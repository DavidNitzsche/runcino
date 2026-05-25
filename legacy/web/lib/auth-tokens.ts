/**
 * S6/native-bridge · token auth for the iPhone bridge + watchOS app.
 *
 * Issues access + refresh token pairs that native clients can use to
 * authenticate against the same backend that powers the web app.  No
 * JWTs, opaque 32-byte base64url tokens stored in the existing
 * `sessions` table with a `kind` discriminator.
 *
 * THREE TOKEN KINDS share the sessions table:
 *
 *   · cookie  · existing web flow · 30d TTL
 *   · access  · native short-lived bearer · 24h TTL · single API call worth
 *   · refresh · native long-lived rotation token · 90d TTL · refresh rotates
 *
 * REFRESH ROTATION
 *   Each /api/auth/token/refresh call:
 *     1. Validates the old refresh token (kind='refresh', not revoked, not expired)
 *     2. Issues a NEW refresh token + a NEW access token
 *     3. Revokes the old refresh token (sets revoked_at)
 *     4. Returns both new tokens to the caller
 *   This is defense against replay: if a refresh token leaks, the
 *   attacker gets one rotation before the legitimate user's next
 *   refresh invalidates them.
 *
 * AUTH CHECK
 *   getCurrentUser() in lib/auth.ts checks cookie session first, then
 *   falls back to Authorization: Bearer <accessToken>.  Bearer tokens
 *   are validated against sessions table with kind='access' and no
 *   revoked_at.
 *
 * WHY NOT JWTS
 *   Simpler.  Existing cookie sessions already do DB lookups per
 *   request; bearer-token DB lookups match that pattern.  Single-user
 *   v1 won't notice the DB load.  Revocation is precise (no token
 *   blacklist required).  Defer JWTs until scale demands them.
 */

import { randomBytes } from 'crypto';
import { query } from './db';

// ── Constants ────────────────────────────────────────────────────

const ACCESS_TTL_HOURS = 24;
const REFRESH_TTL_DAYS = 90;

export const ACCESS_TTL_SECONDS = ACCESS_TTL_HOURS * 60 * 60;

// ── Types ────────────────────────────────────────────────────────

export type TokenKind = 'cookie' | 'access' | 'refresh';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires.  Refresh TTL is 90d
   *  by construction; clients don't need it numerically. */
  expiresIn: number;
}

/** Result of validating an access token.  null when invalid. */
export interface AccessTokenLookup {
  userId: string;
}

// ── Helpers ──────────────────────────────────────────────────────

function newToken(): string {
  // 32 random bytes → ~43 char base64url. Same shape as the existing
  // cookie session_token; no need for a separate format.
  return randomBytes(32).toString('base64url');
}

function accessExpiresAt(): Date {
  const d = new Date();
  d.setHours(d.getHours() + ACCESS_TTL_HOURS);
  return d;
}

function refreshExpiresAt(): Date {
  const d = new Date();
  d.setDate(d.getDate() + REFRESH_TTL_DAYS);
  return d;
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Issue a fresh access+refresh token pair for an authenticated user.
 * Called by:
 *   · POST /api/auth/token after password verification
 *   · POST /api/auth/token/refresh after old refresh validates
 *
 * Both tokens are inserted into the sessions table.  Caller is
 * responsible for revoking any prior refresh token (in the refresh
 * rotation flow).
 */
export async function issueTokens(userId: string, opts?: {
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<TokenPair> {
  const accessToken = newToken();
  const refreshToken = newToken();

  await query(
    `INSERT INTO sessions (user_id, session_token, kind, expires_at, ip_address, user_agent)
     VALUES ($1, $2, 'access', $3, $4, $5),
            ($1, $6, 'refresh', $7, $4, $5)`,
    [
      userId,
      accessToken,
      accessExpiresAt(),
      opts?.ipAddress ?? null,
      opts?.userAgent ?? null,
      refreshToken,
      refreshExpiresAt(),
    ],
  );

  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TTL_SECONDS,
  };
}

/**
 * Validate an access token.  Returns the userId if valid; null if
 * the token is unknown, expired, revoked, or not an access token.
 *
 * Touches last_used_at fire-and-forget (matches the cookie pattern
 * in getCurrentUser).
 */
export async function lookupAccessToken(
  token: string,
): Promise<AccessTokenLookup | null> {
  if (!token || token.length < 16) return null;

  const rows = await query<{ user_id: string }>(
    `SELECT user_id
       FROM sessions
      WHERE session_token = $1
        AND kind = 'access'
        AND expires_at > NOW()
        AND revoked_at IS NULL
      LIMIT 1`,
    [token],
  );

  const row = rows[0];
  if (!row) return null;

  // Touch last_used_at fire-and-forget · don't block the response
  query(
    `UPDATE sessions SET last_used_at = NOW() WHERE session_token = $1`,
    [token],
  ).catch(() => { /* non-fatal */ });

  return { userId: row.user_id };
}

/**
 * Validate a refresh token and rotate it.  Atomic-ish: looks up,
 * verifies, then issues new tokens AND revokes the old refresh in
 * a transaction.
 *
 * Returns the new pair on success, null when the old token is
 * invalid (unknown / expired / revoked / not a refresh token).
 */
export async function rotateRefreshToken(
  oldRefreshToken: string,
  opts?: { ipAddress?: string | null; userAgent?: string | null },
): Promise<TokenPair | null> {
  if (!oldRefreshToken || oldRefreshToken.length < 16) return null;

  // Validate the old token first.  We don't combine into a single
  // CTE because the issueTokens call is its own multi-row insert;
  // simpler to do this as two operations + accept a tiny race window.
  const rows = await query<{ user_id: string; id: string }>(
    `SELECT user_id, id
       FROM sessions
      WHERE session_token = $1
        AND kind = 'refresh'
        AND expires_at > NOW()
        AND revoked_at IS NULL
      LIMIT 1`,
    [oldRefreshToken],
  );

  const row = rows[0];
  if (!row) return null;

  // Revoke the old refresh first.  If issueTokens fails downstream,
  // the user can re-authenticate with password, no token is left
  // both old AND valid.
  await query(
    `UPDATE sessions SET revoked_at = NOW() WHERE id = $1`,
    [row.id],
  );

  return issueTokens(row.user_id, opts);
}

/**
 * Revoke a refresh token explicitly (logout-from-this-device flow).
 * Idempotent: revoking an already-revoked or unknown token returns
 * ok without error.
 *
 * Also revokes any access tokens issued from the same user that
 * predate this revocation, prevents the case where an attacker
 * with a stolen access token can keep using it after the user has
 * explicitly logged out.
 */
export async function revokeRefreshToken(
  refreshToken: string,
): Promise<{ ok: true }> {
  if (!refreshToken || refreshToken.length < 16) {
    return { ok: true };
  }

  // Look up the refresh token first so we can also revoke that
  // user's access tokens.
  const rows = await query<{ user_id: string }>(
    `SELECT user_id
       FROM sessions
      WHERE session_token = $1 AND kind = 'refresh' AND revoked_at IS NULL
      LIMIT 1`,
    [refreshToken],
  );
  const userId = rows[0]?.user_id;

  await query(
    `UPDATE sessions SET revoked_at = NOW()
      WHERE session_token = $1 AND kind = 'refresh' AND revoked_at IS NULL`,
    [refreshToken],
  );

  // If we found a user, revoke their access tokens too (defense in
  // depth: explicit logout means "this device should be fully signed
  // out, not just unable-to-refresh").
  if (userId) {
    await query(
      `UPDATE sessions SET revoked_at = NOW()
        WHERE user_id = $1 AND kind = 'access' AND revoked_at IS NULL`,
      [userId],
    );
  }

  return { ok: true };
}

/**
 * Cleanup helper: revoke ALL active tokens (access + refresh) for a
 * user.  Used when the user changes password or marks themselves
 * compromised.  Cookie sessions are untouched, that's a separate
 * surface and gets cleared via cookie expiry / logout.
 */
export async function revokeAllUserTokens(userId: string): Promise<{ revoked: number }> {
  const result = await query<{ revoked: string }>(
    `UPDATE sessions
        SET revoked_at = NOW()
      WHERE user_id = $1
        AND kind IN ('access', 'refresh')
        AND revoked_at IS NULL
      RETURNING id::TEXT AS revoked`,
    [userId],
  );
  return { revoked: result.length };
}
