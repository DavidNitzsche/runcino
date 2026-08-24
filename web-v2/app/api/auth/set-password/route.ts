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
import { logReadFailure, rowOrNull } from '@/lib/db/read';
import { outage } from '@/lib/route/failure';
import { requireUserId, revokeAllSessionsForUser, tokenFromRequest } from '@/lib/auth/session';

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

  // 2026-08-21 · multi-tenancy audit · a password change ends every other
  // session. Before this, a token minted under the OLD password stayed
  // valid for the rest of its 90-day life, so changing the password did
  // not put out anyone who already had access — which is the main reason
  // someone changes one. The caller's own session is spared so they stay
  // signed in on the device they just did this from.
  //
  // 2026-08-24 · swallowed-failure sweep · this was `.catch(() => 0)`, and the
  // UPDATE inside `revokeAllSessionsForUser` threw on every call (text/uuid
  // COALESCE — see that function). So the revocation never happened AND the
  // response below reported `other_sessions_ended: 0` as if it were a count.
  // The query is fixed; the count is now `null` when the revoke failed, so the
  // number on the wire is never a number we did not measure.
  let revoked: number | null;
  try {
    revoked = await revokeAllSessionsForUser(auth, { exceptToken: tokenFromRequest(req) });
  } catch (e) {
    logReadFailure('auth/set-password · revokeAllSessionsForUser', e);
    revoked = null;
  }

  // 2026-08-24 · swallowed-failure sweep · this was
  // `.catch(() => ({ rows: [] }))`, and the row it could not read decides where
  // the runner lands. A failed read became `ob === undefined` became
  // `onboarding_complete` falsy became `/onboarding` — so one dropped
  // connection sends a fully onboarded runner back through setup, with their
  // password already changed. Load-bearing: a failure is an outage, not a
  // destination.
  const ob = await rowOrNull<{ onboarding_complete: boolean }>(
    'auth/set-password · onboarding_complete',
    pool.query<{ onboarding_complete: boolean }>(
      `SELECT onboarding_complete FROM users WHERE id = $1 LIMIT 1`,
      [auth],
    ),
  );
  if (ob === null) return outage('auth/set-password', new Error('onboarding_complete read failed'));

  return NextResponse.json({
    ok: true,
    redirect: ob?.onboarding_complete ? '/today' : '/onboarding',
    other_sessions_ended: revoked,
  });
}
