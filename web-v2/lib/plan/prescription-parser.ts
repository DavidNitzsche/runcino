/**
 * lib/plan/prescription-parser.ts · parse the prescription strings the
 * generator + workout_library use (e.g. "6×800m @ I pace · 90s jog")
 * into structured rep / rest values that spec-builder consumes.
 *
 * Fixes the sub_label vs workout_spec mismatch flagged 2026-06-02 ·
 * was: spec-builder hardcoded rep_count=4 + rep_distance_mi=1.0 for
 * every threshold workout, regardless of what the prescription said.
 * Result: card title promised "6×800m" but spec actually structured
 * 4×1mi · two different workouts on the same row.
 *
 * Now: spec-builder reads the prescription via this parser. The
 * prescription is the source of truth · spec mirrors it.
 *
 * Recognized shapes (from web-v2/lib/plan/generate.ts inlinePrescriptions
 * + workout_library prescription_text column):
 *
 *   "5×800m @ I pace · 90s jog"
 *   "4×1km @ I pace · 2:00 jog"
 *   "6×800m @ I pace · 90s jog"
 *   "5×1mi @ I-T transition · 2:00 jog"
 *   "3×1mi @ T pace · 60s jog"
 *   "4×1km @ T pace · 60s jog"
 *   "3×1mi @ T pace · 2:00 jog"
 *   "4×1mi @ T pace · 90s jog"
 *   "4×1 mi @ I · 3 Min Jog"        ← workout_library uses this shape too
 *
 * "continuous tempo" + "Nmi continuous tempo" are tempo-shaped · they
 * don't carry reps. Returns null for those · spec-builder falls back
 * to its tempo math.
 */

export interface ParsedPrescription {
  /** rep_count · how many reps. */
  reps: number;
  /** rep_distance_mi · the per-rep distance in miles. Both metric
   *  (k/km/m) and imperial (mi) inputs land here pre-converted. */
  repDistanceMi: number;
  /** rep_rest_s · jog recovery between reps in seconds. Null when the
   *  string didn't carry a rest specifier · spec-builder default applies. */
  restS: number | null;
}

/**
 * Parse a prescription string. Returns null when no rep pattern was
 * recognized (e.g. "continuous tempo", malformed strings) · caller
 * should fall back to the hardcoded spec.
 *
 * Tolerates leading distance prefix (e.g. "5mi · " from layoutWeek's
 * tempo composition) by scanning anywhere in the string for the
 * reps×distance pattern.
 */
export function parsePrescription(s: string | null | undefined): ParsedPrescription | null {
  if (!s || typeof s !== 'string') return null;

  // Match "N×Mmi" / "N×Mkm" / "N×Mk" / "N×Mm" · supports × and x and X
  // separators · whitespace tolerated around × and the unit.
  // Examples: "4×1mi", "6×800m", "4×1km", "5×1k", "4×1 mi"
  const repMatch = s.match(/(\d+)\s*[×xX]\s*(\d+(?:\.\d+)?)\s*(mi|km|k|m)\b/);
  if (!repMatch) return null;

  const reps = parseInt(repMatch[1], 10);
  const value = parseFloat(repMatch[2]);
  const unit = repMatch[3].toLowerCase();
  if (!Number.isFinite(reps) || !Number.isFinite(value) || reps <= 0 || value <= 0) return null;

  // Convert to miles
  let repDistanceMi: number;
  switch (unit) {
    case 'mi':
      repDistanceMi = value;
      break;
    case 'km':
    case 'k':
      // 1 km = 0.621371 mi
      repDistanceMi = value * 0.621371;
      break;
    case 'm':
      // "800m" → 0.497 mi
      repDistanceMi = (value / 1000) * 0.621371;
      break;
    default:
      return null;
  }
  repDistanceMi = Number(repDistanceMi.toFixed(3));

  // Rest specifier · "90s jog" | "2:00 jog" | "3 Min Jog" | "60 s jog"
  const restS = parseRest(s);

  return { reps, repDistanceMi, restS };
}

function parseRest(s: string): number | null {
  // "90s jog" or "90 s jog"
  const sMatch = s.match(/(\d+)\s*s(?:ec)?\b/i);
  if (sMatch) {
    const v = parseInt(sMatch[1], 10);
    if (Number.isFinite(v) && v > 0) return v;
  }
  // "M:SS jog" (e.g. "2:00 jog")
  const mmss = s.match(/(\d+):(\d{2})\s*jog/i);
  if (mmss) {
    const m = parseInt(mmss[1], 10);
    const sec = parseInt(mmss[2], 10);
    if (Number.isFinite(m) && Number.isFinite(sec)) return m * 60 + sec;
  }
  // "N min jog" / "N Min Jog" / "N-min jog"
  const minMatch = s.match(/(\d+)\s*[-\s]?\s*min\s*jog/i);
  if (minMatch) {
    const m = parseInt(minMatch[1], 10);
    if (Number.isFinite(m) && m > 0) return m * 60;
  }
  return null;
}
