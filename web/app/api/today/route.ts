/**
 * GET /api/today — the v4 TODAY page payload (new pipeline).
 *
 * Distinct from /api/coach/today which serves a legacy iOS contract.
 * This endpoint returns the new { voice, topics } payload powering the
 * v4 TODAY page on web + iOS.
 *
 * Response shape:
 *   { ok: true, cached: boolean, briefing, todayState, computedISO }
 *
 * Where:
 *   briefing.voice   — coach prose (paragraphs split by '\n\n')
 *   briefing.topics  — typed cards the coach raised (renderer maps each)
 *   briefing.state   — 'post-run' | 'pre-run' | 'rest' | etc.
 *   briefing.meta    — token usage + latency
 *   todayState       — full state the coach reasoned over (debugging + iOS supporting widgets)
 *
 * Cache invalidation:
 *  - new activity logged → latest_activity_id changes → cache miss
 *  - day rolls over → cache_date changes → cache miss
 *  - ?fresh=1 query param → bypass cache (debug only)
 *
 * Consumers: web /today React page · iOS native TODAY screen.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireActiveUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { loadTodayState } from '@/lib/coach/today-state';
import { generateTodayBriefing, type TodayBriefing } from '@/coach/today-briefing';

interface CachePayload {
  briefing: TodayBriefing;
  todayState: unknown;
  computedISO: string;
}

export async function GET(req: NextRequest) {
  let user;
  try { user = await requireActiveUser(); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }

  const bypass = req.nextUrl.searchParams.get('fresh') === '1';
  const tzOffsetHParam = req.nextUrl.searchParams.get('tzOffsetH');
  const tzOffsetH = tzOffsetHParam != null && !Number.isNaN(Number(tzOffsetHParam))
    ? Number(tzOffsetHParam) : undefined;

  const state = await loadTodayState(user.id, { tzOffsetH });
  const latestActivityId = state.actualToday?.id ?? '';

  if (!bypass) {
    const hit = await query<{ payload: CachePayload }>(
      `SELECT payload FROM coach_today_cache
        WHERE cache_date = $1::date
          AND latest_activity_id = $2::bigint
        ORDER BY computed_at DESC LIMIT 1`,
      [state.today, latestActivityId === '' ? 0 : Number(latestActivityId)],
    ).catch(() => [] as { payload: CachePayload }[]);
    if (hit[0]?.payload) {
      return NextResponse.json({ ok: true, cached: true, ...hit[0].payload });
    }
  }

  const briefing = await generateTodayBriefing(state);
  const payload: CachePayload = {
    briefing,
    todayState: state,
    computedISO: new Date().toISOString(),
  };

  // Cache write — best effort; failures are fine, just recompute next time.
  await query(
    `INSERT INTO coach_today_cache (cache_date, latest_activity_id, payload, computed_at)
     VALUES ($1::date, $2::bigint, $3::jsonb, NOW())`,
    [state.today, latestActivityId === '' ? 0 : Number(latestActivityId), JSON.stringify(payload)],
  ).catch(() => { /* swallow */ });

  return NextResponse.json({ ok: true, cached: false, ...payload });
}
