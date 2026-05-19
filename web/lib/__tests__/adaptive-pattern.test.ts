/**
 * Tests for the adaptive-pattern philosophy — the principles that
 * every adaptive module in the app must obey.
 *
 * These tests are CONTRACT-LEVEL — if they regress, the app is
 * starting to over-react to single events or chase noise. The whole
 * "alive but not nervous" guarantee depends on this passing.
 */

import { describe, it, expect } from 'vitest';
import {
  meetsEvidenceThreshold,
  contextMultiplier,
  compareTrendWindows,
  buildVerdict,
  insufficientData,
  requiresLargeShiftConfirmation,
  LARGE_SHIFT_THRESHOLDS,
  DEFAULT_THRESHOLDS,
  type EvidenceItem,
} from '../adaptive-pattern';

const ev = (
  partial: Partial<EvidenceItem> & { weight: number },
): EvidenceItem => ({
  label: 'sample', when: '2026-05-01', kind: 'workout', ...partial,
});

describe('adaptive-pattern · rule 1 (evidence threshold)', () => {
  it('does not fire on a single observation, even with high weight', () => {
    const r = meetsEvidenceThreshold([ev({ weight: 5 })], 'up');
    expect(r.meets).toBe(false);
  });

  it('does not fire on 2 observations for an UP change (default min 3)', () => {
    const r = meetsEvidenceThreshold([ev({ weight: 1 }), ev({ weight: 1 })], 'up');
    expect(r.meets).toBe(false);
  });

  it('fires on 3 observations with sufficient combined weight for UP', () => {
    const r = meetsEvidenceThreshold(
      [ev({ weight: 1 }), ev({ weight: 1 }), ev({ weight: 1 })],
      'up',
    );
    expect(r.meets).toBe(true);
  });

  it('reports "low" or "medium" partial confidence when threshold not met', () => {
    const r = meetsEvidenceThreshold([ev({ weight: 1 }), ev({ weight: 1 })], 'up');
    expect(r.meets).toBe(false);
    expect(['low', 'medium']).toContain(r.confidence);
  });
});

describe('adaptive-pattern · rule 3 (asymmetric thresholds)', () => {
  it('UP requires MORE evidence than DOWN', () => {
    // 2 weight-1 items: enough for DOWN (min 2 count, 1.5 weight),
    // not enough for UP (min 3 count, 2.5 weight).
    const items = [ev({ weight: 1 }), ev({ weight: 1 })];
    const down = meetsEvidenceThreshold(items, 'down');
    const up   = meetsEvidenceThreshold(items, 'up');
    expect(down.meets).toBe(true);
    expect(up.meets).toBe(false);
  });

  it('DOWN fires with 2 observations totaling 1.5+ weight', () => {
    const r = meetsEvidenceThreshold(
      [ev({ weight: 1 }), ev({ weight: 0.8 })],
      'down',
    );
    expect(r.meets).toBe(true);
  });
});

describe('adaptive-pattern · rule 2 (context filters)', () => {
  it('halves weight for an observation within 14 days of a race', () => {
    const m = contextMultiplier('2026-05-10', {
      lastRaceDate: '2026-05-05',
    });
    expect(m).toBe(0.5);
  });

  it('does not penalize observations >14 days post-race', () => {
    const m = contextMultiplier('2026-06-01', {
      lastRaceDate: '2026-05-05',
    });
    expect(m).toBe(1.0);
  });

  it('quarters weight in hot weather (>85°F)', () => {
    const m = contextMultiplier('2026-07-15', { ambientTempF: 90 });
    expect(m).toBe(0.25);
  });

  it('halves weight in warm weather (75–85°F)', () => {
    const m = contextMultiplier('2026-07-15', { ambientTempF: 80 });
    expect(m).toBe(0.5);
  });

  it('attenuates for poor sleep', () => {
    const m = contextMultiplier('2026-05-10', { sleep7dAvgHrs: 5 });
    expect(m).toBeLessThan(1.0);
  });

  it('attenuates for high load context', () => {
    const m = contextMultiplier('2026-05-10', {
      prior14dMi: 90,
      baselineWeeklyMi: 25,  // ratio = 90 / 50 = 1.8 → 0.6
    });
    expect(m).toBe(0.6);
  });

  it('stacks multipliers — heat + race + bad sleep compounds', () => {
    const m = contextMultiplier('2026-05-10', {
      lastRaceDate: '2026-05-05',
      ambientTempF: 88,
      sleep7dAvgHrs: 5,
    });
    // 0.5 race × 0.25 heat × 0.7 sleep = 0.0875 → floor at 0.1
    expect(m).toBe(0.1);
  });

  it('never zeros out — floors at 0.1 so single noisy days do not erase signal', () => {
    const m = contextMultiplier('2026-05-10', {
      lastRaceDate: '2026-05-09',
      ambientTempF: 95,
      sleep7dAvgHrs: 4,
      energyScore: 1,
    });
    expect(m).toBeGreaterThanOrEqual(0.1);
  });
});

describe('adaptive-pattern · rule 4 (trend-based)', () => {
  it('compares median of latest 28d window to prior 28d window', () => {
    const today = Date.now();
    const day = (d: number): string =>
      new Date(today - d * 86_400_000).toISOString().slice(0, 10);
    const series = [
      { date: day(50), value: 100 }, { date: day(45), value: 100 },
      { date: day(40), value: 100 }, { date: day(35), value: 100 },
      { date: day(20), value: 90 },  { date: day(15), value: 90 },
      { date: day(10), value: 90 },  { date: day(5),  value: 90 },
    ];
    const t = compareTrendWindows(series);
    expect(t.latestMedian).toBe(90);
    expect(t.priorMedian).toBe(100);
    expect(t.delta).toBe(-10);
    expect(t.sufficient).toBe(true);
  });

  it('flags sufficient=false when either window has <3 samples', () => {
    const today = Date.now();
    const day = (d: number): string =>
      new Date(today - d * 86_400_000).toISOString().slice(0, 10);
    const series = [
      { date: day(5), value: 90 },
      { date: day(40), value: 100 }, { date: day(35), value: 100 },
    ];
    const t = compareTrendWindows(series);
    expect(t.sufficient).toBe(false);
  });
});

describe('adaptive-pattern · rule 6 (falsifier required)', () => {
  it('throws when falsifier is missing or trivial', () => {
    expect(() => buildVerdict({
      direction: 'up',
      evidence: [ev({ weight: 1 }), ev({ weight: 1 }), ev({ weight: 1 })],
      reason: 'fitness improved',
      falsifier: '',  // empty
    })).toThrow(/falsifier/);
    expect(() => buildVerdict({
      direction: 'up',
      evidence: [ev({ weight: 1 }), ev({ weight: 1 }), ev({ weight: 1 })],
      reason: 'fitness improved',
      falsifier: 'no',  // too short
    })).toThrow(/falsifier/);
  });

  it('accepts a substantive falsifier', () => {
    const v = buildVerdict({
      direction: 'up',
      evidence: [ev({ weight: 1 }), ev({ weight: 1 }), ev({ weight: 1 })],
      reason: 'fitness improved',
      falsifier: 'We would reconsider if your next race comes in slower.',
    });
    expect(v.hasFinding).toBe(true);
  });
});

describe('adaptive-pattern · over-reaction guards', () => {
  it('does NOT fire on one great workout', () => {
    // Simulating: one race result with high weight, no other evidence.
    const v = buildVerdict({
      direction: 'up',
      evidence: [ev({ weight: 5, kind: 'race', label: 'New 5K PR' })],
      reason: 'one great race',
      falsifier: 'Sustained evidence over 3+ workouts would change this.',
    });
    // Even with weight 5, only 1 observation → does NOT meet UP threshold.
    expect(v.hasFinding).toBe(false);
  });

  it('does NOT fire on one bad workout', () => {
    const v = buildVerdict({
      direction: 'down',
      evidence: [ev({ weight: 3, kind: 'workout', label: 'rough threshold' })],
      reason: 'one bad workout',
      falsifier: 'Two more rough sessions in a row would change this.',
    });
    expect(v.hasFinding).toBe(false);
  });

  it('treats a single hot-weather outlier as nearly zero signal', () => {
    const items = [
      ev({ weight: 1, when: '2026-07-15' }),  // hot day
      ev({ weight: 1, when: '2026-07-16' }),  // hot day
      ev({ weight: 1, when: '2026-07-17' }),  // hot day
    ];
    // Apply heat context (90°F) — each item drops to 0.25 weight
    const filtered = items.map((e) => ({ ...e, weight: e.weight * 0.25 }));
    const r = meetsEvidenceThreshold(filtered, 'up');
    // Total weight = 0.75 < 2.5 → does not fire
    expect(r.meets).toBe(false);
  });

  it('insufficient-data verdict is a valid null verdict', () => {
    const v = insufficientData(
      'No recent races logged yet.',
      'Logging any race with HR data would give the validator something to work with.',
    );
    expect(v.hasFinding).toBe(false);
    expect(v.direction).toBe('none');
    expect(v.confidence).toBe('none');
    expect(v.evidence).toEqual([]);
  });
});

describe('adaptive-pattern · confidence scaling', () => {
  it('reports HIGH confidence when evidence well exceeds threshold', () => {
    // 5 weight-1 items for UP (default min 3 count, 2.5 weight)
    // total = 5 weight, ratio 2.0 → HIGH
    const r = meetsEvidenceThreshold(
      Array(5).fill(0).map(() => ev({ weight: 1 })),
      'up',
    );
    expect(r.meets).toBe(true);
    expect(r.confidence).toBe('high');
  });

  it('reports LOW confidence when just barely over threshold', () => {
    // 3 items × 0.85 weight = 2.55 total, just over 2.5 ratio = 1.02
    const r = meetsEvidenceThreshold(
      Array(3).fill(0).map(() => ev({ weight: 0.85 })),
      'up',
    );
    expect(r.meets).toBe(true);
    expect(r.confidence).toBe('low');
  });
});

describe('adaptive-pattern · rule 8 (large-shift confirmation gate)', () => {
  // The exact scenario that motivated this rule: a pace-band shift
  // from 441 s/mi (T pace at VDOT 46, derived from 15K race pace)
  // to 361 s/mi (a buggy "training paces table" value, off by ~5
  // VDOT). Without this gate, the change shipped silently because
  // the evidence/falsifier checks all passed at a higher layer.
  it('the regression scenario: 80 sec/mi pace shift triggers confirmation', () => {
    const r = requiresLargeShiftConfirmation({
      fieldLabel: 'T pace band',
      kind: 'pace_band_s_per_mi',
      oldValue: 441,
      newValue: 361,
    });
    expect(r.requiresConfirmation).toBe(true);
    expect(r.deltaActual).toBe(80);
    expect(r.threshold).toBe(LARGE_SHIFT_THRESHOLDS.pace_band_s_per_mi);
    expect(r.bannerMessage).toMatch(/T pace band would shift/);
    expect(r.bannerMessage).toMatch(/80/);
  });

  it('small pace adjustments (≤15 sec/mi) do not require confirmation', () => {
    const r = requiresLargeShiftConfirmation({
      fieldLabel: 'E pace low end',
      kind: 'pace_band_s_per_mi',
      oldValue: 540,
      newValue: 552,
    });
    expect(r.requiresConfirmation).toBe(false);
    expect(r.deltaActual).toBe(12);
  });

  it('exactly at threshold does NOT trigger (strict >)', () => {
    const r = requiresLargeShiftConfirmation({
      fieldLabel: 'T pace',
      kind: 'pace_band_s_per_mi',
      oldValue: 400,
      newValue: 415,  // delta = 15, threshold = 15
    });
    expect(r.requiresConfirmation).toBe(false);
  });

  it('max HR shift >8 bpm requires confirmation', () => {
    const r = requiresLargeShiftConfirmation({
      fieldLabel: 'Max HR',
      kind: 'max_hr_bpm',
      oldValue: 175,
      newValue: 184,
    });
    expect(r.requiresConfirmation).toBe(true);
    expect(r.deltaActual).toBe(9);
  });

  it('max HR shift of 5 bpm does NOT require confirmation', () => {
    const r = requiresLargeShiftConfirmation({
      fieldLabel: 'Max HR',
      kind: 'max_hr_bpm',
      oldValue: 175,
      newValue: 180,
    });
    expect(r.requiresConfirmation).toBe(false);
  });

  it('VDOT shift >2 points requires confirmation', () => {
    const r = requiresLargeShiftConfirmation({
      fieldLabel: 'VDOT',
      kind: 'vdot_points',
      oldValue: 45,
      newValue: 48,  // 3 point jump
    });
    expect(r.requiresConfirmation).toBe(true);
  });

  it('race goal shift >2 min requires confirmation', () => {
    // User considering tightening HM goal from 1:35 to 1:30 = 300s
    const r = requiresLargeShiftConfirmation({
      fieldLabel: 'AFC Half goal',
      kind: 'race_goal_seconds',
      oldValue: 5700,
      newValue: 5400,
    });
    expect(r.requiresConfirmation).toBe(true);
    expect(r.deltaActual).toBe(300);
  });

  it('threshold override is honored when explicitly set', () => {
    // A runner with a high RHR baseline might legitimately swing
    // ±10 bpm in RHR readings. Per-runner override allows widening.
    const r = requiresLargeShiftConfirmation({
      fieldLabel: 'Resting HR',
      kind: 'resting_hr_bpm',
      oldValue: 55,
      newValue: 62,  // delta = 7, default threshold = 6, override = 10
      thresholdOverride: 10,
    });
    expect(r.requiresConfirmation).toBe(false);
    expect(r.threshold).toBe(10);
  });

  it('banner copy includes direction (up/down) and units', () => {
    const up = requiresLargeShiftConfirmation({
      fieldLabel: 'Max HR',
      kind: 'max_hr_bpm',
      oldValue: 170,
      newValue: 180,
    });
    expect(up.bannerMessage).toMatch(/up by/);
    expect(up.bannerMessage).toMatch(/bpm/);

    const down = requiresLargeShiftConfirmation({
      fieldLabel: 'Max HR',
      kind: 'max_hr_bpm',
      oldValue: 180,
      newValue: 170,
    });
    expect(down.bannerMessage).toMatch(/down by/);
  });

  it('falsifier suggests user actions in the banner', () => {
    const r = requiresLargeShiftConfirmation({
      fieldLabel: 'T pace',
      kind: 'pace_band_s_per_mi',
      oldValue: 441,
      newValue: 361,
    });
    expect(r.falsifier).toMatch(/Apply if/);
    expect(r.falsifier).toMatch(/keep current/i);
  });
});

describe('adaptive-pattern · large-shift gate is the safety net', () => {
  // Documents the gate's purpose: catches errors that the
  // evidence/falsifier philosophy doesn't catch on its own. A high-
  // confidence verdict to make a wrong-magnitude change is the
  // exact case the gate exists for.
  it('high-confidence verdict + large shift = still requires confirmation', () => {
    // Evidence side: passes (say 5 race-derived data points)
    const evidenceVerdict = buildVerdict({
      direction: 'up',
      evidence: Array(5).fill(0).map((_, i) => ({
        label: `race ${i+1}`, weight: 1, when: '2026-05-01', kind: 'race' as const,
      })),
      reason: 'five corroborating race results',
      falsifier: 'A new race that contradicts this would change our mind.',
    });
    expect(evidenceVerdict.hasFinding).toBe(true);
    expect(evidenceVerdict.confidence).toBe('high');

    // Shift side: also gates (80 sec/mi is well above threshold)
    const shift = requiresLargeShiftConfirmation({
      fieldLabel: 'T pace',
      kind: 'pace_band_s_per_mi',
      oldValue: 441,
      newValue: 361,
    });
    expect(shift.requiresConfirmation).toBe(true);

    // Both gates pass through the user's confirmation —
    // evidenceVerdict tells them WHY, shift.bannerMessage tells
    // them HOW MUCH.
  });
});
