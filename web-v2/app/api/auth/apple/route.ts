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

const APPLE_AUDIENCE = process.env.APPLE_AUDIENCE ?? 'run.faff.app';   // iOS bundle id
const APPLE_SERVICES_ID = process.env.APPLE_SERVICES_ID ?? null;       // web Services ID (separate from bundle id)
const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';

// Both surfaces (iPhone native flow + web Sign in with Apple JS) POST here.
// iPhone JWT claims.aud = the iOS bundle id. Web JWT claims.aud = the
// configured Services ID. Accept either · they're both us.
const ACCEPTED_AUDIENCES: ReadonlySet<string> = new Set<string>(
  [APPLE_AUDIENCE, APPLE_SERVICES_ID].filter((s): s is string => !!s),
);

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
 *
 * 2026-06-05 · backend audit P0-1 fix · was: claims-only, signature
 * never verified. Any forged JWT with the right iss/aud/exp string
 * would sign in as any user; the email-bootstrap branch linked the
 * forged identity into existing rows (David's account included).
 * Now: JWKS-based RSA-SHA256 verification via Node's built-in crypto
 * (no jose dependency · Apple's keys are RSA, which crypto.createPublicKey
 * with format='jwk' handles directly). kid match against Apple's JWKS
 * is required · unknown kid throws. Cite docs/2026-06-05-backend-audit.html
 * § P0-1.
 */
async function verifyAppleToken(token: string): Promise<any> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed JWT');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());

  if (claims.iss !== APPLE_ISSUER) throw new Error(`bad iss: ${claims.iss}`);
  if (!ACCEPTED_AUDIENCES.has(claims.aud)) {
    throw new Error(`bad aud: ${claims.aud} (accepted: ${Array.from(ACCEPTED_AUDIENCES).join(', ')})`);
  }
  if (claims.exp && claims.exp * 1000 < Date.now()) throw new Error('token expired');

  // ── JWS signature verification · the critical security gate ──
  // The header carries the `kid` (key id) and `alg` (Apple uses RS256
  // for all keys served from appleid.apple.com/auth/keys). We:
  //   1. Pull the matching JWK from Apple's JWKS endpoint (60-min cache)
  //   2. Import as a public key via Node crypto (handles JWK natively)
  //   3. Verify the (header || '.' || payload) signature against it.
  const { createPublicKey, createVerify } = await import('crypto');
  if (!header.kid) throw new Error('missing kid in JWT header');
  if (header.alg !== 'RS256') throw new Error(`unexpected alg: ${header.alg} (Apple uses RS256)`);

  const keys = await fetchJWKS();
  const jwk = (keys as Array<Record<string, unknown>>).find((k) => k.kid === header.kid);
  if (!jwk) {
    throw new Error(`unknown kid: ${header.kid} · not in Apple JWKS`);
  }

  // Apple's JWKs are RSA; createPublicKey accepts a JsonWebKeyInput
  // ({ key, format: 'jwk' }) directly on Node 16+. The resulting
  // KeyObject feeds straight into createVerify. Cast jwk to the
  // standard JsonWebKey shape · Apple's keys conform to RFC 7517.
  let publicKey;
  try {
    publicKey = createPublicKey({
      key: jwk as unknown as import('crypto').JsonWebKey,
      format: 'jwk',
    });
  } catch (e: unknown) {
    throw new Error(`JWK import failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  const signingInput = `${parts[0]}.${parts[1]}`;
  const signature = Buffer.from(parts[2], 'base64url');
  const verifier = createVerify('RSA-SHA256');
  verifier.update(signingInput);
  verifier.end();
  const ok = verifier.verify(publicKey, signature);
  if (!ok) {
    throw new Error('JWT signature verification failed');
  }

  return claims;
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }

  const identityToken = body?.identity_token;
  if (!identityToken) {
    return NextResponse.json({ error: 'identity_token required' }, { status: 400 });
  }

  let claims: any;
  try {
    claims = await verifyAppleToken(identityToken);
  } catch (e: any) {
    return NextResponse.json({ error: `token verify failed: ${e?.message}` }, { status: 401 });
  }

  // body.user is optional · web sign-in only ships authorization + id_token,
  // so we fall back to extracting sub from the verified claims when the
  // client doesn't include it. Native iOS still passes user explicitly so
  // both surfaces converge on the same persisted identifier.
  const appleUserId = (body?.user ?? '').trim() || (claims?.sub ?? '').trim();
  if (!appleUserId) {
    return NextResponse.json({ error: 'apple user identifier missing from token + body' }, { status: 400 });
  }
  if (claims.sub && claims.sub !== appleUserId) {
    return NextResponse.json({ error: 'sub mismatch with body.user' }, { status: 400 });
  }

  // Apple's email lives in the verified JWT claims on first sign-in (and
  // sometimes on every sign-in for relay emails). Trust claims.email over
  // body.email · the body could be forged, the token has been verified.
  const email: string | null = (claims.email ?? body.email ?? null) || null;

  // Find or create the profile row.
  // 1) Direct apple_user_id match wins (returning Apple user, already linked).
  // 2) Email-bootstrap fallback. First-time Apple sign-in for an account
  //    that pre-existed in `users` (David is the canonical example: his
  //    users.email = dnitch85@me.com but profile.apple_user_id was never
  //    set). We look up users by email, then upsert the profile row with
  //    apple_user_id populated. Lands him on his real 91-workout plan
  //    instead of creating a phantom new account.
  // 3) Genuine new signup. INSERT a fresh profile row. user_uuid is NULL
  //    until a downstream onboarding step claims a users row · keeps the
  //    schema clean while the new account decides what to do.
  let userUuid: string | null = null;
  try {
    const existing = (await pool.query(
      `SELECT user_uuid::text AS user_uuid FROM profile WHERE apple_user_id = $1 LIMIT 1`,
      [appleUserId],
    )).rows[0];
    if (existing) {
      userUuid = existing.user_uuid;
      if (email) {
        await pool.query(
          `UPDATE profile SET apple_email = COALESCE(apple_email, $1) WHERE user_uuid = $2`,
          [email, userUuid],
        );
      }
    } else if (email) {
      const linked = (await pool.query(
        `SELECT id::text AS user_uuid FROM users WHERE email = $1 LIMIT 1`,
        [email],
      )).rows[0];
      if (linked) {
        userUuid = linked.user_uuid;
        // Upsert the profile row to carry the Apple identifier going forward.
        // ON CONFLICT path: an existing profile row already keyed by user_uuid
        // (legacy single-user 'me' default) gets its Apple columns populated;
        // a fresh INSERT happens when the row didn't exist.
        await pool.query(
          `INSERT INTO profile (user_uuid, apple_user_id, apple_email)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_uuid) DO UPDATE
             SET apple_user_id = EXCLUDED.apple_user_id,
                 apple_email   = COALESCE(profile.apple_email, EXCLUDED.apple_email)`,
          [userUuid, appleUserId, email],
        ).catch(async () => {
          // Fallback when no unique constraint on user_uuid · just update.
          await pool.query(
            `UPDATE profile SET apple_user_id = $1, apple_email = COALESCE(apple_email, $2)
              WHERE user_uuid = $3`,
            [appleUserId, email, userUuid],
          );
        });
      }
    }

    if (!userUuid) {
      // 2026-06-10 · invite-only gate (David: "remove apple sign on, just
      // email and password"). Apple Sign In was the one auth path that
      // created `status='active'` accounts with NO invite check — anyone
      // with an Apple ID was straight in, a hole in the otherwise
      // invite-only model. New-account creation via Apple is now gated
      // the same as /api/auth/signup: blocked unless ALLOW_OPEN_SIGNUP.
      // EXISTING Apple users (userUuid resolved above) still sign in, so
      // this never locks anyone out; it only stops new un-approved
      // accounts. The iPhone Apple button is also removed — request
      // access is the only door for strangers.
      if (process.env.ALLOW_OPEN_SIGNUP !== 'true') {
        return NextResponse.json(
          { ok: false, error: 'Faff is invite-only — request access at faff.run' },
          { status: 403 },
        );
      }
      // Genuine new signup. 2026-06-10 multi-user fix: this branch used
      // to INSERT a bare profile row and RETURN its user_uuid — but
      // nothing ever created the users row, so user_uuid came back NULL
      // and the request 500'd ("profile resolution failed"). A stranger
      // with an Apple ID could never actually sign up. Now: create the
      // users row first (email comes from the VERIFIED token claims;
      // Apple always supplies one, relay or real), then the linked
      // profile row, atomically.
      if (!email) {
        return NextResponse.json(
          { error: 'Apple sign-in returned no email · cannot create an account' },
          { status: 400 },
        );
      }
      const fullName = body.full_name ? `${body.full_name.givenName ?? ''} ${body.full_name.familyName ?? ''}`.trim() : null;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // password_hash is NOT NULL · Apple-only accounts get an
        // unusable sentinel (random preimage, never matchable) — they
        // sign in with Apple, not a password.
        const { unusablePasswordHash } = await import('@/lib/auth/access-requests');
        const u = (await client.query(
          `INSERT INTO users (email, name, status, onboarding_complete, password_hash)
           VALUES ($1, COALESCE($2, ''), 'active', FALSE, $3)
           ON CONFLICT (email) DO UPDATE SET updated_at = NOW()
           RETURNING id::text AS id`,
          [email, fullName, await unusablePasswordHash()],
        )).rows[0];
        userUuid = u.id;
        // profile's PK is the legacy user_id text column (DEFAULT 'me')
        // — set it to the uuid-as-text or every new signup collides
        // with the legacy row. No ON CONFLICT: a brand-new users row
        // cannot have a profile row yet, and profile has no unique
        // index on user_uuid to conflict on anyway.
        await client.query(
          `INSERT INTO profile (user_id, user_uuid, apple_user_id, apple_email, full_name)
           VALUES ($1::text, $1::uuid, $2, $3, $4)`,
          [userUuid, appleUserId, email, fullName],
        );
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    }
  } catch (e: any) {
    return NextResponse.json({ error: `profile upsert failed: ${e?.message}` }, { status: 500 });
  }

  if (!userUuid) {
    return NextResponse.json({ error: 'profile resolution failed' }, { status: 500 });
  }

  // Mint a session.
  const userAgent = req.headers.get('user-agent') ?? undefined;
  const sess = await createSession(userUuid, { kind: 'apple', userAgent });

  // Same redirect contract as /api/auth/email: finished accounts land
  // on /today, fresh ones walk the onboarding deck. Web AuthButtons and
  // the iPhone client both honor it; absence degrades to '/today'.
  const ob = (await pool.query(
    `SELECT onboarding_complete FROM users WHERE id = $1 LIMIT 1`,
    [userUuid],
  ).catch(() => ({ rows: [] as Array<{ onboarding_complete: boolean }> }))).rows[0];
  const redirect: '/today' | '/onboarding' = ob?.onboarding_complete === false ? '/onboarding' : '/today';

  const res = NextResponse.json({
    ok: true,
    redirect,
    token: sess.token,
    expires_at: sess.expiresAt,
    user_uuid: userUuid,
  });
  // 2026-05-30 P1 SSR-leak fix follow-up: also set the session as a
  // cookie so React server components / page loaders can resolve the
  // runner without the Bearer header (SSR has no client-side state).
  // The Bearer header path keeps working for API calls. HttpOnly so
  // JS can't read it; Secure in prod; SameSite=Lax so navigating to
  // /faff from anywhere on the domain carries the cookie.
  res.cookies.set('faff_session', sess.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: new Date(sess.expiresAt),
  });
  return res;
}
