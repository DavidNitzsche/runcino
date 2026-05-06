/**
 * Doctrine barrel + citation helper.
 *
 * Every numeric constant or rule extracted from the research lives in a
 * file under web/coach/doctrine/, named after its research chapter.
 * Each export pairs a value with a Citation pointing back into the
 * markdown so a future reader (human or AI) can trace any number to
 * its justification.
 *
 * Pattern (see intensity.ts for the canonical example):
 *
 *   export const POLARIZED_DISTRIBUTION: Cited<IntensityDistribution> = {
 *     value: { easyPct: 80, thresholdPct: 5, hardPct: 15 },
 *     citations: [cite('§3.1', 'roughly 80 percent easy …')],
 *   };
 *
 * The barrel re-exports each topic file so consumers can import either
 * by-topic (`import { POLARIZED_DISTRIBUTION } from '@/coach/doctrine'`)
 * or by-file (`import * as Intensity from '@/coach/doctrine/intensity'`).
 */
import type { Citation } from '../types';

/** Wraps a doctrine value with the Citation(s) that justify it. */
export interface Cited<T> {
  value: T;
  citations: Citation[];
  /** Optional human-readable note alongside the value — surfaces in
   *  Coach rationale strings ("polarized 80 / 5 / 15 — see §3.1"). */
  note?: string;
}

/** Convenience builder. `cite('§3.1')` constructs a coaching-research
 *  citation; pass `'amp'` as second arg to point at amp-research instead. */
export function cite(
  section: string,
  snippet?: string,
  doc: 'coaching' | 'amp' = 'coaching',
): Citation {
  return {
    doc: doc === 'amp' ? 'docs/amp-research.md' : 'docs/coaching-research.md',
    section,
    snippet,
  };
}

// ── Topic barrels ────────────────────────────────────────────────────
// Each file under doctrine/ is its own research chapter. Import either
// by-topic via this barrel (`import { POLARIZED_DISTRIBUTION } from
// '@/coach/doctrine'`) or by-file (`import * as Intensity from
// '@/coach/doctrine/intensity'`) when the call site cares about scope.
export * from './intensity';
export * from './volume';
export * from './workouts';
export * from './strength';
export * from './fueling';
export * from './recovery';
export * from './shoes';
export * from './cadence';
export * from './heat';
export * from './masters';
export * from './load';
export * from './taper';
