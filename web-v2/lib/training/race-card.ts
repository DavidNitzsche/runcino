/**
 * lib/training/race-card.ts · the Races decision card, both axes.
 *
 * `docs/faff-iphone-design-contract.md` §2 and `native-v2/…/APIV5.swift`
 * (`V5DecisionCard`) name TWO axes that both drive the card and neither one
 * substitutes for the other:
 *
 *   VERDICT · `assessGoal()`'s `GoalFeasibility` (lib/training/goal-
 *             assessment.ts). Always present — recomputed on every read
 *             whether or not anything happened.
 *   TRIGGER · why we are asking NOW, a discrete event. May be absent (the
 *             goal simply drifted).
 *
 * The trigger decides the card's SHAPE, not just its copy. Four triggers are
 * a decision about the goal (shape `decision`, driven by the verdict) — the
 * other four are a fact the runner needs or a choice only the runner can
 * make (shape `fact` / `choice`), and those get NO safe/stretch pair and NO
 * target-naming buttons. "Take 3:16:45" under a heat question answers
 * something nobody asked; that is the mistake this split exists to prevent.
 *
 * This file is the PURE half: given an already-computed `GoalAssessment`
 * (from `assessGoal`) and, when one was detected, a `FactChoiceSpec`, it
 * composes the wire-shaped card with no I/O. The async detection of the four
 * fact/choice triggers (heat forecast, course-elevation conflict, chip-time
 * lock, two A races) lives in `app/api/v5/races/route.ts`, which calls
 * straight through to `composeRaceCard` once it has resolved (or failed to
 * resolve) each one. Kept pure and separate so the shape/answer rules below
 * are unit-testable without a database.
 */
import type { GoalAssessment, GoalFeasibility } from './goal-assessment';
import { formatRaceTime } from './vdot';

// ─── wire shapes (mirrors native-v2/…/APIV5.swift verbatim) ────────────────

export type V5CardShape = 'decision' | 'fact' | 'choice';

export type V5CardAnswerAction =
  | 'hold' | 'take' | 'not_now' | 'acknowledge' | 'repace'
  | 'confirm' | 'leave' | 'choose_race';

export interface V5CardAnswerOut {
  id: string;
  label: string;
  action: V5CardAnswerAction;
  targetSec: number | null;
}

export interface V5NumberOut {
  text: string | null;
  modelled: boolean;
}

export interface V5DecisionCardOut {
  shape: V5CardShape;
  verdict: GoalFeasibility;
  trigger: string | null;
  question: string;
  safeTarget: V5NumberOut | null;
  stretchTarget: V5NumberOut | null;
  cautions: string[];
  answers: V5CardAnswerOut[];
}

/**
 * The four triggers that are NOT a decision about the goal. `id` is what
 * lands in `V5DecisionCard.trigger` and what `POST /api/v5/goal-answer`
 * suppresses when the runner answers `acknowledge` / `not_now` / `leave`.
 */
export type FactChoiceTriggerId = 'heat' | 'course_changed' | 'chip_lock' | 'two_a_races';

export interface FactChoiceSpec {
  kind: 'fact' | 'choice';
  trigger: FactChoiceTriggerId;
  question: string;
  answers: V5CardAnswerOut[];
}

/**
 * The four triggers that ARE a decision about the goal, per the design
 * contract's table. `null` covers a verdict the table doesn't name a trigger
 * for (`open-ended` — the design's own "loose end": a no-date goal never
 * reaches the Races screen, which is always anchored to a dated A race).
 */
export type DecisionTriggerId =
  | 'fitness_ahead' | 'fitness_behind' | 'evidence_stale' | 'returning_injury'
  | 'date_passed' | null;

// ─── the four FACT / CHOICE cards ───────────────────────────────────────────
// Coach voice: short, direct, no hype, no exclamation marks, no emoji, no em
// dashes. None of the four may carry a safeTarget/stretchTarget or a `take`
// answer — composeRaceCard enforces this structurally, not by convention.

const ackAnswer = (id: string): V5CardAnswerOut =>
  ({ id, label: 'Acknowledge', action: 'acknowledge', targetSec: null });
const notNowAnswer = (id: string): V5CardAnswerOut =>
  ({ id, label: 'Not now', action: 'not_now', targetSec: null });

/** Race-morning heat. The goal stands; race morning will feel harder than
 *  training did. Cite: Research/06 (Maughan/Ely/Vihma), gated in the route
 *  on `computeRaceConditions`'s existing >85°F safety threshold or a
 *  doctrine-graded 'hot'/'extreme' WBGT band on a REAL forecast (not a
 *  climate-normal guess). */
export function heatFactCard(raceName: string, tempF: number | null): FactChoiceSpec {
  const tempPhrase = tempF != null ? `around ${Math.round(tempF)}°F` : 'hot';
  return {
    kind: 'fact',
    trigger: 'heat',
    question: `Race morning for ${raceName} is forecast ${tempPhrase}. The goal doesn't change. The pace on the day might.`,
    answers: [ackAnswer('heat_ack'), { id: 'heat_repace', label: 'Re-pace the day', action: 'repace', targetSec: null }],
  };
}

/** The course's measured elevation disagrees with what the projection was
 *  built on. Gated in the route on `resolveCourseElevation`'s `conflict`
 *  field — never asserted from a hunch. */
export function courseChangedFactCard(raceName: string): FactChoiceSpec {
  return {
    kind: 'fact',
    trigger: 'course_changed',
    question: `The course elevation for ${raceName} reads differently than what this projection was built on. We can't know which course you'll actually race.`,
    answers: [ackAnswer('course_ack'), notNowAnswer('course_not_now')],
  };
}

/** The race happened, but its finish time is a Strava/watch match, not a
 *  curated chip time (CLAUDE.md race-data rule 3 — the engine's own label
 *  is already "Training effort · race to lock in"; PROVISIONAL_FINISH_LABEL
 *  in lib/coach/races-state.ts).
 *
 *  2026-08-21 · race-data re-audit · the copy used to read "Until it does, it
 *  doesn't count as fitness evidence", and the engine says the opposite in
 *  writing. `lib/race/auto-result.ts` §"FITNESS doctrine" lists exactly where
 *  the provisional flag binds: the UPWARD re-anchor is BLOCKED, but
 *  `bestRecentVdot` and `runPostResultChain` are "ADMITTED, unchanged", and
 *  `effort-authority.ts` states that at selection an unconfirmed result "is
 *  simply the best evidence the runner has". The card was also rendering
 *  directly above the evidence list on the same screen, which was listing that
 *  race AS evidence. Two things on one screen cannot disagree about whether a
 *  race counts, and the true one is that it counts — it just cannot move the
 *  paces upward until it is locked. */
export function chipLockFactCard(raceName: string): FactChoiceSpec {
  return {
    kind: 'fact',
    trigger: 'chip_lock',
    question: `${raceName}'s time is still the watch's. It counts, but it can't move your paces up until you lock the chip time in.`,
    answers: [
      { id: 'confirm', label: 'Confirm the time', action: 'confirm', targetSec: null },
      { id: 'leave', label: 'Leave it provisional', action: 'leave', targetSec: null },
    ],
  };
}

/**
 * TWO A RACES ARE ONLY A CONFLICT WHEN ONE BLOCK CANNOT SERVE BOTH.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * David, 2026-08-25: "needs a decision is coming up but makes no sense. One
 * is in December and one is in March."
 *
 * He is right, and the bug was that the detector asked "are there two?" when
 * the question is "do they collide?". CIM is 2026-12-06 and LA is 2027-03-07
 * — thirteen weeks apart, which is a whole marathon block with a week to
 * spare. Nothing about that pair needs choosing between; it is a season, and
 * it is the season a marathoner is supposed to run. The card demanded the
 * runner demote one of two races that were never competing, and both answers
 * it offered did damage.
 *
 * The card is still right when the races are genuinely stacked. Two A races
 * six weeks apart cannot both get a build and a taper, and the engine
 * genuinely cannot choose which one gets the block — which is why this is the
 * app's one CHOICE shape rather than something a threshold settles.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY TWELVE WEEKS
 *
 * It is the shortest gap in which the second race gets a real block of its
 * own: recovery from the first, then a build, then a taper. Below it the
 * second A race is being trained for out of the first one's leftovers, and
 * which race owns the block is a decision with two defensible answers.
 *
 * MEASURED BETWEEN THE TWO RACES, never from today. Two A races nine weeks
 * apart are the same collision whether they are next month or next year; how
 * far away the first one is says nothing about whether the second can have a
 * block of its own.
 */
export const A_RACE_COLLISION_DAYS = 84;

/**
 * The nearest pair of upcoming A races close enough to collide, or null.
 *
 * NOT BLINDLY THE FIRST TWO. Three A races at 10 / 120 / 130 days out hold no
 * conflict between the first two and a real one between the last two, and
 * asking about the wrong pair is the same failure as asking when there is no
 * conflict at all.
 *
 * Takes anything carrying `days` (days from today, ascending once sorted), so
 * the route can hand it its own row type without this file knowing about it.
 */
export function collidingARacePair<T extends { days: number }>(upcoming: T[]): [T, T] | null {
  const byDate = [...upcoming].sort((a, b) => a.days - b.days);
  for (let i = 0; i + 1 < byDate.length; i++) {
    if (byDate[i + 1].days - byDate[i].days < A_RACE_COLLISION_DAYS) {
      return [byDate[i], byDate[i + 1]];
    }
  }
  return null;
}

/** Two A races both ahead. Nothing in the engine can choose — this is the
 *  one CHOICE shape. Each answer's `id` IS that race's slug: `POST
 *  /api/v5/goal-answer` reads it back as `raceSlug` for `choose_race`. */
export function twoARacesChoiceCard(
  a: { slug: string; name: string },
  b: { slug: string; name: string },
): FactChoiceSpec {
  return {
    kind: 'choice',
    trigger: 'two_a_races',
    question: `${a.name} and ${b.name} are both set as A races. Training aims at one goal at a time.`,
    answers: [
      { id: a.slug, label: `${a.name} is the goal`, action: 'choose_race', targetSec: null },
      { id: b.slug, label: `${b.name} is the goal`, action: 'choose_race', targetSec: null },
    ],
  };
}

// ─── the DECISION card, driven by the verdict alone ─────────────────────────

function fmt(sec: number | null): string | null {
  return sec == null ? null : formatRaceTime(sec) ?? null;
}

/**
 * Which of the four "this IS a decision" triggers names why we're asking,
 * given the verdict `assessGoal` already computed and whether the runner is
 * currently on (or just off) the return-to-run ladder. Exported for the
 * route, which resolves `returningFromInjury` from the `runner_injuries` table —
 * this function stays pure and takes the answer as a bool. (The route said
 * `injuries` until 2026-08-24; no such table exists, so the answer was always
 * false. See `detectReturningFromInjury`.)
 */
export function decisionTriggerForVerdict(
  feasibility: GoalFeasibility,
  returningFromInjury: boolean,
): DecisionTriggerId {
  if (feasibility === 'unreadable') return 'evidence_stale';
  if (returningFromInjury && (feasibility === 'out-of-reach' || feasibility === 'date-passed')) {
    return 'returning_injury';
  }
  if (feasibility === 'date-passed') return 'date_passed';
  if (feasibility === 'comfortable' || feasibility === 'realistic') return 'fitness_ahead';
  if (feasibility === 'ambitious' || feasibility === 'aggressive' || feasibility === 'out-of-reach') {
    return 'fitness_behind';
  }
  return null; // open-ended — not reachable from the Races screen (always dated)
}

/**
 * The decision-shape card. Safe/stretch always carry `modelled: true` — both
 * are PROJECTED, never a measured result (rule one).
 *
 * The "Take X" button offers whichever number matches the direction of the
 * verdict: ahead of goal offers the STRETCH target (upgrade, since fitness
 * covers more than the stated goal asks); behind goal offers the SAFE
 * target (the honest number `assessGoal` says to report against once the
 * goal itself is aggressive/out-of-reach). Neither number is fabricated: a
 * verdict with no safe/stretch (unreadable, date-passed) gets no "Take"
 * button at all rather than a number invented to fill one.
 */
export function buildDecisionCard(
  assessment: GoalAssessment,
  returningFromInjury = false,
): V5DecisionCardOut {
  const trigger = decisionTriggerForVerdict(assessment.feasibility, returningFromInjury);
  const safeTarget: V5NumberOut | null =
    assessment.safeTargetSec != null ? { text: fmt(assessment.safeTargetSec), modelled: true } : null;
  const stretchTarget: V5NumberOut | null =
    assessment.stretchTargetSec != null ? { text: fmt(assessment.stretchTargetSec), modelled: true } : null;
  const cautions = assessment.cautions.slice(0, 3);

  const hold: V5CardAnswerOut = { id: 'hold', label: 'Hold the goal', action: 'hold', targetSec: null };
  const notNow: V5CardAnswerOut = { id: 'not_now', label: 'Not now', action: 'not_now', targetSec: null };
  const answers: V5CardAnswerOut[] = [];

  if (assessment.feasibility === 'comfortable' || assessment.feasibility === 'realistic') {
    answers.push(hold);
    if (assessment.stretchTargetSec != null) {
      answers.push({
        id: 'take', label: `Take ${fmt(assessment.stretchTargetSec)}`,
        action: 'take', targetSec: assessment.stretchTargetSec,
      });
    }
    answers.push(notNow);
  } else if (
    assessment.feasibility === 'ambitious' ||
    assessment.feasibility === 'aggressive' ||
    assessment.feasibility === 'out-of-reach'
  ) {
    answers.push(hold);
    if (assessment.safeTargetSec != null) {
      answers.push({
        id: 'take', label: `Take ${fmt(assessment.safeTargetSec)}`,
        action: 'take', targetSec: assessment.safeTargetSec,
      });
    }
    answers.push(notNow);
  } else {
    // unreadable / date-passed — no honest number exists to offer.
    answers.push(hold, notNow);
  }

  return {
    shape: 'decision',
    verdict: assessment.feasibility,
    trigger,
    question: assessment.statement,
    safeTarget,
    stretchTarget,
    cautions,
    answers,
  };
}

/**
 * THE composer. A pre-detected fact/choice always wins the shape — that is
 * the whole point of the split (four of the eight triggers are not a
 * decision about the goal, and the three-button decision set does not fit
 * them). Absent one, the card falls back to the decision shape driven by
 * the verdict alone.
 */
export function composeRaceCard(args: {
  assessment: GoalAssessment;
  factOrChoice: FactChoiceSpec | null;
  returningFromInjury?: boolean;
}): V5DecisionCardOut {
  const { assessment, factOrChoice, returningFromInjury = false } = args;
  if (factOrChoice) {
    return {
      shape: factOrChoice.kind,
      verdict: assessment.feasibility,
      trigger: factOrChoice.trigger,
      question: factOrChoice.question,
      safeTarget: null,
      stretchTarget: null,
      cautions: [],
      answers: factOrChoice.answers,
    };
  }
  return buildDecisionCard(assessment, returningFromInjury);
}

/**
 * How long an answered fact/choice trigger stays suppressed before the
 * route will detect it again. A UX convention, not a physiological
 * constant — no doctrine registry claim applies (CLAUDE.md Rule 7 binds
 * constants that assert something about training science; this is a
 * "don't re-ask the same fact every day" cooldown).
 */
export const TRIGGER_SUPPRESS_DAYS = 14;
