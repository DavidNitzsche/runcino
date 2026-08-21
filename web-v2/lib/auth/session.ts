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
import { outage } from '@/lib/route/failure';

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
  const r = await resolveUserId(req);
  return r.kind === 'user' ? r.userId : null;
}

/**
 * What the session read actually found. Three outcomes, not two.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * A DATABASE OUTAGE USED TO SIGN THE RUNNER OUT
 *
 * `userIdFromRequest` wrapped the sessions lookup in `try { … } catch { }`
 * and returned `null` either way, so "no row matches this token" and "the
 * sessions table could not be read" were the same answer. `requireUserId`
 * turned that into 401.
 *
 * Forced against a dev server with `DATABASE_URL` pointed at a dead port,
 * holding a perfectly valid Bearer token:
 *
 *     [auth] session lookup failed:
 *     GET /api/v5/today 401 in 53ms   → {"error":"Unauthorized"}
 *
 * And a 401 is not a quiet failure on the phone. `API.authedSend` posts
 * `.faffSessionExpired`; `FaffApp` handles it with `TokenStore.shared.clear()`
 * and a bounce to the sign-in gate. So a Postgres blip DELETED a valid token
 * and signed the runner out — and they could not sign back in, because
 * signing in reads the same database. Told "your session expired", which was
 * not true, with no way back until the database returned.
 *
 * That is rule three at its most expensive: an outage wearing the clothes of
 * a decision about the runner. So the read failure is now its own outcome
 * and `requireUserId` answers 503 for it. A 503 is not 401, so the phone
 * leaves the token alone and shows the outage screen.
 */
type SessionResolution =
  | { kind: 'user'; userId: string }
  | { kind: 'no-session' }
  | { kind: 'unreadable'; error: unknown };

async function resolveUserId(
  req: Request | { headers: Headers, url?: string },
): Promise<SessionResolution> {
  const token = extractToken(req);
  if (!token) return { kind: 'no-session' };
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
      return { kind: 'user', userId: r.user_uuid };
    }
    // The read SUCCEEDED and matched nothing. This one really is a 401.
    return { kind: 'no-session' };
  } catch (e: unknown) {
    // A refused connection carries an EMPTY `message`, which is why the log
    // line above this fix read `session lookup failed:` and stopped. Log the
    // whole error, not one field of it.
    console.error('[auth] session lookup UNREADABLE (not an expiry):', e);
    return { kind: 'unreadable', error: e };
  }
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
  const r = await resolveUserId(req);
  if (r.kind === 'user') return r.userId;
  // See `SessionResolution`. A session we could not READ is not a session
  // that expired, and answering 401 for it made the phone throw away a
  // valid token. 104 route files call this helper, so the distinction lands
  // everywhere at once.
  if (r.kind === 'unreadable') return outage('auth/session', r.error);
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

/**
 * Admin gate for /api/admin/** routes (2026-06-10 · multi-user opening).
 *
 * requireUserId alone meant ANY signed-in runner could fire the
 * diagnostic/backfill endpoints — harmless while David was the only
 * account, wrong the moment signup opened. Resolves the session like
 * requireUserId, then requires users.is_admin. Returns the user_uuid,
 * a 401 (no session), or a 403 (valid session, not an admin).
 */
export async function requireAdmin(
  req: Request | { headers: Headers, url?: string },
): Promise<string | NextResponse> {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  try {
    const r = (await pool.query(
      `SELECT is_admin FROM users WHERE id = $1 LIMIT 1`,
      [auth],
    )).rows[0];
    if (r?.is_admin === true) return auth;
  } catch (e: unknown) {
    // Same shape as the session read above: an unreadable `users` row is not
    // a runner who lacks the admin flag. 403 is a decision; this is not one.
    return outage('auth/admin', e);
  }
  return NextResponse.json({ error: 'Forbidden · admin only' }, { status: 403 });
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

/**
 * SSR-side counterpart to `userIdFromRequest`. React server components
 * + page loaders don't have a NextRequest in scope — they read cookies
 * via `next/headers` instead. Same `faff_session=<token>` cookie that
 * the API helpers accept; resolves it to a user_uuid against the
 * `sessions` table.
 *
 * As of 2026-05-30 we ALSO honor a `DEV_USER_UUID` env override when
 * NODE_ENV !== 'production'. This is the dev-only escape hatch for
 * David's local browser session (which doesn't have a real Apple
 * sign-in cookie yet — the iPhone client uses Bearer auth and we
 * haven't wired SignInWithAppleButton on the web). The fallback never
 * fires in production, so prod traffic without a cookie still returns
 * null and surfaces never leak.
 *
 * Returns null when no valid session is present. SSR callers MUST
 * treat null as "render the empty/sign-in state" — falling back to a
 * default user is the bug we just fixed (see seed.ts / raceDetail.ts).
 */
export async function userIdFromCookies(): Promise<string | null> {
  // Dynamic import so this module stays usable in non-Next contexts
  // (e.g. scripts/, test harnesses) where `next/headers` would throw.
  let cookieStore: { get: (n: string) => { value: string } | undefined };
  try {
    const { cookies } = await import('next/headers');
    cookieStore = await cookies();
  } catch {
    return resolveDevFallback();
  }
  const tok = cookieStore.get('faff_session')?.value;
  if (!tok) return resolveDevFallback();
  const tokenHash = hashToken(tok);
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
      void pool.query(
        `UPDATE sessions SET last_used_at = NOW() WHERE session_token = $1`,
        [tokenHash],
      ).catch(() => {});
      return r.user_uuid;
    }
  } catch (e: any) {
    console.error('[auth] SSR session lookup failed:', e?.message);
  }
  // Token present but invalid — STILL fall through to dev fallback in
  // dev (e.g. cookie left over from a wiped sessions table) so local
  // dev doesn't hard-401 mid-iteration. In prod this returns null.
  return resolveDevFallback();
}

/**
 * Convenience wrapper for SSR loaders that must either return a real
 * user_uuid or trigger a redirect to the sign-in surface. Symmetric to
 * `requireUserId` for API routes — but where the API path returns a
 * NextResponse 401, this throws an `AuthRedirect` that the page can
 * catch and forward to `redirect('/onboarding')` (or render a sign-in
 * shell directly).
 *
 * Most callers prefer to handle the null case inline (render an empty
 * seed, show a "please sign in" panel) rather than redirect, so this
 * is opt-in. Use `userIdFromCookies()` + manual null-check for the
 * common case.
 */
export async function requireUserIdFromCookies(): Promise<string> {
  const id = await userIdFromCookies();
  if (!id) throw new AuthError('no SSR session');
  return id;
}

/**
 * Dev-only env-var fallback. Returns a UUID when:
 *   - NODE_ENV !== 'production'
 *   - DEV_USER_UUID is set
 * Returns null in production (or when unset). Never falls back to a
 * hardcoded UUID — that was the bug.
 */
function resolveDevFallback(): string | null {
  if (process.env.NODE_ENV === 'production') return null;
  const dev = process.env.DEV_USER_UUID;
  if (dev && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dev)) {
    return dev;
  }
  return null;
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

  // First-login funnel instrumentation (2026-08-17): both real invitees
  // never signed in and nothing measured that. Detect "this user had zero
  // sessions" BEFORE minting the first one; log it to ops_alerts after.
  // Fully best-effort — a probe failure must never block session creation
  // (worst case: the first-login event is missed, not the login).
  let firstLogin = false;
  try {
    firstLogin = (await pool.query(
      `SELECT 1 FROM sessions WHERE COALESCE(user_uuid::text, user_id) = $1 LIMIT 1`,
      [userUuid],
    )).rows.length === 0;
  } catch { firstLogin = false; }

  await pool.query(
    `INSERT INTO sessions (user_id, user_uuid, session_token, expires_at, kind, user_agent, ip_address, created_at)
     VALUES ($1, $1, $2, $3, $4, $5, $6, NOW())`,
    [userUuid, tokenHash, expiresAt, opts?.kind ?? 'app', opts?.userAgent ?? null, opts?.ipHash ?? null],
  );

  if (firstLogin) {
    void (async () => {
      const email = (await pool.query<{ email: string }>(
        `SELECT email::text AS email FROM users WHERE id = $1::uuid LIMIT 1`,
        [userUuid],
      ).catch(() => ({ rows: [] as Array<{ email: string }> }))).rows[0]?.email ?? null;
      const { raiseAlert } = await import('@/lib/ops/alerts');
      await raiseAlert({
        kind: 'unknown',
        severity: 'info',
        message: `First login: ${email ?? userUuid}`,
        metadata: { user_uuid: userUuid, email, session_kind: opts?.kind ?? 'app' },
        source: 'first-login',
      });
    })().catch(() => {});
  }

  return { token, expiresAt };
}

export async function revokeSession(token: string): Promise<void> {
  const tokenHash = hashToken(token);
  await pool.query(
    `UPDATE sessions SET revoked_at = NOW() WHERE session_token = $1`,
    [tokenHash],
  );
}

/**
 * Revoke every live session for a user, optionally sparing the one the
 * caller is currently holding.
 *
 * 2026-08-21 · multi-tenancy audit. Changing a password did not touch
 * the sessions table, so a token minted before the change stayed valid
 * for the rest of its 90-day TTL. That inverts what a password change
 * means to the person doing it: the common reason to change a password
 * is the belief that someone else has access, and the one thing it has
 * to accomplish — putting that someone out — was the one thing it did
 * not do. Sessions on other devices survived, on both the invite
 * first-login path and the admin bootstrap path.
 *
 * `exceptToken` keeps the caller signed in on the device they just
 * changed the password from. Everything else is cut.
 *
 * Returns the number of sessions revoked, so callers can report it.
 */
export async function revokeAllSessionsForUser(
  userUuid: string,
  opts?: { exceptToken?: string | null },
): Promise<number> {
  const spare = opts?.exceptToken ? hashToken(opts.exceptToken) : null;
  const r = await pool.query(
    `UPDATE sessions
        SET revoked_at = NOW()
      WHERE COALESCE(user_uuid::text, user_id) = $1
        AND revoked_at IS NULL
        AND ($2::text IS NULL OR session_token <> $2)`,
    [userUuid, spare],
  );
  return r.rowCount ?? 0;
}

/**
 * Pull the raw bearer/cookie token off a request. Exported so routes
 * that need to spare the caller's own session (see
 * `revokeAllSessionsForUser`) can identify it without re-implementing
 * the header parsing.
 */
export function tokenFromRequest(req: Request | { headers: Headers }): string | null {
  return extractToken(req);
}

/** Cron-friendly: purge expired or revoked > 7d old. */
export async function cleanExpired(): Promise<{ purged: number }> {
  const r = await pool.query(
    `DELETE FROM sessions
      WHERE (expires_at < NOW() OR revoked_at < NOW() - interval '7 days')`,
  );
  return { purged: r.rowCount ?? 0 };
}
