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
 *   · the personal exponent read — `durability-anchor.ts#resolveRaceExponent`,
 *     the CANONICAL personal-exponent resolver (2026-09-01, see
 *     docs/reports/race-prediction-consolidation-2026-09-01.md). Was
 *     `fitPersonalExponent` off `loadVdotInputs`' race candidates — coach-
 *     goal.ts's own, independent two-race fit; that duplicated the same
 *     question `durability-anchor.ts` already answers for pace prescription.
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
  gradeCourse,
  inferDistanceMiFromNameOrSlug,
  type CoachGoalFraming,
} from './coach-goal';
import { resolveRaceExponent } from '@/lib/training/durability-anchor';
import { isGoalFraming } from './goal-framing';
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
    /** races.meta.goalFraming — the runner's answered framing from the
     *  race_goal_framing card ('time' | 'effort'). Anything else ignored. */
    goalFraming?: unknown;
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

    const course = gradeCourse({
      metaTerrain: race.metaTerrain,
      elevationGainFt: race.elevationGainFt ?? null,
      distanceMi: goalDistanceMi,
    });

    const { runnerToday } = await import('@/lib/runtime/runner-tz');
    const todayISO = await runnerToday(userId);

    // 2026-09-01 · P0 · THE race-pace brain. A coach-set goal is the brain's
    // expected race day with the likely range as A/C; the fitness figure it
    // reports is the canonical threshold capacity's, not a snapshot table's.
    const { resolveRaceOutlook } = await import('@/lib/race/race-outlook');
    // goalDistanceMi is positive or null by construction (see above); the
    // function's outer try/catch is the one failure path.
    const outlook = goalDistanceMi != null
      ? await resolveRaceOutlook(userId, {
          slug: race.slug, name: race.name ?? race.slug, distanceMi: goalDistanceMi,
          dateISO: race.daysAway != null
            ? new Date(Date.parse(todayISO + 'T12:00:00Z') + race.daysAway * 86_400_000).toISOString().slice(0, 10)
            : null,
          priority: race.priority === 'A' || race.priority === 'B' || race.priority === 'C' ? race.priority : null,
          statedGoalSec: null,
          isPast: false,
        }, todayISO)
      : null;
    const anchor = {
      vdot: outlook?.capacity.thresholdVdot ?? null,
      anchorDateISO: outlook?.capacity.newestEvidenceISO ?? null,
      anchorDistanceMi: outlook?.capacity.thresholdSecPerMi ? (60 * 60) / outlook.capacity.thresholdSecPerMi : null,
    };
    const durabilityExponent = await resolveRaceExponent(userId).catch(() => null);

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
      course,
      goalFraming: isGoalFraming(race.goalFraming) ? race.goalFraming : null,
      vdot: anchor.vdot,
      vdotAnchorDistanceMi: anchor.anchorDistanceMi,
      marathonSpecificTraining,
      durabilityExponent,
      outlook: outlook?.expectedRaceDay.expectedSec != null && outlook.expectedRaceDay.likelyRangeSec
        ? {
            expectedSec: outlook.expectedRaceDay.expectedSec,
            likelyRangeSec: outlook.expectedRaceDay.likelyRangeSec,
            thresholdVdot: outlook.capacity.thresholdVdot,
          }
        : null,
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
