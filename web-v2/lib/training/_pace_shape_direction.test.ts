/**
 * lib/training/_pace_shape_direction.test.ts · DIRECTION-1, 2026-09-04.
 *
 * Every pace shape asserts a DIRECTION, and a defect this session shipped —
 * `experience.ts`'s now-deleted `paceShortfalls` clause — proved that
 * "actual vs. prescribed" arithmetic without first reading the shape reads
 * exactly backwards for a ceiling: it reported a runner who ran SLOWER than
 * an easy-day ceiling (8:48/mi against an 8:00/mi ceiling — fully compliant,
 * by construction) as having missed a target. This file is the falsifiable
 * boundary matrix that should have caught it, walking every real shape this
 * engine has across every direction it can be wrong in.
 *
 * ── THE REAL SHAPE SET, STATED PLAINLY ──────────────────────────────────────
 *
 * `PrescriptionShape` (`lib/training/prescription-resolver.ts`) has exactly
 * FOUR values: `ceiling`, `window`, `effort`, `none`. This engine has no
 * distinct `floor` or `target` or `observational` type — a request to audit
 * those as separate shapes is answered here by mapping onto the real four,
 * not by inventing types that do not exist:
 *
 *   · ceiling — "do not go FASTER than this." Slower is never a miss. Easy,
 *     long, recovery, warm-up, cool-down, shakeout — AND, as of MP-EMBEDDED-1
 *     below, never a marathon-pace-specific phase, however it is embedded.
 *   · window  — "hold this, both sides." Threshold, interval, race pace,
 *     and (as of MP-EMBEDDED-1) an embedded marathon-pace segment.
 *   · effort  — a target exists but not as a pace. Never pace-graded. There
 *     is no "effort-governed ceiling" — effort and ceiling are mutually
 *     exclusive by construction (`paceShapeFor`'s `byEffort` check runs
 *     before the phase-type switch).
 *   · none    — no prescribed pace. Never pace-graded. This is the engine's
 *     answer for "observational, report only" — a phase with no target is
 *     recorded and never judged, which is what "observational" means here.
 *
 * There is no separate "floor" shape (nothing in this engine prescribes a
 * MINIMUM pace with no ceiling) — a request to test one is not skipped by
 * oversight, it is answered by this paragraph: the shape does not exist, so
 * a test asserting its direction would be asserting behaviour of code that
 * is not there.
 *
 * ── WHAT THIS FILE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
 *
 *   · Whether the WIDTHS are doctrine-correct — `_execution_semantics_owner
 *     .test.ts` (EXECSEM-1/2) and the doctrine registry (`PACE.*`) own that.
 *     This file asserts DIRECTION only: which side of a boundary a shape
 *     fails on, never whether the boundary's distance is the right number.
 *   · The composed SENTENCE. `_experience.test.ts`'s `KEY-PHASE-1` and
 *     `PORTIONS-1` blocks own the prose; this file owns the grade a sentence
 *     is built from.
 *   · The Swift/wrist side. `_watch_grader_parity.test.ts` covers that seam.
 */
import { describe, it, expect } from 'vitest';
import {
  gradeCeilingPhase,
  gradeWorkPhase,
  gradePhase,
  paceShapeFor,
  EASY_PHASE_TOLERANCE_S_PER_MI,
  MP_PHASE_TOLERANCE_S_PER_MI,
  looksLikeMarathonPaceLabel,
} from './execution-semantics';
import { gradeStoredPhases } from '@/lib/execution/verdict';

/* ═══════════════════════ 1 · CEILING · "not faster than" ═══════════════════
 *
 * "Smaller number = faster" is the whole engine's convention (seconds per
 * mile). A ceiling's ONE failure direction is therefore avg < ceiling - slack
 * — running with a SMALLER number than the ceiling allows. Running with a
 * LARGER number (slower) can never fail a ceiling, at any distance from it.
 */
describe('CEILING · fails only for running FASTER than the ceiling, never slower', () => {
  const CEILING = 480; // 8:00/mi

  it('comfortably compliant · well slower than the ceiling', () => {
    expect(gradeCeilingPhase({ ceilingSecPerMi: CEILING, avgSecPerMi: 600 })).toBe('hit'); // 10:00/mi
  });

  it('exactly at the boundary · avg === ceiling', () => {
    expect(gradeCeilingPhase({ ceilingSecPerMi: CEILING, avgSecPerMi: CEILING })).toBe('hit');
  });

  it('just inside the fast-side slack · one second on the compliant side', () => {
    // slack defaults to EASY_PHASE_TOLERANCE_S_PER_MI (30) · ceiling - slack + 1
    expect(gradeCeilingPhase({ ceilingSecPerMi: CEILING, avgSecPerMi: CEILING - EASY_PHASE_TOLERANCE_S_PER_MI + 1 })).toBe('hit');
  });

  it('exactly at the fast-side slack boundary · still compliant, the check is strict-less-than', () => {
    expect(gradeCeilingPhase({ ceilingSecPerMi: CEILING, avgSecPerMi: CEILING - EASY_PHASE_TOLERANCE_S_PER_MI })).toBe('hit');
  });

  it('just outside the fast-side slack · one second past it', () => {
    expect(gradeCeilingPhase({ ceilingSecPerMi: CEILING, avgSecPerMi: CEILING - EASY_PHASE_TOLERANCE_S_PER_MI - 1 })).toBe('fast');
  });

  it('much faster · a real overcook', () => {
    expect(gradeCeilingPhase({ ceilingSecPerMi: CEILING, avgSecPerMi: 380 })).toBe('fast'); // 6:20/mi
  });

  it('MUCH SLOWER · still `hit`. The direction this session shipped backwards.', () => {
    // 12:00/mi against an 8:00/mi ceiling — a huge gap, and doctrine is
    // explicit (`gradeCeilingPhase`'s own header, Research/01 §9/§11) that
    // there is no bottom to an easy-day ceiling.
    expect(gradeCeilingPhase({ ceilingSecPerMi: CEILING, avgSecPerMi: 720 })).toBe('hit');
  });

  it('missing pace · avgSecPerMi null', () => {
    expect(gradeCeilingPhase({ ceilingSecPerMi: CEILING, avgSecPerMi: null })).toBe('not_graded');
  });

  it('missing ceiling · ceilingSecPerMi null', () => {
    expect(gradeCeilingPhase({ ceilingSecPerMi: null, avgSecPerMi: 500 })).toBe('not_graded');
  });

  it('not completed · incomplete regardless of pace', () => {
    expect(gradeCeilingPhase({ ceilingSecPerMi: CEILING, avgSecPerMi: 380, completed: false })).toBe('incomplete');
  });
});

/* ═══════════════════════ 2 · WINDOW · "hold this, both sides" ══════════════
 *
 * A window has TWO failure directions, symmetric around the target:
 * avg < target - tolerance is `fast` (still not a "miss" per doctrine —
 * `sessionLadder` counts `fast` as landed — but a real deviation on the fast
 * side), avg > target + tolerance is `slow` (a real miss, the one direction
 * `sessionLadder` never counts as landed).
 */
describe('WINDOW · fails on BOTH sides of the target, symmetrically', () => {
  const TARGET = 430; // 7:10/mi
  const TOL = 8; // threshold width

  it('comfortably compliant · avg === target', () => {
    expect(gradeWorkPhase({ targetSecPerMi: TARGET, avgSecPerMi: TARGET, toleranceSec: TOL })).toBe('hit');
  });

  it('exactly at the slow-side boundary · avg === target + tolerance', () => {
    expect(gradeWorkPhase({ targetSecPerMi: TARGET, avgSecPerMi: TARGET + TOL, toleranceSec: TOL })).toBe('hit');
  });

  it('just outside the slow-side boundary · one second past it', () => {
    expect(gradeWorkPhase({ targetSecPerMi: TARGET, avgSecPerMi: TARGET + TOL + 1, toleranceSec: TOL })).toBe('slow');
  });

  it('exactly at the fast-side boundary · avg === target - tolerance', () => {
    expect(gradeWorkPhase({ targetSecPerMi: TARGET, avgSecPerMi: TARGET - TOL, toleranceSec: TOL })).toBe('hit');
  });

  it('just outside the fast-side boundary · one second past it', () => {
    expect(gradeWorkPhase({ targetSecPerMi: TARGET, avgSecPerMi: TARGET - TOL - 1, toleranceSec: TOL })).toBe('fast');
  });

  it('much faster', () => {
    expect(gradeWorkPhase({ targetSecPerMi: TARGET, avgSecPerMi: 350, toleranceSec: TOL })).toBe('fast');
  });

  it('much slower', () => {
    expect(gradeWorkPhase({ targetSecPerMi: TARGET, avgSecPerMi: 600, toleranceSec: TOL })).toBe('slow');
  });

  it('missing pace', () => {
    expect(gradeWorkPhase({ targetSecPerMi: TARGET, avgSecPerMi: null, toleranceSec: TOL })).toBe('not_graded');
  });

  it('missing target', () => {
    expect(gradeWorkPhase({ targetSecPerMi: null, avgSecPerMi: 430, toleranceSec: TOL })).toBe('not_graded');
  });

  it('missing tolerance', () => {
    expect(gradeWorkPhase({ targetSecPerMi: TARGET, avgSecPerMi: 430, toleranceSec: null })).toBe('not_graded');
  });

  it('not completed · incomplete regardless of pace', () => {
    expect(gradeWorkPhase({ targetSecPerMi: TARGET, avgSecPerMi: TARGET, toleranceSec: TOL, completed: false })).toBe('incomplete');
  });
});

/* ═══════════════════════ 3 · EFFORT and NONE · never pace-graded ═══════════ */

describe('EFFORT and NONE · a shape, not a grade — pace never decides', () => {
  it('EFFORT · byEffort true refuses to grade even a wildly-off pace', () => {
    expect(gradePhase({ phaseType: 'work', targetSecPerMi: 430, avgSecPerMi: 900, byEffort: true }, 'interval'))
      .toBe('not_graded');
  });

  it('NONE · no target refuses to grade even a wildly-off pace', () => {
    expect(gradePhase({ phaseType: 'work', targetSecPerMi: null, avgSecPerMi: 900 }, 'interval'))
      .toBe('not_graded');
  });

  it('NONE · a recovery phase is always none, even carrying a legacy target', () => {
    expect(paceShapeFor('recovery', 'threshold', { hasTarget: true })).toBe('none');
  });
});

/* ═══════════════════ 4 · shape resolution itself, by class and type ════════ */

describe('paceShapeFor · the shape a phase TYPE + SESSION CLASS resolves to', () => {
  it('a quality work phase is a window', () => {
    expect(paceShapeFor('work', 'threshold')).toBe('window');
    expect(paceShapeFor('work', 'interval')).toBe('window');
    expect(paceShapeFor('work', 'race')).toBe('window');
  });

  it('an easy or long work phase is a ceiling', () => {
    expect(paceShapeFor('work', 'easy')).toBe('ceiling');
    expect(paceShapeFor('work', 'long')).toBe('ceiling');
  });

  it('a warm-up or cool-down is ALWAYS a ceiling, whatever the session', () => {
    expect(paceShapeFor('warmup', 'threshold')).toBe('ceiling');
    expect(paceShapeFor('cooldown', 'race')).toBe('ceiling');
  });

  it('MISSING SHAPE / legacy payload · a phase with no target resolves to none, not a guess', () => {
    expect(paceShapeFor('work', 'threshold', { hasTarget: false })).toBe('none');
  });
});

/* ═════════ 5 · MP-EMBEDDED-1 · a marathon-pace phase within a long run ═════
 *
 * `paceShapeFor` alone CANNOT see this — it takes a phase TYPE and a SESSION
 * class, never per-phase intent, so every work phase in a `long` session
 * reads `ceiling` uniformly. `gradeStoredPhases` is the one place that also
 * holds the phase's own LABEL, and this is the boundary matrix for the
 * override it applies there.
 */
describe('MP-EMBEDDED-1 · a marathon-pace-labelled phase in a long run grades as a WINDOW', () => {
  it('detects the label, case-insensitively, with or without punctuation', () => {
    expect(looksLikeMarathonPaceLabel('4.0 mi @ marathon pace')).toBe(true);
    expect(looksLikeMarathonPaceLabel('Marathon Pace block')).toBe(true);
    expect(looksLikeMarathonPaceLabel('MARATHON-PACE')).toBe(true);
    expect(looksLikeMarathonPaceLabel('10.0 mi easy')).toBe(false);
    expect(looksLikeMarathonPaceLabel(null)).toBe(false);
  });

  function longRun(phases: Array<Record<string, unknown>>) {
    return gradeStoredPhases(phases, 'long', {}).phases;
  }

  it('an MP-labelled phase with NO wire shape grades as window, at ±5 s/mi', () => {
    const graded = longRun([
      { index: 0, type: 'work', label: '4.0 mi @ marathon pace', completed: true,
        targetPaceSPerMi: 434, actualPaceSPerMi: 439 }, // +5, exactly at the boundary
    ]);
    expect(graded[0].shape).toBe('window');
    expect(graded[0].toleranceSec).toBe(MP_PHASE_TOLERANCE_S_PER_MI);
    expect(graded[0].verdict).toBe('hit');
  });

  it('one second past the ±5 boundary on the slow side · slow, not "compliant with a ceiling"', () => {
    const graded = longRun([
      { index: 0, type: 'work', label: '4.0 mi @ marathon pace', completed: true,
        targetPaceSPerMi: 434, actualPaceSPerMi: 440 },
    ]);
    expect(graded[0].verdict).toBe('slow');
  });

  it('a non-MP-labelled work phase in the SAME long run still grades as a ceiling', () => {
    const graded = longRun([
      { index: 0, type: 'work', label: '10.0 mi easy', completed: true,
        targetPaceSPerMi: 480, actualPaceSPerMi: 720 }, // dramatically slower
    ]);
    expect(graded[0].shape).toBe('ceiling');
    expect(graded[0].verdict).toBe('hit'); // never fails for slow
  });

  it('an EXPLICIT wire shape always wins over the label — Rule 10, a stamped anchor is read, not guessed', () => {
    const graded = longRun([
      { index: 0, type: 'work', label: '4.0 mi @ marathon pace', completed: true,
        paceShape: 'ceiling', targetPaceSPerMi: 434, actualPaceSPerMi: 900 },
    ]);
    expect(graded[0].shape).toBe('ceiling');
    expect(graded[0].verdict).toBe('hit');
  });
});

/* ═════════════ 6 · the five real-shaped examples, named verdicts ═══════════ */

describe('the five real-shaped examples · plain-language verdict beside each', () => {
  it('1 · easy ceiling 8:42, actual 8:35 · FASTER than the ceiling by 7s, inside the 30s slack · compliant', () => {
    // Verdict in plain language: within the allowed fast-side slack. Not
    // "correct because faster, not slower" — it is compliant because 7s is
    // inside doctrine's own 30s easy-day slack; 31s fast would not be.
    expect(gradeCeilingPhase({ ceilingSecPerMi: 522, avgSecPerMi: 515 })).toBe('hit');
  });

  it('2 · easy ceiling 8:00, actual 8:48 · 48s SLOWER than the ceiling · compliant, never a miss', () => {
    // Verdict in plain language: a ceiling has no slow-side edge. This is
    // the exact case the deleted `paceShortfalls` clause got backwards.
    expect(gradeCeilingPhase({ ceilingSecPerMi: 480, avgSecPerMi: 528 })).toBe('hit');
  });

  it('3 · marathon-effort window 7:14, actual 7:42 · 28s slower than a ±5s window · a real miss', () => {
    // Verdict in plain language: this phase WAS a target/window (MP-
    // EMBEDDED-1's detection), and 28s past a 5s tolerance is genuinely slow.
    const graded = gradeStoredPhases([
      { index: 0, type: 'work', label: '4.0 mi @ marathon pace', completed: true,
        targetPaceSPerMi: 434, actualPaceSPerMi: 462 },
    ], 'long', {}).phases;
    expect(graded[0].shape).toBe('window');
    expect(graded[0].verdict).toBe('slow');
  });

  it('4 · Sept 1 interval window, 422/429/422/419 against 430±8 · three hit, one fast', () => {
    // Verdict in plain language: the owner's real 4×1mi session. The last
    // rep (419) sits 11s under target — past the 8s fast-side edge — and
    // grades `fast`, which `sessionLadder` counts as landed, never a miss.
    const reps = [422, 429, 422, 419].map((avg) =>
      gradeWorkPhase({ targetSecPerMi: 430, avgSecPerMi: avg, toleranceSec: 8 }));
    expect(reps).toEqual(['hit', 'hit', 'hit', 'fast']);
  });

  it('5 · self-authored AFC race-segment windows · one hit, four slow', () => {
    // Verdict in plain language: the owner's real Americas Finest City half.
    // Race tolerance is ±12 s/mi; Point Loma Climb (428 asked, 436 actual,
    // +8) clears it, the other four (+15 to +105) do not.
    const segments: Array<[target: number, actual: number]> = [
      [428, 436], // Point Loma Climb
      [399, 414], // The Drop
      [411, 479], // Mission Bay
      [408, 465], // Harbor Approach
      [418, 523], // Balboa Finish
    ];
    const graded = segments.map(([target, avg]) =>
      gradeWorkPhase({ targetSecPerMi: target, avgSecPerMi: avg, toleranceSec: 12 }));
    expect(graded).toEqual(['hit', 'slow', 'slow', 'slow', 'slow']);
  });
});
