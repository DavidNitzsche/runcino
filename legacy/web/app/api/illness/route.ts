/**
 * /api/illness — active illness log.
 *
 * GET                  → { ok, active: RunnerIllness | null, history: RunnerIllness[] }
 * POST { kind, severity?, aboveNeck?, notes?, startDate? }  → { ok, illness }
 * PATCH { id, resolve?: true | resolvedDate?: 'YYYY-MM-DD' } → { ok }
 *
 * Mode trigger: when active = non-null, the coach enters ILLNESS mode.
 * Per docs/COACH_VOICE_AUDIT_AND_REWRITE.md §7.5.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  getActiveIllness, listIllnesses, createIllness, resolveIllness,
  type IllnessKind, type IllnessSeverity,
} from '@/lib/illness-store';
import { invalidate } from '@/lib/coach-reads-cache';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ ok: false, error: 'auth required' }, { status: 401 });
  const [active, history] = await Promise.all([
    getActiveIllness(user.id),
    listIllnesses(user.id),
  ]);
  return NextResponse.json({ ok: true, active, history });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ ok: false, error: 'auth required' }, { status: 401 });

  let body: { kind?: IllnessKind; severity?: IllnessSeverity; aboveNeck?: boolean; notes?: string; startDate?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 }); }
  if (!body.kind) return NextResponse.json({ ok: false, error: 'kind is required' }, { status: 400 });

  const illness = await createIllness({
    userUuid: user.id,
    kind: body.kind,
    severity: body.severity ?? 'mild',
    aboveNeck: body.aboveNeck ?? true,
    notes: body.notes ?? null,
    startDate: body.startDate,
  });

  await invalidate(user.id, 'prescription-chain');
  await invalidate(user.id, 'readiness');

  return NextResponse.json({ ok: true, illness });
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ ok: false, error: 'auth required' }, { status: 401 });

  let body: { id?: number; resolve?: boolean; resolvedDate?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 });

  if (body.resolve || body.resolvedDate) {
    await resolveIllness(body.id, user.id, body.resolvedDate);
    await invalidate(user.id, 'prescription-chain');
    await invalidate(user.id, 'readiness');
  }
  return NextResponse.json({ ok: true });
}
