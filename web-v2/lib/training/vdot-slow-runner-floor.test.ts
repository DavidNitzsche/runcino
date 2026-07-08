/**
 * lib/training/vdot-slow-runner-floor.test.ts · AUDIT P1-56 / P1-13
 * (2026-07-07) — slow-runner support.
 *
 * Doctrine boundary under test: Research/01-pace-zones-vdot.md's Daniels
 * table is cited/validated across VDOT [30,85] only ("Range: ~30 (beginner)
 * to 85+"). Below 30 is off the cited table — the engine must NOT
 * extrapolate the raw Daniels %VO2max equation past that boundary (that
 * would be exactly the "extrapolate beyond research" violation CLAUDE.md
 * forbids). VDOT itself therefore correctly stays null below 30; that part
 * of vdotFromRace/vdotFromRun is NOT a bug and this file does not touch it.
 *
 * What WAS a bug (P1-56/P1-13): a null VDOT got treated as "no fitness data
 * exists" throughout the app, when the runner plainly has a demonstrated
 * pace — it just doesn't map onto the VDOT scale. This file locks the fix:
 * the anchor-pace machinery that represents that pace honestly and derives
 * training paces from it via Research/01's own pace-relative-to-race-pace
 * offset table (§"Pace conversion from a race time"), which is
 * distance-tier-based, not VDOT-based, so it is valid at any pace.
 *
 * Reference persona used throughout: a 13:30/mi 5K runner (41:57 5K —
 * "12+ min/mi runners" named explicitly in the audit's universality lens).
 * Raw VDOT for this effort is ~20.4 — genuinely off-table, not a rounding
 * edge case near 30.
 */
import { describe, it, expect } from 'vitest';
import {
  vdotFromRace, anchorPaceFrom, tPaceFromAnchorPace, easyPaceBandFromAnchorPace,
  predictRaceTimeFromAnchor, bestRecentVdot, resolveCurrentTPace, clampToSanePace,
  tPaceFromVdot, type BelowTableAnchor,
} from './vdot';
import { conservativeVdotFromMileage } from '@/lib/plan/spec-builder';

// ─── Reference persona: 13:30/mi 5K (41:57), raw VDOT ≈ 20.4 ───────────────
const FIVE_K_MI = 3.10686;
const SLOW_PACE_S_PER_MI = 13 * 60 + 30; // 810
const SLOW_5K_FINISH_S = Math.round(SLOW_PACE_S_PER_MI * FIVE_K_MI); // 2517 (41:57)

describe('P1-56 · vdotFromRace correctly stays null below the cited table floor', () => {
  it('the 13:30/mi 5K (raw VDOT ~20.4) returns null — doctrine-correct, not a bug', () => {
    expect(vdotFromRace(SLOW_5K_FINISH_S, FIVE_K_MI)).toBeNull();
  });
  it('VDOT exactly at the table floor (30:40 5K) still resolves to 30', () => {
    expect(vdotFromRace(30 * 60 + 40, FIVE_K_MI)).toBe(30);
  });
});

describe('P1-56 · anchorPaceFrom — honest pace representation', () => {
  it('builds a valid AnchorPace from the slow 5K', () => {
    const a = anchorPaceFrom(SLOW_5K_FINISH_S, FIVE_K_MI);
    expect(a).not.toBeNull();
    expect(a!.finishSeconds).toBe(SLOW_5K_FINISH_S);
    expect(a!.distanceMi).toBeCloseTo(FIVE_K_MI, 4);
    expect(a!.paceSPerMi).toBeCloseTo(SLOW_PACE_S_PER_MI, 0);
  });
  it('rejects bad input (null-safe)', () => {
    expect(anchorPaceFrom(null, FIVE_K_MI)).toBeNull();
    expect(anchorPaceFrom(SLOW_5K_FINISH_S, null)).toBeNull();
    expect(anchorPaceFrom(0, FIVE_K_MI)).toBeNull();
    expect(anchorPaceFrom(30, FIVE_K_MI)).toBeNull(); // < 60s guard
  });
});

describe('P1-56 · tPaceFromAnchorPace — training paces derived from the anchor, not VDOT', () => {
  const anchor = anchorPaceFrom(SLOW_5K_FINISH_S, FIVE_K_MI)!;

  it('5K-tier anchor uses the +15 s/mi offset (Research/01 pace-conversion table)', () => {
    const t = tPaceFromAnchorPace(anchor);
    expect(t).not.toBeNull();
    expect(t!).toBe(Math.round(SLOW_PACE_S_PER_MI + 15));
  });

  it('T-pace is SLOWER (higher s/mi) than the anchor race pace — never faster than demonstrated fitness', () => {
    const t = tPaceFromAnchorPace(anchor)!;
    expect(t).toBeGreaterThan(anchor.paceSPerMi);
  });

  it('distance tiers match spec-builder.tPaceFromGoal exactly (same offsets, different anchor)', () => {
    // marathon anchor: pace - 18
    const mAnchor = anchorPaceFrom(6 * 3600 + 30 * 60, 26.2188)!; // 6:30 marathon
    expect(tPaceFromAnchorPace(mAnchor)).toBe(Math.round(mAnchor.paceSPerMi - 18));
    // half anchor: pace - 5
    const hAnchor = anchorPaceFrom(3 * 3600, 13.1094)!; // 3:00 half
    expect(tPaceFromAnchorPace(hAnchor)).toBe(Math.round(hAnchor.paceSPerMi - 5));
    // 10K anchor: pace + 8
    const tenKAnchor = anchorPaceFrom(70 * 60, 6.21371)!; // 1:10:00 10K
    expect(tPaceFromAnchorPace(tenKAnchor)).toBe(Math.round(tenKAnchor.paceSPerMi + 8));
  });

  it('ultra-distance anchor (>=31mi) returns null — T-pace is not ultra-adjacent (PACE-5 doctrine)', () => {
    const ultraAnchor = anchorPaceFrom(8 * 3600, 31.0686)!; // 8:00 50K
    expect(tPaceFromAnchorPace(ultraAnchor)).toBeNull();
  });

  it('null-safe on missing anchor', () => {
    expect(tPaceFromAnchorPace(null)).toBeNull();
    expect(tPaceFromAnchorPace(undefined)).toBeNull();
  });
});

describe('P1-56 · easyPaceBandFromAnchorPace — matches spec-builder PACE-E-1 constants', () => {
  it('easy band is T+80..T+120, ordered correctly, and slower than the anchor pace', () => {
    const anchor = anchorPaceFrom(SLOW_5K_FINISH_S, FIVE_K_MI)!;
    const band = easyPaceBandFromAnchorPace(anchor)!;
    const t = tPaceFromAnchorPace(anchor)!;
    expect(band.lo).toBe(t + 80);
    expect(band.hi).toBe(t + 120);
    expect(band.lo).toBeLessThan(band.hi);
    expect(band.lo).toBeGreaterThan(anchor.paceSPerMi); // easy slower than race pace
  });
});

describe('P1-56 · predictRaceTimeFromAnchor — Riegel cross-distance prediction (Research/02 §2)', () => {
  const anchor = anchorPaceFrom(SLOW_5K_FINISH_S, FIVE_K_MI)!;

  it('predicts a slower (larger) 10K time than the 5K anchor, scaled by the Riegel exponent', () => {
    const tenK = predictRaceTimeFromAnchor(anchor, 6.21371);
    expect(tenK).not.toBeNull();
    // T2 = T1 * (D2/D1)^1.06 — sanity: strictly more than double (b>1 means
    // pace slows with distance, so 2x distance takes MORE than 2x time).
    expect(tenK!).toBeGreaterThan(anchor.finishSeconds * 2);
    expect(tenK!).toBeLessThan(anchor.finishSeconds * 2.2);
  });

  it('round-trips to the same time at the anchor distance itself', () => {
    const same = predictRaceTimeFromAnchor(anchor, FIVE_K_MI);
    expect(same).toBe(anchor.finishSeconds);
  });

  it('returns null outside Riegel\'s own cited validity window (Research/02 §2.4: 1500m-marathon)', () => {
    expect(predictRaceTimeFromAnchor(anchor, 50)).toBeNull(); // 50mi ultra, way past marathon
    const ultraAnchor = anchorPaceFrom(8 * 3600, 50)!;
    expect(predictRaceTimeFromAnchor(ultraAnchor, FIVE_K_MI)).toBeNull(); // ultra anchor itself out of window
  });

  it('null-safe on missing anchor / bad target', () => {
    expect(predictRaceTimeFromAnchor(null, FIVE_K_MI)).toBeNull();
    expect(predictRaceTimeFromAnchor(anchor, 0)).toBeNull();
    expect(predictRaceTimeFromAnchor(anchor, -5)).toBeNull();
  });
});

describe('P1-56 · bestRecentVdot — belowTableAnchor is honest and additive', () => {
  const TODAY = '2026-07-07';
  const SLOW_RACE = {
    slug: 'slow-5k', name: 'Local 5K', date: '2026-06-01', priority: 'A' as const,
    distance_mi: FIVE_K_MI, finish_seconds: SLOW_5K_FINISH_S,
  };
  const FAST_RACE = {
    slug: 'fast-5k', name: 'Faster 5K', date: '2026-05-01', priority: 'A' as const,
    distance_mi: FIVE_K_MI, finish_seconds: 21 * 60 + 25, // VDOT 46
  };

  it('a runner with ONLY a below-table race gets best=null but belowTableAnchor populated', () => {
    const r = bestRecentVdot([SLOW_RACE], TODAY, 180);
    expect(r.best).toBeNull();
    expect(r.considered).toEqual([]);
    expect(r.belowTableAnchor).not.toBeNull();
    expect(r.belowTableAnchor!.source).toBe('race');
    expect(r.belowTableAnchor!.refId).toBe('slow-5k');
    expect(r.belowTableAnchor!.finish_seconds).toBe(SLOW_5K_FINISH_S);
    expect(r.belowTableAnchor!.anchor.paceSPerMi).toBeCloseTo(SLOW_PACE_S_PER_MI, 0);
  });

  it('a runner with a REAL in-table race never falls back to belowTableAnchor, even if an old slow race exists', () => {
    const r = bestRecentVdot([FAST_RACE, SLOW_RACE], TODAY, 180);
    expect(r.best).not.toBeNull();
    expect(r.best!.vdot).toBeGreaterThan(30);
    expect(r.belowTableAnchor).toBeNull(); // real candidate wins outright — no anchor fallback needed
  });

  it('C-priority slow race is excluded from belowTableAnchor too (same eligibility as the main path)', () => {
    const r = bestRecentVdot(
      [{ ...SLOW_RACE, priority: 'C' as const }], TODAY, 180,
    );
    expect(r.belowTableAnchor).toBeNull();
  });

  it('below-table RUN candidate requires the same honesty gate as vdotFromRun (quality type or hard HR)', () => {
    const easyRun = {
      id: 'easy-1', date: '2026-06-20', workout_type: 'easy', distance_mi: 4.0,
      finish_seconds: Math.round(SLOW_PACE_S_PER_MI * 4.0), avg_hr: 110, max_hr: 180,
    };
    const r1 = bestRecentVdot([], TODAY, 180, [easyRun], 3);
    expect(r1.belowTableAnchor).toBeNull(); // easy effort, no HR gate pass — correctly excluded

    const hardRun = {
      id: 'hard-1', date: '2026-06-20', workout_type: 'tempo', distance_mi: 4.0,
      finish_seconds: Math.round(SLOW_PACE_S_PER_MI * 4.0), avg_hr: 160, max_hr: 180,
    };
    const r2 = bestRecentVdot([], TODAY, 180, [hardRun], 3);
    expect(r2.belowTableAnchor).not.toBeNull(); // quality-typed effort — correctly included
    expect(r2.belowTableAnchor!.source).toBe('run');
  });

  it('a runner with NO races/runs at all gets null for both best and belowTableAnchor (genuinely no data)', () => {
    const r = bestRecentVdot([], TODAY, 180);
    expect(r.best).toBeNull();
    expect(r.belowTableAnchor).toBeNull();
  });
});

describe('P1-56 · resolveCurrentTPace — the 3-tier cascade, tier 2 is the fix', () => {
  const belowTable: BelowTableAnchor = {
    source: 'race', refId: 'slow-5k', name: 'Local 5K', date: '2026-06-01',
    distance_mi: FIVE_K_MI, finish_seconds: SLOW_5K_FINISH_S, age_days: 30,
    anchor: anchorPaceFrom(SLOW_5K_FINISH_S, FIVE_K_MI)!,
  };

  it('tier 1 · measured VDOT always wins when present (byte-identical to the old tPaceFromVdot call)', () => {
    const r = resolveCurrentTPace(48, belowTable, 25, conservativeVdotFromMileage);
    expect(r.tier).toBe('measured_vdot');
    expect(r.tPaceSec).toBe(tPaceFromVdot(48));
  });

  it('tier 2 · below-table anchor wins over the mileage estimate when no measured VDOT exists', () => {
    const r = resolveCurrentTPace(null, belowTable, 25, conservativeVdotFromMileage);
    expect(r.tier).toBe('below_table_anchor');
    expect(r.tPaceSec).toBe(tPaceFromAnchorPace(belowTable.anchor));
    expect(r.anchorPaceSPerMi).toBeCloseTo(SLOW_PACE_S_PER_MI, 0);
  });

  it('THE CORE P1-56 ASSERTION: tier 2 T-pace is dramatically slower than the mileage-only floor (never faster than the runner\'s own race pace)', () => {
    const r = resolveCurrentTPace(null, belowTable, 25, conservativeVdotFromMileage);
    const mileageFloorT = tPaceFromVdot(conservativeVdotFromMileage(25)); // VDOT 38 -> fast T-pace
    expect(r.tPaceSec).not.toBeNull();
    expect(mileageFloorT).not.toBeNull();
    // The old bug: mileage-only floor (VDOT >= 30) produces a T-pace FASTER
    // than this runner's actual demonstrated 5K race pace. The fix must not.
    expect(r.tPaceSec!).toBeGreaterThan(mileageFloorT!);
    // Concretely: the anchor-derived T-pace stays slower than the runner's
    // own race pace; the mileage floor's does not.
    expect(r.tPaceSec!).toBeGreaterThan(SLOW_PACE_S_PER_MI);
    expect(mileageFloorT!).toBeLessThan(SLOW_PACE_S_PER_MI); // the bug, demonstrated
  });

  it('tier 3 · falls to the mileage estimate when neither measured VDOT nor a below-table anchor exists (byte-identical to the old fallback)', () => {
    const r = resolveCurrentTPace(null, null, 25, conservativeVdotFromMileage);
    expect(r.tier).toBe('mileage_estimate');
    expect(r.tPaceSec).toBe(tPaceFromVdot(conservativeVdotFromMileage(25)));
  });

  it('tier 2 falls through to tier 3 for an ultra anchor (tPaceFromAnchorPace returns null there)', () => {
    const ultraAnchor: BelowTableAnchor = {
      ...belowTable, distance_mi: 31.0686, finish_seconds: 8 * 3600,
      anchor: anchorPaceFrom(8 * 3600, 31.0686)!,
    };
    const r = resolveCurrentTPace(null, ultraAnchor, 25, conservativeVdotFromMileage);
    expect(r.tier).toBe('mileage_estimate');
  });
});

describe('P1-56 falsifiable requirement #3 · clampToSanePace — sanity backstop', () => {
  it('a too-fast prescribed pace is clamped up (slower) to the demonstrated anchor pace', () => {
    const prescribedFast = 600; // 10:00/mi — faster than the runner's 13:30/mi anchor
    const clamped = clampToSanePace(prescribedFast, SLOW_PACE_S_PER_MI);
    expect(clamped).toBe(SLOW_PACE_S_PER_MI); // clamped SLOWER (larger s/mi)
  });
  it('an already-honest (slower-or-equal) prescribed pace passes through unchanged', () => {
    const prescribedSlow = 900; // 15:00/mi — already slower than the anchor
    expect(clampToSanePace(prescribedSlow, SLOW_PACE_S_PER_MI)).toBe(prescribedSlow);
  });
  it('is a no-op when no anchor is known', () => {
    expect(clampToSanePace(600, null)).toBe(600);
    expect(clampToSanePace(600, undefined)).toBe(600);
  });
  it('null-safe on a null prescribed pace', () => {
    expect(clampToSanePace(null, SLOW_PACE_S_PER_MI)).toBeNull();
  });
});
