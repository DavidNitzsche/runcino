/**
 * lib/brain/proposal/action.ts · THE GENERALIZED ACTION SCHEMA.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * `plan_workout_proposals.action_payload` carried three fields: `newType`,
 * `newDate`, `shaveFraction`. The accept route rebuilt exactly those three. So
 * the one runner-consented channel this engine has could express "make it a
 * different type", "move it", and "make it shorter", and nothing else.
 *
 * A pace change had nowhere to live. A dose change had nowhere to live. A
 * coordinated change across several rows had nowhere to live. The audit's
 * verdict was that even with the authority seam open, most levers still could
 * not travel: **the propose lane structurally could not carry them.**
 *
 * That is the constraint this file removes. Every action a coaching decision
 * can reach for is a member of one versioned union, and a member that cannot
 * be executed or rendered is caught by a gate rather than discovered by a
 * runner staring at a card that does nothing.
 *
 * ── THE TWO RULES THE SHAPE ENFORCES ───────────────────────────────────────
 *
 * 1 · **Every action carries its BEFORE.** A proposal raised on Tuesday must
 *     not mutate a plan that changed on Wednesday. `before` is not decoration:
 *     `staleAgainst()` compares it to the live row and refuses.
 *
 * 2 · **Direction is a property of the action, not of the prose.** An engine
 *     that cannot say whether it is asking for more or less cannot be audited
 *     for the asymmetry CLAUDE.md Rule 21 measures, and that is exactly how
 *     "309 intents, zero upward" survived.
 */

/** Bumped when a member changes shape. A stored payload names the version it was written under. */
export const ACTION_SCHEMA_VERSION = 1 as const;

/** More work, less work, or neither. Every member declares one. */
export type ActionDirection = 'MORE' | 'LESS' | 'NEUTRAL' | 'STOP';

/** The quantity a change is expressed in, so a renderer never guesses units. */
export type Quantity =
  | { readonly unit: 'mi'; readonly value: number }
  | { readonly unit: 'min'; readonly value: number }
  | { readonly unit: 'sec_per_mi'; readonly value: number }
  | { readonly unit: 'reps'; readonly value: number }
  | { readonly unit: 'count'; readonly value: number };

/**
 * One plan row an action touches, with the values it expects to find.
 *
 * EVERY FIELD BUT THE ID IS OPTIONAL, and that is Rule 11 rather than
 * convenience. Three states, not two:
 *
 *   absent (`undefined`) · the proposal did not record this field, so there is
 *                          nothing to compare and its silence is not evidence
 *                          the plan changed.
 *   `null`               · recorded, and the value was genuinely nothing — a
 *                          rest day's distance, an easy run's pace target.
 *                          Compared, and a live value where this says null IS
 *                          a change.
 *   a value              · recorded and compared.
 *
 * The distinction is load-bearing. Proposals written before the action schema
 * carry no `planVersion` at all; treating that absence as a mismatch would have
 * marked every existing card stale and made the Accept button refuse
 * everything, which is a worse failure than the one staleness prevents.
 */
export interface RowBefore {
  readonly planWorkoutId: string;
  readonly dateISO?: string;
  readonly type?: string;
  readonly distanceMi?: number | null;
  readonly paceTargetSecPerMi?: number | null;
  /** The plan version this was read from. A rebuild changes it. */
  readonly planVersion?: string | null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE UNION · every action a coaching decision can reach for
 * ═══════════════════════════════════════════════════════════════════════ */

interface ActionBase {
  readonly schemaVersion: typeof ACTION_SCHEMA_VERSION;
  readonly direction: ActionDirection;
  /** Every row this action expects to find, as it expects to find it. */
  readonly before: readonly RowBefore[];
}

export type BrainAction =
  | (ActionBase & { kind: 'PACE_CHANGE'; to: Quantity; lever: 'THRESHOLD' | 'MARATHON' | 'INTERVAL' | 'EASY' })
  /**
   * `to` is the resulting distance, and is NULL when the decision was made
   * without one ("add to Thursday", target still to be sized). Null is not
   * zero: `plannedWrites` refuses an unsized change rather than writing a
   * zero-mile session, which is Rule 11 on the one field that would silently
   * delete a run.
   *
   * `ofBefore` is the PROPORTION the decision was actually expressed in, when
   * it was. A cut is decided as "take 17% off" and only then priced in miles;
   * recording just the miles throws away the sentence the runner should read.
   */
  | (ActionBase & { kind: 'DISTANCE_CHANGE'; to: Quantity | null; ofBefore?: number })
  | (ActionBase & { kind: 'DURATION_CHANGE'; to: Quantity })
  | (ActionBase & { kind: 'REPETITION_CHANGE'; to: Quantity })
  | (ActionBase & { kind: 'RECOVERY_INTERVAL_CHANGE'; to: Quantity })
  | (ActionBase & { kind: 'QUALITY_DOSE_CHANGE'; to: Quantity; lever: 'THRESHOLD' | 'MARATHON' | 'INTERVAL' })
  | (ActionBase & { kind: 'LONG_RUN_STRUCTURE_CHANGE'; to: string; describe: string })
  | (ActionBase & { kind: 'WORKOUT_TYPE_CHANGE'; to: string })
  | (ActionBase & { kind: 'ADD_WORKOUT'; dateISO: string; type: string; distanceMi: number })
  | (ActionBase & { kind: 'REMOVE_WORKOUT' })
  | (ActionBase & { kind: 'FREQUENCY_CHANGE'; to: Quantity })
  | (ActionBase & { kind: 'RESCHEDULE'; toDateISO: string; swapWithId: string | null })
  /**
   * Several rows changing together, as ONE decision the runner answers once.
   * A pace re-anchor touches every future quality row; offering that as
   * seventy separate cards would be a worse product than offering none.
   */
  | (ActionBase & { kind: 'COORDINATED'; describe: string; parts: readonly BrainAction[] })
  | (ActionBase & { kind: 'RACE_TARGET_CHANGE'; raceSlug: string; toSecPerMi: number })
  | (ActionBase & { kind: 'TAPER_CHANGE'; describe: string })
  | (ActionBase & { kind: 'RECOVERY_CHANGE'; describe: string })
  /** A future prescription that is not decided yet. Carries what would earn it. */
  | (ActionBase & { kind: 'CONDITIONAL'; defaultTo: Quantity; earnedTo: Quantity; assessOnISO: string })
  | (ActionBase & { kind: 'FIELD_TEST'; describe: string })
  /** The engine deliberately declining to change anything, recorded so it is visible. */
  | (ActionBase & { kind: 'HOLD'; because: string })
  | (ActionBase & { kind: 'REFUSAL'; because: string })
  /** Safety. Never overridden by the optimisation target. */
  | (ActionBase & { kind: 'SAFETY_STOP'; because: string; until: string | null });

export type ActionKind = BrainAction['kind'];

/**
 * The least an action must say for the card to know which way it points.
 *
 * A full `BrainAction` satisfies this structurally. It exists so the legacy
 * engine-kind adapter can ask the SAME direction function without first having
 * to resolve a payload it may not have — the alternative was a second
 * five-kind switch on the surface, which is what went silent when the engine
 * learnt a sixth kind.
 */
export interface ActionShape {
  readonly kind: ActionKind;
  readonly direction: ActionDirection;
  /** Only read for WORKOUT_TYPE_CHANGE, where rest/recovery is not a pull-back. */
  readonly to?: unknown;
}

/** Every kind, so a gate can assert a renderer and an executor exist for each. */
export const ALL_ACTION_KINDS: readonly ActionKind[] = [
  'PACE_CHANGE', 'DISTANCE_CHANGE', 'DURATION_CHANGE', 'REPETITION_CHANGE',
  'RECOVERY_INTERVAL_CHANGE', 'QUALITY_DOSE_CHANGE', 'LONG_RUN_STRUCTURE_CHANGE',
  'WORKOUT_TYPE_CHANGE', 'ADD_WORKOUT', 'REMOVE_WORKOUT', 'FREQUENCY_CHANGE',
  'RESCHEDULE', 'COORDINATED', 'RACE_TARGET_CHANGE', 'TAPER_CHANGE',
  'RECOVERY_CHANGE', 'CONDITIONAL', 'FIELD_TEST', 'HOLD', 'REFUSAL', 'SAFETY_STOP',
];

/** Kinds that change nothing and exist to make a judgement visible (Rule 11). */
export const NON_MUTATING_KINDS: ReadonlySet<ActionKind> =
  new Set<ActionKind>(['HOLD', 'REFUSAL', 'SAFETY_STOP']);

/* ══════════════════════════════════════════════════════════════════════════
 * STALENESS · a proposal raised against one plan may not mutate another
 * ═══════════════════════════════════════════════════════════════════════ */

export interface LiveRow {
  readonly planWorkoutId: string;
  readonly dateISO: string;
  readonly type: string;
  readonly distanceMi: number | null;
  readonly paceTargetSecPerMi: number | null;
  readonly planVersion: string | null;
}

export type StalenessVerdict =
  | { readonly stale: false }
  | { readonly stale: true; readonly why: string };

/**
 * Would applying this action write over something that has since changed?
 *
 * The failure this prevents is quiet and expensive: a proposal sits pending for
 * three days, the runner rebuilds his block, then taps Accept and the engine
 * writes a decision made about a plan that no longer exists.
 *
 * A MISSING row is stale, not absent-and-fine (Rule 11): the row this was about
 * is gone, and applying to nothing is not the same as applying.
 */
export function staleAgainst(
  action: BrainAction,
  live: ReadonlyMap<string, LiveRow>,
): StalenessVerdict {
  for (const b of action.before) {
    const now = live.get(b.planWorkoutId);
    if (now === undefined) {
      return { stale: true, why: `workout ${b.planWorkoutId} no longer exists in the plan` };
    }
    if (b.planVersion !== undefined && now.planVersion !== b.planVersion) {
      return {
        stale: true,
        why: `the plan changed since this was raised (${b.planVersion ?? 'unversioned'} to `
          + `${now.planVersion ?? 'unversioned'})`,
      };
    }
    if (b.dateISO !== undefined && now.dateISO !== b.dateISO) {
      return { stale: true, why: `workout ${b.planWorkoutId} moved to ${now.dateISO}` };
    }
    if (b.type !== undefined && now.type !== b.type) {
      return { stale: true, why: `workout ${b.planWorkoutId} is now a ${now.type}` };
    }
    if (b.distanceMi !== undefined && numChanged(now.distanceMi, b.distanceMi)) {
      return { stale: true, why: `workout ${b.planWorkoutId} is now ${String(now.distanceMi)} mi` };
    }
    if (b.paceTargetSecPerMi !== undefined
      && numChanged(now.paceTargetSecPerMi, b.paceTargetSecPerMi)) {
      return { stale: true, why: `workout ${b.planWorkoutId}'s pace target changed` };
    }
  }
  if (action.kind === 'COORDINATED') {
    for (const part of action.parts) {
      const v = staleAgainst(part, live);
      if (v.stale) return v;
    }
  }
  return { stale: false };
}

/** Null and a number are different facts; two numbers compare on value. */
function numChanged(a: number | null, b: number | null): boolean {
  if (a === null && b === null) return false;
  if (a === null || b === null) return true;
  return Math.abs(a - b) > 0.001;
}

/* ══════════════════════════════════════════════════════════════════════════
 * LIFECYCLE
 * ═══════════════════════════════════════════════════════════════════════ */

export type ProposalStatus =
  | 'pending' | 'accepted' | 'declined' | 'deferred'
  | 'expired' | 'applied' | 'superseded' | 'undone' | 'failed';

/** Which transitions are legal. A status machine nobody can read is a status field. */
export const LEGAL_TRANSITIONS: Readonly<Record<ProposalStatus, readonly ProposalStatus[]>> = {
  pending: ['accepted', 'declined', 'deferred', 'expired', 'superseded'],
  deferred: ['pending', 'expired', 'superseded'],
  accepted: ['applied', 'failed'],
  applied: ['undone', 'superseded'],
  failed: ['pending', 'expired'],
  declined: [],
  expired: [],
  superseded: [],
  undone: [],
};

export function transitionAllowed(from: ProposalStatus, to: ProposalStatus): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}
