/**
 * goal-projection-resolve — "what does the race-pace brain say about this
 * runner's next A race, right now." One place, so the number the Races
 * card shows (app/api/v5/races/route.ts) and the number the daily snapshot
 * cron diffs day-over-day (for the projection-change push) are sourced the
 * same way and cannot silently drift apart.
 *
 * 2026-09-01 · P0 · resolves `lib/race/race-outlook.ts` for the next A race
 * and maps it through `raceProjectionFromOutlook`. Nothing is computed
 * here; this file only picks the race.
 */
import { loadRacesState, type RaceRow } from '@/lib/coach/races-state';
import { parseRaceTime } from './vdot';
import { raceProjectionFromOutlook, type RaceProjectionBasis } from './race-projection';
import { resolveRaceOutlookBySlug, type RaceOutlook } from '@/lib/race/race-outlook';

export interface ResolvedGoalProjection {
  raceSlug: string;
  raceName: string;
  goalSec: number | null;
  projectedSec: number | null;
  /** Which quantity of the outlook answered. */
  basis: RaceProjectionBasis | null;
  outlook: RaceOutlook | null;
}

function nextARace(racesState: Awaited<ReturnType<typeof loadRacesState>>): RaceRow | null {
  const upcomingAs = racesState.aRaces.filter((r) => !r.is_past).sort((a, b) => a.days - b.days);
  return upcomingAs[0] ?? racesState.aRace ?? null;
}

export async function resolveNextAGoalProjection(userUuid: string, todayISO?: string): Promise<ResolvedGoalProjection | null> {
  const racesState = await loadRacesState(userUuid);
  const nextA = nextARace(racesState);
  if (!nextA) return null;
  const goalSec = parseRaceTime(nextA.goal);
  const outlook = await resolveRaceOutlookBySlug(userUuid, nextA.slug, todayISO).catch(() => null);
  const resolved = raceProjectionFromOutlook(outlook);
  return {
    raceSlug: nextA.slug, raceName: nextA.name, goalSec,
    projectedSec: resolved.projectedSec, basis: resolved.basis, outlook,
  };
}
