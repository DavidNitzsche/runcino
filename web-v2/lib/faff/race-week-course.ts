/**
 * lib/faff/race-week-course.ts · real per-race data for the redesigned
 * Race Week screen (components/redesign/race-week/RaceWeekClient.tsx) that
 * isn't already on the seed: registration/bib/gun-time admin state, and the
 * course elevation profile.
 *
 * Not folded into components/faff-app/seed.ts — that file already resolves
 * a course-elevation chunk for `goalRace.courseImpactSec` (seed.ts ~2503),
 * but only keeps the scalar seconds-impact, not the raw trackpoint series a
 * sparkline needs, and seed.ts is a large, heavily-shared file this task
 * has no reason to touch. Same "reproduce narrowly, don't edit the shared
 * file" call BlockClient.tsx already made for TrainView.tsx's phase-group
 * helpers.
 *
 * Every field here reuses an existing resolver rather than re-deriving the
 * logic:
 *   · registeredFromMeta — lib/race/race-detail-pacing.ts (also used by
 *     components/faff-app/raceDetail.ts, the parallel Race Detail port's
 *     data source). Honesty-gated: boolean | null, no default-true.
 *   · resolveCourseElevation — lib/race/course-elevation.ts, the ONE
 *     trust-gated elevation resolver (measured geometry beats typed
 *     course_library scalars) already used by seed.ts's courseImpactSec
 *     chunk. Reused verbatim rather than re-implementing the precedence.
 *   · the gun-time COALESCE (meta.startTime / meta.gun_time /
 *     meta.start_time) mirrors the identical chain
 *     lib/coach/readiness-brief.ts's raceGunTimeMissing check (~line 519)
 *     and seed.ts's own race-week-card fetch (~line 2465) already use.
 *
 * The one genuinely new piece is `elevationPoints()`: a plain feet-per-
 * sample array for ElevationProfile's `points` prop. raceDetail.ts already
 * extracts the same trackpoint elevations for its `elevPath` SVG string
 * (elevPathFromGeometry), but returns a pre-rendered path, not raw numbers
 * — so this file does the same extraction, output as numbers instead of an
 * SVG path.
 */

import { pool } from '@/lib/db/pool';
import { userIdFromCookies } from '@/lib/auth/session';
import { registeredFromMeta } from '@/lib/race/race-detail-pacing';
import { resolveCourseElevation, type StoredGeometry } from '@/lib/race/course-elevation';

export interface RaceWeekCourse {
  /** null = the runner never recorded either way (registeredFromMeta's
   *  honest unknown state) — the admin checklist must render this as
   *  "not recorded", never as an implied false. */
  registered: boolean | null;
  bib: string | null;
  gunTimeSet: boolean;
  courseSource: 'editorial' | 'crowd' | 'stub' | null;
  netElevFt: number | null;
  gainFt: number | null;
  /** Real elevation samples in feet, downsampled to ~36 points for the
   *  ElevationProfile sparkline. Null when no usable GPS track is on file
   *  for this race — the honest state per CLAUDE.md's design-source
   *  doctrine, never a fabricated flat line. */
  points: number[] | null;
}

const MAX_POINTS = 36;
const M_TO_FT = 3.28084;

export async function loadRaceWeekCourse(
  slug: string,
  distanceMi: number | null,
): Promise<RaceWeekCourse | null> {
  try {
    const userId = await userIdFromCookies();
    if (!userId) return null;

    const [raceRes, libRes] = await Promise.all([
      pool.query<{ course_geometry: StoredGeometry | null; meta: Record<string, unknown> | null }>(
        `SELECT course_geometry, meta FROM races WHERE slug = $1 AND user_uuid = $2 LIMIT 1`,
        [slug, userId],
      ).catch(() => ({ rows: [] as Array<{ course_geometry: StoredGeometry | null; meta: Record<string, unknown> | null }> })),
      pool.query<{ source: string | null; elevation_gain_ft: number | null; net_elevation_ft: number | null }>(
        `SELECT source, elevation_gain_ft, net_elevation_ft FROM course_library WHERE slug = $1`,
        [slug],
      ).catch(() => ({ rows: [] as Array<{ source: string | null; elevation_gain_ft: number | null; net_elevation_ft: number | null }> })),
    ]);

    const raceRow = raceRes.rows[0] ?? null;
    const libRow = libRes.rows[0] ?? null;
    const meta = (raceRow?.meta ?? {}) as Record<string, unknown>;
    const geom = raceRow?.course_geometry ?? null;

    const gunTimeRaw = meta['startTime'] ?? meta['gun_time'] ?? meta['start_time'] ?? null;
    const bibRaw = typeof meta['bib'] === 'string' ? (meta['bib'] as string) : null;

    const resolvedElev = resolveCourseElevation({
      lib: libRow,
      geometry: geom,
      nominalDistanceMi: distanceMi,
    });

    return {
      registered: registeredFromMeta(meta),
      bib: bibRaw && bibRaw.trim() !== '' ? bibRaw : null,
      gunTimeSet: typeof gunTimeRaw === 'string' && gunTimeRaw.trim() !== '',
      // 2026-08-21 · race-data re-audit · this reported the LIBRARY row's
      // label over numbers that came from the GPS track, so a measured
      // elevation rendered on the race-week card as `editorial` — a
      // provenance claim about a value that source never supplied. Measured
      // reads as 'crowd' (measured, not editorially verified), the same
      // convention the projection route and the web seed already use.
      courseSource: resolvedElev.provenance === 'measured'
        ? 'crowd'
        : ((libRow?.source as RaceWeekCourse['courseSource']) ?? null),
      netElevFt: resolvedElev.netElevationFt,
      gainFt: resolvedElev.elevationGainFt,
      points: elevationPoints(geom),
    };
  } catch {
    return null;
  }
}

/** Real elevation samples (feet), downsampled for the sparkline. Mirrors
 *  the extraction components/faff-app/raceDetail.ts#elevPathFromGeometry
 *  already does for its SVG path — same source data (races.course_geometry
 *  .trackPoints[].ele, metres), plain numbers instead of a rendered path so
 *  it can feed ElevationProfile's `points` prop directly. */
function elevationPoints(geom: StoredGeometry | null): number[] | null {
  const tp = (geom as { trackPoints?: unknown } | null)?.trackPoints;
  if (!Array.isArray(tp) || tp.length < 2) return null;
  const eles = (tp as Array<{ ele?: unknown }>)
    .map((p) => (typeof p?.ele === 'number' ? p.ele : null))
    .filter((v): v is number => v != null && isFinite(v))
    .map((m) => m * M_TO_FT);
  if (eles.length < 2) return null;
  const step = Math.max(1, Math.floor(eles.length / MAX_POINTS));
  const out: number[] = [];
  for (let i = 0; i < eles.length; i += step) out.push(Math.round(eles[i]));
  const last = Math.round(eles[eles.length - 1]);
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}
