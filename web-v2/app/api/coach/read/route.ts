/**
 * GET /api/coach/read
 *
 * The whole coaching read in one call: what the runner can race today, how
 * well they are absorbing training, what is actually holding the goal back,
 * and what to do about it.
 *
 * This is the surface for the three-model split in
 * `Design/adaptive-progression-engine.md`. Before it existed the models were
 * pure functions with no consumers — correct, tested, and invisible to the
 * person doing the running.
 *
 *   {
 *     fitness:        { vdot, range, confidence, basis, races },
 *     adaptation:     { band, confidence, decision, dimensions[] },
 *     limiter:        { primary, levers[], summary } | null,
 *     recommendation: { action, change, reason, consequence, confidence },
 *     goal:           { gapSec, status, weeksRemaining } | null
 *   }
 *
 * Every block is independently nullable. A runner we cannot see gets nulls and
 * an honest recommendation, never a fabricated reading — the same contract the
 * models hold internally.
 *
 * Surfaces that should consume this: web Today and the block view, iPhone
 * Today, the run recap's "what changes because of it" line, and the coach log.
 * It deliberately returns data rather than copy, so a redesign can recompose
 * it without the engine changing.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { loadVdotInputs } from '@/lib/training/vdot-inputs';
import { bestRecentVdot } from '@/lib/training/vdot';
import { resolveFitness } from '@/lib/fitness/fitness-model';
import { readAdaptation } from '@/lib/adaptation/load';
import { computeGoalGap } from '@/lib/plan/goal-gap';
import { recommendFromAdaptation, renderShort } from '@/lib/coach/recommendation';
import { pool } from '@/lib/db/pool';
import { paceBlendAnchorIsProvisional } from '@/lib/plan/anchor-provenance';
import { GOAL_VDOT_SANITY_BAND } from '@/lib/plan/goal-vdot-sanity';

export const dynamic = 'force-dynamic';

/** Each block degrades on its own. One unreadable model must not blank the
 *  whole read — a partial answer is useful and a 500 is not. */
async function quiet<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[coach/read] ${label} unreadable:`, err instanceof Error ? err.message : err);
    return null;
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const todayISO = await runnerToday(userId);

  const [fitness, adaptation, goalGap, goalVdotSanity] = await Promise.all([
    quiet('fitness', async () => {
      const inputs = await loadVdotInputs(userId, todayISO);
      // FLOOR-1 (2026-08-19) · thread the run floor `loadVdotInputs` actually
      // used. This call omits the arg, so it takes `loadVdotInputs`'s own
      // default (`EVIDENCE_RUN_FLOOR_MI`, evidence-only as of 2026-09-01 — see
      // vdot.ts) — the same default the projection cron, drift monitor, plan
      // generator and targets route all now resolve to as well. Still read
      // back from `inputs.runFloorMi` rather than re-derived here, so the two
      // halves of the ladder can never disagree even if the default changes.
      const { best, considered } = bestRecentVdot(
        inputs.raceCandidates,
        todayISO,
        undefined,
        inputs.runCandidates,
        inputs.runFloorMi,
      );
      return resolveFitness({ best, considered });
    }),
    quiet('adaptation', () => readAdaptation(userId)),
    quiet('goal gap', () => computeGoalGap(userId)),
    // GOAL-SANITY-NAME-1 (2026-09-02) · the active plan's GOAL-VDOT SANITY
    // SCREEN. This was `goalRealism` until 2026-09-02, and the rename is the
    // fix: it answers "is the typed goal more than 15% of VDOT above
    // demonstrated threshold capacity", which is a narrower question than its
    // old name promised. **It is not Goal Feasibility.** Constitution §L's
    // owner is `lib/race/race-outlook.ts` §7, which reads the projection, its
    // likely range and expected race day and returns comfortable / realistic /
    // aggressive / unlikely_currently. Anything answering "is my goal
    // realistic" reads that, never this.
    //
    // Rule 10 · RECOMPUTE, do not read the frozen boolean. `reanchor-plan.ts`
    // rewrites `pace_blend.season_anchor_vdot` in place as capacity moves and
    // leaves the authored screen untouched, so the persisted struct goes stale
    // by design. On 2026-09-02 the owner's live row held
    // `estimatedCurrentVdot: 44.1` beside a `season_anchor_vdot` of 47.7 — two
    // numbers for one quantity (Rule 16), and the older one was the one being
    // served. The inputs survive on the same row, so the posture here is
    // recompute; the legacy read is the fallback for a row with no live anchor.
    quiet('goal vdot sanity', async () => {
      const row = (await pool.query<{
        sanity: Record<string, unknown> | null;
        realism: Record<string, unknown> | null;
        blend: Record<string, unknown> | null;
        measured_vdot: string | null;
      }>(
        `SELECT authored_state->'goal_vdot_sanity' AS sanity,
                authored_state->'goal_realism'     AS realism,
                authored_state->'pace_blend'       AS blend,
                authored_state->'derived_from'->>'bestRecentVdot' AS measured_vdot
           FROM training_plans
          WHERE user_uuid = $1 AND archived_iso IS NULL
          ORDER BY authored_iso DESC LIMIT 1`,
        [userId],
      )).rows[0];
      const raw = (row?.sanity ?? row?.realism) as Record<string, unknown> | null | undefined;
      if (!raw) return null;
      const blend = row.blend as Record<string, unknown> | null;

      // The live anchor and the goal VDOT the plan already recorded. Both sit
      // on `pace_blend`, which the re-anchor keeps current.
      const liveAnchor = typeof blend?.season_anchor_vdot === 'number' ? blend.season_anchor_vdot : null;
      const recordedGoalVdot = typeof blend?.goal_vdot === 'number'
        ? blend.goal_vdot
        : (typeof raw.goalVdot === 'number' ? raw.goalVdot : null);

      // Plans authored BEFORE the provenance landed carry neither `assessable`
      // nor a marked `pace_blend`. Rather than defaulting them to "assessable"
      // — the assumption that produced the cold-start bug — fall back to the
      // Rule 10 transparency envelope, which records
      // `derived_from.bestRecentVdot` and is null exactly when nothing was
      // measured.
      const nothingMeasured = row.measured_vdot == null;
      const provisional = paceBlendAnchorIsProvisional(blend) || nothingMeasured;
      const assessable = typeof raw.assessable === 'boolean' ? raw.assessable : !provisional;
      const basis = (raw.basis as string | undefined)
        ?? (provisional ? 'provisional_mileage' : 'measured_vdot');
      const band = typeof raw.band === 'number' ? raw.band : GOAL_VDOT_SANITY_BAND;

      const canRecompute = assessable && !provisional && liveAnchor != null && recordedGoalVdot != null;
      const anchorVdot = canRecompute
        ? liveAnchor
        : (assessable && typeof raw.anchorVdot === 'number' ? raw.anchorVdot
          : assessable && typeof raw.estimatedCurrentVdot === 'number' ? raw.estimatedCurrentVdot
          : null);
      const beyondSanityBand = canRecompute
        ? recordedGoalVdot! > liveAnchor! * band
        : assessable && (raw.beyondSanityBand === true || raw.flag === true);

      return {
        // Named for the predicate. A `false` here means the typed goal is
        // inside the sanity band and NOTHING more: remaining training time and
        // uncertainty are not inputs to it.
        beyondSanityBand,
        assessable,
        basis,
        goalVdot: recordedGoalVdot,
        anchorVdot,
        band,
        // Rule 9 · the continuous quantity the boolean steps on, so a consumer
        // can grade rather than read a cliff.
        bandExcessVdot: recordedGoalVdot != null && anchorVdot != null
          ? Math.round((recordedGoalVdot - anchorVdot * band) * 1000) / 1000
          : null,
        // Rule 10 · which posture produced the answer above.
        anchorFreshness: canRecompute ? 'recomputed' : 'frozen_at_authoring',
      };
    }),
  ]);

  const recommendation = adaptation ? recommendFromAdaptation(adaptation) : null;

  return NextResponse.json({
    fitness: fitness
      ? {
          vdot: fitness.vdot,
          range: { lo: fitness.vdotLo, hi: fitness.vdotHi },
          confidence: fitness.confidence,
          basis: fitness.basis,
          races: fitness.races,
        }
      : null,

    adaptation: adaptation
      ? {
          band: adaptation.band,
          confidence: adaptation.confidence,
          decision: adaptation.decision,
          stepMultiplier: adaptation.stepMultiplier,
          veto: adaptation.veto,
          summary: adaptation.summary,
          // Unreadable dimensions are returned WITH a null score rather than
          // dropped, so a consumer can show what we could not see. Omitting
          // them would read as a complete picture.
          dimensions: adaptation.dimensions.map((d) => ({
            dimension: d.dimension,
            score: d.score,
            detail: d.detail || null,
          })),
        }
      : null,

    limiter: goalGap?.limiter
      ? {
          primary: goalGap.limiter.primary,
          confidence: goalGap.limiter.confidence,
          levers: goalGap.limiter.levers,
          summary: goalGap.limiter.summary,
        }
      : null,

    recommendation: recommendation
      ? {
          action: recommendation.action,
          change: recommendation.change,
          reason: recommendation.reason,
          consequence: recommendation.consequence,
          confidence: recommendation.confidence,
          line: renderShort(recommendation),
          evidence: recommendation.evidence,
        }
      : null,

    goal: goalGap
      ? {
          gapSec: goalGap.gapSec,
          status: goalGap.status,
          weeksRemaining: goalGap.weeksRemaining,
          whatClosesIt: goalGap.whatClosesIt,
        }
      : null,

    // GOAL-SANITY-NAME-1 · a SCREEN on the typed goal, not a feasibility
    // verdict. `beyondSanityBand: false` means the goal is inside a fixed 15%
    // VDOT band around demonstrated threshold capacity; it says nothing about
    // whether the goal is reachable, because runway and uncertainty are not
    // inputs. `assessable: false` means the plan's fitness anchor was a mileage
    // self-report and there is no verdict at all — never render that as "goal
    // looks fine." For "is my goal realistic", read Goal Feasibility
    // (`lib/race/race-outlook.ts` §7 `goalFeasibility`).
    goalVdotSanity: goalVdotSanity ?? null,
  });
}
