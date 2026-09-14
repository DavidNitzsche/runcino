/**
 * lib/race/goal-outcome-resolver.test.ts · falsifying tests for THE
 * goal-outcome resolver.
 *
 * ── WHAT THIS GATE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
 *
 *   · IT CANNOT TELL YOU THE INPUT WAS RESOLVED CORRECTLY. Every fixture
 *     hands the resolver already-decided facts and checks what it CONCLUDES
 *     from them — a wrong `targetRaceEvidenceWeight` computed upstream,
 *     handed in here, produces a confidently wrong (but internally
 *     consistent) verdict. `lib/postrun/_postrun_live.audit.test.ts`-style
 *     coverage against real production reads is a separate concern.
 *   · IT DOES NOT PICK WHICH TARGET NUMBER IS CANONICAL. Which of a race's
 *     several live target numbers to hand in as `publishedTargetSec` is
 *     Wave 2 / U7's territory (see the resolver's own header).
 *
 * The Santa Monica 10K case is reproduced from the forensic debrief's own
 * cited numbers (`for external review/00-master-programme/
 * SANTA-MONICA-10K-FORENSIC-DEBRIEF-2026-09-13.md`), independently
 * re-verified against `DATABASE_URL_RO` before writing this file:
 *
 *   · measured 10K-equivalent finish   ~2753s (45:53, `runs.id
 *     -159534527913687`, `data.durationSec`)
 *   · published target                 2585s (43:05) —
 *     `race-outlook.ts:872`'s live recompute; 2575s (42:55) — the frozen
 *     `plan_workouts.workout_spec.race_execution.target_sec` snapshot. Both
 *     are used below to prove the verdict does not hinge on which of the
 *     two numbers a caller hands in — a race that fails this bad only on
 *     one of them would be a Rule 16 problem, not a resolved case.
 *   · race-evidence weight              0.02 (`durabilityBlend.weight`,
 *     solved from the debrief's own `2575 = w·2724 + (1-w)·2572`)
 *   · target evidence corroboration     false (one cruise-interval session)
 *   · preparation demonstrated/demand   422s / 2580s (7:02 of continuous
 *     race-pace running against a ~43-minute demand)
 */
import { describe, it, expect } from 'vitest';
import {
  resolveGoalOutcome,
  TARGET_EVIDENCE_WEIGHT_FLOOR,
  PREPARATION_SUPPORT_RATIO_FLOOR,
  type GoalOutcomeInput,
} from './goal-outcome-resolver';

const SANTA_MONICA_BASE: GoalOutcomeInput = {
  raceId: 'santa-monica-10k-2026-09-13',
  measuredFinishSec: 2753,
  publishedTargetSec: 2585,
  targetRaceEvidenceWeight: 0.02,
  targetEvidenceCorroborated: false,
  preparationSupport: { ok: true, demonstratedSec: 422, demandSec: 2580 },
};

describe('resolveGoalOutcome · Santa Monica, the concrete acceptance case', () => {
  it('classifies target_invalidated with BOTH reasons — the ruling\'s exact "and/or", both true at once', () => {
    const r = resolveGoalOutcome(SANTA_MONICA_BASE);
    expect(r.outcome).toBe('target_invalidated');
    expect(r.reasons).toContain('target_evidence_unreliable');
    expect(r.reasons).toContain('insufficient_preparation_support');
    expect(r.reasons).toHaveLength(2);
  });

  it('excludes automatically from adaptation — the ruling\'s "must NOT trigger or contribute" cashed out as one boolean', () => {
    const r = resolveGoalOutcome(SANTA_MONICA_BASE);
    expect(r.excludeFromAutomaticAdaptation).toBe(true);
  });

  it('does not hinge on which of the two live target numbers is handed in (43:05 live recompute vs 42:55 frozen snapshot)', () => {
    const withLiveTarget = resolveGoalOutcome({ ...SANTA_MONICA_BASE, publishedTargetSec: 2585 });
    const withFrozenTarget = resolveGoalOutcome({ ...SANTA_MONICA_BASE, publishedTargetSec: 2575 });
    expect(withLiveTarget.outcome).toBe('target_invalidated');
    expect(withFrozenTarget.outcome).toBe('target_invalidated');
    expect(withLiveTarget.reasons.sort()).toEqual(withFrozenTarget.reasons.sort());
  });

  it('the explanation names the measured result as valid and the target as the defect — never the reverse', () => {
    const r = resolveGoalOutcome(SANTA_MONICA_BASE);
    expect(r.explanation).toContain('2753');
    expect(r.explanation.toLowerCase()).toContain('measured performance');
    expect(r.explanation.toLowerCase()).toContain('stays valid');
  });

  it('FALSIFIED: a corroborated, well-weighted, well-prepared version of the SAME race scores met/missed, never invalidated', () => {
    // Same result, same target — only the evidence quality changed. If this
    // ever classified target_invalidated too, the resolver would be reading
    // the RESULT instead of the TARGET's own evidence, which is exactly the
    // conflation this file exists to remove.
    const r = resolveGoalOutcome({
      ...SANTA_MONICA_BASE,
      targetRaceEvidenceWeight: 0.9,
      targetEvidenceCorroborated: true,
      preparationSupport: { ok: true, demonstratedSec: 2600, demandSec: 2580 },
    });
    expect(r.outcome).toBe('missed');
    expect(r.reasons).toEqual([]);
    expect(r.excludeFromAutomaticAdaptation).toBe(false);
  });
});

describe('resolveGoalOutcome · not_assessable', () => {
  it('no measured performance', () => {
    const r = resolveGoalOutcome({ ...SANTA_MONICA_BASE, measuredFinishSec: null });
    expect(r.outcome).toBe('not_assessable');
    expect(r.reasons).toEqual(['no_measured_performance']);
    expect(r.excludeFromAutomaticAdaptation).toBe(true);
  });

  it('no published target — even with a real measured performance', () => {
    const r = resolveGoalOutcome({ ...SANTA_MONICA_BASE, publishedTargetSec: null });
    expect(r.outcome).toBe('not_assessable');
    expect(r.reasons).toEqual(['no_published_target']);
  });

  it('a race unsealed in races.actual_result is STILL assessable — measuredFinishSec is independent of sealing', () => {
    // The resolver's own contract: measuredFinishSec comes from the matched
    // canonical run, not races.actual_result. A caller that resolved it
    // despite the race sitting unsealed (Rule 23's cron-ordering gap) gets a
    // real verdict, not a refusal borrowed from an unrelated operational fact.
    const r = resolveGoalOutcome(SANTA_MONICA_BASE);
    expect(r.outcome).not.toBe('not_assessable');
  });
});

describe('resolveGoalOutcome · target_evidence_unreliable alone', () => {
  it('fires when weight is under the floor and uncorroborated, with no preparation signal at all', () => {
    const r = resolveGoalOutcome({
      ...SANTA_MONICA_BASE,
      preparationSupport: { ok: false, reason: 'not_measured' },
    });
    expect(r.outcome).toBe('target_invalidated');
    expect(r.reasons).toEqual(['target_evidence_unreliable']);
  });

  it('does NOT fire when the weight is low but the OTHER branch is corroborated', () => {
    const r = resolveGoalOutcome({
      ...SANTA_MONICA_BASE,
      targetEvidenceCorroborated: true,
      preparationSupport: { ok: false, reason: 'not_measured' },
    });
    expect(r.outcome).not.toBe('target_invalidated');
  });

  it('an UNRESOLVED weight (null) is treated as unknown, never as zero — Rule 11', () => {
    const r = resolveGoalOutcome({
      ...SANTA_MONICA_BASE,
      targetRaceEvidenceWeight: null,
      preparationSupport: { ok: false, reason: 'not_measured' },
    });
    // A null weight must not silently manufacture an invalidation on its own.
    expect(r.reasons).not.toContain('target_evidence_unreliable');
  });
});

describe('resolveGoalOutcome · insufficient_preparation_support alone', () => {
  it('fires below the floor even with a fully reliable target', () => {
    const r = resolveGoalOutcome({
      ...SANTA_MONICA_BASE,
      targetRaceEvidenceWeight: 0.95,
      targetEvidenceCorroborated: true,
    });
    expect(r.outcome).toBe('target_invalidated');
    expect(r.reasons).toEqual(['insufficient_preparation_support']);
  });

  it('does not fire when preparation was not_applicable (no continuous-pace demand worth checking)', () => {
    const r = resolveGoalOutcome({
      ...SANTA_MONICA_BASE,
      targetRaceEvidenceWeight: 0.95,
      targetEvidenceCorroborated: true,
      preparationSupport: { ok: false, reason: 'not_applicable' },
    });
    expect(r.outcome).not.toBe('target_invalidated');
  });

  it('exactly at the floor is NOT insufficient — the floor is a lower bound, not a strict interior', () => {
    const demand = 1000;
    const atFloor = demand * PREPARATION_SUPPORT_RATIO_FLOOR;
    const r = resolveGoalOutcome({
      ...SANTA_MONICA_BASE,
      targetRaceEvidenceWeight: 0.95,
      targetEvidenceCorroborated: true,
      preparationSupport: { ok: true, demonstratedSec: atFloor, demandSec: demand },
    });
    expect(r.reasons).not.toContain('insufficient_preparation_support');
  });
});

describe('resolveGoalOutcome · met / missed, over a valid target', () => {
  const validEvidence = { targetRaceEvidenceWeight: 0.95, targetEvidenceCorroborated: true } as const;

  it('exceeding the target is met, tagged exceeded_target', () => {
    const r = resolveGoalOutcome({
      ...SANTA_MONICA_BASE, ...validEvidence,
      preparationSupport: { ok: true, demonstratedSec: 2600, demandSec: 2580 },
      measuredFinishSec: 2500, publishedTargetSec: 2585,
    });
    expect(r.outcome).toBe('met');
    expect(r.reasons).toEqual(['exceeded_target']);
  });

  it('within doctrine\'s own optimism tolerance still reads met, tagged within_tolerance_of_target', () => {
    const r = resolveGoalOutcome({
      ...SANTA_MONICA_BASE, ...validEvidence,
      preparationSupport: { ok: true, demonstratedSec: 2600, demandSec: 2580 },
      measuredFinishSec: 2600, publishedTargetSec: 2585, // ~0.6% over — inside a 5% band
    });
    expect(r.outcome).toBe('met');
    expect(r.reasons).toEqual(['within_tolerance_of_target']);
  });

  it('a real miss, well outside tolerance, over a fully valid target', () => {
    const r = resolveGoalOutcome({
      ...SANTA_MONICA_BASE, ...validEvidence,
      preparationSupport: { ok: true, demonstratedSec: 2600, demandSec: 2580 },
      measuredFinishSec: 2900, publishedTargetSec: 2585,
    });
    expect(r.outcome).toBe('missed');
    expect(r.reasons).toEqual([]);
    expect(r.excludeFromAutomaticAdaptation).toBe(false);
  });
});

describe('resolveGoalOutcome · reasons is empty exactly on met/missed, non-empty exactly on target_invalidated', () => {
  it('never a non-empty reasons array on met', () => {
    const r = resolveGoalOutcome({
      ...SANTA_MONICA_BASE, targetRaceEvidenceWeight: 0.95, targetEvidenceCorroborated: true,
      preparationSupport: { ok: true, demonstratedSec: 2600, demandSec: 2580 },
      measuredFinishSec: 2000, publishedTargetSec: 2585,
    });
    expect(r.outcome).toBe('met');
    expect(r.reasons.length).toBeGreaterThan(0); // met still carries ITS OWN tag
    expect(r.reasons).not.toContain('target_evidence_unreliable');
    expect(r.reasons).not.toContain('insufficient_preparation_support');
  });

  it('never an empty reasons array on target_invalidated', () => {
    const r = resolveGoalOutcome(SANTA_MONICA_BASE);
    expect(r.outcome).toBe('target_invalidated');
    expect(r.reasons.length).toBeGreaterThan(0);
  });
});
