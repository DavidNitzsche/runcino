/**
 * Self-reported race-history → VDOT (2026-06-23 · PARITY-1).
 *
 * Single source of truth for turning onboarding `profile.race_history` PRs into a fitness anchor.
 * Both the plan loader (loadGeneratorInputs) and the coach voice band consume these — kept here so
 * the bucket→mileage and whenRaced→days-ago maps can't drift between the two.
 *
 * Mirrors the SIM's bestVdotFromHistory (sim-inputs.ts) exactly — raw vdotFromRace, no marathon
 * correction — so the prod loader and the graded sim derive the SAME bestRecentVdot for identical
 * self-reports (that parity is the whole point of PARITY-1).
 */
import { vdotFromRace } from './vdot';

export interface RaceHistoryEntry {
  distance?: string;
  timeSec?: number | string;
  whenRaced?: string;
  otherDistanceMi?: number;
}

/** Map a race_history distance bucket to mileage. */
export function distanceMiOfBucket(d: string | undefined, otherMi: number | undefined): number | null {
  switch (d) {
    case '5k':       return 3.107;
    case '10k':      return 6.214;
    case 'half':     return 13.109;
    case 'marathon': return 26.219;
    case 'other':
      return Number.isFinite(otherMi) && (otherMi ?? 0) > 0 ? Number(otherMi) : null;
    default: return null;
  }
}

/** Map a whenRaced bucket to a midpoint days-ago. */
export function whenRacedDaysAgo(w: string | undefined): number | null {
  switch (w) {
    case '<6mo':   return 90;     // midpoint of 0-180
    case '6-12mo': return 270;    // midpoint of 180-365
    case '1-2yr':  return 547;    // midpoint of 365-730
    case '2+yr':   return 1095;   // representative 3yr · drops out of recent gate
    default:       return null;
  }
}

/**
 * Best (max) VDOT across self-reported PRs raced within `maxDaysAgo`. Returns undefined when no
 * usable entry exists (→ caller falls back to the conservative mileage estimate). Never throws.
 */
export function bestVdotFromRaceHistory(entries: RaceHistoryEntry[] | null | undefined, maxDaysAgo = 365): number | undefined {
  let best: number | undefined;
  for (const e of entries ?? []) {
    const distMi = distanceMiOfBucket(e.distance, e.otherDistanceMi);
    const daysAgo = whenRacedDaysAgo(e.whenRaced);
    if (distMi == null || daysAgo == null || daysAgo > maxDaysAgo) continue;
    const timeSec = Number(e.timeSec);
    if (!Number.isFinite(timeSec) || timeSec <= 0) continue;
    const v = vdotFromRace(timeSec, distMi);
    if (v != null && (best === undefined || v > best)) best = v;
  }
  return best;
}
