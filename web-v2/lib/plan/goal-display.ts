/**
 * Canonicalize a typed race-goal time to H:MM:SS (2026-06-23 · CAP-3).
 *
 * Single source for goal-time normalization. Onboarding used this; /api/race POST + PATCH stored the
 * raw string, so a runner typing "7:45" for a 5K had it read as 7h45m → an absurd implied pace that
 * PACE-3 then nulled (the goal silently discarded). Distance-aware: a two-part time on a SHORT race
 * (5K/10K) is MM:SS; on a longer race it is H:MM. Accepts a distance category ('5k') OR a label ('5K').
 */
export function normalizeGoalDisplay(time: string | null | undefined, distance: string | null | undefined): string | null {
  if (!time) return null;
  const t = String(time).trim();
  if (!t) return null;
  if (/^\d{1,2}:\d{2}:\d{2}$/.test(t)) return t;            // already H:MM:SS
  const two = t.match(/^(\d{1,2}):(\d{2})$/);
  if (two) {
    const d = (distance ?? '').toLowerCase();
    const isShort = d === '5k' || d === '10k' || d.includes('5k') || d.includes('10k');
    return isShort
      ? `0:${two[1].padStart(2, '0')}:${two[2]}`            // MM:SS → 0:MM:SS
      : `${two[1]}:${two[2]}:00`;                           // H:MM  → H:MM:00
  }
  return null;
}
