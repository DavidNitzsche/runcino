/**
 * GET /api/races/coach — coach voice + topics for the /races page.
 *
 * Reads RacesState, runs the LLM via races-briefing, returns the
 * { voice, topics } payload. Same shape pattern as /api/today.
 *
 * No cache yet — race calendar changes infrequently but isn't keyed
 * on activity. Add caching if it becomes hot.
 */

import { NextResponse } from 'next/server';
import { requireActiveUser } from '@/lib/auth';
import { loadRacesState } from '@/lib/coach/races-state';
import { generateRacesBriefing } from '@/coach/races-briefing';

export async function GET() {
  let user;
  try { user = await requireActiveUser(); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }

  const state = await loadRacesState(user.id);
  const briefing = await generateRacesBriefing(state);

  return NextResponse.json({ ok: true, briefing, state });
}
