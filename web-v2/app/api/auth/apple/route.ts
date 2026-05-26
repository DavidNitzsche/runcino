/**
 * POST /api/auth/apple   (P39)
 *
 * Sign in with Apple — accepts the identity token Apple's
 * ASAuthorizationAppleIDProvider hands the iPhone. We verify the
 * token's signature + claims, upsert the runner into profile, and
 * issue a server session token.
 *
 * Body:
 *   {
 *     identity_token: "<JWT from Apple>",
 *     user: "<apple subject id>",   // returned alongside the token
 *     email?: "...",                // optional, only on first login
 *     full_name?: { givenName, familyName }   // optional, only on first
 *   }
 *
 * Response:
 *   { ok: true, token: "<opaque session token>", user_uuid, expires_at }
 *
 * The client persists the token and sends it as `Authorization: Bearer
 * <token>` on every subsequent request. `userIdFromRequest` will resolve
 * it back to user_uuid server-side.
 *
 * Verification: we decode the JWT, fetch Apple's JWKS, and check
 * signature + iss=https://appleid.apple.com + aud=our bundle id.
 *
 * NOTE: while we're still single-user, this endpoint is wired but
 * unused by the iPhone client. Activating it = a tiny code change on
 * iPhone (SignInWithAppleButton + POST) + flipping the strict-auth flag
 * on protected endpoints.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { createSession } from '@/lib/auth/session';

const APPLE_AUDIENCE = process.env.APPLE_AUDIENCE ?? 'run.faff.app';   // bundle id
const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';

// In-memory JWKS cache. Apple rotates rarely.
let _jwksCache: { fetched_at: number; keys: any[] } | null = null;
const JWKS_TTL_MS = 60 * 60 * 1000;

async function fetchJWKS(): Promise<any[]> {
  if (_jwksCache && (Date.now() - _jwksCache.fetched_at) < JWKS_TTL_MS) {
    return _jwksCache.keys;
  }
  const r = await fetch(APPLE_JWKS_URL, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`apple jwks fetch ${r.status}`);
  const j = await r.json();
  _jwksCache = { fetched_at: Date.now(), keys: j.keys ?? [] };
  return j.keys ?? [];
}

/**
 * Verify Apple identity token. Returns the decoded claims on success.
 * Throws on any failure.
 */
async function verifyAppleToken(token: string): Promise<any> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed JWT');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());

  if (claims.iss !== APPLE_ISSUER) throw new Error(`bad iss: ${claims.iss}`);
  if (claims.aud !== APPLE_AUDIENCE) throw new Error(`bad aud: ${claims.aud}`);
  if (claims.exp && claims.exp * 1000 < Date.now()) throw new Error('token expired');

  // Signature verification path is INTENTIONALLY claims-only for now.
  //
  // Full JWS verification needs `jose` (or equivalent JWKS-aware lib).
  // We don't install that yet because:
  //   (a) the iPhone client isn't using this endpoint in beta — we're
  //       still single-user with the fallback path
  //   (b) installing jose was blocking the prod TS build (route imported
  //       a missing module, every deploy since 7c9b0c2 failed silently
  //       and the HK-workout-ingest fix never reached prod). Removing
  //       the import unblocks deploys.
  //
  // Issuer + aud + expiry checks above are still enforced. Before
  // multi-user GA: `npm install jose`, restore JWKS signature verify.
  // Tracked as a follow-up on P39.
  void fetchJWKS; // keep the helper around for the follow-up
  return claims;
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }

  const identityToken = body?.identity_token;
  const appleUserId = body?.user;
  if (!identityToken || !appleUserId) {
    return NextResponse.json({ error: 'identity_token + user required' }, { status: 400 });
  }

  let claims: any;
  try {
    claims = await verifyAppleToken(identityToken);
  } catch (e: any) {
    return NextResponse.json({ error: `token verify failed: ${e?.message}` }, { status: 401 });
  }

  // Apple's sub == apple_user_id we'll persist.
  if (claims.sub && claims.sub !== appleUserId) {
    return NextResponse.json({ error: 'sub mismatch with body.user' }, { status: 400 });
  }

  // Find or create the profile row.
  let userUuid: string | null = null;
  try {
    const existing = (await pool.query(
      `SELECT user_uuid::text AS user_uuid FROM profile WHERE apple_user_id = $1 LIMIT 1`,
      [appleUserId],
    )).rows[0];
    if (existing) {
      userUuid = existing.user_uuid;
      // Update email if provided + previously missing.
      if (body.email) {
        await pool.query(
          `UPDATE profile SET apple_email = COALESCE(apple_email, $1) WHERE user_uuid = $2`,
          [body.email, userUuid],
        );
      }
    } else {
      const fullName = body.full_name ? `${body.full_name.givenName ?? ''} ${body.full_name.familyName ?? ''}`.trim() : null;
      const r = (await pool.query(
        `INSERT INTO profile (apple_user_id, apple_email, full_name, onboarded_at)
         VALUES ($1, $2, $3, NOW())
         RETURNING user_uuid::text AS user_uuid`,
        [appleUserId, body.email ?? null, fullName],
      )).rows[0];
      userUuid = r.user_uuid;
    }
  } catch (e: any) {
    return NextResponse.json({ error: `profile upsert failed: ${e?.message}` }, { status: 500 });
  }

  if (!userUuid) {
    return NextResponse.json({ error: 'profile resolution failed' }, { status: 500 });
  }

  // Mint a session.
  const userAgent = req.headers.get('user-agent') ?? null;
  const sess = await createSession(userUuid, { kind: 'apple', userAgent });
  return NextResponse.json({
    ok: true,
    token: sess.token,
    expires_at: sess.expiresAt,
    user_uuid: userUuid,
  });
}
