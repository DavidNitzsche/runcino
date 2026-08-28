/**
 * heat-band.ts — pace verdict band.
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
 * The target is never widened for conditions — the runner paces off feel
 * on the day, and a heat-widened "on pace" verdict would grade him against
 * a number he didn't run to. `slowdownPct` is accepted for call-site
 * compatibility and ignored. All paces in seconds-per-mile.
 *
 *   'fast' · actual < target - tolerance
 *   'on'   · target - tolerance <= actual <= target + tolerance
 *   'slow' · actual > target + tolerance
 *
 * Extracted 2026-06-08 from four byte-identical inline copies that had
 * begun to drift. Heat-widening removed 2026-08-27 — the runner does not
 * want the app re-labeling a real pace miss as "on" because it was hot.
 */
export type PaceVerdict = 'on' | 'fast' | 'slow';

export function heatAdjustedStatus(
  targetSPerMi: number,
  actualSPerMi: number,
  _slowdownPct: number,
  tolerance = 10,
): PaceVerdict {
  if (actualSPerMi < targetSPerMi - tolerance) return 'fast';
  if (actualSPerMi > targetSPerMi + tolerance) return 'slow';
  return 'on';
}

/** Raw HR-drift band shape (chip text + color) shared by the run-detail
 *  panels. `heatExpected` is set once heatAwareDrift relabels it. */
export type DriftBand = { text: string; color: string; heatExpected?: boolean };

/**
 * Heat-aware HR-drift label. On a warm-or-hotter day (slowdownPct >= 2 — the
 * same gate heatAdjustedStatus uses to start widening the pace band) a
 * back-half HR rise is thermoregulation, not aerobic decoupling. Relabel the
 * verdict to HEAT DRIFT so the runner still sees the magnitude with the right
 * cause, instead of a red "LATE FADE" that reads as lost fitness.
 *
 * Only the two RISE verdicts are rewritten ('SOME DRIFT', 'LATE FADE'); a
 * flat/steady run (STAYED FLAT / HELD STEADY) and every band on a cool day
 * pass through unchanged. Don't suppress — the magnitude line still renders.
 */
export function heatAwareDrift(raw: DriftBand, slowdownPct: number): DriftBand {
  const isRise = raw.text === 'SOME DRIFT' || raw.text === 'LATE FADE';
  if (slowdownPct >= 2 && isRise) {
    return { text: 'HEAT DRIFT', color: '#F3AD38' /* --warn-text */, heatExpected: true };
  }
  return raw;
}
