/**
 * GET  /api/settings        → UserSettings (merged w/ defaults)
 * PATCH /api/settings {...} → partial update; merges into profile.user_settings
 */
import { NextRequest, NextResponse } from 'next/server';
import { loadSettings, patchSettings } from '@/lib/coach/settings';
import { requireUserId } from '@/lib/auth/session';
import { rebuildActivePlanForPrefs } from '@/lib/plan/auto-rebuild';
import { resolveReplanOutcome, REPLAN_NOT_ATTEMPTED } from '@/lib/plan/replan-outcome';

// A plan-shaping day change re-runs generatePlan inline. Give it headroom.
export const maxDuration = 120;

const ALLOWED = new Set([
  'units_distance', 'units_temp', 'units_pace',
  'long_run_day', 'rest_day', 'quality_days', 'available_days',
  'briefing_time', 'push_enabled',
  // 2026-08-19 · "Start runs from this phone." Reveals the RUN pill on the
  // iPhone. Not plan-shaping — it changes what the phone offers, never what
  // the plan prescribes, so it deliberately stays out of PLAN_SHAPING.
  'phone_run_enabled',
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
    // phone_run_enabled gates whether the phone offers to record a run at all.
    // Stored in jsonb, so a string "false" would persist and read back TRUTHY
    // on every consumer. Reject anything that isn't a real boolean rather than
    // coercing — a client sending the wrong type should learn that it did.
    if (k === 'phone_run_enabled' && typeof body[k] !== 'boolean') {
      return NextResponse.json(
        { error: 'phone_run_enabled must be a boolean' },
        { status: 400 },
      );
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
    //
    /* REBUILDTRUTH-1 sibling (2026-09-09) · this PATCH carried the identical
     * defect already fixed in `/api/profile`'s PATCH: `replanned = !!r.ok`
     * read TRUE for `deduped_within_30s` (nothing ran) and `unchanged` (ran,
     * rolled back — `auto-rebuild.ts` itself distinguishes this precisely)
     * exactly as much as for a real replan, and the old `.catch(() => ({ ok:
     * false }))` discarded WHY a thrown rebuild failed. Same fix as the
     * sibling, and now the SAME resolver (`resolveReplanOutcome`, Rule 16 —
     * one quantity, one name) so the two routes cannot drift back apart. */
    const changedShaping = Object.keys(patch).filter((k) => PLAN_SHAPING.has(k));
    const outcome = changedShaping.length > 0
      ? resolveReplanOutcome(
          await rebuildActivePlanForPrefs(userId, changedShaping)
            .catch((e: unknown) => ({
              ok: false,
              // Rule 11 · a swallowed throw is not "the rebuild declined".
              reason: `the rebuild threw: ${e instanceof Error ? e.message : String(e)}`,
            } as Awaited<ReturnType<typeof rebuildActivePlanForPrefs>>)),
        )
      : REPLAN_NOT_ATTEMPTED;
    return NextResponse.json({ ok: true, patch, ...outcome });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 });
  }
}
