/**
 * POST /api/auth/request-access · { name, email }
 *
 * The public door now that open signup is OFF (invite-only, David
 * 2026-06-10). Records a pending users row + notifies David (ops alert
 * always · email when RESEND_API_KEY is configured). Response is the
 * same whether the email is new, pending, or active — the login page
 * can't be used to enumerate accounts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { authRateLimited } from '@/lib/auth/rate-limit';
import { createAccessRequest } from '@/lib/auth/access-requests';

export async function POST(req: NextRequest) {
  if (authRateLimited(req)) {
    return NextResponse.json({ ok: false, error: 'too many attempts — try again in a few minutes' }, { status: 429 });
  }
  let body: { name?: unknown; email?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 }); }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (!name || name.length > 80) {
    return NextResponse.json({ ok: false, error: 'name required' }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return NextResponse.json({ ok: false, error: 'enter a valid email address' }, { status: 400 });
  }

  await createAccessRequest(name, email);
  return NextResponse.json({ ok: true, message: 'Request received. You will get an email when access is approved.' });
}
