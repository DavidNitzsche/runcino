/**
 * lib/faff/ramp-scope.ts · what is Train's volume ramp allowed to claim?
 *
 * Locked 2026-08-17. The ramp rendered the active plan's weeks and then a
 * checkered RACE bar, unconditionally. On a 2-week post-race recovery block
 * with a goal marathon 111 days out, that drew: two easy weeks, then race
 * day — and the 13-week goal build that actually sits between them was
 * invisible. Under a header that read "WEEKLY VOLUME · TO RACE DAY".
 *
 * The ruling: the ramp is a VOLUME chart. It can only honestly draw weeks
 * that carry prescribed mileage, and the goal block has not been generated
 * yet, so there is nothing to draw for it — inventing bars would fabricate
 * volume the runner has not been prescribed. So the ramp scopes itself to
 * the block it can draw, says which block that is in its own label, and
 * hands off in a caption that names the block that comes next. That is the
 * same set of facts the Goal page's THE WORK beat already states, off the
 * same `resolveBlockState` read, so the two surfaces cannot drift.
 *
 * The alternative considered and rejected: draw an explicit "gap" segment
 * between the recovery bars and the race bar. Rejected because a gap
 * segment on a volume axis still reads as volume, and because it keeps the
 * race bar on a chart whose weeks do not reach it.
 *
 * Pure · no IO.
 */

import type { BlockState } from './block-state';

export interface RampScopeInput {
  /** The runner's block state · lib/faff/block-state.ts. */
  blockState: BlockState;
  /** `seed.season.raceIdx` — which is only ever `miles.length - 1`, i.e.
   *  the last week of whatever plan is active. Never a race date. */
  raceIdx: number;
  /** Goal race name, for the handoff sentence. */
  goalName?: string | null;
}

export interface RampHandoff {
  /** The recovery window's span, when the current block is a recovery one. */
  windowStartISO: string | null;
  windowEndISO: string | null;
  /** The day the goal block opens. */
  opensISO: string | null;
  /** How far out the goal race is when that block opens. */
  weeksOutAtOpen: number | null;
  goalName: string | null;
}

export interface RampScope {
  /** True when the active plan actually ends at the goal race, so the last
   *  plan week IS race week and the ramp may say "to race day". */
  blockRunsToRace: boolean;
  /** The index the ramp should treat as race week. One PAST the end of the
   *  plan when the block does not run to the race — so no week resolves to
   *  the 'race' phase, and no real training week is swallowed by the
   *  checkered bar. */
  rampRaceIdx: number;
  /** Whether to draw the checkered race bar at all. */
  showRaceBar: boolean;
  /** The ramp's header label · never claims "to race day" dishonestly. */
  label: string;
  /** The handoff caption's facts, or null when the block runs to the race
   *  (nothing to hand off to) or there is nothing to name. */
  handoff: RampHandoff | null;
}

export function resolveRampScope(input: RampScopeInput): RampScope {
  const { blockState, raceIdx } = input;
  const goalName = input.goalName ?? null;
  const blockRunsToRace = !blockState.betweenBlocks;

  if (blockRunsToRace) {
    return {
      blockRunsToRace: true,
      rampRaceIdx: raceIdx,
      showRaceBar: true,
      label: 'WEEKLY VOLUME · TO RACE DAY',
      handoff: null,
    };
  }

  const label = blockState.reason === 'recovery'
    ? 'WEEKLY VOLUME · RECOVERY BLOCK'
    : 'WEEKLY VOLUME · CURRENT BLOCK';

  // Nothing worth captioning when we can name neither the window nor what
  // opens next. Render no caption rather than a half-sentence.
  const hasHandoff = blockState.nextBlockOpensISO != null
    || blockState.windowEndISO != null
    || goalName != null;

  return {
    blockRunsToRace: false,
    // One past the end · deliberately out of range for every real week.
    rampRaceIdx: raceIdx + 1,
    showRaceBar: false,
    label,
    handoff: hasHandoff
      ? {
        windowStartISO: blockState.windowStartISO,
        windowEndISO: blockState.windowEndISO,
        opensISO: blockState.nextBlockOpensISO,
        weeksOutAtOpen: blockState.weeksOutAtOpen,
        goalName,
      }
      : null,
  };
}
