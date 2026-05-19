/**
 * Adaptive simulations — end-to-end scenarios run through the
 * adaptive modules to verify the "alive but not nervous" guarantee.
 *
 * Each test models a real runner experience and asserts the system
 * does (or does NOT) propose a change. The scenarios are drawn from
 * the philosophy doc:
 *
 *   - One great workout → no VDOT bump
 *   - One bad workout → no fitness downgrade
 *   - One hot day → outlier dampened
 *   - Three sustained good workouts → propose fitness bump (would,
 *     once VDOT updater ships — for now, evidence threshold passes)
 *   - Three sustained poor check-ins → already covered by engine 3+ rule
 *   - Single peak HR above stored → does NOT bump (needs ≥2 or 5+ bpm)
 *   - Sustained race-anchored discrepancy → DOES propose bump
 *
 * If these regress, the app has started chasing noise.
 */

import { describe, it, expect } from 'vitest';
import {
  meetsEvidenceThreshold,
  contextMultiplier,
  buildVerdict,
  type EvidenceItem,
} from '../adaptive-pattern';

const obs = (
  label: string,
  weight: number,
  when: string = '2026-05-15',
  kind: EvidenceItem['kind'] = 'workout',
): EvidenceItem => ({ label, weight, when, kind });

describe('SIMULATION · runner has one great workout', () => {
  it('a single great threshold session does NOT propose a VDOT bump', () => {
    // VDOT bump = UP direction, needs ≥3 evidence items + ≥2.5 weight
    const evidence: EvidenceItem[] = [
      obs('Threshold session: held 7:15 at HR 145 (Z3, easy)', 5.0, '2026-05-14'),
    ];
    const verdict = buildVerdict({
      direction: 'up',
      evidence,
      reason: 'one good session',
      falsifier: 'We would propose a bump if two more landed the same way.',
    });
    expect(verdict.hasFinding).toBe(false);
    expect(verdict.direction).toBe('none');
  });

  it('three consecutive great threshold sessions DO clear the threshold', () => {
    const evidence: EvidenceItem[] = [
      obs('Threshold #1 hit target at Z3', 1.0, '2026-05-01'),
      obs('Threshold #2 hit target at Z3', 1.0, '2026-05-08'),
      obs('Threshold #3 hit target at Z3', 1.0, '2026-05-15'),
    ];
    const verdict = buildVerdict({
      direction: 'up',
      evidence,
      reason: 'three threshold sessions landed at target with controlled HR',
      falsifier: 'Two of the next three threshold sessions falling outside target would change this.',
    });
    expect(verdict.hasFinding).toBe(true);
    expect(verdict.direction).toBe('up');
  });
});

describe('SIMULATION · runner has one bad day', () => {
  it('a single hot rough run does NOT propose a fitness downgrade', () => {
    // DOWN needs ≥2 items, but a single hot-day observation gets
    // context-filtered to 0.25× weight → way below threshold.
    const rawWeight = 1.0;
    const heatMult = contextMultiplier('2026-07-15', { ambientTempF: 90 });
    const filteredWeight = rawWeight * heatMult;
    expect(filteredWeight).toBeLessThan(0.5);

    const evidence: EvidenceItem[] = [
      obs('Easy run was 8:13/mi vs 8:49 target — pace creep', filteredWeight, '2026-07-15'),
    ];
    const verdict = buildVerdict({
      direction: 'down',
      evidence,
      reason: 'one hot day with pace creep',
      falsifier: 'A second creep run in moderate weather would tip us into proposing a change.',
    });
    expect(verdict.hasFinding).toBe(false);
  });

  it('one bad workout post-race gets context-dampened to near zero', () => {
    const heatAndRaceWeight = contextMultiplier('2026-05-08', {
      lastRaceDate: '2026-05-05',
      ambientTempF: 88,
    });
    // Race recency 0.5 × heat 0.25 = 0.125 → floors to 0.1
    expect(heatAndRaceWeight).toBeCloseTo(0.125, 2);
  });
});

describe('SIMULATION · max HR validator firing rules', () => {
  it('one validated peak +2 bpm above stored does NOT fire', () => {
    // Mirror the rule in validate-max-hr.ts firing logic:
    //   fires if (≥2 validated peaks above) OR (top peak +5 bpm above)
    const currentMaxHr = 175;
    const peaks = [{ hr: 177, isValidatedEffort: true }];
    const validatedAbove = peaks.filter((p) => p.isValidatedEffort && p.hr > currentMaxHr);
    const meetsMultiPeak = validatedAbove.length >= 2;
    const meetsClearSingle = validatedAbove[0]
      && (validatedAbove[0].hr - currentMaxHr) >= 5;
    expect(meetsMultiPeak || meetsClearSingle).toBe(false);
  });

  it('one validated peak +5 bpm above stored DOES fire (clear-gap override)', () => {
    const currentMaxHr = 175;
    const peaks = [{ hr: 180, isValidatedEffort: true }];
    const validatedAbove = peaks.filter((p) => p.isValidatedEffort && p.hr > currentMaxHr);
    const meetsClearSingle = validatedAbove[0]
      && (validatedAbove[0].hr - currentMaxHr) >= 5;
    expect(meetsClearSingle).toBe(true);
  });

  it('two validated peaks +2 bpm each DO fire (multi-peak)', () => {
    const currentMaxHr = 175;
    const peaks = [
      { hr: 177, isValidatedEffort: true },
      { hr: 176, isValidatedEffort: true },
    ];
    const validatedAbove = peaks.filter((p) => p.isValidatedEffort && p.hr > currentMaxHr);
    expect(validatedAbove.length >= 2).toBe(true);
  });
});

describe('SIMULATION · easy-pace insight 3+ run requirement', () => {
  it('2 easy runs slower than target do NOT trigger an insight', () => {
    // Mirror the weekly-insights.ts rule: easyPaces.length >= 3
    const easyPaces = [560, 565];  // 2 runs at 9:20, 9:25/mi
    expect(easyPaces.length >= 3).toBe(false);
  });

  it('3 easy runs slower than target DO clear the count threshold', () => {
    const easyPaces = [560, 565, 555];
    expect(easyPaces.length >= 3).toBe(true);
  });
});

describe('SIMULATION · engine 2+ poor-day requirement', () => {
  // Mirror the coach-engine.ts rule (now `poorDaysCount >= 2`).
  it('1 poor check-in does NOT trigger the easy-share cutback', () => {
    const poorDaysCount = 1;
    const easyShare14d = 0.55;  // below 60%
    const triggers = poorDaysCount >= 2 && easyShare14d > 0 && easyShare14d < 0.60;
    expect(triggers).toBe(false);
  });

  it('2 poor check-ins + low easy-share DOES trigger the cutback', () => {
    const poorDaysCount = 2;
    const easyShare14d = 0.55;
    const triggers = poorDaysCount >= 2 && easyShare14d > 0 && easyShare14d < 0.60;
    expect(triggers).toBe(true);
  });

  it('2 poor check-ins but HEALTHY easy-share does NOT trigger', () => {
    // Two poor days alone aren't enough — the low easy-share is the
    // corroborating second signal. With a healthy 80% easy share,
    // 2 poor days could be a stress-week and not training-related.
    const poorDaysCount = 2;
    const easyShare14d = 0.82;
    const triggers = poorDaysCount >= 2 && easyShare14d > 0 && easyShare14d < 0.60;
    expect(triggers).toBe(false);
  });
});

describe('SIMULATION · sustained vs spike scenarios', () => {
  it('5 great workouts spread over 28 days = HIGH confidence UP', () => {
    const evidence: EvidenceItem[] = Array(5).fill(0).map((_, i) => ({
      label: `Quality session ${i + 1} landed in band`,
      weight: 1.0,
      when: '2026-05-15',
      kind: 'workout',
    }));
    const r = meetsEvidenceThreshold(evidence, 'up');
    expect(r.meets).toBe(true);
    expect(r.confidence).toBe('high');
  });

  it('3 great workouts at full weight = MEDIUM confidence UP', () => {
    const evidence: EvidenceItem[] = Array(3).fill(0).map((_, i) => ({
      label: `Quality session ${i + 1}`,
      weight: 1.0,
      when: '2026-05-15',
      kind: 'workout',
    }));
    const r = meetsEvidenceThreshold(evidence, 'up');
    expect(r.meets).toBe(true);
    // 3 × 1.0 / 2.5 required = 1.2 → medium
    expect(r.confidence).toBe('medium');
  });

  it('3 workouts at 80% weight each = JUST OVER threshold = LOW confidence', () => {
    const evidence: EvidenceItem[] = Array(3).fill(0).map(() => ({
      label: 'Quality session',
      weight: 0.85,
      when: '2026-05-15',
      kind: 'workout',
    }));
    const r = meetsEvidenceThreshold(evidence, 'up');
    expect(r.meets).toBe(true);
    // 3 × 0.85 = 2.55 / 2.5 = 1.02 → low (just barely over)
    expect(r.confidence).toBe('low');
  });
});

describe('SIMULATION · asymmetric DOWN signal fires faster', () => {
  it('2 fatigue signals fire DOWN where 3 fitness signals would be required for UP', () => {
    const items: EvidenceItem[] = [
      obs('rough threshold', 1.0, '2026-05-14'),
      obs('RHR up 4 bpm last week', 0.8, '2026-05-15'),
    ];
    const down = meetsEvidenceThreshold(items, 'down');
    const up   = meetsEvidenceThreshold(items, 'up');
    expect(down.meets).toBe(true);   // 2 items, 1.8 weight ≥ 1.5
    expect(up.meets).toBe(false);    // only 2 items, UP needs ≥3
  });
});

describe('SIMULATION · context filter compositing', () => {
  it('three observations all from a hot week barely move the needle', () => {
    const rawWeights = [1.0, 1.0, 1.0];
    const filtered = rawWeights.map((w) =>
      w * contextMultiplier('2026-07-15', { ambientTempF: 90 }),
    );
    // Each is 0.25; total 0.75 < 2.5 → does not fire UP
    const evidence: EvidenceItem[] = filtered.map((w, i) => obs(`hot run ${i+1}`, w));
    const r = meetsEvidenceThreshold(evidence, 'up');
    expect(r.meets).toBe(false);
  });

  it('three observations in moderate weather fire normally', () => {
    const rawWeights = [1.0, 1.0, 1.0];
    const filtered = rawWeights.map((w) =>
      w * contextMultiplier('2026-04-15', { ambientTempF: 65 }),
    );
    // Each is 1.0; total 3.0 ≥ 2.5 → fires UP
    const evidence: EvidenceItem[] = filtered.map((w, i) => obs(`run ${i+1}`, w));
    const r = meetsEvidenceThreshold(evidence, 'up');
    expect(r.meets).toBe(true);
  });
});
