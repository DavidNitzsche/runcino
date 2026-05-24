/**
 * /api/coach/mode — the active coach mode + banner + voice line.
 *
 * GET → { ok, mode, onboardingStage, activeInjury, activeIllness,
 *          overrides, banner, modeVoice }
 *
 * Single source of truth for which mode the coach is in. Web pages,
 * iOS shell, and watch token surfaces all consume this so the mode
 * is consistent across surfaces. Per spec §7.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { gatherCoachState } from '@/lib/coach-state';
import { getCoachModeContext } from '@/coach/coach-modes';
import { todayISO, userTimezone } from '@/lib/synthetic-plan';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req);
  const today = todayISO(user?.timezone || userTimezone(user?.location));

  // Anonymous callers get the legacy single-user state for preview
  // surfaces; mode resolves against that.
  const state = await gatherCoachState({ userId: user?.id });
  const ctx = await getCoachModeContext(state, user?.id, today);

  return NextResponse.json({ ok: true, today, ...ctx });
}
