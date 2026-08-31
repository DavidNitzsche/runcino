/**
 * lib/training/coaching-thesis.ts · THE COACHING THESIS.
 *
 * `docs/BRAIN_CONSTITUTION.md` §F names a domain with no implementation
 * anywhere in the codebase (confirmed by two prior audits, and again by
 * `docs/reports/workout-provenance-trace-2026-09-01.md` §11: "Searched
 * `web-v2/lib`, `web-v2/app` and `web-v2/components` for `CoachingThesis`,
 * `coachingThesis` and `coaching-thesis`: zero matches... there is no
 * strategic layer in this app that has an opinion about what this Tuesday
 * is for."). This file is the smallest version of that opinion that is
 * still real — computed from the Runner Model's own canonical capacities,
 * never invented, never persisted.
 *
 *     "Owns: what are we currently trying to accomplish with this runner?
 *      The strategic bridge between fitness and planning."   — §F
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
 * against each other (§33: "High-Intensity Capacity, Threshold, Durability
 * ... should explain most coaching decisions").
 *
 * It also does not touch `lib/adaptation/*` or any race-prediction module.
 * §F's own boundary: "Should prevent the plan generator from behaving
 * randomly" is a READ relationship (the plan generator would consume this),
 * not a write relationship in the other direction — this file is not wired
 * into `generate.ts` in this pass. Wiring it into authoring is real,
 * separately-scoped work; see the header of `docs/reports/coaching-
 * thesis-2026-09-01.md` for what is and is not done.
 *
 * ── WHAT "PRIMARY LIMITER" MEANS HERE, ARGUED RATHER THAN ASSUMED ───────────
 *
 * §F's own worked example ties limiter directly to priority:
 * `primary_limiter: DURABILITY` → `priority: increase_long_run_demand`. The
 * honest, computed reading of "limiter" available from the Runner Model
 * TODAY — with no race-prediction layer built to ask "what caps this
 * runner's race time" (Constitution §J is unimplemented; grep confirms no
 * `primary_limiter` field exists anywhere in this codebase before this
 * file) — is: **the capacity the Runner Model currently knows the LEAST
 * about, relative to what that capacity's own ladder can ever report.**
 * A coach cannot safely push a trait it has no real evidence for, and
 * building that evidence — not necessarily pushing harder — is itself a
 * legitimate coaching priority. That is what "establish_X_evidence" below
 * says when it fires, and it is a different, narrower claim than "X is
 * weak"; this file does not claim to know a capacity is weak when it only
 * knows a capacity is unevidenced. See `PrimaryLimiterBasis`.
 *
 * ── THE ASYMMETRY THIS FILE MUST NOT PRETEND AWAY ────────────────────────────
 *
 * `capacity-resolver.ts`'s own header names the gap: "HIGH-INTENSITY
 * CAPACITY HAS NO DIRECT-EVIDENCE READER AT ALL... starts at the VDOT
 * fallback." Its ladder structurally cannot exceed
 * `CAPACITY_CONFIDENCE_BANDS.fallbackCeiling` (0.50), while threshold and
 * durability can both reach `directCeiling` (0.90). Comparing raw
 * `confidence` across the three would make high-intensity "the limiter" for
 * every runner in this app who is not on a stale VDOT read — an artefact of
 * an engine gap, not a coaching finding, and exactly the kind of "smart in
 * five places" false precision doctrine warns against (Constitution §38,
 * Rule 32: "don't add complexity solely to avoid admitting uncertainty").
 *
 * So every capacity's confidence is normalized against its OWN reachable
 * ceiling before the three are ranked (`normalizedConfidence` below). This
 * is the one piece of arithmetic this file adds on top of the resolvers'
 * own numbers, and it is reported (`ranking`) so a caller — or a human — can
 * see exactly why the pick landed where it did, the same transparency
 * `ConfidenceComponents` gives one layer down.
 *
 * ── HONESTY ABOUT CONFIDENCE (Rule 32, §27) ──────────────────────────────────
 *
 * `confidence` on the returned thesis is NOT a new, fifth score (Constitution
 * §11: "Scores require justification... If a score exists solely to combine
 * six other scores, question it aggressively"). It is the primary limiter's
 * own resolved `confidence`, passed through unchanged, from the one owning
 * resolver for that capacity. `evidenceIds` is the same pass-through — never
 * invented, per §38 and Rule 10's provenance requirement.
 *
 * ── COMPUTE AT READ TIME (Rule 10), NO PERSISTED SNAPSHOT ────────────────────
 *
 * Nothing here is written to a row. Every call re-derives from the capacity
 * resolvers (which themselves recompute from `runs`/`races`/`profile`) and
 * from the runner's own current-week `plan_workouts`. `resolvedAt` is
 * stamped so a value that travels into a response body says when it was
 * true, exactly as `capacity-resolver.ts` does for the same reason.
 *
 * ── WHAT THIS CANNOT CATCH, STATED RATHER THAN HIDDEN (Rule 22) ─────────────
 *
 *   · HIGH_INTENSITY can be picked as the limiter (normalization narrows the
 *     gap, it does not erase it — a runner with strong direct threshold and
 *     durability evidence and a stale VDOT-fallback interval read is a real
 *     finding), but `increase_high_intensity_demand` never fires: the
 *     `direct` rung this file would need to justify "push it harder" does
 *     not exist for this capacity yet, so the priority for it is always
 *     `establish_high_intensity_evidence`. Named here, not silently absent.
 *   · The ranking's tie-break order (THRESHOLD, DURABILITY, HIGH_INTENSITY)
 *     is a stated convention, not a research finding — argued only by "the
 *     two capacities with a real direct rung come first."
 *   · `addressedBy` reads the runner's OWN authored week, not the ideal one —
 *     an empty list is a true, useful finding ("this week's plan does not
 *     carry a session addressing what the model currently knows least
 *     about"), never papered over with a fabricated session.
 *   · Durability's "family" match for `addressedBy` is `is_long`, which is a
 *     coarse proxy — a long run trains durability but is not the ONLY
 *     durability-relevant sesion type, and this file does not attempt the
 *     finer classification `lib/evidence/activity-evidence.ts` (Activity
 *     Interpreter) would need to do it properly.
 */

import { pool } from '@/lib/db/pool';
import { loadSettings } from '@/lib/coach/settings';
import { weekWindowFor } from '@/lib/coach/week-window';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { readSelectionRationale } from '@/lib/plan/progression-spec';
import {
  resolveThresholdCapacity,
  resolveHighIntensityCapacity,
  resolveDurability,
  CAPACITY_CONFIDENCE_BANDS,
  type ThresholdCapacityEstimate,
  type HighIntensityCapacityEstimate,
  type DurabilityCapacityEstimate,
  type SourceMode,
} from '@/lib/training/capacity-resolver';

/** The three capacities Coaching Thesis trades off against each other — the
 *  Runner Model's own set (§33), minus the easy-ceiling boundary (see file
 *  header for why easy is excluded). */
export type PrimaryCapacity = 'THRESHOLD' | 'HIGH_INTENSITY' | 'DURABILITY';

/** How the primary limiter was picked. One value today; typed as an open
 *  string union so a future second basis (e.g. a race-prediction-derived
 *  limiter, once Constitution §J exists) is a real second value and not a
 *  silent redefinition of this one's meaning. */
export type PrimaryLimiterBasis = 'LOWEST_NORMALIZED_CONFIDENCE';

/** Structured, never prose (§27) — a human-readable sentence is the
 *  caller's job, built from these, so an explanation cannot drift from what
 *  the resolver actually did. */
export type ThesisReasonCode =
  | 'LOWEST_NORMALIZED_CONFIDENCE'
  | 'HIGH_INTENSITY_STRUCTURALLY_CEILINGED'
  | 'LIMITER_HAS_DIRECT_EVIDENCE'
  | 'LIMITER_HAS_NO_DIRECT_EVIDENCE'
  | 'KEY_SESSION_PRESENT_THIS_WEEK'
  | 'NO_KEY_SESSION_THIS_WEEK'
  | 'NO_ACTIVE_PLAN';

export const COACHING_THESIS_MODEL_VERSION = '1.0.0';

/** One capacity's position in the ranking that decided the thesis — the
 *  transparency layer, same posture as `ConfidenceComponents` one file
 *  down. */
export interface CapacityRanking {
  capacity: PrimaryCapacity;
  /** The resolver's own confidence, unchanged. */
  confidence: number;
  /** `confidence` divided by this capacity's own reachable ceiling — see
   *  file header for why HIGH_INTENSITY's ceiling differs from the other
   *  two's. This is what the ranking is actually sorted on. */
  normalizedConfidence: number;
  sourceMode: SourceMode;
}

/** A session on the runner's OWN current-week plan that speaks to the
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
   * (RATIONALE-PERSIST-1) — the same field
   * `docs/reports/workout-provenance-trace-2026-09-01.md` found computed and
   * discarded at authoring time. `null` on a row authored before that field
   * existed, or on a day a generic trajectory (not the catalogue) filled.
   */
  selectionRationale: string | null;
}

export interface CoachingThesis {
  /** What the Runner Model currently knows least about, relative to what
   *  that capacity's own ladder can report — see file header. */
  primaryLimiter: PrimaryCapacity;
  basis: PrimaryLimiterBasis;
  /** One machine-derived line — never a template string keyed on nothing
   *  but the workout type, which is the defect this file exists to not
   *  repeat (see `sessionRationale()` in `lib/training/prescriptions.ts`,
   *  the byte-identical-forever string the provenance trace named). */
  priority: string;
  /** The runner's own authored sessions this week that speak to the
   *  primary limiter's family. A real, honest empty array when none do. */
  addressedBy: AddressedSession[];
  /** The other two capacities, ranked, and a one-line reason each is not
   *  this week's emphasis. */
  secondaryPriority: { capacity: PrimaryCapacity; note: string };
  notPriority: { capacity: PrimaryCapacity; note: string };
  /** 0..1. The primary limiter's OWN resolved confidence — not a new score
   *  (see file header). */
  confidence: number;
  /** Traceable to the limiter's own underlying observations — a direct
   *  pass-through of that capacity's `evidenceIds`, never fabricated. */
  evidenceIds: string[];
  reasons: ThesisReasonCode[];
  /** Concrete, checkable conditions — not prose — that would move the
   *  primary limiter on a future resolve. */
  reconsiderIf: string[];
  /** Every capacity's position, so the pick is auditable without
   *  re-deriving it. */
  ranking: CapacityRanking[];
  resolvedAt: string;
  modelVersion: string;
}

/** HIGH_INTENSITY's structural confidence ceiling — see file header. Kept
 *  as its own named constant rather than inlined so the argument for it
 *  lives in exactly one place and a future direct high-intensity reader
 *  (the seam `capacity-resolver.ts` already names) has one line to change. */
const HIGH_INTENSITY_REACHABLE_CEILING = CAPACITY_CONFIDENCE_BANDS.fallbackCeiling;
const DIRECT_REACHABLE_CEILING = CAPACITY_CONFIDENCE_BANDS.directCeiling;

/** Deterministic tie-break: the two capacities with a real direct-evidence
 *  rung come first, alphabetically stable otherwise. Argued, not derived. */
const TIE_BREAK_ORDER: PrimaryCapacity[] = ['THRESHOLD', 'DURABILITY', 'HIGH_INTENSITY'];

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function rankCapacities(
  threshold: ThresholdCapacityEstimate,
  highIntensity: HighIntensityCapacityEstimate,
  durability: DurabilityCapacityEstimate,
): CapacityRanking[] {
  const raw: CapacityRanking[] = [
    {
      capacity: 'THRESHOLD',
      confidence: threshold.confidence,
      normalizedConfidence: clamp01(threshold.confidence / DIRECT_REACHABLE_CEILING),
      sourceMode: threshold.sourceMode,
    },
    {
      capacity: 'DURABILITY',
      confidence: durability.confidence,
      normalizedConfidence: clamp01(durability.confidence / DIRECT_REACHABLE_CEILING),
      sourceMode: durability.sourceMode,
    },
    {
      capacity: 'HIGH_INTENSITY',
      confidence: highIntensity.confidence,
      normalizedConfidence: clamp01(highIntensity.confidence / HIGH_INTENSITY_REACHABLE_CEILING),
      sourceMode: highIntensity.sourceMode,
    },
  ];
  return raw.sort((a, b) => {
    if (a.normalizedConfidence !== b.normalizedConfidence) {
      return a.normalizedConfidence - b.normalizedConfidence;
    }
    return TIE_BREAK_ORDER.indexOf(a.capacity) - TIE_BREAK_ORDER.indexOf(b.capacity);
  });
}

/** §F's worked example ties limiter to priority directly
 *  (`DURABILITY → increase_long_run_demand`); this is that mapping,
 *  generalised over both postures each capacity can be in. */
function priorityFor(capacity: PrimaryCapacity, sourceMode: SourceMode): string {
  const hasDirectEvidence = sourceMode === 'direct';
  switch (capacity) {
    case 'DURABILITY':
      return hasDirectEvidence ? 'increase_long_run_demand' : 'establish_durability_evidence';
    case 'THRESHOLD':
      return hasDirectEvidence ? 'increase_threshold_demand' : 'establish_threshold_evidence';
    case 'HIGH_INTENSITY':
      // Never `increase_high_intensity_demand` — see file header, "WHAT THIS
      // CANNOT CATCH": the direct rung this posture needs does not exist yet
      // for this capacity.
      return 'establish_high_intensity_evidence';
  }
}

function noteFor(capacity: PrimaryCapacity, sourceMode: SourceMode): string {
  const evidenced = sourceMode === 'direct' || sourceMode === 'race_derived';
  switch (capacity) {
    case 'DURABILITY':
      return evidenced
        ? 'holding steady · not this week\'s emphasis, evidence is ahead of the other two'
        : 'holding steady · not pushed while its evidence stays thin';
    case 'THRESHOLD':
      return evidenced
        ? 'holding steady · not this week\'s emphasis, evidence is ahead of the other two'
        : 'holding steady · not pushed while its evidence stays thin';
    case 'HIGH_INTENSITY':
      return 'holding steady · no direct evidence reader exists for this capacity yet';
  }
}

/** The plan-day `type`/`is_long` shape that speaks to each capacity's
 *  family. Coarse by design — see file header's "WHAT THIS CANNOT CATCH". */
function matchesCapacity(
  capacity: PrimaryCapacity,
  row: { type: string; is_long: boolean },
): boolean {
  if (capacity === 'DURABILITY') return row.is_long;
  if (capacity === 'THRESHOLD') return row.type === 'threshold' || row.type === 'tempo';
  return row.type === 'intervals';
}

/**
 * THE canonical Coaching Thesis. §F's answer, computed, not templated.
 *
 * No goal parameter — same structural discipline `capacity-resolver.ts`
 * enforces on the four resolvers it owns (Constitution §6): a coaching
 * strategy about what the Runner Model currently knows least about must not
 * be able to see what the runner is chasing, or "we don't know your
 * durability yet" would quietly become "your goal needs durability" through
 * the back door §6 exists to close. Compute-at-read-time (Rule 10); nothing
 * here is persisted.
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

  const ranking = rankCapacities(threshold, highIntensity, durability);
  const [primary, secondary, tertiary] = ranking;

  const estimateFor: Record<PrimaryCapacity, { confidence: number; evidenceIds: string[]; sourceMode: SourceMode }> = {
    THRESHOLD: threshold,
    HIGH_INTENSITY: highIntensity,
    DURABILITY: durability,
  };
  const primaryEstimate = estimateFor[primary.capacity];

  const reasons: ThesisReasonCode[] = ['LOWEST_NORMALIZED_CONFIDENCE'];
  if (primary.capacity === 'HIGH_INTENSITY') reasons.push('HIGH_INTENSITY_STRUCTURALLY_CEILINGED');
  reasons.push(
    primaryEstimate.sourceMode === 'direct' ? 'LIMITER_HAS_DIRECT_EVIDENCE' : 'LIMITER_HAS_NO_DIRECT_EVIDENCE',
  );

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
      if (!matchesCapacity(primary.capacity, row)) continue;
      addressedBy.push({
        planWorkoutId: row.id,
        dateIso: row.date_iso,
        type: row.type,
        subLabel: row.sub_label,
        selectionRationale: readSelectionRationale(row.workout_spec),
      });
    }
  } else {
    reasons.push('NO_ACTIVE_PLAN');
  }
  reasons.push(addressedBy.length > 0 ? 'KEY_SESSION_PRESENT_THIS_WEEK' : 'NO_KEY_SESSION_THIS_WEEK');

  const reconsiderIf: string[] = [
    `${secondary.capacity}'s normalized confidence (currently ${secondary.normalizedConfidence.toFixed(2)}) `
      + `drops below ${primary.capacity}'s (currently ${primary.normalizedConfidence.toFixed(2)})`,
    `${primary.capacity}'s own confidence crosses into direct evidence `
      + `(≥ ${CAPACITY_CONFIDENCE_BANDS.directFloor.toFixed(2)}) with a fresh corroborating session`,
    'a new race result changes any capacity\'s sourceMode to direct or race_derived',
  ];

  return {
    primaryLimiter: primary.capacity,
    basis: 'LOWEST_NORMALIZED_CONFIDENCE',
    priority: priorityFor(primary.capacity, primaryEstimate.sourceMode),
    addressedBy,
    secondaryPriority: { capacity: secondary.capacity, note: noteFor(secondary.capacity, secondary.sourceMode) },
    notPriority: { capacity: tertiary.capacity, note: noteFor(tertiary.capacity, tertiary.sourceMode) },
    confidence: primaryEstimate.confidence,
    evidenceIds: primaryEstimate.evidenceIds,
    reasons,
    reconsiderIf,
    ranking,
    resolvedAt,
    modelVersion: COACHING_THESIS_MODEL_VERSION,
  };
}
