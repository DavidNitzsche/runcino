/**
 * P39 — server-side session auth.
 *
 * Pattern: opaque session tokens stored in `sessions` table (legacy
 * shape: id, user_id, session_token, expires_at, created_at,
 * last_used_at, kind, revoked_at). Lightweight alternative to JWT;
 * we already have the table.
 *
 * Two helpers:
 *   - `userIdFromRequest(req)` — opaque-token Bearer / cookie; falls
 *     back to DEFAULT_USER_ID env when no token + auth not strict.
 *     This keeps every existing endpoint working through the
 *     single-to-multi-user migration window.
 *   - `requireAuth(req)` — strict version; returns 401 if no valid
 *     session. Use on endpoints that absolutely must be per-user.
 *
 * Session lifecycle:
 *   - createSession(userUuid) → token (random 32 hex)
 *   - revokeSession(token)    → null
 *   - cleanExpired()          → cron job
 */
import { randomBytes, createHash } from 'crypto';
import { pool } from '@/lib/db/pool';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';
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
 *   3. fallback to DEFAULT_USER_ID for back-compat (so single-user beta
 *      keeps working; will be removed when multi-user fully cuts over).
 */
export async function userIdFromRequest(req: Request | { headers: Headers, url?: string }): Promise<string> {
  const token = extractToken(req);
  if (!token) return DAVID_USER_ID;
  const tokenHash = hashToken(token);
  try {
    const r = (await pool.query(
      `SELECT user_id::text AS user_uuid
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
  return DAVID_USER_ID;
}

/** Strict variant — throws if no valid session. Use on new endpoints
 *  that must not silently fall back. */
export async function requireAuth(req: Request | { headers: Headers }): Promise<string> {
  const token = extractToken(req);
  if (!token) throw new AuthError('no token');
  const tokenHash = hashToken(token);
  const r = (await pool.query(
    `SELECT user_id::text AS user_uuid
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
    `INSERT INTO sessions (user_id, session_token, expires_at, kind, user_agent, ip_address, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
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
