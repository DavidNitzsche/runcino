/**
 * Coach engine — placeholder logic.
 *
 * INTENTIONAL STUB. The real coaching logic lands once the research
 * doc informs how each principle (80/20, ACWR, taper rules, post-
 * heavy-block rest, etc.) gets encoded. Until then, this file:
 *
 *   1. Locks the response shape iOS will read every morning.
 *   2. Computes `mode` correctly from race calendar (deterministic).
 *   3. Surfaces state-driven ALERTS that the research doc will
 *      eventually drive prescriptions from (heavy-block, rebuild
 *      after break, race-week incoming).
 *   4. Picks today's workout via a simple day-of-week heuristic so
 *      the dashboard card has something visible.
 *
 * Every workout payload sets `isPlaceholder: true` so the UI can
 * surface a clear "this is placeholder coaching" chip. Replacing the
 * engine with the real logic = rewriting `coachDaily()` only.
 *
 * See lib/coach-state.ts for the input shape — that's the data
 * picture Coach reads each morning.
 */

import type { CoachState } from './coach-state';

export type WorkoutType = 'easy' | 'long' | 'tempo' | 'intervals' | 'recovery' | 'rest' | 'fun' | 'race';

export interface CoachToday {
  /** RACE mode = A race in scope and structuring toward it.
   *  BASE mode = no A race in scope; maintain the base. */
  mode: 'race' | 'base';
  /** Human-readable mode descriptor for the UI. Adapts to whether a
   *  race is in scope, distance-to-go, etc. */
  modeDetail: string;

  today: {
    type: WorkoutType;
    distanceMi: number;
    /** Inclusive pace target band, in seconds per mile. null = no
     *  pace target (rest, fun, recovery). */
    paceTargetSPerMi: { lowS: number; highS: number } | null;
    /** Aerobic / lactate / VO2max zone, 1–5. null when not applicable. */
    hrZone: number | null;
    /** Plain-English description of what to do. */
    description: string;
  };

  /** ONE sentence explaining the load-bearing input behind today's
   *  prescription. The "why" is the whole product differentiator. */
  rationale: string;

  /** Plausible (not promised) week shape. Re-derived every morning;
   *  not a static plan. */
  weekShape: Array<{
    date: string;
    type: WorkoutType;
    distanceMi: number;
    isToday: boolean;
  }>;

  /** State-driven flags Coach surfaces independently of today's
   *  workout (race-week incoming, heavy-block detected, rebuild after
   *  break, missing race result, etc). Rendered as chips above the
   *  prescription card. */
  alerts: Array<{
    severity: 'info' | 'warn' | 'rest';
    message: string;
  }>;

  generatedAt: string;
  /** True until the research-doc-driven engine ships. The UI surfaces
   *  this as a chip so users know the prescriptions are heuristic. */
  isPlaceholder: boolean;
}

/** Decide today's prescription given an aggregated state object.
 *  PLACEHOLDER LOGIC — see file header. */
export function coachDaily(state: CoachState): CoachToday {
  const mode = decideMode(state);
  const modeDetail = describeMode(state, mode);
  const alerts = computeAlerts(state, mode);

  // Day-of-week heuristic: traditional Mon–Sun structure with the
  // long run on Saturday. Real engine will place workouts based on
  // recent execution + recovery, not the calendar.
  const dow = new Date(state.now + 'T12:00:00Z').getUTCDay();
  const today = pickToday(state, mode, dow);
  const rationale = composeRationale(state, mode, today.type);
  const weekShape = sketchWeekShape(state, mode);

  return {
    mode,
    modeDetail,
    today,
    rationale,
    weekShape,
    alerts,
    generatedAt: new Date().toISOString(),
    isPlaceholder: true,
  };
}

/* ── Mode (decidable from race calendar — not placeholder) ────── */
function decideMode(state: CoachState): 'race' | 'base' {
  return state.races.nextA && state.races.inWindow.some(r => r.priority === 'A') ? 'race' : 'base';
}

function describeMode(state: CoachState, mode: 'race' | 'base'): string {
  if (mode === 'race' && state.races.nextA) {
    const r = state.races.nextA;
    if (r.daysAway === 0) return `Race day — ${r.name}`;
    if (r.daysAway === 1) return `Race tomorrow — ${r.name}`;
    if (r.daysAway <= 7)  return `${r.daysAway} days to ${r.name} · taper week`;
    if (r.daysAway <= 21) return `${r.daysAway} days to ${r.name} · peak block`;
    return `${r.daysAway} days to ${r.name}`;
  }
  if (state.flags.rebuildAfterBreak) return 'Rebuilding base after a break — easing back in';
  if (state.flags.heavyBlockSuspected) return 'Heavy block detected — maintain the base, prioritize recovery';
  return 'Maintain the base — steady volume, weekly long run, no peaking';
}

/* ── Alerts (state-driven, real) ─────────────────────────────── */
function computeAlerts(state: CoachState, mode: 'race' | 'base'): CoachToday['alerts'] {
  const out: CoachToday['alerts'] = [];

  if (state.flags.heavyBlockSuspected && mode === 'base') {
    out.push({
      severity: 'rest',
      message: `${state.races.raceCount30d} races + high volume in the last 30 days. Consider 3–5 days of full rest before resuming structure.`,
    });
  }
  if (state.flags.rebuildAfterBreak) {
    out.push({
      severity: 'warn',
      message: `Last 7 days mileage is well below your 28-day average. Easing back in.`,
    });
  }
  if (state.intensity.easyShare14d > 0 && state.intensity.easyShare14d < 0.60) {
    out.push({
      severity: 'warn',
      message: `Only ${Math.round(state.intensity.easyShare14d * 100)}% easy miles last 14 days. Drop intensity before injury risk climbs.`,
    });
  }
  if (state.races.nextA && state.races.nextA.daysAway > 0 && state.races.nextA.daysAway <= 14) {
    out.push({
      severity: 'info',
      message: `${state.races.nextA.daysAway}-day taper window for ${state.races.nextA.name}. Volume drops, intensity holds.`,
    });
  }
  return out;
}

/* ── Today's workout (PLACEHOLDER day-of-week heuristic) ──────── */
function pickToday(state: CoachState, mode: 'race' | 'base', dow: number): CoachToday['today'] {
  // Race-week override: 7 days out → easy/rest; 1 day out → 20-min shakeout.
  if (mode === 'race' && state.races.nextA) {
    if (state.races.nextA.daysAway === 0) return placeholderRace(state.races.nextA.distanceMi);
    if (state.races.nextA.daysAway === 1) return placeholderShakeout();
    if (state.races.nextA.daysAway <= 7)  return placeholderTaperEasy(state);
  }

  // Heavy-block: rest day overrides everything.
  if (state.flags.heavyBlockSuspected && mode === 'base') {
    return placeholderRest('Heavy-block recovery — full rest today.');
  }

  const baseMi = Math.max(3, state.volume.weeklyAvg4w / 5);
  // Simple day-of-week mapping: Sat=long, Sun=recovery, Wed=tempo (race) / easy (base), rest easy.
  if (dow === 6) return placeholderLong(state, mode);
  if (dow === 0) return placeholderRecovery();
  if (dow === 3 && mode === 'race') return placeholderTempo(state);
  return placeholderEasy(baseMi);
}

function placeholderEasy(distMi: number): CoachToday['today'] {
  return {
    type: 'easy',
    distanceMi: round1(distMi),
    paceTargetSPerMi: null,
    hrZone: 2,
    description: `${round1(distMi)} mi easy · conversational pace · HR zone 2`,
  };
}
function placeholderLong(state: CoachState, mode: 'race' | 'base'): CoachToday['today'] {
  const target = mode === 'race' ? Math.max(8, state.volume.longestLast28Mi + 1) : Math.max(8, state.volume.longestLast28Mi);
  return {
    type: 'long',
    distanceMi: round1(target),
    paceTargetSPerMi: null,
    hrZone: 2,
    description: `${round1(target)} mi long run · aerobic effort · keep it fun`,
  };
}
function placeholderRecovery(): CoachToday['today'] {
  return {
    type: 'recovery',
    distanceMi: 4,
    paceTargetSPerMi: null,
    hrZone: 1,
    description: '3–5 mi very easy or full rest · let the legs come back',
  };
}
function placeholderTempo(state: CoachState): CoachToday['today'] {
  const flat = state.races.nextA?.goalFinishS && state.races.nextA.distanceMi > 0
    ? Math.round(state.races.nextA.goalFinishS / state.races.nextA.distanceMi)
    : null;
  return {
    type: 'tempo',
    distanceMi: 7,
    paceTargetSPerMi: flat ? { lowS: flat - 5, highS: flat + 5 } : null,
    hrZone: 4,
    description: '2 mi WU · 4 mi at goal pace · 1 mi CD',
  };
}
function placeholderTaperEasy(state: CoachState): CoachToday['today'] {
  return {
    type: 'easy',
    distanceMi: Math.max(3, round1(state.volume.weeklyAvg4w / 6)),
    paceTargetSPerMi: null,
    hrZone: 2,
    description: 'Taper easy · keep legs fresh · don\'t add volume',
  };
}
function placeholderShakeout(): CoachToday['today'] {
  return {
    type: 'easy',
    distanceMi: 2,
    paceTargetSPerMi: null,
    hrZone: 2,
    description: '20 min shakeout · 2–3 strides · race tomorrow',
  };
}
function placeholderRace(distMi: number): CoachToday['today'] {
  return {
    type: 'race',
    distanceMi: round1(distMi),
    paceTargetSPerMi: null,
    hrZone: null,
    description: 'Race day. Trust the plan. Execute.',
  };
}
function placeholderRest(why: string): CoachToday['today'] {
  return {
    type: 'rest',
    distanceMi: 0,
    paceTargetSPerMi: null,
    hrZone: null,
    description: why,
  };
}

/* ── Rationale (placeholder string composition) ───────────────── */
function composeRationale(state: CoachState, mode: 'race' | 'base', type: WorkoutType): string {
  if (state.flags.heavyBlockSuspected && type === 'rest') {
    return `${state.races.raceCount30d} races finished in 30 days; rest is the highest-leverage workout.`;
  }
  if (state.flags.rebuildAfterBreak) {
    return `Last 7 days mileage is ${Math.round((state.volume.last7Mi / Math.max(state.volume.weeklyAvg4w, 1)) * 100)}% of recent average — easing back, not pushing.`;
  }
  if (mode === 'race' && state.races.nextA && state.races.nextA.daysAway <= 7) {
    return `${state.races.nextA.daysAway}-day taper for ${state.races.nextA.name} — volume drops while intensity holds.`;
  }
  if (type === 'long') {
    return `Saturday long run — current weekly avg is ${state.volume.weeklyAvg4w.toFixed(1)} mi, peak last 28 days was ${state.volume.longestLast28Mi.toFixed(1)} mi.`;
  }
  if (type === 'tempo') {
    return `Mid-week quality session — placing intensity here keeps Saturday's long run aerobic.`;
  }
  return mode === 'race' ? 'Building toward race day.' : 'Maintain the base — easy mileage compounds.';
}

/* ── Week shape (placeholder Mon-Sun sketch) ──────────────────── */
function sketchWeekShape(state: CoachState, mode: 'race' | 'base'): CoachToday['weekShape'] {
  const today = new Date(state.now + 'T12:00:00Z');
  const dow = today.getUTCDay();
  const monday = new Date(today); monday.setUTCDate(today.getUTCDate() + (dow === 0 ? -6 : 1 - dow));

  const out: CoachToday['weekShape'] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday); d.setUTCDate(monday.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const isToday = iso === state.now;
    const dayDow = d.getUTCDay();
    const baseEasy = Math.max(3, state.volume.weeklyAvg4w / 5);
    let entry: { type: WorkoutType; distanceMi: number };
    if (dayDow === 6)                                  entry = { type: 'long',     distanceMi: round1(Math.max(8, state.volume.longestLast28Mi)) };
    else if (dayDow === 0)                             entry = { type: 'recovery', distanceMi: 4 };
    else if (dayDow === 3 && mode === 'race')          entry = { type: 'tempo',    distanceMi: 7 };
    else if (dayDow === 1)                             entry = { type: 'rest',     distanceMi: 0 };
    else                                               entry = { type: 'easy',     distanceMi: round1(baseEasy) };
    out.push({ date: iso, ...entry, isToday });
  }
  return out;
}

function round1(n: number): number { return Math.round(n * 10) / 10; }
