/**
 * lib/race/coach-goal-load.ts · the ONE evidence loader for a coach-set goal.
 *
 * Both surfaces that show a coach goal — the iPhone race detail
 * (app/api/race/[slug]/route.ts) and the web race page
 * (components/faff-app/raceDetail.ts) — call this, so they cannot drift into
 * two different answers for the same race. The derivation itself is the pure
 * module (lib/race/coach-goal.ts); this file only gathers what it needs:
 *
 *   · current VDOT + its anchor  — the same snapshot chain every projection
 *     surface reads (loadLatestVdotWithAnchor)
 *   · the personal exponent fit  — bestRecentVdot's own race candidates
 *     (loadVdotInputs), graded by the race-authority machinery
 *   · the marathon-block signal  — loadMarathonSpecificTraining, asked only
 *     when the target is a marathon off a sub-marathon anchor
 *
 * Compute-on-read, nothing persisted: a coach goal follows the evidence the
 * morning it changes, and the moment the runner states their own goal
 * (meta.goalDisplay) the derivation refuses and this returns null. Nothing
 * here writes any race field.
 */

import {
  deriveCoachGoal,
  fitPersonalExponent,
  courseIsHilly,
  inferDistanceMiFromNameOrSlug,
  type CoachGoalFraming,
} from './coach-goal';
import { distanceCategoryOrNull } from './distance-category';

export type LoadedCoachGoal = CoachGoalFraming & {
  /** True when the distance came from a name/slug inference (display default
   *  only — the race row's own distance field is missing; report the gap). */
  distance_mi_inferred?: boolean;
  /** The inferred distance used, when distance_mi_inferred. */
  distance_mi_used?: number;
};

export async function loadCoachGoalForRace(
  userId: string,
  race: {
    slug: string;
    name: string | null;
    priority: string | null;
    /** Parsed runner-stated goal seconds · any positive value → null result. */
    statedGoalSec: number | null;
    /** Official races.meta distance when present. */
    distanceMi: number | null;
    /** races.meta.terrain (or equivalent) for the hilly read. */
    metaTerrain?: unknown;
    /** Measured course elevation gain (ft) when known. */
    elevationGainFt?: number | null;
    /** Negative days = past race → null result. */
    daysAway: number | null;
  },
): Promise<LoadedCoachGoal | null> {
  try {
    if (race.statedGoalSec != null && race.statedGoalSec > 0) return null;
    if (race.daysAway == null || race.daysAway < 0) return null;

    const officialDistanceMi =
      race.distanceMi != null && race.distanceMi > 0 ? race.distanceMi : null;
    const inferredDistanceMi = officialDistanceMi == null
      ? inferDistanceMiFromNameOrSlug(race.name, race.slug)
      : null;
    const goalDistanceMi = officialDistanceMi ?? inferredDistanceMi;

    const hilly = courseIsHilly({
      metaTerrain: race.metaTerrain,
      elevationGainFt: race.elevationGainFt ?? null,
      distanceMi: goalDistanceMi,
    });

    const { loadLatestVdotWithAnchor } = await import('@/lib/training/projection-snapshots');
    const anchor = await loadLatestVdotWithAnchor(userId)
      .catch(() => ({ vdot: null, anchorDateISO: null, anchorDistanceMi: null }));
    const { runnerToday } = await import('@/lib/runtime/runner-tz');
    const todayISO = await runnerToday(userId);

    let exponentFit = null;
    try {
      const { loadVdotInputs } = await import('@/lib/training/vdot-inputs');
      const { raceCandidates } = await loadVdotInputs(userId, todayISO);
      exponentFit = fitPersonalExponent(raceCandidates, todayISO);
    } catch { exponentFit = null; }

    const needsBlockSignal = goalDistanceMi != null
      && distanceCategoryOrNull(goalDistanceMi) === 'm'
      && anchor.anchorDistanceMi != null
      && ['5k', '10k', 'hm'].includes(distanceCategoryOrNull(anchor.anchorDistanceMi) ?? '');
    const marathonSpecificTraining = needsBlockSignal
      ? await (await import('@/lib/training/plan-target'))
          .loadMarathonSpecificTraining(userId).catch(() => null)
      : null;

    const framing = deriveCoachGoal({
      statedGoalSec: race.statedGoalSec,
      priority: race.priority,
      distanceMi: goalDistanceMi,
      hilly,
      vdot: anchor.vdot,
      vdotAnchorDistanceMi: anchor.anchorDistanceMi,
      marathonSpecificTraining,
      exponentFit,
      todayISO,
    });
    if (!framing) return null;
    return {
      ...framing,
      ...(inferredDistanceMi != null
        ? { distance_mi_inferred: true, distance_mi_used: inferredDistanceMi }
        : {}),
    };
  } catch {
    // Additive everywhere it is used — a failed read is an absent goal, never
    // a failed page.
    return null;
  }
}
