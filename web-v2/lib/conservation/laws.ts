/**
 * lib/conservation/laws.ts · what must still be true after a number has been
 * through the app.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY CONSERVATION AND NOT SPOT VALUES
 *
 * On 2026-08-23 a run of 11.01 miles in 5298 seconds — 8:01/mi on the watch
 * that recorded it — reached the phone as 3:37/mi, and the coach said "Easy
 * 11.0 mi at 3:37/mi. A touch quicker than the 9:22/mi easy target."
 *
 * Every test in the suite passed that day. They passed because they check that
 * a function returns the value it was written to return. Not one of them
 * checked that a number is still ITSELF after it has crossed a boundary.
 *
 * A spot assertion — "this run's pace is 481" — only ever guards the run it
 * names. A conservation law guards every run, including the ones nobody
 * thought to write a fixture for, because it is stated about the RELATIONSHIP
 * between numbers rather than about any number's value:
 *
 *     pace = time ÷ distance
 *
 * is true for an elite and for a walker, on a treadmill and on a trail, and it
 * was false on three of Faff's own screens at once. That is what a law buys.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT A SURFACE READING IS
 *
 * Every screen that prints a run reduces it to the same small set of figures.
 * A `SurfaceReading` is that set, plus the name of the screen it came from, so
 * a failure names what the runner would have seen and where.
 *
 * The laws take readings and return FINDINGS. They never throw and never
 * assert — the test file decides what is fatal. That is deliberate: a harness
 * that stops at the first failure reports one bug per run instead of all of
 * them, and the whole point here is the sweep.
 */

/** One screen's read of one run. Absent figures are null, never zero. */
export interface SurfaceReading {
  /** The screen. "poster", "run detail", "log", "recap" — runner-facing names. */
  surface: string;
  /** Miles, as this surface would print it. */
  distanceMi: number | null;
  /** Seconds, as this surface would print it. */
  timeSec: number | null;
  /** Seconds per mile, as this surface would print it. */
  paceSecPerMi: number | null;
  /** The literal strings the runner sees, when the surface formats them. */
  printed?: { distance?: string | null; time?: string | null; pace?: string | null };
}

/** The run as it was actually performed. The harness's ground truth. */
export interface RunTruth {
  distanceMi: number;
  /** Wall-clock seconds from start to finish. */
  elapsedSec: number;
  /** Seconds actually moving. Null when the run had no pause worth recording. */
  movingSec: number | null;
}

export interface Finding {
  /** Stable key, so the same defect aggregates across a sweep. */
  law: string;
  /** Which run shape. */
  shape: string;
  /** Which screen, when the finding belongs to one. */
  surface: string | null;
  /** What the runner would have seen. Written for a person, not a stack trace. */
  saw: string;
}

const f = (law: string, shape: string, surface: string | null, saw: string): Finding =>
  ({ law, shape, surface, saw });

/* ══════════════════════════════════════════════════════════════════════════
 * TOLERANCES
 *
 * Each is the smallest band that a correct implementation cannot fail, so a
 * violation is a defect and never a rounding artefact.
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Distance is printed to one decimal place, so the printed figure stands for
 * a true value within half a tenth either way. Anything outside that is a
 * different number, not a different rounding.
 */
export const DISTANCE_QUANTUM_MI = 0.1;
export const DISTANCE_TOL_MI = DISTANCE_QUANTUM_MI / 2 + 1e-9;
/** A clock is printed to the second. */
export const TIME_TOL_SEC = 1.0;
/** Pace is printed to the second per mile. */
export const PACE_TOL_SEC = 1.0;

/* ══════════════════════════════════════════════════════════════════════════
 * THE LAWS
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * LAW 1 · DISTANCE IN EQUALS DISTANCE OUT.
 *
 * Every surface that prints a distance prints the distance that was run.
 */
export function distanceConserved(shape: string, truth: RunTruth, readings: SurfaceReading[]): Finding[] {
  const out: Finding[] = [];
  for (const r of readings) {
    if (r.distanceMi == null) {
      out.push(f('DISTANCE_MISSING', shape, r.surface, `no distance printed for a ${truth.distanceMi} mi run`));
      continue;
    }
    if (Math.abs(r.distanceMi - truth.distanceMi) > DISTANCE_TOL_MI) {
      out.push(f('DISTANCE_CHANGED', shape, r.surface,
        `${r.distanceMi.toFixed(2)} mi printed for a ${truth.distanceMi.toFixed(2)} mi run`));
    }
  }
  return out;
}

/**
 * LAW 2 · THE CLOCK IS ONE OF THE RUN'S OWN CLOCKS.
 *
 * A surface may choose to print elapsed time or moving time. It may not print
 * a third number. This is the law the 2026-08-23 run broke: 39:49 was neither
 * the runner's elapsed 1:28:18 nor any moving time he ran — it was a figure a
 * third party computed and the merge stamped on.
 */
export function timeConserved(shape: string, truth: RunTruth, readings: SurfaceReading[]): Finding[] {
  const out: Finding[] = [];
  const honest = [truth.elapsedSec, truth.movingSec].filter((v): v is number => v != null);
  for (const r of readings) {
    if (r.timeSec == null) {
      out.push(f('TIME_MISSING', shape, r.surface, `no time printed for a ${clock(truth.elapsedSec)} run`));
      continue;
    }
    if (!honest.some((h) => Math.abs(r.timeSec! - h) <= TIME_TOL_SEC)) {
      out.push(f('TIME_CHANGED', shape, r.surface,
        `${clock(r.timeSec)} printed; the run's own clocks are ${honest.map(clock).join(' / ')}`));
    }
  }
  return out;
}

/**
 * LAW 3 · A PACE EQUALS ITS OWN SURFACE'S TIME OVER ITS OWN SURFACE'S DISTANCE.
 *
 * THIS IS THE ONE THAT BROKE WHILE EVERY TEST PASSED. The poster printed
 * `11.0 mi · 1:28:18 · 3:37/mi`. Eleven miles in an hour and twenty-eight
 * minutes is 8:01/mi. The screen carried its own disproof and printed the
 * number anyway.
 *
 * Note what this does NOT require: it does not require the surface to pick the
 * clock the harness would have picked. A surface printing moving time beside a
 * moving pace is correct, and so is a surface printing elapsed beside elapsed.
 * What is never correct is one of each.
 *
 * ── THE ROUNDING BAND, AND WHY IT IS NOT JUST A FUDGE FACTOR ────────────────
 *
 * A printed "4 mi" stands for anything from 3.95 to 4.05, and the pace printed
 * beside it was computed from the true distance, not the rounded one. On a
 * four-mile run that spread is worth about five seconds a mile; on a 0.6-mile
 * shakeout it is worth forty. A flat tolerance would either wave through a
 * real defect on the short run or invent one on every long run.
 *
 * So the band is derived from the display quantum rather than guessed: the
 * printed pace must be reachable from the printed clock and SOME distance the
 * printed distance could stand for. Outside that, no rounding explains it, and
 * 3:37/mi beside 1:28:18 is not within a country mile of it.
 */
export function paceMatchesOwnClock(shape: string, _truth: RunTruth, readings: SurfaceReading[]): Finding[] {
  const out: Finding[] = [];
  for (const r of readings) {
    if (r.paceSecPerMi == null || r.timeSec == null || r.distanceMi == null || r.distanceMi <= 0) continue;
    const lo = Math.max(1e-6, r.distanceMi - DISTANCE_TOL_MI);
    const hi = r.distanceMi + DISTANCE_TOL_MI;
    // Fastest pace the printed clock allows is over the LARGEST distance.
    const fastest = r.timeSec / hi - PACE_TOL_SEC;
    const slowest = r.timeSec / lo + PACE_TOL_SEC;
    if (r.paceSecPerMi < fastest || r.paceSecPerMi > slowest) {
      out.push(f('PACE_CONTRADICTS_CLOCK', shape, r.surface,
        `${fmtMi(r.distanceMi)} · ${clock(r.timeSec)} · ${pace(r.paceSecPerMi)}` +
        ` — that clock over that distance is ${pace(r.timeSec / r.distanceMi)}`));
    }
  }
  return out;
}

/**
 * LAW 4 · NO TWO SCREENS DISAGREE ABOUT THE SAME RUN.
 *
 * The 23rd showed `11.0 mi · 1:28:18 · 3:37/mi` on the poster, `39:49` on run
 * detail and `39:49` in the log. Three surfaces, three different runs.
 *
 * Distance is absolute: there is one right answer and every screen must print
 * it. Time is not — a surface may legitimately prefer the moving clock — so
 * the disagreement is only reported when the two times are not the run's two
 * honest clocks. A poster showing elapsed beside a log showing moving is a
 * product choice; a poster and a log showing two numbers that are neither is a
 * defect.
 */
export function surfacesAgree(shape: string, truth: RunTruth, readings: SurfaceReading[]): Finding[] {
  const out: Finding[] = [];
  const withDist = readings.filter((r) => r.distanceMi != null);
  for (let i = 1; i < withDist.length; i++) {
    const a = withDist[0], b = withDist[i];
    const gap = Math.abs(a.distanceMi! - b.distanceMi!);
    if (gap <= DISTANCE_TOL_MI) continue;
    // A gap of exactly one display step is two surfaces rounding the same true
    // distance in opposite directions — 3.05 mi becoming "3.1" on one screen
    // and "3.0" on another. Still worth naming, because the runner sees two
    // numbers, but it is a different defect from a distance that changed.
    out.push(f(
      gap <= DISTANCE_QUANTUM_MI + DISTANCE_TOL_MI ? 'SURFACES_ROUND_DIFFERENTLY' : 'SURFACES_DISAGREE_DISTANCE',
      shape, `${a.surface} vs ${b.surface}`,
      `${a.distanceMi!.toFixed(2)} mi reads as ${fmtMi(a.distanceMi!)} on ${a.surface} and ${fmtMi(b.distanceMi!)} on ${b.surface}`));
  }
  // Time: only flag a spread wider than the run's own elapsed-to-moving gap.
  const times = readings.filter((r) => r.timeSec != null).map((r) => r);
  if (times.length > 1) {
    const lo = times.reduce((m, r) => (r.timeSec! < m.timeSec! ? r : m));
    const hi = times.reduce((m, r) => (r.timeSec! > m.timeSec! ? r : m));
    const honestGap = truth.movingSec != null ? Math.abs(truth.elapsedSec - truth.movingSec) : 0;
    if (hi.timeSec! - lo.timeSec! > honestGap + TIME_TOL_SEC) {
      out.push(f('SURFACES_DISAGREE_TIME', shape, `${lo.surface} vs ${hi.surface}`,
        `${clock(lo.timeSec!)} on ${lo.surface}, ${clock(hi.timeSec!)} on ${hi.surface}` +
        (honestGap > 0 ? ` — the run's own pause accounts for only ${Math.round(honestGap)}s` : '')));
    }
  }
  return out;
}

/**
 * LAW 5 · SPLITS SUM TO THE RUN.
 *
 * A twelve-mile split list under an eleven-mile heading is a contradiction the
 * runner can see with their own eyes, and it is on a real row: the 2026-08-23
 * run stores 11.01 miles and twelve splits summing to 11.88.
 *
 * The tolerance is generous — a partial final split and per-split rounding are
 * both normal — but it is a fixed fraction, so a list that is a whole split
 * out cannot hide inside it.
 */
export function splitsSumToDistance(
  shape: string,
  truth: RunTruth,
  splitDistancesMi: number[] | null,
): Finding[] {
  if (splitDistancesMi == null || splitDistancesMi.length === 0) return [];
  const sum = splitDistancesMi.reduce((s, v) => s + v, 0);
  // Two percent of the run, floored at a tenth of a mile so a 3-mile run is
  // not held to an unreachable standard.
  const tol = Math.max(0.1, truth.distanceMi * 0.02);
  if (Math.abs(sum - truth.distanceMi) > tol) {
    return [f('SPLITS_DO_NOT_SUM', shape, 'run detail',
      `${splitDistancesMi.length} splits summing to ${sum.toFixed(2)} mi under a ${fmtMi(truth.distanceMi)} heading`)];
  }
  return [];
}

/**
 * LAW 6 · HEART-RATE ZONE SHARES SUM TO 100, OR THE RUN HAS NO HEART RATE.
 *
 * There is no third state. Five independently-rounded percentages can sum to
 * 98 or 102 and nothing in the app normalises them, so the band is one point.
 *
 * An all-zero object is not "no heart rate" — it is a stored placeholder, and
 * on a run that HAS an average heart rate it is a contradiction: the run
 * measured a heart rate and then spent none of its time in any zone.
 */
export function zonesSumTo100(
  shape: string,
  zones: { z1: number; z2: number; z3: number; z4: number; z5: number } | null | undefined,
  avgHr: number | null,
): Finding[] {
  if (zones == null) return [];
  const sum = zones.z1 + zones.z2 + zones.z3 + zones.z4 + zones.z5;
  if (sum === 0) {
    if (avgHr != null) {
      return [f('ZONES_EMPTY_WITH_HR', shape, 'run detail',
        `every zone 0% on a run with an average heart rate of ${avgHr} bpm`)];
    }
    return []; // A genuine no-HR run. Zeros are an honest absence.
  }
  if (Math.abs(sum - 100) > 1) {
    return [f('ZONES_DO_NOT_SUM', shape, 'run detail', `zone shares sum to ${sum}%, not 100%`)];
  }
  return [];
}

/**
 * LAW 7 · THE PARTS DO NOT EXCEED THE WHOLE.
 *
 * Phase distances and durations sum to no more than the run's own. They may
 * legitimately sum to LESS — a watch that stopped inside the last rep, a run
 * with untracked warm-up — so only the overshoot is a finding.
 */
export function phasesWithinRun(
  shape: string,
  truth: RunTruth,
  phases: Array<{ actualDistanceMi?: number | null; actualDurationSec?: number | null }> | null,
): Finding[] {
  if (phases == null || phases.length === 0) return [];
  const out: Finding[] = [];
  const dist = phases.reduce((s, p) => s + (p.actualDistanceMi ?? 0), 0);
  const dur = phases.reduce((s, p) => s + (p.actualDurationSec ?? 0), 0);
  if (dist > truth.distanceMi + Math.max(0.1, truth.distanceMi * 0.02)) {
    out.push(f('PHASES_EXCEED_DISTANCE', shape, 'run detail',
      `${phases.length} phases summing to ${dist.toFixed(2)} mi inside a ${fmtMi(truth.distanceMi)} run`));
  }
  if (dur > truth.elapsedSec + 5) {
    out.push(f('PHASES_EXCEED_TIME', shape, 'run detail',
      `${phases.length} phases summing to ${clock(dur)} inside a ${clock(truth.elapsedSec)} run`));
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * FORMATTERS — for the FINDING TEXT ONLY.
 *
 * These exist so a failure reads like a screen and not like a struct. They are
 * deliberately NOT the app's formatters: a harness that borrows the code under
 * test to describe the code under test can print a defect back as if it were
 * correct. The app's real formatters are exercised through their own surfaces.
 * ═══════════════════════════════════════════════════════════════════════ */

export function clock(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
    : `${m}:${String(ss).padStart(2, '0')}`;
}

export function pace(sPerMi: number): string {
  const s = Math.round(sPerMi);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}/mi`;
}

export function fmtMi(mi: number): string {
  return `${(Math.round(mi * 10) / 10).toFixed(1)} mi`;
}
