/**
 * goal-projection-resolve — "what does computeGoalProjection say about this
 * runner's next A race, right now." One place, so the number the Races
 * card shows (app/api/v5/races/route.ts) and the number the daily snapshot
 * cron diffs day-over-day (for the projection-change push) are sourced the
 * same way and cannot silently drift apart.
 *
 * 2026-09-01 · the final precedence step now CALLS `resolveRaceProjection`
 * (`lib/training/race-projection.ts`) instead of reimplementing its
 * trajectory → vdotProjectionSec → raw-equivalence precedence inline. This
 * file's own header used to say it "mirrors app/api/v5/races/route.ts's
 * inline resolution" — a hand copy of the canonical resolver's logic, kept
 * in sync by nobody. It agreed with the resolver because it was written to,
 * not because anything enforced it (no test equivalent to
 * `_goal_immutability.test.ts`'s import-regex check existed for this file —
 * see docs/reports/race-prediction-external-review-2026-08-31.md §2.3).
 * Now there is exactly one implementation of the precedence to drift from.
 */
import { loadRacesState, type RaceRow } from '@/lib/coach/races-state';
import { loadLatestVdotWithAnchor } from './projection-snapshots';
import { parseRaceTime } from './vdot';
import { computeGoalProjection } from './goal-projection';
import { resolveRaceProjection, type RaceProjectionBasis } from './race-projection';

export interface ResolvedGoalProjection {
  raceSlug: string;
  raceName: string;
  goalSec: number | null;
  projectedSec: number | null;
  /** Which rung of `resolveRaceProjection`'s precedence answered. */
  basis: RaceProjectionBasis | null;
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

  const resolved = resolveRaceProjection({ goalProjection, vdot, distanceMi: distanceMi ?? null });

  return {
    raceSlug: nextA.slug, raceName: nextA.name, goalSec,
    projectedSec: resolved.projectedSec, basis: resolved.basis,
  };
}
