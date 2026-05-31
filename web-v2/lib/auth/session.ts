/**
 * P39 — server-side session auth.
 *
 * Pattern: opaque session tokens stored in `sessions` table (legacy
 * shape: id, user_id, session_token, expires_at, created_at,
 * last_used_at, kind, revoked_at). Lightweight alternative to JWT;
 * we already have the table.
 *
 * Helpers:
 *   - `userIdFromRequest(req)` — opaque-token Bearer / cookie. Returns
 *     a real user_uuid on success, or `null` when no valid session is
 *     present. Callers MUST treat `null` as 401.
 *     Prior to the user-isolation fix (2026-05-30), this fell back to
 *     DEFAULT_USER_ID (David). That made every unauthenticated request
 *     read David's data — a cross-user leak waiting on user #2.
 *   - `requireUserId(req)` — convenience wrapper that returns either
 *     a user_uuid or a 401 NextResponse. The standard helper for any
 *     route handler that must be per-user.
 *   - `requireAuth(req)` — legacy strict version; throws AuthError on
 *     missing/invalid session. Kept for back-compat where the caller
 *     prefers a try/catch over a Response branch.
 *
 * Session lifecycle:
 *   - createSession(userUuid) → token (random 32 hex)
 *   - revokeSession(token)    → null
 *   - cleanExpired()          → cron job
 */
import { randomBytes, createHash } from 'crypto';
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';

const TOKEN_TTL_DAYS = 90;

/** Generate a random session token. 32 bytes hex = 64 chars. */
function newToken(): string {
  return randomBytes(32).toString('hex');
}

/** SHA-256 of token, since we store hashed (don't trust the DB host
 *  with raw tokens). The runtime always hashes incoming tokens before
 *  comparing. */
function hashToken(t: string): string {
  return createHash('sha256').update(t).digest('hex');
}

/**
 * Look up the userId for a request. Strategy:
 *   1. Authorization: Bearer <token>
 *   2. Cookie `faff_session=<token>`
 *   3. (HISTORICAL) fallback to DEFAULT_USER_ID — REMOVED 2026-05-30.
 *      The fallback meant that any unauthenticated request silently
 *      read David's data. As soon as user #2 onboarded, a failed
 *      session lookup would have leaked David's plan/runs/health/etc.
 *      Now returns `null` — callers MUST treat that as 401.
 */
export async function userIdFromRequest(req: Request | { headers: Headers, url?: string }): Promise<string | null> {
  const token = extractToken(req);
  if (!token) return null;
  const tokenHash = hashToken(token);
  try {
    const r = (await pool.query(
      `SELECT COALESCE(user_uuid, user_id)::text AS user_uuid
         FROM sessions
        WHERE session_token = $1
          AND expires_at > NOW()
          AND revoked_at IS NULL
        LIMIT 1`,
      [tokenHash],
    )).rows[0];
    if (r?.user_uuid) {
      // Best-effort: bump last_used (don't block on error).
      void pool.query(
        `UPDATE sessions SET last_used_at = NOW() WHERE session_token = $1`,
        [tokenHash],
      ).catch(() => {});
      return r.user_uuid;
    }
  } catch (e: any) {
    console.error('[auth] session lookup failed:', e?.message);
  }
  return null;
}

/**
 * The canonical helper for route handlers that must be per-user.
 *
 * Returns either:
 *   - a string user_uuid (success), OR
 *   - a NextResponse with status 401 (caller should `return` it
 *     immediately).
 *
 * Usage:
 *
 *   export async function GET(req: NextRequest) {
 *     const auth = await requireUserId(req);
 *     if (auth instanceof NextResponse) return auth;
 *     const userId = auth;
 *     // … per-user query, scoped to userId
 *   }
 */
export async function requireUserId(
  req: Request | { headers: Headers, url?: string },
): Promise<string | NextResponse> {
  const userId = await userIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return userId;
}

/** Strict variant — throws if no valid session. Use on new endpoints
 *  that must not silently fall back. */
export async function requireAuth(req: Request | { headers: Headers }): Promise<string> {
  const token = extractToken(req);
  if (!token) throw new AuthError('no token');
  const tokenHash = hashToken(token);
  const r = (await pool.query(
    `SELECT COALESCE(user_uuid, user_id)::text AS user_uuid
       FROM sessions
      WHERE session_token = $1
        AND expires_at > NOW()
        AND revoked_at IS NULL
      LIMIT 1`,
    [tokenHash],
  )).rows[0];
  if (!r?.user_uuid) throw new AuthError('invalid or expired token');
  return r.user_uuid;
}

export class AuthError extends Error {
  status = 401;
  constructor(msg: string) { super(msg); this.name = 'AuthError'; }
}

function extractToken(req: Request | { headers: Headers }): string | null {
  const h = req.headers.get('authorization') ?? req.headers.get('Authorization') ?? '';
  const m = h.match(/^Bearer\s+([A-Za-z0-9._\-]+)$/);
  if (m) return m[1];
  const cookie = req.headers.get('cookie') ?? '';
  const cm = cookie.match(/(?:^|;\s*)faff_session=([A-Za-z0-9._\-]+)/);
  return cm ? cm[1] : null;
}

/**
 * Create a new session for a user. Returns { token, expiresAt } — the
 * token is the RAW value (caller sets cookie / returns it), but we
 * store the SHA-256 hash. Token is 64 hex chars.
 */
export async function createSession(
  userUuid: string,
  opts?: { kind?: string; userAgent?: string; ipHash?: string },
): Promise<{ token: string; expiresAt: string }> {
  const token = newToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 86400000).toISOString();
  await pool.query(
    `INSERT INTO sessions (user_id, user_uuid, session_token, expires_at, kind, user_agent, ip_address, created_at)
     VALUES ($1, $1, $2, $3, $4, $5, $6, NOW())`,
    [userUuid, tokenHash, expiresAt, opts?.kind ?? 'app', opts?.userAgent ?? null, opts?.ipHash ?? null],
  );
  return { token, expiresAt };
}

export async function revokeSession(token: string): Promise<void> {
  const tokenHash = hashToken(token);
  await pool.query(
    `UPDATE sessions SET revoked_at = NOW() WHERE session_token = $1`,
    [tokenHash],
  );
}

/** Cron-friendly: purge expired or revoked > 7d old. */
export async function cleanExpired(): Promise<{ purged: number }> {
  const r = await pool.query(
    `DELETE FROM sessions
      WHERE (expires_at < NOW() OR revoked_at < NOW() - interval '7 days')`,
  );
  return { purged: r.rowCount ?? 0 };
}
