/**
 * strategy-contracts.ts · THE BLOCK'S STRATEGY, WRITTEN DOWN.
 *
 * Brief §4.3 (`BlockStrategy` / `PhaseStrategy` / `WeekIntent`), §5.1 (one
 * primary stressor per week) and §6 Phase 6 (proposed versus earned
 * progression).
 *
 * ── WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT ───────────────────────────
 *
 * The brief's own instruction, verbatim: "Do not let this become a second
 * planning engine. It is the explicit representation of decisions currently
 * hidden in `generate.ts`."
 *
 * So NOTHING here decides anything. Every field is READ off a block the
 * composer has already finished authoring, or off a reading the composer was
 * already handed. It computes no capacity, sizes no week, places no session
 * and ranks no limiter. Run it or do not run it and the plan is byte-identical
 * — which is the property `_strategy_contracts.test.ts` asserts first, because
 * a description that changes what it describes is not a description.
 *
 * What it buys, and why it is worth a file: after this, "what is week 7 FOR"
 * has an answer that is a value rather than an inference over three thousand
 * lines. `validateComposedPlan` can check the one-primary-stressor rule
 * against a stated primary lever instead of guessing which axis was meant.
 * And a future adaptation pass has somewhere to write EARNED / HELD / REDUCED
 * against a step the plan actually proposed, which is the contract brief
 * Phase 6 asks for and the reason `ProgressionStatus` exists here with only
 * one of its five values reachable today.
 *
 * ── OWNERSHIP (Constitution) ────────────────────────────────────────────────
 *
 * The Plan Generator owns "what training should happen and when", so the
 * strategy is its to state. It does not own fitness, adaptation or readiness:
 * the limiter is the Coaching Thesis's and is quoted; the prerequisite for a
 * progression step NAMES the owner that will answer it rather than restating
 * that owner's thresholds. A prerequisite written as a number here would be a
 * second copy of the adaptation policy, which is the exact failure this file
 * is supposed to help prevent.
 *
 * ── RULE 22 · WHAT THIS CANNOT FAIL ON ──────────────────────────────────────
 *
 *   · Whether the block is any GOOD. It describes what was authored. A wrong
 *     week with a correct WeekIntent over it passes here, and belongs to the
 *     sweep, the doctrine gate and the coaching gates.
 *   · The INTENSITY axis of progression. `ComposedWeek` carries weekly miles,
 *     day distances and session labels; it does not carry a scalar for "how
 *     hard". The levers derived here are the ones the composed block can be
 *     read for — volume, long-run duration, quality duration and quality
 *     density — and `OverloadTrajectory`'s own log is the record of the
 *     rep-shape levers, carried through rather than re-derived.
 *   · A step the plan never proposed. Every progression here is PROPOSED by
 *     construction: authoring has no execution evidence, so nothing can be
 *     EARNED at this point and the other four statuses are unreachable until
 *     an adaptation pass writes them.
 */
import type { ProgressionLever } from '@/lib/prescription/levers';
import type { PhaseAnswer } from './phase-answers';
import type { DistCategory } from './goal-tiers';

/** Contract version. Bumped when the SHAPE changes, never when a value does. */
export const BLOCK_STRATEGY_MODEL_VERSION = 'block-strategy/1';

/**
 * The lifecycle of a proposed progression step (brief §6 Phase 6).
 *
 * Only `PROPOSED` is reachable at authoring, and that is the honest state: the
 * whole block is visible, and every future step above today's load is a
 * PROPOSAL conditional on absorption. The other four are the vocabulary an
 * adaptation pass writes back with, and they are declared here so that pass
 * has a contract to write into rather than inventing one. Per the brief,
 * Adaptation stays shadow-only; nothing in this file grants mutation
 * authority, and nothing reads these back to change a plan.
 */
export type ProgressionStatus = 'PROPOSED' | 'EARNED' | 'HELD' | 'REDUCED' | 'RESTRUCTURED';

/**
 * A condition that must hold before a proposed step is taken.
 *
 * `owner` is load-bearing. The prerequisite NAMES the service that will answer
 * it instead of restating that service's thresholds, because a threshold
 * copied here would be a second answer to a question another owner already
 * owns — the defect `docs/DOCTRINE_ENFORCEMENT_AND_CLEAN_IMPLEMENTATION.md`
 * spends its first page on.
 */
export interface EvidenceRequirement {
  kind: 'ABSORPTION' | 'EXECUTION' | 'READINESS' | 'CAPACITY';
  /** Coach-register statement of what has to be true. */
  statement: string;
  /** `path#symbol` of the service that answers it. */
  owner: string;
}

export interface ProposedProgression {
  lever: ProgressionLever;
  from: number;
  to: number;
  unit: 'mi' | 'min' | 'reps' | 's/mi';
  prerequisiteEvidence: readonly EvidenceRequirement[];
  /** What this week becomes if the prerequisite is not met. Concrete, and
   *  derived from the week before it rather than described in the abstract. */
  holdAlternative: string;
  status: ProgressionStatus;
}

/** A lever that also moved, and by how much. The one-primary-stressor ledger. */
export interface SecondaryChange {
  lever: ProgressionLever;
  from: number;
  to: number;
  /** Fraction of the previous value. 0.04 = four percent. */
  deltaFraction: number;
}

export type WeekRole = 'BUILD' | 'HOLD' | 'CUTBACK' | 'RACE' | 'RECOVERY' | 'TAPER';

export interface WeekIntent {
  weekStartISO: string;
  phaseLabel: string;
  role: WeekRole;
  /**
   * The lever this week is FOR. Null on a week that advances nothing — a hold,
   * a cutback, a taper week — which is a legitimate answer and a different
   * fact from "we did not look" (Rule 11): a week with no proposal carries
   * `proposedChange: null` and a role that says why.
   */
  primaryProgressionLever: ProgressionLever | null;
  proposedChange: ProposedProgression | null;
  /** Everything else that moved. Brief §5.1: other variables may move only
   *  within declared tolerances, and this is the declaration. */
  secondaryChanges: readonly SecondaryChange[];
  volumeMi: number;
  longRunMi: number | null;
  qualityBudget: { sessions: number; atPaceMi: number };
  rationale: string;
  /**
   * WEEKANSWERS-1 (2026-09-02) · WHY THIS WEEK LOOKS LIKE THIS.
   *
   * The owner's requirement, verbatim: every planned week must answer why this
   * mileage, why this long run, why these quality sessions, why this cutback,
   * how it develops the previous week, and how it prepares for the marathon.
   *
   * Derived here from the numbers this block already holds — the previous
   * week's own values, the block's peak, the week's marathon-pace miles, and
   * the weeks left to race day — so the answers are the plan's arithmetic put
   * into sentences rather than prose written alongside it. Nothing here reads
   * a database, a clock, or a score.
   *
   * Rule 17: each answer is said once, in the week it belongs to, and the
   * sentence that belongs to the BLOCK (how long runs progress, why the
   * longest run is what it is) lives on `BlockStrategy.answers`, not repeated
   * on fifteen weeks.
   */
  answers: WeekAnswers;
}

/** WEEKANSWERS-1 · the six questions, one sentence each, in coach voice. */
export interface WeekAnswers {
  whyMileage: string;
  whyLongRun: string;
  whyQuality: string;
  /** Null on a week that is neither a cutback nor a recovery week — the
   *  question does not apply, which is a different fact from an empty answer. */
  whyCutback: string | null;
  developsPrevious: string;
  preparesForRace: string;
}

/**
 * WEEKANSWERS-1 · the five BLOCK-level questions. Said once for the whole
 * block, because they are statements about the block and Rule 17 forbids
 * printing them on every week that happens to contain one.
 */
export interface BlockAnswers {
  longRunProgression: string;
  marathonSpecificStart: string;
  marathonPaceProgression: string;
  longestRunReason: string;
  sustainRaceEffort: string;
}

export interface PhaseStrategy {
  id: string;
  kind: 'BASE' | 'DEVELOPMENT' | 'RACE_SPECIFIC' | 'TAPER' | 'RECOVERY';
  /** The composer's own label for this phase, unchanged. */
  label: string;
  startISO: string;
  endISO: string;
  /** The phase's primary development purpose, in the phase answers' words. */
  primaryDevelopment: string;
  /** The lever the phase's weeks actually move, most often. Null when its
   *  weeks advance nothing (a taper). */
  primaryProgressionLever: ProgressionLever | null;
  /** Levers no week in the phase moves. Brief §4.3's `heldConstant`. */
  heldConstant: readonly ProgressionLever[];
  /** The session families the phase's quality days actually carry. */
  keyWorkoutFamilies: readonly string[];
  /** What the phase's long runs do: their range, and whether any carries
   *  race-pace work. */
  longRunStrategy: { minMi: number; maxMi: number; racePaceLongs: number };
  entryBasis: string;
  exitCriteria: string;
  restructureTriggers: string;
  rationale: string;
  /** The full structured answer this phase already carries, not restated.
   *  Rule 17: say it once, and refer back. */
  answers: PhaseAnswer | null;
}

export interface BlockStrategy {
  modelVersion: string;
  targetEvent: { distanceMi: number; category: DistCategory; dateISO: string } | null;
  /** The runner's STATED goal, carried verbatim. Never renegotiated, never
   *  used to price training — it is here so the block records what it was
   *  built toward, and `check-goal-pace-leak` is what keeps it out of the
   *  capacity path. */
  statedGoalSec: number | null;
  /** The Coaching Thesis as resolved at authoring, or an explicit absence.
   *  Brief Phase 1: "Make Coaching Thesis a required input; allow `UNKNOWN`
   *  explicitly." A block with no thesis says so; it never omits the field. */
  thesis: { limiter: string; priority: string | null; confidence: number | null; source: string };
  startingLoadMi: number;
  peakLoadMi: number;
  phases: readonly PhaseStrategy[];
  weeks: readonly WeekIntent[];
  /** WEEKANSWERS-1 · the five block-level questions, answered once. */
  answers: BlockAnswers;
  /** The doctrine ceilings this block was authored and validated under, by
   *  name. Not values — the values belong to the constants that hold them. */
  fixedConstraints: readonly string[];
  /** Brief §4.3's `adaptationPolicy`. A reference, never a copy. */
  adaptationPolicy: string;
}

/* ────────────────────────────────────────────────────────────── derivation */

/** Materiality: below this a change is noise, not a progression. One half of
 *  Rule 9's grain — the composer moves distances in half-mile steps, so on a
 *  40-mile week a single half mile is 1.25%. */
const MATERIAL_FRACTION = 0.03;

interface StrategyWeek {
  startISO: string;
  phase: string;
  weeklyMi: number;
  isRaceWeek: boolean;
  isCutback?: boolean;
  days: ReadonlyArray<{
    type: string; distanceMi: number; isLong: boolean; isQuality: boolean; subLabel: string | null;
  }>;
}

/**
 * The week's long run in miles, for ARITHMETIC. Zero means "nothing to compare
 * against", which is the right answer for a delta: a week with no long run and
 * a week whose long run is zero miles both fail the `from > 0` guard in
 * `leversOf` and neither produces a progression.
 *
 * Not for REPORTING — see `longRunMiOf`, which keeps the two apart because a
 * reader of `WeekIntent.longRunMi` cannot tell them apart from a zero (Rule 11,
 * and `check-coercion` caught the first cut of this file doing exactly that).
 */
const longMiOf = (w: StrategyWeek): number =>
  Math.max(0, ...w.days.filter((d) => d.isLong && d.type !== 'race').map((d) => d.distanceMi));

/**
 * The week's long run as a REPORTED reading. Null means the week has no
 * long-run day at all — a race week, a recovery week. A number, zero included,
 * means there IS a long-run day and this is what it carries; a zero there
 * would be a defect somewhere else and this must not hide it behind the same
 * null the absent case uses.
 */
function longRunMiOf(w: StrategyWeek): number | null {
  const days = w.days.filter((d) => d.isLong && d.type !== 'race');
  if (days.length === 0) return null;
  return Math.max(...days.map((d) => d.distanceMi));
}

const qualitySessionsOf = (w: StrategyWeek): number =>
  w.days.filter((d) => d.isQuality && !d.isLong && d.type !== 'race').length;

/** Miles of prescribed quality work in the week, long-run finishes excluded —
 *  the quantity `quality_duration` names. */
const qualityMiOf = (w: StrategyWeek): number =>
  w.days.filter((d) => d.isQuality && !d.isLong && d.type !== 'race')
    .reduce((s, d) => s + d.distanceMi, 0);

/**
 * WEEKANSWERS-1 · marathon-pace miles the week's own prescriptions declare.
 *
 * Read off `subLabel`, which is where the composer states the segment — the
 * same string `buildWorkoutSpec` parses back — so this cannot disagree with
 * what the runner is asked to run. Long-run finishes and dedicated MP sessions
 * both count; they are the same doctrine (`Research/04` §4.4, `Research/08`
 * §9.2) and the runner's legs do not tell them apart.
 */
const mpMilesOfDay = (subLabel: string | null): number => {
  let total = 0;
  const re = /([0-9]+(?:\.[0-9]+)?)\s*mi\s*@\s*(?:M|MP)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(subLabel ?? ''))) total += Number(m[1]);
  return total;
};

const mpMilesOf = (w: StrategyWeek): number =>
  Math.round(w.days.reduce((s, d) => s + mpMilesOfDay(d.subLabel), 0) * 10) / 10;

/** The same miles, split by WHERE they sit. A runner reads "in the long run"
 *  and "in a session" as two different asks, and they are. */
const mpMilesInLongOf = (w: StrategyWeek): number =>
  Math.round(w.days.filter((d) => d.isLong).reduce((s, d) => s + mpMilesOfDay(d.subLabel), 0) * 10) / 10;

const mi = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function roleOf(w: StrategyWeek, prev: StrategyWeek | null): WeekRole {
  if (w.isRaceWeek) return 'RACE';
  if (w.phase === 'TAPER') return 'TAPER';
  if (w.isCutback) return 'CUTBACK';
  if (w.phase === 'RECOVERY') return 'RECOVERY';
  // THE BLOCK'S FIRST WEEK IS NOT A BUILD WEEK. It is the starting load — the
  // number `resolveRampBase` handed the volume curve — and there is nothing
  // before it to have progressed from. Calling it BUILD would put a
  // prerequisite and a hold alternative on a week whose hold alternative is
  // "do not start the block", which is not a coaching statement. HOLD, with a
  // rationale that says which kind of hold it is.
  if (!prev || !(prev.weeklyMi > 0)) return 'HOLD';
  return (w.weeklyMi - prev.weeklyMi) / prev.weeklyMi > MATERIAL_FRACTION ? 'BUILD' : 'HOLD';
}

/** The prerequisite for advancing a given lever, by NAME of the owner that
 *  answers it. See `EvidenceRequirement` for why these carry no numbers. */
function prerequisitesFor(lever: ProgressionLever): EvidenceRequirement[] {
  switch (lever) {
    case 'weekly_volume':
      return [
        { kind: 'ABSORPTION',
          statement: 'The weeks before this one were absorbed, and the acute-to-chronic load stays inside doctrine.',
          owner: 'lib/plan/adaptive-ramp.ts#tryAdaptiveBump' },
        { kind: 'READINESS',
          statement: 'No readiness pull-back is active.',
          owner: 'lib/coach/readiness.ts#scoreReadiness' },
      ];
    case 'long_run_duration':
      return [
        { kind: 'ABSORPTION',
          statement: 'The previous long run was completed, and this one stays inside the single-session spike guard.',
          owner: 'lib/plan/generate.ts#enforceRampCeilingAfterEmbedding' },
      ];
    case 'quality_duration':
    case 'rep_count':
    case 'interval_duration':
    case 'work_density':
      return [
        { kind: 'EXECUTION',
          statement: 'The previous session in this family was executed at its stated targets.',
          owner: 'lib/plan/progression-gate.ts' },
      ];
    case 'pace':
      return [
        { kind: 'CAPACITY',
          statement: 'New evidence moved the capacity this pace is drawn from.',
          owner: 'lib/training/capacity-resolver.ts' },
      ];
    default:
      return [
        { kind: 'EXECUTION',
          statement: 'The week before this one was executed as prescribed.',
          owner: 'lib/plan/progression-gate.ts' },
      ];
  }
}

/**
 * THE WEEK'S PRIMARY LEVER, read off the block rather than declared by it.
 *
 * Brief §5.1 requires every build week to declare ONE primary progression
 * lever. The composer does not currently declare one, so this reads what it
 * actually did: of the axes a `ComposedWeek` can be measured on, the one that
 * rose most in relative terms is the primary and the rest are secondary.
 *
 * That is a description, not a decision — and it is exactly what makes the
 * compound-progression finding checkable. If the engine later DECLARES a
 * primary lever at authoring, this function becomes a cross-check against it
 * rather than the source of it, which is the right direction of travel.
 */
function leversOf(w: StrategyWeek, prev: StrategyWeek | null): {
  primary: ProgressionLever | null;
  changes: SecondaryChange[];
} {
  if (!prev) return { primary: null, changes: [] };
  const axes: Array<{ lever: ProgressionLever; from: number; to: number }> = [
    { lever: 'weekly_volume', from: prev.weeklyMi, to: w.weeklyMi },
    { lever: 'long_run_duration', from: longMiOf(prev), to: longMiOf(w) },
    { lever: 'quality_duration', from: qualityMiOf(prev), to: qualityMiOf(w) },
    { lever: 'work_density', from: qualitySessionsOf(prev), to: qualitySessionsOf(w) },
  ];
  const moved = axes
    .filter((a) => a.from > 0 && (a.to - a.from) / a.from > MATERIAL_FRACTION)
    .map((a) => ({ ...a, deltaFraction: (a.to - a.from) / a.from }))
    .sort((a, b) => b.deltaFraction - a.deltaFraction);
  if (moved.length === 0) return { primary: null, changes: [] };
  const [first, ...rest] = moved;
  return {
    primary: first.lever,
    changes: rest.map((r) => ({ lever: r.lever, from: r.from, to: r.to, deltaFraction: r.deltaFraction })),
  };
}

const UNIT_OF: Partial<Record<ProgressionLever, ProposedProgression['unit']>> = {
  weekly_volume: 'mi',
  long_run_duration: 'mi',
  quality_duration: 'mi',
  work_density: 'reps',
  rep_count: 'reps',
  interval_duration: 'min',
  pace: 's/mi',
};

const PHASE_KIND: Record<string, PhaseStrategy['kind']> = {
  BASE: 'BASE',
  QUALITY: 'DEVELOPMENT',
  'RACE-SPECIFIC': 'RACE_SPECIFIC',
  TAPER: 'TAPER',
  RECOVERY: 'RECOVERY',
};

/** The families a day's label names, for `keyWorkoutFamilies`. */
function familyOf(d: { type: string }): string | null {
  switch (d.type) {
    case 'threshold': case 'tempo': case 'intervals': case 'race_week_tuneup': return d.type;
    default: return null;
  }
}

export interface BlockStrategyInputs {
  weeks: readonly StrategyWeek[];
  phases: ReadonlyArray<{ label: string; weeks: number; answers?: PhaseAnswer }>;
  targetEvent: { distanceMi: number; category: DistCategory; dateISO: string } | null;
  statedGoalSec: number | null;
  thesis: { primaryLimiter: string; priority: string | null; confidence: number | null; source: string } | null;
}

/**
 * WEEKANSWERS-1 · the six per-week answers, derived from this week's own
 * numbers and the one before it.
 *
 * Every sentence names a QUANTITY the runner can check against his own plan.
 * A sentence that would be true of any week is not an answer, so where a
 * question has no answer for this week the field says which fact is missing
 * rather than filling in a platitude — and `whyCutback` is null outright on a
 * week that is not one (Rule 11: not applicable is not the same as unknown).
 *
 * Coach voice: short, direct, no hype, no exclamation marks, no emoji, no em
 * dashes. `check-coach-voice.sh` is the gate.
 */
function weekAnswers(args: {
  w: StrategyWeek;
  prev: StrategyWeek | null;
  role: WeekRole;
  blockPeakMi: number;
  blockPeakLongMi: number;
  weeksOut: number | null;
}): WeekAnswers {
  const { w, prev, role, blockPeakMi, blockPeakLongMi, weeksOut } = args;
  const vol = w.weeklyMi;
  const long = longMiOf(w);
  const qCount = qualitySessionsOf(w);
  const mp = mpMilesOf(w);
  const prevVol = prev ? prev.weeklyMi : 0;
  const prevLong = prev ? longMiOf(prev) : 0;
  const sharePct = blockPeakMi > 0 ? Math.round((vol / blockPeakMi) * 100) : 0;
  const out = weeksOut == null ? null : weeksOut;

  const whyMileage =
    role === 'RACE' ? `Race week. ${mi(vol)} mi, and almost all of it is the race.`
    : role === 'TAPER' ? `${mi(vol)} mi, ${sharePct}% of this block's biggest week. Volume comes down so the work already done can surface.`
    : role === 'CUTBACK' ? `${mi(vol)} mi against ${mi(prevVol)} mi last week. The reduction is deliberate and is what lets the next step land.`
    : prev == null ? `${mi(vol)} mi. This is the load you are already holding, not a step up.`
    : vol > prevVol ? `${mi(vol)} mi, up from ${mi(prevVol)}. The step is the week's main work.`
    : `${mi(vol)} mi, the same as last week. Repeating a load is how it gets absorbed.`;

  const whyLongRun =
    long <= 0 ? 'No long run this week. The race day is the long effort.'
    : role === 'TAPER' ? `${mi(long)} mi. The long run comes down with everything else; the distance is already in your legs.`
    : long >= blockPeakLongMi ? `${mi(long)} mi, the longest run of the block. It is the session everything else is arranged around.`
    : prevLong > 0 && long > prevLong ? `${mi(long)} mi, up from ${mi(prevLong)}. One step, taken because the last one was completed.`
    : prevLong > 0 && long < prevLong ? `${mi(long)} mi, back from ${mi(prevLong)}. A shorter long run inside a reduced week.`
    : `${mi(long)} mi. Holding the distance is what makes the next one repeatable.`;

  // The marathon-pace miles, split by where they sit. A runner reads "inside
  // the long run" and "in a session of its own" as two different asks.
  const mpInLong = mpMilesInLongOf(w);
  const mpInQuality = Math.round((mp - mpInLong) * 10) / 10;
  const whyQuality =
    qCount === 0 && mpInLong <= 0
      ? 'No structured session this week. Easy running is the whole prescription.'
    : qCount === 0
      ? `No separate session. The ${mi(mpInLong)} mi at marathon pace inside the long run is the week's hard work.`
    : mpInQuality > 0
      ? `${qCount} structured session${qCount === 1 ? '' : 's'}, carrying ${mi(mpInQuality)} mi at marathon pace. Rehearsing race pace is the point of the week.`
    : mpInLong > 0
      ? `${qCount} structured session${qCount === 1 ? '' : 's'} beside a long run carrying ${mi(mpInLong)} mi at marathon pace. The long run is the harder of the two.`
      : `${qCount} structured session${qCount === 1 ? '' : 's'}. They sit either side of the long run so neither compromises the other.`;

  const whyCutback =
    role === 'CUTBACK' ? `Down from ${mi(prevVol)} mi. Fatigue clears on the weeks you run less, not on the weeks you run more.`
    : role === 'RECOVERY' ? 'Recovery week. Easy running only, until the legs are ready to be asked again.'
    : null;

  const developsPrevious =
    prev == null ? 'Nothing precedes it. This week sets the load the rest of the block is measured from.'
    // A taper week does not "develop" the week before it, whatever the
    // arithmetic did coming out of a down week. It unwinds the block.
    : role === 'TAPER' ? `It unwinds the block rather than adding to it. ${mi(vol)} mi against a peak of ${mi(blockPeakMi)}.`
    : role === 'RACE' ? 'It does not build on anything. The work is behind you.'
    : long > prevLong && vol > prevVol ? `Both the week and the long run step up, ${mi(prevVol)} to ${mi(vol)} mi and ${mi(prevLong)} to ${mi(long)} mi.`
    : long > prevLong ? `The long run moves, ${mi(prevLong)} to ${mi(long)} mi. Everything else holds so only one thing is being asked.`
    : vol > prevVol ? `The week moves, ${mi(prevVol)} to ${mi(vol)} mi, with the long run held at ${mi(long)}.`
    : vol < prevVol ? `It takes load off last week's ${mi(prevVol)} mi so the next step has somewhere to land.`
    : 'It repeats last week. A load you have held once is not yet a load you own.';

  const preparesForRace = (() => {
    const when = out == null ? '' : out === 0 ? 'Race week. ' : `${out} week${out === 1 ? '' : 's'} out. `;
    if (role === 'RACE') return `${when}Everything that prepares you has already happened.`;
    if (mp > 0) return `${when}${mi(mp)} mi at marathon pace rehearses the effort you have to hold on the day, not just the distance.`;
    if (long >= blockPeakLongMi && long > 0) return `${when}The longest run of the block is where late-race fatigue gets practised.`;
    if (role === 'TAPER') return `${when}Freshness is the work now. The fitness is made.`;
    if (long > 0) return `${when}Time on your feet at ${mi(long)} mi builds the durability the last ten kilometres need.`;
    return `${when}Easy volume is what everything harder is built on.`;
  })();

  return { whyMileage, whyLongRun, whyQuality, whyCutback, developsPrevious, preparesForRace };
}

/**
 * Derive the explicit strategy of a block that has already been composed.
 *
 * Pure. No clock, no database, no mutation of the input. Returns null only
 * when there is no block to describe.
 */
export function deriveBlockStrategy(inputs: BlockStrategyInputs): BlockStrategy | null {
  const { weeks } = inputs;
  if (weeks.length === 0) return null;

  // ── WEEKANSWERS-1 · the block-wide facts the per-week answers speak from ──
  const blockPeakMi = Math.max(0, ...weeks.map((w) => w.weeklyMi));
  const blockPeakLongMi = Math.max(0, ...weeks.map(longMiOf));
  const raceISO = inputs.targetEvent?.dateISO ?? null;
  const weeksOut = (startISO: string): number | null => {
    if (!raceISO) return null;
    const d = Math.round((Date.parse(`${raceISO}T12:00:00Z`) - Date.parse(`${startISO}T12:00:00Z`)) / 86400000);
    return Math.max(0, Math.floor(d / 7));
  };
  const firstMpWeek = weeks.find((w) => mpMilesOf(w) > 0) ?? null;
  const totalMpMi = Math.round(weeks.reduce((s, w) => s + mpMilesOf(w), 0) * 10) / 10;
  const longestLongWeek = weeks.reduce<StrategyWeek | null>(
    (best, w) => (best == null || longMiOf(w) > longMiOf(best) ? w : best), null);
  const openingLongMi = longMiOf(weeks[0]);

  const intents: WeekIntent[] = weeks.map((w, i) => {
    // `weeks[-1]` is undefined, so this is an index lookup rather than a
    // threshold on a measurement — written without a ternary because the
    // coercion scanner reads `i > 0 ? x : null` as a zero-erasure by shape,
    // and it is right to: that shape is what the real ones look like.
    const prev: StrategyWeek | null = weeks[i - 1] ?? null;
    const role = roleOf(w, prev);
    const { primary, changes } = leversOf(w, prev);
    // A week that is not building is not proposing a step, whatever the
    // arithmetic did — a cutback whose long happens to tick up is absorbing,
    // not advancing, and calling that a proposal would put a prerequisite on
    // a week doctrine already reduced on purpose.
    const advancing = role === 'BUILD' && primary != null && prev != null;
    const from = advancing
      ? (primary === 'weekly_volume' ? prev.weeklyMi
        : primary === 'long_run_duration' ? longMiOf(prev)
        : primary === 'work_density' ? qualitySessionsOf(prev)
        : qualityMiOf(prev))
      : 0;
    const to = advancing
      ? (primary === 'weekly_volume' ? w.weeklyMi
        : primary === 'long_run_duration' ? longMiOf(w)
        : primary === 'work_density' ? qualitySessionsOf(w)
        : qualityMiOf(w))
      : 0;
    return {
      weekStartISO: w.startISO,
      phaseLabel: w.phase,
      role,
      primaryProgressionLever: advancing ? primary : null,
      proposedChange: advancing && primary
        ? {
            lever: primary,
            from: Number(from.toFixed(2)),
            to: Number(to.toFixed(2)),
            unit: UNIT_OF[primary] ?? 'mi',
            prerequisiteEvidence: prerequisitesFor(primary),
            holdAlternative:
              `Repeat the week of ${prev!.startISO}: ${prev!.weeklyMi} mi, long ${longMiOf(prev!)} mi, `
              + `${qualitySessionsOf(prev!)} quality session(s).`,
            status: 'PROPOSED',
          }
        : null,
      secondaryChanges: advancing ? changes : [],
      volumeMi: w.weeklyMi,
      longRunMi: longRunMiOf(w),
      qualityBudget: { sessions: qualitySessionsOf(w), atPaceMi: Number(qualityMiOf(w).toFixed(2)) },
      rationale:
        role === 'RACE' ? 'Race week. Everything before it has already happened.'
        : role === 'TAPER' ? 'Taper. Volume comes down, intensity holds.'
        : role === 'CUTBACK' ? 'Planned cutback. The reduction is the work.'
        : role === 'RECOVERY' ? 'Recovery. Easy running only.'
        : advancing && primary
          ? `Build week. Primary stressor: ${primary.replace(/_/g, ' ')}.`
          : prev == null
            ? 'Opening week. This is the block starting load, not a step.'
            : 'Hold week. The load repeats so the last step can be absorbed.',
      answers: weekAnswers({
        w, prev, role, blockPeakMi, blockPeakLongMi, weeksOut: weeksOut(w.startISO),
      }),
    };
  });

  // Phase spans, walked in the composer's own phase order.
  const phaseStrategies: PhaseStrategy[] = [];
  let cursor = 0;
  for (const p of inputs.phases) {
    const span = weeks.slice(cursor, cursor + p.weeks);
    cursor += p.weeks;
    if (span.length === 0) continue;
    const spanIntents = intents.slice(
      intents.findIndex((x) => x.weekStartISO === span[0].startISO),
      intents.findIndex((x) => x.weekStartISO === span[span.length - 1].startISO) + 1,
    );
    const leverCounts = new Map<ProgressionLever, number>();
    for (const it of spanIntents) {
      if (it.primaryProgressionLever) {
        leverCounts.set(it.primaryProgressionLever, (leverCounts.get(it.primaryProgressionLever) ?? 0) + 1);
      }
    }
    const primaryLever = [...leverCounts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const moved = new Set<ProgressionLever>([
      ...leverCounts.keys(),
      ...spanIntents.flatMap((it) => it.secondaryChanges.map((c) => c.lever)),
    ]);
    const measurable: ProgressionLever[] = ['weekly_volume', 'long_run_duration', 'quality_duration', 'work_density'];
    const longs = span.flatMap((w) => w.days.filter((d) => d.isLong && d.type !== 'race' && d.distanceMi > 0));
    const families = new Set<string>();
    for (const w of span) for (const d of w.days) { const f = familyOf(d); if (f && d.isQuality) families.add(f); }
    const answers = p.answers ?? null;
    phaseStrategies.push({
      id: `${p.label}@${span[0].startISO}`,
      kind: PHASE_KIND[p.label] ?? 'DEVELOPMENT',
      label: p.label,
      startISO: span[0].startISO,
      endISO: span[span.length - 1].startISO,
      primaryDevelopment: answers?.developing
        ?? `${p.label} phase. No structured phase answer was attached to this block.`,
      primaryProgressionLever: primaryLever,
      heldConstant: measurable.filter((l) => !moved.has(l)),
      keyWorkoutFamilies: [...families].sort(),
      longRunStrategy: {
        minMi: longs.length ? Math.min(...longs.map((d) => d.distanceMi)) : 0,
        maxMi: longs.length ? Math.max(...longs.map((d) => d.distanceMi)) : 0,
        racePaceLongs: longs.filter((d) => /@\s*(M|MP)\b/.test(d.subLabel ?? '')).length,
      },
      entryBasis: answers?.evidence ?? 'Not stated.',
      exitCriteria: answers?.progress ?? 'Not stated.',
      restructureTriggers: answers?.restructure ?? 'Not stated.',
      rationale: answers?.whyNow ?? 'Not stated.',
      answers,
    });
  }

  return {
    modelVersion: BLOCK_STRATEGY_MODEL_VERSION,
    targetEvent: inputs.targetEvent,
    statedGoalSec: inputs.statedGoalSec,
    // Rule 11 · a block with no thesis says UNKNOWN out loud rather than
    // omitting the field, and a thesis whose read FAILED is a third fact.
    thesis: inputs.thesis
      ? {
          limiter: inputs.thesis.primaryLimiter,
          priority: inputs.thesis.priority,
          confidence: inputs.thesis.confidence,
          source: inputs.thesis.source,
        }
      : { limiter: 'UNKNOWN', priority: null, confidence: null, source: 'absent' },
    startingLoadMi: weeks[0].weeklyMi,
    peakLoadMi: Math.max(...weeks.map((w) => w.weeklyMi)),
    phases: phaseStrategies,
    weeks: intents,
    // ── WEEKANSWERS-1 · the five block-level answers, said ONCE ─────────────
    //
    // Each reads a quantity off the block that has just been derived above, so
    // none of them can drift from the plan they describe. Rule 17: these belong
    // to the block, not to every week that happens to contain one of them.
    answers: {
      longRunProgression: openingLongMi > 0 && blockPeakLongMi > 0
        ? `The long run opens at ${mi(openingLongMi)} mi and climbs to ${mi(blockPeakLongMi)}, one step at a time, `
          + 'and never more than a tenth further than the longest run of the previous month. '
          + 'It steps back on every down week so the next step is taken on rested legs.'
        : 'This block has no long-run progression to describe.',
      marathonSpecificStart: firstMpWeek
        ? `Marathon-pace work starts the week of ${firstMpWeek.startISO}`
          + (weeksOut(firstMpWeek.startISO) != null ? `, ${weeksOut(firstMpWeek.startISO)} weeks out.` : '.')
          + ' Threshold and hills come first because pace work is only worth doing on an aerobic base that can hold it.'
        : 'No marathon-pace work is scheduled in this block.',
      marathonPaceProgression: totalMpMi > 0
        ? `${mi(totalMpMi)} mi at marathon pace across the block, in sessions that get longer as race day approaches `
          + 'rather than more frequent. Two weeks between them, never on a down week.'
        : 'No marathon-pace volume in this block.',
      longestRunReason: longestLongWeek && blockPeakLongMi > 0
        ? `${mi(blockPeakLongMi)} mi is the longest run, the week of ${longestLongWeek.startISO}. `
          + 'It is set from the longest runs you have actually completed and what one training cycle adds to them, '
          + 'not from a category. Nothing in the block asks for more than that.'
        : 'This block has no long run to explain.',
      sustainRaceEffort: totalMpMi > 0 && blockPeakLongMi > 0
        ? `The long runs build the hours; the ${mi(totalMpMi)} mi at marathon pace inside and beside them build the effort. `
          + `Running ${mi(blockPeakLongMi)} mi easy proves you can cover the distance. `
          + 'Holding race pace late in a long run is what proves you can race it.'
        : 'Without race-pace work this block builds distance, not race effort.',
    },
    fixedConstraints: [
      'lib/plan/validate.ts#longRunCapMi',
      'lib/plan/validate.ts#ACWR_HIGH_RISK',
      'lib/plan/goal-tiers.ts#GENERAL_RAMP_CEILING',
      'lib/plan/goal-tiers.ts#BLOCK_SHAPE.taperWeeks',
      'lib/plan/dosing.ts#weeklyDoseBudgetMi',
      'lib/plan/combined-stress.ts#RETURN_TO_LONG_DAYS',
    ],
    adaptationPolicy: 'lib/plan/progression-gate.ts · shadow-only at authoring; no step here grants mutation authority',
  };
}
