/**
 * lib/faff/goal-status.ts · THE single goal-status vocabulary.
 *
 * Ruled in the web recomposition deck (docs/design/web-recomposition-deck-
 * 2026-08-17.html · Decision 3b): the app shipped three dialects for one
 * fact, plus a fourth derivation on Today's GAP tile.
 *
 *   · StatusPill      "On track / Watching / Off track"   (no number)
 *   · confidence tier "HIGH / MEDIUM / LOW / AHEAD"       (mixed axes)
 *   · prose           "on pace / off pace"                (no number)
 *   · GapPanel chip   "31:48 to find / On track"          (own wording)
 *
 * The ruling: ONE chip, tier word + gap value. AHEAD · ON PACE · WATCHING ·
 * BEHIND, each carrying the number the pill never did. It obeys the design
 * brief's label grammar (one word plus optional context) and it is the same
 * sentence on every surface.
 *
 * Deliberate call on 'unclosable': the deck names four words, so unclosable
 * is NOT a fifth. A sustained-unclosable gap reads BEHIND like any other
 * behind, and sets `unclosable` on the read — that flag is what mounts the
 * goal-renegotiation card next to the number it renegotiates. The vocabulary
 * stays four words wide; the escalation lives in the card, not the chip.
 *
 * Consumers: TargetsView (ANSWER + THE PATH), GapPanel. Today's GAP tile is
 * expected to adopt `resolveGoalStatus` in place of its own derivation.
 */

export type GoalStatusTier = 'ahead' | 'on-pace' | 'watching' | 'behind';

export type GoalStatusWord = 'AHEAD' | 'ON PACE' | 'WATCHING' | 'BEHIND';

export interface GoalStatusRead {
  tier: GoalStatusTier;
  word: GoalStatusWord;
  /** Signed seconds against the goal. Positive = slower than goal. */
  gapSec: number | null;
  /** Absolute gap, clock-formatted ("31:48"). Null when there is no gap
   *  worth stating (inside the ON PACE dead band, or no numbers). */
  gapLabel: string | null;
  /** The chip's full text · "BEHIND · 31:48" or "ON PACE". */
  label: string;
  /** True when the gap has been classified unclosable on the runway that
   *  is left. Mounts the renegotiation card; does NOT change the word. */
  unclosable: boolean;
  /** Palette token for the chip, from the locked ten-colour palette. */
  tone: string;
}

/** Gaps under this read as "on pace" rather than a number worth stating. */
export const ON_PACE_DEAD_BAND_SEC = 30;

const TONE: Record<GoalStatusTier, string> = {
  ahead: '#86efa0',
  'on-pace': '#86efa0',
  watching: '#F3AD38',
  behind: '#FC4D64',
};

const WORD: Record<GoalStatusTier, GoalStatusWord> = {
  ahead: 'AHEAD',
  'on-pace': 'ON PACE',
  watching: 'WATCHING',
  behind: 'BEHIND',
};

/** Clock format for a gap · "48", "31:48", "1:04:12". Always positive. */
export function formatGapClock(sec: number): string {
  const t = Math.max(0, Math.round(Math.abs(sec)));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  if (m > 0) return `${m}:${pad(s)}`;
  return String(s);
}

export interface GoalStatusInput {
  /** The goal-seeking trajectory · the preferred read. Where the plan,
   *  executed, projects you on race day. */
  trajectory?: {
    gapSec: number | null;
    gapVdot: number;
    reachable: boolean;
    aheadOfGoal: boolean;
  } | null;
  /** Goal finish time in seconds. */
  goalSec?: number | null;
  /** Current-fitness projection in seconds · the fallback read when no
   *  trajectory exists (cold start, no race date). */
  projectionSec?: number | null;
  /** A sustained-unclosable classification from the gap engine, or a
   *  pending goal_renegotiation proposal. Forces BEHIND. */
  unclosable?: boolean;
}

/**
 * Resolve the one status read. Returns null when there is nothing honest
 * to say — no trajectory AND no goal-versus-projection pair. Callers must
 * render nothing in that case rather than inventing a tier.
 */
export function resolveGoalStatus(input: GoalStatusInput): GoalStatusRead | null {
  const traj = input.trajectory ?? null;
  const goalSec = input.goalSec ?? null;
  const projSec = input.projectionSec ?? null;
  const unclosable = input.unclosable === true;

  let tier: GoalStatusTier | null = null;
  let gapSec: number | null = null;

  if (traj) {
    gapSec = traj.gapSec ?? null;
    // aheadOfGoal reports the gap as a magnitude; sign it so the chip and
    // any consumer arithmetic agree that faster-than-goal is negative.
    if (traj.aheadOfGoal && gapSec != null && gapSec > 0) gapSec = -gapSec;
    tier = traj.aheadOfGoal ? 'ahead'
      : traj.reachable ? 'on-pace'
      : traj.gapVdot <= 1.5 ? 'watching'
      : 'behind';
  } else if (goalSec != null && goalSec > 0 && projSec != null) {
    gapSec = projSec - goalSec;
    const ratio = projSec / goalSec;
    // Same thresholds the gap panel has judged by since 2026-06-04.
    tier = ratio <= 1.0 ? 'ahead'
      : ratio <= 1.03 ? 'on-pace'
      : ratio <= 1.08 ? 'watching'
      : 'behind';
  }

  if (tier == null) return null;

  // An unclosable gap is never dressed as anything softer than BEHIND.
  if (unclosable) tier = 'behind';

  const word = WORD[tier];
  const showGap = gapSec != null
    && (tier !== 'on-pace' || Math.abs(gapSec) >= ON_PACE_DEAD_BAND_SEC);
  const gapLabel = showGap ? formatGapClock(gapSec!) : null;

  return {
    tier,
    word,
    gapSec,
    gapLabel,
    label: gapLabel ? `${word} · ${gapLabel}` : word,
    unclosable,
    tone: TONE[tier],
  };
}
