/**
 * lib/onboarding/_onboarding_e2e.test.ts · a new runner walks in the front
 * door, and the plan they walk out with is the plan they are shown.
 *
 * Run:
 *   ./node_modules/.bin/vitest run lib/onboarding --disable-console-intercept 2>&1 | tail -80
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Onboarding is the one path where a wrong number does not produce a wrong
 * screen — it produces a wrong TRAINING BLOCK, sixteen weeks of it, and the
 * runner has no way to know. It had never been walked end to end, because a
 * real signup writes to production.
 *
 * So it is walked here instead, with no database, no session and no HTTP:
 *
 *   the tap        `OnboardingV5Answers`, as `OnboardingHostV5.submit` posts it
 *   the front door `deriveOnboardingComplete`  (the route's own validators)
 *   the block      `buildSimPlan` → `composePlan` / `composeMaintenancePlan` /
 *                  `composeRecoveryPlan` → `finalizeComposedPlan`  (the engine)
 *   the row        `persistedDayShape`         (what `persistPlan` writes)
 *   the week       `trainingWeekWindow` + `shapePlanWeekDays`  (what
 *                  `loadPlanWeek` returns)
 *   the screen     `prescriptionFor` + `composeV5Today`  (the phone)
 *   the watch      `projectWeekStrip` (the lobby's week page)
 *
 * Every one of those is the production function, reached directly. Three were
 * extracted for this file and are byte-identical to the code they came out of;
 * their old homes now call them — `deriveOnboardingComplete`,
 * `persistedDayShape`, `narrowToPrescriptionType`.
 *
 * 750 archetypes: every weekly frequency the screen offers against every
 * long-run day against every signup weekday against two runways, plus the
 * runners who actually arrive (a true beginner, someone returning, a
 * competitive marathoner, no Strava, deep Strava, no race at all, mid-block,
 * three post-race recovery shapes) and the runway from one week to fifty-three.
 * All three engine modes. 11,000 weeks, 79,000 rows.
 *
 * WHAT IT SAYS ABOUT ONBOARDING. The answers survive: nothing the phone can
 * send is dropped by the route, the stated frequency is never exceeded, the
 * long run lands on the chosen day, the block reaches the race and tapers into
 * it, the recovery block spends the right column of `Research/00b`, and every
 * authored distance, name and note reaches the week strip unchanged. What does
 * not survive is the WEEK the day sits in, and the DOSE the panel draws — see
 * `KNOWN`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * HOW A FINDING IS REPORTED
 *
 * The laws return findings and never throw, so one run reports every defect
 * rather than the first one. `KNOWN` holds the ones that are real, open, and
 * belong to somebody — each with the sentence explaining what the runner
 * would have been given. A known finding does not fail the gate; an
 * UNEXPECTED one does, and so does a KNOWN entry that has stopped firing,
 * because a stale exemption is how a fixed bug gets to look unfixed.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  deriveOnboardingComplete,
  isRefusal,
  VALID_WEEKLY_MI,
  VALID_HIST_AVG,
  VALID_FREQ,
  VALID_DAY_KEYS,
  type OnboardingCompleteInputs,
} from './complete-inputs';
import { HIST_AVG_MIDPOINTS, HIST_LONG_MIDPOINTS, type HistAvg, type HistLong } from './state';
import { buildSimPlan } from '@/lib/plan/sim-inputs';
import {
  recentWeeklyMiFromBucket,
  recentLongMiFromBucket,
  type SimWeeklyMi,
  type SimLongBucket,
  type DayKey,
} from '@/lib/plan/sim-constants';
import { persistedDayShape } from '@/lib/plan/generate';
import { trainingWeekWindow } from '@/lib/notifications/week-window';
import { shapePlanWeekDays, type PlanWorkoutRow, type PlanWeekResult } from '@/lib/plan/week-loader';
import { projectWeekStrip } from '@/lib/watch/build-workout';
import { prescriptionFor, derivePaces, narrowToPrescriptionType, type WorkoutType } from '@/lib/training/prescriptions';
import { composeV5Today, displayTypeFor, subLabelIsName } from '@/lib/faff/v5-today';
import { resolveCitation, parseBand } from '@/lib/doctrine/resolve';

/* ══════════════════════════════════════════════════════════════════════════
 * FINDINGS
 * ═══════════════════════════════════════════════════════════════════════ */

interface Finding { law: string; arc: string; saw: string }
const findings: Finding[] = [];
const say = (law: string, arc: string, saw: string) => { findings.push({ law, arc, saw }); };

/**
 * Open defects this walk finds. Each is real and each is somebody's.
 *
 * A key here suppresses the gate for that law and NOTHING else. It does not
 * loosen the law, it does not narrow the sweep, and the staleness check below
 * deletes it for you the moment the engine stops producing it.
 */
const KNOWN: Record<string, string> = {
  // PLAN_WEEK_IS_NOT_THE_RUNNERS_WEEK · CLOSED 2026-08-24 by WEEK-ALIGN-1.
  //
  // The block was authored in weeks starting on the weekday the runner signed
  // up and read back in weeks ending on their long-run day; they coincided for
  // one signup weekday in seven, and two of the seven active production plans
  // were misaligned on the day it was fixed. Week 0 now starts on the
  // training-week boundary like every other week and `persistPlan` clips the
  // days before the runner's first, so no run predates them and every authored
  // week is one `trainingWeekWindow` reads back whole. LAW O4 still asks
  // 11,324 times and the control above still proves it has teeth.
  THE_SIMULATOR_SHOWS_A_PLAN_PRODUCTION_DOES_NOT_AUTHOR:
    'OPEN · and it is the one that makes the other sweeps suspect. `buildSimPlan` chains: for a ' +
    'race outside `BUILD_WINDOW_WEEKS` it composes the hold block and then the entire ' +
    'periodized build and returns one calendar. `composeForUserInternal` calls `pickPlanMode` ' +
    'once and one composer once — there is no chain in production. A half marathon SIXTEEN ' +
    'weeks out is outside the 12-week half window, and sixteen is one of the three plan lengths ' +
    'the native goal sheet offers for a half, so this is an ordinary answer and not an edge. ' +
    'What the runner is given on day one: a rolling maintenance block with no build ' +
    'in it — FOUR weeks for a half sixteen weeks out — for the race they just entered, while ' +
    '/sim/plan draws the full seventeen. The runner is not stranded — the rebuild authors the ' +
    'build once the race enters the window — but the plan they are shown at signup is not the ' +
    'plan they were previewed. ' +
    'It also means `_sweep_allusers.test.ts`, whose far-out archetypes use raceDateISO ' +
    '2027-03-01, has been grading the CHAINED block for those rows.',
  TODAY_DOSE_IS_NOT_THE_PLANNED_DISTANCE:
    'OPEN · belongs to the phone/watch prescription pass. `V5Panel.dose` and every step under ' +
    'it come from `prescriptionFor(type, weekMi, profile, targetMi)` — a GENERIC template of ' +
    'the right family — and not from the row. `workout_spec`, the column `persistPlan` writes ' +
    'and its own comment calls "the authored truth", is read by the watch and by nothing on ' +
    'the phone. Easy, long, shakeout and race days survive it exactly. Quality days do not: a ' +
    'marathon race-specific week authored "2×1 km @ T pace · 1 min jog" as 3 mi is drawn as ' +
    '"Threshold · 4 × 1 mile reps" at 7.4 mi, and a base week authored "5×8s · by effort · ' +
    '2 min jog" as 2 mi is drawn as "Intervals · 4 × 800m" at 5.3 mi. The dose also disagrees ' +
    'with the week strip on the same screen, because the strip prints the row. 8.1% of all ' +
    'authored days across a four-distance sweep. Not fixed here: making the panel print the ' +
    'row would break the other half of the same rule — the headline must equal the sum of the ' +
    'steps beneath it (2026-06-02) — so the fix is to prescribe FROM the spec, which is the ' +
    'pass already in flight.',
  WATCH_FALLBACK_HAS_NO_SESSION_IN_IT:
    'OPEN · belongs to the phone/watch prescription pass. `race_week_tuneup`, `fartlek`, ' +
    '`progression` and `recovery` are types the generator emits and `prescriptionFor`\'s ' +
    'switch has no case for; they reach its `default` arm and come back as `total_mi: 0`, ' +
    '"No workout scheduled". `/api/v5/today` narrows them first. `lib/watch/build-workout.ts` ' +
    'casts (`wo.type as WorkoutType`) and asks anyway, so on a day whose `workout_spec` is ' +
    'absent the watch has an empty card to fall back on — in race week, on the tune-up. The ' +
    'narrowing is now `narrowToPrescriptionType` in `lib/training/prescriptions.ts` and the ' +
    'watch has only to call it.',
  // SIM_SEED_IS_NOT_A_SEED_THE_ROUTE_CAN_WRITE · CLOSED 2026-08-24 by SIM-SEED-1.
  //
  // The top three rungs of the simulator's volume ladder seeded 62 / 80 / 100
  // mi/wk and production can persist none of those — the phone sends a band,
  // the route persists that band's HIST_AVG_MIDPOINTS value, and the engine
  // reads the column, so a real high-volume signup is seeded 52 / 70 / 90.
  // It was recorded as the owner's call on the reading "which ladder is
  // right". It was not a call: the simulator's job is to author what
  // production authors, so the simulator adopts the route's ladder and no
  // runner's prescribed pace moves. `recentWeeklyMiFromBucket` now resolves
  // through the Swift's own band cut points into the midpoint table, and this
  // law re-fires the moment the two drift apart again.
  //
  // The widening HIGHVOL-1 bought is intact: the nine buckets still cover
  // every seed a signup can reach, 90 mi/wk included.
  WATCH_DOSES_OFF_A_DIFFERENT_WEEK:
    'OPEN · belongs to the phone/watch prescription pass. `lib/watch/build-workout.ts` sums ' +
    'the week it doses quality sessions against over a HARDCODED Monday-anchored window, ' +
    'while the phone doses off `glance.weekPlanned` (the plan\'s own week) and the strip ' +
    'reads the long-run-day window. `prescriptionFor` turns that number into a rep count, so ' +
    'the watch can hand the runner a different session than the phone just showed them.',
};

/* ══════════════════════════════════════════════════════════════════════════
 * THE TAP · what `OnboardingHostV5.submit` actually posts
 *
 * The Swift cannot be imported, so the two values it derives on the client
 * are READ OUT OF THE SWIFT SOURCE rather than copied into this file. That
 * keeps the check honest: if someone edits the rung ladder or the band map on
 * the phone, this reads the edit, not a stale copy of it.
 * ═══════════════════════════════════════════════════════════════════════ */

const HOSTS_V5 = path.resolve(
  __dirname, '..', '..', '..', 'native-v2', 'Faff', 'Faff', 'ViewsV5', 'HostsV5.swift',
);

/** The rungs `OnboardingHostV5.snapWeeklyMi` can emit, read from the Swift. */
function hostWeeklyMiRungs(): number[] | null {
  if (!fs.existsSync(HOSTS_V5)) return null;
  const src = fs.readFileSync(HOSTS_V5, 'utf8');
  const m = src.match(/validWeeklyMi\s*=\s*\[([^\]]+)\]/);
  if (!m) return null;
  return m[1].split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
}

/** The band strings `OnboardingHostV5.histAvgBand` can emit, read from the Swift. */
function hostHistAvgBands(): string[] | null {
  if (!fs.existsSync(HOSTS_V5)) return null;
  const src = fs.readFileSync(HOSTS_V5, 'utf8');
  const fn = src.match(/func histAvgBand\([^)]*\)\s*->\s*String\s*\{([\s\S]*?)\n {4}\}/);
  if (!fn) return null;
  return [...fn[1].matchAll(/return\s+"([^"]+)"/g)].map((x) => x[1]);
}

/** The runner, in the language of the screen they are looking at. */
interface Runner {
  label: string;
  /** The goal chip. 'none' is the no-race path. */
  distance: '5k' | '10k' | 'half' | 'marathon' | 'none';
  /** Race chip → a date this many weeks out. Null on the no-race path. */
  raceInWeeks: number | null;
  /** The finish-time field, free text, exactly as typed. Empty = by feel. */
  goalTime: string;
  fitnessMode: 'new' | 'consistent' | 'returning' | 'racing';
  /** The volume stepper's raw integer. Only SENT in the `consistent` mode. */
  weeklyMi: number;
  daysPerWeek: number;
  longRunDay: DayKey;
  /** The day the runner taps "Start training". */
  signupISO: string;
  /** Longest recent run — the screen does not ask, so this is what a
   *  Strava-connected runner's history would seed. */
  longestRunBucket: SimLongBucket;
  /** A measured VDOT the app OBSERVED. `null` is the no-Strava cold start. */
  observedVdot: number | null;
  /** A race the runner just finished — the recovery-block entry. */
  lastRaceDaysAgo?: number;
  lastRaceDistance?: '5k' | '10k' | 'half' | 'marathon';
  /** Already mid-block when the plan is authored. */
  isMidBlock?: boolean;
}

const addDays = (iso: string, n: number): string => {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dowOf = (iso: string): number => new Date(iso + 'T12:00:00Z').getUTCDay();
const DOW_OF: Record<DayKey, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

/** `OnboardingHostV5.submit`'s payload, built from the runner's taps. */
function payloadFor(r: Runner, rungs: number[], bands: string[]): Record<string, unknown> {
  const snap = (mi: number) => [...rungs].sort((a, b) => a - b).filter((v) => v <= mi).pop() ?? 0;
  // Mirrors the Swift switch's cut points; the BAND STRINGS themselves come
  // from the Swift, so a renamed band is a failure here rather than a silent
  // mismatch with `VALID_HIST_AVG`.
  const bandFor = (mi: number) => {
    const idx = mi < 5 ? 0 : mi < 15 ? 1 : mi < 25 ? 2 : mi < 35 ? 3 : mi < 45 ? 4
      : mi < 55 ? 5 : mi < 65 ? 6 : mi < 85 ? 7 : 8;
    return bands[idx] ?? bands[bands.length - 1];
  };
  const p: Record<string, unknown> = {
    distance: r.distance,
    timezone: 'America/Los_Angeles',
    connectionsSkipped: true,
    longRunDay: r.longRunDay,
    weeklyFreq: Math.min(Math.max(r.daysPerWeek, 0), 6),
    name: 'Runner',
  };
  if (r.raceInWeeks != null) p.date = addDays(r.signupISO, r.raceInWeeks * 7);
  if (r.goalTime) p.time = r.goalTime;
  if (r.fitnessMode === 'consistent') {
    const mi = snap(r.weeklyMi);
    p.weeklyMi = mi;
    p.histAvg = bandFor(mi);
  }
  if (r.fitnessMode === 'new') p.experienceLevel = 'beginner';
  return p;
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE BRIDGE · the route's derived inputs → what the engine is seeded with
 *
 * `buildSimPlan` mirrors `loadGeneratorInputs` step for step, and it speaks in
 * BUCKETS while the route speaks in MIDPOINT MILES. The bridge is the only
 * place this file translates, so LAW O1 asserts the translation is lossless in
 * the direction that matters: whatever bucket is handed to the engine seeds
 * exactly the mileage the route persisted.
 * ═══════════════════════════════════════════════════════════════════════ */

const WEEKLY_BUCKETS: SimWeeklyMi[] = [0, 5, 15, 25, 35, 45, 55, 70, 90];

/** The bucket whose cold-start seed equals the miles the route wrote. */
function bucketForSeededMi(mi: number): SimWeeklyMi {
  let best: SimWeeklyMi = 0;
  for (const b of WEEKLY_BUCKETS) if (recentWeeklyMiFromBucket(b) <= mi) best = b;
  return best;
}

interface Walked {
  runner: Runner;
  derived: OnboardingCompleteInputs;
  /** Composed weeks, each with the `plan_workouts` rows it would persist. */
  weeks: Array<{
    startISO: string;
    phase: string;
    isRaceWeek: boolean;
    tPaceSec: number | null;
    /** The composed days, filtered exactly as `persistPlan` filters them. */
    authored: Array<{ dow: number; type: string; distanceMi: number; subLabel: string | null; isLong: boolean }>;
    rows: PlanWorkoutRow[];
    /** `pace_target_s_per_mi`, per row id. */
    paceById: Map<string, number | null>;
  }>;
  mode: string;
  raceDistanceMi: number;
  goalPaceSec: number | null;
  tPaceSec: number;
  longRunDow: number;
  /** Total block mileage, as authored. */
  totalAuthoredMi: number;
  /** True when `buildSimPlan` chained a race-prep build onto a hold block —
   *  something `composeForUserInternal` never does. */
  chainFired: boolean;
  /** How many weeks production would actually have authored when it did. */
  holdWeeks: number;
}

/** The whole walk, or the engine's refusal — which is a correct answer. */
function walk(r: Runner, rungs: number[], bands: string[]): Walked | { refused: string } {
  const body = payloadFor(r, rungs, bands);
  const derived = deriveOnboardingComplete(body, r.signupISO);
  if (isRefusal(derived)) return { refused: `route: ${derived.error}` };

  // The engine's cold-start seeds, exactly as `loadGeneratorInputs` builds
  // them: run history first, self-report only where history reads zero.
  const seededWeeklyMi = derived.histAvgMi ?? 0;
  const built = buildSimPlan({
    goalMode: r.distance === 'none' ? 'justRun' : r.raceInWeeks != null ? 'race' : 'goal',
    distance: r.distance === 'none' ? 'half' : r.distance,
    startDateISO: r.signupISO,
    planWeeks: r.raceInWeeks ?? 0,
    goalTimeSec: goalSecFrom(derived.time, r.distance),
    raceDateISO: derived.date ?? '',
    lastRaceFinishedDaysAgo: r.lastRaceDaysAgo ?? 0,
    lastRaceDistance: r.lastRaceDistance ?? null,
    // `experience_level` is nullable and NULL is the production default; the
    // sim types it as a string, so it is passed through as-is.
    experienceLevel: derived.experienceLevel as never,
    weeklyFrequency: derived.weeklyFreq ?? 0,
    weeklyMileageBucket: bucketForSeededMi(seededWeeklyMi),
    longestRunBucket: r.longestRunBucket,
    raceHistory: [],
    longRunDay: (derived.longRunDay ?? 'sun') as DayKey,
    // The route derives the rest day from the long-run day and writes both
    // into `user_settings`, so the engine sees this pair and not a default.
    restDay: (derived.restDay ?? 'sat') as DayKey,
    availableDays: [],
    bestRecentVdotOverride: r.observedVdot,
    isMidBlock: r.isMidBlock ?? false,
  } as never);
  if (!built.ok) return { refused: `engine: ${built.reason}` };

  const args = {
    lthr: null, maxHr: null,
    goalPaceSec: built.derived.goalPaceSec,
    easyAnchorTSec: null, goalIPaceEligible: false, belowTableAnchor: null,
  };

  const weeks: Walked['weeks'] = [];
  let totalAuthoredMi = 0;
  built.composed.weeks.forEach((w: any, wi: number) => {
    const weekStartDow = dowOf(w.startISO);
    const authored: Walked['weeks'][number]['authored'] = [];
    const rows: PlanWorkoutRow[] = [];
    const paceById = new Map<string, number | null>();
    for (const d of w.days) {
      // `persistPlan`'s own row filter. Mirroring it is not transcription —
      // it decides which days exist at all.
      if (d.distanceMi === 0 && d.type !== 'rest' && d.type !== 'race') continue;
      const dateISO = addDays(w.startISO, (d.dow - weekStartDow + 7) % 7);
      // WEEK-ALIGN-1 · `persistPlan`'s `clipBeforeISO`. Week 0 is composed from
      // the training-week boundary so the week reads back whole; the part of it
      // that predates the runner is not written.
      if (dateISO < built.derived.blockStartISO) continue;
      const shape = persistedDayShape(d, w.tPaceSec ?? built.derived.tPaceSec, args, null);
      const id = `w${wi}d${d.dow}`;
      authored.push({ dow: d.dow, type: d.type, distanceMi: d.distanceMi, subLabel: d.subLabel, isLong: d.isLong });
      rows.push({
        id, date_iso: dateISO, dow: d.dow, type: shape.type,
        // numeric() comes back from node-pg as a STRING. A row that fed a
        // number here would not exercise the coercion the loader performs.
        distance_mi: String(shape.distanceMi),
        sub_label: shape.subLabel, notes: shape.notes,
      });
      paceById.set(id, shape.paceTargetSPerMi);
      totalAuthoredMi += shape.distanceMi;
    }
    weeks.push({ startISO: w.startISO, phase: w.phase, isRaceWeek: !!w.isRaceWeek, tPaceSec: w.tPaceSec ?? null, authored, rows, paceById });
  });

  // THE CHAIN, DETECTED FROM THE OUTPUT. `buildSimPlan` concatenates a hold
  // block and a full build when the race is outside the window; production
  // composes one or the other. A non-race-prep mode whose weeks nevertheless
  // carry build phases is that concatenation, and the hold block is the run of
  // MAINTENANCE / RECOVERY weeks at the front.
  const HOLD_PHASES = new Set(['MAINTENANCE', 'RECOVERY']);
  let holdWeeks = 0;
  while (holdWeeks < weeks.length && HOLD_PHASES.has(weeks[holdWeeks].phase)) holdWeeks++;
  const chainFired = built.mode !== 'race-prep' && holdWeeks < weeks.length;

  return {
    runner: r, derived, weeks, chainFired, holdWeeks,
    mode: built.mode, raceDistanceMi: built.raceDistanceMi,
    goalPaceSec: built.derived.goalPaceSec, tPaceSec: built.derived.tPaceSec,
    longRunDow: DOW_OF[(derived.longRunDay ?? 'sun') as DayKey],
    totalAuthoredMi,
  };
}

/** "1:45:00" / "22:30" → seconds, by the route's own disambiguation rule. */
function goalSecFrom(time: string | null, distance: string): number | null {
  if (!time) return null;
  const three = time.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (three) return Number(three[1]) * 3600 + Number(three[2]) * 60 + Number(three[3]);
  const two = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!two) return null;
  const isShort = distance === '5k' || distance === '10k';
  return isShort ? Number(two[1]) * 60 + Number(two[2]) : Number(two[1]) * 3600 + Number(two[2]) * 60;
}

/** The week `loadPlanWeek` returns for `dateISO`, built with no database. */
function readBackWeek(w: Walked, allRows: PlanWorkoutRow[], dateISO: string): PlanWeekResult {
  const win = trainingWeekWindow(dateISO, dowOf(dateISO), w.longRunDow);
  const inWindow = allRows.filter((r) => r.date_iso >= win.week_start_iso && r.date_iso <= win.week_end_iso);
  return {
    plan_id: 'pln_sim',
    week_start_iso: win.week_start_iso,
    week_end_iso: win.week_end_iso,
    today_iso: dateISO,
    days: shapePlanWeekDays(inWindow, {
      weekStart: win.week_start_iso, today: dateISO,
      actualByDate: new Map(), skippedDates: new Set(),
    }),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE LAWS
 * ═══════════════════════════════════════════════════════════════════════ */

let arcsWalked = 0;
let weeksWalked = 0;
let rowsWritten = 0;
let daysRendered = 0;
let refusals = 0;

/**
 * How many times each law was actually ASKED. A law that never reached its
 * precondition reports clean forever, which is the harness's own version of
 * the bug it exists to catch — so the ones with real preconditions are counted
 * and floored.
 */
const exercised: Record<string, number> = {};
const ask = (law: string) => { exercised[law] = (exercised[law] ?? 0) + 1; };
const modeCounts: Record<string, number> = {};

function grade(r: Runner, rungs: number[], bands: string[]): void {
  arcsWalked++;
  const w = walk(r, rungs, bands);
  if ('refused' in w) {
    // A refusal is a correct answer, not an empty state — but it must be a
    // SENTENCE, and it must not be how the engine handles an ordinary runner.
    refusals++;
    if (!w.refused.replace(/^\w+: /, '').trim()) say('REFUSAL_WITH_NOTHING_IN_IT', r.label, w.refused);
    return;
  }
  const arc = r.label;
  modeCounts[w.mode] = (modeCounts[w.mode] ?? 0) + 1;
  const allRows = w.weeks.flatMap((x) => x.rows);
  rowsWritten += allRows.length;
  weeksWalked += w.weeks.length;

  /* ── LAW O1 · THE ANSWER THE RUNNER GAVE IS THE ANSWER THE ENGINE GOT ── */
  if (r.fitnessMode === 'consistent') {
    if (w.derived.weeklyMi == null) {
      say('VOLUME_ANSWER_DROPPED', arc, `the runner reported ${r.weeklyMi} mi/wk and the route kept nothing`);
    }
    if (w.derived.histAvgMi == null) {
      say('VOLUME_BAND_DROPPED', arc, `histAvg "${String(payloadFor(r, rungs, bands).histAvg)}" is not a value the route accepts`);
    }
  }
  if (w.derived.weeklyFreq !== Math.min(Math.max(r.daysPerWeek, 0), 6)) {
    say('FREQUENCY_ANSWER_DROPPED', arc, `the runner asked for ${r.daysPerWeek} days a week; the route kept ${String(w.derived.weeklyFreq)}`);
  }
  if (w.derived.longRunDay !== r.longRunDay) {
    say('LONG_RUN_DAY_ANSWER_DROPPED', arc, `picked ${r.longRunDay}, kept ${String(w.derived.longRunDay)}`);
  }
  if (w.derived.restDay === w.derived.longRunDay) {
    say('REST_DAY_COLLIDES_WITH_THE_LONG_RUN', arc, `both are ${String(w.derived.longRunDay)} — the generator overwrites the slot and the week has no rest day`);
  }

  /* ── LAW O2 · THE PLAN RUNS THE DAYS THE RUNNER SAID THEY COULD RUN ──
   *
   * A three-day runner once got a six-day plan. The stated frequency is a
   * CAP, never a floor: a taper week legitimately runs fewer days. */
  const statedFreq = w.derived.weeklyFreq;
  if (statedFreq != null && statedFreq >= 1) {
    ask('MORE_RUNNING_DAYS_THAN_THE_RUNNER_HAS');
    for (const wk of w.weeks) {
      if (wk.isRaceWeek) continue;
      const runDays = wk.authored.filter((d) => d.distanceMi > 0).length;
      if (runDays > statedFreq) {
        say('MORE_RUNNING_DAYS_THAN_THE_RUNNER_HAS', arc,
          `week of ${wk.startISO} runs ${runDays} days; the runner said ${statedFreq}`);
        break;
      }
    }
  }

  /* ── LAW O3 · THE LONG RUN IS ON THE DAY THEY CHOSE ── */
  for (const wk of w.weeks) {
    if (wk.isRaceWeek) continue;
    const long = wk.authored.find((d) => d.isLong && d.type !== 'race');
    if (long) ask('LONG_RUN_ON_THE_WRONG_DAY');
    if (long && long.dow !== w.longRunDow) {
      say('LONG_RUN_ON_THE_WRONG_DAY', arc,
        `week of ${wk.startISO} puts the long run on dow ${long.dow}; the runner picked dow ${w.longRunDow}`);
      break;
    }
  }

  /* ── LAW O4 · THE WEEK THE RUNNER OPENS IS ONE OF THEIR TRAINING WEEKS ──
   *
   * The block is authored in weeks. The strip is read in windows. If the two
   * are not the same seven days then the strip is a composite of two weeks,
   * and every per-week number beside it — planned mileage, "Week N of M",
   * cutback detection — is about a week the runner is not looking at. */
  const weekOfDate = new Map<string, number>();
  w.weeks.forEach((wk, i) => { for (const row of wk.rows) weekOfDate.set(row.date_iso, i); });
  // EVERY week of the block is opened, not a sample of one. A defect that only
  // appears in the taper, or only in week 0, is exactly the kind a sample
  // misses — and the block is the unit the runner lives in for four months.
  let straddleReported = false;
  let watchDoseReported = false;
  for (const probeWk of w.weeks) {
    const probeDay = addDays(probeWk.startISO, 2);
    const seen = readBackWeek(w, allRows, probeDay);
    daysRendered += seen.days.length;
    ask('PLAN_WEEK_IS_NOT_THE_RUNNERS_WEEK');
    const drawnFrom = new Set(seen.days.filter((d) => d.plan_workout_id).map((d) => weekOfDate.get(d.date_iso)));
    if (drawnFrom.size > 1 && !straddleReported) {
      straddleReported = true;
      const stripMi = seen.days.reduce((s, d) => s + d.distance_mi, 0);
      const planMi = probeWk.rows.reduce((s, x) => s + Number(x.distance_mi), 0);
      say('PLAN_WEEK_IS_NOT_THE_RUNNERS_WEEK', arc,
        `signed up on a ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dowOf(r.signupISO)]} with ${r.longRunDay} long runs · ` +
        `the strip for ${probeDay} spans plan weeks {${[...drawnFrom].join(', ')}} and totals ` +
        `${stripMi.toFixed(1)} mi while the plan week it sits in is ${planMi.toFixed(1)} mi`);
    }

    /* ── LAW O5 · EVERY ROW IN THE WINDOW REACHES THE SCREEN, UNCHANGED ── */
    const byDate = new Map(seen.days.map((d) => [d.date_iso, d]));
    for (const row of allRows) {
      if (row.date_iso < seen.week_start_iso! || row.date_iso > seen.week_end_iso!) continue;
      const s = byDate.get(row.date_iso);
      if (!s) { say('ROW_IN_THE_WINDOW_VANISHED', arc, `${row.type} on ${row.date_iso} is not on the week`); continue; }
      const isPrimary = s.plan_workout_id === row.id;
      const isSecondary = s.secondaryRun?.plan_workout_id === row.id;
      if (!isPrimary && !isSecondary) {
        say('ROW_COLLAPSED_AWAY', arc, `${row.type} on ${row.date_iso} is neither the day nor its secondary; the day shows ${s.type}`);
        continue;
      }
      const shownMi = isPrimary ? s.distance_mi : s.secondaryRun!.distance_mi;
      if (Math.abs(shownMi - Number(row.distance_mi)) > 0.005) {
        say('PRESCRIBED_DISTANCE_CHANGED', arc, `${row.type} on ${row.date_iso} stored ${row.distance_mi} mi, rendered ${shownMi} mi`);
      }
      const shownLabel = isPrimary ? s.sub_label : s.secondaryRun!.sub_label;
      if ((row.sub_label ?? null) !== (shownLabel ?? null)) {
        say('SESSION_NAME_CHANGED', arc, `${row.date_iso} stored "${row.sub_label}", rendered "${shownLabel}"`);
      }
    }

    /* ── LAW O6 · THE WATCH'S WEEK IS THE PHONE'S WEEK ──
     *
     * `projectWeekStrip` reads `loadPlanWeek` verbatim, so this is the half
     * that IS sound and the law states it so it stays that way. */
    const watch = projectWeekStrip(seen);
    ask('WATCH_WEEK_MILEAGE_DISAGREES_WITH_THE_PHONE');
    if (!watch) {
      say('WATCH_HAS_NO_WEEK', arc, `the phone rendered ${seen.days.length} days and the watch strip is null`);
    } else {
      if (watch.days.length !== seen.days.length) {
        say('WATCH_WEEK_IS_A_DIFFERENT_LENGTH', arc, `phone ${seen.days.length} days, watch ${watch.days.length}`);
      }
      const phoneMi = Math.round(seen.days.reduce((s, d) => s + d.distance_mi, 0) * 10) / 10;
      if (Math.abs(watch.milesPlanned - phoneMi) > 0.05) {
        say('WATCH_WEEK_MILEAGE_DISAGREES_WITH_THE_PHONE', arc, `phone ${phoneMi} mi, watch ${watch.milesPlanned} mi`);
      }
      for (let i = 0; i < Math.min(watch.days.length, seen.days.length); i++) {
        if (watch.days[i].dateIso !== seen.days[i].date_iso || watch.days[i].type !== seen.days[i].type) {
          say('WATCH_DAY_DISAGREES_WITH_THE_PHONE', arc,
            `slot ${i}: phone ${seen.days[i].date_iso} ${seen.days[i].type}, watch ${watch.days[i].dateIso} ${watch.days[i].type}`);
          break;
        }
      }
    }

    /* ── LAW O7 · THE WATCH DOSES THE SESSION OFF THE RUNNER'S OWN WEEK ──
     *
     * `prescriptionFor`'s second argument decides the rep count. The phone
     * passes the plan week's own total; `lib/watch/build-workout.ts` passes a
     * Monday-anchored sum. When those differ the two surfaces can prescribe
     * different sessions for the same day. */
    const todayRow = seen.days.find((d) => d.is_today && d.type !== 'rest');
    if (todayRow) {
      const planWeekMi = probeWk.rows.reduce((s, x) => s + Number(x.distance_mi), 0);
      const mondayDow = dowOf(probeDay);
      const sinceMonday = mondayDow === 0 ? 6 : mondayDow - 1;
      const mondayStart = addDays(probeDay, -sinceMonday);
      const watchWeekMi = allRows
        .filter((x) => x.date_iso >= mondayStart && x.date_iso <= addDays(mondayStart, 6))
        .reduce((s, x) => s + Number(x.distance_mi), 0);
      const p = { lthr: null, goal_seconds: null, goal_distance_mi: w.raceDistanceMi };
      // The phone narrows the row's type before asking; the watch casts and
      // asks anyway. Both are reproduced exactly, because the difference is
      // one of the things under test.
      const type = narrowToPrescriptionType(todayRow.type);
      const onPhone = safeRx(type, planWeekMi, p, todayRow.distance_mi);
      const onWatch = safeRx(todayRow.type as WorkoutType, watchWeekMi, p, todayRow.distance_mi);

      /* ── LAW O7b · THE WATCH ASKS FOR A SESSION THE CATALOGUE HAS ──
       *
       * Four types the generator emits reach `prescriptionFor`'s `default` arm
       * and come back as `total_mi: 0`, "No workout scheduled". The phone
       * narrows them away first. The watch does not, so its fallback for a day
       * whose `workout_spec` is missing is an empty card. */
      if (onWatch && onWatch.total_mi === 0 && todayRow.distance_mi > 0) {
        say('WATCH_FALLBACK_HAS_NO_SESSION_IN_IT', arc,
          `${todayRow.date_iso} type "${todayRow.type}" (${todayRow.distance_mi} mi authored): the watch's ` +
          `fallback prescription is "${onWatch.headline}" · the phone narrows it to "${type}" first`);
      }
      if (onPhone && onWatch && onPhone.headline !== onWatch.headline && !watchDoseReported) {
        watchDoseReported = true;
        say('WATCH_DOSES_OFF_A_DIFFERENT_WEEK', arc,
          `${todayRow.date_iso} ${type}: the phone says "${onPhone.headline}" off a ${planWeekMi.toFixed(1)} mi week, ` +
          `the watch says "${onWatch.headline}" off a ${watchWeekMi.toFixed(1)} mi week`);
      }

      /* ── LAW O8 · THE HEADLINE DOSE IS THE DAY'S OWN DISTANCE ──
       *
       * `V5Panel.dose` is `prescription.total_mi`, not the row. A quality
       * session's steps are padded toward the row's distance and are allowed
       * not to reach it exactly; a whole mile apart is a different run. */
      if (onPhone) ask('TODAY_DOSE_IS_NOT_THE_PLANNED_DISTANCE');
      if (onPhone && Math.abs(onPhone.total_mi - todayRow.distance_mi) > 0.55) {
        say('TODAY_DOSE_IS_NOT_THE_PLANNED_DISTANCE', arc,
          `${todayRow.date_iso} authored "${todayRow.sub_label}" as ${todayRow.distance_mi} mi (${todayRow.type}); ` +
          `the panel would print ${onPhone.total_mi} mi and "${onPhone.headline}"`);
      }

      /* ── LAW O8b · THE PANEL THE RUNNER ACTUALLY SEES ──
       *
       * `composeV5Today` is the last hop and the only one that assembles the
       * screen. Everything above tests its inputs; this runs the composer and
       * looks at what it draws. The context is the minimum the before-run
       * branch reads — no readiness, no weather, no shoes, none of which come
       * from the plan. */
      if (onPhone) {
        const today = composeV5Today({
          todayISO: todayRow.date_iso,
          raceMode: true,
          todayPlan: {
            type: todayRow.type, subLabel: todayRow.sub_label,
            distanceMi: todayRow.distance_mi,
            originalType: null, originalSubLabel: null,
          },
          weekLine: `Week 1 of ${w.weeks.length}`,
          phaseLine: probeWk.phase,
          weekStripDays: seen.days.map((d) => ({
            id: d.plan_workout_id ?? `date:${d.date_iso}`,
            dateISO: d.date_iso, plannedType: d.type, subLabel: d.sub_label,
            isToday: d.is_today, isRest: d.type === 'rest', isDone: false,
          })),
          prescription: {
            type: onPhone.type, headline: onPhone.headline, why: onPhone.why,
            steps: onPhone.steps.map((st) => ({
              label: st.label, distance_mi: st.distance_mi, reps: st.reps,
              rep_distance_mi: st.rep_distance_mi, duration: st.duration,
              pace_target: st.pace_target, hr_target: st.hr_target,
              note: st.note, recovery: st.recovery,
            })),
            total_mi: onPhone.total_mi, fueling: null,
          },
          weatherKicker: null,
          paceBandStat: null, hrCapStat: null, effortStat: null, why: null,
          whereYouAre: [], beforeYouGo: [], paceNote: null,
          raceDay: todayRow.type === 'race',
          recentRun: null, weekOff: null, offSeason: null, injury: null,
          sick: null, convergence: null,
        });
        // The strip on the screen is the week the loader returned. Not
        // re-derived, not a subset, in order.
        if (today.weekStrip.length !== seen.days.length) {
          say('PANEL_WEEK_STRIP_IS_A_DIFFERENT_WEEK', arc,
            `the loader returned ${seen.days.length} days and the panel drew ${today.weekStrip.length}`);
        } else {
          for (let i = 0; i < today.weekStrip.length; i++) {
            if (today.weekStrip[i].dateISO !== seen.days[i].date_iso) {
              say('PANEL_WEEK_STRIP_IS_A_DIFFERENT_WEEK', arc,
                `slot ${i}: loader ${seen.days[i].date_iso}, panel ${today.weekStrip[i].dateISO}`);
              break;
            }
          }
        }
        // RULE ONE, at the surface. Every stat on the panel is a model — a
        // pace band off a typed goal, an HR ceiling off an LTHR estimate — and
        // the composer's own comment says so. A `false` here would be a
        // modelled number wearing a measured number's clothes.
        for (const st of today.panel.stats) {
          if (st.value.modelled !== true) {
            say('A_MODELLED_NUMBER_IS_DRAWN_AS_MEASURED', arc,
              `${todayRow.date_iso} panel stat "${st.label}" = ${st.value.text} is marked measured`);
          }
        }
        // The 56pt headline slot, through the composer rather than through
        // `displayTypeFor` directly.
        if (today.panel.type.length > 16 || /[()]/.test(today.panel.type)) {
          say('PANEL_HEADLINE_IS_NOT_A_NAME', arc, `${todayRow.date_iso} "${today.panel.type}"`);
        }
        // A day with running in it must say how far.
        if (todayRow.distance_mi > 0 && (today.panel.dose == null || !today.panel.dose.text)) {
          say('PANEL_HAS_NO_DOSE_ON_A_RUNNING_DAY', arc,
            `${todayRow.date_iso} ${todayRow.type} ${todayRow.distance_mi} mi and the panel prints no dose`);
        }
        ask('PANEL_HAS_NO_DOSE_ON_A_RUNNING_DAY');
      }

      /* ── LAW O9 · THE PACE ON THE SCREEN IS THE PACE IN THE ROW ──
       *
       * `persistPlan` writes `pace_target_s_per_mi` off the week's blended T.
       * The panel's pace band comes from `derivePaces`, off the runner's typed
       * GOAL. On a by-feel runner there is no goal, so the band must be absent
       * rather than invented. */
      const dp = derivePaces(p);
      const storedPace = w.weeks.flatMap((x) => [...x.paceById.entries()])
        .find(([id]) => id === todayRow.plan_workout_id)?.[1] ?? null;
      if (storedPace != null && (type === 'threshold' || type === 'tempo')) {
        const shown = dp.thresholdSec ?? null;
        if (shown != null && Math.abs(shown - storedPace) > 45) {
          say('SCREEN_PACE_IS_NOT_THE_ROW_PACE', arc,
            `${todayRow.date_iso} ${type}: the row was written at ${storedPace}s/mi, the panel would print ${shown}s/mi`);
        }
      }
    }
  }

  /* ── LAW O10 · A NAME IN THE HEADLINE, AND NOTHING THE ENGINE SAYS TO
   *              ITSELF. Drawn at 56 points, across every row in the block. */
  for (const row of allRows) {
    const headline = displayTypeFor(row.type, row.sub_label);
    if (headline.length > 16) say('HEADLINE_TOO_LONG_FOR_56PT', arc, `${row.date_iso} "${headline}" is ${headline.length} characters`);
    if (/[()]/.test(headline)) say('HEADLINE_IS_ENGINE_SHORTHAND', arc, `${row.date_iso} "${headline}"`);
    if (row.sub_label && !subLabelIsName(row.sub_label) && headline === row.sub_label) {
      say('REJECTED_LABEL_REACHED_THE_HEADLINE', arc, `${row.date_iso} "${row.sub_label}"`);
    }
  }

  /* ── LAW O11 · COACH VOICE, IN EVERY LABEL THE BLOCK WRITES ── */
  for (const row of allRows) {
    for (const text of [row.sub_label, row.notes]) {
      if (!text) continue;
      if (/[!]/.test(text)) say('LABEL_SHOUTS', arc, `${row.date_iso} "${text}"`);
      if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text)) say('LABEL_CARRIES_AN_EMOJI', arc, `${row.date_iso} "${text}"`);
      if (/—/.test(text)) say('LABEL_USES_AN_EM_DASH', arc, `${row.date_iso} "${text}"`);
    }
  }

  /* ── LAW O11b · THE SIMULATOR AUTHORS WHAT PRODUCTION AUTHORS ──
   *
   * `buildSimPlan` chains: when the race sits outside `BUILD_WINDOW_WEEKS` it
   * composes the hold block AND THEN the whole periodized build, and hands
   * back one calendar. Its own comment says why — "so the runner sees the
   * complete picture instead of a 1-4 week stub that just stops."
   *
   * `composeForUserInternal` does not. It calls `pickPlanMode` once and one
   * composer once. So for a race outside the window, production writes the
   * stub and the simulator draws the complete picture, and they are not the
   * same plan. This law names every archetype where the two part company. */
  if (w.chainFired) {
    ask('THE_SIMULATOR_SHOWS_A_PLAN_PRODUCTION_DOES_NOT_AUTHOR');
    say('THE_SIMULATOR_SHOWS_A_PLAN_PRODUCTION_DOES_NOT_AUTHOR', arc,
      `${r.distance} ${r.raceInWeeks} weeks out · the simulator composes ${w.weeks.length} weeks ` +
      `(${[...new Set(w.weeks.map((x) => x.phase))].join('→')}); production's \`pickPlanMode\` answers ` +
      `"${w.mode}" and authors only the first ${w.holdWeeks} of them`);
  }

  /* ── LAW O12 · THE BLOCK REACHES THE RACE THE RUNNER ENTERED ──
   *
   * A plan authored today for a race N weeks out has to still be a plan when N
   * is small and when N is large. The engine refuses under two weeks and over
   * a year, and a refusal is a correct answer — but anything it AGREES to
   * build must arrive on the day. */
  if (r.raceInWeeks != null && w.derived.date) {
    ask('THE_BLOCK_DOES_NOT_REACH_THE_RACE');
    const last = w.weeks[w.weeks.length - 1];
    const lastDay = addDays(last.startISO, 6);
    if (w.derived.date > lastDay || w.derived.date < w.weeks[0].startISO) {
      say('THE_BLOCK_DOES_NOT_REACH_THE_RACE', arc,
        `race day is ${w.derived.date}; the block runs ${w.weeks[0].startISO} to ${lastDay}`);
    }
    // Within a week either side — the deadline is snapped to the long-run day.
    const spanWeeks = w.weeks.length;
    if (spanWeeks < r.raceInWeeks - 1 || spanWeeks > r.raceInWeeks + 2) {
      say('THE_BLOCK_IS_NOT_THE_LENGTH_THE_RUNNER_CHOSE', arc,
        `the runner entered a race ${r.raceInWeeks} weeks out and the block is ${spanWeeks} weeks`);
    }
  }

  /* ── LAW O13 · A RACE-PREP BLOCK ENDS IN A TAPER ──
   *
   * Cite: Research/00a §"Taper". A block that ramps to the gun is not a plan,
   * it is a calendar. Only asserted where doctrine's taper applies — a block
   * with fewer weeks than the shortest taper doctrine names has no room. */
  //
  // Gated on the block ENDING AT A RACE, not on `mode`. A half 14 weeks out is
  // outside `BUILD_WINDOW_WEEKS.hm` (12), so `pickPlanMode` answers
  // `maintenance` and the composer chains the hold block onto the full build
  // — 230 of this file's 258 archetypes take that path. Reading `mode` here
  // skipped every one of them, which is how a law comes to be asked ten times.
  if (r.raceInWeeks != null && w.weeks.length >= 6) {
    ask('NO_TAPER_BEFORE_THE_RACE');
    const tail = w.weeks.slice(-3);
    if (!tail.some((wk) => wk.phase === 'TAPER' || wk.isRaceWeek)) {
      say('NO_TAPER_BEFORE_THE_RACE', arc,
        `the last three weeks are ${tail.map((x) => x.phase).join(', ')}`);
    }
  }

  /* ── LAW O14 · THE RECOVERY BLOCK SPENDS THE RIGHT COLUMN ──
   *
   * THE INCIDENT THIS IS WRITTEN FROM. `Research/00b` §"Recovery by Distance"
   * has two adjacent columns — "Total recovery days (no quality)" and "Days of
   * zero/very-light running" — and the engine once spent the first as if it
   * were the second: a half-marathon recovery block with FIVE STRAIGHT REST
   * DAYS and fifteen miles across a fortnight, off a 33 mi/wk base. Fixed in
   * 52174bcd; `RECOVERY.half-protocol-run-days` watches the CONSTANT.
   *
   * Nothing watched the composed BLOCK, which is where the runner meets it.
   * The bands are read out of the doc at run time, so this cannot pass by
   * agreeing with itself. */
  if (w.mode === 'recovery' && r.lastRaceDistance) {
    const band = recoveryBands(r.lastRaceDistance);
    if (band) {
      ask('RECOVERY_SPENDS_THE_WRONG_COLUMN');
      ask('QUALITY_INSIDE_THE_NO_QUALITY_WINDOW');
      const agoDays = r.lastRaceDaysAgo ?? 0;
      // Rest days the block itself prescribes, as a run of consecutive days —
      // the shape the incident took. The days before the block starts are not
      // observable from here, so they are added at the front only when the
      // block opens on the race itself.
      const dayTypes: Array<{ sinceRace: number; mi: number; quality: boolean }> = [];
      for (const wk of w.weeks) {
        const wkStartDow = dowOf(wk.startISO);
        for (const d of wk.authored) {
          const offset = (d.dow - wkStartDow + 7) % 7;
          const sinceRace = agoDays + (Date.parse(addDays(wk.startISO, offset) + 'T12:00:00Z')
            - Date.parse(w.weeks[0].startISO + 'T12:00:00Z')) / 86400000;
          dayTypes.push({
            sinceRace, mi: d.distanceMi,
            quality: ['threshold', 'intervals', 'tempo', 'race_week_tuneup'].includes(d.type),
          });
        }
      }
      dayTypes.sort((a, b) => a.sinceRace - b.sinceRace);
      let streak = 0, worst = 0;
      for (const d of dayTypes) {
        if (d.sinceRace > band.zero[1] + 7) break; // past the window doctrine describes
        if (d.mi === 0) { streak++; worst = Math.max(worst, streak); } else streak = 0;
      }
      if (worst > band.zero[1]) {
        say('RECOVERY_SPENDS_THE_WRONG_COLUMN', arc,
          `${r.lastRaceDistance}: ${worst} consecutive days of no running · Research/00b ` +
          `§"Recovery by Distance" allows ${band.zero[0]}-${band.zero[1]} days of zero running ` +
          `(the ${band.noQuality[0]}-${band.noQuality[1]} figure beside it is days without QUALITY, ` +
          'and spending it as rest is the 52174bcd defect)');
      }
      const earlyQuality = dayTypes.find((d) => d.quality && d.sinceRace < band.noQuality[0]);
      if (earlyQuality) {
        say('QUALITY_INSIDE_THE_NO_QUALITY_WINDOW', arc,
          `${r.lastRaceDistance}: a quality session ${Math.round(earlyQuality.sinceRace)} days after the race · ` +
          `Research/00b allows no quality for ${band.noQuality[0]}-${band.noQuality[1]} days`);
      }
    }
  }

  /* ── LAW O15 · THE BLOCK IS NOT EMPTY, AND NO WEEK IN IT IS ── */
  if (w.totalAuthoredMi <= 0) {
    say('BLOCK_HAS_NO_RUNNING_IN_IT', arc, `${w.weeks.length} weeks, ${w.totalAuthoredMi} mi`);
  }
  for (const wk of w.weeks) {
    if (wk.isRaceWeek || wk.phase === 'TAPER' || w.mode === 'recovery') continue;
    if (wk.authored.every((d) => d.distanceMi === 0)) {
      say('EMPTY_TRAINING_WEEK', arc, `week of ${wk.startISO} (${wk.phase}) has no running in it`);
      break;
    }
  }
}

/**
 * The two adjacent columns of `Research/00b` §"Recovery by Distance", read out
 * of the doc at run time. Hardcoding either side would only prove the test
 * agrees with itself — the rule Rule 7 states in as many words.
 */
const RECOVERY_ROW: Record<string, string> = {
  '5k': '5K', '10k': '10K', half: 'Half marathon', marathon: 'Marathon',
};
let recoveryTable: ReturnType<typeof resolveCitation> | null | undefined;
function recoveryBands(distance: string): { zero: [number, number]; noQuality: [number, number] } | null {
  if (recoveryTable === undefined) {
    try {
      recoveryTable = resolveCitation('Research/00b-recovery-protocols.md', '### Recovery by Distance');
    } catch { recoveryTable = null; }
  }
  if (!recoveryTable) return null;
  const label = RECOVERY_ROW[distance];
  if (!label) return null;
  const t = recoveryTable.table();
  return {
    zero: parseBand(t.cell(label, 'Days of zero/very-light running')),
    noQuality: parseBand(t.cell(label, 'Total recovery days (no quality)')),
  };
}

/** `prescriptionFor` throws on a type it does not implement. That is not a
 *  finding about the plan, so it is caught rather than counted. */
function safeRx(type: WorkoutType, weeklyMi: number, p: Parameters<typeof prescriptionFor>[2], targetMi: number) {
  try { return prescriptionFor(type, weeklyMi, p, targetMi); } catch { return null; }
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE ARCHETYPES
 * ═══════════════════════════════════════════════════════════════════════ */

const ALL_DAYS: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
/** Seven consecutive days, so every signup weekday is walked. */
const SIGNUPS = ['2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12'];

const BASE: Omit<Runner, 'label' | 'longRunDay' | 'signupISO' | 'daysPerWeek'> = {
  distance: 'half', raceInWeeks: 14, goalTime: '1:45:00',
  fitnessMode: 'consistent', weeklyMi: 25, longestRunBucket: '6-10', observedVdot: null,
};

/** SWEEP 1 · every weekly frequency against every long-run day against every
 *  signup weekday. The training week ENDS on the long-run day, so a boundary
 *  defect hides in exactly one combination and nothing smaller finds it. */
function* boundaryMatrix(): Generator<Runner> {
  // Two runways per cell: 12 weeks is inside `BUILD_WINDOW_WEEKS.hm` and
  // composes as a straight race-prep block; 16 is outside it, so the engine
  // holds in maintenance and chains the build on behind. Both are ordinary
  // answers to the same screen and they take different code paths.
  // EVERY frequency the screen offers, not just the comfortable ones. 0 is
  // "not running right now" and floors to a three-day couch-to-X; 1 and 2 are
  // hard caps the layout has to respect, and they are where "a three-day
  // runner got a six-day plan" lives.
  for (const longRunDay of ALL_DAYS)
    for (const daysPerWeek of [0, 1, 2, 3, 4, 5, 6])
      for (const signupISO of SIGNUPS)
        for (const raceInWeeks of [12, 16])
          yield { ...BASE, label: `boundary/${longRunDay}/f${daysPerWeek}/${signupISO}/${raceInWeeks}wk`, longRunDay, daysPerWeek, signupISO, raceInWeeks };
}

/** SWEEP 2 · the runners who actually arrive. */
function* personas(): Generator<Runner> {
  const starts = ['2026-09-07', '2026-09-10'];
  for (const signupISO of starts) {
    for (const longRunDay of ['sun', 'sat'] as DayKey[]) {
      // A true beginner. No volume answer at all, because the screen does not
      // ask them one — the mode they picked asks something else.
      yield { ...BASE, label: `beginner/${longRunDay}/${signupISO}`, longRunDay, signupISO,
        distance: '5k', raceInWeeks: 12, goalTime: '', fitnessMode: 'new', daysPerWeek: 3,
        weeklyMi: 0, longestRunBucket: '0-3', observedVdot: null };
      // Returning after a break. Some base, no measured fitness.
      yield { ...BASE, label: `returning/${longRunDay}/${signupISO}`, longRunDay, signupISO,
        distance: '10k', raceInWeeks: 14, goalTime: '52:00', fitnessMode: 'returning', daysPerWeek: 4,
        weeklyMi: 0, longestRunBucket: '3-6', observedVdot: null };
      // A competitive marathoner with a deep, observed history.
      yield { ...BASE, label: `competitive/${longRunDay}/${signupISO}`, longRunDay, signupISO,
        distance: 'marathon', raceInWeeks: 18, goalTime: '2:55:00', fitnessMode: 'consistent',
        daysPerWeek: 6, weeklyMi: 62, longestRunBucket: '16-22', observedVdot: 58 };
      // No Strava at all, against the same answers.
      yield { ...BASE, label: `no-strava/${longRunDay}/${signupISO}`, longRunDay, signupISO,
        daysPerWeek: 5, observedVdot: null };
      // Deep Strava history, same answers — the measured-anchor path.
      yield { ...BASE, label: `deep-strava/${longRunDay}/${signupISO}`, longRunDay, signupISO,
        daysPerWeek: 5, observedVdot: 48 };
      // No race at all. The v5 screen's no-race path authors nothing at
      // onboarding; the engine's just-run block is what a goal later builds.
      yield { ...BASE, label: `no-race/${longRunDay}/${signupISO}`, longRunDay, signupISO,
        distance: 'none', raceInWeeks: null, goalTime: '', daysPerWeek: 4 };
      // Mid-block when the plan is authored.
      yield { ...BASE, label: `mid-block/${longRunDay}/${signupISO}`, longRunDay, signupISO,
        daysPerWeek: 5, isMidBlock: true };
      // Just raced — the recovery block.
      for (const [dist, ago] of [['half', 4], ['marathon', 6], ['10k', 3]] as const) {
        yield { ...BASE, label: `post-${dist}-${ago}d/${longRunDay}/${signupISO}`, longRunDay, signupISO,
          distance: 'marathon', raceInWeeks: 20, goalTime: '3:30:00', daysPerWeek: 5,
          lastRaceDaysAgo: ago, lastRaceDistance: dist };
      }
    }
  }
}

/** SWEEP 3 · the runway. A race next week and a race a year out are the two
 *  ends where the week arithmetic stops being ordinary. */
function* runways(): Generator<Runner> {
  for (const raceInWeeks of [1, 2, 3, 4, 6, 8, 12, 16, 20, 26, 40, 51])
    for (const longRunDay of ['sun', 'wed'] as DayKey[])
      yield { ...BASE, label: `runway/${raceInWeeks}wk/${longRunDay}`, longRunDay, signupISO: '2026-09-09', daysPerWeek: 5, raceInWeeks };
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE TESTS
 * ═══════════════════════════════════════════════════════════════════════ */

describe('onboarding · a new runner walks in, and the plan they get is the plan they are shown', () => {
  it('the phone cannot send an answer the route drops', () => {
    const rungs = hostWeeklyMiRungs();
    const bands = hostHistAvgBands();
    expect(rungs, `could not read validWeeklyMi out of ${HOSTS_V5}`).not.toBeNull();
    expect(bands, `could not read histAvgBand out of ${HOSTS_V5}`).not.toBeNull();
    const dropped: string[] = [];
    for (const mi of rungs!) if (!VALID_WEEKLY_MI.has(mi as never)) dropped.push(`weeklyMi ${mi}`);
    for (const b of bands!) if (!VALID_HIST_AVG.has(b as HistAvg)) dropped.push(`histAvg "${b}"`);
    // The host clamps frequency into 0...6 before sending; every value in that
    // range has to be one the route keeps, or a runner's day count is dropped.
    for (let f = 0; f <= 6; f++) if (!VALID_FREQ.has(f as never)) dropped.push(`weeklyFreq ${f}`);
    for (const d of ALL_DAYS) if (!VALID_DAY_KEYS.has(d)) dropped.push(`longRunDay "${d}"`);
    expect(dropped, 'the phone can send these and the route keeps none of them').toEqual([]);
  });

  it('the simulator seeds the engine the way the route does', () => {
    // `recentWeeklyMiFromBucket` says in its own doc comment that it is "the
    // exact (lossy) value a new no-Strava signup's plan is seeded from", and
    // production's value is always a HIST_AVG_MIDPOINTS entry — the host sends
    // a band, the route persists that band's midpoint, the engine reads the
    // column. A bucket that seeds anything else is a runner nobody can be.
    //
    // Reported as a finding rather than asserted here, because the answer is a
    // decision and not an oversight: see the KNOWN entry.
    const routeMidpoints = new Set(Object.values(HIST_AVG_MIDPOINTS));
    for (const b of WEEKLY_BUCKETS) {
      const seeded = recentWeeklyMiFromBucket(b);
      if (!routeMidpoints.has(seeded)) {
        say('SIM_SEED_IS_NOT_A_SEED_THE_ROUTE_CAN_WRITE', `bucket/${b}`,
          `bucket ${b} seeds ${seeded} mi/wk; the route can only persist ` +
          `${[...routeMidpoints].sort((x, y) => x - y).join(', ')}`);
      }
    }
    // The longest-run ladder is held to the same rule, and passes it.
    const hardFail: string[] = [];
    const longMidpoints = new Set(Object.values(HIST_LONG_MIDPOINTS));
    for (const b of ['0-3', '3-6', '6-10', '10+', '16-22', '22+'] as SimLongBucket[]) {
      const seeded = recentLongMiFromBucket(b);
      if (!longMidpoints.has(seeded)) {
        hardFail.push(`longest bucket "${b}" seeds ${seeded} mi, which is not a HIST_LONG_MIDPOINTS value`);
      }
    }
    // And the bridge this file uses has to round-trip exactly, or every
    // archetype below is graded against a runner it did not build.
    for (const b of WEEKLY_BUCKETS) {
      const mi = recentWeeklyMiFromBucket(b);
      if (recentWeeklyMiFromBucket(bucketForSeededMi(mi)) !== mi) {
        hardFail.push(`bucketForSeededMi(${mi}) does not round-trip bucket ${b}`);
      }
    }
    expect(hardFail, 'the walk is grading a runner it did not build').toEqual([]);
  });

  it('the laws catch a plan that has gone wrong', () => {
    // POSITIVE CONTROLS. A harness that cannot fail is a harness that reports
    // clean because it looked at nothing.
    const missed: string[] = [];
    const before = findings.length;

    // 1 · A three-day runner handed a six-day week.
    const sixDayWeek: PlanWorkoutRow[] = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-13']
      .map((d, i) => ({ id: `x${i}`, date_iso: d, dow: dowOf(d), type: i === 5 ? 'long' : 'easy', distance_mi: '5', sub_label: i === 5 ? 'LONG' : 'EASY' }));
    const seen = shapePlanWeekDays(sixDayWeek, { weekStart: '2026-09-07', today: '2026-09-07', actualByDate: new Map(), skippedDates: new Set() });
    if (seen.filter((d) => d.distance_mi > 0).length !== 6) missed.push('the reader did not render six running days it was given six rows for');

    // 2 · A distance that changed between the row and the screen.
    const bumped = shapePlanWeekDays(
      [{ id: 'a', date_iso: '2026-09-07', dow: 1, type: 'long', distance_mi: '13.7', sub_label: 'LONG' }],
      { weekStart: '2026-09-07', today: '2026-09-07', actualByDate: new Map(), skippedDates: new Set() });
    if (bumped[0].distance_mi !== 13.7) missed.push('the loader did not carry a numeric() string through as a number');

    // 3 · A prescription in the 56pt headline slot.
    if (displayTypeFor('threshold', '2 mi WU · 4 mi @ T · 2 mi CD').length > 16) {
      missed.push('a prescription reached the 56pt headline and LAW O10 would not object');
    }
    // 4 · Engine shorthand in it.
    if (subLabelIsName('EASY (MEDIUM)')) missed.push('`EASY (MEDIUM)` passes the name gate');

    // 5 · The boundary law itself, driven by a block built to break it.
    //
    //     This control used to ask the ENGINE for a Wednesday signup with
    //     Sunday long runs and assert the result straddled — which it did,
    //     because the anchor was literal (two live production plans were in
    //     exactly that shape on 2026-08-24). WEEK-ALIGN-1 snapped the anchor,
    //     so the engine no longer produces one, and a control phrased as "the
    //     defect still reproduces" retires itself the moment the defect is
    //     fixed. That is backwards: the control's job is to prove the DETECTOR
    //     has teeth, and the detector must keep them forever.
    //
    //     So the misaligned block is synthesised here instead — weeks laid on
    //     a Wed→Tue grid against a Sunday long run, which is what the engine
    //     used to write — and LAW O4's own straddle test is run against it.
    {
      const misaligned: PlanWorkoutRow[] = [];
      const wkOf = new Map<string, number>();
      for (let wi = 0; wi < 3; wi++) {
        const start = addDays('2026-09-09', wi * 7);   // 2026-09-09 is a Wednesday
        for (let i = 0; i < 7; i++) {
          const d = addDays(start, i);
          misaligned.push({
            id: `m${wi}-${i}`, date_iso: d, dow: dowOf(d),
            type: dowOf(d) === 0 ? 'long' : 'easy', distance_mi: '5',
            sub_label: dowOf(d) === 0 ? 'LONG' : 'EASY',
          });
          wkOf.set(d, wi);
        }
      }
      const asIfWalked = { longRunDow: 0 } as Walked;   // Sunday long runs
      const week = readBackWeek(asIfWalked, misaligned, '2026-09-18');
      const spans = new Set(week.days.filter((d) => d.plan_workout_id).map((d) => wkOf.get(d.date_iso)));
      if (spans.size <= 1) {
        missed.push('a Wed→Tue block read back in Mon→Sun windows no longer registers as a straddle — LAW O4 is asleep');
      }
    }

    // 5b · And the engine does not build one. The runner the law was written
    //      from: a Wednesday signup with Sunday long runs. Every week of the
    //      block must read back whole, and no day may predate the signup.
    const wed: Runner = { ...BASE, label: 'control/wed-signup', longRunDay: 'sun', daysPerWeek: 5, signupISO: '2026-09-09' };
    const walked = walk(wed, hostWeeklyMiRungs()!, hostHistAvgBands()!);
    if ('refused' in walked) {
      missed.push(`the control runner was refused a plan: ${walked.refused}`);
    } else {
      const rows = walked.weeks.flatMap((x) => x.rows);
      const wkOf = new Map<string, number>();
      walked.weeks.forEach((x, i) => { for (const r of x.rows) wkOf.set(r.date_iso, i); });
      const probe = addDays(walked.weeks[2].startISO, 2);
      const week = readBackWeek(walked, rows, probe);
      const spans = new Set(week.days.filter((d) => d.plan_workout_id).map((d) => wkOf.get(d.date_iso)));
      if (spans.size > 1) missed.push('a Wednesday signup with Sunday long runs still straddles two plan weeks');
      const early = rows.filter((r) => r.date_iso < wed.signupISO);
      if (early.length > 0) missed.push(`${early.length} rows are dated before the runner signed up (first ${early[0].date_iso})`);
    }

    // 6 · The route's refusals still refuse.
    for (const [body, why] of [
      [{ timezone: 'UTC', name: 'R' }, 'no distance'],
      [{ distance: 'half', timezone: 'UTC', name: 'R' }, 'a race distance with no date'],
      [{ distance: 'none', timezone: 'UTC' }, 'no name'],
      [{ distance: 'none', name: 'R' }, 'no timezone'],
    ] as [Record<string, unknown>, string][]) {
      const d = deriveOnboardingComplete(body, '2026-09-09');
      if (!isRefusal(d)) missed.push(`the route accepted ${why}`);
      else if (!d.error.trim()) missed.push(`the route refused ${why} with an empty sentence`);
    }

    // The controls must not leave findings of their own behind.
    findings.length = before;
    console.log(`\n=== ONBOARDING CONTROLS · ${11 - missed.length} of 11 caught ===`);
    for (const m of missed) console.log(`  MISSED  ${m}`);
    expect(missed, 'the onboarding laws have stopped working').toEqual([]);
  });

  it('a race next week and a race a year out both get an honest answer', () => {
    // The two ends of the runway, printed rather than only graded. A plan
    // authored today for a race N weeks out has to still be a plan when N is
    // one and when N is fifty-one — or an honest refusal, which is also an
    // answer, but never a block that quietly does not reach the start line.
    const rungs = hostWeeklyMiRungs()!;
    const bands = hostHistAvgBands()!;
    const bad: string[] = [];
    console.log('\n=== THE RUNWAY ===');
    for (const raceInWeeks of [1, 2, 3, 4, 6, 8, 12, 16, 20, 26, 40, 51, 53]) {
      const r: Runner = { ...BASE, label: `runway/${raceInWeeks}`, longRunDay: 'sun', daysPerWeek: 5, signupISO: '2026-09-09', raceInWeeks };
      const w = walk(r, rungs, bands);
      if ('refused' in w) {
        console.log(`  ${String(raceInWeeks).padStart(2)} wk  REFUSED · ${w.refused}`);
        // A refusal must carry a reason a runner can act on.
        if (w.refused.replace(/^\w+: /, '').length < 12) bad.push(`${raceInWeeks}wk refused with "${w.refused}"`);
        continue;
      }
      const last = addDays(w.weeks[w.weeks.length - 1].startISO, 6);
      const phases = [...new Set(w.weeks.map((x) => x.phase))].join('→');
      const peak = Math.max(...w.weeks.map((x) => x.rows.reduce((s, y) => s + Number(y.distance_mi), 0)));
      console.log(`  ${String(raceInWeeks).padStart(2)} wk  ${String(w.weeks.length).padStart(2)} weeks · ${w.mode.padEnd(11)} · peak ${peak.toFixed(1)} mi · ${phases} · ends ${last} (race ${w.derived.date})`);
      if (w.derived.date && w.derived.date > last) bad.push(`${raceInWeeks}wk: the block ends ${last}, the race is ${w.derived.date}`);
    }
    expect(bad, 'a race the block never reaches, or a refusal with nothing in it').toEqual([]);
  });

  it('every archetype gets the plan it was promised', () => {
    const rungs = hostWeeklyMiRungs()!;
    const bands = hostHistAvgBands()!;
    for (const r of boundaryMatrix()) grade(r, rungs, bands);
    for (const r of personas()) grade(r, rungs, bands);
    for (const r of runways()) grade(r, rungs, bands);

    const byLaw = new Map<string, Finding[]>();
    for (const f of findings) {
      const list = byLaw.get(f.law) ?? [];
      list.push(f);
      byLaw.set(f.law, list);
    }

    console.log(`\n=== WALKED ${arcsWalked} ONBOARDING ARCHETYPES ===`);
    console.log(`    ${weeksWalked} weeks composed · ${rowsWritten} plan_workouts rows · ${daysRendered} rendered days · ${refusals} honest refusals`);
    console.log('\n--- HOPS THIS WALK DOES NOT COVER ---');
    for (const u of UNCOVERED) console.log(`  · ${u}`);
    console.log(`\n--- FINDINGS · ${findings.length} across ${byLaw.size} laws ---`);
    for (const [law, list] of [...byLaw.entries()].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  [${list.length}] ${law}${KNOWN[law] ? '  (KNOWN)' : ''}`);
      if (KNOWN[law]) console.log(`        ${KNOWN[law]}`);
      for (const f of list.slice(0, 2)) console.log(`        ${f.arc} — ${f.saw}`);
    }

    // THE FLOOR. A walk that walked nothing and reported clean is the same
    // bug one level up.
    expect(arcsWalked, 'too few archetypes for this walk to mean anything').toBeGreaterThanOrEqual(750);
    expect(weeksWalked, 'no weeks were composed — the engine refused everything').toBeGreaterThanOrEqual(10000);
    expect(rowsWritten, 'no rows were written — the persist hop was never reached').toBeGreaterThanOrEqual(60000);
    expect(daysRendered, 'no days were rendered — the reader returned nothing').toBeGreaterThanOrEqual(70000);
    // ALL THREE ENGINE MODES. `composePlan`, `composeMaintenancePlan` and
    // `composeRecoveryPlan` are three different authors and a walk that only
    // reached one of them has audited a third of onboarding.
    for (const [mode, floor] of [['race-prep', 100], ['maintenance', 100], ['recovery', 8]] as [string, number][]) {
      expect(modeCounts[mode] ?? 0, `only ${modeCounts[mode] ?? 0} archetypes reached ${mode}`).toBeGreaterThanOrEqual(floor);
    }

    // EVERY LAW WITH A PRECONDITION MUST HAVE REACHED IT. A global archetype
    // count does not prove the recovery law ran — only recovery blocks ask it,
    // and if none were composed it has reported clean while looking at
    // nothing. The floors are what the archetype set actually produces, so a
    // sweep that quietly stops building post-race runners fails here.
    console.log(`\n--- MODES · ${JSON.stringify(modeCounts)} ---`);
    console.log('\n--- LAWS ASKED ---');
    for (const [law, n] of Object.entries(exercised).sort()) console.log(`  ${String(n).padStart(6)}× ${law}`);
    const asleep = Object.entries({
      MORE_RUNNING_DAYS_THAN_THE_RUNNER_HAS: 600,
      // 2026-08-24 · was 10000, and RACE-RUNUP-1 took it to 9929: a long run
      // inside the seven days before the race is now eased to an easy day, so
      // there are ~70 fewer long runs across the sweep for this law to ask
      // about. The floor moves to just under the new figure rather than to it,
      // so it still catches the law going quiet without failing on the next
      // legitimate handful.
      LONG_RUN_ON_THE_WRONG_DAY: 9800,
      PLAN_WEEK_IS_NOT_THE_RUNNERS_WEEK: 10000,
      WATCH_WEEK_MILEAGE_DISAGREES_WITH_THE_PHONE: 10000,
      TODAY_DOSE_IS_NOT_THE_PLANNED_DISTANCE: 5000,
      THE_BLOCK_DOES_NOT_REACH_THE_RACE: 700,
      NO_TAPER_BEFORE_THE_RACE: 700,
      // Only the post-race personas reach these two, and they are the pair
      // the 52174bcd incident turned on.
      RECOVERY_SPENDS_THE_WRONG_COLUMN: 6,
      QUALITY_INSIDE_THE_NO_QUALITY_WINDOW: 6,
      THE_SIMULATOR_SHOWS_A_PLAN_PRODUCTION_DOES_NOT_AUTHOR: 300,
      PANEL_HAS_NO_DOSE_ON_A_RUNNING_DAY: 5000,
    }).filter(([law, floor]) => (exercised[law] ?? 0) < floor)
      .map(([law, floor]) => `${law} was asked ${exercised[law] ?? 0}×, needs ${floor}`);
    expect(asleep, 'these laws never reached their precondition — they are reporting clean on nothing').toEqual([]);

    // A KNOWN entry that no longer fires is a fixed bug wearing an open one's
    // clothes. Delete it.
    const stale = Object.keys(KNOWN).filter((k) => !byLaw.has(k));
    expect(stale, 'these are marked open and no longer happen — delete them from KNOWN').toEqual([]);

    // THE GATE.
    const unexpected = [...byLaw.entries()]
      .filter(([law]) => !KNOWN[law])
      .map(([law, list]) => `[${list.length}] ${law} e.g. ${list[0].arc} — ${list[0].saw}`);
    expect(unexpected).toEqual([]);
  }, 300_000);
});

export const UNCOVERED = [
  '`generatePlan`\'s database reads. `loadGeneratorInputs` resolves the race row, the ' +
    'measured VDOT, the mid-block detection and the seal snapshot from Postgres; ' +
    '`buildSimPlan` mirrors it step for step and is what is driven here. The two are ' +
    'held together by `lib/plan/_audit_connection_parity.test.ts`, not by this file.',
  'The INSERT itself. `persistedDayShape` is the row\'s values; the statement that binds ' +
    'them, the chunking and the `original_*` columns are entered around.',
  'The other writers of `plan_workouts` — seed-from-onboarding, injury-builder, the ' +
    'reschedule route, mutate, adapt. Only the generate path is walked.',
  'The Swift. `OnboardingHostV5`\'s payload is reconstructed here and its two derived ' +
    'values are read out of the source, but nothing in this file runs Swift, and the ' +
    'watch\'s own rendering of the week is not reached.',
  'Readiness, weather, shoes and fuelling. They reach the same screen and none of them ' +
    'comes from the plan.',
];
