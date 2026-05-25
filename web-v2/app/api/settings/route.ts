/**
 * GET  /api/settings        → UserSettings (merged w/ defaults)
 * PATCH /api/settings {...} → partial update; merges into profile.user_settings
 */
import { NextRequest, NextResponse } from 'next/server';
import { loadSettings, patchSettings } from '@/lib/coach/settings';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

const ALLOWED = new Set([
  'units_distance', 'units_temp', 'units_pace',
  'long_run_day', 'rest_day', 'quality_days',
  'briefing_time', 'push_enabled',
]);

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('user_id') ?? DAVID_USER_ID;
  try {
    const s = await loadSettings(userId);
    return NextResponse.json(s);
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const userId = body.user_id ?? DAVID_USER_ID;
  const patch: any = {};
  for (const k of Object.keys(body)) {
    if (k === 'user_id') continue;
    if (!ALLOWED.has(k)) {
      return NextResponse.json({ error: `not allowed: ${k}` }, { status: 400 });
    }
    patch[k] = body[k];
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'nothing to save' }, { status: 400 });
  }
  try {
    await patchSettings(userId, patch);
    return NextResponse.json({ ok: true, patch });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 });
  }
}
