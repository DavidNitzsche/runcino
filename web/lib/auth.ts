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
import { query, maybeBackfillLegacyOwner } from './db';
import { SESSION_COOKIE } from './auth-constants';

// ── Constants ─────────────────────────────────────────────────
export { SESSION_COOKIE };
const SESSION_TTL_DAYS = 30;
const BCRYPT_COST = 12;

// ── Types ─────────────────────────────────────────────────────
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  onboarding_complete: boolean;
  /** From the users.location text field; pages use this to compute
   *  the user's timezone for "today" math. */
  location: string | null;
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

  // Insert returning the new row. Conflicts on email will throw.
  const rows = await query<AuthUser>(
    `INSERT INTO users (email, password_hash, name)
     VALUES ($1, $2, $3)
     RETURNING id, email, name, onboarding_complete, location;`,
    [normalizedEmail, passwordHash, name.trim()],
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
    `SELECT id, email, name, onboarding_complete, location, password_hash
     FROM users WHERE email = $1 LIMIT 1;`,
    [normalizedEmail],
  );
  const u = rows[0];
  if (!u) throw new Error('Invalid email or password');

  const ok = await verifyPassword(password, u.password_hash);
  if (!ok) throw new Error('Invalid email or password');

  await createSessionCookie(u.id);
  await query(`UPDATE users SET last_login_at = NOW() WHERE id = $1;`, [u.id]);

  return { id: u.id, email: u.email, name: u.name, onboarding_complete: u.onboarding_complete, location: u.location };
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
 * Look up the currently-logged-in user from the session cookie.
 * Returns null if no cookie, expired session, or session not found.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const rows = await query<AuthUser>(
    `SELECT u.id, u.email, u.name, u.onboarding_complete, u.location
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.session_token = $1 AND s.expires_at > NOW()
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
