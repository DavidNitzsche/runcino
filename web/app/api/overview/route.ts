/**
 * /api/overview, server-side bundle of every Coach call the Overview
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
import { getCurrentUser } from '../../../lib/auth';
import { backfillWatchRunsAsActivities } from '../../../lib/watch-completion';
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
import { resolvePlanUserId } from '../../../lib/plan-user';
import { listRecentSkips } from '../../../lib/skip-store';
import { listMutations } from '../../../lib/plan-store';
import type { PlanWorkout } from '../../../coach/plan-types';
import { getProfile } from '../../../lib/profile-store';
import { greeting } from '../../../lib/dates';
import { vdotSnapshot } from '../../../lib/vdot';
import type { ResolvedFitness } from '../../../lib/fitness-types';
import { resolveFitness } from '../../../lib/fitness-resolver';
import { computeZ2CoverageFinding } from '../../../lib/z2-coverage';
import { buildHrZonesBundle, type HrZonesBundle } from '../../../lib/hr-zones';
import { describeWorkout, describeKeyFromPlan, type WorkoutDescription } from '../../../lib/workout-descriptions';
import { generateBriefing } from '../../../lib/coach-briefing';
import { getWeekStats, getCompletedMileageByDate } from '../../../lib/completed-runs';
import { realPlanToWeeks, daysBetween } from '../../../lib/synthetic-plan';
import { listUserConnectors } from '../../../lib/connectors';
import { computeReadinessScore } from '../../../lib/readiness-score';

type DescribedPlanWorkout = PlanWorkout & { label: string; description: WorkoutDescription };

interface OverviewApiOk {
  ok: true;
  /** Whether the request resolved an authenticated user (Bearer/cookie).
   *  /overview is auth-OPTIONAL, it serves the single-tenant 'me' plan
   *  even anonymously, so userId-gated fields (readiness, connectors)
   *  silently go empty when a token is expired. Native clients read this
   *  to detect a stale-token downgrade and refresh+retry. */
  authenticated: boolean;
  today: string;
  state: Awaited<ReturnType<typeof gatherCoachState>>;
  workout: CoachDecision<WorkoutPrescription>;
  readiness: CoachDecision<ReadinessAssessment>;
  bodySystems: CoachDecision<BodySystemsReport>;
  trajectory: CoachDecision<Trajectory14wk>;
  weekDeltas: CoachDecision<WeekDeltasReport>;
  raceFitnessA: CoachDecision<RaceFitnessPrediction> | null;
  raceFitnessB: CoachDecision<RaceFitnessPrediction> | null;
  /** Per-signal freshness map, drives the "Coach is watching" UI
   *  strip. Six signals: strava / checkin / vdotAnchor / profile /
   *  raceCal / healthkit. See lib/freshness.ts for budgets. */
  freshness: FreshnessMap;
  /** 7-day plan-adjustments rollup, drives the PLAN ADAPTED card. */
  recentAdjustments: CoachDecision<RecentAdjustmentsReport>;
  /** AdjustForReality applied to today's prescription. Drives the
   *  COACH ADJUSTED pin + "why" line on the TodayCard. */
  adjustedToday: CoachDecision<AdjustedPlan>;
  /** Wave G · PATH TO RACE, null when no A-race with goal time. */
  pathToRace: CoachDecision<PathToRaceResult> | null;
  /** Wave G · NEXT PUSH, always present, may have 0 pushes. */
  nextPushes: CoachDecision<NextPushesReport>;
  /** Wave J · one-sentence narrative line. Null when no signal fires. */
  narrative: NarrativeLine | null;
  /** v4 · multi-sentence daily briefing the coach delivers at the top
   *  of /overview. Always present, composed from real signals. */
  briefing: CoachDecision<DailyBriefing>;
  /** Plan-artifact workouts for the current Mon→Sun week. Enriched with
   *  a `label` + computed `description` (pace band + structured steps +
   *  effort + why) when fitness resolves, so the iPhone app and any
   *  client render the same structured workout the web modal shows. */
  planWeekWorkouts: Array<PlanWorkout | DescribedPlanWorkout> | null;
  /** Current week's phase from the plan artifact (BASE/BUILD/PEAK/TAPER).
   *  Replaces coach.workout.answer.phaseLabel which reads from old engine. */
  planCurrentPhase: string | null;
  /** Runner display name from the profile table. null when no profile row. */
  profileName: string | null;
  /** The day-aware coach line, the SAME generateBriefing the /overview
   *  web page renders, so the iPhone app and the website show identical
   *  coach copy. null when no plan / on any compute failure. */
  coachLine: string | null;
  /** Actual miles logged per day this week (dateISO → mi), so clients
   *  can mark a day "done" only when the run actually happened (≥60% of
   *  planned), instead of assuming any past day is complete. Empty for
   *  anonymous reads. */
  completedByDate: Record<string, number>;
  /** Dates the runner deliberately SKIPPED, distinct from "missed/not
   *  logged" so clients can mark them differently. */
  skippedDates: string[];
  /** Recent coach plan adaptations (last 7d), grouped by reason, for the
   *  "Coach updated your plan" card. Each carries the cited reason + the
   *  days it touched. `adaptationsLatestTs` lets clients show the card only
   *  when there's something newer than the user last dismissed. */
  coachAdaptations: Array<{ reason: string; citation: string | null; count: number; days: string[]; ts: string }>;
  adaptationsLatestTs: string | null;
  /** BIG adaptations awaiting the runner's approve/skip. These are NOT yet
   *  applied to the plan, the workout keeps its current values until the
   *  runner accepts. Each carries the mutation ids to POST to
   *  /api/plan/adaptations/act. Empty for anon reads. */
  pendingAdaptations: Array<{
    ids: string[];
    reason: string;
    citation: string | null;
    trigger: string;
    days: string[];
    ts: string;
  }>;
  /** Active (non-disconnected) connector providers for the user, e.g.
   *  ["strava"]. Lets clients show real integration status instead of a
   *  hardcoded "Connect". Empty for anonymous reads. */
  connectors: string[];
  /** Daily readiness score (0–100) + state for the Today/Health ring,
   *  from computeReadinessScore. null when suppressed/silent or anon, 
   *  the client renders a dashed "No data" ring then. Surface-only;
   *  never auto-edits the plan. */
  readinessScore: number | null;
  readinessState: 'green' | 'yellow' | 'red' | null;
  readinessRecommendation: string | null;
  /** The transparent score breakdown, each signal that moved the score
   *  off baseline (75) with its delta + plain-language note, so the client
   *  can render a "what goes into this" detail view instead of an opaque
   *  number. Empty when no score. */
  readinessInputs: Array<{ name: string; delta: number; note: string }>;
  /** Signals we WOULD use but don't have yet (e.g. sleep, mileage-vs-plan),
   *  listed so the detail view is honest about gaps. */
  readinessMissing: string[];
  /** The runner's HR zones (Karvonen %HRR when resting HR known, %max
   *  fallback), drives the zone scale on Health + the readiness sheet.
   *  Null when max HR is unknown. */
  hrZones: HrZonesBundle | null;
  /** A-race fitness projection for the Race detail (from raceFitnessA).
   *  null when no A-race goal. */
  raceProjection: {
    projectedDisplay: string;
    vdot: number;
    goalPaceSPerMi: number;
    predictedPaceSPerMi: number;
    headroomSPerMi: number;   // goal − predicted; + = room to spare
    confidence: string;
  } | null;
  /** Next 4 future weeks' long-run distances from the plan artifact.
   *  Used by the long-run strip to show projected Sunday bars. */
  planFutureLongRuns: Array<{ weekStartISO: string; longMi: number }>;
}

interface OverviewApiErr {
  ok: false;
  error: string;
}

export async function GET(req: Request): Promise<Response> {
  try {
    // Bearer-aware: getCurrentUser(req) honors the native app's
    // Authorization: Bearer token (requireActiveUser is cookie-only, so the
    // iPhone was being treated as anonymous → empty completion/readiness).
    const authUser = await getCurrentUser(req);
    const userId: string | undefined = authUser?.id;
    // Surface any watch-recorded runs that synced before the run-surfacing
    // logic existed, so they show up as real runs (idempotent, non-fatal).
    if (userId) await backfillWatchRunsAsActivities(userId);
    const state = await gatherCoachState({ userId, tz: authUser?.timezone });
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
      getCurrentPlan(await resolvePlanUserId()).catch(() => ({ plan: null, action: 'error' })),
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

    // Enrich the plan workouts with the computed description (pace band
    // + structured steps + effort + why), the SAME describeWorkout the
    // web modal uses. Daniels pace bands come from the VDOT already in
    // `state` (no extra DB round-trip), so every client renders the same
    // real workout. Defensive: per-day try/catch keeps the base shape if
    // anything goes sideways.
    let planWeekDescribed: Array<PlanWorkout | DescribedPlanWorkout> | null = planWeekWorkouts;
    if (planWeekWorkouts && planWeekWorkouts.length > 0) {
      // describeWorkout reads only paces / racePaceBand / hrZones off the
      // fitness object; build that subset from the state VDOT snapshot.
      const vsnap = vdotSnapshot(state);
      const fitness: ResolvedFitness | null = vsnap
        ? ({
            paces: vsnap.paces,
            racePaceBand: { lowS: vsnap.paces.T.lowS, highS: vsnap.paces.T.highS, label: 'Race pace' },
            hrZones: null,
          } as unknown as ResolvedFitness)
        : null;
      planWeekDescribed = planWeekWorkouts.map((w) => {
        if (w.type === 'rest') return w;
        try {
          const label = describeKeyFromPlan(w.type, w.subLabel ?? null);
          const description = describeWorkout(label, w.type, fitness);
          return { ...w, label, description };
        } catch { return w; }
      });
    }

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

    const freshness = await gatherFreshness({ state, userId: authUser?.id });

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

    // Day-aware coach line, assembled exactly like the /overview web
    // page so the iPhone app and the website render identical copy (one
    // source of truth). Replaces the app's old client-side compose, and
    // sidesteps dailyBriefing's stale "cleaning up from the race" clause.
    // Defensive: any failure leaves coachLine null and the app falls back.
    let coachLine: string | null = null;
    try {
      const plan = planResult.plan;
      if (plan) {
        const weeks = realPlanToWeeks(plan, describeKeyFromPlan);
        const currentWeek = weeks.find((w) => w.days.some((d) => d.date === today)) ?? weeks[0];
        if (currentWeek) {
          const previousWeek = weeks[weeks.findIndex((w) => w === currentWeek) - 1] ?? null;
          const todayDay = currentWeek.days.find((d) => d.date === today) ?? null;
          const statsUser = userId ?? 'me';
          const yISO = (() => {
            const d = new Date(today + 'T00:00:00Z');
            d.setUTCDate(d.getUTCDate() - 1);
            return d.toISOString().slice(0, 10);
          })();
          const emptyStats = { totalMi: 0, runDays: 0, longest: null, quality: null, avgHr: null };
          const lastWeekStats = previousWeek
            ? await getWeekStats(statsUser, previousWeek.startDate, previousWeek.endDate).catch(() => emptyStats)
            : emptyStats;
          const thisWeekSoFar = yISO >= currentWeek.startDate
            ? await getWeekStats(statsUser, currentWeek.startDate, yISO).catch(() => emptyStats)
            : emptyStats;
          const raceDate = weeks[weeks.length - 1]?.days[6]?.date ?? stateNextA?.date ?? '2026-08-16';
          const daysToRace = Math.max(0, daysBetween(today, raceDate));
          const localHour = Number(new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false,
          }).format(new Date()));
          coachLine = generateBriefing({
            firstName: (profileRow?.full_name?.trim().split(' ')[0]) || '',
            today,
            daysToRace,
            raceLabel: stateNextA?.name ?? 'AFC Half',
            currentWeek,
            previousWeek,
            lastWeekStats,
            thisWeekSoFar,
            todayDay,
            localHour,
          });
        }
      }
    } catch { coachLine = null; }

    // Actual miles logged per day this week, so clients show real
    // completion (≥60% of planned) instead of "any past day is done".
    // Authenticated only, the query is keyed to the user's UUID.
    // Computed for anonymous (demo) reads too: getCompletedMileageByDate
    // binds null → reads the legacy 'me' activities, so past days that
    // were actually run show as DONE (green) instead of "not logged".
    const completedByDate: Record<string, number> = {};
    try {
      if (planWeekWorkouts && planWeekWorkouts.length > 0) {
        const dates = planWeekWorkouts.map((w) => w.dateISO).filter(Boolean).sort();
        const from = dates[0];
        const to = dates[dates.length - 1];
        if (from && to) {
          const m = await getCompletedMileageByDate(userId ?? null, from, to);
          for (const [k, v] of m) completedByDate[k] = v;
        }
      }
    } catch { /* leave empty */ }

    // Deliberately-skipped days (this plan week) so clients distinguish a
    // skip from a missed/unlogged day. Keyed by the plan user ('me').
    let skippedDates: string[] = [];
    try {
      if (planWeekWorkouts && planWeekWorkouts.length > 0) {
        const dates = planWeekWorkouts.map((w) => w.dateISO).filter(Boolean).sort();
        const from = dates[0];
        const to = dates[dates.length - 1];
        if (from && to) {
          const skips = await listRecentSkips({ userId: await resolvePlanUserId(), sinceISO: from, untilISO: to });
          skippedDates = skips.map((s) => s.dateISO);
        }
      }
    } catch { /* leave empty */ }

    // Recent coach adaptations (last 7d), grouped by reason, for the
    // "Coach updated your plan" card. Reason is always present; we group on
    // it (trigger_kind can be null on legacy rows).
    let coachAdaptations: Array<{ reason: string; citation: string | null; count: number; days: string[]; ts: string }> = [];
    let adaptationsLatestTs: string | null = null;
    let pendingAdaptations: Array<{ ids: string[]; reason: string; citation: string | null; trigger: string; days: string[]; ts: string }> = [];
    try {
      const plan = planResult.plan;
      if (plan) {
        const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
        const muts = await listMutations(plan.id, since);
        if (muts.length > 0) {
          // APPLIED adaptations → the informational "Coach updated your plan" card.
          const applied = muts.filter((m) => (m.status ?? 'applied') === 'applied');
          if (applied.length > 0) {
            adaptationsLatestTs = applied.reduce((mx, m) => (m.ts > mx ? m.ts : mx), applied[0].ts);
            const byReason = new Map<string, { reason: string; citation: string | null; days: Set<string>; ts: string }>();
            for (const m of applied) {
              const g = byReason.get(m.reason) ?? { reason: m.reason, citation: m.citation, days: new Set<string>(), ts: m.ts };
              g.days.add(m.workoutDateISO);
              if (m.ts > g.ts) g.ts = m.ts;
              byReason.set(m.reason, g);
            }
            coachAdaptations = [...byReason.values()]
              .map((g) => ({ reason: g.reason, citation: g.citation, count: g.days.size, days: [...g.days].sort(), ts: g.ts }))
              .sort((a, b) => (a.ts < b.ts ? 1 : -1));
          }
          // PROPOSED adaptations → the approve/skip card. Grouped by reason so
          // a multi-day reshape is one card with all its mutation ids.
          const proposed = muts.filter((m) => m.status === 'proposed');
          if (proposed.length > 0) {
            const byReason = new Map<string, { ids: string[]; reason: string; citation: string | null; trigger: string; days: Set<string>; ts: string }>();
            for (const m of proposed) {
              const g = byReason.get(m.reason) ?? { ids: [], reason: m.reason, citation: m.citation, trigger: m.trigger, days: new Set<string>(), ts: m.ts };
              g.ids.push(m.id);
              g.days.add(m.workoutDateISO);
              if (m.ts > g.ts) g.ts = m.ts;
              byReason.set(m.reason, g);
            }
            pendingAdaptations = [...byReason.values()]
              .map((g) => ({ ids: g.ids, reason: g.reason, citation: g.citation, trigger: g.trigger, days: [...g.days].sort(), ts: g.ts }))
              .sort((a, b) => (a.ts < b.ts ? 1 : -1));
          }
        }
      }
    } catch { /* leave empty */ }

    // Active connectors (Strava etc.) so clients show real integration
    // status. Authenticated only; empty + non-fatal for anonymous reads.
    let connectors: string[] = [];
    try {
      if (userId) connectors = (await listUserConnectors(userId)).map((c) => c.provider);
    } catch { connectors = []; }

    // Daily readiness score for the Today/Health ring. Real, surface-only.
    let readinessScore: number | null = null;
    let readinessState: 'green' | 'yellow' | 'red' | null = null;
    // The SAME recommendation string the web overview ring shows, shipped
    // so the iPhone renders the coach's readiness voice verbatim instead
    // of composing its own. Null when there's no health-derived score.
    let readinessRecommendation: string | null = null;
    let readinessInputs: Array<{ name: string; delta: number; note: string }> = [];
    let readinessMissing: string[] = [];
    // The runner's Karvonen HR zones (Research/03 §4 + §5), drives the zone
    // scale on Health + the readiness sheet. Null when max HR is unknown.
    let hrZones: HrZonesBundle | null = null;
    try {
      if (userId) {
        // Parity with the web /overview ring: pass the SAME max HR + resting HR
        // + Z2 cross-reference. Without max HR the score can't detect hard
        // efforts by heart rate, which previously inflated the iPhone score
        // (90/green) vs the web (50/red) for the identical day.
        const fit = await resolveFitness(userId, today).catch(() => null);
        const restingForZones = fit?.restingHr.value ?? state.recovery?.rhrBpm ?? null;
        hrZones = buildHrZonesBundle(fit?.maxHr.value ?? state.recovery?.maxHrBpm ?? null, restingForZones);
        const z2 = fit
          ? await computeZ2CoverageFinding(userId, today, fit.maxHr.value, fit.restingHr.value, fit.vdot.value).catch(() => null)
          : null;
        const r = await computeReadinessScore(
          userId, today, fit?.maxHr.value ?? null, restingForZones, z2,
        );
        readinessScore = r.score;
        readinessState = r.score != null ? r.state : null;
        readinessRecommendation = r.score != null && r.recommendation ? r.recommendation : null;
        if (r.score != null) {
          readinessInputs = r.inputs;
          readinessMissing = r.missingInputs;
        }
      }
    } catch { /* silent → dashed ring */ }

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
      authenticated: userId != null,
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
      planWeekWorkouts: planWeekDescribed,
      planCurrentPhase,
      profileName: profileRow?.full_name?.trim() || null,
      coachLine,
      completedByDate,
      skippedDates,
      coachAdaptations,
      adaptationsLatestTs,
      pendingAdaptations,
      connectors,
      readinessScore,
      readinessState,
      readinessRecommendation,
      readinessInputs,
      readinessMissing,
      hrZones,
      raceProjection: raceFitnessA?.answer ? {
        projectedDisplay: raceFitnessA.answer.predictedDisplay,
        vdot: Math.round(raceFitnessA.answer.vdot),
        goalPaceSPerMi: Math.round(raceFitnessA.answer.goalPaceSPerMi),
        predictedPaceSPerMi: Math.round(raceFitnessA.answer.predictedPaceSPerMi),
        headroomSPerMi: Math.round(raceFitnessA.answer.headroomSPerMi),
        confidence: raceFitnessA.answer.confidence,
      } : null,
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
