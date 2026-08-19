/**
 * GOAL-RENEGOTIATION INVARIANTS (2026-08-17 · coaching-loop reconciliation).
 *
 * Locks: the sustained-unclosable gate, the consecutive-unclosable
 * counter in goal-gap's trend classifier, and the proposal payload shape
 * (revised target band · ambition stays on the board · coach voice).
 */
import { describe, it, expect } from 'vitest';
import { classifyTrend, type GoalGap } from './goal-gap';
import {
  RENEGOTIATION_SUSTAINED_DAYS,
  shouldProposeRenegotiation,
  composeRenegotiationReasons,
} from './goal-renegotiation';
import type { GapReport } from './gap-report';

// HM goal 1:30 (5400s) · 6 weeks out → closable = 40*6*1.5 = 360s.
const GOAL = 5400;
const WEEKS = 6;
const DIST = 13.1;
const UNCLOSABLE_PROJ = GOAL + 400;  // gap 400 > 360
const FINE_PROJ = GOAL + 100;

function series(projs: number[]): Array<{ date: string; projectionSec: number | null; vdot: number | null }> {
  return projs.map((p, i) => ({
    date: `2026-08-${String(i + 1).padStart(2, '0')}`,
    projectionSec: p,
    vdot: null,
  }));
}

describe('classifyTrend · consecutiveUnclosableDays', () => {
  it('counts the unbroken unclosable streak from the latest day back', () => {
    const s = series([FINE_PROJ, FINE_PROJ, ...Array(6).fill(UNCLOSABLE_PROJ)]);
    const r = classifyTrend(s, GOAL, WEEKS, DIST);
    expect(r.status).toBe('unclosable');
    expect(r.consecutiveUnclosableDays).toBe(6);
  });
  it('a closable day breaks the streak', () => {
    const s = series([...Array(4).fill(UNCLOSABLE_PROJ), FINE_PROJ, UNCLOSABLE_PROJ, UNCLOSABLE_PROJ]);
    const r = classifyTrend(s, GOAL, WEEKS, DIST);
    expect(r.status).toBe('unclosable');
    expect(r.consecutiveUnclosableDays).toBe(2);
  });
  it('non-unclosable series reports zero', () => {
    const r = classifyTrend(series(Array(8).fill(FINE_PROJ)), GOAL, WEEKS, DIST);
    expect(r.status).not.toBe('unclosable');
    expect(r.consecutiveUnclosableDays).toBe(0);
  });
});

describe('shouldProposeRenegotiation', () => {
  it('requires sustained unclosable (≥5 consecutive days)', () => {
    expect(shouldProposeRenegotiation({ status: 'unclosable', consecutiveUnclosableDays: RENEGOTIATION_SUSTAINED_DAYS })).toBe(true);
    expect(shouldProposeRenegotiation({ status: 'unclosable', consecutiveUnclosableDays: 4 })).toBe(false);
    expect(shouldProposeRenegotiation({ status: 'widening', consecutiveUnclosableDays: 9 })).toBe(false);
    expect(shouldProposeRenegotiation({ status: 'closing', consecutiveUnclosableDays: 0 })).toBe(false);
  });
});

function mkGap(): GoalGap {
  return {
    mode: 'race',
    raceSlug: 'cim-2026',
    raceDateISO: '2026-12-06',
    raceDistanceMi: 26.2,
    goalSec: 10800,           // 3:00
    trajectorySec: 11640,     // 3:14
    gapSec: 840,
    confidence: 0.8,
    // Renegotiation is a trajectory decision, not a limiter one · this fixture
    // exercises the sustained-unclosable path and carries no limiter read.
    limiter: null,
    // The renegotiation payload does not read the assessment · this fixture
    // pins the sustained-unclosable path only.
    assessment: null,
    status: 'unclosable',
    weeksRemaining: 4,
    whatClosesIt: [],
    citation: 'goal-gap engine v1',
    consecutiveWideningDays: 0,
    consecutiveUnclosableDays: 6,
  };
}

describe('composeRenegotiationReasons', () => {
  it('carries the A/B/C bands from the gap report', () => {
    const report = {
      alternativeRanges: {
        a: { sec: 11400, label: 'A-goal · stretch but possible' },
        b: { sec: 11640, label: 'B-goal · where you\'re tracking' },
        c: { sec: 11940, label: 'C-goal · safe + executable' },
      },
    } as unknown as GapReport;
    const r = composeRenegotiationReasons(mkGap(), report);
    expect(r.alternatives.a.sec).toBe(11400);
    expect(r.alternatives.b.sec).toBe(11640);
    expect(r.alternatives.c.sec).toBe(11940);
    expect(r.keeps_ambition).toBe(true);
    expect(r.accept_path).toContain('PATCH /api/race/cim-2026');
    expect(r.race_slug).toBe('cim-2026');
  });

  it('falls back to trajectory-anchored bands without a simulator report', () => {
    const r = composeRenegotiationReasons(mkGap(), null);
    expect(r.alternatives.a.sec).toBe(10800);            // stretch = the stated goal
    expect(r.alternatives.b.sec).toBe(11640);            // tracking = trajectory
    expect(r.alternatives.c.sec).toBe(Math.round(11640 * 1.03));
  });

  it('speaks coach voice · ambition stays on the board · no em dashes, no exclamations', () => {
    const r = composeRenegotiationReasons(mkGap(), null);
    expect(r.message).toContain('3:00');                 // the ambition, named
    expect(r.message).toContain('stays on the board');
    expect(r.message).not.toMatch(/—/);
    expect(r.message).not.toMatch(/!/);
    expect(r.message).not.toMatch(/😀|🎉|🔥/u);
  });
});
