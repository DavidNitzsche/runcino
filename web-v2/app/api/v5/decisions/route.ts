/**
 * GET /api/v5/decisions · the runner's decision history.
 *
 * V5PROPOSALSURFACE-1 (2026-09-05). Every adaptation this engine has ever
 * proposed, accepted, declined, deferred, expired, applied, superseded or
 * undone, in one list, newest first.
 *
 * ── WHY IT IS A SEPARATE ENDPOINT AND NOT A FIELD ON /api/v5/today ─────────
 *
 * `PRODUCT_UX_SIMPLIFICATION_DOCTRINE`: only surface information that changes
 * what the runner should understand or do next. History does not. It is
 * reached deliberately, from Settings, by a runner who wants to know what the
 * coach has been doing, and putting it on the Today payload would make every
 * morning's fetch carry a list nobody opened.
 *
 * ── THE FAILURE POSTURE ────────────────────────────────────────────────────
 *
 * `outage()` on a failed read, never an empty list. An empty history and a
 * failed history look identical on screen and mean opposite things, and this
 * is the surface built to prove the engine HAS decided things. Saying "nothing
 * yet" because Postgres blinked would be the exact bug this whole change is
 * about, on the screen that exists to expose it.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import { loadV5Decisions } from '@/lib/faff/v5-decisions';
import { outage } from '@/lib/route/failure';
import { runnerToday } from '@/lib/runtime/runner-tz';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  try {
    const today = await runnerToday(userId);
    const read = await loadV5Decisions(userId, today);
    if (!read.ok) return outage('v5/decisions', read.error);
    return NextResponse.json({ ok: true, decisions: read.decisions });
  } catch (err) {
    return outage('v5/decisions', err);
  }
}
