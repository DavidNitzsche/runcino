/**
 * Per-state gradient + accent mapping.
 *
 * The resolver returns a `state` enum and a `poster.gradient_token` string.
 * This module is the SINGLE place client code maps that token → the CSS
 * variable. Components never compute this themselves.
 *
 * Why centralize: a gradient rename is a one-line change here, not a
 * search-and-replace across components.
 *
 * Cardinal Rule #4 · single source of truth for state → token mapping.
 */

import type { DayState } from './types';

/**
 * State → CSS gradient variable. Reads via `var()` at render time so
 * the regenerated theme.css picks up token changes without code edits.
 */
export const STATE_GRADIENT_VAR: Record<DayState, string> = {
  easy: 'var(--g-easy)',
  quality: 'var(--g-quality)',
  long: 'var(--g-long)',
  rest: 'var(--g-rest)',
  done_nailed: 'var(--g-done)',
  // done-ease-off: faded amber · same amber-start as --g-missed but a
  // cooler/quieter terminal stop (reflective "honest read", not directive
  // "pick one"). Design lifted this from the web-today-states-2026-05-27
  // deck into design/tokens/colors.css per Sprint 02 Flag 2 (Path A).
  done_ease_off: 'var(--g-ease)',
  niggle: 'var(--g-niggle)',
  sick: 'var(--g-sick)',
  missed: 'var(--g-missed)',
  race_week: 'var(--g-race)',
  new_user: 'var(--g-new)',
  // skipped: muted slate-purple ("you chose this"). Distinct from --g-missed
  // (amber-burn, "you let time run out") and --g-sick (overcast slate,
  // health-coded). Token: --g-skip in /design/tokens/colors.css. P-SKIP 2026-05-28.
  skipped: 'var(--g-skip)',
};

/**
 * State → eyebrow chip color logic per design/resolver/states.md.
 * Reserved for future use (eyebrow currently inherits ink via the
 * Poster's gradient overlay).
 */
export const STATE_LABEL: Record<DayState, string> = {
  easy: 'EASY',
  quality: 'QUALITY',
  long: 'LONG RUN',
  rest: 'REST DAY',
  done_nailed: 'COMPLETED',
  done_ease_off: 'COMPLETED',
  niggle: 'NIGGLE WATCH',
  sick: 'BODY FIGHTING',
  missed: 'MISSED',
  race_week: 'RACE WEEK',
  new_user: 'WELCOME',
  skipped: 'SKIPPED',
};
