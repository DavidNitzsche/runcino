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
import { distanceCategoryOrThrow } from '@/lib/race/distance-category';
import {
  composePlan,
  inlinePrescriptions,
  type ComposePlanInput,
  type ComposePlanResult,
  type DOW,
} from './generate';
import { fixtureTPaceFromGoalPace } from './_fixture-goal-tpace';
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

/**
 * VARIETY-BEGIN-1 (2026-08-28) · the beginner's second structured day is
 * Research/04 §8.2's LIGHT HILLS — "Nmi E w/ 8×20s light hill surges ·
 * walk-down rec" — typed `intervals` (DOCTRINE-BASE-2's rep-shaped-day
 * convention, the same one BASE-phase speed days already use) and run BY
 * EFFORT with no pace target. Research/22 §"10K — Beginner" lists "light
 * hills" among its own Key workout types, so this is base-building vocabulary,
 * not the I/R machine this invariant fences off. Exempted by its label the
 * same way the light fartlek is; a real I/R leak — distance reps, an I or R
 * zone tag — still fires through DIST_REP / I_R_ZONE below.
 */
const LIGHT_HILL_SURGES = /\d+\s*[×x]\s*\d+\s*s\s+light\s+hill\s+surges/i;

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
  const cat = distanceCategoryOrThrow(opts.raceDistanceMi);
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
    tPaceSec: fixtureTPaceFromGoalPace(opts.goalSec, opts.raceDistanceMi),
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
  const cat = distanceCategoryOrThrow(mi);
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
      // VARIETY-BEGIN-1 · the beginner light-hills day rides the `intervals`
      // type but is by-effort base-building vocabulary, not I/R rep work.
      const lightHills = LIGHT_HILL_SURGES.test(d.subLabel ?? '');
      if ((isRepType(d.type) && !lightHills) || hasStructuredReps(d.subLabel)) {
        out.push({ week: wi, dow: d.dow, type: d.type, subLabel: d.subLabel, phase: w.phase });
      }
    }
  });
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// INVARIANT 10 · TIEREVIDENCE-2 (2026-09-02) · THE QUALITY VOCABULARY IS
// DECIDED BY MEASURED VOLUME, NOT BY A TYPED WORD
//
// ── WHAT THIS INVARIANT USED TO SAY, AND WHY IT COULD NOT SURVIVE ───────────
//
// "a beginner plan must NOT contain structured interval reps", swept as
// `buildInput({ level: 'beginner', ... })` across 309 cells. Every one of those
// cells asserted that `profile.experience_level` CHANGES the plan — which is
// the authority `docs/PLAN_SIMPLIFICATION_DOCTRINE.md` §"What may not" removes
// by name, and which `_declared_level_inert.test.ts` is the owner's own gate
// against. Left as it was, this file would have been a 309-cell assertion that
// the defect is still present.
//
// ── WHAT IT SAYS NOW, AND WHY IT IS STRONGER ───────────────────────────────
//
// The invariant behind it — a runner who cannot absorb the I/R machine must
// not be handed it — is real and is KEPT. What changed is the evidence that
// answers it. `plan-templates.ts` `unstatedLevelFor` (LOWVOL-2) already had the
// doctrine-cited reading, in its own words: "Volume can only ever demote ...
// a big week is not a demonstration of anything, whereas a week below the
// beginner peak is a hard fact about what the runner can absorb." That is the
// production behaviour for the 8-of-16 accounts whose `experience_level` is
// NULL, and it is now the behaviour for all of them.
//
// So invariant 10 splits into the two things that are actually true:
//
//   10a · THE VOCABULARY DOES NOT MOVE WITH THE LABEL. The rep-day set is
//         byte-identical across all four declarable values and both absences,
//         for every one of the 309 cells. This is `_declared_level_inert`'s
//         property asked of the whole matrix rather than of one runner, so it
//         is a WIDER sweep than the one it replaces, not a narrower one.
//
//   10b · A RUNNER BELOW DOCTRINE'S BEGINNER PEAK BAND GETS NO STRUCTURED
//         REPS. The protection survives, bought with the runner's own reported
//         volume. `isBaseBuildingPlan` decides, and the cells it fires on are
//         the ones asserted — which keeps this from being an assertion about
//         an empty set (Rule 15).
//
// ── WHAT 10a/10b CANNOT FAIL ON (Rule 22) ──────────────────────────────────
//
//   · THE ROUTING BEING RIGHT. 10b asserts the low-volume runner is protected;
//     it cannot tell whether a 15 mi/wk runner SHOULD be. `Research/22`
//     §"5K — Intermediate" opens "For runners with a year of running, 15-20 mpw
//     base" and prescribes I reps there, so doctrine itself puts reps at that
//     volume — but "a year of running" is not a thing this app measures, and
//     nothing here can notice that it is missing.
//   · A LEAK THAT IS IDENTICAL ACROSS LEVELS. 10a proves sameness only. If the
//     engine handed every runner the wrong session, both cases pass.
// ════════════════════════════════════════════════════════════════════════════
describe('INV-10a · the rep vocabulary does not move with the declared level', () => {
  for (const dist of DISTANCES) {
    for (const goal of dist.goals) {
      for (const vol of VOLUMES) {
        for (const wo of WEEKS_OUT) {
          const id = `INV10a/${dist.name}/${goal.tag}/vol${vol}/wo${wo}`;
          it(id, () => {
            COMBO_COUNT++;
            const fingerprints = LEVELS.map((level) => {
              const input = buildInput({
                level, raceDistanceMi: dist.mi, goalSec: goal.sec,
                weeksOut: wo, recentWeeklyMi: vol, recentLongMi: recentLongFor(dist.mi, vol),
              });
              // The OMITTED case as well as the null one: a `?? 'intermediate'`
              // and a `=== null` behave differently across the two (Rule 11).
              if (level == null) delete (input as { level?: unknown }).level;
              return JSON.stringify(repWorkdays(composePlan(input)));
            });
            // LIVENESS · six real compositions, not six exceptions swallowed.
            expect(fingerprints).toHaveLength(LEVELS.length);
            const ref = fingerprints[0];
            for (let i = 1; i < fingerprints.length; i++) {
              if (fingerprints[i] === ref) continue;
              record({
                id, invariant: 'INV-10a level-inert-vocabulary',
                inputJson: JSON.stringify({ level: LEVELS[i], distanceMi: dist.mi, goalSec: goal.sec, weeksOut: wo, recentWeeklyMi: vol }),
                expected: 'the structured-rep day set is identical at every declared level',
                actual: `level ${String(LEVELS[i])} produced a different set from ${String(LEVELS[0])}`,
                severity: 'critical',
              });
            }
            for (let i = 1; i < fingerprints.length; i++) {
              expect(
                fingerprints[i],
                `${id}: experience level ${String(LEVELS[i])} changed the structured-rep vocabulary. ` +
                'A self-declared band has no authority over which session a runner is prescribed ' +
                '(docs/PLAN_SIMPLIFICATION_DOCTRINE.md §"What may not").',
              ).toBe(ref);
            }
          });
        }
      }
    }
  }
});

describe('INV-10b · below doctrine\'s beginner peak band, no structured reps', () => {
  // LIVENESS · counted across the whole sweep and asserted non-zero at the end,
  // so a change that stopped `isBaseBuildingPlan` ever firing cannot make this
  // suite report clean by asserting nothing (Rule 18 clause 2).
  let PROTECTED_CELLS = 0;
  for (const dist of DISTANCES) {
    for (const goal of dist.goals) {
      for (const vol of VOLUMES) {
        for (const wo of WEEKS_OUT) {
          const cat = distanceCategoryOrThrow(dist.mi);
          if (!isBaseBuildingPlan(cat, null, vol)) continue;
          const id = `INV10b/${dist.name}/${goal.tag}/vol${vol}/wo${wo}`;
          it(id, () => {
            COMBO_COUNT++;
            PROTECTED_CELLS++;
            const input = buildInput({
              level: null, raceDistanceMi: dist.mi, goalSec: goal.sec,
              weeksOut: wo, recentWeeklyMi: vol, recentLongMi: recentLongFor(dist.mi, vol),
            });
            const reps = repWorkdays(composePlan(input));
            if (reps.length > 0) {
              const sample = reps.slice(0, 3).map((r) => `wk${r.week} ${r.phase} ${r.type} "${r.subLabel}"`).join(' | ');
              record({
                id, invariant: 'INV-10b low-volume-no-reps',
                inputJson: JSON.stringify({ distanceMi: dist.mi, goalSec: goal.sec, weeksOut: wo, recentWeeklyMi: vol }),
                expected: 'zero structured-rep days (base_building: light tempo/fartlek/strides only)',
                actual: `${reps.length} rep day(s): ${sample}`,
                severity: 'critical',
              });
            }
            expect(
              reps,
              `${id}: a runner reporting ${vol} mi/wk — below doctrine's own beginner peak band ` +
              `for the ${dist.name} — was handed structured I/R reps`,
            ).toHaveLength(0);
          });
        }
      }
    }
  }
  it('LIVENESS · the low-volume rule fired on real cells', () => {
    expect(
      PROTECTED_CELLS,
      'no cell in the sweep was routed to base-building, so INV-10b asserted nothing',
    ).toBeGreaterThan(10);
  });
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
            const cat = distanceCategoryOrThrow(dist.mi);
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
/**
 * TIEREVIDENCE-2 (2026-09-02) · INVERTED, for the same reason INV-10 was.
 *
 * This case asserted that two runners with byte-identical history — 30 mi/wk,
 * the same goal, the same distance — get STRUCTURALLY DIFFERENT plans because
 * one of them typed "beginner" and the other typed "advanced". That is the
 * defect `docs/PLAN_SIMPLIFICATION_DOCTRINE.md` §"What may not" removes, stated
 * as a requirement.
 *
 * What it was really protecting is kept and is asserted twice over: the plan
 * must still CARRY quality (a gate that only ever asks "did you correctly
 * refuse?" passes an engine that can only refuse — Rule 22), and the low-volume
 * runner must still be protected from the I/R machine (INV-10b, on the
 * runner's own reported volume). What is deleted is the word deciding it.
 */
describe('INV-11b · two runners with the same history get the same structure', () => {
  for (const dist of DISTANCES.filter(d => d.name !== '50K')) {
    const id = `INV11b/${dist.name}`;
    it(id, () => {
      COMBO_COUNT++;
      const vol = 30;
      const goalSec = dist.goals[1].sec;
      const beg = composePlan(buildInput({ level: 'beginner', raceDistanceMi: dist.mi, goalSec, weeksOut: 16, recentWeeklyMi: vol, recentLongMi: recentLongFor(dist.mi, vol) }));
      const adv = composePlan(buildInput({ level: 'advanced', raceDistanceMi: dist.mi, goalSec, weeksOut: 16, recentWeeklyMi: vol, recentLongMi: recentLongFor(dist.mi, vol) }));
      const begReps = JSON.stringify(repWorkdays(beg));
      const advReps = JSON.stringify(repWorkdays(adv));
      if (begReps !== advReps) {
        record({
          id, invariant: 'INV-11b structure-is-level-inert',
          inputJson: JSON.stringify({ distanceMi: dist.mi, goalSec, vol }),
          expected: 'identical structured-rep days at 30 mi/wk whatever was typed',
          actual: 'the declared level changed the structure',
          severity: 'critical',
        });
      }
      expect(begReps, `${id}: the declared level changed the rep structure`).toBe(advReps);
      // ...and BOTH still carry quality. Rule 22: a sameness assertion is
      // satisfied by two empty plans, so the thing being made the same has to
      // be asserted to exist.
      for (const [what, r] of [['beginner-typed', beg], ['advanced-typed', adv]] as const) {
        expect(
          r.weeks.some(w => w.days.some(d => d.isQuality)),
          `${id}: the ${what} plan carries no quality at all`,
        ).toBe(true);
      }
      expect(
        repWorkdays(adv).length,
        `${id}: a 30 mi/wk runner gets no structured session anywhere in a 16-week block`,
      ).toBeGreaterThan(0);
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
/**
 * TIEREVIDENCE-2 (2026-09-02) · THE FROZEN SNAPSHOT MOVES, AND HERE IS EXACTLY
 * WHAT MOVED AND WHY.
 *
 * This persona is `advanced`, 60 mi/wk, a 3:00 marathon goal, and — the part
 * that matters — NO measured VDOT: `bestRecentVdot` is not on the input at all.
 * With the self-declared experience level removed as decision authority, the
 * only thing that ever put it on `TIER_TARGETS.m.advanced` is gone, and it
 * composes against the row an unmeasured runner gets, `UNMEASURED_ROW_TIER`
 * ('intermediate').
 *
 * WHAT DID NOT MOVE, which is the half worth stating first: every weekly
 * volume, the phase arc, the cutback placement, and the quality types on every
 * week. 60/61/62/45/63/64/65/49/66/66/66/51/66/54/40/44.2 — the persona's own
 * 60 mi/wk base is what sizes its block (`max(peakWeeklyFloorMi, base × 1.10)`
 * with the base arm winning), and that has nothing to do with the row.
 *
 * WHAT MOVED: the long run, by one to two and a half miles per week, and only
 * because `peakLongMiBand[1]` is 22 on §"Marathon — Intermediate" against 24 on
 * §"Marathon — Advanced". The peak long goes 22.5 -> 22.
 *
 *   wk2  17 -> 16     wk3  13 -> 12     wk4  18 -> 17     wk5  19 -> 18
 *   wk6  20 -> 19     wk7  15 -> 14     wk8  21 -> 20     wk9  22 -> 20
 *   wk10 22.5 -> 21   wk11 17 -> 16     wk12 22.5 -> 22   wk13 20 -> 18
 *   wk14 15 -> 13
 *
 * A 22-mile peak long inside a 66 mi/wk week is 33% of the week; the 22.5 it
 * replaces was 34%, against `Research/00a` §"Volume progression rules"' own
 * "≤25-30% of weekly volume". So the move is toward doctrine's share cap, not
 * away from it.
 *
 * AND THE REAL RUNNER IS UNAFFECTED, which is what "David protection" is for.
 * The owner's own CIM authoring carries `demonstratedLongMi: 21.5` and a
 * measured peak week, so `evidenceLongCeilingMi` — his own longest run, not a
 * band — is what caps his long, and it is 21.5 before and after (measured on
 * the `_declared_level_inert.test.ts` fixture, which is his real block). This
 * persona differs from him in exactly one way: it has never been measured.
 */
describe('INV-12 · advanced-marathon (David class) plan is protected', () => {
  // Reconstruct the persona's ComposePlanInput EXACTLY as the generator-bench
  // builds it (personaToComposeInput): start Monday 2026-01-05, race = start +
  // weeksOut*7 - 1 (Sunday), longRunDow Sun, restDow Sat, qualityDows Tue+Thu.
  const DAVID: ComposePlanInput = (() => {
    const distanceMi = 26.2, goalSec = 10800, weeksOut = 16, weeklyBaseMi = 60;
    const cat = distanceCategoryOrThrow(distanceMi);
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
      tPaceSec: fixtureTPaceFromGoalPace(goalSec, distanceMi),
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
    const cat = distanceCategoryOrThrow(26.2);
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
  //
  // DRIFT ACCEPTED · WKPEAK-2 (2026-08-25) · THE PEAK IS A PHASE.
  //
  // wk3 47.5→51.5 · wk4 61.5→64.5 · wk5 62→65 · wk6 64→66 · wk7 50→51 (long
  // 18→19) · wk8 63→66 · wk10 64→68. The peak barely moves (67.5 → 68); the
  // middle of the block fills in. `volumeCurve` was a pure geometric climb
  // reaching its target on the LAST climbing week, so a build spent one week at
  // the volume it was built for. Research/22's marathon rows name a peak PHASE
  // — §"Marathon — Beginner" Phases "peak (3 wk)", §"Marathon — Intermediate"
  // "Peak long run | 20-22 mi (2-3 times)" — and PEAK_HOLD_WEEKS.m now makes
  // the curve arrive with three climbing weeks to spare and hold there.
  //
  // Nothing about the ceiling moved: GENERAL_RAMP_CEILING still caps every
  // step, the doctrine-band test above still passes (68 is inside [55,75]×1.1),
  // and the taper is untouched. What changed is that the weeks between the ramp
  // and the taper now carry the volume the block is built for instead of
  // approaching it asymptotically.
  //
  // The vocabulary snapshot moves once, in the same direction and for the same
  // reason: wk6's I session goes 7×800m → 10×800m because that week is now 66
  // miles instead of 64 and the interval dose is a share of weekly volume, not
  // a fixed rep count. 10×800m is 5.0 mi in a 66 mi week — 7.6%, inside
  // Daniels' ≤8% I cap, which `_dosing_doctrine.test.ts` checks independently.
  //
  // RE-SYNC · MERGE CORRUPTION, NOT NEW DRIFT (2026-08-27).
  //
  // This snapshot went stale on wk3/4/6/7/10 — back down to their PRE-WKPEAK-2
  // values (wk3 51.5→47.5, wk4 64.5→61.5, wk6 66→63, wk7 51→49 long19→18,
  // wk10 68→64) — even though `volumeCurve`/`cycleBoundedPeak`/`PEAK_HOLD_WEEKS`
  // never regressed: composePlan has produced the WKPEAK-2 numbers on every
  // commit since 23a4e60c landed (verified by rebuilding the fingerprint at
  // each commit between 23a4e60c and this one). The `variety` and
  // `pace-trajectory` branches (merged in at 91547b15 and 408f98d8) were both
  // cut BEFORE 23a4e60c, so their own copies of this .snap file still carried
  // the pre-WKPEAK-2 numbers for those five weeks; the merge conflict on this
  // generated file was resolved by keeping the stale branch content instead of
  // regenerating from a test run. wk5/8/9/11/12 escaped this because those
  // branches' own unrelated fixes (ONE-PER-FAMILY-1/2, d7334086 + 760a1369)
  // happened to touch the same lines and land correctly.
  //
  // Fix here is snapshot-only: `npx vitest run ... -u` against current
  // composePlan output, which the doctrine-band test above and every other
  // invariant in this file already passes against. No engine change.
  //
  // DRIFT ACCEPTED · CUTBACK-LONG-1 (2026-08-28) · THE CUTBACK LONG DROPS.
  //
  // Exactly the three cutback weeks move, nothing else: wk3 51.5→47.5 (long
  // 17→13), wk7 51→47 (long 19→15), wk11 53.5→51.5 (long 19→17). Research/00b
  // §"Depth of Cutback by Mileage Tier" states the long run's OWN reduction
  // per tier in the table's Notes column ("Long run –25%" for this fixture's
  // 60-80 mpw blocks); the engine cut the WEEK by 20% but the long dropped
  // only 6-16%, so the weekday runs absorbed the whole deload. Each cutback
  // long now lands at round(refLong × 0.75) off its preceding load block's
  // longest long (17×.75→13, 20×.75→15, 22.5×.75→17), and each week's total
  // cut lands inside the doc's 20-30% band (wk3 24.6% of 63, wk7 28.8% of 66,
  // wk11 24.3% of 68). Bound by CUTBACK.long-run-depth in the doctrine
  // registry; the applying pass is `applyCutbackLongDrop` in generate.ts.
  //
  // DRIFT ACCEPTED · DOSE-EFFORT-1 / REACH-4 (2026-08-30) · TWO NEWLY-REACHABLE
  // ENTRIES RESHUFFLE THE ROTATION, wk4/wk5/wk9/wk11 only.
  //
  // Two catalogue entries were `KNOWN_BLOCKED` until this commit —
  // `lydiard-hill-circuit` (its effort-cued sequence render declined outright)
  // and `continuous-mile-cutdowns` (the tempo slot, the only door with a
  // continuous-block renderer, didn't admit its `cutdown` family) — so neither
  // was ever in the intervals/tempo slots' LRU candidate pool. Both are fixed
  // and reachable now, and a deterministic LRU rotation drawing from a wider
  // pool necessarily redraws differently from week zero forward wherever a new
  // candidate wins a staleness tie:
  //
  //   · wk4 intervals: `long-hill-repeats` → `lydiard-hill-circuit` ("800m
  //     bound uphill + …·by effort"). wk5 intervals: `medium-hill-repeats`
  //     (6mi) → `long-hill-repeats` (7.5mi), purely because wk4 no longer used
  //     the latter — one new candidate ripples the recency every later week
  //     reads (see `CatalogueHistory`'s own doc comment on why rotation is
  //     LRU).
  //   · wk9 tempo: `wave-tempo` → `continuous-mile-cutdowns` ("6.5mi
  //     continuous mile cutdowns"). wk11 tempo: `continuous-tempo` →
  //     `wave-tempo`, the same one-new-candidate ripple, one slot over. Same
  //     mileage at both weeks — pure entry-choice reshuffle, no sizing change.
  //
  // wk4/wk5's MILEAGE also moves (wk4 64.5→62, wk5 64→65.5) for a second,
  // independent reason: `applyDosingCaps`'s reconciliation pass used to find a
  // phantom T/I finding for whichever hill session landed that week (its
  // rendered "@ T-10K effort" text read as real T/I zones to the OLD
  // `dosePaceOf`, though `fits()` had already priced the session's at-pace
  // miles at zero in the composer's own forward accounting) and trimmed a
  // paced sibling session to compensate. DOSE-EFFORT-1 makes `dosePaceOf`
  // agree with `fits()` — zero either way — so that trim no longer fires and
  // the tempo/intervals days it used to shave land at their natural size
  // (wk4 tempo 9→10mi, intervals 7.5→7mi; wk5 intervals 6→7.5mi from the
  // rotation swap above). wk9/wk11 carry no such trim either way, hence no
  // mileage change there.
  //
  // Verified NOT a cap violation: `_dosing_sweep_gate.test.ts` stays at 0
  // enforced breaches across the full 11598-archetype corpus both before and
  // after (reported taper-only findings actually DROP 7615→7592, the same
  // phantom-removal effect measured corpus-wide). `_sweep_allusers.test.ts`
  // and `_maint_invariants.test.ts` both stay at 0 findings. This file's own
  // doctrine-band test above (peak weekly/long) still passes unchanged.
  // ── RULE12-RESIDUAL-1 (2026-08-30) · the ONE reason this snapshot moved ────
  //
  // Every long run, every phase boundary and every quality type is unchanged,
  // and the `david-marathon-quality-vocab` snapshot beside this one did not move
  // at all. What moved is weekly MILEAGE, by at most 2 mi in either direction:
  //
  //   wk0 61→60  wk1 60→61  wk2 63.5→62  wk3 47.5→46  wk4 62→63  wk5 65.5→64
  //   wk6 66→65  wk7 47→48  wk8 65→66  wk9 65→66  wk10 68→66  wk11 51.5→51
  //   wk12 67.5→66  wk13 55→54  wk14 41→40      (wk15, the race week, unchanged)
  //
  // The easy day was the last whole-mile quantity in the week: `perEasy` was
  // `Math.round(remainingMi / easyCount)` and every easy day got that same
  // number, so the week's realized volume moved in `easyCount`-mile steps and a
  // quotient crossing x.5 moved the WEEK by three or four miles. The continuity
  // walk read that as the plan getting smaller as the runner trained more. The
  // quotient now floors to the half mile and the leftover is handed out half a
  // mile at a time, so the easy pool is the remainder to within half a mile and
  // the week tracks the budget the volume curve actually authored.
  //
  // These weeks are therefore CLOSER to their curve targets than the frozen
  // ones were, not further; the drift is the rounding error being removed.
  // Verified alongside: `_sweep_allusers` and `_maint_invariants` both stay at
  // zero findings with NO answer-key edit, `_dosing_sweep_gate` stays at zero
  // enforced breaches, and this file's own doctrine-band test (peak weekly /
  // peak long) still passes unchanged.
  /**
   * 2026-09-02 · THE SNAPSHOT MOVED ONCE, ON PURPOSE, AND HERE IS WHY.
   *
   * Two lines: weeks 9 and 11, `5×7 min @ I-T transition · 60s jog` →
   * `· 3:30 jog`. `Research/01`'s Interval row prescribes "Equal duration jog
   * (≥0.5× rep)"; a seven-minute repetition followed by sixty seconds is
   * 0.14× and was never doctrine. Nothing structural moved — the same weeks,
   * the same phases, the same mileage, the same long runs, the same session
   * families — which is what the first snapshot in this test asserts and what
   * stayed byte-identical.
   *
   * A frozen snapshot exists so drift has to be argued rather than absorbed.
   * This is the argument. Any FURTHER drift is still CRITICAL.
   *
   * ── 2026-09-02, SECOND MOVE · LADDER-TARGET-2 ─────────────────────────────
   *
   * `david-marathon-structure` is BYTE-IDENTICAL. Same weeks, same phases,
   * same weekly mileage, same long runs, same quality day types. Only
   * `david-marathon-quality-vocab` moved, on exactly three lines, and all
   * three are the same session written honestly:
   *
   *   wk8   7×1km · MP → 5K · 60s jog
   *      →  1km @ MP+10 · 60s jog + 1km @ MP+5 · … + 1km @ 5K
   *   wk10  4×2km · MP → T · 2 min jog
   *      →  2km @ MP+6 · 2 min jog + … + 2km @ T
   *   wk12  as wk8
   *
   * The old string NAMED a descent and shipped ONE pace: `buildWorkoutSpec`
   * priced the whole set at the slot's single anchor and `subLabelFromSpec`
   * re-derived the label from that spec, so a runner reading `MP → 5K` ran
   * seven identical kilometres. Measured across the archetype matrix by
   * `_ladder_targets.test.ts`: 2,581 of 2,898 ladder sessions shipped one flat
   * scalar; the fix takes it to 497, all of them a different shape.
   *
   * The rungs are doctrine, not invented. `Research/04` §12.3 says "Start at
   * MP, finish at 5K" and "Each rep 5 s/mi faster"; §11.2 says "Start slightly
   * slower than MP; descend across reps to slightly faster than T" and "Each
   * rep 2.5–5 s/km faster". The `+N` openers are §12.2's own Pace example
   * shape ("6 reps: MP+10, MP, MP-10, HM, T, 10K"), and the step is read out
   * of each entry's cited row at run time rather than chosen.
   *
   * Verified alongside: `_sweep_allusers`, `_maint_invariants` and
   * `_dosing_sweep_gate` all stay at zero findings, and this file's own
   * doctrine-band test passes unchanged. Any FURTHER drift is still CRITICAL.
   *
   * ── FROZEN SNAPSHOT MOVED · 2026-09-03 · MPLADDER-1 + TAPERLONG-1 ─────────
   *
   * Both snapshots moved, on five lines, and every one is a ruling in
   * `docs/PROGRESSIVE_BASELINE_DOCTRINE.md` landing on this fixture. Recorded
   * line by line rather than re-baselined, because that is what "FROZEN" is
   * for. WEEKLY MILEAGE IS UNCHANGED ON EVERY WEEK, which is the property this
   * fingerprint most exists to protect.
   *
   *   wk13  long 18 → 16 · wk14  long 13 → 10
   *      Q18, the owner overruling `Research/08` §9.2's table by name: "Not
   *      18/13. Use 14-16 mi two weeks out and 8-10 mi one week out."
   *
   *   wk13  tempo "2.5 mi WU · 11 mi @ MP · 1.5 mi CD" → race_week_tuneup
   *   wk14  tempo "2 mi WU · 7 mi @ MP · 1 mi CD" → "2.5 mi WU · 4.5 mi @ T · 1 mi CD"
   *      The taper's marathon-effort work moved INTO the long run (Q18), so
   *      §9.2's -2 row takes its own stated alternative, "or 4-5 mi threshold".
   *      Eighteen of this block's marathon-pace miles used to sit in these two
   *      weeks; that displacement is the S1.1 defect the ladder was built for.
   *
   *   wk8   intervals → tempo (2 quality → 1) · wk12  threshold → tempo+intervals (1 → 2)
   *      Q14: "When a long run carries ≥~6 meaningful marathon-effort miles, it
   *      IS a quality session — schedule only one additional midweek quality
   *      workout." wk8's long now carries the ladder's development dose and
   *      wk12's does not, so the second midweek slot moves with it. The block's
   *      total quality-day count is unchanged.
   *
   * Any drift BEYOND these five lines is still CRITICAL.
   */
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
    expect(isBaseBuildingPlan(distanceCategoryOrThrow(26.2), 'advanced_plus')).toBe(false);
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
      expect(isBaseBuildingPlan(distanceCategoryOrThrow(dist.mi), null)).toBe(false);
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
