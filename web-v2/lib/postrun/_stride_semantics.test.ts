/**
 * lib/postrun/_stride_semantics.test.ts · a stride is not a rep, and a short
 * recording is not a run.
 *
 * ── WHAT THIS GATE EXISTS FOR ───────────────────────────────────────────────
 *
 * On 2026-09-02 the runner opened his post-run screen and said: "the post run
 * breakdown is awful. Not showing all the miles, not showing the strides."
 *
 * The session was `EASY · 6x20s strides`. What the screen told him was:
 *
 *     "All seven reps landed, with four quicker than the ceiling."
 *
 * Three wrongs in nine words, and every one of them has a test below:
 *
 *   · SEVEN — the composer counted every `type: 'work'` phase, which is the
 *     5.0 mi easy block PLUS the six strides. The easy block is not a rep.
 *   · FOUR QUICKER — four strides came in at 347-365 s/mi against a 401
 *     target and were reported as deviations. `Research/04` §7.2 calls a
 *     stride "relaxed", "~85-95% max effort" and "Not a workout"; being quick
 *     is what a stride IS.
 *   · THE FRAMING — a quality-session sentence over an easy day.
 *
 * ── WHAT THIS GATE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
 *
 *   · IT CANNOT SEE THE PHONE. Every assertion here is on the composed object.
 *     Nothing proves a screen draws a stride row, and Rule 13's rendering half
 *     is not claimed by this file.
 *   · IT CANNOT PROVE THE MARKER ROUND-TRIPS. `STRIDE-3` proves the composer
 *     honours `shape: 'effort'` when it arrives; whether the WRIST ever sends
 *     `isStrideSegment` back is a Swift fact this file cannot reach. That is
 *     precisely why the label rung exists and why it is tested harder.
 *   · IT CANNOT MEASURE THE MISSING DISTANCE. `CAPTURE-*` assert that the app
 *     says the recording is short. Whether it is short by 0.43 mi is a fact
 *     only the watch held, and this file must never be made to assert it.
 *   · IT IS ONE SESSION SHAPE. Strides on a shakeout, on a standalone strides
 *     day, or mixed into a quality session are not exercised against real rows.
 *
 * ── RULE 22 · THE BALANCE ───────────────────────────────────────────────────
 *
 * A stride suite written only to stop false criticism would pass an app that
 * never identifies a stride at all. So the cases run in BOTH directions: four
 * assert a stride is recognised and not graded, and three assert that a
 * genuine rep is still counted, that a label alone cannot mint a stride, and
 * that a clean recording says nothing about capture.
 */
import { describe, it, expect } from 'vitest';
import { gradeStoredPhases } from '@/lib/execution/verdict';
import { EASY_PHASE_TOLERANCE_S_PER_MI, gradeCeilingPhase } from '@/lib/training/execution-semantics';
import { looksLikeStrideLabel, strideLabelFor } from '@/lib/training/expand-spec';
import {
  composePostRunExperience,
  isStridePhase,
  readCapture,
  readStrides,
  type PostRunInput,
} from './experience';

/**
 * The owner's REAL 2026-09-02 phases, read out of `runs.data.phases` at
 * `faff_readonly`, sample streams stripped.
 *
 * NOTE WHAT IS NOT HERE: no `isStrideSegment`, no `paceShape`, no
 * `tolerancePaceSPerMi`. `appendStrides` sets the first, `build-workout.ts`
 * puts all three on the prescription wire, and the wrist decodes them — and
 * `WatchCompletionPhase`, the outgoing struct, declares none of them. This is
 * the payload as it actually exists, which is the only payload worth grading
 * against (Rule 13 clause 2).
 */
const REAL_0902_PHASES = [
  { index: 0, type: 'work', label: '5.0 mi easy', verdict: 'hit', completed: true, avgHr: 137, maxHr: 149, avgCadence: 165, actualDistanceMi: 5, actualPaceSPerMi: 515, targetPaceSPerMi: 522, actualDurationSec: 2577, timeInToleranceSec: 2090, timeOutOfToleranceSec: 455 },
  { index: 1, type: 'work', label: 'Stride 1 of 6', completed: true, avgHr: 147, maxHr: 148, avgCadence: 171, actualDistanceMi: 0.05, actualPaceSPerMi: 401, targetPaceSPerMi: 401, actualDurationSec: 20 },
  { index: 2, type: 'recovery', label: 'Walk back', completed: true, avgHr: 151, maxHr: 155, avgCadence: 166, actualDistanceMi: 0.11, actualPaceSPerMi: 546, targetPaceSPerMi: 522, actualDurationSec: 60 },
  { index: 3, type: 'work', label: 'Stride 2 of 6', completed: true, avgHr: 147, maxHr: 148, avgCadence: 177, actualDistanceMi: 0.06, actualPaceSPerMi: 347, targetPaceSPerMi: 401, actualDurationSec: 20 },
  { index: 4, type: 'recovery', label: 'Walk back', completed: true, avgHr: 153, maxHr: 159, avgCadence: 162, actualDistanceMi: 0.12, actualPaceSPerMi: 519, targetPaceSPerMi: 522, actualDurationSec: 60 },
  { index: 5, type: 'work', label: 'Stride 3 of 6', completed: true, avgHr: 149, maxHr: 153, avgCadence: 174, actualDistanceMi: 0.06, actualPaceSPerMi: 349, targetPaceSPerMi: 401, actualDurationSec: 20 },
  { index: 6, type: 'recovery', label: 'Walk back', completed: true, avgHr: 154, maxHr: 159, avgCadence: 163, actualDistanceMi: 0.11, actualPaceSPerMi: 547, targetPaceSPerMi: 522, actualDurationSec: 60 },
  { index: 7, type: 'work', label: 'Stride 4 of 6', completed: true, avgHr: 152, maxHr: 154, avgCadence: 157, actualDistanceMi: 0.05, actualPaceSPerMi: 365, targetPaceSPerMi: 401, actualDurationSec: 20 },
  { index: 8, type: 'recovery', label: 'Walk back', completed: true, avgHr: 154, maxHr: 160, avgCadence: 147, actualDistanceMi: 0.09, actualPaceSPerMi: 677, targetPaceSPerMi: 522, actualDurationSec: 60 },
  { index: 9, type: 'work', label: 'Stride 5 of 6', completed: true, avgHr: 142, maxHr: 146, avgCadence: 176, actualDistanceMi: 0.06, actualPaceSPerMi: 350, targetPaceSPerMi: 401, actualDurationSec: 20 },
  { index: 10, type: 'recovery', label: 'Walk back', completed: false, avgHr: 157, maxHr: 163, avgCadence: 148, actualDistanceMi: 0.1, actualPaceSPerMi: 563, targetPaceSPerMi: 522, actualDurationSec: 59 },
  { index: 11, type: 'work', label: 'Stride 6 of 6', completed: true, avgHr: 152, maxHr: 157, avgCadence: 161, actualDistanceMi: 0.05, actualPaceSPerMi: 431, targetPaceSPerMi: 401, actualDurationSec: 20 },
  { index: 12, type: 'recovery', label: 'Walk back', completed: true, avgHr: 157, maxHr: 160, avgCadence: 146, actualDistanceMi: 0.12, actualPaceSPerMi: 526, targetPaceSPerMi: 522, actualDurationSec: 61 },
];

/** The owner's REAL `plan_workouts.workout_spec` for 2026-09-02. */
const REAL_0902_SPEC = {
  kind: 'easy',
  hr_cap_bpm: 151,
  strides_reps: 6,
  strides_duration_s: 20,
  strides_recovery_s: 60,
  strides_pace_s_per_mi: 401,
  pace_target_s_per_mi_lo: 502,
  pace_target_s_per_mi_hi: 542,
};

/** The row's REAL `clockAudit`. Present only because the check FAILED. */
const REAL_0902_CLOCK = { driftSec: 1637, wallSec: 4694, countedSec: 3057 };

function input(o: Partial<PostRunInput> = {}): PostRunInput {
  return {
    runId: '-145861381014809',
    dateISO: '2026-09-02',
    plannedType: 'easy',
    plannedTypeDisplay: 'Easy',
    plannedDistanceMi: 5,
    raceMatched: false,
    targetProvenance: 'plan',
    verdict: gradeStoredPhases(REAL_0902_PHASES, 'easy'),
    evidence: null,
    workHrCeilingBpm: null,
    overallHrCeilingBpm: REAL_0902_SPEC.hr_cap_bpm,
    wholeRunHrBpm: 139,
    rpe: 3,
    adaptations: [],
    hasActivePlan: true,
    activePlanId: 'pln_9a57561debb776e5',
    sensorLimited: false,
    stridesPrescribed: REAL_0902_SPEC.strides_reps,
    // THE ROW AS IT NOW STANDS. The totals were repaired by hand on
    // 2026-09-02 (`data.manualCorrection`, approved by the runner, sourced
    // from a photograph of his watch at the moment he stopped) while the
    // phases and splits were deliberately left alone — the recovered
    // 0.43 mi is post-plan overtime and belongs to no phase.
    recordedDistanceMi: 6.41,
    recordedDurationSec: 3349,
    structuredDistanceMi: 5.98,
    structuredDurationSec: 3057,
    splitCount: 5,
    splitDistanceMi: 5,
    correctedManually: true,
    clockAudit: REAL_0902_CLOCK,
    ...o,
  } as PostRunInput;
}

/* ══════════════ STRIDE-0 · the label contract has ONE definition ═════════ */

describe('STRIDE-0 · the authored label and the matcher cannot drift apart', () => {
  it('matches every label appendStrides can author', () => {
    for (const reps of [4, 6, 8]) {
      for (let i = 0; i < reps; i++) {
        expect(looksLikeStrideLabel(strideLabelFor(i, reps))).toBe(true);
      }
    }
  });

  it('REFUSES a label that merely mentions strides', () => {
    // Anchored at both ends on purpose. A coach note is not a phase label.
    expect(looksLikeStrideLabel('Strides after the long run')).toBe(false);
    expect(looksLikeStrideLabel('Stride out the last mile')).toBe(false);
    expect(looksLikeStrideLabel('Interval · 1 mi')).toBe(false);
    expect(looksLikeStrideLabel(null)).toBe(false);
    expect(looksLikeStrideLabel('')).toBe(false);
  });
});

/* ══════════════ STRIDE-1 · the easy block is not a repetition ═══════════ */

describe("STRIDE-1 · the runner's real 2026-09-02 easy day", () => {
  const out = composePostRunExperience(input());

  it('does NOT call the easy block a rep, and does not count seven of anything', () => {
    // THE EXACT STRING HE WAS SHOWN. Asserted as a non-match rather than
    // trusted to a paraphrase, because this is the sentence he read.
    expect(out.execution.summary).not.toBe(
      'All seven reps landed, with four quicker than the ceiling.',
    );
    expect(out.execution.summary).not.toMatch(/seven/i);
    expect(out.execution.summary).not.toMatch(/\breps?\b/i);
  });

  it('describes the session as one easy run plus strides', () => {
    // The SHAPE of the result, not the absence of the defect (Rule 13 cl. 3).
    // EASY-VOICE-1, 2026-09-04 · "The work block stayed under the ceiling"
    // was composer vocabulary, not something a coach says about a run that
    // got done — replaced with activity-appropriate language. `recoveries
    // Honest` has nothing to evaluate on a single-block session (there are
    // no between-rep recoveries to judge), so this shape now earns
    // `CONTROLLED` outright rather than falling to the ambiguous `EXECUTED`
    // a null `recoveriesHonest` produced.
    expect(out.execution.headline).toBe('Easy run complete');
    expect(out.execution.summary).toBe(
      'You kept the run controlled, staying under the pace ceiling. Six strides after, walk-backs taken.',
    );
    expect(out.execution.status).toBe('CONTROLLED');
    expect(out.execution.intendedStimulus).toBe('Easy');
  });

  it('grades against a CEILING and never a window — an easy run is never failed for being slow', () => {
    expect(out.execution.summary).toMatch(/ceiling/);
    expect(out.execution.summary).not.toMatch(/window|interval|tempo|threshold/i);
  });
});

/* ══════════ STRIDE-2 · a stride is never criticised for being quick ══════ */

describe('STRIDE-2 · four strides at 347-365 against a 401 target', () => {
  const out = composePostRunExperience(input());

  it('says nothing about them being quicker than anything', () => {
    expect(out.execution.summary).not.toMatch(/quicker|faster|ahead of/i);
  });

  it('carries no verdict field on any stride row, by construction', () => {
    const s = out.strides!;
    expect(s).not.toBeNull();
    for (const row of s.strides) {
      // If someone adds a verdict to `PostRunStride`, this fails and they have
      // to argue with Research/04 §7.2 rather than with a reviewer.
      expect(Object.keys(row)).not.toContain('verdict');
      expect(Object.keys(row)).not.toContain('statusLabel');
    }
  });

  it('reports completion, distance and physiology instead', () => {
    const s = out.strides!;
    expect(s.prescribed).toBe(6);
    expect(s.recorded).toBe(6);
    expect(s.completed).toBe(6);
    expect(s.strides.map((r) => r.paceSecPerMi)).toEqual([401, 347, 349, 365, 350, 431]);
    expect(s.strides.map((r) => r.avgHr)).toEqual([147, 147, 149, 152, 142, 152]);
    expect(s.recoveryCount).toBe(6);
    expect(s.recoveryDistanceMi).toBe(0.65);
    expect(s.summary).toBe('0.98 mi of this run is the strides and their walk-backs.');
  });

  it('accounts for exactly the distance the five-row mile table left off', () => {
    const s = out.strides!;
    const strideMi = s.strides.reduce((a, r) => a + (r.distanceMi ?? 0), 0);
    // 5.98 recorded − 5 whole miles in `runs.data.splits` = 0.98, and this is it.
    expect(Math.round((strideMi + (s.recoveryDistanceMi ?? 0)) * 100) / 100).toBe(0.98);
  });
});

/* ══════════ STRIDE-3 · the marker rung, for when the wrist carries it ════ */

describe('STRIDE-3 · `isStrideSegment` on the wire needs no spec to be believed', () => {
  it('honours shape `effort` with NO strides_reps at all', () => {
    const marked = REAL_0902_PHASES.map((p) =>
      p.label?.startsWith('Stride') ? { ...p, isStrideSegment: true } : p,
    );
    const out = composePostRunExperience(input({
      verdict: gradeStoredPhases(marked, 'easy'),
      // The plan row is deliberately unreadable here: the marker alone must
      // carry it, which is the state this app reaches when Swift is fixed.
      stridesPrescribed: null,
    }));
    expect(out.strides).not.toBeNull();
    expect(out.strides!.recorded).toBe(6);
    expect(out.strides!.basis).toBe('marker');
    expect(out.execution.summary).not.toMatch(/seven|\breps?\b/i);
  });

  it('reports which rung answered, so a reader is never guessing', () => {
    expect(composePostRunExperience(input()).strides!.basis).toBe('label');
  });
});

/* ══════════ STRIDE-4 · a label ALONE may never mint a stride ═════════════ */

describe('STRIDE-4 · the fallback is conjunctive and stays that way', () => {
  it('refuses a stride label when the session prescribed none', () => {
    for (const prescribed of [null, 0]) {
      const out = composePostRunExperience(input({ stridesPrescribed: prescribed }));
      expect(out.strides).toBeNull();
      // And the old arithmetic comes back, which is the point: nothing is
      // being hidden, the phases really are seven work phases to this reader.
      expect(out.execution.summary).toMatch(/seven/i);
    }
  });

  it('treats a phase as a stride only when BOTH the spec and the label agree', () => {
    const p = gradeStoredPhases(REAL_0902_PHASES, 'easy').phases[1];
    expect(isStridePhase(p, 6)).toBe(true);
    expect(isStridePhase(p, 0)).toBe(false);
    expect(isStridePhase(p, null)).toBe(false);
  });
});

/* ══════════ STRIDE-5 · a real rep set is UNCHANGED ══════════════════════ */

describe('STRIDE-5 · the balance · a genuine repetition is still a repetition', () => {
  it('still counts four one-mile intervals as four reps', () => {
    const reps = [
      { index: 0, type: 'warmup', label: 'Warm-up', completed: true, actualDurationSec: 1084, actualDistanceMi: 2.1, targetPaceSPerMi: 502, actualPaceSPerMi: 516 },
      { index: 1, type: 'work', label: 'Interval · 1 mi', completed: true, actualDurationSec: 424, actualDistanceMi: 1.01, targetPaceSPerMi: 430, actualPaceSPerMi: 429 },
      { index: 2, type: 'work', label: 'Interval · 1 mi', completed: true, actualDurationSec: 431, actualDistanceMi: 1.01, targetPaceSPerMi: 430, actualPaceSPerMi: 431 },
      { index: 3, type: 'work', label: 'Interval · 1 mi', completed: true, actualDurationSec: 423, actualDistanceMi: 1.0, targetPaceSPerMi: 430, actualPaceSPerMi: 430 },
      { index: 4, type: 'work', label: 'Interval · 1 mi', completed: true, actualDurationSec: 422, actualDistanceMi: 1.01, targetPaceSPerMi: 430, actualPaceSPerMi: 428 },
    ];
    const out = composePostRunExperience(input({
      plannedType: 'threshold',
      plannedTypeDisplay: 'Threshold',
      verdict: gradeStoredPhases(reps, 'threshold'),
      stridesPrescribed: 0,
      clockAudit: null,
    }));
    expect(out.strides).toBeNull();
    expect(out.execution.summary).toMatch(/all four reps/i);
  });
});

/* ══════ TOLERANCE · Rule 11 · an absent slack is not a zero slack ═══════ */

describe('TOLERANCE · a ceiling phase with no stored tolerance is not graded at zero', () => {
  /* WHY THIS GATE EXISTS, AND IT IS NOT HYPOTHETICAL.
   *
   * Not one phase on the 2026-09-02 run carries `tolerancePaceSPerMi` — the
   * field is absent from all thirteen. His easy block ran 515 s/mi against a
   * 522 ceiling, and the wrist, which HAD the tolerance at the time, wrote
   * `verdict: "hit"` onto the phase.
   *
   * Seven seconds a mile under a ceiling is a hit at any honest width and a
   * FAST at a width of zero. So if any path ever compares 515 to 522 with no
   * slack, this session flips to "The work block came in ahead of the
   * ceiling" — a runner told he ran his easy day too hard because a number
   * was missing. That is Rule 11 exactly: an absent tolerance is "don't
   * know", never "zero".
   *
   * `gradeStoredPhases` gets this right by falling back to
   * `phaseToleranceSec`, doctrine's own width, and this pins that behaviour
   * so a future change to the tolerance ladder cannot silently reintroduce
   * the zero. It reads the width out of `execution-semantics.ts` at run time
   * rather than hardcoding it, so it checks the ENGINE and not itself.
   */
  const graded = gradeStoredPhases(REAL_0902_PHASES, 'easy', { stridesPrescribed: 6 });
  const easyBlock = graded.phases[0];

  it('confirms the fixture really carries no tolerance — the gate needs that to mean anything', () => {
    for (const p of REAL_0902_PHASES) {
      expect((p as Record<string, unknown>).tolerancePaceSPerMi).toBeUndefined();
    }
  });

  it('falls back to doctrine\'s easy width rather than to zero', () => {
    expect(easyBlock.shape).toBe('ceiling');
    expect(easyBlock.toleranceSec).toBe(EASY_PHASE_TOLERANCE_S_PER_MI);
    expect(easyBlock.toleranceSec).toBeGreaterThan(0);
  });

  it('grades the easy block HIT, agreeing with the verdict the wrist stored', () => {
    // The wrist had the tolerance and wrote "hit". The server, recomputing,
    // must reach the same answer — when it does not, one of them is reading a
    // width the other never had (Rule 16).
    expect(easyBlock.verdict).toBe('hit');
    expect(REAL_0902_PHASES[0].verdict).toBe('hit');
  });

  it('and the sentence therefore says he stayed under it', () => {
    const out = composePostRunExperience(input({ verdict: graded }));
    // EASY-VOICE-1, 2026-09-04 · "staying under the pace ceiling", not
    // "stayed under the ceiling" — the activity-appropriate rewrite of the
    // same claim, still gated on the same real `hit` grade above.
    expect(out.execution.summary).toMatch(/staying under the pace ceiling/);
    expect(out.execution.summary).not.toMatch(/ahead of the ceiling/);
  });

  it('FALSIFIER · at zero slack the same phase reads fast, which is the defect', () => {
    // Run the engine's own rule at the width this gate exists to forbid, so
    // the assertion above is shown to be load-bearing rather than incidental
    // (Rule 18: a gate that has never failed is a hypothesis).
    expect(gradeCeilingPhase({ ceilingSecPerMi: 522, avgSecPerMi: 515, completed: true, slackSec: 0 }))
      .toBe('fast');
    expect(gradeCeilingPhase({ ceilingSecPerMi: 522, avgSecPerMi: 515, completed: true, slackSec: EASY_PHASE_TOLERANCE_S_PER_MI }))
      .toBe('hit');
  });
});

/* ══════════ CAPTURE · Rule 11, applied to distance ══════════════════════ */

describe('CAPTURE · three quantities, one total, and the runner can tell them apart', () => {
  it('reconciles 6.41 = 5.98 structured + 0.43 overtime, and names the mile table share', () => {
    const c = readCapture(input());
    expect(c.status).toBe('OVERTIME');
    expect(c.totalDistanceMi).toBe(6.41);
    expect(c.structuredDistanceMi).toBe(5.98);
    expect(c.overtimeDistanceMi).toBe(0.43);
    expect(c.overtimeDurationSec).toBe(292);
    expect(c.splitCount).toBe(5);
    expect(c.splitDistanceMi).toBe(5);
    expect(c.summary).toBe(
      '6.41 mi in total: 5.98 mi of the session, then 0.43 mi run on after the last '
      + 'prescribed piece. The mile table covers the first five.',
    );
  });

  it('calls the overtime overtime, and never a phase or a mile', () => {
    /* It is real running that belongs to the run and to no phase. The repair
     * note on the row says exactly that, which is why `phases` and `splits`
     * were left alone; inventing rows for it here would undo that decision
     * one layer up. */
    const out = composePostRunExperience(input());
    expect(out.strides!.strides.length).toBe(6);        // still six, not seven
    expect(out.capture.summary).toMatch(/run on after the last prescribed piece/);
    expect(out.capture.summary).not.toMatch(/stride|mile 6|phase/i);
  });

  it('does NOT narrate the stale clock drift once the totals have been repaired', () => {
    /* `clockAudit` is frozen at ingest — the repair note says it is "left as
     * the original ingest recorded it" — so its 1637 s complains about a
     * 5.98 that no longer exists. Reading it as a live shortfall would be a
     * confident claim off a value whose anchor moved (Rule 10). */
    const c = readCapture(input());
    expect(c.correctedManually).toBe(true);
    expect(c.uncountedSec).toBe(1637);
    expect(c.status).not.toBe('SHORT');
    expect(c.summary).not.toMatch(/stopped counting|cover less than you ran/);
  });

  it('DOES say the recording is short when nobody has repaired it — the pre-repair state', () => {
    // Exactly the row as it stood this morning: total == phases, drift present,
    // no correction. This arm must survive, because the capture defect it
    // reports is still live for every future run until the watch is fixed.
    const c = readCapture(input({
      recordedDistanceMi: 5.98, recordedDurationSec: 3057, correctedManually: false,
    }));
    expect(c.status).toBe('SHORT');
    expect(c.summary).toBe(
      'The watch stopped counting before this run ended. It logged 5.98 mi, and its own clock '
      + 'recorded more elapsed time than it counted, so the distance, the splits and the paces '
      + 'below cover less than you ran.',
    );
  });

  it('NEVER quantifies that shortfall in the sentence', () => {
    /* `driftSec` is `completedAt - startedAt - countedSec`, and on a salvaged
     * completion `completedAt` is when the payload was BUILT. 1637 s against
     * 292 s of real lost running: "about 27 minutes uncounted" would have been
     * five times the truth, stated confidently, inside a caveat about honesty
     * (Rule 13 clause 4). */
    const c = readCapture(input({
      recordedDistanceMi: 5.98, recordedDurationSec: 3057, correctedManually: false,
    }));
    expect(c.summary).not.toMatch(/27|1637|minute/);
  });

  it('says NOTHING when the phases account for the run — the balance case', () => {
    const c = readCapture(input({
      recordedDistanceMi: 5.98, recordedDurationSec: 3057, clockAudit: null, correctedManually: false,
    }));
    expect(c.status).toBe('RECONCILED');
    expect(c.summary).toBeNull();
  });

  it('does not call GPS rounding overtime', () => {
    // Thirteen two-decimal phases can disagree with the total by a few
    // hundredths without anyone having run anywhere.
    const c = readCapture(input({
      recordedDistanceMi: 6.02, recordedDurationSec: 3060, clockAudit: null, correctedManually: false,
    }));
    expect(c.status).toBe('RECONCILED');
    expect(c.overtimeDistanceMi).toBeNull();
  });

  it('refuses to reconcile when it has no phases to reconcile against', () => {
    const c = readCapture(input({ structuredDistanceMi: null, structuredDurationSec: null }));
    expect(c.status).toBe('UNKNOWN');
    expect(c.summary).toBeNull();
  });
});

/* ══════════ BELIEF · closure 6 · the tension read must be reachable ═════ */

describe('BELIEF · a comparison that did not happen is never narrated as one', () => {
  const withEvidence = (reason: string) => input({
    evidence: {
      modelVersion: '1.0.0',
      activityId: '-145861381014809',
      date: '2026-09-02',
      eligibility: { admissible: true, signals: {}, signalReasons: [], continuity: {}, rejections: [] },
      environment: { hrCostPlausiblyElevated: false, load: 'none', reasons: [] },
      capacities: {
        threshold: { capacity: 'threshold', kind: 'evidence', strength: 'moderate', weight: 0.5, reliability: 'moderate', anchorEffect: 'supporting_evidence_only', reasons: [] },
        high_intensity: { capacity: 'high_intensity', kind: 'no_evidence', reasons: [] },
        durability: { capacity: 'durability', kind: 'no_evidence', reasons: [] },
        easy_ceiling: { capacity: 'easy_ceiling', kind: 'no_evidence', reasons: [] },
      },
      beliefTension: { ok: false, reason },
      trainingLoad: { stimulus: 'aerobic_maintenance', aerobicMinutes: 51, distanceMi: 5.98, primaryValue: 'Aerobic volume.' },
      anchorMoveCandidate: false,
      anchorMoveReasons: [],
      reasons: [],
    } as never,
  });

  it('REFUSES "supports your current" when no belief was supplied', () => {
    const out = composePostRunExperience(withEvidence('no_belief_supplied'));
    expect(out.evidence.runnerSummary).not.toMatch(/supports your current/i);
    expect(out.evidence.runnerSummary).toBe(
      'This run says something about your threshold range. It has not been checked against your current number yet.',
    );
    // And it says so in the record, so the gap can never be invisible again.
    expect(out.evidence.reasons).toContain('CURRENT_BELIEF_NOT_SUPPLIED_TO_CLASSIFIER');
  });

  it('SAYS "supports your current" when the comparison actually ran — the balance case', () => {
    const out = composePostRunExperience(withEvidence('observation_consistent_with_belief'));
    expect(out.evidence.runnerSummary).toBe(
      'This supports your current threshold range. One session is not enough to move it.',
    );
    expect(out.evidence.reasons).not.toContain('CURRENT_BELIEF_NOT_SUPPLIED_TO_CLASSIFIER');
  });
});

/* ══════════════════════════════ LIVENESS ════════════════════════════════ */

describe('LIVENESS', () => {
  it('graded the real payload rather than an empty one', () => {
    // Rule 18 clause 2: a gate that reports clean because it read nothing is
    // the worst outcome available, since it also reports confidence.
    const v = gradeStoredPhases(REAL_0902_PHASES, 'easy');
    expect(v.basis).toBe('watch-phases');
    expect(v.phases.length).toBe(13);
    expect(v.work.count).toBe(7);
    expect(readStrides(input())!.strides.length).toBe(6);
  });
});
