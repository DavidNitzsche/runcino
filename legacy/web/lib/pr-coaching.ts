/**
 * C5 · PR coaching lines
 *
 * Per-PR coaching copy on the /races Personal Records grid. Each PR
 * card carries a one-line classifier under the source pill, "Most
 * recent goal-distance effort", "Pre-cycle PR", etc.
 *
 * Consolidated here (was originally inline in app/races/page.tsx) so
 * the strings live alongside other coach-voice copy and can be
 * referenced from future surfaces (e.g., /profile Coach Reads if it
 * ever wants per-PR context, or V7 cross-references from L7 verdicts
 * to specific PR cards).
 *
 * VOICE (per lib/coach-voice.ts):
 *   Impersonal observation, these are data classifications, not
 *   coach verdicts addressed to the runner. No "you", no "we".
 *   Each line states what the PR IS (its role in the VDOT computation)
 *   and may include a short qualifier on its trustworthiness.
 *
 * RULE 2 NOTE:
 *   PR coaching lines are NOT adaptive verdicts, they're static
 *   classifications based on PR age + distance match. No falsifier
 *   required. (If the system ever starts WEIGHTING PRs adaptively
 *   based on a model output, that would change.)
 */

/** Four states a PR card can be in. */
export type PRRole =
  | 'goal-distance'    // Race PR at the goal distance, within current cycle.
  | 'pre-cycle'        // Race PR older than 12 weeks (still informs baseline).
  | 'adjacent-tier'    // Race PR at a non-goal distance (decaying evidence).
  | 'strava-effort';   // Strava-source training effort (not a race result).

/** Canonical coaching line per role.  Keys are stable; renderers
 *  import this map rather than hard-coding strings. */
export const PR_COACHING_LINES: Record<PRRole, string> = {
  'goal-distance':  'Your sharpest recent effort at this distance.',
  'pre-cycle':      'An older PR, still part of your story.',
  'adjacent-tier':  'A strong effort at another distance.',
  'strava-effort':  'A training best, race it to make it official.',
};

/** Threshold (days) above which a race PR is considered "pre-cycle". */
export const PRE_CYCLE_DAYS = 84;  // 12 weeks

/**
 * Classify a PR into one of the four roles.
 *
 *   classifyPR({ source: 'strava' })                      → 'strava-effort'
 *   classifyPR({ source: 'race', isGoalDistance: false }) → 'adjacent-tier'
 *   classifyPR({ source: 'race', isGoalDistance: true, ageDays: 30 })  → 'goal-distance'
 *   classifyPR({ source: 'race', isGoalDistance: true, ageDays: 200 }) → 'pre-cycle'
 *   classifyPR({ source: 'race', isGoalDistance: false, ageDays: 200 }) → 'pre-cycle'
 */
export function classifyPR(args: {
  source: 'race' | 'strava';
  isGoalDistance?: boolean;
  ageDays?: number | null;
}): PRRole {
  if (args.source === 'strava') return 'strava-effort';
  const isPreCycle = args.ageDays != null && args.ageDays > PRE_CYCLE_DAYS;
  if (isPreCycle) return 'pre-cycle';
  if (args.isGoalDistance) return 'goal-distance';
  return 'adjacent-tier';
}

/** Look up the coaching line for a role. Thin wrapper but documents
 *  the canonical surface, future callers import this rather than
 *  reaching into PR_COACHING_LINES directly. */
export function coachingLineForPR(role: PRRole): string {
  return PR_COACHING_LINES[role];
}
