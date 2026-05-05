/**
 * Coach engine — the real version.
 *
 * Replaces the earlier placeholder. Encodes the coaching principles
 * from docs/coaching-research.md as constraints + decisions on top of
 * the aggregated CoachState. See coach-principles.ts for every
 * literature-anchored constant the engine reads.
 *
 * Decision flow each morning:
 *   1. mode      — race vs base (deterministic from race calendar)
 *   2. phase     — BASE | BUILD | PEAK | TAPER (race mode) OR
 *                  POST_RACE | REBUILD | BASE_MAINTENANCE (base mode)
 *   3. run pick  — default by phase + day-of-week, then state nudges
 *   4. constraints — long-run spike cap, recovery spacing, ACWR cap,
 *                    heavy-block override, post-race override
 *   5. strength  — Amp-aware prescription, opposite hard run days
 *   6. week shape — same loop simulated forward 7 days
 *   7. alerts    — heavy-block, easy-ratio low, taper window, rebuild
 *   8. rationale — one sentence that names the load-bearing input
 */

import type { CoachState } from './coach-state';
import {
  type Phase, type RaceSubPhase,
  raceSubPhase, intensityTarget, maxLongRunMi, acwr, ACWR_HIGH,
  HEAVY_BLOCK_REST_DAYS,
} from './coach-principles';
import {
  type RunWorkoutType, type RunPrescription,
  defaultByDow, recovery, generalAerobic, easyWithStrides, mediumLong,
  longSteady, longProgression, longMpBlock, thresholdContinuous,
  thresholdIntervals, subThreshold, vo2, marathonSpecific, shakeout, rest, race,
} from './coach-workouts';
import {
  prescribeStrength, strengthWeekContext, type StrengthPrescription,
} from './coach-strength';

export type WorkoutType = RunWorkoutType;

export interface CoachToday {
  mode: 'race' | 'base';
  modeDetail: string;
  phase: Phase;
  today: TodayPrescription;
  strength: StrengthPrescription | null;
  rationale: string;
  weekShape: Array<{
    date: string;
    type: WorkoutType;
    distanceMi: number;
    isToday: boolean;
    hasStrength: boolean;
  }>;
  alerts: Array<{ severity: 'info' | 'warn' | 'rest'; message: string }>;
  generatedAt: string;
  isPlaceholder: boolean;
}

interface TodayPrescription {
  type: WorkoutType;
  label: string;
  distanceMi: number;
  paceTargetSPerMi: { lowS: number; highS: number } | null;
  hrZone: number | null;
  description: string;
}

/* ── Main entry ─────────────────────────────────────────────── */
export function coachDaily(state: CoachState): CoachToday {
  const mode = decideMode(state);
  const phase = decidePhase(state, mode);
  const todayDow = jsDow(state.now);

  const run = applyConstraints(pickRun(state, phase, todayDow), state, phase, todayDow);
  const isHard = isHardRun(run);
  const strength = prescribeStrength(state, phase, todayDow, isHard);

  const alerts = computeAlerts(state, phase);
  const week = simulateWeek(state, phase, todayDow);
  const rationale = composeRationale(state, phase, run, strength);

  return {
    mode, modeDetail: describeMode(state, phase),
    phase,
    today: runToTodayShape(run),
    strength,
    rationale,
    weekShape: week,
    alerts,
    generatedAt: new Date().toISOString(),
    isPlaceholder: false,
  };
}

/* ── Mode ───────────────────────────────────────────────────── */
function decideMode(state: CoachState): 'race' | 'base' {
  return state.races.nextA && state.races.inWindow.some(r => r.priority === 'A') ? 'race' : 'base';
}

/* ── Phase ──────────────────────────────────────────────────── */
function decidePhase(state: CoachState, mode: 'race' | 'base'): Phase {
  // Race mode → sub-phase by days-to-A.
  if (mode === 'race' && state.races.nextA) {
    return raceSubPhase(state.races.nextA.daysAway, state.races.nextA.distanceMi) as RaceSubPhase;
  }
  // Base mode — POST_RACE while ANY recent race's distance-aware
  // recovery window is still open. A marathon contributes 26 days,
  // a half 14, a 10K 7. So a marathon 21 days ago still qualifies
  // as POST_RACE even though the previous "14 day" rule would have
  // closed it. Stacking races (marathon + half within 14 days) keeps
  // the phase active until the LATEST window closes.
  if (state.recoveryWindowEndsISO && state.now <= state.recoveryWindowEndsISO) {
    return 'POST_RACE';
  }
  if (state.flags.rebuildAfterBreak) return 'REBUILD';
  return 'BASE_MAINTENANCE';
}

function describeMode(state: CoachState, phase: Phase): string {
  if (phase === 'TAPER' && state.races.nextA) {
    const d = state.races.nextA.daysAway;
    if (d === 0) return `Race day — ${state.races.nextA.name}`;
    if (d === 1) return `Race tomorrow — ${state.races.nextA.name}`;
    return `${d} days to ${state.races.nextA.name} · taper week — volume drops, intensity holds`;
  }
  if (phase === 'PEAK' && state.races.nextA)  return `${state.races.nextA.daysAway} days to ${state.races.nextA.name} · peak block — marathon-specific work`;
  if (phase === 'BUILD' && state.races.nextA) return `${state.races.nextA.daysAway} days to ${state.races.nextA.name} · build phase — threshold + progression long runs`;
  if (phase === 'BASE' && state.races.nextA)  return `${state.races.nextA.daysAway} days to ${state.races.nextA.name} · base block — aerobic volume`;
  if (phase === 'POST_RACE') {
    const r = state.races.recent[0];
    return r ? `Recovery week — ${r.daysAgo} day${r.daysAgo === 1 ? '' : 's'} since ${r.name}` : 'Recovery — volume drop is by design';
  }
  if (phase === 'REBUILD') return 'Easing back in — rebuilding the base after a break';
  return 'Maintain the base — steady volume, weekly long run, no peaking';
}

/* ── Run picker ─────────────────────────────────────────────── */
function pickRun(state: CoachState, phase: Phase, dow: number): RunPrescription {
  // Race-week / race-day overrides — these short-circuit normal logic.
  if (phase === 'TAPER' && state.races.nextA) {
    const d = state.races.nextA.daysAway;
    if (d === 0) return race(state.races.nextA.distanceMi, state.races.nextA.name);
    if (d === 1) return shakeout();
  }

  // Heavy-block detected + base mode → mandate rest. Doc §13.3:
  // a runner peaking ≥70 mpw needs 2-4 weeks of reduced training.
  if (phase === 'BASE_MAINTENANCE' && state.flags.heavyBlockSuspected) {
    return rest(`Heavy-block recovery (~${HEAVY_BLOCK_REST_DAYS} days). Full rest today.`);
  }

  // POST_RACE — graduated recovery based on the LARGEST recent race's
  // distance + heavy-block flag (stacked races extend the rest depth).
  //
  // Single race recovery — gentle ramp:
  //   Marathon:    days 0-3 REST, days 4-7 recovery 2-3mi, days 8-14
  //                easy 4-6mi, days 15-21 gradual return, day 22+ base.
  //   Half:        days 0-2 REST, days 3-5 recovery 2-3mi, days 6-9
  //                easy 4-6mi, day 10+ base return.
  //   10K:         days 0-1 REST, days 2-4 recovery, day 5+ base.
  //   5K:          day 0 REST, day 1 recovery, day 2+ base.
  //
  // Heavy block (marathon-in-14d, 2+ races in 14d, etc) — every stage
  // extends ~2x because the second race compounded the damage.
  if (phase === 'POST_RACE') {
    const r = postRaceWorkout(state);
    if (r) return r;
  }

  // Default by phase + day-of-week (from coach-workouts).
  const def = defaultByDow(phase, dow);
  return buildPrescriptionFor(def.primary, state, phase);
}

/** Graduated post-race recovery prescription. Looks at the LARGEST
 *  recent race (most damaging) + heavy-block flag, finds days-since
 *  to that race, and picks the right depth: REST → light recovery →
 *  easy general aerobic → base return. Returns null when nothing
 *  matches (caller falls through to default phase logic). */
function postRaceWorkout(state: CoachState): RunPrescription | null {
  if (state.races.recent.length === 0) return null;
  // Largest race is the load-bearing one for recovery duration.
  const biggest = state.races.recent.slice().sort((a, b) => b.distanceMi - a.distanceMi)[0];
  // Most-recent race tells us how many days have actually passed.
  const mostRecent = state.races.recent[0];
  const days = mostRecent.daysAgo;
  const distMi = biggest.distanceMi;
  const heavy = state.flags.heavyBlockSuspected;

  const stageMul = heavy ? 1.8 : 1;   // heavy block ~2x rest depth
  const restEnd = Math.round((distMi >= 22 ? 3 : distMi >= 11 ? 2 : 1) * stageMul);
  const lightEnd = Math.round((distMi >= 22 ? 7 : distMi >= 11 ? 5 : 3) * stageMul);
  const easyEnd = Math.round((distMi >= 22 ? 14 : distMi >= 11 ? 9 : 5) * stageMul);

  if (days <= restEnd) {
    const racesDesc = state.races.recent.length > 1
      ? `${state.races.recent.length} races in ${state.races.recent[state.races.recent.length - 1].daysAgo} days (last: ${mostRecent.name})`
      : `${days === 0 ? 'Race day' : `${days} day${days === 1 ? '' : 's'}`} since ${mostRecent.name}`;
    return rest(`${racesDesc}. Full rest today. ${heavy ? 'Heavy block stacked — needs proper recovery before any running.' : 'The body needs 24-72h before any running, even easy.'}`);
  }
  if (days <= lightEnd) {
    return {
      type: 'recovery', label: 'Recovery run',
      distanceMi: 2.5, durationMin: null,
      paceTargetSPerMi: null, hrZone: 1,
      description: `2-3 mi very easy · circulation, not adaptation · or rest if legs aren\'t ready`,
      isQuality: false, isLong: false, appendStrides: false,
    };
  }
  if (days <= easyEnd) {
    const baseEasy = baseEasyMi(state, 'POST_RACE');
    return {
      type: 'general_aerobic', label: 'General aerobic',
      distanceMi: round1(Math.max(3, Math.min(baseEasy * 0.7, 6))), durationMin: null,
      paceTargetSPerMi: null, hrZone: 2,
      description: `${round1(Math.max(3, Math.min(baseEasy * 0.7, 6)))} mi easy aerobic · stay conversational · gradual return`,
      isQuality: false, isLong: false, appendStrides: false,
    };
  }
  // Past the easy window but recoveryWindowEndsISO still says POST_RACE
  // (e.g. day 15-26 after a marathon). Allow general aerobic at base
  // volume but no quality work.
  return {
    type: 'general_aerobic', label: 'General aerobic',
    distanceMi: round1(baseEasyMi(state, 'POST_RACE')), durationMin: null,
    paceTargetSPerMi: null, hrZone: 2,
    description: `${round1(baseEasyMi(state, 'POST_RACE'))} mi easy aerobic · still inside the marathon recovery window — no quality yet`,
    isQuality: false, isLong: false, appendStrides: false,
  };
}

function buildPrescriptionFor(type: RunWorkoutType, state: CoachState, phase: Phase): RunPrescription {
  const baseEasy = baseEasyMi(state, phase);
  const longTarget = longRunTarget(state, phase);

  switch (type) {
    case 'recovery':           return recovery(Math.min(5, Math.max(3, baseEasy * 0.6)));
    case 'general_aerobic':    return generalAerobic(baseEasy, state);
    case 'medium_long':        return mediumLong(Math.max(8, baseEasy * 1.6), state);
    case 'long_steady':        return longSteady(longTarget, state);
    case 'long_progression':   return longProgression(longTarget, state);
    case 'long_mp_block':      return longMpBlock(longTarget, state, Math.min(14, Math.max(6, longTarget * 0.55)));
    case 'threshold':          return thresholdContinuous(8, state);
    case 'threshold_intervals': return thresholdIntervals(state);
    case 'sub_threshold':      return subThreshold(state);
    case 'vo2':                return vo2(state);
    case 'marathon_specific':  return marathonSpecific(state);
    case 'strides_appended':   return easyWithStrides(baseEasy, state);
    case 'shakeout':           return shakeout();
    case 'race':               return state.races.nextA ? race(state.races.nextA.distanceMi, state.races.nextA.name) : rest('No race scheduled.');
    case 'rest':               return rest('Scheduled rest day.');
  }
}

/** Daily easy mileage scaled to recent volume + phase. Floors at 3,
 *  caps at 25% of weekly average so a single easy day doesn't blow the
 *  weekly budget. */
function baseEasyMi(state: CoachState, phase: Phase): number {
  const wkAvg = Math.max(state.volume.weeklyAvg4w, 12);
  const dailyShare = wkAvg / 5;  // Assume ~5 running days/week
  if (phase === 'POST_RACE') return Math.max(3, dailyShare * 0.5);
  if (phase === 'REBUILD')   return Math.max(3, dailyShare * 0.7);
  if (phase === 'TAPER')     return Math.max(3, dailyShare * 0.8);
  return Math.max(3, Math.min(dailyShare, 12));
}

/** Long-run target — capped at 110% of longest run in last 30 days
 *  (single-session-spike rule, doc §13.1). PEAK targets a slight
 *  increase; TAPER cuts to ~75%; POST_RACE / REBUILD cap at 60-80%. */
function longRunTarget(state: CoachState, phase: Phase): number {
  const cap = maxLongRunMi(state);
  const peakLast = state.volume.longestLast28Mi;
  switch (phase) {
    case 'TAPER':            return Math.min(cap, Math.max(8, peakLast * 0.65));
    case 'PEAK':             return Math.min(cap, Math.max(14, peakLast * 1.05));
    case 'BUILD':            return Math.min(cap, Math.max(10, peakLast * 1.05));
    case 'BASE':             return Math.min(cap, Math.max(8, peakLast));
    case 'BASE_MAINTENANCE': return Math.min(cap, Math.max(8, peakLast));
    case 'POST_RACE':        return Math.min(cap, Math.max(6, peakLast * 0.4));
    case 'REBUILD':          return Math.min(cap, Math.max(6, peakLast * 0.6));
  }
}

/* ── Hard constraints ───────────────────────────────────────── */
function applyConstraints(p: RunPrescription, state: CoachState, phase: Phase, dow: number): RunPrescription {
  // 1. Long run can't spike — cap at maxLongRunMi.
  if (p.isLong && p.distanceMi > maxLongRunMi(state)) {
    const capped = maxLongRunMi(state);
    return { ...p, distanceMi: round1(capped),
      description: p.description.replace(/^\d+(\.\d+)?\s*mi/i, `${round1(capped)} mi`)
        + ` · capped to ${round1(capped)} mi (long-run spike rule: never >10% over your recent longest)`,
    };
  }

  // 2. 24h recovery: yesterday hard → today must be easy.
  const y = state.recovery.yesterday;
  const yesterdayHard = y && y.distMi > 0 && y.avgHr != null && y.avgHr >= 152;
  if (p.isQuality && yesterdayHard) {
    return generalAerobic(baseEasyMi(state, phase), state);
  }

  // 3. ACWR > 1.3 → flag and downshift quality to general aerobic.
  const ratio = acwr(state);
  if (ratio != null && ratio > ACWR_HIGH && p.isQuality && !p.isLong) {
    const easy = generalAerobic(baseEasyMi(state, phase), state);
    return { ...easy, description: `${easy.description} · acute load is ${ratio.toFixed(2)}× chronic, holding off on quality today` };
  }

  // 4. POST_RACE phase — never quality, ever.
  if (phase === 'POST_RACE' && p.isQuality) {
    return recovery(Math.max(3, baseEasyMi(state, phase) * 0.7));
  }

  // 5. Rebuild — cap distance to a sensible easy.
  if (phase === 'REBUILD' && p.distanceMi > baseEasyMi(state, phase) * 1.3) {
    return generalAerobic(Math.max(3, baseEasyMi(state, phase)), state);
  }

  // dow used implicitly via the picker; keep for future placement rules.
  void dow;
  return p;
}

function isHardRun(p: RunPrescription): boolean {
  return p.isQuality || (p.isLong && p.distanceMi >= 10);
}

/* ── Alerts ─────────────────────────────────────────────────── */
function computeAlerts(state: CoachState, phase: Phase): CoachToday['alerts'] {
  const out: CoachToday['alerts'] = [];

  if (phase === 'BASE_MAINTENANCE' && state.flags.heavyBlockSuspected) {
    out.push({ severity: 'rest', message: `${state.races.raceCount30d} races + high volume in the last 30 days. Coach prescribed rest — recovery is the workout.` });
  }
  if (phase === 'POST_RACE') {
    const r = state.races.recent[0];
    if (r) out.push({ severity: 'info', message: `${r.daysAgo} days since ${r.name}. Volume drop is intentional — building back gradually through the recovery window.` });
  }
  if (state.flags.rebuildAfterBreak) {
    out.push({ severity: 'warn', message: 'Last 7 days mileage is well below your 28-day average. Rebuild week — easy mileage only.' });
  }
  // Easy-share alert — only fires in phases where the runner has
  // forward agency over training composition. POST_RACE and REBUILD
  // are recovery phases; the past 14 days will mechanically fail the
  // ratio and the alert isn't actionable. Skip it.
  const target = intensityTarget(phase);
  if (
    phase !== 'POST_RACE' && phase !== 'REBUILD' &&
    state.intensity.easyShare14d > 0 &&
    state.intensity.easyShare14d < target.easyShareMin
  ) {
    out.push({ severity: 'warn', message: `Only ${Math.round(state.intensity.easyShare14d * 100)}% easy miles last 14 days. Target for this phase is ≥${Math.round(target.easyShareMin * 100)}% — drop intensity before injury risk climbs.` });
  }
  if (state.races.nextA && state.races.nextA.daysAway > 0 && state.races.nextA.daysAway <= 14) {
    out.push({ severity: 'info', message: `${state.races.nextA.daysAway}-day taper window for ${state.races.nextA.name}. Volume drops 40-60%, intensity preserved.` });
  }
  const ratio = acwr(state);
  if (ratio != null && ratio > ACWR_HIGH) {
    out.push({ severity: 'warn', message: `Acute:chronic load ratio is ${ratio.toFixed(2)}× — over the 1.3 ceiling. Holding intensity until it drops.` });
  }
  return out;
}

/* ── Week shape simulation ──────────────────────────────────── */
function simulateWeek(state: CoachState, phase: Phase, todayDow: number): CoachToday['weekShape'] {
  const today = new Date(state.now + 'T12:00:00Z');
  const monday = new Date(today);
  monday.setUTCDate(today.getUTCDate() + (todayDow === 0 ? -6 : 1 - todayDow));

  const cadence = strengthWeekContext(state, phase).cadence;
  const out: CoachToday['weekShape'] = [];

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday); d.setUTCDate(monday.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    const isToday = iso === state.now;

    // Pick the day's run + apply constraints. (Doesn't account for
    // execution within the week — this is a *plausible* shape, not a
    // promise. Re-derived every morning.)
    const def = defaultByDow(phase, dow);
    const run = applyConstraints(buildPrescriptionFor(def.primary, state, phase), state, phase, dow);

    // Strength on this day? Match coach-strength placement rules.
    const hasStrength = strengthFitsThisDay(state, phase, dow, isHardRun(run), cadence.perWeek);

    out.push({ date: iso, type: run.type, distanceMi: run.distanceMi, isToday, hasStrength });
  }
  return out;
}

/** Mirrors prescribeStrength's day placement so the week shape's
 *  hasStrength flag matches what the actual prescription would have
 *  said for that day. */
function strengthFitsThisDay(state: CoachState, phase: Phase, dow: number, todayHard: boolean, perWeek: number): boolean {
  if (perWeek === 0) return false;
  const PLACEMENT: Record<string, number[]> = {
    heavy: [1, 4], power: [3], maintenance: [2, 5], mobility: [0, 2],
  };
  const types = phase === 'BASE' ? ['heavy', 'heavy']
    : phase === 'BUILD' ? ['heavy', 'power']
    : phase === 'PEAK' ? ['maintenance']
    : phase === 'TAPER' ? ['maintenance']
    : phase === 'BASE_MAINTENANCE' ? ['heavy', 'heavy']
    : phase === 'REBUILD' ? ['heavy', 'mobility']
    : ['mobility'];
  for (let i = 0; i < Math.min(perWeek, types.length); i++) {
    if (PLACEMENT[types[i]]?.includes(dow)) {
      if (todayHard && (types[i] === 'heavy' || types[i] === 'power')) continue;
      return true;
    }
  }
  return false;
}

/* ── Rationale ──────────────────────────────────────────────── */
function composeRationale(state: CoachState, phase: Phase, p: RunPrescription, strength: StrengthPrescription | null): string {
  // Priority order: explicit overrides → state-driven flags → phase
  // logic → fall-through.
  if (p.type === 'race') return `Race day. Trust the plan, execute the pacing strategy.`;
  if (p.type === 'shakeout') return `Race tomorrow — keep the legs awake without adding fatigue.`;

  if (state.flags.heavyBlockSuspected && p.type === 'rest') {
    return `${state.races.raceCount30d} races finished in the last 30 days; rest is the highest-leverage workout right now.`;
  }
  if (state.flags.rebuildAfterBreak) {
    const ratio = state.volume.weeklyAvg4w > 0 ? Math.round((state.volume.last7Mi / state.volume.weeklyAvg4w) * 100) : null;
    return ratio != null
      ? `Last 7 days are ${ratio}% of your recent weekly average — easing back, not pushing.`
      : `Coming back from a break — easing back in.`;
  }
  if (phase === 'POST_RACE') {
    const r = state.races.recent[0];
    return r ? `${r.daysAgo} day${r.daysAgo === 1 ? '' : 's'} since ${r.name}. Recovery before structure.` : `Recovery before structure.`;
  }
  if (phase === 'TAPER') {
    return `Taper week — fitness is built, the job is to arrive at the start line rested without losing edge.`;
  }
  if (phase === 'PEAK' && p.isLong) {
    return `Peak block long run — most race-specific session in the cycle (Pfitzinger/Canova). Long-run cap is ${maxLongRunMi(state).toFixed(1)} mi (no >10% spikes).`;
  }
  if (p.isQuality && p.isLong) {
    return `Long run with quality — drives both aerobic capacity and race-pace specificity. Cap ${maxLongRunMi(state).toFixed(1)} mi from longest recent.`;
  }
  if (p.isLong) {
    return `Long run anchors the week. Aerobic effort, kept fun. Cap ${maxLongRunMi(state).toFixed(1)} mi from longest recent.`;
  }
  if (p.isQuality) {
    const tgt = intensityTarget(phase);
    return `Mid-week quality session — ${phase.toLowerCase()} target is ${Math.round(tgt.qualityDaysPerWeek)} quality day${tgt.qualityDaysPerWeek === 1 ? '' : 's'}/week, easy share ≥${Math.round(tgt.easyShareMin * 100)}%.`;
  }
  if (strength) {
    return `Easy mileage today; ${strength.label.toLowerCase()} on the Amp completes the day. ${state.intensity.easyShare14d > 0 ? `Last 14d easy share ${Math.round(state.intensity.easyShare14d * 100)}%.` : ''}`.trim();
  }
  return phase === 'BASE_MAINTENANCE'
    ? `Maintain the base — easy mileage compounds across years more than any single hard day.`
    : `Building toward race day — aerobic miles are the substrate.`;
}

/* ── Helpers ────────────────────────────────────────────────── */
function runToTodayShape(p: RunPrescription): TodayPrescription {
  return {
    type: p.type, label: p.label,
    distanceMi: p.distanceMi,
    paceTargetSPerMi: p.paceTargetSPerMi,
    hrZone: p.hrZone,
    description: p.description,
  };
}
function jsDow(iso: string): number {
  return new Date(iso + 'T12:00:00Z').getUTCDay();
}
function round1(n: number): number { return Math.round(n * 10) / 10; }
