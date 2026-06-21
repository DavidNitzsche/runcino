/**
 * lib/plan/_audit_periodization.test.ts · ADVERSARIAL PERIODIZATION SWEEP.
 *
 * Audit dimension: PERIODIZATION BY LEVEL + DAVID-PROTECTION.
 * Invariants under test (from the onboarding→plan fail-proof audit):
 *
 *   10. Base-building for beginners — a beginner plan must NOT contain
 *       structured interval reps (5×800m, I/R-pace reps). Light tempo /
 *       fartlek / strides only. Cross-checks isBaseBuildingPlan().
 *   11. Non-beginners get real structured sessions appropriate to the tier.
 *   12. PROTECTED — an advanced/advanced_plus MARATHON runner's plan must be
 *       byte-stable. Any structural drift is CRITICAL. The advanced-marathon
 *       persona (David's class) is snapshotted whole.
 *
 * Substrate: composePlan() — pure, no DB, no clock. We construct
 * ComposePlanInput directly and sweep level × distance × volume × goalPace.
 *
 * This file is read by the workflow as an adversarial probe. It is designed
 * to FAIL LOUDLY if any beginner plan leaks rep-work, if any non-beginner
 * plan goes soft, or if David's marathon plan drifts.
 */

import { describe, it, expect } from 'vitest';
import {
  composePlan,
  inlinePrescriptions,
  distanceCategoryOfPublic,
  type ComposePlanInput,
  type ComposePlanResult,
  type DOW,
} from './generate';
import { tPaceFromGoal } from './spec-builder';
import { isBaseBuildingPlan } from './plan-templates';

type LevelKey = 'beginner' | 'intermediate' | 'advanced' | 'advanced_plus' | null;

// ── structured-rep detector ────────────────────────────────────────────────
// The I/R "machine" vocabulary a beginner must never see:
//   · "5×800m", "4×1km", "6 x 1200m", "3×1mi"  (structured rep count × dist)
//   · "@ I pace" / "I-pace" / "@ R" / "@ R pace" (VO2max / rep zones)
//   · "reps" in a structured count
// Light fartlek ("5×1 min surges @ T effort") is ALLOWED — it is time-based
// surges at T effort, not distance reps at I/R. We must NOT flag those.
//
// Distinguisher: a STRUCTURED rep is "<count> × <distance>m|km|mi @ <zone>".
// A light fartlek is "<count> × <N> min surges @ T effort". So we match
// distance-unit reps and explicit I/R zone tags, and explicitly exempt the
// "min surges @ T effort" form.

const DIST_REP = /\b\d+\s*[×x]\s*\d+\s*(?:m|km|mi)\b/i;   // 5×800m, 4×1km, 3×1mi
const I_R_ZONE = /@\s*I\b|\bI[-\s]?pace\b|@\s*R\b|\bR[-\s]?pace\b|@\s*I[-–]T\b/i;
const MIN_SURGE_FARTLEK = /\d+\s*[×x]\s*\d+\s*min\s+surges?\s+@\s*T\s+effort/i;

/** True when a sub_label encodes a STRUCTURED interval/rep workout (I/R machine). */
function hasStructuredReps(subLabel: string | null | undefined): boolean {
  if (!subLabel) return false;
  // Light fartlek "N×M min surges @ T effort" is explicitly NOT a structured rep.
  if (MIN_SURGE_FARTLEK.test(subLabel)) return false;
  return DIST_REP.test(subLabel) || I_R_ZONE.test(subLabel);
}

/** Type-level rep markers: a 'intervals' day is by definition VO2/I-pace rep work. */
function isRepType(type: string): boolean {
  return type === 'intervals';
}

// The race-week TUNE-UP (race_week_tuneup) is a deliberate race-pace REHEARSAL
// authored ~5 days out, IDENTICALLY for every experience level (see generate.ts
// layoutWeek race-week branch — "4×1km @ race pace · 90s jog" for long races).
// It is NOT structured I/R training and is out of scope for invariant 10
// (which governs the BUILD-phase quality vocabulary). The shakeout strides day
// is likewise a universal touch. So invariant-10 scope = quality days that are
// NOT the race-week tune-up. We assert this distinction explicitly rather than
// matching it loosely, so a real beginner I/R leak in a BUILD phase still fires.
const TUNEUP_TYPES = new Set(['race_week_tuneup', 'shakeout']);

// ── input builder ───────────────────────────────────────────────────────────
// Fixed Monday start so layouts are deterministic. Race day = Sunday.
const START_MONDAY = '2026-01-05'; // a Monday

function buildInput(opts: {
  level: LevelKey;
  raceDistanceMi: number;
  goalSec: number | null;
  weeksOut: number;
  recentWeeklyMi: number;
  recentLongMi?: number;
  trainingDaysPerWeek?: number | null;
  qualityDows?: DOW[];
  availableDows?: Set<number> | null;
  longRunDow?: DOW;
  restDow?: DOW;
}): ComposePlanInput {
  const cat = distanceCategoryOfPublic(opts.raceDistanceMi);
  const raceDay = new Date(START_MONDAY + 'T12:00:00Z');
  raceDay.setUTCDate(raceDay.getUTCDate() + opts.weeksOut * 7 - 1);
  const raceDateISO = raceDay.toISOString().slice(0, 10);
  const goalPaceSec = opts.goalSec != null ? Math.round(opts.goalSec / opts.raceDistanceMi) : null;
  return {
    raceDistanceMi: opts.raceDistanceMi,
    goalSec: opts.goalSec,
    goalPaceSec,
    raceDateISO,
    startMondayISO: START_MONDAY,
    level: opts.level,
    recentWeeklyMi: opts.recentWeeklyMi,
    easyDayMedianMi: Math.max(3, Math.round(opts.recentWeeklyMi / 5)),
    recentLongMi: opts.recentLongMi ?? Math.round(opts.recentWeeklyMi * 0.25),
    isMidBlock: false,
    longRunDow: (opts.longRunDow ?? 0) as DOW,
    restDow: (opts.restDow ?? 6) as DOW,
    qualityDows: opts.qualityDows ?? ([2, 4] as DOW[]),
    availableDows: opts.availableDows ?? null,
    trainingDaysPerWeek: opts.trainingDaysPerWeek ?? null,
    crossModes: [],
    rxQuality: inlinePrescriptions(cat),
    rxRaceSpecific: inlinePrescriptions(cat),
    tPaceSec: tPaceFromGoal(opts.goalSec, opts.raceDistanceMi),
    lthr: null,
    maxHr: null,
  };
}

// ── sweep dimensions ──────────────────────────────────────────────────────
// distance × representative goal (fast / median / slow per distance).
const DISTANCES: Array<{ mi: number; name: string; goals: Array<{ sec: number | null; tag: string }> }> = [
  { mi: 3.1, name: '5K', goals: [
    { sec: 1020, tag: 'fast(17:00)' }, { sec: 1500, tag: 'median(25:00)' }, { sec: 2100, tag: 'slow(35:00)' }, { sec: null, tag: 'no-goal' },
  ] },
  { mi: 6.2, name: '10K', goals: [
    { sec: 2100, tag: 'fast(35:00)' }, { sec: 3000, tag: 'median(50:00)' }, { sec: 4200, tag: 'slow(70:00)' }, { sec: null, tag: 'no-goal' },
  ] },
  { mi: 13.1, name: 'HM', goals: [
    { sec: 4800, tag: 'fast(1:20)' }, { sec: 7080, tag: 'median(1:58)' }, { sec: 9000, tag: 'slow(2:30)' }, { sec: null, tag: 'no-goal' },
  ] },
  { mi: 26.2, name: 'M', goals: [
    { sec: 9000, tag: 'fast(2:30)' }, { sec: 12600, tag: 'median(3:30)' }, { sec: 18000, tag: 'slow(5:00)' }, { sec: null, tag: 'no-goal' },
  ] },
  { mi: 31.0, name: '50K', goals: [
    { sec: 13500, tag: 'fast(3:45)' }, { sec: 18000, tag: 'median(5:00)' }, { sec: 27000, tag: 'slow(7:30)' }, { sec: null, tag: 'no-goal' },
  ] },
];

const VOLUMES = [5, 15, 25, 35, 45, 55];
const LEVELS: LevelKey[] = ['beginner', 'intermediate', 'advanced', 'advanced_plus', null];
const WEEKS_OUT = [8, 12, 16, 24];

// A reasonable recentLong by distance so the long-floor doesn't crash sizing.
function recentLongFor(mi: number, vol: number): number {
  const cat = distanceCategoryOfPublic(mi);
  const byCat = cat === '5k' ? 5 : cat === '10k' ? 7 : cat === 'hm' ? 10 : cat === 'm' ? 14 : 18;
  return Math.min(byCat, Math.round(vol * 0.3));
}

// ── collectors ──────────────────────────────────────────────────────────────
interface Violation {
  id: string;
  invariant: string;
  inputJson: string;
  expected: string;
  actual: string;
  severity: 'critical' | 'major' | 'minor';
}
const VIOLATIONS: Violation[] = [];
let COMBO_COUNT = 0;

function record(v: Violation) { VIOLATIONS.push(v); }

function repWorkdays(result: ComposePlanResult): Array<{ week: number; dow: number; type: string; subLabel: string | null; phase: string }> {
  const out: Array<{ week: number; dow: number; type: string; subLabel: string | null; phase: string }> = [];
  result.weeks.forEach((w, wi) => {
    for (const d of w.days) {
      // Race-week tune-up / shakeout are universal race rehearsals, not I/R
      // training — excluded from the structured-rep scope (see TUNEUP_TYPES note).
      if (TUNEUP_TYPES.has(d.type)) continue;
      if (isRepType(d.type) || hasStructuredReps(d.subLabel)) {
        out.push({ week: wi, dow: d.dow, type: d.type, subLabel: d.subLabel, phase: w.phase });
      }
    }
  });
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// INVARIANT 10 · BEGINNER = NO STRUCTURED REPS
// ════════════════════════════════════════════════════════════════════════════
describe('INV-10 · beginner plans contain NO structured interval reps', () => {
  for (const dist of DISTANCES) {
    for (const goal of dist.goals) {
      for (const vol of VOLUMES) {
        for (const wo of WEEKS_OUT) {
          const id = `INV10/beginner/${dist.name}/${goal.tag}/vol${vol}/wo${wo}`;
          it(id, () => {
            COMBO_COUNT++;
            const input = buildInput({
              level: 'beginner', raceDistanceMi: dist.mi, goalSec: goal.sec,
              weeksOut: wo, recentWeeklyMi: vol, recentLongMi: recentLongFor(dist.mi, vol),
            });
            let result: ComposePlanResult;
            try {
              result = composePlan(input);
            } catch (e) {
              record({
                id, invariant: 'INV-10 (no crash)',
                inputJson: JSON.stringify({ level: 'beginner', ...dist, goal, vol, wo }),
                expected: 'composePlan returns a plan', actual: `threw: ${String(e)}`,
                severity: 'critical',
              });
              throw e;
            }
            // Cross-check: isBaseBuildingPlan must agree this is a base-building plan.
            const cat = distanceCategoryOfPublic(dist.mi);
            const baseBuilding = isBaseBuildingPlan(cat, 'beginner');
            const reps = repWorkdays(result);
            if (reps.length > 0) {
              const sample = reps.slice(0, 3).map(r => `wk${r.week} ${r.phase} ${r.type} "${r.subLabel}"`).join(' | ');
              record({
                id, invariant: 'INV-10 beginner-no-reps',
                inputJson: JSON.stringify({ level: 'beginner', distanceMi: dist.mi, goalSec: goal.sec, weeksOut: wo, recentWeeklyMi: vol }),
                expected: 'zero structured-rep days (base_building: light tempo/fartlek/strides only)',
                actual: `${reps.length} rep day(s): ${sample}${baseBuilding ? '' : ' [isBaseBuildingPlan=FALSE — template disagreement]'}`,
                severity: 'critical',
              });
            }
            expect(reps, `${id}: beginner leaked structured reps`).toHaveLength(0);
            // And isBaseBuildingPlan must be true for every beginner distance.
            expect(baseBuilding, `${id}: isBaseBuildingPlan should be true for beginner`).toBe(true);
          });
        }
      }
    }
  }
});

// ════════════════════════════════════════════════════════════════════════════
// INVARIANT 11 · NON-BEGINNERS GET REAL STRUCTURED SESSIONS
// ════════════════════════════════════════════════════════════════════════════
// A non-beginner plan with adequate runway (a QUALITY + RACE-SPECIFIC phase)
// must contain at least one genuinely structured quality session — a rep
// workout OR a continuous-tempo/threshold session with a pace+spec. We assert
// the plan is NOT base-building (for non-ultra) AND carries quality work.
//
// Note ultra: per plan-templates, intermediate/advanced ultra are
// base_building/tempo_threshold by DESIGN (aerobic-dominant, B2B longs). So we
// only require "no rep machine" softness for ultra; we DON'T demand intervals.
describe('INV-11 · non-beginner plans carry real structured quality', () => {
  for (const level of (['intermediate', 'advanced', 'advanced_plus'] as LevelKey[])) {
    for (const dist of DISTANCES) {
      // pick the median goal (real fitness signal) + a no-goal case
      for (const goal of [dist.goals[1], dist.goals[3]]) {
        for (const vol of [25, 45]) {
          const id = `INV11/${level}/${dist.name}/${goal.tag}/vol${vol}`;
          it(id, () => {
            COMBO_COUNT++;
            const input = buildInput({
              level, raceDistanceMi: dist.mi, goalSec: goal.sec,
              weeksOut: 16, recentWeeklyMi: vol, recentLongMi: recentLongFor(dist.mi, vol),
            });
            const result = composePlan(input);
            const cat = distanceCategoryOfPublic(dist.mi);
            const baseBuilding = isBaseBuildingPlan(cat, level);

            // Non-ultra non-beginner must NOT be base-building.
            if (cat !== 'ultra' && baseBuilding) {
              record({
                id, invariant: 'INV-11 non-beginner-not-base-building',
                inputJson: JSON.stringify({ level, distanceMi: dist.mi, goalSec: goal.sec }),
                expected: 'isBaseBuildingPlan=false for non-beginner non-ultra',
                actual: 'isBaseBuildingPlan=TRUE — non-beginner got base-building structure',
                severity: 'major',
              });
            }

            // Every QUALITY/RACE-SPECIFIC week must carry >=1 quality day with
            // BOTH a pace-bearing spec and a real workout sub_label.
            const qWeeks = result.weeks.filter(w => (w.phase === 'QUALITY' || w.phase === 'RACE-SPECIFIC') && !w.isRaceWeek);
            for (const w of qWeeks) {
              const qDays = w.days.filter(d => d.isQuality);
              if (qDays.length === 0) {
                record({
                  id, invariant: 'INV-11 quality-coverage',
                  inputJson: JSON.stringify({ level, distanceMi: dist.mi, goalSec: goal.sec, week: w.startISO, phase: w.phase }),
                  expected: 'every QUALITY/RACE-SPECIFIC week has >=1 quality day',
                  actual: `week ${w.startISO} (${w.phase}) has ZERO quality days`,
                  severity: 'major',
                });
              }
              for (const q of qDays) {
                if (!q.subLabel || q.subLabel.trim() === '' || q.subLabel === 'QUALITY') {
                  record({
                    id, invariant: 'INV-11 naked-quality',
                    inputJson: JSON.stringify({ level, distanceMi: dist.mi, week: w.startISO, type: q.type }),
                    expected: 'quality day carries a concrete workout sub_label',
                    actual: `naked quality day: type=${q.type} subLabel="${q.subLabel}"`,
                    severity: 'major',
                  });
                }
              }
            }

            // For non-ultra, at least ONE structured session somewhere in the plan
            // (a rep day OR a threshold/tempo with reps) — the "machine" must show up.
            if (cat !== 'ultra' && qWeeks.length > 0) {
              const anyStructured = result.weeks.some(w =>
                w.days.some(d => d.isQuality && (isRepType(d.type) || /\d+\s*[×x]\s*\d|@\s*T\b|tempo|threshold/i.test(d.subLabel ?? '')))
              );
              if (!anyStructured) {
                record({
                  id, invariant: 'INV-11 structured-presence',
                  inputJson: JSON.stringify({ level, distanceMi: dist.mi, goalSec: goal.sec }),
                  expected: 'non-beginner plan contains structured quality (reps or T work)',
                  actual: 'no structured quality session found anywhere in the plan',
                  severity: 'major',
                });
              }
              expect(anyStructured, `${id}: non-beginner plan has no structured quality`).toBe(true);
            }
          });
        }
      }
    }
  }
});

// ════════════════════════════════════════════════════════════════════════════
// INVARIANT 11b · BEGINNER vs NON-BEGINNER DIVERGENCE (same race/volume)
// ════════════════════════════════════════════════════════════════════════════
// A page rendered for a beginner and one for an advanced runner at the SAME
// race+volume must look meaningfully different. Concretely: at a volume where
// the advanced plan carries rep work, the beginner plan at the identical
// inputs must NOT. This catches a regression where level stops gating.
describe('INV-11b · beginner & advanced plans diverge on structure', () => {
  for (const dist of DISTANCES.filter(d => d.name !== '50K')) {
    const id = `INV11b/${dist.name}`;
    it(id, () => {
      COMBO_COUNT++;
      const vol = 30;
      const goalSec = dist.goals[1].sec;
      const beg = composePlan(buildInput({ level: 'beginner', raceDistanceMi: dist.mi, goalSec, weeksOut: 16, recentWeeklyMi: vol, recentLongMi: recentLongFor(dist.mi, vol) }));
      const adv = composePlan(buildInput({ level: 'advanced', raceDistanceMi: dist.mi, goalSec, weeksOut: 16, recentWeeklyMi: vol, recentLongMi: recentLongFor(dist.mi, vol) }));
      const begReps = repWorkdays(beg).length;
      const advReps = repWorkdays(adv).length;
      // Beginner must be zero; advanced (non-ultra) should be > 0.
      if (begReps !== 0) {
        record({
          id, invariant: 'INV-11b beginner-zero-reps',
          inputJson: JSON.stringify({ distanceMi: dist.mi, goalSec, vol }),
          expected: 'beginner rep-count = 0', actual: `beginner rep-count = ${begReps}`,
          severity: 'critical',
        });
      }
      expect(begReps, `${id}: beginner should have 0 reps`).toBe(0);
      // Advanced must carry SOME quality (rep or T). If advanced also has 0,
      // structure isn't gating at all.
      const advQuality = adv.weeks.some(w => w.days.some(d => d.isQuality));
      expect(advQuality, `${id}: advanced should carry quality`).toBe(true);
    });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// INVARIANT 12 · DAVID PROTECTION — advanced-marathon plan is byte-stable
// ════════════════════════════════════════════════════════════════════════════
// Mirrors the `advanced-marathon` persona (synthetic-runners.ts): advanced,
// 60 mpw base, 3:00:00 marathon, 16 weeks out, recentLong 14. We snapshot the
// FULL plan structure and assert: (a) inline structure invariants, and (b) a
// frozen byte-snapshot. Any drift here is CRITICAL.
describe('INV-12 · advanced-marathon (David class) plan is protected', () => {
  // Reconstruct the persona's ComposePlanInput EXACTLY as the generator-bench
  // builds it (personaToComposeInput): start Monday 2026-01-05, race = start +
  // weeksOut*7 - 1 (Sunday), longRunDow Sun, restDow Sat, qualityDows Tue+Thu.
  const DAVID: ComposePlanInput = (() => {
    const distanceMi = 26.2, goalSec = 10800, weeksOut = 16, weeklyBaseMi = 60;
    const cat = distanceCategoryOfPublic(distanceMi);
    const raceDay = new Date(START_MONDAY + 'T12:00:00Z');
    raceDay.setUTCDate(raceDay.getUTCDate() + weeksOut * 7 - 1);
    return {
      raceDistanceMi: distanceMi,
      goalSec,
      goalPaceSec: Math.round(goalSec / distanceMi),
      raceDateISO: raceDay.toISOString().slice(0, 10),
      startMondayISO: START_MONDAY,
      level: 'advanced',
      recentWeeklyMi: weeklyBaseMi,
      easyDayMedianMi: Math.max(3, Math.round(weeklyBaseMi / 5)),
      recentLongMi: 14,
      isMidBlock: false,
      longRunDow: 0 as DOW,
      restDow: 6 as DOW,
      qualityDows: [2, 4] as DOW[],
      trainingDaysPerWeek: null,
      crossModes: [],
      rxQuality: inlinePrescriptions(cat),
      rxRaceSpecific: inlinePrescriptions(cat),
      tPaceSec: tPaceFromGoal(goalSec, distanceMi),
      lthr: null,
      maxHr: null,
    };
  })();

  const result = composePlan(DAVID);

  it('produces a 16-week marathon plan with full phase arc', () => {
    COMBO_COUNT++;
    expect(result.totalWeeks).toBe(16);
    const phases = result.blocks.phases.map(p => p.label);
    // Marathon (16wk) arc: BASE? → QUALITY → RACE-SPECIFIC → TAPER.
    expect(phases).toContain('QUALITY');
    expect(phases).toContain('RACE-SPECIFIC');
    expect(phases).toContain('TAPER');
    expect(phases[phases.length - 1]).toBe('TAPER');
  });

  it('is NOT contaminated by base-building structure', () => {
    COMBO_COUNT++;
    const cat = distanceCategoryOfPublic(26.2);
    expect(isBaseBuildingPlan(cat, 'advanced')).toBe(false);
    // No "light fartlek surges @ T effort" beginner sub_label anywhere.
    const contaminated = result.weeks.flatMap(w => w.days)
      .filter(d => MIN_SURGE_FARTLEK.test(d.subLabel ?? ''));
    if (contaminated.length > 0) {
      record({
        id: 'INV12/no-base-building', invariant: 'INV-12 david-no-fartlek-contamination',
        inputJson: JSON.stringify({ persona: 'advanced-marathon' }),
        expected: 'zero beginner light-fartlek sub_labels',
        actual: `${contaminated.length} fartlek day(s): ${contaminated.map(d => d.subLabel).join(', ')}`,
        severity: 'critical',
      });
    }
    expect(contaminated).toHaveLength(0);
  });

  it('carries the threshold/cruise machine (Xmi @ T tempo, N×1mi @ T reps)', () => {
    COMBO_COUNT++;
    const qualitySubs = result.weeks.flatMap(w => w.days)
      .filter(d => d.isQuality)
      .map(d => d.subLabel ?? '');
    // Marathon quality mix is tempo+threshold (see generate.ts qualityTypes m/ultra).
    // The threshold rx for marathon is "4×1mi @ T pace · 90s jog"; tempo is "Nmi continuous tempo".
    const hasTRep = qualitySubs.some(s => /\d+\s*[×x]\s*1\s*mi\s*@\s*T/i.test(s));
    const hasTempo = qualitySubs.some(s => /tempo/i.test(s));
    if (!hasTRep && !hasTempo) {
      record({
        id: 'INV12/threshold-machine', invariant: 'INV-12 david-threshold-present',
        inputJson: JSON.stringify({ persona: 'advanced-marathon', qualitySubs: qualitySubs.slice(0, 6) }),
        expected: 'at least one "N×1mi @ T" cruise OR continuous tempo session',
        actual: `no T-rep or tempo found. quality subs: ${qualitySubs.slice(0, 6).join(' | ')}`,
        severity: 'critical',
      });
    }
    expect(hasTRep || hasTempo, 'David plan missing T-pace cruise/tempo work').toBe(true);
  });

  it('long-run progression carries MP finish inserts (race-specific)', () => {
    COMBO_COUNT++;
    const rsLongs = result.weeks
      .filter(w => w.phase === 'RACE-SPECIFIC')
      .flatMap(w => w.days.filter(d => d.type === 'long').map(d => d.subLabel ?? ''));
    if (rsLongs.length > 0) {
      const hasMP = rsLongs.some(s => s.includes('@ MP'));
      if (!hasMP) {
        record({
          id: 'INV12/mp-finish', invariant: 'INV-12 david-MP-finish',
          inputJson: JSON.stringify({ persona: 'advanced-marathon', rsLongs }),
          expected: 'RACE-SPECIFIC long runs carry "@ MP" finish inserts',
          actual: `no @ MP found in RACE-SPECIFIC longs: ${rsLongs.join(' | ')}`,
          severity: 'major',
        });
      }
      expect(hasMP, 'David RACE-SPECIFIC longs missing MP finish').toBe(true);
    }
  });

  it('peak weekly + peak long sit in the advanced-marathon doctrine band', () => {
    COMBO_COUNT++;
    const buildWeeks = result.weeks.filter(w => w.phase !== 'TAPER' && !w.isRaceWeek);
    const peakWeekly = Math.max(...buildWeeks.map(w => w.days.reduce((s, d) => s + d.distanceMi, 0)));
    const peakLong = Math.max(...buildWeeks.flatMap(w => w.days.filter(d => d.type === 'long').map(d => d.distanceMi)));
    // advanced-marathon expectedPlan band [55,75] peak weekly, [20,22] peak long.
    // Allow ±10% tolerance as the bench does.
    expect(peakWeekly).toBeGreaterThanOrEqual(55 * 0.9);
    expect(peakWeekly).toBeLessThanOrEqual(75 * 1.1);
    expect(peakLong).toBeGreaterThanOrEqual(20 - 1.5);
    expect(peakLong).toBeLessThanOrEqual(22 + 1.5);
  });

  // ── FROZEN STRUCTURE SNAPSHOT ─────────────────────────────────────────────
  // Compact, human-auditable fingerprint: per-week [phase | weeklyMi | longMi |
  // quality types]. If ANY of this changes, this assertion breaks and forces a
  // human to confirm the drift was intended.
  it('FROZEN: per-week structural fingerprint is byte-stable', () => {
    COMBO_COUNT++;
    const fp = result.weeks.map((w, i) => {
      const longMi = Math.max(0, ...w.days.filter(d => d.type === 'long').map(d => d.distanceMi));
      const qTypes = w.days.filter(d => d.isQuality).map(d => d.type).join('+') || 'none';
      const weeklyMi = w.days.reduce((s, d) => s + d.distanceMi, 0);
      return `wk${i}:${w.phase}:${weeklyMi}mi:long${longMi}:${qTypes}`;
    });
    // This snapshot is the CONTRACT. Generated on first run; any structural
    // drift to David's marathon plan flips it red.
    expect(fp).toMatchSnapshot('david-marathon-structure');
    // Also snapshot the full quality sub_labels (the workout vocabulary).
    const qVocab = result.weeks.map((w, i) => {
      const subs = w.days.filter(d => d.isQuality).map(d => `${d.type}="${d.subLabel}"`);
      return subs.length ? `wk${i}: ${subs.join(' ; ')}` : null;
    }).filter(Boolean);
    expect(qVocab).toMatchSnapshot('david-marathon-quality-vocab');
  });

  // ── advanced_plus marathon also protected ─────────────────────────────────
  it('advanced_plus marathon is equally protected (no base-building, has machine)', () => {
    COMBO_COUNT++;
    const apInput = { ...DAVID, level: 'advanced_plus' as LevelKey, recentWeeklyMi: 90, easyDayMedianMi: 18, recentLongMi: 18 };
    const ap = composePlan(apInput);
    expect(isBaseBuildingPlan(distanceCategoryOfPublic(26.2), 'advanced_plus')).toBe(false);
    const apFartlek = ap.weeks.flatMap(w => w.days).filter(d => MIN_SURGE_FARTLEK.test(d.subLabel ?? ''));
    expect(apFartlek, 'advanced_plus marathon contaminated with beginner fartlek').toHaveLength(0);
    const apQuality = ap.weeks.some(w => w.days.some(d => d.isQuality && /\d+\s*[×x]\s*1\s*mi\s*@\s*T|tempo|threshold/i.test(d.subLabel ?? '')));
    expect(apQuality, 'advanced_plus marathon missing T machine').toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// EDGE PROBE · null/unset level should default to intermediate (NOT beginner)
// ════════════════════════════════════════════════════════════════════════════
// A null-experience runner must NOT silently get a base-building plan (that
// would strip rep work from an unknown-but-possibly-fit runner). Per
// templateFor's NORM_LEVEL, null → intermediate.
describe('EDGE · null/unset level defaults to intermediate periodization', () => {
  for (const dist of DISTANCES.filter(d => d.name !== '50K')) {
    const id = `EDGE/null-level/${dist.name}`;
    it(id, () => {
      COMBO_COUNT++;
      expect(isBaseBuildingPlan(distanceCategoryOfPublic(dist.mi), null)).toBe(false);
      const result = composePlan(buildInput({ level: null, raceDistanceMi: dist.mi, goalSec: dist.goals[1].sec, weeksOut: 16, recentWeeklyMi: 30, recentLongMi: recentLongFor(dist.mi, 30) }));
      // null level must NOT produce the beginner light-fartlek vocabulary.
      const fartlek = result.weeks.flatMap(w => w.days).filter(d => MIN_SURGE_FARTLEK.test(d.subLabel ?? ''));
      if (fartlek.length > 0) {
        record({
          id, invariant: 'EDGE null-not-beginner',
          inputJson: JSON.stringify({ level: null, distanceMi: dist.mi }),
          expected: 'null level → intermediate (no beginner fartlek)',
          actual: `${fartlek.length} beginner fartlek day(s)`,
          severity: 'major',
        });
      }
      expect(fartlek, `${id}: null level leaked beginner structure`).toHaveLength(0);
    });
  }
});

// ── final report dump ───────────────────────────────────────────────────────
describe('ZZ · periodization audit summary', () => {
  it('emits combo count + violation table', () => {
    // eslint-disable-next-line no-console
    console.log(`\n[PERIODIZATION AUDIT] combos exercised (approx): ${COMBO_COUNT}`);
    // eslint-disable-next-line no-console
    console.log(`[PERIODIZATION AUDIT] violations: ${VIOLATIONS.length}`);
    for (const v of VIOLATIONS) {
      // eslint-disable-next-line no-console
      console.log(`  [${v.severity}] ${v.id} :: ${v.invariant}\n     expected: ${v.expected}\n     actual:   ${v.actual}\n     input:    ${v.inputJson}`);
    }
    // This test itself never fails — it's a reporter. Real failures are the
    // per-combo expects above.
    expect(true).toBe(true);
  });
});
