/**
 * Citation helper + Cited<T> wrapper.
 *
 * Lives in its own file so that doctrine topic files can import
 * directly from `./cite` rather than transiting through the index
 * barrel. The barrel pattern (`export *` from many topic files) plus
 * top-level `cite()` calls inside those topic files exposed a TDZ
 * bug under Turbopack/Next.js production bundling — the chunk could
 * end up calling cite() before the function declaration's `let`
 * binding was reached.
 *
 * Topic files: import { cite, type Cited } from './cite';
 * Consumers:   import { ... } from '@/coach/doctrine';   (still works
 *              via re-export in index.ts)
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

/** Identifiers for the structured research library at
 *  `/Volumes/WP/06 Claude Code/Runcino/Research/`. */
export type ResearchDocId =
  | '00a' | '00b'
  | '01' | '02' | '03' | '04'
  | '05' | '06' | '07' | '08'
  | '09' | '10' | '11' | '12'
  | '13' | '14' | '15' | '16'
  | '17' | '18' | '19'
  | '20' | '21' | '22'
  | '24';

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
  '24':  '24-vdot-age-sex-grading.md',
};

/** Convenience builder. Three forms:
 *
 *    cite('§3.1', 'snippet')                       → docs/coaching-research.md (legacy)
 *    cite('§3.1', 'snippet', 'amp')                → docs/amp-research.md (legacy)
 *    cite('§3', 'snippet', 'research', '01')       → Research/01-pace-zones-vdot.md (canonical)
 *
 *  Single arrow-fn implementation (not an overloaded function
 *  declaration) keeps Turbopack from emitting both a `function l`
 *  AND a `let l=` for the same name, which produced a TDZ error
 *  during page-data collection. */
export const cite = (
  section: string,
  snippet?: string,
  doc?: 'coaching' | 'amp' | 'research',
  researchDocId?: ResearchDocId,
): Citation => {
  if (doc === 'research') {
    if (!researchDocId) throw new Error(`cite() with 'research' requires a doc id (e.g. '01')`);
    return { doc: `Research/${RESEARCH_DOC_FILES[researchDocId]}`, section, snippet };
  }
  return {
    doc: doc === 'amp' ? 'docs/amp-research.md' : 'docs/coaching-research.md',
    section,
    snippet,
  };
};
