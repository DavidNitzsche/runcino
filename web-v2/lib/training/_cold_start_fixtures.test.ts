/**
 * lib/training/_cold_start_fixtures.test.ts · THE GOLDEN COLD-START RUNNERS.
 *
 * `docs/DOCTRINE_ENFORCEMENT_AND_CLEAN_IMPLEMENTATION.md` §20-21 asks for
 * golden-runner fixtures — new runner, inconsistent training, returning
 * runner, aggressive goal, no/bad data — that gate any change to the capacity
 * architecture. This file is the cold-start half of that set, and it exists
 * because the 2026-09-01 independent audit found the cold-start ladder wrong
 * in two separate ways at once and NOTHING in the suite printed what a real
 * new runner would actually be prescribed.
 *
 * IT PRINTS. Every fixture's resolved threshold and easy paces go to stdout in
 * mm:ss/mi, because "9:23/mi" is a sentence a coach can judge and
 * "paceSecPerMi: 563" is not. The assertions below are about ORDER and
 * DISTINCTNESS — the properties the audit found broken — and the printed table
 * is what makes a wrong-but-well-ordered set visible to a human (Rule 10's
 * "internally perfect is exactly why it survives").
 *
 * ── RULE 22 · WHAT THIS CANNOT FAIL ON ──────────────────────────────────────
 *
 *   · It is PURE. It drives `composeThresholdCapacity` / `composeEasyCeiling`
 *     / `composeHighIntensityCapacity` directly, so it cannot catch a WIRING
 *     defect — a loader that never reads `profile.race_history` would pass
 *     every case here. `_capacity_resolver.test.ts` 3e-* and the shadow
 *     compare's live-account block are what cover that.
 *   · It cannot say whether a prescribed pace is PHYSIOLOGICALLY right for a
 *     runner nobody has watched. Nothing can. It can say the set is ordered,
 *     the cases are distinct, and none of them is the flat VDOT-30 floor by
 *     accident.
 *   · It says nothing about VOLUME. These fixtures price a runner; the volume
 *     curve is the plan generator's and is not exercised here.
 */

import { describe, it, expect } from 'vitest';
import {
  composeThresholdCapacity,
  composeEasyCeiling,
  composeHighIntensityCapacity,
  CAPACITY_CONFIDENCE_BANDS,
  USER_PRIOR_COVERAGE_SATURATION_RUN_DAYS,
  type VdotFallbackRead,
  type ThresholdCapacityEstimate,
} from '@/lib/training/capacity-resolver';
import { readSelfReportedPr } from '@/lib/training/self-reported-pr';
import type { ThresholdPaceRead, EasyPaceRead } from '@/lib/training/pace-corpus';
import type { NormalReading } from '@/lib/training/normal-window';

const TODAY = '2026-09-01';

const NO_DIRECT_THRESHOLD: ThresholdPaceRead = { ok: false, reason: 'no_observations', observations: 0, weightedSupport: 0, excluded: [], windowDays: 60 };
const NO_DIRECT_EASY: EasyPaceRead = { ok: false, reason: 'no_observations', observations: 0 };

function habit(weeklyMi: number): NormalReading<number> {
  return { ok: true, value: weeklyMi, representativeDays: 28, excludedDays: 0 };
}

function fallback(over: Partial<VdotFallbackRead>): VdotFallbackRead {
  return {
    measuredVdot: null,
    measuredVdotEvidenceId: null,
    measuredVdotDate: null,
    measuredVdotSource: null,
    belowTableAnchor: null,
    normalWeeklyMi: habit(0),
    normalRunDays: 0,
    selfReportedWeeklyMi: null,
    selfReportedPr: { ok: false, reason: 'NO_PR_ON_FILE', considered: 0, rejected: [] },
    ...over,
  };
}

function mmss(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return '—';
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}/mi`;
}

interface Fixture {
  name: string;
  fallback: VdotFallbackRead;
  /** What a coach should be able to say about this runner in one line. */
  expect: string;
}

const PR_RECENT_HALF = readSelfReportedPr([{ distance: 'half', timeSec: 5400, whenRaced: '<6mo' }]);
const PR_ABSURD = readSelfReportedPr([{ distance: 'marathon', timeSec: 2400, whenRaced: '<6mo' }]);
const PR_OLD_HALF = readSelfReportedPr([{ distance: 'half', timeSec: 5400, whenRaced: '2+yr' }]);

const FIXTURES: Fixture[] = [
  {
    name: 'zero-run · nothing answered',
    fallback: fallback({}),
    expect: 'the population prior, and it says so',
  },
  {
    name: 'zero-run · answered "I do not run yet" (0 mi/wk)',
    fallback: fallback({ selfReportedWeeklyMi: 0 }),
    expect: 'same number as unanswered, different reported fact',
  },
  {
    name: 'no-PR · 20 mi/wk self-report, nothing logged',
    fallback: fallback({ selfReportedWeeklyMi: 20 }),
    expect: 'priced off the self-report, user_prior, low confidence',
  },
  {
    name: 'invalid-PR · 20 mi/wk self-report + a 40-minute marathon typed',
    fallback: fallback({ selfReportedWeeklyMi: 20, selfReportedPr: PR_ABSURD }),
    expect: 'the PR is rejected with a reason and prices nothing',
  },
  {
    name: 'typed-PR · 20 mi/wk self-report + a recent 1:30 half',
    fallback: fallback({ selfReportedWeeklyMi: 20, selfReportedPr: PR_RECENT_HALF }),
    expect: 'faster than the no-PR twin, slower than the PR itself',
  },
  {
    name: 'typed-PR (stale) · same 1:30 half, raced 2+ years ago',
    fallback: fallback({ selfReportedWeeklyMi: 20, selfReportedPr: PR_OLD_HALF }),
    expect: 'still heard, much fainter than the recent one',
  },
  {
    name: 'sparse-history · 1 logged run, 40 mi/wk self-report',
    fallback: fallback({
      normalWeeklyMi: habit(0.8), normalRunDays: 1, selfReportedWeeklyMi: 40,
    }),
    expect: 'barely moved off the zero-run answer — NOT the population floor',
  },
  {
    name: 'sparse-history · 4 logged runs, 40 mi/wk self-report',
    fallback: fallback({
      normalWeeklyMi: habit(12), normalRunDays: 4, selfReportedWeeklyMi: 40,
    }),
    expect: 'a quarter of the way from the self-report to the real number',
  },
  {
    name: 'full month logged · 22 mi/wk real, 40 mi/wk self-report',
    fallback: fallback({
      normalWeeklyMi: habit(22),
      normalRunDays: USER_PRIOR_COVERAGE_SATURATION_RUN_DAYS,
      selfReportedWeeklyMi: 40,
    }),
    expect: 'the self-report is gone; evidence has fully taken over',
  },
  {
    name: 'returning runner · a real measured VDOT, but ten months old',
    fallback: fallback({
      measuredVdot: 47, measuredVdotEvidenceId: 'old-half',
      measuredVdotDate: '2025-11-01', measuredVdotSource: 'race',
      selfReportedWeeklyMi: 20, selfReportedPr: PR_RECENT_HALF,
    }),
    expect: 'value held, confidence decayed; the typed PR never enters',
  },
];

function resolve(f: VdotFallbackRead): {
  threshold: ThresholdCapacityEstimate;
  easyCeilingSecPerMi: number;
  intervalSecPerMi: number;
} {
  const threshold = composeThresholdCapacity({ direct: NO_DIRECT_THRESHOLD, fallback: f, todayISO: TODAY });
  const easy = composeEasyCeiling({ direct: NO_DIRECT_EASY, threshold, todayISO: TODAY });
  const hi = composeHighIntensityCapacity({ fallback: f, todayISO: TODAY });
  return {
    threshold,
    easyCeilingSecPerMi: easy.ceilingSecPerMi,
    intervalSecPerMi: hi.intervalPaceSecPerMi,
  };
}

describe('COLD START · the golden new-runner fixtures', () => {
  const resolved = FIXTURES.map((f) => ({ f, r: resolve(f.fallback) }));

  it('prints the prescribed paces for every cold-start fixture', () => {
    const rows = resolved.map(({ f, r }) => ({
      fixture: f.name,
      threshold: mmss(r.threshold.paceSecPerMi),
      easyCeiling: mmss(r.easyCeilingSecPerMi),
      interval: mmss(r.intervalSecPerMi),
      mode: r.threshold.sourceMode,
      conf: r.threshold.confidence.toFixed(2),
      reasons: r.threshold.reasons.join(','),
    }));
    // eslint-disable-next-line no-console
    console.log('\n=== COLD-START FIXTURE TABLE ===');
    // eslint-disable-next-line no-console
    console.table(rows);
    expect(rows.length).toBe(FIXTURES.length);
  });

  it('every fixture resolves an ORDERED set — easy never faster than threshold, interval never slower', () => {
    for (const { f, r } of resolved) {
      expect({ name: f.name, ok: r.easyCeilingSecPerMi > r.threshold.paceSecPerMi })
        .toEqual({ name: f.name, ok: true });
      expect({ name: f.name, ok: r.intervalSecPerMi < r.threshold.paceSecPerMi })
        .toEqual({ name: f.name, ok: true });
    }
  });

  it('no fixture is silently the flat VDOT-30 floor except the two that should be', () => {
    const floor = resolved[0].r.threshold.paceSecPerMi; // zero-run, nothing answered
    const atFloor = resolved.filter(({ r }) => r.threshold.paceSecPerMi === floor).map(({ f }) => f.name);
    // Only the two genuinely-no-information cases. This is the audit's own
    // headline defect ("every runner's FIRST plan would be paced at the
    // near-beginner VDOT-30 floor") expressed as an assertion.
    expect(atFloor).toEqual([
      'zero-run · nothing answered',
      'zero-run · answered "I do not run yet" (0 mi/wk)',
    ]);
  });

  it('the cases are DISTINCT — a typed PR, a rejected PR and no PR are three different answers', () => {
    const by = (name: string) => resolved.find(({ f }) => f.name === name)!.r;
    const noPr = by('no-PR · 20 mi/wk self-report, nothing logged');
    const bad = by('invalid-PR · 20 mi/wk self-report + a 40-minute marathon typed');
    const good = by('typed-PR · 20 mi/wk self-report + a recent 1:30 half');
    const stale = by('typed-PR (stale) · same 1:30 half, raced 2+ years ago');

    // A rejected PR prices exactly like no PR, and says why.
    expect(bad.threshold.paceSecPerMi).toBe(noPr.threshold.paceSecPerMi);
    expect(bad.threshold.reasons).toContain('ONBOARDING_PR_REJECTED');
    expect(noPr.threshold.reasons).not.toContain('ONBOARDING_PR_REJECTED');

    // A valid PR is faster than no PR; a stale one sits between them.
    expect(good.threshold.paceSecPerMi).toBeLessThan(stale.threshold.paceSecPerMi);
    expect(stale.threshold.paceSecPerMi).toBeLessThan(noPr.threshold.paceSecPerMi);
  });

  it('sparse history is never WORSE than no history (the audit\'s Rule 9 signature)', () => {
    const by = (name: string) => resolved.find(({ f }) => f.name === name)!.r;
    const zero = by('zero-run · nothing answered');
    const one = by('sparse-history · 1 logged run, 40 mi/wk self-report');
    const four = by('sparse-history · 4 logged runs, 40 mi/wk self-report');
    // The runner who has logged something must never be priced as if they
    // knew LESS about themselves than the runner who has logged nothing and
    // said nothing. Under the `real > 0` switch this is exactly backwards.
    expect(one.threshold.paceSecPerMi).toBeLessThan(zero.threshold.paceSecPerMi);
    expect(four.threshold.paceSecPerMi).toBeLessThan(zero.threshold.paceSecPerMi);
    // And more logged running moves monotonically toward the real number.
    expect(four.threshold.paceSecPerMi).toBeGreaterThan(one.threshold.paceSecPerMi);
  });

  it('a stated goal cannot reach any fixture — there is no goal-shaped input to swap', () => {
    // The "extreme goal swap" case, as a structural assertion: swapping a
    // 2:30 marathon goal for a 5:00 one cannot change a number because
    // neither can be expressed in the inputs at all.
    for (const f of FIXTURES) {
      expect(Object.keys(f.fallback).filter((k) => /goal/i.test(k))).toEqual([]);
    }
  });

  it('every prior-priced fixture carries user_prior or population_prior confidence, never more', () => {
    for (const { f, r } of resolved) {
      if (r.threshold.sourceMode === 'user_prior') {
        expect({ name: f.name, c: r.threshold.confidence })
          .toEqual({ name: f.name, c: CAPACITY_CONFIDENCE_BANDS.userPrior });
      }
      if (r.threshold.sourceMode === 'population_prior') {
        expect({ name: f.name, c: r.threshold.confidence })
          .toEqual({ name: f.name, c: CAPACITY_CONFIDENCE_BANDS.populationPrior });
      }
      // Nothing here is ever direct or inferred — no observation exists.
      expect(r.threshold.sourceMode).not.toBe('direct');
      expect(r.threshold.sourceMode).not.toBe('inferred');
    }
  });
});
