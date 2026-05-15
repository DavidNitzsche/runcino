/**
 * /overview · data wiring layer.
 *
 * Every data point the Overview page renders comes from one of the
 * functions in this module. Real data sources are wired where they
 * exist today (Strava-cached activities, the localStorage-backed race
 * store, the Coach engine state, and the Coach methods on
 * `web/coach/coach.ts`).
 *
 * Surfaces whose feeding data source genuinely doesn't exist yet
 * resolve to `null` (and the page renders an explicit NO DATA YET
 * empty-state). No more synthesized mockup fallbacks.
 */

import type {
  CoachDecision,
  BodySystemsReport,
  Trajectory14wk,
  RaceFitnessPrediction,
  WeekDeltasReport,
} from '@/coach/types';
import type {
  ReadinessAssessment,
  WorkoutPrescription,
  RecentAdjustmentsReport,
  AdjustedPlan,
} from '@/coach/coach';
import type { CoachState } from '@/lib/coach-state';
import type { NormalizedActivity } from '@/lib/strava-activities';
import { onlyRuns } from '@/lib/strava-activities';
import {
  rollupYear,
  weeklyMiles,
  yearOfRunningHeatmap,
  naivePRs,
  effortBalance,
  type YearRollup,
} from '@/lib/strava-stats';
import { vdotSnapshot, vdotRow, type VdotSnapshot as VdotLibSnapshot } from '@/lib/vdot';
import { listRaces, type SavedRace } from '@/lib/storage';
import { daysUntil } from '@/lib/dates';
import type { FreshnessMap } from '@/lib/freshness-types';
import { loadAliveCoachData, type AliveCoachData } from './_alive-coach';
import type { NarrativeLine } from '@/coach/coach-narrative';
import type { DailyBriefing } from '@/coach/coach-briefing';
import type { PathToRaceResult, NextPushesReport } from '@/coach/coach';

// ─────────────────────────────────────────────────────────────────────
// Public type
// ─────────────────────────────────────────────────────────────────────

export interface OverviewData {
  /** ISO "today" used everywhere downstream. Locked once per load. */
  today: string;
  /** Identity card content. */
  profile: ProfileSnapshot;
  /** Coach engine state — fed into every Coach call below. */
  state: CoachState;
  /** Race calendar. */
  races: {
    upcoming: SavedRace[];
    past: SavedRace[];
    nextA: SavedRace | null;
    nextB: SavedRace | null;
    daysToNextA: number | null;
  };
  /** Strava activities and rollups. Null when Strava isn't connected. */
  strava: {
    activities: NormalizedActivity[] | null;
    runs: NormalizedActivity[] | null;
    rollup: YearRollup | null;
    heatmap: Array<{ date: string; miles: number; runs: number }> | null;
    weeklyHistory: Array<{ weekStart: string; miles: number; runs: number }> | null;
    prs: Array<{ label: string; distMi: number; bestS: number | null; activityId: number | null; date: string | null }> | null;
    effort: ReturnType<typeof effortBalance> | null;
  };
  /** Coach decisions powering each coaching surface. */
  coach: {
    workout: CoachDecision<WorkoutPrescription>;
    readiness: CoachDecision<ReadinessAssessment>;
    bodySystems: CoachDecision<BodySystemsReport>;
    trajectory: CoachDecision<Trajectory14wk>;
    weekDeltas: CoachDecision<WeekDeltasReport>;
    /** A-race fitness prediction. null when no A race is set. */
    raceFitnessA: CoachDecision<RaceFitnessPrediction> | null;
    /** B-race fitness prediction. null when no B race in window. */
    raceFitnessB: CoachDecision<RaceFitnessPrediction> | null;
  };
  /** Today's workout structure (warm-up / main / cool-down breakdown).
   *  Stage-7 stub: the Coach prescription is one paragraph today, the
   *  structure split lives here until the engine returns it natively. */
  workoutStructure: WorkoutStructureBlock[];
  /** Plan-adapted decision-delta card content. null when no adjustment
   *  has been made (nothing to surface; page hides the card). */
  planAdapted: PlanAdaptedReport | null;
  /** READINESS · FROM YOUR CHECK-INS tile. 7-day aggregate of the
   *  daily_checkin table. Null when no rows in the window. */
  checkinReadiness: CheckinReadinessSnapshot | null;
  /** AdjustForReality output for today. Null when the engine held the
   *  plan steady. When set, the TodayCard renders the COACH ADJUSTED
   *  pin + the "why" line under the workout title. */
  adjustedToday: TodayAdjustment | null;
  /** HRV / RHR / Sleep / Effort spark cards. HealthKit-blocked: null
   *  until M2 ships. Page renders an AWAITING HEALTHKIT empty state. */
  biometrics: BiometricsSnapshot | null;
  /** VDOT card content. null when no recent canonical race is logged. */
  vdot: VdotSnapshot | null;
  /** ACWR load gauge content. null when not enough history to compute. */
  load: LoadSnapshot | null;
  /** Pace zones (E / M / T / I / R) display strings. null when no VDOT. */
  paceZones: PaceZonesSnapshot | null;
  /** Weekly-miles 4 past + 4 ahead. null when no Strava history. */
  weeklyMilesStrip: WeeklyMilesStrip | null;
  /** Long-run 6 past + 4 ahead. null when no Strava history. */
  longRunStrip: LongRunStrip | null;
  /** Year-in-running heatmap + monthly volume + PRs + facts. */
  year: YearSnapshot;
  /** Wave J — single sentence the coach says at the top of /overview.
   *  Null when no priority signal fires (steady state). */
  narrative: NarrativeLine | null;
  /** v4 — multi-sentence coach briefing on the new /overview layout.
   *  Always present; clauses inside compose only from real signals. */
  briefing: DailyBriefing | null;
  /** Wave G — Coach-is-watching strip + PathToRace + NextPush payloads.
   *  Always present; surfaces render empty-state copy when data is
   *  thin. */
  aliveCoach: AliveCoachData;
  /** Wave L — per-signal freshness map driving chip variants on the
   *  watching strip and elsewhere. */
  freshness: FreshnessMap;
  /** Active plan workouts for the current Mon→Sun week. Null when no plan. */
  planWeekWorkouts: OverviewApiPayload['planWeekWorkouts'];
  /** Current week's phase from the plan (BASE/BUILD/PEAK/TAPER). */
  planCurrentPhase: string | null;
}

// ─────────────────────────────────────────────────────────────────────
// Stub types
// ─────────────────────────────────────────────────────────────────────

export interface ProfileSnapshot {
  /** Display name. */
  name: string;
  /** Time-of-day greeting ("Good morning" etc.). */
  greeting: string;
}

export interface WorkoutStructureBlock {
  /** Display time offset, e.g. "0:00". */
  timeOffset: string;
  /** Block name, e.g. "Warm-up · easy aerobic". */
  name: string;
  /** Distance display, e.g. "0.5 mi". */
  distance: string;
  /** Pace display, e.g. "9:30/mi". */
  pace: string;
  /** True for the main block (rendered bold). */
  isMain?: boolean;
}

export interface PlanAdaptedDelta {
  label: string;
  was: string;
  now: string;
  unit?: string;
}

export interface PlanAdaptedReport {
  /** Lead line. */
  title: string;
  /** Body paragraph. */
  body: string;
  /** Pin label. null = no pin. */
  pinLabel: string | null;
  deltas: PlanAdaptedDelta[];
  /** Footer left text. */
  footLeft: string;
  /** Per-day adjustment rows. */
  items: PlanAdaptedItem[];
}

export interface PlanAdaptedItem {
  dateISO: string;
  dateDisplay: string;
  changeDisplay: string;
  why: string;
}

export interface CheckinReadinessSnapshot {
  rowsCount: number;
  latestDateISO: string;
  loggedToday: boolean;
  avgEnergyDisplay: string;
  avgSorenessDisplay: string;
  avgStressDisplay: string;
  poorDaysCount: number;
  pinLabel: string;
  pinVariant: 'green' | 'amber' | 'warn' | 'muted';
  headline: string;
  body: string;
}

export interface TodayAdjustment {
  why: string;
  reasons: string[];
}

export interface BiometricSpark {
  /** Latest reading display. */
  value: string;
  /** Unit display. */
  unit: string;
  /** Pin label. */
  pinLabel: string;
  /** Pin variant. */
  pinVariant: 'green' | 'amber' | 'warn' | 'blue' | 'purple';
  /** Footer left. */
  footLeft: string;
  /** Footer right delta. */
  footRight: string;
  /** Sparkline polyline points. */
  sparkPoints: string;
  /** Stroke color. */
  strokeColor: string;
}

export interface BiometricsSnapshot {
  hrv: BiometricSpark;
  rhr: BiometricSpark;
  sleep: {
    value: string;
    unit: string;
    pinLabel: string;
    /** 7 nights of stage stacks. Each entry is a fraction (0–1) of total height. */
    nights: Array<{ height: number; color: string }>;
    footLeft: string;
    footRight: string;
  };
  effort: BiometricSpark;
}

export interface VdotSnapshot {
  /** Display VDOT. null when no race anchored. */
  value: string;
  /** Source label (race name · finish time · how-long-ago). */
  source: string;
  /** Tier eyebrow row labels. */
  tiers: Array<{ label: string; active?: boolean }>;
  /** Tier band fill position (0–1). */
  bandPosition: number;
  bandWidth: number;
  /** Display VDOT range labels under the band. */
  scaleLabels: string[];
  /** Equivalent race times. */
  equivalents: Array<{ distance: string; time: string; isGoal?: boolean }>;
  /** RAW / DECAY caption. */
  detailLine: string;
}

export interface LoadSnapshot {
  /** ACWR value. */
  value: string;
  /** Pin label (e.g. "SWEET SPOT"). */
  pinLabel: string;
  /** Pin variant. */
  pinVariant: 'green' | 'amber' | 'warn';
  /** Verdict line under value. */
  bandLine: string;
  /** Trend headline. */
  trendLabel: string;
  /** 4-week trend values, oldest → today. */
  trend: number[];
}

export interface PaceZone {
  letter: 'E' | 'M' | 'T' | 'I' | 'R';
  label: string;
  value: string;
  rangeSuffix?: string;
}
export interface PaceZonesSnapshot {
  /** Source label. */
  source: string;
  /** Race anchor label. */
  raceAnchor: string;
  zones: PaceZone[];
  /** Distribution bars over 14 days. */
  distribution: Array<{
    zoneLetter: 'E' | 'M' | 'T' | 'I' | 'R';
    label: string;
    timeDisplay: string;
    barFraction: number;
    color: string;
    muted?: boolean;
  }>;
  /** Plain-English share line. */
  shareLine: string;
  currentFitnessPace: string;
  goalPace: string;
  headroomS: number;
}

export interface WeeklyMilesStrip {
  /** Pin label. */
  pinLabel: string;
  /** Big "22 mi" hero. */
  thisWeekMi: number;
  /** Bars left → right. */
  bars: Array<{
    miles: number;
    date: string;
    kind: 'past' | 'past-race' | 'now' | 'future';
  }>;
  /** Peak label for the footer. */
  peakLabel: string;
  footRight: string;
}

export interface LongRunStrip {
  pinLabel: string;
  nextMi: number;
  nextLabel: string;
  bars: Array<{
    miles: number;
    date: string;
    kind: 'past' | 'past-race' | 'now' | 'future';
  }>;
  footLeft: string;
  footRight: string;
}

export interface YearSnapshot {
  /** Top stats row. Empty array when no rollup data. */
  topStats: Array<{ value: string; label: string }>;
  /** 52-week heatmap cells. Empty array = NO DATA YET. */
  heatmap: Array<{
    color: string;
    isRaceWeek: boolean;
    isFutureRace: boolean;
    isToday: boolean;
  }>;
  /** Monthly volume bars. Empty array = NO DATA YET. */
  monthly: Array<{
    label: string;
    miles: number | null;
    isCurrent: boolean;
    isFuture: boolean;
  }>;
  /** Highlights strip. Empty array = NO DATA YET. */
  highlights: Array<{ label: string; value: string; unit: string; meta: string; color?: string }>;
  /** PR shelf. Empty array = NO DATA YET. */
  prs: Array<{ distance: string; time: string; meta: string }>;
  /** YTD ring + counters. null when no Strava activities. */
  ytd: YtdSnapshot | null;
}

export interface YtdSnapshot {
  miles: number;
  dayOfYear: number;
  pctOfYear: number;
  /** vs same day last year. null when no prior-year data. */
  vsLastYearMi: number | null;
  vsLastYearDelta: number | null;
  /** Projected EOY miles based on current pace. */
  projectedEoyMi: number;
  projectedDelta: number | null;
  timeOnFeetHr: number;
  elevationGainKFt: number;
  /** Avg pace display. null when no HR-validated data. */
  avgPace: string | null;
  avgPaceVs2025: string | null;
  caloriesK: number | null;
  caloriesEquiv: string | null;
}

// ─────────────────────────────────────────────────────────────────────
// The single load entry point.
// ─────────────────────────────────────────────────────────────────────

interface OverviewApiPayload {
  ok: boolean;
  today: string;
  state: CoachState;
  workout: CoachDecision<WorkoutPrescription>;
  readiness: CoachDecision<ReadinessAssessment>;
  bodySystems: CoachDecision<BodySystemsReport>;
  trajectory: CoachDecision<Trajectory14wk>;
  weekDeltas: CoachDecision<WeekDeltasReport>;
  raceFitnessA: CoachDecision<RaceFitnessPrediction> | null;
  raceFitnessB: CoachDecision<RaceFitnessPrediction> | null;
  recentAdjustments?: CoachDecision<RecentAdjustmentsReport> | null;
  adjustedToday?: CoachDecision<AdjustedPlan> | null;
  freshness?: FreshnessMap;
  pathToRace?: CoachDecision<PathToRaceResult> | null;
  nextPushes?: CoachDecision<NextPushesReport>;
  narrative?: NarrativeLine | null;
  briefing?: CoachDecision<DailyBriefing> | null;
  planWeekWorkouts?: Array<{
    dateISO: string;
    type: string;
    distanceMi: number;
    isQuality: boolean;
    isLong: boolean;
    paceTargetSPerMi: number | null;
    notes: string;
    subLabel?: string | null;
  }> | null;
  planCurrentPhase?: string | null;
  profileName?: string | null;
  planFutureLongRuns?: Array<{ weekStartISO: string; longMi: number }>;
  error?: string;
}

export async function loadOverviewData(
  activities: NormalizedActivity[] | null,
  stravaFetchedAtMs: number | null = null,
): Promise<OverviewData> {
  const [savedRaces, api] = await Promise.all([
    listRaces().catch(() => [] as SavedRace[]),
    fetchOverviewApi(),
  ]);

  const today = api.today;

  // Race calendar.
  const upcoming = savedRaces
    .filter((r) => daysUntil(r.meta.date) >= 0)
    .sort((a, b) => daysUntil(a.meta.date) - daysUntil(b.meta.date));
  const past = savedRaces
    .filter((r) => daysUntil(r.meta.date) < 0)
    .sort((a, b) => daysUntil(b.meta.date) - daysUntil(a.meta.date));

  const nextA = upcoming.find((r) => (r.meta.priority ?? 'A') === 'A') ?? null;
  const nextB = upcoming.find((r) => r.meta.priority === 'B') ?? null;
  const daysToNextA = nextA ? daysUntil(nextA.meta.date) : null;

  // Strava-backed rollups (client-side).
  const runs = activities ? onlyRuns(activities) : null;
  const rollup = runs && runs.length > 0 ? rollupYear(runs) : null;
  const heatmap = runs && runs.length > 0 ? yearOfRunningHeatmap(runs) : null;
  const weeklyHistory = runs && runs.length > 0 ? weeklyMiles(runs, 12) : null;
  const prs = runs && runs.length > 0 ? naivePRs(runs) : null;
  const effort = runs && runs.length > 0 ? effortBalance(runs) : null;

  const coachState = api.state;
  const vdotLib = vdotSnapshot(coachState);

  // Sub-snapshots — each returns null when its data source is empty.
  const profile = getProfileSnapshot(today, api.profileName ?? null);
  const adjustedAnswer = api.adjustedToday?.answer ?? null;
  const renderedWorkout = adjustedAnswer?.changed
    ? adjustedAnswer.workout
    : api.workout.answer;
  // Plan-as-artifact structure takes precedence over engine simulation.
  // When the plan has a workout for today, derive structure from its type/
  // distance/pace. Engine structure is the fallback for dates with no plan.
  const planTodayWorkout = (api.planWeekWorkouts ?? []).find(w => w.dateISO === today) ?? null;
  const workoutStructure = planTodayWorkout
    ? getPlanWorkoutStructure(planTodayWorkout)
    : getWorkoutStructure(renderedWorkout);
  const planAdapted = getPlanAdapted(api.weekDeltas.answer, api.recentAdjustments ?? null);
  const checkinReadiness = getCheckinReadiness(coachState);
  const biometrics = getBiometricsSnapshot();
  const vdot = getVdotSnapshot(vdotLib, today);
  const load = getLoadSnapshot(coachState);
  const paceZones = getPaceZonesSnapshot(vdotLib, coachState, api.raceFitnessA);
  const weeklyMilesStrip = getWeeklyMilesStrip(weeklyHistory, api.trajectory.answer, coachState);
  const longRunStrip = getLongRunStrip(runs, savedRaces, today, api.planFutureLongRuns ?? []);
  const year = getYearSnapshot(rollup, heatmap, prs, runs, savedRaces, today);

  // Swap api.workout for the adjusted workout when adjustForReality
  // returned changed=true. Same CoachDecision wrapper, new answer.
  const workoutDecision: CoachDecision<WorkoutPrescription> = adjustedAnswer?.changed
    ? {
        ...api.workout,
        answer: adjustedAnswer.workout,
        rationale: api.adjustedToday?.rationale ?? api.workout.rationale,
      }
    : api.workout;

  const adjustedToday: TodayAdjustment | null = adjustedAnswer?.changed
    ? {
        why: adjustedAnswer.adjustedFor.join(' · '),
        reasons: adjustedAnswer.adjustedFor,
      }
    : null;

  // Wave J · narrative line — computed server-side; client just renders.
  const narrative = api.narrative ?? null;

  // v4 · daily briefing — composed server-side, ready to drop into the
  // CoachStrip's left column. The decision wrapper exposes citations;
  // the rendered text is `.answer.text` and the strip label is `.answer.label`.
  const briefing = api.briefing?.answer ?? null;

  // Wave G · alive-coach payload. PathToRace + NextPushes + Readiness
  // were computed server-side and bundled into the API response so the
  // coach engine never enters the client bundle. The chip builder here
  // is pure: it composes those decisions + freshness signals into the
  // WatchingChip[] the strip renders.
  const aliveCoach = api.pathToRace !== undefined && api.nextPushes
    ? loadAliveCoachData({
        state: coachState,
        today,
        stravaFetchedAtMs,
        checkin: coachState.checkin,
        pathToRace: api.pathToRace,
        nextPushes: api.nextPushes,
        readiness: api.readiness,
      })
    : ({
        watching: [],
        pathToRace: null,
        nextPushes: {
          answer: { pushes: [], rationale: 'awaiting api' },
          rationale: 'awaiting api',
          citations: [],
          brain: 'deterministic',
        },
      } as AliveCoachData);

  // Wave L · freshness map. The API route returns it; fall back to a
  // synthesized empty map for safety, but the route always provides it.
  const freshness: FreshnessMap = api.freshness ?? emptyFreshnessMap();

  return {
    today,
    profile,
    state: coachState,
    races: { upcoming, past, nextA, nextB, daysToNextA },
    strava: { activities, runs, rollup, heatmap, weeklyHistory, prs, effort },
    coach: {
      workout: workoutDecision,
      readiness: api.readiness,
      bodySystems: api.bodySystems,
      trajectory: api.trajectory,
      weekDeltas: api.weekDeltas,
      raceFitnessA: api.raceFitnessA,
      raceFitnessB: api.raceFitnessB,
    },
    workoutStructure,
    planAdapted,
    checkinReadiness,
    adjustedToday,
    biometrics,
    vdot,
    load,
    paceZones,
    weeklyMilesStrip,
    longRunStrip,
    year,
    narrative,
    briefing,
    aliveCoach,
    freshness,
    planWeekWorkouts: api.planWeekWorkouts ?? null,
    planCurrentPhase: api.planCurrentPhase ?? null,
  };
}

/** Minimal "all unavailable" freshness map for the edge case where the
 *  API route omits it. Production code path always provides one. */
function emptyFreshnessMap(): FreshnessMap {
  const unavailable = (source: FreshnessMap[keyof FreshnessMap]['source']) => ({
    source,
    label: 'AWAITING DATA',
    isAvailable: false,
    isStale: false,
    staleness: 'unavailable' as const,
    lastRefreshISO: null,
    daysSince: null,
    reason: 'No signal yet',
  });
  return {
    strava: unavailable('strava'),
    checkin: unavailable('checkin'),
    vdotAnchor: unavailable('vdot-anchor'),
    profile: unavailable('profile'),
    raceCal: unavailable('race-cal'),
    healthkit: unavailable('healthkit'),
  };
}

// ─────────────────────────────────────────────────────────────────────
// /api/overview — single bundled server call.
// ─────────────────────────────────────────────────────────────────────

async function fetchOverviewApi(): Promise<OverviewApiPayload> {
  try {
    const res = await fetch('/api/overview', { cache: 'no-store' });
    if (!res.ok) throw new Error(`/api/overview ${res.status}`);
    const json = (await res.json()) as OverviewApiPayload;
    if (!json.ok) throw new Error(json.error || 'overview api not ok');
    return json;
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e));
  }
}

// ─────────────────────────────────────────────────────────────────────
// Profile snapshot
// ─────────────────────────────────────────────────────────────────────

function getProfileSnapshot(today: string, profileName: string | null): ProfileSnapshot {
  const hour = new Date(today + 'T12:00:00').getHours();
  const greeting =
    hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return {
    name: profileName ?? 'Runner',
    greeting,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Workout structure split
// ─────────────────────────────────────────────────────────────────────

/**
 * Derive a warm-up / main / cool-down structure from the plan artifact.
 * Plan data is canonical — engine simulation is only a fallback when no
 * plan workout exists for today.
 */
function getPlanWorkoutStructure(wo: {
  type: string;
  distanceMi: number;
  paceTargetSPerMi: number | null;
}): WorkoutStructureBlock[] {
  const totalMi = wo.distanceMi;
  const paceS   = wo.paceTargetSPerMi;

  switch (wo.type) {
    case 'easy':
    case 'recovery':
    case 'shakeout': {
      const easyS  = paceS ?? 560;
      const warmMi = Math.max(0.5, Math.round(totalMi * 0.15 * 10) / 10);
      const coolMi = Math.max(0.5, Math.round(totalMi * 0.15 * 10) / 10);
      const mainMi = Math.round((totalMi - warmMi - coolMi) * 10) / 10;
      const warmS  = Math.round(warmMi * (easyS + 30));
      const mainS  = Math.round(mainMi * easyS);
      return [
        { timeOffset: '0:00',           name: 'Warm-up · easy aerobic',   distance: `${warmMi.toFixed(1)} mi`, pace: fmtPace(easyS + 30) },
        { timeOffset: fmtClock(warmS),  name: 'Main · easy',              distance: `${mainMi.toFixed(1)} mi`, pace: fmtPace(easyS), isMain: true },
        { timeOffset: fmtClock(warmS + mainS), name: 'Cool-down · drop pace', distance: `${coolMi.toFixed(1)} mi`, pace: fmtPace(easyS + 30) },
      ];
    }

    case 'long': {
      const longS  = paceS ?? 570;
      const warmMi = Math.min(1.5, Math.round(totalMi * 0.10 * 10) / 10);
      const coolMi = Math.min(1.0, Math.round(totalMi * 0.08 * 10) / 10);
      const mainMi = Math.round((totalMi - warmMi - coolMi) * 10) / 10;
      const warmS  = Math.round(warmMi * (longS + 30));
      const mainS  = Math.round(mainMi * longS);
      return [
        { timeOffset: '0:00',           name: 'Easy build · settle in',        distance: `${warmMi.toFixed(1)} mi`, pace: fmtPace(longS + 30) },
        { timeOffset: fmtClock(warmS),  name: 'Main · long aerobic',           distance: `${mainMi.toFixed(1)} mi`, pace: fmtPace(longS), isMain: true },
        { timeOffset: fmtClock(warmS + mainS), name: 'Cool-down · walk if needed', distance: `${coolMi.toFixed(1)} mi`, pace: fmtPace(longS + 30) },
      ];
    }

    case 'threshold': {
      const threshS = paceS ?? 450;
      const easyS   = threshS + 75;
      const warmMi  = Math.min(2.0, Math.round(totalMi * 0.25 * 10) / 10);
      const coolMi  = Math.min(1.5, Math.round(totalMi * 0.18 * 10) / 10);
      const mainMi  = Math.round((totalMi - warmMi - coolMi) * 10) / 10;
      const warmS   = Math.round(warmMi * easyS);
      const mainS   = Math.round(mainMi * threshS);
      return [
        { timeOffset: '0:00',           name: 'Warm-up · easy aerobic',   distance: `${warmMi.toFixed(1)} mi`, pace: fmtPace(easyS) },
        { timeOffset: fmtClock(warmS),  name: 'Threshold blocks',         distance: `${mainMi.toFixed(1)} mi`, pace: fmtPace(threshS), isMain: true },
        { timeOffset: fmtClock(warmS + mainS), name: 'Cool-down · jog easy', distance: `${coolMi.toFixed(1)} mi`, pace: fmtPace(easyS) },
      ];
    }

    case 'interval': {
      const intS   = paceS ?? 420;
      const easyS  = intS + 105;
      const warmMi = Math.min(2.0, Math.round(totalMi * 0.25 * 10) / 10);
      const coolMi = Math.min(1.0, Math.round(totalMi * 0.12 * 10) / 10);
      const mainMi = Math.round((totalMi - warmMi - coolMi) * 10) / 10;
      const warmS  = Math.round(warmMi * easyS);
      const mainS  = Math.round(mainMi * intS);
      return [
        { timeOffset: '0:00',           name: 'Warm-up + drills/strides', distance: `${warmMi.toFixed(1)} mi`, pace: fmtPace(easyS) },
        { timeOffset: fmtClock(warmS),  name: 'VO₂ max intervals',        distance: `${mainMi.toFixed(1)} mi`, pace: fmtPace(intS), isMain: true },
        { timeOffset: fmtClock(warmS + mainS), name: 'Cool-down · easy',  distance: `${coolMi.toFixed(1)} mi`, pace: fmtPace(easyS) },
      ];
    }

    case 'mp': {
      const mpS    = paceS ?? 480;
      const easyS  = mpS + 75;
      const warmMi = Math.min(2.0, Math.round(totalMi * 0.20 * 10) / 10);
      const coolMi = Math.min(1.5, Math.round(totalMi * 0.12 * 10) / 10);
      const mainMi = Math.round((totalMi - warmMi - coolMi) * 10) / 10;
      const warmS  = Math.round(warmMi * easyS);
      const mainS  = Math.round(mainMi * mpS);
      return [
        { timeOffset: '0:00',           name: 'Warm-up · easy aerobic',    distance: `${warmMi.toFixed(1)} mi`, pace: fmtPace(easyS) },
        { timeOffset: fmtClock(warmS),  name: 'Marathon pace blocks',      distance: `${mainMi.toFixed(1)} mi`, pace: fmtPace(mpS), isMain: true },
        { timeOffset: fmtClock(warmS + mainS), name: 'Cool-down · jog easy', distance: `${coolMi.toFixed(1)} mi`, pace: fmtPace(easyS) },
      ];
    }

    case 'race': {
      const raceS  = paceS ?? 450;
      return [
        { timeOffset: '0:00',                      name: 'Warm-up · easy jog',    distance: '1.0 mi', pace: fmtPace(raceS + 90) },
        { timeOffset: fmtClock(Math.round(raceS + 90) * 1), name: 'Race', distance: `${(totalMi - 1.5).toFixed(1)} mi`, pace: fmtPace(raceS), isMain: true },
        { timeOffset: fmtClock(Math.round((raceS + 90) + (totalMi - 1.5) * raceS)), name: 'Cool-down', distance: '0.5 mi', pace: fmtPace(raceS + 90) },
      ];
    }

    default:
      return [];
  }
}

function getWorkoutStructure(workout: WorkoutPrescription): WorkoutStructureBlock[] {
  // The Coach prescription is one paragraph today; we synthesize the
  // warm-up / main / cool-down split from the distance + paceTarget.
  // Stage-9 wires coach.prescribeWorkout to return a structured break.
  const totalMi = workout.distanceMi ?? 3.0;
  const paceMid = workout.paceTargetSPerMi
    ? (workout.paceTargetSPerMi.lower + workout.paceTargetSPerMi.upper) / 2
    : 540; // 9:00/mi default
  const warmMi = Math.max(0.4, Math.round(totalMi * 0.16 * 10) / 10);
  const coolMi = Math.max(0.4, Math.round(totalMi * 0.16 * 10) / 10);
  const mainMi = Math.round((totalMi - warmMi - coolMi) * 10) / 10;
  const warmS = Math.round(warmMi * (paceMid + 30));
  const mainS = Math.round(mainMi * paceMid);
  return [
    {
      timeOffset: '0:00',
      name: 'Warm-up · easy aerobic',
      distance: `${warmMi.toFixed(1)} mi`,
      pace: fmtPace(paceMid + 30),
    },
    {
      timeOffset: fmtClock(warmS),
      name: 'Main · steady',
      distance: `${mainMi.toFixed(1)} mi`,
      pace: fmtPace(paceMid),
      isMain: true,
    },
    {
      timeOffset: fmtClock(warmS + mainS),
      name: 'Cool-down · drop pace',
      distance: `${coolMi.toFixed(1)} mi`,
      pace: fmtPace(paceMid + 25),
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────
// Plan-adapted decision deltas
// ─────────────────────────────────────────────────────────────────────

function getCheckinReadiness(state: CoachState): CheckinReadinessSnapshot | null {
  const c = state.checkin;
  if (!c || c.rowsCount === 0) return null;
  const poorDays = c.poorDaysCount ?? 0;
  let pinLabel = 'STEADY';
  let pinVariant: CheckinReadinessSnapshot['pinVariant'] = 'green';
  let headline = 'Check-ins steady.';
  let body = `${c.rowsCount} of the last 7 days logged. Energy ${c.avgEnergy?.toFixed(1) ?? '—'}/10, soreness ${c.avgSoreness?.toFixed(1) ?? '—'}/10, stress ${c.avgStress?.toFixed(1) ?? '—'}/10.`;
  if (poorDays >= 3) {
    pinLabel = 'CUTBACK';
    pinVariant = 'warn';
    headline = `${poorDays} poor days this week.`;
    body = `Doctrine reads ${poorDays} flagged days as a recovery pattern, not a one-off. Cutback territory until signals clear.`;
  } else if (poorDays >= 2) {
    pinLabel = 'WATCHING';
    pinVariant = 'amber';
    headline = `${poorDays} check-ins flagged.`;
    body = `Two qualitative signals firing in the last week. Holding the next quality if they don't clear in 24-48h.`;
  } else if (poorDays === 1) {
    headline = 'One flagged day — not a pattern yet.';
  }
  return {
    rowsCount: c.rowsCount,
    latestDateISO: c.latestDateISO ?? '',
    loggedToday: c.loggedToday,
    avgEnergyDisplay: c.avgEnergy != null ? c.avgEnergy.toFixed(1) : '—',
    avgSorenessDisplay: c.avgSoreness != null ? c.avgSoreness.toFixed(1) : '—',
    avgStressDisplay: c.avgStress != null ? c.avgStress.toFixed(1) : '—',
    poorDaysCount: poorDays,
    pinLabel,
    pinVariant,
    headline,
    body,
  };
}

function getPlanAdapted(
  _weekDeltas: WeekDeltasReport,
  recent: CoachDecision<RecentAdjustmentsReport> | null,
): PlanAdaptedReport | null {
  if (!recent) return null;
  const items = recent.answer.items;
  if (items.length === 0) return null;
  const head = items[0];
  return {
    title: `${items.length} adjustment${items.length === 1 ? '' : 's'} this week`,
    body: head.why
      ? `${head.dateDisplay} · ${head.changeDisplay}. ${head.why}.`
      : `${head.dateDisplay} · ${head.changeDisplay}.`,
    pinLabel: items.length >= 3 ? 'HEAVY ADJUST' : 'COACH ADJUSTED',
    deltas: [],
    footLeft: `${items.length} of last 7 days · doctrine driven`,
    items,
  };
}


// ─────────────────────────────────────────────────────────────────────
// Biometrics — HealthKit-blocked
// ─────────────────────────────────────────────────────────────────────

function getBiometricsSnapshot(): BiometricsSnapshot | null {
  // HRV / RHR / sleep / subjective effort all need HealthKit (M2) or a
  // daily check-in (not built). Until one lands, this is null and the
  // page renders an AWAITING HEALTHKIT empty state.
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// VDOT
// ─────────────────────────────────────────────────────────────────────

function getVdotSnapshot(
  snap: VdotLibSnapshot | null,
  _today: string,
): VdotSnapshot | null {
  if (!snap) return null;

  const vdot = snap.vdot;
  const tier =
    vdot < 38 ? 'NOVICE' :
    vdot < 46 ? 'INTERMED' :
    vdot < 58 ? 'ADV' :
    'ELITE';
  const tierActive = (t: string) => t === tier;
  // Band sits centered on the runner's VDOT within a 30..70 range.
  const bandCenter = Math.max(0, Math.min(1, (vdot - 30) / 40));
  const bandWidth = 0.10;
  const bandPosition = Math.max(0, Math.min(1 - bandWidth, bandCenter - bandWidth / 2));

  const sourceLabel = `${snap.source.name.toUpperCase()} · ${fmtDuration(snap.source.timeS)} · ${daysAgoLabel(snap.source.daysAgo)}`;

  return {
    value: vdot.toFixed(1),
    detailLine: `FROM ${distLabelFromMi(snap.source.distanceMi)} · ${snap.source.daysAgo}D AGO`,
    source: sourceLabel,
    tiers: [
      { label: 'NOVICE', active: tierActive('NOVICE') },
      { label: 'INTERMED', active: tierActive('INTERMED') },
      { label: `ADV${tierActive('ADV') ? ' ◀ YOU' : ''}`, active: tierActive('ADV') },
      { label: 'ELITE', active: tierActive('ELITE') },
    ],
    bandPosition,
    bandWidth,
    scaleLabels: ['30', '40', '50', '60', '70'],
    equivalents: equivalentTimesFromVdot(snap),
  };
}

function equivalentTimesFromVdot(snap: VdotLibSnapshot): Array<{ distance: string; time: string; isGoal?: boolean }> {
  const row = vdotRow(snap.vdot);
  if (!row) return [];
  return [
    { distance: '5K', time: fmtDuration(row.km5S) },
    { distance: '10K', time: fmtDuration(row.km10S) },
    { distance: 'HM', time: fmtDuration(row.halfS) },
    { distance: 'M', time: fmtDuration(row.marathonS) },
  ];
}

// ─────────────────────────────────────────────────────────────────────
// Load gauge
// ─────────────────────────────────────────────────────────────────────

function getLoadSnapshot(state: CoachState): LoadSnapshot | null {
  // Need both a last-7 and an 8-week baseline to anchor ACWR.
  if (state.volume.last7Mi <= 0 || state.volume.weeklyAvg8w <= 0) return null;

  const acwr = state.volume.last7Mi / state.volume.weeklyAvg8w;
  const v = Math.round(acwr * 100) / 100;
  let pinLabel = 'SWEET SPOT';
  let pinVariant: LoadSnapshot['pinVariant'] = 'green';
  let trendLabel = '▲ HOLDING SWEET SPOT';
  if (acwr > 1.5) {
    pinLabel = 'OVERREACH';
    pinVariant = 'warn';
    trendLabel = '▲ OVERREACH';
  } else if (acwr > 1.3) {
    pinLabel = 'STRETCHED';
    pinVariant = 'amber';
    trendLabel = '▲ STRETCHED';
  } else if (acwr < 0.5) {
    pinLabel = 'DETRAIN';
    pinVariant = 'warn';
    trendLabel = '▼ DETRAIN';
  } else if (acwr < 0.8) {
    pinLabel = 'EASING';
    pinVariant = 'amber';
    trendLabel = '▼ EASING';
  }

  // 4-week ACWR trend — we have weeklyAvg4w and weeklyAvg8w plus last7.
  // Without a true rolling acwr_w-3 .. acwr_w-0 series we approximate
  // with a 3-point reconstruction: w-1 ≈ avg4w/avg8w, w0 = current.
  // The trend renders as a 3-bar mini-sparkline rather than a 4-bar one
  // when we lack the deeper history — honest dataset shape, not a fake
  // 4-week curve.
  const ratio4v8 =
    state.volume.weeklyAvg8w > 0
      ? state.volume.weeklyAvg4w / state.volume.weeklyAvg8w
      : null;
  const trend: number[] = [];
  if (ratio4v8 != null) trend.push(Math.round(ratio4v8 * 100) / 100);
  trend.push(v);

  return {
    value: v.toFixed(2),
    pinLabel,
    pinVariant,
    bandLine: '0.8–1.2 SAFE',
    trendLabel,
    trend,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Pace zones
// ─────────────────────────────────────────────────────────────────────

function getPaceZonesSnapshot(
  snap: VdotLibSnapshot | null,
  state: CoachState,
  raceFitnessA: CoachDecision<RaceFitnessPrediction> | null,
): PaceZonesSnapshot | null {
  if (!snap) return null;
  const p = snap.paces;
  const easyShare = state.intensity.easyShare14d;
  const easyMi14d = state.intensity.easyMi14d;
  const hardMi14d = state.intensity.hardMi14d;
  const totalMi14d = easyMi14d + hardMi14d;

  const fmt = (s: number) => fmtPaceLoose(s);
  const eLow = p.E.lowS;
  const eHigh = p.E.highS;
  const mMid = Math.round((p.M.lowS + p.M.highS) / 2);
  const tMid = Math.round((p.T.lowS + p.T.highS) / 2);
  const iMid = Math.round((p.I.lowS + p.I.highS) / 2);
  const rMid = Math.round((p.R.lowS + p.R.highS) / 2);

  const easyPct = Math.round(easyShare * 100);
  const hardPct = 100 - easyPct;

  // Goal pace from raceFitnessA when set; otherwise leave as a dash.
  const goalPaceS = raceFitnessA?.answer.goalPaceSPerMi ?? null;
  const fitnessPaceS = raceFitnessA?.answer.predictedPaceSPerMi ?? null;
  const headroomS = raceFitnessA?.answer.headroomSPerMi ?? 0;

  return {
    source: `VDOT ${snap.vdot.toFixed(1)} · DANIELS`,
    raceAnchor: snap.source.name.toUpperCase(),
    zones: [
      { letter: 'E', label: 'Easy', value: fmt(eLow), rangeSuffix: `–${fmt(eHigh).split(':').slice(1).join(':')}` },
      { letter: 'M', label: 'Marathon', value: fmt(mMid) },
      { letter: 'T', label: 'Threshold', value: fmt(tMid) },
      { letter: 'I', label: 'Interval', value: fmt(iMid) },
      { letter: 'R', label: 'Rep', value: fmt(rMid) },
    ],
    distribution:
      totalMi14d > 0
        ? [
            {
              zoneLetter: 'E',
              label: 'EASY',
              timeDisplay: `${easyMi14d.toFixed(1)} MI`,
              barFraction: easyShare,
              color: 'var(--good)',
            },
            {
              zoneLetter: 'M',
              label: 'MARATHON',
              timeDisplay: '—',
              barFraction: 0,
              color: 'var(--corp)',
              muted: true,
            },
            {
              zoneLetter: 'T',
              label: 'THRESHOLD',
              timeDisplay: `${hardMi14d.toFixed(1)} MI`,
              barFraction: 1 - easyShare,
              color: 'var(--milestone)',
            },
            { zoneLetter: 'I', label: 'INTERVAL', timeDisplay: '—', barFraction: 0, color: 'var(--warn)', muted: true },
            { zoneLetter: 'R', label: 'REP', timeDisplay: '—', barFraction: 0, color: 'var(--xp)', muted: true },
          ]
        : [],
    shareLine:
      totalMi14d > 0
        ? `Running ${easyPct}% easy · aiming ≥80% · ${easyPct >= 80 ? '✓' : 'pull back hard work'}`
        : 'No intensity data yet · log runs to anchor the distribution',
    currentFitnessPace: fitnessPaceS ? `${fmt(fitnessPaceS)}/MI` : '—',
    goalPace: goalPaceS ? `${fmt(goalPaceS)}/MI` : '—',
    headroomS: Math.round(headroomS),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Weekly miles · 4 past + 4 ahead
// ─────────────────────────────────────────────────────────────────────

function getWeeklyMilesStrip(
  weeklyHistory: Array<{ weekStart: string; miles: number; runs: number }> | null,
  trajectory: Trajectory14wk,
  state: CoachState,
): WeeklyMilesStrip | null {
  // weeklyHistory contains the last 12 weeks (oldest → newest); the
  // most recent slot is THIS week.
  if (!weeklyHistory || weeklyHistory.length === 0) return null;

  const recent = weeklyHistory.slice(-5); // last 5 weeks incl current
  const past = recent.slice(0, 4); // 4 prior weeks
  const thisWeek = recent[recent.length - 1] ?? { miles: state.volume.last7Mi, weekStart: '' };

  // Future weeks from trajectory. trajectory14wk's points include 4
  // past + present + 9 future. We slice the first 3 future points.
  const futurePoints = trajectory.points
    .filter((p) => p.phase !== 'past' && p.label !== 'NOW')
    .slice(0, 3);

  const bars: WeeklyMilesStrip['bars'] = past.map((w) => ({
    miles: Math.round(w.miles),
    date: shortDate(w.weekStart),
    kind: 'past',
  }));
  bars.push({
    miles: Math.round(thisWeek.miles),
    date: shortDate(thisWeek.weekStart),
    kind: 'now',
  });
  futurePoints.forEach((p) => {
    bars.push({
      miles: Math.round(p.plannedMi),
      date: shortDate(p.weekStartISO),
      kind: 'future',
    });
  });

  // Pin label = current week vs 8-week average.
  const avg8w = state.volume.weeklyAvg8w;
  const deltaPct =
    avg8w > 0 ? Math.round(((thisWeek.miles - avg8w) / avg8w) * 100) : 0;
  const pinLabel =
    deltaPct > 5 ? `↑${deltaPct}% vs 8W AVG` :
    deltaPct < -5 ? `↓${Math.abs(deltaPct)}% vs 8W AVG` :
    'ON BASELINE';

  // Peak label from history.
  const peakWeek = weeklyHistory.reduce((m, w) => (w.miles > m.miles ? w : m), weeklyHistory[0]);
  const peakLabel = peakWeek.miles > 0
    ? `PEAK · ${shortDate(peakWeek.weekStart)} · ${Math.round(peakWeek.miles)} MI`
    : '—';

  return {
    pinLabel,
    thisWeekMi: Math.round(thisWeek.miles),
    bars,
    peakLabel,
    footRight: deltaPct > 0 ? 'BUILDING' : deltaPct < 0 ? 'RECOVERING' : 'HOLDING',
  };
}

// ─────────────────────────────────────────────────────────────────────
// Long-run progression · 6 past + 4 ahead
// ─────────────────────────────────────────────────────────────────────

function getLongRunStrip(
  runs: NormalizedActivity[] | null,
  savedRaces: SavedRace[],
  today: string,
  futureLongRuns: Array<{ weekStartISO: string; longMi: number }> = [],
): LongRunStrip | null {
  if (!runs || runs.length === 0) return null;

  // Compute the longest run per ISO week (Mon-anchored) for the last 6 weeks.
  const todayD = new Date(today + 'T12:00:00');
  const monday = new Date(todayD);
  const dayOfWeek = monday.getDay();
  monday.setDate(monday.getDate() + (dayOfWeek === 0 ? -6 : 1 - dayOfWeek));
  monday.setHours(0, 0, 0, 0);

  const buckets: Array<{ weekStartISO: string; longest: number; kind: 'past' | 'past-race' | 'now' }> = [];
  for (let w = 5; w >= 0; w--) {
    const start = new Date(monday);
    start.setDate(monday.getDate() - 7 * w);
    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    const startISO = start.toISOString().slice(0, 10);
    const endISO = end.toISOString().slice(0, 10);
    const inWeek = runs.filter((r) => r.date >= startISO && r.date < endISO);
    const longest = inWeek.reduce((m, r) => Math.max(m, r.distanceMi), 0);
    // Was a race finished this week?
    const raceThisWeek = savedRaces.some(
      (r) => r.meta.date >= startISO && r.meta.date < endISO,
    );
    buckets.push({
      weekStartISO: startISO,
      longest: Math.round(longest * 10) / 10,
      kind: w === 0 ? 'now' : raceThisWeek ? 'past-race' : 'past',
    });
  }

  if (buckets.every((b) => b.longest === 0)) return null;

  const bars: LongRunStrip['bars'] = buckets.map((b) => ({
    miles: b.longest,
    date: shortDate(b.weekStartISO),
    kind: b.kind,
  }));

  // Pad with 4 future entries from the plan artifact (Sunday long run distance).
  for (let w = 1; w <= 4; w++) {
    const future = new Date(monday);
    future.setDate(monday.getDate() + 7 * w);
    const futureMonISO = future.toISOString().slice(0, 10);
    const planEntry = futureLongRuns.find((r) => r.weekStartISO === futureMonISO);
    bars.push({
      miles: planEntry?.longMi ?? 0,
      date: shortDate(futureMonISO),
      kind: 'future',
    });
  }

  const peakMi = Math.max(...buckets.map((b) => b.longest));
  const thisWeekMi = buckets[buckets.length - 1].longest;

  return {
    pinLabel: peakMi > 0 ? `PEAK ${peakMi} MI` : '—',
    nextMi: Math.round(thisWeekMi),
    nextLabel: 'THIS WK',
    bars,
    footLeft: thisWeekMi >= peakMi ? 'BUILDING' : 'HOLDING',
    footRight: '—',
  };
}

// ─────────────────────────────────────────────────────────────────────
// Year-in-running snapshot
// ─────────────────────────────────────────────────────────────────────

function getYearSnapshot(
  rollup: YearRollup | null,
  heatmap: Array<{ date: string; miles: number; runs: number }> | null,
  prs: Array<{ label: string; distMi: number; bestS: number | null; activityId: number | null; date: string | null }> | null,
  runs: NormalizedActivity[] | null,
  savedRaces: SavedRace[],
  today: string,
): YearSnapshot {
  const monthLabels = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const todayD = new Date(today + 'T12:00:00');
  const currentMonth = todayD.getMonth();
  const year = todayD.getFullYear();

  // 52-week heatmap from real per-day data.
  const heatmapCells = buildHeatmapCells(heatmap, savedRaces, today);

  // Monthly volume — sum by calendar month from runs.
  const monthly: YearSnapshot['monthly'] =
    runs && runs.length > 0
      ? monthLabels.map((label, i) => {
          const monthRuns = runs.filter((r) => {
            const m = r.date.match(/^(\d{4})-(\d{2})/);
            return m && Number(m[1]) === year && Number(m[2]) - 1 === i;
          });
          const miles = monthRuns.reduce((s, r) => s + r.distanceMi, 0);
          return {
            label,
            miles: i > currentMonth ? null : Math.round(miles),
            isCurrent: i === currentMonth,
            isFuture: i > currentMonth,
          };
        })
      : [];

  // Highlights — derived from rollup + runs + races.
  const highlights = buildHighlights(rollup, runs, savedRaces);

  // PRs from naivePRs — only the buckets that actually have a result.
  const prShelf: YearSnapshot['prs'] = [];
  if (prs) {
    for (const p of prs) {
      if (p.bestS == null) continue;
      const label = p.label === 'Half' ? 'HALF' : p.label.toUpperCase();
      const meta = p.date ? formatShortDateMeta(p.date) : '—';
      prShelf.push({ distance: label, time: fmtDuration(p.bestS), meta });
    }
  }

  // YTD numbers from rollup. We don't have a 2025 rollup to diff
  // against, so vsLastYear / projected delta / avgPaceVs2025 / calories
  // come out null. The page renders dashes for those — honest, not
  // a fake "+22 mi vs 2025" boast.
  const ytd: YtdSnapshot | null = rollup
    ? buildYtd(rollup, today)
    : null;

  // Top stats: runs + days + avg HR from rollup. When no data, show empty.
  const topStats: YearSnapshot['topStats'] = rollup
    ? [
        { value: String(rollup.totalRuns), label: 'RUNS' },
        { value: String(rollup.daysRun), label: 'DAYS' },
        ...(rollup.avgHr != null ? [{ value: String(rollup.avgHr), label: 'HR' }] : []),
      ]
    : [];

  return {
    topStats,
    heatmap: heatmapCells,
    monthly,
    highlights,
    prs: prShelf,
    ytd,
  };
}

function buildHeatmapCells(
  heatmap: Array<{ date: string; miles: number; runs: number }> | null,
  savedRaces: SavedRace[],
  today: string,
): YearSnapshot['heatmap'] {
  if (!heatmap || heatmap.length === 0) return [];

  // Bucket the heatmap by ISO week of the year. We render one cell per
  // week — colour by miles (green ramp), red on race weeks, dashed
  // future weeks for future races.
  const todayD = new Date(today + 'T12:00:00');
  const yearStart = new Date(todayD.getFullYear(), 0, 1);

  // Race lookup by ISO YYYY-WW.
  const raceWeekKeys = new Set<string>();
  const futureRaceWeekKeys = new Set<string>();
  for (const r of savedRaces) {
    const dateISO = r.meta.date;
    const m = dateISO.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) continue;
    const d = new Date(dateISO + 'T12:00:00');
    if (d.getFullYear() !== todayD.getFullYear()) continue;
    const wk = weekIndex(d, yearStart);
    if (d.getTime() < todayD.getTime()) raceWeekKeys.add(String(wk));
    else futureRaceWeekKeys.add(String(wk));
  }

  // Sum miles per week.
  const weeksMi = new Array<number>(52).fill(0);
  for (const cell of heatmap) {
    const d = new Date(cell.date + 'T12:00:00');
    if (d.getFullYear() !== todayD.getFullYear()) continue;
    const wk = Math.min(51, weekIndex(d, yearStart));
    weeksMi[wk] += cell.miles;
  }
  const maxMi = Math.max(...weeksMi, 1);
  const todayWk = Math.min(51, weekIndex(todayD, yearStart));

  const cells: YearSnapshot['heatmap'] = [];
  for (let w = 0; w < 52; w++) {
    const mi = weeksMi[w];
    const isFutureRace = futureRaceWeekKeys.has(String(w));
    const isRaceWeek = raceWeekKeys.has(String(w));
    const isToday = w === todayWk;
    let color = 'var(--l3)';
    if (isRaceWeek) color = '#FF5722';
    else if (mi > 0) {
      const alpha = 0.15 + (mi / maxMi) * 0.55;
      color = `rgba(62,189,65,${alpha.toFixed(2)})`;
    }
    cells.push({ color, isRaceWeek, isFutureRace, isToday });
  }
  return cells;
}

function weekIndex(d: Date, yearStart: Date): number {
  const dayOffset = Math.floor((d.getTime() - yearStart.getTime()) / 86_400_000);
  return Math.floor(dayOffset / 7);
}

function buildHighlights(
  rollup: YearRollup | null,
  runs: NormalizedActivity[] | null,
  savedRaces: SavedRace[],
): YearSnapshot['highlights'] {
  if (!rollup || !runs || runs.length === 0) return [];

  // Biggest week — sum per ISO week, pick max.
  const weeklyTotals = new Map<string, number>();
  for (const r of runs) {
    const monday = isoMondayOfDate(r.date);
    weeklyTotals.set(monday, (weeklyTotals.get(monday) ?? 0) + r.distanceMi);
  }
  let biggestWeek = { weekStart: '', miles: 0 };
  for (const [weekStart, miles] of weeklyTotals.entries()) {
    if (miles > biggestWeek.miles) biggestWeek = { weekStart, miles };
  }

  // Longest run.
  const longest = runs.reduce((m, r) => (r.distanceMi > m.distanceMi ? r : m), runs[0]);

  // Hilliest run.
  const hilliest = runs.reduce((m, r) => (r.elevGainFt > m.elevGainFt ? r : m), runs[0]);

  const racesThisYear = savedRaces.filter((r) => {
    const m = r.meta.date.match(/^(\d{4})/);
    return m && Number(m[1]) === new Date().getFullYear();
  });

  const out: YearSnapshot['highlights'] = [];
  if (biggestWeek.miles > 0) {
    out.push({
      label: 'BIGGEST WEEK',
      value: String(Math.round(biggestWeek.miles)),
      unit: 'mi',
      meta: `WEEK OF ${formatShortDateMeta(biggestWeek.weekStart)}`,
    });
  }
  if (longest && longest.distanceMi > 0) {
    out.push({
      label: 'LONGEST RUN',
      value: longest.distanceMi.toFixed(1),
      unit: 'mi',
      meta: formatShortDateMeta(longest.date),
      color: 'var(--good)',
    });
  }
  out.push({
    label: 'RACES RUN',
    value: String(racesThisYear.length),
    unit: '',
    meta: racesThisYear.length > 0 ? `${rollup.raceCount} TAGGED · ${rollup.raceMiles.toFixed(0)} MI` : 'NONE LOGGED',
  });
  if (hilliest && hilliest.elevGainFt > 0) {
    out.push({
      label: 'HILLIEST RUN',
      value: (hilliest.elevGainFt / 1000).toFixed(1),
      unit: 'k ft',
      meta: formatShortDateMeta(hilliest.date),
    });
  }
  return out;
}

function buildYtd(rollup: YearRollup, today: string): YtdSnapshot {
  const todayD = new Date(today + 'T12:00:00');
  const yearStart = new Date(todayD.getFullYear(), 0, 1);
  const dayOfYear = Math.floor((todayD.getTime() - yearStart.getTime()) / 86_400_000) + 1;
  const pctOfYear = Math.round((dayOfYear / 365) * 100);
  const projectedEoyMi = dayOfYear > 0 ? Math.round((rollup.totalMiles / dayOfYear) * 365) : 0;
  const timeOnFeetHr = Math.round(rollup.totalMovingS / 3600);
  const elevationGainKFt = Math.round((rollup.totalElevFt / 1000) * 10) / 10;

  let avgPaceDisplay: string | null = null;
  if (rollup.avgPaceSPerMi != null) {
    const m = Math.floor(rollup.avgPaceSPerMi / 60);
    const s = rollup.avgPaceSPerMi - m * 60;
    avgPaceDisplay = `${m}:${String(s).padStart(2, '0')}`;
  }

  return {
    miles: Math.round(rollup.totalMiles),
    dayOfYear,
    pctOfYear,
    // No prior-year rollup available — these stay null until a 2025
    // snapshot is loaded. Page renders dashes.
    vsLastYearMi: null,
    vsLastYearDelta: null,
    projectedEoyMi,
    projectedDelta: null,
    timeOnFeetHr,
    elevationGainKFt,
    avgPace: avgPaceDisplay,
    avgPaceVs2025: null,
    // Calorie estimation needs body weight + HR; not wired.
    caloriesK: null,
    caloriesEquiv: null,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────

function fmtPace(sPerMi: number): string {
  if (!isFinite(sPerMi) || sPerMi <= 0) return '—';
  const mm = Math.floor(sPerMi / 60);
  const ss = Math.round(sPerMi - mm * 60);
  return `${mm}:${ss.toString().padStart(2, '0')}/mi`;
}

function fmtPaceLoose(sPerMi: number): string {
  if (!isFinite(sPerMi) || sPerMi <= 0) return '—';
  const mm = Math.floor(sPerMi / 60);
  const ss = Math.round(sPerMi - mm * 60);
  return `${mm}:${ss.toString().padStart(2, '0')}`;
}

function fmtClock(secs: number): string {
  if (!isFinite(secs) || secs < 0) return '0:00';
  const mm = Math.floor(secs / 60);
  const ss = Math.round(secs - mm * 60);
  return `${mm}:${ss.toString().padStart(2, '0')}`;
}

function fmtDuration(s: number): string {
  if (!isFinite(s) || s <= 0) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s - h * 3600) / 60);
  const sec = Math.round(s - h * 3600 - m * 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function shortDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${Number(m[2])}/${Number(m[3])}`;
}

function formatShortDateMeta(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}`;
}

function distLabelFromMi(mi: number): string {
  if (mi >= 26) return 'MARATHON';
  if (mi >= 13) return 'HALF';
  if (mi >= 9) return '15K';
  if (mi >= 6) return '10K';
  if (mi >= 3) return '5K';
  return `${mi.toFixed(1)} MI`;
}

function daysAgoLabel(days: number): string {
  if (days <= 0) return 'TODAY';
  if (days < 30) return `${days}D AGO`;
  if (days < 365) return `${Math.round(days / 30)} MO AGO`;
  return `${Math.round(days / 365)} YR AGO`;
}

function isoMondayOfDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00');
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().slice(0, 10);
}
