/**
 * lib/plan/course-profile.ts · COURSE-PLAN-1 (2026-08-25)
 *
 * THE PLAN ENGINE HAS NEVER KNOWN WHAT THE COURSE LOOKS LIKE.
 *
 * Eleven modules elsewhere read a race's elevation — `lib/race/course-
 * elevation.ts` resolves it, `lib/faff/race-week-course.ts` renders it,
 * `lib/training/race-conditions.ts` and `lib/coach/voice-band.ts` reason from
 * it — and `lib/plan/` reads none of them. Every block this engine has ever
 * authored was composed for a flat course, for every runner.
 *
 * That is a general gap, and for one runner it is a named one.
 * `Research/08-pacing-and-race-week.md` §4.5 is titled "Net downhill courses
 * (Boston, Big Sur, CIM, Revel series)" and says of exactly that class:
 *
 *   "course-PR potential is real but only with quad-protective training
 *    (downhill long runs) and conservative early pacing. Expected gain vs.
 *    flat: 1-3% for trained downhill runners; 0% or negative for untrained."
 *
 * The owner's goal race is CIM. His race row holds a 10,050-point GPX
 * measuring 1,031 ft of gain against 1,335 ft of loss, and every long run in
 * his fourteen-week block reads "Conversational throughout."
 *
 * ── WHERE THE NUMBERS COME FROM ───────────────────────────────────────────
 *
 * Nowhere new. `resolveCourseElevation` is the one elevation authority in this
 * codebase (trust-gated since `4e7986ac`: elevation is MEASURED, not typed)
 * and this module calls it with the same three inputs every other consumer
 * passes — the curated `course_library` row, the stored geometry, the nominal
 * distance. There is no second elevation engine here and there must never be.
 *
 * ONE addition, and it is a read-path fallback rather than a derivation:
 * `races.course_geometry` is NULL on races whose GPX was uploaded before the
 * structured-geometry pipeline existed — the owner's CIM row among them, with
 * 793 KB of `gpx_text` sitting beside the empty column. `parseGPX` is the same
 * parser that populates the column; running it at read time gets the identical
 * shape without a production write. When the column is populated the fallback
 * never runs.
 *
 * ── RULE 1 ────────────────────────────────────────────────────────────────
 *
 * Elevation read off a GPS track is MEASURED and reads as measured. Nothing in
 * this module converts it into seconds. A grade-to-pace adjustment is a MODEL
 * (`Research/01` §course/weather gives one) and would have to carry the amber
 * `~` mark wherever it surfaced; the plan does not need one to do the thing
 * doctrine actually asks for, which is to put the runner on the right terrain.
 * What this module produces is a terrain instruction, not a time.
 */
import { pool } from '@/lib/db/pool';
import { rowOrNull } from '@/lib/db/read';
import { parseGPX } from '@/lib/race/gpx-parser';
import {
  resolveCourseElevation,
  elevationIsTrustedForAdjustment,
  type StoredGeometry,
  type CourseElevationProvenance,
  type GeometryConfidence,
} from '@/lib/race/course-elevation';

/**
 * The shape of a course, as the plan engine needs to know it.
 *
 * `rolling` and `climbing` are named so the type is honest about what it can
 * distinguish; only `net_downhill` currently changes a prescription, because
 * it is the only one `Research/` gives the plan engine a long-run instruction
 * for. The others exist so a reader can see that "not net-downhill" is a
 * finding and not a gap.
 */
export type CourseShape = 'net_downhill' | 'climbing' | 'rolling' | 'flat' | 'unknown';

export interface CourseTerrain {
  shape: CourseShape;
  /** Signed net change, feet. Negative = the course drops. */
  netFt: number | null;
  gainFt: number | null;
  lossFt: number | null;
  /** Gross vertical per ten miles · the unit `Research/11`'s hill-volume rule
   *  is written in. Null when gain is unknown. */
  vertPer10Mi: number | null;
  provenance: CourseElevationProvenance;
  confidence: GeometryConfidence | 'unknown';
  /** `elevationIsTrustedForAdjustment` — whether this may MOVE anything. */
  trusted: boolean;
  /** Where the geometry came from, for the audit trail. */
  geometrySource: 'course_geometry' | 'gpx_text' | 'none';
}

export const UNKNOWN_TERRAIN: CourseTerrain = {
  shape: 'unknown',
  netFt: null,
  gainFt: null,
  lossFt: null,
  vertPer10Mi: null,
  provenance: 'unknown',
  confidence: 'unknown',
  trusted: false,
  geometrySource: 'none',
};

/**
 * Net drop, in feet, at which a course is prepared for as net-downhill.
 *
 * CONVENTION, not doctrine, and deliberately marked as one. `Research/11`
 * §"Net-Downhill Races and Negative-Split Strategy" defines the class in words
 * — "point-to-point with substantial elevation loss" — and `Research/08` §4.5
 * defines it by naming four races. Neither states a number, so this one is
 * ours and it must not be cited as though it were theirs.
 *
 * A hundred feet is twice `CONFLICT_NET_FT`, the threshold at which
 * `course-elevation.ts` already says two net figures differ by more than
 * measurement noise. Erring low is the right direction here because of what
 * the trigger BUYS: a sentence of terrain guidance on the long runs. An
 * over-inclusive trigger costs a runner one instruction they did not need. An
 * under-inclusive one costs the quads doctrine says fail at mile 18.
 */
export const NET_DOWNHILL_NET_FT = -100;

/**
 * `Research/11` §"Decision Rule: Hill Training Volume" is written per ten
 * miles of race vert, so this is the unit the shape is judged in.
 *
 *   If race vert <500 ft per 10 mi:      1 hill workout / 2 weeks (maintenance)
 *   If race vert 500-1500 ft per 10 mi:  1 hill workout / week
 *   ...
 *
 * The engine does not yet DOSE hill work off this — the quality mix is the
 * workout catalogue's, not this module's — so the band is computed, carried,
 * and reported rather than acted on. Naming it here is what makes the gap
 * visible instead of absent.
 */
export const ROLLING_VERT_PER_10MI = 500;

/** Classify a resolved course. Pure. */
export function courseShapeOf(
  netFt: number | null,
  gainFt: number | null,
  lossFt: number | null,
  distanceMi: number | null,
): { shape: CourseShape; vertPer10Mi: number | null } {
  const vertPer10Mi = gainFt != null && distanceMi != null && distanceMi > 0
    ? Math.round((gainFt / distanceMi) * 10)
    : null;
  if (netFt == null) return { shape: 'unknown', vertPer10Mi };
  // Net first: a course can be BOTH rolling and net-downhill, and the
  // net-downhill preparation is the one doctrine gives the long run.
  if (netFt <= NET_DOWNHILL_NET_FT) return { shape: 'net_downhill', vertPer10Mi };
  if (gainFt != null && lossFt != null && netFt >= -NET_DOWNHILL_NET_FT) {
    return { shape: 'climbing', vertPer10Mi };
  }
  if (vertPer10Mi != null && vertPer10Mi >= ROLLING_VERT_PER_10MI) {
    return { shape: 'rolling', vertPer10Mi };
  }
  return { shape: 'flat', vertPer10Mi };
}

interface RaceCourseRow {
  course_geometry: StoredGeometry | null;
  gpx_text: string | null;
}

/**
 * Geometry for a race, from the column if it is populated and from the stored
 * GPX if it is not.
 *
 * Exported for the probe harnesses and for a future backfill that wants to
 * agree with what the plan engine already reads.
 */
export function geometryFromRow(
  row: RaceCourseRow | null,
): { geometry: StoredGeometry | null; source: CourseTerrain['geometrySource'] } {
  const stored = row?.course_geometry ?? null;
  const storedPoints = Array.isArray((stored as { trackPoints?: unknown } | null)?.trackPoints)
    ? ((stored as { trackPoints: unknown[] }).trackPoints).length
    : 0;
  if (storedPoints >= 2) return { geometry: stored, source: 'course_geometry' };
  const gpx = row?.gpx_text ?? null;
  if (gpx && gpx.length > 0) {
    try {
      // The same parser the importer runs. Its output IS the column's shape,
      // which is why this is a fallback and not a second implementation.
      return { geometry: parseGPX(gpx) as unknown as StoredGeometry, source: 'gpx_text' };
    } catch {
      // A GPX we cannot parse is not a flat course. Fall through to unknown.
    }
  }
  return { geometry: null, source: 'none' };
}

/**
 * Load one race's terrain for the plan engine.
 *
 * Never throws and never returns a guess: every failure path returns
 * `UNKNOWN_TERRAIN`, whose shape is `'unknown'` and whose numbers are null.
 * `Research/`-derived guidance keys on `net_downhill`, so an unknown course
 * composes exactly as it composed before this module existed.
 */
export async function loadRaceCourseTerrain(
  userId: string,
  raceSlug: string | null,
  nominalDistanceMi: number | null,
): Promise<CourseTerrain> {
  if (!raceSlug) return UNKNOWN_TERRAIN;
  try {
    // `rowOrNull`, not a bare `.catch(() => ({ rows: [] }))`. A failed read and
    // a course with no geometry both end up at `UNKNOWN_TERRAIN` here, and that
    // is exactly the confusion `lib/db/read.ts` exists to stop: one of them is
    // a fact about the race and the other is a bug in this query, and only the
    // second should be in the logs. Three states in, one state out, but the
    // failure says so on its way past.
    const [raceRow, libRow] = await Promise.all([
      rowOrNull<RaceCourseRow>(
        'course-profile/race-geometry',
        pool.query<RaceCourseRow>(
          `SELECT course_geometry, gpx_text FROM races WHERE slug = $1 AND user_uuid = $2 LIMIT 1`,
          [raceSlug, userId],
        ),
      ),
      rowOrNull<{ elevation_gain_ft: number | null; net_elevation_ft: number | null }>(
        'course-profile/course-library',
        pool.query<{ elevation_gain_ft: number | null; net_elevation_ft: number | null }>(
          `SELECT elevation_gain_ft, net_elevation_ft FROM course_library WHERE slug = $1`,
          [raceSlug],
        ),
      ),
    ]);
    // A failed geometry read is not a flat course. Refuse rather than compose
    // downhill guidance off a row nobody managed to fetch.
    if (raceRow === null) return UNKNOWN_TERRAIN;
    const { geometry, source } = geometryFromRow(raceRow ?? null);
    const resolved = resolveCourseElevation({
      lib: libRow ?? null,
      geometry,
      nominalDistanceMi,
    });
    const { shape, vertPer10Mi } = courseShapeOf(
      resolved.netElevationFt, resolved.elevationGainFt, resolved.lossFt, nominalDistanceMi,
    );
    return {
      shape,
      netFt: resolved.netElevationFt,
      gainFt: resolved.elevationGainFt,
      lossFt: resolved.lossFt,
      vertPer10Mi,
      provenance: resolved.provenance,
      confidence: resolved.confidence,
      trusted: elevationIsTrustedForAdjustment(resolved),
      geometrySource: resolved.provenance === 'measured' ? source : 'none',
    };
  } catch {
    return UNKNOWN_TERRAIN;
  }
}
