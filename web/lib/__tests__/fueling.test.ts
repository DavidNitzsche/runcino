import { describe, expect, it } from 'vitest';
import { planFueling } from '../fueling';
import type { Phase } from '../types';

const bigSurPhases: Phase[] = [
  { index: 0, label: 'Redwood descent',          startMi: 0,    endMi: 5,     distanceMi: 5,    targetPaceSPerMi: 520, targetPaceDisplay: '8:40/mi', meanGradePct: -1,   elevationGainFt: 100, elevationLossFt: 250, cumulativeTimeS: 2600, cumulativeTimeDisplay: '0:43:20', note: '' },
  { index: 1, label: 'Rolling to Hurricane',      startMi: 5,    endMi: 10,    distanceMi: 5,    targetPaceSPerMi: 510, targetPaceDisplay: '8:30/mi', meanGradePct: 0,    elevationGainFt: 300, elevationLossFt: 400, cumulativeTimeS: 5150, cumulativeTimeDisplay: '1:25:50', note: '' },
  { index: 2, label: 'Hurricane Point climb',    startMi: 10,   endMi: 12,    distanceMi: 2,    targetPaceSPerMi: 595, targetPaceDisplay: '9:55/mi', meanGradePct: 5,    elevationGainFt: 520, elevationLossFt: 30,  cumulativeTimeS: 6340, cumulativeTimeDisplay: '1:45:40', note: '' },
  { index: 3, label: 'Descent to Bixby Bridge',   startMi: 12,   endMi: 14,    distanceMi: 2,    targetPaceSPerMi: 505, targetPaceDisplay: '8:25/mi', meanGradePct: -3,   elevationGainFt: 40,  elevationLossFt: 340, cumulativeTimeS: 7350, cumulativeTimeDisplay: '2:02:30', note: '' },
  { index: 4, label: 'Highway 1 bluffs',          startMi: 14,   endMi: 22,    distanceMi: 8,    targetPaceSPerMi: 530, targetPaceDisplay: '8:50/mi', meanGradePct: 0,    elevationGainFt: 800, elevationLossFt: 780, cumulativeTimeS: 11590, cumulativeTimeDisplay: '3:13:10', note: '' },
  { index: 5, label: 'Carmel Highlands finish',  startMi: 22,   endMi: 26.22, distanceMi: 4.22, targetPaceSPerMi: 525, targetPaceDisplay: '8:45/mi', meanGradePct: 0,    elevationGainFt: 400, elevationLossFt: 215, cumulativeTimeS: 13805, cumulativeTimeDisplay: '3:50:05', note: '' },
];

describe('planFueling', () => {
  it('hits 60g/hr target with Maurten 40g gels for 3:50 finish', () => {
    const plan = planFueling({ phases: bigSurPhases, finishS: 13800 });
    // 60 g/hr × (13800/3600) = 230 g → ceil(230/40) = 6 gels
    expect(plan.summary.gelCount).toBeGreaterThanOrEqual(5);
    expect(plan.summary.gelCount).toBeLessThanOrEqual(7);
    expect(plan.summary.totalCarbsG).toBeGreaterThanOrEqual(200);
  });

  it('anchors every gel to a valid mile on the course', () => {
    const plan = planFueling({ phases: bigSurPhases, finishS: 13800 });
    for (const a of plan.anchors) {
      expect(a.atMi).toBeGreaterThan(0);
      expect(a.atMi).toBeLessThan(26.22);
      expect(a.phaseIdx).toBeGreaterThanOrEqual(0);
      expect(a.phaseIdx).toBeLessThan(bigSurPhases.length);
    }
  });

  it('anchors are in ascending order', () => {
    const plan = planFueling({ phases: bigSurPhases, finishS: 13800 });
    for (let i = 1; i < plan.anchors.length; i++) {
      expect(plan.anchors[i].atMi).toBeGreaterThanOrEqual(plan.anchors[i - 1].atMi);
    }
  });

  it('snaps at least one anchor to a phase boundary', () => {
    const plan = planFueling({ phases: bigSurPhases, finishS: 13800 });
    const boundaries = new Set<number>();
    for (const p of bigSurPhases) {
      boundaries.add(p.startMi);
      boundaries.add(p.endMi);
    }
    const snapped = plan.anchors.filter(a => boundaries.has(a.atMi));
    expect(snapped.length).toBeGreaterThan(0);
  });

  it('accepts custom gel carbs', () => {
    const plan = planFueling({
      phases: bigSurPhases,
      finishS: 13800,
      gelCarbsG: 25,
      gelBrand: 'SIS',
    });
    expect(plan.summary.gelCarbsG).toBe(25);
    expect(plan.summary.gelBrand).toBe('SIS');
    expect(plan.summary.gelCount).toBeGreaterThan(8); // more gels needed
  });
});
