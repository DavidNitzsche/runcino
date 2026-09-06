/**
 * lib/runner-state/store/quantity-loaders.ts · THE THREE "DOSE" QUANTITIES
 * DAVID NAMED THAT HAVE NO `belief.ts` KEY.
 *
 * `THRESHOLD_DOSE`, `INTERVAL_DOSE` and `MARATHON_PACE_DOSE` are `QuantityId`s
 * in `quantity-owners.ts`, not `BeliefKey`s in `belief.ts` — and that split is
 * deliberate, not a gap this file should paper over. Each one is a
 * PRESCRIPTION CEILING: a pure, deterministic function of the runner's
 * weekly-volume belief and a doctrine table, not itself a fact with its own
 * independent evidence ledger. Inventing a 21st `BeliefKey` for "how many
 * miles at threshold pace may one session hold" would fail `belief.ts`'s own
 * §34 test the header quotes: "does this require a NEW BELIEF, or is it
 * merely NEW EVIDENCE — or a computed ceiling — ABOUT an existing one?"
 * Almost always the second, and here it plainly is: the ceiling has no
 * evidence of its own, it is arithmetic over evidence
 * `SUSTAINABLE_WEEKLY_VOLUME` already carries.
 *
 * So these are stored as `registry: 'QUANTITY'` rows (`write.ts#stampQuantity`),
 * keyed by `QuantityId`, carrying the WEEKLY-VOLUME belief's own confidence,
 * evidence, recency, Rule 8 side and levers FORWARD — the ceiling moves
 * exactly when, and only when, the belief that feeds it moves, so it is only
 * as trustworthy as the weekly-mileage figure behind it rather than a formula
 * inventing its own confidence, rule8Side or levers from nothing.
 *
 * Every value below is produced by calling the registry's own OWNER
 * function, named in `quantity-owners.ts`. Nothing here re-derives a formula
 * quantity-owners.ts does not already attribute to that exact site.
 *
 * ── WHY "LONG-RUN STRUCTURE" IS NOT HERE ────────────────────────────────────
 *
 * `LONG_RUN_DISTANCE`'s share-of-week half is `LONG_RUN_MAX_SHARE_OF_WEEK`,
 * and quantity-owners.ts names its OWNER as
 * `lib/adaptation/canonical/evaluate.ts`, inside the WALLED canonical
 * adaptation engine. That wall enforces its own import allowlist
 * (`_zero_mutation_scan.test.ts` guard 3, `_cannot_mutate.test.ts` /
 * `_never_mutates_plan.test.ts` guard 4 — "nothing outside imports this
 * engine except the enumerated authorized entry points"), and this
 * directory is not on it. A first draft imported the constant directly and
 * three gates outside this session's scope correctly failed. Adding this
 * file to those gates' allowlists is a decision for whoever owns the wall,
 * not a belief-store wiring pass — and the two SECOND answers the registry
 * also lists for this quantity (`lib/workout-catalogue/select.ts` at 0.30,
 * `lib/plan/adjudication/cold-start.ts` at 0.30) both disagree with the
 * OWNER's 0.35, so spending either of them here would mean stamping a value
 * that is not the one `ownership.ts` calls canonical — exactly the
 * thirteenth-owner shape this store must not produce. Left unwired and named
 * here rather than faked.
 */
import { atPaceSessionCapMi, AT_PACE_SESSION_MI } from '@/lib/prescription/levers';
import { MARATHON_PACE_WORKOUT_CAP } from '@/lib/plan/dosing';
import type {
  Belief, BeliefEstimate, BeliefImmovable, BeliefLever, EvidenceRecency, EvidenceRef, Rule8Side,
} from '../belief';
import type { Measured } from '@/lib/adaptation/canonical/input';
import type { QuantityId } from '../quantity-owners';

export interface QuantityReading {
  readonly quantityId: QuantityId;
  readonly reading: Measured<BeliefEstimate<number>>;
  readonly confidence: number | null;
  readonly sourceMode: string | null;
  readonly supporting: readonly EvidenceRef[];
  readonly owner: { readonly module: string; readonly symbol: string; readonly answers: string };
  readonly computedAtISO: string;
  readonly recency: EvidenceRecency | null;
  readonly rule8Side: Rule8Side;
  readonly movesUpOn: readonly BeliefLever[];
  readonly movesDownOn: readonly BeliefLever[];
  readonly neverMovesOn: readonly BeliefImmovable[];
}

const DOSE_OWNERS: Readonly<Record<'THRESHOLD_DOSE' | 'INTERVAL_DOSE' | 'MARATHON_PACE_DOSE', { module: string; symbol: string; answers: string }>> = {
  THRESHOLD_DOSE: { module: 'lib/prescription/levers.ts', symbol: 'atPaceSessionCapMi', answers: 'min(weeklyMi × 0.10, AT_PACE_SESSION_MI.threshold.max)' },
  INTERVAL_DOSE: { module: 'lib/prescription/levers.ts', symbol: 'atPaceSessionCapMi', answers: 'min(weeklyMi × 0.08, AT_PACE_SESSION_MI.interval.max)' },
  MARATHON_PACE_DOSE: { module: 'lib/plan/dosing.ts', symbol: 'MARATHON_PACE_WORKOUT_CAP', answers: 'min(18, weeklyMi × 0.20)' },
};

/**
 * Derive the three dose ceilings from the already-resolved weekly volume
 * belief. When the belief is not `ok`, every ceiling inherits the SAME
 * refusal rather than substituting a default weekly mileage — a ceiling
 * computed off an invented number would be worse than refusing (Rule 11).
 */
export function quantitiesFromWeeklyVolume(
  weeklyVolume: Belief<number>,
): readonly QuantityReading[] {
  const now = new Date().toISOString();
  const shared = {
    rule8Side: weeklyVolume.rule8Side,
    movesUpOn: weeklyVolume.movesUpOn,
    movesDownOn: weeklyVolume.movesDownOn,
    neverMovesOn: weeklyVolume.neverMovesOn,
  };

  if (!weeklyVolume.reading.ok) {
    const upstreamWhy = weeklyVolume.reading.why;
    // `Readability`'s `READ` member carries no `what` and cannot legally
    // appear here (it pairs with `ok: true` elsewhere in the union), but the
    // type does not encode that — so this branch names it rather than
    // crashing on a field that is not there (Rule 11 applied to this file's
    // own defensive code).
    const upstreamMessage = upstreamWhy.kind === 'READ'
      ? 'upstream reading carried no message (unexpected READ state on a refusal)'
      : upstreamWhy.what;
    const why = {
      kind: upstreamWhy.kind === 'READ' ? 'FAILED' as const : upstreamWhy.kind,
      what: `derived from SUSTAINABLE_WEEKLY_VOLUME: ${upstreamMessage}`,
    };
    return (['THRESHOLD_DOSE', 'INTERVAL_DOSE', 'MARATHON_PACE_DOSE'] as const).map((id) => ({
      quantityId: id,
      reading: { ok: false, why },
      confidence: null,
      sourceMode: null,
      supporting: [],
      owner: DOSE_OWNERS[id],
      computedAtISO: now,
      recency: null,
      ...shared,
    }));
  }

  const weeklyMi = weeklyVolume.reading.value.best;
  const base = {
    confidence: weeklyVolume.confidence,
    sourceMode: weeklyVolume.sourceMode,
    supporting: weeklyVolume.supporting,
    computedAtISO: now,
    recency: weeklyVolume.recency,
    ...shared,
  };

  const thresholdDoseMi = atPaceSessionCapMi(weeklyMi, 'threshold');
  const intervalDoseMi = atPaceSessionCapMi(weeklyMi, 'interval');
  const marathonDoseMi = Math.min(
    MARATHON_PACE_WORKOUT_CAP.absMi,
    weeklyMi * MARATHON_PACE_WORKOUT_CAP.pctOfWeekly,
  );

  return [
    {
      quantityId: 'THRESHOLD_DOSE',
      reading: { ok: true, value: { best: thresholdDoseMi, range: { low: 0, high: AT_PACE_SESSION_MI.threshold.max } } },
      owner: DOSE_OWNERS.THRESHOLD_DOSE,
      ...base,
    },
    {
      quantityId: 'INTERVAL_DOSE',
      reading: { ok: true, value: { best: intervalDoseMi, range: { low: 0, high: AT_PACE_SESSION_MI.interval.max } } },
      owner: DOSE_OWNERS.INTERVAL_DOSE,
      ...base,
    },
    {
      quantityId: 'MARATHON_PACE_DOSE',
      reading: { ok: true, value: { best: marathonDoseMi, range: { low: 0, high: MARATHON_PACE_WORKOUT_CAP.absMi } } },
      owner: DOSE_OWNERS.MARATHON_PACE_DOSE,
      ...base,
    },
  ];
}
