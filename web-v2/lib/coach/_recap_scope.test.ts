/**
 * What the recap is allowed to SAY about a run, as opposed to show.
 *
 * Two defects are pinned here. The first is that the tempo and interval arms
 * quoted the whole-run average heart rate inside a sentence otherwise entirely
 * about the work block — "Tempo done · 4.0 mi @ 6:59 · avg HR 148", where 148
 * includes the warm-up and the cool-down and 6:59 does not. The second is that
 * three real session types never reached an arm at all and came out as
 * "Logged."
 */
import { describe, it, expect } from 'vitest';
import { deriveRecap, type RecapInput } from './run-recap';
import { deriveReadingScopes, type ScopePhase } from './reading-scope';

/** Run -106657799059002 · 2026-08-11 · 4 × 1 km. Production phases. */
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

const base: RecapInput = {
  type: 'tempo',
  phase: 'BUILD',
  plannedMi: 6,
  actualMi: 5.97,
  actualPaceSPerMi: 438,
  actualAvgHr: 153,
  actualMaxHr: 175,
};

const allText = (r: { verdict: string; facts: string[] }) =>
  [r.verdict, ...r.facts].join(' ');

describe('recap · the heart rate it quotes names its interval', () => {
  it('does not put the whole-run 153 in a sentence about the tempo block', () => {
    const readings = deriveReadingScopes({ phases: TUNEUP_0811, wholeHrBpm: 153 });
    const r = deriveRecap({
      ...base,
      workPaceSPerMi: 400,
      workDistanceMi: 2.48,
      readings,
    });
    const text = allText(r);
    expect(text).not.toContain('153');
    expect(text).toContain('165');
    expect(text).toContain('across the 4 reps');
  });

  it('THE DEFECT, pinned · without the scope the old path still emits 153', () => {
    // This is the code path as it stood before 2026-08-24, reachable by
    // omitting `readings`. It is kept green on purpose: it is both the
    // backward-compatibility guarantee for an old payload AND the proof that
    // the assertion above is testing a real change rather than agreeing with
    // itself. 153 is the mean of four hard kilometres and three jogs.
    const r = deriveRecap({ ...base, workPaceSPerMi: 400, workDistanceMi: 2.48 });
    expect(allText(r)).toContain('153');
  });

  it('leaves an unstructured run exactly as it was', () => {
    const readings = deriveReadingScopes({ phases: [], wholeHrBpm: 139 });
    const withScope = deriveRecap({ ...base, type: 'easy', actualAvgHr: 139, readings });
    const withoutScope = deriveRecap({ ...base, type: 'easy', actualAvgHr: 139 });
    expect(withScope.facts).toEqual(withoutScope.facts);
    expect(withScope.verdict).toEqual(withoutScope.verdict);
  });

  it('quotes no heart rate at all when the reps are under two minutes', () => {
    const shortReps: ScopePhase[] = [
      { type: 'warmup', actual_duration_sec: 600, avg_hr: 130 },
      ...Array.from({ length: 8 }, (): ScopePhase[] => [
        { type: 'work',     actual_duration_sec: 85,  avg_hr: 150 },
        { type: 'recovery', actual_duration_sec: 120, avg_hr: 140 },
      ]).flat(),
    ];
    const readings = deriveReadingScopes({ phases: shortReps, wholeHrBpm: 148 });
    const r = deriveRecap({
      ...base,
      type: 'intervals',
      actualAvgHr: 148,
      repPaces: [352, 350, 355, 353, 356, 358, 354, 357],
      plannedPaceSPerMi: 354,
      readings,
    });
    const text = allText(r);
    // Research/03 §14 · reps under two minutes: ignore HR. Not "average it
    // more carefully" — the recap must not name a heart rate at all.
    expect(text).not.toMatch(/\bHR\b/);
    expect(text).not.toContain('148');
    expect(text).not.toContain('150');
  });
});

describe('recap · the three types that used to say "Logged."', () => {
  it('gives a race-week tune-up its own read, and declines the fitness question', () => {
    const readings = deriveReadingScopes({ phases: TUNEUP_0811, wholeHrBpm: 153 });
    const r = deriveRecap({
      ...base,
      type: 'race_week_tuneup',
      workPaceSPerMi: 400,
      repPaces: [381, 387, 402, 416],
      readings,
    });
    expect(r.verdict).not.toBe('Logged.');
    expect(r.verdict).toBe('Sharpener done.');
    const text = allText(r);
    // Research/08 §9.4 · "Resist the urge to test fitness. The work is done."
    expect(text).toMatch(/not testing fitness/i);
    expect(text).toMatch(/taper/i);
  });

  it('reads a fartlek by its surges, not by an average pace', () => {
    const r = deriveRecap({
      ...base,
      type: 'fartlek',
      repPaces: [360, 365, 358, 370, 380, 385],
    });
    expect(r.verdict).toBe('Fartlek done.');
    expect(allText(r)).toContain('6 surges');
  });

  it('reads a progression by the delta between its ends', () => {
    const r = deriveRecap({
      ...base,
      type: 'progression',
      actualMi: 8,
      splits: [
        { mile: 1, paceSPerMi: 520 }, { mile: 2, paceSPerMi: 515 },
        { mile: 3, paceSPerMi: 505 }, { mile: 4, paceSPerMi: 495 },
        { mile: 5, paceSPerMi: 480 }, { mile: 6, paceSPerMi: 465 },
        { mile: 7, paceSPerMi: 450 }, { mile: 8, paceSPerMi: 440 },
      ],
    });
    expect(r.verdict).toBe('Progression done.');
    expect(allText(r)).toMatch(/Dropped about \d+s\/mi/);
  });

  it('still falls through to "Logged." for a genuinely unknown type', () => {
    const r = deriveRecap({ ...base, type: 'unplanned' });
    expect(r.verdict).toBe('Logged.');
  });
});
