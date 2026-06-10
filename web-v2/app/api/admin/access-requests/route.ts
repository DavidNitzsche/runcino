/**
 * /api/admin/access-requests · David's approval backend (requireAdmin).
 *
 *   GET  → { requests: [{id,email,name,status,created_at}] }  (pending + denied)
 *   POST { user_id, action: 'approve' | 'deny' }
 *        approve → temp password generated · returned in the RESPONSE
 *        (so David can share it manually while email is unconfigured)
 *        and emailed to the runner when RESEND_API_KEY is set.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/session';
import {
  approveAccessRequest,
  denyAccessRequest,
  listAccessRequests,
} from '@/lib/auth/access-requests';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ ok: true, requests: await listAccessRequests() });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  let body: { user_id?: unknown; action?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 }); }

  const userId = typeof body.user_id === 'string' ? body.user_id : '';
  const action = body.action === 'approve' || body.action === 'deny' ? body.action : null;
  if (!userId || !action) {
    return NextResponse.json({ ok: false, error: 'user_id and action (approve|deny) required' }, { status: 400 });
  }

  if (action === 'deny') {
    const r = await denyAccessRequest(userId);
    return r.ok
      ? NextResponse.json({ ok: true, denied: true })
      : NextResponse.json({ ok: false, error: r.error }, { status: 400 });
  }

  const r = await approveAccessRequest(userId, auth);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
  return NextResponse.json({
    ok: true,
    approved: true,
    email: r.email,
    // Shown ONCE in the admin UI · only a bcrypt hash is stored.
    temp_password: r.tempPassword,
    emailed: r.emailed,
  });
}
