/**
 * /api/injury — active injury log.
 *
 * GET                  → { ok, active: RunnerInjury | null, history: RunnerInjury[] }
 * POST { site, severity?, returnProtocol?, notes?, startDate?, expectedReturnDate? }
 *                      → { ok, injury }
 * PATCH { id, resolve?: true | resolvedDate?: 'YYYY-MM-DD', returnProtocol? }
 *                      → { ok }
 *
 * Mode trigger: when active = non-null, the coach enters INJURY mode.
 * Per docs/COACH_VOICE_AUDIT_AND_REWRITE.md §7.4.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  getActiveInjury,
  listInjuries,
  createInjury,
  resolveInjury,
  updateInjuryProtocol,
  type RunnerInjury,
} from '@/lib/injury-store';
import { invalidate } from '@/lib/coach-reads-cache';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ ok: false, error: 'auth required' }, { status: 401 });
  const [active, history] = await Promise.all([
    getActiveInjury(user.id),
    listInjuries(user.id),
  ]);
  return NextResponse.json({ ok: true, active, history });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ ok: false, error: 'auth required' }, { status: 401 });

  let body: Partial<RunnerInjury> & { site?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 }); }
  if (!body.site || typeof body.site !== 'string') {
    return NextResponse.json({ ok: false, error: 'site is required' }, { status: 400 });
  }

  const injury = await createInjury({
    userUuid: user.id,
    site: body.site,
    severity: (body.severity as RunnerInjury['severity']) ?? 'minor',
    returnProtocol: body.returnProtocol ?? null,
    notes: body.notes ?? null,
    startDate: body.startDate ?? undefined,
    expectedReturnDate: body.expectedReturnDate ?? null,
  });

  // Mode shift invalidates everything — the coach's reads change shape.
  await invalidate(user.id, 'prescription-chain');
  await invalidate(user.id, 'readiness');

  return NextResponse.json({ ok: true, injury });
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ ok: false, error: 'auth required' }, { status: 401 });

  let body: { id?: number; resolve?: boolean; resolvedDate?: string; returnProtocol?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 });

  if (body.resolve || body.resolvedDate) {
    await resolveInjury(body.id, user.id, body.resolvedDate);
    await invalidate(user.id, 'prescription-chain');
    await invalidate(user.id, 'readiness');
  }
  if (body.returnProtocol) {
    await updateInjuryProtocol(body.id, user.id, body.returnProtocol);
  }
  return NextResponse.json({ ok: true });
}
