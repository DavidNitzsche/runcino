/**
 * GET /api/coach/recovery-brief
 *
 * Returns the post-run RecoveryBrief envelope for the authenticated
 * runner. Shipped paired with the iPhone agent's TodayView post-run
 * pivot.
 *
 * Pairs with:
 *   · designs/briefs/today-postrun-pivot.md            (design spec)
 *   · designs/briefs/today-postrun-pivot-execution.md  (engineering split)
 *
 * Output shape · RecoveryBrief defined in lib/coach/recovery-brief.ts.
 * Returns the shape DIRECTLY (not wrapped in { ok, brief }) per the
 * iPhone agent's stated preference in their forward-compat handoff.
 *
 * Returns 200 with `null` body when:
 *   · No run today (`todayRunDone === false`)
 *   · True cold-start (no HRV + RHR baseline)
 *
 * iPhone gates the post-run UI swap on `todayRunDone` from the existing
 * state envelope (state-loader populates it). This endpoint always
 * returns 200 so iPhone's Decodable shape stays simple · `RecoveryBrief?`
 * decode from a null body.
 *
 * Mode selection:
 *   · `state.todayRunLong === true` → mode='long_run'
 *   · else                          → mode='standard'
 *
 * The iPhone agent's handoff allows passing `?mode=` to force a mode
 * for screenshot QA, but in production we derive from state.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import { loadCoachState } from '@/lib/coach/state-loader';
import { loadRecoveryBrief, type RecoveryMode } from '@/lib/coach/recovery-brief';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const url = new URL(req.url);
  const modeParam = url.searchParams.get('mode');
  const forcedMode: RecoveryMode | null =
    modeParam === 'long_run' || modeParam === 'standard' ? (modeParam as RecoveryMode) : null;

  try {
    const state = await loadCoachState(userId);
    if (!state.todayRunDone) {
      // No run today · iPhone stays in morning mode, hides the recovery
      // view. Return 200 with null body so the iPhone's optional decode
      // doesn't error on a 404.
      return NextResponse.json(null);
    }
    const mode: RecoveryMode = forcedMode ?? (state.todayRunLong ? 'long_run' : 'standard');
    const brief = await loadRecoveryBrief(userId, state, mode);
    // brief is null on true cold-start · same handling as no-run case.
    return NextResponse.json(brief);
  } catch (e) {
    console.error('[api/coach/recovery-brief] failed:', e instanceof Error ? e.message : String(e));
    // Degrade to null rather than 500 · the recovery view is a nice-to-
    // have surface, not load-bearing. iPhone falls back to morning mode.
    return NextResponse.json(null);
  }
}
