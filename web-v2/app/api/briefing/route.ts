/**
 * GET /api/briefing
 *
 * Returns { lead, voice, topics[] } for the current user + surface + mode.
 * Phase 0 stub: returns a fixed shape so the client renders end-to-end before
 * the engine is productionized. Phase 1 replaces this with the real briefing
 * service backed by mockup-today.mjs logic + topic-prereq enforcement.
 *
 * Query params:
 *   surface   one of: today | training | races | race-detail | health | profile
 *   mode      surface-specific: today=post-run|pre-run|rest|race-day, etc.
 *   user_id   uuid (defaults to David in dev)
 */
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const surface = params.get('surface') ?? 'today';
  const mode    = params.get('mode')    ?? 'post-run';

  // Phase 0 stub: literal payload from the locked v4 mockup. Phase 1 will
  // replace this body with the briefing service output.
  return NextResponse.json({
    surface,
    mode,
    lead: 'Solid long run this morning.',
    voice: [
      "11.1 miles at 8:50 with HR sitting at 140 — exactly the engine work we wanted. **40.5 of 41.2** for the week, basically perfect.",
      "Cadence held at 160. That's fine for easy work, but I want to run a small experiment on turnover once we have your height in — leg length drives the right target.",
      "Sleep's been short all week — 6.8h average. Not the danger zone yet, but a full week of deficit compounds. Aim for 7.5 tonight.",
      "Threshold Tuesday is the first real quality of this build. We're 84 days out from AFC — time to start applying pressure.",
    ],
    topics: [],
    _scaffold: true,
    _note: 'Phase 0 stub. Phase 1 replaces with real briefing service.',
  });
}
