/**
 * lib/postrun/_experience.test.ts · the post-run interpretation, state by state.
 *
 * ── WHAT THIS GATE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
 *
 *   · IT CANNOT TELL YOU THE VERDICT IS RIGHT. Every fixture hands the
 *     composer a grade and an evidence classification and checks what it SAYS
 *     about them. A wrong grade, explained perfectly, passes here.
 *   · IT IS FIXTURES. Rule 13 clause 2: fixtures skip the code paths that
 *     break. The real-payload half is `_postrun_live.audit.test.ts`, which
 *     runs the whole loader against production read-only.
 *   · THE EVIDENCE FIXTURES ARE PARTIAL. `ActivityEvidenceResult` has thirty
 *     fields and this composer reads seven; the factory below fills those
 *     seven honestly and casts the rest. A new field the composer starts
 *     reading will be `undefined` here until the factory is extended, which is
 *     a hole this comment exists to name.
 *   · IT CANNOT SEE THE PHONE. Nothing here proves a screen renders any of it.
 *
 * ── RULE 22 · THE BALANCE, ASSERTED ─────────────────────────────────────────
 *
 * A post-run suite written by someone worried about false praise fills up with
 * refusals and then passes an app that can only refuse. The last test in this
 * file counts the fixtures on each side and fails if either outnumbers the
 * other more than two to one.
 */
import { describe, it, expect } from 'vitest';
import { gradeStoredPhases } from '@/lib/execution/verdict';
import { auditExplanation, layerOne } from '@/lib/faff/explanation';
import { workHrCeiling, overallHrCeiling, displayedHrAsk } from '@/lib/prescription/hr-ceiling';
import {
  composePostRunExperience,
  numberWord,
  type PostRunInput,
  type PostRunExperienceV1,
} from './experience';
import type { ActivityEvidenceResult, CapacityEvidence, CapacityName } from '@/lib/evidence/activity-evidence';

/* ─────────────────────────── fixture factories ─────────────────────────── */

/** The owner's REAL 2026-09-01 phases, read out of `coach_intents` at
 *  `faff_readonly`. A fixture invented to fit the code proves the code agrees
 *  with itself. */
const REAL_0901_PHASES = [
  { index: 0, type: 'warmup', label: 'Warm-up', verdict: 'hit', completed: true, avgHr: 140, actualDurationSec: 1084, actualDistanceMi: 2.1, targetPaceSPerMi: 502, actualPaceSPerMi: 516 },
  { index: 1, type: 'work', label: 'Interval · 1 mi', verdict: 'drifted', completed: true, avgHr: 158, actualDurationSec: 424, actualDistanceMi: 1.01, targetPaceSPerMi: 430, actualPaceSPerMi: 422 },
  { index: 2, type: 'recovery', label: 'Jog 1 min', completed: true, avgHr: 158, actualDurationSec: 61, actualDistanceMi: 0.12, actualPaceSPerMi: 515 },
  { index: 3, type: 'work', label: 'Interval · 1 mi', verdict: 'drifted', completed: true, avgHr: 161, actualDurationSec: 431, actualDistanceMi: 1.01, targetPaceSPerMi: 430, actualPaceSPerMi: 429 },
  { index: 4, type: 'recovery', label: 'Jog 1 min', completed: true, avgHr: 156, actualDurationSec: 64, actualDistanceMi: 0.08, actualPaceSPerMi: 785 },
  { index: 5, type: 'work', label: 'Interval · 1 mi', verdict: 'drifted', completed: true, avgHr: 164, actualDurationSec: 423, actualDistanceMi: 1.0, targetPaceSPerMi: 430, actualPaceSPerMi: 422 },
  { index: 6, type: 'recovery', label: 'Jog 1 min', completed: true, avgHr: 157, actualDurationSec: 64, actualDistanceMi: 0.06, actualPaceSPerMi: 1034 },
  { index: 7, type: 'work', label: 'Interval · 1 mi', verdict: 'missed', completed: true, avgHr: 166, actualDurationSec: 422, actualDistanceMi: 1.01, targetPaceSPerMi: 430, actualPaceSPerMi: 419 },
  { index: 8, type: 'cooldown', label: 'Cool-down', verdict: 'missed', completed: true, avgHr: 153, actualDurationSec: 1125, actualDistanceMi: 2.11, targetPaceSPerMi: 502, actualPaceSPerMi: 534 },
];

/** The owner's REAL `plan_workouts.workout_spec` for 2026-09-01. */
const REAL_0901_SPEC = {
  kind: 'threshold',
  lthr_bpm: 168,
  rep_count: 4,
  warmup_mi: 2.1,
  rep_rest_s: 60,
  cooldown_mi: 2.1,
  rep_distance_mi: 1,
  rep_pace_s_per_mi: 430,
  rules: [
    { kind: 'pass', metric: 'hr', op: '<=', value: 164, scope: 'work', action: null, label: 'Pass: avgHr ≤ 164 on the work' },
    { kind: 'bail', metric: 'hr', op: '>', value: 173, scope: 'work', action: 'drop_to_easy', label: 'HR over 173 and climbing · finish easy, the stimulus is banked' },
  ],
};

function capacity(name: CapacityName, kind: 'evidence' | 'no_evidence' | 'indeterminate'): CapacityEvidence {
  if (kind === 'evidence') {
    return { capacity: name, kind, strength: 'moderate', weight: 0.55, reliability: 'moderate', anchorEffect: 'supporting_evidence_only', reasons: [] };
  }
  return { capacity: name, kind, reasons: [] } as CapacityEvidence;
}

interface EvidenceOverrides {
  admissible?: boolean;
  hrSignal?: string;
  paceSignal?: string;
  capacities?: Partial<Record<CapacityName, CapacityEvidence>>;
  anchorMoveCandidate?: boolean;
  tension?: boolean;
  /**
   * Was the classifier handed the runner's current belief.
   *
   * DEFAULT TRUE, and that default is the fix for closure 6 rather than a
   * convenience. Until 2026-09-02 `load.ts` passed no belief at all, so every
   * production classification refused with `no_belief_supplied` — and this
   * factory hard-coded that refusal, which meant the suite asserted the
   * app's own defect as its expected output. `load.ts` now resolves the
   * belief through `resolveThresholdCapacity`, so the honest default here is
   * a belief that WAS supplied and simply agreed with the observation.
   *
   * Set false to exercise the refusal arm, which one test below does.
   */
  beliefSupplied?: boolean;
  heat?: boolean;
  stimulus?: string;
}

function evidenceFixture(o: EvidenceOverrides = {}): ActivityEvidenceResult {
  const caps: Record<CapacityName, CapacityEvidence> = {
    threshold: capacity('threshold', 'no_evidence'),
    high_intensity: capacity('high_intensity', 'no_evidence'),
    durability: capacity('durability', 'no_evidence'),
    easy_ceiling: capacity('easy_ceiling', 'no_evidence'),
    ...(o.capacities ?? {}),
  } as Record<CapacityName, CapacityEvidence>;
  return {
    modelVersion: '1.0.0',
    activityId: 'fixture',
    date: '2026-09-01',
    eligibility: {
      admissible: o.admissible ?? true,
      signals: { distance: 'high', duration: 'high', pace: o.paceSignal ?? 'high', hr: o.hrSignal ?? 'high', power: 'moderate', dynamics: 'moderate' },
      signalReasons: [],
      continuity: { grain: 'splits', grade: 'high', weight: 1, unaccountedSec: 0, unaccountedFraction: 0, interruptedSplitIndices: [], reasons: [] },
      rejections: o.admissible === false ? ['NO_USABLE_DISTANCE'] : [],
    },
    environment: { hrCostPlausiblyElevated: o.heat === true, load: o.heat ? 'moderate' : 'none', reasons: [] },
    capacities: caps,
    beliefTension: o.tension
      ? {
          ok: true, capacity: 'threshold', code: 'CONTRADICTS_CURRENT_ESTIMATE',
          direction: 'observation_stronger_than_belief', believedPaceSecPerMi: 440,
          observedPaceSecPerMi: 422, magnitudeSecPerMi: 18, magnitudePct: 4.1,
          observedMinutes: 28, accumulatedMinutesBefore: 18, beliefAsOf: '2026-08-25',
          anchorEffect: 'no_change_flag_for_reexamination', reexaminationWeight: 0.4,
          reasons: ['SUSTAINED_WORK_FASTER_THAN_BELIEF'],
        }
      : { ok: false, reason: o.beliefSupplied === false ? 'no_belief_supplied' : 'observation_consistent_with_belief' },
    trainingLoad: { stimulus: o.stimulus ?? 'aerobic_maintenance', aerobicMinutes: 45, distanceMi: 6, primaryValue: 'Aerobic volume.' },
    anchorMoveCandidate: o.anchorMoveCandidate ?? false,
    anchorMoveReasons: [],
    reasons: [],
  } as unknown as ActivityEvidenceResult;
}

interface InputOverrides extends Partial<PostRunInput> { phases?: unknown; sessionClass?: 'threshold' | 'easy' | 'interval' | 'long' | 'other' }

function makeInput(o: InputOverrides = {}): PostRunInput {
  const verdict = o.verdict ?? gradeStoredPhases(o.phases ?? REAL_0901_PHASES, o.sessionClass ?? 'threshold', { prescribedRecoverySec: 60 });
  return {
    runId: '-258355938987883',
    dateISO: '2026-09-01',
    plannedType: 'threshold',
    plannedTypeDisplay: 'Threshold',
    plannedDistanceMi: 8.5,
    raceMatched: false,
    targetProvenance: 'plan',
    verdict,
    evidence: o.evidence !== undefined ? o.evidence : evidenceFixture(),
    workHrCeilingBpm: workHrCeiling(REAL_0901_SPEC)?.bpm ?? null,
    overallHrCeilingBpm: overallHrCeiling(REAL_0901_SPEC)?.bpm ?? null,
    wholeRunHrBpm: 162,
    rpe: null,
    adaptations: [],
    hasActivePlan: true,
    activePlanId: 'pln_9a57561debb776e5',
    sensorLimited: false,
    // 2026-09-02 · the strides / capture inputs. Defaults describe the
    // 4 x 1 mile session these fixtures are built from: it prescribed no
    // strides, and its recording was clean.
    stridesPrescribed: 0,
    recordedDistanceMi: 8.5,
    recordedDurationSec: 4098,
    clockAudit: null,
    ...o,
  } as PostRunInput;
}

/** Every fixture composed in this file, for the balance assertion. */
const COMPOSED: PostRunExperienceV1[] = [];
function compose(o: InputOverrides = {}): PostRunExperienceV1 {
  const out = composePostRunExperience(makeInput(o));
  COMPOSED.push(out);
  return out;
}

/* ─────────────────────────── the HR-ceiling owner ──────────────────────── */

describe('hr-ceiling · one ladder, three meanings, and a scope on each', () => {
  it('reads the work ceiling out of the spec rule nothing had ever read', () => {
    expect(workHrCeiling(REAL_0901_SPEC)).toEqual({ bpm: 164, scope: 'work', source: 'pass_rule' });
  });

  it('REFUSES to let hr_cap_bpm stand in for a work ceiling', () => {
    // A whole-run mean ceiling says nothing about what a rep may average.
    expect(workHrCeiling({ hr_cap_bpm: 145 })).toBeNull();
    expect(overallHrCeiling({ hr_cap_bpm: 145 })).toEqual({ bpm: 145, scope: 'overall', source: 'hr_cap_bpm' });
  });

  it('REFUSES to read a bail rule as a ceiling', () => {
    // `bail` is "stop the session", not "stay under this on average". Grading
    // against it would call a normal session a breach at 173.
    expect(workHrCeiling({ rules: [{ kind: 'bail', metric: 'hr', op: '>', value: 173, scope: 'work' }] })).toBeNull();
  });

  it('keeps the display ask and the graded ceiling apart', () => {
    // The owner's session: 168 is what the plan REFERENCES (LTHR) and is not a
    // ceiling; 164 is what it ASKS you to stay under, on the work.
    expect(displayedHrAsk(REAL_0901_SPEC)).toEqual({ bpm: 168, isCeiling: false });
    expect(workHrCeiling(REAL_0901_SPEC)?.bpm).toBe(164);
  });
});

/* ─────────────────────────── the real session ──────────────────────────── */

describe("the owner's real 4 x 1 mile, 2026-09-01", () => {
  const out = compose();

  it('grades every rep as landed and calls the session controlled', () => {
    expect(out.execution.status).toBe('CONTROLLED');
    expect(out.execution.stimulusDelivered).toBe('FULL');
    expect(out.execution.summary).toBe('All four reps landed, with one quicker than the window.');
  });

  it('states the cost against the ceiling the plan actually set', () => {
    expect(out.cost.hrScope).toBe('work');
    expect(out.cost.hrBpm).toBe(162);
    expect(out.cost.ceilingBpm).toBe(164);
    expect(out.cost.status).toBe('EXPECTED');
  });

  it('carries the DEVICE grades as history and never as the verdict', () => {
    // The wrist said drifted / drifted / drifted / missed. The canonical grade
    // is hit / hit / hit / fast, and the sentence is built from the second.
    const work = out.execution;
    expect(work.summary).not.toMatch(/drift|missed/i);
  });

  it('says what the run taught the coach, and that one session does not move it', () => {
    const e = compose({
      evidence: evidenceFixture({
        capacities: { threshold: capacity('threshold', 'evidence'), durability: capacity('durability', 'evidence') },
      }),
    }).evidence;
    expect(e.role).toBe('CORROBORATES');
    expect(e.domains).toEqual(['THRESHOLD', 'DURABILITY']);
    expect(e.runnerSummary).toBe('This supports your current threshold range and ability to hold pace late. One session is not enough to move them.');
    expect(e.beliefChanged).toBe(false);
  });

  it('the briefing passes the voice audit', () => {
    expect(auditExplanation(out.briefing)).toEqual([]);
  });

  it('says the heart rate ONCE (Rule 17)', () => {
    // The brief opens on "average heart rate printed three times on Today".
    // The sentence states it; the facts must then not restate it.
    const rendered = [layerOne(out.briefing), ...out.briefing.facts.map((f) => f.display), ...out.briefing.detail.paragraphs].join(' ');
    expect(rendered.match(/162/g) ?? []).toHaveLength(1);
    expect(rendered.match(/164/g) ?? []).toHaveLength(1);
  });
});

/* ─────────────────────────── the run-type corpus ───────────────────────── */

describe('run-type states', () => {
  it('EASY · a whole-run ceiling is read against the whole-run mean', () => {
    const easyPhases = [{ index: 0, type: 'steady', label: 'Easy', completed: true, avgHr: 138, actualDurationSec: 2400, actualDistanceMi: 5, actualPaceSPerMi: 480 }];
    const out = compose({
      phases: easyPhases, sessionClass: 'easy', plannedType: 'easy', plannedTypeDisplay: 'Easy',
      workHrCeilingBpm: null, overallHrCeilingBpm: 145, wholeRunHrBpm: 138,
      evidence: evidenceFixture({ stimulus: 'aerobic_maintenance' }),
    });
    expect(out.cost.hrScope).toBe('overall');
    expect(out.cost.status).toBe('EXPECTED');
    expect(out.cost.summary).toBe('Heart rate averaged 138 against a 145 ceiling.');
    // An easy run is never failed for being slow.
    expect(out.execution.status).not.toBe('SLOW');
  });

  it('EASY IN HEAT · over the ceiling, explained, not blamed', () => {
    const easyPhases = [{ index: 0, type: 'steady', label: 'Easy', completed: true, avgHr: 152, actualDurationSec: 2400, actualDistanceMi: 5, actualPaceSPerMi: 500 }];
    const out = compose({
      phases: easyPhases, sessionClass: 'easy', plannedType: 'easy', plannedTypeDisplay: 'Easy',
      workHrCeilingBpm: null, overallHrCeilingBpm: 145, wholeRunHrBpm: 152,
      evidence: evidenceFixture({ heat: true }),
    });
    expect(out.cost.status).toBe('HIGHER_EXPLAINED');
    expect(out.cost.summary).toContain('the conditions account for');
  });

  it('EASY, HOT DAY WITH NO WEATHER · the same numbers refuse to blame the weather', () => {
    const easyPhases = [{ index: 0, type: 'steady', label: 'Easy', completed: true, avgHr: 152, actualDurationSec: 2400, actualDistanceMi: 5, actualPaceSPerMi: 500 }];
    const out = compose({
      phases: easyPhases, sessionClass: 'easy', plannedType: 'easy', plannedTypeDisplay: 'Easy',
      workHrCeilingBpm: null, overallHrCeilingBpm: 145, wholeRunHrBpm: 152,
      evidence: evidenceFixture({ heat: false }),
    });
    expect(out.cost.status).toBe('HIGHER_UNEXPLAINED');
    expect(out.next.summary).toContain('Keep the next easy day genuinely easy.');
  });

  it('CONTINUOUS TEMPO · one block is not "rep 1 of 1"', () => {
    const tempo = [
      { index: 0, type: 'warmup', label: 'Warm-up', completed: true, actualDurationSec: 600, actualDistanceMi: 1.2, targetPaceSPerMi: 510, actualPaceSPerMi: 520 },
      { index: 1, type: 'work', label: 'Tempo', completed: true, avgHr: 160, actualDurationSec: 1800, actualDistanceMi: 4.2, targetPaceSPerMi: 430, actualPaceSPerMi: 428 },
    ];
    const out = compose({ phases: tempo, sessionClass: 'threshold', plannedTypeDisplay: 'Tempo' });
    expect(out.execution.summary).toBe('The work block landed inside the window.');
    expect(out.execution.summary).not.toMatch(/\brep\b/i);
  });

  it('LONG · a CEILING is called a ceiling, never a window', () => {
    // Found by sweeping this composer over the runner's own 40 most recent
    // runs: his 2026-08-30 long read "The work block came in ahead of the
    // window" over a phase whose shape is `ceiling`. A ceiling has one edge,
    // and calling it a window tells the runner he could have been too slow for
    // a long run, which doctrine forbids outright.
    const longPhases = [{
      index: 0, type: 'work', label: '13.5 mi long run', completed: true, avgHr: 159,
      actualDurationSec: 6300, actualDistanceMi: 13.5,
      targetPaceSPerMi: 520, tolerancePaceSPerMi: 18, actualPaceSPerMi: 466,
    }];
    const out = compose({
      phases: longPhases, sessionClass: 'long', plannedType: 'long', plannedTypeDisplay: 'Long',
      workHrCeilingBpm: null, overallHrCeilingBpm: null, wholeRunHrBpm: 159,
    });
    expect(out.execution.status).toBe('FAST');
    // PACE-SHAPE-AUDIT-1 · "came in ahead of" read as praise for violating
    // a ceiling; "ran faster than ... allowed" cannot be misread either way.
    expect(out.execution.summary).toBe('The work block ran faster than the ceiling allowed.');
    expect(out.execution.summary).not.toMatch(/window/);
  });

  it('INCOMPLETE · one rep of two reads as English, not as a template', () => {
    // "one of two reps were finished before the session stopped." — from the
    // same real-run sweep, on his 2026-07-25 eighteen-miler.
    const cut = [
      { index: 0, type: 'work', label: 'Rep 1', completed: true, actualDurationSec: 600, actualDistanceMi: 2, targetPaceSPerMi: 430, actualPaceSPerMi: 430 },
      { index: 1, type: 'work', label: 'Rep 2', completed: false, actualDurationSec: 100, actualDistanceMi: 0.3, targetPaceSPerMi: 430, actualPaceSPerMi: 430 },
    ];
    const out = compose({ phases: cut, sessionClass: 'threshold' });
    expect(out.execution.status).toBe('INCOMPLETE');
    expect(out.execution.summary).toBe('One of two reps was finished before the session stopped.');
  });

  it('SLOW · most of the work outside the window is stated, never judged', () => {
    const slow = REAL_0901_PHASES.map((p) => (p.type === 'work' ? { ...p, actualPaceSPerMi: 470 } : p));
    const out = compose({ phases: slow });
    expect(out.execution.status).toBe('SLOW');
    expect(out.execution.stimulusDelivered).toBe('PARTIAL');
    // A missed target is a fact. It is not a fault.
    expect(out.execution.summary).not.toMatch(/fail|should have|not good enough/i);
  });

  it('FAST · every rep ahead of the window is its own state, not "executed"', () => {
    const fast = REAL_0901_PHASES.map((p) => (p.type === 'work' ? { ...p, actualPaceSPerMi: 405 } : p));
    const out = compose({ phases: fast });
    expect(out.execution.status).toBe('FAST');
    expect(out.execution.summary).toBe('All four reps came in ahead of the window.');
  });

  it('MIXED · some landed and some did not', () => {
    const mixed = REAL_0901_PHASES.map((p, i) => (p.type === 'work' && i > 4 ? { ...p, actualPaceSPerMi: 480 } : p));
    const out = compose({ phases: mixed });
    expect(out.execution.status).toBe('PARTIAL_PRODUCTIVE');
    expect(out.execution.stimulusDelivered).toBe('PARTIAL');
  });

  it('INCOMPLETE · a rep ended early is partial, and next says take the next day as written', () => {
    const cut = REAL_0901_PHASES.map((p, i) => (i === 7 ? { ...p, completed: false, actualDistanceMi: 0.4, actualDurationSec: 170 } : p));
    const out = compose({ phases: cut });
    expect(out.execution.status).toBe('INCOMPLETE');
    expect(out.next.summary).toBe('Take the next day as written and see how the legs answer.');
  });

  it('NO STRUCTURE · a run with no phases is recorded, not graded', () => {
    const out = compose({ phases: [], evidence: evidenceFixture() });
    expect(out.execution.status).toBe('INDETERMINATE');
    expect(out.execution.stimulusDelivered).toBe('UNKNOWN');
    expect(out.briefing.intent).toBe('REFUSE');
    expect(out.briefing.certainty).toBe('UNKNOWN');
  });

  it('SENSOR-LIMITED · the refusal names the sensors, and carries no action', () => {
    const out = compose({ phases: [], sensorLimited: true });
    expect(out.execution.status).toBe('SENSOR_LIMITED');
    expect(out.briefing.intent).toBe('REFUSE');
    // Rule 11 + the explanation contract: a refusal is an answer, not a retry.
    expect(out.briefing.action).toBeUndefined();
    expect(auditExplanation(out.briefing)).toEqual([]);
  });

  it('EXCLUDED · a recording too poor to read is kept and said so', () => {
    const out = compose({ evidence: evidenceFixture({ admissible: false }) });
    expect(out.evidence.role).toBe('EXCLUDED');
    expect(out.evidence.planAuthorityEligible).toBe(false);
  });
});

/* ────────────── PROVENANCE-1, 2026-09-03 · whose target this was ───────── */

describe("PROVENANCE-1 · an unplanned race never claims the app's authorship", () => {
  // The exact shape that found this defect: the Americas Finest City half,
  // a real production run with five named course segments and NO matching
  // `plan_workouts` row — `raceMatched` is true, `targetProvenance` is
  // `'self_authored'`, and the segments still carry real, correctly-graded
  // per-mile targets from David's own watch.

  it("SELF-AUTHORED RACE · the note names the runner's own pacing plan, never the app's", () => {
    const out = compose({
      raceMatched: true,
      targetProvenance: 'self_authored',
      phases: REAL_0901_PHASES.map((p) => (p.type === 'work' ? { ...p, actualPaceSPerMi: 470 } : p)),
    });
    expect(out.execution.targetProvenance).toBe('self_authored');
    expect(out.execution.targetProvenanceNote).not.toBeNull();
    // The exact failure mode this closes: language that reads as if the
    // COACHING APP set these targets, when no `plan_workouts` row exists.
    expect(out.execution.targetProvenanceNote).toMatch(/pace plan you set/i);
    expect(out.execution.targetProvenanceNote).not.toMatch(/the app (asked|prescribed)/i);
  });

  it("SELF-AUTHORED, NOT A RACE · still attributed to the runner's own watch workout", () => {
    const out = compose({
      raceMatched: false,
      targetProvenance: 'self_authored',
      phases: REAL_0901_PHASES.map((p) => (p.type === 'work' ? { ...p, actualPaceSPerMi: 470 } : p)),
    });
    expect(out.execution.targetProvenanceNote).toMatch(/workout you built on your watch/i);
  });

  it('PLAN-BACKED · the ordinary case needs no extra caption', () => {
    const out = compose({ targetProvenance: 'plan' });
    expect(out.execution.targetProvenance).toBe('plan');
    expect(out.execution.targetProvenanceNote).toBeNull();
  });

  it('NO TARGET AT ALL · nothing to attribute, so nothing is said', () => {
    const out = compose({ phases: [], targetProvenance: 'none' });
    expect(out.execution.targetProvenance).toBe('none');
    expect(out.execution.targetProvenanceNote).toBeNull();
  });
});

/* ────────── PORTIONS-1, 2026-09-04 · a long run is not a rep set ───────── */

describe('PORTIONS-1 · a marathon-specific long run reads as two portions, never reps', () => {
  // The owner's REAL 2026-06-27 "Little adventure today": 10.0 mi easy into
  // 4.0 mi at marathon pace, self-authored on the watch (no plan_workouts
  // row). Read out of the walk-substrate copy of `faff_readonly` — this is
  // the exact shape that shipped "All two reps stayed under the ceiling",
  // which reads as a two-repetition interval set, and the exact shape that
  // shipped "Work executed" over a marathon-effort mile run 28 sec/mi slow.
  // No `paceShape` and no `tolerancePaceSPerMi` on either phase, matching
  // the REAL raw watch-completion payload exactly (queried directly off
  // `faff_readonly`, 2026-09-04: neither field is present on this run's
  // stored phases) — the shape and tolerance are resolved entirely by
  // `gradeStoredPhases`'s fallback, which is the exact path this fixture
  // exists to prove.
  const REAL_LONG_PHASES = [
    { index: 0, type: 'work', label: '10.0 mi easy', completed: true, avgHr: 145,
      actualDurationSec: 5280, actualDistanceMi: 10.0,
      targetPaceSPerMi: 480, actualPaceSPerMi: 528 },
    { index: 1, type: 'work', label: '4.0 mi @ marathon pace', completed: true, avgHr: 163,
      actualDurationSec: 1848, actualDistanceMi: 4.0,
      targetPaceSPerMi: 434, actualPaceSPerMi: 462 },
  ];

  const out = compose({
    phases: REAL_LONG_PHASES,
    sessionClass: 'long',
    plannedType: 'long',
    plannedTypeDisplay: 'Long',
    raceMatched: false,
    targetProvenance: 'self_authored',
    workHrCeilingBpm: null,
    overallHrCeilingBpm: null,
    wholeRunHrBpm: 149,
  });

  it('grades each phase on its OWN shape — the easy portion a ceiling, the MP portion a window', () => {
    // KEY-PHASE-1's whole point: `paceShapeFor` alone cannot tell a long
    // run's easy portion from its embedded marathon-pace portion (both are
    // phaseType 'work' in a 'long' session), so `gradeStoredPhases` must
    // detect the MP phase by its own label and grade it as a WINDOW — a
    // real target, not a ceiling nothing can miss for being slow.
    const graded = out.execution;
    expect(graded.status).toBe('PARTIAL_PRODUCTIVE');
  });

  it('never calls the two phases reps, a repetition, a work block, or segments', () => {
    expect(out.execution.summary).not.toMatch(/\brep\b/i);
    expect(out.execution.summary).not.toMatch(/\breps\b/i);
    expect(out.execution.summary).not.toMatch(/repetition/i);
    expect(out.execution.summary).not.toMatch(/\bwork block\b/i);
    expect(out.execution.summary).not.toMatch(/\bsegments?\b/i);
  });

  it('names the marathon-effort phase as the key finding — never the easy phase it is not', () => {
    // KEY-PHASE-1, 2026-09-04 · replaces a defect this exact test file
    // shipped earlier the same day: the OLD sentence cited "10.0 mi easy
    // averaged 8:48/mi against 8:00/mi prescribed" — a ceiling phase that
    // ran SLOWER than its ceiling, which is compliant BY DEFINITION
    // (`gradeCeilingPhase` has no `slow` verdict) — as if it were a missed
    // target. The real miss was always the marathon-pace phase, graded
    // against its own ±5 s/mi window (`Research/01`'s M row).
    //
    // LESS-IS-MORE-1, 2026-09-05 · David's own correction on the FIRST
    // version of this sentence: "not a paragraph explaining every phase,
    // source, comparison, and caveat." One short headline naming the real
    // phase, one supporting sentence with the actual window (not a bare
    // target — a runner cannot judge "outside 7:14" without knowing how
    // wide 7:14 was allowed to be), HR dropped from the prose entirely
    // (already in the stats grid above — Rule 17, never say a number twice).
    expect(out.execution.headline).toBe('Marathon work ran slow');
    expect(out.execution.headline).not.toMatch(/executed/i);
    expect(out.execution.headline).not.toMatch(/structure completed/i);
    expect(out.execution.summary).toBe('4 mi averaged 7:42/mi against a 7:09–7:19 window. Easy miles stayed controlled.');
    expect(out.execution.summary).not.toMatch(/10\.0 mi easy averaged/);
    expect(out.execution.summary).not.toMatch(/HR averaged/);
  });

  it('attributes the targets to the watch workout, not the app, for a self-authored long run', () => {
    expect(out.execution.targetProvenance).toBe('self_authored');
    expect(out.execution.targetProvenanceNote).toMatch(/workout you built on your watch/i);
  });
});

/* ─────────────────────────── Rule 11, as a type ────────────────────────── */

describe('Rule 11 · three facts, never one', () => {
  it('an UNREAD classification is not "not enough evidence"', () => {
    const out = compose({ evidence: null });
    expect(out.evidence.role).toBe('UNREAD');
    expect(out.evidence.role).not.toBe('INSUFFICIENT');
    expect(out.evidence.runnerSummary).toBe('This run has not been read into the coaching picture yet.');
    // And it must not let the plan claim it is unchanged.
    expect(out.plan.status).toBe('UNKNOWN');
  });

  it('a FAILED adaptation look is not "the plan is unchanged"', () => {
    const found = compose({ adaptations: [] });
    const failed = compose({ adaptations: null });
    expect(found.plan.status).toBe('UNCHANGED');
    expect(failed.plan.status).toBe('UNKNOWN');
    expect(failed.plan.runnerSummary).not.toBe(found.plan.runnerSummary);
  });

  it('a session with a reading but no ceiling reports the number without a verdict', () => {
    const out = compose({ workHrCeilingBpm: null, overallHrCeilingBpm: null });
    expect(out.cost.status).toBe('UNKNOWN');
    expect(out.cost.summary).toBeNull();
    expect(out.cost.hrBpm).toBe(162); // the reading still travels
    expect(out.briefing.whyNot?.some((w) => w.code === 'cost_not_stated')).toBe(true);
  });
});

/* ─────────────────────────── the upward path ───────────────────────────── */

describe('Rule 21 · the evidence layer can say a run was strong enough to push', () => {
  it('NEW_ANCHOR_CANDIDATE is reachable and says so plainly', () => {
    const out = compose({
      evidence: evidenceFixture({
        anchorMoveCandidate: true,
        capacities: { threshold: capacity('threshold', 'evidence') },
      }),
    });
    expect(out.evidence.role).toBe('NEW_ANCHOR_CANDIDATE');
    expect(out.evidence.planAuthorityEligible).toBe(true);
    expect(out.evidence.runnerSummary).toBe('This is strong enough on its own to move your threshold range.');
    // And the plan then HOLDS for the review rather than claiming nothing changed.
    expect(out.plan.status).toBe('HELD_FOR_EVIDENCE');
  });

  it('CHALLENGES · the third outcome exists and never claims the belief moved', () => {
    const out = compose({
      evidence: evidenceFixture({ tension: true, capacities: { threshold: capacity('threshold', 'evidence') } }),
    });
    expect(out.evidence.role).toBe('CHALLENGES');
    expect(out.evidence.beliefChanged).toBe(false);
    expect(out.evidence.runnerSummary).toContain('the next session like it will settle');
  });

  it('an UPDATED plan quotes the engine and drops the doctrine citation', () => {
    const out = compose({
      adaptations: [{ reason: 'plan_adapt_downgrade', display: '4 days off. First run back is easy, not quality.' }],
    });
    expect(out.plan.status).toBe('UPDATED');
    expect(out.plan.changes).toEqual(['4 days off. First run back is easy, not quality.']);
  });
});

/* ─────────────────────────── falsification ─────────────────────────────── */

describe('Rule 18 · the assertions above can fail', () => {
  it('FALSIFIER · a whole-run mean read against a work ceiling is caught', () => {
    // Break the pairing on purpose: feed a whole-run HR of 175 while claiming
    // the work scope. The composer picks the pair itself, so the only way to
    // express this defect is to hand it a verdict with no work phases AND a
    // work ceiling — which must NOT produce a work-scoped verdict.
    const out = composePostRunExperience(makeInput({
      phases: [], workHrCeilingBpm: 164, overallHrCeilingBpm: null, wholeRunHrBpm: 175,
    }));
    expect(out.cost.hrScope).toBe('overall');
    expect(out.cost.status).toBe('UNKNOWN'); // no whole-run ceiling exists
    expect(out.cost.summary).toBeNull();
  });

  it('FALSIFIER · a repeated sentence is caught by the auditor, not by luck', () => {
    const out = compose();
    const broken = { ...out.briefing, consequence: out.briefing.verdict };
    const defects = auditExplanation(broken);
    expect(defects.some((d) => /repeats a sentence/.test(d.problem))).toBe(true);
  });

  it('FALSIFIER · hype in the composed copy is caught', () => {
    const out = compose();
    const broken = { ...out.briefing, verdict: 'Amazing session, you crushed it.' };
    expect(auditExplanation(broken).length).toBeGreaterThan(0);
  });

  it('numberWord stays numeric past nine, so a long set does not read as prose', () => {
    expect(numberWord(4)).toBe('four');
    expect(numberWord(12)).toBe('12');
  });
});

/* ─────────────────────────── Rule 22 · balance ─────────────────────────── */

describe('Rule 22 · this suite is not only refusals', () => {
  it('exercises supportive and withholding outcomes in comparable numbers', () => {
    const supportive = COMPOSED.filter((c) =>
      c.evidence.role === 'CORROBORATES' || c.evidence.role === 'NEW_ANCHOR_CANDIDATE'
      || c.execution.status === 'CONTROLLED' || c.execution.status === 'EXECUTED' || c.execution.status === 'FAST');
    const withholding = COMPOSED.filter((c) =>
      c.evidence.role === 'UNREAD' || c.evidence.role === 'EXCLUDED' || c.evidence.role === 'CONTEXT_ONLY'
      || c.execution.status === 'INDETERMINATE' || c.execution.status === 'SENSOR_LIMITED' || c.execution.status === 'SLOW');
    expect(supportive.length).toBeGreaterThanOrEqual(4);
    expect(withholding.length).toBeGreaterThanOrEqual(4);
    expect(supportive.length).toBeLessThanOrEqual(withholding.length * 2);
    expect(withholding.length).toBeLessThanOrEqual(supportive.length * 2);
  });

  it('LIVENESS · the corpus actually composed something', () => {
    // A suite that reports clean because it looked at nothing is the worst
    // outcome available, since it also reports confidence.
    expect(COMPOSED.length).toBeGreaterThanOrEqual(14);
  });
});
