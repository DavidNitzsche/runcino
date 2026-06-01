/**
 * GET /api/readiness/brief
 *
 * iPhone-side feed for the full ReadinessBrief envelope. Returns the
 * SAME composed brief that web's `seed.readinessBrief` carries — both
 * surfaces consume the canonical `loadReadinessBrief()` composer from
 * lib/coach/readiness-brief.ts. Single source of truth.
 *
 * The redesigned Today panel taps into this surface for the "full
 * readiness brief" sheet (see designs/from Design agent/Readiness
 * brief page/ + designs/briefs/readiness-brief-iphone-surface-brief.md).
 *
 * Response shape mirrors `ReadinessBrief` from lib/coach/readiness-brief.ts
 * including: score / band / label / headline / oneLineMover / scoreTrend
 * (14 days) / pillars[] (5 with 14-day sparklines + confounders) /
 * streaks[] / movers[] / subjectiveOverride / subjectiveCheckin /
 * coldStart / trendNote / composition / watchTomorrow / gapReport.
 *
 * Returns `{ ok: false, brief: null }` for brand-new users with no
 * CoachState · iPhone renders the cold-start variant.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import { loadCoachState } from '@/lib/coach/state-loader';
import { loadReadinessBrief } from '@/lib/coach/readiness-brief';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  try {
    const state = await loadCoachState(userId);
    if (!state) {
      return NextResponse.json({ ok: false, brief: null });
    }
    const brief = await loadReadinessBrief(userId, state);
    return NextResponse.json({ ok: true, brief });
  } catch (err: any) {
    console.error('[api/readiness/brief] failed:', err);
    return NextResponse.json(
      { ok: false, brief: null, error: err?.message ?? 'lookup failed' },
      { status: 500 },
    );
  }
}
