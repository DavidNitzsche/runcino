/**
 * lib/race/goal-framing.ts · the "time or effort?" ask for a rolling course.
 *
 * Owner ruling (David 2026-08-28): when the coach-goal engine hits the one
 * genuine judgment call it has — a ROLLING course (Research/02 §13.2's Hilly
 * tier, 19-57 ft/mi gross), where a hill-adjusted time target and an
 * effort-only framing are both defensible — the APP asks the runner. Not a
 * backend conversation, not a silent pick: a card.
 *
 * The default while unanswered is the GRADED framing — hill-adjusted A/B/C
 * times plus the effort guidance line (`deriveCoachGoal`'s rolling-band
 * default). The live case is his Santa Monica 10K: 202 ft of gain (~32
 * ft/mi), B priority, raced all-out as a fitness anchor — exactly this band,
 * and he wants numbers. So the card confirms rather than gates: accept keeps
 * the numbers, decline switches the race to effort framing, and silence
 * changes nothing (the card copy says so).
 *
 * Mechanics mirror the race_role card (lib/race/race-role.ts, RACEROLE-1):
 *   · the nightly plan-drift cron writes ONE pending `race_goal_framing`
 *     plan_proposals row per race (dedupe on any prior row for the slug, any
 *     status, fail-closed), for a ROLLING-band, non-C race with no stated
 *     goal and no answered framing, inside the active plan's window;
 *   · it fires when the race enters the ~4-week window — or on the next
 *     cron night if the race was added closer than that — NOT parked until
 *     race week (GOAL_FRAMING_FIRE_WINDOW_DAYS below);
 *   · the answer persists on `races.meta.goalFraming` ('time' | 'effort'),
 *     written field-level with jsonb_set (Rule 6), by the proposal route:
 *     accept → 'time', decline → 'effort';
 *   · `deriveCoachGoal` reads the answer as an override of the band logic;
 *   · expiry (14d unanswered, the standing proposal-expiry sweep) changes
 *     nothing — the graded default stands.
 *
 * This module is PURE — no DB, no fetch. The cron calls `goalFramingCard`;
 * the proposal route persists the answer; `coach-goal.ts` owns the band.
 */

import type { CourseGrade } from './coach-goal';

export type GoalFraming = 'time' | 'effort';

/** True when `v` is a value this module owns. Guards the meta read in the
 *  goal derivation against arbitrary strings in jsonb. */
export function isGoalFraming(v: unknown): v is GoalFraming {
  return v === 'time' || v === 'effort';
}

/**
 * The cron fires the ask once the race is this many days out or closer.
 * ~4 weeks: the runner gets the question with the whole sharpening block
 * still ahead, not as race-week noise — and a race added later than 4 weeks
 * out gets asked on the next cron night rather than never. The lower bound
 * is race day itself (a past race has nothing to frame); the per-slug
 * exactly-once dedupe means a card is never re-fired closer in.
 */
export const GOAL_FRAMING_FIRE_WINDOW_DAYS = 28;

export interface GoalFramingCardInput {
  raceName: string;
  /** Short distance label for the title ("10k", "half"). Falls back to the
   *  race name alone when null. */
  distanceLabel: string | null;
  /** Measured gross gain, ft. */
  elevationGainFt: number;
  /** Measured gross gain per mile — the band position the ask is about. */
  gainFtPerMi: number;
}

export interface GoalFramingCard {
  /** Card headline, e.g. "Santa Monica 10k. Time or effort?" */
  title: string;
  /** Card body. States the course, the two framings, and that leaving it
   *  keeps the graded numbers. */
  body: string;
  /** ACCEPT verb · rendered as "ACCEPT · RACE THE NUMBER". */
  acceptVerb: string;
  /** Secondary verb · rendered as the KEEP-slot label. Declining is an
   *  answer here (it persists 'effort'), so the label says what it does. */
  keepVerb: string;
}

/* Coach voice: short, direct. No hype, no exclamation marks, no emoji, no
   em dashes. The body must say what standing pat means, because the card
   expires unanswered after 14 days and the graded default stands. */
export function goalFramingCard(input: GoalFramingCardInput): GoalFramingCard {
  const label = input.distanceLabel?.trim() || null;
  // "Santa Monica" + "10k" → "Santa Monica 10k"; a name that already carries
  // its distance ("Santa Monica 10K") is left alone.
  const name = label && !input.raceName.toLowerCase().includes(label.toLowerCase())
    ? `${input.raceName} ${label}`.replace(/\s+/g, ' ').trim()
    : input.raceName;
  const gain = Math.round(input.elevationGainFt);
  const perMi = Math.round(input.gainFtPerMi);
  return {
    title: `${name}. Time or effort?`,
    body:
      `Rolling course. ${gain} ft of climb, about ${perMi} a mile. ` +
      `I have set your targets graded for the hills, with effort as the guide on the climbs. ` +
      `If you would rather race it purely on effort and let the splits fall where they fall, say so. ` +
      `Leave this and the graded numbers stand.`,
    acceptVerb: 'RACE THE NUMBER',
    keepVerb: 'KEEP IT ON EFFORT',
  };
}

/** The band the ask exists for. The cron gates on this so the question is
 *  only ever posed where both answers are defensible: flat has nothing to
 *  ask, steep already refused the number. */
export function gradeGetsTheAsk(grade: CourseGrade): boolean {
  return grade === 'rolling';
}
