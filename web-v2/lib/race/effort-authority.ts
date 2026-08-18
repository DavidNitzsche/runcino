/**
 * lib/race/effort-authority.ts · the ANCHOR-FREE half of rule 8.
 *
 * `lib/race/representativeness.ts` diagnoses a race against an anchor: how much
 * of the gap between what the anchor predicted and what the runner ran is
 * explained by the day rather than by fitness. That question needs an anchor to
 * deviate from, so it belongs where an anchor exists — the two re-anchor
 * detectors in `lib/plan/adapt.ts`.
 *
 * SELECTION has no anchor. `bestRecentVdot` is choosing WHICH evidence anchors
 * the runner; asking "how far is this race from the anchor" there is circular.
 * But rule 8's model is not one question, it is three multiplied together:
 *
 *     authority = unexplained_fraction × effort_class × premise_gate
 *
 * Only the first term needs an anchor. EFFORT CLASS is a fact about the race
 * day — what the athlete set out to do and what they gave — and it transfers to
 * selection unchanged. That is what this module owns, and it is the term that
 * matters: `Research/00b` §"Recovery by Effort (A vs. B vs. C Race)" grades a C
 * race as "Strong effort, no taper … treat like a hard workout". A hard workout
 * with a number on it is not a field test.
 *
 * ── Why this file exists rather than a function in representativeness.ts ────
 *
 * `representativeness.ts` imports `predictRaceTime` from `lib/training/vdot.ts`.
 * Selection lives IN `vdot.ts`. Importing the other way would close a cycle
 * through the single hottest file in the fitness model, so the anchor-free
 * constants and mapping live here, in a leaf that imports only
 * `lib/plan/goal-tiers.ts` (itself a leaf with no imports at all).
 * `representativeness.ts` re-exports the two floors so there is exactly one
 * definition of each and every existing importer is unaffected.
 *
 * ── What selection deliberately does NOT charge ────────────────────────────
 *
 * Three factors the full diagnosis prices are absent here on purpose, each for
 * a stated reason rather than because they were hard:
 *
 *   · CONDITIONS (course, heat, humidity, wind, altitude, pacing). Every one is
 *     sized as a share of `observed_shortfall_pct`, which is measured against
 *     the anchor. With no anchor there is no denominator, and inventing one
 *     would be exactly the fabricated model this engine's doctrine gate exists
 *     to stop. A race distorted by its course still reports its own honest
 *     VDOT and still competes on it; what the course means is priced where an
 *     anchor exists. NAMED GAP: a materially net-downhill course therefore
 *     enters selection unpriced. It cannot be closed without either an anchor
 *     or a new model, and the re-anchor path already prices it.
 *
 *   · ILLNESS. The full model zeroes authority — a race run sick measures the
 *     illness. Zeroing at SELECTION would mean a runner whose only recent race
 *     was run sick has no anchor at all, which is worse than an under-reading
 *     anchor: an honest slow number prescribes work that is too easy, and no
 *     number at all falls through to a mileage guess that floors at VDOT 30
 *     (the P1-56 failure). Selection keeps the race; the re-anchor path refuses
 *     to move the model on it.
 *
 *   · UNCONFIRMED RESULT (`actual_result.provisional`). The full model zeroes it
 *     on the UPWARD limb only, because every residual error in a watch time
 *     biases fast. "Fast" is a direction, and a direction needs an anchor. At
 *     selection the same row is simply the best evidence the runner has, and it
 *     already entered the pool this way before any of this existed.
 *
 * ── Taper and fatigue ──────────────────────────────────────────────────────
 *
 * `effectiveEffortClass` in `representativeness.ts` downgrades a declared class
 * when the athlete raced on loaded legs or without a taper. Those inputs are
 * three database queries away and are not on a VDOT candidate, so selection
 * grades the DECLARED class. That is the conservative direction: a downgrade
 * can only ever lower authority, so grading declared-only can hold a race
 * ABOVE its true class but never below it. `EFFORT-AUTHORITY.agrees-with-the-
 * recovery-scale` in the doctrine registry pins the two mappings together on
 * the graded priorities so they cannot drift.
 */
import { RECOVERY_EFFORT_SCALE, recoveryEffortScale } from '@/lib/plan/goal-tiers';

/**
 * `Research/00b` §"Recovery by Effort (A vs. B vs. C Race)". The B row —
 * "Hard but not depleted; 1-week taper" — is doctrine's boundary between a
 * result that stands as a performance and one that carries a caveat. A read at
 * or above it is representative.
 */
export const REPRESENTATIVE_FLOOR = RECOVERY_EFFORT_SCALE.B;

/**
 * The C row — "Strong effort, no taper … treat like a hard workout" — is
 * doctrine's own marker for "this barely counts as a race". Below it a result
 * does not move the fitness model at all.
 */
export const UNREPRESENTATIVE_FLOOR = RECOVERY_EFFORT_SCALE.C;

/** The three bands the two doctrine floors cut authority into. */
export type AuthorityTier = 'representative' | 'compromised' | 'unrepresentative';

export function authorityTier(authority: number): AuthorityTier {
  if (!isFinite(authority)) return 'unrepresentative';
  if (authority >= REPRESENTATIVE_FLOOR) return 'representative';
  if (authority >= UNREPRESENTATIVE_FLOOR) return 'compromised';
  return 'unrepresentative';
}

/**
 * The priorities `Research/00b`'s effort table actually has a row for.
 *
 * `lib/faff/types.ts` also allows `'training_run'` and `'hilly_excluded'`, and
 * a row can carry any string a past import wrote. Neither of those is a race
 * priority; both are the app's own labels for a row that is not a graded race.
 */
export const GRADED_RACE_PRIORITIES = ['A', 'B', 'C'] as const;

export function isGradedRacePriority(priority: string | null | undefined): boolean {
  return (GRADED_RACE_PRIORITIES as readonly string[]).includes(
    String(priority ?? '').trim().toUpperCase(),
  );
}

/**
 * How much authority a race carries over the fitness model at SELECTION time,
 * from what a VDOT candidate already knows: its declared priority.
 *
 * A 1.0 · B 0.65 · C 0.35, straight off `Research/00b`'s recovery scale, which
 * is the same table `recoveryEffortScale` spends on recovery duration. Two
 * things being graded by one table is the point: the doc's own columns bind
 * "Effort given" and "Taper before" to the scale, so how much an effort proves
 * and how long it costs are two readings of one row.
 *
 * ── An UNGRADED priority is graded at the C row, not the A row ─────────────
 *
 * `recoveryEffortScale` maps anything unrecognised to A, and that default is
 * correct FOR RECOVERY: an unlabelled race is more likely a goal race than a
 * tune-up, and over-resting is the safe error. For AUTHORITY the safe error
 * runs the other way, and reusing the recovery default would be the exact bug
 * this module was written to prevent.
 *
 * Grading an ungraded row as an A race asserts what the A row says: "Maximum,
 * full taper, peak day". A row labelled `training_run` says the opposite in
 * words, and one labelled `hilly_excluded` says the course is doing the
 * talking. Doctrine's table has no row for either, and its lowest row — "treat
 * like a hard workout" — is the honest read for an entry the table cannot
 * place. So an ungraded race still counts, at the weight doctrine gives a hard
 * workout with a number on it.
 *
 * This is a CONVENTION about which doctrine row an ungraded label falls to, not
 * a physiological claim `Research/00b` makes; `EFFORT-AUTHORITY.ungraded-
 * priority-falls-to-the-lowest-graded-row` in the registry states the
 * properties it owes rather than pretending the doc names these labels.
 */
export function selectionAuthority(priority: string | null | undefined): number {
  if (!isGradedRacePriority(priority)) return RECOVERY_EFFORT_SCALE.C;
  return recoveryEffortScale(priority);
}
