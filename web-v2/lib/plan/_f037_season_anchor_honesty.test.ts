/**
 * F037 (2026-09-14) · `pace_blend.season_anchor_vdot` MUST NOT OUTLIVE ITS
 * OWN LABEL.
 *
 * Register F032 (doctrine-resolved) / F037 (this fix), plus the coach
 * consultant's ruling in `for coaching consult/consult-log/2026-09-14-006-
 * progression-mechanism-reconciliation.md` (Q2): a persisted
 * `pace_blend.season_anchor_vdot` traced back to `users.vdot_last_reviewed`,
 * unreviewed since 2026-05-19 (4+ months stale), while `season_anchor_source`
 * claimed `'measured_vdot'` and `season_anchor_provisional` claimed `false` —
 * asserting current-measured confidence on a stale onboarding artifact.
 *
 * NOT THE SAME DEFECT AS F032: `t_pace_s_per_mi` — the pace actually
 * prescribed — is confirmed fresh and race-blind through
 * `resolveThresholdCapacity()`, a completely separate path that never reads
 * this anchor. Nothing in this file touches that computation; every
 * assertion below is about what `pace_blend.season_anchor_vdot` /
 * `season_anchor_source` / `season_anchor_provisional` may honestly CLAIM.
 * Both real races since onboarding (AFC 8/16, Santa Monica 9/13) computed
 * ~44.1, LOWER than the frozen 46.6 anchor — so a correct fix moves this
 * DISPLAYED number down, not up. That is the intended, correct outcome of
 * an honesty fix, not a regression.
 *
 * ── Rule 18 falsification ────────────────────────────────────────────────
 *
 * `it.each` below builds a `pace_blend` shaped exactly like the register's
 * finding — a present `season_anchor_vdot`, `season_anchor_source:
 * 'measured_vdot'`, `season_anchor_provisional: false`, and NO
 * `season_anchor_stamped_at` (every row written before this fix looks
 * exactly like this, because the field did not exist). Reverting this fix's
 * two new functions in `anchor-provenance.ts` to `return false` unmasks the
 * exact bug: the mislabeled anchor would report itself as fresh forever.
 */
import { describe, it, expect } from 'vitest';
import { distanceCategoryOrThrow } from '@/lib/race/distance-category';
import { composePlan, inlinePrescriptions, type ComposePlanInput, type DOW } from './generate';
import { fixtureTPaceFromGoalPace } from './_fixture-goal-tpace';
import {
  isAnchorStampExpired, paceBlendAnchorIsExpired, SEASON_ANCHOR_EXPIRY_DAYS,
} from './anchor-provenance';

const START_MONDAY = '2026-09-07';

/** A minimal, complete race-prep ComposePlanInput — same shape as
 *  `_midrace_invariants.test.ts`'s `cimInput`, the smallest known-working
 *  fixture for this composer. */
function baseInput(overrides: Partial<ComposePlanInput> = {}): ComposePlanInput {
  const raceDistanceMi = 26.22;
  const goalSec = 10800;
  return {
    raceDistanceMi,
    goalSec,
    goalPaceSec: Math.round(goalSec / raceDistanceMi),
    raceDateISO: '2026-12-06',
    startMondayISO: START_MONDAY,
    level: 'advanced',
    recentWeeklyMi: 45,
    easyDayMedianMi: 6,
    recentLongMi: 16,
    isMidBlock: false,
    longRunDow: 0 as DOW,
    restDow: 6 as DOW,
    qualityDows: [2, 4] as DOW[],
    availableDows: null,
    trainingDaysPerWeek: null,
    crossModes: [],
    rxQuality: inlinePrescriptions(distanceCategoryOrThrow(raceDistanceMi)),
    rxRaceSpecific: inlinePrescriptions(distanceCategoryOrThrow(raceDistanceMi)),
    tPaceSec: fixtureTPaceFromGoalPace(goalSec, raceDistanceMi),
    lthr: null,
    maxHr: null,
    // The FRESH signal this fixture asserts is on file today — matches the
    // real AFC/Santa Monica direction the register cites (~44.1, lower than
    // the frozen 46.6 the bug carried forward).
    bestRecentVdot: 44.1,
    ...overrides,
  };
}

describe('anchor-provenance · isAnchorStampExpired / paceBlendAnchorIsExpired', () => {
  it('a stamp inside the freshness window is NOT expired', () => {
    expect(isAnchorStampExpired('2026-08-01', '2026-09-07')).toBe(false); // 37 days
  });

  it('a stamp past the 84-day freshness window IS expired', () => {
    expect(isAnchorStampExpired('2026-05-19', '2026-09-14')).toBe(true); // 118 days
    // The register's own boundary case, at the doctrine cite's own threshold.
    expect(SEASON_ANCHOR_EXPIRY_DAYS).toBe(84);
  });

  it('RULE 18 · a MISSING stamp is expired, not trusted-by-default', () => {
    // Every pace_blend written before this fix has no season_anchor_stamped_at
    // at all. Reading a missing stamp as "fresh" is exactly the F037 bug.
    expect(isAnchorStampExpired(undefined, '2026-09-14')).toBe(true);
    expect(isAnchorStampExpired(null, '2026-09-14')).toBe(true);
  });

  it('an unparseable stamp is expired (fail-safe, not fail-open)', () => {
    expect(isAnchorStampExpired('not-a-date', '2026-09-14')).toBe(true);
  });

  it('paceBlendAnchorIsExpired reproduces the exact register finding', () => {
    // The register's own shape: 46.6, 'measured_vdot', provisional: false,
    // last actually reviewed 2026-05-19 — no stamp survives that far back.
    const staleAnchor = {
      season_anchor_vdot: 46.6,
      season_anchor_source: 'measured_vdot',
      season_anchor_provisional: false,
    };
    expect(paceBlendAnchorIsExpired(staleAnchor, '2026-09-14')).toBe(true);
  });

  it('no anchor at all is not "expired" — nothing to be stale about', () => {
    expect(paceBlendAnchorIsExpired({ season_anchor_vdot: null }, '2026-09-14')).toBe(false);
    expect(paceBlendAnchorIsExpired(null, '2026-09-14')).toBe(false);
  });
});

describe('F037 · composePlan recomputes an EXPIRED inherited season anchor live', () => {
  it('a stale inherited anchor (4+ months, matching the register) is REPLACED by the live read', () => {
    const input = baseInput({
      seasonAnchorVdot: 46.6,
      seasonAnchorSource: 'measured_vdot',
      // 2026-05-19 → 2026-09-07 is 111 days — past SEASON_ANCHOR_EXPIRY_DAYS.
      seasonAnchorStampedAt: '2026-05-19',
    });
    const composed = composePlan(input);
    const pb = composed.authoredState.pace_blend as Record<string, unknown>;
    // The fresh, live value — NOT the frozen 46.6 the old code would have
    // re-stamped as 'measured_vdot' / provisional:false forever.
    expect(pb.season_anchor_vdot).not.toBe(46.6);
    expect(Number(pb.season_anchor_vdot)).toBeCloseTo(44.1, 0);
    // Direction check, stated plainly per this project's push/pull-back rule:
    // the corrected number is LOWER than the stale one, exactly as expected
    // (both AFC and Santa Monica read ~44.1, under the frozen 46.6).
    expect(Number(pb.season_anchor_vdot)).toBeLessThan(46.6);
    // Re-stamped with THIS authoring's own date, not silently left dateless.
    expect(pb.season_anchor_stamped_at).toBe(START_MONDAY);
  });

  it('RULE 18 falsification target · a stale anchor with NO stamp at all is also replaced', () => {
    // Exactly what every pre-fix pace_blend looks like: a present
    // season_anchor_vdot / season_anchor_source, no season_anchor_stamped_at.
    const input = baseInput({
      seasonAnchorVdot: 46.6,
      seasonAnchorSource: 'measured_vdot',
      // seasonAnchorStampedAt intentionally omitted.
    });
    const composed = composePlan(input);
    const pb = composed.authoredState.pace_blend as Record<string, unknown>;
    expect(pb.season_anchor_vdot).not.toBe(46.6);
    expect(Number(pb.season_anchor_vdot)).toBeCloseTo(44.1, 0);
  });

  it('a GENUINELY fresh inherited anchor is still honored, unchanged (this is not a live-mirror)', () => {
    // 10 days before startMondayISO — well inside the 84-day window. This is
    // the Option-B half of the fix: season_anchor_vdot is a deliberately
    // slower-moving baseline, and a fresh inheritance must not be forced to
    // the live read every single rebuild (that would defeat its purpose as a
    // stable comparison point for the reanchor mechanism).
    const input = baseInput({
      seasonAnchorVdot: 46.6,
      seasonAnchorSource: 'measured_vdot',
      seasonAnchorStampedAt: '2026-08-28',
    });
    const composed = composePlan(input);
    const pb = composed.authoredState.pace_blend as Record<string, unknown>;
    expect(pb.season_anchor_vdot).toBe(46.6);
    expect(pb.season_anchor_source).toBe('measured_vdot');
    expect(pb.season_anchor_provisional).toBe(false);
    // The ORIGINAL stamp travels forward unchanged — re-stamping "now" would
    // launder an old-but-still-fresh measurement into a newer-looking one.
    expect(pb.season_anchor_stamped_at).toBe('2026-08-28');
  });

  it('a fresh authoring with no inheritance at all stamps its own date', () => {
    const input = baseInput(); // no seasonAnchorVdot supplied
    const composed = composePlan(input);
    const pb = composed.authoredState.pace_blend as Record<string, unknown>;
    expect(Number(pb.season_anchor_vdot)).toBeCloseTo(44.1, 0);
    expect(pb.season_anchor_stamped_at).toBe(START_MONDAY);
  });
});
