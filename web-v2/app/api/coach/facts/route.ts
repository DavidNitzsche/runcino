/**
 * GET /api/coach/facts?surface=today&user_id=<uuid>&race=<slug>
 *
 * Returns a CoachFactBlock — a deterministic, structured list of CAPS-
 * tracked label / value / meta facts for the requested surface.
 *
 * ZERO LLM. ZERO Anthropic dependency. Pure DB reads + the
 * fact-reciter functions.
 *
 * Cardinal Rule #1 (PROJECT.md, locked 2026-05-28): "Zero LLM ·
 * anywhere · ever." This route is the only entry point the
 * BriefingLoader (web) and the iOS CoachFactsCard hit.
 */
import { NextRequest, NextResponse } from 'next/server';
import { loadGlanceState } from '@/lib/coach/glance-state';
import { loadTrainingState } from '@/lib/coach/training-state';
import { loadRacesState } from '@/lib/coach/races-state';
import { loadHealthState } from '@/lib/coach/health-state';
import { loadProfileState } from '@/lib/coach/profile-state';
import {
  reciteToday,
  recitePlan,
  reciteRaces,
  reciteRaceDetail,
  reciteHealth,
  reciteMe,
  type CoachFactBlock,
} from '@/lib/coach/fact-reciter';

// Pure DB reads only — no LLM call. Bounded by the slowest state loader,
// typically <300 ms. Keep the maxDuration tight so a stuck pool query
// surfaces fast rather than hanging the briefing UI.
export const maxDuration = 15;

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

// Same surface set the legacy /api/briefing accepted, plus a couple of
// friendly aliases ('plan'/'race-detail'/'me') so the new contract reads
// natural while still supporting clients that use the legacy keys.
const SURFACE_MAP: Record<string, 'today' | 'plan' | 'races' | 'race_detail' | 'health' | 'me'> = {
  today: 'today',
  plan: 'plan',
  training: 'plan',                // legacy alias
  races: 'races',
  race_detail: 'race_detail',
  'race-detail': 'race_detail',    // legacy alias
  health: 'health',
  me: 'me',
  profile: 'me',                   // legacy alias
};

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const raw = (params.get('surface') ?? 'today').toLowerCase();
  const surface = SURFACE_MAP[raw];
  const userId = params.get('user_id') ?? DAVID_USER_ID;
  const raceSlug = params.get('race') ?? undefined;

  if (!surface) {
    return NextResponse.json({
      error: `Unknown surface "${raw}". Allowed: ${Object.keys(SURFACE_MAP).join(', ')}.`,
    }, { status: 400 });
  }

  try {
    const block = await buildBlock(userId, surface, raceSlug);
    return NextResponse.json({ block });
  } catch (err: any) {
    return NextResponse.json({
      error: err?.message ?? String(err),
      stack: process.env.NODE_ENV === 'development' ? err?.stack : undefined,
    }, { status: 500 });
  }
}

// Allow POST too — easier to drive from forms / serverless clients with
// JSON bodies. Same shape, same response.
export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const raw = String(body?.surface ?? 'today').toLowerCase();
  const surface = SURFACE_MAP[raw];
  const userId = body?.user_id ?? DAVID_USER_ID;
  const raceSlug = body?.race ?? undefined;

  if (!surface) {
    return NextResponse.json({
      error: `Unknown surface "${raw}". Allowed: ${Object.keys(SURFACE_MAP).join(', ')}.`,
    }, { status: 400 });
  }

  try {
    const block = await buildBlock(userId, surface, raceSlug);
    return NextResponse.json({ block });
  } catch (err: any) {
    return NextResponse.json({
      error: err?.message ?? String(err),
    }, { status: 500 });
  }
}

async function buildBlock(
  userId: string,
  surface: 'today' | 'plan' | 'races' | 'race_detail' | 'health' | 'me',
  raceSlug: string | undefined,
): Promise<CoachFactBlock> {
  switch (surface) {
    case 'today': {
      const glance = await loadGlanceState(userId);
      return reciteToday(glance);
    }
    case 'plan': {
      const training = await loadTrainingState(userId);
      return recitePlan(training);
    }
    case 'races': {
      const races = await loadRacesState(userId);
      return reciteRaces(races);
    }
    case 'race_detail': {
      const races = await loadRacesState(userId);
      const all = [...races.aRaces, ...races.upcomingBs, ...races.upcomingCs, ...races.past];
      const race = raceSlug
        ? all.find((r) => r.slug === raceSlug)
        : (races.aRace ?? all[0]);
      if (!race) {
        return {
          surface: 'race_detail',
          facts: [{
            label: 'RACE',
            value: '—',
            meta: raceSlug ? `no race with slug "${raceSlug}"` : 'no races on the calendar',
          }],
        };
      }
      // Glance optional — only as defensive context.
      let glance = null;
      try { glance = await loadGlanceState(userId); } catch { /* non-fatal */ }
      return reciteRaceDetail(race, glance);
    }
    case 'health': {
      const health = await loadHealthState(userId);
      return reciteHealth(health);
    }
    case 'me': {
      const profile = await loadProfileState(userId);
      return reciteMe(profile);
    }
  }
}
