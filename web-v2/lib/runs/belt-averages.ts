/**
 * belt-averages.ts · what the belt was actually set to, across a session.
 *
 * A treadmill session's speed and incline live on the completion payload's
 * PHASES, not on the run row — there is no sensor, only the settings the
 * runner confirmed. Rolling those phases up to one number for a card is easy
 * to get wrong in the same way the phone's own console got it wrong
 * (see native-v2/Faff/Faff/BeltTracker.swift): a plain mean is a summary
 * statistic standing in for an integral.
 *
 * Two specific traps this closes:
 *
 *  1. A phase the runner never reached still carries `actualSpeedMph` and
 *     `actualInclinePct` — by design, both consoles report an unreached
 *     phase at its NOMINAL target so the payload says what was asked. It has
 *     no `actualDurationSec`, because it did not happen. Averaging it in puts
 *     a speed the belt never ran at into the answer. David's 2026-07-23
 *     session had 3 of its 9 phases unreached, and a plain mean counted all
 *     nine.
 *
 *  2. A 2-minute recovery is not worth the same as a 20-minute work block.
 *     Weight by the time actually spent.
 *
 * Returns null rather than a number when no phase carries either field —
 * "we do not know what this belt was set to" is a correct answer, and a
 * caller that renders null as an absence is telling the truth. Same posture
 * as `treadmillMeanInclinePct` in lib/terrain/run-terrain.ts, which does the
 * distance-weighted version of the incline half for grade adjustment.
 */

export interface BeltPhaseLike {
  actualSpeedMph?: unknown;
  actualInclinePct?: unknown;
  actualDurationSec?: unknown;
}

export interface BeltAverages {
  /** Time-weighted mean belt speed across the phases that happened. */
  speedMph: number | null;
  /** Time-weighted mean incline across the phases that happened. */
  inclinePct: number | null;
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param phases the completion payload's `phases` array, unknown-typed
 *               because it arrives from a jsonb column.
 */
export function beltAverages(phases: unknown): BeltAverages {
  if (!Array.isArray(phases) || phases.length === 0) {
    return { speedMph: null, inclinePct: null };
  }
  const rows = phases.filter((p): p is BeltPhaseLike => !!p && typeof p === 'object');
  // Only the phases that actually ran carry a duration.
  const ran = rows.filter((p) => (num(p.actualDurationSec) ?? 0) > 0);

  const mean = (key: 'actualSpeedMph' | 'actualInclinePct', positiveOnly: boolean): number | null => {
    let weighted = 0;
    let weight = 0;
    for (const p of ran) {
      const v = num(p[key]);
      if (v == null || (positiveOnly && !(v > 0))) continue;
      const w = num(p.actualDurationSec) ?? 0;
      weighted += v * w;
      weight += w;
    }
    if (weight > 0) return weighted / weight;
    // No phase carries a duration — an older payload from before the
    // consoles reported one. Fall back to the plain mean, which is what this
    // always did, rather than dropping the card entirely.
    const flat = rows
      .map((p) => num(p[key]))
      .filter((v): v is number => v != null && (!positiveOnly || v > 0));
    return flat.length > 0 ? flat.reduce((s, v) => s + v, 0) / flat.length : null;
  };

  return { speedMph: mean('actualSpeedMph', true), inclinePct: mean('actualInclinePct', false) };
}
