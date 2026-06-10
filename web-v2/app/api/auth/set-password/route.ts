/**
 * POST /api/auth/set-password · { password }
 *
 * First-login step for approved runners: they signed in with the temp
 * password David's approval generated; this stores their own and stamps
 * email_verified_at (the "runner chose their credentials" marker the
 * login redirect checks). Requires a live session — the temp password
 * IS valid for login, it just routes here first.
 */
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;

  let body: { password?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 }); }

  const password = typeof body.password === 'string' ? body.password : '';
  if (password.length < 6) {
    return NextResponse.json({ ok: false, error: 'password must be at least 6 characters' }, { status: 400 });
  }
  if (password.length > 200) {
    return NextResponse.json({ ok: false, error: 'password too long' }, { status: 400 });
  }

  const hash = await bcrypt.hash(password, 12);
  await pool.query(
    `UPDATE users SET password_hash = $1, email_verified_at = NOW(), updated_at = NOW()
      WHERE id = $2`,
    [hash, auth],
  );

  const ob = (await pool.query<{ onboarding_complete: boolean }>(
    `SELECT onboarding_complete FROM users WHERE id = $1 LIMIT 1`,
    [auth],
  ).catch(() => ({ rows: [] as Array<{ onboarding_complete: boolean }> }))).rows[0];

  return NextResponse.json({
    ok: true,
    redirect: ob?.onboarding_complete ? '/today' : '/onboarding',
  });
}
