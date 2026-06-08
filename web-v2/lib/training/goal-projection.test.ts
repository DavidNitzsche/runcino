/**
 * Confidence interval + label · pins the calibration so a tweak to a base %
 * or BUILD_RATE can't silently drift the numbers David approved.
 *
 * Reference case (UI-HEALTH 3.4): David, AFC Half (HM), VDOT 47.9 →
 * current-fitness projection 1:34:54 (5694s), goal 1:30:00 (5400s),
 * ~69 days out, status 'watching'.
 *   · band (watching ×1.25 on §13.7 HM ±2.5%) → 1:31:56 – 1:37:52
 *   · label → MEDIUM · doable, not banked
 */
import { describe, it, expect } from 'vitest';
import { computeConfidenceInterval, computeConfidenceLabel } from './goal-projection';

const HM = 13.1;
const DAVID_PROJ = 5694; // predictRaceTime(47.9, 13.1) = 1:34:54
const DAVID_GOAL = 5400; // 1:30:00

describe('computeConfidenceInterval', () => {
  it('David watching · §13.7 HM base ×1.25 → 1:31:56 – 1:37:52', () => {
    const ci = computeConfidenceInterval({
      centerSec: DAVID_PROJ, raceDistanceMi: HM, status: 'watching', pacing: { cv: null, source: 'default' },
    });
    expect(ci).not.toBeNull();
    expect(ci!.lo).toBe(5516); // 1:31:56 (faster edge)
    expect(ci!.hi).toBe(5872); // 1:37:52 (slower edge)
    expect(ci!.pct).toBe(3.1);
    expect(ci!.method).toBe('research-span');
  });

  it('on-track ×1.0 → the unscaled ±2.5% band (1:32:32 – 1:37:16)', () => {
    const ci = computeConfidenceInterval({ centerSec: DAVID_PROJ, raceDistanceMi: HM, status: 'on-track' });
    expect(ci!.lo).toBe(5552); // 1:32:32
    expect(ci!.hi).toBe(5836); // 1:37:16
    expect(ci!.pct).toBe(2.5);
  });

  it('off-track ×1.5 widens the band', () => {
    const ci = computeConfidenceInterval({ centerSec: DAVID_PROJ, raceDistanceMi: HM, status: 'off-track' });
    expect(ci!.lo).toBe(5480);
    expect(ci!.hi).toBe(5908);
    expect(ci!.pct).toBe(3.8); // 2.5 × 1.5, display-rounded
  });

  it('span keys on target distance · 10K tighter, marathon wider', () => {
    expect(computeConfidenceInterval({ centerSec: 3000, raceDistanceMi: 6.2, status: 'on-track' })!.pct).toBe(2.0);
    expect(computeConfidenceInterval({ centerSec: 10800, raceDistanceMi: 26.2, status: 'on-track' })!.pct).toBe(3.0);
  });

  it('observed CV replaces the §13.7 base · tight pacer floored at 2.0%', () => {
    const tight = computeConfidenceInterval({ centerSec: DAVID_PROJ, raceDistanceMi: HM, status: 'on-track', pacing: { cv: 0.015, source: 'observed' } });
    expect(tight!.method).toBe('observed-cv');
    expect(tight!.pct).toBe(2.0);
    const loose = computeConfidenceInterval({ centerSec: DAVID_PROJ, raceDistanceMi: HM, status: 'on-track', pacing: { cv: 0.05, source: 'observed' } });
    expect(loose!.pct).toBe(3.5);
  });

  it('null/zero center → null (cold-start, no band)', () => {
    expect(computeConfidenceInterval({ centerSec: null, raceDistanceMi: HM, status: 'on-track' })).toBeNull();
    expect(computeConfidenceInterval({ centerSec: 0, raceDistanceMi: HM, status: 'on-track' })).toBeNull();
  });
});

describe('computeConfidenceLabel', () => {
  it('David · gap 4:54, ~10wk runway, watching → MEDIUM · doable, not banked', () => {
    const label = computeConfidenceLabel({
      goalSec: DAVID_GOAL, raceDistanceMi: HM, vdot: 47.9, daysToRace: 69, status: 'watching',
    });
    expect(label).not.toBeNull();
    expect(label!.tier).toBe('medium');
    expect(label!.word).toBe('MEDIUM');
    expect(label!.descriptor).toBe('doable, not banked');
    expect(label!.detail).toContain('4:54 to find');
    expect(label!.detail).toContain('10 weeks');
    expect(Number(label!.evidence.gapVdot)).toBeCloseTo(3.0, 1);
  });

  it('already at/ahead of goal fitness → HIGH · ahead of the number', () => {
    const label = computeConfidenceLabel({ goalSec: DAVID_GOAL, raceDistanceMi: HM, vdot: 52, daysToRace: 69, status: 'on-track' });
    expect(label!.tier).toBe('high');
    expect(label!.detail).toBe('ahead of the number · hold the plan');
  });

  it('off-track caps the tier at LOW', () => {
    const label = computeConfidenceLabel({ goalSec: DAVID_GOAL, raceDistanceMi: HM, vdot: 50, daysToRace: 200, status: 'off-track' });
    expect(label!.tier).toBe('low');
  });

  it('watching caps HIGH down to MEDIUM', () => {
    // Small gap + long runway would read HIGH, but watching pulls it to MEDIUM.
    const label = computeConfidenceLabel({ goalSec: DAVID_GOAL, raceDistanceMi: HM, vdot: 50.5, daysToRace: 120, status: 'watching' });
    expect(label!.tier).toBe('medium');
  });

  it('runway under 2 weeks with a real gap → LOW', () => {
    const label = computeConfidenceLabel({ goalSec: DAVID_GOAL, raceDistanceMi: HM, vdot: 47.9, daysToRace: 7, status: 'on-track' });
    expect(label!.tier).toBe('low');
  });

  it('null vdot → null (cold-start, no honest read)', () => {
    expect(computeConfidenceLabel({ goalSec: DAVID_GOAL, raceDistanceMi: HM, vdot: null, daysToRace: 69, status: 'on-track' })).toBeNull();
  });
});
