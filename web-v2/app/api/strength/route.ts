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
 *          start_at?,         // ISO-8601 instant (offset/Z) · HKWorkout.startDate
 *          timezone?,         // IANA device zone · with start_at, the server
 *                             //   derives the session's local date itself
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
import { runnerToday, captureTimezoneFromDevice } from '@/lib/runtime/runner-tz';
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

  // 2026-07-06 · audit P1-22 · the legacy HealthKitImporter formats the
  // session date in a hardcoded America/Los_Angeles frame ("yyyy-MM-dd
  // (PT)") — wrong calendar day for any non-Pacific runner, and every
  // downstream reader (strength-recommender loadLoggedStrengthDates,
  // roll-forward, habit detection, strength-status) keys on this being
  // the runner-local day. Updated clients ship the raw HKWorkout start
  // instant (`start_at`, offset-carrying ISO) plus the device `timezone`;
  // the SERVER derives the local date from those and ignores the
  // client-computed one. Legacy payloads (no start_at/timezone) keep the
  // exact old ladder: body.date, else runnerToday. Cite:
  // Research/07-strength-programming.md §frequency-recommendations —
  // weekly counts only work when sessions land on the right local day.
  const deviceTz: string | null = (() => {
    if (typeof body.timezone !== 'string' || !body.timezone) return null;
    try { new Intl.DateTimeFormat('en-CA', { timeZone: body.timezone }); return body.timezone; }
    catch { return null; }
  })();
  if (deviceTz) await captureTimezoneFromDevice(userId, deviceTz).catch(() => { /* best-effort */ });
  const derivedDate: string | null = (() => {
    if (!deviceTz || typeof body.start_at !== 'string') return null;
    // Offset/Z REQUIRED · a bare wall time would be parsed in the SERVER'S
    // zone (UTC on Railway) and could bucket a day off — the exact bug
    // class this derivation replaces. Bare start_at → fall back to the
    // legacy body.date ladder below.
    if (!/(?:Z|[+-]\d{2}:?\d{2})$/.test(body.start_at)) return null;
    const t = Date.parse(body.start_at);
    if (!Number.isFinite(t)) return null;
    // en-CA formats as YYYY-MM-DD · same idiom as runnerToday().
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: deviceTz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(t));
  })();
  const date = derivedDate
    ?? (typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
      ? body.date
      : await runnerToday(userId));
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
  //
  // 2026-07-06 · audit P2-51 · owner guard on the DO UPDATE. The partial
  // unique index on hk_uuid is GLOBAL — without the guard, an
  // authenticated user POSTing another user's hk_uuid mutated THAT
  // user's row (date/type/duration overwritten; user_uuid untouched, so
  // it stayed in the victim's history with the attacker's data). Same
  // shape as the DELETE handler's owner scoping below. With the guard,
  // a cross-owner conflict updates nothing and RETURNING is empty →
  // 409, never a silent cross-tenant write.
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
         WHERE strength_sessions.user_uuid = EXCLUDED.user_uuid
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
  // P2-51 · empty RETURNING on the hk_uuid path means the ON CONFLICT
  // guard blocked a cross-owner update — the hk_uuid already belongs to
  // a different user_uuid. 409, no cache bust (nothing changed).
  if (hkUuid && r.rows.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'hk_uuid already registered to another user' },
      { status: 409 },
    );
  }
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
