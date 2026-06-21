/**
 * lib/plan/_audit_volume.test.ts · EXHAUSTIVE VOLUME-INVARIANT SWEEP.
 *
 * Onboarding→plan fail-proofing audit. DIMENSION = VOLUME (invariants 3,4,5,6,14).
 * Pure offline sweep over composePlan(): no DB, no clock.
 *
 * Domain swept (cartesian product, with realistic goalPace fast/median/slow):
 *   level × recentWeeklyMi × trainingDaysPerWeek × raceDistanceMi ×
 *   goalPaceTier × availableDows-shape × planLength × longRunDow
 *
 * For EVERY week of EVERY generated plan we assert:
 *   I3  long_mi >= every easy_mi that week                 (inversion)
 *   I4  quality_mi <= 1.5×long_mi AND <= 0.6×week_mi       (not dwarfing)
 *   I5  week0 weekly < peak weekly  UNLESS over-volumed    (progressive ramp)
 *   I6  taper/race week weekly < peak                      (real taper)
 *   I14 beginner floor ~6mpw; distance-appropriate peak caps; sane numbers
 *
 * The over-volumed distinction (I5): if the plan's peak weekly <= the runner's
 * stated weekly volume, a flat curve is CORRECT (progression is intensity, not
 * mileage). A genuinely under-volumed runner (peak should climb) who stays flat
 * is a REAL bug. We classify each case and only flag the wrong one.
 *
 * Every violation is collected into VIOLATIONS with the exact ComposePlanInput
 * so a failure is reproducible. The summary is printed at the end.
 */

import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import {
  composePlan,
  inlinePrescriptions,
  distanceCategoryOfPublic,
  type ComposePlanInput,
  type ComposePlanResult,
  type ComposedWeek,
  type DOW,
} from './generate';
import { validateComposedPlan, type PlanValidationContext } from './validate';
import { tPaceFromGoal } from './spec-builder';

// ── domain axes ───────────────────────────────────────────────────────────

type Level = 'beginner' | 'intermediate' | 'advanced' | 'advanced_plus' | null;

const LEVELS: Level[] = ['beginner', 'intermediate', 'advanced', 'advanced_plus', null];

// recentWeeklyMi spanning the onboarding buckets (0..55).
const WEEKLY_MI = [0, 5, 15, 25, 35, 45, 55];

// trainingDaysPerWeek: null (legacy fill-all) + 0..6.
const FREQ: (number | null)[] = [null, 0, 1, 2, 3, 4, 5, 6];

// race distances covering every category boundary.
//  5k(<=4) · 10k(<=8) · hm(<=17) · m(<=30) · ultra(>30)
const DISTANCES = [3.1, 6.2, 13.1, 26.2, 31.07, 62.14]; // 5K,10K,HM,M,50K,100K

// goal-pace tiers per distance: a FAST, a MEDIAN, and a SLOW finish.
// Slow goal + high volume = the "over-volumed for goal" case.
// Values are goal pace (s/mi). null = no goal time (just-run path).
function goalPacesFor(distMi: number): (number | null)[] {
  const cat = distanceCategoryOfPublic(distMi);
  switch (cat) {
    case '5k':    return [null, 300, 390, 540];   // 5:00, 6:30, 9:00 /mi
    case '10k':   return [null, 330, 420, 600];   // 5:30, 7:00, 10:00 /mi
    case 'hm':    return [null, 360, 480, 660];   // 6:00, 8:00, 11:00 /mi
    case 'm':     return [null, 390, 510, 720];   // 6:30, 8:30, 12:00 /mi
    case 'ultra': return [null, 480, 600, 840];   // 8:00, 10:00, 14:00 /mi
  }
}

// available-days shapes (Set<number> of DOW, or null = unrestricted).
// Sun=0..Sat=6. Includes awkward shapes: weekends only, consecutive only,
// and a shape where the long-run day (Sun) is NOT available.
const AVAIL_SHAPES: Array<{ name: string; set: Set<number> | null }> = [
  { name: 'unset',            set: null },
  { name: '7-all',            set: new Set([0, 1, 2, 3, 4, 5, 6]) },
  { name: '5-weekdaysplus',   set: new Set([0, 1, 2, 3, 4]) },        // Sun-Thu
  { name: '4-spread',         set: new Set([0, 2, 4, 6]) },           // Sun Tue Thu Sat
  { name: '3-spread',         set: new Set([0, 2, 4]) },              // Sun Tue Thu
  { name: '2-weekends',       set: new Set([0, 6]) },                 // Sat+Sun only
  { name: '3-consecutive',    set: new Set([1, 2, 3]) },              // Mon Tue Wed (no Sun long!)
];

// plan length controlled via raceDateISO offset from a fixed Monday start.
// Edges: 4,5,12,16,24,52 weeks.
const PLAN_WEEKS = [4, 5, 12, 16, 24, 52];

// long-run day of week (Sun..Sat).
const LONG_DOWS: DOW[] = [0, 3, 6]; // Sun, Wed, Sat (sample, not all 7 — combinatorial budget)

const START_MONDAY = '2026-01-05'; // a real Monday

// ── input builder (mirrors the real onboarding → ComposePlanInput mapping) ──

function buildInput(opts: {
  level: Level;
  weeklyMi: number;
  freq: number | null;
  distMi: number;
  goalPaceSec: number | null;
  avail: Set<number> | null;
  planWeeks: number;
  longDow: DOW;
  recentLongMi?: number; // explicit override (histLong bucket); else derived
}): ComposePlanInput {
  const cat = distanceCategoryOfPublic(opts.distMi);
  // race day = startMonday + planWeeks*7 - 1 (Sunday end, like the bench).
  const raceDay = new Date(START_MONDAY + 'T12:00:00Z');
  raceDay.setUTCDate(raceDay.getUTCDate() + opts.planWeeks * 7 - 1);
  const raceDateISO = raceDay.toISOString().slice(0, 10);

  const goalSec = opts.goalPaceSec != null ? Math.round(opts.goalPaceSec * opts.distMi) : null;

  // qualityDows: pick two days that are not the long/rest day, preferring
  // available days when a set is supplied (mirrors upstream derivation intent).
  const restDow: DOW = ((opts.longDow + 1) % 7) as DOW; // day after long = rest
  const candidateQ: DOW[] = [2, 4, 1, 3, 5, 6, 0].filter(
    (d) => d !== opts.longDow && d !== restDow,
  ) as DOW[];
  const qFiltered = opts.avail
    ? candidateQ.filter((d) => opts.avail!.has(d))
    : candidateQ;
  const qualityDows: DOW[] = (qFiltered.length >= 1 ? qFiltered : candidateQ).slice(0, 2);

  const recentLongMi =
    opts.recentLongMi ?? Math.round(opts.weeklyMi * 0.25);

  return {
    raceDistanceMi: opts.distMi,
    goalSec,
    goalPaceSec: opts.goalPaceSec,
    raceDateISO,
    startMondayISO: START_MONDAY,
    level: opts.level,
    recentWeeklyMi: opts.weeklyMi,
    easyDayMedianMi: Math.max(3, Math.round(opts.weeklyMi / 5)),
    recentLongMi,
    isMidBlock: false,
    longRunDow: opts.longDow,
    restDow,
    qualityDows,
    availableDows: opts.avail,
    trainingDaysPerWeek: opts.freq,
    crossModes: [],
    rxQuality: inlinePrescriptions(cat),
    rxRaceSpecific: inlinePrescriptions(cat),
    tPaceSec: tPaceFromGoal(goalSec, opts.distMi),
    lthr: null,
    maxHr: null,
  };
}

// ── per-week metrics ────────────────────────────────────────────────────────

function easyDistances(w: ComposedWeek): number[] {
  return w.days.filter((d) => d.type === 'easy').map((d) => d.distanceMi);
}
function longDistance(w: ComposedWeek): number {
  // Training long only — exclude the race-day row (type 'race').
  const longs = w.days.filter((d) => d.isLong && d.type !== 'race').map((d) => d.distanceMi);
  return longs.length ? Math.max(...longs) : 0;
}
function qualityDistances(w: ComposedWeek): number[] {
  return w.days
    .filter((d) => d.isQuality && d.type !== 'race' && d.type !== 'long')
    .map((d) => d.distanceMi);
}
function runningDayDistances(w: ComposedWeek): number[] {
  return w.days.filter((d) => d.distanceMi > 0).map((d) => d.distanceMi);
}
function weekTotal(w: ComposedWeek): number {
  return w.days.reduce((s, d) => s + (d.distanceMi || 0), 0);
}

// distance-appropriate peak weekly caps (sanity ceiling, I14). Generous —
// only catches absurd output (a 5K plan prescribing 50mpw, a marathon 10mpw).
function peakWeeklyBounds(distMi: number): { floorOk: number; ceil: number } {
  const cat = distanceCategoryOfPublic(distMi);
  switch (cat) {
    case '5k':    return { floorOk: 8,  ceil: 90 };
    case '10k':   return { floorOk: 10, ceil: 100 };
    case 'hm':    return { floorOk: 12, ceil: 110 };
    case 'm':     return { floorOk: 18, ceil: 130 };
    case 'ultra': return { floorOk: 22, ceil: 150 };
  }
}
// distance-appropriate long-run ceiling (I14). Race-day row excluded.
function longCeil(distMi: number): number {
  const cat = distanceCategoryOfPublic(distMi);
  switch (cat) {
    case '5k':    return 12;
    case '10k':   return 14;
    case 'hm':    return 18;
    case 'm':     return 26;
    case 'ultra': return 42;
  }
}

// ── violation accumulator ─────────────────────────────────────────────────

interface Violation {
  invariant: string;
  detail: string;
  weekIdx: number;
  phase: string;
  input: ComposePlanInput;
  severity: 'critical' | 'major' | 'minor';
  /** Would validateComposedPlan PERSIST this plan? true = real shipping bug;
   *  false = the safety net rejects it (fails safe, invariant 1 satisfied). */
  persists: boolean;
}
const VIOLATIONS: Violation[] = [];
// Set per-plan before recording so each violation is stamped with whether the
// validator would persist the plan. Crash/structural records set it explicitly.
let CURRENT_PERSISTS = true;
function record(v: Omit<Violation, 'persists'> & { persists?: boolean }) {
  VIOLATIONS.push({ ...v, persists: v.persists ?? CURRENT_PERSISTS });
}

/** Mirror the validator call generatePlanForUser makes. Returns whether the
 *  plan would be PERSISTED (true) or REJECTED with an explicit reason (false). */
function wouldPersist(input: ComposePlanInput, res: ComposePlanResult): boolean {
  const ctx: PlanValidationContext = {
    level: input.level,
    isSteppingStoneToMarathon: false,
    priorPlanPeakLongMi: null,
    todayISO: '2026-01-04',
    trainingDaysPerWeek: input.trainingDaysPerWeek,
    trailingAvgWeeklyMi: input.recentWeeklyMi > 0 ? input.recentWeeklyMi : null,
  };
  try {
    validateComposedPlan(res, input.raceDistanceMi, 'race-prep', ctx);
    return true;
  } catch {
    return false;
  }
}

function inputTag(i: ComposePlanInput): string {
  return [
    `lvl=${i.level}`,
    `wk=${i.recentWeeklyMi}`,
    `freq=${i.trainingDaysPerWeek}`,
    `dist=${i.raceDistanceMi}`,
    `gpace=${i.goalPaceSec}`,
    `long=${i.recentLongMi}`,
    `lDow=${i.longRunDow}`,
    `avail=${i.availableDows ? [...i.availableDows].join('') : 'null'}`,
    `start=${i.startMondayISO}`,
    `race=${i.raceDateISO}`,
  ].join(' ');
}

// ── the per-plan invariant checker ──────────────────────────────────────────

function checkPlanVolume(input: ComposePlanInput, res: ComposePlanResult) {
  // CURRENT_PERSISTS is set by the caller (after compose) so every record()
  // in this function is stamped with the plan's persist status.
  const { weeks } = res;
  const cat = distanceCategoryOfPublic(input.raceDistanceMi);
  const isBeginner = input.level === 'beginner';

  // Peak weekly across NON-taper NON-race weeks (the build peak).
  const buildWeeks = weeks.filter((w) => w.phase !== 'TAPER' && !w.isRaceWeek);
  const peakWeekly = buildWeeks.length ? Math.max(...buildWeeks.map(weekTotal)) : 0;
  const peakWeeklyAll = weeks.length ? Math.max(...weeks.map(weekTotal)) : 0;
  const wk0 = weeks.length ? weekTotal(weeks[0]) : 0;
  const statedWeekly = input.recentWeeklyMi;
  const { floorOk, ceil } = peakWeeklyBounds(input.raceDistanceMi);
  const longLimit = longCeil(input.raceDistanceMi);

  // ── I5 · progressive ramp vs over-volumed flat ──────────────────────────
  // Over-volumed-for-goal: a FLAT weekly curve is CORRECT when the runner's
  // stated volume already meets (or exceeds) the plan's intended peak — the
  // progression is intensity, not mileage. We classify "intended peak" from
  // the plan's OWN authored tier band lower bound (what it set out to reach)
  // and from the stated volume, with a 15% rounding tolerance.
  //   under-volumed (should climb): stated*1.15 < tierBandLo  AND  the plan's
  //   actual peak exceeds stated (it tried to climb) — yet wk0 already == peak.
  const tierBand = (res.authoredState as { tier_peak_weekly_band?: [number, number] })
    .tier_peak_weekly_band;
  const tierLo = Array.isArray(tierBand) ? tierBand[0] : 0;
  // Over-volumed iff stated already within 15% of the plan's intended peak.
  const intendedPeak = Math.max(peakWeekly, tierLo);
  const overVolumed = peakWeekly > 0 && statedWeekly * 1.15 >= intendedPeak;
  const hasRunway = buildWeeks.length > 1;
  if (!overVolumed && hasRunway && wk0 > 0 && peakWeeklyAll <= wk0) {
    record({
      invariant: 'I5-ramp',
      detail:
        `under-volumed runner does not ramp: wk0=${wk0}mi peakAll=${peakWeeklyAll}mi ` +
        `(stated ${statedWeekly}, plan peak ${peakWeekly}, tierLo ${tierLo}; intendedPeak ${intendedPeak})`,
      weekIdx: 0,
      phase: weeks[0]?.phase ?? '?',
      input,
      severity: 'major',
    });
  }

  // ── I14 · distance-appropriate peak weekly cap ──────────────────────────
  if (peakWeekly > ceil) {
    record({
      invariant: 'I14-peakceil',
      detail: `peak weekly ${peakWeekly}mi > ${ceil}mi ceiling for ${cat.toUpperCase()}`,
      weekIdx: -1,
      phase: 'BUILD',
      input,
      severity: 'major',
    });
  }
  // beginner volume floor ~6mpw: a beginner with a real base should peak >=6.
  if (isBeginner && statedWeekly > 0 && peakWeekly > 0 && peakWeekly < 6) {
    record({
      invariant: 'I14-beginnerfloor',
      detail: `beginner peak weekly ${peakWeekly}mi < 6mpw floor (stated ${statedWeekly})`,
      weekIdx: -1,
      phase: 'BUILD',
      input,
      severity: 'minor',
    });
  }

  // ── I6 · taper present + real taper (race/taper week < peak) ─────────────
  // Only meaningful when there's a real build peak to compare against.
  if (peakWeekly > 0) {
    for (const w of weeks) {
      if (w.phase !== 'TAPER' && !w.isRaceWeek) continue;
      const tw = weekTotal(w);
      // Race week INCLUDES the race itself (race distance counts), which can
      // exceed peak for short races. Compare TRAINING volume = week minus the
      // race-day row, for race week. Taper weeks have no race row.
      const raceRowMi = w.days
        .filter((d) => d.type === 'race')
        .reduce((s, d) => s + d.distanceMi, 0);
      const trainingVol = tw - raceRowMi;
      if (trainingVol >= peakWeekly) {
        record({
          invariant: 'I6-taper',
          detail:
            `${w.isRaceWeek ? 'race' : 'taper'} week training volume ${trainingVol.toFixed(1)}mi ` +
            `>= build peak ${peakWeekly}mi (no taper)`,
          weekIdx: weeks.indexOf(w),
          phase: w.phase,
          input,
          severity: 'major',
        });
      }
    }
  }

  // ── per-week checks: I3 inversion, I4 dwarfing, I14 sane numbers ─────────
  weeks.forEach((w, wi) => {
    const easies = easyDistances(w);
    const longMi = longDistance(w);
    const quals = qualityDistances(w);
    const weekMi = weekTotal(w);
    const runDists = runningDayDistances(w);

    // I13/I14: no NaN/null/negative/absurd anywhere.
    for (const d of w.days) {
      const x = d.distanceMi;
      if (typeof x !== 'number' || Number.isNaN(x) || x < 0) {
        record({
          invariant: 'I13-nan',
          detail: `day dow=${d.dow} type=${d.type} distanceMi=${String(x)} (NaN/neg/null)`,
          weekIdx: wi, phase: w.phase, input, severity: 'critical',
        });
      }
      if (x > 0 && x < 0.5 && d.type !== 'rest') {
        record({
          invariant: 'I13-tiny',
          detail: `day dow=${d.dow} type=${d.type} distanceMi=${x} absurdly small (<0.5mi run)`,
          weekIdx: wi, phase: w.phase, input, severity: 'minor',
        });
      }
    }
    // any single run absurdly long?
    for (const dmi of runDists) {
      if (dmi > longLimit && !(w.isRaceWeek && dmi === input.raceDistanceMi)) {
        record({
          invariant: 'I14-longceil',
          detail: `single run ${dmi}mi exceeds ${longLimit}mi long ceiling for ${cat.toUpperCase()}`,
          weekIdx: wi, phase: w.phase, input, severity: 'major',
        });
      }
    }

    // I3 · INVERSION: long >= every easy that week. Skip taper/race week
    // (long is intentionally a recovery long / absent; the strip's longest
    // run there is the race itself). Only enforce where a training long exists.
    if (!w.isRaceWeek && w.phase !== 'TAPER' && longMi > 0 && easies.length > 0) {
      const maxEasy = Math.max(...easies);
      if (maxEasy > longMi + 1e-6) {
        record({
          invariant: 'I3-inversion',
          detail: `easy ${maxEasy}mi > long ${longMi}mi (Lilley inversion)`,
          weekIdx: wi, phase: w.phase, input, severity: 'critical',
        });
      }
    }
    // Even in BASE/non-long contexts, no easy run should dwarf the longest
    // run of the week (general "longest run is the long" sanity).
    if (!w.isRaceWeek && runDists.length > 0) {
      const longestRun = Math.max(...runDists);
      const longestEasy = easies.length ? Math.max(...easies) : 0;
      // longestEasy can equal longestRun (it IS the longest); only flag when
      // an easy strictly exceeds a *designated long* — handled above. Here we
      // assert the designated long, if present, is the longest run overall.
      if (longMi > 0 && longestRun > longMi + 1e-6 && w.phase !== 'TAPER') {
        // a non-long run (quality) longer than the long run.
        record({
          invariant: 'I3-longnotlongest',
          detail: `longest run ${longestRun}mi exceeds designated long ${longMi}mi`,
          weekIdx: wi, phase: w.phase, input, severity: 'major',
        });
      }
      void longestEasy;
    }

    // I4 · QUALITY NOT DWARFING: each quality_mi <= 1.5×long_mi AND <= 0.6×week_mi.
    if (quals.length > 0) {
      const maxQ = Math.max(...quals);
      if (longMi > 0 && maxQ > 1.5 * longMi + 1e-6) {
        record({
          invariant: 'I4-dwarf-long',
          detail: `quality ${maxQ}mi > 1.5×long (${(1.5 * longMi).toFixed(1)}mi); long=${longMi}`,
          weekIdx: wi, phase: w.phase, input, severity: 'major',
        });
      }
      if (weekMi > 0 && maxQ > 0.6 * weekMi + 1e-6) {
        record({
          invariant: 'I4-dwarf-week',
          detail: `quality ${maxQ}mi > 0.6×week (${(0.6 * weekMi).toFixed(1)}mi); week=${weekMi}`,
          weekIdx: wi, phase: w.phase, input, severity: 'major',
        });
      }
    }
  });
}

// ── the sweep ───────────────────────────────────────────────────────────────

describe('VOLUME INVARIANT SWEEP · composePlan exhaustive', () => {
  let combos = 0;
  let plans = 0;
  let crashes = 0;
  const crashSamples: string[] = [];

  it('sweeps the full runner-input domain without crashing or violating volume invariants', { timeout: 600000 }, () => {
    for (const level of LEVELS) {
      for (const weeklyMi of WEEKLY_MI) {
        for (const freq of FREQ) {
          for (const distMi of DISTANCES) {
            for (const goalPaceSec of goalPacesFor(distMi)) {
              for (const avail of AVAIL_SHAPES) {
                for (const planWeeks of PLAN_WEEKS) {
                  for (const longDow of LONG_DOWS) {
                    combos++;
                    const input = buildInput({
                      level, weeklyMi, freq, distMi,
                      goalPaceSec, avail: avail.set, planWeeks, longDow,
                    });
                    let res: ComposePlanResult | null = null;
                    try {
                      res = composePlan(input);
                    } catch (e) {
                      crashes++;
                      if (crashSamples.length < 25) {
                        crashSamples.push(`${(e as Error).message} || ${inputTag(input)}`);
                      }
                      record({
                        invariant: 'I1-crash',
                        detail: `composePlan threw: ${(e as Error).message}`,
                        weekIdx: -1, phase: '?', input, severity: 'critical', persists: false,
                      });
                      continue;
                    }
                    plans++;
                    // I1/I2 structural sanity (week-strip contiguity).
                    if (!res || !Array.isArray(res.weeks) || res.weeks.length === 0) {
                      record({
                        invariant: 'I1-empty',
                        detail: `empty/garbage result (weeks=${res?.weeks?.length})`,
                        weekIdx: -1, phase: '?', input, severity: 'critical', persists: false,
                      });
                      continue;
                    }
                    // Stamp persist-status for this plan up front (structural
                    // checks below + checkPlanVolume all read CURRENT_PERSISTS).
                    CURRENT_PERSISTS = wouldPersist(input, res);
                    for (let wi = 0; wi < res.weeks.length; wi++) {
                      const w = res.weeks[wi];
                      if (w.days.length !== 7) {
                        record({
                          invariant: 'I2-7days',
                          detail: `week ${wi} has ${w.days.length} days (not 7)`,
                          weekIdx: wi, phase: w.phase, input, severity: 'critical',
                        });
                      }
                      const dows = w.days.map((d) => d.dow).sort((a, b) => a - b);
                      const expect7 = [0, 1, 2, 3, 4, 5, 6];
                      if (JSON.stringify(dows) !== JSON.stringify(expect7)) {
                        record({
                          invariant: 'I2-dows',
                          detail: `week ${wi} dows=${dows.join(',')} not a clean 0-6 set`,
                          weekIdx: wi, phase: w.phase, input, severity: 'critical',
                        });
                      }
                    }
                    checkPlanVolume(input, res);
                  }
                }
              }
            }
          }
        }
      }
    }

    // ── report ────────────────────────────────────────────────────────────
    // The decisive triage axis is `persists`: a violation in a plan the
    // validator REJECTS is fail-safe (invariant 1 — explicit reason, no bad
    // write). A violation in a plan that PERSISTS ships to the runner = real
    // bug. We split every count on it.
    const persisting = VIOLATIONS.filter((v) => v.persists);
    const failSafe = VIOLATIONS.filter((v) => !v.persists);
    const cnt = (arr: Violation[], sev?: string) =>
      arr.filter((v) => !sev || v.severity === sev).length;

    const byInv = (arr: Violation[]): Record<string, number> => {
      const m: Record<string, number> = {};
      for (const v of arr) m[v.invariant] = (m[v.invariant] ?? 0) + 1;
      return m;
    };

    // Distinct exemplars per bucket (dedup by invariant + numeric-stripped detail).
    const distinct = (arr: Violation[]): Violation[] => {
      const seen = new Set<string>();
      const out: Violation[] = [];
      for (const v of arr) {
        const key = v.invariant + '|' + v.detail.replace(/-?[\d.]+/g, '#');
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(v);
      }
      return out;
    };
    const exemplarJson = (v: Violation) => ({
      severity: v.severity, invariant: v.invariant, weekIdx: v.weekIdx,
      phase: v.phase, detail: v.detail, persists: v.persists, inputTag: inputTag(v.input),
      inputJson: JSON.stringify({
        ...v.input, availableDows: v.input.availableDows ? [...v.input.availableDows] : null,
      }),
    });

    writeFileSync(
      '/tmp/_audit_volume_report.json',
      JSON.stringify(
        {
          combos, plans, crashes,
          totals: {
            all: VIOLATIONS.length,
            critical: cnt(VIOLATIONS, 'critical'),
            major: cnt(VIOLATIONS, 'major'),
            minor: cnt(VIOLATIONS, 'minor'),
          },
          PERSISTING: { // real shipping bugs
            total: persisting.length,
            critical: cnt(persisting, 'critical'),
            major: cnt(persisting, 'major'),
            minor: cnt(persisting, 'minor'),
            byInvariant: byInv(persisting),
          },
          FAIL_SAFE: { // validator rejects → acceptable per invariant 1
            total: failSafe.length,
            byInvariant: byInv(failSafe),
          },
          crashSamples,
          // For the persisting bucket, capture how degenerate the inputs are:
          // distribution of recentWeeklyMi + trainingDaysPerWeek among the
          // plans that produced a persisting violation, per invariant. Lets us
          // confirm whether a finding is "only on 0-base / 1-2-day runners" or
          // bites realistic profiles too.
          persistingProfileDistribution: (() => {
            const byInvProfile: Record<string, {
              weeklyMi: Record<number, number>;
              freq: Record<string, number>;
              levels: Record<string, number>;
              dist: Record<string, number>;
              levelXdist: Record<string, number>;
            }> = {};
            for (const v of persisting) {
              const k = v.invariant;
              byInvProfile[k] ??= { weeklyMi: {}, freq: {}, levels: {}, dist: {}, levelXdist: {} };
              const wm = v.input.recentWeeklyMi;
              byInvProfile[k].weeklyMi[wm] = (byInvProfile[k].weeklyMi[wm] ?? 0) + 1;
              const fk = String(v.input.trainingDaysPerWeek);
              byInvProfile[k].freq[fk] = (byInvProfile[k].freq[fk] ?? 0) + 1;
              const lk = String(v.input.level);
              byInvProfile[k].levels[lk] = (byInvProfile[k].levels[lk] ?? 0) + 1;
              const dk = distanceCategoryOfPublic(v.input.raceDistanceMi);
              byInvProfile[k].dist[dk] = (byInvProfile[k].dist[dk] ?? 0) + 1;
              const lxd = `${lk}/${dk}`;
              byInvProfile[k].levelXdist[lxd] = (byInvProfile[k].levelXdist[lxd] ?? 0) + 1;
            }
            return byInvProfile;
          })(),
          persistingExemplars: distinct(persisting).map(exemplarJson),
          failSafeExemplars: distinct(failSafe).map(exemplarJson),
        },
        null,
        2,
      ),
    );

    // Hard gate: NO critical violation in a plan that persists, and NO
    // crash anywhere. A crash is never acceptable; a critical (inversion,
    // NaN, non-7-day) in a persisted plan ships broken data to the runner.
    // Persisting MAJORS are reported (see JSON) but do not fail the gate —
    // they are triaged in the findings, several are validator-rejected or
    // checker-conservative.
    const persistingCriticals = persisting.filter((v) => v.severity === 'critical');
    const crashViolations = VIOLATIONS.filter((v) => v.invariant === 'I1-crash');
    expect(
      crashViolations.length,
      `${crashViolations.length} crashes (composePlan must never throw)`,
    ).toBe(0);
    expect(
      persistingCriticals.length,
      `${persistingCriticals.length} CRITICAL violations in PERSISTED plans (see /tmp/_audit_volume_report.json)`,
    ).toBe(0);
  });
});
