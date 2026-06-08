/**
 * heat-band.ts — heat-adjusted pace verdict band.
 *
 * Single source of truth for the on / fast / slow classification shared
 * by every surface that judges a completed run's pace against its
 * prescribed target:
 *
 *   · loadPhaseBreakdown       — lib/coach/run-state.ts          (phase bars)
 *   · computeTodayExecution E5 — lib/coach/glance-state.ts       (done-state)
 *   · winTempo                 — lib/coach/run-win.ts            (recap win line)
 *   · loadRecentTestPoints     — lib/training/goal-projection.ts (Targets page)
 *
 * Heat widens the SLOW side only — you're allowed to be slower when it's
 * hot, never faster. All paces in seconds-per-mile.
 *
 *   effectiveTarget = slowdownPct >= 2 ? round(target * (1 + slowdownPct/100)) : target
 *   'fast' · actual < target - tolerance               (faster than plan)
 *   'on'   · target - tolerance <= actual <= effectiveTarget + tolerance
 *   'slow' · actual > effectiveTarget + tolerance       (real miss, heat allowed for)
 *
 * Cool conditions (slowdownPct < 2) collapse effectiveTarget to the raw
 * target, so the band is symmetric +/- tolerance.
 *
 * Extracted 2026-06-08 from four byte-identical inline copies that had
 * begun to drift — winTempo never heat-adjusted, so the recap win line
 * contradicted the phase bars + done-state on a hot day.
 */
export type PaceVerdict = 'on' | 'fast' | 'slow';

export function heatAdjustedStatus(
  targetSPerMi: number,
  actualSPerMi: number,
  slowdownPct: number,
  tolerance = 10,
): PaceVerdict {
  const effectiveTarget = slowdownPct >= 2
    ? Math.round(targetSPerMi * (1 + slowdownPct / 100))
    : targetSPerMi;
  if (actualSPerMi < targetSPerMi - tolerance) return 'fast';
  if (actualSPerMi > effectiveTarget + tolerance) return 'slow';
  return 'on';
}
