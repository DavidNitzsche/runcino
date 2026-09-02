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

  const [fitness, adaptation, goalGap] = await Promise.all([
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

    // GOALSANITY-DELETE-1 (2026-09-02) · the goal-VDOT sanity screen used to be
    // emitted here and is DELETED. It had no live consumer — nothing in this
    // repo fetched this route — and a second, narrower answer to "is my goal
    // realistic" sitting beside Goal Feasibility is the competing ownership the
    // Constitution forbids. For that question read Goal Feasibility
    // (`lib/race/race-outlook.ts` §7 `goalFeasibility`), which is §L's owner.
  });
}
