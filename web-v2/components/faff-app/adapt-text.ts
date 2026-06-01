/**
 * Adaptation summarizer · "was X" text builder.
 *
 * The auto-adapter may change a workout's TYPE (threshold → easy),
 * its DISTANCE (8 mi easy → 6 mi easy), its DATE (Wed → Thu), or any
 * combination. The week-strip chip + FULL PLAN month cell + drawer
 * all need the same human-readable summary of what changed.
 *
 * Locked 2026-06-01 (David call):
 *   "An easy run can change to a shorter or longer easy run · I want
 *    to be notified of all run changes going forward."
 *
 * Compare label + distance + date independently. Build the summary
 * from whatever materially changed. Sub-tolerance distance drift +
 * case-only label diff suppress so the surface doesn't cry wolf on
 * no-op rewrites.
 */

export type AdaptationLike = {
  wasAdapted: boolean;
  originalType: string | null;
  originalSubLabel: string | null;
  originalDistanceMi: number | null;
  originalDateIso: string | null;
  reason?: string | null;
  adaptedAt?: string | null;
  kind?: string | null;
} | null | undefined;

export type CurrentDayLike = {
  type?: string | null;
  name?: string | null;
  subLabel?: string | null;
  dist?: string | number | null;  // current distance · stringified or numeric
  iso?: string | null;            // current ISO date · YYYY-MM-DD
  date?: string | null;           // alt key some shapes use
};

/**
 * Build the "was X" annotation text for a day whose adaptation is set.
 *
 * Returns:
 *   - `"was 8 mi threshold"` when both distance and label changed
 *   - `"was 8 mi"` when only distance changed
 *   - `"was threshold"` when only label changed
 *   - `"moved from MON"` when only the date changed
 *   - `null` when nothing materially changed (no-op rewrite) or
 *     adaptation isn't set.
 *
 * CSS in the consumer should uppercase the line so "was 8 mi threshold"
 * renders as "WAS 8 MI THRESHOLD".
 */
export function buildAdaptText(adapt: AdaptationLike, current: CurrentDayLike): string | null {
  if (!adapt?.wasAdapted) return null;

  const origLabel = adapt.originalSubLabel || adapt.originalType;
  const origDist = adapt.originalDistanceMi;
  const origDateIso = adapt.originalDateIso;

  const curLabelStr = (current.subLabel || current.name || current.type || '').toString();
  const curDistRaw = current.dist;
  const curDistNum = typeof curDistRaw === 'number'
    ? curDistRaw
    : parseFloat((curDistRaw ?? '0').toString());
  const curIso = current.iso ?? current.date ?? null;

  // Label changed · normalize case + trim before comparing so
  // "EASY" vs "Easy" doesn't trip a no-op annotation.
  const labelChanged = !!origLabel
    && origLabel.toString().toUpperCase().trim() !== curLabelStr.toUpperCase().trim();

  // Distance changed · 0.25 mi tolerance to absorb rounding noise.
  const distChanged = origDist != null
    && curDistNum > 0
    && Math.abs(origDist - curDistNum) >= 0.25;

  // Date changed · the workout moved to a different calendar day.
  const dateChanged = !!origDateIso && !!curIso && origDateIso !== curIso;

  const parts: string[] = [];
  if (distChanged && origDist != null) {
    // Drop ".0" so 8.0 reads as "8 mi".
    const distStr = origDist.toFixed(1).replace(/\.0$/, '');
    parts.push(`${distStr} mi`);
  }
  if (labelChanged && origLabel) {
    parts.push(origLabel.toString().toLowerCase());
  }

  if (parts.length > 0) {
    return `was ${parts.join(' ')}`;
  }
  if (dateChanged && origDateIso) {
    try {
      const d = new Date(origDateIso + 'T12:00:00');
      const dow = d.toLocaleDateString(undefined, { weekday: 'short' });
      return `moved from ${dow}`;
    } catch {
      return null;
    }
  }
  return null;
}
