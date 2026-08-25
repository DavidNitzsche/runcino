/**
 * The scoping rule, checked against the run that motivated it.
 *
 * The 2026-08-11 fixture below is REAL. It is the nine phases stored on run
 * `-106657799059002` in production, trimmed to the fields this module reads.
 * Its whole-run stored `avgHr` is 153 and its work phases averaged 165 — the
 * twelve-beat gap is the defect, and the first test is the proof.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveReadingScopes,
  medianWorkDurationSec,
  HR_REP_KINETICS_FLOOR_SEC,
  type ScopePhase,
} from './reading-scope';

/** Run -106657799059002 · 2026-08-11 · 4 × 1 km. Production data. */
const TUNEUP_0811: ScopePhase[] = [
  { type: 'warmup',   actual_duration_sec: 714, avg_hr: 135, avg_cadence: 159 },
  { type: 'work',     actual_duration_sec: 237, avg_hr: 164, avg_cadence: 174 },
  { type: 'recovery', actual_duration_sec:  90, avg_hr: 164, avg_cadence: 160 },
  { type: 'work',     actual_duration_sec: 242, avg_hr: 169, avg_cadence: 171 },
  { type: 'recovery', actual_duration_sec:  90, avg_hr: 127, avg_cadence: 116 },
  { type: 'work',     actual_duration_sec: 250, avg_hr: 168, avg_cadence: 168 },
  { type: 'recovery', actual_duration_sec:  90, avg_hr: 155, avg_cadence: 115 },
  { type: 'work',     actual_duration_sec: 259, avg_hr: 160, avg_cadence: 162 },
  { type: 'cooldown', actual_duration_sec: 507, avg_hr: 161, avg_cadence: 154 },
];

/** Run -220066891328078 · 2026-08-24 · 4.02 mi easy, no phases at all. */
const EASY_0824: ScopePhase[] = [];

describe('deriveReadingScopes · the 2026-08-11 tune-up', () => {
  it('refuses the whole-run 153 bpm and reports the work instead', () => {
    const r = deriveReadingScopes({
      phases: TUNEUP_0811,
      wholeHrBpm: 153,
      wholeCadenceSpm: 164,
    });

    expect(r.hr.scope).toBe('work');
    // Nothing on this run happened at 153. The duration-weighted mean of the
    // four reps is 165, and that is a number a rep of this session actually
    // ran at.
    expect(r.hr.value).toBe(165);
    expect(r.hr.value).not.toBe(153);
    expect(r.hr.note).toBe('across the 4 reps');
  });

  it('scopes cadence to the reps, away from the jogs that halve it', () => {
    const r = deriveReadingScopes({
      phases: TUNEUP_0811,
      wholeCadenceSpm: 164,
    });
    expect(r.cadence.scope).toBe('work');
    // Reps ran 162–174 spm; two of the jogs ran 115–116. The work mean is up
    // in rep territory, not between the two.
    expect(r.cadence.value).toBeGreaterThanOrEqual(162);
    expect(r.cadence.value).toBeLessThanOrEqual(174);
  });

  it('calls the pace WORK pace, not average pace', () => {
    // The session averaged 7:18 (438 s/mi) across nine phases; its reps ran
    // about 6:38 (398). Labelling 438 "average pace" invites a comparison
    // with the rep target it is fifty seconds away from.
    const r = deriveReadingScopes({
      phases: TUNEUP_0811,
      wholePaceSPerMi: 438,
      workPaceSPerMi: 398,
    });
    expect(r.pace.scope).toBe('work');
    expect(r.pace.value).toBe(398);
  });

  it('falls back to the whole-run pace rather than refusing it', () => {
    // Unlike HR, a pace is always a true statement about the run. Only its
    // label was ever the problem.
    const r = deriveReadingScopes({ phases: TUNEUP_0811, wholePaceSPerMi: 438 });
    expect(r.pace.scope).toBe('whole');
    expect(r.pace.value).toBe(438);
  });

  it('takes the per-mile chart and the zone bar off a rep set', () => {
    const r = deriveReadingScopes({ phases: TUNEUP_0811 });
    expect(r.isRepSet).toBe(true);
    expect(r.splitsMeaningful).toBe(false);
    expect(r.zoneBarMeaningful).toBe(false);
  });

  it('reads a ~4 minute rep, which is above the kinetics floor', () => {
    const m = medianWorkDurationSec(TUNEUP_0811);
    expect(m).toBe(246);
    expect(m!).toBeGreaterThanOrEqual(HR_REP_KINETICS_FLOOR_SEC);
  });
});

describe('deriveReadingScopes · a run with no structure', () => {
  it('leaves the whole-run averages exactly as they were', () => {
    const r = deriveReadingScopes({
      phases: EASY_0824,
      wholeHrBpm: 139,
      wholeCadenceSpm: 153,
    });
    expect(r.hr).toEqual({ scope: 'whole', value: 139, note: null });
    expect(r.cadence).toEqual({ scope: 'whole', value: 153, note: null });
    expect(r.splitsMeaningful).toBe(true);
    expect(r.zoneBarMeaningful).toBe(true);
    expect(r.isRepSet).toBe(false);
  });
});

describe('deriveReadingScopes · the HR kinetics floor', () => {
  const shortReps = (sec: number): ScopePhase[] => [
    { type: 'warmup',   actual_duration_sec: 600, avg_hr: 130, avg_cadence: 160 },
    ...Array.from({ length: 8 }, (): ScopePhase[] => [
      { type: 'work',     actual_duration_sec: sec, avg_hr: 150, avg_cadence: 186 },
      { type: 'recovery', actual_duration_sec: 120, avg_hr: 140, avg_cadence: 150 },
    ]).flat(),
    { type: 'cooldown', actual_duration_sec: 600, avg_hr: 135, avg_cadence: 158 },
  ];

  it('shows NO heart rate at all on an 8 × 400 (reps ~85 s)', () => {
    const r = deriveReadingScopes({ phases: shortReps(85), wholeHrBpm: 148 });
    expect(r.hr.scope).toBe('none');
    expect(r.hr.value).toBeNull();
    expect(r.hr.note).toMatch(/never reach/);
    // Research/03 §14 says ignore HR, not "average it more carefully".
    expect(r.zoneBarMeaningful).toBe(false);
  });

  it('still shows cadence on those reps · cadence has no rise time', () => {
    const r = deriveReadingScopes({ phases: shortReps(85) });
    expect(r.cadence.scope).toBe('work');
    expect(r.cadence.value).toBe(186);
  });

  it('scopes rather than refuses once the reps clear two minutes', () => {
    const r = deriveReadingScopes({ phases: shortReps(180), wholeHrBpm: 148 });
    expect(r.hr.scope).toBe('work');
    expect(r.hr.value).toBe(150);
  });

  it('treats exactly two minutes as clearing the floor', () => {
    const r = deriveReadingScopes({ phases: shortReps(HR_REP_KINETICS_FLOOR_SEC) });
    expect(r.hr.scope).toBe('work');
  });
});

describe('deriveReadingScopes · refusing rather than falling back', () => {
  it('shows no HR when the work phases carried none, even though the run did', () => {
    const phases: ScopePhase[] = [
      { type: 'warmup', actual_duration_sec: 600, avg_hr: 130 },
      { type: 'work',   actual_duration_sec: 300, avg_hr: null },
      { type: 'work',   actual_duration_sec: 300, avg_hr: null },
    ];
    // Falling back to 148 here is the original bug wearing a scope label.
    const r = deriveReadingScopes({ phases, wholeHrBpm: 148 });
    expect(r.hr.scope).toBe('none');
    expect(r.hr.value).toBeNull();
  });

  it('prefers the server-computed work average over its own re-derivation', () => {
    const r = deriveReadingScopes({
      phases: TUNEUP_0811,
      wholeHrBpm: 153,
      workHrBpm: 166,
    });
    expect(r.hr.value).toBe(166);
  });

  it('keeps the mile chart on a single-block session (a tempo)', () => {
    const tempo: ScopePhase[] = [
      { type: 'warmup',   actual_duration_sec: 800, avg_hr: 132, avg_cadence: 158 },
      { type: 'work',     actual_duration_sec: 1700, avg_hr: 162, avg_cadence: 176 },
      { type: 'cooldown', actual_duration_sec: 600, avg_hr: 140, avg_cadence: 156 },
    ];
    const r = deriveReadingScopes({ phases: tempo, wholeHrBpm: 148 });
    expect(r.isRepSet).toBe(false);
    expect(r.splitsMeaningful).toBe(true);
    // One work phase is still a scope · "on the work", not "across N reps".
    expect(r.hr.scope).toBe('work');
    expect(r.hr.value).toBe(162);
    expect(r.hr.note).toBe('on the work');
  });

  it('weights by duration, so a long rep is not one vote among equals', () => {
    const uneven: ScopePhase[] = [
      { type: 'work', actual_duration_sec: 60,  avg_hr: 200 },
      { type: 'work', actual_duration_sec: 540, avg_hr: 150 },
    ];
    const r = deriveReadingScopes({ phases: uneven });
    // Plain mean would be 175. Weighted is 155.
    expect(r.hr.value).toBe(155);
  });

  it('survives a ragged treadmill phase list with missing fields', () => {
    // Real shape from run -226755616416002 · the cool-down carries no HR, no
    // distance and no duration.
    const belt: ScopePhase[] = [
      { type: 'warmup',   actual_duration_sec: 1074, avg_hr: 129 },
      { type: 'work',     actual_duration_sec: 1200, avg_hr: null },
      { type: 'cooldown' },
    ];
    expect(() => deriveReadingScopes({ phases: belt })).not.toThrow();
    const r = deriveReadingScopes({ phases: belt, wholeHrBpm: 140 });
    expect(r.hr.scope).toBe('none');
  });
});
