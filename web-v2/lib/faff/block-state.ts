/**
 * lib/faff/block-state.ts · is the runner INSIDE a training block, or
 * between two of them?
 *
 * Ruled in the web recomposition deck (Decision 3): Targets' THE WORK beat
 * rendered an empty test-point list whenever the active plan had no quality
 * in it — which is exactly what a post-race recovery block looks like. An
 * empty list reads as a broken page. The deck's ruling is to say the state
 * out loud: name the window, name the date the next block opens, and name
 * how far out the goal race is when it does.
 *
 * A recovery block is a BRIDGE, not the block. The runner is between blocks
 * during it even though a plan row exists, because none of the work in it is
 * pointed at the goal race — it is pointed at absorbing the last one. Same
 * for a plan whose last prescribed day has passed, and for no plan at all.
 *
 * Pure · no IO. The seed passes in what it already loaded.
 */

export type BetweenBlocksReason = 'recovery' | 'block-over' | 'no-plan';

export interface BlockStateInput {
  /** training_plans.mode for the active plan · null when no active plan. */
  planMode?: string | null;
  /** First prescribed day of the active plan (ISO YYYY-MM-DD). */
  planFirstDayISO?: string | null;
  /** Last prescribed day of the active plan (ISO YYYY-MM-DD). */
  planLastDayISO?: string | null;
  /** The runner's today, in their own timezone (ISO YYYY-MM-DD). */
  todayISO: string;
  /** The goal race the next block will be built for. */
  goalRace?: { name: string; dateISO: string | null } | null;
}

export interface BlockState {
  betweenBlocks: boolean;
  /** Why, when betweenBlocks. Null when inside a block. */
  reason: BetweenBlocksReason | null;
  /** The window the runner is in right now · the recovery block's span, or
   *  null when there is no plan to bound it. */
  windowStartISO: string | null;
  windowEndISO: string | null;
  /** The day after the window closes · when the next block opens. Null when
   *  there is nothing to open from. */
  nextBlockOpensISO: string | null;
  /** Whole weeks from the block opening to the goal race. Null without a
   *  goal race date or an opening date. */
  weeksOutAtOpen: number | null;
  goalName: string | null;
  goalDateISO: string | null;
}

const DAY_MS = 86_400_000;

function parseISO(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso.slice(0, 10) + 'T12:00:00Z');
  return Number.isFinite(t) ? t : null;
}

function addDays(iso: string, days: number): string | null {
  const t = parseISO(iso);
  if (t == null) return null;
  return new Date(t + days * DAY_MS).toISOString().slice(0, 10);
}

const IN_BLOCK: BlockState = {
  betweenBlocks: false,
  reason: null,
  windowStartISO: null,
  windowEndISO: null,
  nextBlockOpensISO: null,
  weeksOutAtOpen: null,
  goalName: null,
  goalDateISO: null,
};

/**
 * Resolve whether the runner is between blocks, and everything the honest
 * copy needs to say so.
 */
export function resolveBlockState(input: BlockStateInput): BlockState {
  const { todayISO } = input;
  const mode = (input.planMode ?? '').trim().toLowerCase() || null;
  const first = input.planFirstDayISO ?? null;
  const last = input.planLastDayISO ?? null;
  const todayT = parseISO(todayISO);
  const lastT = parseISO(last);

  let reason: BetweenBlocksReason | null = null;
  if (mode == null) {
    reason = 'no-plan';
  } else if (mode === 'recovery') {
    reason = 'recovery';
  } else if (lastT != null && todayT != null && todayT > lastT) {
    // The plan ran out and nothing has replaced it yet.
    reason = 'block-over';
  }

  if (reason == null) return IN_BLOCK;

  // The next block opens the day after this window closes. With no plan at
  // all there is no window to close, so it opens as soon as one is built.
  const nextBlockOpensISO = last ? addDays(last, 1) : null;
  const goalDateISO = input.goalRace?.dateISO ?? null;
  const openT = parseISO(nextBlockOpensISO);
  const goalT = parseISO(goalDateISO);
  const weeksOutAtOpen = openT != null && goalT != null && goalT > openT
    ? Math.floor((goalT - openT) / (7 * DAY_MS))
    : null;

  return {
    betweenBlocks: true,
    reason,
    windowStartISO: reason === 'recovery' ? first : null,
    windowEndISO: reason === 'recovery' ? last : null,
    nextBlockOpensISO,
    weeksOutAtOpen,
    goalName: input.goalRace?.name ?? null,
    goalDateISO,
  };
}
