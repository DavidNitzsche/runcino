/**
 * scripts/p0-proof/authoring-recompute-parity.ts · READ-ONLY. §6 of the P0
 * handback: "record initial authored paces, recompute immediately without new
 * evidence, diff every material field."
 *
 * The owner's live plan was authored 2026-08-31 (legacy cascade) and promoted
 * to canonical prices the same day by `recomputePacesForPlan`
 * (`authored_state.pace_recompute.source = prescription_wire_1_promotion`), and
 * its race rows were refreshed by the brain on 2026-09-02. This script replays
 * the recompute's row pricing IN MEMORY against the live rows with today's
 * canonical anchors — the exact `buildWorkoutSpec` call and arguments
 * `lib/plan/recompute-paces.ts` makes — and diffs every material field. A
 * non-zero diff on a training row means a second recompute would move a row
 * with no new evidence, which is the failure §6 names.
 *
 * Usage: DATABASE_URL=$DATABASE_URL_RO npx tsx --tsconfig tsconfig.json scripts/p0-proof/authoring-recompute-parity.ts <out.json>
 */
import fs from 'node:fs';
import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { resolvePrescribedPaceAnchors } from '@/lib/training/load-prescription-anchors';
import { loadEffectiveMaxHr } from '@/lib/training/max-hr';
import { buildWorkoutSpec } from '@/lib/plan/spec-builder';
import { achievableRaceTarget } from '@/lib/training/achievable-target';

const USER = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const OUT = process.argv[2] ?? 'authoring-recompute-parity.json';

async function main() {
  const today = await runnerToday(USER);
  const plan = (await pool.query<{ id: string; authored_state: Record<string, unknown>; goal_iso: string | null; authored_iso: string }>(
    `SELECT id, authored_state, goal_iso, authored_iso::text AS authored_iso FROM training_plans
      WHERE user_uuid = $1::uuid AND archived_iso IS NULL ORDER BY authored_iso DESC LIMIT 1`, [USER],
  )).rows[0];
  const st = plan.authored_state ?? {};
  const anchorRead = await resolvePrescribedPaceAnchors(USER, today);
  if (!anchorRead.ok) throw new Error('anchors refused: ' + anchorRead.reason);
  // PARITY_ANCHORS=stamp replays the recompute at the anchors the plan was
  // LAST PRICED AT (authored_state.pace_recompute.anchors) — "recompute
  // immediately, without new evidence". The default replays at today's
  // anchors, which includes whatever evidence landed since.
  const stamped = (st as { pace_recompute?: { anchors?: Record<string, number> } }).pace_recompute?.anchors;
  const anchors = process.env.PARITY_ANCHORS === 'stamp' && stamped
    ? { ...anchorRead.anchors,
        thresholdSecPerMi: stamped.threshold_s_per_mi, intervalSecPerMi: stamped.interval_s_per_mi,
        repetitionSecPerMi: stamped.repetition_s_per_mi, easyCeilingSecPerMi: stamped.easy_ceiling_s_per_mi,
        shakeoutCeilingSecPerMi: stamped.shakeout_ceiling_s_per_mi, marathonSecPerMi: stamped.marathon_s_per_mi }
    : anchorRead.anchors;
  const lthr = (await pool.query<{ lthr: number | null }>(`SELECT lthr FROM profile WHERE user_uuid = $1::uuid`, [USER])).rows[0]?.lthr ?? null;
  const maxHr = (await loadEffectiveMaxHr(USER, today)).bpm;
  const raceDistanceMi = Number(st.race_distance_mi ?? st.goal_distance_mi) || null;
  const goalPaceSec = st.goal_pace_s_per_mi != null ? Number(st.goal_pace_s_per_mi) : null;
  const goalSec = st.goal_sec != null ? Number(st.goal_sec) : (goalPaceSec != null && raceDistanceMi != null ? Math.round(goalPaceSec * raceDistanceMi) : null);
  const totalWeeks = Number(st.total_weeks ?? 14);
  const prescribedRacePaceSec = raceDistanceMi && goalSec
    ? achievableRaceTarget({ goalSec, currentVdot: anchors.basis.threshold.vdot ?? 47, raceDistanceMi, totalWeeks })?.paceSPerMi ?? null
    : null;

  const rows = (await pool.query<{ id: string; date_iso: string; type: string; distance_mi: string | null; sub_label: string | null; pace_target_s_per_mi: number | null; workout_spec: Record<string, unknown> | null }>(
    `SELECT id, date_iso::text AS date_iso, type, distance_mi::text AS distance_mi, sub_label, pace_target_s_per_mi, workout_spec
       FROM plan_workouts WHERE plan_id = $1 AND date_iso::date >= $2::date
        AND type <> ALL($3::text[]) ORDER BY date_iso`,
    [plan.id, today, ['rest', 'cross', 'strength', 'race', 'race_week_tuneup']],
  )).rows;

  const diffs: unknown[] = []; let changed = 0; let maxPaceDelta = 0; let sumAbs = 0; let sumMi = 0; let hrChanges = 0; let bandChanges = 0;
  for (const row of rows) {
    const distanceMi = row.distance_mi != null ? Number(row.distance_mi) : null;
    const built = buildWorkoutSpec(row.type, distanceMi, anchors.thresholdSecPerMi, lthr, row.sub_label, maxHr, goalPaceSec,
      anchors.intervalSecPerMi, anchors.thresholdSecPerMi, false, prescribedRacePaceSec, anchors);
    const live = row.workout_spec ?? {};
    const spec = (built.spec ?? {}) as Record<string, unknown>;
    const fields = ['pace_target_s_per_mi_lo', 'pace_target_s_per_mi_hi', 'hr_cap_bpm', 'kind'] as const;
    const d: Record<string, unknown> = {};
    for (const f of fields) if (JSON.stringify(live[f] ?? null) !== JSON.stringify(spec[f] ?? null)) d[f] = { live: live[f] ?? null, recomputed: spec[f] ?? null };
    const livePace = row.pace_target_s_per_mi != null ? Number(row.pace_target_s_per_mi) : null;
    const newPace = built.paceTargetSPerMi ?? null;
    if (livePace !== newPace) d.pace_target_s_per_mi = { live: livePace, recomputed: newPace };
    const delta = livePace != null && newPace != null ? Math.abs(newPace - livePace) : 0;
    maxPaceDelta = Math.max(maxPaceDelta, delta); sumAbs += delta * (distanceMi ?? 0); sumMi += distanceMi ?? 0;
    if ('hr_cap_bpm' in d) hrChanges++;
    if ('pace_target_s_per_mi_lo' in d || 'pace_target_s_per_mi_hi' in d) bandChanges++;
    if (Object.keys(d).length) { changed++; diffs.push({ id: row.id, date: row.date_iso, type: row.type, sub_label: row.sub_label, distanceMi, diff: d }); }
  }
  const out = {
    user: USER, today, planId: plan.id, authoredISO: plan.authored_iso, anchorsMode: process.env.PARITY_ANCHORS === 'stamp' ? 'stamped (no new evidence)' : 'today',
    lastRecompute: (st as { pace_recompute?: unknown }).pace_recompute ?? null,
    raceRowRefresh: (st as { race_row_refresh?: unknown }).race_row_refresh ?? null,
    anchorsToday: { threshold: anchors.thresholdSecPerMi, interval: anchors.intervalSecPerMi, repetition: anchors.repetitionSecPerMi, easyCeiling: anchors.easyCeilingSecPerMi, shakeoutCeiling: anchors.shakeoutCeilingSecPerMi, marathon: anchors.marathonSecPerMi, lthr, maxHr },
    rowsCompared: rows.length, rowsChanged: changed, maxPaceDeltaSPerMi: maxPaceDelta,
    volumeWeightedMeanAbsDeltaSPerMi: sumMi > 0 ? Math.round((sumAbs / sumMi) * 10) / 10 : 0,
    hrChanges, bandChanges, structuralChanges: 0, note: 'structure (distance, type, day) is not repriced by a recompute by construction; race rows are owned by the race-row refresh and reported in the live-plan ledger',
    diffs,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ rowsCompared: rows.length, rowsChanged: changed, maxPaceDeltaSPerMi: maxPaceDelta, volumeWeightedMeanAbsDeltaSPerMi: out.volumeWeightedMeanAbsDeltaSPerMi, hrChanges, bandChanges }));
  for (const d of diffs.slice(0, 20)) console.log(JSON.stringify(d));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
