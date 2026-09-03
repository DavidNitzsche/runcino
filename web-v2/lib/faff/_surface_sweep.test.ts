/**
 * lib/faff/_surface_sweep.test.ts — EXHAUSTIVE surface conformance sweep.
 *
 * The sibling of `lib/plan/_sweep_allusers.test.ts`, one layer up. That one
 * proves a plan is well-FORMED across 7680 archetypes. This one proves the
 * SURFACES a runner reads hold their contract across every runner state, every
 * awkward data shape production actually contains, and every calendar boundary
 * — 4284 cells, each driving the real composers.
 *
 * Run:
 *   ./node_modules/.bin/vitest run lib/faff/_surface_sweep.test.ts \
 *     --disable-console-intercept 2>&1 | tail -60
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE BAR
 *
 * For every cell, every surface must do one of three things — render the
 * truth, refuse, or degrade honestly — and never the fourth: a plausible wrong
 * answer. `lib/faff/surface-sweep-matrix.ts` holds the states, the shapes, the
 * boundaries and the rules; this file holds the fixtures and the gate.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE REFUSES TO PASS ON NOTHING
 *
 * Two sweeps in this repo have reported clean while running zero cells. So:
 *
 *   · CELL FLOOR — the matrix must yield at least `CELL_FLOOR` cells and the
 *     auditors must run at least `CHECK_FLOOR` assertions, or the gate fails
 *     before it looks at a single finding.
 *   · POSITIVE CONTROLS — every rule in `RULES` is fired at least once against
 *     a deliberately planted defect, and a meta-test asserts that EVERY rule id
 *     has such a control. A rule with no control is a rule that may already be
 *     dead; the coverage test is what stops one being added without one.
 *
 * The controls plant defects in composer OUTPUT, not in the composers, so they
 * stay green when the engine is fixed and still prove the detector is live.
 */
import { describe, it, expect } from 'vitest';

import { composeV5Today, type V5TodayContext, type V5Today, type V5Row, type V5PrescriptionLike } from './v5-today';
import { composeWhy, type WhyFacts } from './why-voice';
import { deriveRecap, type RecapInput, type RecapPayload } from '../coach/run-recap';
import { resolveBlockState, type BlockState } from './block-state';
import { resolveRampScope, type RampScope } from './ramp-scope';
import { racePlateFor, type RacePlate } from './race-plate';
import { resolveRaceRole, resolveProvenance } from './race-roles';
import { daysToRace, weeksToRace } from './race-countdown';

import {
  sweepMatrix, cellId, CELL_FLOOR, BOUNDARY_DATES, GOAL_RACE, BOUNDARIES,
  RULES, RULE_IDS, FIRM_RULE_IDS, MAX_PAUSED_SHARE,
  RETIRED_WIRE_FIELDS, RETIRED_WIRE_STATES,
  isBadText, voiceBreak, walkStrings, parsePrinted,
  type Cell, type Finding, type RuleId, type RunnerState, type DataShape,
} from './surface-sweep-matrix';

// ─────────────────────────────────────────────────────────────────────────
// Fixtures — one realistic context per cell
// ─────────────────────────────────────────────────────────────────────────

/** The session the plan prescribes in each state. `race_week_tuneup` and
 *  `race` are real `plan_workouts.type` values, not sweep inventions. */
const SESSION_FOR: Record<RunnerState, { type: string; subLabel: string | null; mi: number }> = {
  off_season:         { type: 'easy',             subLabel: null,          mi: 5 },
  base:               { type: 'easy',             subLabel: null,          mi: 6 },
  build:              { type: 'threshold',        subLabel: 'THRESHOLD',   mi: 9 },
  peak:               { type: 'long',             subLabel: 'MEDIUM-LONG', mi: 20 },
  taper:              { type: 'easy',             subLabel: null,          mi: 4 },
  race_week:          { type: 'race_week_tuneup', subLabel: 'TUNE-UP',     mi: 5 },
  race_day:           { type: 'race',             subLabel: null,          mi: 26.2 },
  hours_after_race:   { type: 'race',             subLabel: null,          mi: 26.2 },
  post_race_recovery: { type: 'recovery',         subLabel: null,          mi: 3 },
  injury_flare:       { type: 'rest',             subLabel: null,          mi: 0 },
  return_ladder:      { type: 'easy',             subLabel: null,          mi: 0.8 },
  illness:            { type: 'rest',             subLabel: null,          mi: 0 },
  week_off:           { type: 'rest',             subLabel: null,          mi: 0 },
  no_goal:            { type: 'easy',             subLabel: null,          mi: 5 },
  first_week_signup:  { type: 'easy',             subLabel: null,          mi: 3 },
  plan_elapsed:       { type: 'easy',             subLabel: null,          mi: 6 },
  coached:            { type: 'easy',             subLabel: null,          mi: 6 },
};

const PHASE_FOR: Record<RunnerState, string | null> = {
  off_season: null, base: 'Base', build: 'Quality', peak: 'Quality', taper: 'Taper',
  race_week: 'Race-specific', race_day: 'Race-specific', hours_after_race: 'Recovery',
  post_race_recovery: 'Recovery', injury_flare: null, return_ladder: null, illness: null,
  week_off: null, no_goal: null, first_week_signup: 'Base', plan_elapsed: 'Base', coached: 'Base',
};

/** `training_plans.mode` for the active plan in each state. Null means there
 *  is no active plan at all, which `resolveBlockState` reads as 'no-plan'. */
const PLAN_MODE_FOR: Record<RunnerState, string | null> = {
  off_season: null, base: 'race-prep', build: 'race-prep', peak: 'race-prep',
  taper: 'race-prep', race_week: 'race-prep', race_day: 'race-prep',
  hours_after_race: 'recovery', post_race_recovery: 'recovery',
  injury_flare: 'race-prep', return_ladder: 'recovery', illness: 'race-prep',
  week_off: 'race-prep', no_goal: null, first_week_signup: 'race-prep',
  plan_elapsed: 'race-prep', coached: 'race-prep',
};

/** The runner's execution, per data shape. This is where production's awkward
 *  rows live — see the survey counts in surface-sweep-matrix.ts. */
interface RunShape {
  distanceMi: number;
  /** Elapsed seconds from the device that ran the session. Null on the 71
   *  production rows that carry a distance and no clock at all. */
  durationSec: number | null;
  paceSPerMi: number | null;
  avgHr: number | null;
  indoor: boolean;
  speedMph: number | null;
  inclinePct: number | null;
  /** null on the shoe rows whose `mileage` column is NULL. */
  shoeMi: number | null;
  splitCount: number;
  repCount: number | null;
}

const RUN_FOR: Record<DataShape, RunShape> = {
  nominal:            { distanceMi: 8.0,  durationSec: 4200, paceSPerMi: 525, avgHr: 148, indoor: false, speedMph: null, inclinePct: null, shoeMi: 212, splitCount: 8, repCount: null },
  no_gps:             { distanceMi: 6.0,  durationSec: 3180, paceSPerMi: 530, avgHr: 144, indoor: false, speedMph: null, inclinePct: null, shoeMi: 212, splitCount: 6, repCount: null },
  treadmill:          { distanceMi: 9.01, durationSec: 4860, paceSPerMi: 539, avgHr: 151, indoor: true,  speedMph: 6.7,  inclinePct: 1.0,  shoeMi: 45,  splitCount: 9, repCount: null },
  no_hr:              { distanceMi: 7.2,  durationSec: 3900, paceSPerMi: 542, avgHr: null, indoor: false, speedMph: null, inclinePct: null, shoeMi: 212, splitCount: 7, repCount: null },
  reps_nine:          { distanceMi: 9.5,  durationSec: 4650, paceSPerMi: 489, avgHr: 162, indoor: false, speedMph: null, inclinePct: null, shoeMi: 88,  splitCount: 9, repCount: 9 },
  reps_none:          { distanceMi: 9.5,  durationSec: 4650, paceSPerMi: 489, avgHr: 162, indoor: false, speedMph: null, inclinePct: null, shoeMi: 88,  splitCount: 0, repCount: null },
  splits_unreliable:  { distanceMi: 10.2, durationSec: 5400, paceSPerMi: 529, avgHr: 149, indoor: false, speedMph: null, inclinePct: null, shoeMi: 212, splitCount: 3, repCount: null },
  // Two ingests disagree: the watch clock says 8:45/mi, Strava's moving time
  // says 7:30/mi. Believable as a paused run — printed together they still do
  // not multiply out, which is the ELAPSED_VS_MOVING observation.
  merge_disagree:     { distanceMi: 12.0, durationSec: 6300, paceSPerMi: 450, avgHr: 147, indoor: false, speedMph: null, inclinePct: null, shoeMi: 212, splitCount: 12, repCount: null },
  race_no_goal:       { distanceMi: 13.1, durationSec: 6113, paceSPerMi: 467, avgHr: 168, indoor: false, speedMph: null, inclinePct: null, shoeMi: 30,  splitCount: 13, repCount: null },
  race_null_distance: { distanceMi: 6.21, durationSec: 2760, paceSPerMi: 444, avgHr: 165, indoor: false, speedMph: null, inclinePct: null, shoeMi: 30,  splitCount: 6, repCount: null },
  two_rows_one_date:  { distanceMi: 8.0,  durationSec: 4200, paceSPerMi: 525, avgHr: 148, indoor: false, speedMph: null, inclinePct: null, shoeMi: 212, splitCount: 8, repCount: null },
  zero_runs:          { distanceMi: 0,    durationSec: null, paceSPerMi: null, avgHr: null, indoor: false, speedMph: null, inclinePct: null, shoeMi: null, splitCount: 0, repCount: null },
  one_run:            { distanceMi: 3.1,  durationSec: 1680, paceSPerMi: 542, avgHr: 150, indoor: false, speedMph: null, inclinePct: null, shoeMi: 3,   splitCount: 3, repCount: null },
  hundred_mile_week:  { distanceMi: 22.0, durationSec: 11400, paceSPerMi: 518, avgHr: 152, indoor: false, speedMph: null, inclinePct: null, shoeMi: 640, splitCount: 22, repCount: null },
  walk_run_08:        { distanceMi: 0.8,  durationSec: 720,  paceSPerMi: 900, avgHr: 118, indoor: false, speedMph: null, inclinePct: null, shoeMi: 0,   splitCount: 1, repCount: null },
  // THE REAL ROW. 2026-08-23: durationSec 5298 over 11.01 mi is 8:01/mi, the
  // watch's own clock. paceSPerMi 217 is 3:37/mi, off a Strava moving time of
  // 2389s that implies 16.6 mph for eleven miles. `runPaceSecPerMi` now
  // rejects it at the read; this cell proves the composers do too.
  bad_merge_337:      { distanceMi: 11.01, durationSec: 5298, paceSPerMi: 217, avgHr: 141, indoor: false, speedMph: null, inclinePct: null, shoeMi: 212, splitCount: 11, repCount: null },
  no_clock:           { distanceMi: 9.14, durationSec: null, paceSPerMi: null, avgHr: 146, indoor: false, speedMph: null, inclinePct: null, shoeMi: 212, splitCount: 0, repCount: null },
  shoe_unknown_mi:    { distanceMi: 6.0,  durationSec: 3180, paceSPerMi: 530, avgHr: 144, indoor: false, speedMph: null, inclinePct: null, shoeMi: null, splitCount: 6, repCount: null },
  shoe_zero_mi:       { distanceMi: 6.0,  durationSec: 3180, paceSPerMi: 530, avgHr: 144, indoor: false, speedMph: null, inclinePct: null, shoeMi: 0,    splitCount: 6, repCount: null },
  sublabel_prescription: { distanceMi: 9.5, durationSec: 4650, paceSPerMi: 489, avgHr: 162, indoor: false, speedMph: null, inclinePct: null, shoeMi: 88, splitCount: 9, repCount: 4 },
  sublabel_zone_letter:  { distanceMi: 9.5, durationSec: 4650, paceSPerMi: 489, avgHr: 162, indoor: false, speedMph: null, inclinePct: null, shoeMi: 88, splitCount: 9, repCount: 4 },
};

const REFUSAL_STATES: ReadonlySet<RunnerState> = new Set(['injury_flare', 'illness', 'week_off', 'off_season', 'no_goal', 'coached']);

/** A prescription shaped by the cell — nine phases, none, or the ordinary
 *  warm/work/cool the generator writes. */
function prescriptionFor(cell: Cell): V5PrescriptionLike | null {
  const s = SESSION_FOR[cell.state];
  if (s.mi <= 0) return null;
  if (cell.shape === 'reps_none') {
    return { type: s.type, headline: 'Intervals', why: 'The hard sessions do the work.', steps: [], total_mi: s.mi };
  }
  if (cell.shape === 'reps_nine') {
    return {
      type: s.type, headline: 'Intervals', why: 'The hard sessions do the work.',
      total_mi: s.mi,
      steps: [
        { label: 'Warm up', distance_mi: 2, note: 'Easy.' },
        ...Array.from({ length: 9 }, (_, i) => ({
          label: `Rep ${i + 1}`, reps: 1, rep_distance_mi: 0.5,
          pace_target: '5:52/mi', note: 'Hold the pace.',
          recovery: { duration: '90s', note: 'Jog.' },
        })),
        { label: 'Cool down', distance_mi: 2, note: 'Easy.' },
      ],
    };
  }
  return {
    type: s.type, headline: s.subLabel ?? 'Easy',
    why: 'The week\'s total matters more than any single run.',
    total_mi: s.mi,
    steps: [{ label: 'Run', distance_mi: s.mi, pace_target: '8:50/mi', note: 'Keep it conversational.' }],
  };
}

/** The week strip. `two_rows_one_date` puts two rows on one date, which 44
 *  production plan-days actually carry. */
function weekStripFor(cell: Cell): V5TodayContext['weekStripDays'] {
  const b = BOUNDARY_DATES[cell.boundary];
  const s = { ...SESSION_FOR[cell.state], subLabel: subLabelFor(cell) };
  const base = Array.from({ length: 7 }, (_, i) => {
    const iso = addDays(b.todayISO, i - 3);
    const isToday = i === 3;
    return {
      id: `date:${iso}`, dateISO: iso,
      plannedType: isToday ? s.type : (i % 3 === 0 ? 'rest' : 'easy'),
      subLabel: isToday ? s.subLabel : null,
      isToday, isRest: !isToday && i % 3 === 0, isDone: i < 3,
    };
  });
  if (cell.shape === 'two_rows_one_date') {
    base.push({ ...base[3], id: `date:${base[3].dateISO}#2`, plannedType: 'easy', subLabel: null, isToday: true });
  }
  return base;
}

const DAY_MS = 86_400_000;
/** Noon-UTC anchored, the same arithmetic block-state.ts uses, so a DST
 *  transition cannot move a day. */
function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso + 'T12:00:00Z') + days * DAY_MS).toISOString().slice(0, 10);
}

function recentRunFor(cell: Cell): V5TodayContext['recentRun'] {
  const r = RUN_FOR[cell.shape];
  if (r.distanceMi <= 0) return null;
  return {
    runId: 'run-1',
    distanceMi: r.distanceMi,
    durationSec: r.durationSec,
    paceSPerMi: r.paceSPerMi,
    avgHr: r.avgHr,
    indoor: r.indoor,
    speedMph: r.speedMph,
    inclinePct: r.inclinePct,
    askedPaceSPerMi: cell.state === 'race_day' ? null : 537,
    // ASKED DISTANCE, varied deliberately rather than nulled. A fixture that
    // sets a new field to null everywhere adds a column to the matrix and
    // exercises nothing — the sweep would report thousands of fresh cells and
    // have tested the absence branch alone. Three readings are covered here:
    // the two numbers agreeing, a genuine overshoot, and an honest absence on
    // a day nothing was prescribed.
    //
    // The overshoot is not invented: `bad_merge_337` IS his 2026-08-23 row,
    // and the prescription that day was 5 miles against the 11.01 he ran. So
    // that cell now carries both of that row's defects at once — a pace its
    // own clock disproves, and a distance row where asked and ran differ by
    // more than double.
    askedMi: cell.state === 'off_season' || cell.state === 'no_goal'
      ? null
      : (cell.shape === 'bad_merge_337' ? 5 : r.distanceMi),
    // The four recap strings that were composed, returned, decoded and never
    // drawn. Non-empty on the nominal path so a rule that asserts they REACH
    // a surface can fail if they stop; null/[] where deriveRecap genuinely
    // returns nothing, so the absence branch stays covered too.
    facts: r.avgHr != null ? ['Your heart rate held steady through the second half.'] : [],
    win: cell.shape === 'zero_runs' ? null : 'Longest run of the block so far.',
    conditionsNote: r.indoor ? null : 'It was 78 degrees and humid.',
    coachTip: cell.state === 'race_week' ? 'Keep the next two days short.' : null,
    askedHrCap: r.avgHr != null ? 146 : null,
    askedHrIsHardCap: cell.state === 'base' || cell.state === 'peak',
    effortAsked: { lo: 2, hi: 4 },
    effortLogged: cell.shape === 'zero_runs' ? null : 3,
    verdict: 'Ran it as asked.',
    zoneShares: r.avgHr != null ? [0.1, 0.6, 0.2, 0.1, 0] : null,
    zoneTarget: 2,
    zoneTargets: cell.state === 'race_day' ? [4, 5] : null,
    elevationSamples: r.indoor ? null : [10, 22, 31, 18],
    elevGainFt: r.indoor ? null : 240,
    elevGainMeasured: true,
    hrMax: 158, cadenceAvg: 172, tempF: 61, workoutType: 'easy', hrAvgWork: null, cadenceAvgWork: null, paceWork: null,
    routeSplits: [],
    routePhases: [],
    hrZones: [],
    paceBand: null,
    routePolyline: null,
    weekDoneMi: cell.shape === 'hundred_mile_week' ? 100.4 : 24.2,
    weekPlannedMi: cell.state === 'off_season' || cell.state === 'no_goal' ? null : 42,
    // `shoeMi: null` is the production shape whose display asserted a zero.
    shoeOptions: [{ id: 's1', name: 'Vomero Premium', mi: 62.7 }, { id: 's2', name: 'Vaporfly 3', mi: 88 }],
    shoeWorn: { id: 'shoe-1', name: 'Endorphin Speed 4', mi: r.shoeMi as number },
    niggleFlagged: cell.state === 'return_ladder' ? 'Left calf' : null,
  };
}

/**
 * The day's `plan_workouts.sub_label`, which is written by two different kinds
 * of author. Some rows carry a runner-facing NAME ("THRESHOLD", "FIELD TEST").
 * Others carry the whole prescription, derived from the spec by
 * `subLabelFromSpec` (lib/training/expand-spec.ts) — and a third kind carries a
 * bare pace-zone letter.
 *
 * All three reach `V5Panel.type`, which the phone draws at 56pt Archivo with
 * lineLimit(1) and a 0.5 minimum scale factor. Only the first is a headline.
 *
 * These two cells exist because a MUTATION TEST found the gap: deleting the
 * `subLabelIsName` guard from `displayTypeFor` — reverting it to the exact
 * behaviour that shipped "3x1MI @ T PACE, 6…" as a day's headline — changed
 * nothing the sweep could see, because every sub_label in the matrix was
 * already a short clean name. A sweep only covers the shapes it feeds.
 */
function subLabelFor(cell: Cell): string | null {
  if (cell.shape === 'sublabel_prescription') return '3x1mi @ T pace, 60s jog';
  if (cell.shape === 'sublabel_zone_letter') return 'T';
  return SESSION_FOR[cell.state].subLabel;
}

function todayCtxFor(cell: Cell, withRun: boolean): V5TodayContext {
  const b = BOUNDARY_DATES[cell.boundary];
  const s = { ...SESSION_FOR[cell.state], subLabel: subLabelFor(cell) };
  const st = cell.state;
  return {
    todayISO: b.todayISO,
    isSteppedDay: b.stepped,
    // `no_goal` and `coached` are the two the phone declines outright.
    raceMode: st !== 'no_goal' && st !== 'coached',
    todayPlan: s.mi > 0 || st === 'race_day'
      ? { type: s.type, subLabel: s.subLabel, distanceMi: s.mi, originalType: null, originalSubLabel: null }
      : null,
    weekLine: st === 'off_season' ? null : 'Week 6 of 16',
    phaseLine: PHASE_FOR[st],
    weekStripDays: weekStripFor(cell),
    prescription: withRun ? null : prescriptionFor(cell),
    weatherKicker: withRun ? null : '72°F, light wind',
    paceBandStat: withRun ? null : '8:50-9:35/mi',
    hrCapStat: withRun ? null : '146 bpm',
    effortStat: withRun ? null : '2-4',
    why: whyFor(cell) || null,
    whereYouAre: [{ id: 'readiness', label: 'Readiness', sub: 'Sleep 7h 10m, RHR 46', value: { text: '62 of 100', modelled: false }, action: null }],
    beforeYouGo: withRun ? [] : [{ id: 'shoe', label: 'Endorphin Speed 4', sub: '212 mi on them', value: null, action: 'change_shoe' }],
    paceNote: null,
    raceDay: st === 'race_day',
    recentRun: withRun ? recentRunFor(cell) : null,
    weekOff: st === 'week_off'
      ? { reason: 'Away from the plan', fromISO: b.todayISO, toISO: addDays(b.todayISO, 6), nextUp: { label: 'Monday, Easy 4 mi', sub: '' } }
      : null,
    offSeason: st === 'off_season'
      ? { sinceLastRace: '3 weeks since Big Sur', silenceReason: 'No block is written. Running is optional, and nothing here is measured against a goal.', weeklyRange: '25 to 35 miles a week' }
      : null,
    injury: st === 'injury_flare'
      ? { area: 'Left calf', since: 'Flagged 2 days ago', verdict: 'Rest, not run.', whatChanged: [], checkIn: [], returnAvailable: false }
      : null,
    sick: st === 'illness'
      ? { symptoms: ['Head cold', 'Fatigue'], hasFever: false, since: 'Flagged today', verdict: 'Rest, not run.', checkIn: [] }
      : null,
  };
}

function whyFactsFor(cell: Cell): WhyFacts {
  const st = cell.state;
  const phase = PHASE_FOR[st];
  return {
    phase: phase ? phase.toUpperCase() : null,
    lastRaceName: st === 'hours_after_race' || st === 'post_race_recovery' ? 'Americas Finest City' : null,
    daysSinceRace: st === 'hours_after_race' ? 0 : st === 'post_race_recovery' ? 8 : null,
    dayNote: SESSION_FOR[st].mi > 0 ? 'Conversational pace · should feel like nothing.' : 'Off. Still recovering.',
    // The generator authors a phase rationale on every block. It is the only
    // input `composeWhy` accepts and never reads — this cell is what makes
    // that visible rather than theoretical.
    phaseRationale: 'Absorb the race before the next block opens.',
    fallback: cell.shape === 'zero_runs' ? null : 'Easy day. The week\'s volume is what matters.',
  };
}

const whyFor = (cell: Cell) => composeWhy(whyFactsFor(cell));

function recapInputFor(cell: Cell): RecapInput | null {
  const r = RUN_FOR[cell.shape];
  if (r.distanceMi <= 0) return null;
  const s = SESSION_FOR[cell.state];
  const type = (['easy', 'long', 'recovery', 'shakeout', 'tempo', 'threshold', 'intervals',
    'fartlek', 'progression', 'race_week_tuneup', 'race', 'rest', 'unplanned'] as const)
    .includes(s.type as never) ? (s.type as RecapInput['type']) : 'easy';
  const phaseMap: Record<string, RecapInput['phase']> = {
    Base: 'BASE', Quality: 'BUILD', Taper: 'TAPER', 'Race-specific': 'PEAK', Recovery: 'RECOVERY',
  };
  return {
    type,
    phase: PHASE_FOR[cell.state] ? (phaseMap[PHASE_FOR[cell.state] as string] ?? null) : 'OFF',
    plannedMi: s.mi,
    plannedPaceSPerMi: 537,
    plannedHrCap: 146,
    actualMi: r.distanceMi,
    actualPaceSPerMi: r.paceSPerMi,
    actualDurationSec: r.durationSec,
    actualAvgHr: r.avgHr,
    actualMaxHr: r.avgHr != null ? r.avgHr + 18 : null,
    repCount: r.repCount,
    splits: Array.from({ length: r.splitCount }, (_, i) => ({
      mile: i + 1,
      paceSPerMi: r.paceSPerMi != null ? r.paceSPerMi + (i % 3) * 4 : null,
      avgHr: r.avgHr != null ? r.avgHr + i : null,
    })),
    weather: { tempF: 72, dewpointF: 58, humidityPct: 60, windMph: 4, conditions: 'clear' },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Auditors — the three-outcome rule, made mechanical
// ─────────────────────────────────────────────────────────────────────────

let CHECKS = 0;
const check = () => { CHECKS += 1; };

const REFUSAL_WIRE_STATES = new Set(['not_on_phone_yet', 'injury_flare', 'sick', 'week_off', 'off_season']);
const CONTENT_WIRE_STATES = new Set(['before_run', 'after_run', 'race_day']);

/** Engine shorthand in the display register. Mirrors `PRESCRIPTION_SHAPE` in
 *  v5-today.ts — the headline draws at 56pt with `lineLimit(1)`, so a
 *  prescription there truncates mid-number. */
const PRESCRIPTION_SHAPE = /[@×+/]|\b(?:WU|CD)\b|\d\s*(?:mi|km|min|sec)\b|·|\d\s*x\s*\d/i;
const DISPLAY_NAME_MAX = 16;

function auditToday(out: V5Today, ctx: V5TodayContext, cell: Cell): Finding[] {
  const f: Finding[] = [];
  const add = (rule: RuleId, detail: string, where: string) => f.push({ rule, detail, where });

  // ── every string in the payload ──────────────────────────────────────
  walkStrings(out, (path, value) => {
    check();
    if (isBadText(value)) add('BAD_TEXT', `${path} = ${JSON.stringify(value)}`, path);
    const v = voiceBreak(value);
    if (v) add('VOICE', `${path} carried ${JSON.stringify(v)} in ${JSON.stringify(value)}`, path);
  });

  // The interpunct is a field separator. Legal on a stats plate, never in the
  // one field this app writes as prose.
  check();
  if (out.why && out.why.includes('·')) add('VOICE', `why is prose and carried an interpunct: ${JSON.stringify(out.why)}`, 'why');

  // ── every number's provenance ────────────────────────────────────────
  forEachNumber(out, (path, n) => {
    check();
    if (typeof n.modelled !== 'boolean') add('MODELLED_FLAG_SHAPE', `${path}.modelled = ${JSON.stringify(n.modelled)}`, path);
  });

  // A goal-derived pace band and a zone-model HR ceiling are not reads of
  // anything that happened. A logged distance, clock and heart rate are.
  for (const st of out.panel.stats) {
    check();
    if (['Pace band', 'HR ceiling', 'Effort'].includes(st.label) && st.value.text != null && st.value.modelled !== true) {
      add('MODELLED_UNDERMARKED', `panel stat ${st.label} = ${st.value.text} stamped measured`, 'panel.stats');
    }
    if (['Distance', 'Time', 'Pace'].includes(st.label) && st.value.text != null && st.value.modelled !== false) {
      add('MODELLED_OVERMARKED', `panel stat ${st.label} = ${st.value.text} stamped modelled`, 'panel.stats');
    }
  }
  for (const st of out.onTheBelt ?? []) {
    check();
    if (st.value.text != null && st.value.modelled !== true) {
      add('MODELLED_UNDERMARKED', `belt ${st.label} = ${st.value.text} stamped measured — nothing on a treadmill measured it`, 'onTheBelt');
    }
  }

  // ── orphan sections ──────────────────────────────────────────────────
  check();
  if (out.why !== null && out.why.trim() === '') {
    add('ORPHAN_SECTION', 'why is present on the wire and empty — the header draws over blank space', 'why');
  }
  check();
  if (out.verdict !== null && out.verdict.trim() === '') add('ORPHAN_SECTION', 'verdict present and empty', 'verdict');
  check();
  if (CONTENT_WIRE_STATES.has(out.state) && out.panel.type.trim() === '') {
    add('ORPHAN_SECTION', `state ${out.state} shipped an empty 56pt headline`, 'panel.type');
  }
  for (const [name, rows] of [['whereYouAre', out.whereYouAre], ['beforeYouGo', out.beforeYouGo],
    ['askedVsRan', out.askedVsRan], ['whatThisDidToTheWeek', out.whatThisDidToTheWeek]] as [string, V5Row[]][]) {
    for (const r of rows) {
      check();
      if (!r.label || r.label.trim() === '') add('ORPHAN_SECTION', `${name} row ${r.id} has no label`, name);
    }
  }
  for (const g of out.groups) {
    check();
    if (g.steps.length === 0) add('ORPHAN_SECTION', `group ${g.id} "${g.title}" has no steps`, 'groups');
    check();
    if (!g.title || g.title.trim() === '') add('ORPHAN_SECTION', `group ${g.id} has no title`, 'groups');
    for (const s of g.steps) {
      check();
      if (!s.main || s.main.trim() === '') add('ORPHAN_SECTION', `step ${s.id} has no line`, 'groups');
    }
  }

  // ── refusals ─────────────────────────────────────────────────────────
  if (REFUSAL_WIRE_STATES.has(out.state)) {
    const reason =
      out.state === 'not_on_phone_yet' ? out.notOnPhoneYet
      : out.state === 'injury_flare' ? out.injury?.verdict
      : out.state === 'sick' ? out.sick?.verdict
      : out.state === 'week_off' ? out.weekOff?.coachLine
      : out.offSeason?.silenceReason;
    check();
    if (!reason || reason.trim() === '') {
      add('REFUSAL_UNEXPLAINED', `state ${out.state} shipped no stated reason — a blank screen, not a refusal`, out.state);
    }
    // A refusal that also ships prescription content drew half a screen it
    // had already declined to draw.
    check();
    if (out.groups.length > 0 || out.beforeYouGo.length > 0 || out.askedVsRan.length > 0 || out.panel.stats.length > 0) {
      add('REFUSAL_LEAKED_CONTENT',
        `state ${out.state} shipped groups=${out.groups.length} beforeYouGo=${out.beforeYouGo.length} askedVsRan=${out.askedVsRan.length} stats=${out.panel.stats.length}`,
        out.state);
    }
  }

  // ── the headline is a NAME ───────────────────────────────────────────
  check();
  if (out.panel.type.length > DISPLAY_NAME_MAX) {
    add('HEADLINE_IS_SHORTHAND', `panel.type ${JSON.stringify(out.panel.type)} is ${out.panel.type.length} chars — it truncates at 56pt`, 'panel.type');
  }
  check();
  if (PRESCRIPTION_SHAPE.test(out.panel.type)) {
    add('HEADLINE_IS_SHORTHAND', `panel.type ${JSON.stringify(out.panel.type)} is a prescription, not a name`, 'panel.type');
  }

  // ── the week strip's arithmetic, across both DST transitions ─────────
  //
  // Every strip day recomputes its own letter and number from its own ISO,
  // anchored at noon UTC. A local-midnight parse anywhere in this chain moves
  // a day by one in the wrong timezone, and moves it TWICE across a DST
  // boundary. Recomputing independently and requiring equality is what turns
  // "the arithmetic is noon-UTC anchored for exactly this reason" from a claim
  // in a comment into something the build checks.
  const DOW_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  for (const d of out.weekStrip) {
    const at = Date.parse(d.dateISO + 'T12:00:00Z');
    check();
    if (!Number.isFinite(at)) {
      add('DAY_ARITHMETIC', `strip day ${d.id} carries an unparseable date ${JSON.stringify(d.dateISO)}`, 'weekStrip');
      continue;
    }
    const day = new Date(at);
    check();
    if (d.letter !== DOW_LETTER[day.getUTCDay()] || d.number !== String(day.getUTCDate())) {
      add('DAY_ARITHMETIC',
        `strip day ${d.dateISO} is drawn as ${d.letter}${d.number} but noon-UTC says ${DOW_LETTER[day.getUTCDay()]}${day.getUTCDate()}`,
        'weekStrip');
    }
  }
  // The distinct days the strip covers must be consecutive — no day lost to a
  // 23-hour day, none duplicated by a 25-hour one.
  const days = [...new Set(out.weekStrip.map((d) => d.dateISO))].sort();
  for (let i = 1; i < days.length; i += 1) {
    check();
    const gap = (Date.parse(days[i] + 'T12:00:00Z') - Date.parse(days[i - 1] + 'T12:00:00Z')) / 86_400_000;
    if (Math.round(gap) !== 1 || Math.abs(gap - Math.round(gap)) > 0.001) {
      add('DAY_ARITHMETIC', `${days[i - 1]} to ${days[i]} is ${gap} days apart in the strip`, 'weekStrip');
    }
  }

  // ── a retired surface may not come back ──────────────────────────────
  // The overnight-convergence story is deleted, not defaulted off
  // (docs/PLAN_SIMPLIFICATION_DOCTRINE.md). The wire types no longer name it,
  // so TypeScript stops the obvious route back; these two checks are the route
  // TypeScript cannot see — a payload widened with an untyped spread, or a
  // `state` that has been loosened to a bare string.
  const wire = out as unknown as Record<string, unknown>;
  for (const field of RETIRED_WIRE_FIELDS) {
    check();
    if (field in wire) {
      add('RETIRED_SURFACE', `V5Today carried the retired field ${JSON.stringify(field)}`, field);
    }
  }
  check();
  if ((RETIRED_WIRE_STATES as readonly string[]).includes(out.state as string)) {
    add('RETIRED_SURFACE', `V5Today.state was the retired ${JSON.stringify(out.state)}`, 'state');
  }

  // ── a stepped-to day is not in the present tense ─────────────────────
  check();
  if (ctx.isSteppedDay && out.whereYouAre.length > 0) {
    add('STEPPED_PRESENT_TENSE', `${out.whereYouAre.length} present-tense rows survived onto a stepped-to day`, 'whereYouAre');
  }

  // ── no number contradicts another on the same screen ─────────────────
  const dist = parsePrinted(out.panel.stats.find((s) => s.label === 'Distance')?.value.text);
  const time = parsePrinted(out.panel.stats.find((s) => s.label === 'Time')?.value.text);
  const pace = parsePrinted(out.panel.stats.find((s) => s.label === 'Pace')?.value.text);
  if (dist && time && pace && dist.value > 0) {
    const implied = time.value / dist.value;
    check();
    // Moving time cannot exceed elapsed, so a stored pace implies a paused
    // share. Above half it is not a pause — it is a bad number, and the panel
    // is printing a pace its own clock disproves.
    if (pace.value < implied * MAX_PAUSED_SHARE) {
      add('SELF_CONTRADICTION',
        `panel prints ${dist.value} mi in ${time.value}s (${Math.round(implied)}s/mi) beside a pace of ${pace.value}s/mi — impossible`,
        'panel.stats');
    } else if (Math.abs(pace.value - implied) / implied > 0.02) {
      add('ELAPSED_VS_MOVING',
        `panel prints ${Math.round(implied)}s/mi of elapsed clock beside a ${pace.value}s/mi pace`,
        'panel.stats');
    }
  }
  // The same run's pace is printed in two places. They must be the same string.
  const panelPace = out.panel.stats.find((s) => s.label === 'Pace')?.value.text ?? null;
  const rowPace = out.askedVsRan.find((r) => r.id === 'pace')?.value?.text ?? null;
  if (out.state === 'after_run') {
    check();
    // ABSENCE IS NOT CONTRADICTION.
    //
    // The asked-vs-ran table no longer carries a pace row — the poster's top
    // line is the one place a pace appears, which is what this rule was
    // written to enforce in the first place. Two surfaces cannot disagree when
    // only one of them speaks. The rule still fires the moment both do.
    if (rowPace != null && panelPace !== rowPace) {
      add('SELF_CONTRADICTION', `panel pace ${JSON.stringify(panelPace)} and asked-vs-ran pace ${JSON.stringify(rowPace)} on one screen`, 'panel.stats/askedVsRan');
    }
  }

  // ── a default is a confident assertion ───────────────────────────────
  const shoeIn = ctx.recentRun?.shoeWorn?.mi;
  check();
  if (out.shoesWorn && (shoeIn == null || !Number.isFinite(shoeIn)) && /\b0 mi\b/.test(out.shoesWorn.sub ?? '')) {
    add('ZERO_FOR_UNKNOWN',
      `shoe mileage is unknown and the row says ${JSON.stringify(out.shoesWorn.sub)} — a new shoe and an unknown one read identically`,
      'shoesWorn.sub');
  }
  // …and the other direction. A figure the engine HAS must be printed, zero
  // included. `shoes.mileage` is NOT NULL DEFAULT 0, so a brand-new shoe
  // genuinely sits at zero and "Mileage not tracked" would be a worse lie than
  // the one it replaced.
  check();
  if (out.shoesWorn && shoeIn != null && Number.isFinite(Number(shoeIn))
      && !/\d/.test(out.shoesWorn.sub ?? '')) {
    add('DECLINED_A_KNOWN_VALUE',
      `shoe mileage is known (${shoeIn}) and the row printed ${JSON.stringify(out.shoesWorn.sub)}`,
      'shoesWorn.sub');
  }

  /* THE WEEKLY PERCENTAGE MAY NOT COME BACK (2026-09-02).
   *
   * This used to guard the `week-total` row against implying a share of an
   * unknown planned total. The row is deleted — the post-run brief's DELETE
   * list, "weekly mileage percentage as the meaning of a run" — and a check
   * whose target no longer exists is a check that has quietly stopped meaning
   * anything (Rule 18 clause 4). So it is inverted into a ratchet: the row
   * reappearing is itself the finding, whatever value it carries. */
  const weekRow = out.whatThisDidToTheWeek.find((r) => r.id === 'week-total');
  check();
  if (weekRow) {
    add('ZERO_FOR_UNKNOWN',
      'the weekly mileage percentage is back under "what this did"; what a run changed is `postRun`',
      'whatThisDidToTheWeek');
  }

  // ── absent is not the same as unreadable ─────────────────────────────
  if (out.state === 'after_run' && out.askedVsRan.length > 0) {
    check();
    const readable = out.askedVsRan.filter((r) => r.value?.text != null).length;
    if (readable === 0) {
      add('UNREADABLE_FOR_ABSENT',
        'every asked-vs-ran row shipped a null value, so the section draws three fault-red dashes for a run that simply carries no clock',
        'askedVsRan');
    }
  }
  return f;
}

/** Walk every `V5Number` in a payload — an object carrying a `text` key. */
function forEachNumber(root: unknown, visit: (path: string, n: { text: unknown; modelled: unknown }) => void, path = '$'): void {
  if (Array.isArray(root)) { root.forEach((v, i) => forEachNumber(v, visit, `${path}[${i}]`)); return; }
  if (root && typeof root === 'object') {
    const o = root as Record<string, unknown>;
    if ('text' in o && 'modelled' in o) visit(path, o as never);
    for (const [k, v] of Object.entries(o)) forEachNumber(v, visit, `${path}.${k}`);
  }
}

function auditWhy(out: string, facts: WhyFacts, cell: Cell): Finding[] {
  const f: Finding[] = [];
  const add = (rule: RuleId, detail: string) => f.push({ rule, detail, where: 'composeWhy' });
  check();
  if (isBadText(out)) add('BAD_TEXT', JSON.stringify(out));
  check();
  const v = voiceBreak(out);
  if (v) add('VOICE', `carried ${JSON.stringify(v)} in ${JSON.stringify(out)}`);
  check();
  if (out.includes('·')) add('VOICE', `interpunct survived into prose: ${JSON.stringify(out)}`);
  // The section had something to say and said nothing.
  check();
  const hadInput = [facts.phase, facts.dayNote, facts.fallback, facts.phaseRationale].some((x) => (x ?? '').trim() !== '');
  if (hadInput && out.trim() === '') {
    add('ORPHAN_SECTION', `every input was authored and composeWhy returned empty: ${JSON.stringify(facts)}`);
  }
  // Two sentences at most, and each one a sentence.
  check();
  if (out.trim() !== '' && !/[.?]$/.test(out.trim())) add('ORPHAN_SECTION', `not a sentence: ${JSON.stringify(out)}`);
  return f;
}

function auditRecap(out: RecapPayload, input: RecapInput, cell: Cell): Finding[] {
  const f: Finding[] = [];
  const add = (rule: RuleId, detail: string, where: string) => f.push({ rule, detail, where });
  walkStrings(out, (path, value) => {
    check();
    if (isBadText(value)) add('BAD_TEXT', `${path} = ${JSON.stringify(value)}`, path);
    const v = voiceBreak(value);
    if (v) add('VOICE', `${path} carried ${JSON.stringify(v)} in ${JSON.stringify(value)}`, path);
  });
  check();
  if (!out.verdict || out.verdict.trim() === '') add('ORPHAN_SECTION', 'recap shipped no verdict', 'verdict');
  for (const fact of out.facts) {
    check();
    if (!fact || fact.trim() === '') add('ORPHAN_SECTION', 'recap shipped an empty fact', 'facts');
  }
  // The recap may not repeat a pace the run's own clock disproves.
  if (input.actualPaceSPerMi != null && input.actualDurationSec != null && input.actualMi > 0) {
    const implied = input.actualDurationSec / input.actualMi;
    if (input.actualPaceSPerMi < implied * MAX_PAUSED_SHARE) {
      const printed = `${Math.floor(input.actualPaceSPerMi / 60)}:${String(Math.round(input.actualPaceSPerMi % 60)).padStart(2, '0')}/mi`;
      const prose = [out.verdict, ...out.facts].join(' ');
      check();
      if (prose.includes(printed)) {
        add('SELF_CONTRADICTION',
          `recap printed ${printed} for a run whose own clock says ${Math.round(implied)}s/mi`, 'verdict/facts');
      }
    }
  }
  return f;
}

function auditBlock(out: BlockState, ramp: RampScope, today: string): Finding[] {
  const f: Finding[] = [];
  const add = (rule: RuleId, detail: string, where: string) => f.push({ rule, detail, where });
  walkStrings({ out, ramp }, (path, value) => {
    check();
    if (isBadText(value)) add('BAD_TEXT', `${path} = ${JSON.stringify(value)}`, path);
  });
  check();
  if (!ramp.label || ramp.label.trim() === '') add('ORPHAN_SECTION', 'ramp shipped no header label', 'ramp.label');
  check();
  if (ramp.blockRunsToRace === out.betweenBlocks) {
    add('SELF_CONTRADICTION', `ramp says blockRunsToRace=${ramp.blockRunsToRace} while block says betweenBlocks=${out.betweenBlocks}`, 'ramp');
  }
  check();
  if (out.weeksOutAtOpen != null && out.weeksOutAtOpen < 0) {
    add('BAD_TEXT', `weeksOutAtOpen is negative (${out.weeksOutAtOpen})`, 'weeksOutAtOpen');
  }
  // A window that has already closed, presented as the one the runner is in.
  check();
  if (out.betweenBlocks && out.windowEndISO != null && out.windowEndISO < today) {
    add('STALE_WINDOW', `today is ${today} and the current window is stated as ending ${out.windowEndISO}`, 'windowEndISO');
  }
  check();
  if (out.betweenBlocks && out.nextBlockOpensISO != null && out.nextBlockOpensISO < today) {
    add('STALE_WINDOW', `today is ${today} and the next block is stated to open ${out.nextBlockOpensISO}, already past`, 'nextBlockOpensISO');
  }
  return f;
}

function auditRacePlate(out: RacePlate, input: { isPast: boolean; goalSec: number | null; finishSec: number | null; projectedSec: number | null }, cell: Cell): Finding[] {
  const f: Finding[] = [];
  const add = (rule: RuleId, detail: string, where: string) => f.push({ rule, detail, where });
  // The plate's own three fields must agree with each other: a projection is
  // forward-looking and modelled, a finish time is neither.
  check();
  if (out.showsForwardLooking !== out.middleModelled || out.middleModelled !== out.gapModelled) {
    add('SELF_CONTRADICTION',
      `plate says showsForwardLooking=${out.showsForwardLooking} middleModelled=${out.middleModelled} gapModelled=${out.gapModelled}`,
      'racePlate');
  }
  check();
  if (out.gapSec != null && out.middleSec != null && input.goalSec != null
    && out.gapSec !== out.middleSec - input.goalSec) {
    add('SELF_CONTRADICTION', `gap ${out.gapSec} does not equal middle ${out.middleSec} minus goal ${input.goalSec}`, 'gapSec');
  }
  check();
  if (out.middleSec != null && input.isPast && out.middleModelled) {
    add('MODELLED_OVERMARKED', 'a finish time was stamped modelled', 'middleModelled');
  }
  check();
  if (out.middleSec != null && !input.isPast && !out.middleModelled) {
    add('MODELLED_UNDERMARKED', 'a projection was stamped measured', 'middleModelled');
  }
  check();
  if (out.middleSec == null && input.isPast && !out.middleModelled) {
    add('UNREADABLE_FOR_ABSENT',
      'a past race with no logged result ships a null value stamped measured, which the phone paints as fault-red "could not read"',
      'middleSec');
  }
  return f;
}

// ─────────────────────────────────────────────────────────────────────────
// The sweep
// ─────────────────────────────────────────────────────────────────────────

/** At least this many auditor assertions must actually execute. A sweep that
 *  runs zero checks and reports clean is the bug one level up. */
const CHECK_FLOOR = 200_000;

/** One nominal cell per boundary, per runner state. */
const BOUNDARIES_FLOOR = BOUNDARIES.length;

describe('SURFACE conformance sweep', () => {
  it('every runner state × data shape × boundary holds the three-outcome rule', () => {
    const COUNT: Record<string, number> = {};
    const EXAMPLE: Record<string, string> = {};
    // Which BOUNDARIES a finding fires on, printed beside the count. A raw
    // total cannot tell "every cell of one synthetic far-future date" from
    // "the day after a real block ends", and those want different answers.
    const WHERE: Record<string, Set<string>> = {};
    let cells = 0;

    for (const cell of sweepMatrix()) {
      cells += 1;
      const id = cellId(cell);
      const found: Finding[] = [];

      // Today, two ways: before the run and after it. It was four until the
      // overnight-convergence surface was deleted — the other two fed a
      // two-domain and a three-domain readiness verdict through the composer,
      // and there is no longer an input for either.
      for (const withRun of [false, true]) {
        const ctx = todayCtxFor(cell, withRun);
        found.push(...auditToday(composeV5Today(ctx), ctx, cell));
      }

      // Why this run.
      const facts = whyFactsFor(cell);
      found.push(...auditWhy(composeWhy(facts), facts, cell));

      // The recap.
      const ri = recapInputFor(cell);
      if (ri) found.push(...auditRecap(deriveRecap(ri), ri, cell));

      // The block, and the ramp that reads it.
      const b = BOUNDARY_DATES[cell.boundary];
      const block = resolveBlockState({
        planMode: PLAN_MODE_FOR[cell.state],
        planFirstDayISO: b.planFirstISO,
        planLastDayISO: b.planLastISO,
        todayISO: b.todayISO,
        goalRace: cell.state === 'no_goal' ? null : GOAL_RACE,
      });
      const ramp = resolveRampScope({ blockState: block, raceIdx: 15, goalName: GOAL_RACE.name });
      found.push(...auditBlock(block, ramp, b.todayISO));

      // The race plate.
      const isPast = cell.state === 'hours_after_race' || cell.state === 'post_race_recovery' || cell.state === 'off_season';
      const plateIn = {
        isPast,
        goalSec: cell.shape === 'race_no_goal' ? null : 3 * 3600,
        finishSec: isPast && cell.shape !== 'zero_runs' ? 3 * 3600 + 412 : null,
        projectedSec: cell.shape === 'race_null_distance' ? null : 3 * 3600 + 180,
      };
      found.push(...auditRacePlate(racePlateFor(plateIn), plateIn, cell));

      // The single-fact race resolvers, including the production priority
      // value that is not A, B or C.
      for (const prio of ['A', 'B', 'C', null, 'hilly-excluded'] as never[]) {
        const role = resolveRaceRole(prio, { ownGoal: cell.shape === 'race_no_goal' ? null : '3:00:00' });
        check();
        if (!role.line || role.line.trim() === '') found.push({ rule: 'ORPHAN_SECTION', detail: `race role ${String(prio)} has no caption`, where: 'resolveRaceRole' });
        walkStrings(role, (p, v) => { check(); if (isBadText(v)) found.push({ rule: 'BAD_TEXT', detail: `${p} = ${JSON.stringify(v)}`, where: 'resolveRaceRole' }); });
      }
      for (const p of ['official', 'logged', 'provisional', null] as never[]) {
        const pr = resolveProvenance(p);
        if (pr) { check(); if (!pr.label.trim() || !pr.source.trim()) found.push({ rule: 'ORPHAN_SECTION', detail: `provenance ${String(p)} incomplete`, where: 'resolveProvenance' }); }
      }
      check();
      const d = daysToRace(GOAL_RACE.dateISO, b.todayISO);
      const w = weeksToRace(GOAL_RACE.dateISO, b.todayISO);
      if (d != null && w != null && Math.floor(d / 7) !== w) {
        found.push({ rule: 'SELF_CONTRADICTION', detail: `daysToRace ${d} and weeksToRace ${w} disagree`, where: 'race-countdown' });
      }

      for (const x of found) {
        const key = `${x.rule} · ${x.where}`;
        COUNT[key] = (COUNT[key] ?? 0) + 1;
        (WHERE[key] ??= new Set()).add(cell.boundary);
        if (!EXAMPLE[key]) EXAMPLE[key] = `${id} — ${x.detail}`;
      }
    }

    // ── the floors, checked BEFORE the findings ───────────────────────
    console.log(`\n=== SWEPT ${cells} cells · ${CHECKS} assertions ===`);
    expect(cells, 'the matrix shrank — a sweep that runs no cells reports clean').toBeGreaterThanOrEqual(CELL_FLOOR);
    expect(CHECKS, 'the auditors ran too few assertions to be doing their job').toBeGreaterThanOrEqual(CHECK_FLOOR);

    const firm: [string, number][] = [];
    const soft: [string, number][] = [];
    for (const [k, v] of Object.entries(COUNT).sort((a, b) => b[1] - a[1])) {
      const rule = k.split(' · ')[0] as RuleId;
      (RULES[rule].firm ? firm : soft).push([k, v]);
    }
    console.log(`FIRM findings: ${firm.reduce((s, x) => s + x[1], 0)} across ${firm.length} kinds`);
    const at = (k: string) => [...(WHERE[k] ?? [])].join(', ');
    for (const [k, v] of firm) console.log(`  [${v}] ${k}\n        on: ${at(k)}\n        e.g. ${EXAMPLE[k]}`);
    console.log(`OBSERVATIONS (design decisions, not gated): ${soft.reduce((s, x) => s + x[1], 0)} across ${soft.length} kinds`);
    for (const [k, v] of soft) console.log(`  [${v}] ${k}\n        on: ${at(k)}\n        e.g. ${EXAMPLE[k]}`);

    const firmTotal = firm.reduce((s, x) => s + x[1], 0);
    expect(firmTotal, `${firmTotal} firm surface-conformance failures — see the log above`).toBe(0);
  }, 120_000);
});

// ─────────────────────────────────────────────────────────────────────────
// Positive controls — a rule that cannot fail is a rule that is not running
// ─────────────────────────────────────────────────────────────────────────

const CELL: Cell = { state: 'base', shape: 'nominal', boundary: 'midweek' };

/** Each control plants ONE defect and asserts the auditor names it. The keys
 *  are checked for completeness against `RULE_IDS` below, so a new rule
 *  without a control fails the build. */
const CONTROLS: Record<RuleId, () => Finding[]> = {
  BAD_TEXT: () => {
    const ctx = todayCtxFor(CELL, false);
    const out = composeV5Today(ctx);
    out.panel.stats.push({ label: 'Pace band', value: { text: `${NaN}:00/mi`, modelled: true }, tone: null });
    return auditToday(out, ctx, CELL);
  },
  ORPHAN_SECTION: () => {
    const ctx = todayCtxFor(CELL, false);
    const out = composeV5Today(ctx);
    out.why = '';
    return auditToday(out, ctx, CELL);
  },
  REFUSAL_UNEXPLAINED: () => {
    const ctx = todayCtxFor({ ...CELL, state: 'injury_flare' }, false);
    const out = composeV5Today(ctx);
    out.injury = { ...out.injury!, verdict: '' };
    return auditToday(out, ctx, { ...CELL, state: 'injury_flare' });
  },
  REFUSAL_LEAKED_CONTENT: () => {
    const ctx = todayCtxFor({ ...CELL, state: 'week_off' }, false);
    const out = composeV5Today(ctx);
    out.groups = [{ id: 'g', title: 'Work', note: null, steps: [{ id: 's', main: '6 mi', sub: null }] }];
    return auditToday(out, ctx, { ...CELL, state: 'week_off' });
  },
  MODELLED_FLAG_SHAPE: () => {
    const ctx = todayCtxFor(CELL, false);
    const out = composeV5Today(ctx);
    out.panel.dose = { text: '6 mi', modelled: undefined as never };
    return auditToday(out, ctx, CELL);
  },
  MODELLED_UNDERMARKED: () => {
    const ctx = todayCtxFor(CELL, false);
    const out = composeV5Today(ctx);
    const band = out.panel.stats.find((s) => s.label === 'Pace band')!;
    band.value = { text: band.value.text, modelled: false };
    return auditToday(out, ctx, CELL);
  },
  MODELLED_OVERMARKED: () => {
    const ctx = todayCtxFor(CELL, true);
    const out = composeV5Today(ctx);
    const d = out.panel.stats.find((s) => s.label === 'Distance')!;
    d.value = { text: d.value.text, modelled: true };
    return auditToday(out, ctx, CELL);
  },
  ZERO_FOR_UNKNOWN: () => {
    const cell: Cell = { ...CELL, shape: 'shoe_unknown_mi' };
    const ctx = todayCtxFor(cell, true);
    const out = composeV5Today(ctx);
    out.shoesWorn = { id: 's', label: 'Endorphin Speed 4', sub: '0 mi on them', value: null, action: null };
    return auditToday(out, ctx, cell);
  },
  DECLINED_A_KNOWN_VALUE: () => {
    const cell: Cell = { ...CELL, shape: 'shoe_zero_mi' };
    const ctx = todayCtxFor(cell, true);
    const out = composeV5Today(ctx);
    out.shoesWorn = { id: 's', label: 'Endorphin Speed 4', sub: 'Mileage not tracked', value: null, action: null };
    return auditToday(out, ctx, cell);
  },
  SELF_CONTRADICTION: () => {
    const ctx = todayCtxFor(CELL, true);
    const out = composeV5Today(ctx);
    // 8 mi in 1:10:00 is 8:45/mi. Print 3:37/mi beside it.
    out.panel.stats = [
      { label: 'Distance', value: { text: '8 mi', modelled: false }, tone: null },
      { label: 'Time', value: { text: '1:10:00', modelled: false }, tone: null },
      { label: 'Pace', value: { text: '3:37/mi', modelled: false }, tone: null },
    ];
    return auditToday(out, ctx, CELL);
  },
  HEADLINE_IS_SHORTHAND: () => {
    const ctx = todayCtxFor(CELL, false);
    const out = composeV5Today(ctx);
    out.panel.type = '3×1MI @ T PACE · 60S JOG';
    return auditToday(out, ctx, CELL);
  },
  VOICE: () => {
    const ctx = todayCtxFor(CELL, false);
    const out = composeV5Today(ctx);
    out.why = 'Great work out there!';
    return auditToday(out, ctx, CELL);
  },
  STEPPED_PRESENT_TENSE: () => {
    const cell: Cell = { ...CELL, boundary: 'stepped_past' };
    const ctx = todayCtxFor(cell, false);
    const out = composeV5Today(ctx);
    out.whereYouAre = [{ id: 'readiness', label: 'Readiness', sub: null, value: { text: '62 of 100', modelled: false }, action: null }];
    return auditToday(out, ctx, cell);
  },
  DAY_ARITHMETIC: () => {
    const ctx = todayCtxFor(CELL, false);
    const out = composeV5Today(ctx);
    // A local-midnight parse in a negative-offset zone draws the day before.
    out.weekStrip = out.weekStrip.map((d, i) => (i === 2 ? { ...d, number: String(Number(d.number) - 1) } : d));
    return auditToday(out, ctx, CELL);
  },
  RETIRED_SURFACE: () => {
    const ctx = todayCtxFor(CELL, false);
    const out = composeV5Today(ctx);
    // Exactly the shape a composer that started re-emitting the deleted
    // surface would produce: the field back on the payload, and the state to
    // match. Neither is nameable in the wire types any more, which is the
    // point — this control proves the auditor sees it anyway.
    Object.assign(out as unknown as Record<string, unknown>, {
      changed: { converged: [], coachLine: '' },
      state: 'changed_overnight',
    });
    return auditToday(out, ctx, CELL);
  },
  STALE_WINDOW: () => {
    const block = resolveBlockState({
      planMode: 'recovery', planFirstDayISO: '2026-08-17', planLastDayISO: '2026-08-30',
      todayISO: '2026-09-15', goalRace: GOAL_RACE,
    });
    return auditBlock(block, resolveRampScope({ blockState: block, raceIdx: 2 }), '2026-09-15');
  },
  UNREADABLE_FOR_ABSENT: () => {
    const cell: Cell = { ...CELL, shape: 'no_clock' };
    const ctx = todayCtxFor(cell, true);
    const out = composeV5Today(ctx);
    out.askedVsRan = out.askedVsRan.map((r) => ({ ...r, value: { text: null, modelled: false } }));
    return auditToday(out, ctx, cell);
  },
  ELAPSED_VS_MOVING: () => {
    const ctx = todayCtxFor(CELL, true);
    const out = composeV5Today(ctx);
    // 12 mi in 1:45:00 is 8:45/mi elapsed; the moving pace says 7:30/mi.
    out.panel.stats = [
      { label: 'Distance', value: { text: '12 mi', modelled: false }, tone: null },
      { label: 'Time', value: { text: '1:45:00', modelled: false }, tone: null },
      { label: 'Pace', value: { text: '7:30/mi', modelled: false }, tone: null },
    ];
    return auditToday(out, ctx, CELL);
  },
};

// ─────────────────────────────────────────────────────────────────────────
// Timezone independence — the strongest form of the DST claim
// ─────────────────────────────────────────────────────────────────────────

/**
 * The boundary axis puts a cell on both 2026 DST transitions and asserts the
 * week strip's days stay consecutive. That proves the arithmetic is right in
 * the timezone the test happens to run in.
 *
 * This proves something stronger and simpler to reason about: the composers do
 * not depend on the server's timezone AT ALL. Every date path in them is
 * anchored at noon UTC and read back with getUTC*, so the same context must
 * produce a byte-identical payload in Los Angeles, in UTC and in Auckland —
 * three zones on both sides of the date line, two of which are mid-DST on the
 * dates swept.
 *
 * A local-midnight parse anywhere in the chain moves a day by one in a
 * negative-offset zone and by one the other way in a positive-offset zone, so
 * a byte comparison catches it without anyone having to work out which day it
 * should have been.
 */
const withTz = <T>(tz: string, fn: () => T): T => {
  const prev = process.env.TZ;
  process.env.TZ = tz;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev;
  }
};

describe('SURFACE sweep · the composers do not read the server clock or its zone', () => {
  const ZONES = ['America/Los_Angeles', 'UTC', 'Pacific/Auckland'];

  it('every cell composes byte-identically in three timezones', () => {
    let compared = 0;
    for (const cell of sweepMatrix()) {
      // Every boundary, but one shape — the axis under test is the DATE, and
      // the full cross would triple a sweep that already runs two million
      // assertions for no extra coverage of the thing being proven.
      if (cell.shape !== 'nominal') continue;
      const render = () => {
        const b = BOUNDARY_DATES[cell.boundary];
        const block = resolveBlockState({
          planMode: PLAN_MODE_FOR[cell.state],
          planFirstDayISO: b.planFirstISO,
          planLastDayISO: b.planLastISO,
          todayISO: b.todayISO,
          goalRace: cell.state === 'no_goal' ? null : GOAL_RACE,
        });
        return JSON.stringify({
          before: composeV5Today(todayCtxFor(cell, false)),
          after: composeV5Today(todayCtxFor(cell, true)),
          block,
          ramp: resolveRampScope({ blockState: block, raceIdx: 15, goalName: GOAL_RACE.name }),
          days: daysToRace(GOAL_RACE.dateISO, b.todayISO),
          weeks: weeksToRace(GOAL_RACE.dateISO, b.todayISO),
        });
      };
      const [la, utc, akl] = ZONES.map((tz) => withTz(tz, render));
      compared += 1;
      expect(utc, `${cellId(cell)} composes differently in America/Los_Angeles than in UTC`).toBe(la);
      expect(akl, `${cellId(cell)} composes differently in Pacific/Auckland than in UTC`).toBe(utc);
    }
    // The floor again: a filter that matched nothing would pass silently.
    expect(compared, 'the timezone comparison ran on no cells').toBeGreaterThanOrEqual(BOUNDARIES_FLOOR);
  }, 60_000);
});

describe('SURFACE sweep · positive controls', () => {
  it('every rule has a control — a rule with none may already be dead', () => {
    expect(Object.keys(CONTROLS).sort()).toEqual([...RULE_IDS].sort());
  });

  for (const rule of RULE_IDS) {
    it(`detects a planted ${rule}`, () => {
      const found = CONTROLS[rule]();
      expect(found.map((f) => f.rule), `planted ${rule} went undetected: ${RULES[rule].what}`).toContain(rule);
    });
  }

  it('a clean payload trips nothing', () => {
    const ctx = todayCtxFor(CELL, false);
    const found = auditToday(composeV5Today(ctx), ctx, CELL);
    expect(found, `a nominal base-phase midweek cell should be clean: ${JSON.stringify(found)}`).toEqual([]);
  });

  it('the firm rule set is not empty and is a subset of every rule', () => {
    expect(FIRM_RULE_IDS.length).toBeGreaterThan(8);
    expect(FIRM_RULE_IDS.every((r) => RULE_IDS.includes(r))).toBe(true);
  });
});
