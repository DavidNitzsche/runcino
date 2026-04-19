/**
 * Fueling plan.
 *
 * Anchors gels to phase boundaries rather than wall-clock intervals,
 * so absorption lands where you need it most (e.g. mile 8 gel digests
 * during the Hurricane Point climb).
 *
 * Target: 60 g carbs / hour, sourced from Maurten 160 (40 g each) by
 * default. Call with a different gel brand / carb count and the math
 * adapts.
 */

import { M_PER_MI } from './time';
import type { FuelingSummary, Phase } from './types';

export interface FuelPlanInput {
  phases: Phase[];
  finishS: number;
  carbTargetGPerHr?: number;
  gelCarbsG?: number;
  gelBrand?: string;
}

export interface FuelPlan {
  summary: FuelingSummary;
  anchors: Array<{
    atMi: number;
    gelNumber: number;
    phaseIdx: number;
    rationale: string;
  }>;
}

/**
 * Build a fueling schedule.
 * - Needed gel count = ceil((target_g_per_hr × hours) / gel_carbs_g)
 * - Distribute evenly across race by time, then snap each anchor to
 *   the nearest phase boundary for digestion alignment.
 */
export function planFueling(input: FuelPlanInput): FuelPlan {
  const { phases, finishS } = input;
  const targetGPerHr = input.carbTargetGPerHr ?? 60;
  const gelCarbsG = input.gelCarbsG ?? 40;
  const brand = input.gelBrand ?? 'Maurten';

  const totalDistanceMi = phases.length > 0 ? phases[phases.length - 1].endMi : 0;
  const hours = finishS / 3600;
  const totalCarbsG = targetGPerHr * hours;
  // Running performance research suggests taking the first gel ~30 min in
  // and roughly every 30-35 min after. Count is driven by target, not clock.
  const gelCount = Math.max(1, Math.ceil(totalCarbsG / gelCarbsG));

  // Divide race into (gelCount + 1) intervals, anchor gels at interval ends
  // (so the first is ~30 min in and the last is before the finish).
  const idealAnchorMiles: number[] = [];
  for (let i = 1; i <= gelCount; i++) {
    const t = i / (gelCount + 1);
    idealAnchorMiles.push(t * totalDistanceMi);
  }

  // Snap each ideal anchor to the nearest phase boundary (start_mi)
  // that's within 1 mile — otherwise keep the ideal position.
  const boundaryMiles = phases.map(p => p.startMi).concat(
    phases.length > 0 ? [phases[phases.length - 1].endMi] : []
  );

  const anchors = idealAnchorMiles.map((ideal, idx) => {
    const gelNumber = idx + 1;
    let bestMi = ideal;
    let bestDelta = Infinity;
    for (const b of boundaryMiles) {
      // Don't snap to the very start or very end
      if (b <= 0.5 || b >= totalDistanceMi - 0.5) continue;
      const delta = Math.abs(ideal - b);
      if (delta < 1.0 && delta < bestDelta) {
        bestDelta = delta;
        bestMi = b;
      }
    }
    // Find phase index for the (possibly snapped) mile
    let phaseIdx = 0;
    for (let p = 0; p < phases.length; p++) {
      if (bestMi >= phases[p].startMi && bestMi < phases[p].endMi) {
        phaseIdx = p;
        break;
      }
      phaseIdx = p;
    }
    const snapped = bestDelta < Infinity;
    const phase = phases[phaseIdx];
    const rationale = snapped
      ? `Snapped to "${phase.label}" boundary (ideal ${ideal.toFixed(1)} mi) for absorption alignment.`
      : `Even time split at ${ideal.toFixed(1)} mi.`;

    return {
      atMi: Math.round(bestMi * 10) / 10,
      gelNumber,
      phaseIdx,
      rationale,
    };
  });

  const actualCarbsG = gelCount * gelCarbsG;

  return {
    summary: {
      carbTargetGPerHr: targetGPerHr,
      totalCarbsG: actualCarbsG,
      gelCount,
      gelCarbsG,
      gelBrand: brand,
      notes:
        `Gels anchored to phase boundaries, not clock. ` +
        `${gelCount} × ${gelCarbsG} g = ${actualCarbsG} g carbs total (${(actualCarbsG / hours).toFixed(1)} g/hr).`,
    },
    anchors,
  };
}
