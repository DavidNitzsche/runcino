/**
 * Doctrine §10, Cadence and running form.
 *
 * Extracted from docs/coaching-research.md §10.1, §10.2, §10.3.
 * The 180-spm "rule" is myth; cadence intervention helps a specific
 * subset of runners.
 */
import { cite, type Cited } from './cite';

/** Natural cadence ranges by pace. */
export const NATURAL_CADENCE_BY_PACE: Cited<{
  easy: { low: number; high: number };
  tempo: { low: number; high: number };
  fiveK: { low: number; high: number };
  sprint: { low: number };
}> = {
  value: {
    easy:   { low: 160, high: 175 },
    tempo:  { low: 170, high: 185 },
    fiveK:  { low: 180, high: 195 },
    sprint: { low: 200 },
  },
  note: 'The 180 spm "rule" came from Daniels counting elites at race pace at the 1984 Olympics. He never claimed it as a universal target.',
  citations: [
    cite('§10.1', 'Easy runs naturally produce 160 to 175 spm. … Tempo runs naturally produce 170 to 185 spm. … 5K race pace produces 180 to 195 spm. … Sprint speeds exceed 200 spm.'),
    cite('§10.1', 'The "180 steps per minute" number originated with Jack Daniels'),
  ],
};

/** When cadence intervention actually pays off. */
export const CADENCE_INTERVENTION: Cited<{
  /** Below this spm at meaningful pace, intervention is high-leverage. */
  threshold_high_leverage_below_spm: number;
  /** Below this spm, overstriding is almost certain. */
  threshold_overstriding_below_spm: number;
  /** Heiderscheit 2011: this much cadence increase reduces impact loading. */
  recommended_cadence_increase_pct_low: number;
  recommended_cadence_increase_pct_high: number;
  /** Past this %, metabolic cost climbs without further benefit. */
  diminishing_returns_above_pct: number;
  /** Resulting impact loading reduction. */
  impact_loading_reduction_pct_low: number;
  impact_loading_reduction_pct_high: number;
}> = {
  value: {
    threshold_high_leverage_below_spm: 165,
    threshold_overstriding_below_spm: 160,
    recommended_cadence_increase_pct_low: 5,
    recommended_cadence_increase_pct_high: 10,
    diminishing_returns_above_pct: 10,
    impact_loading_reduction_pct_low: 10,
    impact_loading_reduction_pct_high: 20,
  },
  note: 'A 5–10 % cadence increase reduces impact loading 10–20 % without meaningful metabolic penalty. Past 10 %, metabolic cost climbs.',
  citations: [
    cite('§10.2', 'a 5 to 10 percent increase from natural cadence reduces impact loading by 10 to 20 percent without a meaningful metabolic penalty'),
    cite('§10.2', 'The runners who genuinely benefit from cadence intervention are those whose natural cadence sits below 165 spm at any meaningful pace.'),
    cite('§10.2', 'Below 160 spm, overstriding is almost certain.'),
  ],
};

/** Form work that consistently helps, independent of cadence. */
export const FORM_WORK_PRIORITIES: Cited<string[]> = {
  value: [
    'hip extension and glute activation',
    'core stability',
    'calf and Achilles strength',
    'strides and hill sprints',
  ],
  note: 'The most form-improving work most runners can do is more strides, not more form drills in isolation.',
  citations: [cite('§10.3', 'Form work that consistently helps')],
};
