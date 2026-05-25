/**
 * /training · data wiring layer.
 *
 * Mirrors the architecture of /overview/data.ts. Every value rendered on
 * the Training page resolves to one of the functions in this module.
 *
 * Real sources are wired where they exist (Strava cache, saved races,
 * Coach engine state, Coach methods). Surfaces whose feeding source
 * doesn't exist yet resolve to `null`, the page renders an explicit
 * NO DATA YET empty-state.
 */

import type {
  CoachDecision,
  Trajectory14wk,
  ProofSessionsReport,
  WeekDeltasReport,
  RaceFitnessPrediction,
  TrajectoryPoint,
} from '@/coach/types';
import type {
  WorkoutPrescription,
  ReadinessAssessment,
  RecentAdjustmentsReport,
  AdjustedPlan,
} from '@/coach/coach';
import type { CoachState } from '@/lib/coach-state';
import type { NormalizedActivity } from '@/lib/strava-activities';
import { onlyRuns } from '@/lib/strava-activities';
import { vdotSnapshot } from '@/lib/vdot';
import { naivePRs } from '@/lib/strava-stats';
import { listRaces, type SavedRace } from '@/lib/storage';
import { daysUntil } from '@/lib/dates';
import type { TrainingApiHrZoneTime } from '../api/training/route';
import type { FreshnessMap } from '@/lib/freshness-types';
import { loadAliveCoachData, type AliveCoachData } from '../overview/_alive-coach';
import type { NarrativeLine } from '@/coach/coach-narrative';
import type { PathToRaceResult, NextPushesReport } from '@/coach/coach';

export type { TrainingApiHrZoneTime as HrZoneTime, TrainingApiZoneDay as HrZoneDay } from '../api/training/route';

// ─────────────────────────────────────────────────────────────────────
// Public type
// ─────────────────────────────────────────────────────────────────────

export interface TrainingData {
  /** ISO "today". Locked once per load. */
  today: string;
  /** Profile snapshot, name + greeting tone. */
  profile: ProfileSnapshot;
  /** Coach engine state. */
  state: CoachState;
  /** Race calendar resolved for context (next A, next B, daysToA). */
  races: {
    upcoming: SavedRace[];
    past: SavedRace[];
    nextA: SavedRace | null;
    nextB: SavedRace | null;
    daysToNextA: number | null;
  };
  /** Coach decisions powering every coaching surface. */
  coach: {
    workout: CoachDecision<WorkoutPrescription>;
    readiness: CoachDecision<ReadinessAssessment>;
    weekDeltas: CoachDecision<WeekDeltasReport>;
    trajectory: CoachDecision<Trajectory14wk>;
    proofSessions: CoachDecision<ProofSessionsReport>;
    raceFitnessA: CoachDecision<RaceFitnessPrediction> | null;
  };
  /** Today workout structure (warm-up / main / cool-down split). */
  workoutStructure: WorkoutStructureBlock[];
  /** Today readiness signals (Sleep / HRV / RHR / Soreness). null until
   *  HealthKit + a daily check-in pipeline ship. */
  readyToRun: ReadyToRunSnapshot | null;
  /** Today conditions + coach note. null until weather wiring lands. */
  conditions: ConditionsSnapshot | null;
  /** Goal tracking, PR / Goal / Stretch tiles + fitness now vs goal.
   *  null when no A-race is set (page prompts the user to set one). */
  goalTracking: GoalTrackingSnapshot | null;
  /** Plan-adapted (Coach Read), null when nothing has changed in the
   *  last 7 days. */
  planAdapted: PlanAdaptedReport | null;
  /** AdjustForReality output for today; null when the plan held. */
  adjustedToday: TodayAdjustment | null;
  /** 14-day HR-zones rollup. */
  hrZones: TrainingApiHrZoneTime;
  /** Strava activities for any client-side rollup. May be null. */
  activities: NormalizedActivity[] | null;
  runs: NormalizedActivity[] | null;
  /** Wave J · one-sentence coach voice. Same component as /overview. */
  narrative: NarrativeLine | null;
  /** Wave G · "Coach is watching" chips reusing the alive-coach loader.
   *  Only the watching strip is rendered on /training, PathToRace and
   *  NextPush live on /overview where they anchor the hero rows. */
  aliveCoach: AliveCoachData;
  /** Wave L · per-signal freshness map. */
  freshness: FreshnessMap;
  /** Plan workouts for the current Mon→Sun week. Null when no active plan. */
  planWeekWorkouts: Array<{
    dateISO: string; type: string; distanceMi: number;
    isQuality: boolean; isLong: boolean;
    paceTargetSPerMi: number | null; notes: string; subLabel?: string | null;
  }> | null;
  /** Current week's phase from the plan (BASE/BUILD/PEAK/TAPER). */
  planCurrentPhase: string | null;
}

// ─────────────────────────────────────────────────────────────────────
// Sub-types
// ─────────────────────────────────────────────────────────────────────

export interface ProfileSnapshot {
  name: string;
  greeting: string;
}

export interface WorkoutStructureBlock {
  timeOffset: string;
  name: string;
  distance: string;
  pace: string;
  isMain?: boolean;
}

export interface ReadyToRunSnapshot {
  /** All-signals headline ("▲ ALL SIGNALS GREEN" / "− HOLD" / "▼ REST"). */
  headline: string;
  /** Headline color token. */
  headlineColor: string;
  /** Individual signals, each is null until that sensor stream is live. */
  sleep: { value: string; delta: string; color: string } | null;
  hrv: { value: string; unit: string; delta: string; color: string } | null;
  rhr: { value: string; unit: string; delta: string; color: string } | null;
  soreness: { value: string; detail: string } | null;
}

export interface ConditionsSnapshot {
  tempF: string;
  detail: string;
  coachNote: string;
  hrCap: number;
}

export interface GoalTilesRow {
  pr: { label: string; time: string; meta: string } | null;
  goal: { label: string; time: string; meta: string };
  stretch: { label: string; time: string; meta: string };
}

export interface GoalTrackingSnapshot {
  aRaceName: string;
  goalTime: string;
  goalPace: string;
  fitnessNow: string;
  /** VDOT line. null when no VDOT anchored. */
  vdotLine: string | null;
  headroomSPerMi: number;
  pinLabel: string;
  pinVariant: 'green' | 'amber' | 'warn';
  daysToA: number;
  tiles: GoalTilesRow;
  latestProof: {
    dateISO: string;
    title: string;
    summary: string;
    onTarget: boolean;
  } | null;
}

export interface PlanAdaptedDelta {
  label: string;
  was: string;
  now: string;
  unit?: string;
}

export interface PlanAdaptedReport {
  title: string;
  body: string;
  pinLabel: string | null;
  deltas: PlanAdaptedDelta[];
  footLeft: string;
  items: PlanAdaptedItem[];
}

export interface PlanAdaptedItem {
  dateISO: string;
  dateDisplay: string;
  changeDisplay: string;
  why: string;
}

export interface TodayAdjustment {
  why: string;
  reasons: string[];
}

// ─────────────────────────────────────────────────────────────────────
// API payload
// ─────────────────────────────────────────────────────────────────────

interface TrainingApiOk {
  ok: true;
  today: string;
  state: CoachState;
  workout: CoachDecision<WorkoutPrescription>;
  readiness: CoachDecision<ReadinessAssessment>;
  weekDeltas: CoachDecision<WeekDeltasReport>;
  trajectory: CoachDecision<Trajectory14wk>;
  proofSessions: CoachDecision<ProofSessionsReport>;
  raceFitnessA: CoachDecision<RaceFitnessPrediction> | null;
  hrZones: TrainingApiHrZoneTime;
  recentAdjustments?: CoachDecision<RecentAdjustmentsReport> | null;
  adjustedToday?: CoachDecision<AdjustedPlan> | null;
  freshness?: FreshnessMap;
  pathToRace?: CoachDecision<PathToRaceResult> | null;
  nextPushes?: CoachDecision<NextPushesReport>;
  narrative?: NarrativeLine | null;
  planWeekWorkouts?: Array<{
    dateISO: string; type: string; distanceMi: number;
    isQuality: boolean; isLong: boolean;
    paceTargetSPerMi: number | null; notes: string; subLabel?: string | null;
  }> | null;
  planCurrentPhase?: string | null;
  profileName?: string | null;
}

interface TrainingApiErr {
  ok: false;
  error: string;
}

type TrainingApiPayload = TrainingApiOk | TrainingApiErr;

// ─────────────────────────────────────────────────────────────────────
// Single load entry point.
// ─────────────────────────────────────────────────────────────────────

export async function loadTrainingData(
  activities: NormalizedActivity[] | null,
  stravaFetchedAtMs: number | null = null,
): Promise<TrainingData> {
  const [savedRaces, api] = await Promise.all([
    listRaces().catch(() => [] as SavedRace[]),
    fetchTrainingApi(),
  ]);

  if (!api.ok) {
    throw new Error(api.error || 'training api not ok');
  }

  const today = api.today;

  const upcoming = savedRaces
    .filter((r) => daysUntil(r.meta.date) >= 0)
    .sort((a, b) => daysUntil(a.meta.date) - daysUntil(b.meta.date));
  const past = savedRaces
    .filter((r) => daysUntil(r.meta.date) < 0)
    .sort((a, b) => daysUntil(b.meta.date) - daysUntil(a.meta.date));
  const nextA = upcoming.find((r) => (r.meta.priority ?? 'A') === 'A') ?? null;
  const nextB = upcoming.find((r) => r.meta.priority === 'B') ?? null;
  const daysToNextA = nextA ? daysUntil(nextA.meta.date) : null;

  const runs = activities ? onlyRuns(activities) : null;
  const prs = runs && runs.length > 0 ? naivePRs(runs) : null;
  const vdotLib = vdotSnapshot(api.state);

  const profile = getProfileSnapshot(today, api.profileName ?? null);
  const adjustedAnswer = api.adjustedToday?.answer ?? null;
  const renderedWorkout = adjustedAnswer?.changed
    ? adjustedAnswer.workout
    : api.workout.answer;
  const workoutStructure = getWorkoutStructure(renderedWorkout);
  const readyToRun = getReadyToRun(api.readiness.answer);
  const conditions = getConditions();
  const goalTracking = getGoalTracking(
    api.raceFitnessA,
    api.proofSessions.answer,
    nextA,
    daysToNextA,
    vdotLib,
    prs,
  );
  const planAdapted = getPlanAdapted(api.recentAdjustments ?? null);

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

  // Wave J · narrative line, computed server-side; client just renders.
  const narrative = api.narrative ?? null;

  // Wave G · alive-coach payload. PathToRace + NextPushes were computed
  // server-side; chip builder runs client-side over the API result.
  const aliveCoach = api.pathToRace !== undefined && api.nextPushes
    ? loadAliveCoachData({
        state: api.state,
        today,
        stravaFetchedAtMs,
        checkin: api.state.checkin,
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

  const freshness: FreshnessMap = api.freshness ?? emptyFreshnessMap();

  return {
    today,
    profile,
    state: api.state,
    races: { upcoming, past, nextA, nextB, daysToNextA },
    coach: {
      workout: workoutDecision,
      readiness: api.readiness,
      weekDeltas: api.weekDeltas,
      trajectory: api.trajectory,
      proofSessions: api.proofSessions,
      raceFitnessA: api.raceFitnessA,
    },
    workoutStructure,
    readyToRun,
    conditions,
    goalTracking,
    planAdapted,
    adjustedToday,
    hrZones: api.hrZones,
    activities,
    runs,
    narrative,
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

async function fetchTrainingApi(): Promise<TrainingApiPayload> {
  try {
    const res = await fetch('/api/training', { cache: 'no-store' });
    if (!res.ok) throw new Error(`/api/training ${res.status}`);
    return (await res.json()) as TrainingApiPayload;
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e));
  }
}

// ─────────────────────────────────────────────────────────────────────
// Profile
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
// Today workout structure, synthesized split until Coach returns it
// ─────────────────────────────────────────────────────────────────────

function getWorkoutStructure(workout: WorkoutPrescription): WorkoutStructureBlock[] {
  const totalMi = workout.distanceMi ?? 3.0;
  const paceMid = workout.paceTargetSPerMi
    ? (workout.paceTargetSPerMi.lower + workout.paceTargetSPerMi.upper) / 2
    : 540;
  const warmMi = Math.max(0.4, Math.round(totalMi * 0.16 * 10) / 10);
  const coolMi = Math.max(0.4, Math.round(totalMi * 0.16 * 10) / 10);
  const mainMi = Math.max(0.1, Math.round((totalMi - warmMi - coolMi) * 10) / 10);
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
      name: workout.isQuality ? 'Main · quality' : 'Main · steady recovery',
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
// Ready-to-run snapshot
// ─────────────────────────────────────────────────────────────────────

function getReadyToRun(readiness: ReadinessAssessment): ReadyToRunSnapshot {
  // The headline is the only thing the Coach surfaces today, the
  // individual signals (sleep / HRV / RHR / soreness) come from
  // HealthKit + a daily check-in we haven't wired. Each is null until
  // its source goes live; the page renders an AWAITING HEALTHKIT body.
  const headline =
    readiness.level === 'green'
      ? '▲ ALL SIGNALS GREEN'
      : readiness.level === 'yellow'
      ? '− HOLD'
      : '▼ REST DAY';
  const headlineColor =
    readiness.level === 'green'
      ? 'var(--good)'
      : readiness.level === 'yellow'
      ? 'var(--att)'
      : 'var(--warn)';
  return {
    headline,
    headlineColor,
    sleep: null,
    hrv: null,
    rhr: null,
    soreness: null,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Conditions + coach note inset
// ─────────────────────────────────────────────────────────────────────

function getConditions(): ConditionsSnapshot | null {
  // No weather wiring yet. The card renders an AWAITING WEATHER empty
  // state until lib/weather.ts × coach.dailyConditionsNote ship.
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Goal tracking, pulls from Coach.raceFitnessPrediction (A race)
// ─────────────────────────────────────────────────────────────────────

function getGoalTracking(
  raceFitnessA: CoachDecision<RaceFitnessPrediction> | null,
  proofs: ProofSessionsReport,
  nextA: SavedRace | null,
  daysToA: number | null,
  vdotLib: ReturnType<typeof vdotSnapshot>,
  prs: Array<{ label: string; distMi: number; bestS: number | null; activityId: number | null; date: string | null }> | null,
): GoalTrackingSnapshot | null {
  if (!nextA || !raceFitnessA) return null;

  const headroom = raceFitnessA.answer.headroomSPerMi;
  const onTrack = headroom >= 0;
  const aRaceName = nextA.meta.name.toUpperCase();
  const goalTime = raceFitnessA.answer.goalDisplay;
  const goalPaceS = raceFitnessA.answer.goalPaceSPerMi;
  const fitnessTime = raceFitnessA.answer.predictedDisplay;
  const stretchTime = raceFitnessA.answer.stretchDisplay;
  const days = daysToA ?? 0;

  // VDOT line, real snapshot or null. We don't yet track a delta so
  // the line is just the current VDOT.
  const vdotLine = vdotLib ? `VDOT ${vdotLib.vdot.toFixed(1)}` : null;

  // PR tile, pull the closest-distance PR from naivePRs.
  const distLabel = labelForDistanceFromMi(nextA.meta.distanceMi);
  const prBucket = pickPrForRaceDistance(prs, nextA.meta.distanceMi);
  const prTile =
    prBucket && prBucket.bestS != null
      ? {
          label: `PR · ${distLabel}`,
          time: fmtDuration(prBucket.bestS),
          meta: prBucket.date ? formatShortDate(prBucket.date) : '-',
        }
      : null;

  // Stretch pace, raceFitnessPrediction already gives a stretchDisplay
  // but no pace; compute from goalPace - typical stretch delta.
  const stretchPaceS = Math.max(0, goalPaceS - 8);

  return {
    aRaceName,
    goalTime,
    goalPace: `${fmtPace(goalPaceS).replace('/mi', '')}/MI`,
    fitnessNow: fitnessTime,
    vdotLine,
    headroomSPerMi: headroom,
    pinLabel: onTrack ? '▲ ON TRACK' : '▼ SHORT',
    pinVariant: onTrack ? 'green' : 'warn',
    daysToA: days,
    tiles: {
      pr: prTile,
      goal: {
        label: `GOAL · ${distLabel}`,
        time: goalTime,
        meta: `${fmtPace(goalPaceS).replace('/mi', '')}/MI · ${days}D`,
      },
      stretch: {
        label: 'STRETCH',
        time: stretchTime,
        meta: `${fmtPace(stretchPaceS).replace('/mi', '')}/MI · IF GREAT`,
      },
    },
    latestProof: proofs.latestCompleted
      ? {
          dateISO: proofs.latestCompleted.dateISO,
          title: proofs.latestCompleted.label,
          summary: proofs.latestCompleted.summary,
          onTarget: proofs.latestCompleted.onTarget,
        }
      : null,
  };
}

function pickPrForRaceDistance(
  prs: Array<{ label: string; distMi: number; bestS: number | null; activityId: number | null; date: string | null }> | null,
  raceMi: number,
): { label: string; distMi: number; bestS: number | null; date: string | null } | null {
  if (!prs) return null;
  // Map race distance → naivePR bucket label.
  let key: string;
  if (raceMi >= 24) key = 'Marathon';
  else if (raceMi >= 12) key = 'Half';
  else if (raceMi >= 6) key = '10K';
  else if (raceMi >= 3) key = '5K';
  else key = '1 mi';
  return prs.find((p) => p.label === key) ?? null;
}

// ─────────────────────────────────────────────────────────────────────
// Plan adapted (Coach Read)
// ─────────────────────────────────────────────────────────────────────

function getPlanAdapted(
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

function _getPlanAdaptedLegacy(): PlanAdaptedReport | null {
  // The engine doesn't yet surface a 7-day "what the plan moved"
  // history. coach.adjustForReality returns a single-day AdjustedPlan
  //, useful for today's prescription but not for the weekly Coach
  // Read card. Until a method like coach.recentAdjustments() lands,
  // this is null and the page hides the card.
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function fmtPace(sPerMi: number): string {
  if (!isFinite(sPerMi) || sPerMi <= 0) return ', ';
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
  if (!isFinite(s) || s <= 0) return ', ';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s - h * 3600) / 60);
  const sec = Math.round(s - h * 3600 - m * 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function labelForDistanceFromMi(mi: number): string {
  if (mi >= 24) return 'MARATHON';
  if (mi >= 12) return 'HALF';
  if (mi >= 6) return '10K';
  if (mi >= 3) return '5K';
  return `${mi.toFixed(1)}MI`;
}

/** Format minutes as "Xh" or "Xm" depending on size. Used by HR Zones card. */
export function formatZoneTime(minutes: number): { value: string; unit: string } {
  if (minutes >= 60) {
    const hrs = Math.round((minutes / 60) * 10) / 10;
    return { value: Number.isInteger(hrs) ? String(hrs) : hrs.toFixed(1), unit: 'h' };
  }
  return { value: String(Math.round(minutes)), unit: 'm' };
}

/** Compact "MAY 11" date label. */
export function formatShortDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

