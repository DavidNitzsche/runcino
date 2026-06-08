/**
 * /api/strength — strength_sessions CRUD.
 *
 * Research/07 prescribes 2 strength sessions/wk for distance runners.
 * This route lets the runner log when they did one (manually) AND
 * accepts HK-imported sessions (idempotent on hk_uuid).
 *
 * GET    /api/strength?days=14         → list recent (includes source field)
 * POST   /api/strength {                 → log a session (manual or HK upsert)
 *          date, session_type?, duration_min?, notes?,
 *          source?,           // 'manual' (default) | 'apple_health' | 'watch' | 'strava'
 *          hk_uuid?,          // HKWorkout.uuid · required when source='apple_health'
 *        }
 * DELETE /api/strength?hk_uuid=<uuid>   → remove an HK-imported row by stable uuid
 *
 * Manual logging (LogNonRunSheet) · sends no source · defaults to 'manual'.
 * HK ingest (HealthKitImporter) · sends source='apple_health' + hk_uuid.
 *   Idempotent on hk_uuid · re-syncing the same HKWorkout upserts
 *   instead of creating duplicates. Constraint catches dupes at write time.
 * HK delete · scoped to (user_uuid, hk_uuid) · idempotent · always 200.
 *
 * Cite: Research/07-strength-programming.md §frequency-recommendations.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { requireUserId } from '@/lib/auth/session';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const days = Math.max(1, Math.min(90, Number(req.nextUrl.searchParams.get('days') ?? 14)));
  const r = await pool.query(
    `SELECT id, date::text AS date, session_type, duration_min, notes,
            source, hk_uuid, created_at::text AS created_at
       FROM strength_sessions
      WHERE user_uuid = $1
        AND date >= CURRENT_DATE - $2::int
      ORDER BY date DESC`,
    [userId, days],
  ).catch(() => ({ rows: [] }));
  return NextResponse.json({ ok: true, sessions: r.rows });
}

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 }); }

  const date = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
    ? body.date
    : await runnerToday(userId);
  const sessionType = typeof body.session_type === 'string' ? body.session_type : null;
  const durationMin = Number.isFinite(Number(body.duration_min)) ? Number(body.duration_min) : null;
  const notes = typeof body.notes === 'string' ? body.notes : null;

  // 2026-06-01 · provenance + HK idempotency.
  // source defaults to 'manual'. When source='apple_health', hk_uuid
  // is required + the row UPSERTs on hk_uuid so a re-sync of the same
  // HKWorkout doesn't create duplicate rows.
  const sourceRaw = typeof body.source === 'string' ? body.source : 'manual';
  const allowedSources = ['manual', 'apple_health', 'watch', 'strava'];
  const source = allowedSources.includes(sourceRaw) ? sourceRaw : 'manual';
  const hkUuid = typeof body.hk_uuid === 'string' && body.hk_uuid.length > 0 ? body.hk_uuid : null;

  if (source === 'apple_health' && !hkUuid) {
    return NextResponse.json(
      { ok: false, error: 'hk_uuid required when source=apple_health' },
      { status: 400 }
    );
  }

  // UPSERT on hk_uuid when provided · INSERT when null.
  // The unique partial index strength_sessions_hk_uuid_uniq makes the
  // ON CONFLICT clause safe to use even though hk_uuid is nullable.
  const r = hkUuid
    ? await pool.query(
        `INSERT INTO strength_sessions
           (user_uuid, date, session_type, duration_min, notes, source, hk_uuid)
         VALUES ($1, $2::date, $3, $4, $5, $6, $7)
         ON CONFLICT (hk_uuid) WHERE hk_uuid IS NOT NULL
         DO UPDATE SET
           date = EXCLUDED.date,
           session_type = EXCLUDED.session_type,
           duration_min = EXCLUDED.duration_min,
           notes = COALESCE(EXCLUDED.notes, strength_sessions.notes),
           source = EXCLUDED.source
         RETURNING id, date::text AS date, session_type, duration_min, notes,
                   source, hk_uuid, created_at::text AS created_at`,
        [userId, date, sessionType, durationMin, notes, source, hkUuid],
      )
    : await pool.query(
        `INSERT INTO strength_sessions (user_uuid, date, session_type, duration_min, notes, source)
         VALUES ($1, $2::date, $3, $4, $5, $6)
         RETURNING id, date::text AS date, session_type, duration_min, notes,
                   source, hk_uuid, created_at::text AS created_at`,
        [userId, date, sessionType, durationMin, notes, source],
      );
  await bustBriefingCacheForEvent(userId, 'run_ingest').catch(() => {});
  return NextResponse.json({ ok: true, session: r.rows[0] });
}

/**
 * DELETE /api/strength?hk_uuid=<uuid>
 *
 * Removes an HK-imported strength_sessions row. Used by the iPhone HK
 * importer when a runner deletes the corresponding HKWorkout in Apple
 * Fitness · without this, deletions in Apple Fitness leave stale rows
 * that inflate the recommender's habit signal + the ACWR fold.
 *
 * Owner-scoped: `DELETE WHERE hk_uuid = $1 AND user_uuid = $2`. The
 * partial unique index on hk_uuid is global · we MUST filter by owner
 * to prevent a spoofed hk_uuid from nuking another runner's row.
 *
 * Idempotent: re-deleting a missing row returns `{ ok: true, deleted: 0 }`.
 * iPhone may re-POST the entire 28-day delete sweep on every sync if
 * simpler than tracking what got removed · 404 would force needless
 * retry logic.
 *
 * Manual-log rows (hk_uuid IS NULL) are NEVER eligible · they use a
 * separate by-id DELETE route (not yet built · file a brief if needed).
 *
 * Per designs/briefs/strength-hk-delete-backend-brief.md.
 */
export async function DELETE(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const hkUuid = req.nextUrl.searchParams.get('hk_uuid');
  if (!hkUuid) {
    return NextResponse.json(
      { ok: false, error: 'hk_uuid required' },
      { status: 400 }
    );
  }

  const r = await pool.query(
    `DELETE FROM strength_sessions
      WHERE hk_uuid = $1 AND user_uuid = $2`,
    [hkUuid, userId],
  ).catch(() => ({ rowCount: 0 }));

  // Bust briefing cache only when something actually moved · saves a
  // round-trip when the iPhone re-sends a no-op delete.
  if (r.rowCount && r.rowCount > 0) {
    await bustBriefingCacheForEvent(userId, 'run_ingest').catch(() => {});
  }

  return NextResponse.json({ ok: true, deleted: r.rowCount ?? 0 });
}
