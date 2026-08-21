/**
 * lib/race/course-elevation.ts · Course elevation, derived and trusted.
 *
 * ── Why this file exists ─────────────────────────────────────────────────
 *
 * Before it, `course_library.elevation_gain_ft` and `.net_elevation_ft` were
 * hand-typed scalars. Migration 130 entered four rows off race-website
 * profiles, and nothing else ever wrote `net_elevation_ft` — not the GPX
 * importer, not the promote-from-race path, not the cron. Two of the four
 * were wrong, in ways nothing could catch:
 *
 *   americas-finest-city   stored net 0, gross 210 ft
 *                          real GPX (5790 pts): net −130 ft, gross 722 ft
 *   big-sur-marathon       stored net +260 ft
 *                          published profile and the runner's own watch: ~−346
 *
 * The read path made it permanent: it consulted geometry only when the
 * library row was labelled `stub`, so an `editorial` label on the worse data
 * locked out the better data sitting next to it.
 *
 * ── The doctrine this implements ─────────────────────────────────────────
 *
 * The bug was not really about elevation. It was about source of truth: the
 * system held an asserted claim and a measurement, had no confidence model
 * for either, and set precedence by RECORD TYPE rather than DATA QUALITY.
 *
 * So the rule is not "GPS always wins", and it is certainly not "editorial
 * always wins". It is:
 *
 *   trusted_geometry  >  trusted_curated_data  >  unknown
 *
 * The load-bearing word is *trusted*. A runner's watch trace can be wrong —
 * positioning error, barometric drift, a late start, a tunnel, a dropout —
 * so a measurement has to earn authority before it takes it. That is what
 * `assessGeometryConfidence` is for.
 *
 * Three further rules this module holds to:
 *
 *   · UNKNOWN IS NEVER ZERO. `net = 0` asserts that start and finish are
 *     level; `gain = 0` asserts a measured flat course. Neither may ever
 *     stand in for "we have no data". Absence returns null and provenance
 *     'unknown'.
 *
 *   · NET COMES FROM ENDPOINTS, GROSS FROM THE FILTERED PROFILE. Gain and
 *     loss need a noise filter; net must not depend on one. Deriving net as
 *     filtered-gain minus filtered-loss would let a threshold turn a downhill
 *     course level. For a continuous route gain − loss ≡ finish − start
 *     anyway — algebra, not approximation, and it holds on the real AFC track
 *     to 7e-12 ft.
 *
 *   · CONFLICT SURVIVES RESOLUTION. When the curated and measured figures
 *     disagree materially, picking a winner must not erase the fact that they
 *     disagreed. `conflict` is returned alongside the resolved value so a
 *     data-quality pass can flag it and a human can look.
 */

/** Feet per metre. */
const FT_PER_M = 3.28084;

/**
 * Metres of elevation change to clear before a climb or descent counts as
 * real rather than sensor noise.
 *
 * PROVISIONAL. This was tuned so one course (AFC: 722 ft here) matched one
 * external system (Strava: 724 ft). That is a single point of agreement with
 * a model that is itself an estimate, not a ground-truth elevation standard —
 * it is not calibration. Before this number is treated as settled it needs a
 * corpus: flat road, rolling, sustained climb, sustained descent, mountain,
 * barometric watch, GPS-only watch, and several runners over one known route.
 * The test that matters is stability across repeated measurements of the same
 * route, not agreement with any one vendor.
 */
export const NOISE_THRESHOLD_M = 1.6;

/**
 * Version tag for the gross-elevation algorithm. Stored alongside derived
 * values so a future recalibration can find and replay everything computed
 * under the old filter.
 */
export const ELEVATION_ALGORITHM_VERSION = 'elevation_hysteresis_v1';

export interface ElevationProfile {
  /** Gross climbed feet, noise-thresholded. */
  gainFt: number;
  /** Gross descended feet, noise-thresholded. Positive number. */
  lossFt: number;
  /** Signed net change in feet (finish − start). Negative = net drop. */
  netFt: number;
}

/**
 * Derive gross gain, gross loss, and net from a sequence of metre elevations.
 *
 * Gain and loss use hysteresis against a moving reference: a move only counts
 * once it clears the threshold, and the reference resets on any move the other
 * way. Net ignores the threshold entirely and reads the endpoints.
 *
 * Returns null for fewer than two usable samples — an empty or single-point
 * track has no profile, and zeroes would be a claim we cannot support.
 */
export function elevationProfileFt(
  eles: ReadonlyArray<number>,
  thresholdM = NOISE_THRESHOLD_M,
): ElevationProfile | null {
  const e = eles.filter((x) => typeof x === 'number' && isFinite(x));
  if (e.length < 2) return null;

  let gainM = 0;
  let lossM = 0;
  let upRef = e[0];
  let downRef = e[0];
  for (let i = 1; i < e.length; i++) {
    const up = e[i] - upRef;
    if (up >= thresholdM) { gainM += up; upRef = e[i]; }
    else if (up < 0) { upRef = e[i]; }

    const down = downRef - e[i];
    if (down >= thresholdM) { lossM += down; downRef = e[i]; }
    else if (down < 0) { downRef = e[i]; }
  }

  return {
    gainFt: Math.round(gainM * FT_PER_M),
    lossFt: Math.round(lossM * FT_PER_M),
    // Exact, threshold-free: gain − loss ≡ finish − start for any route.
    netFt: Math.round((e[e.length - 1] - e[0]) * FT_PER_M),
  };
}

/** The stored shape of `races.course_geometry` / `course_library.geometry_json`. */
export interface StoredGeometry {
  trackPoints?: unknown;
  elevation_gain_ft?: unknown;
  net_elevation_ft?: unknown;
}

interface TrackPoint { lat: number; lon: number; ele: number | null }

/**
 * Read the stored points without discarding any.
 *
 * Deliberately does NOT require lat/lon: the elevation profile needs only the
 * `ele` series, and dropping points for missing coordinates would silently
 * shorten a profile — the same class of quiet data loss this module exists to
 * stop. Coordinates are filtered where they are actually needed, in the
 * distance and gap checks.
 */
function readTrackPoints(geom: StoredGeometry | null | undefined): TrackPoint[] {
  const tp = geom?.trackPoints;
  if (!Array.isArray(tp)) return [];
  return tp.map((p) => {
    const r = p as { lat?: unknown; lon?: unknown; ele?: unknown };
    const ele = r?.ele == null ? null : Number(r.ele);
    return {
      lat: Number(r?.lat),
      lon: Number(r?.lon),
      ele: ele != null && isFinite(ele) ? ele : null,
    };
  });
}

/** Points carrying usable coordinates — the only ones distance can use. */
const withCoords = (pts: TrackPoint[]) => pts.filter((p) => isFinite(p.lat) && isFinite(p.lon));

/** Largest absolute step between consecutive elevation samples, metres. */
function maxAbsStep(pts: TrackPoint[]): number {
  let max = 0;
  for (let i = 1; i < pts.length; i++) {
    const j = Math.abs((pts[i].ele as number) - (pts[i - 1].ele as number));
    if (j > max) max = j;
  }
  return max;
}

function haversineM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Derive the profile from a stored geometry blob, tolerating the several
 * shapes the column has held. Returns null when the blob carries no usable
 * track — editorial rows hold curated phases and an empty `trackPoints`, and
 * must fall through to their typed scalars rather than read as a flat course.
 */
export function elevationProfileFromGeometry(
  geom: StoredGeometry | null | undefined,
  thresholdM = NOISE_THRESHOLD_M,
): ElevationProfile | null {
  const eles = readTrackPoints(geom).map((p) => p.ele).filter((e): e is number => e != null);
  return elevationProfileFt(eles, thresholdM);
}

// ── Geometry confidence ───────────────────────────────────────────────────

export type GeometryConfidence = 'high' | 'medium' | 'low' | 'reject';

export interface GeometryAssessment {
  confidence: GeometryConfidence;
  /** Plain-language reasons, for the data-quality surface and for humans. */
  reasons: string[];
  /** Route length measured from the track itself, miles. Null if unusable. */
  measuredDistanceMi: number | null;
  /** Fraction of nominal distance the track covers. Null if nominal unknown. */
  distanceRatio: number | null;
  /** Elevation samples per mile. */
  pointsPerMi: number | null;
  /** Largest gap between consecutive points, metres. */
  maxGapM: number | null;
  /** Largest single-sample elevation jump, metres. */
  maxElevJumpM: number | null;
}

/** A track shorter than this fraction of nominal is not the course. */
const DISTANCE_MIN_RATIO = 0.95;
/** …and one this much longer has wandered or double-recorded. */
const DISTANCE_MAX_RATIO = 1.08;
/** Below this sampling density the profile is too coarse to trust for gross gain. */
const MIN_POINTS_PER_MI = 20;
/** A jump this large between consecutive samples is a dropout, not a route. */
const MAX_GAP_M = 400;
/** No runner gains this much between two consecutive samples; it is corrupt. */
const MAX_ELEV_JUMP_M = 60;

/**
 * Judge whether a GPS track is good enough to define a course.
 *
 * The unconditional rule this replaces — "two elevation points and geometry
 * wins" — was too weak to be safe. A watch trace is not the official course:
 * runners weave, GPS drifts, barometric altimeters mis-read in weather, and
 * someone may start their watch late or lose signal in a tunnel. A single bad
 * trace should not be able to redefine a course for every future runner.
 *
 * `nominalDistanceMi` is the course's declared distance. Without it the
 * distance check cannot run, which caps confidence at medium — we can still
 * see that a track is dense and clean, but not that it covers the right route.
 */
export function assessGeometryConfidence(
  geom: StoredGeometry | null | undefined,
  opts: { nominalDistanceMi?: number | null } = {},
): GeometryAssessment {
  const pts = readTrackPoints(geom);
  const withEle = pts.filter((p) => p.ele != null);
  const base: GeometryAssessment = {
    confidence: 'reject',
    reasons: [],
    measuredDistanceMi: null,
    distanceRatio: null,
    pointsPerMi: null,
    maxGapM: null,
    maxElevJumpM: null,
  };

  if (pts.length < 2) return { ...base, reasons: ['no track points'] };
  if (withEle.length < 2) return { ...base, reasons: ['track carries no elevation samples'] };

  const geo = withCoords(pts);
  if (geo.length < 2) {
    // No coordinates means the route cannot be checked against the course at
    // all. The elevation series may still be usable, but it has not earned
    // authority over a curated value.
    return {
      ...base, confidence: 'low',
      reasons: ['track carries no coordinates — route cannot be verified'],
      pointsPerMi: null, maxGapM: null,
      maxElevJumpM: maxAbsStep(withEle),
    };
  }

  let meters = 0;
  let maxGapM = 0;
  for (let i = 1; i < geo.length; i++) {
    const d = haversineM(geo[i - 1], geo[i]);
    meters += d;
    if (d > maxGapM) maxGapM = d;
  }
  const measuredDistanceMi = meters / 1609.344;

  const maxElevJumpM = maxAbsStep(withEle);

  const pointsPerMi = measuredDistanceMi > 0 ? withEle.length / measuredDistanceMi : null;
  const nominal = opts.nominalDistanceMi != null && isFinite(Number(opts.nominalDistanceMi)) && Number(opts.nominalDistanceMi) > 0
    ? Number(opts.nominalDistanceMi) : null;
  const distanceRatio = nominal ? measuredDistanceMi / nominal : null;

  const out: GeometryAssessment = {
    ...base, measuredDistanceMi, distanceRatio, pointsPerMi, maxGapM, maxElevJumpM,
  };
  const reasons: string[] = [];

  // ── Disqualifying checks · these mean "this is not the course" ──────────
  if (measuredDistanceMi <= 0) return { ...out, confidence: 'reject', reasons: ['zero-length track'] };
  if (distanceRatio != null && distanceRatio < DISTANCE_MIN_RATIO) {
    return {
      ...out, confidence: 'reject',
      reasons: [`track covers ${(distanceRatio * 100).toFixed(0)}% of the nominal distance — short of the course`],
    };
  }
  if (distanceRatio != null && distanceRatio > DISTANCE_MAX_RATIO) {
    return {
      ...out, confidence: 'reject',
      reasons: [`track is ${(distanceRatio * 100).toFixed(0)}% of the nominal distance — longer than the course`],
    };
  }
  if (maxElevJumpM > MAX_ELEV_JUMP_M) {
    return {
      ...out, confidence: 'reject',
      reasons: [`${maxElevJumpM.toFixed(0)} m elevation jump between consecutive samples — corrupt altitude data`],
    };
  }

  // ── Degrading checks · usable, but not authoritative ────────────────────
  let confidence: GeometryConfidence = 'high';
  const degrade = (to: GeometryConfidence, why: string) => {
    reasons.push(why);
    if (to === 'low') confidence = 'low';
    else if (confidence === 'high') confidence = 'medium';
  };

  if (pointsPerMi != null && pointsPerMi < MIN_POINTS_PER_MI) {
    degrade('low', `only ${pointsPerMi.toFixed(0)} elevation samples per mile — too coarse for gross gain`);
  }
  if (maxGapM > MAX_GAP_M) {
    degrade('low', `${maxGapM.toFixed(0)} m gap between consecutive points — signal dropout`);
  }
  if (nominal == null) {
    degrade('medium', 'no nominal distance to check the route against');
  }
  if (withEle.length < pts.length) {
    degrade('medium', `${pts.length - withEle.length} of ${pts.length} points carry no elevation`);
  }

  if (reasons.length === 0) reasons.push('dense track, distance matches, no dropouts or altitude spikes');
  return { ...out, confidence, reasons };
}

// ── Resolution ────────────────────────────────────────────────────────────

export type CourseElevationProvenance = 'measured' | 'editorial' | 'unknown';

/** How far apart the two sources may drift before it is worth a human look. */
export const CONFLICT_GAIN_FT = 100;
export const CONFLICT_GAIN_RATIO = 0.25;
export const CONFLICT_NET_FT = 50;

export interface ElevationConflict {
  status: 'SOURCE_CONFLICT';
  curatedGainFt: number | null;
  measuredGainFt: number | null;
  curatedNetFt: number | null;
  measuredNetFt: number | null;
  detail: string;
}

export interface ResolvedCourseElevation {
  elevationGainFt: number | null;
  netElevationFt: number | null;
  lossFt: number | null;
  provenance: CourseElevationProvenance;
  /** Confidence in the value actually returned. */
  confidence: GeometryConfidence | 'unknown';
  /**
   * Set when curated and measured figures both existed and disagreed
   * materially. Populated even though one of them won — discarding the
   * disagreement is how a wrong number stays wrong.
   */
  conflict: ElevationConflict | null;
  /** Null when no track was present to assess. */
  geometry: GeometryAssessment | null;
  algorithmVersion: string;
}

/**
 * Is this resolved elevation trustworthy enough to MOVE A NUMBER?
 *
 * 2026-08-21 · race-data source-of-truth re-audit. `confidence` was computed,
 * returned, unit-tested — and read by nothing. Every consumer took
 * `elevationGainFt` bare.
 *
 * That was survivable while the resolver only handed out measured values it
 * trusted, but it does not: the `|| !hasCurated` arm of `resolveCourseElevation`
 * deliberately lets a LOW-confidence trace through when there is no curated
 * `course_library` row to fall back on — the common case for a race a runner
 * added themselves. "Low" is not a shade of doubt here, it is self-refuting:
 * `assessGeometryConfidence` degrades to it for "only N elevation samples per
 * mile — too coarse for gross gain" and "N m gap between consecutive points —
 * signal dropout". A number derived from a trace that says that about itself
 * should still be SHOWN (it beats nothing, which is why the resolver returns
 * it), but it must not silently become seconds in a projection or a detractor
 * that decides whether a race re-anchors fitness.
 *
 * So the precedence rule stays where it is and the gate lives here, at the
 * question consumers actually have. This is CLAUDE.md's per-finding context
 * filter rule: the resolver's precedence describes what the best available
 * value IS; each consumer still has to ask whether that value is good enough
 * for what IT does with it.
 *
 * Display paths (the race-detail elevation line, the course-changed footnote)
 * deliberately do NOT call this — they are reporting the measurement, not
 * arguing from it.
 */
export function elevationIsTrustedForAdjustment(
  resolved: Pick<ResolvedCourseElevation, 'confidence'>,
): boolean {
  return resolved.confidence === 'high' || resolved.confidence === 'medium';
}

export interface ResolveCourseElevationInput {
  lib?: {
    elevation_gain_ft?: number | string | null;
    net_elevation_ft?: number | string | null;
  } | null;
  /**
   * Geometry to measure from. Pass the per-race `races.course_geometry`
   * first — it is the only place a real GPS track reliably lives — falling
   * back to `course_library.geometry_json`.
   */
  geometry?: StoredGeometry | null;
  /** Declared course distance, for the geometry distance check. */
  nominalDistanceMi?: number | null;
  /**
   * How far the curated scalars are trusted. Editorial values known to be
   * contradicted by an outside source (Big Sur's +260 against a published
   * −346) should be passed 'low' so they never read as settled fact.
   */
  editorialConfidence?: 'medium' | 'low';
}

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
};

function detectConflict(
  curatedGain: number | null, curatedNet: number | null,
  measured: ElevationProfile,
): ElevationConflict | null {
  const parts: string[] = [];
  if (curatedGain != null) {
    const diff = Math.abs(measured.gainFt - curatedGain);
    if (diff > CONFLICT_GAIN_FT && diff / Math.max(1, curatedGain) > CONFLICT_GAIN_RATIO) {
      parts.push(`gross gain: curated ${curatedGain} ft vs measured ${measured.gainFt} ft`);
    }
  }
  if (curatedNet != null && Math.abs(measured.netFt - curatedNet) > CONFLICT_NET_FT) {
    parts.push(`net: curated ${curatedNet} ft vs measured ${measured.netFt} ft`);
  }
  if (parts.length === 0) return null;
  return {
    status: 'SOURCE_CONFLICT',
    curatedGainFt: curatedGain,
    measuredGainFt: measured.gainFt,
    curatedNetFt: curatedNet,
    measuredNetFt: measured.netFt,
    detail: parts.join('; '),
  };
}

/**
 * Resolve a course's elevation by trust, not by record type.
 *
 *   canonical certified geometry   (not modelled yet — see note below)
 *   > consensus of qualifying traces (not modelled yet)
 *   > one high/medium-confidence trace
 *   > trusted curated values
 *   > a low-confidence trace, if there is nothing curated
 *   > unknown
 *
 * Consensus and certified geometry are deliberately absent for now: at one
 * contributor per course there is nothing to reconcile. The shape here leaves
 * room for them — `assessGeometryConfidence` already scores a single trace, so
 * a later aggregate can score several and pick or blend among them, without
 * any consumer of this function changing.
 *
 * Editorial curation is untouched where it earns its keep: the phases, segment
 * notes, and start/finish labels in `geometry_json` are real work no GPS track
 * supplies. Only the two scalars a track can measure are subject to override.
 */
export function resolveCourseElevation(
  input: ResolveCourseElevationInput,
): ResolvedCourseElevation {
  const curatedGain = num(input.lib?.elevation_gain_ft);
  const curatedNet = num(input.lib?.net_elevation_ft);
  const hasCurated = curatedGain != null || curatedNet != null;
  const editorialConfidence = input.editorialConfidence ?? 'medium';

  const hasTrack = readTrackPoints(input.geometry).length >= 2;
  const assessment = hasTrack
    ? assessGeometryConfidence(input.geometry, { nominalDistanceMi: input.nominalDistanceMi })
    : null;
  const measured = assessment && assessment.confidence !== 'reject'
    ? elevationProfileFromGeometry(input.geometry)
    : null;

  const conflict = measured ? detectConflict(curatedGain, curatedNet, measured) : null;

  const curatedResult = (): ResolvedCourseElevation => ({
    elevationGainFt: curatedGain,
    netElevationFt: curatedNet,
    // Derivable only when both are known, and floored: a row whose curated
    // net exceeds its curated gross is malformed, not a negative descent.
    lossFt: curatedGain != null && curatedNet != null ? Math.max(0, curatedGain - curatedNet) : null,
    provenance: 'editorial',
    confidence: editorialConfidence,
    conflict,
    geometry: assessment,
    algorithmVersion: ELEVATION_ALGORITHM_VERSION,
  });

  if (measured && assessment) {
    const trackIsAuthoritative =
      assessment.confidence === 'high' || assessment.confidence === 'medium';
    // A low-confidence trace still beats nothing at all, but never beats a
    // curated value — one bad upload must not redefine the course.
    if (trackIsAuthoritative || !hasCurated) {
      return {
        elevationGainFt: measured.gainFt,
        netElevationFt: measured.netFt,
        lossFt: measured.lossFt,
        provenance: 'measured',
        confidence: assessment.confidence,
        conflict,
        geometry: assessment,
        algorithmVersion: ELEVATION_ALGORITHM_VERSION,
      };
    }
    return curatedResult();
  }

  if (hasCurated) return curatedResult();

  return {
    elevationGainFt: null,
    netElevationFt: null,
    lossFt: null,
    provenance: 'unknown',
    confidence: 'unknown',
    conflict,
    geometry: assessment,
    algorithmVersion: ELEVATION_ALGORITHM_VERSION,
  };
}
