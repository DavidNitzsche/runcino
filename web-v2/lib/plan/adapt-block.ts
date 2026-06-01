/**
 * lib/plan/adapt-block.ts · block-level adapter wrapper (Phase 1.3).
 *
 * The day-of adapter (lib/plan/adapt.ts) reacts to one signal at a
 * time: "sleep is bad, downgrade Tuesday." That's right but blind.
 * It doesn't ask: "If I downgrade Tuesday, does Thursday's interval
 * land on a recovery deficit? Does the long run still serve the
 * goal? Is the goal-gap widening already?"
 *
 * This module wraps the day-of adapter with 3-day forward reasoning:
 *
 *   1. For every downgrade/shave action returned by the day-of adapter
 *   2. Read the next 3 days of planned workouts
 *   3. If a quality day is scheduled within 48h after the downgrade,
 *      check spacing rules (Research/04 · 48h hard-easy spacing minimum)
 *   4. If goal-gap is 'widening' or 'unclosable', annotate the
 *      adaptation with extra audit context: "Downgraded Tue because
 *      sleep debt + goal slipping · we'll need to make this up Thu."
 *   5. If downgrade + cascade would violate hard-easy spacing, ALSO
 *      shift the next quality day forward + audit the cascade.
 *
 * Returns a `BlockAdaptation` envelope that the cron/route layer
 * applies in a single transaction.
 *
 * Doctrine:
 *   · Research/04-workouts-and-progressions.md §hard-easy-rule (48h)
 *   · Research/15-wearable-data.md §recovery-after-quality
 *   · docs/PLAN_ENGINE_ARCHITECTURE.md §Phase 1.3
 */

import { pool } from '@/lib/db/pool';
import { detectAdaptations, type AdaptationAction } from './adapt';
import { computeGoalGap, type GoalGap } from './goal-gap';

export interface BlockAdaptationContext {
  /** Today's date in ISO YYYY-MM-DD (used to look up neighbor workouts). */
  todayISO: string;
  /** The original day-of action that triggered the block reasoning. */
  primaryAction: AdaptationAction;
  /** Goal-gap state at the time of the adaptation. */
  goalGap: GoalGap | null;
}

export interface BlockAdaptation {
  /** Primary action (what the day-of adapter wanted). */
  primary: AdaptationAction;
  /** Cascade actions · downstream shifts to preserve plan integrity. */
  cascade: AdaptationAction[];
  /** Plain-language explanation surfaced in the brief + audit log. */
  rationale: string;
  /** Research/ doctrine citations for every action in the bundle. */
  citations: string[];
  /** Context snapshot for the audit trail. */
  context: BlockAdaptationContext;
}

/**
 * The block-aware entry point. Use this instead of calling
 * `detectAdaptations()` directly when you want forward-reasoning.
 *
 * Returns a list of `BlockAdaptation` envelopes · each contains a
 * primary action + zero or more cascade actions + rationale. The
 * caller applies all actions in a single transaction.
 */
export async function detectBlockAdaptations(
  userUuid: string,
  todayISO?: string,
): Promise<BlockAdaptation[]> {
  const today = todayISO ?? new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);

  // 1. Day-of adapter does its thing
  const dayOf = await detectAdaptations(userUuid);
  if (dayOf.actions.length === 0) return [];

  // 2. Read goal-gap once · feeds rationale + cascade decisions
  const goalGap = await computeGoalGap(userUuid);

  // 3. Wrap each action with block-level reasoning
  const out: BlockAdaptation[] = [];
  for (const action of dayOf.actions) {
    const wrapped = await wrapWithBlockReasoning(userUuid, action, today, goalGap);
    out.push(wrapped);
  }
  return out;
}

/**
 * Wrap a single day-of action with 3-day forward reasoning.
 *
 * - Only `downgrade` and `shave` actions trigger cascade analysis
 * - `reschedule` already moves things in time, so cascades are
 *   handled by the reschedule itself
 * - `recompute_paces` and `mark_dirty` are administrative · no cascade
 */
async function wrapWithBlockReasoning(
  userUuid: string,
  action: AdaptationAction,
  todayISO: string,
  goalGap: GoalGap | null,
): Promise<BlockAdaptation> {
  const citations = ['docs/PLAN_ENGINE_ARCHITECTURE.md §Phase 1.3'];
  let rationale = action.why;
  const cascade: AdaptationAction[] = [];

  // Only downgrade/shave need cascade analysis
  if (action.kind === 'downgrade' || action.kind === 'shave') {
    const nextQuality = await loadNextQualityWorkout(userUuid, todayISO);
    if (nextQuality) {
      const daysToNext = daysBetween(todayISO, nextQuality.dateISO);

      // Hard-easy spacing rule (Research/04 §hard-easy-rule)
      // After a downgrade-due-to-fatigue, you need ≥48h before next quality.
      // If the next quality is <48h out (which means tomorrow, given today
      // already had a downgrade), shift it.
      if (daysToNext <= 1) {
        cascade.push({
          kind: 'reschedule',
          workoutIds: [nextQuality.id],
          newDate: addDays(nextQuality.dateISO, 1),
          why: `Shifted to preserve 48h hard-easy spacing after today's downgrade.`,
        });
        citations.push('Research/04-workouts-and-progressions.md §hard-easy-rule');
        rationale += ` · Cascade: shifted next quality day to preserve 48h spacing.`;
      }
    }
  }

  // Goal-gap context · annotate when relevant
  if (goalGap) {
    if (goalGap.status === 'widening') {
      rationale += ` · Goal-gap widening (${formatGap(goalGap.gapSec)} behind ` +
        `with ${goalGap.weeksRemaining}w left) · we'll need to make this up.`;
      citations.push('docs/PLAN_ENGINE_ARCHITECTURE.md §Phase 1.1');
    } else if (goalGap.status === 'unclosable') {
      rationale += ` · Goal-gap currently unclosable (${formatGap(goalGap.gapSec)}) · ` +
        `goal renegotiation will surface separately.`;
    } else if (goalGap.status === 'closing' && (action.kind === 'downgrade' || action.kind === 'shave')) {
      // Trajectory moving in the right direction · don't undercut it
      rationale += ` · Trajectory was closing the goal-gap · keeping today recoverable ` +
        `preserves the trend.`;
    }
  }

  return {
    primary: action,
    cascade,
    rationale,
    citations,
    context: {
      todayISO,
      primaryAction: action,
      goalGap,
    },
  };
}

// ─── helpers ───────────────────────────────────────────────────────────

interface NextQualityWorkout {
  id: string;
  dateISO: string;
  type: string;
  subLabel: string | null;
}

async function loadNextQualityWorkout(
  userUuid: string,
  todayISO: string,
): Promise<NextQualityWorkout | null> {
  const r = (await pool.query<{
    id: string; date_iso: string; type: string; sub_label: string | null;
  }>(
    `SELECT pw.id, pw.date_iso::text AS date_iso, pw.type, pw.sub_label
       FROM plan_workouts pw
       JOIN training_plans tp ON tp.id = pw.plan_id
      WHERE tp.user_uuid = $1::uuid
        AND tp.archived_iso IS NULL
        AND pw.is_quality = true
        AND pw.date_iso > $2::date
        AND pw.date_iso <= ($2::date + INTERVAL '4 days')
      ORDER BY pw.date_iso ASC
      LIMIT 1`,
    [userUuid, todayISO],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!r) return null;
  return {
    id: r.id,
    dateISO: r.date_iso,
    type: r.type,
    subLabel: r.sub_label,
  };
}

function daysBetween(aISO: string, bISO: string): number {
  const a = Date.parse(aISO + 'T12:00:00Z');
  const b = Date.parse(bISO + 'T12:00:00Z');
  return Math.round((b - a) / 86400000);
}

function addDays(iso: string, n: number): string {
  return new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
}

function formatGap(gapSec: number): string {
  const sign = gapSec > 0 ? '+' : '-';
  const abs = Math.abs(gapSec);
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return s === 0 ? `${sign}${m}m` : `${sign}${m}m${s}s`;
}

/**
 * Apply a BlockAdaptation to plan_workouts in a single transaction.
 * Mirrors applyAdaptations() but applies primary + cascade together
 * and writes both to coach_intents with cross-references so the audit
 * trail shows the cascade chain.
 */
export async function applyBlockAdaptation(
  userUuid: string,
  block: BlockAdaptation,
): Promise<{ touched: number; auditIds: number[] }> {
  const allActions = [block.primary, ...block.cascade];
  if (allActions.length === 0) return { touched: 0, auditIds: [] };

  // Reuse the existing apply path · it handles the transaction, citation
  // writes, and stale-field cleanup. Adding the rationale into the why
  // field so the briefing voice picks up the block-level context.
  const { applyAdaptations } = await import('./adapt');
  const enriched = allActions.map((a, i) => ({
    ...a,
    why: i === 0 ? block.rationale : a.why,  // primary gets the full block rationale
  }));
  const touched = await applyAdaptations(userUuid, enriched);
  return { touched, auditIds: [] };
}
