/**
 * goal-projection-resolve — "what does computeGoalProjection say about this
 * runner's next A race, right now." One place, so the number the Races
 * card shows (app/api/v5/races/route.ts) and the number the daily snapshot
 * cron diffs day-over-day (for the projection-change push) are sourced the
 * same way and cannot silently drift apart.
 *
 * Mirrors app/api/v5/races/route.ts's inline resolution, minus its
 * assessGoal() cold-start fallback (currentEquivalentSec) — that fallback
 * only matters before any VDOT has ever been read, and when it does apply
 * it's derived from the same predictRaceTime(vdot, distance) this already
 * falls back to. Not worth threading assessGoal's full weeklyMi/taper
 * context through the cron for that edge case.
 */
import { loadRacesState, type RaceRow } from '@/lib/coach/races-state';
import { loadLatestVdotWithAnchor } from './projection-snapshots';
import { parseRaceTime, predictRaceTime } from './vdot';
import { computeGoalProjection } from './goal-projection';

export interface ResolvedGoalProjection {
  raceSlug: string;
  raceName: string;
  goalSec: number | null;
  projectedSec: number | null;
}

function nextARace(racesState: Awaited<ReturnType<typeof loadRacesState>>): RaceRow | null {
  const upcomingAs = racesState.aRaces.filter((r) => !r.is_past).sort((a, b) => a.days - b.days);
  return upcomingAs[0] ?? racesState.aRace ?? null;
}

export async function resolveNextAGoalProjection(userUuid: string): Promise<ResolvedGoalProjection | null> {
  const racesState = await loadRacesState(userUuid);
  const nextA = nextARace(racesState);
  if (!nextA) return null;

  const distanceMi = nextA.distance_mi;
  const goalSec = parseRaceTime(nextA.goal);
  const goalDateISO = nextA.date;

  const { vdot, anchorDateISO, anchorDistanceMi } = await loadLatestVdotWithAnchor(userUuid);

  const goalProjection = (distanceMi != null && distanceMi > 0 && goalSec != null && goalDateISO)
    ? await computeGoalProjection({
        userUuid,
        goalSec,
        raceDistanceMi: distanceMi,
        vdot,
        daysToRace: nextA.days,
        vdotAnchorDateISO: anchorDateISO,
        vdotAnchorDistanceMi: anchorDistanceMi,
      }).catch(() => null)
    : null;

  const projectedSec = goalProjection?.trajectory?.projectedSec
    ?? goalProjection?.vdotProjectionSec
    ?? (vdot != null && distanceMi ? predictRaceTime(vdot, distanceMi) : null);

  return { raceSlug: nextA.slug, raceName: nextA.name, goalSec, projectedSec };
}
