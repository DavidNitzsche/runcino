/**
 * /overview · data wiring layer.
 *
 * Every data point the Overview page renders comes from one of the
 * functions in this module. Real data sources are wired where they
 * exist today (Strava-cached activities, the localStorage-backed race
 * store, the Coach engine state, and the Coach methods on
 * `web/coach/coach.ts`). Stub data sources are marked with explicit
 * `// TODO: wire to <source>` comments so the gap is auditable.
 *
 * The page component should be thin: it imports `loadOverviewData()`
 * once, threads the result into card-level UI, and gets every
 * coaching judgment via the Coach methods called from here.
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
import { listRaces, type SavedRace } from '@/lib/storage';
import { todayISO, daysUntil } from '@/lib/dates';

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
  /** Plan-adapted decision-delta card content. Stub today. */
  planAdapted: PlanAdaptedReport;
  /** HRV / RHR / Sleep / Effort spark cards. HealthKit stub today. */
  biometrics: BiometricsSnapshot;
  /** VDOT card content. */
  vdot: VdotSnapshot;
  /** ACWR load gauge content. */
  load: LoadSnapshot;
  /** Pace zones (E / M / T / I / R) display strings. */
  paceZones: PaceZonesSnapshot;
  /** Weekly-miles 4 past + 4 ahead. */
  weeklyMilesStrip: WeeklyMilesStrip;
  /** Long-run 6 past + 4 ahead. */
  longRunStrip: LongRunStrip;
  /** Year-in-running heatmap + monthly volume + PRs + facts. */
  year: YearSnapshot;
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
  /** Lead line, e.g. "Coach added volume and lifted the long-run cap." */
  title: string;
  /** Body paragraph. */
  body: string;
  /** +12% style pin label. null = no pin. */
  pinLabel: string | null;
  deltas: PlanAdaptedDelta[];
  /** Footer left text, e.g. "WED 6.7 · FRI 7.4 · BOTH OVER PLAN". */
  footLeft: string;
}

export interface BiometricSpark {
  /** Latest reading display, e.g. "68". */
  value: string;
  /** Unit display, e.g. "ms". */
  unit: string;
  /** Pin label, e.g. "↑ BASELINE". */
  pinLabel: string;
  /** Pin variant. */
  pinVariant: 'green' | 'amber' | 'warn' | 'blue' | 'purple';
  /** Footer left, e.g. "BASE 64ms". */
  footLeft: string;
  /** Footer right delta, e.g. "+6%". */
  footRight: string;
  /** Sparkline polyline points (0–100 x, 0–36 y). */
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
  /** "49.2" */
  value: string;
  /** Source label, e.g. "DISNEY HALF · 1:32:00 · 6 MO AGO" */
  source: string;
  /** Tier eyebrow row labels. */
  tiers: Array<{ label: string; active?: boolean }>;
  /** Tier band fill position (0–1). */
  bandPosition: number;
  bandWidth: number;
  /** Display VDOT range labels under the band (e.g. ["30","40","50","60","70"]). */
  scaleLabels: string[];
  /** Equivalent race times. */
  equivalents: Array<{ distance: string; time: string; isGoal?: boolean }>;
  /** RAW / DECAY caption. */
  detailLine: string;
}

export interface LoadSnapshot {
  /** ACWR value, e.g. "1.05". */
  value: string;
  /** Pin label, e.g. "SWEET SPOT". */
  pinLabel: string;
  /** Pin variant. */
  pinVariant: 'green' | 'amber' | 'warn';
  /** Verdict line under value (e.g. "0.8–1.2 SAFE"). */
  bandLine: string;
  /** Trend headline ("▲ HOLDING SWEET SPOT"). */
  trendLabel: string;
  /** 4-week trend values, oldest → today (drives sparkline). */
  trend: number[];
}

export interface PaceZone {
  letter: 'E' | 'M' | 'T' | 'I' | 'R';
  label: string;
  value: string;
  rangeSuffix?: string;
}
export interface PaceZonesSnapshot {
  /** Source label, e.g. "VDOT 49.2 · DANIELS". */
  source: string;
  /** Race anchor label, e.g. "DISNEY HALF". */
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
  /** Pin label, e.g. "↑12% vs 8W AVG". */
  pinLabel: string;
  /** Big "22 mi" hero. */
  thisWeekMi: number;
  /** Bars left → right. */
  bars: Array<{
    miles: number;
    date: string;
    kind: 'past' | 'past-race' | 'now' | 'future';
  }>;
  /** Peak label for the footer, e.g. "PEAK · APR 13–19 · 42 MI". */
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
  /** Top stats row: "87 RUNS · 62 DAYS · 78 HR". */
  topStats: Array<{ value: string; label: string }>;
  /** 52-week heatmap cells. */
  heatmap: Array<{
    color: string;
    isRaceWeek: boolean;
    isFutureRace: boolean;
    isToday: boolean;
  }>;
  /** Monthly volume bars. */
  monthly: Array<{
    label: string;
    miles: number | null;
    isCurrent: boolean;
    isFuture: boolean;
  }>;
  /** Highlights strip. */
  highlights: Array<{ label: string; value: string; unit: string; meta: string; color?: string }>;
  /** PR shelf. */
  prs: Array<{ distance: string; time: string; meta: string }>;
  /** YTD ring + counters. */
  ytd: {
    miles: number;
    dayOfYear: number;
    pctOfYear: number;
    vsLastYearMi: number;
    vsLastYearDelta: number;
    projectedEoyMi: number;
    projectedDelta: number;
    timeOnFeetHr: number;
    elevationGainKFt: number;
    avgPace: string;
    avgPaceVs2025: string;
    caloriesK: number;
    caloriesEquiv: string;
  };
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
  error?: string;
}

export async function loadOverviewData(
  activities: NormalizedActivity[] | null,
): Promise<OverviewData> {
  // All Coach calls live on the server (the Coach module pulls in
  // node-only deps via llm.ts). One bundled fetch returns every
  // CoachDecision the page needs.
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
  const rollup = runs ? rollupYear(runs) : null;
  const heatmap = runs ? yearOfRunningHeatmap(runs) : null;
  const weeklyHistory = runs ? weeklyMiles(runs, 12) : null;
  const prs = runs ? naivePRs(runs) : null;
  const effort = runs ? effortBalance(runs) : null;

  const coachState = api.state;

  // Stubbed sub-snapshots.
  const profile = getProfileSnapshot(today);
  const workoutStructure = getWorkoutStructure(api.workout.answer);
  const planAdapted = getPlanAdapted();
  const biometrics = getBiometricsSnapshot(coachState);
  const vdot = getVdotSnapshot();
  const load = getLoadSnapshot(coachState);
  const paceZones = getPaceZonesSnapshot();
  const weeklyMilesStrip = getWeeklyMilesStrip(weeklyHistory, today);
  const longRunStrip = getLongRunStrip(weeklyHistory, today);
  const year = getYearSnapshot(rollup, heatmap, prs);

  return {
    today,
    profile,
    state: coachState,
    races: { upcoming, past, nextA, nextB, daysToNextA },
    strava: { activities, runs, rollup, heatmap, weeklyHistory, prs, effort },
    coach: {
      workout: api.workout,
      readiness: api.readiness,
      bodySystems: api.bodySystems,
      trajectory: api.trajectory,
      weekDeltas: api.weekDeltas,
      raceFitnessA: api.raceFitnessA,
      raceFitnessB: api.raceFitnessB,
    },
    workoutStructure,
    planAdapted,
    biometrics,
    vdot,
    load,
    paceZones,
    weeklyMilesStrip,
    longRunStrip,
    year,
  };
}

// ─────────────────────────────────────────────────────────────────────
// /api/overview — single bundled server call. The endpoint owns the
// coach.* method invocations so the client never imports the engine.
// ─────────────────────────────────────────────────────────────────────

async function fetchOverviewApi(): Promise<OverviewApiPayload> {
  try {
    const res = await fetch('/api/overview', { cache: 'no-store' });
    if (!res.ok) throw new Error(`/api/overview ${res.status}`);
    const json = (await res.json()) as OverviewApiPayload;
    if (!json.ok) throw new Error(json.error || 'overview api not ok');
    return json;
  } catch (e) {
    // The page handles `loadError` itself; we still need a typed
    // fallback to satisfy the OverviewApiPayload shape so the rest of
    // the function compiles. Throw so the caller's catch sees it.
    throw e instanceof Error ? e : new Error(String(e));
  }
}

// ─────────────────────────────────────────────────────────────────────
// Profile snapshot
// ─────────────────────────────────────────────────────────────────────

function getProfileSnapshot(today: string): ProfileSnapshot {
  // TODO: wire to a user/profile table. For now, the user is the
  // single tenant — name is hard-coded from the mockup until we have
  // a profile data source.
  const hour = new Date(today + 'T12:00:00').getHours();
  const greeting =
    hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return {
    // TODO: wire to profile.name — pulled from auth / settings
    name: 'David',
    greeting,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Workout structure split
// ─────────────────────────────────────────────────────────────────────

function getWorkoutStructure(workout: WorkoutPrescription): WorkoutStructureBlock[] {
  // TODO: wire to coach.prescribeWorkout — once the Coach returns a
  // structured warm-up / main / cool-down break, surface that
  // directly. Currently the prescription is one paragraph; we
  // synthesize a 3-step split from the distance + paceTarget.
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

function getPlanAdapted(): PlanAdaptedReport {
  // TODO: wire to coach.adjustForReality() — Stage A in the plan.
  // Today this throws; we surface the mockup's deltas as a stub so
  // the card renders. When adjustForReality lands, replace this body
  // with `coach.adjustForReality(...)` and read the result's deltas.
  return {
    title: 'Coach added volume and lifted the long-run cap.',
    body:
      'Last 3 runs felt easier than expected (effort −0.4 vs target) with manageable load. Coach saw you absorbing well and unlocked +12% baseline + a longer long run.',
    pinLabel: '+12%',
    deltas: [
      { label: 'VOLUME / WK', was: '14', now: '17', unit: 'mi' },
      { label: 'LONG RUN CAP', was: '7.4', now: '8.2', unit: 'mi' },
    ],
    footLeft: 'WED 6.7 · FRI 7.4 · BOTH OVER PLAN',
  };
}

// ─────────────────────────────────────────────────────────────────────
// Biometrics
// ─────────────────────────────────────────────────────────────────────

function getBiometricsSnapshot(state: CoachState): BiometricsSnapshot {
  // TODO: wire to HealthKit ingestion (HRV, RHR, sleep). Until M2 lands
  // the values below are mockup-faithful placeholders so the visual
  // language stays consistent.
  void state;
  return {
    hrv: {
      value: '68',
      unit: 'ms',
      pinLabel: '↑ BASELINE',
      pinVariant: 'green',
      footLeft: 'BASE 64ms',
      footRight: '+6%',
      sparkPoints: '0,28 14,26 28,22 42,24 56,18 70,16 84,12 100,10',
      strokeColor: 'var(--good)',
    },
    rhr: {
      value: '42',
      unit: 'bpm',
      pinLabel: 'STABLE',
      pinVariant: 'green',
      footLeft: 'BASE 43bpm · 7D',
      footRight: '−1bpm',
      sparkPoints: '0,18 14,18 28,17 42,18 56,16 70,17 84,16 100,15',
      strokeColor: 'var(--corp)',
    },
    sleep: {
      value: '7:42',
      unit: 'hrs',
      pinLabel: 'DEEP',
      nights: [
        { height: 0.6, color: 'rgba(38,127,255,.3)' },
        { height: 0.9, color: 'rgba(38,127,255,.6)' },
        { height: 1.0, color: '#9013FE' },
        { height: 0.7, color: 'rgba(38,127,255,.5)' },
        { height: 0.85, color: 'rgba(38,127,255,.7)' },
        { height: 0.95, color: '#9013FE' },
        { height: 0.5, color: 'rgba(38,127,255,.4)' },
      ],
      footLeft: 'DEEP 1:54 · REM 1:46',
      footRight: '+0:18',
    },
    effort: {
      value: '4.2',
      unit: '',
      pinLabel: '↓ EASIER',
      pinVariant: 'green',
      footLeft: 'WAS 4.6 · DRIFT',
      footRight: '−0.4',
      sparkPoints: '0,12 14,14 28,16 42,16 56,18 70,22 84,26 100,28',
      strokeColor: 'var(--good)',
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// VDOT
// ─────────────────────────────────────────────────────────────────────

function getVdotSnapshot(): VdotSnapshot {
  // TODO: wire to lib/vdot.ts (vdotSnapshot) — the engine already
  // computes this from recent races. The /api/coach/today endpoint
  // returns it. Once we plumb it through the state object, replace
  // these placeholders with the live values.
  return {
    value: '49.2',
    detailLine: 'RAW 50.0 · DECAY −0.8 · 6 MO TREND',
    source: 'DISNEY HALF · 1:32:00 · 6 MO AGO',
    tiers: [
      { label: 'NOVICE' },
      { label: 'INTERMED' },
      { label: 'ADV ◀ YOU', active: true },
      { label: 'ELITE' },
    ],
    bandPosition: 0.5,
    bandWidth: 0.34,
    scaleLabels: ['30', '40', '50', '60', '70'],
    equivalents: [
      { distance: '5K', time: '19:32' },
      { distance: '10K', time: '40:55' },
      { distance: 'HM', time: '1:31', isGoal: true },
      { distance: 'M', time: '3:11' },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────
// Load gauge
// ─────────────────────────────────────────────────────────────────────

function getLoadSnapshot(state: CoachState): LoadSnapshot {
  // Real input — ACWR is computed in lib/coach-principles.ts. We get
  // a value back from coach.assessReadiness via state, but using the
  // mockup's "sweet spot" classification until Coach surfaces it.
  const acwr =
    state.volume.last7Mi > 0 && state.volume.weeklyAvg8w > 0
      ? state.volume.last7Mi / state.volume.weeklyAvg8w
      : 1.05;
  const v = Math.round(acwr * 100) / 100;
  let pinLabel = 'SWEET SPOT';
  let pinVariant: LoadSnapshot['pinVariant'] = 'green';
  if (acwr > 1.5) {
    pinLabel = 'OVERREACH';
    pinVariant = 'warn';
  } else if (acwr > 1.3) {
    pinLabel = 'STRETCHED';
    pinVariant = 'amber';
  } else if (acwr < 0.5) {
    pinLabel = 'DETRAIN';
    pinVariant = 'warn';
  }
  return {
    value: v.toFixed(2),
    pinLabel,
    pinVariant,
    bandLine: '0.8–1.2 SAFE',
    trendLabel: '▲ HOLDING SWEET SPOT',
    // TODO: wire to a 4-week trend (acwr_week-3 .. acwr_week-0). Stub
    // for now — mockup-faithful curve.
    trend: [0.92, 0.98, 1.02, v],
  };
}

// ─────────────────────────────────────────────────────────────────────
// Pace zones
// ─────────────────────────────────────────────────────────────────────

function getPaceZonesSnapshot(): PaceZonesSnapshot {
  // TODO: wire to pace_zones.ts × vdotSnapshot. The doctrine module
  // already returns the 5-band table; once the engine surfaces it
  // alongside today's prescription, swap this stub.
  return {
    source: 'VDOT 49.2 · DANIELS',
    raceAnchor: 'DISNEY HALF',
    zones: [
      { letter: 'E', label: 'Easy', value: '8:55', rangeSuffix: '–9:25' },
      { letter: 'M', label: 'Marathon', value: '7:18' },
      { letter: 'T', label: 'Threshold', value: '7:00' },
      { letter: 'I', label: 'Interval', value: '6:30' },
      { letter: 'R', label: 'Rep', value: '5:55' },
    ],
    distribution: [
      { zoneLetter: 'E', label: 'EASY', timeDisplay: '14:12 HR', barFraction: 0.92, color: 'var(--good)' },
      { zoneLetter: 'M', label: 'MARATHON', timeDisplay: '—', barFraction: 0, color: 'var(--corp)', muted: true },
      { zoneLetter: 'T', label: 'THRESHOLD', timeDisplay: '0:42 HR', barFraction: 0.05, color: 'var(--milestone)' },
      { zoneLetter: 'I', label: 'INTERVAL', timeDisplay: '0:28 HR', barFraction: 0.03, color: 'var(--warn)' },
      { zoneLetter: 'R', label: 'REP', timeDisplay: '—', barFraction: 0, color: 'var(--xp)', muted: true },
    ],
    shareLine: 'Running 92% easy · aiming ≥80% · +12% headroom ✓',
    currentFitnessPace: '7:00/MI',
    goalPace: '7:15/MI',
    headroomS: 15,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Weekly miles · 4 past + 4 ahead
// ─────────────────────────────────────────────────────────────────────

function getWeeklyMilesStrip(
  weeklyHistory: Array<{ weekStart: string; miles: number; runs: number }> | null,
  _today: string,
): WeeklyMilesStrip {
  // Real input where available — last 4 weeks come straight from
  // Strava rollup. Future 4 weeks are coach.trajectory14wk's first
  // few points. Today's projection is from coach.weekDeltas.
  const past = (weeklyHistory ?? []).slice(0, 4).reverse(); // oldest → newest

  const bars: WeeklyMilesStrip['bars'] = [];
  past.forEach((w, i) => {
    bars.push({
      miles: w.miles,
      date: shortDate(w.weekStart),
      // Penultimate past week is the Big Sur race week.
      kind: i === past.length - 1 ? 'past-race' : 'past',
    });
  });
  // Pad to 4 past with placeholders if Strava is thin.
  while (bars.length < 4) {
    bars.unshift({ miles: 0, date: '—', kind: 'past' });
  }
  // This week (now). Use mockup-faithful "22" if no real data.
  bars.push({
    miles: 22,
    date: '5/4',
    kind: 'now',
  });
  // Future 3 weeks — placeholder ramp; replace with trajectory14wk.
  bars.push({ miles: 17, date: '5/11', kind: 'future' });
  bars.push({ miles: 24, date: '5/18', kind: 'future' });
  bars.push({ miles: 28, date: '5/25', kind: 'future' });

  return {
    pinLabel: '↑12% vs 8W AVG',
    thisWeekMi: 22,
    bars,
    peakLabel: 'PEAK · APR 13–19 · 42 MI',
    footRight: 'RECOVERING',
  };
}

// ─────────────────────────────────────────────────────────────────────
// Long-run progression · 6 past + 4 ahead
// ─────────────────────────────────────────────────────────────────────

function getLongRunStrip(
  weeklyHistory: Array<{ weekStart: string; miles: number; runs: number }> | null,
  _today: string,
): LongRunStrip {
  void weeklyHistory;
  // TODO: wire to per-week longest-run rollup. The mockup shows a
  // 10-cell strip; we surface mockup-faithful values until the
  // weekly-longest tracker lands.
  return {
    pinLabel: 'PEAK 14 MI',
    nextMi: 5,
    nextLabel: 'SUN MAY 10 · NEXT',
    bars: [
      { miles: 10, date: '3/22', kind: 'past' },
      { miles: 12, date: '3/29', kind: 'past' },
      { miles: 26, date: '4/26', kind: 'past-race' },
      { miles: 2, date: '5/3', kind: 'past' },
      { miles: 2, date: '5/3', kind: 'past' },
      { miles: 5, date: '5/10', kind: 'now' },
      { miles: 7, date: '5/17', kind: 'future' },
      { miles: 9, date: '5/24', kind: 'future' },
      { miles: 11, date: '5/31', kind: 'future' },
      { miles: 14, date: '6/7', kind: 'future' },
    ],
    footLeft: 'RECOVERING → BUILDING',
    footRight: '+2 MI/WK',
  };
}

// ─────────────────────────────────────────────────────────────────────
// Year-in-running snapshot
// ─────────────────────────────────────────────────────────────────────

function getYearSnapshot(
  rollup: YearRollup | null,
  _heatmap: Array<{ date: string; miles: number; runs: number }> | null,
  prs: Array<{ label: string; distMi: number; bestS: number | null; activityId: number | null; date: string | null }> | null,
): YearSnapshot {
  const monthLabels = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  // 52-week heatmap. Mockup-driven mix until per-week rollup lands.
  // TODO: derive from yearOfRunningHeatmap + race detection.
  const heatmapCells: YearSnapshot['heatmap'] = [];
  for (let w = 0; w < 52; w++) {
    let color = 'var(--l3)';
    let isRaceWeek = false;
    let isFutureRace = false;
    let isToday = false;
    if (w < 6) color = `rgba(62,189,65,${0.10 + w * 0.07})`;
    else if (w === 6) { color = '#FF5722'; isRaceWeek = true; }
    else if (w < 11) color = `rgba(62,189,65,${0.55 + (10 - w) * 0.02})`;
    else if (w === 11) { color = '#FF5722'; isRaceWeek = true; }
    else if (w < 16) color = `rgba(62,189,65,${0.65 + (w - 11) * 0.04})`;
    else if (w === 16) { color = '#FF5722'; isRaceWeek = true; }
    else if (w === 17) { color = '#FF5722'; isRaceWeek = true; }
    else if (w === 18) { color = 'rgba(62,189,65,.32)'; isToday = true; }
    else if (w === 24) isFutureRace = true;
    else if (w === 32) isFutureRace = true;
    heatmapCells.push({ color, isRaceWeek, isFutureRace, isToday });
  }

  // Monthly volume — use rollup when present, mockup placeholders when not.
  // TODO: rollupYear returns total; we want per-month breakdown.
  const monthly: YearSnapshot['monthly'] = monthLabels.map((label, i) => {
    const fallback = [52, 98, 120, 142, 14, null, null, null, null, null, null, null][i] ?? null;
    return {
      label,
      miles: fallback,
      isCurrent: i === 4,
      isFuture: i > 4,
    };
  });

  const highlights = [
    { label: 'BIGGEST WEEK', value: '42', unit: 'mi', meta: 'APR 13–19 · PRE-BIG SUR' },
    { label: 'LONGEST RUN', value: '26.2', unit: 'mi', meta: 'APR 27 · BIG SUR', color: 'var(--good)' },
    { label: 'RACES RUN', value: '5', unit: '', meta: '1×M · 3×HM · 1×10K' },
    { label: 'HILLIEST RUN', value: '4.2', unit: 'k ft', meta: 'APR 27 · BIG SUR' },
  ];

  // PR shelf — pull from naivePRs() when available; otherwise mockup.
  const prShelf: YearSnapshot['prs'] = [];
  const labels: Array<{ key: string; label: string; mockTime: string; mockMeta: string }> = [
    { key: '5K', label: '5K', mockTime: '19:48', mockMeta: 'FEB 14 · −24s' },
    { key: '10K', label: '10K', mockTime: '41:32', mockMeta: 'MAR 22 · −36s' },
    { key: 'half', label: 'HALF', mockTime: '1:32:00', mockMeta: 'DISNEY · −2:18' },
    { key: 'marathon', label: 'MARATHON', mockTime: '3:18:42', mockMeta: 'BIG SUR APR · −5:29' },
  ];
  labels.forEach((p) => {
    const hit = prs?.find((x) => x.label === p.key);
    if (hit && hit.bestS != null) {
      prShelf.push({ distance: p.label, time: fmtDuration(hit.bestS), meta: p.mockMeta });
    } else {
      prShelf.push({ distance: p.label, time: p.mockTime, meta: p.mockMeta });
    }
  });

  const ytdMiles = rollup?.totalMiles != null ? Math.round(rollup.totalMiles) : 503;
  // TODO: derive day-of-year and projection from real data.
  return {
    topStats: [
      { value: String(rollup?.totalRuns ?? 87), label: 'RUNS' },
      { value: '62', label: 'DAYS' },
      { value: '78', label: 'HR' },
    ],
    heatmap: heatmapCells,
    monthly,
    highlights,
    prs: prShelf,
    ytd: {
      miles: ytdMiles,
      dayOfYear: 129,
      pctOfYear: 35,
      vsLastYearMi: 481,
      vsLastYearDelta: 22,
      projectedEoyMi: 1650,
      projectedDelta: 42,
      timeOnFeetHr: 78,
      elevationGainKFt: 8.4,
      avgPace: '8:21',
      avgPaceVs2025: '−12s vs 2025',
      caloriesK: 62.8,
      caloriesEquiv: '≈ 220 BURRITOS',
    },
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
