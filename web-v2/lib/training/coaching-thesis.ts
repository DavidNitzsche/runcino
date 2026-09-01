/**
 * lib/training/coaching-thesis.ts · THE COACHING THESIS.
 *
 * `docs/BRAIN_CONSTITUTION.md` §F:
 *
 *     "Owns: what are we currently trying to accomplish with this runner?
 *      The strategic bridge between fitness and planning."
 *
 * This file is the smallest version of that opinion that is still real —
 * computed from the Runner Model's own canonical capacities, never invented,
 * never persisted.
 *
 * ── WHAT THIS CONSUMES, AND WHAT IT DOES NOT CALCULATE ──────────────────────
 *
 * §F is explicit: "Does NOT calculate fitness — consumes canonical Runner
 * Model outputs." This resolver calls `resolveThresholdCapacity`,
 * `resolveHighIntensityCapacity` and `resolveDurability` from
 * `lib/training/capacity-resolver.ts` (THE Runner Model layer, per
 * Constitution §C) and reads nothing else about fitness. It does not touch
 * `resolveEasyCeiling` — easy running is a boundary with feel-based
 * guidance, not one of the three capacities a coaching strategy trades off
 * against each other (§33).
 *
 * It also does not touch `lib/adaptation/*` or any race-prediction module.
 *
 * ── THE DEFECT THIS FILE WAS REWRITTEN TO REMOVE (2026-09-01) ───────────────
 *
 * The first version of `rankCapacities` normalized every capacity's
 * confidence against its OWN reachable ceiling before comparing them:
 * THRESHOLD and DURABILITY by `directCeiling` (0.90), HIGH_INTENSITY by
 * `fallbackCeiling` (0.50), because HIGH_INTENSITY has no direct-evidence
 * reader and 0.50 is all it can ever score. The intent was decent — stop a
 * reader-less capacity being permanently blamed. The effect was not.
 *
 * HIGH_INTENSITY's confidence is `fallbackConfidence(anchorDate, today) =
 * 0.20 + 0.30 · 2^(−days/28)`, so its NORMALIZED value was
 * `0.4 + 0.6 · 2^(−days/28)` — a pure function of the age of the best recent
 * VDOT anchor run, a quantity with nothing whatever to do with 3-5K ability.
 * Against the owner's THRESHOLD standing the limiter flipped between anchor
 * age 9 days and 10 days, and it was observed flipping live:
 *
 *     2026-08-31   anchor 48 d old   HI normalized 0.583   limiter HIGH_INTENSITY
 *     2026-09-01   anchor  0 d old   HI normalized 1.000   limiter THRESHOLD
 *
 * Overnight, with no high-intensity session run and no high-intensity
 * evidence gained, the app's stated top training priority changed — because
 * a THRESHOLD run refreshed a VDOT anchor. That is CLAUDE.md Rule 9 exactly:
 * a categorical change in what the plan emphasises, hinging on a hair, on an
 * unrelated clock. (`docs/reports/independent-coaching-system-audit-2026-09-01/
 * G-real-run-traces.md` §3 is the trace.)
 *
 * ── THE FIX, AND WHY IT IS A REFUSAL RATHER THAN A BETTER SCORE ─────────────
 *
 * Rule 11: "don't know", "measured zero" and "the read failed" are three
 * facts, never one. A capacity with no direct, inferred or race-derived
 * reader has not been LOOKED AT. Giving it a score — any score, however
 * cleverly normalized — turns "we did not look" into "we looked and found
 * weakness", and the audit measured that becoming a negative finding roughly
 * half the time, with the half decided by the calendar.
 *
 * So a capacity resolved at `vdot_fallback`, `user_prior` or
 * `population_prior` is UNRANKABLE (`NO_DIRECT_READER`) and can never be the
 * primary limiter. The ranking runs among the rest, on their OWN resolved
 * confidences, with no normalization of any kind — a capacity may not be
 * promoted toward the limiter slot because its reachable ceiling is
 * structurally low. And `primaryLimiter` may be `UNKNOWN`, which is the
 * honest answer for a runner with no evidenced capacity at all; a refusal is
 * a correct answer, a confident limiter picked off a fallback rung is not.
 *
 * `CoachingThesis.confidence` is therefore `number | null`, and
 * `CapacityStanding`'s unrankable branch carries NO `confidence` field at
 * all, so `standing.confidence` does not compile until the caller has
 * branched — the same Rule 11-as-a-type discipline `DurabilityComponent<T>`
 * and `NormalReading<T>` already enforce.
 *
 * ── WHAT "PRIMARY LIMITER" MEANS HERE, ARGUED RATHER THAN ASSUMED ───────────
 *
 * §F's own worked example ties limiter directly to priority:
 * `primary_limiter: DURABILITY` → `priority: increase_long_run_demand`. With
 * no race-prediction layer built to ask "what caps this runner's race time"
 * (Constitution §J is unimplemented), the honest computed reading available
 * TODAY is: **among the capacities the Runner Model has actually looked at,
 * the one it knows least about.** That is a narrower claim than "X is weak",
 * and it is stated as such: `basis` says
 * `LOWEST_CONFIDENCE_AMONG_EVIDENCED`, never "lowest capacity".
 *
 * It is nonetheless a legitimate coaching priority, and it is now free of
 * the artefact above: every capacity in the comparison has runner-specific
 * evidence behind it, so a low confidence means thin evidence about THIS
 * RUNNER, not a missing reader in the engine.
 *
 * ── DURABILITY'S SUB-READS, CONSUMED AND REPORTED, NEVER RE-CLASSIFIED ──────
 *
 * `resolveDurability` reports `sourceMode: 'direct'` whenever decoupling
 * corroborated, EVEN IF `raceExponent` is absent — in which case
 * `enduranceExponent` is `POPULATION_ENDURANCE_PRIOR` and says nothing about
 * this runner. Admitting DURABILITY on `sourceMode` alone would therefore
 * repeat the very bug this rewrite removes, one level down. So the DURABILITY
 * standing carries the sub-reads straight through — the race exponent's own
 * fitted value beside the population prior it is measured against, and the
 * decoupling reading — and nothing that talks about durability may claim a
 * personal exponent the runner does not have.
 *
 * WHAT IS DELIBERATELY NOT DONE HERE: no "durability is above / below
 * neutral" VERDICT. Turning `1.0869 vs 1.06` into a categorical strength or
 * weakness needs a band around the prior, and no `Research/` file states one
 * — a bare point comparison would be a fresh Rule 9 cliff, and an invented
 * band would be a physiology-asserting constant needing a Rule 7 registry
 * entry it cannot honestly get. The numbers are reported so a caller (or a
 * human) can see them; the verdict is not manufactured. Named here rather
 * than silently absent, per Rule 22.
 *
 * ── HONESTY ABOUT CONFIDENCE (Rule 32, §27) ──────────────────────────────────
 *
 * `confidence` on the returned thesis is NOT a new, fifth score. It is the
 * primary limiter's own resolved `confidence`, passed through unchanged, from
 * the one owning resolver for that capacity, and `null` when there is no
 * limiter. `evidenceIds` is the same pass-through — never invented.
 *
 * ── ONE VOICE (Rule 16, Rule 17) ───────────────────────────────────────────
 *
 * `coachLine` is composed HERE, once, from the structured fields above it,
 * and every surface quotes it rather than writing its own sentence about the
 * same facts. Constitution §P: "UI displays intelligence. UI does not create
 * intelligence." Today's "why this run" and the Block screen's strategy line
 * are the two consumers, and neither composes a second explanation.
 *
 * ── COMPUTE AT READ TIME (Rule 10), NO PERSISTED SNAPSHOT ────────────────────
 *
 * Nothing here is written to a row. Every call re-derives from the capacity
 * resolvers (which themselves recompute from `runs`/`races`/`profile`) and
 * from the runner's own current-week `plan_workouts`. `resolvedAt` is
 * stamped so a value that travels into a response body says when it was true.
 *
 * ── WHAT THIS CANNOT CATCH, STATED RATHER THAN HIDDEN (Rule 22) ─────────────
 *
 *   · HIGH_INTENSITY is unrankable for EVERY runner today, because
 *     `resolveHighIntensityCapacity` has no direct rung at all. That is not
 *     this file deciding speed does not matter; it is this file refusing to
 *     rank a capacity nothing has read. The moment a direct high-intensity
 *     reader lands, the same code ranks it with no edit, and
 *     `reconsiderIf` says so as a concrete trigger.
 *   · The ranking's tie-break order (THRESHOLD, DURABILITY, HIGH_INTENSITY)
 *     is a stated convention, not a research finding.
 *   · `addressedBy` reads the runner's OWN authored week, not the ideal one —
 *     an empty list is a true, useful finding, never papered over with a
 *     fabricated session.
 *   · Durability's "family" match for `addressedBy` is `is_long`, which is a
 *     coarse proxy. The finer classification belongs to the Activity
 *     Interpreter (`lib/evidence/activity-evidence.ts`).
 *   · A session that MATCHES the limiter's family is not necessarily a
 *     session that can EVIDENCE it: appendix E Finding 7 found the week's one
 *     credited high-intensity session was hill reps with
 *     `pace_target_s_per_mi = NULL`, structurally incapable of producing pace
 *     evidence. `AddressedSession.serves` says `MATCHES_LIMITER_FAMILY` and
 *     nothing stronger, precisely so no caller can read family match as proof
 *     of evidence value.
 */

import { pool } from '@/lib/db/pool';
import { loadSettings } from '@/lib/coach/settings';
import { weekWindowFor } from '@/lib/coach/week-window';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { readSelectionRationale } from '@/lib/plan/progression-spec';
import { POPULATION_ENDURANCE_PRIOR } from '@/lib/training/durability-anchor';
import {
  resolveThresholdCapacity,
  resolveHighIntensityCapacity,
  resolveDurability,
  type ThresholdCapacityEstimate,
  type HighIntensityCapacityEstimate,
  type DurabilityCapacityEstimate,
  type SourceMode,
} from '@/lib/training/capacity-resolver';

/** The three capacities Coaching Thesis trades off against each other — the
 *  Runner Model's own set (§33), minus the easy-ceiling boundary (see file
 *  header for why easy is excluded). */
export type PrimaryCapacity = 'THRESHOLD' | 'HIGH_INTENSITY' | 'DURABILITY';

/** The limiter, or the honest refusal. Rule 11: "no evidenced capacity" is a
 *  fact of its own, not a capacity picked off the weakest rung. */
export type ThesisLimiter = PrimaryCapacity | 'UNKNOWN';

/** How the primary limiter was picked, or why it could not be. */
export type ThesisBasis =
  | 'LOWEST_CONFIDENCE_AMONG_EVIDENCED'
  | 'NO_EVIDENCED_CAPACITY';

/** Why a capacity was excluded from the ranking. One value today; typed as a
 *  union so a future second exclusion is a real second value and not a silent
 *  redefinition of this one. */
export type UnrankableReason = 'NO_DIRECT_READER';

/**
 * The source modes that mean a capacity has been LOOKED AT with evidence
 * belonging to this runner.
 *
 * `direct` — the runner's own classified training, corroborated.
 * `inferred` — a demonstrated pace read through a conversion.
 * `race_derived` — anchored on a race result, which BRIEF 06 makes PRIMARY
 * evidence for durability rather than a fallback for it.
 *
 * Everything below these — `vdot_fallback`, `user_prior`, `population_prior` —
 * is the engine answering from a scalar, a typed-in number, or nothing.
 */
export const RANKABLE_SOURCE_MODES: readonly SourceMode[] =
  Object.freeze(['direct', 'inferred', 'race_derived'] as const);

export function isRankableSourceMode(mode: SourceMode): boolean {
  return RANKABLE_SOURCE_MODES.includes(mode);
}

/** Structured, never prose (§27) — the coach-voice sentence set is composed
 *  from these in ONE place (`composeCoachLine`), so an explanation cannot
 *  drift from what the resolver actually did. */
export type ThesisReasonCode =
  | 'LOWEST_CONFIDENCE_AMONG_EVIDENCED'
  | 'NO_EVIDENCED_CAPACITY'
  | 'CAPACITY_UNRANKABLE_NO_DIRECT_READER'
  | 'LIMITER_HAS_DIRECT_EVIDENCE'
  | 'LIMITER_EVIDENCE_IS_INDIRECT'
  | 'KEY_SESSION_PRESENT_THIS_WEEK'
  | 'NO_KEY_SESSION_THIS_WEEK'
  | 'NO_ACTIVE_PLAN';

/** What the coach is trying to do next. §F's own vocabulary. */
export type ThesisPriority =
  | 'increase_threshold_demand'
  | 'increase_high_intensity_demand'
  | 'increase_long_run_demand'
  | 'establish_evidence_before_prioritising';

/** Why a capacity is not this block's emphasis. */
export type HeldConstantCode =
  | 'BETTER_EVIDENCED_THAN_THE_LIMITER'
  | 'NOT_LOOKED_AT_NO_DIRECT_READER';

/** Concrete, checkable conditions that would move the limiter on a future
 *  resolve. Structured, so a surface can render them without parsing prose. */
export type ReviewTriggerCode =
  | 'LIMITER_CONFIDENCE_OVERTAKEN'
  | 'UNRANKABLE_GAINS_A_DIRECT_READER'
  | 'NEW_RACE_RESULT';

export const COACHING_THESIS_MODEL_VERSION = '2.0.0';

/**
 * Durability's two sub-observations, passed straight through from
 * `resolveDurability` so a reader of this thesis can see whether the
 * durability standing rests on the runner's OWN race curve or only on
 * decoupling with the population prior standing in for the exponent.
 *
 * `raceExponent` is null when `DurabilityCapacityEstimate.raceExponent`
 * refuses — which is a different fact from "the exponent equals the prior",
 * and is exactly the collapse Rule 11 forbids. `populationPrior` is carried
 * beside it so the comparison needs no second import at the call site, and no
 * verdict is derived from the pair here (see file header).
 */
export interface DurabilitySubReads {
  /** The runner's own fitted Riegel exponent, or null when no fit is
   *  supported. NEVER the population prior wearing this field's name. */
  raceExponent: number | null;
  /** `POPULATION_ENDURANCE_PRIOR`, the neutral value the fit is measured
   *  against. A constant, carried for comparison, never a measurement. */
  populationPrior: number;
  /** Mean pace/HR drift across qualifying long runs, percentage points, or
   *  null when the read could not corroborate. */
  decouplingPct: number | null;
}

/**
 * One capacity's position, or its argued exclusion.
 *
 * RULE 11 AS A TYPE. The unrankable branch carries no `confidence`, so
 * `standing.confidence` does not compile until the caller has branched on
 * `rankable`. A capacity nothing has read and a capacity read at low
 * confidence are opposite facts, and the whole point of this rewrite is that
 * the previous shape let one be spent as the other.
 */
export type CapacityStanding =
  | {
      capacity: PrimaryCapacity;
      rankable: true;
      /** The owning resolver's own confidence, unchanged. Never normalized,
       *  never rescaled — see the file header. */
      confidence: number;
      sourceMode: SourceMode;
      /** DURABILITY only. */
      durability?: DurabilitySubReads;
    }
  | {
      capacity: PrimaryCapacity;
      rankable: false;
      reason: UnrankableReason;
      sourceMode: SourceMode;
      durability?: DurabilitySubReads;
    };

/** A session on the runner's OWN current-week plan whose FAMILY speaks to the
 *  primary limiter — never invented; absent entirely when the week carries
 *  none. */
export interface AddressedSession {
  planWorkoutId: string;
  dateIso: string;
  type: string;
  subLabel: string | null;
  /**
   * The catalogue selector's own real "why this one, not the alternatives"
   * line, read straight off `workout_spec.selection_rationale`
   * (RATIONALE-PERSIST-1). `null` on a row authored before that field
   * existed, or on a day a generic trajectory (not the catalogue) filled.
   */
  selectionRationale: string | null;
  /**
   * The strength of the claim, and deliberately the weakest true one. A
   * family match is NOT proof the session can produce evidence for the
   * capacity — see the file header's last bullet.
   */
  serves: 'MATCHES_LIMITER_FAMILY';
}

export interface HeldConstant {
  capacity: PrimaryCapacity;
  code: HeldConstantCode;
  /** One line, structured-adjacent: what is true of this capacity right now.
   *  Not coach voice; `coachLine` is the coach voice. */
  note: string;
}

export interface ReviewTrigger {
  code: ReviewTriggerCode;
  /** The concrete, checkable condition, with the live numbers in it. */
  detail: string;
}

export interface CoachingThesis {
  /** Among the capacities the Runner Model has actually looked at, the one it
   *  knows least about — or `UNKNOWN` when it has looked at none. */
  primaryLimiter: ThesisLimiter;
  basis: ThesisBasis;
  priority: ThesisPriority;
  /** The runner's own authored sessions this week whose family speaks to the
   *  primary limiter. A real, honest empty array when none do, and always
   *  empty when the limiter is `UNKNOWN`. */
  addressedBy: AddressedSession[];
  /** Every capacity that is NOT the emphasis, with the reason it is not. */
  heldConstant: HeldConstant[];
  /** 0..1, the primary limiter's OWN resolved confidence — not a new score.
   *  `null` when the limiter is `UNKNOWN`: Rule 11, there is no number to
   *  report and a zero would read as certainty about nothing. */
  confidence: number | null;
  /** Traceable to the limiter's own underlying observations — a direct
   *  pass-through of that capacity's `evidenceIds`, never fabricated. Empty
   *  when the limiter is `UNKNOWN`. */
  evidenceIds: string[];
  reasons: ThesisReasonCode[];
  reconsiderIf: ReviewTrigger[];
  /** Every capacity's position or exclusion, so the pick is auditable without
   *  re-deriving it. Rankable ones first, ascending by confidence. */
  standings: CapacityStanding[];
  /**
   * THE one composed coach-voice sentence set, built from the structured
   * fields above. Every surface quotes this; none writes its own. No em
   * dashes, no exclamation marks, no interpuncts, two sentences.
   */
  coachLine: string;
  resolvedAt: string;
  modelVersion: string;
}

/** Deterministic tie-break: the two capacities with a real direct-evidence
 *  rung come first, alphabetically stable otherwise. Argued, not derived. */
const TIE_BREAK_ORDER: PrimaryCapacity[] = ['THRESHOLD', 'DURABILITY', 'HIGH_INTENSITY'];

/** The runner-facing word for each capacity. One place, so the coach line and
 *  any future surface cannot drift (Rule 16). */
const CAPACITY_WORD: Record<PrimaryCapacity, string> = {
  THRESHOLD: 'threshold',
  HIGH_INTENSITY: 'speed',
  DURABILITY: 'durability',
};

function durabilitySubReads(durability: DurabilityCapacityEstimate): DurabilitySubReads {
  return {
    raceExponent: durability.raceExponent.present ? durability.raceExponent.value : null,
    populationPrior: POPULATION_ENDURANCE_PRIOR,
    decouplingPct: durability.decoupling.present ? durability.decoupling.value : null,
  };
}

/**
 * The standings. NO NORMALIZATION OF ANY KIND — see the file header for the
 * defect that removing it fixes.
 *
 * Rankable capacities sort ascending by their own resolved confidence (least
 * known first, so `standings[0]` is the limiter when there is one). Unrankable
 * capacities follow, in tie-break order, and can never reach the front.
 */
export function rankCapacities(
  threshold: ThresholdCapacityEstimate,
  highIntensity: HighIntensityCapacityEstimate,
  durability: DurabilityCapacityEstimate,
): CapacityStanding[] {
  const subReads = durabilitySubReads(durability);
  const build = (
    capacity: PrimaryCapacity,
    estimate: { confidence: number; sourceMode: SourceMode },
  ): CapacityStanding =>
    isRankableSourceMode(estimate.sourceMode)
      ? {
          capacity,
          rankable: true,
          confidence: estimate.confidence,
          sourceMode: estimate.sourceMode,
          ...(capacity === 'DURABILITY' ? { durability: subReads } : {}),
        }
      : {
          capacity,
          rankable: false,
          reason: 'NO_DIRECT_READER',
          sourceMode: estimate.sourceMode,
          ...(capacity === 'DURABILITY' ? { durability: subReads } : {}),
        };

  const all: CapacityStanding[] = [
    build('THRESHOLD', threshold),
    build('DURABILITY', durability),
    build('HIGH_INTENSITY', highIntensity),
  ];

  return all.sort((a, b) => {
    if (a.rankable !== b.rankable) return a.rankable ? -1 : 1;
    if (a.rankable && b.rankable && a.confidence !== b.confidence) {
      return a.confidence - b.confidence;
    }
    return TIE_BREAK_ORDER.indexOf(a.capacity) - TIE_BREAK_ORDER.indexOf(b.capacity);
  });
}

/**
 * §F's worked example ties limiter to priority directly
 * (`DURABILITY → increase_long_run_demand`); this is that mapping.
 *
 * There is no `establish_X_evidence` posture any more, and its absence is the
 * point. A capacity only reaches this function once it has direct, inferred or
 * race-derived evidence, which is precisely the condition the old
 * "establish evidence first" branches existed to cover — the branch became
 * unreachable when `rankCapacities` started refusing to rank an unread
 * capacity, and Rule 26 (prefer deletion) applies. The unevidenced case is now
 * a limiter of `UNKNOWN` with `establish_evidence_before_prioritising`.
 */
export function priorityFor(limiter: ThesisLimiter): ThesisPriority {
  switch (limiter) {
    case 'DURABILITY': return 'increase_long_run_demand';
    case 'THRESHOLD': return 'increase_threshold_demand';
    case 'HIGH_INTENSITY': return 'increase_high_intensity_demand';
    case 'UNKNOWN': return 'establish_evidence_before_prioritising';
  }
}

function heldConstantFor(standing: CapacityStanding): HeldConstant {
  if (!standing.rankable) {
    return {
      capacity: standing.capacity,
      code: 'NOT_LOOKED_AT_NO_DIRECT_READER',
      note: `no direct, inferred or race-derived reader exists for this capacity yet `
        + `(resolved at ${standing.sourceMode}), so it is not ranked and is not being `
        + `called a weakness`,
    };
  }
  return {
    capacity: standing.capacity,
    code: 'BETTER_EVIDENCED_THAN_THE_LIMITER',
    note: `holding steady at confidence ${standing.confidence.toFixed(2)} `
      + `(${standing.sourceMode}), which is ahead of the limiter's`,
  };
}

/**
 * THE coach-voice sentence set. One composer, quoted by every surface
 * (Rule 16, Constitution §P).
 *
 * Two sentences, in doctrine §19's own order: what holds, then where the work
 * goes. No em dashes, no exclamation marks, no interpuncts, no engine
 * vocabulary — the structured fields carry the mechanics and this carries the
 * message. The "no direct reader" fact is deliberately NOT said here: it is an
 * engine gap rather than a coaching finding, it does not change what the
 * runner does next (`docs/PRODUCT_UX_SIMPLIFICATION_DOCTRINE.md`), and it is
 * already carried structurally in `heldConstant`.
 */
export function composeCoachLine(
  limiter: ThesisLimiter,
  heldConstant: HeldConstant[],
): string {
  if (limiter === 'UNKNOWN') {
    return 'There is not enough direct evidence yet to say which part of your fitness is '
      + 'holding you back. The next few weeks are about building that evidence rather '
      + 'than pushing one trait.';
  }
  const holds = heldConstant.find((h) => h.code === 'BETTER_EVIDENCED_THAN_THE_LIMITER');
  const work = `${CAPACITY_WORD[limiter].charAt(0).toUpperCase()}${CAPACITY_WORD[limiter].slice(1)}`
    + ' is where the work goes.';
  if (!holds) return work;
  return `Your ${CAPACITY_WORD[holds.capacity]} is the best evidenced part of your training `
    + `right now, so it holds. ${work}`;
}

/** The plan-day `type`/`is_long` shape that speaks to each capacity's
 *  family. Coarse by design — see file header's "WHAT THIS CANNOT CATCH". */
export function matchesCapacity(
  capacity: PrimaryCapacity,
  row: { type: string; is_long: boolean },
): boolean {
  if (capacity === 'DURABILITY') return row.is_long;
  if (capacity === 'THRESHOLD') return row.type === 'threshold' || row.type === 'tempo';
  return row.type === 'intervals';
}

function reviewTriggersFor(
  limiter: ThesisLimiter,
  standings: CapacityStanding[],
): ReviewTrigger[] {
  const triggers: ReviewTrigger[] = [];
  const rankable = standings.filter((s): s is Extract<CapacityStanding, { rankable: true }> => s.rankable);

  if (limiter !== 'UNKNOWN' && rankable.length >= 2) {
    const [primary, next] = rankable;
    triggers.push({
      code: 'LIMITER_CONFIDENCE_OVERTAKEN',
      detail: `${next.capacity}'s confidence (currently ${next.confidence.toFixed(2)}) `
        + `falls below ${primary.capacity}'s (currently ${primary.confidence.toFixed(2)})`,
    });
  }

  for (const s of standings) {
    if (s.rankable) continue;
    triggers.push({
      code: 'UNRANKABLE_GAINS_A_DIRECT_READER',
      detail: `${s.capacity} gains a direct, inferred or race-derived reader and becomes `
        + `rankable (it resolves at ${s.sourceMode} today, and the ranking admits nothing `
        + `below ${RANKABLE_SOURCE_MODES.join('/')})`,
    });
  }

  triggers.push({
    code: 'NEW_RACE_RESULT',
    detail: 'a new race result changes any capacity\'s sourceMode, which can both admit a '
      + 'capacity to the ranking and move the confidences already in it',
  });

  return triggers;
}

/**
 * THE canonical Coaching Thesis. §F's answer, computed, not templated.
 *
 * No goal parameter — same structural discipline `capacity-resolver.ts`
 * enforces on the four resolvers it owns (Constitution §6): a coaching
 * strategy about what the Runner Model currently knows least about must not
 * be able to see what the runner is chasing. Compute-at-read-time (Rule 10);
 * nothing here is persisted.
 */
export async function resolveCoachingThesis(
  userId: string,
  todayISO?: string,
): Promise<CoachingThesis> {
  const today = todayISO ?? await runnerToday(userId);
  const resolvedAt = new Date().toISOString();

  const [threshold, highIntensity, durability, settings] = await Promise.all([
    resolveThresholdCapacity(userId, today),
    resolveHighIntensityCapacity(userId, today),
    resolveDurability(userId, today),
    loadSettings(userId),
  ]);

  const standings = rankCapacities(threshold, highIntensity, durability);
  const primary = standings.find((s) => s.rankable) ?? null;
  const limiter: ThesisLimiter = primary ? primary.capacity : 'UNKNOWN';

  const estimateFor: Record<PrimaryCapacity, { confidence: number; evidenceIds: string[]; sourceMode: SourceMode }> = {
    THRESHOLD: threshold,
    HIGH_INTENSITY: highIntensity,
    DURABILITY: durability,
  };
  const primaryEstimate = limiter === 'UNKNOWN' ? null : estimateFor[limiter];

  const reasons: ThesisReasonCode[] = [
    limiter === 'UNKNOWN' ? 'NO_EVIDENCED_CAPACITY' : 'LOWEST_CONFIDENCE_AMONG_EVIDENCED',
  ];
  if (standings.some((s) => !s.rankable)) reasons.push('CAPACITY_UNRANKABLE_NO_DIRECT_READER');
  if (primaryEstimate) {
    reasons.push(
      primaryEstimate.sourceMode === 'direct'
        ? 'LIMITER_HAS_DIRECT_EVIDENCE'
        : 'LIMITER_EVIDENCE_IS_INDIRECT',
    );
  }

  const heldConstant = standings
    .filter((s) => s.capacity !== limiter)
    .map(heldConstantFor);

  // ── this week's own authored sessions, on the active plan only (Rule 14: a
  // query names the population it reads — the same "active, unarchived,
  // latest-authored" definition `lib/plan/week-loader.ts` uses for the
  // identical reason: an archived plan version's rows are not this week). ──
  const { startISO, endISO } = weekWindowFor(settings.long_run_day, today);
  const planRow = (await pool.query<{ id: string }>(
    `SELECT id FROM training_plans
      WHERE user_uuid = $1 AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [userId],
  )).rows[0];

  const addressedBy: AddressedSession[] = [];
  if (planRow) {
    if (limiter !== 'UNKNOWN') {
      const rows = (await pool.query<{
        id: string; date_iso: string; type: string; sub_label: string | null;
        is_long: boolean; workout_spec: unknown;
      }>(
        `SELECT id::text AS id, date_iso, type, sub_label, is_long, workout_spec
           FROM plan_workouts
          WHERE plan_id = $1
            AND date_iso::date BETWEEN $2::date AND $3::date
          ORDER BY date_iso ASC`,
        [planRow.id, startISO, endISO],
      )).rows;
      for (const row of rows) {
        if (!matchesCapacity(limiter, row)) continue;
        addressedBy.push({
          planWorkoutId: row.id,
          dateIso: row.date_iso,
          type: row.type,
          subLabel: row.sub_label,
          selectionRationale: readSelectionRationale(row.workout_spec),
          serves: 'MATCHES_LIMITER_FAMILY',
        });
      }
    }
  } else {
    reasons.push('NO_ACTIVE_PLAN');
  }
  reasons.push(addressedBy.length > 0 ? 'KEY_SESSION_PRESENT_THIS_WEEK' : 'NO_KEY_SESSION_THIS_WEEK');

  return {
    primaryLimiter: limiter,
    basis: limiter === 'UNKNOWN' ? 'NO_EVIDENCED_CAPACITY' : 'LOWEST_CONFIDENCE_AMONG_EVIDENCED',
    priority: priorityFor(limiter),
    addressedBy,
    heldConstant,
    confidence: primaryEstimate ? primaryEstimate.confidence : null,
    evidenceIds: primaryEstimate ? primaryEstimate.evidenceIds : [],
    reasons,
    reconsiderIf: reviewTriggersFor(limiter, standings),
    standings,
    coachLine: composeCoachLine(limiter, heldConstant),
    resolvedAt,
    modelVersion: COACHING_THESIS_MODEL_VERSION,
  };
}
