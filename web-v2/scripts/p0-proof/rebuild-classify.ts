/**
 * REBUILD CLASSIFY · full before/after classification of every day the
 * rebuild would change, per David's 2026-09-03 authorization §3. Read-only.
 * Unlike rebuild-preview.ts (type + distance only, 0.05mi tolerance), this
 * also flags pace-only and HR-only changes on days whose type/distance agree,
 * and pulls each day's workout_spec to detect marathon-pace content and
 * quality-session structure changes.
 */
import { pool } from '@/lib/db/pool';
import { composeForUser } from '@/lib/plan/generate';

const U = process.env.PROBE_UUID || '0645f40c-951d-4ccc-b86e-9979cd26c795';

interface Row {
  iso: string; type: string; mi: number; subLabel: string | null;
  paceSPerMi: number | null; hrCap: number | null; isQuality: boolean; isLong: boolean;
  specHasMP: boolean; raceSlug: string | null;
}

function specHasMarathonPace(spec: unknown): boolean {
  if (!spec || typeof spec !== 'object') return false;
  const s = JSON.stringify(spec);
  return /"pace_kind":"M"|@ ?M\b|marathon.?pace/i.test(s);
}

async function main() {
  const plan = (await pool.query<{ id: string; race_id: string | null; goal_iso: string | null }>(
    `SELECT id, race_id, goal_iso FROM training_plans
      WHERE user_uuid = $1 AND archived_iso IS NULL ORDER BY authored_iso DESC LIMIT 1`, [U])).rows[0];
  if (!plan) { console.log('no active plan'); return; }

  const liveRows = (await pool.query<{
    date_iso: string; type: string; sub_label: string | null; distance_mi: string | null;
    pace_target_s_per_mi: number | null; workout_spec: unknown; is_quality: boolean; is_long: boolean;
  }>(`SELECT date_iso, type, sub_label, distance_mi, pace_target_s_per_mi, workout_spec, is_quality, is_long
        FROM plan_workouts WHERE plan_id = $1 ORDER BY date_iso`, [plan.id])).rows;

  const live = new Map<string, Row>();
  for (const r of liveRows) {
    const iso = String(r.date_iso).slice(0, 10);
    const spec = r.workout_spec as Record<string, unknown> | null;
    live.set(iso, {
      iso, type: r.type, mi: Number(r.distance_mi ?? 0), subLabel: r.sub_label,
      paceSPerMi: r.pace_target_s_per_mi, hrCap: spec ? Number((spec as any).hr_cap_bpm ?? NaN) || null : null,
      isQuality: r.is_quality, isLong: r.is_long, specHasMP: specHasMarathonPace(spec),
      raceSlug: r.type === 'race' ? (spec ? String((spec as any).race_slug ?? '') : null) : null,
    });
  }

  const composed = await composeForUser({ userId: U, raceSlug: plan.race_id ?? undefined });
  if (!composed.ok) { console.log(`COMPOSE REFUSED: ${composed.reason}`); return; }
  const cr = composed.result.composed as unknown as { weeks: Array<{ startISO: string; days: Array<Record<string, unknown>> }> };

  const newRows = new Map<string, Row>();
  for (const w of cr.weeks ?? []) {
    const startMs = Date.parse(w.startISO + 'T12:00:00Z');
    const startDow = new Date(startMs).getUTCDay();
    for (const d of w.days ?? []) {
      const dow = Number(d.dow);
      const offset = ((dow - startDow) % 7 + 7) % 7;
      const iso = new Date(startMs + offset * 86400000).toISOString().slice(0, 10);
      const spec = (d.workoutSpec ?? d.spec ?? null) as Record<string, unknown> | null;
      newRows.set(iso, {
        iso, type: String(d.type ?? ''), mi: Number(d.distanceMi ?? 0),
        subLabel: (d.subLabel as string | null) ?? null,
        paceSPerMi: (d.paceTargetSPerMi as number | null) ?? null,
        hrCap: spec ? Number((spec as any).hr_cap_bpm ?? NaN) || null : null,
        isQuality: Boolean(d.isQuality), isLong: Boolean(d.isLong),
        specHasMP: specHasMarathonPace(spec),
        raceSlug: String(d.type) === 'race' ? (spec ? String((spec as any).race_slug ?? '') : null) : null,
      });
    }
  }

  const allISO = [...new Set([...live.keys(), ...newRows.keys()])].sort();

  const out: Array<{
    iso: string; kind: string; l?: Row; n?: Row;
    typeChanged: boolean; distanceDeltaAbs: number; paceChanged: boolean; hrChanged: boolean;
    mpChanged: boolean; qualityChanged: boolean; longChanged: boolean;
  }> = [];

  for (const iso of allISO) {
    const l = live.get(iso);
    const n = newRows.get(iso);
    if (!l && n) { out.push({ iso, kind: 'NEW_DAY', n, typeChanged: true, distanceDeltaAbs: n.mi, paceChanged: false, hrChanged: false, mpChanged: n.specHasMP, qualityChanged: n.isQuality, longChanged: n.isLong }); continue; }
    if (l && !n) { out.push({ iso, kind: 'REMOVED_DAY', l, typeChanged: true, distanceDeltaAbs: l.mi, paceChanged: false, hrChanged: false, mpChanged: l.specHasMP, qualityChanged: l.isQuality, longChanged: l.isLong }); continue; }
    if (!l || !n) continue;
    const typeChanged = l.type !== n.type;
    const distanceDeltaAbs = Math.abs(l.mi - n.mi);
    const paceChanged = (l.paceSPerMi ?? null) !== (n.paceSPerMi ?? null);
    const hrChanged = (l.hrCap ?? null) !== (n.hrCap ?? null);
    const mpChanged = l.specHasMP !== n.specHasMP;
    const qualityChanged = l.isQuality !== n.isQuality;
    const longChanged = l.isLong !== n.isLong;
    if (!typeChanged && distanceDeltaAbs < 0.05 && !paceChanged && !hrChanged && !mpChanged && !qualityChanged && !longChanged) continue;
    out.push({ iso, kind: 'CHANGED', l, n, typeChanged, distanceDeltaAbs, paceChanged, hrChanged, mpChanged, qualityChanged, longChanged });
  }

  console.log(JSON.stringify({ planId: plan.id, raceId: plan.race_id, total: out.length, days: out }, null, 2));
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
