/**
 * /training · data wiring layer.
 *
 * Mirrors the architecture of /overview/data.ts. Every value rendered on
 * the Training page resolves to one of the functions in this module.
 *
 * Real sources are wired where they exist (Strava cache, saved races,
 * Coach engine state, Coach methods). Stubs are clearly marked with
 * `// TODO: wire to <source>` comments. The shapes are stable — when
 * the real engine ships, only the body of each helper changes.
 */

import type {
  CoachDecision,
  Trajectory14wk,
  ProofSessionsReport,
  WeekDeltasReport,
  RaceFitnessPrediction,
} from '@/coach/types';
import type {
  WorkoutPrescription,
  ReadinessAssessment,
} from '@/coach/coach';
import type { CoachState } from '@/lib/coach-state';
import type { NormalizedActivity } from '@/lib/strava-activities';
import { onlyRuns } from '@/lib/strava-activities';
import { listRaces, type SavedRace } from '@/lib/storage';
import { daysUntil } from '@/lib/dates';

// ─────────────────────────────────────────────────────────────────────
// Public type
// ─────────────────────────────────────────────────────────────────────

export interface TrainingData {
  /** ISO "today". Locked once per load. */
  today: string;
  /** Profile snapshot — name + greeting tone. */
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
  /** Today workout structure (warm-up / main / cool-down split). Stub
   *  until prescribeWorkout returns a real breakdown. */
  workoutStructure: WorkoutStructureBlock[];
  /** Today readiness signals (Sleep / HRV / RHR / Soreness). Stub
   *  until HealthKit ingestion lands. */
  readyToRun: ReadyToRunSnapshot;
  /** Today conditions + coach note inset. Stub until weather wiring. */
  conditions: ConditionsSnapshot;
  /** Goal tracking — PR / Goal / Stretch tiles + fitness now vs goal.
   *  Reads from race-prediction when an A-race is set; falls back to
   *  doctrine placeholders otherwise. */
  goalTracking: GoalTrackingSnapshot;
  /** Next-4-weeks plan blocks. Stub until trajectory exposes a
   *  block-level view alongside the 14-week curve. */
  nextFourWeeks: NextFourWeeksSnapshot;
  /** Plan-adapted (Coach Read) — same shape used on Overview. */
  planAdapted: PlanAdaptedReport;
  /** Strava activities for any client-side rollup. May be null. */
  activities: NormalizedActivity[] | null;
  runs: NormalizedActivity[] | null;
}

// ─────────────────────────────────────────────────────────────────────
// Sub-types
// ─────────────────────────────────────────────────────────────────────

export interface ProfileSnapshot {
  name: string;
  greeting: string;
}

export interface WorkoutStructureBlock {
  /** Display time offset, e.g. "0:00". */
  timeOffset: string;
  /** Block label, e.g. "Warm-up · easy aerobic". */
  name: string;
  /** Distance display, e.g. "0.5 mi". */
  distance: string;
  /** Pace display, e.g. "9:30/mi". */
  pace: string;
  /** True for the main block (rendered bold). */
  isMain?: boolean;
}

export interface ReadyToRunSnapshot {
  /** All-signals headline ("▲ ALL SIGNALS GREEN" / "− HOLD" / "▼ REST"). */
  headline: string;
  /** Headline color token. */
  headlineColor: string;
  sleep: { value: string; delta: string; color: string };
  hrv: { value: string; unit: string; delta: string; color: string };
  rhr: { value: string; unit: string; delta: string; color: string };
  soreness: { value: string; detail: string };
}

export interface ConditionsSnapshot {
  /** Big temp number, e.g. "62". */
  tempF: string;
  /** Sub-line, e.g. "12 MPH · CLOUDY". */
  detail: string;
  /** Coach note paragraph. */
  coachNote: string;
  /** HR ceiling to mention inline. */
  hrCap: number;
}

export interface GoalTilesRow {
  pr: { label: string; time: string; meta: string };
  goal: { label: string; time: string; meta: string };
  stretch: { label: string; time: string; meta: string };
}

export interface GoalTrackingSnapshot {
  /** A-race name, e.g. "AFC HALF". */
  aRaceName: string;
  /** Goal time display, e.g. "1:35:00". */
  goalTime: string;
  /** Goal pace display, e.g. "7:15/MI". */
  goalPace: string;
  /** Current fitness time display, e.g. "1:32". */
  fitnessNow: string;
  /** VDOT line, e.g. "VDOT 49.2 · ▲ +0.8". */
  vdotLine: string;
  /** Headroom seconds-per-mile (positive = room to spare). */
  headroomSPerMi: number;
  /** Pin label, e.g. "▲ ON TRACK" / "▼ SHORT". */
  pinLabel: string;
  /** Pin variant. */
  pinVariant: 'green' | 'amber' | 'warn';
  /** Days to A race. */
  daysToA: number;
  /** Tiles row at the bottom (PR · GOAL · STRETCH). */
  tiles: GoalTilesRow;
  /** Latest-proof callout text (short summary line). */
  latestProof: {
    dateISO: string;
    title: string;
    summary: string;
    onTarget: boolean;
  } | null;
}

export interface NextFourWeeksBlock {
  /** Week range label, e.g. "WEEK · MAY 11–17". */
  rangeLabel: string;
  /** Block title, e.g. "Recovery week 2". */
  title: string;
  /** Phase tone — colors the left rail. */
  tone: 'recovery' | 'base' | 'build' | 'peak' | 'taper' | 'race';
  /** Weekly miles. */
  miles: number;
  /** Quality days count. */
  quality: number;
  /** Long-run miles. */
  longMi: number;
  /** Short rationale string. */
  rationale: string;
}

export interface NextFourWeeksSnapshot {
  /** Block range header, e.g. "NEXT 4 WEEKS · MAY 11 → JUN 7". */
  rangeLabel: string;
  /** Section title, e.g. "Recovery wraps · Base block opens". */
  title: string;
  /** Two summary pins, e.g. ["RECOVERY 2/2", "BASE · 21D"]. */
  pins: Array<{ label: string; variant: 'green' | 'amber' | 'warn' | 'blue' | 'purple' | 'race' | 'coach' | 'muted' }>;
  blocks: NextFourWeeksBlock[];
  /** Summary strip at the bottom of the card. */
  summary: {
    totalMi: number;
    avgWeekMi: number;
    avgVsRecovery: string;
    qualityDays: number;
    qualityDetail: string;
    longestRunMi: number;
    longestRunWhen: string;
  };
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
): Promise<TrainingData> {
  const [savedRaces, api] = await Promise.all([
    listRaces().catch(() => [] as SavedRace[]),
    fetchTrainingApi(),
  ]);

  if (!api.ok) {
    throw new Error(api.error || 'training api not ok');
  }

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

  const runs = activities ? onlyRuns(activities) : null;

  const profile = getProfileSnapshot(today);
  const workoutStructure = getWorkoutStructure(api.workout.answer);
  const readyToRun = getReadyToRun(api.readiness.answer);
  const conditions = getConditions(api.workout.answer);
  const goalTracking = getGoalTracking(
    api.raceFitnessA,
    api.proofSessions.answer,
    nextA,
    daysToNextA,
  );
  const nextFourWeeks = getNextFourWeeks(api.trajectory.answer);
  const planAdapted = getPlanAdapted();

  return {
    today,
    profile,
    state: api.state,
    races: { upcoming, past, nextA, nextB, daysToNextA },
    coach: {
      workout: api.workout,
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
    nextFourWeeks,
    planAdapted,
    activities,
    runs,
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

function getProfileSnapshot(today: string): ProfileSnapshot {
  // TODO: wire to a user/profile table. Mirrors the Overview port —
  // single-tenant placeholder until auth + profile data exists.
  const hour = new Date(today + 'T12:00:00').getHours();
  const greeting =
    hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return {
    // TODO: wire to profile.name
    name: 'David',
    greeting,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Today workout structure — synthesized split until Coach returns it
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
  // TODO: wire to HealthKit (HRV / RHR / sleep). Until M2 lands the
  // numbers below are mockup-faithful placeholders; only the headline
  // is derived from Coach.assessReadiness so the at-a-glance signal
  // tracks real Coach output.
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
    // TODO: wire to HealthKit sleep
    sleep: { value: '7:42', delta: '+18M GOAL', color: 'var(--good)' },
    // TODO: wire to HealthKit HRV
    hrv: { value: '68', unit: 'MS', delta: '▲ +4 vs BASE', color: 'var(--good)' },
    // TODO: wire to HealthKit RHR
    rhr: { value: '42', unit: 'BPM', delta: '▼ −1 vs BASE', color: 'var(--good)' },
    // TODO: wire to daily self-report; mental.ts has the doctrine for the input
    soreness: { value: 'MILD', detail: 'CALF · CONNECTIVE' },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Conditions + coach note inset
// ─────────────────────────────────────────────────────────────────────

function getConditions(workout: WorkoutPrescription): ConditionsSnapshot {
  // TODO: wire to weather.ts × coach.dailyConditionsNote (no such
  // method yet). Until that lands we surface mockup-faithful weather
  // with a coach note synthesized from the prescription HR zone.
  const hrCap = workout.hrZone ? 130 + workout.hrZone * 8 : 145;
  return {
    tempF: '62',
    detail: '12 MPH · CLOUDY',
    coachNote: `Settle into pace — don't chase. Cap effort if HR drifts above ${hrCap}. Recovery means recovery; stop if anything pulls.`,
    hrCap,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Goal tracking — pulls from Coach.raceFitnessPrediction (A race)
// ─────────────────────────────────────────────────────────────────────

function getGoalTracking(
  raceFitnessA: CoachDecision<RaceFitnessPrediction> | null,
  proofs: ProofSessionsReport,
  nextA: SavedRace | null,
  daysToA: number | null,
): GoalTrackingSnapshot {
  const headroom = raceFitnessA?.answer.headroomSPerMi ?? 0;
  const onTrack = headroom >= 0;
  const aRaceName = (nextA?.meta.name ?? raceFitnessA?.answer.raceName ?? 'AFC HALF').toUpperCase();
  const goalTime = raceFitnessA?.answer.goalDisplay ?? '1:35:00';
  const goalPaceS = raceFitnessA?.answer.goalPaceSPerMi ?? 435;
  const fitnessTime = raceFitnessA?.answer.predictedDisplay ?? '1:32';
  const stretchTime = raceFitnessA?.answer.stretchDisplay ?? '1:30:00';
  const days = daysToA ?? 98;

  return {
    aRaceName,
    goalTime,
    goalPace: `${fmtPace(goalPaceS).replace('/mi', '')}/MI`,
    fitnessNow: fitnessTime,
    // TODO: wire to lib/vdot.ts and surface real trend
    vdotLine: 'VDOT 49.2 · ▲ +0.8',
    headroomSPerMi: headroom,
    pinLabel: onTrack ? '▲ ON TRACK' : '▼ SHORT',
    pinVariant: onTrack ? 'green' : 'warn',
    daysToA: days,
    tiles: {
      // TODO: wire to PR shelf (lib/strava-stats.naivePRs); fallback
      pr: { label: 'PR · DISNEY', time: '1:32:00', meta: '7:00/MI · 6 MO' },
      goal: { label: 'GOAL · AFC', time: goalTime, meta: `${fmtPace(goalPaceS).replace('/mi', '')}/MI · ${days}D` },
      stretch: { label: 'STRETCH', time: stretchTime, meta: '6:52/MI · IF GREAT' },
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

// ─────────────────────────────────────────────────────────────────────
// Next 4 weeks — derived from trajectory14wk's first few build points
// ─────────────────────────────────────────────────────────────────────

function getNextFourWeeks(trajectory: Trajectory14wk): NextFourWeeksSnapshot {
  // TODO: wire to a dedicated Coach.next4Weeks() method backed by
  // plan_templates.ts. For now we project the first 4 future points
  // out of the 14-week trajectory and synthesize the supporting
  // metadata.
  const points = trajectory.points;
  // Point index 4 is "today" in the stub trajectory (4 past + present).
  // Take the next 4 (build wks 1-4 of the build block).
  const startIdx = 5;
  const nextFour = points.slice(startIdx, startIdx + 4);

  const TONES: Array<NextFourWeeksBlock['tone']> = ['recovery', 'base', 'base', 'base'];
  const TITLES = [
    'Recovery week 2',
    'Base · LT in',
    'Base · build LR',
    'Base · cutback',
  ];
  const RATIONALES = [
    'Frequency rebuild · stride intro Fri',
    'First T tempo Tue · long climbs',
    'Cruise intervals Thu · build duration',
    'Recovery week · −20% volume',
  ];
  const QUALITY = [0, 1, 1, 1];
  const LONGS = [7, 9, 11, 8];

  const blocks: NextFourWeeksBlock[] = nextFour.map((p, i) => ({
    rangeLabel: weekRangeLabel(p.weekStartISO),
    title: TITLES[i] ?? `Week ${i + 1}`,
    tone: TONES[i] ?? 'base',
    miles: Math.round(p.plannedMi),
    quality: QUALITY[i] ?? 0,
    longMi: LONGS[i] ?? Math.round(p.plannedMi * 0.4),
    rationale: RATIONALES[i] ?? '',
  }));

  // Fill if trajectory was short.
  while (blocks.length < 4) {
    blocks.push({
      rangeLabel: '—',
      title: '—',
      tone: 'base',
      miles: 0,
      quality: 0,
      longMi: 0,
      rationale: '',
    });
  }

  const totalMi = blocks.reduce((s, b) => s + b.miles, 0);
  const avgWeek = totalMi / 4;
  const longestRun = blocks.reduce((m, b) => (b.longMi > m.longMi ? b : m), blocks[0]);

  return {
    rangeLabel: blocks[0] && blocks[3]
      ? `NEXT 4 WEEKS · ${blocks[0].rangeLabel.replace('WEEK · ', '').split('–')[0]} → ${blocks[3].rangeLabel.replace('WEEK · ', '').split('–')[1] ?? ''}`
      : 'NEXT 4 WEEKS',
    title: 'Recovery wraps · Base block opens',
    pins: [
      { label: 'RECOVERY 2/2', variant: 'amber' },
      { label: 'BASE · 21D', variant: 'blue' },
    ],
    blocks,
    summary: {
      totalMi,
      avgWeekMi: Math.round(avgWeek * 10) / 10,
      avgVsRecovery: '▲ +6 vs RECOVERY',
      qualityDays: blocks.reduce((s, b) => s + b.quality, 0),
      qualityDetail: 'FIRST T · CRUISE INT · STRIDES',
      longestRunMi: longestRun.longMi,
      longestRunWhen: longestRun.rangeLabel.replace('WEEK · ', '').replace('–', ' — '),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Plan adapted (Coach Read) — same as Overview until Stage A lands
// ─────────────────────────────────────────────────────────────────────

function getPlanAdapted(): PlanAdaptedReport {
  // TODO: wire to coach.adjustForReality() — Stage A in the plan.
  // The Coach method throws today; we surface the mockup's deltas as
  // a stub so the card renders. When the engine lands, replace this
  // body with a direct Coach call.
  return {
    title: 'Coach added volume and lifted the long-run cap.',
    body:
      'Last 3 runs felt easier than expected (effort −0.4 vs target) with manageable load. Coach saw you absorbing well.',
    pinLabel: '+12%',
    deltas: [
      { label: 'VOLUME / WK', was: '14', now: '17', unit: 'mi' },
      { label: 'LONG RUN CAP', was: '7.4', now: '8.2', unit: 'mi' },
    ],
    footLeft: 'WED 6.7 · FRI 7.4',
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
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

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function weekRangeLabel(weekStartISO: string): string {
  const m = weekStartISO.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return weekStartISO;
  const month = MONTHS[Number(m[2]) - 1];
  const start = Number(m[3]);
  // 7-day span.
  const d = new Date(weekStartISO + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 6);
  const endDay = d.getUTCDate();
  const endMonth = MONTHS[d.getUTCMonth()];
  const range =
    month === endMonth ? `${month} ${start}–${endDay}` : `${month} ${start}–${endMonth} ${endDay}`;
  return `WEEK · ${range}`;
}
