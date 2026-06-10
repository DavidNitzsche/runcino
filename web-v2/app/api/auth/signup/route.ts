/**
 * POST /api/auth/signup
 *
 * Name + email + password account creation — the missing half of
 * /api/auth/email (which is sign-in only and 401s on unknown emails).
 * Until this route, NOTHING in web-v2 created a `users` row; every
 * account in prod was hand-seeded. This is the canonical signup path
 * for web and iPhone (David, 2026-06-10: "for now lets do just name,
 * email and password").
 *
 * Creates users + profile rows atomically, mints a session, sets the
 * faff_session cookie, and returns the same SuccessBody shape as
 * /api/auth/email so the iPhone EmailSignInSheet can reuse its
 * TokenStore handling unchanged.
 *
 * Body:   { name, email, password }
 * Resp:   { ok, redirect: '/onboarding', token, expires_at, user_uuid }
 *         409 when the email is already registered.
 *
 * Notes:
 *  - email_verified_at is stamped NOW(): there is no email-verification
 *    flow yet, and the column's live meaning is "credentials established"
 *    — it's what the /api/auth/email admin-bootstrap branch checks. A
 *    NULL here on a future is_admin account would re-open that one-time
 *    password-set door, so signup always closes it.
 *  - users.onboarding_complete stays FALSE; /api/onboarding/complete
 *    flips it, and the sign-in redirect ('/today' vs '/onboarding')
 *    keys off it.
 */
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { pool } from '@/lib/db/pool';
import { createSession } from '@/lib/auth/session';
import { authRateLimited } from '@/lib/auth/rate-limit';

const SESSION_COOKIE = 'faff_session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

interface SuccessBody {
  ok: true;
  redirect: '/onboarding';
  token: string;
  expires_at: string;
  user_uuid: string;
}
interface ErrorBody { ok: false; error: string; }

export async function POST(req: NextRequest): Promise<NextResponse<SuccessBody | ErrorBody>> {
  // 2026-06-10 (same day it opened): faff.run went INVITE-ONLY per
  // David — "either you have one or you don't. You can request access."
  // Open self-signup is OFF; the route stays (the machinery below is
  // sound and may reopen later) but always answers 403 pointing at the
  // request-access door. iPhone's create-account sheet surfaces this
  // error verbatim.
  if (process.env.ALLOW_OPEN_SIGNUP !== 'true') {
    return NextResponse.json(
      { ok: false, error: 'Faff is invite-only — request access at faff.run' },
      { status: 403 },
    );
  }
  if (authRateLimited(req)) {
    return NextResponse.json({ ok: false, error: 'too many attempts — try again in a few minutes' }, { status: 429 });
  }
  let body: { name?: unknown; email?: unknown; password?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 }); }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!name || !email || !password) {
    return NextResponse.json({ ok: false, error: 'name, email and password required' }, { status: 400 });
  }
  if (name.length > 80) {
    return NextResponse.json({ ok: false, error: 'name too long' }, { status: 400 });
  }
  // Light shape check only — the citext UNIQUE index is the real gate.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return NextResponse.json({ ok: false, error: 'enter a valid email address' }, { status: 400 });
  }
  // Floor matches /api/auth/email + the iPhone sheet (count >= 6).
  if (password.length < 6) {
    return NextResponse.json({ ok: false, error: 'password must be at least 6 characters' }, { status: 400 });
  }
  if (password.length > 200) {
    return NextResponse.json({ ok: false, error: 'password too long' }, { status: 400 });
  }

  // Pre-check for a clean 409 (users.email is citext — case-insensitive
  // match happens in the DB, don't lowercase here). The UNIQUE index
  // still backstops the race below.
  const existing = (await pool.query(
    `SELECT 1 FROM users WHERE email = $1 LIMIT 1`,
    [email],
  )).rows[0];
  if (existing) {
    return NextResponse.json(
      { ok: false, error: 'an account with this email already exists — sign in instead' },
      { status: 409 },
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  // users + profile in one txn — a half-created account (users row
  // without profile) is the zero-state shape that used to crash /today
  // (see /api/onboarding/complete pass-4 fix for the same discipline).
  const client = await pool.connect();
  let userUuid: string;
  try {
    await client.query('BEGIN');
    const u = (await client.query(
      `INSERT INTO users (email, password_hash, email_verified_at, name, status, onboarding_complete)
       VALUES ($1, $2, NOW(), $3, 'active', FALSE)
       RETURNING id::text AS id`,
      [email, passwordHash, name],
    )).rows[0];
    userUuid = u.id;
    // profile's PRIMARY KEY is the LEGACY user_id text column with
    // DEFAULT 'me' (single-user era). Omitting it makes every new
    // signup collide with David's 'me' row — set it to the uuid-as-text
    // explicitly. user_uuid stays the canonical column.
    await client.query(
      `INSERT INTO profile (user_id, user_uuid, full_name) VALUES ($1::text, $1::uuid, $2)`,
      [userUuid, name],
    );
    await client.query('COMMIT');
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    // Only the users-email unique violation means "account exists" —
    // a 23505 from any other table is a real bug and must surface as
    // one (a profile-PK collision masqueraded as this 409 once).
    if (err?.code === '23505' && /users/.test(`${err?.table ?? ''}${err?.constraint ?? ''}`)) {
      return NextResponse.json(
        { ok: false, error: 'an account with this email already exists — sign in instead' },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { ok: false, error: `signup failed: ${err?.message ?? String(err)}` },
      { status: 500 },
    );
  }
  client.release();

  const userAgent = req.headers.get('user-agent') ?? undefined;
  const sess = await createSession(userUuid, { kind: 'email', userAgent });

  const res = NextResponse.json<SuccessBody>({
    ok: true,
    redirect: '/onboarding',
    token: sess.token,
    expires_at: sess.expiresAt,
    user_uuid: userUuid,
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
