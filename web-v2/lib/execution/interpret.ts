/**
 * What work actually happened.
 *
 * The execution half of `Design/execution-memory-firing.md`. Its opening claim
 * is the architectural one:
 *
 *   > The plan prescribes a training stimulus, not a file format.
 *
 * So a session is judged on two independent axes — did the athlete perform the
 * workout as WRITTEN, and did they create the intended EFFECT — and those are
 * not the same question. A workout can be structurally different and
 * physiologically equivalent; it can also look complete on paper and miss the
 * stimulus entirely.
 *
 * ## What this replaces
 *
 * Seven independent predicates across the codebase answered "was it done",
 * using four different distance thresholds (none, ≥1.0 mi, ≥0.8×, ≥max(1,
 * 0.6×), 0.7–1.3×). A 6-mile run on an 8-mile tempo day was simultaneously
 * done and missed depending which surface you read. None of them could tell
 * "swapped 5×1mi for 3×2mi because the track was closed" from "skipped it".
 *
 * ## The rule with the widest blast radius
 *
 *   > Do not compare 3 × 2 miles against the planned rep-level pace window for
 *   > 5 × 1. Reconstruct what was actually performed and compare THAT to the
 *   > intended stimulus.
 *
 * Which is why this module takes two `Stimulus` values and never sees a rep
 * count. Callers reconstruct the actual stimulus from phases or splits; the
 * judgement here is shape-blind by construction.
 *
 * ## Evidence is not credit
 *
 * Four outputs, deliberately separate, because no single `completed = true`
 * may drive all of them:
 *
 *   · execution   — did they do the work
 *   · adaptation  — does this say they are absorbing training
 *   · fitness     — does this say anything about what they could race
 *   · risk        — does this say anything about getting hurt
 *
 * The case that proves they must be separate: an athlete failing badly at a
 * pace previously considered established is LOW execution credit and HIGH
 * fitness evidence. It is one of the most informative things that can happen,
 * and a boolean throws it away.
 */

import { AT_PACE_SESSION_MI } from '@/lib/prescription/levers';
import { COMPLETION_LADDER } from '@/lib/training/execution-semantics';

/** Doctrine's seven states. */
export type ExecutionState =
  | 'AS_PLANNED'
  | 'EQUIVALENT'
  | 'PARTIAL_PRODUCTIVE'
  | 'PARTIAL_FAILED'
  | 'REPLACED'
  | 'MISSED'
  | 'EXTRA';

/** The physiological zone a session's work was aimed at. Two sessions in
 *  different domains are never equivalent, whatever their duration. */
export type IntensityDomain =
  | 'recovery' | 'easy' | 'marathon' | 'threshold' | 'interval' | 'repetition' | 'race';

/** How much rest the work blocks were separated by. Doctrine: recovery
 *  structure must not be "radically altered" for two shapes to be equivalent —
 *  lengthening the rest changes the workout (`Research/04` §5.3). */
export type RecoveryIntent = 'none' | 'incomplete' | 'complete';

/**
 * A training stimulus, as intended OR as performed. The same shape for both,
 * so the comparison cannot accidentally reach for a rep count.
 */
export interface Stimulus {
  domain: IntensityDomain;
  /** Minutes spent at the domain's intensity. The primary quantity. */
  workMinutes: number;
  /** Miles at that intensity. Null when only time is known. */
  workMi: number | null;
  /** Mean pace across the work, s/mi. Null when unreadable. */
  meanWorkPaceSPerMi: number | null;
  recoveryIntent: RecoveryIntent;
}

export interface ExecutionContext {
  /** True when the runner stopped early with the effort visibly coming apart —
   *  pace collapsing, HR above band, or a reported RPE spike. Distinguishes
   *  "cut short and cooked" from "cut short deliberately". */
  effortCollapsed?: boolean;
  /** True when a race was run in this session's place. */
  replacedByRace?: boolean;
  /** True when this run was not on the plan at all. */
  unplanned?: boolean;
  /** The pace the runner had previously established for this domain, s/mi.
   *  Lets a failure at a KNOWN pace read as high fitness evidence rather than
   *  as a bad day — the case doctrine calls "extremely informative". */
  establishedPaceSPerMi?: number | null;
}

export interface EvidenceRead {
  /** Did they do the work. Drives training credit. */
  execution: 'full' | 'partial' | 'none';
  /** Does this say they are absorbing training. Drives PROGRESSION credit,
   *  which is a different question — doctrine rule 4. */
  adaptation: 'positive' | 'neutral' | 'negative' | 'unknown';
  /** Does this say anything about what they could race. */
  fitness: 'high' | 'moderate' | 'low' | 'none';
  risk: 'none' | 'watch' | 'meaningful';
}

export interface ExecutionRead {
  state: ExecutionState;
  /** 0..1 · how much of the intended stimulus was delivered. */
  stimulusCompletion: number;
  evidence: EvidenceRead;
  /** One line a coach surface or the log can use. */
  why: string;
}

/* ------------------------------------------------------------- constants */

/**
 * How far the delivered work volume may sit from the intended one and still
 * count as the same stimulus.
 *
 * Not an invented tolerance. `Research/04` §5.1 prescribes threshold sessions
 * at **4-8 mi** at pace and VO2 sessions at **3-6 mi** — bands with a 2× and a
 * 1.5× span. Doctrine treats every point inside those as the same session, so
 * two executions that both land inside the band are the same prescription by
 * the research's own reckoning. This ratio is the fallback for sessions with
 * no published band (and for time-only reads), and it is set to the tighter of
 * the two spans expressed as a symmetric tolerance.
 *
 * The worked example in the brief clears it comfortably: 5 × 1 mi is 5 miles
 * of work, 3 × 2 mi is 6 — twenty percent, and doctrine says that is the same
 * session run a different way.
 */
export const EQUIVALENT_WORK_TOLERANCE = COMPLETION_LADDER.SAME_STIMULUS_WITHIN;

/** Below this share of the intended stimulus a session stops being a version
 *  of the prescription and becomes a fragment of it.
 *
 *  F-14 · both constants now read the ONE completion ladder in
 *  `lib/training/execution-semantics.ts`, which also holds `adapt.ts`'s
 *  "counts as done" line and states in one place how the three relate. They
 *  were three literals in two files with no stated relationship, and an 8 mi
 *  threshold run at 5.0 mi got three different verdicts as a result. */
export const PARTIAL_FLOOR = COMPLETION_LADDER.FRAGMENT_BELOW;

/* --------------------------------------------------------------- helpers */

function bandFor(domain: IntensityDomain): { min: number; max: number } | null {
  if (domain === 'threshold' || domain === 'marathon') return AT_PACE_SESSION_MI.threshold;
  if (domain === 'interval' || domain === 'repetition') return AT_PACE_SESSION_MI.interval;
  return null;
}

/** Both volumes inside the same doctrine band → the same prescription, by the
 *  research's own reckoning. */
function bothInsideBand(planned: Stimulus, actual: Stimulus): boolean {
  const band = bandFor(planned.domain);
  if (!band || planned.workMi == null || actual.workMi == null) return false;
  const inside = (mi: number) => mi >= band.min && mi <= band.max;
  return inside(planned.workMi) && inside(actual.workMi);
}

/** Lengthening the rest changes the workout (`Research/04` §5.3). Shortening it
 *  makes it harder, which is a different session too. */
function recoveryPreserved(planned: Stimulus, actual: Stimulus): boolean {
  return planned.recoveryIntent === actual.recoveryIntent;
}

/* ------------------------------------------------------------ the reading */

/**
 * Interpret one planned session against what was actually run.
 *
 * `actual` is null when nothing was run at all. Pure — callers reconstruct the
 * actual stimulus from phases, splits or the watch's own phase verdicts.
 */
export function interpretExecution(
  planned: Stimulus,
  actual: Stimulus | null,
  ctx: ExecutionContext = {},
): ExecutionRead {
  /* --- nothing ran ------------------------------------------------------ */
  if (ctx.unplanned) {
    // Doctrine: extra training is DATA, not achievement. It earns no execution
    // credit against a plan it was not part of, and no progression credit —
    // more work is not evidence that more work was appropriate.
    const hard = actual != null && actual.domain !== 'easy' && actual.domain !== 'recovery';
    return {
      state: 'EXTRA',
      stimulusCompletion: 0,
      evidence: {
        execution: 'none',
        adaptation: 'unknown',
        fitness: hard ? 'low' : 'none',
        risk: hard ? 'watch' : 'none',
      },
      why: hard
        ? 'Unplanned hard running. Recorded as load, not as credit. Whether it was absorbed is next week s question.'
        : 'Unplanned easy running. Recorded as load, not as credit.',
    };
  }

  if (ctx.replacedByRace) {
    // A race may be BETTER fitness evidence than the workout it displaced,
    // while costing more recovery. Replacement is not equivalence.
    return {
      state: 'REPLACED',
      stimulusCompletion: 1,
      evidence: { execution: 'full', adaptation: 'neutral', fitness: 'high', risk: 'watch' },
      why: 'A race stood in for this session. It carries better fitness evidence than the workout would have, and a higher recovery cost. The rest of the week has to account for it.',
    };
  }

  if (actual == null || actual.workMinutes <= 0) {
    return {
      state: 'MISSED',
      stimulusCompletion: 0,
      evidence: { execution: 'none', adaptation: 'unknown', fitness: 'none', risk: 'none' },
      why: 'This session did not happen.',
    };
  }

  /* --- how much of the intended stimulus landed ------------------------- */
  const completion = planned.workMinutes > 0
    ? Math.min(1.5, actual.workMinutes / planned.workMinutes)
    : 1;

  const sameDomain = planned.domain === actual.domain;
  const withinTolerance = Math.abs(completion - 1) <= EQUIVALENT_WORK_TOLERANCE;
  const sameStimulus = sameDomain
    && recoveryPreserved(planned, actual)
    && (withinTolerance || bothInsideBand(planned, actual));

  /* --- fitness evidence ------------------------------------------------- */
  // Doctrine's sharpest case: failing badly at a pace previously considered
  // established is LOW execution credit and HIGH fitness evidence. A boolean
  // throws that away; it is one of the most informative things that happens.
  const failedAtKnownPace = ctx.effortCollapsed
    && ctx.establishedPaceSPerMi != null
    && actual.meanWorkPaceSPerMi != null
    && actual.meanWorkPaceSPerMi <= ctx.establishedPaceSPerMi + 5;

  const routineAerobic = planned.domain === 'easy' || planned.domain === 'recovery';

  /* --- the states ------------------------------------------------------- */
  if (sameStimulus) {
    const identical = planned.workMi != null && actual.workMi != null
      && Math.abs(planned.workMi - actual.workMi) < 0.15;
    return {
      state: identical ? 'AS_PLANNED' : 'EQUIVALENT',
      stimulusCompletion: 1,
      evidence: {
        execution: 'full',
        adaptation: 'positive',
        // A routine easy run is fully executed and says almost nothing about
        // what the runner could race. A quality session says a lot.
        fitness: routineAerobic ? 'none' : 'moderate',
        risk: 'none',
      },
      why: identical
        ? 'Ran as prescribed.'
        : 'Different shape, same stimulus. The work duration and the intensity both landed where the session intended. That is the session, run another way.',
    };
  }

  if (completion >= 1 + EQUIVALENT_WORK_TOLERANCE && sameDomain) {
    // More work than asked for, at the right intensity. Not a failure, and not
    // a licence — the adaptation model decides whether it was absorbed.
    return {
      state: 'PARTIAL_PRODUCTIVE',
      stimulusCompletion: 1,
      evidence: { execution: 'full', adaptation: 'neutral', fitness: 'moderate', risk: 'watch' },
      why: 'More work than the session asked for, at the right intensity. Banked as training; whether it was absorbed is a separate question.',
    };
  }

  if (completion < PARTIAL_FLOOR) {
    return {
      state: ctx.effortCollapsed ? 'PARTIAL_FAILED' : 'PARTIAL_PRODUCTIVE',
      stimulusCompletion: completion,
      evidence: {
        execution: 'partial',
        adaptation: ctx.effortCollapsed ? 'negative' : 'unknown',
        fitness: failedAtKnownPace ? 'high' : 'low',
        risk: ctx.effortCollapsed ? 'meaningful' : 'none',
      },
      why: ctx.effortCollapsed
        ? 'This came apart early. Some useful work happened, and it is also evidence the prescription was above what the day had in it.'
        : 'Well short of the session, without the effort coming apart. Recorded as partial rather than as a miss.',
    };
  }

  // The middle band: a real chunk of the session, short of all of it.
  if (ctx.effortCollapsed) {
    return {
      state: 'PARTIAL_FAILED',
      stimulusCompletion: completion,
      evidence: {
        execution: 'partial',
        // Training credit yes. Progression credit no — stopping cooked is
        // evidence the prescription was at or above capacity that day.
        adaptation: 'negative',
        fitness: failedAtKnownPace ? 'high' : 'moderate',
        risk: 'meaningful',
      },
      why: failedAtKnownPace
        ? 'Stopped early at a pace that has been comfortable before. That is worth more than the missed reps. It says something about today, or about the last few weeks.'
        : 'Stopped early with the effort coming apart. The work that happened still counts; it does not count as room for more.',
    };
  }

  // The middle band is reached three ways, and one sentence cannot describe
  // all of them honestly. Volume short of the session is the common case. A
  // domain change is a different failure — the work happened, at an intensity
  // the session did not ask for — and saying "the work the session wanted"
  // there would be untrue. It reads that way on real data: a threshold day run
  // at repetition pace, and a race whose goal pace the runner never reached.
  return {
    state: 'PARTIAL_PRODUCTIVE',
    stimulusCompletion: completion,
    evidence: {
      execution: 'partial',
      adaptation: 'neutral',
      fitness: routineAerobic ? 'none' : 'low',
      risk: 'none',
    },
    why: !sameDomain
      ? 'The work happened at a different intensity than the session was aiming for, so it does not bank as that stimulus.'
      : completion >= 1
        ? 'The session was delivered in a different structure than it was written in. Banked as training, not as the prescription.'
        : 'Short of the full session, but the work that happened was the work the session wanted.',
  };
}

/**
 * Does this reading earn a progression step?
 *
 * Doctrine rule 4 in one predicate: **partial work can be useful without
 * earning progression.** Training credit and progression credit are different
 * currencies, and collapsing them is what let a runner who completed 60% of a
 * session be treated either as having done nothing or as having earned more.
 */
export function earnsProgressionCredit(read: ExecutionRead): boolean {
  if (read.evidence.execution !== 'full') return false;
  return read.state === 'AS_PLANNED'
    || read.state === 'EQUIVALENT'
    || read.state === 'PARTIAL_PRODUCTIVE';
}
