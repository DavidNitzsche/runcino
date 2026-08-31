/**
 * history-shapes.ts · A TRAINING HISTORY THE ARCHETYPE CORPUS CAN CARRY
 * (2026-08-30, CLAUDE.md Rule 15).
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *
 * `_sweep_allusers.test.ts` grades 11,598 archetypes and is the most-cited
 * quality evidence in this project. Until this file, `sim-matrix.ts`'s `Arc`
 * carried no history at all, so `sim-inputs.ts`'s `hist` was null for every one
 * of them, and four doctrine mechanisms were dark across the WHOLE corpus:
 *
 *   · `resolveRampBase` was never called          → `lifted` never exercised
 *   · `rampBaseEvidence` was null                 → `baseRebuilt` short-circuited
 *   · `easyDayMedianMi` was 0                     → the easy-day floor never bound
 *   · `recentQualityPerWeek` was undefined        → the density ramp never fired
 *
 * Every defect that mattered on 2026-08-30 lived in those four. Adding
 * archetypes would never have helped: the corpus could not express a runner
 * with a past, and every real runner has one. Rule 15's standard is PATHS
 * REACHED, not cases run, so this file is sized to reach branches, not to
 * multiply rows — see `REACH_BRANCHES` and the sweep's coverage ledger.
 *
 * ── THE MODEL ───────────────────────────────────────────────────────────────
 *
 * A `HistoryShape` renders `HISTORY_DAYS` (16 weeks · one full
 * `RAMP_BASE_LOOKBACK_WEEKS` window) of daily miles, MOST-RECENT-FIRST, plus
 * the side facts that are part of the same runner and must not be invented
 * separately from the mileage: how many quality sessions a week those miles
 * contained, how long a quality session was, and which race (if any) the engine
 * itself prescribed the quiet stretch for.
 *
 * Deriving the side facts from the same render is the point. A history that
 * says "0.6 mi/wk of quality" beside a series with two hard days in every week
 * teaches the engine a runner who does not exist, and Rule 11 is explicit that
 * a zero measured inside a prescribed recovery block and a zero off a detrained
 * runner are opposite facts. One render, one runner.
 *
 * ── WHY THE SHAPES ARE NOT RANDOM ───────────────────────────────────────────
 *
 * A generated 28-day series no human would run teaches nothing and produces
 * false failures. Every shape below is either a `Research/` protocol rendered
 * literally or the owner's own logged mileage:
 *
 *   · week layout, long-run share, cutback cadence  · `Research/00a`
 *     §"Volume progression rules" — "| Down weeks | Every 3-4 wk, reduce by
 *     20-30% |" — and `Research/22`'s per-tier sample weeks.
 *   · easy-day VARIATION (a short recovery day after the long, longer general
 *     aerobic days elsewhere) · `Research/00a` §1 vs §2, and CLAUDE.md Rule 12:
 *     "Four identical easy days is a template, not a plan."
 *   · post-race recovery depth · `Research/00b` §"Recovery by Distance"
 *     and §"Marathon Recovery (4-week reverse taper)".
 *   · the 1-2 week layoff return · `Research/22` §"Return from Short Layoff".
 *   · the owner's real 112 days (`OWNER_DAILY_MI`) as the calibration
 *     reference for what "real" looks like.
 *
 * ── PROVENANCE OF `OWNER_DAILY_MI` ──────────────────────────────────────────
 *
 * Read from prod with `DATABASE_URL_RO` on 2026-08-30 — `runs`, user_uuid
 * 0645f40c-951d-4ccc-b86e-9979cd26c795, `NOT (data ? 'mergedIntoId')` (the
 * canonical predicate, Rule 14), 112 days ending 2026-08-30. Re-verified
 * against prod on the day this file landed: mean28 = 31.5 against a rank-3
 * sustained week of 44.9, i.e. 70.16% of sustained — a tenth of a mile above
 * `RAMP_BASE_RESUME_FRACTION`, which is exactly why he is the right
 * calibration point for a corpus about boundaries.
 *
 * ── WHAT THIS CORPUS CANNOT FAIL ON (CLAUDE.md Rule 22) ────────────────────
 *
 * Written down deliberately, because "a gate that only ever asks 'did you
 * correctly refuse?' will pass an engine that can only refuse", and a corpus
 * built to catch the defects of one night inherits that night's instincts.
 *
 * 1. ADAPTATION. Every shape here is an input to AUTHORING. Nothing in this
 *    corpus runs `adapt.ts`, `progression-pass.ts` or `adaptive-ramp.ts`, so
 *    an engine that authors a perfect block and then never pushes it again
 *    passes every case in this file. Rule 21's finding — zero upward
 *    adaptations in 309 production intents — is invisible from here and always
 *    will be.
 * 2. THE DB READERS THEMSELVES. `sim-inputs.ts` resolves the anchors with the
 *    engine's PURE halves. The SQL of `recentQualityPerWeek`,
 *    `easyDayMedianMi` and `rampBaseForBuild` never runs. Rule 14's
 *    archived-plan-version join is caught here only because the falsifier
 *    injects the number that query produced; the query is unwatched by this
 *    file and belongs to `_active_plan_scan`.
 * 3. A WRONG-BUT-CONSISTENT DOCTRINE CONSTANT. The answer key is
 *    `TIER_TARGETS`, which is engine code. A band that disagrees with
 *    `Research/22` passes every archetype. That is `check-doctrine.sh`'s job,
 *    not this one.
 * 4. ANYTHING THE RUNNER SEES. Copy, labels, ordering, contrast. Rule 13.
 *
 * DISTRIBUTION, counted rather than assumed. Of the nine shapes, SIX describe
 * a runner below their own level (postRaceShallow, postRaceDeep, shortLayoff,
 * injuryReturn, fromNothing, deloadBuild) and THREE describe one at or above
 * it (steady, progressiveBuild, racesMonthly). That imbalance is named because
 * it is the exact shape Rule 22 warns about; `progressiveBuild` exists to keep
 * it from being 8:1, and the upward branch it reaches — CURRENTVOL-1's floor
 * binding ABOVE the 28-day mean — is the one the hero statement depends on.
 *
 * NOTE FOR THE OWNER OF `_coach_sensible.test.ts`: that file carries its own
 * checked-in copy of this same series under the same name. The two were
 * confirmed identical when this file landed. Per Rule 16 one of them should
 * import the other, and this module is the importable side (it is not a test
 * file, so importing it registers no describes). That is a one-line change in
 * a file this agent does not own, so it is reported rather than made.
 */

// ── the model ───────────────────────────────────────────────────────────────

/** 16 weeks · one full `RAMP_BASE_LOOKBACK_WEEKS` window. */
export const HISTORY_WEEKS = 16;
export const HISTORY_DAYS = HISTORY_WEEKS * 7;

/** What a logged day WAS, so the side facts are derived and cannot drift. */
export type DayKind = 'rest' | 'easy' | 'quality' | 'long' | 'race';

export interface HistoryDay {
  mi: number;
  kind: DayKind;
}

/** A rendered runner-past: the series plus everything derived from it. */
export interface RenderedHistory {
  /** `sim.dailyMiMostRecentFirst` · miles run `i` days before the start date. */
  dailyMiMostRecentFirst: number[];
  /** `sim.recentQualityPerWeek` · quality sessions per week over the last 28
   *  days, the window `recentQualityPerWeek` measures in production. */
  recentQualityPerWeek: number;
  /** `sim.recentQualityDistanceMi` · the runner's typical quality-day
   *  distance over the same window. 0 when there was none. */
  recentQualityDistanceMi: number;
  /** The 14-day easy-day median `sim-inputs` will derive, computed here too so
   *  a shape can be asserted to actually reach the floor it was written for. */
  easyDayMedianMi: number;
  /** Days since a race the runner actually ran, or 0. */
  lastRaceFinishedDaysAgo: number;
  lastRaceDistance: '5k' | '10k' | 'half' | 'marathon' | null;
  lastRacePriority: 'A' | 'B' | 'C' | null;
  /** True when the last 28 days contain quality — the honest read of
   *  "has this runner been in a block", which is what `isMidBlock` means. */
  isMidBlock: boolean;
}

export interface HistoryShapeSpec {
  /** Stable id · used in arc strings and in the coverage ledger. */
  id: string;
  /** One line naming the runner and the doctrine the shape renders. */
  what: string;
  /** The `Research/` passage the weekly profile is read from. */
  cite: string;
  /**
   * Weekly volumes as a FRACTION of `sustainedMi`, most-recent-first, 16 long.
   * Fractions rather than miles so one shape serves a 20 mi/wk runner and a
   * 55 mi/wk runner without two hand-written copies that can disagree.
   */
  weekFrac: readonly number[];
  /** Quality sessions in each of those weeks, most-recent-first, 16 long. */
  weekQuality: readonly number[];
  /** The race behind the quiet stretch, if any. */
  race?: { daysAgo: number; distance: '5k' | '10k' | 'half' | 'marathon'; priority: 'A' | 'B' | 'C' };
  /** Which branches this shape is written to reach. Asserted by the sweep. */
  reaches: readonly ReachBranch[];
}

/**
 * THE BRANCH LEDGER · Rule 15's "paths reached", named so the sweep can assert
 * every one of them was actually visited. A shape whose branch stops being
 * reachable fails loudly instead of going quiet, which is the failure mode this
 * whole file exists to end (Rule 18 §2 · assert liveness).
 */
export const REACH_BRANCHES = [
  // ── resolveRampBase ──
  'ramp:called',              // the reader ran at all — null for all 11,598 before
  'ramp:no-sustained',        // sustained === 0 · the from-nothing early return
  'ramp:layoff',              // interruption > allowedInterruptionWeeks · early return
  'ramp:lifted',              // 0.70 × sustained > mean · the lift path
  'ramp:not-lifted',          // the mean governs
  'ramp:held-binds',          // CURRENTVOL-1 · the held floor raised the base above the mean
  'ramp:returning',           // there is a sustained level the runner is below
  'ramp:entry-week-spent',    // POSTRACE-RESTORE-1 · heldByCurrent
  'ramp:entry-week-owed',     // the other side of it · a runner coming back from not running
  'ramp:race-extended-allowance', // allowedInterruptionWeeksFor read a real race
  // ── baseRebuilt ──
  'base:rebuilt',             // BASE may be skipped mid-block
  'base:deficit',             // the clause NOTHING could reach · BASE is inserted
  // ── easy-day floor ──
  'easy:floor-armed',         // easyDayMedianMi > the flat 3 mi minimum
  'easy:floor-binds',         // a bigger demonstrated easy day produced a bigger prescription
  'easy:floor-dark',          // deliberately 0 · the from-nothing runner
  // ── quality-density ramp ──
  'density:habit-at-target',  // recentQ >= prefs · no ramp, but MEASURED, not assumed
  'density:ramps',            // recentQ below prefs · the ramp runs
  'density:return-floor',     // QUALITY_RETURN_MIN_SESSIONS kept quality from vanishing
] as const;
export type ReachBranch = (typeof REACH_BRANCHES)[number];

// ── the owner's real history · the calibration reference ────────────────────

/**
 * The owner's logged daily mileage, most-recent-first from 2026-08-30. Real,
 * not invented — see the provenance note in the file header. Kept because a
 * corpus of hand-made histories needs one row that is known to be a runner.
 */
export const OWNER_DAILY_MI: readonly number[] = [
  13.49, 0, 6.32, 3.14, 7.78, 0, 4.02, 11.01, 0, 9.14, 4.26, 0, 4.01, 0,
  13.2, 0, 0, 0, 0, 5.97, 4.02, 12.37, 0, 6.02, 4.86, 6.02, 4.77, 5.77,
  0, 4.16, 0, 0, 0, 0, 0, 0, 18, 0, 5.06, 7.21, 7.52, 9.69, 0, 0,
  7.9, 5.73, 9.01, 8.02, 9.09, 12.6, 0, 4.96, 5.86, 6.16, 7.56, 6.01, 0, 0,
  0, 0, 0, 0, 0, 0, 14.02, 0, 5.83, 0, 8.12, 0, 13.15, 0, 6.45, 8.15,
  6.03, 7.5, 6.01, 13.13, 0, 0, 6.9, 6.02, 8.02, 6.01, 12.55, 0, 6.01, 7.76,
  6.08, 7.41, 5.06, 12.36, 0, 7.71, 0, 5.86, 7.61, 6.16, 12.12, 0, 7.78, 7.17,
  5.08, 2.44, 5.95, 11.02, 0, 5.01, 11.22, 5.59, 4.71, 0,
];

// ── the week layout ─────────────────────────────────────────────────────────

/**
 * One week, most-recent-first: index 0 is the day before the start date.
 *
 * Every archetype in the corpus starts on a Monday (`startDateISO
 * '2026-07-06'`) with `longRunDay: 'sun'`, so index 0 IS the long-run day and
 * the roles below read Sunday → Monday. That is a real `Research/22` sample
 * week for a six-day runner: long Sunday, rest Saturday, short recovery Friday,
 * quality Thursday, general-aerobic Wednesday, quality Tuesday, easy Monday.
 */
const WEEK_ROLES: readonly DayKind[] = ['long', 'rest', 'easy', 'quality', 'easy', 'quality', 'easy'];

/**
 * Which slot is surrendered first as the week gets shorter. Ordered so a
 * five-day week keeps both quality days and a three-day week keeps one — the
 * priority `Research/22`'s low-frequency tables use (a 3-day plan is long +
 * quality + easy, never long + two easies).
 */
const DROP_ORDER: readonly number[] = [4, 5, 2, 3, 6];

/**
 * `Research/00a` §1 vs §2 · easy days are NOT all the same length. The day
 * after the long run is the short recovery run; the days away from it are
 * general aerobic. Weights are relative and normalised to the week's easy
 * budget, so this holds at every volume. Rule 12 names the alternative — four
 * identical easy days — as a template rather than a plan.
 */
const EASY_WEIGHTS: readonly number[] = [0.72, 1.16, 1.12];

/** `Research/22`'s long-run share of the week, mid-band. */
const LONG_SHARE = 0.30;
/** A quality session's share of the week, mid-band across the tier tables. */
const QUALITY_SHARE = 0.17;

const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Render one week of `HistoryDay`, most-recent-first.
 *
 * Conserves `weekMi` to the tenth: whatever rounding leaves over lands on the
 * long run, so a shape's stated weekly fraction is the weekly total the engine
 * will actually read back.
 */
export function layWeek(weekMi: number, daysPerWeek: number, qualityDays: number): HistoryDay[] {
  const roles: DayKind[] = [...WEEK_ROLES];
  if (daysPerWeek >= 7) roles[1] = 'easy';
  let running = roles.filter((r) => r !== 'rest').length;
  for (const idx of DROP_ORDER) {
    if (running <= daysPerWeek) break;
    if (roles[idx] === 'rest') continue;
    roles[idx] = 'rest';
    running--;
  }
  // Quality beyond what the runner is doing becomes easy running, never rest —
  // dropping the day would change the week's DAY COUNT, which is a different
  // fact about the runner and not one this parameter is describing.
  let qLeft = Math.max(0, Math.round(qualityDays));
  for (let i = 0; i < 7; i++) {
    if (roles[i] !== 'quality') continue;
    if (qLeft > 0) qLeft--; else roles[i] = 'easy';
  }
  if (weekMi <= 0) return roles.map(() => ({ mi: 0, kind: 'rest' as DayKind }));

  const qCount = roles.filter((r) => r === 'quality').length;
  const easyIdx = roles.map((r, i) => (r === 'easy' ? i : -1)).filter((i) => i >= 0);
  const longMi = r1(weekMi * LONG_SHARE);
  const qMi = qCount > 0 ? r1(Math.min(weekMi * QUALITY_SHARE, Math.max(0, weekMi - longMi) / qCount)) : 0;
  const easyBudget = Math.max(0, weekMi - longMi - qMi * qCount);
  const wSum = easyIdx.reduce((s, _, k) => s + EASY_WEIGHTS[k % EASY_WEIGHTS.length], 0);

  const out: HistoryDay[] = roles.map((kind) => ({ mi: 0, kind }));
  let spent = 0;
  easyIdx.forEach((dayIdx, k) => {
    const mi = wSum > 0 ? r1((easyBudget * EASY_WEIGHTS[k % EASY_WEIGHTS.length]) / wSum) : 0;
    out[dayIdx] = { mi, kind: 'easy' };
    spent += mi;
  });
  for (let i = 0; i < 7; i++) if (roles[i] === 'quality') { out[i] = { mi: qMi, kind: 'quality' }; spent += qMi; }
  out[0] = { mi: r1(Math.max(0, weekMi - spent)), kind: 'long' };
  return out;
}

// ── the shapes ──────────────────────────────────────────────────────────────

/** `Research/00a` §"Volume progression rules" · "reduce by 20-30%". */
const CUTBACK = 0.75;

const flat = (n: number, v: number) => Array.from({ length: n }, () => v);

/** A steady 16 weeks with a cutback every fourth, most-recent-first. */
function steadyFrac(cutbackAt: number): number[] {
  return Array.from({ length: HISTORY_WEEKS }, (_, w) => ((w - cutbackAt) % 4 === 0 && w >= cutbackAt ? CUTBACK : 1.0));
}

export const HISTORY_SHAPES: readonly HistoryShapeSpec[] = [
  {
    id: 'steady',
    what: 'Uninterrupted training at a held volume, cutback every fourth week.',
    cite: 'Research/00a §"Volume progression rules" · "| Down weeks | Every 3-4 wk, reduce by 20-30% |"',
    weekFrac: steadyFrac(2),
    weekQuality: flat(HISTORY_WEEKS, 2),
    reaches: ['ramp:called', 'ramp:not-lifted', 'ramp:held-binds', 'base:rebuilt', 'easy:floor-armed', 'density:habit-at-target'],
  },
  {
    id: 'deloadBuild',
    what: 'Mid-build, two weeks into a deliberate absorb block. The plan asked him to go easy and he did.',
    cite: 'Research/00a §"Volume progression rules" (the down weeks) + Research/22 §"Marathon — Intermediate" build shape',
    // Two recent down weeks, then a build that had been climbing.
    weekFrac: [0.80, 0.78, 1.00, 0.97, 0.94, 0.75, 0.91, 0.88, 0.86, 0.70, 0.83, 0.80, 0.78, 0.64, 0.76, 0.73],
    weekQuality: [1, 1, 2, 2, 2, 1, 2, 2, 2, 1, 2, 2, 2, 1, 2, 2],
    // MEASURED, not assumed. Two down weeks put `heldMi` (0.80 of sustained)
    // BELOW the 28-day mean (0.8875), so CURRENTVOL-1's floor does not bind and
    // `heldByCurrent` is false — the ladder's re-entry week is still OWED. That
    // is the correct doctrine reading for a runner mid-deload, and it is the
    // opposite side of the fork from `postRaceShallow`, which is why both are
    // in the corpus. An earlier draft of this line claimed
    // `ramp:entry-week-spent` and the per-shape assertion caught it.
    reaches: ['ramp:called', 'ramp:not-lifted', 'ramp:returning', 'ramp:entry-week-owed', 'base:rebuilt', 'easy:floor-armed'],
  },
  {
    id: 'progressiveBuild',
    what: 'Climbing. His most recent week is the biggest he has run, and nothing has interrupted him.',
    cite: 'Research/00a §"Volume progression rules" · the climb the down weeks punctuate; Research/22 §"Marathon — Advanced" build shape',
    // RULE 22 (2026-08-30) · the shape this corpus was missing. Six of the
    // eight shapes beside it describe a runner BELOW their level — post-race,
    // layoff, injury, deload, from nothing — because that is what the defects
    // of 2026-08-30 were about, and a corpus written to catch those inherits
    // their instinct. "You cannot correct an engine's bias with a test suite
    // that shares it."
    //
    // This runner is the hero statement's third world: he pushed forward, and
    // the question is whether the plan pushes back. `heldMi` (0.92 of
    // sustained) sits ABOVE the 28-day mean (0.90), so CURRENTVOL-1's floor
    // binds UPWARD — the branch where the engine ramps from what the runner is
    // demonstrably holding rather than from an average that is already behind
    // him — and `returning` is false because there is nothing to restore.
    weekFrac: [1.00, 0.96, 0.72, 0.92, 0.88, 0.85, 0.64, 0.81, 0.78, 0.75, 0.56, 0.71, 0.68, 0.65, 0.49, 0.62],
    weekQuality: [2, 2, 1, 2, 2, 2, 1, 2, 2, 2, 1, 2, 2, 2, 1, 2],
    reaches: ['ramp:called', 'ramp:not-lifted', 'ramp:held-binds', 'base:rebuilt', 'easy:floor-armed', 'density:habit-at-target'],
  },
  {
    id: 'postRaceShallow',
    what: 'Two weeks past an A-priority half. Inside the recovery window the engine itself prescribed — THE case that broke everything.',
    cite: 'Research/00b §"Recovery by Distance" · half marathon, "| 10-14 |" total recovery days with no quality + Research/08 §9.1 taper',
    // The owner's own ratios, 2026-08-30: recovery / recovery / taper / build,
    // giving mean28 = 0.7025 × sustained — a tenth of a mile the safe side of
    // RAMP_BASE_RESUME_FRACTION, which is where he actually sat.
    weekFrac: [0.775, 0.632, 0.517, 0.886, 0.094, 1.00, 0.886, 0.962, 0.00, 0.623, 1.00, 0.893, 1.00, 0.884, 0.902, 0.837],
    weekQuality: [0, 0, 1, 2, 0, 2, 2, 2, 0, 1, 2, 2, 2, 2, 2, 2],
    race: { daysAgo: 14, distance: 'half', priority: 'A' },
    reaches: ['ramp:called', 'ramp:not-lifted', 'ramp:returning', 'ramp:held-binds', 'ramp:entry-week-spent', 'ramp:race-extended-allowance', 'base:rebuilt', 'easy:floor-armed', 'density:ramps'],
  },
  {
    id: 'postRaceDeep',
    what: 'Three weeks past an A-priority marathon, still inside Research/00b\'s four-week no-quality window.',
    cite: 'Research/00b §"Recovery by Distance" (marathon, "| 21-28 |") + §"Marathon Recovery (4-week reverse taper)" · "| Week 2 | 30-40% |", "| Week 3 | 50-60% |"',
    weekFrac: [0.35, 0.30, 0.15, 0.50, 0.85, 1.00, 0.75, 0.97, 0.94, 0.72, 0.91, 0.88, 1.00, 0.70, 0.86, 0.83],
    weekQuality: [0, 0, 0, 1, 2, 2, 1, 2, 2, 1, 2, 2, 2, 1, 2, 2],
    race: { daysAgo: 21, distance: 'marathon', priority: 'A' },
    reaches: ['ramp:called', 'ramp:lifted', 'ramp:returning', 'ramp:entry-week-owed', 'ramp:race-extended-allowance', 'base:rebuilt', 'density:ramps', 'density:return-floor'],
  },
  {
    id: 'shortLayoff',
    what: 'Two weeks off with nothing behind them — a trip, a cold. Doctrine\'s own return case.',
    cite: 'Research/22 §"Return from Short Layoff (1-2 weeks off)" · "8-14 days | 70% of pre-layoff volume for 1 wk, 85% for wk 2, full for wk 3"',
    weekFrac: [0.00, 0.00, 1.00, 0.97, 0.75, 0.94, 0.91, 0.88, 0.72, 1.00, 0.86, 0.83, 0.70, 0.95, 0.92, 0.89],
    weekQuality: [0, 0, 2, 2, 1, 2, 2, 2, 1, 2, 2, 2, 1, 2, 2, 2],
    // No `density:return-floor`: the two weeks off are preceded by normal
    // training, so the 28-day window still holds 1.0 quality sessions a week
    // and `Math.round` does not take it to zero. The floor's trigger belongs to
    // the runners whose whole window was a prescribed no-quality block.
    reaches: ['ramp:called', 'ramp:lifted', 'ramp:returning', 'ramp:entry-week-owed', 'base:rebuilt', 'density:ramps'],
  },
  {
    id: 'injuryReturn',
    what: 'Hurt three weeks ago mid-block, now jogging back. The dip is longer than any allowance and nothing explains it.',
    cite: 'Research/05 §1.4 Return-to-Volume Guidelines + Research/22 §14 Comeback Plans (the two-week allowance this deliberately exceeds)',
    // Three consecutive weeks below the resume level with NO race behind them,
    // so `allowedInterruptionWeeksFor` stays at SHORT_LAYOFF_WEEKS and
    // `resolveRampBase` takes its layoff early return — the only path on which
    // `baseRebuilt` can come out FALSE, and therefore the only way an archetype
    // can reach the BASE-deficit branch at all.
    //
    // Week 3 still carries quality, which is what makes him mid-block: he was
    // training normally a month ago. That matters, because `baseRebuilt` is
    // only OBSERVABLE through `sizeBlocks(…, isMidBlock && baseRebuilt)` — a
    // runner who has not done quality skips BASE-insertion on the isMidBlock
    // clause alone and the gate would be grading nothing.
    //
    // ABSENCE-CONTINUOUS-1 (2026-08-30) · DEEPENED, and the reason is the point
    // of the shape. `interruptionWeeks` used to be a COUNT of consecutive weeks
    // below the resume level, so three weeks at 15/22/30% of sustained counted
    // as exactly three and cleared the two-week allowance. It is now
    // WEEKS-EQUIVALENT OF ABSENCE — doctrine keys its return protocols on DAYS
    // OFF, and a runner holding 22% of his sustained volume is not off — so the
    // same three weeks measured 1.99, a hundredth of a week INSIDE the
    // allowance, and this shape stopped reaching `ramp:layoff` and with it the
    // only path to `base:deficit`. Exactly the blindness Rule 15 exists to
    // catch, caught by the reachability assertion the same night both landed.
    //
    // The fractions below are 10/18/25% of sustained — for a 45 mi/wk runner,
    // four and a half, eight and eleven miles across three weeks. That is what
    // `Research/22` §"Return from Moderate Layoff (3-8 weeks)" is describing,
    // and it is what this shape's own `what` claims: a dip longer than any
    // allowance. The old numbers described a deep dip, which is a different
    // runner and a different branch.
    weekFrac: [0.10, 0.18, 0.25, 0.90, 0.95, 0.75, 0.92, 1.00, 0.88, 0.70, 0.94, 0.90, 1.00, 0.72, 0.86, 0.83],
    weekQuality: [0, 0, 0, 2, 2, 1, 2, 2, 2, 1, 2, 2, 2, 1, 2, 2],
    // No density claims. This is the one shape that gets a BASE phase, and
    // `densityForWeek` returns the full prescribed density during BASE while
    // the ramp's `stepsUp` counts GLOBAL week index — so by the time the first
    // QUALITY week arrives the four-week ramp has already completed and no
    // ramp is observable in the authored plan. That is defensible (four weeks
    // of base IS the return), and it is worth knowing: a runner who gets BASE
    // never sees Rule 5's ramp.
    reaches: ['ramp:called', 'ramp:layoff', 'base:deficit'],
  },
  {
    id: 'fromNothing',
    what: 'A new runner two weeks in. Three short runs a week and nothing at all before them.',
    cite: 'Research/00a §"Practical base-building rules" · the couch-start ramp',
    // Rendered against a nominal 8 mi/wk, so weeks 0-1 are 6.0 and 4.4 mi —
    // three runs of about two miles, which is what a fortnight-old runner
    // actually does. Only two non-zero weeks, so `RAMP_BASE_SUSTAINED_RANK`'s
    // third-highest is 0 and `resolveRampBase` takes its no-sustained early
    // return: the branch that says "this runner has no level to be below",
    // which is a different fact from a layoff and must not be collapsed with
    // one (Rule 11).
    weekFrac: [0.75, 0.55, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00],
    weekQuality: flat(HISTORY_WEEKS, 0),
    // No `base:rebuilt`. `baseRebuilt` comes out TRUE for him on its
    // `!(sustainedMi > 0)` clause, but it is only ever OBSERVABLE through
    // `sizeBlocks(…, isMidBlock && baseRebuilt)`, and a runner with no quality
    // in the last 28 days is not mid-block by construction. So that clause of
    // the gate is computed and cannot change any plan — a real limit on what
    // this corpus can assert, stated rather than papered over.
    reaches: ['ramp:called', 'ramp:no-sustained', 'easy:floor-dark', 'density:return-floor'],
  },
  {
    id: 'racesMonthly',
    what: 'Races a C-priority event roughly every four weeks. Sawtooth, high quality density, never fully rebuilt.',
    cite: 'Research/22 §"5K-10K Track / Road Series" · "Race weekly or bi-weekly for 4-8 weeks after a peak" + Research/00b §"Recovery by Effort (A vs. B vs. C Race)"',
    weekFrac: [0.65, 0.45, 0.75, 1.00, 0.65, 0.45, 0.75, 1.00, 0.65, 0.45, 0.75, 1.00, 0.65, 0.45, 0.75, 1.00],
    weekQuality: [1, 1, 2, 2, 1, 1, 2, 2, 1, 1, 2, 2, 1, 1, 2, 2],
    race: { daysAgo: 14, distance: '10k', priority: 'C' },
    // No `ramp:race-extended-allowance`, and the reason is worth recording: a
    // C-priority 10K's mandated window is 2 taper weeks plus
    // `postRaceRecoveryWeeks('10k','C')`, which scales 1 week down below half
    // and floors to 0 — so the total is exactly `SHORT_LAYOFF_WEEKS` and the
    // race buys this runner no extra allowance at all. The A-priority shapes
    // carry that branch.
    reaches: ['ramp:called', 'ramp:not-lifted', 'ramp:returning', 'ramp:entry-week-owed', 'base:rebuilt', 'easy:floor-armed', 'density:habit-at-target'],
  },
];

export const shapeById = (id: string): HistoryShapeSpec | undefined => HISTORY_SHAPES.find((s) => s.id === id);

// ── rendering ───────────────────────────────────────────────────────────────

/**
 * QUALITY-INFLATION FALSIFIER (CLAUDE.md Rule 18 · a gate is not trusted until
 * it has been made to fail).
 *
 * Rule 14's archived-plan-version defect made `recentQualityPerWeek` return 36
 * for a runner whose habit is two, by joining `plan_workouts` on `user_uuid`
 * alone and so counting every one of 47 plan versions. The consequence was that
 * `recentQ >= tierQ` was trivially true in `densityForWeek` and Rule 5's ramp
 * had NEVER FIRED for any runner whose plan had been rebuilt, which is
 * everyone.
 *
 * The essential property is that the number is LARGE AND UNRELATED TO THE
 * RUNNER — it counts plan rows, not runs — so this falsifier REPLACES the
 * measured habit with the env var's value rather than scaling it. Scaling
 * would leave a genuinely-zero habit at zero and miss the very probe pair
 * written to catch this.
 *
 * Applied at the handoff (`simInputsForArc`), which is where the DB reader's
 * answer entered the composer, so it also overrides the probe families'
 * deliberate habit values exactly as the real bug did.
 *
 *   FAFF_FALSIFY_QUALITY_INFLATION=36 npx vitest run lib/plan/_sweep_allusers.test.ts
 *
 * Unset in every normal run; the sweep asserts it is unset when it would
 * otherwise be green, so it can never be quietly left armed.
 */
export const QUALITY_INFLATION_ENV = 'FAFF_FALSIFY_QUALITY_INFLATION';

/** The falsifier's value, or null when it is not armed. */
export function inflatedQualityPerWeek(): number | null {
  const raw = process.env[QUALITY_INFLATION_ENV];
  if (!raw) return null;
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** `easyDayMedianMi`'s own derivation · runs of 3-9 mi over 14 days, median,
 *  rounded to 0.5. Mirrored here so a shape can be asserted to arm the floor
 *  it was written for, and asserted equal to what `sim-inputs` derives. */
export function easyMedianOf(daily: readonly number[]): number {
  const easies: number[] = [];
  for (let i = 0; i < 14; i++) { const m = daily[i] ?? 0; if (m >= 3 && m <= 9) easies.push(m); }
  if (easies.length === 0) return 0;
  easies.sort((a, b) => a - b);
  const mid = easies.length % 2
    ? easies[(easies.length - 1) / 2]
    : (easies[easies.length / 2 - 1] + easies[easies.length / 2]) / 2;
  return Math.round(mid * 2) / 2;
}

/**
 * Render a shape for one runner.
 *
 * `sustainedMi` is the volume the shape's fractions are expressed against —
 * the level this runner holds when nothing is interrupting them. Everything
 * else falls out of the same render, so the mileage and the side facts describe
 * ONE runner rather than three.
 */
export function renderHistory(
  spec: HistoryShapeSpec,
  sustainedMi: number,
  daysPerWeek: number,
): RenderedHistory {
  const days: HistoryDay[] = [];
  for (let w = 0; w < HISTORY_WEEKS; w++) {
    const frac = spec.weekFrac[w] ?? 0;
    const q = spec.weekQuality[w] ?? 0;
    days.push(...layWeek(r1(sustainedMi * frac), daysPerWeek, q));
  }
  const dailyMiMostRecentFirst = days.map((d) => d.mi);

  // The 28-day window `recentQualityPerWeek` measures in production.
  const last28 = days.slice(0, 28);
  const qDays = last28.filter((d) => d.kind === 'quality' && d.mi > 0);
  const recentQualityPerWeek = Math.round((qDays.length / 4) * 100) / 100;
  const recentQualityDistanceMi = qDays.length
    ? r1(qDays.reduce((s, d) => s + d.mi, 0) / qDays.length)
    : 0;

  return {
    dailyMiMostRecentFirst,
    recentQualityPerWeek,
    recentQualityDistanceMi,
    easyDayMedianMi: easyMedianOf(dailyMiMostRecentFirst),
    lastRaceFinishedDaysAgo: spec.race?.daysAgo ?? 0,
    lastRaceDistance: spec.race?.distance ?? null,
    lastRacePriority: spec.race?.priority ?? null,
    // `isMidBlock` means "has been doing quality recently", which is a fact
    // about the last 28 days and is therefore derived, never declared.
    isMidBlock: qDays.length > 0,
  };
}
