/**
 * lib/runner-state/ownership.ts · WHO ANSWERS WHAT, AND WHO ELSE ALSO DOES.
 *
 * ── WHAT THIS IS ───────────────────────────────────────────────────────────
 *
 * `docs/BRAIN_CONSTITUTION.md` §29 assigns one canonical owner per coaching
 * QUESTION at the level of a domain. This is the same rule one level down, at
 * the level of a FUNCTION: for each of the twenty runner facts in
 * `belief.ts`, which exported symbol is THE answer, which other symbols also
 * answer it, and can they disagree.
 *
 * §5 is the sentence being enforced: "Never `thresholdFromRace()` /
 * `thresholdFromWorkout()` / `thresholdFromVDOT()` / `thresholdForPlan()` /
 * `thresholdForPrediction()` all independently returning different truths."
 * They exist. This file names them.
 *
 * ── WHY A REGISTRY AND NOT A REFACTOR ──────────────────────────────────────
 *
 * Rule 16 says do not silently pick one. Every conflict below is recorded
 * with both `file:line` references and a stated verdict, and the verdict is
 * one of three:
 *
 *   RESOLVED   the loser already routes to the winner. Recorded so a
 *              regression is visible, not because anything is outstanding.
 *   ROUTED     this session routed the loser to the winner. Named.
 *   OPEN       not safe to route here, or not this session's call. The
 *              conflict is recorded with both references and stays open.
 *
 * Nothing in this file is OPEN by omission. A belief with two owners and no
 * `conflict` entry fails the gate.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ──────────────────────────────────────────
 *
 * No numbers, no thresholds, no physiology. This file names functions. If a
 * future edit puts a pace, a mileage or a band in here, it has started a
 * second brain and `_runner_state.test.ts` fails on it by name.
 *
 * ── RULE 22 · WHAT THIS FILE'S GATE CANNOT FAIL ON ─────────────────────────
 *
 * · It cannot tell whether the CANONICAL choice is the right one. It proves
 *   the named symbol exists, that the belief states a Rule 8 side, and that
 *   competing owners are declared. Whether `sustainedWeeklyMileage` is a
 *   better answer than `resolveRampBase` is a coaching judgement no gate
 *   makes.
 * · It cannot find a competing owner nobody wrote down. The registry is
 *   hand-built from a survey and a survey misses things. The liveness assert
 *   catches a registry that has gone empty; it cannot catch one that was
 *   never complete. Where a belief's survey found nothing, `competing` is
 *   empty AND `surveyed` says what was searched, so the next reader can tell
 *   "looked and found none" from "did not look" (Rule 11 applied to this
 *   file itself).
 * · It cannot see a NEW competing owner added tomorrow. Only a scanner over
 *   the whole tree could, and a scanner for "does this function answer the
 *   same coaching question" is not a syntactic property.
 * · It is one-sided in the same way `check-coercion.sh` is: every assertion
 *   fires on a belief having too many owners. None fires on a belief whose
 *   single owner is wrong.
 */
import type {
  BeliefImmovable,
  BeliefKey,
  BeliefLever,
  BeliefOwnerRef,
  ConstitutionOwner,
  Rule8Side,
} from './belief';

/* ══════════════════════════════════════════════════════════════════════════
 * THE CONFLICT RECORD
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Another site that answers the same question.
 *
 * `at` is `path:line` and is NOT resolved by the gate. Line numbers rot, and
 * Rule 7's first instruction is to anchor on quoted text rather than a line.
 * The line here is a POINTER FOR A HUMAN reading the report; `module` and
 * `symbol` are the machine-checkable pair and those are what the gate
 * resolves. A rotted line number is a stale comment; a rotted symbol is a
 * build failure.
 */
export interface CompetingOwner {
  readonly module: string;
  readonly symbol: string;
  /** `path:line` as surveyed. Human pointer only. */
  readonly at: string;
  /** What it computes instead. */
  readonly computes: string;
  /** Can it return a different answer for the same runner on the same day. */
  readonly canDisagree: boolean;
}

export type ConflictVerdict = 'RESOLVED' | 'ROUTED' | 'OPEN';

export interface Rule16Conflict {
  readonly verdict: ConflictVerdict;
  /** Which of the competing owners this is about. `module#symbol`. */
  readonly between: readonly string[];
  /** Which one should own it, and why. Required even when OPEN. */
  readonly shouldOwn: string;
  readonly because: string;
  /** For OPEN only: why it was not routed here. Empty otherwise. */
  readonly notRoutedBecause: string;
}

export interface BeliefOwnership {
  readonly key: BeliefKey;
  /** The coaching question, in the runner's language. */
  readonly question: string;
  /** The §29 domain this belongs to. */
  readonly constitutionOwner: ConstitutionOwner;
  /**
   * The one function that should answer it. Null when the survey found NO
   * owner at all, which is a finding rather than an omission and is why the
   * field is nullable instead of being filled with the nearest thing.
   */
  readonly canonical: BeliefOwnerRef | null;
  readonly rule8Side: Rule8Side;
  /** Empty ONLY when the survey looked and found none. See `surveyed`. */
  readonly competing: readonly CompetingOwner[];
  /** What was searched. Present so an empty `competing` is a measurement. */
  readonly surveyed: string;
  /** Null only when `competing` is empty. */
  readonly conflict: Rule16Conflict | null;
  readonly movesUpOn: readonly BeliefLever[];
  readonly movesDownOn: readonly BeliefLever[];
  readonly neverMovesOn: readonly BeliefImmovable[];
}

/* ══════════════════════════════════════════════════════════════════════════
 * SHARED PROHIBITIONS
 *
 * Written once and referenced, because Rule 17 applies to this file too: a
 * sentence repeated twenty times is a sentence nobody reads.
 * ═══════════════════════════════════════════════════════════════════════ */

const NEVER_THE_GOAL: BeliefImmovable = {
  what: 'GOAL_STATED',
  why: 'The coach projects. It never renegotiates a stated goal, and a goal '
    + 'can never manufacture capacity the runner has not demonstrated.',
};

const NEVER_CALENDAR_TIME: BeliefImmovable = {
  what: 'CALENDAR_TIME',
  why: 'Doctrine 16. Time passing is not evidence of decline. Stale evidence '
    + 'lowers confidence, it does not lower the number.',
};

const NEVER_ONE_ANOMALY: BeliefImmovable = {
  what: 'ONE_ANOMALY',
  why: 'Doctrine 15. One run should rarely rewrite the runner. A single '
    + 'outlier raises a question, it does not settle one.',
};

const NEVER_READINESS: BeliefImmovable = {
  what: 'READINESS',
  why: 'Constitution 18. Tired is not less fit. State changes what training '
    + 'is appropriate today and never edits the underlying belief.',
};

const NEVER_TAPER: BeliefImmovable = {
  what: 'PRESCRIBED_TAPER',
  why: 'Rule 8. A week the engine itself told him to go easy in is not his '
    + 'training identity, and sizing the next block off it is the defect.',
};

const NEVER_PREDICTION: BeliefImmovable = {
  what: 'RACE_PREDICTION',
  why: 'Constitution J. Race prediction is an output of the model, never an '
    + 'input to it. A prediction that feeds back is a loop, not a belief.',
};

/* ══════════════════════════════════════════════════════════════════════════
 * THE REGISTRY
 * ═══════════════════════════════════════════════════════════════════════ */

export const BELIEF_OWNERSHIP: Readonly<Record<BeliefKey, BeliefOwnership>> = {

  /* ── 1 ─────────────────────────────────────────────────────────────── */
  SUSTAINABLE_WEEKLY_VOLUME: {
    key: 'SUSTAINABLE_WEEKLY_VOLUME',
    question: 'How much can this runner hold in a week, week after week.',
    constitutionOwner: 'Runner Model',
    canonical: {
      module: 'lib/training/normal-window.ts',
      symbol: 'sustainedWeeklyMileage',
      answers: 'The rank-3 week over fully representative trailing 7-day '
        + 'blocks, taper and post-race recovery excluded, refusing under six '
        + 'representative weeks.',
    },
    rule8Side: 'HABIT',
    competing: [
      {
        module: 'lib/plan/generate.ts',
        symbol: 'resolveRampBase',
        at: 'lib/plan/generate.ts:1457',
        computes: 'The same rank-3 order statistic, over a raw 112 calendar '
          + 'day series with no Rule 8 filter, plus a 0.70 resume fraction.',
        canDisagree: true,
      },
      {
        module: 'lib/adaptation/volume-evidence/belief.ts',
        symbol: 'rankWeek',
        at: 'lib/adaptation/volume-evidence/belief.ts:123',
        computes: 'A third copy of rank-k descending, fed representative '
          + 'weeks by its caller.',
        canDisagree: true,
      },
      {
        module: 'lib/coach/runner-calibration.ts',
        symbol: 'peakWeekMi',
        at: 'lib/coach/runner-calibration.ts:335',
        computes: 'A filtered 28-day calendar-week maximum, persisted as '
          + 'runner_calibration.volume_ceiling_mi.',
        canDisagree: true,
      },
    ],
    surveyed: 'lib/training, lib/plan, lib/adaptation, lib/coach, lib/runs, '
      + 'lib/onboarding for weekly-volume capability readers.',
    conflict: {
      verdict: 'OPEN',
      between: [
        'lib/training/normal-window.ts#sustainedWeeklyMileage',
        'lib/plan/generate.ts#resolveRampBase',
        'lib/adaptation/volume-evidence/belief.ts#rankWeek',
      ],
      shouldOwn: 'lib/training/normal-window.ts#sustainedWeeklyMileage',
      because: 'It is the only one of the three that excludes prescribed '
        + 'taper and recovery days, and the only one that refuses rather than '
        + 'answering off a thin sample. The other two take the same order '
        + 'statistic over a different population, so for any runner with a '
        + 'race in the look-back they answer different numbers.',
      notRoutedBecause: 'resolveRampBase sits inside the plan generator, '
        + 'which normal-window.ts cannot import without closing a cycle, and '
        + 'changing the ramp base changes composed volume for every runner. '
        + 'That is an engine change with its own corpus movement, not a '
        + 'registry entry. Recorded with both references.',
    },
    movesUpOn: [
      {
        what: 'Two more full weeks of ordinary training at a higher volume '
          + 'than the current sustained week.',
        reader: 'lib/training/normal-window.ts#representativeWeeks',
      },
      {
        what: 'A surplus week the engine admits as evidence rather than as a '
          + 'one-off.',
        reader: 'lib/adaptation/volume-evidence/belief.ts#updateDemonstratedVolume',
      },
    ],
    movesDownOn: [
      {
        what: 'Sustained lower weeks that are not prescribed recovery.',
        reader: 'lib/adaptation/volume-evidence/belief.ts#applyCapacityLoss',
      },
    ],
    neverMovesOn: [NEVER_TAPER, NEVER_THE_GOAL, NEVER_CALENDAR_TIME],
  },

  /* ── 2 ─────────────────────────────────────────────────────────────── */
  RECENT_COMPLETED_VOLUME: {
    key: 'RECENT_COMPLETED_VOLUME',
    question: 'How much has this runner actually run lately.',
    constitutionOwner: 'Training Load',
    canonical: {
      module: 'lib/runs/volume.ts',
      symbol: 'recentWeeklyMileageMi',
      answers: 'The literal 28-day total over covered weeks, taper days '
        + 'included, because a taper day is a real day he really ran.',
    },
    rule8Side: 'ABSORBED_LOAD',
    competing: [],
    surveyed: 'lib/runs, lib/plan, lib/faff for absorbed-volume readers. The '
      + 'other sites found (generate.ts trailingAvgWeeklyMi, '
      + 'drift-monitor.ts, adapt.ts preAbsenceWeeklyMi) are the same posture '
      + 'over different windows for different questions, not competing '
      + 'answers to this one.',
    conflict: null,
    movesUpOn: [
      {
        what: 'Running more miles. This is a measurement, not a judgement.',
        reader: 'lib/runs/volume.ts#recentMileageWindow',
      },
    ],
    movesDownOn: [
      {
        what: 'Running fewer miles, for any reason including a taper.',
        reader: 'lib/runs/volume.ts#recentMileageWindow',
      },
    ],
    neverMovesOn: [
      {
        what: 'PRESCRIBED_TAPER',
        why: 'The INVERSE of Rule 8 and the corollary it spends most of its '
          + 'text on. This reader must keep every taper day. Filtering it '
          + 'would make an injury guard more permissive in exactly the case '
          + 'the guard exists for.',
      },
      NEVER_THE_GOAL,
    ],
  },

  /* ── 3 ─────────────────────────────────────────────────────────────── */
  ACUTE_LOAD: {
    key: 'ACUTE_LOAD',
    question: 'What have the last seven days cost him.',
    constitutionOwner: 'Training Load',
    canonical: {
      module: 'lib/coach/acwr.ts',
      symbol: 'computeAcwr',
      answers: 'Seven-day mean daily mileage against the 28-day base, with a '
        + 'typed reason when it cannot honestly be computed.',
    },
    rule8Side: 'ABSORBED_LOAD',
    competing: [
      {
        module: 'lib/coach/training-form.ts',
        symbol: 'computeTrainingForm',
        at: 'lib/coach/training-form.ts:117',
        computes: 'A 7-day exponentially weighted acute load on a '
          + 'TSS-like intensity scale, not on mileage.',
        canDisagree: true,
      },
    ],
    surveyed: 'lib/coach, lib/plan, lib/adaptation for acute-load readers. '
      + 'The five hand-rolled ACWR copies the survey expected were already '
      + 'consolidated onto computeAcwr; glance-state.ts and state-loader.ts '
      + 'both delegate.',
    conflict: {
      verdict: 'OPEN',
      between: [
        'lib/coach/acwr.ts#computeAcwr',
        'lib/coach/training-form.ts#computeTrainingForm',
      ],
      shouldOwn: 'lib/coach/acwr.ts#computeAcwr',
      because: 'Doctrine cites the acute:chronic ratio on distance, and the '
        + 'ratio is what every downstream guard reads. The training-form '
        + 'EWMA answers a related but different question on a different '
        + 'unit, and neither module states which of the two a surface should '
        + 'quote for acute load.',
      notRoutedBecause: 'They are arguably two quantities rather than two '
        + 'answers, and deciding that is the Training Load owner call. What '
        + 'is missing is a sentence in either file saying which one a '
        + 'surface should read, and adding it to another owner file is not '
        + 'this session to take.',
    },
    movesUpOn: [
      { what: 'A heavier seven days.', reader: 'lib/coach/acwr.ts#acwrFromDailyMileage' },
    ],
    movesDownOn: [
      { what: 'A lighter seven days.', reader: 'lib/coach/acwr.ts#acwrFromDailyMileage' },
    ],
    neverMovesOn: [
      {
        what: 'PRESCRIBED_TAPER',
        why: 'Acute load is supposed to fall in a taper. That is what makes '
          + 'it acute. Filtering it would hide the freshness it exists to '
          + 'measure.',
      },
      NEVER_THE_GOAL,
    ],
  },

  /* ── 4 ─────────────────────────────────────────────────────────────── */
  CHRONIC_LOAD: {
    key: 'CHRONIC_LOAD',
    question: 'What base is his acute load being measured against.',
    constitutionOwner: 'Training Load',
    canonical: {
      module: 'lib/coach/acwr.ts',
      symbol: 'acwrFromDailyMileage',
      answers: 'The 28-day mean daily mileage that is the denominator of the '
        + 'ratio. Unfiltered, on purpose.',
    },
    rule8Side: 'ABSORBED_LOAD',
    competing: [
      {
        module: 'lib/coach/training-form.ts',
        symbol: 'computeTrainingForm',
        at: 'lib/coach/training-form.ts:117',
        computes: 'A 42-day exponentially weighted chronic load on a '
          + 'TSS-like scale.',
        canDisagree: true,
      },
      {
        module: 'lib/coach/convergence-loader.ts',
        symbol: 'loadConvergenceContext',
        at: 'lib/coach/convergence-loader.ts:366',
        computes: 'chronic28 times seven, under the name habitualWeeklyMpw. '
          + 'A chronic-load number wearing a habit name.',
        canDisagree: true,
      },
      {
        module: 'lib/coach/readiness.ts',
        symbol: 'weeklyMpwFor',
        at: 'lib/coach/readiness.ts:454',
        computes: 'chronic28 times seven again, in a third place.',
        canDisagree: false,
      },
    ],
    surveyed: 'lib/coach, lib/plan for chronic-load and "usual week" readers.',
    conflict: {
      verdict: 'OPEN',
      between: [
        'lib/coach/acwr.ts#acwrFromDailyMileage',
        'lib/coach/convergence-loader.ts#loadConvergenceContext',
        'lib/plan/adapt.ts#detectVolumeOvershoot',
      ],
      shouldOwn: 'lib/coach/acwr.ts#acwrFromDailyMileage',
      because: 'One chronic leg, one definition. Three call sites currently '
        + 'multiply it by seven to reach "his usual week", and a fourth '
        + '(detectVolumeOvershoot) computes a Rule 8 FILTERED chronic leg for '
        + 'the same phrase. So a surface quoting "your usual week" from the '
        + 'coach lane and one quoting it from the plan lane disagree during '
        + 'and after any taper, which is precisely Rule 16.',
      notRoutedBecause: 'Both postures are individually argued and both have '
        + 'registered Rule 8 exemptions. The filtered leg feeds a card that '
        + 'says "your usual {N} mile week", where filtering is right; the '
        + 'unfiltered leg feeds the ratio, where it is right. The missing '
        + 'piece is one named habit reader the card can call instead, and '
        + 'building it means editing another owner file.',
    },
    movesUpOn: [
      { what: 'A heavier month.', reader: 'lib/coach/acwr.ts#acwrFromDailyMileage' },
    ],
    movesDownOn: [
      { what: 'A lighter month.', reader: 'lib/coach/acwr.ts#acwrFromDailyMileage' },
    ],
    neverMovesOn: [NEVER_THE_GOAL, NEVER_READINESS],
  },

  /* ── 5 ─────────────────────────────────────────────────────────────── */
  RUN_FREQUENCY_TOLERANCE: {
    key: 'RUN_FREQUENCY_TOLERANCE',
    question: 'How many days a week does he run, and how many can he run.',
    constitutionOwner: 'Runner Model',
    canonical: null,
    rule8Side: 'HABIT',
    competing: [
      {
        module: 'lib/plan/goal-tiers.ts',
        symbol: 'TIER_TARGETS',
        at: 'lib/plan/goal-tiers.ts:654',
        computes: 'The doctrine table daysPerWeek per archetype. Used '
          + 'whenever profile.weekly_frequency is null, which Rule 11 '
          + 'measured at 8 of 16 production profiles.',
        canDisagree: true,
      },
      {
        module: 'lib/training/normal-window.ts',
        symbol: 'normalWeeklyMileageDetail',
        at: 'lib/training/normal-window.ts:899',
        computes: 'runDays, the representative days with any mileage. A '
          + 'COVERAGE fact by its own doc comment, not a frequency rate.',
        canDisagree: true,
      },
      {
        module: 'lib/plan/block-preview.ts',
        symbol: 'previewBlockShape',
        at: 'lib/plan/block-preview.ts:396',
        computes: 'The one site that distinguishes a stated frequency from a '
          + 'defaulted one, as { value, sourced }.',
        canDisagree: false,
      },
    ],
    surveyed: 'lib/plan, lib/training, lib/faff, lib/onboarding for any '
      + 'reader that derives run frequency from completed runs.',
    conflict: {
      verdict: 'OPEN',
      between: [
        'profile.weekly_frequency (stated)',
        'lib/plan/goal-tiers.ts#TIER_TARGETS',
        'lib/training/normal-window.ts#normalWeeklyMileageDetail',
      ],
      shouldOwn: 'a habit reader in lib/training/normal-window.ts that does '
        + 'not yet exist',
      because: 'NOTHING MEASURES THIS. Every site above reads a stated value, '
        + 'a population table, or a coverage count that its own comment says '
        + 'is not a rate. Rule 8 lists the frequency derivation among its six '
        + 'founding defects (a median of 5 read for a runner who runs 6) and '
        + 'the derivation it describes no longer exists anywhere in the tree. '
        + 'So the belief is stated, never demonstrated, and a runner who has '
        + 'moved from five days to six cannot tell the engine by running.',
      notRoutedBecause: 'Building a measured frequency reader means deciding '
        + 'what it does when it disagrees with a stated preference, which is '
        + 'a coaching decision about whose answer wins. Recorded rather than '
        + 'guessed.',
    },
    movesUpOn: [],
    movesDownOn: [],
    neverMovesOn: [
      NEVER_TAPER,
      {
        what: 'GOAL_STATED',
        why: 'A more ambitious goal does not give the runner another day in '
          + 'the week.',
      },
    ],
  },

  /* ── 6 ─────────────────────────────────────────────────────────────── */
  LONG_RUN_TOLERANCE: {
    key: 'LONG_RUN_TOLERANCE',
    question: 'How long a long run does he handle.',
    constitutionOwner: 'Runner Model',
    canonical: {
      module: 'lib/plan/generate.ts',
      symbol: 'evidenceLongCeilingMi',
      answers: 'The long-run ceiling his own evidence supports, from a '
        + '365-day demonstrated long with races excluded and taper excluded, '
        + 'bounded by the tier band.',
    },
    rule8Side: 'HABIT',
    competing: [
      {
        module: 'lib/adaptation/canonical/levers/long-run.ts',
        symbol: 'evaluateLongRun',
        at: 'lib/adaptation/canonical/levers/long-run.ts:110',
        computes: 'A spike ceiling at 1.10 times the LITERAL longest run in '
          + 'the prior 30 days. Deliberately unfiltered.',
        canDisagree: true,
      },
      {
        module: 'lib/coach/runner-calibration.ts',
        symbol: 'loadRunnerCalibration',
        at: 'lib/coach/runner-calibration.ts:295',
        computes: 'long_tolerance_mi, a filtered 14-day median of runs '
          + 'between 10 and 30 miles.',
        canDisagree: true,
      },
    ],
    surveyed: 'lib/plan, lib/adaptation, lib/coach, lib/onboarding for '
      + 'long-run capability and long-run spike readers.',
    conflict: {
      verdict: 'RESOLVED',
      between: [
        'lib/plan/generate.ts#evidenceLongCeilingMi',
        'lib/adaptation/canonical/levers/long-run.ts#evaluateLongRun',
      ],
      shouldOwn: 'both, because they are two questions',
      because: 'This is Rule 8 corollary done right and it is the worked '
        + 'example the rule itself cites. The habit half asks what he can do '
        + 'and is filtered; the spike anchor asks what his legs have been '
        + 'prepared for in the last thirty days and stays literal, because '
        + 'Research/00a writes its own 30-day window into the citation. '
        + 'recentPeakLongMi was one name over two quantities and was split.',
      notRoutedBecause: '',
    },
    movesUpOn: [
      {
        what: 'A longer training long run absorbed outside a taper.',
        reader: 'lib/plan/generate.ts#demonstratedLongMi',
      },
    ],
    movesDownOn: [
      {
        what: 'A long-run habit that falls away over a full year.',
        reader: 'lib/plan/generate.ts#demonstratedLongMi',
      },
    ],
    neverMovesOn: [NEVER_TAPER, NEVER_THE_GOAL, NEVER_ONE_ANOMALY],
  },

  /* ── 7 ─────────────────────────────────────────────────────────────── */
  THRESHOLD_PACE: {
    key: 'THRESHOLD_PACE',
    question: 'What can he hold at threshold.',
    constitutionOwner: 'Runner Model',
    canonical: {
      module: 'lib/training/capacity-resolver.ts',
      symbol: 'resolveThresholdCapacity',
      answers: 'T pace in seconds per mile with confidence, source mode and '
        + 'the evidence ids behind it, off a four-rung ladder with a '
        + 'day-to-day continuity cap.',
    },
    rule8Side: 'NEITHER',
    competing: [
      {
        module: 'lib/training/vdot.ts',
        symbol: 'resolveCurrentTPace',
        at: 'lib/training/vdot.ts:1679',
        computes: 'The legacy three-rung cascade. Returns a tier label and '
          + 'no confidence, and misses both the corpus rung and the '
          + 'continuity cap.',
        canDisagree: true,
      },
      {
        module: 'lib/plan/seed-from-onboarding.ts',
        symbol: 'persistMaintenancePlan',
        at: 'lib/plan/seed-from-onboarding.ts:564',
        computes: 'The cold-start threshold for the very first plan, off a '
          + 'measured or mileage-derived VDOT, inside the onboarding '
          + 'transaction before the resolver can read the runner at all.',
        canDisagree: true,
      },
      {
        module: 'lib/adaptation/canonical/levers/threshold-pace.ts',
        symbol: 'evaluateThresholdPace',
        at: 'lib/adaptation/canonical/levers/threshold-pace.ts:117',
        computes: 'Moves a carried anchor from its own admissibility rules, '
          + 'which are a second ruleset over the same sessions.',
        canDisagree: true,
      },
    ],
    surveyed: 'lib/training, lib/plan, lib/adaptation, lib/race for anything '
      + 'that produces a threshold pace.',
    conflict: {
      verdict: 'OPEN',
      between: [
        'lib/training/capacity-resolver.ts#resolveThresholdCapacity',
        'lib/training/vdot.ts#resolveCurrentTPace',
        'lib/plan/seed-from-onboarding.ts#persistMaintenancePlan',
      ],
      shouldOwn: 'lib/training/capacity-resolver.ts#resolveThresholdCapacity',
      because: 'Constitution 5 names this exact function as the one '
        + 'application-level answer, and it is the only one of the three '
        + 'that carries confidence, source mode and evidence ids.',
      notRoutedBecause: 'THE GOAL SIDE DOOR IS CLOSED (THRESHOLD-OWNER-1, '
        + '2026-09-05). spec-builder.tPaceFromGoal was the third competitor '
        + 'in this row and it is DELETED: it read the stated goal and '
        + 'returned a threshold, measured live at 394 s/mi against the '
        + 'canonical 430, and its last caller (adapt.ts single-row rebuild) '
        + 'now reads resolvePrescribedPaceAnchors. The executed-run grader '
        + '(execution/reconstruct.ts) was migrated in the same pass and three '
        + 'dead imports of the legacy cascade were removed. What is left is '
        + 'not a side door: resolveCurrentTPace survives only as rungs 2-4 '
        + 'the canonical resolver itself calls, and the seeder answers before '
        + 'any belief exists. lib/training/_threshold_owner_scan.test.ts is '
        + 'now the gate on this row and fails when a new owner appears.',
    },
    movesUpOn: [
      {
        what: 'Threshold sessions consistently ahead of target at the same '
          + 'effort.',
        reader: 'lib/training/pace-corpus.ts#thresholdPaceCorpus',
      },
      {
        what: 'A race that anchors a faster equivalent.',
        reader: 'lib/training/vdot.ts#bestRecentVdot',
      },
    ],
    movesDownOn: [
      {
        what: 'Threshold sessions repeatedly behind target at the same '
          + 'effort.',
        reader: 'lib/training/pace-corpus.ts#thresholdPaceCorpus',
      },
    ],
    neverMovesOn: [
      NEVER_THE_GOAL, NEVER_CALENDAR_TIME, NEVER_ONE_ANOMALY,
      NEVER_READINESS, NEVER_PREDICTION,
    ],
  },

  /* ── 8 ─────────────────────────────────────────────────────────────── */
  MARATHON_PACE: {
    key: 'MARATHON_PACE',
    question: 'What can he hold for the marathon.',
    constitutionOwner: 'Pace Prescription',
    canonical: {
      module: 'lib/training/prescription-resolver.ts',
      symbol: 'marathonPaceFromDurability',
      answers: 'Threshold carried to 26.2 through the runner OWN fitted '
        + 'endurance exponent, with a range and a rehearsal cap.',
    },
    rule8Side: 'NEITHER',
    competing: [
      {
        module: 'lib/plan/spec-builder.ts',
        symbol: 'resolveMarathonPace',
        at: 'lib/plan/spec-builder.ts:281',
        computes: 'Threshold plus a flat population offset, and lets the '
          + 'GOAL pace become the training pace when it sits in zone. '
          + 'Measured live at 412 against the canonical 472.',
        canDisagree: true,
      },
      {
        module: 'lib/training/vdot.ts',
        symbol: 'predictRaceTimeFromAnchor',
        at: 'lib/training/vdot.ts:365',
        computes: 'The same carry across distance on a hardcoded Riegel '
          + 'exponent instead of the runner fitted one.',
        canDisagree: true,
      },
    ],
    surveyed: 'lib/training, lib/plan, lib/race for marathon-pace producers.',
    conflict: {
      verdict: 'OPEN',
      between: [
        'lib/training/prescription-resolver.ts#marathonPaceFromDurability',
        'lib/plan/spec-builder.ts#resolveMarathonPace',
      ],
      shouldOwn: 'lib/training/prescription-resolver.ts#marathonPaceFromDurability',
      because: 'Doctrine 17 is explicit that short-distance ability does not '
        + 'guarantee long-distance performance and that durability is what '
        + 'bridges them. A flat offset from threshold is the population '
        + 'assumption doctrine 26 says to REPLACE once individual evidence '
        + 'exists. And the goal branch is the same forbidden side door '
        + 'tPaceFromGoal was, which was deleted on 2026-09-05 · this one is '
        + 'the last of that shape left in the engine.',
      notRoutedBecause: 'The fork is already gated on whether the caller '
        + 'passes resolved anchors, so the legacy branch is reached only by '
        + 'callers that have none. Closing it means giving every caller '
        + 'anchors, which is the same migration as the threshold row.',
    },
    movesUpOn: [
      {
        what: 'A marathon-pace rehearsal held at marathon effort over '
          + 'rehearsal distance.',
        reader: 'lib/training/durability-anchor.ts#aggregateMarathonRehearsals',
      },
      {
        what: 'Threshold moving, which carries through the exponent.',
        reader: 'lib/training/capacity-resolver.ts#resolveThresholdCapacity',
      },
    ],
    movesDownOn: [
      {
        what: 'Late-run deterioration showing the carry is not holding.',
        reader: 'lib/training/durability-anchor.ts#fitRaceExponent',
      },
    ],
    neverMovesOn: [
      NEVER_THE_GOAL, NEVER_READINESS, NEVER_ONE_ANOMALY, NEVER_PREDICTION,
    ],
  },

  /* ── 9 ─────────────────────────────────────────────────────────────── */
  INTERVAL_PACE: {
    key: 'INTERVAL_PACE',
    question: 'What can he hold at three to five kilometre effort.',
    constitutionOwner: 'Runner Model',
    canonical: {
      module: 'lib/training/capacity-resolver.ts',
      symbol: 'resolveHighIntensityCapacity',
      answers: 'Interval pace off the measured anchor, with repetition pace '
        + 'left null rather than invented where doctrine has no route to it.',
    },
    rule8Side: 'NEITHER',
    competing: [
      {
        module: 'lib/plan/spec-builder.ts',
        symbol: 'marathonPaceSPerMi',
        at: 'lib/plan/spec-builder.ts:222',
        computes: 'The fallback branch in the same file prices interval at a '
          + 'flat threshold minus 18, which its own comment concedes is a '
          + 'deliberate deviation from the doctrine offset.',
        canDisagree: true,
      },
      {
        module: 'lib/plan/zone-anchors.ts',
        symbol: 'resolveZoneAnchors',
        at: 'lib/plan/zone-anchors.ts:184',
        computes: 'Prices the faster zones off an anchor round-tripped back '
          + 'out of the week threshold pace rather than off the measured '
          + 'anchor, and substitutes a repetition pace where the canonical '
          + 'resolver returns null.',
        canDisagree: true,
      },
    ],
    surveyed: 'lib/training, lib/plan for interval and repetition pace '
      + 'producers.',
    conflict: {
      verdict: 'OPEN',
      between: [
        'lib/training/capacity-resolver.ts#resolveHighIntensityCapacity',
        'lib/plan/zone-anchors.ts#resolveZoneAnchors',
      ],
      shouldOwn: 'lib/training/capacity-resolver.ts#resolveHighIntensityCapacity',
      because: 'The round trip is the defect, not the offset. Pricing the '
        + 'fast zones off a value recovered from the week threshold pace '
        + 'means the continuity cap and the corpus rung, both of which move '
        + 'the week threshold, silently move interval pace too, in a '
        + 'direction nobody chose. And a surface that prints a repetition '
        + 'pace where the owner says unknown is Rule 11 collapsed at the '
        + 'last step.',
      notRoutedBecause: 'zone-anchors.ts is the plan generator lane and its '
        + 'callers do not all hold resolved anchors. Same migration again.',
    },
    movesUpOn: [
      {
        what: 'A race or time trial at five kilometres or shorter.',
        reader: 'lib/training/vdot.ts#bestRecentVdot',
      },
    ],
    movesDownOn: [
      {
        what: 'The measured anchor falling, which carries through.',
        reader: 'lib/training/capacity-resolver.ts#composeHighIntensityCapacity',
      },
    ],
    neverMovesOn: [NEVER_THE_GOAL, NEVER_READINESS, NEVER_ONE_ANOMALY],
  },

  /* ── 10 ────────────────────────────────────────────────────────────── */
  MAX_DEMONSTRATED_DOSE: {
    key: 'MAX_DEMONSTRATED_DOSE',
    question: 'What is the biggest session of this kind he has actually '
      + 'completed.',
    constitutionOwner: 'Runner Model',
    canonical: null,
    rule8Side: 'HABIT',
    competing: [
      {
        module: 'lib/plan/adjudication/adjudicate.ts',
        symbol: 'athleteEvidenceFor',
        at: 'lib/plan/adjudication/adjudicate.ts:212',
        computes: 'The shaped slot for exactly this question. It takes a '
          + 'demonstrated maximum and grades a prescribed dose against it.',
        canDisagree: false,
      },
      {
        module: 'lib/plan/dosing.ts',
        symbol: 'weeklyDoseBudgetMi',
        at: 'lib/plan/dosing.ts:687',
        computes: 'A doctrine CAP on weekly at-pace dose. A ceiling, not '
          + 'evidence about this runner.',
        canDisagree: false,
      },
      {
        module: 'lib/prescription/trajectory.ts',
        symbol: 'atPaceCapMinutes',
        at: 'lib/prescription/trajectory.ts:340',
        computes: 'A per-family at-pace cap derived from weekly volume, '
          + 'again a ceiling rather than a demonstrated maximum.',
        canDisagree: false,
      },
    ],
    surveyed: 'lib/plan, lib/prescription, lib/execution, lib/workout-'
      + 'catalogue for any reader that aggregates a per-workout-type maximum '
      + 'from completed sessions.',
    conflict: {
      verdict: 'OPEN',
      between: ['lib/plan/adjudication/adjudicate.ts#athleteEvidenceFor'],
      shouldOwn: 'a per-type demonstrated-dose reader that does not yet exist',
      because: 'THE SLOT EXISTS AND IS EMPTY, and that is a Rule 21 finding '
        + 'rather than a Rule 16 one. athleteEvidenceFor is built to grade a '
        + 'prescribed dose against a demonstrated maximum, and exactly two '
        + 'quantities are ever passed to it: peak weekly mileage, and a '
        + 'completed marathon-pace maximum that the corpus records as null '
        + 'for every archetype. lib/execution/reconstruct.ts is the only '
        + 'place actual at-pace work minutes are measured and nothing '
        + 'aggregates a maximum from it. So session dose is bounded entirely '
        + 'by doctrine ceilings with no demonstrated floor, which means the '
        + 'engine can never notice that a runner has earned a bigger '
        + 'session.',
      notRoutedBecause: 'Building the reader is engine work with a corpus '
        + 'consequence, and Rule 15 says the fixture type has to be able to '
        + 'express the input before the mechanism can be tested at all.',
    },
    movesUpOn: [
      {
        what: 'Completing a bigger session of that type with the work '
          + 'actually landed.',
        reader: 'lib/execution/reconstruct.ts#actualStimulus',
      },
    ],
    movesDownOn: [],
    neverMovesOn: [NEVER_THE_GOAL, NEVER_TAPER],
  },

  /* ── 11 ────────────────────────────────────────────────────────────── */
  RECOVERY_RESPONSE: {
    key: 'RECOVERY_RESPONSE',
    question: 'How does he come back from a hard session or a race.',
    constitutionOwner: 'Readiness',
    canonical: {
      module: 'lib/coach/recovery-phase.ts',
      symbol: 'computeRecoveryPhase',
      answers: 'Which hard session he is recovering from, how far into it he '
        + 'is, and whether the data supports saying so at all.',
    },
    rule8Side: 'ABSORBED_LOAD',
    competing: [
      {
        module: 'lib/coach/state-loader.ts',
        symbol: 'loadCoachState',
        at: 'lib/coach/state-loader.ts:352',
        computes: 'A resting heart-rate baseline as the mean of a 30-day '
          + 'series excluding the last seven days, with the current value '
          + 'as the MEDIAN of the last three.',
        canDisagree: true,
      },
      {
        module: 'lib/coach/convergence-loader.ts',
        symbol: 'loadConvergenceSeries',
        at: 'lib/coach/convergence-loader.ts:338',
        computes: 'A DIFFERENT resting heart-rate baseline, the mean of the '
          + 'prior window only with a minimum of seven samples. This is the '
          + 'number that decides the cardiac vote, and it is not the number '
          + 'shown on the health surface.',
        canDisagree: true,
      },
      {
        module: 'lib/coach/health-state.ts',
        symbol: 'loadHealthState',
        at: 'lib/coach/health-state.ts:443',
        computes: 'A third copy of the same baseline formula, but with the '
          + 'current value as the arithmetic MEAN of the last three rather '
          + 'than the median. The median was the documented fix for one '
          + 'corrupted reading poisoning the answer, and this reader has it '
          + 'for heart-rate variability and not for resting heart rate.',
        canDisagree: true,
      },
      {
        module: 'lib/coach/profile-state.ts',
        symbol: 'loadProfileState',
        at: 'lib/coach/profile-state.ts:158',
        computes: 'A fourth, a plain 60-day average, falling back to the '
          + 'stored profile snapshot on a truthiness test.',
        canDisagree: true,
      },
      {
        module: 'lib/training/biometrics-refresh.ts',
        symbol: 'rollingRestingHr',
        at: 'lib/training/biometrics-refresh.ts:54',
        computes: 'A fifth, a seven-day rolling mean inside a sanity band, '
          + 'and the one that is WRITTEN BACK to the profile.',
        canDisagree: true,
      },
      {
        module: 'lib/plan/goal-tiers.ts',
        symbol: 'postRaceRecoveryWeeks',
        at: 'lib/plan/goal-tiers.ts',
        computes: 'The doctrine PRESCRIBED recovery window by distance and '
          + 'priority. A schedule fact, not an observation, and listed so '
          + 'the two are not confused.',
        canDisagree: false,
      },
    ],
    surveyed: 'lib/coach, lib/plan, lib/training, lib/evidence for recovery '
      + 'readers, including every resting heart-rate, heart-rate '
      + 'variability, sleep and subjective reader.',
    conflict: {
      verdict: 'OPEN',
      between: [
        'lib/coach/state-loader.ts#loadCoachState',
        'lib/coach/convergence-loader.ts#loadConvergenceSeries',
        'lib/coach/health-state.ts#loadHealthState',
        'lib/coach/profile-state.ts#loadProfileState',
        'lib/training/biometrics-refresh.ts#rollingRestingHr',
      ],
      shouldOwn: 'lib/training/biometrics-refresh.ts#rollingRestingHr',
      because: 'FIVE FORMULAS ANSWER "what is this runner resting heart '
        + 'rate baseline" and no two of them are the same window. That is '
        + 'the plainest Rule 16 violation this survey found. The one that '
        + 'should own it is the one that already WRITES the answer back to '
        + 'the profile, because a persisted derived value with one producer '
        + 'is the only arrangement in which the displayed number and the '
        + 'deciding number cannot come apart. The concrete cost today: the '
        + 'baseline that decides a cardiac vote and the baseline printed on '
        + 'the health surface are different numbers, and one reader uses a '
        + 'mean where its sibling uses a median specifically because a mean '
        + 'was poisoned by a corrupt reading in production.',
      notRoutedBecause: 'Every one of the five feeds a different surface '
        + 'with its own tests, and consolidating them changes what the '
        + 'runner reads on the health page and what the convergence grade '
        + 'says on the same morning. That needs a replay against his own '
        + 'history, not a registry entry.',
    },
    movesUpOn: [
      {
        what: 'Returning to normal paces at normal heart rate sooner after '
          + 'a hard session.',
        reader: 'lib/coach/recovery-phase.ts#computeRecoveryPhase',
      },
    ],
    movesDownOn: [
      {
        what: 'Taking longer than the expected window for the anchor '
          + 'session.',
        reader: 'lib/coach/recovery-phase.ts#expectedDaysForAnchor',
      },
    ],
    neverMovesOn: [NEVER_THE_GOAL, NEVER_ONE_ANOMALY],
  },

  /* ── 12 ────────────────────────────────────────────────────────────── */
  TRAINING_CONSISTENCY: {
    key: 'TRAINING_CONSISTENCY',
    question: 'How regularly does he actually train.',
    constitutionOwner: 'Training Load',
    canonical: null,
    rule8Side: 'ABSORBED_LOAD',
    competing: [
      {
        module: 'lib/adaptation/adaptation-model.ts',
        symbol: 'CONSISTENCY_SPREAD_NOTE',
        at: 'lib/adaptation/adaptation-model.ts:587',
        computes: 'A module-private readConsistency that scores planned '
          + 'against actual weekly mileage and its spread, and folds the '
          + 'result into a weighted dimension score.',
        canDisagree: true,
      },
      {
        module: 'lib/faff/week-mileage.ts',
        symbol: 'computeWeekMileage',
        at: 'lib/faff/week-mileage.ts:85',
        computes: 'Per-week actual against planned and days run, for a '
          + 'surface. No belief is kept.',
        canDisagree: true,
      },
      {
        module: 'lib/coach/runner-calibration.ts',
        symbol: 'loadRunnerCalibration',
        at: 'lib/coach/runner-calibration.ts:236',
        computes: 'A three-tier cold-start / building / calibrated label off '
          + 'workout counts. Account maturity, not training consistency.',
        canDisagree: true,
      },
    ],
    surveyed: 'lib/adaptation, lib/coach, lib/faff, lib/plan for adherence, '
      + 'completion-rate, streak and consistency readers.',
    conflict: {
      verdict: 'OPEN',
      between: ['lib/adaptation/adaptation-model.ts#CONSISTENCY_SPREAD_NOTE'],
      shouldOwn: 'a named reader in the Training Load owner, which does not '
        + 'yet exist',
      because: 'The only implementation is a private function inside a '
        + 'weighted dimension score, and Constitution 11 warns against '
        + 'exactly that shape: a score that exists to be combined with five '
        + 'other scores, with no domain statement anyone else can read. The '
        + 'reasoning inside it is good, and the point is that nothing else '
        + 'in the app can reach it. A surface asking how consistent this '
        + 'runner has been has nowhere to call.',
      notRoutedBecause: 'Promoting a private scorer to a canonical reader '
        + 'means deciding what the domain statement is, which is the '
        + 'Training Load owner call.',
    },
    movesUpOn: [
      {
        what: 'Weeks landing close to plan, with the shape steady rather '
          + 'than the mean flattering an interrupted block.',
        reader: 'lib/faff/week-mileage.ts#computeWeekMileage',
      },
    ],
    movesDownOn: [
      {
        what: 'Weeks scattering around the plan even when the mean holds.',
        reader: 'lib/faff/week-mileage.ts#computeWeekMileage',
      },
    ],
    neverMovesOn: [
      NEVER_THE_GOAL,
      {
        what: 'PRESCRIBED_TAPER',
        why: 'A cutback week the plan authored is adherence, not '
          + 'inconsistency. Grading it as a miss reads the engine own '
          + 'instruction as the runner failure.',
      },
    ],
  },

  /* ── 13 ────────────────────────────────────────────────────────────── */
  RACE_PERFORMANCE: {
    key: 'RACE_PERFORMANCE',
    question: 'What could he race right now.',
    constitutionOwner: 'Race Prediction',
    canonical: {
      module: 'lib/race/race-outlook.ts',
      symbol: 'resolveRaceOutlook',
      answers: 'Expected result, likely range, confidence and the limiter, '
        + 'from capacity plus durability plus preparation plus conditions.',
    },
    rule8Side: 'NEITHER',
    competing: [
      {
        module: 'lib/fitness/fitness-model.ts',
        symbol: 'resolveFitness',
        at: 'lib/fitness/fitness-model.ts:334',
        computes: 'A second race-equivalence range, fed from bestRecentVdot '
          + 'rather than from the capacity resolver. This is what Today '
          + 'prints under "Where you are".',
        canDisagree: true,
      },
      {
        module: 'lib/training/projection-snapshots.ts',
        symbol: 'resolveCurrentVdotSnapshot',
        at: 'lib/training/projection-snapshots.ts:318',
        computes: 'A stored nightly VDOT up to fourteen days old, derived '
          + 'from a different model than the outlook uses.',
        canDisagree: true,
      },
      {
        module: 'lib/race/personal-records.ts',
        symbol: 'composePersonalRecords',
        at: 'lib/race/personal-records.ts:152',
        computes: 'What he has actually raced, curated result first and a '
          + 'training-run fallback always labelled provisional. A different '
          + 'question, listed so the two are not confused.',
        canDisagree: false,
      },
    ],
    surveyed: 'lib/race, lib/training, lib/fitness for race-prediction and '
      + 'race-result producers.',
    conflict: {
      verdict: 'OPEN',
      between: [
        'lib/race/race-outlook.ts#resolveRaceOutlook',
        'lib/fitness/fitness-model.ts#resolveFitness',
        'lib/training/projection-snapshots.ts#resolveCurrentVdotSnapshot',
      ],
      shouldOwn: 'lib/race/race-outlook.ts#resolveRaceOutlook',
      because: 'Rule 16 was locked on this exact defect: three projected '
        + 'finishes live at once, all labelled projected. The remaining '
        + 'split is a fitness ANCHOR split rather than a projection split, '
        + 'and it is worse for being invisible: Today prints a range off '
        + 'bestRecentVdot while the race screen prints one off the capacity '
        + 'resolver, and the two are different numbers on the same day for '
        + 'the same runner.',
      notRoutedBecause: 'The repo already carries a probe for this exact '
        + 'divergence rather than a fix, which says the migration is known '
        + 'and owned. Moving Today onto the capacity anchor changes the '
        + 'headline number on the runner home screen and is a product call.',
    },
    movesUpOn: [
      {
        what: 'A race result the effort authority admits as representative.',
        reader: 'lib/race/effort-authority.ts#selectionAuthority',
      },
      {
        what: 'Capacity moving underneath it.',
        reader: 'lib/training/capacity-resolver.ts#resolveThresholdCapacity',
      },
    ],
    movesDownOn: [
      {
        what: 'A representative race that lands slower than the model '
          + 'expected.',
        reader: 'lib/race/representativeness.ts#assessRepresentativeness',
      },
    ],
    neverMovesOn: [NEVER_THE_GOAL, NEVER_CALENDAR_TIME, NEVER_READINESS],
  },

  /* ── 14 ────────────────────────────────────────────────────────────── */
  ENVIRONMENTAL_SENSITIVITY: {
    key: 'ENVIRONMENTAL_SENSITIVITY',
    question: 'How much does heat cost THIS runner.',
    constitutionOwner: 'Environmental Context',
    canonical: {
      module: 'lib/coach/heat-acclimatization.ts',
      symbol: 'computeHeatAcclimatization',
      answers: 'How far into acclimatisation he is, from his own exposure, '
        + 'and the heart-rate penalty that stage still carries.',
    },
    rule8Side: 'ABSORBED_LOAD',
    competing: [
      {
        module: 'lib/training/heat-model.ts',
        symbol: 'maughanSlowdownPctForVdot',
        at: 'lib/training/heat-model.ts:145',
        computes: 'The POPULATION slowdown for an ability tier. Not a '
          + 'belief about this runner at all.',
        canDisagree: true,
      },
      {
        module: 'lib/race/representativeness.ts',
        symbol: 'assessRepresentativeness',
        at: 'lib/race/representativeness.ts:682',
        computes: 'How much a specific race result should be discounted for '
          + 'the conditions it was run in.',
        canDisagree: false,
      },
      {
        module: 'lib/training/elevation-model.ts',
        symbol: 'courseElevationCostSec',
        at: 'lib/training/elevation-model.ts:67',
        computes: 'A SECOND declaration of the per-percent grade cost, same '
          + 'value and same citation as the terrain owner, but with no '
          + 'doctrine claim watching it. The same file already imports the '
          + 'descent fraction from that owner, so the import edge exists '
          + 'and was not used for this constant.',
        canDisagree: true,
      },
    ],
    surveyed: 'lib/training, lib/coach, lib/weather, lib/race, lib/terrain '
      + 'for heat, dewpoint, altitude and terrain readers. Three different '
      + 'temperatures decide three different sentences about the same '
      + 'morning, each correctly cited and none reconciled with the others.',
    conflict: {
      verdict: 'OPEN',
      between: [
        'lib/coach/heat-acclimatization.ts#computeHeatAcclimatization',
        'lib/training/heat-model.ts#maughanSlowdownPctForVdot',
      ],
      shouldOwn: 'lib/coach/heat-acclimatization.ts#computeHeatAcclimatization',
      because: 'Only one of the two is about this runner. The heat model is '
        + 'doctrine, correctly cited, and it prices heat for a COHORT. '
        + 'Doctrine 26 names the progression: population assumption, then '
        + 'individual observation, then repeated individual evidence. The '
        + 'app has rung one and rung three of the acclimatisation axis and '
        + 'nothing on the slowdown axis, so a runner who demonstrably '
        + 'suffers more in heat than his tier cannot tell the engine.',
      notRoutedBecause: 'A personal slowdown reader would be a new '
        + 'measurement, and Constitution 10 is emphatic that heat is '
        + 'evidence rather than an engine. Where it belongs is inside the '
        + 'Evidence Engine as a per-activity observation, and that is the '
        + 'Evidence Engine owner call.',
    },
    movesUpOn: [
      {
        what: 'Consecutive days of exposure, which move him along the '
          + 'acclimatisation timeline.',
        reader: 'lib/coach/heat-acclimatization.ts#acclimationStage',
      },
    ],
    movesDownOn: [
      {
        what: 'A break from heat exposure, which walks the timeline back.',
        reader: 'lib/coach/heat-acclimatization.ts#acclimationStage',
      },
    ],
    neverMovesOn: [NEVER_THE_GOAL, NEVER_ONE_ANOMALY],
  },

  /* ── 15 ────────────────────────────────────────────────────────────── */
  INJURY_STATE: {
    key: 'INJURY_STATE',
    question: 'Is something hurt, and what does it stop him doing.',
    constitutionOwner: 'Safety',
    canonical: {
      module: 'lib/safety/safety-verdict.ts',
      symbol: 'classifySafety',
      answers: 'The open injury, the uncleared niggle and what they permit, '
        + 'as a verdict that other systems may not override.',
    },
    rule8Side: 'NEITHER',
    competing: [
      {
        module: 'lib/plan/injury-builder.ts',
        symbol: 'buildInjuryPlan',
        at: 'lib/plan/injury-builder.ts:562',
        computes: 'The return-to-running ladder once an injury is known. '
          + 'Consumes the state, does not decide it.',
        canDisagree: false,
      },
      {
        module: 'lib/topics/types.ts',
        symbol: 'CoachState',
        at: 'lib/topics/types.ts:128',
        computes: 'activeNiggle, a separate flattened read of the same rows '
          + 'with no failure state at all.',
        canDisagree: true,
      },
      {
        module: 'lib/plan/return-checkin-store.ts',
        symbol: 'loadActiveInjuryForReturn',
        at: 'lib/plan/return-checkin-store.ts:33',
        computes: 'A live second read of the injury table for the return '
          + 'protocol, on its own scoping.',
        canDisagree: true,
      },
      {
        module: 'lib/race/representativeness-inputs.ts',
        symbol: 'assessRaceRepresentativeness',
        at: 'lib/race/representativeness-inputs.ts:230',
        computes: 'A third read of the niggle table, ordering by severity '
          + 'cast to TEXT so nine sorts above ten, and collapsing a failed '
          + 'read to no niggle.',
        canDisagree: true,
      },
    ],
    surveyed: 'lib/safety, lib/plan, lib/coach, lib/race, lib/watch for '
      + 'injury and niggle state. The scoping predicate differs WITHIN the '
      + 'owner itself: the injury read filters on the uuid column alone '
      + 'while its sibling illness and niggle reads coalesce, which is a '
      + 'Rule 14 population question inside one function.',
    conflict: {
      verdict: 'OPEN',
      between: [
        'lib/safety/safety-verdict.ts#classifySafety',
        'lib/topics/types.ts#CoachState',
      ],
      shouldOwn: 'lib/safety/safety-verdict.ts#classifySafety',
      because: 'Safety may override other systems and other systems may not '
        + 'override Safety, so there cannot be a second read of the same '
        + 'rows that answers with less. CoachState.activeNiggle carries no '
        + 'failure branch, so a niggle query that errors is indistinguishable '
        + 'from a runner with nothing wrong, on the surface where that '
        + 'matters most.',
      notRoutedBecause: 'CoachState is the briefing loader input consumed by '
        + 'every topic prereq in the deck. Changing its shape touches an '
        + 'owner this session does not have.',
    },
    movesUpOn: [
      {
        what: 'The injury being marked resolved.',
        reader: 'lib/safety/safety-verdict.ts#classifySafety',
      },
    ],
    movesDownOn: [
      {
        what: 'A new injury or a niggle logged at higher severity.',
        reader: 'lib/safety/safety-verdict.ts#classifySafety',
      },
    ],
    neverMovesOn: [
      NEVER_THE_GOAL,
      {
        what: 'RACE_PREDICTION',
        why: 'No fitness goal outranks safety, and a race being close is not '
          + 'evidence that an injury has healed.',
      },
    ],
  },

  /* ── 16 ────────────────────────────────────────────────────────────── */
  ILLNESS_STATE: {
    key: 'ILLNESS_STATE',
    question: 'Is he ill, and how far into it.',
    constitutionOwner: 'Safety',
    canonical: {
      module: 'lib/safety/safety-verdict.ts',
      symbol: 'classifySafety',
      answers: 'The uncleared illness episode, whether it carries fever, and '
        + 'what that permits.',
    },
    rule8Side: 'NEITHER',
    competing: [
      {
        module: 'lib/coach/convergence-loader.ts',
        symbol: 'loadConvergenceContext',
        at: 'lib/coach/convergence-loader.ts:209',
        computes: 'A second read of the same table on a NARROWER population '
          + 'and with the opposite failure direction: it scopes on the uuid '
          + 'column alone where the owner coalesces, and a failed query '
          + 'reads as not ill.',
        canDisagree: true,
      },
      {
        module: 'lib/coach/readiness-brief.ts',
        symbol: 'loadReadinessBrief',
        at: 'lib/coach/readiness-brief.ts:536',
        computes: 'Nothing. It passes a hardcoded false with a note saying '
          + 'the episode table is not wired through yet.',
        canDisagree: true,
      },
      {
        module: 'lib/coach/easy-discipline.ts',
        symbol: 'detectEasyDiscipline',
        at: 'lib/coach/easy-discipline.ts:868',
        computes: 'A third read, of ALL episodes rather than open ones, to '
          + 'test whether a given past run overlapped one. A different '
          + 'window for a different question, listed because it is a third '
          + 'definition of the same phrase.',
        canDisagree: false,
      },
    ],
    surveyed: 'lib/safety, lib/coach, lib/plan, lib/race, lib/evidence for '
      + 'every read of the sick-episode table.',
    conflict: {
      verdict: 'OPEN',
      between: [
        'lib/safety/safety-verdict.ts#classifySafety',
        'lib/coach/convergence-loader.ts#loadConvergenceContext',
        'lib/coach/readiness-brief.ts#loadReadinessBrief',
      ],
      shouldOwn: 'lib/safety/safety-verdict.ts#classifySafety',
      because: 'Safety may override other systems and other systems may not '
        + 'override Safety, so a second answer to "is he ill" is forbidden '
        + 'by construction. Two things make this worse than an ordinary '
        + 'duplicate. First, Rule 14: the two readers name DIFFERENT '
        + 'POPULATIONS, so a row written against the legacy identifier is '
        + 'visible to one and invisible to the other, on the same runner on '
        + 'the same request. Second, they fail in OPPOSITE DIRECTIONS: one '
        + 'database blip makes the safety owner withhold the session and '
        + 'makes the convergence loader report no illness and let every '
        + 'domain vote normally. And the readiness brief does not read at '
        + 'all; it asserts that he is well.',
      notRoutedBecause: 'Both secondary readers live in another owner files '
        + 'and each feeds a surface with its own suite. The hardcoded false '
        + 'in particular is a wiring gap rather than a disagreement, and '
        + 'closing it means giving the brief the safety resolution, which '
        + 'changes what the morning page says.',
    },
    movesUpOn: [
      {
        what: 'The episode being cleared.',
        reader: 'lib/safety/safety-verdict.ts#classifySafety',
      },
    ],
    movesDownOn: [
      {
        what: 'A new episode logged, and fever in particular.',
        reader: 'lib/safety/safety-verdict.ts#classifySafety',
      },
    ],
    neverMovesOn: [
      NEVER_THE_GOAL,
      {
        what: 'RACE_PREDICTION',
        why: 'A race on Sunday is not evidence that a fever has passed.',
      },
    ],
  },

  /* ── 17 ────────────────────────────────────────────────────────────── */
  DATA_QUALITY: {
    key: 'DATA_QUALITY',
    question: 'How far can the underlying measurements be trusted.',
    constitutionOwner: 'Evidence Engine',
    canonical: {
      module: 'lib/evidence/activity-evidence.ts',
      symbol: 'assessEligibility',
      answers: 'Per-signal quality for distance, duration, pace, heart rate, '
        + 'power and dynamics, keeping absent and unusable as separate facts.',
    },
    rule8Side: 'NEITHER',
    competing: [
      {
        module: 'lib/training/pace-corpus.ts',
        symbol: 'classifyThresholdCandidates',
        at: 'lib/training/pace-corpus.ts:1604',
        computes: 'A second per-observation authority scale, grading heart '
          + 'rate from band position only. It does not reach the flat-trace '
          + 'check at all.',
        canDisagree: true,
      },
      {
        module: 'lib/adaptation/canonical/hr-trace-credibility.ts',
        symbol: 'workTraceIsCredible',
        at: 'lib/adaptation/canonical/hr-trace-credibility.ts:93',
        computes: 'Whether a heart-rate trace is a measurement or one value '
          + 'carried forward. A third scale, boolean.',
        canDisagree: true,
      },
      {
        module: 'lib/coach/runner-calibration.ts',
        symbol: 'loadRunnerCalibration',
        at: 'lib/coach/runner-calibration.ts:236',
        computes: 'A fourth scale, three tiers off workout counts. This is '
          + 'account maturity rather than measurement quality.',
        canDisagree: true,
      },
    ],
    surveyed: 'lib/evidence, lib/training, lib/adaptation, lib/race, '
      + 'lib/runs, lib/coach for reliability, credibility and authority '
      + 'scales.',
    conflict: {
      verdict: 'OPEN',
      between: [
        'lib/evidence/activity-evidence.ts#assessEligibility',
        'lib/training/pace-corpus.ts#classifyThresholdCandidates',
        'lib/adaptation/canonical/hr-trace-credibility.ts#workTraceIsCredible',
      ],
      shouldOwn: 'lib/evidence/activity-evidence.ts#assessEligibility',
      because: 'Constitution 14 says data quality modifies confidence and '
        + 'never creates an alternate truth, and Constitution B gives the '
        + 'Evidence Engine admissibility. Four independent scales with no '
        + 'conversion between them is the alternate truth arriving anyway. '
        + 'The concrete cost: a flat-lined heart-rate trace that the '
        + 'credibility module refuses is still admitted as threshold '
        + 'evidence by the capacity resolver, because the corpus grades '
        + 'heart rate on band position and never asks whether the trace was '
        + 'measured.',
      notRoutedBecause: 'Routing the corpus through the credibility check '
        + 'would change which observations anchor threshold pace for every '
        + 'runner. That is a capacity change with a corpus consequence and '
        + 'it needs its own replay, not a registry entry.',
    },
    movesUpOn: [
      {
        what: 'Cleaner traces, more signals present, more corroboration '
          + 'between them.',
        reader: 'lib/evidence/activity-evidence.ts#assessEligibility',
      },
    ],
    movesDownOn: [
      {
        what: 'Signals disagreeing, or a trace that is not a measurement.',
        reader: 'lib/adaptation/canonical/hr-trace-credibility.ts#workTraceIsCredible',
      },
    ],
    neverMovesOn: [
      NEVER_THE_GOAL,
      {
        what: 'ONE_ANOMALY',
        why: 'One bad trace lowers what that observation is worth. It does '
          + 'not lower what every other observation is worth.',
      },
    ],
  },

  /* ── 18 ────────────────────────────────────────────────────────────── */
  GOAL_FEASIBILITY: {
    key: 'GOAL_FEASIBILITY',
    question: 'How does the stated goal compare with the current outlook.',
    constitutionOwner: 'Goal Feasibility',
    canonical: {
      module: 'lib/race/race-outlook.ts',
      symbol: 'composeRaceOutlook',
      answers: 'The goal against the expected result and the likely range, '
        + 'with the gap and the reasons.',
    },
    rule8Side: 'NEITHER',
    competing: [
      {
        module: 'lib/training/goal-assessment.ts',
        symbol: 'assessGoal',
        at: 'lib/training/goal-assessment.ts:243',
        computes: 'A second verdict, on a different and overlapping '
          + 'vocabulary, from a doctrine gain band rather than from the '
          + 'projection range, and off a different fitness number.',
        canDisagree: true,
      },
      {
        module: 'lib/training/goal-ready.ts',
        symbol: 'computeGoalReady',
        at: 'lib/training/goal-ready.ts:114',
        computes: 'When the goal becomes reachable, from a linear fit over '
          + 'stored snapshots rather than the doctrine gain band.',
        canDisagree: true,
      },
      {
        module: 'lib/training/achievable-target.ts',
        symbol: 'achievableRaceTarget',
        at: 'lib/training/achievable-target.ts:199',
        computes: 'Whether the goal sits within five percent of a seasonal '
          + 'ceiling. The same tolerance applied to a different reference.',
        canDisagree: true,
      },
    ],
    surveyed: 'lib/training, lib/race, lib/plan for anything returning a '
      + 'feasibility verdict or a goal gap.',
    conflict: {
      verdict: 'OPEN',
      between: [
        'lib/race/race-outlook.ts#composeRaceOutlook',
        'lib/training/goal-assessment.ts#assessGoal',
      ],
      shouldOwn: 'lib/race/race-outlook.ts#composeRaceOutlook',
      because: 'Constitution L says Goal Feasibility consumes Goal plus Race '
        + 'Prediction, and the outlook is the race prediction. assessGoal '
        + 'reaches a verdict WITHOUT going through it, on a fitness number '
        + 'that comes from a stored snapshot rather than the live anchor, '
        + 'and both verdicts render on the same race surface. A goal can '
        + 'read realistic on one and aggressive on the other, and the two '
        + 'vocabularies do not even share their members.',
      notRoutedBecause: 'assessGoal also carries the runway and volume '
        + 'cautions that the outlook does not, so routing it away would lose '
        + 'runner-facing content. The correct fix is for assessGoal to '
        + 'consume the outlook verdict rather than compute its own, which '
        + 'is a change inside the goal-assessment owner.',
    },
    movesUpOn: [
      {
        what: 'The outlook improving, or runway remaining.',
        reader: 'lib/race/race-outlook.ts#composeRaceOutlook',
      },
    ],
    movesDownOn: [
      {
        what: 'The outlook falling behind what the goal requires, or the '
          + 'runway running out.',
        reader: 'lib/race/race-outlook.ts#composeRaceOutlook',
      },
    ],
    neverMovesOn: [
      {
        what: 'GOAL_STATED',
        why: 'This belief is ABOUT the goal and must never CHANGE it. The '
          + 'coach projects and says what the evidence supports. Only the '
          + 'runner moves the target.',
      },
      NEVER_READINESS,
    ],
  },

  /* ── 19 ────────────────────────────────────────────────────────────── */
  TRAINING_PHASE: {
    key: 'TRAINING_PHASE',
    question: 'Where is he in the block.',
    constitutionOwner: 'Plan Generator',
    canonical: null,
    rule8Side: 'NEITHER',
    competing: [
      {
        module: 'lib/coach/state-loader.ts',
        symbol: 'loadCoachState',
        at: 'lib/coach/state-loader.ts:223',
        computes: 'Finds today phase by scanning plan_phases for the week '
          + 'index, with its own idea of which week is current.',
        canDisagree: true,
      },
      {
        module: 'lib/coach/glance-state.ts',
        symbol: 'loadGlanceState',
        at: 'lib/coach/glance-state.ts:364',
        computes: 'The same predicate, a second query, a different current '
          + 'week resolution.',
        canDisagree: true,
      },
      {
        module: 'lib/workout-catalogue/select.ts',
        symbol: 'PHASE_FROM_ENGINE',
        at: 'lib/workout-catalogue/select.ts:210',
        computes: 'Maps the engine four labels onto the doctrine five, and '
          + 'its own header calls the split a convention.',
        canDisagree: true,
      },
      {
        module: 'lib/plan/catalogue-rx.ts',
        symbol: 'doctrinePhasesForWeek',
        at: 'lib/plan/catalogue-rx.ts:1041',
        computes: 'A SECOND, different split of the same engine label, on '
          + 'weeks remaining rather than on list order.',
        canDisagree: true,
      },
    ],
    surveyed: 'lib/plan, lib/coach, lib/training, lib/workout-catalogue, '
      + 'lib/faff for phase types and phase resolution.',
    conflict: {
      verdict: 'OPEN',
      between: [
        'lib/coach/state-loader.ts#loadCoachState',
        'lib/coach/glance-state.ts#loadGlanceState',
        'lib/workout-catalogue/select.ts#PHASE_FROM_ENGINE',
        'lib/plan/catalogue-rx.ts#doctrinePhasesForWeek',
      ],
      shouldOwn: 'a resolveCurrentPhase in the Plan Generator, which does '
        + 'not yet exist',
      because: 'There is no function anywhere that answers what phase is '
        + 'this runner in today. There is a database column and five '
        + 'independent readers of it in five different vocabularies, two of '
        + 'which resolve the current week differently and can therefore '
        + 'return different labels on the same day. Worse, three of the five '
        + 'vocabularies contain members the generator never writes, so any '
        + 'predicate typed on them can only ever be false.',
      notRoutedBecause: 'Naming one resolver means picking one vocabulary, '
        + 'and the vocabularies are not translations of each other. That is '
        + 'a Plan Generator decision with reach into the workout library.',
    },
    movesUpOn: [],
    movesDownOn: [],
    neverMovesOn: [
      {
        what: 'READINESS',
        why: 'A tired week does not move him back into base. The phase is '
          + 'what the plan authored, and readiness modifies the session '
          + 'inside it.',
      },
      NEVER_THE_GOAL,
    ],
  },

  /* ── 20 ────────────────────────────────────────────────────────────── */
  READINESS: {
    key: 'READINESS',
    question: 'Is the next prescribed stress appropriate today.',
    constitutionOwner: 'Readiness',
    canonical: {
      module: 'lib/training/runner-state.ts',
      symbol: 'resolveRunnerState',
      answers: 'Proceed, caution, reduce or recover, as a coaching decision '
        + 'with the signal that drove it. Never a score.',
    },
    rule8Side: 'ABSORBED_LOAD',
    competing: [
      {
        module: 'lib/plan/adapt.ts',
        symbol: 'runnerIsCompromised',
        at: 'lib/plan/adapt.ts:1537',
        computes: 'The training-gap re-entry signal, which is one of the '
          + 'inputs the state layer consolidates rather than a second '
          + 'answer. But it swallows both of its own detector failures and '
          + 'reads them as not compromised, so the state layer refusal '
          + 'branch cannot fire for the likeliest failure.',
        canDisagree: true,
      },
      {
        module: 'lib/safety/safety-verdict.ts',
        symbol: 'classifySafety',
        at: 'lib/safety/safety-verdict.ts:331',
        computes: 'A verdict that can say STOP, on the same morning, with '
          + 'no arbitration layer between the two. The prescription '
          + 'resolver consumes the state and takes no safety input at all.',
        canDisagree: true,
      },
      {
        module: 'lib/coach/readiness.ts',
        symbol: 'computeReadiness',
        at: 'lib/coach/readiness.ts:501',
        computes: 'A 0 to 100 score with its own five-band vocabulary. Its '
          + 'own header says nothing mutates on it and it is a DISPLAY '
          + 'quantity, so it is not a competing decision. Listed because it '
          + 'is what a runner actually reads under the word readiness.',
        canDisagree: true,
      },
    ],
    surveyed: 'lib/training, lib/coach, lib/plan, lib/adaptation, lib/safety '
      + 'for readiness deciders. The morning-readiness scoring was '
      + 'deliberately removed from this decision in 2026-09-02 when the '
      + 'owner ruled that he decides how ready he is.',
    conflict: {
      verdict: 'OPEN',
      between: [
        'lib/training/runner-state.ts#resolveRunnerState',
        'lib/safety/safety-verdict.ts#classifySafety',
      ],
      shouldOwn: 'both, with Safety above Readiness, through an arbitration '
        + 'step that does not yet exist',
      because: 'Constitution 18 sets the override order with Safety first '
        + 'and the acute readiness constraint second, and Constitution 15 '
        + 'names a safety verdict of STOP beside a plan that says RUN as '
        + 'FORBIDDEN rather than merely wrong. Today nothing joins them: '
        + 'the prescription resolver takes a runner state and has no safety '
        + 'input, so a surface can read proceed from one owner and STOP '
        + 'from the other with nothing between them. Separately, the state '
        + 'layer own refusal contract is stronger than the reader beneath '
        + 'it, because the gap detector swallows its failures before the '
        + 'state layer can see them.',
      notRoutedBecause: 'The arbitration belongs in Constitution 16 final '
        + 'decision validator, which is a whole component and not a '
        + 'registry entry. Both owners are correct in isolation; what is '
        + 'missing is the layer that fails loudly when they disagree.',
    },
    movesUpOn: [
      {
        what: 'Coming out of a comeback window, or acute load settling back '
          + 'toward the base.',
        reader: 'lib/training/runner-state.ts#composeRunnerState',
      },
    ],
    movesDownOn: [
      {
        what: 'A training gap, a post-race window, or acute load running '
          + 'well ahead of the base.',
        reader: 'lib/training/runner-state.ts#composeRunnerState',
      },
    ],
    neverMovesOn: [
      NEVER_THE_GOAL,
      {
        what: 'RACE_PREDICTION',
        why: 'Wanting a session to happen is not evidence that it should. '
          + 'Readiness answers from what he ran and what the plan already '
          + 'said.',
      },
    ],
  },
};

/* ══════════════════════════════════════════════════════════════════════════
 * DERIVED VIEWS  ·  computed here so no surface re-derives them (Rule 17)
 * ═══════════════════════════════════════════════════════════════════════ */

/** Every belief with no canonical owner at all. A finding, not an omission. */
export function beliefsWithNoOwner(): readonly BeliefKey[] {
  return (Object.keys(BELIEF_OWNERSHIP) as BeliefKey[])
    .filter((k) => BELIEF_OWNERSHIP[k].canonical == null);
}

/** Every unresolved Rule 16 conflict, for the report. */
export function openConflicts(): ReadonlyArray<{
  key: BeliefKey;
  conflict: Rule16Conflict;
}> {
  const out: Array<{ key: BeliefKey; conflict: Rule16Conflict }> = [];
  for (const k of Object.keys(BELIEF_OWNERSHIP) as BeliefKey[]) {
    const c = BELIEF_OWNERSHIP[k].conflict;
    if (c != null && c.verdict === 'OPEN') out.push({ key: k, conflict: c });
  }
  return out;
}

/**
 * Beliefs that can be pushed down but not up.
 *
 * Rule 21's measurement in registry form: 309 production adaptations, zero
 * upward. A belief with a way down and no way up is that disposition made
 * structural, and this is the query that finds it. The gate fails on a
 * non-empty result, so the list below is the ratchet.
 */
export function beliefsThatOnlyFall(): readonly BeliefKey[] {
  return (Object.keys(BELIEF_OWNERSHIP) as BeliefKey[]).filter((k) => {
    const o = BELIEF_OWNERSHIP[k];
    return o.movesDownOn.length > 0 && o.movesUpOn.length === 0;
  });
}
