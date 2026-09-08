/**
 * lib/postrun/_tension_direction_and_voice.test.ts
 *
 * Two findings from a Product Experience review of the owner's REAL
 * 2026-09-08 tempo, rendered on the phone against his own account.
 *
 * ── TENSION-DIRECTION-1 · the panel called his best signal an anomaly ───────
 *
 * The screen read, in full:
 *
 *   "Work heart rate averaged 159 against a 164 ceiling.
 *    This sits outside what your current threshold range predicts. It is
 *    noted, and the next session like it will settle whether the number
 *    moves."
 *
 * 159 is UNDER 164. He held 7:11 for 3.5 miles at a LOWER cardiac cost than
 * the current belief predicts, which is durability evidence and a good day.
 * The sentence was written direction-blind — one string served both arms of a
 * union that carries an explicit `direction` — so the only wording that fits
 * both is the wording that commits to neither, and "sits outside" is the
 * vocabulary of a reading that went wrong.
 *
 * ── COACH-VOICE-1 · "The work block landed inside the window." ─────────────
 *
 * Engine nouns twice in eight words. `work block` is this composer's name for
 * `work[0]`; `the window` is `paceShapeFor`'s name for its shape. Neither is
 * a thing a coach says, and between them they name no number at all.
 *
 * ── WHAT THIS GATE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
 *
 *   · IT CANNOT TELL YOU THE VERDICT IS RIGHT. It checks what the composer
 *     SAYS about a grade it is handed. A wrong grade, worded beautifully,
 *     passes here.
 *   · IT CANNOT SEE THE PHONE. Nothing here proves a screen draws any of it.
 *   · THE WEAKER-THAN-BELIEF ARM IS SYNTHETIC AND SAYS SO. The owner has no
 *     stored run that produced it — `readBeliefTension`'s weaker arm needs a
 *     graded effort run FRESH and more than the margin slower than belief,
 *     and his history has none. The fixture below is hand-built and LABELLED
 *     as hand-built (Rule 13 clause 2: never pass a fixture off as real). Its
 *     numbers are the stronger arm's mirrored, not measurements.
 *
 * ── FALSIFIED (Rule 18) ─────────────────────────────────────────────────────
 *
 * Against the pre-fix composer every assertion below fails: both tension arms
 * return the identical "sits outside … whether the number moves" string, and
 * the one-block summary returns "The work block landed inside the window."
 */
import { describe, it, expect } from 'vitest';
import { gradeStoredPhases } from '@/lib/execution/verdict';
import { composePostRunExperience, type PostRunInput } from './experience';
import type {
  ActivityEvidenceResult, BeliefTensionRead, CapacityEvidence, CapacityName,
} from '@/lib/evidence/activity-evidence';

/** The owner's REAL 2026-09-08 tempo, `runs.data.phases` verbatim (run id
 *  `-75144899844434`), minus the per-second `hrSamples` arrays. */
const REAL_0908_PHASES = [
  {
    type: 'warmup', index: 0, label: 'Warm-up', avgHr: 128, maxHr: 147,
    verdict: 'hit', completed: true, paceShape: 'ceiling', avgCadence: 155,
    actualDistanceMi: 1.51, actualPaceSPerMi: 510, targetPaceSPerMi: 502,
    actualDurationSec: 769,
  },
  {
    type: 'work', index: 1, label: '3.5 mi tempo', avgHr: 159, maxHr: 166,
    verdict: 'hit', completed: true, paceShape: 'window', avgCadence: 171,
    actualDistanceMi: 3.5, actualPaceSPerMi: 431, targetPaceSPerMi: 430,
    actualDurationSec: 1509,
  },
  {
    type: 'cooldown', index: 2, label: 'Cool-down', avgHr: 151, maxHr: 164,
    verdict: 'hit', completed: true, paceShape: 'ceiling', avgCadence: 158,
    actualDistanceMi: 1.2, actualPaceSPerMi: 497, targetPaceSPerMi: 502,
    actualDurationSec: 598,
  },
  {
    type: 'overtime', index: 3, label: 'After the session', completed: true,
    actualDistanceMi: 0.24, actualPaceSPerMi: 482, actualDurationSec: 118,
  },
];

function noEvidence(name: CapacityName): CapacityEvidence {
  return { capacity: name, kind: 'no_evidence', reasons: [] } as CapacityEvidence;
}

function evidenceWith(tension: BeliefTensionRead): ActivityEvidenceResult {
  return {
    modelVersion: '1.0.0',
    activityId: '-75144899844434',
    date: '2026-09-08',
    eligibility: {
      admissible: true,
      signals: { distance: 'high', duration: 'high', pace: 'high', hr: 'high', power: 'moderate', dynamics: 'moderate' },
      signalReasons: [],
      continuity: { grain: 'splits', grade: 'high', weight: 1, unaccountedSec: 0, unaccountedFraction: 0, interruptedSplitIndices: [], reasons: [] },
      rejections: [],
    },
    environment: { hrCostPlausiblyElevated: false, load: 'none', reasons: [] },
    capacities: {
      threshold: noEvidence('threshold'),
      high_intensity: noEvidence('high_intensity'),
      durability: noEvidence('durability'),
      easy_ceiling: noEvidence('easy_ceiling'),
    },
    beliefTension: tension,
    trainingLoad: { stimulus: 'threshold', aerobicMinutes: 50, distanceMi: 6.46, primaryValue: 'Threshold work.' },
    anchorMoveCandidate: false,
    anchorMoveReasons: [],
    reasons: [],
  } as unknown as ActivityEvidenceResult;
}

/**
 * The STRONGER arm, with the numbers `readBeliefTension` would produce for a
 * threshold block held past accumulated load. Direction is the field under
 * test; the rest is scaffolding.
 */
const STRONGER: BeliefTensionRead = {
  ok: true, capacity: 'threshold', code: 'CONTRADICTS_CURRENT_ESTIMATE',
  direction: 'observation_stronger_than_belief',
  believedPaceSecPerMi: 440, observedPaceSecPerMi: 431,
  magnitudeSecPerMi: 9, magnitudePct: 2.05,
  observedMinutes: 25.2, accumulatedMinutesBefore: 12.8, beliefAsOf: '2026-09-01',
  anchorEffect: 'no_change_flag_for_reexamination', reexaminationWeight: 0.42,
  reasons: ['SUSTAINED_WORK_MATCHED_BELIEF_UNDER_ACCUMULATED_LOAD'],
};

/**
 * The WEAKER arm. HAND-BUILT, NOT MEASURED — see the header. No run in this
 * account has ever produced `observation_weaker_than_belief`, so this fixture
 * is the only way to reach the branch, and it is named as a fixture rather
 * than presented as a rendered result.
 */
const WEAKER_SYNTHETIC: BeliefTensionRead = {
  ...STRONGER,
  direction: 'observation_weaker_than_belief',
  observedPaceSecPerMi: 462, magnitudeSecPerMi: -22, magnitudePct: -5.0,
  reasons: ['GRADED_EFFORT_SLOWER_THAN_BELIEF_WHILE_FRESH'],
};

function compose(tension: BeliefTensionRead) {
  const verdict = gradeStoredPhases(REAL_0908_PHASES, 'threshold');
  return composePostRunExperience({
    runId: '-75144899844434',
    dateISO: '2026-09-08',
    plannedType: 'tempo',
    plannedTypeDisplay: 'Tempo',
    plannedDistanceMi: 6.2,
    raceMatched: false,
    targetProvenance: 'plan',
    verdict,
    evidence: evidenceWith(tension),
    workHrCeilingBpm: 164,
    overallHrCeilingBpm: null,
    wholeRunHrBpm: 149,
    rpe: null,
    adaptations: [],
    hasActivePlan: true,
    activePlanId: 'pln_fixture',
    sensorLimited: false,
    stridesPrescribed: 0,
    recordedDistanceMi: 6.46,
    recordedDurationSec: 2994,
    clockAudit: null,
  } as unknown as PostRunInput);
}

describe('TENSION-DIRECTION-1 · the sentence names which way the belief looks wrong', () => {
  it('STRONGER · says he held the pace deeper into the session, and names the number', () => {
    const out = compose(STRONGER);
    expect(out.evidence.role).toBe('CHALLENGES');
    expect(out.evidence.runnerSummary).toBe(
      'You held that pace deeper into the session than your current threshold pace predicts.'
      + ' One session does not move it. The next one like it will.',
    );
    // The belief is still not moved — the direction changed the WORDS, never
    // the outcome. `anchorEffect` cannot express a move and this must not
    // start claiming one.
    expect(out.evidence.beliefChanged).toBe(false);
  });

  it('WEAKER (hand-built fixture, see header) · says it came in slower', () => {
    const out = compose(WEAKER_SYNTHETIC);
    expect(out.evidence.role).toBe('CHALLENGES');
    expect(out.evidence.runnerSummary).toBe(
      'That came in slower than your current threshold pace predicts.'
      + ' One session does not move it. The next one like it will.',
    );
    expect(out.evidence.beliefChanged).toBe(false);
  });

  it('the two arms cannot both be the old direction-blind sentence', () => {
    const a = compose(STRONGER).evidence.runnerSummary;
    const b = compose(WEAKER_SYNTHETIC).evidence.runnerSummary;
    // THE ASSERTION THAT WOULD HAVE CAUGHT IT. Before the fix these were
    // byte-identical, which is the whole defect in one line.
    expect(a).not.toBe(b);
    for (const s of [a, b]) {
      expect(s).not.toMatch(/sits outside/i);
      // "the number" named nothing. Both arms now say which number.
      expect(s).not.toMatch(/whether the number moves/i);
      expect(s).toContain('threshold pace');
    }
  });

  /* RULE 22 · THE BALANCE. A gate written by someone worried about false
   * praise ends up asserting only the cautious arm. Both directions are
   * asserted above, in the same shape, and this counts them so a future edit
   * cannot quietly drop one. */
  it('exercises both directions, not just the cautious one', () => {
    const directions = new Set([STRONGER.direction, WEAKER_SYNTHETIC.direction]);
    expect(directions.size).toBe(2);
  });
});

describe('COACH-VOICE-1 · a one-block session states its own numbers', () => {
  it("reads '3.5 miles at 7:11. Right in the window.'", () => {
    const out = compose(STRONGER);
    expect(out.execution.summary).toBe('3.5 miles at 7:11. Right in the window.');
    // The engine's own nouns are gone from the sentence the runner reads.
    expect(out.execution.summary).not.toMatch(/work block/i);
    // And it did not become a rep set on the way.
    expect(out.execution.summary).not.toMatch(/\brep\b/i);
  });

  it('degrades to the structural sentence rather than inventing a number', () => {
    // Rule 11: the same session with no recorded distance on its one work
    // block has nothing concrete to say, so it says the old thing rather
    // than a sentence with a hole in it.
    const noDistance = REAL_0908_PHASES.map((p) => (
      p.type === 'work' ? { ...p, actualDistanceMi: null } : p
    ));
    const verdict = gradeStoredPhases(noDistance, 'threshold');
    const out = composePostRunExperience({
      runId: 'x', dateISO: '2026-09-08', plannedType: 'tempo', plannedTypeDisplay: 'Tempo',
      plannedDistanceMi: 6.2, raceMatched: false, targetProvenance: 'plan', verdict,
      evidence: evidenceWith({ ok: false, reason: 'observation_consistent_with_belief' } as BeliefTensionRead),
      workHrCeilingBpm: 164, overallHrCeilingBpm: null, wholeRunHrBpm: 149, rpe: null,
      adaptations: [], hasActivePlan: true, activePlanId: 'pln_fixture', sensorLimited: false,
      stridesPrescribed: 0, recordedDistanceMi: 6.46, recordedDurationSec: 2994, clockAudit: null,
    } as unknown as PostRunInput);
    expect(out.execution.summary).toBe('The work block landed inside the window.');
  });
});
