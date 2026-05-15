/**
 * /api/overview — server-side bundle of every Coach call the Overview
 * page needs.
 *
 * The Overview page is a client component (because it owns modal /
 * hover state), but the Coach engine pulls in node-only modules
 * (Anthropic SDK, fs reads of research docs). So every Coach method
 * call runs here on the server, returning a single serialized envelope
 * the client uses to render every coach-tinted surface.
 *
 * Mirrors the shape of /api/coach/today but adds the Stage-7 stubs:
 * bodySystems / trajectory14wk / weekDeltas / raceFitnessPrediction
 * for the next A and next B race.
 */

import { gatherCoachState } from '../../../lib/coach-state';
import { coach } from '../../../coach/coach';
import type {
  CoachDecision,
  BodySystemsReport,
  Trajectory14wk,
  RaceFitnessPrediction,
  WeekDeltasReport,
} from '../../../coach/types';
import type {
  ReadinessAssessment,
  WorkoutPrescription,
  RecentAdjustmentsReport,
  AdjustedPlan,
  PathToRaceResult,
  NextPushesReport,
} from '../../../coach/coach';
import { listRacesDB } from '../../../lib/race-store';
import { gatherFreshness } from '../../../lib/freshness';
import type { FreshnessMap } from '../../../lib/freshness-types';
import { narrativeLine, type NarrativeLine } from '../../../coach/coach-narrative';
import { dailyBriefing, type DailyBriefing } from '../../../coach/coach-briefing';
import { getCurrentPlan } from '../../../coach/plan-lifecycle';
import type { PlanWorkout } from '../../../coach/plan-types';
import { getProfile } from '../../../lib/profile-store';
import { greeting } from '../../../lib/dates';

interface OverviewApiOk {
  ok: true;
  today: string;
  state: Awaited<ReturnType<typeof gatherCoachState>>;
  workout: CoachDecision<WorkoutPrescription>;
  readiness: CoachDecision<ReadinessAssessment>;
  bodySystems: CoachDecision<BodySystemsReport>;
  trajectory: CoachDecision<Trajectory14wk>;
  weekDeltas: CoachDecision<WeekDeltasReport>;
  raceFitnessA: CoachDecision<RaceFitnessPrediction> | null;
  raceFitnessB: CoachDecision<RaceFitnessPrediction> | null;
  /** Per-signal freshness map — drives the "Coach is watching" UI
   *  strip. Six signals: strava / checkin / vdotAnchor / profile /
   *  raceCal / healthkit. See lib/freshness.ts for budgets. */
  freshness: FreshnessMap;
  /** 7-day plan-adjustments rollup — drives the PLAN ADAPTED card. */
  recentAdjustments: CoachDecision<RecentAdjustmentsReport>;
  /** AdjustForReality applied to today's prescription. Drives the
   *  COACH ADJUSTED pin + "why" line on the TodayCard. */
  adjustedToday: CoachDecision<AdjustedPlan>;
  /** Wave G · PATH TO RACE — null when no A-race with goal time. */
  pathToRace: CoachDecision<PathToRaceResult> | null;
  /** Wave G · NEXT PUSH — always present, may have 0 pushes. */
  nextPushes: CoachDecision<NextPushesReport>;
  /** Wave J · one-sentence narrative line. Null when no signal fires. */
  narrative: NarrativeLine | null;
  /** v4 · multi-sentence daily briefing the coach delivers at the top
   *  of /overview. Always present — composed from real signals. */
  briefing: CoachDecision<DailyBriefing>;
  /** Plan-artifact workouts for the current Mon→Sun week. */
  planWeekWorkouts: PlanWorkout[] | null;
  /** Current week's phase from the plan artifact (BASE/BUILD/PEAK/TAPER).
   *  Replaces coach.workout.answer.phaseLabel which reads from old engine. */
  planCurrentPhase: string | null;
  /** Runner display name from the profile table. null when no profile row. */
  profileName: string | null;
  /** Next 4 future weeks' long-run distances from the plan artifact.
   *  Used by the long-run strip to show projected Sunday bars. */
  planFutureLongRuns: Array<{ weekStartISO: string; longMi: number }>;
}

interface OverviewApiErr {
  ok: false;
  error: string;
}

export async function GET(): Promise<Response> {
  try {
    const state = await gatherCoachState();
    const today = state.now.slice(0, 10);

    // The Coach methods that need a goal time pull from the saved
    // races table directly; gatherCoachState already exposes nextA
    // and nextAny but only as a NextRace shape with goalFinishS.
    const allRaces = await listRacesDB().catch(() => []);
    const upcoming = allRaces
      .filter((r) => r.meta.date >= today)
      .sort((a, b) => a.meta.date.localeCompare(b.meta.date));
    const nextA = upcoming.find((r) => (r.meta.priority ?? 'A') === 'A') ?? null;
    const nextB = upcoming.find((r) => r.meta.priority === 'B') ?? null;

    // Resolve plan first so trajectory14wk can consume actual plan volumes.
    const [planResult, profileRow] = await Promise.all([
      getCurrentPlan('me').catch(() => ({ plan: null, action: 'error' })),
      getProfile('me').catch(() => null),
    ]);

    // Build planWeeks with resolved phase labels (phaseId is a UUID in the
    // plan artifact; trajectory14wk needs the label string BASE/BUILD/etc).
    const planWeeksForTrajectory = (() => {
      const plan = planResult.plan;
      if (!plan) return [];
      return plan.weeks.map((wk) => {
        const phase = plan.phases.find((p) => p.id === wk.phaseId);
        return {
          weekStartISO: wk.weekStartISO,
          phaseLabel: phase?.label ?? 'BASE',
          isCutback: wk.isCutback,
          isPeak: wk.isPeak,
          isRaceWeek: wk.isRaceWeek,
          workouts: wk.workouts.map((w) => ({ distanceMi: w.distanceMi, isLong: w.isLong })),
        };
      });
    })();

    const [
      workout,
      readiness,
      bodySystems,
      trajectory,
      weekDeltas,
      recentAdjustments,
    ] = await Promise.all([
      coach.prescribeWorkout({ today, state }),
      coach.assessReadiness({ today, state }),
      coach.bodySystems({ today, state }),
      coach.trajectory14wk({ today, state, planWeeks: planWeeksForTrajectory }),
      coach.weekDeltas({ today, state }),
      coach.recentAdjustments({ today, state }),
    ]);

    // Extract this week's plan workouts and phase (Mon–Sun containing today).
    // Also post-process weekDeltas so planned miles come from the plan artifact
    // rather than the old coachDaily simulation.
    const { planWeekWorkouts, planCurrentPhase } = (() => {
      const plan = planResult.plan;
      if (!plan) return { planWeekWorkouts: null, planCurrentPhase: null };
      const todayD = new Date(today + 'T12:00:00Z');
      const dow = todayD.getUTCDay();
      const monOffset = dow === 0 ? -6 : 1 - dow;
      const monDate = new Date(todayD);
      monDate.setUTCDate(monDate.getUTCDate() + monOffset);
      const monISO = monDate.toISOString().slice(0, 10);
      const sunDate = new Date(monDate);
      sunDate.setUTCDate(sunDate.getUTCDate() + 6);
      const sunISO = sunDate.toISOString().slice(0, 10);
      const week = plan.weeks.find(
        (wk) => wk.weekStartISO >= monISO && wk.weekStartISO <= sunISO,
      );
      const phase = week ? plan.phases.find((p) => p.id === week.phaseId) : null;
      const workouts = week?.workouts ?? null;

      // Post-process weekDeltas: override planned miles per day from the
      // plan artifact so delta comparisons reflect the real plan, not the
      // old engine simulation. Recompute aggregates to match.
      if (workouts) {
        const planByDate = new Map(workouts.map((w) => [w.dateISO, w.distanceMi]));
        for (const day of weekDeltas.answer.days) {
          const planMi = planByDate.get(day.dateISO);
          if (planMi !== undefined) day.plannedMi = planMi;
        }
        weekDeltas.answer.plannedWeekMi = weekDeltas.answer.days.reduce((s, d) => s + d.plannedMi, 0);
        weekDeltas.answer.loggedWeekMi = weekDeltas.answer.days.reduce((s, d) => s + (d.actualMi ?? 0), 0);
        const completedDelta = weekDeltas.answer.days
          .filter((d) => d.deltaMi != null)
          .reduce((s, d) => s + (d.deltaMi ?? 0), 0);
        const remainingPlanned = weekDeltas.answer.days
          .filter((d) => d.actualMi == null)
          .reduce((s, d) => s + d.plannedMi, 0);
        weekDeltas.answer.projectedWeekMi = Math.round(
          (weekDeltas.answer.loggedWeekMi + remainingPlanned + completedDelta * 0.3) * 10,
        ) / 10;
        weekDeltas.answer.netDeltaMi = weekDeltas.answer.projectedWeekMi - weekDeltas.answer.plannedWeekMi;
      }

      return {
        planWeekWorkouts: workouts,
        planCurrentPhase: phase?.label ?? null,
      };
    })();

    // Today's adjustForReality consumes the live state.checkin
    // aggregate so the engine can fold qualitative signals into the
    // decision (Research/00b §Decision Matrix).
    const missedRunsLast7d = recentAdjustments.answer.items.filter(
      (i) => i.dateISO !== today,
    ).length;
    const acwrVal =
      state.volume.weeklyAvg8w > 0
        ? state.volume.last7Mi / state.volume.weeklyAvg8w
        : 0;
    const adjustedToday = await coach.adjustForReality({
      today,
      scheduledWorkout: workout.answer,
      signals: {
        daysSinceLastRun:
          state.recovery.daysSinceLastRun >= 0 ? state.recovery.daysSinceLastRun : 0,
        missedRunsLast7d,
        acwr: acwrVal,
        checkinPoorDaysLast7d: state.checkin?.poorDaysCount,
      },
    });

    const raceFitnessA = nextA
      ? await callRacePrediction(today, state, nextA)
      : null;
    const raceFitnessB = nextB
      ? await callRacePrediction(today, state, nextB)
      : null;

    const freshness = await gatherFreshness({ state });

    // Wave G · alive-coach surfaces. Run server-side so the coach
    // module never enters the client bundle.
    const stateNextA = state.races.nextA;
    const pathToRace = (stateNextA && stateNextA.goalFinishS)
      ? await coach.pathToRace({
          today,
          state,
          raceName: stateNextA.name,
          raceDateISO: stateNextA.date,
          raceDistanceMi: stateNextA.distanceMi,
          goalTimeS: stateNextA.goalFinishS,
        })
      : null;
    const nextPushes = await coach.nextPushes({ today, state });

    // Wave J · narrative line. Pull adjustment context from
    // adjustedToday so the "Coach adjusted today" priority can fire.
    const adjAns = adjustedToday.answer;
    const narrative = await narrativeLine(state, today, {
      adjustment: adjAns.changed
        ? {
            changed: true,
            adjustedFor: adjAns.adjustedFor,
            newLabel: adjAns.workout.label,
            direction: 'softening',
          }
        : undefined,
    });

    // v4 · multi-sentence briefing for the coach strip. Composed
    // from greeting + body-state read + today + race countdown.
    const todayDate = new Date(today + 'T12:00:00Z');
    const dowNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const briefing = dailyBriefing(state, {
      name: (profileRow?.full_name?.trim() || 'Runner'),
      greeting: greeting(todayDate),
      workout: workout.answer
        ? {
            label: workout.answer.label,
            distanceMi: workout.answer.distanceMi,
            isQuality: workout.answer.isQuality,
            isLong: workout.answer.isLong,
            paceTargetSPerMi:
              typeof workout.answer.paceTargetSPerMi === 'number'
                ? workout.answer.paceTargetSPerMi
                : null,
          }
        : null,
      phaseLabel: planCurrentPhase,
      raceCountdown: stateNextA
        ? { name: stateNextA.name, daysAway: stateNextA.daysAway }
        : null,
      todayDow: dowNames[todayDate.getUTCDay()],
      todayMonthDay: `${monthNames[todayDate.getUTCMonth()]} ${todayDate.getUTCDate()}`,
    });

    // Future long runs: next 4 weeks after this week, largest isLong workout in each.
    const planFutureLongRuns = (() => {
      const plan = planResult.plan;
      if (!plan) return [];
      const todayD = new Date(today + 'T12:00:00Z');
      const dow = todayD.getUTCDay();
      const monOffset = dow === 0 ? -6 : 1 - dow;
      const thisMonDate = new Date(todayD);
      thisMonDate.setUTCDate(thisMonDate.getUTCDate() + monOffset);
      const result: Array<{ weekStartISO: string; longMi: number }> = [];
      for (let w = 1; w <= 4; w++) {
        const futureMonDate = new Date(thisMonDate);
        futureMonDate.setUTCDate(futureMonDate.getUTCDate() + 7 * w);
        const futureMonISO = futureMonDate.toISOString().slice(0, 10);
        const week = plan.weeks.find((wk) => wk.weekStartISO === futureMonISO);
        const longMi = week
          ? week.workouts.filter((wo) => wo.isLong).reduce((m, wo) => Math.max(m, wo.distanceMi), 0)
          : 0;
        result.push({ weekStartISO: futureMonISO, longMi });
      }
      return result;
    })();

    const body: OverviewApiOk = {
      ok: true,
      today,
      state,
      workout,
      readiness,
      bodySystems,
      trajectory,
      weekDeltas,
      raceFitnessA,
      raceFitnessB,
      freshness,
      recentAdjustments,
      adjustedToday,
      pathToRace,
      nextPushes,
      narrative,
      briefing,
      planWeekWorkouts,
      planCurrentPhase,
      profileName: profileRow?.full_name?.trim() || null,
      planFutureLongRuns,
    };
    return Response.json(body);
  } catch (e) {
    const err: OverviewApiErr = {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
    return Response.json(err, { status: 200 });
  }
}

async function callRacePrediction(
  today: string,
  state: Awaited<ReturnType<typeof gatherCoachState>>,
  race: Awaited<ReturnType<typeof listRacesDB>>[number],
): Promise<CoachDecision<RaceFitnessPrediction> | null> {
  const goalS = parseGoalHMS(race.meta.goalDisplay);
  if (goalS == null) return null;
  return coach.raceFitnessPrediction({
    today,
    state,
    raceName: race.meta.name,
    raceDateISO: race.meta.date,
    raceDistanceMi: race.meta.distanceMi,
    goalTimeS: goalS,
  });
}

function parseGoalHMS(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}
