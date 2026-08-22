/**
 * POST /api/auth/email
 *
 * Email + password sign-in for the web. Mirrors /api/auth/apple ·
 * verify identity, mint a session row, set the faff_session cookie.
 *
 * Two branches:
 *
 *   1. Bootstrap (first sign-in for an admin who hasn't set a password
 *      via this surface): IF `users.is_admin = TRUE AND
 *      email_verified_at IS NULL`, treats the request as a one-time
 *      password set · bcrypt-hash the provided password, UPDATE
 *      password_hash + email_verified_at, skip bcrypt.compare. Closes
 *      after first successful login.
 *
 *   2. Normal: bcrypt.compare(password, password_hash) · 401 on miss.
 *
 * Body:   { email, password }
 * Resp:   { ok, redirect } + faff_session cookie
 */
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { pool } from '@/lib/db/pool';
import { createSession, revokeAllSessionsForUser } from '@/lib/auth/session';
import { authRateLimited } from '@/lib/auth/rate-limit';

const SESSION_COOKIE = 'faff_session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

interface SuccessBody {
  ok: true;
  redirect: '/today' | '/onboarding' | '/set-password';
  // iPhone clients need the bearer token in the JSON body (Bearer auth,
  // not cookies). Web ignores these fields and follows `redirect`. Added
  // 2026-05-31 so the iPhone EmailSignInSheet can save into TokenStore
  // without parsing the Set-Cookie header.
  token: string;
  expires_at: string;
  user_uuid: string;
}
interface ErrorBody   { ok: false; error: string; }

export async function POST(req: NextRequest): Promise<NextResponse<SuccessBody | ErrorBody>> {
  // 2026-06-10 · multi-user opening: per-IP brake on the public auth
  // surfaces (bcrypt cost was the only thing slowing a stuffing bot).
  if (authRateLimited(req)) {
    return NextResponse.json({ ok: false, error: 'too many attempts — try again in a few minutes' }, { status: 429 });
  }
  let body: { email?: unknown; password?: unknown; timezone?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 }); }

  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  // Optional browser-detected IANA timezone (2026-08-17 · multi-user
  // hygiene): web-only runners never sync from iOS, so profile.timezone
  // stayed NULL and every "today" fell to the UTC/Pacific fallbacks in
  // lib/runtime/runner-tz.ts. Validated against Intl; bad values drop.
  const clientTz = typeof body.timezone === 'string' && body.timezone.length > 0
      && body.timezone.length <= 64 && isValidIanaTz(body.timezone)
    ? body.timezone : null;
  if (!email || !password) {
    return NextResponse.json({ ok: false, error: 'email and password required' }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ ok: false, error: 'password must be at least 6 characters' }, { status: 400 });
  }

  // users.email is citext · don't lowercase
  const userRow = (await pool.query(
    `SELECT id::text AS user_uuid, password_hash, status, onboarding_complete,
            is_admin, email_verified_at
       FROM users WHERE email = $1 LIMIT 1`,
    [email],
  )).rows[0];

  if (!userRow) {
    return NextResponse.json({ ok: false, error: 'invalid credentials' }, { status: 401 });
  }
  if (userRow.status !== 'active') {
    return NextResponse.json({ ok: false, error: 'account not active' }, { status: 403 });
  }

  // Bootstrap branch · admin + unverified only
  //
  // 2026-08-21 · backend audit · THIS BRANCH SET A PASSWORD WITHOUT CHECKING ONE.
  //
  // The condition was `is_admin === true && email_verified_at == null`, and the
  // body of it hashed whatever password arrived and stored it. No invite token,
  // no email proof, no `bcrypt.compare` — and it runs BEFORE the compare below,
  // so reaching it skipped authentication entirely. Anyone who knew an admin's
  // email address could POST a password of their choosing and own the account;
  // `revokeAllSessionsForUser` on the way out then cut the real admin's live
  // sessions. It did not even require `password_hash` to be unset, so it was a
  // takeover of a fully provisioned account, not just a first-run convenience.
  //
  // Checked against production (faff_readonly, 2026-08-21): the single admin
  // row, dnitch85@me.com, already carries `email_verified_at`, so the branch is
  // shut for it and no account is exposed right now. That is a property of the
  // data, not of the code. Admins are only ever made by DDL or a seed script —
  // `lib/auth/access-requests.ts` never grants the flag — and every such row is
  // born `email_verified_at IS NULL`. So the hole reopens the moment a second
  // admin is provisioned, and stays open until that admin happens to log in
  // before an attacker does. Provisioning an admin should not start a race.
  //
  // Two conditions added, both necessary:
  //
  //   · a shared secret in `x-faff-bootstrap-token`, FAIL-CLOSED when
  //     ADMIN_BOOTSTRAP_TOKEN is unset. Unset-means-allow is the vacuous-pass
  //     shape this codebase already rejects in all thirteen cron routes, which
  //     answer 503 rather than proceeding; this matches them.
  //   · `password_hash IS NULL`. Bootstrap means "this account has no password
  //     yet", and that is the only thing it should be able to do. Overwriting
  //     an existing hash is a reset, and a reset needs the old password
  //     (/api/auth/set-password) or a mailed token — never an unauthenticated
  //     POST.
  //
  // Both are cheap and neither touches the normal login path below.
  const bootstrapToken = process.env.ADMIN_BOOTSTRAP_TOKEN;
  const bootstrapHeader = req.headers.get('x-faff-bootstrap-token');
  const bootstrapAuthorised =
    typeof bootstrapToken === 'string'
    && bootstrapToken.length > 0
    && bootstrapHeader === bootstrapToken;

  let bootstrapped = false;
  if (
    userRow.is_admin === true
    && userRow.email_verified_at == null
    && userRow.password_hash == null
    && bootstrapAuthorised
  ) {
    const newHash = await bcrypt.hash(password, 12);
    await pool.query(
      `UPDATE users SET password_hash = $1, email_verified_at = NOW(), updated_at = NOW()
        WHERE id = $2`,
      [newHash, userRow.user_uuid],
    );
    // 2026-08-21 · multi-tenancy audit · the bootstrap branch sets a
    // password just like /api/auth/set-password does, so it ends other
    // sessions for the same reason: a token minted before the change
    // otherwise outlived it by up to 90 days. No token to spare here —
    // the caller's session is minted below, after this runs.
    await revokeAllSessionsForUser(userRow.user_uuid).catch(() => {});
    bootstrapped = true;
  }

  if (!bootstrapped) {
    if (!userRow.password_hash) {
      return NextResponse.json({ ok: false, error: 'invalid credentials' }, { status: 401 });
    }
    let matches = false;
    try { matches = await bcrypt.compare(password, userRow.password_hash); } catch {}
    if (!matches) {
      return NextResponse.json({ ok: false, error: 'invalid credentials' }, { status: 401 });
    }
  }

  const userAgent = req.headers.get('user-agent') ?? undefined;
  const sess = await createSession(userRow.user_uuid, { kind: 'email', userAgent });

  await pool.query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [userRow.user_uuid]).catch(() => {});

  // Persist the browser timezone ONLY where none exists yet. An
  // iOS-synced (or Settings-set) value always wins — this fills the
  // web-only gap, it never overwrites. Best-effort: a miss here just
  // leaves the runner on the existing fallback until next login.
  if (clientTz) {
    await pool.query(
      `UPDATE profile SET timezone = $1
        WHERE user_uuid = $2::uuid AND (timezone IS NULL OR timezone = '')`,
      [clientTz, userRow.user_uuid],
    ).catch(() => {});
    await pool.query(
      `UPDATE users SET timezone = $1, updated_at = NOW()
        WHERE id = $2 AND (timezone IS NULL OR timezone = '')`,
      [clientTz, userRow.user_uuid],
    ).catch(() => {});
  }

  // Invite-only flow (2026-06-10): a non-admin with NULL email_verified_at
  // is signing in on the TEMP password David's approval generated — route
  // them to choose their own before anything else. (Admins with NULL
  // hit the bootstrap branch above instead and verify there.)
  const mustChangePassword = !bootstrapped && userRow.email_verified_at == null && userRow.is_admin !== true;
  const redirect: '/today' | '/onboarding' | '/set-password' = mustChangePassword
    ? '/set-password'
    : userRow.onboarding_complete ? '/today' : '/onboarding';
  const res = NextResponse.json<SuccessBody>({
    ok: true,
    redirect,
    token: sess.token,
    expires_at: sess.expiresAt,
    user_uuid: userRow.user_uuid,
  });
  res.cookies.set(SESSION_COOKIE, sess.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
  return res;
}

/** True when Intl accepts the string as a timeZone (catches junk before
 *  it lands in profile.timezone, where runner-tz would throw on it). */
function isValidIanaTz(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; }
  catch { return false; }
}
