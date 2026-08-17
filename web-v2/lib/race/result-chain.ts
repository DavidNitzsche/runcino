/**
 * lib/race/result-chain.ts · the shared post-race-result chain.
 *
 * 2026-08-17 · race-lifecycle fixes. Extracted from app/api/race/result/
 * route.ts so BOTH writers of races.actual_result.finishS run the same
 * follow-on steps:
 *
 *   · the manual chip-time route (POST /api/race/result)
 *   · the auto-provisional detector (lib/race/auto-result.ts, fired from
 *     the plan-drift cron the morning after a race)
 *
 * Steps (identical to the route's original 2-4):
 *   1. Projection snapshots for the race distance + 26.2M.
 *   2. vdot_auto_recalc coach_intent (briefing layer signal).
 *   3. Archive the active plan if this race is its goal race
 *      (archive_reason = 'race_completed').
 *   4. Generate a plan for the next A/B race (optional · regeneratePlan).
 *   5. Bust the briefing cache.
 *
 * Fix folded in during extraction: the route called
 * recordProjectionSnapshot(userId, today, distanceMi, vdot, projSec,
 * slug, 'race-result') — 'race-result' landed in the anchorDateISO
 * positional slot, the `$7::date` cast threw, and the .catch swallowed
 * it, so race-result snapshots were NEVER written. The chain passes the
 * race date + distance as the anchor and 'race-result' as the source.
 *
 * Rule 6 note: this module does NOT write actual_result. Each caller
 * owns its own field-level jsonb merge (`COALESCE(actual_result,'{}')
 * || patch`) so no writer can clobber fields it doesn't know about.
 * manualResultPatch / the auto detector's provisionalResultPatch are
 * the two patch builders; both are pure and unit-tested.
 */

import { pool } from '@/lib/db/pool';
import { vdotFromRace, predictRaceTime } from '@/lib/training/vdot';
import { recordProjectionSnapshot } from '@/lib/training/projection-snapshots';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';

export function fmtFinish(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.round(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Patch object the MANUAL route merges into actual_result. Marking
 * source:'manual' / provisional:false here is what lets a later chip
 * time overwrite an auto-logged watch result: the jsonb || merge
 * replaces finishS/finishDisplay/source and clears the provisional
 * flag, while preserving fields the manual entry doesn't carry (the
 * matched runId keeps its provenance value).
 */
export function manualResultPatch(
  finishS: number,
  avgHrBpm: number | null,
): Record<string, unknown> {
  return {
    finishS,
    finishDisplay: fmtFinish(finishS),
    source: 'manual',
    provisional: false,
    // Retro-page confirm flow: records when the runner locked the result
    // in (confirming or correcting an auto-logged watch_provisional).
    confirmedAt: new Date().toISOString(),
    ...(avgHrBpm != null ? { avgHrBpm } : {}),
  };
}

export interface NextPlanResult {
  ok: boolean;
  raceSlug: string;
  raceName: string;
  plan_id?: string;
  weeks_generated?: number;
  compressed?: boolean;
  reason?: string;
}

export interface PostResultOutcome {
  vdotBefore: number | null;
  vdotAfter: number | null;
  projectionSec: number | null;
  marathonProjectionSec: number | null;
  planArchived: boolean;
  nextPlan: NextPlanResult | null;
}

export interface PostResultChainArgs {
  userId: string;
  raceSlug: string;
  /** meta->>'date' of the resulted race. Null tolerated (route parity):
   *  the next-race query then throws into the inner catch and surfaces
   *  in nextPlan.reason instead of silently skipping. */
  raceDateISO: string | null;
  distanceMi: number | null;
  finishS: number;
  /** When false, steps 1-3 + cache bust still run but no next plan is
   *  generated (used by the auto detector for C-priority races so a
   *  parkrun result can't archive-and-rebuild a mid-block plan). */
  regeneratePlan?: boolean;
}

export async function runPostResultChain(args: PostResultChainArgs): Promise<PostResultOutcome> {
  const { userId, raceSlug, raceDateISO, distanceMi, finishS } = args;
  const regeneratePlan = args.regeneratePlan !== false;

  // ── 1. Immediate projection snapshots ──────────────────────────────
  const today = await runnerToday(userId);
  const vdot = distanceMi ? vdotFromRace(finishS, distanceMi) : null;

  const priorSnap = (await pool.query<{ vdot: string | null }>(
    `SELECT vdot FROM projection_snapshots
      WHERE user_uuid = $1 AND distance_mi = $2
      ORDER BY snapshot_date DESC LIMIT 1`,
    [userId, distanceMi ?? 13.1],
  ).catch(() => ({ rows: [] }))).rows[0];
  const vdotBefore = priorSnap?.vdot ? Number(priorSnap.vdot) : null;

  const projSec = vdot != null && distanceMi ? predictRaceTime(vdot, distanceMi) : null;
  const mProjSec = vdot != null ? predictRaceTime(vdot, 26.2) : null;

  if (vdot != null && distanceMi) {
    await recordProjectionSnapshot(
      userId, today, distanceMi, vdot, projSec, raceSlug,
      raceDateISO, distanceMi, 'race-result',
    ).catch(() => null);
  }
  if (vdot != null) {
    await recordProjectionSnapshot(
      userId, today, 26.2, vdot, mProjSec, raceSlug,
      raceDateISO, distanceMi, 'race-result',
    ).catch(() => null);
  }

  // ── 2. vdot coach_intent (briefing layer signal) ───────────────────
  if (vdot != null) {
    await pool.query(
      `INSERT INTO coach_intents (user_id, user_uuid, reason, field, value)
       VALUES ($1, $1, 'vdot_auto_recalc', 'vdot', $2)`,
      [userId, String(vdot)],
    ).catch(() => null);
  }

  // ── 3. Archive active plan if this was its goal race ───────────────
  // Two-attempt fallback: archive_reason column may not exist yet if the
  // migration hasn't run. archived_iso is the load-bearing field.
  let planArchived = false;
  try {
    const r = await pool.query(
      `UPDATE training_plans
         SET archived_iso = NOW(), archive_reason = 'race_completed'
       WHERE user_uuid = $1
         AND race_id = $2
         AND archived_iso IS NULL`,
      [userId, raceSlug],
    );
    planArchived = (r.rowCount ?? 0) > 0;
  } catch {
    try {
      const r = await pool.query(
        `UPDATE training_plans SET archived_iso = NOW()
         WHERE user_uuid = $1 AND race_id = $2 AND archived_iso IS NULL`,
        [userId, raceSlug],
      );
      planArchived = (r.rowCount ?? 0) > 0;
    } catch { /* best-effort */ }
  }

  // ── 4. Auto-generate plan for the next A/B race ────────────────────
  // Inner try/catch: failures surface in nextPlan.reason, not as a throw.
  // null = no future A/B race found (generation not attempted).
  // { ok: false } = generation was attempted but failed.
  let nextPlan: NextPlanResult | null = null;
  if (regeneratePlan) {
    try {
      // No .catch here — DB errors throw to the inner catch below so the
      // runner sees the failure reason rather than a silent null.
      const nextRaceRow = (await pool.query<{ slug: string; name: string }>(
        `SELECT slug, meta->>'name' AS name FROM races
          WHERE user_uuid = $1
            AND (meta->>'date')::date > $2::date
            AND meta->>'priority' IN ('A', 'B')
          ORDER BY
            CASE WHEN meta->>'priority' = 'A' THEN 0 ELSE 1 END,
            (meta->>'date')::date
          LIMIT 1`,
        [userId, raceDateISO ?? '9999-99-99'],
      )).rows[0];

      if (nextRaceRow) {
        const { generatePlan } = await import('@/lib/plan/generate');
        const gen = await generatePlan({ userId, raceSlug: nextRaceRow.slug });

        let compressed = false;
        if (gen.ok && gen.plan_id) {
          const stRow = (await pool.query<{ authored_state: Record<string, unknown> | null }>(
            `SELECT authored_state FROM training_plans WHERE id = $1`,
            [gen.plan_id],
          ).catch(() => ({ rows: [] }))).rows[0];
          compressed = Boolean(stRow?.authored_state?.compressed_timeline);
        }

        if (!gen.ok) {
          console.error('[race/result-chain] next-plan generation failed:', nextRaceRow.slug, gen.reason);
        }
        nextPlan = {
          ok: gen.ok,
          raceSlug: nextRaceRow.slug,
          raceName: nextRaceRow.name ?? nextRaceRow.slug,
          plan_id: gen.plan_id,
          weeks_generated: gen.weeks_generated,
          compressed,
          reason: gen.reason,
        };
      }
      // nextRaceRow undefined → no future A/B race → nextPlan stays null
    } catch (genErr: unknown) {
      const msg = genErr instanceof Error ? genErr.message : String(genErr);
      console.error('[race/result-chain] next-plan step failed:', msg);
      nextPlan = { ok: false, raceSlug: '', raceName: '', reason: msg };
    }
  }

  await bustBriefingCacheForEvent(userId, 'race_crud');

  return {
    vdotBefore,
    vdotAfter: vdot,
    projectionSec: projSec,
    marathonProjectionSec: mProjSec,
    planArchived,
    nextPlan,
  };
}
