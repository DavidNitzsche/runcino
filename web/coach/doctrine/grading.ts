/**
 * Doctrine — VDOT age + sex grading.
 *
 * Source: Research/24-vdot-age-sex-grading.md.
 *
 * Layered on top of the absolute VDOT computation (Research/01).
 * Pace prescription is always keyed off raw VDOT — grading exists
 * to give the runner context ("how strong is this for my age?")
 * and to support tier interpretation in the brief voice.
 *
 * Two layers:
 *   1. Age-grading — Daniels-style per-decade VDOT decline,
 *      simplified pending full WMA-table integration.
 *   2. Sex-cohort context — VDOT offset to communicate where the
 *      runner sits in their sex distribution.
 *
 * The full World Masters Athletics tables are the gold standard
 * and are the right long-term replacement; this module ships an
 * approximation good enough for surfacing age-graded VDOT today.
 */

import { cite, type Cited } from './cite';

export type RunnerSex = 'male' | 'female' | 'unspecified';

// ── Age decline (men, simplified Daniels model) ───────────────────

/** Per-year VDOT decline rate by age decade. Cumulative decline
 *  from age 30 is the sum of per-year rates across the elapsed
 *  decades. */
export const VDOT_AGE_DECLINE_MALE: Cited<Array<{
  loAge: number;        // inclusive
  hiAge: number;        // exclusive (Infinity for last bucket)
  perYearVdot: number;  // VDOT points lost per year in this band
  rationale: string;
}>> = {
  value: [
    { loAge: 0,  hiAge: 30, perYearVdot: 0,    rationale: 'Peak performance window. No age adjustment.' },
    { loAge: 30, hiAge: 40, perYearVdot: 0.3,  rationale: 'Gradual VO2max + economy decline begins.' },
    { loAge: 40, hiAge: 50, perYearVdot: 0.6,  rationale: 'Faster decline as recovery + adaptation rates slow.' },
    { loAge: 50, hiAge: 60, perYearVdot: 0.9,  rationale: 'Steeper decline; recovery cost compounds.' },
    { loAge: 60, hiAge: 70, perYearVdot: 1.2,  rationale: 'Larger drops typical without specific masters training.' },
    { loAge: 70, hiAge: Infinity, perYearVdot: 1.5, rationale: 'Substantial year-over-year decline expected.' },
  ],
  note: 'Daniels-extrapolated per-year decline for men. Non-linear because both VO2max and running economy degrade with age, and the rate of degradation accelerates after 50. Replaces full WMA tables until those are vendored.',
  citations: [
    cite('Age decline — male', 'Per-year VDOT decline rate by age decade for men, Daniels-extrapolated. Used to compute age-graded VDOT.', 'research', '24'),
  ],
};

/** Per-year VDOT decline rate by age decade for women. Slightly
 *  shallower in the 30-50 window, slightly steeper post-50. */
export const VDOT_AGE_DECLINE_FEMALE: Cited<Array<{
  loAge: number;
  hiAge: number;
  perYearVdot: number;
  rationale: string;
}>> = {
  value: [
    { loAge: 0,  hiAge: 30, perYearVdot: 0,    rationale: 'Peak performance window. No age adjustment.' },
    { loAge: 30, hiAge: 40, perYearVdot: 0.25, rationale: 'Slightly more gradual than men in this band.' },
    { loAge: 40, hiAge: 50, perYearVdot: 0.5,  rationale: 'Pre-menopause window; decline still gradual.' },
    { loAge: 50, hiAge: 60, perYearVdot: 1.0,  rationale: 'Post-menopause hormonal shifts steepen the decline.' },
    { loAge: 60, hiAge: 70, perYearVdot: 1.3,  rationale: 'Continued steeper-than-male trajectory.' },
    { loAge: 70, hiAge: Infinity, perYearVdot: 1.6, rationale: 'Substantial decline; women lose ground faster than men past 70.' },
  ],
  note: 'Per-year VDOT decline rates for women, adjusted for the menopausal transition shifting the steepest decline window from 50→60+.',
  citations: [
    cite('Age decline — female', 'Per-year VDOT decline rate by age decade for women, accounting for menopausal transition shifting the steepest-decline window.', 'research', '24'),
  ],
};

/** Compute cumulative VDOT decline from age 30 for a given (age, sex).
 *  Returns 0 for runners under 30 (peak window) or unspecified sex. */
export function ageDeclineFromThirty(age: number, sex: RunnerSex): number {
  if (age <= 30) return 0;
  if (sex === 'unspecified') {
    // Average the male/female curves when sex is unset — reasonable
    // midpoint that doesn't make an assumption.
    return (ageDeclineFromThirty(age, 'male') + ageDeclineFromThirty(age, 'female')) / 2;
  }
  const table = sex === 'female' ? VDOT_AGE_DECLINE_FEMALE.value : VDOT_AGE_DECLINE_MALE.value;
  let cumulative = 0;
  for (const band of table) {
    if (age <= band.loAge) break;                     // before this band
    const yearsInBand = Math.min(age, band.hiAge) - band.loAge;
    cumulative += yearsInBand * band.perYearVdot;
    if (age <= band.hiAge) break;                     // ended in this band
  }
  return Math.round(cumulative * 10) / 10;            // 1 decimal
}

// ── Sex-cohort context ────────────────────────────────────────────

/** Sex-cohort offset for tier interpretation. Open-class tier
 *  ranges (Research/01) are anchored on the male distribution; for
 *  women, add the offset before mapping to a tier label. */
export const VDOT_SEX_COHORT_OFFSET: Cited<Record<RunnerSex, number>> = {
  value: {
    male:        0,
    female:      7,    // women's elite ceiling is ~7 VDOT below men's
    unspecified: 0,
  },
  note: 'Offset applied for sex-cohort tier interpretation only. Pace prescription remains keyed off raw VDOT for everyone — these offsets affect framing/tier labels, not pace targets.',
  citations: [
    cite('Sex-cohort offset', 'Approximate VDOT delta between men\'s and women\'s elite ceilings (7 points). Used to shift tier labels into the appropriate sex-cohort interpretation.', 'research', '24'),
  ],
};

// ── Public API ─────────────────────────────────────────────────────

export interface VdotGrading {
  /** Raw VDOT — drives pace prescription. */
  raw: number;
  /** Age-graded VDOT — what an open-class (age 30) runner would
   *  need to match this performance. Used for self-comparison and
   *  voice framing only. */
  ageGraded: number | null;
  /** Sex-cohort-adjusted VDOT — used for tier interpretation when
   *  communicating "where does this fit in your cohort." */
  sexCohortVdot: number | null;
  /** Runner age at evaluation. */
  age: number | null;
  /** Runner sex. */
  sex: RunnerSex;
  /** Brief explanation of how the grade was computed (for the
   *  Coach voice + dashboard tooltip). */
  rationale: string;
}

/** Compute the full grading bundle for a VDOT score. When age is
 *  unknown, age-graded VDOT is null (we don't guess). When sex is
 *  unspecified, sex-cohort VDOT is null. */
export function gradeVdot(rawVdot: number, age: number | null, sex: RunnerSex): VdotGrading {
  let ageGraded: number | null = null;
  if (age != null && age > 0) {
    ageGraded = Math.round((rawVdot + ageDeclineFromThirty(age, sex)) * 10) / 10;
  }
  let sexCohortVdot: number | null = null;
  if (sex !== 'unspecified') {
    sexCohortVdot = rawVdot + VDOT_SEX_COHORT_OFFSET.value[sex];
  }
  // Build a one-line rationale the dashboard can show on hover.
  const parts: string[] = [];
  if (ageGraded != null && age != null && age > 30) {
    parts.push(`age ${age}: +${(ageGraded - rawVdot).toFixed(1)} VDOT for age-grading`);
  }
  if (sexCohortVdot != null && sex === 'female') {
    parts.push(`women\'s cohort: +${VDOT_SEX_COHORT_OFFSET.value.female} VDOT for tier framing`);
  }
  const rationale = parts.length === 0
    ? 'Open-class fitness — same number means the same physiological work for everyone.'
    : parts.join(' · ');

  return { raw: rawVdot, ageGraded, sexCohortVdot, age, sex, rationale };
}
