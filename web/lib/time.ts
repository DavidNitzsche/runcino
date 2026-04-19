/**
 * Time and pace formatting helpers.
 * All times in seconds, all paces in seconds-per-mile.
 */

export const M_PER_MI = 1609.344;
export const FT_PER_M = 3.28084;

/** "3:50:00" from 13800. */
export function formatHMS(totalS: number): string {
  const s = Math.round(totalS);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}

/** "8:40" from 520. */
export function formatPace(sPerMi: number): string {
  const s = Math.round(sPerMi);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

/** "8:40/mi" from 520. */
export function formatPaceMi(sPerMi: number): string {
  return `${formatPace(sPerMi)}/mi`;
}

/** Parse "3:50:00" → 13800. Returns null on malformed input. */
export function parseHMS(str: string): number | null {
  const m = str.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, h, mm, ss] = m;
  return Number(h) * 3600 + Number(mm) * 60 + Number(ss);
}

/** 42195 meters → 26.22 miles, rounded to 2 dp. */
export function metersToMiles(m: number): number {
  return Math.round((m / M_PER_MI) * 100) / 100;
}

/** 500 meters → 500/1609.344 miles. */
export function metersToMilesExact(m: number): number {
  return m / M_PER_MI;
}
