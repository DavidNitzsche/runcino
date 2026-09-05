// POST /api/cron/snapshot-projections
//
// Daily VDOT + projection snapshot for every active user. Runs once
// per day; cheap to re-run (UPSERTs idempotently on the
// (user_uuid, snapshot_date, distance_mi) UNIQUE).
//
// Snapshots are read by race-header.ts to compute the projection-trend
// delta without re-running the full VDOT chain across 180 days of data
// on every page load.
//
// For each active user:
//   1. Read recent A/B races (last 180d, with actual_result preference)
//   2. Read recent quality runs (last 60d, ≥4mi, ≥80%MHR or quality-typed)
//   3. Compute bestRecentVdot off race + run candidates
//   4. Compute projection for each canonical distance (HM, M) + the user's
//      anchored race distance if different
//   5. UPSERT projection_snapshots row
//
// Auth: same CRON_SECRET as other cron routes.

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import {
  bestRecentVdot, VDOT_FULL_VALUE_DAYS, predictRaceTime, EVIDENCE_RUN_FLOOR_MI,
} from '@/lib/training/vdot';
import { recordProjectionSnapshot } from '@/lib/training/projection-snapshots';
import { loadEffectiveMaxHr, ratchetUsersMaxHr } from '@/lib/training/max-hr';
import { loadVdotInputs } from '@/lib/training/vdot-inputs';
import { reanchorActivePlan, isReanchorDeferral, isReanchorProposed } from '@/lib/plan/reanchor-plan';
import { distanceMiFromLabel } from '@/lib/race/distance';
import { refreshRunnerCalibration } from '@/lib/coach/runner-calibration';
import { resolveNextAGoalProjection } from '@/lib/training/goal-projection-resolve';
import { checkAndNotifyProjectionChange } from '@/lib/notifications/projection-changed';
import { recordCronSuccess } from '@/lib/ops/cron-ledger';

export const maxDuration = 60;

const CANONICAL_DISTANCES = [13.1, 26.2]; // HM + M; race-anchored distance added per user

// 2026-07-07 · ultra-honesty audit · delegate to the shared parser so an
// ultra-anchored plan's race resolves its real distance for the snapshot
// set (was a local fork with no ultra branches — already returned null on
// unmatched, no 13.1 fallthrough bug). predictRaceTime below independently
// refuses to project past the marathon regardless of what distance resolves
// here, so an ultra anchor still snapshots an honest null projection.
function distFromLabel(label: string | null | undefined): number | null {
  return distanceMiFromLabel(label);
}

async function snapshotForUser(userUuid: string, today: string): Promise<{ vdot: number | null; snapshots: Array<{ distance: number; sec: number | null }>; reanchor: Awaited<ReturnType<typeof reanchorActivePlan>>; raceRows: { updated: number; refused: number } | null; convergence: string | null }> {
  // Ratchet stored max_hr if a new ceiling was observed this year.
  // loadVdotInputs calls loadEffectiveMaxHr internally for the run-candidate
  // HR gate; we call it separately here for the ratchet side effect only.
  const effMaxHr = await loadEffectiveMaxHr(userUuid, today);
  if (effMaxHr.source === 'observed_12mo') {
    await ratchetUsersMaxHr(userUuid, today).catch(() => null);
  }

  // Evidence-only honest-effort floor (2026-09-01 fix — see
  // EVIDENCE_RUN_FLOOR_MI's header in vdot.ts): a short-distance runner's
  // ~3.1mi quality efforts count as fitness candidates because the effort
  // itself is field-test length, never because of what the runner's goal is.
  const runFloorMi = EVIDENCE_RUN_FLOOR_MI;

  // Race + run candidates via the shared canonical loader.
  // Throws on DB error — the outer loop catches per-user, logs, and continues
  // rather than storing VDOT=null from a transient failure.
  const { raceCandidates, runCandidates } = await loadVdotInputs(userUuid, today);
  const { best } = bestRecentVdot(raceCandidates, today, VDOT_FULL_VALUE_DAYS, runCandidates, runFloorMi);
  const vdot = best?.vdot ?? null;

  // Race-anchored distance (if active plan ties to a race).
  const planRow = (await pool.query<{ race_id: string | null }>(
    `SELECT race_id FROM training_plans
      WHERE user_uuid = $1 AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [userUuid],
  ).catch(() => ({ rows: [] }))).rows[0];
  let anchorDistance: number | null = null;
  let anchorSlug: string | null = null;
  if (planRow?.race_id) {
    // 2026-06-05 · backend audit P0-6 fix · scope race lookup by user.
    // Cite docs/2026-06-05-backend-audit.html § P0-6.
    const raceMeta = (await pool.query<{ meta?: Record<string, unknown> }>(
      `SELECT meta FROM races WHERE slug = $1 AND user_uuid = $2`,
      [planRow.race_id, userUuid],
    ).catch(() => ({ rows: [] }))).rows[0]?.meta;
    if (raceMeta) {
      anchorDistance = raceMeta.distanceMi ? Number(raceMeta.distanceMi) : distFromLabel(raceMeta.distanceLabel as string);
      anchorSlug = planRow.race_id;
    }
  }

  const distancesToSnapshot = new Set([...CANONICAL_DISTANCES]);
  if (anchorDistance && !distancesToSnapshot.has(anchorDistance)) distancesToSnapshot.add(anchorDistance);

  const snapshots: Array<{ distance: number; sec: number | null }> = [];
  for (const d of distancesToSnapshot) {
    const projSec = vdot != null ? predictRaceTime(vdot, d) : null;
    // #N1 (audit 2026-06-16) · attach the race slug ONLY to the row whose
    // distance matches the anchored race. The other canonical distances are
    // generic fitness-trend projections and must carry race_slug = null —
    // tagging them with the anchor's slug mislabeled e.g. the 26.2 marathon
    // row as belonging to a 13.1 half (americas-finest-city). Distance-keyed
    // readers were unaffected, but the slug column was lying about which race
    // a projection belonged to.
    const slugForDistance = (anchorDistance != null && d === anchorDistance) ? anchorSlug : null;
    await recordProjectionSnapshot(
      userUuid, today, d, vdot, projSec, slugForDistance,
      best?.date ?? null, best?.distance_mi ?? null, 'cron-daily',
    );
    snapshots.push({ distance: d, sec: projSec });
  }

  // Self-heal: if this runner's ACTIVE plan was anchored provisionally (or
  // their fitness has shifted >= 2 VDOT), refresh its future paces in place off
  // the measured read. This is what makes a provisional / calibrating plan never
  // get stuck on fabricated paces, and it is what ENDS the calibration intro.
  //
  // 2026-08-17 · COLD-4 · was scoped to no-race plans only, so a race-prep
  // runner on an invented anchor had no path off it. `vdot` here is
  // `bestRecentVdot(...)` — evidence-only, so a null read leaves the plan alone
  // rather than re-anchoring onto another estimate. Best-effort.
  let reanchor: Awaited<ReturnType<typeof reanchorActivePlan>> = null;
  try {
    // Thread the winning candidate's provenance through so a phone read of
    // GET /api/v5/paces days later can tell "a race confirmed this" from
    // "training evidence modelled this" (lib/plan/pace-drop-event.ts).
    reanchor = await reanchorActivePlan(userUuid, vdot, today, best
      ? { source: best.source, refId: best.source === 'race' ? best.slug : best.id }
      : null);
  }
  // 2026-08-25 · A FAILED PLAN REWRITE USED TO LEAVE NO TRACE ANYWHERE.
  //
  // This was `catch { reanchor = null; }` — a bare catch with no binding, so
  // the error object was not merely unlogged, it was unreachable. `reanchor:
  // null` in the cron's JSON response is also what a runner who needed no
  // re-anchor produces, so "nothing to do" and "the rewrite threw" were the
  // same output, in the response, in the Railway logs and in `ops_alerts`.
  //
  // This route is named `snapshot-projections` and reads like a reporting job,
  // but `reanchorActivePlan` rewrites `plan_workouts.pace_target_s_per_mi` and
  // `workout_spec` for every future unsealed day. It is the third automatic
  // writer of the runner's plan, alongside the drift cron and the rebuild core,
  // and the only one whose name does not say so. A failure here means the
  // runner trains tomorrow to the paces of an anchor the engine already knows
  // is wrong. That should be loud.
  catch (e) {
    reanchor = null;
    console.error('[snapshot-projections] plan re-anchor failed:', userUuid, e);
  }

  // 2026-09-01 · P0 · the plan's RACE rows follow the race-pace brain daily,
  // through the dedicated canonical path (lib/race/race-row-refresh.ts). The
  // reanchor above refreshes them too when it rewrites paces; this call is
  // what keeps them current on a day the anchor did NOT move but the runway
  // did. Idempotent — an unchanged row is reported, not rewritten (Rule 23).
  let raceRows: { updated: number; refused: number } | null = null;
  try {
    const active = (await pool.query<{ id: string }>(
      `SELECT id FROM training_plans
        WHERE user_uuid = $1::uuid AND archived_iso IS NULL
        ORDER BY authored_iso DESC LIMIT 1`,
      [userUuid],
    )).rows[0];
    if (active) {
      const { refreshRaceRowsForPlan } = await import('@/lib/race/race-row-refresh');
      const r = await refreshRaceRowsForPlan(active.id, { todayISO: today, source: 'cron/snapshot-projections' });
      raceRows = r ? { updated: r.updated, refused: r.refused } : null;
      if (r && r.refused > 0) {
        console.error('[snapshot-projections] race-row refresh refused rows:', userUuid, r.rows.filter((x) => x.action === 'refused'));
      }
    }
  } catch (e) {
    console.error('[snapshot-projections] race-row refresh failed:', userUuid, e);
  }

  /* RULE 23 · CANNOT-CONVERGE-1 (2026-09-01) · SAY SO WHEN A PLAN IS STILL
   * PRICED BY NOTHING, AFTER THIS JOB HAS HAD ITS TURN.
   *
   * The 2026-09-01 independent audit's second finding was not that convergence
   * lagged — it was that for 6 of 7 live plans it had NEVER happened, and
   * nobody knew: no alert, no staleness check, discovered only because a human
   * queried `training_plans` by hand. `reanchorActivePlan` above now covers the
   * runner with no measured VDOT (`reanchorOffCanonicalPrior`); this is the
   * check that the coverage is actually holding.
   *
   * Runs AFTER the reanchor, so it judges the state that survives the fix, and
   * best-effort: a failure to raise an alert must never fail the job that
   * writes the runner's paces.
   */
  let convergence: string | null = null;
  try {
    const { alertOnUnconvergedPlan } = await import('@/lib/adaptation/authoring-convergence');
    convergence = await alertOnUnconvergedPlan(userUuid);
  } catch (e) {
    console.error('[snapshot-projections] convergence check failed:', userUuid, e);
  }

  return { vdot, snapshots, reanchor, raceRows, convergence };
}

export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({
      error: 'CRON_SECRET not configured.',
    }, { status: 503 });
  }
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (token !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // 2026-06-03 · per-user TZ · each runner's snapshot is anchored to
  // their calendar day, not the server's UTC day.
  const { runnerToday } = await import('@/lib/runtime/runner-tz');
  const userIds = (await pool.query<{ user_uuid: string }>(
    `SELECT DISTINCT user_uuid FROM training_plans
      WHERE archived_iso IS NULL AND user_uuid IS NOT NULL`,
  ).catch(() => ({ rows: [] }))).rows.map((r) => r.user_uuid);

  // 2026-06-10 · multi-user: the SELECT above IS the population — no
  // hardcoded-user append. (Pre-signup this force-included David's UUID
  // as legacy-row paranoia; every active plan now carries user_uuid.)

  const results: Array<{ user_uuid: string; vdot: number | null; snapshots: Array<{ distance: number; sec: number | null }>; reanchored?: { mode: string; from: number | null; to: number; workouts: number; sealed: number; cleared_provisional: boolean }; reanchor_skipped?: { plan_id: string; reason: string; window_hours: number }; reanchor_proposed?: { plan_id: string; arm: string; status: string; proposal_id?: number; workouts?: number; sealed?: number; mean_anchor_delta_s_per_mi?: number; superseded_id?: number | null; reason?: string; error?: string; until?: string }; calibration?: { data_quality: string; workouts: number; quality: number } | { error: string }; projectionAlert?: { race_slug: string; sent: boolean; reason: string; recorded: boolean } | { error: string }; error?: string }> = [];
  for (const u of userIds) {
    try {
      const today = await runnerToday(u);
      const r = await snapshotForUser(u, today);

      // 2026-08-17 · multi-user hygiene: runner_calibration had ZERO
      // writers (the weekly cron its header once named was never built —
      // one hand-made row existed). Refresh per user here, AFTER the
      // snapshot write. .catch-guarded end to end: a calibration failure
      // must never break or mask the projection snapshot.
      const calibration = await refreshRunnerCalibration(u)
        .then((c) => ({ data_quality: c.dataQuality as string, workouts: c.sourceWorkoutCount, quality: c.sourceQualityCount }))
        .catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));

      // 2026-08-26 · David asked for a push when the Races card's
      // "Projected" moves >= 30s day-over-day. Resolves the SAME
      // computeGoalProjection number the card reads (goal-projection-resolve
      // is the shared source for both), snapshots it, and diffs against
      // yesterday. Its own try/catch — a failed alert must never mask or
      // break the projection snapshot this route exists to write.
      let projectionAlert: { race_slug: string; sent: boolean; reason: string; recorded: boolean } | { error: string } | undefined;
      try {
        const goalProjection = await resolveNextAGoalProjection(u);
        if (goalProjection) {
          const check = await checkAndNotifyProjectionChange({
            userUuid: u,
            raceSlug: goalProjection.raceSlug,
            raceName: goalProjection.raceName,
            todayISO: today,
            projectedSec: goalProjection.projectedSec,
          });
          // `recorded` (2026-08-30) is the half that was missing: this row
          // is now the Races chart's series, not just the push's diff, so
          // the response has to say whether it actually landed. It had not
          // been landing at all — migration 155 was unapplied in prod and
          // the write sat behind a bare `.catch`.
          projectionAlert = {
            race_slug: goalProjection.raceSlug, sent: check.sent,
            reason: check.reason, recorded: check.recorded,
          };
        }
      } catch (e: unknown) {
        projectionAlert = { error: e instanceof Error ? e.message : String(e) };
        console.error('[snapshot-projections] projection-change alert failed:', u, e);
      }

      results.push({
        user_uuid: u, vdot: r.vdot, snapshots: r.snapshots,
        // 2026-08-28 · a same-morning deferral to the 03:00 adapter is a
        // recorded no-op, not silence — the audit trail must distinguish
        // "stood down for the adapter's move" from "nothing to do".
        // REANCHORPROPOSES-1 (2026-09-05) · the third branch, and the one this
        // job now takes on every ordinary day. The self-heal RAISES A CARD
        // instead of writing; `reanchor_proposed.status` carries the writer's
        // own verdict so `written`, `unchanged`, `quiet_after_dismissal`,
        // `no_target`, `refused` and `read_failed` are six distinguishable
        // facts in the response rather than one absent key (Rule 11). The
        // `reanchored` branch below survives because `forceReanchorActivePlan`
        // still applies on the runner's own race-authority answer.
        ...(r.reanchor && isReanchorDeferral(r.reanchor)
          ? { reanchor_skipped: { plan_id: r.reanchor.planId, reason: r.reanchor.reason, window_hours: r.reanchor.windowHours } }
          : r.reanchor && isReanchorProposed(r.reanchor)
            ? { reanchor_proposed: {
                plan_id: r.reanchor.planId,
                arm: r.reanchor.arm,
                status: r.reanchor.outcome.status,
                ...(r.reanchor.outcome.status === 'written'
                  ? {
                      proposal_id: r.reanchor.outcome.proposalId,
                      workouts: r.reanchor.outcome.payload.workoutsAffected,
                      sealed: r.reanchor.outcome.payload.workoutsSealed,
                      mean_anchor_delta_s_per_mi: r.reanchor.outcome.payload.meanAnchorDeltaSecPerMi,
                      superseded_id: r.reanchor.outcome.supersededId,
                    }
                  : r.reanchor.outcome.status === 'read_failed'
                    ? { error: r.reanchor.outcome.error.message }
                    : r.reanchor.outcome.status === 'refused' || r.reanchor.outcome.status === 'unchanged'
                      || r.reanchor.outcome.status === 'no_target'
                      ? { reason: r.reanchor.outcome.reason }
                      : { until: r.reanchor.outcome.untilISO }),
              } }
            : r.reanchor
              ? { reanchored: { mode: r.reanchor.mode, from: r.reanchor.fromVdot, to: r.reanchor.toVdot, workouts: r.reanchor.workoutsUpdated, sealed: r.reanchor.workoutsSealed, cleared_provisional: r.reanchor.clearedProvisional } }
              : {}),
        calibration,
        ...(projectionAlert ? { projectionAlert } : {}),
      });
    } catch (e: unknown) {
      results.push({
        user_uuid: u, vdot: null, snapshots: [],
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // 2026-08-30 · scheduler ledger (lib/ops/cron-ledger.ts). plan-drift's
  // goal-gap findings refuse to fire when this job's output is more than 36h
  // old, so this stamp is also what tells the operator WHY they went quiet.
  await recordCronSuccess('snapshot-projections', {
    users: results.length,
    errors: results.filter((r) => r.error).length,
  });

  return NextResponse.json({
    ok: results.every((r) => !r.error),
    // 2026-06-03 · per-runner today now resolved inside the loop;
    // top-level stamp is server UTC (a moment, not a calendar day).
    timestamp: new Date().toISOString(),
    users: results.length,
    results,
  });
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/cron/snapshot-projections',
    auth: 'Authorization: Bearer <CRON_SECRET>',
    recommended_schedule: '30 7 * * *  (daily at 00:30 PT = 07:30 UTC)',
  });
}
