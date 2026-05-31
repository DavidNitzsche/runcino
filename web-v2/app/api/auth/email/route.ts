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
import { createSession } from '@/lib/auth/session';

const SESSION_COOKIE = 'faff_session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

interface SuccessBody { ok: true; redirect: '/today' | '/onboarding'; }
interface ErrorBody   { ok: false; error: string; }

export async function POST(req: NextRequest): Promise<NextResponse<SuccessBody | ErrorBody>> {
  let body: { email?: unknown; password?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 }); }

  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
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
  let bootstrapped = false;
  if (userRow.is_admin === true && userRow.email_verified_at == null) {
    const newHash = await bcrypt.hash(password, 12);
    await pool.query(
      `UPDATE users SET password_hash = $1, email_verified_at = NOW(), updated_at = NOW()
        WHERE id = $2`,
      [newHash, userRow.user_uuid],
    );
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

  const redirect: '/today' | '/onboarding' = userRow.onboarding_complete ? '/today' : '/onboarding';
  const res = NextResponse.json<SuccessBody>({ ok: true, redirect });
  res.cookies.set(SESSION_COOKIE, sess.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
  return res;
}
