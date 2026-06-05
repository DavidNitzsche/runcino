/**
 * state-presence.ts · canonical "do we have this signal?" helpers.
 *
 * 2026-06-05 · multi-tenant audit landed (docs/2026-06-05-multi-tenant-audit.html).
 * Cross-cutting Pattern 8: five different presence predicates across coach
 * modules disagreed on what counts as "real RHR" · some required baseline +
 * current, some required 5+ samples, some required just non-null current.
 * Same pillar, five definitions. Result: a Strava-only runner with no
 * recovery data lands at score 67-75 = READY because the LOAD pillar alone
 * fires and no consumer agreed on what "we have nothing" meant.
 *
 * This module is the canonical answer. Every consumer (readiness scorer,
 * recovery brief, heat acclim, health-actions empty-state, seed adapter)
 * should import these helpers instead of writing its own `state.x != null`
 * check.
 *
 * Anti-pattern this kills:
 *   const rhr = state.rhrCurrent ?? state.rhrBaseline ?? 60;
 *   const sleep = state.sleep7Avg ?? 7.5;
 *   const hasRhr = state.rhrCurrent != null && state.rhrBaseline != null;  // disagrees with next file
 *
 * Doctrine: NoData is encoded everywhere as either null, 0, undefined, or
 * "". Each consumer handles it with its own ad-hoc fallback. There is no
 * shared `presence(state, pillar)` predicate. This module is that predicate.
 *
 * Cite: docs/2026-06-05-multi-tenant-audit.html § Pattern 1 (null-coalesce
 * to plausible default), § Pattern 2 (cold-start definition), § Pattern 8
 * (independent presence predicates).
 */

import type { CoachState } from '@/lib/topics/types';

export type PresenceKey = 'sleep' | 'hrv' | 'rhr' | 'hr_recovery' | 'load' | 'cycle';

/**
 * Presence mode · how strict is the "do we have it?" check?
 *
 * - 'point'    · we have a current reading (the minimal · "we have a
 *                number to show")
 * - 'baseline' · we have BOTH current AND baseline (required when the
 *                judgment is delta-vs-normal · e.g. "RHR is 5bpm
 *                elevated today")
 * - 'trend'    · we have baseline / history (used when asking "what's
 *                this runner's normal?")
 */
export type PresenceMode = 'point' | 'baseline' | 'trend';

/**
 * Recovery pillars · the four pillars that distinguish "we know how
 * rested the runner is" from "we don't." LOAD pillar (run history /
 * ACWR) does NOT count · a Strava-only runner has LOAD but zero
 * recovery signal. That's the multi-tenant Pattern 2 root cause:
 * cold-start was defined as "no data of any kind" instead of "no
 * recovery signal."
 */
export const RECOVERY_PILLARS: ReadonlyArray<PresenceKey> = [
  'sleep',
  'hrv',
  'rhr',
  'hr_recovery',
] as const;

/**
 * Aggregate weight a recovery pillar contributes to the readiness score.
 * Mirrors the weights in lib/coach/readiness.ts so coverage math stays
 * synced · if those weights change, update this table.
 *
 * Sums to 75 (the 25% LOAD weight lives outside the recovery group · a
 * runner missing all recovery signals can only ever reach 25% real
 * coverage if LOAD is present, which is exactly the point).
 */
const RECOVERY_PILLAR_WEIGHTS: Record<PresenceKey, number> = {
  sleep: 25,
  hrv: 25,
  rhr: 20,
  hr_recovery: 5,
  load: 0,
  cycle: 0,
};

/**
 * Does the state carry a real signal for this pillar at the requested
 * strictness? Returns false on null / undefined / sentinel values · NEVER
 * substitutes a default.
 *
 * Use this everywhere instead of inline `state.x != null` checks. When
 * you reach for `?? 60` or `|| 50`, that's the signal · use this helper
 * and an honest "no data" branch instead.
 */
export function hasSignal(
  state: CoachState | null | undefined,
  key: PresenceKey,
  mode: PresenceMode = 'point',
): boolean {
  if (!state) return false;
  switch (key) {
    case 'sleep':
      // sleep7Avg is the canonical signal · single-night reads are too noisy
      // to count as presence. 0 means "literally zero" (not a real reading)
      // so we exclude it as well · sleep_hours==0 is always a write error.
      if (mode === 'baseline') {
        return state.sleep7Avg != null && state.sleep7Avg > 0;
      }
      return state.sleep7Avg != null && state.sleep7Avg > 0;
    case 'hrv':
      if (mode === 'baseline') {
        return state.hrvCurrent != null && state.hrvBaseline != null;
      }
      if (mode === 'trend') {
        return state.hrvBaseline != null;
      }
      return state.hrvCurrent != null;
    case 'rhr':
      if (mode === 'baseline') {
        return state.rhrCurrent != null && state.rhrBaseline != null;
      }
      if (mode === 'trend') {
        return state.rhrBaseline != null;
      }
      return state.rhrCurrent != null;
    case 'hr_recovery':
      if (mode === 'baseline') {
        return state.hrRecoveryCurrent != null && state.hrRecoveryBaseline != null;
      }
      if (mode === 'trend') {
        return state.hrRecoveryBaseline != null;
      }
      return state.hrRecoveryCurrent != null;
    case 'load':
      // LOAD needs all three: acute, chronic, ratio. The ratio alone
      // could be NaN-derived from 0/0, so we require both inputs too.
      return (
        state.loadAcwr != null
        && state.loadAcute7 != null
        && state.loadChronic28 != null
        && state.loadChronic28 > 0
      );
    case 'cycle':
      // Cycle phase only counts when biological sex is female AND a
      // phase has been computed. The luteal-phase HRV adjustment in
      // readiness.ts depends on both being true.
      return state.biologicalSex === 'female' && state.cyclePhase != null;
    default:
      return false;
  }
}

// ── Convenience helpers · for grep-friendly callsite reads ───────────

export const hasSleepSignal = (state: CoachState | null | undefined, mode: PresenceMode = 'point'): boolean =>
  hasSignal(state, 'sleep', mode);

export const hasHrvSignal = (state: CoachState | null | undefined, mode: PresenceMode = 'point'): boolean =>
  hasSignal(state, 'hrv', mode);

export const hasRhrSignal = (state: CoachState | null | undefined, mode: PresenceMode = 'point'): boolean =>
  hasSignal(state, 'rhr', mode);

export const hasHrRecoverySignal = (state: CoachState | null | undefined, mode: PresenceMode = 'point'): boolean =>
  hasSignal(state, 'hr_recovery', mode);

export const hasLoadSignal = (state: CoachState | null | undefined): boolean =>
  hasSignal(state, 'load');

export const hasCycleSignal = (state: CoachState | null | undefined): boolean =>
  hasSignal(state, 'cycle');

/**
 * Does the state carry AT LEAST ONE real recovery signal?
 *
 * This is the CORRECT definition of "we know something about how rested
 * this runner is." A runner who connected Strava and has run history
 * (LOAD pillar real) but no watch data (HRV/RHR/sleep/hr_recovery all
 * null) returns FALSE here · they're a cold-start recovery runner.
 *
 * Use this gate instead of `state.x != null` ladders when the question
 * is "should I show a recovery panel / readiness score / coach voice
 * about recovery."
 */
export function hasRecoverySignal(
  state: CoachState | null | undefined,
  mode: PresenceMode = 'point',
): boolean {
  if (!state) return false;
  return RECOVERY_PILLARS.some((key) => hasSignal(state, key, mode));
}

/**
 * recoveryCoverage · how much of the readiness picture is backed by
 * real data?
 *
 * Returns a 0..1 fraction · sum of weights from recovery pillars with
 * real data over the total possible recovery weight (75 · sum of the
 * four recovery-pillar weights).
 *
 * Interpretation:
 *   1.0  · fully instrumented runner · all four recovery pillars real
 *   0.6+ · trustworthy reading · most pillars covered
 *   0.4- · LIMITED · score should be rendered with subdued chrome and
 *          a "limited signal" caption per Pattern 6 fix
 *   0.0  · no recovery signal · should never show a confident score
 *
 * Consumers should pair this with hasRecoverySignal() · coverage<0.4
 * AND hasRecoverySignal()==true means "we have something but it's thin"
 * · coverage==0 AND hasRecoverySignal()==false means cold start.
 */
export function recoveryCoverage(state: CoachState | null | undefined): number {
  if (!state) return 0;
  let total = 0;
  let real = 0;
  for (const key of RECOVERY_PILLARS) {
    const weight = RECOVERY_PILLAR_WEIGHTS[key];
    total += weight;
    if (hasSignal(state, key)) real += weight;
  }
  return total > 0 ? real / total : 0;
}

/**
 * Convenience · returns a structured presence summary for one state.
 * Useful for debugging, audit reports, and the new "coverage" field
 * the audit recommends adding to ReadinessBreakdown.
 */
export interface PresenceSummary {
  recovery: {
    coverage: number;
    hasAny: boolean;
    pillars: Record<'sleep' | 'hrv' | 'rhr' | 'hr_recovery', boolean>;
  };
  load: boolean;
  cycle: boolean;
}

export function summarizePresence(state: CoachState | null | undefined): PresenceSummary {
  return {
    recovery: {
      coverage: recoveryCoverage(state),
      hasAny: hasRecoverySignal(state),
      pillars: {
        sleep: hasSleepSignal(state),
        hrv: hasHrvSignal(state),
        rhr: hasRhrSignal(state),
        hr_recovery: hasHrRecoverySignal(state),
      },
    },
    load: hasLoadSignal(state),
    cycle: hasCycleSignal(state),
  };
}
