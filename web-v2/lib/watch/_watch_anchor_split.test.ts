/**
 * lib/watch/_watch_anchor_split.test.ts · the two numbers a runner runs under.
 *
 * ANCHOR-SPLIT-1 · the easy/long HR ceiling on the running face was derived
 * live from `profile.lthr` while the recap row on the SAME payload read the
 * authored `workout_spec.hr_cap_bpm`. One payload, two answers, one name.
 *
 * BAND-WIDEN-1 · `expandLong`/`expandEasy`/`expandRecovery` each computed
 * `Math.max(perClassTolerance, authoredHalfWidth)`, so the watch drew a band
 * WIDER than the plan authored whenever the authored one was tighter.
 *
 * Both are asserted against the owner's real production rows rather than
 * invented ones, and both are stated as what the runner reads rather than as
 * the absence of the defect (Rule 13 §3). Falsified against the unfixed code
 * before landing — see the commit message for what each one said when it failed.
 */
import { describe, it, expect } from 'vitest';
import { resolveHrCeiling } from './build-workout';
import { expandSpecToPhases } from '@/lib/training/expand-spec';

// The owner's real spec rows on plan pln_0e635603799fd7b1.
const REAL_LONG = {
  kind: 'long', fuel_mi: [5, 9], hr_cap_bpm: 145,
  pace_target_s_per_mi_lo: 517, pace_target_s_per_mi_hi: 552,
} as never;
const REAL_EASY = {
  kind: 'easy', hr_cap_bpm: 145,
  pace_target_s_per_mi_lo: 542, pace_target_s_per_mi_hi: 582,
} as never;
/** 2026-08-24 · a replanned day. `replan-scenarios.ts` wrote a null cap. */
const REPLANNED_EASY = { kind: 'easy', fuel_mi: [], hr_cap_bpm: null } as never;

describe('ANCHOR-SPLIT-1 · the ceiling is the one the plan prescribed', () => {
  it('carries the authored cap even after the anchor moves under it', () => {
    // The re-anchor cron moves profile.lthr 162 -> 168. aerobicCeilingBpm then
    // returns 151, but the plan still prescribes 145 and the recap still grades
    // against 145. The wrist must not be the one surface reading 151.
    for (const lthr of [162, 168]) {
      const c = resolveHrCeiling({
        sessionClass: 'long', longHasFinish: false, specCeilingBpm: 145, lthr, maxHr: 179,
      });
      expect(c.bpm, `lthr ${lthr}`).toBe(145);
      expect(c.source).toBe('prescribed');
    }
  });

  it('names a ceiling it worked out itself as derived, never as prescribed', () => {
    // Rule 11 · absent and 145 are different facts. The number still ships,
    // because a replanned easy day with no aerobic guidance is worse — but it
    // ships labelled, so nothing downstream can grade against it as an ask.
    const c = resolveHrCeiling({
      sessionClass: 'easy', longHasFinish: false, specCeilingBpm: null, lthr: 162, maxHr: 179,
    });
    expect(c.bpm).toBe(145);
    expect(c.source).toBe('derived');
  });

  it('offers no ceiling, and no source, where one would coach the opposite', () => {
    // A long run with an HM/M finish is run at race pace through the finish;
    // a workout-level cap would red-alert across it (Audit D / D1).
    const finish = resolveHrCeiling({
      sessionClass: 'long', longHasFinish: true, specCeilingBpm: 145, lthr: 162, maxHr: 179,
    });
    expect(finish.bpm).toBeNull();
    expect(finish.source).toBeNull();

    // And a threshold session has no aerobic ceiling at all — its HR guidance
    // is the work-phase target, not a cap.
    const quality = resolveHrCeiling({
      sessionClass: 'threshold', longHasFinish: false, specCeilingBpm: 145, lthr: 162, maxHr: 179,
    });
    expect(quality.bpm).toBeNull();
    expect(quality.source).toBeNull();
  });

  it('reports no ceiling rather than a guess when it has no anchor either', () => {
    const c = resolveHrCeiling({
      sessionClass: 'easy', longHasFinish: false, specCeilingBpm: null, lthr: null, maxHr: null,
    });
    expect(c.bpm).toBeNull();
    expect(c.source).toBeNull();
  });
});

describe('BAND-WIDEN-1 · the watch draws the band the plan authored', () => {
  /** What the wrist actually shows: target ± tolerance, in seconds/mile. */
  function drawnBand(spec: never, totalMi: number, toleranceSec: number) {
    const phases = expandSpecToPhases({ spec, totalMi, easyPaceSec: 562, toleranceSec });
    const work = phases!.find((p) => p.type === 'work')!;
    const t = work.targetPaceSPerMi!;
    const tol = work.tolerancePaceSPerMi!;
    return { lo: t - tol, hi: t + tol };
  }

  it('does not widen a long-run band past what was authored', () => {
    // Authored 517-552. The old MAX(20, 18) drew 515-555 — three seconds per
    // mile of pace the plan never sanctioned, called "on target" on the wrist.
    const { lo, hi } = drawnBand(REAL_LONG, 13, 20);
    expect(lo).toBe(517);
    // The wire carries a SYMMETRIC tolerance and 517-552 has a half-width of
    // 17.5, so the band cannot be exact. It errs wide by one second rather than
    // tight, because calling 8:37/mi off-target on a day the plan allows it is
    // the worse error. See bandToleranceSec.
    expect(hi).toBeLessThanOrEqual(553);
    expect(hi).toBeGreaterThanOrEqual(552);
  });

  it('draws the easy band unchanged — the case that used to pass by luck', () => {
    // Authored 542-582, half-width exactly 20, which is also the easy default.
    // MAX returned the same number either way, which is why this never showed
    // the bug. It must still be right now that the MAX is gone.
    expect(drawnBand(REAL_EASY, 7, 20)).toEqual({ lo: 542, hi: 582 });
  });

  it('is independent of the caller per-class tolerance whenever a band exists', () => {
    // The authored band IS the band. A caller passing a different per-class
    // default must not move it — that coupling was the whole defect, and this
    // is what makes the easy-day agreement above a fact rather than a
    // coincidence that happens to hold at tolerance 20.
    for (const tol of [8, 12, 20, 45]) {
      expect(drawnBand(REAL_EASY, 7, tol), `tolerance ${tol}`).toEqual({ lo: 542, hi: 582 });
      expect(drawnBand(REAL_LONG, 13, tol).lo, `tolerance ${tol}`).toBe(517);
    }
  });

  it('still bands a replanned day off the easy anchor when the spec has none', () => {
    // No authored band → the easy anchor ±(30, 60) stands, unchanged. The fix
    // must not strip guidance from the spec-less case.
    const { lo, hi } = drawnBand(REPLANNED_EASY, 7, 20);
    expect(lo).toBe(532);
    expect(hi).toBe(622);
  });
});
