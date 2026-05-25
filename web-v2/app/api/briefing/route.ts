/**
 * GET /api/briefing?surface=today&mode=auto&user_id=<uuid>
 *
 * Calls the coach engine (state loader → router → prereqs → LLM) and returns
 * { lead, voice, topics } for the requested surface.
 *
 * Caches in-memory for 5 minutes per (user, date, surface) since the LLM
 * call is expensive; cache key includes latest activity id + check-in id so
 * a new run / check-in busts it.
 */
import { NextRequest, NextResponse } from 'next/server';
import { generateBriefing } from '@/lib/coach/engine';
import type { Surface } from '@/lib/coach/router';

const DAVID_USER_ID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const VALID_SURFACES: Surface[] = ['today', 'training', 'races', 'race-detail', 'health', 'profile'];

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const surfaceParam = (params.get('surface') ?? 'today') as Surface;
  const userId = params.get('user_id') ?? DAVID_USER_ID;
  const raceSlug = params.get('race') ?? undefined;

  if (!VALID_SURFACES.includes(surfaceParam)) {
    return NextResponse.json({ error: `Invalid surface: ${surfaceParam}` }, { status: 400 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({
      error: 'ANTHROPIC_API_KEY not set — coach engine offline. Provide .env.local with the key or run against the stub by deleting the env var check.',
    }, { status: 503 });
  }

  try {
    const briefing = await generateBriefing(userId, surfaceParam, raceSlug);
    return NextResponse.json(briefing);
  } catch (err: any) {
    return NextResponse.json({
      error: err.message ?? String(err),
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    }, { status: 500 });
  }
}
