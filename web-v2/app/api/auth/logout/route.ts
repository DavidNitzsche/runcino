/**
 * POST /api/auth/logout · revoke the current session + clear the cookie.
 *
 * 2026-06-10 (David: "no way to sign out if you're already logged in") —
 * the web never needed sign-out in the single-user era. Revokes the
 * session row server-side (revoked_at, same mechanism the iPhone's
 * sign-out relies on) and expires the faff_session cookie. Token may
 * arrive as cookie (web) or Bearer (API clients). No-op without one —
 * still answers ok and clears the cookie, so a stale client can always
 * get to a clean state.
 */
import { NextRequest, NextResponse } from 'next/server';
import { revokeSession } from '@/lib/auth/session';

export async function POST(req: NextRequest) {
  const header = req.headers.get('authorization') ?? '';
  const bearer = header.match(/^Bearer\s+([A-Za-z0-9._\-]+)$/)?.[1] ?? null;
  const cookie = (req.headers.get('cookie') ?? '').match(/(?:^|;\s*)faff_session=([A-Za-z0-9._\-]+)/)?.[1] ?? null;
  const token = bearer ?? cookie;

  if (token) {
    await revokeSession(token).catch(() => {});
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set('faff_session', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return res;
}
