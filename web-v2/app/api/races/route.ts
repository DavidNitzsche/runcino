/**
 * GET /api/races — race list for the iPhone /races tab.
 *
 * Returns the same data the web /races page renders via loadRacesState:
 * upcoming A/B/C bucket + past races (with finish-time enrichment).
 * Trimmed to the fields the iPhone tab actually displays (slug, name,
 * date, priority, distance_label, location, days_to_race).
 *
 * 2026-05-27: shipped after the iPhone parity audit found /races was
 * showing only the coach brief + topic cards, no race list. Web shows
 * brief + full list.
 *
 * Note: /api/race (singular) handles CRUD (POST/PATCH/DELETE) per race;
 * /api/races (plural) is the read-only list endpoint.
 */
import { NextRequest, NextResponse } from 'next/server';
import { loadRacesState } from '@/lib/coach/races-state';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('user_id') ?? DAVID_USER_ID;
  try {
    const state = await loadRacesState(userId);
    // Concatenate upcoming + past, soonest-first. iPhone splits visually
    // by its own priority bucket if needed; for now, flat chronological
    // matches the simplest list rendering.
    const races = [
      ...state.aRaces.filter((r) => !r.is_past),
      ...state.upcomingBs,
      ...state.upcomingCs,
      ...state.past,
    ].map((r) => ({
      slug: r.slug,
      name: r.name,
      date: r.date || null,
      priority: r.priority,
      distance_label: r.distance_label,
      location: r.location,
      days_to_race: r.days,
    }));
    return NextResponse.json({ races });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 });
  }
}
