/**
 * lib/faff/surface-sweep-matrix.ts — the runner states, data shapes and
 * boundaries the app will actually meet, and the rules every surface must
 * hold across all of them.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * On 2026-08-24 the owner found four visible defects on one screen in twenty
 * minutes that a six-agent audit had missed. Every one of them only broke
 * UNDER A CONDITION: a pace that wrapped only past sixty minutes, a staleness
 * that showed only after backgrounding, a headline that truncated only on a
 * quality day, a label that was engine shorthand only on a recovery-block
 * rebuild.
 *
 * A condition is exactly what a fixture lacks. That is why they survived every
 * unit test: each of those tests asserted one hand-built case, and the case a
 * human hand builds is the case a human already thought of.
 *
 * `lib/plan/_sweep_allusers.test.ts` solved the same problem one layer down —
 * it grades 7680 plan archetypes against the research answer key, and it finds
 * things nobody thought of because it does not depend on anyone thinking of
 * them. It proves plans are well-FORMED. Nothing did the same for the SURFACES
 * a runner reads, or for the shapes real data arrives in.
 *
 * This module is the state half. `_surface_sweep.test.ts` is the gate.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE THREE-OUTCOME RULE
 *
 * For every cell, a surface must do exactly one of three things:
 *
 *   1. RENDER THE TRUTH.
 *   2. REFUSE — Rule 3. A refusal is a correct answer, not an empty state, and
 *      it must not look like the data-outage screen. An orphan section header
 *      over blank space is a refusal wearing an outage's clothes.
 *   3. DEGRADE HONESTLY — show less, never invent. A default is a confident
 *      assertion: `?? 0` turning "we do not know" into "it is zero" is the bug
 *      class that hid four dead features for months.
 *
 * NEVER a fourth thing: a plausible wrong answer. That is the one this whole
 * exercise exists to catch.
 *
 * Every rule below is a mechanical test for the fourth thing. Each carries a
 * positive control in the gate — a planted defect it must detect — because a
 * rule that cannot fail is a rule that is not running, and a sweep that runs
 * zero cells and reports clean is the same bug one level up.
 *
 * Pure · no IO · no clock read. Every date is an explicit ISO string.
 */

// ─────────────────────────────────────────────────────────────────────────
// The matrix
// ─────────────────────────────────────────────────────────────────────────

/**
 * The training states a runner passes through, plus the ones the app is not
 * allowed to author for. Each maps onto a different composition of Today, a
 * different block reading, and a different thing the coach may honestly say.
 */
export const RUNNER_STATES = [
  'off_season',        // no block written, running optional
  'base',              // volume phase, nothing sharp
  'build',             // quality phase
  'peak',              // the biggest weeks
  'taper',             // volume dropping, race approaching
  'race_week',         // inside seven days
  'race_day',          // today is the race
  'hours_after_race',  // logged today, the race is behind them
  'post_race_recovery',// the recovery block the engine authors after a race
  'injury_flare',      // a diagnosed injury, load restricted
  'return_ladder',     // the walk-run return protocol
  'illness',           // systemic, sick_episodes
  'week_off',          // a deliberate zero week
  'no_goal',           // no race at all — the app refuses this phone screen
  'first_week_signup', // no history, plan just written
  'plan_elapsed',      // the block ran out and nothing replaced it
  'coached',           // an outside coach owns the plan; the app may not rewrite
] as const;
export type RunnerState = (typeof RUNNER_STATES)[number];

/**
 * The data shapes that are real and awkward. Every one of these either exists
 * in production today or is one merge away from existing. The counts in the
 * comments are from a read-only survey of the production database on
 * 2026-08-24 (256 canonical runs, 20 races).
 */
export const DATA_SHAPES = [
  'nominal',            // everything present and agreeing
  'no_gps',             // 87 prod runs carry no summaryPolyline
  'treadmill',          // 6 prod runs indoor — belt settings, not sensors
  'no_hr',              // 33 prod runs have no avgHr
  'reps_nine',          // a rep session with nine phases
  'reps_none',          // a rep session whose phases never arrived
  'splits_unreliable',  // 101 prod runs carry a splits-unreliable flag
  'merge_disagree',     // a merged row whose two ingests disagree
  'race_no_goal',       // every prod race: goalSeconds is NULL
  'race_null_distance', // 3 prod races: my-marathon, santa-monica-10k, qa-tune-up-10k
  'two_rows_one_date',  // 44 prod plan days carry more than one row
  'zero_runs',          // a fresh account
  'one_run',            // one data point — no trend may be claimed
  'hundred_mile_week',  // the top of the range
  'walk_run_08',        // 2 prod runs under a mile — the return ladder's dose
  'bad_merge_337',      // the 3:37/mi a Strava moving time invented
  'no_clock',           // 71 prod runs carry distance and NO time and NO pace
  'shoe_unknown_mi',    // a shoe row whose mileage is unreadable
  'shoe_zero_mi',       // 2 prod shoes sit at exactly 0 mi, the NOT NULL DEFAULT
  // The two shapes `subLabelFromSpec` (lib/training/expand-spec.ts) writes into
  // `plan_workouts.sub_label` that are NOT runner-facing names. Both land in
  // the 56pt Archivo headline, which is lineLimit(1) with a 0.5 minimum scale.
  // This is the owner's own "a headline that truncated only on a quality day",
  // kept as a permanent cell rather than a memory.
  'sublabel_prescription', // "3x1mi @ T pace, 60s jog" as the day's headline
  'sublabel_zone_letter',  // "T" — a pace-zone letter says nothing at 56pt
] as const;
export type DataShape = (typeof DATA_SHAPES)[number];

/**
 * Boundaries. The ramp arithmetic is noon-UTC anchored precisely so a DST
 * transition cannot move a day; this proves it rather than trusting it.
 *
 * US DST 2026: forward 2026-03-08, back 2026-11-01. Both are swept in both
 * directions — the day before, the day of, and the day after.
 */
export const BOUNDARIES = [
  'midweek',
  'week_first_day',      // the training week opens
  'week_last_day',       // long-run day, the week closes
  'month_edge',          // 2026-08-31 → 2026-09-01
  'year_edge',           // 2026-12-31 → 2027-01-01
  'dst_spring_forward',  // 2026-03-08, the 23-hour day
  'dst_fall_back',       // 2026-11-01, the 25-hour day
  'stepped_past',        // a day in a past week, stepped to
  'stepped_future',      // a day in a future week, stepped to
  'stepped_outside_plan',// a day the plan never covered
  'block_last_day',      // the day a block ends
  'next_block_first_day',// the day the next authors itself
] as const;
export type Boundary = (typeof BOUNDARIES)[number];

export interface Cell {
  state: RunnerState;
  shape: DataShape;
  boundary: Boundary;
}

export const cellId = (c: Cell) => `${c.state}/${c.shape}/${c.boundary}`;

export function* sweepMatrix(): Generator<Cell> {
  for (const state of RUNNER_STATES)
    for (const shape of DATA_SHAPES)
      for (const boundary of BOUNDARIES) yield { state, shape, boundary };
}

/**
 * The size the matrix must not silently shrink below.
 *
 * An ABSOLUTE number, not `RUNNER_STATES.length * DATA_SHAPES.length * …`.
 * That product is what the matrix currently yields, so asserting the sweep
 * reached it would only prove the sweep can multiply: delete half of every
 * axis and a derived floor shrinks with them, the gate stays green, and the
 * sweep quietly stops covering what its own header claims. That is the exact
 * failure this file exists to prevent, one level up, and it has happened in
 * this repo twice.
 *
 * So the floor is written down. Raise it when an axis grows; never lower it to
 * make a build pass. `scripts/check-surface-sweep.sh` holds per-axis minimums
 * as well, so a container with no toolchain catches the same thing.
 */
export const CELL_FLOOR = 3600;

// ─────────────────────────────────────────────────────────────────────────
// Dates — every one explicit, none read from a clock
// ─────────────────────────────────────────────────────────────────────────

/** The day the sweep calls "today" for each boundary, and the plan window
 *  around it. `long_run_day` is Sunday, so the training week ends Sunday
 *  (see CLAUDE.md · week boundary = long-run day). */
export const BOUNDARY_DATES: Record<Boundary, {
  todayISO: string;
  planFirstISO: string;
  planLastISO: string;
  /** True when today is a day the runner STEPPED to, not the day it is. */
  stepped: boolean;
}> = {
  midweek:               { todayISO: '2026-08-19', planFirstISO: '2026-08-17', planLastISO: '2026-11-29', stepped: false },
  week_first_day:        { todayISO: '2026-08-17', planFirstISO: '2026-08-17', planLastISO: '2026-11-29', stepped: false },
  week_last_day:         { todayISO: '2026-08-23', planFirstISO: '2026-08-17', planLastISO: '2026-11-29', stepped: false },
  month_edge:            { todayISO: '2026-08-31', planFirstISO: '2026-08-17', planLastISO: '2026-11-29', stepped: false },
  year_edge:             { todayISO: '2026-12-31', planFirstISO: '2026-12-07', planLastISO: '2027-03-07', stepped: false },
  dst_spring_forward:    { todayISO: '2026-03-08', planFirstISO: '2026-02-16', planLastISO: '2026-05-31', stepped: false },
  dst_fall_back:         { todayISO: '2026-11-01', planFirstISO: '2026-08-17', planLastISO: '2026-11-29', stepped: false },
  stepped_past:          { todayISO: '2026-08-12', planFirstISO: '2026-08-17', planLastISO: '2026-11-29', stepped: true },
  stepped_future:        { todayISO: '2026-09-02', planFirstISO: '2026-08-17', planLastISO: '2026-11-29', stepped: true },
  stepped_outside_plan:  { todayISO: '2027-06-14', planFirstISO: '2026-08-17', planLastISO: '2026-11-29', stepped: true },
  block_last_day:        { todayISO: '2026-11-29', planFirstISO: '2026-08-17', planLastISO: '2026-11-29', stepped: false },
  next_block_first_day:  { todayISO: '2026-11-30', planFirstISO: '2026-08-17', planLastISO: '2026-11-29', stepped: false },
};

/** The goal race. CIM, the marathon this runner is actually training for. */
export const GOAL_RACE = { name: 'California International Marathon', dateISO: '2026-12-06' };

// ─────────────────────────────────────────────────────────────────────────
// The rules
// ─────────────────────────────────────────────────────────────────────────

/**
 * Every rule the sweep enforces, and what a violation showed a runner.
 *
 * `firm` rules gate CI at zero. `firm: false` rules are real observations
 * whose correct answer is a DESIGN DECISION rather than a defect with an
 * obvious fix — they are counted and printed, never silently dropped, so the
 * decision stays visible instead of decaying into an accepted wrong.
 */
export const RULES = {
  BAD_TEXT: {
    firm: true,
    what: 'A user-facing string carried NaN, undefined, Invalid Date, Infinity or [object Object].',
  },
  ORPHAN_SECTION: {
    firm: true,
    what: 'A section header stood over nothing. A refusal wearing an outage\'s clothes.',
  },
  REFUSAL_UNEXPLAINED: {
    firm: true,
    what: 'A refusal state shipped without the stated reason that makes it a refusal rather than a blank screen.',
  },
  REFUSAL_LEAKED_CONTENT: {
    firm: true,
    what: 'A refusal state also shipped prescription content, so the phone drew half a screen it had declined to draw.',
  },
  MODELLED_FLAG_SHAPE: {
    firm: true,
    what: 'A number reached the wire without a boolean provenance flag, so the phone had to guess where it came from.',
  },
  MODELLED_UNDERMARKED: {
    firm: true,
    what: 'A goal-derived or zone-model number was stamped measured. A modelled number read as measured, which ValuesV5 calls the sin.',
  },
  MODELLED_OVERMARKED: {
    firm: true,
    what: 'A logged read (distance, clock, heart rate) was stamped modelled, making a measurement look like a guess.',
  },
  ZERO_FOR_UNKNOWN: {
    firm: true,
    what: 'An unknown quantity printed as a confident zero. `?? 0` turning "we do not know" into "it is zero".',
  },
  DECLINED_A_KNOWN_VALUE: {
    firm: true,
    what: 'The surface declined to print something it actually had. The other half of degrading honestly, and the half a sweep forgets: the first draft of the shoe-mileage fix relabelled a genuinely brand-new 0 mi shoe as untracked, which is wrong more often than the defect it replaced because `shoes.mileage` is NOT NULL DEFAULT 0.',
  },
  SELF_CONTRADICTION: {
    firm: true,
    what: 'Two numbers on one screen disproved each other. A pace its own clock says is impossible.',
  },
  HEADLINE_IS_SHORTHAND: {
    firm: true,
    what: 'The 56pt headline carried engine shorthand or a whole prescription, so it truncated mid-number.',
  },
  VOICE: {
    firm: true,
    what: 'Coach voice broken by an exclamation mark, an emoji, a long dash, or an interpunct in prose.',
  },
  STEPPED_PRESENT_TENSE: {
    firm: true,
    what: 'A day the runner stepped to carried present-tense reads, so a Wednesday screen showed Friday\'s readiness.',
  },
  DAY_ARITHMETIC: {
    firm: true,
    what: 'A day moved, collapsed or duplicated in the week strip. The ramp arithmetic is noon-UTC anchored for exactly this reason; this is what proves it across both DST transitions.',
  },
  RETIRED_SURFACE: {
    firm: true,
    what: 'A surface the owner retired came back onto the wire. `docs/PLAN_SIMPLIFICATION_DOCTRINE.md` removed readiness\'s authority over training decisions, so the overnight-convergence story (`V5Today.changed`, state `changed_overnight`) is deleted rather than defaulted off. A composer that emits either again has restored a lever doctrine took out.',
  },
  STALE_WINDOW: {
    firm: false,
    what: 'A window that has already closed was presented as the one the runner is in.',
  },
  UNREADABLE_FOR_ABSENT: {
    firm: false,
    what: 'Data that was never recorded rendered as fault-red "could not read" rather than as honestly absent.',
  },
  ELAPSED_VS_MOVING: {
    firm: false,
    what: 'An elapsed clock and a moving pace were printed side by side, so the two did not multiply out.',
  },
} as const;

export type RuleId = keyof typeof RULES;
export const RULE_IDS = Object.keys(RULES) as RuleId[];
export const FIRM_RULE_IDS = RULE_IDS.filter((r) => RULES[r].firm);

/**
 * Surfaces that have been DELETED, and must stay deleted.
 *
 * `docs/PLAN_SIMPLIFICATION_DOCTRINE.md` took readiness, daily form and
 * wearable signals out of every training decision: "removed — not hidden, not
 * defaulted off". The overnight-convergence screen was the surface that told
 * the runner readiness had changed his session, so it went with the authority
 * behind it — `V5Today.changed`, `V5TodayContext.convergence`, the
 * `changed_overnight` wire state and the iOS `TodayChangedV5` view.
 *
 * These names are written down because a TYPE deletion only stops the surface
 * coming back through TypeScript. A composer that spreads an untyped row onto
 * the payload, or that widens `state` to `string`, would put either back on the
 * wire with nothing to say so. The sweep checks every composed payload against
 * this list, so the deletion is a gate rather than a memory (Rule 20).
 */
export const RETIRED_WIRE_FIELDS = ['changed'] as const;
export const RETIRED_WIRE_STATES = ['changed_overnight'] as const;

export interface Finding {
  rule: RuleId;
  detail: string;
  where: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Shared detectors
// ─────────────────────────────────────────────────────────────────────────

/**
 * The shapes that mean a formatter was handed something it could not format
 * and printed the failure instead of refusing.
 *
 * `\bnull\b` is deliberately NOT here: "null" is a word ("null result") and
 * the risk of a false finding outweighs a shape that `undefined` already
 * catches in every template-literal path.
 */
const BAD_TEXT_RE = /\bNaN\b|\bundefined\b|\bInfinity\b|Invalid Date|\[object Object\]/;

/** Emoji, exclamation marks and em dashes are out of the coach's register
 *  (CLAUDE.md · coach voice). The interpunct is a FIELD separator: legal on a
 *  stats plate, never inside prose (lib/faff/why-voice.ts rule 1). */
const VOICE_RE = /[!\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]|—/u;

export function isBadText(s: string): boolean {
  return BAD_TEXT_RE.test(s);
}

export function voiceBreak(s: string): string | null {
  const m = VOICE_RE.exec(s);
  return m ? m[0] : null;
}

/** Walk every string in a payload, naming its path, so no field can be added
 *  to a wire type and quietly escape the text rules. */
export function walkStrings(
  root: unknown,
  visit: (path: string, value: string) => void,
  path = '$',
): void {
  if (typeof root === 'string') { visit(path, root); return; }
  if (Array.isArray(root)) {
    root.forEach((v, i) => walkStrings(v, visit, `${path}[${i}]`));
    return;
  }
  if (root && typeof root === 'object') {
    for (const [k, v] of Object.entries(root as Record<string, unknown>)) {
      walkStrings(v, visit, `${path}.${k}`);
    }
  }
}

/** "8:01/mi" / "1:41:53" / "12.4 mi" → seconds or miles. Null when the string
 *  is not one of the app's printed number shapes. */
export function parsePrinted(s: string | null | undefined): { kind: 'pace' | 'clock' | 'mi'; value: number } | null {
  if (!s) return null;
  const pace = /^(\d+):([0-5]\d)\/mi$/.exec(s);
  if (pace) return { kind: 'pace', value: Number(pace[1]) * 60 + Number(pace[2]) };
  const hms = /^(\d+):([0-5]\d):([0-5]\d)$/.exec(s);
  if (hms) return { kind: 'clock', value: Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3]) };
  const ms = /^(\d+):([0-5]\d)$/.exec(s);
  if (ms) return { kind: 'clock', value: Number(ms[1]) * 60 + Number(ms[2]) };
  const mi = /^([\d.]+) mi$/.exec(s);
  if (mi) return { kind: 'mi', value: Number(mi[1]) };
  return null;
}

/**
 * The share of a run that may plausibly be paused before its stored pace stops
 * being believable.
 *
 * RE-EXPORTED, never re-declared. `lib/runs/run-shape.ts` owns this number and
 * the arithmetic around it (`reconcilePaceWithClock`), added on 2026-08-24
 * after a Strava moving time turned an 8:01/mi easy run into 3:37/mi on every
 * surface that read it. A sweep that checked the composers against its OWN
 * copy of the threshold would keep passing after the engine's copy moved,
 * which is the same "the test agrees with itself" failure the doctrine gate
 * warns about in CLAUDE.md Rule 7.
 */
export { MAX_PAUSED_SHARE } from '../runs/run-shape';
