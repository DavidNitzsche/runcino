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

/** Convenience builder. Three forms:
 *
 *    cite('§3.1', 'snippet')                       → docs/coaching-research.md (legacy)
 *    cite('§3.1', 'snippet', 'amp')                → docs/amp-research.md (legacy)
 *    cite('§3', 'snippet', 'research', '01')       → Research/01-pace-zones-vdot.md (canonical)
 *
 *  The `'research'` form is the canonical mastermind path going forward
 *  (per docs/COACH_BUILD_PLAN.md). Doctrine files migrate from the
 *  legacy synthesis docs to `/Research/` per the staged plan; the older
 *  arms stay until the last legacy citation is gone, at which point the
 *  synthesis docs and these arms get deleted together. */
export function cite(
  section: string,
  snippet?: string,
  doc?: 'coaching' | 'amp',
): Citation;
export function cite(
  section: string,
  snippet: string | undefined,
  doc: 'research',
  researchDocId: ResearchDocId,
): Citation;
export function cite(
  section: string,
  snippet?: string,
  doc?: 'coaching' | 'amp' | 'research',
  researchDocId?: ResearchDocId,
): Citation {
  if (doc === 'research') {
    if (!researchDocId) throw new Error(`cite() with 'research' requires a doc id (e.g. '01')`);
    return { doc: `Research/${RESEARCH_DOC_FILES[researchDocId]}`, section, snippet };
  }
  return {
    doc: doc === 'amp' ? 'docs/amp-research.md' : 'docs/coaching-research.md',
    section,
    snippet,
  };
}

/** Identifiers for the structured research library at
 *  `/Volumes/WP/06 Claude Code/Runcino/Research/`. Each maps to a
 *  filename; doctrine files cite via the id, the helper resolves to
 *  the path. INDEX, GLOSSARY, SOURCES are reference-only and not in
 *  this enum. */
export type ResearchDocId =
  | '00a' | '00b'
  | '01' | '02' | '03' | '04'
  | '05' | '06' | '07' | '08'
  | '09' | '10' | '11' | '12'
  | '13' | '14' | '15' | '16'
  | '17' | '18' | '19'
  | '20' | '21' | '22';

const RESEARCH_DOC_FILES: Record<ResearchDocId, string> = {
  '00a': '00a-distance-running-training.md',
  '00b': '00b-recovery-protocols.md',
  '01':  '01-pace-zones-vdot.md',
  '02':  '02-race-time-prediction.md',
  '03':  '03-heart-rate-zones.md',
  '04':  '04-workout-vocabulary.md',
  '05':  '05-injury-return-protocols.md',
  '06':  '06-weather-adjustments.md',
  '07':  '07-strength-programming.md',
  '08':  '08-pacing-and-race-week.md',
  '09':  '09-cross-training.md',
  '10':  '10-mobility-warmup.md',
  '11':  '11-course-specific-training.md',
  '12':  '12-travel-timezone.md',
  '13':  '13-sex-specific-training.md',
  '14':  '14-age-considerations.md',
  '15':  '15-wearable-data.md',
  '16':  '16-form-biomechanics.md',
  '17':  '17-footwear.md',
  '18':  '18-fueling-products.md',
  '19':  '19-hydration-electrolytes.md',
  '20':  '20-mental-training.md',
  '21':  '21-form-corrections.md',
  '22':  '22-plan-templates.md',
};

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
export * from './post_race';
export * from './pace_zones';
export * from './hr_zones';
export * from './race_prediction';
export * from './weather';
export * from './pacing';
export * from './race_week';
export * from './injury_return';
