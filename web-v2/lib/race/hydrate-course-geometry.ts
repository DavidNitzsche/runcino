/**
 * lib/race/hydrate-course-geometry.ts · the writer that was missing.
 *
 * `course-geometry-source.ts` decides WHAT a backfill would write and why.
 * This file is the database half: it loads the candidate rows, runs that same
 * pure planner, and — only when told to commit — writes the geometry.
 *
 * Shared by the two callers so there is one backfill, not two:
 *   · `POST /api/admin/backfill-course-geometry`  · operator-invoked, dry run
 *                                                   by default
 *   · `POST /api/cron/promote-courses`            · the daily pass, so a row
 *                                                   that arrives with GPX and
 *                                                   no geometry stops needing
 *                                                   an operator at all
 *
 * ── THE WRITE, AND WHY IT CANNOT CLOBBER ─────────────────────────────────
 *
 * CLAUDE.md Rule 6: `course_geometry` is a whole-column jsonb with several
 * writers of different field coverage, so a naive full replace is how one
 * writer erases another's fields. This writer sidesteps the rule rather than
 * guarding against it — its `WHERE` clause fires ONLY on a row whose column is
 * empty. There is nothing to preserve, so there is nothing to lose, and the
 * guard lives in SQL rather than in the plan, which means a stale plan cannot
 * overwrite a column that was populated between the read and the write.
 *
 * That also makes it idempotent: a second run finds the same rows already
 * populated and writes nothing.
 *
 * ── WHAT REVERSES IT ─────────────────────────────────────────────────────
 *
 *     UPDATE races SET course_geometry = NULL, course_source = NULL
 *      WHERE slug = ANY($1) AND user_uuid = $2;
 *
 * `gpx_text` is never touched, so the source file survives any reversal and
 * the backfill can simply be run again.
 */
import type { Pool } from 'pg';
import { pool as defaultPool } from '@/lib/db/pool';
import { rowsOrNull } from '@/lib/db/read';
import { parseGPX } from '@/lib/race/gpx-parser';
import { planGeometryHydration, type HydrationPlan } from '@/lib/race/course-geometry-source';

interface CandidateRow {
  slug: string;
  user_uuid: string;
  gpx_text: string | null;
  course_geometry: Record<string, unknown> | null;
  nominal_mi: string | null;
  lib_gain: number | string | null;
  lib_net: number | string | null;
}

export interface HydrationRun {
  /** Null when the candidate read FAILED. An empty array is the honest none. */
  plans: (HydrationPlan & { userUuid: string; written: boolean })[] | null;
  committed: boolean;
  counts: Record<string, number>;
}

export interface HydrationOpts {
  /** Restrict to one user's races. Null scans every user. */
  userUuid?: string | null;
  /** Restrict to one race. */
  slug?: string | null;
  /** Nothing is written unless this is explicitly true. */
  commit?: boolean;
  /** Cap the scan so a cron pass cannot blow its time budget. */
  limit?: number;
  pool?: Pool;
}

/**
 * Plan — and optionally perform — the `gpx_text` → `course_geometry` backfill.
 *
 * DRY RUN IS THE DEFAULT. `commit` must be passed `true`; anything else,
 * including `undefined`, plans and writes nothing.
 */
export async function hydrateCourseGeometry(opts: HydrationOpts = {}): Promise<HydrationRun> {
  const p: Pool = opts.pool ?? defaultPool;
  const commit = opts.commit === true;
  const limit = opts.limit ?? 50;

  const rows = await rowsOrNull<CandidateRow>(
    'hydrate-course-geometry/candidates',
    p.query<CandidateRow>(
      `SELECT r.slug,
              r.user_uuid,
              r.gpx_text,
              r.course_geometry,
              r.meta->>'distanceMi' AS nominal_mi,
              c.elevation_gain_ft   AS lib_gain,
              c.net_elevation_ft    AS lib_net
         FROM races r
         LEFT JOIN course_library c ON c.slug = r.slug
        WHERE r.user_uuid IS NOT NULL
          AND length(COALESCE(r.gpx_text, '')) > 0
          AND jsonb_array_length(COALESCE(r.course_geometry->'trackPoints', '[]'::jsonb)) < 2
          AND ($1::text IS NULL OR r.user_uuid::text = $1)
          AND ($2::text IS NULL OR r.slug = $2)
        ORDER BY r.meta->>'date'
        LIMIT $3`,
      [opts.userUuid ?? null, opts.slug ?? null, limit],
    ),
  );

  // A failed candidate read is not "no races need backfilling". Say so.
  if (rows === null) return { plans: null, committed: commit, counts: {} };

  const counts: Record<string, number> = {
    write: 0, already_populated: 0, no_gpx: 0, unparseable: 0, refused: 0, written: 0, write_failed: 0,
  };
  const plans: (HydrationPlan & { userUuid: string; written: boolean })[] = [];

  for (const r of rows) {
    const nominalRaw = r.nominal_mi != null ? Number(r.nominal_mi) : NaN;
    const plan = planGeometryHydration({
      slug: r.slug,
      row: { course_geometry: r.course_geometry as never, gpx_text: r.gpx_text },
      nominalDistanceMi: Number.isFinite(nominalRaw) ? nominalRaw : null,
      lib: { elevation_gain_ft: r.lib_gain, net_elevation_ft: r.lib_net },
    });
    counts[plan.verdict] = (counts[plan.verdict] ?? 0) + 1;

    let written = false;
    if (commit && plan.verdict === 'write' && r.gpx_text) {
      try {
        // Re-parse rather than carry the blob out of the planner, so the value
        // stored is unambiguously `parseGPX(gpx_text)` and nothing in between.
        const geometry = parseGPX(r.gpx_text);
        const res = await p.query(
          `UPDATE races
              SET course_geometry = $1,
                  course_source   = COALESCE(course_source, 'upload')
            WHERE slug = $2
              AND user_uuid = $3
              AND jsonb_array_length(COALESCE(course_geometry->'trackPoints', '[]'::jsonb)) < 2`,
          [geometry, r.slug, r.user_uuid],
        );
        written = (res.rowCount ?? 0) > 0;
        counts[written ? 'written' : 'write_failed'] += 1;
      } catch (e: unknown) {
        counts.write_failed += 1;
        console.error(
          `[hydrate-course-geometry] write FAILED ${r.slug} · ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    plans.push({ ...plan, userUuid: r.user_uuid, written });
  }

  return { plans, committed: commit, counts };
}
