/**
 * THE CLASS · A STRIDE IS COUNTED AS A REP.
 *
 * Not one instance. `phases.filter(type === 'work').length` is the expression,
 * and it has now been wrong on four surfaces independently:
 *
 *   `lib/coach/reading-scope.ts`     "Cadence, across the 7 reps"   ← fixed here
 *   `RunDetailV5.repSectionTitle`    "Rep by rep" over an easy day  ← fixed 09-02
 *   `lib/postrun/experience.ts`      "All seven reps"               ← fixed 09-02
 *   `WorkoutEngine.repCountForDisplay` (wrist) `repCount: 7`        ← fixed 09-02
 *
 * Same arithmetic, four authors, one wrong answer. This file is the gate for
 * the SERVER half of it, driven end to end through the real pipeline the
 * runner's screen uses — `gradeStoredPhases` → `mapWatchPhases` →
 * `deriveReadingScopes` — rather than a hand-built `ScopePhase[]`, because a
 * fixture I write myself cannot tell me the pipeline still resolves the stride
 * shape (Rule 13: a fixture skips the code path that breaks).
 *
 * ── LIVENESS (Rule 18.2) ────────────────────────────────────────────────────
 *
 * `REAL_0902_PHASES` is asserted to hold exactly seven `work` entries and six
 * stride labels before anything is measured. If the fixture is ever trimmed to
 * something that cannot express the defect, this file fails rather than going
 * quietly green — which is the failure mode Rule 15 names.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ──────────────────────────────────────
 *
 *   · A stride on a session whose plan row prescribed none AND whose stored
 *     phase carries no `isStrideSegment` marker. Both stride rungs are then
 *     unavailable and the phase is indistinguishable from a short rep. That is
 *     a data-vintage gap in the payload, not something this module can see.
 *   · The VALUE half. `hr_avg_work` / `cadence_avg_work` come from
 *     `lib/runs/work-averages.ts`, which still filters on `type === 'work'`
 *     and therefore still averages the strides in. `deriveReadingScopes`
 *     prefers those server numbers over its own weighted mean, deliberately,
 *     so the two surfaces cannot print different numbers under one label. The
 *     measured cost on this session is 1 bpm (137 reps-only against 138 with
 *     the strides) and 0 spm, which is why it is reported rather than fixed
 *     inside this file's boundary. If that module is ever fixed, the third
 *     test below starts asserting the corrected value and should be updated
 *     rather than deleted.
 *   · Anything on the wrist. `WorkoutEngine` is a watch target.
 *   · Whether the phone RENDERS the note. This gate reaches the wire, not the
 *     screen.
 */
import { describe, it, expect } from 'vitest';
import { mapWatchPhases } from './run-state';
import { deriveReadingScopes, medianWorkDurationSec } from './reading-scope';

/**
 * Run `-145861381014809` · 2026-09-02 · 6.41 mi easy + 6 strides.
 *
 * REAL. Read from production on 2026-09-03 as `faff_readonly`, out of the
 * `coach_intents` row `reason = 'watch_completion'`, `field =
 * '0645f40c-951d-4ccc-b86e-9979cd26c795-2026-09-02#0919'` — the payload
 * `loadPhaseBreakdown` reads, in the watch's own camelCase, trimmed to the
 * fields the pipeline below touches.
 *
 * This is the session that produced "Cadence, across the 7 reps" on his screen
 * beside a section header reading "Piece by piece" over six strides.
 */
const REAL_0902_PHASES = [
  { type: 'work',     label: '5.0 mi easy',    actualDurationSec: 2577, actualDistanceMi: 5.00, avgHr: 137, avgCadence: 165 },
  { type: 'work',     label: 'Stride 1 of 6',  actualDurationSec:   20, actualDistanceMi: 0.05, avgHr: 147, avgCadence: 171 },
  { type: 'recovery', label: 'Walk back',      actualDurationSec:   60, actualDistanceMi: 0.11, avgHr: 151, avgCadence: 166 },
  { type: 'work',     label: 'Stride 2 of 6',  actualDurationSec:   20, actualDistanceMi: 0.06, avgHr: 147, avgCadence: 177 },
  { type: 'recovery', label: 'Walk back',      actualDurationSec:   60, actualDistanceMi: 0.12, avgHr: 153, avgCadence: 162 },
  { type: 'work',     label: 'Stride 3 of 6',  actualDurationSec:   20, actualDistanceMi: 0.06, avgHr: 149, avgCadence: 174 },
  { type: 'recovery', label: 'Walk back',      actualDurationSec:   60, actualDistanceMi: 0.11, avgHr: 154, avgCadence: 163 },
  { type: 'work',     label: 'Stride 4 of 6',  actualDurationSec:   20, actualDistanceMi: 0.05, avgHr: 152, avgCadence: 157 },
  { type: 'recovery', label: 'Walk back',      actualDurationSec:   60, actualDistanceMi: 0.09, avgHr: 154, avgCadence: 147 },
  { type: 'work',     label: 'Stride 5 of 6',  actualDurationSec:   20, actualDistanceMi: 0.06, avgHr: 142, avgCadence: 176 },
  { type: 'recovery', label: 'Walk back',      actualDurationSec:   59, actualDistanceMi: 0.10, avgHr: 157, avgCadence: 148 },
  { type: 'work',     label: 'Stride 6 of 6',  actualDurationSec:   20, actualDistanceMi: 0.05, avgHr: 152, avgCadence: 161 },
  { type: 'recovery', label: 'Walk back',      actualDurationSec:   61, actualDistanceMi: 0.12, avgHr: 157, avgCadence: 146 },
];

/** What `plan_workouts.workout_spec.strides_reps` held for that day, and what
 *  `loadPhaseBreakdown` passes into the grader. */
const STRIDES_PRESCRIBED = 6;

/** The real pipeline, in the real order, with the real arguments. */
const scopesFor = (stridesPrescribed: number | null) =>
  deriveReadingScopes({
    phases: mapWatchPhases(REAL_0902_PHASES, 0, 'easy', stridesPrescribed),
    wholeHrBpm: 141,
    wholeCadenceSpm: 164,
  });

describe('the fixture can still express the defect (liveness)', () => {
  it('holds seven work phases, six of which are strides', () => {
    const work = REAL_0902_PHASES.filter((p) => p.type === 'work');
    expect(work).toHaveLength(7);
    expect(work.filter((p) => /^Stride \d of 6$/.test(p.label))).toHaveLength(6);
  });

  it('the grader resolves those six as strides, and only those six', () => {
    const mapped = mapWatchPhases(REAL_0902_PHASES, 0, 'easy', STRIDES_PRESCRIBED);
    const effort = mapped.filter((p) => p.type === 'work' && p.pace_shape === 'effort');
    expect(effort).toHaveLength(6);
    // The easy block is NOT one of them. Without this the test above would
    // pass on a pipeline that called everything a stride.
    expect(mapped.find((p) => p.label === '5.0 mi easy')?.pace_shape).not.toBe('effort');
  });
});

describe('a stride is not a rep · the count the runner reads', () => {
  it('does not call this session a seven-rep set', () => {
    const r = scopesFor(STRIDES_PRESCRIBED);
    // The defect verbatim. This is the string that was on his screen.
    expect(r.cadence.note).not.toBe('across the 7 reps');
    expect(r.hr.note).not.toBe('across the 7 reps');
    // Assert the SHAPE of the answer, not just the absence of the bad one
    // (Rule 18: an absence-only assertion cannot see wreckage). The work of
    // that day was one 5.0 mi block, so the label is the single-block one.
    expect(r.cadence.note).toBe('on the work');
    expect(r.isRepSet).toBe(false);
  });

  it('no reading calls a number a rep count that disagrees with the strides', () => {
    const r = scopesFor(STRIDES_PRESCRIBED);
    for (const reading of [r.hr, r.cadence, r.pace]) {
      const n = reading.note?.match(/across the (\d+) reps/)?.[1];
      // Six strides plus one easy block is never "7 reps", and it is never
      // "6 reps" either — the strides are not reps at all.
      expect(n, `note "${reading.note}"`).toBeUndefined();
    }
  });
});

describe('a stride is not a rep · the numbers that followed from the count', () => {
  it('stops the strides dragging the kinetics median under the floor', () => {
    // Seven work phases: [20, 20, 20, 20, 20, 20, 2577]. Median 20, which is
    // under HR_REP_KINETICS_FLOOR_SEC, so the whole session was refused a
    // heart-rate reading. Reps-only leaves one phase and a median of 2577.
    const mapped = mapWatchPhases(REAL_0902_PHASES, 0, 'easy', STRIDES_PRESCRIBED);
    expect(medianWorkDurationSec(mapped)).toBe(2577);
  });

  it('gives the session back its heart rate, and does not say the rep sentence', () => {
    const r = scopesFor(STRIDES_PRESCRIBED);
    expect(r.hr.scope).toBe('work');
    // 43 minutes of steady easy running at 137 bpm. Refusing it with "Reps
    // this short never reach their heart-rate band." was the second-order
    // cost of the same off-by-one.
    expect(r.hr.note).not.toMatch(/Reps this short/);
    expect(r.hr.value).toBeGreaterThan(130);
    expect(r.hr.value).toBeLessThan(145);
  });

  it('gives the session back its mile splits and its zone bar', () => {
    const r = scopesFor(STRIDES_PRESCRIBED);
    // Five of his 6.41 miles were one continuous easy block. Suppressing the
    // per-mile table on it, because six 20-second accelerations made the
    // session look like a rep set, is the same defect wearing a third hat.
    expect(r.splitsMeaningful).toBe(true);
    expect(r.zoneBarMeaningful).toBe(true);
  });
});

describe('the mechanism is REACHABLE, and it is not a no-op (Rule 15)', () => {
  it('the unresolved payload still reads seven, so the fix is doing the work', () => {
    // Rule 22's "beware the false zero", inverted: prove the gate would have
    // caught the defect rather than agreeing with an engine that never had
    // one. With no stride count the label rung cannot fire, nothing is shaped
    // `effort`, and the pipeline reproduces the original wrong answer.
    const r = scopesFor(null);
    expect(r.cadence.note).toBe('across the 7 reps');
    expect(r.isRepSet).toBe(true);
    expect(r.hr.scope).toBe('none');
    expect(r.splitsMeaningful).toBe(false);
  });
});

describe('a real rep set is still a rep set', () => {
  it('four kilometre reps plus strides count four, not ten', () => {
    const phases = [
      { type: 'warmup',   label: 'Warm-up',      actualDurationSec: 714, avgHr: 135, avgCadence: 159 },
      { type: 'work',     label: 'Rep 1',        actualDurationSec: 237, avgHr: 164, avgCadence: 174 },
      { type: 'recovery', label: 'Jog',          actualDurationSec:  90, avgHr: 164, avgCadence: 160 },
      { type: 'work',     label: 'Rep 2',        actualDurationSec: 242, avgHr: 169, avgCadence: 171 },
      { type: 'recovery', label: 'Jog',          actualDurationSec:  90, avgHr: 127, avgCadence: 116 },
      { type: 'work',     label: 'Rep 3',        actualDurationSec: 250, avgHr: 168, avgCadence: 168 },
      { type: 'recovery', label: 'Jog',          actualDurationSec:  90, avgHr: 155, avgCadence: 115 },
      { type: 'work',     label: 'Rep 4',        actualDurationSec: 259, avgHr: 160, avgCadence: 162 },
      { type: 'work',     label: 'Stride 1 of 6', actualDurationSec: 20, avgHr: 150, avgCadence: 175 },
      { type: 'work',     label: 'Stride 2 of 6', actualDurationSec: 20, avgHr: 150, avgCadence: 175 },
      { type: 'work',     label: 'Stride 3 of 6', actualDurationSec: 20, avgHr: 150, avgCadence: 175 },
      { type: 'work',     label: 'Stride 4 of 6', actualDurationSec: 20, avgHr: 150, avgCadence: 175 },
      { type: 'work',     label: 'Stride 5 of 6', actualDurationSec: 20, avgHr: 150, avgCadence: 175 },
      { type: 'work',     label: 'Stride 6 of 6', actualDurationSec: 20, avgHr: 150, avgCadence: 175 },
      { type: 'cooldown', label: 'Cool-down',    actualDurationSec: 507, avgHr: 161, avgCadence: 154 },
    ];
    const r = deriveReadingScopes({
      phases: mapWatchPhases(phases, 0, 'interval', 6),
      wholeHrBpm: 153,
      wholeCadenceSpm: 160,
    });
    // The half of the rule that says a rep set is STILL a rep set. Without
    // this the whole gate would pass an engine that had simply stopped
    // counting reps at all (Rule 22: check the distribution, both verdicts).
    expect(r.isRepSet).toBe(true);
    expect(r.cadence.note).toBe('across the 4 reps');
    expect(r.splitsMeaningful).toBe(false);
  });
});
