/**
 * Auth — bcrypt hashing, session cookie management, server-side
 * session lookup. No email verification, no password reset for v1
 * (defer infra). Sign-up → immediate session cookie → logged in.
 *
 * The cookie name is `faff_session`. Value is the opaque session_token
 * stored in the `sessions` table (32 bytes base64url). On each request
 * for a protected route we look up the session by token + check expiry.
 *
 * On signup, if email matches LEGACY_OWNER_EMAIL we run the backfill
 * (claims all single-user 'me' rows for that account).
 */

import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { query, maybeBackfillLegacyOwner } from './db';
import { SESSION_COOKIE } from './auth-constants';

// ── Constants ─────────────────────────────────────────────────
export { SESSION_COOKIE };
const SESSION_TTL_DAYS = 30;
const BCRYPT_COST = 12;

// Approval gate. When SIGNUP_REQUIRES_APPROVAL is unset OR truthy,
// new signups land as 'pending' and need admin approval. The legacy
// owner (LEGACY_OWNER_EMAIL) is always auto-approved + auto-admin'd.
// Flip to "false" to open up self-serve signup.
function signupRequiresApproval(): boolean {
  const v = (process.env.SIGNUP_REQUIRES_APPROVAL ?? 'true').toLowerCase();
  return v !== 'false' && v !== '0' && v !== 'no';
}

function legacyOwnerEmail(): string {
  return (process.env.LEGACY_OWNER_EMAIL || 'dnitch85@me.com').toLowerCase();
}

export type UserStatus = 'pending' | 'active' | 'denied';

// ── Types ─────────────────────────────────────────────────────
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  onboarding_complete: boolean;
  /** From the users.location text field; pages use this to compute
   *  the user's timezone for "today" math. */
  location: string | null;
  status: UserStatus;
  is_admin: boolean;
  /** Max HR (bpm) — null when unset. When set, coach uses %max
   *  zones in HR commentary instead of qualitative bands. */
  max_hr: number | null;
  /** Brand accent (`#RRGGBB`) the user picked on /profile. null falls
   *  back to the canonical faff.run orange `#E85D26`. */
  accent_color: string | null;
}

// ── Helpers ───────────────────────────────────────────────────

function newToken(): string {
  // 32 random bytes → ~43 char base64url. Plenty of entropy.
  return randomBytes(32).toString('base64url');
}

function ttlDate(): Date {
  const d = new Date();
  d.setDate(d.getDate() + SESSION_TTL_DAYS);
  return d;
}

// ── Public API ────────────────────────────────────────────────

/**
 * Hash a plaintext password with bcrypt (cost 12). The returned string
 * embeds the salt + cost so it's self-contained — no separate salt
 * column needed in the DB.
 */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

/** Compare a plaintext password against a stored bcrypt hash. */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Sign up a new user. Creates the row, sets a session cookie, and
 * runs the legacy-owner backfill if the email matches. Returns the
 * new user record. Throws if email already exists.
 *
 * The cookie is set via the next/headers `cookies()` API which means
 * this must be called from a Route Handler or Server Action context.
 */
export async function signupUser(email: string, password: string, name: string): Promise<AuthUser> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail.includes('@')) throw new Error('Invalid email');
  if (!password || password.length < 8) throw new Error('Password must be at least 8 characters');
  if (!name?.trim()) throw new Error('Name is required');

  const passwordHash = await hashPassword(password);

  // Approval gate. The legacy owner is always active + admin so they can
  // never lock themselves out of the admin panel. Everyone else is
  // 'pending' until an admin approves them (unless approval is disabled).
  const isLegacyOwner = normalizedEmail === legacyOwnerEmail();
  const status: UserStatus = (isLegacyOwner || !signupRequiresApproval()) ? 'active' : 'pending';
  const isAdmin = isLegacyOwner;
  const approvedAt = status === 'active' ? new Date() : null;

  // Insert returning the new row. Conflicts on email will throw.
  const rows = await query<AuthUser>(
    `INSERT INTO users (email, password_hash, name, status, is_admin, approved_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, email, name, onboarding_complete, location, status, is_admin, max_hr, accent_color;`,
    [normalizedEmail, passwordHash, name.trim(), status, isAdmin, approvedAt],
  );
  const user = rows[0];
  if (!user) throw new Error('Failed to create user');

  // Legacy-owner backfill — runs IF this email is LEGACY_OWNER_EMAIL.
  // No-op for everyone else.
  try {
    await maybeBackfillLegacyOwner(user.id, user.email);
  } catch (e) {
    // Don't fail signup if the backfill errors — log + continue.
    // The user can re-trigger via the /api/admin/backfill route later.
    console.error('[auth] backfill failed:', e);
  }

  // Set the cookie even for pending users so they land on /pending
  // signed-in (don't need to type credentials a second time). The page
  // gate decides where to send them based on status.
  await createSessionCookie(user.id);
  await query(`UPDATE users SET last_login_at = NOW() WHERE id = $1;`, [user.id]);

  return user;
}

/**
 * Log an existing user in. Looks up by email, verifies bcrypt hash,
 * sets a session cookie. Returns the user record. Throws on bad creds.
 */
export async function loginUser(email: string, password: string): Promise<AuthUser> {
  const normalizedEmail = email.trim().toLowerCase();

  const rows = await query<AuthUser & { password_hash: string }>(
    `SELECT id, email, name, onboarding_complete, location, status, is_admin, max_hr, accent_color, password_hash
     FROM users WHERE email = $1 LIMIT 1;`,
    [normalizedEmail],
  );
  const u = rows[0];
  if (!u) throw new Error('Invalid email or password');

  const ok = await verifyPassword(password, u.password_hash);
  if (!ok) throw new Error('Invalid email or password');

  await createSessionCookie(u.id);
  await query(`UPDATE users SET last_login_at = NOW() WHERE id = $1;`, [u.id]);

  return {
    id: u.id, email: u.email, name: u.name,
    onboarding_complete: u.onboarding_complete,
    location: u.location, status: u.status, is_admin: u.is_admin,
    max_hr: u.max_hr, accent_color: u.accent_color,
  };
}

/**
 * Insert a session row + set the cookie. Cookie is httpOnly, secure
 * in prod, sameSite lax (so OAuth redirects work).
 */
async function createSessionCookie(userId: string): Promise<void> {
  const token = newToken();
  const expires = ttlDate();
  await query(
    `INSERT INTO sessions (user_id, session_token, expires_at) VALUES ($1, $2, $3);`,
    [userId, token, expires],
  );
  const jar = await cookies();
  jar.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires,
  });
}

/**
 * Look up the currently-logged-in user.
 *
 * Two paths:
 *   · COOKIE PATH (web) · reads the `faff_session` cookie, matches
 *     against sessions where kind='cookie' (or kind unset for legacy
 *     rows · default 'cookie' was added in the S6 migration).
 *   · BEARER PATH (native) · optional req param.  When provided +
 *     contains `Authorization: Bearer <token>`, matches against
 *     sessions where kind='access' and not revoked.
 *
 * Native clients call routes with the request object; web routes
 * still call this with no args.  When both are present, BEARER wins
 * (explicit > implicit).  Returns null if neither resolves.
 */
export async function getCurrentUser(req?: { headers: Headers } | Request): Promise<AuthUser | null> {
  // ── Bearer path · native clients ────────────────────────────
  if (req) {
    const authHeader = req.headers.get('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const bearer = authHeader.slice('Bearer '.length).trim();
      if (bearer.length >= 16) {
        const rows = await query<AuthUser>(
          `SELECT u.id, u.email, u.name, u.onboarding_complete, u.location, u.status, u.is_admin, u.max_hr, u.accent_color
             FROM sessions s
             JOIN users u ON u.id = s.user_id
            WHERE s.session_token = $1
              AND s.kind = 'access'
              AND s.expires_at > NOW()
              AND s.revoked_at IS NULL
            LIMIT 1;`,
          [bearer],
        );
        if (rows[0]) {
          query(`UPDATE sessions SET last_used_at = NOW() WHERE session_token = $1;`, [bearer]).catch(() => {});
          return rows[0];
        }
        // Bearer present but invalid — don't fall through to cookie;
        // an invalid bearer should fail explicitly, not silently
        // succeed via an unrelated cookie session.
        return null;
      }
    }
  }

  // ── Cookie path · web (unchanged) ──────────────────────────
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const rows = await query<AuthUser>(
    `SELECT u.id, u.email, u.name, u.onboarding_complete, u.location, u.status, u.is_admin, u.max_hr, u.accent_color
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.session_token = $1 AND s.expires_at > NOW() AND s.revoked_at IS NULL
     LIMIT 1;`,
    [token],
  );
  const u = rows[0];
  if (!u) return null;

  // Touch last_used_at — fire-and-forget so it doesn't block the response
  query(`UPDATE sessions SET last_used_at = NOW() WHERE session_token = $1;`, [token]).catch(() => {});

  return u;
}

/**
 * Server-side helper that REQUIRES a logged-in user. Returns the user
 * or throws — for use in Server Components / Route Handlers that should
 * only ever run authenticated.
 */
export async function requireUser(): Promise<AuthUser> {
  const u = await getCurrentUser();
  if (!u) throw new Error('Unauthorized');
  return u;
}

/**
 * Page-level gate for app pages (overview/training/log/etc).
 * - No session → /login
 * - Session but status !== 'active' → /pending (waiting room)
 * - Active → returns the user
 *
 * Use this anywhere a logged-in user should see protected content.
 * For the admin panel use requireAdmin() instead.
 */
export async function requireActiveUser(req?: { headers: Headers } | Request): Promise<AuthUser> {
  // Pass `req` from API routes so the native app's Authorization: Bearer
  // token is honored (getCurrentUser checks Bearer first, then the cookie).
  // Page server components call this with no arg → cookie-only, as before.
  const u = await getCurrentUser(req);
  if (!u) redirect('/login');
  if (u.status !== 'active') redirect('/pending');
  return u;
}

/**
 * Page-level gate for /admin and admin API routes. Anyone non-admin
 * gets bounced to /overview (active users) or /login (signed out).
 */
export async function requireAdmin(): Promise<AuthUser> {
  const u = await getCurrentUser();
  if (!u) redirect('/login');
  if (u.status !== 'active') redirect('/pending');
  if (!u.is_admin) redirect('/overview');
  return u;
}

/**
 * Operational-token gate · for agent-driven read-only diagnostics +
 * idempotent backfills.
 *
 * Accepts EITHER:
 *   - A standard admin session (cookie) — same as requireAdmin().
 *   - An `Authorization: Bearer <token>` header matching the
 *     `ADMIN_OPERATIONAL_TOKEN` env var.
 *
 * Returns the bound admin user. When the bearer-token path is used,
 * the user is the LEGACY_OWNER_EMAIL (David) — the rationale being
 * that the agent acts on the owner's behalf, never on another user's.
 *
 * SCOPE · only endpoints that are read-only OR idempotent +
 * rate-limited should opt in. Per CLAUDE.md rule #1 (operational vs
 * decision vs external):
 *   - GET /api/admin/l7-signal-view       · read-only, OK
 *   - GET /api/admin/l7-signal2-view      · read-only, OK
 *   - POST /api/admin/backfill-splits     · idempotent, rate-limited, OK
 *   - POST /api/admin/audit-races         · read-only diagnostic, OK
 *   - GET /api/admin/race-hr-diagnostic   · read-only, OK
 *
 * NOT opt-in:
 *   - Any endpoint that mutates user-visible state without an
 *     idempotency guarantee (e.g., race priority updates)
 *   - Endpoints touching credentials, OAuth, or external accounts
 *
 * When the env var is unset (e.g., dev without operations), the
 * bearer path silently fails and only session auth works.
 */
export async function requireAdminOrOpToken(req: { headers: Headers } | Request): Promise<AuthUser> {
  const auth = req.headers.get('authorization');
  if (auth && auth.startsWith('Bearer ')) {
    const presented = auth.slice('Bearer '.length).trim();
    const expected = process.env.ADMIN_OPERATIONAL_TOKEN?.trim();
    if (expected && expected.length >= 32 && presented === expected) {
      // Token matches — bind to the legacy owner so the rest of the
      // pipeline (admin.id, RBAC) works exactly as it would for a
      // session-authed call.
      const legacyOwner = (process.env.LEGACY_OWNER_EMAIL || 'dnitch85@me.com').toLowerCase();
      const rows = await query<AuthUser>(
        `SELECT id, email, name, onboarding_complete, location, status, is_admin, max_hr, accent_color
           FROM users WHERE LOWER(email) = $1 LIMIT 1`,
        [legacyOwner],
      );
      const u = rows[0];
      if (u && u.is_admin && u.status === 'active') {
        return u;
      }
    }
  }
  // No valid bearer → fall through to session-auth.
  return requireAdmin();
}

/**
 * Sign out — deletes the session row + clears the cookie.
 */
export async function logoutUser(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await query(`DELETE FROM sessions WHERE session_token = $1;`, [token]);
  }
  jar.delete(SESSION_COOKIE);
}
