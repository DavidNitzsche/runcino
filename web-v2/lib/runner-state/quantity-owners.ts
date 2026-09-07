/**
 * lib/runner-state/quantity-owners.ts · TWELVE QUANTITIES, ONE OWNER EACH,
 * AND EVERY LIVE DIVERGENCE AS A MEASURED NUMBER.
 *
 * ── WHY THIS EXISTS BESIDE `ownership.ts` ──────────────────────────────────
 *
 * `ownership.ts` records, for each of the twenty runner FACTS in `belief.ts`,
 * which symbol should own it and which others also answer. It is a survey and
 * it says so. Its own Rule 22 section names the hole this file exists to fill:
 *
 *   "WHETHER A LOADER ACTUALLY CALLED THE CANONICAL OWNER. The registry names
 *    an owner and a submission carries a number; nothing syntactic joins them.
 *    A loader that calls the legacy cascade and submits the result produces a
 *    belief this suite cannot distinguish from a correct one."
 *
 * A text scan cannot tell wiring from decoration. `_threshold_owner_scan.test
 * .ts` says the same thing about itself, and the precedent that motivated this
 * file is exactly that shape: a caller that invokes the canonical resolver,
 * DISCARDS its result, and answers with its own arithmetic passes every scan
 * ever written.
 *
 * So this registry is not a survey. Every site named here can be RESOLVED —
 * actually called, for one runner, on one date — and `_owner_agreement.test.ts`
 * resolves all of them and COMPARES THE NUMBERS. The gate fails on a numeric
 * divergence, not on a grep.
 *
 * ── THE TWELVE ─────────────────────────────────────────────────────────────
 *
 * The owner's own list (2026-09-05), not `belief.ts`'s. They are the
 * quantities a PRESCRIPTION is made of rather than the facts a BELIEF is made
 * of, which is why several carry no `BeliefKey`: "how many miles at marathon
 * pace may this session hold" is not a belief about the runner, it is a
 * decision about the week. Where one does map, `belief` names it so the two
 * registries can be cross-read instead of drifting.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ──────────────────────────────────────────
 *
 * NO ENGINE IMPORTS. This file is data: ids, module paths, symbol names,
 * argued reasons and measured deltas. The resolvers live in
 * `_owner_agreement.test.ts`, for the reason `_runner_state.test.ts` already
 * asserts about this whole directory — importing `lib/plan/spec-builder` or
 * `lib/training/capacity-resolver` pulls `pg` into `lib/runner-state/`, and a
 * runner-state module that opens a database is a different kind of file.
 *
 * The join between the two halves is CHECKED, not trusted: the gate asserts
 * every `probe: 'PURE'` site has a resolver and every resolver names a site
 * that exists here. A site that quietly loses its resolver fails.
 *
 * ── RULE 18 · THE RATCHET, IN BOTH DIRECTIONS ──────────────────────────────
 *
 * `acceptedDivergence` is the exemption list:
 *
 *   · a measured delta ABOVE `maxAbs` fails            (it may not grow)
 *   · a measured delta AT OR BELOW `tolerance` fails until the entry is
 *     DELETED                                          (a stale exemption fails)
 *
 * so closing a divergence forces the entry out rather than leaving a comment
 * nobody reads. Every entry carries `closesWhen` — the concrete migration that
 * removes it — because "we might need it" is not a reason.
 *
 * ── RULE 22 · WHAT THIS REGISTRY AND ITS GATE CANNOT FAIL ON ───────────────
 *
 * · A SITE NOBODY WROTE DOWN. Same limit `ownership.ts` states, and it is
 *   real: the survey behind this file found ELEVEN independent producers of
 *   post-race recovery days and this registry resolves five of them. A sixth
 *   anchor-less caller of `buildWorkoutSpec` added tomorrow is invisible until
 *   somebody lists it. The text scans (`_threshold_owner_scan.test.ts`,
 *   `check-goal-pace-leak.sh`) are the other half of this defence and stay
 *   where they are.
 * · WHETHER THE CANONICAL ANSWER IS RIGHT. Every owner of a quantity could
 *   agree on a wrong number and this reports clean. It asks "do the sites that
 *   answer this question answer it the same", never "is the answer good".
 * · A DIVERGENCE THAT ONLY APPEARS ON A RUNNER THE PROBE MATRIX CANNOT
 *   EXPRESS. Rule 15 pointed at this file: the matrix is a handful of
 *   synthetic runners, and a producer that agrees on all of them and diverges
 *   on the next one reads clean. That is why the matrix spans cold-start to
 *   elite and why one runner carries a raced-and-tapered history — and it is
 *   still a handful.
 * · A DB-ONLY SITE'S VALUE. `probe: 'DB_ONLY'` sites cannot be called without
 *   a database and CI has none. They are measured in
 *   `_owner_agreement.audit.test.ts` against the real account; the CI gate can
 *   only assert that the audit file NAMES them, which is a wiring check and
 *   not a value check. Stated rather than papered over.
 * · A SITE THAT IS UNREACHABLE FOR A REASON THE REGISTRY GOT WRONG.
 *   `reachedBy` is a human claim. If a listed production path stops calling a
 *   site, nothing here notices; the site just keeps agreeing with itself.
 * · IT IS ONE-SIDED ON MAGNITUDE. `toleranceAbs` says how far apart two
 *   answers may be before they are different answers. Nothing fires when two
 *   owners agree too precisely — i.e. when one is a silent copy of the other.
 *   Copies are `ownership.ts`'s survey problem, and the terrain row below is
 *   one this session closed by hand rather than by gate.
 */
import type { BeliefKey } from './belief';

/* ══════════════════════════════════════════════════════════════════════════
 * THE TWELVE
 * ═══════════════════════════════════════════════════════════════════════ */

export type QuantityId =
  | 'WEEKLY_VOLUME'
  | 'LONG_RUN_DISTANCE'
  | 'THRESHOLD_DOSE'
  | 'INTERVAL_PACE'
  | 'INTERVAL_DOSE'
  | 'MARATHON_PACE_DOSE'
  | 'QUALITY_FREQUENCY'
  | 'RUNNING_FREQUENCY'
  | 'RECOVERY_SPACING'
  | 'RACE_TARGET'
  | 'GOAL'
  | 'HEAT_TERRAIN_RESPONSE';

export const QUANTITY_IDS: readonly QuantityId[] = [
  'WEEKLY_VOLUME', 'LONG_RUN_DISTANCE', 'THRESHOLD_DOSE', 'INTERVAL_PACE',
  'INTERVAL_DOSE', 'MARATHON_PACE_DOSE', 'QUALITY_FREQUENCY',
  'RUNNING_FREQUENCY', 'RECOVERY_SPACING', 'RACE_TARGET', 'GOAL',
  'HEAT_TERRAIN_RESPONSE',
] as const;

/**
 * What a site IS, relative to the owner.
 *
 * The distinction `_threshold_owner_scan.test.ts` says it cannot make by
 * reading a call, made explicit and then CHECKED by resolving:
 *
 *   OWNER     THE answer. Exactly one per quantity.
 *   CARRIER   Consumes the owner's number and hands it on. Held to tolerance
 *             ZERO — a wrapping layer that quietly changes the number it
 *             exists to carry is a second owner wearing the first's name.
 *   EVIDENCE  Feeds the owner. Legitimately different, never the answer, and
 *             deliberately NOT compared: an input is not a competing output.
 *   SECOND    Independently answers the same question. Every one is a Rule 16
 *             finding until it is migrated or deleted.
 *   REMOVED   Deleted by a consolidation. Kept by name so a reintroduction is
 *             caught (the shape `weeklyVolWoWMaxPct` uses in the doctrine
 *             registry). The gate asserts these no longer exist.
 */
export type OwnerRole = 'OWNER' | 'CARRIER' | 'EVIDENCE' | 'SECOND' | 'REMOVED';

/** Whether the gate can call this site with no database. */
export type ProbeMode = 'PURE' | 'DB_ONLY';

export interface QuantitySite {
  /** `module#symbol`. The key the resolver map joins on. */
  readonly siteId: string;
  readonly module: string;
  readonly symbol: string;
  readonly role: OwnerRole;
  readonly probe: ProbeMode;
  /**
   * Which OWNER this site is measured against, as a `siteId`.
   *
   * Omitted where the quantity has exactly one owner — which is every row
   * except RECOVERY_SPACING, whose heading genuinely covers two questions
   * (days after a RACE, days after a HARD SESSION). Splitting a name that
   * covers two quantities is what Rule 8's corollary and Rule 16 both ask
   * for; naming the owner per site is that split, made checkable.
   */
  readonly comparesTo?: string;
  /**
   * The unit and the tolerance for comparisons made AGAINST this owner, where
   * they differ from the quantity's.
   *
   * Only meaningful on an OWNER, and only needed where a heading genuinely
   * covers two questions in two units — MARATHON_PACE_DOSE holds "how many
   * miles at marathon pace" and "at what pace", and LONG_RUN_DISTANCE holds an
   * evidence ceiling in miles and a share of the week. Printing one unit over
   * both would be this registry committing the defect it exists to find.
   */
  readonly unit?: string;
  readonly toleranceAbs?: number;
  /** What this site computes, in one line. */
  readonly computes: string;
  /**
   * The PRODUCTION call sites that reach it. Empty is a finding, not a
   * convenience: a SECOND answer nothing reaches is dead code and should be
   * deleted rather than registered (Constitution — prefer deletion). Empty is
   * therefore only legal on a `REMOVED` row.
   */
  readonly reachedBy: readonly string[];
}

/**
 * A divergence this repository still carries, with its MEASURED size.
 *
 * Not "these two may differ". `maxAbs` is a number somebody measured across
 * the whole probe matrix, and the gate re-measures it on every run.
 */
export interface AcceptedDivergence {
  /** Two `siteId`s. Order is [owner, other]. */
  readonly between: readonly [string, string];
  /** The largest absolute difference measured across the probe matrix. */
  readonly maxAbs: number;
  /** Why it is still here. Not "legacy" — the actual obstruction. */
  readonly why: string;
  /** The concrete migration that deletes this entry. */
  readonly closesWhen: string;
}

export interface QuantityOwnership {
  readonly quantity: QuantityId;
  /** The question, in the runner's language. */
  readonly question: string;
  readonly unit: string;
  /** The `belief.ts` key this maps onto, when it maps onto one. */
  readonly belief: BeliefKey | null;
  /** Every site that answers it. Exactly one has `role: 'OWNER'`. */
  readonly sites: readonly QuantitySite[];
  /**
   * How far apart two answers may be and still be the same answer.
   *
   * UNIT-AWARE, not a style choice: 1 s/mi is rounding on a pace and 1 day is
   * a whole extra rest day on a spacing. Carriers are held to zero regardless.
   */
  readonly toleranceAbs: number;
  readonly acceptedDivergence: readonly AcceptedDivergence[];
}

/* ══════════════════════════════════════════════════════════════════════════
 * SHARED REASONS · Rule 17 applies to this file too.
 * ═══════════════════════════════════════════════════════════════════════ */

/** The one obstruction behind every pace-family divergence below. */
const ANCHORLESS_CALLERS =
  'Five production paths still call buildWorkoutSpec with anchors = null and '
  + 'therefore reprice easy, long, interval and marathon pace off the flat '
  + 'population offsets instead of off the four capacity resolvers: '
  + 'lib/plan/adapt.ts#rebuildWorkoutDerivations, lib/plan/progression-pass.ts, '
  + 'lib/plan/seed-from-onboarding.ts, app/api/plan/restore/route.ts and '
  + 'app/api/admin/backfill-workout-spec/route.ts.';

const ANCHORLESS_CLOSES =
  'All five thread PrescribedPaceAnchors and the '
  + '`anchors: PrescribedPaceAnchors | null = null` default is deleted from '
  + 'buildWorkoutSpec, making the legacy offset branches unreachable and then '
  + 'removable.';

/* ══════════════════════════════════════════════════════════════════════════
 * THE REGISTRY
 * ═══════════════════════════════════════════════════════════════════════ */

export const QUANTITY_OWNERSHIP: Readonly<Record<QuantityId, QuantityOwnership>> = {

  /* ── 1 ─────────────────────────────────────────────────────────────── */
  WEEKLY_VOLUME: {
    quantity: 'WEEKLY_VOLUME',
    question: 'How much can this runner hold in a week, week after week.',
    unit: 'mi/wk',
    belief: 'SUSTAINABLE_WEEKLY_VOLUME',
    toleranceAbs: 0.1,
    sites: [
      {
        siteId: 'lib/training/normal-window.ts#sustainedFromWeeks',
        module: 'lib/training/normal-window.ts',
        symbol: 'sustainedFromWeeks',
        role: 'OWNER',
        probe: 'PURE',
        computes: 'The rank-3 order statistic over fully-representative '
          + 'trailing 7-day blocks. The pure core of sustainedWeeklyMileage, '
          + 'and the only weekly reader that applies the Rule 8 filter.',
        reachedBy: [
          'lib/training/normal-window.ts#sustainedWeeklyMileage',
          'lib/training/normal-window.ts#normalWeeklyMileage',
          'lib/plan/generate.ts#loadGeneratorInputs',
        ],
      },
      {
        siteId: 'lib/training/normal-window.ts#sustainedWeeklyMileage',
        module: 'lib/training/normal-window.ts',
        symbol: 'sustainedWeeklyMileage',
        role: 'CARRIER',
        probe: 'DB_ONLY',
        computes: 'The DB shell over the owner. Resolves the window, applies '
          + 'the Rule 8 filter, then spends the owner unchanged.',
        reachedBy: ['lib/plan/generate.ts#loadGeneratorInputs'],
      },
      {
        siteId: 'lib/plan/generate.ts#resolveRampBase',
        module: 'lib/plan/generate.ts',
        symbol: 'resolveRampBase',
        role: 'SECOND',
        probe: 'PURE',
        computes: 'The same rank-3 statistic over a RAW 112-day series with '
          + 'no Rule 8 filter, plus a 0.70 resume fraction.',
        reachedBy: ['lib/plan/generate.ts#rampBaseForBuild'],
      },
      {
        siteId: 'lib/adaptation/volume-evidence/belief.ts#rankWeek',
        module: 'lib/adaptation/volume-evidence/belief.ts',
        symbol: 'rankWeek',
        role: 'SECOND',
        probe: 'PURE',
        computes: 'A third rank-k over a weekly series, fed the volume '
          + 'evidence lane\'s own 26-week population. It AGREES with the '
          + 'owner across the whole probe matrix and carries no accepted '
          + 'divergence, because an order statistic is provably unmoved by '
          + 'low weeks while three ordinary weeks survive — the Rule 8 filter '
          + 'cannot separate two rank-3s there. What it could still differ on '
          + 'is the WINDOW (26 weeks against 16), which this matrix cannot '
          + 'express and the audit census measures instead.',
        reachedBy: [
          'lib/adaptation/volume-evidence/belief.ts#updateDemonstratedVolume',
          'lib/plan/volume-evidence-proposal.ts#decideVolumeRaise',
        ],
      },
    ],
    acceptedDivergence: [
      {
        between: [
          'lib/training/normal-window.ts#sustainedFromWeeks',
          'lib/plan/generate.ts#resolveRampBase',
        ],
        maxAbs: 13,
        why: 'The number the next block is RAMPED FROM against the number the '
          + 'runner actually sustains. resolveRampBase reads a raw 112-day '
          + 'series and its baseMi spends a 28-day MEAN and the best of the '
          + 'last two weeks — both of which a taper walks straight into — '
          + 'where the owner ranks only fully-representative weeks. On the '
          + 'raced-and-tapered probe the plan opens more than thirteen miles '
          + 'a week below what he holds, which is Rule 8\'s founding defect '
          + 'reproduced as a number. Note the two RANK statistics agree: an '
          + 'order statistic is unmoved by low weeks, so the leak is entirely '
          + 'in the mean and the last-two terms.',
        closesWhen: 'composePlan takes the sustained reading as an input '
          + 'instead of re-deriving one from `dailyMiMostRecentFirst`, so '
          + 'resolveRampBase becomes the return-ladder SHAPE only and stops '
          + 'answering "what does this runner normally hold".',
      },
    ],
  },

  /* ── 2 ─────────────────────────────────────────────────────────────── */
  LONG_RUN_DISTANCE: {
    quantity: 'LONG_RUN_DISTANCE',
    question: 'How long may the long run be.',
    unit: 'mi',
    belief: 'LONG_RUN_TOLERANCE',
    toleranceAbs: 0.05,
    sites: [
      {
        siteId: 'lib/plan/generate.ts#evidenceLongCeilingMi',
        module: 'lib/plan/generate.ts',
        symbol: 'evidenceLongCeilingMi',
        role: 'OWNER',
        probe: 'PURE',
        unit: 'mi',
        toleranceAbs: 0.05,
        computes: 'min(tier peak, max(demonstrated long, recent long × 1.15)) '
          + '· the runner\'s own evidence, capped by doctrine. Null with no '
          + 'measured long run, which is a refusal and not a zero.',
        reachedBy: ['lib/plan/generate.ts#composePlan'],
      },
      {
        siteId: 'lib/plan/validate.ts#longRunWoWCeilingMi',
        module: 'lib/plan/validate.ts',
        symbol: 'longRunWoWCeilingMi',
        role: 'EVIDENCE',
        probe: 'PURE',
        computes: 'The week-on-week step ceiling. Called by BOTH the '
          + 'author-time smoother and the validator, on purpose, so a plan '
          + 'cannot be written under one reading and refused under another.',
        reachedBy: [
          'lib/plan/generate.ts#finalizeComposedPlan',
          'lib/plan/validate.ts#validateComposedPlan',
        ],
      },
      {
        siteId: 'lib/plan/generate.ts#coherentRecentLong',
        module: 'lib/plan/generate.ts',
        symbol: 'coherentRecentLong',
        role: 'EVIDENCE',
        probe: 'PURE',
        computes: 'Reconciles a claimed recent long against the weekly volume '
          + 'and day count it would have to fit inside. An input to the '
          + 'sizing, never the size.',
        reachedBy: ['lib/plan/generate.ts#composePlan'],
      },
      {
        siteId: 'lib/adaptation/canonical/levers/long-run.ts#LONG_RUN_MAX_SHARE_OF_WEEK',
        module: 'lib/adaptation/canonical/evaluate.ts',
        symbol: 'LONG_RUN_MAX_SHARE_OF_WEEK',
        role: 'OWNER',
        probe: 'PURE',
        unit: 'mi of the week',
        toleranceAbs: 0.05,
        computes: 'THE SHARE HALF of this quantity: how much of the week the '
          + 'long run may be. Named owner because it sits inside the walled '
          + 'canonical adaptation engine, which Constitution 29 gives the '
          + 'progression ceiling. Its value is 0.35 and the two below say '
          + '0.30, so WHICH number is right is still a plan generator call — '
          + 'what this settles is that they are answering one question.',
        reachedBy: ['lib/adaptation/canonical/evaluate.ts#evaluateLevers'],
      },
      {
        siteId: 'lib/workout-catalogue/select.ts#LONG_RUN_WEEKLY_SHARE_CAP',
        module: 'lib/workout-catalogue/select.ts',
        symbol: 'LONG_RUN_WEEKLY_SHARE_CAP',
        role: 'SECOND',
        probe: 'PURE',
        comparesTo: 'lib/adaptation/canonical/levers/long-run.ts#LONG_RUN_MAX_SHARE_OF_WEEK',
        computes: 'The same share, as the workout selector caps it: 0.30.',
        reachedBy: ['lib/workout-catalogue/select.ts#selectWorkout'],
      },
      {
        siteId: 'lib/plan/adjudication/cold-start.ts#COLD_START_LONG_RUN_SHARE_OF_WEEK',
        module: 'lib/plan/adjudication/cold-start.ts',
        symbol: 'COLD_START_LONG_RUN_SHARE_OF_WEEK',
        role: 'SECOND',
        probe: 'PURE',
        comparesTo: 'lib/adaptation/canonical/levers/long-run.ts#LONG_RUN_MAX_SHARE_OF_WEEK',
        computes: 'The same share again, for a runner with no history: 0.30.',
        reachedBy: ['lib/plan/adjudication-corpus.ts#coldStartFor'],
      },
    ],
    acceptedDivergence: [
      {
        between: [
          'lib/adaptation/canonical/levers/long-run.ts#LONG_RUN_MAX_SHARE_OF_WEEK',
          'lib/workout-catalogue/select.ts#LONG_RUN_WEEKLY_SHARE_CAP',
        ],
        maxAbs: 5,
        why: 'THREE constants name "the long run\'s share of the week" and '
          + 'two values answer it: the adaptation engine allows 0.35 and both '
          + 'the selector and the cold-start allowance allow 0.30. Each is '
          + 'individually cited; nothing reconciles them, so the same runner '
          + 'gets a different ceiling depending on which layer asks.',
        closesWhen: 'One exported LONG_RUN_SHARE_OF_WEEK with one doctrine '
          + 'claim, imported by all three. Picking WHICH value is a plan '
          + 'generator call, because 0.35 vs 0.30 moves composition.',
      },
      {
        between: [
          'lib/adaptation/canonical/levers/long-run.ts#LONG_RUN_MAX_SHARE_OF_WEEK',
          'lib/plan/adjudication/cold-start.ts#COLD_START_LONG_RUN_SHARE_OF_WEEK',
        ],
        maxAbs: 5,
        why: 'The third of the three. It agrees with the selector at 0.30 and '
          + 'differs from the adaptation engine at 0.35, so the same runner '
          + 'is offered a long run worth five miles more by one layer than by '
          + 'the other two at a hundred miles a week.',
        closesWhen: 'Same migration as the row above · one exported constant, '
          + 'imported by all three.',
      },
    ],
  },

  /* ── 3 ─────────────────────────────────────────────────────────────── */
  THRESHOLD_DOSE: {
    quantity: 'THRESHOLD_DOSE',
    question: 'How many miles at threshold pace may one session carry.',
    unit: 'mi',
    belief: null,
    toleranceAbs: 0.01,
    sites: [
      {
        siteId: 'lib/prescription/levers.ts#atPaceSessionCapMi:T',
        module: 'lib/prescription/levers.ts',
        symbol: 'atPaceSessionCapMi',
        role: 'OWNER',
        probe: 'PURE',
        computes: 'min(weeklyMi × 0.10, AT_PACE_SESSION_MI.threshold.max) · '
          + 'both halves of the doctrine cell, percentage and absolute.',
        reachedBy: [
          'lib/plan/generate.ts#layoutWeek',
          'lib/plan/quality-day.ts#composeQualityDay',
          'lib/prescription/trajectory.ts#atPaceCapMinutes',
        ],
      },
      {
        siteId: 'lib/workout-catalogue/select.ts#sessionAllowanceMi',
        module: 'lib/workout-catalogue/select.ts',
        symbol: 'sessionAllowanceMi',
        role: 'SECOND',
        probe: 'PURE',
        computes: 'weeklyMi × the family share cap, with NO absolute session '
          + 'band. Answers the same question one layer over, and the '
          + 'catalogue prices affordability against it.',
        reachedBy: ['lib/workout-catalogue/select.ts#selectWorkout'],
      },
    ],
    acceptedDivergence: [
      {
        between: [
          'lib/prescription/levers.ts#atPaceSessionCapMi:T',
          'lib/workout-catalogue/select.ts#sessionAllowanceMi',
        ],
        maxAbs: 2,
        why: 'The catalogue omits the ABSOLUTE half of the same doctrine '
          + 'cell, so above the band\'s hinge it offers more at-pace miles '
          + 'than the composer will pay for. The two agree exactly below the '
          + 'hinge, which is why it has never been visible on a mid-mileage '
          + 'runner.',
        closesWhen: 'CORRECTED 2026-09-06 (DOSE-OWNER-1) · this used to read '
          + '"one call and it is safe." It is not, and the unsafety was '
          + 'measured rather than assumed: routing sessionAllowanceMi to '
          + 'atPaceSessionCapMi makes `3x3mi-at-hm` (Research/04 §14.3, 9 mi '
          + 'at HM pace, `race_specific` family) permanently unreachable — '
          + '`_reachability.test.ts` names it by slug. `capFamilyOf` prices '
          + 'every `race_specific`/`marathon_specific` entry against the '
          + 'plain threshold/interval/repetition cell, but AT_PACE_SESSION_MI '
          + '\'s absolute band (§5.1\'s "4-8 mi") is stated for CRUISE '
          + 'INTERVALS specifically, not the whole zone — so the OWNER itself '
          + 'over-generalises for exactly the two families this divergence\'s '
          + '`why` does not mention. Closing this needs `atPaceSessionCapMi` '
          + '(or `capFamilyOf`) to distinguish "this cap family\'s zone" from '
          + '"this cap family\'s flagship workout" first — a doctrine-scope '
          + 'call, not a wiring one. See `lib/workout-catalogue/select.ts '
          + '#sessionAllowanceMi`\'s own header for the attempted-and-reverted '
          + 'migration.',
      },
    ],
  },

  /* ── 4 ─────────────────────────────────────────────────────────────── */
  INTERVAL_PACE: {
    quantity: 'INTERVAL_PACE',
    question: 'What pace is an interval repetition prescribed at.',
    unit: 's/mi',
    belief: 'INTERVAL_PACE',
    toleranceAbs: 1,
    sites: [
      {
        siteId: 'lib/training/prescription-resolver.ts#composePaceAnchors:I',
        module: 'lib/training/prescription-resolver.ts',
        symbol: 'composePaceAnchors',
        role: 'OWNER',
        probe: 'PURE',
        computes: 'intervalSecPerMi, off resolveHighIntensityCapacity through '
          + 'the prescription layer, with repetition left null where doctrine '
          + 'has no route to it.',
        reachedBy: [
          'lib/training/load-prescription-anchors.ts#resolvePrescribedPaceAnchors',
          'lib/plan/authoring-anchors.ts#syntheticPaceAnchors',
        ],
      },
      {
        siteId: 'lib/plan/spec-builder.ts#buildWorkoutSpec:anchored',
        module: 'lib/plan/spec-builder.ts',
        symbol: 'buildWorkoutSpec',
        role: 'CARRIER',
        probe: 'PURE',
        computes: 'rep_pace_s_per_mi on an intervals spec, WITH anchors. Must '
          + 'equal the owner exactly — this is the number that reaches the '
          + 'watch.',
        reachedBy: [
          'lib/plan/generate.ts#specForComposedDay',
          'lib/plan/recompute-paces.ts#recomputePacesForPlan',
          'lib/plan/reanchor-plan.ts',
        ],
      },
      {
        siteId: 'lib/plan/spec-builder.ts#buildWorkoutSpec:anchorless',
        module: 'lib/plan/spec-builder.ts',
        symbol: 'buildWorkoutSpec',
        role: 'SECOND',
        probe: 'PURE',
        computes: 'rep_pace_s_per_mi with anchors = null · the flat '
          + 'INTERVAL_OFFSET_S offset off threshold, which the constant\'s own '
          + 'comment concedes is a deliberate deviation from Daniels\' I = T-33.',
        reachedBy: [
          'lib/plan/adapt.ts#rebuildWorkoutDerivations',
          'lib/plan/progression-pass.ts',
          'lib/plan/seed-from-onboarding.ts',
          'app/api/plan/restore/route.ts',
          'app/api/admin/backfill-workout-spec/route.ts',
        ],
      },
    ],
    acceptedDivergence: [
      {
        between: [
          'lib/training/prescription-resolver.ts#composePaceAnchors:I',
          'lib/plan/spec-builder.ts#buildWorkoutSpec:anchorless',
        ],
        maxAbs: 31,
        why: ANCHORLESS_CALLERS,
        closesWhen: ANCHORLESS_CLOSES,
      },
    ],
  },

  /* ── 5 ─────────────────────────────────────────────────────────────── */
  INTERVAL_DOSE: {
    quantity: 'INTERVAL_DOSE',
    question: 'How many miles of interval work may one session carry.',
    unit: 'mi',
    belief: null,
    toleranceAbs: 0.01,
    sites: [
      {
        siteId: 'lib/prescription/levers.ts#atPaceSessionCapMi:I',
        module: 'lib/prescription/levers.ts',
        symbol: 'atPaceSessionCapMi',
        role: 'OWNER',
        probe: 'PURE',
        computes: 'min(weeklyMi × 0.08, AT_PACE_SESSION_MI.interval.max).',
        reachedBy: [
          'lib/plan/generate.ts#layoutWeek',
          'lib/prescription/levers.ts#advanceShape',
        ],
      },
      {
        siteId: 'lib/plan/dosing.ts#sessionDoseCeilingMi:I',
        module: 'lib/plan/dosing.ts',
        symbol: 'sessionDoseCeilingMi',
        role: 'SECOND',
        probe: 'PURE',
        computes: 'Daniels\' I cumulative ceiling in miles (10 km), the '
          + 'ABSOLUTE half only. Independent of the weekly percentage.',
        reachedBy: ['lib/plan/dosing.ts#slotDoseBudgetMi'],
      },
    ],
    acceptedDivergence: [
      {
        between: [
          'lib/prescription/levers.ts#atPaceSessionCapMi:I',
          'lib/plan/dosing.ts#sessionDoseCeilingMi:I',
        ],
        maxAbs: 5.58,
        why: 'Two session ceilings for I, cited from the same doctrine and '
          + 'never reconciled: the lever\'s percentage-and-band answer and the '
          + 'doser\'s cumulative-kilometre answer. Neither is wrong; the '
          + 'composer spends whichever the branch it is in happens to ask.',
        closesWhen: 'slotDoseBudgetMi mins against atPaceSessionCapMi, so the '
          + 'per-session answer is one number whichever layer asks for it.',
      },
    ],
  },

  /* ── 6 ─────────────────────────────────────────────────────────────── */
  MARATHON_PACE_DOSE: {
    quantity: 'MARATHON_PACE_DOSE',
    question: 'How many miles at marathon pace may one session carry, and at '
      + 'what pace.',
    unit: 'mi',
    belief: 'MARATHON_PACE',
    toleranceAbs: 0.01,
    sites: [
      {
        siteId: 'lib/plan/dosing.ts#MARATHON_PACE_WORKOUT_CAP',
        module: 'lib/plan/dosing.ts',
        symbol: 'MARATHON_PACE_WORKOUT_CAP',
        role: 'OWNER',
        probe: 'PURE',
        unit: 'mi',
        toleranceAbs: 0.01,
        computes: 'Doctrine\'s cell in full — "the lesser of 18 mi or 20% of '
          + 'weekly mi" — read as min(absMi, weeklyMi × pctOfWeekly). This is '
          + 'what generate.ts computes as `ladderDanielsCapMi`.',
        reachedBy: [
          'lib/plan/generate.ts#layoutWeek',
          'lib/plan/marathon-specific-ladder.ts',
        ],
      },
      {
        siteId: 'lib/training/prescription-resolver.ts#composePaceAnchors:M',
        module: 'lib/training/prescription-resolver.ts',
        symbol: 'composePaceAnchors',
        role: 'OWNER',
        probe: 'PURE',
        unit: 's/mi',
        toleranceAbs: 1,
        computes: 'THE PACE HALF · marathonSecPerMi, threshold capacity '
          + 'carried to 26.2 through the runner\'s OWN fitted endurance '
          + 'exponent.',
        reachedBy: [
          'lib/training/load-prescription-anchors.ts#resolvePrescribedPaceAnchors',
          'lib/plan/generate.ts#composePlan',
        ],
      },
      {
        siteId: 'lib/plan/spec-builder.ts#buildWorkoutSpec:mpAnchored',
        module: 'lib/plan/spec-builder.ts',
        symbol: 'buildWorkoutSpec',
        role: 'CARRIER',
        probe: 'PURE',
        comparesTo: 'lib/training/prescription-resolver.ts#composePaceAnchors:M',
        computes: 'finish_pace_s_per_mi on a long run\'s marathon-pace '
          + 'finish, WITH anchors. Must equal the owner exactly — it is what '
          + 'the watch runs.',
        reachedBy: ['lib/plan/generate.ts#specForComposedDay'],
      },
      {
        siteId: 'lib/plan/spec-builder.ts#resolveMarathonPace',
        module: 'lib/plan/spec-builder.ts',
        symbol: 'resolveMarathonPace',
        role: 'SECOND',
        probe: 'PURE',
        comparesTo: 'lib/training/prescription-resolver.ts#composePaceAnchors:M',
        computes: 'The same finish through the flat MARATHON_OFFSET_S '
          + 'population offset — and, when a caller passes one, through the '
          + 'runner\'s stated GOAL pace whenever it lands inside the marathon '
          + 'zone.',
        reachedBy: [
          'lib/plan/adapt.ts#rebuildWorkoutDerivations',
          'lib/plan/progression-pass.ts',
          'lib/plan/seed-from-onboarding.ts',
          'app/api/plan/restore/route.ts',
          'app/api/admin/backfill-workout-spec/route.ts',
        ],
      },
      {
        siteId: 'lib/plan/dosing.ts#slotDoseBudgetMi:M',
        module: 'lib/plan/dosing.ts',
        symbol: 'slotDoseBudgetMi',
        role: 'SECOND',
        probe: 'PURE',
        comparesTo: 'lib/plan/dosing.ts#MARATHON_PACE_WORKOUT_CAP',
        computes: 'min(weeklyDoseBudgetMi(M), sessionDoseCeilingMi(M)). '
          + 'weeklyShareCap(M) is null, so the weekly budget is INFINITY and '
          + 'the session ceiling is the ABSOLUTE 18 alone — the percentage '
          + 'half of the same doctrine cell never applies on this path.',
        reachedBy: ['lib/plan/generate.ts#layoutWeek (slotBudgetMi)'],
      },
    ],
    acceptedDivergence: [
      {
        between: [
          'lib/plan/dosing.ts#MARATHON_PACE_WORKOUT_CAP',
          'lib/plan/dosing.ts#slotDoseBudgetMi:M',
        ],
        maxAbs: 16.4,
        why: 'THE PERCENTAGE HALF IS DROPPED ON THE HANDOFF, and both sides '
          + 'are inside one file. sessionDoseCeilingMi\'s own comment says the '
          + 'percentage half is "the caller\'s, via the budget above" — and '
          + 'weeklyDoseBudgetMi returns Infinity for M because doctrine gives '
          + 'marathon pace no weekly SHARE. So the handoff is to nothing: a '
          + '20 mi/wk runner\'s marathon-pace slot is ceilinged at 18 miles '
          + 'where the ladder\'s own cap says 4.',
        closesWhen: 'slotDoseBudgetMi takes weeklyMi into the M ceiling, or '
          + 'sessionDoseCeilingMi takes weeklyMi and spends both halves. '
          + 'DELIBERATELY NOT DONE HERE: it lowers a prescribed dose for '
          + 'every sub-90 mi/wk runner, which is plan composition, and this '
          + 'file\'s job is to make the divergence visible rather than to '
          + 'settle a doctrine cell inside a wiring pass.',
      },
      {
        between: [
          'lib/training/prescription-resolver.ts#composePaceAnchors:M',
          'lib/plan/spec-builder.ts#resolveMarathonPace',
        ],
        maxAbs: 44,
        why: ANCHORLESS_CALLERS + ' On the marathon axis this is also the '
          + 'LAST GOAL-SHAPED SIDE DOOR in the engine: resolveMarathonPace '
          + 'still takes a goalPaceSPerMi and returns it as a TRAINING pace '
          + 'when it lands in zone, which is the shape tPaceFromGoal was '
          + 'deleted for. composePlan no longer passes one and a doctrine '
          + 'claim asserts that, but the parameter is reachable from any of '
          + 'the five callers above.',
        closesWhen: ANCHORLESS_CLOSES + ' The goalPaceSPerMi parameter is '
          + 'then deleted from resolveMarathonPace outright, the way '
          + 'tPaceFromGoal was, and registered as REMOVED here so a '
          + 'reintroduction fails by name.',
      },
    ],
  },

  /* ── 7 ─────────────────────────────────────────────────────────────── */
  QUALITY_FREQUENCY: {
    quantity: 'QUALITY_FREQUENCY',
    question: 'How many quality sessions does this week carry.',
    unit: 'sessions/wk',
    belief: null,
    toleranceAbs: 0,
    sites: [
      {
        siteId: 'lib/plan/generate.ts#densityForWeek',
        module: 'lib/plan/generate.ts',
        symbol: 'densityForWeek',
        role: 'OWNER',
        probe: 'DB_ONLY',
        computes: 'The week\'s quality-session count, ramped from the '
          + 'runner\'s own recent density. A CLOSURE inside composePlan, so '
          + 'it is unexported and unreachable from any other module — which '
          + 'is why no second owner can exist inside authoring and equally '
          + 'why nothing can drive it without the whole compose path.',
        reachedBy: ['lib/plan/generate.ts#composePlan'],
      },
      {
        siteId: 'lib/plan/goal-tiers.ts#TIER_TARGETS.qualityPerWeek',
        module: 'lib/plan/goal-tiers.ts',
        symbol: 'TIER_TARGETS',
        role: 'EVIDENCE',
        probe: 'PURE',
        computes: 'The doctrine ceiling the ramp climbs toward. An input, and '
          + 'the composer\'s own comment says it is explicitly not a floor.',
        reachedBy: ['lib/plan/generate.ts#composePlan'],
      },
      {
        siteId: 'lib/adaptation/load-adaptation-engine.ts#qualitySessionsWeekAhead',
        module: 'lib/adaptation/load-adaptation-engine.ts',
        symbol: 'resolveAdaptationProposals',
        role: 'SECOND',
        probe: 'DB_ONLY',
        computes: 'COUNT(*) of is_quality rows in the week ahead. A '
          + 'PRESCRIBED count, not a habit — and composeAdaptation coalesces '
          + 'it with the progression gate\'s resolution count, which is a '
          + 'third quantity again (rows the gate resolved, not rows that '
          + 'exist).',
        reachedBy: ['app/api/cron/run-adaptations/route.ts'],
      },
    ],
    acceptedDivergence: [],
  },

  /* ── 8 ─────────────────────────────────────────────────────────────── */
  RUNNING_FREQUENCY: {
    quantity: 'RUNNING_FREQUENCY',
    question: 'How many days a week does this runner run.',
    unit: 'days/wk',
    belief: 'RUN_FREQUENCY_TOLERANCE',
    toleranceAbs: 0,
    sites: [
      {
        siteId: 'lib/plan/generate.ts#derivedTrainingDaysPerWeek',
        module: 'lib/plan/generate.ts',
        symbol: 'derivedTrainingDaysPerWeek',
        role: 'OWNER',
        probe: 'DB_ONLY',
        computes: 'The rank-3 highest distinct-run-day count over the last 16 '
          + 'seven-day blocks. Rank-3 rather than a median because the median '
          + 'read 5 for a six-day runner. Null on a failed read.',
        reachedBy: ['lib/plan/generate.ts#loadGeneratorInputs'],
      },
      {
        siteId: 'lib/plan/injury-builder.ts#weeklyFrequencyFallback',
        module: 'lib/plan/injury-builder.ts',
        symbol: 'MAX_ACTIVE_DAYS_PER_WEEK',
        role: 'SECOND',
        probe: 'DB_ONLY',
        computes: 'profile.weekly_frequency with NO derived fallback: a null '
          + 'profile reads as 5, where the generator measures the runner. '
          + 'Rule 11 — "don\'t know" answered with a default that silently '
          + 'caps a six-day runner.',
        reachedBy: ['lib/plan/injury-builder.ts#buildInjuryPlan'],
      },
      {
        siteId: 'lib/plan/adapt.ts#weeklyFrequencyCap',
        module: 'lib/plan/adapt.ts',
        symbol: 'weekly_frequency',
        role: 'SECOND',
        probe: 'DB_ONLY',
        computes: 'The raw profile column as a hard per-week run-count cap, '
          + 'with no derived fallback and without the generator\'s 0 -> 3 '
          + 'coercion.',
        reachedBy: ['lib/plan/adapt.ts#applyAdaptations'],
      },
      {
        siteId: 'lib/plan/mutate.ts#weeklyFrequencyContext',
        module: 'lib/plan/mutate.ts',
        symbol: 'weekly_frequency',
        role: 'SECOND',
        probe: 'DB_ONLY',
        computes: 'The same raw read again, into '
          + 'PlanValidationContext.trainingDaysPerWeek.',
        reachedBy: ['lib/plan/mutate.ts'],
      },
    ],
    acceptedDivergence: [],
  },

  /* ── 9 ─────────────────────────────────────────────────────────────── */
  RECOVERY_SPACING: {
    quantity: 'RECOVERY_SPACING',
    question: 'How many days after this session before quality resumes.',
    unit: 'days',
    belief: 'RECOVERY_RESPONSE',
    toleranceAbs: 0,
    sites: [
      {
        siteId: 'lib/plan/goal-tiers.ts#postRaceRecoveryWeeks',
        module: 'lib/plan/goal-tiers.ts',
        symbol: 'postRaceRecoveryWeeks',
        role: 'OWNER',
        probe: 'PURE',
        unit: 'days after a race',
        toleranceAbs: 0,
        computes: 'Post-race recovery in WHOLE WEEKS scaled by race priority, '
          + 'read in days as weeks × 7. The number the Rule 8 window filter '
          + 'and the composer both spend.',
        reachedBy: [
          'lib/plan/generate.ts#prescribedSpanFor',
          'lib/training/normal-window.ts#prescribedWindowFor',
          'lib/plan/race-lifecycle.ts',
        ],
      },
      {
        siteId: 'lib/plan/combined-stress.ts#postRaceNoQualityDays',
        module: 'lib/plan/combined-stress.ts',
        symbol: 'postRaceNoQualityDays',
        role: 'SECOND',
        probe: 'PURE',
        comparesTo: 'lib/plan/goal-tiers.ts#postRaceRecoveryWeeks',
        computes: 'The same week table read in days — but scaled by its OWN '
          + 'priority scale. It reads as a carrier and is not one.',
        reachedBy: [
          'lib/plan/generate.ts',
          'lib/plan/reschedule.ts',
        ],
      },
      {
        siteId: 'lib/plan/combined-stress.ts#noQualityDaysAfterRace',
        module: 'lib/plan/combined-stress.ts',
        symbol: 'noQualityDaysAfterRace',
        role: 'SECOND',
        probe: 'PURE',
        comparesTo: 'lib/plan/goal-tiers.ts#postRaceRecoveryWeeks',
        computes: 'A DAY-granular table (ROLE_POST_QUALITY_FREE_DAYS) read '
          + 'off the LOWER bound of the same doctrine column, with only '
          + 'hm/10k/5k rows — every longer distance collapses onto the half.',
        reachedBy: [
          'lib/plan/generate.ts (placement pass)',
          'lib/plan/validate.ts §11',
        ],
      },
      {
        siteId: 'lib/coach/easy-discipline.ts#raceWindowFor',
        module: 'lib/coach/easy-discipline.ts',
        symbol: 'raceWindowFor',
        role: 'SECOND',
        probe: 'PURE',
        comparesTo: 'lib/plan/goal-tiers.ts#postRaceRecoveryWeeks',
        computes: 'The same window in days, read off the UPPER bound of the '
          + 'same doctrine column, with all four rows present.',
        reachedBy: [
          'lib/coach/easy-discipline.ts#loadEasyDiscipline',
          'lib/adaptation/canonical-shadow/demand-input.ts',
        ],
      },
      {
        siteId: 'lib/coach/recovery-phase.ts#expectedDaysForAnchor:race',
        module: 'lib/coach/recovery-phase.ts',
        symbol: 'expectedDaysForAnchor',
        role: 'SECOND',
        probe: 'PURE',
        comparesTo: 'lib/plan/goal-tiers.ts#postRaceRecoveryWeeks',
        computes: 'A THIRD day table for the race anchor, taking the FLOOR of '
          + 'every doctrine band where the owner takes the week-rounded '
          + 'upper. This is what the phone\'s recovery surface renders.',
        reachedBy: [
          'lib/coach/run-recap.ts#inPostRaceWindow',
          'app/api/v5/today/route.ts',
          'app/api/runs/[id]/recap/route.ts',
        ],
      },
      {
        siteId: 'lib/coach/recovery-phase.ts#expectedDaysForAnchor:session',
        module: 'lib/coach/recovery-phase.ts',
        symbol: 'expectedDaysForAnchor',
        role: 'SECOND',
        probe: 'PURE',
        comparesTo: 'lib/plan/validate.ts#requiredSeparationDays',
        computes: 'The same function\'s NON-race arm — days until quality '
          + 'after a long run or a rep session. The only producer that '
          + 'answers this for a surface rather than for the composer. '
          + 'PARTIALLY CLOSED 2026-09-07 (RECOVERY-OWNER-1): the rep-session '
          + '(intervals/tempo/threshold) branch now calls the owner directly '
          + 'and is measured at zero delta by this registry\'s own probe '
          + '(which calls this site with type \'intervals\'). The LONG-RUN '
          + 'branch is UNCHANGED and still computes independently — hand- '
          + 'traced (not resolved by this gate\'s probe, which never calls '
          + 'this site with type \'long\') at up to 2 days off the owner '
          + '(e.g. a 17mi non-quality long: owner {min:1,max:2}, this reads '
          + '3). Left open because closing it needs `isQuality` / '
          + '`longRunKind` / `raceGoalPaceSec` for a COMPLETED run, which '
          + 'this call site only has a bare run row for — an evidence-'
          + 'classification question, not a wiring one.',
        reachedBy: [
          'lib/coach/run-recap.ts',
          'app/api/v5/today/route.ts',
        ],
      },
      {
        siteId: 'lib/plan/validate.ts#requiredSeparationDays',
        module: 'lib/plan/validate.ts',
        symbol: 'requiredSeparationDays',
        role: 'OWNER',
        probe: 'PURE',
        unit: 'days after a hard session',
        toleranceAbs: 0,
        computes: 'The HARD-DAY half of the same question: how many easy days '
          + 'must sit between two hard sessions. The authoring gate.',
        reachedBy: ['lib/plan/validate.ts#validateComposedPlan §9'],
      },
      {
        siteId: 'lib/plan/reschedule.ts#requiredRecoveryDaysAfter',
        module: 'lib/plan/reschedule.ts',
        symbol: 'requiredRecoveryDaysAfter',
        role: 'CARRIER',
        probe: 'PURE',
        comparesTo: 'lib/plan/validate.ts#requiredSeparationDays',
        computes: 'The same rule flattened to a single number for the '
          + 'rescheduler. Its own header says it MIRRORS §9 rather than '
          + 'calling it, which is the drift surface.',
        reachedBy: ['lib/plan/reschedule.ts'],
      },
    ],
    acceptedDivergence: [
      {
        between: [
          'lib/plan/goal-tiers.ts#postRaceRecoveryWeeks',
          'lib/plan/combined-stress.ts#postRaceNoQualityDays',
        ],
        maxAbs: 3,
        why: 'TWO PRIORITY SCALES FOR ONE TABLE, AND TWO GRANULARITIES, and '
          + 'this gate is what found them. Both functions scale '
          + 'POST_RACE_RECOVERY_WEEKS and both cite Research/00b "Recovery by '
          + 'Effort", but goal-tiers spends RECOVERY_EFFORT_SCALE {A 1.0, B '
          + '0.65, C 0.35} and combined-stress spends POST_RACE_PRIORITY_SCALE '
          + '{A 1.0, B 0.70, C 0.50}. Equalising the scales does NOT close it, '
          + 'which was falsified rather than assumed: at a common 0.65 a '
          + 'B-priority half is still 7 days against 9, because the owner '
          + 'rounds to whole WEEKS before multiplying and the other rounds to '
          + 'DAYS after. They agree exactly on every A race, where both scales '
          + 'are 1.0 and the week boundary lands on the same day — which is '
          + 'why this was invisible: A races are most of the corpus and all of '
          + 'the owner\'s own history.',
        closesWhen: 'One scale AND one granularity: POST_RACE_PRIORITY_SCALE '
          + 'deleted, and combined-stress calling postRaceRecoveryWeeks and '
          + 'multiplying by seven, so there is one table, one scale and one '
          + 'rounding. Picking which set of numbers doctrine actually says is '
          + 'a training-science call rather than a wiring one, which is why it '
          + 'is recorded here and not settled here.',
      },
      {
        between: [
          'lib/plan/goal-tiers.ts#postRaceRecoveryWeeks',
          'lib/plan/combined-stress.ts#noQualityDaysAfterRace',
        ],
        maxAbs: 18,
        why: 'The widest pair in the app. For a marathon the owner says 28 '
          + 'days and this says 10, because its table has no marathon row and '
          + 'collapses every distance above the half onto the half. Its own '
          + 'type is TuneUpCategory, so a marathon is out of contract — but '
          + 'the placement pass and validator §11 call it with whatever '
          + 'distance the embedded race carries.',
        closesWhen: 'ROLE_POST_QUALITY_FREE_DAYS gains m/ultra rows, or the '
          + 'function refuses a distance its table cannot express instead of '
          + 'substituting the half (Rule 11). The refusal is the honest one '
          + 'and it is the plan generator owner\'s call, because §11 currently '
          + 'depends on getting a number.',
      },
      {
        between: [
          'lib/plan/goal-tiers.ts#postRaceRecoveryWeeks',
          'lib/coach/recovery-phase.ts#expectedDaysForAnchor:race',
        ],
        maxAbs: 7,
        why: 'A third reading of the same doctrine column, taking the FLOOR '
          + 'of every band where the owner takes the week-rounded upper. It '
          + 'is what the phone renders, so the runner reads 6 days after a 5K '
          + 'while the plan treats those days as ordinary training.',
        closesWhen: 'expectedDaysForAnchor\'s race arm reads '
          + 'postRaceRecoveryWeeks and keeps its own table only for the '
          + 'non-race anchors it alone answers.',
      },
      {
        between: [
          'lib/plan/goal-tiers.ts#postRaceRecoveryWeeks',
          'lib/coach/easy-discipline.ts#raceWindowFor',
        ],
        maxAbs: 7,
        why: 'GRANULARITY, plus a missing parameter. CLAUDE.md Rule 8 records '
          + 'the first half: the engine table is whole WEEKS and this is '
          + 'DAYS, so the sub-week rows round in opposite directions, and 5K '
          + 'post-race is the costly one — the engine floors 3-5 days to 0 '
          + 'weeks, so a runner\'s post-5K no-quality days count as his '
          + 'normal. The second half is new here: raceWindowFor takes NO '
          + 'PRIORITY at all, so it answers a B-priority half with the '
          + 'A-race window and lands 7 days past the owner.',
        closesWhen: 'POST_RACE_RECOVERY_WEEKS gains a day-granular sibling. '
          + 'That moves a doctrine-bound constant which also moves plan '
          + 'composition, so it is the plan generator owner\'s call and not '
          + 'the window filter\'s.',
      },
      // CLOSED 2026-09-07 (RECOVERY-OWNER-1). The
      // requiredSeparationDays / expectedDaysForAnchor:session pair used to
      // diverge by 1 day here (the surface hardcoded 2, the owner's
      // non-long branch is 1). expectedDaysForAnchor's intervals/tempo/
      // threshold arm now calls requiredSeparationDays directly instead of
      // its own constant, so the two cannot drift again — see
      // lib/coach/recovery-phase.ts's expectedDays(). Per this file's own
      // ratchet rule ("a measured delta AT OR BELOW tolerance fails until
      // the entry is DELETED"), the exemption entry is removed rather than
      // left at maxAbs 0.
    ],
  },

  /* ── 10 ────────────────────────────────────────────────────────────── */
  RACE_TARGET: {
    quantity: 'RACE_TARGET',
    question: 'What is this runner prescribed to race.',
    unit: 's',
    belief: 'GOAL_FEASIBILITY',
    toleranceAbs: 1,
    sites: [
      {
        siteId: 'lib/race/race-outlook.ts#composeRaceOutlook',
        module: 'lib/race/race-outlook.ts',
        symbol: 'composeRaceOutlook',
        role: 'OWNER',
        probe: 'DB_ONLY',
        computes: 'The race-pace brain. Names five quantities apart — stated '
          + 'goal, current projection, training prescription, expected race '
          + 'day, execution — so the Rule 16 three-projections defect cannot '
          + 'recur by accident.',
        reachedBy: [
          'lib/race/effective-race-target.ts#loadEffectiveRaceTarget',
          'app/api/race/[slug]/route.ts',
          'lib/watch/build-workout.ts',
        ],
      },
      {
        siteId: 'lib/training/achievable-target.ts#achievableRaceTarget',
        module: 'lib/training/achievable-target.ts',
        symbol: 'achievableRaceTarget',
        role: 'SECOND',
        probe: 'PURE',
        computes: 'The AUTHORING target: the seasonal VDOT ceiling over the '
          + 'block, floored at max(goal, prescription floor). A different '
          + 'basis from the outlook\'s execution target, and the number the '
          + 'race row is written at.',
        reachedBy: ['lib/plan/generate.ts#composePlan'],
      },
      {
        siteId: 'lib/race/b-goal.ts#resolveBGoal',
        module: 'lib/race/b-goal.ts',
        symbol: 'resolveBGoal',
        role: 'EVIDENCE',
        probe: 'PURE',
        computes: 'The B target, A + a fixed safe fraction. A SECOND '
          + 'prescribed time by design and labelled as one, so it is not a '
          + 'competing answer to the same question.',
        reachedBy: [
          'app/api/race/[slug]/route.ts',
          'lib/race/execution-plan.ts',
        ],
      },
    ],
    acceptedDivergence: [],
  },

  /* ── 11 ────────────────────────────────────────────────────────────── */
  GOAL: {
    quantity: 'GOAL',
    question: 'What did the runner say he wants to run.',
    unit: 's',
    belief: null,
    toleranceAbs: 0,
    sites: [
      {
        siteId: 'lib/training/vdot.ts#parseRaceTime',
        module: 'lib/training/vdot.ts',
        symbol: 'parseRaceTime',
        role: 'OWNER',
        probe: 'PURE',
        computes: 'Goal string to seconds. Handles H:MM:SS, H:MM and MM:SS, '
          + 'with the documented sub-9 heuristic that tells a 7:45 marathon '
          + 'from a 7:45 mile.',
        reachedBy: [
          'lib/plan/generate.ts#parseGoalSeconds',
          'lib/faff/race-on-today.ts',
          'lib/watch/build-workout.ts',
          'app/api/targets/projection/route.ts',
        ],
      },
      {
        siteId: 'lib/plan/generate.ts#parseGoalSeconds',
        module: 'lib/plan/generate.ts',
        symbol: 'parseGoalSeconds',
        role: 'CARRIER',
        probe: 'PURE',
        computes: 'A one-line delegation to the owner. Kept because '
          + 'generate.ts is the module its callers already import.',
        reachedBy: ['lib/plan/generate.ts#loadGeneratorInputs'],
      },
      {
        siteId: 'lib/plan/core.ts#parseGoalSeconds',
        module: 'lib/plan/core.ts',
        symbol: 'parseGoalSeconds',
        role: 'REMOVED',
        probe: 'PURE',
        computes: 'DELETED 2026-09-05. A second implementation, strict '
          + '^H:MM:SS, which returned NULL for every MM:SS goal — so a 25:30 '
          + 'five-kilometre goal read as "no goal at all" through this door '
          + 'and as 1530 seconds through the owner. It had no production '
          + 'caller and no test; the bench that appears to test it imports '
          + 'the generate.ts one.',
        reachedBy: [],
      },
      {
        siteId: 'app/api/prescription/route.ts#parseGoalSeconds',
        module: 'app/api/prescription/route.ts',
        symbol: 'parseGoalSeconds',
        role: 'REMOVED',
        probe: 'PURE',
        computes: 'DELETED 2026-09-05. A third copy of the same strict '
          + 'regex, route-local, and never called from anywhere in the route '
          + 'that declared it.',
        reachedBy: [],
      },
    ],
    acceptedDivergence: [],
  },

  /* ── 12 ────────────────────────────────────────────────────────────── */
  HEAT_TERRAIN_RESPONSE: {
    quantity: 'HEAT_TERRAIN_RESPONSE',
    question: 'How much do heat and terrain move a prescribed pace.',
    unit: 's/mi',
    belief: 'ENVIRONMENTAL_SENSITIVITY',
    toleranceAbs: 0,
    sites: [
      {
        siteId: 'lib/training/heat-model.ts#effortSlowdownPct',
        module: 'lib/training/heat-model.ts',
        symbol: 'effortSlowdownPct',
        role: 'OWNER',
        probe: 'PURE',
        unit: 's/mi of heat',
        toleranceAbs: 0,
        computes: 'The composed heat slowdown for one effort: Maughan column '
          + 'at the runner\'s own VDOT, dewpoint surcharge, duration scale, '
          + 'interval factor.',
        reachedBy: [
          'lib/weather/heat-adjustment.ts#applyHeatToPace',
          'lib/race/execution-plan.ts',
          'lib/watch/heat.ts',
          'lib/coach/weather-adjust.ts',
        ],
      },
      {
        siteId: 'lib/weather/heat-adjustment.ts#applyHeatToPace',
        module: 'lib/weather/heat-adjustment.ts',
        symbol: 'applyHeatToPace',
        role: 'SECOND',
        probe: 'PURE',
        comparesTo: 'lib/training/heat-model.ts#effortSlowdownPct',
        computes: 'The owner\'s percentage applied to a pace — but its '
          + 'signature takes an ABILITY TIER and has no VDOT parameter, so '
          + 'it can only ever spend the stepped population column where the '
          + 'owner reads the runner\'s own VDOT continuously.',
        reachedBy: [
          'lib/coach/weather-adjust.ts',
          'lib/training/durability-anchor.ts',
        ],
      },
      {
        siteId: 'lib/training/heat-model.ts#maughanSlowdownPctForVdot',
        module: 'lib/training/heat-model.ts',
        symbol: 'maughanSlowdownPctForVdot',
        role: 'EVIDENCE',
        probe: 'PURE',
        comparesTo: 'lib/training/heat-model.ts#effortSlowdownPct',
        computes: 'The bare doctrine table read. A COMPONENT of the owner, '
          + 'legitimately different from it — but two production sites call '
          + 'it raw, which is a component being spent as an answer.',
        reachedBy: [
          'lib/training/heat-model.ts#heatEffort',
          'lib/race/representativeness.ts',
          'app/api/today/purpose/route.ts',
        ],
      },
      {
        siteId: 'lib/terrain/grade-adjust.ts#GRADE_COST_PER_PCT',
        module: 'lib/terrain/grade-adjust.ts',
        symbol: 'GRADE_COST_PER_PCT',
        role: 'OWNER',
        probe: 'PURE',
        unit: 's/mi per 1% grade',
        toleranceAbs: 0,
        computes: 'Fraction of pace added per 1% of uphill grade. The terrain '
          + 'owner\'s one declaration.',
        reachedBy: [
          'lib/terrain/grade-adjust.ts#gradeFactor',
          'lib/training/elevation-model.ts',
        ],
      },
      {
        siteId: 'lib/training/elevation-model.ts#GRADE_COST_PER_PCT',
        module: 'lib/training/elevation-model.ts',
        symbol: 'GRADE_COST_PER_PCT',
        role: 'CARRIER',
        probe: 'PURE',
        comparesTo: 'lib/terrain/grade-adjust.ts#GRADE_COST_PER_PCT',
        computes: 'Re-exported from the terrain owner as of 2026-09-05. It '
          + 'was a SECOND literal declaration of the same physiology with no '
          + 'doctrine claim watching it, in a file that already imported the '
          + 'descent fraction from that owner — so the import edge existed '
          + 'and had simply not been used for this constant.',
        reachedBy: [
          'lib/training/elevation-model.ts#courseElevationCostSec',
          'lib/training/course-impact.ts',
        ],
      },
    ],
    acceptedDivergence: [
      {
        between: [
          'lib/training/heat-model.ts#effortSlowdownPct',
          'lib/weather/heat-adjustment.ts#applyHeatToPace',
        ],
        maxAbs: 6,
        why: 'THE ONE FUNCTION THAT APPLIES HEAT TO A PACE CANNOT SEE THE '
          + 'RUNNER. `applyHeatToPace`\'s signature is (pace, tempF, '
          + 'distanceMi, abilityTier, ctx) — there is no VDOT parameter — so '
          + 'it spends `maughanSlowdownPct`\'s STEPPED tier column where the '
          + 'owner spends `maughanSlowdownPctForVdot`\'s continuous read. '
          + 'Worse in practice than in principle: `durability-anchor.ts` '
          + 'calls it with the DEFAULT tier, so a runner far from mid-pack '
          + 'has his rehearsal paces normalised against a population he is '
          + 'not in.',
        closesWhen: 'applyHeatToPace takes an optional vdot and forwards it, '
          + 'the way every other caller of effortSlowdownPct already does. '
          + 'It is a one-parameter change and it is NOT done here only '
          + 'because it moves durability normalisation, which is the '
          + 'Evidence Engine owner\'s number rather than this pass\'s.',
      },
    ],
  },
};

/* ══════════════════════════════════════════════════════════════════════════
 * DERIVED VIEWS · computed here so no caller re-derives them (Rule 17)
 * ═══════════════════════════════════════════════════════════════════════ */

/** Every site in the registry, flattened, with its quantity. */
export function allSites(): ReadonlyArray<{ quantity: QuantityId; site: QuantitySite }> {
  const out: Array<{ quantity: QuantityId; site: QuantitySite }> = [];
  for (const q of QUANTITY_IDS) {
    for (const site of QUANTITY_OWNERSHIP[q].sites) out.push({ quantity: q, site });
  }
  return out;
}

/**
 * The declared owners of a quantity.
 *
 * Plural because RECOVERY_SPACING genuinely holds two questions under one
 * heading — days after a RACE and days after a HARD SESSION — and splitting a
 * name that covers two quantities is what Rule 8's corollary and Rule 16 both
 * ask for. Every other quantity returns exactly one.
 */
export function ownersOf(q: QuantityId): readonly QuantitySite[] {
  return QUANTITY_OWNERSHIP[q].sites.filter((s) => s.role === 'OWNER');
}

/**
 * Every quantity that still has a site independently answering it.
 *
 * The headline number for a report: how far the consolidation actually got. A
 * quantity appears here whether or not its divergence is accepted, because an
 * accepted divergence is still a second answer — it is a second answer
 * somebody has argued for and measured, which is not the same as resolved.
 */
export function quantitiesWithASecondAnswer(): readonly QuantityId[] {
  return QUANTITY_IDS.filter(
    (q) => QUANTITY_OWNERSHIP[q].sites.some((s) => s.role === 'SECOND'),
  );
}

/** Every accepted divergence, for the report and for the ratchet. */
export function acceptedDivergences(): ReadonlyArray<{
  quantity: QuantityId;
  divergence: AcceptedDivergence;
}> {
  const out: Array<{ quantity: QuantityId; divergence: AcceptedDivergence }> = [];
  for (const q of QUANTITY_IDS) {
    for (const d of QUANTITY_OWNERSHIP[q].acceptedDivergence) {
      out.push({ quantity: q, divergence: d });
    }
  }
  return out;
}

/** Sites deleted by a consolidation, guarded against reintroduction. */
export function removedSites(): ReadonlyArray<{ quantity: QuantityId; site: QuantitySite }> {
  return allSites().filter(({ site }) => site.role === 'REMOVED');
}
