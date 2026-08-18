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
 * 2026-06-02 · continuous-tempo shape parser. Matches strings like
 *   "2 mi WU · 4 mi @ T · 2 mi CD"
 *   "1.5 WU · 8 mi @ HM pace · 1.5 CD"
 * Returns null when no continuous-tempo block is recognized.
 *
 * These come from workout_library rows mislabeled family='threshold'
 * that actually describe continuous tempos · spec-builder's tempo
 * branch reads these to produce a tempo spec instead of a rep spec.
 */
export interface ParsedTempo {
  /** warmup_mi · the WU segment in miles. */
  warmupMi: number;
  /** tempo_distance_mi · the continuous tempo block in miles. */
  tempoMi: number;
  /** cooldown_mi · the CD segment in miles. */
  cooldownMi: number;
}

export function parseTempoShape(s: string | null | undefined): ParsedTempo | null {
  if (!s || typeof s !== 'string') return null;
  // "X mi WU · Y mi @ T · Z mi CD" · units on the WU/CD are optional
  // (library has both "2 mi WU" and "1.5 WU" shapes).
  const m = s.match(
    /(\d+(?:\.\d+)?)\s*(?:mi)?\s*WU\s*[·•]\s*(\d+(?:\.\d+)?)\s*mi\s*@[^·•]+[·•]\s*(\d+(?:\.\d+)?)\s*(?:mi)?\s*CD/i,
  );
  if (!m) return null;
  const wu = parseFloat(m[1]);
  const tempo = parseFloat(m[2]);
  const cd = parseFloat(m[3]);
  if (!Number.isFinite(wu) || !Number.isFinite(tempo) || !Number.isFinite(cd)) return null;
  return { warmupMi: wu, tempoMi: tempo, cooldownMi: cd };
}

/**
 * DAY-SIZE-1 (2026-08-17) · the leading size on a composed tempo prescription.
 *
 * `layoutWeek` writes a continuous tempo as `"<N>mi <phrase>"` — "5mi
 * continuous wave tempo · ±10 s/mi around T" — where the phrase carries the
 * §15 family's identity and the number is the composer's decision about the
 * block. `parseTempoShape` cannot read it (there is no WU/CD segment to read),
 * so `buildWorkoutSpec` fell through to its own default of `budget - 3` and
 * built a block of a different length from the one the label promised. The two
 * agreed only by coincidence, at exactly the budget where 0.6 x budget and
 * budget - 3 cross.
 *
 * Returns null unless the string OPENS with the size, so a phrase that merely
 * mentions a distance ("±10 s/mi around T", "last 2 mi at MP") is never read as
 * the block.
 */
export function parseTempoLeadMi(s: string | null | undefined): number | null {
  if (!s || typeof s !== 'string') return null;
  const m = s.match(/^\s*(\d+(?:\.\d+)?)\s*mi\b/i);
  if (!m) return null;
  const mi = parseFloat(m[1]);
  return Number.isFinite(mi) && mi > 0 ? mi : null;
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
  //
  // 2026-08-17 · the UNAMBIGUOUS uppercase units are accepted too. Research/04
  // §11.2 names the Canova session "2K repeats" and the catalog writes it that
  // way — "5×2K · descend MP → T · 2 min jog" — which this regex missed, so
  // `buildWorkoutSpec` fell through to its default and built 4×1mi @ T under a
  // label promising five two-kilometre reps. That is the sub_label/spec drift
  // this parser exists to prevent, arriving through the parser itself.
  //
  // K, KM and MI are added because no other reading of them exists. A bare
  // uppercase "M" is deliberately NOT accepted: "400M" is plainly metres and
  // "2M" is plainly miles, and a parser that guesses between them is how the
  // next drift starts. Lowercase "m" keeps its existing metres meaning.
  const repMatch = s.match(/(\d+)\s*[×xX]\s*(\d+(?:\.\d+)?)\s*(mi|MI|km|KM|k|K|m)\b/);
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

/**
 * DOCTRINE-VOCAB-1 (2026-08-17) · reps measured in TIME rather than distance.
 *
 * Two whole `workout_library` families are written this way and no other shape
 * will do. `Research/04-workout-vocabulary.md` §8.1 sizes every hill repeat by
 * duration ("Short hill repeats | 10–30 s", "Medium hill repeats | 60–90 s",
 * "Long hill repeats | 3–5 min") because the distance covered depends on the
 * gradient; §9.1 does the same for fartlek ("Mona fartlek | 2×90 s, 4×60 s,
 * 4×30 s, 4×15 s"). Until this parser existed, "6×90s hills · 2:30 jog down"
 * fell through `parsePrescription` (which requires a distance unit), and
 * spec-builder silently substituted its default 5×1000m rep set — the runner
 * would have read "hills" over a spec their watch ran as flat kilometre reps.
 *
 * Recognised: "6×90s hills", "6×3 min @ 10K effort", "10×30s hills".
 * Returns null for distance-based reps, so `parsePrescription` keeps priority
 * and every existing prescription parses exactly as it did before.
 */
export interface ParsedTimeReps {
  /** rep_count. */
  reps: number;
  /** rep_duration_s · seconds of work per rep. */
  durationS: number;
  /** rep_rest_s · recovery between reps, null when the string omits it. */
  restS: number | null;
}

export function parseTimeReps(s: string | null | undefined): ParsedTimeReps | null {
  if (!s || typeof s !== 'string') return null;
  // Strides are their own shape with their own placement rules — never a
  // rep set. parseStrides owns them.
  if (parseStrides(s)) return null;

  // "6×90s" / "10×30 s"
  let m = s.match(/(\d+)\s*[×xX]\s*(\d+(?:\.\d+)?)\s*s(?:ec)?\b/);
  let durationS = m ? parseFloat(m[2]) : null;
  if (!m) {
    // "6×3 min" / "4×3min"
    m = s.match(/(\d+)\s*[×xX]\s*(\d+(?:\.\d+)?)\s*min\b/i);
    durationS = m ? parseFloat(m[2]) * 60 : null;
  }
  if (!m || durationS == null) return null;

  const reps = parseInt(m[1], 10);
  if (!Number.isFinite(reps) || reps <= 0 || !Number.isFinite(durationS) || durationS <= 0) return null;

  // The rest specifier sits AFTER the rep pattern ("6×90s hills · 2:30 jog
  // down"), so parse it from the tail — otherwise "90s" is read as its own rest.
  const restS = parseRest(s.slice(m.index! + m[0].length));
  return { reps, durationS, restS };
}

/**
 * DOCTRINE-STRIDES-1 (2026-08-17) · strides tacked onto a run.
 *
 * `Research/04-workout-vocabulary.md` §7.2 puts strides in every phase
 * ("| When in cycle | All phases — never stop doing strides |") and every
 * race-week template in `Research/08` carries them, but until now the string
 * was the whole implementation: `generate.ts` wrote "2 mi + 4×20s strides"
 * into a plan row's NOTES, no spec field existed to carry it, and the watch
 * ran a flat two-mile jog under a label promising strides.
 *
 * Recognised shapes:
 *   "4×20s strides"          → { reps: 4, durationS: 20 }
 *   "6×80m strides"          → { reps: 6, distanceM: 80 }
 *   "45 min easy + 6×80m strides"
 *   "2 mi E + 6×ST"          → { reps: 6 }        (library shorthand)
 *   "2 mi E + 4×ST"
 *
 * Returns null when the string carries no strides. Deliberately narrow: it
 * requires the word "strides" or the "ST" shorthand, so a rep prescription
 * ("6×800m @ I pace") can never be misread as strides.
 */
export interface ParsedStrides {
  /** How many strides. */
  reps: number;
  /** Seconds per stride, when the string expressed them in time. */
  durationS: number | null;
  /** Metres per stride, when the string expressed them in distance. */
  distanceM: number | null;
}

export function parseStrides(s: string | null | undefined): ParsedStrides | null {
  if (!s || typeof s !== 'string') return null;
  // "N×Ms strides" / "N×Mm strides" — the unit is required, the word is required.
  const timed = s.match(/(\d+)\s*[×xX]\s*(\d+(?:\.\d+)?)\s*s(?:ec)?\b[^·•]{0,20}?strides?/i);
  if (timed) {
    const reps = parseInt(timed[1], 10);
    const durationS = parseFloat(timed[2]);
    if (reps > 0 && durationS > 0) return { reps, durationS, distanceM: null };
  }
  const metric = s.match(/(\d+)\s*[×xX]\s*(\d+(?:\.\d+)?)\s*m\b[^·•]{0,20}?strides?/i);
  if (metric) {
    const reps = parseInt(metric[1], 10);
    const distanceM = parseFloat(metric[2]);
    if (reps > 0 && distanceM > 0) return { reps, durationS: null, distanceM };
  }
  // Library shorthand "6×ST" — no unit, so doctrine's own default sizes it.
  const shorthand = s.match(/(\d+)\s*[×xX]\s*ST\b/);
  if (shorthand) {
    const reps = parseInt(shorthand[1], 10);
    if (reps > 0) return { reps, durationS: null, distanceM: null };
  }
  return null;
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
