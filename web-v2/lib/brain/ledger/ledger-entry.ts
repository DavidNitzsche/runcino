/**
 * lib/brain/ledger/ledger-entry.ts · WHAT A DECISION IS, AND HOW ITS DIRECTION
 * IS MEASURED RATHER THAN DECLARED.
 *
 * Pure. No database, no imports from the DB layer, so every judgement below can
 * be falsified without a Postgres instance. The store is `decision-ledger.ts`
 * next door and it contains no policy.
 *
 * ── WHY DIRECTION IS COMPUTED FROM THE SNAPSHOTS AND NEVER PASSED IN ───────
 *
 * `lib/plan/adaptation-log.ts` already named the hazard, about its own log:
 *
 *     "A caller that could label its own change would eventually label a
 *      downgrade 'adjustment', and the log would stop being evidence."
 *
 * It answered that by deriving direction from the ACTION KIND, which is a real
 * improvement and still a declaration — its own Rule 22 note admits the gap:
 * "a `shave` with a negative fraction would be logged DOWN and would raise
 * load. Direction is read from the action's declared intent, not from the rows
 * afterwards."
 *
 * This module closes that gap because it sits somewhere `adaptation-log.ts`
 * does not: inside `mutatePlan`, which holds the plan BEFORE and the plan
 * AFTER. So direction is read from the rows afterwards. `demandDelta` compares
 * the two snapshots on the two axes CLAUDE.md's mission statement names — "with
 * pace but also with volume" — and `directionOfDelta` turns that into UP, DOWN,
 * NEUTRAL or UNKNOWN.
 *
 * A caller cannot lie about this, because a caller does not supply it.
 *
 * ── RULE 11 · UNKNOWN IS A FOURTH ANSWER AND IT IS NOT NEUTRAL ─────────────
 *
 * NEUTRAL means "both snapshots were read and neither axis moved". UNKNOWN
 * means "there was no before-state to compare against" — an authorship, a
 * marked bypass, a refusal that never reached the plan. Collapsing those into
 * NEUTRAL would put fabricated no-change rows into the exact count Rule 21
 * exists to make trustworthy, which is the same defect measured from the other
 * end.
 *
 * ── RULE 22 · WHAT A GATE OVER THIS FILE CANNOT FAIL ON ────────────────────
 *
 * · WHETHER THE DECISION WAS RIGHT. It measures which way the plan moved. It
 *   has no opinion on whether that was the correct coaching answer.
 * · AN AUTHORSHIP. A rebuild has no comparable before-state — the outgoing
 *   block is a different length, a different phase mix and often a different
 *   race — so `demandDelta` refuses rather than comparing a 14-week new block
 *   against four remaining weeks of an old one and calling the difference a
 *   coaching direction. Authorship rows are UNKNOWN by construction, and a
 *   census that wants to know whether REBUILDS trend up needs a different
 *   measurement than this one.
 * · A CHANGE OUTSIDE `plan_workouts`. Direction is measured on prescribed
 *   distance and prescribed pace. A mutation that moves neither — a phase
 *   relabel, a week flag — reads NEUTRAL, correctly, and a mutation that
 *   changes training some other way is invisible here.
 * · WHETHER THE ROW WAS WRITTEN. That is `decision-ledger.ts`'s half, and it
 *   has its own gate.
 */

/* ══════════════════════════════════════════════════════════════════════════
 * THE CONTROLLED VOCABULARIES · these mirror the CHECK constraints in
 * db/migrations/166_plan_decision_ledger.sql exactly, and
 * `_decision_ledger.test.ts` asserts they still do.
 * ═══════════════════════════════════════════════════════════════════════ */

export type LedgerScope = 'PLAN' | 'WEEK' | 'WORKOUT' | 'NONE';

export type LedgerLever =
  | 'PACE'
  | 'VOLUME'
  | 'LONG_RUN'
  | 'SESSION_SHAPE'
  | 'SCHEDULE'
  | 'PLAN_STRUCTURE'
  | 'RECORD_ONLY';

export type LedgerDirection = 'UP' | 'DOWN' | 'NEUTRAL' | 'UNKNOWN';

export type LedgerDecision =
  | 'PROGRESS'
  | 'HOLD'
  | 'REGRESS'
  | 'REFUSE'
  | 'APPLY'
  | 'DEFER'
  | 'EXPIRE'
  | 'UNDO';

export type LedgerAuthorityVerdict = 'PERMITTED' | 'REFUSED' | 'HELD';

export type LedgerRunnerResponse = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED';

/**
 * How much to trust the estimate a decision rested on.
 * `docs/DOCTRINE_ENFORCEMENT_AND_CLEAN_IMPLEMENTATION.md` requires every
 * estimate to carry one "so downstream code knows how much to trust it".
 */
export type LedgerSourceMode =
  | 'DIRECT'
  | 'INFERRED'
  | 'RACE_DERIVED'
  | 'VDOT_FALLBACK'
  | 'USER_PRIOR'
  | 'POPULATION_PRIOR';

export const LEDGER_SCOPES: readonly LedgerScope[] = ['PLAN', 'WEEK', 'WORKOUT', 'NONE'];
export const LEDGER_LEVERS: readonly LedgerLever[] = [
  'PACE', 'VOLUME', 'LONG_RUN', 'SESSION_SHAPE', 'SCHEDULE', 'PLAN_STRUCTURE', 'RECORD_ONLY',
];
export const LEDGER_DIRECTIONS: readonly LedgerDirection[] = ['UP', 'DOWN', 'NEUTRAL', 'UNKNOWN'];
export const LEDGER_DECISIONS: readonly LedgerDecision[] = [
  'PROGRESS', 'HOLD', 'REGRESS', 'REFUSE', 'APPLY', 'DEFER', 'EXPIRE', 'UNDO',
];

/**
 * THE MODEL VERSION OF THE MUTATION BOUNDARY ITSELF.
 *
 * Every ledger row carries the version of the thing that decided. When a
 * caller knows its own engine version it passes that; when it does not, this
 * is the honest answer, because the boundary is what classified the write.
 * Bump it when the boundary's own classification changes meaning — not for an
 * unrelated edit, or the field stops being a version and becomes a timestamp.
 */
export const PLAN_MUTATION_BOUNDARY_MODEL_VERSION = 'plan-mutation-boundary/2026-09-05';

/* ══════════════════════════════════════════════════════════════════════════
 * THE ROW
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * One decision. Every field exists because its absence made a real question
 * unanswerable — the same standard `CanonicalDecisionRecord` set for itself.
 */
export interface LedgerEntry {
  readonly userUuid: string;

  /* plan lineage · required, not an afterthought */
  readonly planId: string | null;
  readonly planLineageId: string;
  readonly replacedPlanId: string | null;
  readonly planVersion: string | null;

  /* workout scope */
  readonly scope: LedgerScope;
  readonly workoutIds: readonly string[];
  readonly scopeFromISO: string | null;
  readonly scopeToISO: string | null;

  /* the axis and which way it moved */
  readonly lever: LedgerLever;
  readonly direction: LedgerDirection;

  /* evidence and provenance */
  readonly evidence: readonly unknown[];
  /** The named write site. Same vocabulary as `plan_mutation_rejections.source`. */
  readonly provenance: string;
  readonly sourceMode: LedgerSourceMode | null;

  /* before and after */
  readonly beforeState: unknown | null;
  readonly afterState: unknown | null;

  /* authority */
  readonly authority: string;
  readonly authorityVerdict: LedgerAuthorityVerdict;
  readonly hold: { owner: string; blocker: string; expiresWhen: string } | null;

  /* the decision, the proposal, the answer */
  readonly decision: LedgerDecision;
  readonly proposalId: string | null;
  readonly proposal: unknown | null;
  readonly runnerResponse: LedgerRunnerResponse | null;

  /* what happened to the plan */
  readonly mutationOutcome: string | null;
  readonly mutationViolations: readonly string[];

  /* the account of itself */
  readonly explanation: string;
  readonly modelVersion: string;
  readonly idempotencyKey: string | null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * MEASURING THE MOVE
 * ═══════════════════════════════════════════════════════════════════════ */

/** The minimum a snapshot row has to carry for this file to read it. */
export interface DemandRow {
  readonly id: string;
  readonly week_id?: string | null;
  readonly date_iso: string;
  readonly distance_mi?: number | null;
  readonly pace_target_s_per_mi?: number | null;
}

/**
 * How the prescription moved, on the two axes the mission statement names.
 *
 * `paceSecPerMi` is the change in the MEAN prescribed pace over the days that
 * carry one, and its sign is deliberately inverted relative to the raw seconds:
 * a smaller seconds-per-mile is a FASTER prescription, so `paceSecPerMi > 0`
 * means the plan asks for more. Storing the raw delta and inverting at every
 * reader is how two surfaces end up disagreeing about which way a number
 * points (Rule 16).
 */
export interface DemandDelta {
  readonly distanceMi: number;
  readonly paceSecPerMi: number;
  readonly changedWorkoutIds: readonly string[];
  /** False when there was no comparable before-state. Direction is UNKNOWN. */
  readonly comparable: boolean;
}

const ROUND = (n: number, dp: number): number => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

const num = (v: number | null | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/**
 * Compare two plan snapshots.
 *
 * `comparable` is false when the before-state is empty, which is exactly the
 * authorship and marked-bypass cases. It is NOT false for an empty after-state:
 * a mutation that deleted every workout moved demand a very long way down and
 * saying "unknown" about that would be the worst possible answer.
 */
export function demandDelta(
  before: readonly DemandRow[],
  after: readonly DemandRow[],
): DemandDelta {
  if (before.length === 0) {
    return {
      distanceMi: 0,
      paceSecPerMi: 0,
      changedWorkoutIds: after.map((r) => r.id).sort(),
      comparable: false,
    };
  }

  const sumMi = (rows: readonly DemandRow[]): number =>
    rows.reduce((s, r) => s + (num(r.distance_mi) ?? 0), 0);

  const meanPace = (rows: readonly DemandRow[]): number | null => {
    const paced = rows.map((r) => num(r.pace_target_s_per_mi)).filter((p): p is number => p != null);
    if (paced.length === 0) return null;
    return paced.reduce((s, p) => s + p, 0) / paced.length;
  };

  const beforePace = meanPace(before);
  const afterPace = meanPace(after);

  // A pace axis exists only when BOTH sides carry one. Comparing "some days had
  // a pace" against "no day had a pace" is a data-presence fact, not a coaching
  // direction, and reading it as one is the shape Rule 9's `scheduledMi >= 5`
  // defect took: a threshold standing in for a question it cannot ask.
  const paceDelta =
    beforePace != null && afterPace != null ? beforePace - afterPace : 0;

  const key = (r: DemandRow): string =>
    `${r.date_iso}|${num(r.distance_mi) ?? 'null'}|${num(r.pace_target_s_per_mi) ?? 'null'}`;
  const beforeById = new Map(before.map((r) => [r.id, key(r)]));
  const afterById = new Map(after.map((r) => [r.id, key(r)]));
  const changed = new Set<string>();
  for (const [id, k] of afterById) if (beforeById.get(id) !== k) changed.add(id);
  for (const id of beforeById.keys()) if (!afterById.has(id)) changed.add(id);

  return {
    distanceMi: ROUND(sumMi(after) - sumMi(before), 2),
    paceSecPerMi: ROUND(paceDelta, 1),
    changedWorkoutIds: [...changed].sort(),
    comparable: true,
  };
}

/**
 * Below this, a move is noise rather than a decision.
 *
 * 0.05 mi is a quarter of the smallest distance any writer in this engine
 * rounds to (`distance_mi` is stored to one decimal), so it cannot mask a real
 * change and it does absorb float drift from summing a hundred rows. 0.5 s/mi
 * is likewise half the smallest unit any pace writer produces.
 *
 * Rule 9 · this is a NOISE FLOOR, not a behavioural cliff: nothing downstream
 * behaves differently either side of it except the LABEL on a log row, and the
 * quantities themselves are recorded exactly, unrounded, in `after_state`.
 */
export const DEMAND_NOISE_MI = 0.05;
export const DEMAND_NOISE_SEC_PER_MI = 0.5;

/**
 * Which way the plan moved.
 *
 * VOLUME leads, because it is the axis with the larger effect on load and the
 * one a runner feels first. Pace decides only when volume did not move, which
 * is exactly the `'derivations'` mutation: a re-anchor moves every pace and no
 * distance.
 */
export function directionOfDelta(d: DemandDelta): LedgerDirection {
  if (!d.comparable) return 'UNKNOWN';
  if (d.distanceMi > DEMAND_NOISE_MI) return 'UP';
  if (d.distanceMi < -DEMAND_NOISE_MI) return 'DOWN';
  if (d.paceSecPerMi > DEMAND_NOISE_SEC_PER_MI) return 'UP';
  if (d.paceSecPerMi < -DEMAND_NOISE_SEC_PER_MI) return 'DOWN';
  return 'NEUTRAL';
}

/** Which axis actually moved, for a reader asking "pace or volume?". */
export function leverOfDelta(d: DemandDelta): LedgerLever {
  if (!d.comparable) return 'PLAN_STRUCTURE';
  const movedMi = Math.abs(d.distanceMi) > DEMAND_NOISE_MI;
  const movedPace = Math.abs(d.paceSecPerMi) > DEMAND_NOISE_SEC_PER_MI;
  if (movedMi) return 'VOLUME';
  if (movedPace) return 'PACE';
  if (d.changedWorkoutIds.length > 0) return 'SESSION_SHAPE';
  return 'RECORD_ONLY';
}

/**
 * How far this decision reached.
 *
 * WEEK requires every changed row to sit in ONE `week_id`. A change spread over
 * two weeks is a PLAN-scope change even when it touched two rows, because a
 * reader asking "what did this week's coaching do" must not be handed a row
 * that also moved next week.
 */
export function scopeOfChange(
  after: readonly DemandRow[],
  changedIds: readonly string[],
): { scope: LedgerScope; fromISO: string | null; toISO: string | null } {
  if (changedIds.length === 0) return { scope: 'NONE', fromISO: null, toISO: null };
  const ids = new Set(changedIds);
  const rows = after.filter((r) => ids.has(r.id));
  const dates = rows.map((r) => r.date_iso).filter(Boolean).sort();
  const fromISO = dates[0] ?? null;
  const toISO = dates[dates.length - 1] ?? null;

  if (changedIds.length === 1) return { scope: 'WORKOUT', fromISO, toISO };
  // Rows the after-snapshot no longer contains (a delete) have no week to fall
  // in, so a mutation that removed rows is PLAN scope rather than being scored
  // on the subset that survived.
  if (rows.length !== changedIds.length) return { scope: 'PLAN', fromISO, toISO };
  const weeks = new Set(rows.map((r) => r.week_id ?? ''));
  if (weeks.size === 1 && !weeks.has('')) return { scope: 'WEEK', fromISO, toISO };
  return { scope: 'PLAN', fromISO, toISO };
}
