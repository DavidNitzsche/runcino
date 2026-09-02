/**
 * lib/race/course-geometry-source.ts · the column that never learned to fill
 * itself.
 *
 * ── THE STATE THIS EXISTS TO END ─────────────────────────────────────────
 *
 * `races.course_geometry` is NULL on nine of the owner's eleven races. Six of
 * those nine carry a parseable GPX in `races.gpx_text` in the same row — Big
 * Sur, Sombrero, Dodgers, Run Malibu, CIM, and next year's LA Marathon,
 * between 35 KB and 3.5 MB each. Eleven modules read the column and see
 * nothing: `course-elevation.ts` resolves from it, `race-week-course.ts`
 * renders from it, `race-conditions.ts` takes the start coordinates out of its
 * bbox, `voice-band.ts` and `representativeness-inputs.ts` reason from it,
 * `promote-from-race.ts` promotes it into the shared library.
 *
 * ── WHY NOTHING EVER FILLED IT ───────────────────────────────────────────
 *
 * Not a broken writer. A MISSING one.
 *
 * `gpx_text` is the legacy column: `legacy/web/lib/race-store.ts` upserted the
 * raw file text there, in a schema that had no `course_geometry` at all.
 * `course_geometry` arrived with web-v2, and every writer of it takes a FRESH
 * user action as its input:
 *
 *   · `POST /api/race/gpx`            multipart file  → course_source 'upload'
 *   · `POST /api/race/strava-course`  a Strava route  → 'strava_route'
 *                                     (the only writer that also stores gpx_text)
 *   · `POST /api/gpx/import`          a Strava route or starred route
 *                                     → 'strava_match'
 *
 * Not one of them can take `gpx_text` as input. `/api/gpx/import` rejects any
 * `source` other than the two Strava ones before it reaches a parser.
 *
 * `/api/cron/promote-courses` looked like the backstop and is not: its scan is
 * `WHERE course_geometry IS NOT NULL`, so it is the L1 → L2 promoter and never
 * an L1 populator. Its own comment says it exists to catch "races whose
 * course_geometry was added by a backfill" — accurate, and empty, because no
 * backfill was ever written.
 *
 * So the gap is one sentence long: THERE IS NO WRITER WHOSE INPUT IS
 * `gpx_text`. This module is that writer's parser-and-judgement half.
 *
 * ── NO SECOND ELEVATION ENGINE ───────────────────────────────────────────
 *
 * Nothing here measures anything. `parseGPX` is the same parser the three
 * live importers call, so a row hydrated from `gpx_text` holds byte-identical
 * numbers to the same file uploaded through `/api/race/gpx`.
 * `assessGeometryConfidence` and `resolveCourseElevation` are the one
 * elevation authority (`4e7986ac`: elevation is MEASURED, not typed) and this
 * module only asks them questions.
 *
 * ── PROVENANCE · NO NEW TIER ─────────────────────────────────────────────
 *
 * A hydrated row stamps `course_source = 'upload'`, an existing value, and it
 * is the true one: the file IS the runner's own GPX, uploaded by them, sitting
 * in their own race row. Americas Finest City carries `'upload'` today from
 * exactly this class of file. What the backfill changes is WHEN the file was
 * parsed, not where it came from, and a parse date is not a trust tier.
 *
 * The trust question — is this good enough to move a number — is already
 * answered one layer down and stays there: `assessGeometryConfidence` scores
 * the track, `resolveCourseElevation` sets provenance `measured` or
 * `editorial`, `elevationIsTrustedForAdjustment` gates the consumers that
 * argue from it. Inventing a `course_source` tier here would put a second,
 * weaker copy of that ladder in a column nothing branches on.
 *
 * ── RULE 3 · A REFUSAL IS A CORRECT ANSWER ───────────────────────────────
 *
 * `assessGeometryConfidence` returning `reject` means "this track is not this
 * course" — short of the distance, longer than it, or carrying an altitude
 * spike no runner produces. Those rows are REPORTED with their reason and NOT
 * written. A stored track that misstates the course is worse than an empty
 * column, because the empty column is the one thing every consumer already
 * knows how to handle.
 */
import { parseGPX } from '@/lib/race/gpx-parser';
import {
  assessGeometryConfidence,
  resolveCourseElevation,
  elevationIsTrustedForAdjustment,
  type StoredGeometry,
  type GeometryAssessment,
  type ElevationConflict,
} from '@/lib/race/course-elevation';

/** The two columns any geometry reader needs off a `races` row. */
export interface RaceGeometryRow {
  course_geometry: StoredGeometry | null;
  gpx_text: string | null;
}

/** Where a resolved geometry actually came from. */
export type GeometryOrigin = 'course_geometry' | 'gpx_text' | 'none';

export interface RaceGeometrySource {
  geometry: StoredGeometry | null;
  origin: GeometryOrigin;
  /** Set only when `gpx_text` was present and did NOT parse. */
  parseError: string | null;
}

/** A stored blob counts as real geometry at the parser's own floor: 2 points. */
function storedPointCount(geom: StoredGeometry | null | undefined): number {
  const tp = (geom as { trackPoints?: unknown } | null | undefined)?.trackPoints;
  return Array.isArray(tp) ? tp.length : 0;
}

/**
 * Geometry for a race: the column when it is populated, the stored GPX when it
 * is not.
 *
 * This is the read-time fallback in one place. It is deliberately NOT wired
 * into the eleven consumers: parsing 3.5 MB of GPX on every page render to
 * work around an empty column is a worse answer than filling the column, and
 * once `planGeometryHydration`'s write has run the fallback never fires. It
 * exists so the backfill, the cron, and any consumer that genuinely cannot
 * wait for the column all read the same way.
 */
export function geometryFromRaceRow(row: RaceGeometryRow | null): RaceGeometrySource {
  if (storedPointCount(row?.course_geometry) >= 2) {
    return { geometry: row!.course_geometry, origin: 'course_geometry', parseError: null };
  }
  const gpx = row?.gpx_text ?? null;
  if (gpx && gpx.length > 0) {
    try {
      // The same parser `/api/race/gpx` runs, called the same way, with no
      // filename — so the derived blob equals the one an upload would store.
      return { geometry: parseGPX(gpx) as unknown as StoredGeometry, origin: 'gpx_text', parseError: null };
    } catch (e: unknown) {
      // A GPX that will not parse is not a flat course. Name the failure and
      // return nothing, so a caller cannot mistake it for an honest absence.
      return {
        geometry: null,
        origin: 'none',
        parseError: e instanceof Error ? e.message : String(e),
      };
    }
  }
  return { geometry: null, origin: 'none', parseError: null };
}

// ── The hydration plan · what a backfill WOULD write ──────────────────────

export type HydrationVerdict =
  /** Column empty, GPX parses, track passes the confidence gate → write. */
  | 'write'
  /** Column already holds a real track. Nothing to do. */
  | 'already_populated'
  /** No `gpx_text` to derive from. Nothing to do, and nothing to report. */
  | 'no_gpx'
  /** `gpx_text` present and the parser refused it. */
  | 'unparseable'
  /** Parsed, but the track is not this course. Reported, never written. */
  | 'refused';

export interface HydrationPlan {
  slug: string;
  verdict: HydrationVerdict;
  /** Plain-language why, in coach voice: short, no hedging. */
  reason: string;
  /** What `races.course_source` would be set to. Null unless verdict 'write'. */
  courseSource: 'upload' | null;
  gpxBytes: number;
  points: number | null;
  /** Distance measured off the track itself, miles. */
  measuredDistanceMi: number | null;
  /** The race's declared distance, from `races.meta.distanceMi`. */
  nominalDistanceMi: number | null;
  distanceRatio: number | null;
  /** MEASURED off the track. This is what the column would hold. */
  gainFt: number | null;
  lossFt: number | null;
  netFt: number | null;
  /**
   * Gross vertical per ten miles — the unit `Research/11`'s hill-volume
   * decision rule is written in.
   *
   * Divided by the NOMINAL distance, not the measured one, and that choice is
   * load-bearing. `lib/plan/course-profile.ts#courseShapeOf` divides by
   * nominal, and a course file that measures 25.56 mi against a 26.22 mi
   * marathon would otherwise make this module report 283 ft/10mi where the
   * plan engine reports 276 for the same track. Two figures for one course is
   * the defect, whichever is nicer.
   */
  vertPer10Mi: number | null;
  confidence: GeometryAssessment['confidence'] | 'unknown';
  confidenceReasons: string[];
  /**
   * Whether the MEASURED track is good enough to move a number.
   *
   * Separate from `resolved*` below on purpose. A low-confidence track that
   * loses to a curated value is still written — it is the runner's real course
   * line, and the map and the profile want it — but it must not be reported as
   * though storing it settled the elevation.
   */
  measuredTrusted: boolean;
  /**
   * What the eleven consumers would actually READ once this row is written:
   * `resolveCourseElevation` run over the new geometry against the curated
   * `course_library` scalars. Where this disagrees with `gainFt` / `netFt`,
   * the curated value won and the backfill did not change what anyone sees.
   */
  resolvedGainFt: number | null;
  resolvedNetFt: number | null;
  resolvedProvenance: 'measured' | 'editorial' | 'unknown';
  /** Populated when the curated `course_library` scalars disagree materially. */
  conflict: ElevationConflict | null;
}

export interface HydrationInput {
  slug: string;
  row: RaceGeometryRow | null;
  /** `races.meta.distanceMi`. Without it the distance check cannot run. */
  nominalDistanceMi: number | null;
  /** The curated `course_library` row, for conflict detection. */
  lib?: { elevation_gain_ft?: number | string | null; net_elevation_ft?: number | string | null } | null;
}

const EMPTY_PLAN = {
  courseSource: null,
  points: null,
  measuredDistanceMi: null,
  nominalDistanceMi: null,
  distanceRatio: null,
  gainFt: null,
  lossFt: null,
  netFt: null,
  vertPer10Mi: null,
  confidence: 'unknown' as const,
  confidenceReasons: [] as string[],
  measuredTrusted: false,
  resolvedGainFt: null,
  resolvedNetFt: null,
  resolvedProvenance: 'unknown' as const,
  conflict: null,
};

/**
 * Decide what a backfill would do to one race row, and show its working.
 *
 * Pure. No database, no clock, no writes. The dry run and the committed run
 * call this identically — the only difference downstream is whether the
 * resulting `write` verdicts are executed. That is what makes the dry run a
 * preview rather than a separate implementation that might disagree.
 */
export function planGeometryHydration(input: HydrationInput): HydrationPlan {
  const { slug, row, nominalDistanceMi } = input;
  const gpxBytes = row?.gpx_text?.length ?? 0;
  const base = { slug, ...EMPTY_PLAN, gpxBytes, nominalDistanceMi };

  if (storedPointCount(row?.course_geometry) >= 2) {
    return {
      ...base,
      verdict: 'already_populated',
      reason: `Column already holds ${storedPointCount(row?.course_geometry)} track points.`,
    };
  }
  if (gpxBytes === 0) {
    return { ...base, verdict: 'no_gpx', reason: 'No GPX on the row. Nothing to derive from.' };
  }

  const src = geometryFromRaceRow(row);
  if (src.parseError || !src.geometry) {
    return {
      ...base,
      verdict: 'unparseable',
      reason: `GPX did not parse: ${src.parseError ?? 'no track points'}.`,
    };
  }

  const geom = src.geometry as unknown as {
    trackPoints: unknown[];
    distance_mi: number;
    elevation_gain_ft: number;
    elevation_loss_ft: number | null;
    net_elevation_ft: number | null;
  };
  const assessment = assessGeometryConfidence(src.geometry, { nominalDistanceMi });
  const resolved = resolveCourseElevation({
    lib: input.lib ?? null,
    geometry: src.geometry,
    nominalDistanceMi,
  });

  const gainFt = geom.elevation_gain_ft ?? null;
  // Nominal first — see the field comment. Measured only when the race never
  // declared a distance, because a ratio against nothing is worse than a ratio
  // against the track.
  const per10Denominator = nominalDistanceMi != null && nominalDistanceMi > 0
    ? nominalDistanceMi
    : (geom.distance_mi > 0 ? geom.distance_mi : null);
  const vertPer10Mi = gainFt != null && per10Denominator != null
    ? Math.round((gainFt / per10Denominator) * 10)
    : null;

  const measured = {
    ...base,
    points: geom.trackPoints.length,
    measuredDistanceMi: assessment.measuredDistanceMi ?? geom.distance_mi,
    distanceRatio: assessment.distanceRatio,
    gainFt,
    lossFt: geom.elevation_loss_ft,
    netFt: geom.net_elevation_ft,
    vertPer10Mi,
    confidence: assessment.confidence,
    confidenceReasons: assessment.reasons,
    // The one definition of "good enough to move a number", asked of the
    // MEASURED track rather than of whatever the resolver ended up choosing.
    measuredTrusted: elevationIsTrustedForAdjustment({ confidence: assessment.confidence }),
    resolvedGainFt: resolved.elevationGainFt,
    resolvedNetFt: resolved.netElevationFt,
    resolvedProvenance: resolved.provenance,
    conflict: resolved.conflict,
  };

  if (assessment.confidence === 'reject') {
    return {
      ...measured,
      verdict: 'refused',
      reason: `Track is not this course: ${assessment.reasons.join('; ')}.`,
    };
  }

  // Say plainly when writing the row will not change what anyone reads. A
  // low-confidence track loses to a curated value by design, and a backfill
  // that quietly reports "written" for a course whose elevation is still the
  // old typed number is the report drifting from reality.
  const measuredLost = resolved.provenance !== 'measured';
  const tail = measuredLost
    ? ` Curated course_library value still wins · stored for the route line, not for the elevation.`
    : '';

  return {
    ...measured,
    verdict: 'write',
    courseSource: 'upload',
    reason: `${geom.trackPoints.length} points, ${assessment.confidence} confidence: ${assessment.reasons.join('; ')}.${tail}`,
  };
}
