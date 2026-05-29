/**
 * GET /api/briefing?surface=today&user_id=<uuid>
 *
 * LEGACY ROUTE — preserved for backward compatibility with the iOS app
 * and any external caller still hitting it. Now a thin adapter over
 * /api/coach/facts.
 *
 * 2026-05-28 · Cardinal Rule #1 (PROJECT.md, locked 2026-05-28): "Zero
 * LLM · anywhere · ever." The old Anthropic tool-use engine is deleted.
 * This route used to return { lead, voice[], topics[] } from an LLM
 * call; now it returns the same envelope, derived deterministically
 * from the CoachFactBlock the fact-reciter produces.
 *
 * Voice contract for legacy clients:
 *   lead    = first fact as "LABEL · VALUE [· meta]"
 *   voice[] = each remaining fact as the same "LABEL · VALUE [· meta]" line
 *   topics  = [] (the old typed Topic cards belonged to the LLM era;
 *              the new UI consumes the fact block directly via
 *              /api/coach/facts and ignores `topics`)
 *
 * Prefer /api/coach/facts for new clients.
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
import { buildPoster, resolveDayState } from '@/lib/faff/glance-adapter';
import type { PosterBreakdownRow } from '@/lib/faff/types';

// Pure DB reads now — no LLM tail latency. 15s is more than enough.
export const maxDuration = 15;

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';
const SURFACE_ALIASES: Record<string, 'today' | 'plan' | 'races' | 'race_detail' | 'health' | 'me'> = {
  today: 'today',
  training: 'plan',
  plan: 'plan',
  races: 'races',
  race_detail: 'race_detail',
  'race-detail': 'race_detail',
  health: 'health',
  profile: 'me',
  me: 'me',
};

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const surfaceParam = (params.get('surface') ?? 'today').toLowerCase();
  const surface = SURFACE_ALIASES[surfaceParam];
  const userId = params.get('user_id') ?? DAVID_USER_ID;
  const raceSlug = params.get('race') ?? undefined;

  if (!surface) {
    return NextResponse.json({ error: `Invalid surface: ${surfaceParam}` }, { status: 400 });
  }

  try {
    const { block, workoutBreakdown } = await buildBlock(userId, surface, raceSlug);
    return NextResponse.json(legacyEnvelopeOf(block, surfaceParam, userId, workoutBreakdown));
  } catch (err: any) {
    return NextResponse.json({
      error: err?.message ?? String(err),
      stack: process.env.NODE_ENV === 'development' ? err?.stack : undefined,
    }, { status: 500 });
  }
}

async function buildBlock(
  userId: string,
  surface: 'today' | 'plan' | 'races' | 'race_detail' | 'health' | 'me',
  raceSlug: string | undefined,
): Promise<{ block: CoachFactBlock; workoutBreakdown?: PosterBreakdownRow[] | null }> {
  switch (surface) {
    case 'today': {
      const glance = await loadGlanceState(userId);
      const block = reciteToday(glance);
      // #163 · single source of truth: the Today poster's workout breakdown
      // is computed by the SAME buildPoster() the web /today renders, so the
      // iOS poster mirrors web exactly instead of re-deriving it client-side.
      const poster = buildPoster(glance, resolveDayState(glance));
      return { block, workoutBreakdown: poster.workout_breakdown };
    }
    case 'plan': {
      const training = await loadTrainingState(userId);
      return { block: recitePlan(training) };
    }
    case 'races': {
      const races = await loadRacesState(userId);
      return { block: reciteRaces(races) };
    }
    case 'race_detail': {
      const races = await loadRacesState(userId);
      const all = [...races.aRaces, ...races.upcomingBs, ...races.upcomingCs, ...races.past];
      const race = raceSlug
        ? all.find((r) => r.slug === raceSlug)
        : (races.aRace ?? all[0]);
      if (!race) {
        return {
          block: {
            surface: 'race_detail',
            facts: [{
              label: 'RACE',
              value: '—',
              meta: raceSlug ? `no race with slug "${raceSlug}"` : 'no races on the calendar',
            }],
          },
        };
      }
      let glance = null;
      try { glance = await loadGlanceState(userId); } catch { /* non-fatal */ }
      return { block: reciteRaceDetail(race, glance) };
    }
    case 'health': {
      const health = await loadHealthState(userId);
      return { block: reciteHealth(health) };
    }
    case 'me': {
      const profile = await loadProfileState(userId);
      return { block: reciteMe(profile) };
    }
  }
}

/**
 * Adapt a CoachFactBlock into the { lead, voice[], topics[] } shape
 * the old BriefingResponse used. Lets legacy clients keep working.
 */
function legacyEnvelopeOf(
  block: CoachFactBlock,
  surfaceParam: string,
  userId: string,
  workoutBreakdown?: PosterBreakdownRow[] | null,
): {
  surface: string;
  mode: string;
  lead: string;
  voice: string[];
  topics: unknown[];
  workout_breakdown: PosterBreakdownRow[] | null;
  block: CoachFactBlock;
  _state: { user_id: string; today: string };
} {
  const fmt = (f: { label: string; value: string; meta?: string }) =>
    `${f.label} · ${f.value}${f.meta ? ' · ' + f.meta : ''}`;
  const [first, ...rest] = block.facts;
  const lead = first ? fmt(first) : '';
  const voice = rest.map(fmt);
  const today = new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);
  return {
    surface: surfaceParam,
    mode: block.state ?? 'facts',
    lead,
    voice,
    topics: [],
    workout_breakdown: workoutBreakdown ?? null,
    block,
    _state: { user_id: userId, today },
  };
}
