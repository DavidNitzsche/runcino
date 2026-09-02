/**
 * lib/plan/prescription-parser.ts · parse the prescription strings the
 * generator + workout library use (e.g. "6×800m @ I pace · 90s jog")
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
 * + the workout library's prescriptionText — lib/plan/workout-library-static.ts):
 *
 *   "5×800m @ I pace · 90s jog"
 *   "4×1km @ I pace · 2:00 jog"
 *   "6×800m @ I pace · 90s jog"
 *   "5×1mi @ I-T transition · 2:00 jog"
 *   "3×1mi @ T pace · 60s jog"
 *   "4×1km @ T pace · 60s jog"
 *   "3×1mi @ T pace · 2:00 jog"
 *   "4×1mi @ T pace · 90s jog"
 *   "4×1 mi @ I · 3 Min Jog"        ← the workout library uses this shape too
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
 * These come from workout-library rows mislabeled family='threshold'
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
 * Two whole workout-library families are written this way and no other shape
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

/* ─────────────────────────────── zones ─────────────────────────────────── */

/**
 * ZONE-R-1 (2026-08-19) · the pace zone a prescription DECLARES.
 *
 * `Research/04-workout-vocabulary.md` §"Pace zone shorthand" is the vocabulary;
 * every prescription this engine writes names its zone out of it ("@ T pace",
 * "@ I-T transition", "@ 5K-10K effort", "· MP → T ·"). Until now nothing read
 * those tokens: `buildWorkoutSpec` paced a `threshold` slot at T and a rep slot
 * at I whatever the label said, and `dosing.ts` carried two hand-written
 * regexes — one for "@ MP", one for "5K pace" — because those were the two
 * cases where the label and the type disagreed badly enough to notice.
 *
 * This is that reading, once, so the pace the watch runs and the bucket the
 * dosing gate charges come from the same lines of parsing.
 *
 * ── Where a zone may appear ────────────────────────────────────────────────
 *
 * Two places, both deliberate and both narrow:
 *
 *   · after an `@`, up to the next `·` — "@ T pace", "@ 5K-10K effort".
 *     A multi-zone clause is a BAND ("I-T transition" is the transition between
 *     them), and its first token is the one the session is paced at.
 *   · in an arrow clause of its own — "· MP → T ·" — which the catalogue
 *     renders for entries whose cited rows state a progression ("descend across
 *     reps"). Its LAST token is the target the session is paced at.
 *
 * Anywhere else a bare letter is prose, not a zone. "±10 s/mi around T" is a
 * wave tempo's shape row, and reading its T as a declaration would be the
 * beginning of a habit that ends in a mis-paced session.
 */
export type PrescriptionZone =
  | 'E' | 'M' | 'MP' | 'T' | 'ST' | 'I' | 'R' | 'HM' | '10K' | '5K' | '3K' | 'mile';

const ZONE_TOKENS: ReadonlyMap<string, PrescriptionZone> = new Map<string, PrescriptionZone>([
  ['E', 'E'], ['M', 'M'], ['MP', 'MP'], ['T', 'T'], ['ST', 'ST'], ['I', 'I'],
  ['R', 'R'], ['HM', 'HM'], ['10K', '10K'], ['5K', '5K'], ['3K', '3K'], ['mile', 'mile'],
]);

/** Zone tokens inside one clause, in the order they are written. */
function zonesInClause(clause: string): PrescriptionZone[] {
  const out: PrescriptionZone[] = [];
  for (const raw of clause.split(/[^A-Za-z0-9]+/)) {
    if (!raw) continue;
    const z = ZONE_TOKENS.get(raw);
    if (z) out.push(z);
  }
  return out;
}

const ARROW_CLAUSE = /^[A-Za-z0-9]+(?:\s*(?:→|->)\s*[A-Za-z0-9]+)+$/;

/** The arrow clause a prescription carries, if it carries exactly one. */
function arrowZones(s: string): PrescriptionZone[] {
  for (const clause of s.split(/[·•]/)) {
    const t = clause.trim();
    if (!/→|->/.test(t)) continue;
    // Only a clause that is NOTHING but zone tokens and arrows. A sentence that
    // happens to contain an arrow is prose.
    if (!ARROW_CLAUSE.test(t)) continue;
    const zs = zonesInClause(t);
    if (zs.length) return zs;
  }
  return [];
}

/** Every zone a prescription declares, in written order. Empty when it declares
 *  none — the common case, and it means the caller's own default stands. */
export function parseZones(s: string | null | undefined): PrescriptionZone[] {
  if (!s || typeof s !== 'string') return [];
  const text = String(s);
  const out: PrescriptionZone[] = [];
  for (const m of text.matchAll(/@\s*([^·•+()]+)/g)) out.push(...zonesInClause(m[1]));
  out.push(...arrowZones(text));
  return out;
}

/**
 * The ONE zone the session's headline pace is set from.
 *
 * A progression walks toward its target, so the target is the last token of the
 * arrow clause; a band is entered at its slow edge, so the band is the first.
 * Both readings are what the existing branches already did by another route,
 * which is why turning this on moved no number: `@ I-T transition` resolves to
 * I, which is what a rep slot was already paced at, and `· MP → T ·` resolves
 * to T, which is what a threshold slot was already paced at.
 */
export function primaryZone(s: string | null | undefined): PrescriptionZone | null {
  if (!s || typeof s !== 'string') return null;
  const arrows = arrowZones(String(s));
  if (arrows.length) return arrows[arrows.length - 1];
  const all = parseZones(s);
  return all.length ? all[0] : null;
}

/* ────────────────────────────── segments ───────────────────────────────── */

/**
 * GRAMMAR-SEQ-1 (2026-08-19) · a session whose steps are NOT all the same.
 *
 * `parsePrescription` and `parseTimeReps` both read one shape: N identical reps
 * with one recovery. That is most of `Research/04`, and it is none of §13's
 * ladders ("400-800-1200-1600"), §9.2's Mona fartlek ("2×90 s, 4×60 s, 4×30 s,
 * 4×15 s"), §10.1's alternations ("1 mi at MP / 1 mi at 10K, repeated 5–8×"),
 * §10.2's combos ("2 mi T + 4×800 I") or §12.4's 5K progression ("first third
 * at HM, middle at T, final third at 10K-5K"). Every one of those sits in the
 * catalogue as cited data and every one was declined, because approximating
 * them into a uniform rep set is the label/spec drift this codebase has already
 * paid for twice.
 *
 * ── The grammar ────────────────────────────────────────────────────────────
 *
 *     SEQ   := ITEM (' + ' ITEM)*
 *     ITEM  := [N '×'] ( '(' STEP (' + ' STEP)* ')' | STEP ) [' · ' REST]
 *     STEP  := NUMBER UNIT [' @ ' ZONE(-ZONE)*] [' · ' REST]
 *     UNIT  := mi | km | m | min | s
 *
 * It is the notation a coach writes on a whiteboard, chosen for that reason:
 * "6×(1mi @ MP + 1mi @ 10K)" is §10.1's own structure row, and
 * "2mi @ T · 2:30 jog + 4×800m @ I · 90s jog" is §10.2's first common structure.
 *
 * ── Why this is safe to add ────────────────────────────────────────────────
 *
 * Returns null unless the string carries a top-level ` + ` or a `×(` group AND
 * every item parses, so no prescription the engine writes today reaches it.
 * `buildWorkoutSpec` consults it FIRST, before `parsePrescription` — a combo
 * like "2mi @ T · 2:30 jog + 4×800m @ I · 90s jog" contains a `4×800m` that the
 * older parser would happily read on its own, building the rep block and
 * silently dropping the threshold block in front of it.
 *
 * Strict, not tolerant, for the same reason: an item with anything left over
 * after its number, unit and zone fails the WHOLE parse rather than being
 * guessed at. That is what keeps the library's "2 mi E + 6×80m strides" — which
 * has a top-level ` + ` and is not a sequence — from being read as one.
 */
export type SegmentUnit = 'mi' | 'km' | 'm' | 'min' | 's';

export interface ParsedSegment {
  /** Size of this step in `unit`. */
  value: number;
  unit: SegmentUnit;
  /** The zone this step runs at, null when the step declares none. */
  zone: PrescriptionZone | null;
  /**
   * LADDER-TARGET-2 (2026-09-02) · SECONDS PER MILE SLOWER THAN `zone`.
   *
   * The vocabulary a cutdown's opening rungs need and the grammar did not
   * have. `Research/04` §12.2's own Pace example is "6 reps: MP+10, MP, MP-10,
   * HM, T, 10K" and its Structure row says "Start slower than MP" — so a
   * six-rep set between two zones has rungs doctrine states as an OFFSET from
   * a zone, not as a zone. Without this a five-zone ladder could only ever
   * express five reps, and every longer set collapsed to one flat number.
   *
   * ADDITIVE, and cheaply so. Only `+N` is read, never `-N`: a minus is
   * already the band separator in a zone clause ("T-10K"), and admitting it
   * here would make "MP-10" ambiguous between an offset and a band. Doctrine
   * only needs the slow side — every cutdown opens slower than its first zone
   * and finishes ON its last one — so the ambiguous half is not needed.
   *
   * It resolves to a NUMBER before the spec: `segmentSpec` adds it to the
   * zone's own pace and writes the result into `SpecStep.pace_s_per_mi`, which
   * is an existing field with existing consumers. No new wire key, no watch
   * change, and a build that has never heard of an offset still receives the
   * flat phase list it always received (`expandSpecToPhases`).
   *
   * 0 on every step that declares none, which is every step the engine wrote
   * before this landed.
   */
  zoneOffsetSPerMi: number;
  /** Jog recovery AFTER this step, seconds. 0 for continuous work. */
  restS: number;
}

// The zone clause admits `+` so a step can name a doctrine offset ("MP+10").
// See `ParsedSegment.zoneOffsetSPerMi` for why only the plus side is read.
const STEP_RE = /^(\d+(?:\.\d+)?)\s*(mi|km|m|min|s)(?:\s*@\s*([A-Za-z0-9/\-+ ]+?))?$/;

/** `"MP+10"` → zone clause `"MP"` and +10 s/mi. `"T-10K"` → itself and 0. */
function splitZoneOffset(clause: string): { zoneText: string; offsetSPerMi: number } {
  const m = clause.match(/^(.+?)\s*\+\s*(\d{1,3})$/);
  if (!m) return { zoneText: clause, offsetSPerMi: 0 };
  return { zoneText: m[1].trim(), offsetSPerMi: Number(m[2]) };
}

/** Split on a separator that is not inside parentheses. */
function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0 && s.startsWith(sep, i)) {
      out.push(s.slice(start, i));
      i += sep.length - 1;
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out.map((x) => x.trim()).filter((x) => x.length > 0);
}

/** `"400m @ mile · 90s jog"` → one step. Null when the text is not a step. */
function parseStep(text: string): ParsedSegment | null {
  const parts = splitTopLevel(text, '·');
  if (parts.length === 0 || parts.length > 2) return null;
  const m = parts[0].trim().match(STEP_RE);
  if (!m) return null;
  const value = parseFloat(m[1]);
  const unit = m[2] as SegmentUnit;
  if (!Number.isFinite(value) || value <= 0) return null;
  const split = m[3] ? splitZoneOffset(m[3]) : null;
  const zones = split ? zonesInClause(split.zoneText) : [];
  // A zone clause that names no zone at all is junk, not an empty zone.
  if (m[3] && zones.length === 0) return null;
  // An offset with no zone to offset FROM is junk for the same reason.
  if (split && split.offsetSPerMi > 0 && zones.length === 0) return null;
  let restS = 0;
  if (parts.length === 2) {
    const r = parseRest(parts[1]);
    if (r == null) return null;
    restS = r;
  }
  return {
    value, unit, zone: zones.length ? zones[0] : null,
    zoneOffsetSPerMi: split?.offsetSPerMi ?? 0,
    restS,
  };
}

export function parseSegments(s: string | null | undefined): ParsedSegment[] | null {
  if (!s || typeof s !== 'string') return null;
  const text = String(s).trim();
  if (!/\s\+\s/.test(text) && !/[×xX]\s*\(/.test(text)) return null;

  const out: ParsedSegment[] = [];
  for (const item of splitTopLevel(text, ' + ')) {
    const rep = item.match(/^(\d+)\s*[×xX]\s*/);
    const repeat = rep ? parseInt(rep[1], 10) : 1;
    // Bounded so a malformed string cannot ask for an unbounded expansion. The
    // largest rep band anywhere in Research/04 is §7.5's "8–16".
    if (!Number.isFinite(repeat) || repeat <= 0 || repeat > 32) return null;
    const body = (rep ? item.slice(rep[0].length) : item).trim();

    if (body.startsWith('(')) {
      const close = body.lastIndexOf(')');
      if (close < 0) return null;
      const tail = body.slice(close + 1).trim().replace(/^[·•]\s*/, '');
      let groupRest = 0;
      if (tail) {
        const r = parseRest(tail);
        if (r == null) return null;
        groupRest = r;
      }
      const steps: ParsedSegment[] = [];
      for (const st of splitTopLevel(body.slice(1, close), ' + ')) {
        const parsed = parseStep(st);
        if (!parsed) return null;
        steps.push(parsed);
      }
      if (steps.length === 0) return null;
      for (let i = 0; i < repeat; i++) {
        steps.forEach((step, j) => {
          out.push({
            ...step,
            restS: j === steps.length - 1 ? Math.max(step.restS, groupRest) : step.restS,
          });
        });
      }
      continue;
    }

    const step = parseStep(body);
    if (!step) return null;
    for (let i = 0; i < repeat; i++) out.push({ ...step });
  }

  if (out.length < 2) return null;
  // The last step of a session has nothing to recover into. `expandSpecToPhases`
  // drops the trailing recovery of a uniform rep set for the same reason; saying
  // it here means every consumer of the segment list agrees without knowing to.
  out[out.length - 1] = { ...out[out.length - 1], restS: 0 };
  return out;
}

/**
 * GRAMMAR-SEQ-1 · take ONE step off the end of a segment prescription, or null
 * when there is nothing left to take.
 *
 * The give-back lever for an unequal-step session. A rep set sheds reps by
 * rewriting its leading count, and a sequence has no leading count to rewrite —
 * so it sheds its LAST step, which is the honest end to cut from: §13.1 says
 * the ascending ladder's closing rung is what "tests stamina" and the
 * descending ladder is "front-loaded", so in both cases the opening rungs are
 * the session's identity and the tail is the part a smaller week cannot buy.
 *
 * A repeated item loses one repeat rather than the whole group, so
 * "6×(1mi @ MP + 1mi @ 10K)" gives back one cycle at a time instead of six.
 *
 * Never cuts below two items: one item is not a sequence, and a one-item string
 * stops parsing as one — which would hand the whole session back to the uniform
 * parsers and change what the watch runs.
 */
export function dropLastSegment(s: string | null | undefined): string | null {
  if (!s || typeof s !== 'string') return null;
  const items = splitTopLevel(String(s).trim(), ' + ');
  // A single REPEATED group is still a sequence — "6×(1mi @ MP + 1mi @ 10K)" is
  // twelve steps — and it sheds a whole cycle at a time.
  if (items.length === 0) return null;
  if (items.length === 1 && !/^\d+\s*[×xX]\s*\(/.test(items[0])) return null;
  const last = items[items.length - 1];
  const rep = last.match(/^(\d+)(\s*[×xX]\s*)/);
  if (rep) {
    const n = parseInt(rep[1], 10);
    if (n > 2) {
      items[items.length - 1] = `${n - 1}${rep[2]}${last.slice(rep[0].length)}`;
      return items.join(' + ');
    }
    if (n === 2) {
      items[items.length - 1] = last.slice(rep[0].length);
      return items.join(' + ');
    }
    // n === 1 · a "1×" prefix is not a repeat; fall through to dropping the item.
  }
  if (items.length <= 2) return null;
  items.pop();
  return items.join(' + ');
}

/**
 * SLOT-ROTATE-4 (2026-08-19) · the last rung, when two still will not fit.
 *
 * `dropLastSegment` stops at two items on purpose: below that there is no
 * sequence left to shed from, and a one-step "ladder" is not §13's session. But
 * "there is nothing left to shed" and "the week can afford what remains" are
 * different statements, and `applyDosingCaps` was treating the first as if it
 * implied the second — so a two-rung remainder that still breached Daniels'
 * share shipped as the plan's final answer.
 *
 * It is reachable because a sequence is priced at SELECTION against the volume
 * curve's budget and realized against what the week actually composes to; the
 * two diverge most on low-frequency weeks, which is the same divergence
 * `dropLastSegment`'s own comment records. §13.1's 1600-1200-800-400 on a
 * 19.5 mi week came out 1.74 mi at I against a 1.56 cap, with the shedder out
 * of moves at two rungs.
 *
 * The collapse to ONE is the shape `sizeFromPrescription` already documents for
 * a rep set that cannot be afforded — "when two still overshoot, the set
 * collapses to one" — and the first item is what repeated shedding from the end
 * converges on. The result is no longer a ladder and does not pretend to be: it
 * is one rung at its stated length, which is a workout the runner can do and
 * the spec builder can build, where the alternative is a labelled breach.
 *
 * Returns null when there is no single leading step to keep, or when the string
 * is already one step.
 */
export function keepFirstSegment(s: string | null | undefined): string | null {
  if (!s || typeof s !== 'string') return null;
  const items = splitTopLevel(String(s).trim(), ' + ');
  if (items.length < 2) return null;
  const first = items[0].trim();
  if (!first) return null;
  // A leading "N×(...)" group is a repeated cycle, not a step; one cycle of it
  // is still a multi-step sequence and shedding it is `dropLastSegment`'s job.
  if (/^\d+\s*[×xX]\s*\(/.test(first)) return null;
  // `parseSegments` reads a bare step, and `parsePrescription` / `parseTimeReps`
  // read a counted set. Emitting the count makes the survivor readable by the
  // rep-set parsers the spec builder reaches for first.
  return /^\d+\s*[×xX]/.test(first) ? first : `1×${first}`;
}

/** A segment's length in miles, given the work pace time-based steps need. */
export function segmentMi(seg: ParsedSegment, paceSPerMi: number | null): number | null {
  switch (seg.unit) {
    case 'mi': return seg.value;
    case 'km': return (seg.value * 1000) / 1609.344;
    case 'm': return seg.value / 1609.344;
    case 'min': return paceSPerMi && paceSPerMi > 0 ? (seg.value * 60) / paceSPerMi : null;
    case 's': return paceSPerMi && paceSPerMi > 0 ? seg.value / paceSPerMi : null;
    default: return null;
  }
}
