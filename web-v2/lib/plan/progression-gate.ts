/**
 * Evidence permits or modifies the planned progression.
 *
 * The second half of `Design/adaptive-progression-engine.md` §3. The authored
 * plan already carries the first half: an overload trajectory that grows each
 * quality session by duration, then density, then the rest of the ladder —
 * "calendar time PROPOSES progression". This is the half that decides whether
 * the runner actually takes that step.
 *
 *     strong    progress as planned, or slightly accelerate
 *     normal    progress as planned
 *     marginal  hold the current stimulus
 *     poor      reduce or modify
 *
 * Until now the plan was honest and static. It proposed a step every week and
 * nothing ever asked whether the runner had earned it, so a block that started
 * going badly kept prescribing the same escalation it had drawn up in week one.
 *
 * ## Why a HOLD needs the previous shape
 *
 * "Hold the current stimulus" means repeat what was last prescribed — not
 * freeze the calendar, and not fall back to some default. That requires
 * knowing the geometry of the session the runner actually did, which is why
 * the shape is persisted on `workout_spec` rather than only rendered into
 * prose. Regexing "3x10 min @ T pace" back apart would be a second definition
 * of the same fact.
 *
 * ## What this module deliberately does NOT do
 *
 * It does not touch pace. Every decision here moves duration, reps or
 * recovery — the cheap levers. A held or reduced week keeps the runner's
 * demonstrated pace, because backing off is about dose, not about deciding
 * they got slower. Pace is the fitness model's business and it moves on
 * evidence, never on a bad fortnight.
 *
 * It also does not read daily readiness. The adaptation verdict it consumes
 * already excludes it — readiness informs, it never acts (locked 2026-08-17).
 */

import {
  advanceShape,
  totalWorkMinutes,
  AT_PACE_WEEKLY_SHARE_CAP,
  type ProgressionLever,
  type WorkShape,
} from '@/lib/prescription/levers';
import type { AdaptationVerdict } from '@/lib/adaptation/adaptation-model';

/** What the gate decided to do with this week's planned step. */
export type ProgressionAction =
  /** Take the planned step, and one more on top of it. */
  | 'ACCELERATE'
  /** Take the planned step exactly as authored. */
  | 'TAKE'
  /** Repeat last week's session. The step is deferred, not cancelled. */
  | 'HOLD'
  /** Prescribe less than last week. */
  | 'BACK_OFF';

export interface ProgressionDecision {
  action: ProgressionAction;
  /** The shape to actually prescribe. */
  shape: WorkShape;
  /** One line in the coach register, for the log and the week view. */
  why: string;
  /** True when the shape differs from what the plan had authored, so a caller
   *  knows whether it needs to write anything at all. */
  changed: boolean;
}

/**
 * How much a back-off week reduces the work.
 *
 * A fifth is the smallest cut that is unambiguously a cut — below that the
 * runner cannot feel the difference and the signal is wasted, and much above it
 * starts to be a deload rather than a modification. Doctrine calls this branch
 * "reduce OR modify", so the cheap, legible version is the right default.
 */
export const BACK_OFF_FRACTION = 0.2;

/**
 * Decide what to prescribe, given what was planned, what was last done, and
 * how the runner is absorbing the work.
 *
 * Pure. `previous` is null on the first quality session of a block, where
 * there is nothing to hold — the planned seed is the only honest answer, and a
 * runner with no history should not be held back on their first week.
 */
export function resolveProgressionStep(args: {
  planned: WorkShape;
  previous: WorkShape | null;
  verdict: AdaptationVerdict;
  /** Weekly mileage, for the doctrine caps inside `advanceShape`. */
  weeklyMi: number;
  family: keyof typeof AT_PACE_WEEKLY_SHARE_CAP;
  /** Lever the authored trajectory used this week, so an acceleration pulls
   *  the same knob rather than reaching for a different one. */
  lever: ProgressionLever | null;
}): ProgressionDecision {
  const { planned, previous, verdict, weeklyMi, family, lever } = args;

  // A veto is not a progression question. Protect, and let the injury,
  // illness and niggle responses own what happens to the session itself.
  if (verdict.veto) {
    return {
      action: 'BACK_OFF',
      shape: reduce(previous ?? planned),
      why: verdict.summary,
      changed: true,
    };
  }

  switch (verdict.band) {
    case 'strong': {
      // Accelerate by pulling the SAME lever one more notch, so the block
      // keeps its shape rather than acquiring a second axis of change. The
      // caps inside advanceShape still bind — a strongly adapting runner
      // earns a bigger step, never an unbounded one.
      if (lever == null) {
        return { action: 'TAKE', shape: planned, why: takeWhy(verdict), changed: false };
      }
      const stepped = advanceShape({
        shape: planned,
        lever,
        stepMultiplier: verdict.stepMultiplier,
        weeklyMi,
        family,
      });
      if (stepped.capped) {
        return {
          action: 'TAKE',
          shape: planned,
          why: 'You are absorbing this block well, but the next step up would run past what the week can carry. Taking the planned step.',
          changed: false,
        };
      }
      return {
        action: 'ACCELERATE',
        shape: stepped.shape,
        why: `You are absorbing this block well, so this week asks for a little more than the plan had drawn up · ${stepped.change}.`,
        changed: true,
      };
    }

    case 'normal':
      return { action: 'TAKE', shape: planned, why: takeWhy(verdict), changed: false };

    case 'marginal': {
      // Nothing to hold on the first session of a block.
      if (previous == null) {
        return { action: 'TAKE', shape: planned, why: takeWhy(verdict), changed: false };
      }
      return {
        action: 'HOLD',
        shape: previous,
        why: 'Holding this week where it was rather than adding to it. The step up is deferred, not cancelled. Repeating a stimulus you have not finished adapting to is how the next one lands better.',
        changed: !sameShape(previous, planned),
      };
    }

    case 'poor':
      return {
        action: 'BACK_OFF',
        shape: reduce(previous ?? planned),
        why: 'Easing this week rather than adding to it. The current load is not producing the response it should, and backing off now protects the rest of the block.',
        changed: true,
      };
  }
}

function takeWhy(verdict: AdaptationVerdict): string {
  return verdict.confidence === 'low'
    ? 'Staying on the planned progression. There is not much training evidence to read yet, and proceeding as planned is the honest answer to that.'
    : 'Staying on the planned progression. The work is landing about as expected.';
}

/**
 * Cut a session by roughly a fifth, spending the cut on whichever dimension
 * leaves a coherent session behind.
 *
 * Reps first: dropping one of four is a real reduction and keeps every
 * remaining rep the length the runner knows. Only a single-rep effort — a
 * continuous tempo — has its duration trimmed instead, because there is no rep
 * to drop. Pace is never touched; see the module header.
 */
function reduce(shape: WorkShape): WorkShape {
  if (shape.reps > 1) {
    const target = totalWorkMinutes(shape) * (1 - BACK_OFF_FRACTION);
    const reps = Math.max(1, Math.min(shape.reps - 1, Math.round(target / shape.repMinutes)));
    return { ...shape, reps, zone: 'ESTABLISHED' };
  }
  return {
    ...shape,
    repMinutes: Math.max(1, Math.round(shape.repMinutes * (1 - BACK_OFF_FRACTION))),
    zone: 'ESTABLISHED',
  };
}

function sameShape(a: WorkShape, b: WorkShape): boolean {
  return a.reps === b.reps
    && a.repMinutes === b.repMinutes
    && a.recoveryMinutes === b.recoveryMinutes
    && a.paceSPerMi === b.paceSPerMi;
}
