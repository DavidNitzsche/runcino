/**
 * promote-from-race.ts — L1 → L2 promotion.
 *
 * David's idea: "Users will be running races, and our access to GPX files
 * will grow. So once someone has a race with GPX we can take that data,
 * make it generic, and pull it into our app library."
 *
 * Each user's race (L1, per-user data on `races.course_geometry`) is
 * promoted into the shared `course_library` (L2) so the next runner with
 * the same race slug gets real geometry instead of a slug-only stub.
 *
 * Promotion rules
 * ---------------
 * Given an existing course_library row keyed by slug:
 *
 *   source='stub'         → UPGRADE to 'crowd-sourced'. Write the
 *                           genericized geometry, set
 *                           first_contributed_iso=NOW(),
 *                           contributor_count=1.
 *
 *   source='editorial'    → Editorial is canonical. Do NOT overwrite
 *                           geometry_json (the curated phases / facts
 *                           live there). Just bump contributor_count.
 *
 *   source='crowd-sourced'→ First-contributor-wins for v1. Don't try to
 *                           merge multiple users' GPX recordings. Bump
 *                           contributor_count, leave geometry alone.
 *
 * If no row exists for the slug, create one as crowd-sourced (the
 * helper does this for completeness, but in practice _seed_course_library
 * already created stub rows for every known slug).
 *
 * Idempotency
 * -----------
 * Marks `races.promoted_to_library_iso = NOW()` on first promotion. If
 * called again for the same race the function returns
 * { action: 'noop' } without touching course_library (so the
 * contributor_count doesn't double-count the same runner's race on
 * repeated cron runs).
 *
 * Genericization
 * --------------
 * The races.course_geometry blob is per-user — it can carry the
 * uploader's user_uuid, the date of the run, performance times, HR,
 * pace. Before lifting it into the shared library we strip every
 * per-user / per-run field. What we KEEP is the course shape itself.
 *
 * STRIPPED  (per-user fields, must not leak across runners):
 *   user_uuid, userId, owner, name (uploader name), email,
 *   date, startedAt, completedAt, finishedAt, recordedAt,
 *   movingTimeS, elapsedTimeS, finishS, finishTime,
 *   avgHr, maxHr, hrSamples, paceSamples, splits,
 *   runId, activityId, stravaId, garmin*, raceResult, actual_result
 *
 * KEPT (course-intrinsic, safe to share):
 *   trackPoints[]   — lat / lon / ele (the GPS line itself)
 *   bbox            — derived from trackPoints
 *   distance_mi     — course nominal distance
 *   elevation_gain_ft
 *   start_label, finish_label
 *   raw_filename    — only the filename, not a per-user path
 */

import { Pool } from 'pg';
import { pool as defaultPool } from '@/lib/db/pool';

export type PromoteAction = 'created' | 'upgraded' | 'incremented' | 'noop';

export interface PromoteResult {
  ok: boolean;
  slug: string;
  source: 'editorial' | 'crowd-sourced' | 'stub' | null;
  contributor_count: number;
  action: PromoteAction;
  reason?: string;
}

interface RaceRow {
  slug: string;
  user_uuid: string | null;
  course_geometry: any | null;
  course_source: string | null;
  promoted_to_library_iso: string | null;
  meta: Record<string, any> | null;
}

interface CourseRow {
  slug: string;
  source: 'editorial' | 'crowd-sourced' | 'stub' | null;
  contributor_count: number;
  geometry_json: any;
  distance_mi: string | number | null;
  elevation_gain_ft: number | null;
  start_label: string | null;
  finish_label: string | null;
  name: string | null;
}

/**
 * Strip per-user / per-run fields from a races.course_geometry blob so
 * it is safe to lift into the shared course_library.
 *
 * KEPT keys: trackPoints, bbox, distance_mi, elevation_gain_ft,
 *            start_label, finish_label, raw_filename.
 * Plus we tag source='crowd-sourced' so the library row knows it came
 * from a runner upload (not an editorial JSON).
 */
function genericize(raceGeometry: any): Record<string, any> {
  const g = raceGeometry ?? {};
  const trackPoints = Array.isArray(g.trackPoints)
    ? g.trackPoints
        .filter((p: any) => p && typeof p.lat === 'number' && typeof p.lon === 'number')
        .map((p: any) => ({
          lat: Number(p.lat),
          lon: Number(p.lon),
          ele: p.ele == null ? null : Number(p.ele),
        }))
    : [];
  const out: Record<string, any> = {
    source: 'crowd-sourced',
    trackPoints,
    distance_mi: typeof g.distance_mi === 'number' ? g.distance_mi : null,
    elevation_gain_ft:
      typeof g.elevation_gain_ft === 'number' ? g.elevation_gain_ft : null,
    bbox: g.bbox && typeof g.bbox === 'object'
      ? {
          minLat: Number(g.bbox.minLat),
          maxLat: Number(g.bbox.maxLat),
          minLon: Number(g.bbox.minLon),
          maxLon: Number(g.bbox.maxLon),
        }
      : null,
  };
  if (typeof g.start_label === 'string') out.start_label = g.start_label;
  if (typeof g.finish_label === 'string') out.finish_label = g.finish_label;
  // raw_filename is the filename only (no path); safe to keep for
  // debugging where the geometry came from.
  if (typeof g.raw_filename === 'string') {
    const fname = g.raw_filename.split('/').pop()?.split('\\').pop();
    if (fname) out.raw_filename = fname;
  }
  return out;
}

function hasRealTrackPoints(geometry: any): boolean {
  const tp = geometry?.trackPoints;
  if (!Array.isArray(tp)) return false;
  // Treat <2 points as "no track" — same threshold as the GPX parser.
  return tp.length >= 2;
}

export interface PromoteOpts {
  userUuid: string;
  raceId: string; // races.slug (the table's primary handle for a per-user race)
  pool?: Pool;
}

export async function promoteCourseFromRace(opts: PromoteOpts): Promise<PromoteResult> {
  const p: Pool = opts.pool ?? defaultPool;
  const { userUuid, raceId } = opts;

  if (!userUuid || !raceId) {
    return {
      ok: false, slug: raceId, source: null, contributor_count: 0,
      action: 'noop', reason: 'missing userUuid or raceId',
    };
  }

  // 1. Load the per-user race row.
  const raceRes = await p.query<RaceRow>(
    `SELECT slug, user_uuid, course_geometry, course_source,
            promoted_to_library_iso, meta
       FROM races
      WHERE slug = $1 AND user_uuid = $2
      LIMIT 1`,
    [raceId, userUuid],
  );
  const race = raceRes.rows[0];
  if (!race) {
    return {
      ok: false, slug: raceId, source: null, contributor_count: 0,
      action: 'noop', reason: 'race not found',
    };
  }

  // 2. Idempotency: if already promoted, noop. We deliberately don't
  // re-bump contributor_count — the same runner contributing the same
  // race twice on different cron passes shouldn't count twice.
  if (race.promoted_to_library_iso) {
    const lib = await p.query<CourseRow>(
      `SELECT slug, source, contributor_count FROM course_library WHERE slug = $1`,
      [raceId],
    );
    return {
      ok: true,
      slug: raceId,
      source: lib.rows[0]?.source ?? null,
      contributor_count: lib.rows[0]?.contributor_count ?? 0,
      action: 'noop',
      reason: 'already promoted',
    };
  }

  // 3. If the race has no real geometry, nothing to promote.
  if (!hasRealTrackPoints(race.course_geometry)) {
    return {
      ok: true, slug: raceId, source: null, contributor_count: 0,
      action: 'noop', reason: 'no real trackPoints on race',
    };
  }

  const generic = genericize(race.course_geometry);
  const meta = race.meta ?? {};
  const nameGuess =
    (typeof meta.name === 'string' && meta.name) ||
    raceId;
  const distGuess =
    (typeof meta.distanceMi === 'number' && meta.distanceMi) ||
    generic.distance_mi ||
    null;

  // 4. Look up the existing library row.
  const libRes = await p.query<CourseRow>(
    `SELECT slug, source, contributor_count, geometry_json, distance_mi,
            elevation_gain_ft, start_label, finish_label, name
       FROM course_library
      WHERE slug = $1
      LIMIT 1`,
    [raceId],
  );
  const lib = libRes.rows[0];

  // 5a. No row at all → create as crowd-sourced.
  if (!lib) {
    const insert = await p.query<CourseRow>(
      `INSERT INTO course_library (
         slug, name, distance_mi, geometry_json, elevation_gain_ft,
         start_label, finish_label, notes,
         source, contributor_count, first_contributed_iso, updated_ts
       ) VALUES (
         $1, $2, $3, $4::jsonb, $5,
         $6, $7, $8,
         'crowd-sourced', 1, NOW(), NOW()
       )
       ON CONFLICT (slug) DO NOTHING
       RETURNING slug, source, contributor_count`,
      [
        raceId,
        nameGuess,
        distGuess,
        JSON.stringify(generic),
        generic.elevation_gain_ft,
        generic.start_label ?? null,
        generic.finish_label ?? null,
        'Crowd-sourced from runner GPX upload.',
      ],
    );
    await p.query(
      `UPDATE races SET promoted_to_library_iso = NOW()
        WHERE slug = $1 AND user_uuid = $2`,
      [raceId, userUuid],
    );
    if (insert.rows[0]) {
      return {
        ok: true, slug: raceId, source: 'crowd-sourced',
        contributor_count: 1, action: 'created',
      };
    }
    // Conflict raced with another promotion — fall through to upgrade path.
  }

  // 5b. source='stub' → UPGRADE.
  if (lib && (lib.source === 'stub' || lib.source == null)) {
    const upd = await p.query<CourseRow>(
      `UPDATE course_library
          SET source = 'crowd-sourced',
              geometry_json = $2::jsonb,
              distance_mi = COALESCE(distance_mi, $3),
              elevation_gain_ft = COALESCE($4, elevation_gain_ft),
              start_label = COALESCE(start_label, $5),
              finish_label = COALESCE(finish_label, $6),
              name = COALESCE(NULLIF(name, ''), $7),
              first_contributed_iso = NOW(),
              contributor_count = 1,
              updated_ts = NOW()
        WHERE slug = $1
      RETURNING slug, source, contributor_count`,
      [
        raceId,
        JSON.stringify(generic),
        distGuess,
        generic.elevation_gain_ft,
        generic.start_label ?? null,
        generic.finish_label ?? null,
        nameGuess,
      ],
    );
    await p.query(
      `UPDATE races SET promoted_to_library_iso = NOW()
        WHERE slug = $1 AND user_uuid = $2`,
      [raceId, userUuid],
    );
    return {
      ok: true,
      slug: raceId,
      source: upd.rows[0]?.source ?? 'crowd-sourced',
      contributor_count: upd.rows[0]?.contributor_count ?? 1,
      action: 'upgraded',
    };
  }

  // 5c. source='editorial' → DO NOT overwrite geometry; bump counter only.
  if (lib && lib.source === 'editorial') {
    const upd = await p.query<CourseRow>(
      `UPDATE course_library
          SET contributor_count = contributor_count + 1,
              first_contributed_iso = COALESCE(first_contributed_iso, NOW()),
              updated_ts = NOW()
        WHERE slug = $1
      RETURNING slug, source, contributor_count`,
      [raceId],
    );
    await p.query(
      `UPDATE races SET promoted_to_library_iso = NOW()
        WHERE slug = $1 AND user_uuid = $2`,
      [raceId, userUuid],
    );
    return {
      ok: true,
      slug: raceId,
      source: 'editorial',
      contributor_count: upd.rows[0]?.contributor_count ?? 1,
      action: 'incremented',
    };
  }

  // 5d. source='crowd-sourced' → first-contributor-wins; bump counter
  // and mark the race as promoted, but do NOT overwrite geometry.
  if (lib && lib.source === 'crowd-sourced') {
    const upd = await p.query<CourseRow>(
      `UPDATE course_library
          SET contributor_count = contributor_count + 1,
              updated_ts = NOW()
        WHERE slug = $1
      RETURNING slug, source, contributor_count`,
      [raceId],
    );
    await p.query(
      `UPDATE races SET promoted_to_library_iso = NOW()
        WHERE slug = $1 AND user_uuid = $2`,
      [raceId, userUuid],
    );
    return {
      ok: true,
      slug: raceId,
      source: 'crowd-sourced',
      contributor_count: upd.rows[0]?.contributor_count ?? 1,
      action: 'incremented',
    };
  }

  // Shouldn't reach here — defensive default.
  return {
    ok: false, slug: raceId, source: lib?.source ?? null,
    contributor_count: lib?.contributor_count ?? 0, action: 'noop',
    reason: 'unknown course_library state',
  };
}
