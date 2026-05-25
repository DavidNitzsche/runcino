/**
 * Approximate workout-duration formatting — app-wide rule: once a duration
 * crosses an hour, show H:MM (101 min → "1:41") instead of "101 min".
 *
 * Returns { value, unit } so it drops into the stat-tile value/unit slots.
 * Under an hour: value "~42", unit "min". An hour or more: value "~1:41",
 * unit "" (the colon already reads as time).
 */
export function approxDuration(min: number | null | undefined): { value: string; unit: string } {
  if (min == null || !Number.isFinite(min)) return { value: '—', unit: '' };
  const m = Math.round(min);
  if (m >= 60) return { value: `~${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`, unit: '' };
  return { value: `~${m}`, unit: 'min' };
}
