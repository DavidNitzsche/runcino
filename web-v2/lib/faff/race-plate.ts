/**
 * lib/faff/race-plate.ts — the Goal / Projected / Gap plate on race detail.
 *
 * Extracted from `app/api/v5/race/[slug]/route.ts` so the one decision that
 * screen kept getting wrong is a pure function with a test around it.
 *
 * THE DECISION: a race that has already been run is not projected.
 *
 * The route computed `projected` from today's VDOT and `gap` from that
 * projection for every race, past or future, though it already read
 * `race.is_past` a few lines further down for the result section. Opening a
 * race from last weekend therefore showed today's fitness projected onto it,
 * a gap against that projection, and a coach line reading "That can still
 * close." about a result already in the book.
 */

export interface RacePlateInput {
  isPast: boolean;
  /** The runner's goal, in seconds. Null when no goal was ever set. */
  goalSec: number | null;
  /** What they actually ran, in seconds. Null pre-race, or on a DNS. */
  finishSec: number | null;
  /** Today's fitness projected onto this distance, in seconds. */
  projectedSec: number | null;
}

export interface RacePlate {
  /** The middle column's value in seconds, or null to leave it empty. */
  middleSec: number | null;
  /** False for a past race's finish (a read); true for a projection. */
  middleModelled: boolean;
  gapSec: number | null;
  gapModelled: boolean;
  /** Whether the forward-looking coach line and pace plan may be shown. */
  showsForwardLooking: boolean;
}

export function racePlateFor(input: RacePlateInput): RacePlate {
  const { isPast, goalSec, finishSec, projectedSec } = input;

  if (isPast) {
    // Past and finished: what they ran, and the gap measured against the
    // goal. A finish time is a read, not a model, so neither carries the
    // tilde. Past and unfinished (a DNS, or a result not logged yet): no
    // projection and no gap — there is nothing honest to put there.
    const gap = (finishSec != null && goalSec != null) ? finishSec - goalSec : null;
    return {
      middleSec: finishSec,
      middleModelled: false,
      gapSec: gap,
      gapModelled: false,
      showsForwardLooking: false,
    };
  }

  const gap = (projectedSec != null && goalSec != null) ? projectedSec - goalSec : null;
  return {
    middleSec: projectedSec,
    middleModelled: true,
    gapSec: gap,
    gapModelled: true,
    showsForwardLooking: true,
  };
}
