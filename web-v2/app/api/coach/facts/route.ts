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
//
// 2026-05-28 hang audit (BriefingLoader stuck on faff skeleton): the
// loader enforces a 3s client-side timeout independent of this value.
// We also wrap buildBlock() in a server-side race so a runaway pool
// query surfaces as a 504-ish JSON error rather than hanging the
// loader's fetch leg.
export const maxDuration = 15;

const SERVER_BUILD_TIMEOUT_MS = 4500;

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
    const block = await buildBlockBounded(userId, surface, raceSlug);
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
    const block = await buildBlockBounded(userId, surface, raceSlug);
    return NextResponse.json({ block });
  } catch (err: any) {
    return NextResponse.json({
      error: err?.message ?? String(err),
    }, { status: 500 });
  }
}

/**
 * Server-side wrapper that races buildBlock against SERVER_BUILD_TIMEOUT_MS
 * so a runaway state-loader query returns a 500 fast instead of holding
 * the loader's fetch leg open. The loader's own 3s timer is the primary
 * guard; this is a defence in depth.
 */
async function buildBlockBounded(
  userId: string,
  surface: 'today' | 'plan' | 'races' | 'race_detail' | 'health' | 'me',
  raceSlug: string | undefined,
): Promise<CoachFactBlock> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutP = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`buildBlock(${surface}) timed out after ${SERVER_BUILD_TIMEOUT_MS}ms`)),
      SERVER_BUILD_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([
      buildBlock(userId, surface, raceSlug),
      timeoutP,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function buildBlock(
  userId: string,
  surface: 'today' | 'plan' | 'races' | 'race_detail' | 'health' | 'me',
  raceSlug: string | undefined,
): Promise<CoachFactBlock> {
  // 2026-05-28 hang audit: each surface is wrapped so a single broken
  // state-loader or reciter throws a TYPED block ({ state: 'error',
  // single fact line with the err message }) instead of bubbling up as a
  // 500. The route handler still returns 500 on a complete failure
  // (timeout, fatal), but the typical "field X was null and we touched
  // .y" case keeps the loader rendering rather than skeletoning.
  switch (surface) {
    case 'today': {
      try {
        const glance = await loadGlanceState(userId);
        return reciteToday(glance);
      } catch (e: any) {
        return errorBlock('today', e);
      }
    }
    case 'plan': {
      try {
        const training = await loadTrainingState(userId);
        return recitePlan(training);
      } catch (e: any) {
        return errorBlock('plan', e);
      }
    }
    case 'races': {
      try {
        const races = await loadRacesState(userId);
        return reciteRaces(races);
      } catch (e: any) {
        return errorBlock('races', e);
      }
    }
    case 'race_detail': {
      try {
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
      } catch (e: any) {
        return errorBlock('race_detail', e);
      }
    }
    case 'health': {
      try {
        const health = await loadHealthState(userId);
        return reciteHealth(health);
      } catch (e: any) {
        return errorBlock('health', e);
      }
    }
    case 'me': {
      try {
        const profile = await loadProfileState(userId);
        return reciteMe(profile);
      } catch (e: any) {
        return errorBlock('me', e);
      }
    }
  }
}

function errorBlock(
  surface: 'today' | 'plan' | 'races' | 'race_detail' | 'health' | 'me',
  err: { message?: string } | undefined,
): CoachFactBlock {
  if (process.env.NODE_ENV === 'development') {
    // eslint-disable-next-line no-console
    console.warn(`[/api/coach/facts] ${surface} reciter failed:`, err?.message ?? err);
  }
  return {
    surface,
    state: 'error',
    facts: [
      {
        label: `${surface.toUpperCase().replace('_', ' ')} · COACH`,
        value: 'facts unavailable',
        meta: process.env.NODE_ENV === 'development'
          ? (err?.message ?? 'unknown error')
          : 'try again in a moment',
      },
    ],
  };
}
