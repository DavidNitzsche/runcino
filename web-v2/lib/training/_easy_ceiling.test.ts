/**
 * EASYCEIL-1 · easy running is prescribed as a CEILING, and the ceiling reads
 * as one.
 *
 * TWO DEFECTS, ONE SHAPE. `docs/PRODUCT_DECISIONS.md` 2026-08-31 settled that
 * easy pace is "a single ceiling … not a `{lo, hi}` band to hit", and named
 * the failure it was correcting: a narrow band "implies a target to land
 * inside". The card did something the decision does not even list — it
 * printed the band's MIDPOINT as a bare number.
 *
 *   1 · 164 future easy/long/recovery rows across every non-archived plan
 *       rendered a point (read-only sweep, 2026-09-01). The owner's 15-mile
 *       long run printed `8:40 /mi` off an authored 502-537 band.
 *   2 · `fmtPaceCeiling` printed `≤ 8:22 /mi`. Pace is SECONDS PER MILE, so
 *       "do not run faster than 8:22" is `pace ≥ 8:22`. The card printed the
 *       inequality backwards — read literally it licenses the exact thing the
 *       ceiling exists to prevent.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ─────────────────────────────────────
 *
 *   · Whether the ceiling VALUE is the right pace. It checks the shape and
 *     the edge the band already carries; `resolveEasyCeiling` owns the number.
 *   · Race day. `Research/01`'s "lock to a single pace" row governs there and
 *     the race branch is the race owner's (Constitution §J) — a race rendered
 *     as a point reads clean here, deliberately.
 *   · The WATCH's rendering. The wrist draws its own band from target ±
 *     tolerance; `PaceDrift.swift` already refuses to grade a `.ceiling`
 *     phase on the slow side, which is the behaviour half of the same rule.
 *   · Copy anywhere but this formatter. A second surface that writes its own
 *     ceiling string is invisible to this file.
 */
import { describe, it, expect } from 'vitest';
import { cardFromSpec, fmtPaceCeiling } from './spec-card';
import type { WorkoutSpec } from '@/lib/plan/spec-builder';

/** The owner's real rows, 2026-09-01, plan `pln_9a57561debb776e5`. */
const LONG = { kind: 'long', pace_target_s_per_mi_lo: 502, pace_target_s_per_mi_hi: 537,
  hr_cap_bpm: 151, fuel_mi: [5, 9, 13] } as unknown as WorkoutSpec;
const EASY = { kind: 'easy', pace_target_s_per_mi_lo: 502, pace_target_s_per_mi_hi: 542,
  hr_cap_bpm: 151, fuel_mi: [] } as unknown as WorkoutSpec;
const RECOVERY = { kind: 'recovery', pace_target_s_per_mi_lo: 602,
  pace_target_s_per_mi_hi: 632, hr_cap_bpm: 151 } as unknown as WorkoutSpec;
const LONG_FINISH = { ...(LONG as object), finish_mi: 4, finish_pace_s_per_mi: 475,
  finish_label: 'M' } as unknown as WorkoutSpec;

const workStep = (spec: WorkoutSpec, type: 'easy' | 'long' | 'recovery', mi: number) =>
  cardFromSpec({ spec, type, distanceMi: mi, easyPaceSec: 522, easyCeilingSec: 502, hr: null })!
    .steps.find((s) => s.label !== 'Warmup' && s.label !== 'Cooldown')!;

describe('EASYCEIL-1 · easy running states a limit, not a number to hold', () => {
  it('the ceiling says which direction it bounds, in words', () => {
    // Not `≤`, which on a clock reads as the opposite instruction. The
    // decision's own phrasing is "no faster than 8:10/mi".
    expect(fmtPaceCeiling(502)).toBe('no faster than 8:22 /mi');
    expect(fmtPaceCeiling(null)).toBeNull();
    expect(fmtPaceCeiling(502)).not.toContain('≤');
  });

  it('a long run states the band s FAST EDGE, never its midpoint', () => {
    // 502-537 reaches the card as 520 ± 18. The runner used to read 8:40 —
    // the midpoint, a number nothing ever asked him to hold.
    const step = workStep(LONG, 'long', 15);
    expect(step.pace_target).toBe('no faster than 8:22 /mi');
    expect(step.pace_target).not.toContain('8:40');
  });

  it('easy and recovery days read the same way', () => {
    expect(workStep(EASY, 'easy', 6).pace_target).toBe('no faster than 8:22 /mi');
    expect(workStep(RECOVERY, 'recovery', 4).pace_target).toBe('no faster than 10:02 /mi');
  });

  it('a marathon-pace FINISH keeps a target · it is not easy running', () => {
    // The one place inside a long run where a number IS the instruction:
    // "Find race rhythm and hold it home". A ceiling here would coach the
    // opposite of the segment the session exists for.
    const card = cardFromSpec({ spec: LONG_FINISH, type: 'long', distanceMi: 16,
      easyPaceSec: 522, easyCeilingSec: 502, hr: null })!;
    const finish = card.steps.find((s) => /marathon pace/i.test(s.label))!;
    expect(finish.pace_target).toBe('7:55 /mi');
    expect(finish.pace_target).not.toContain('no faster than');
    // …and the easy bulk above it is still a ceiling, on the same card.
    const bulk = card.steps.find((s) => /mi easy$/.test(s.label))!;
    expect(bulk.pace_target).toBe('no faster than 8:22 /mi');
  });

  it('a stride keeps its target · Research/04 §7.2 prescribes a pace to reach', () => {
    const spec = { kind: 'easy', pace_target_s_per_mi_lo: 502, pace_target_s_per_mi_hi: 542,
      strides_reps: 4, strides_duration_s: 20, strides_pace_s_per_mi: 407,
      strides_recovery_s: 60 } as unknown as WorkoutSpec;
    const card = cardFromSpec({ spec, type: 'easy', distanceMi: 6, easyPaceSec: 522,
      easyCeilingSec: 502, hr: null })!;
    const strides = card.steps.find((s) => s.label === 'Strides')!;
    expect(strides.pace_target).toBe('6:47 /mi');
    expect(strides.pace_target).not.toContain('no faster than');
  });
});
