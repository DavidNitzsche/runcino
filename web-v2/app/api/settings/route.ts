/**
 * GET  /api/settings        → UserSettings (merged w/ defaults)
 * PATCH /api/settings {...} → partial update; merges into profile.user_settings
 */
import { NextRequest, NextResponse } from 'next/server';
import { loadSettings, patchSettings } from '@/lib/coach/settings';
import { requireUserId } from '@/lib/auth/session';
import { rebuildActivePlanForPrefs } from '@/lib/plan/auto-rebuild';

// A plan-shaping day change re-runs generatePlan inline. Give it headroom.
export const maxDuration = 120;

const ALLOWED = new Set([
  'units_distance', 'units_temp', 'units_pace',
  'long_run_day', 'rest_day', 'quality_days', 'available_days',
  'briefing_time', 'push_enabled',
]);

// Changing which day is long / rest / quality reshapes the plan layout.
// available_days is included: it silently overrode long/rest/quality
// placement (P2-35) with no way to clear it from Settings, so exposing
// it as an editable/clearable field is itself a shaping change.
const PLAN_SHAPING = new Set(['long_run_day', 'rest_day', 'quality_days', 'available_days']);

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  try {
    const s = await loadSettings(userId);
    return NextResponse.json(s);
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
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
    // A long-run / rest / quality day change reshapes the plan layout →
    // rebuild the active race-prep OR goal-mode plan inline (2026-07-06 ·
    // P1-16; isolated — the save still succeeds if no plan exists or the
    // rebuild fails).
    const changedShaping = Object.keys(patch).filter((k) => PLAN_SHAPING.has(k));
    let replanned = false;
    if (changedShaping.length > 0) {
      const r = await rebuildActivePlanForPrefs(userId, changedShaping).catch(() => ({ ok: false }));
      replanned = !!r.ok;
    }
    return NextResponse.json({ ok: true, patch, replanned });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 });
  }
}
