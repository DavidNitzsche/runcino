/**
 * EXHAUSTIVE all-user conformance sweep (2026-06-23).
 *
 * Generates a plan for every meaningful user archetype across the full onboarding input matrix
 * and grades each against the research answer key (TIER_TARGETS bands + validateComposedPlan +
 * structural/pace/ramp invariants). Every failure is a bug. The bar: ZERO firm failures, every
 * archetype, no exceptions — then this becomes a permanent CI gate.
 *
 * Run: ./node_modules/.bin/vitest run lib/plan/_sweep_allusers.test.ts --disable-console-intercept 2>&1 | tail -60
 */
import { describe, it, expect } from 'vitest';
import { buildSimPlan, simEasyDayMedianMi, simPrescribedSpans } from './sim-inputs';
import { validateComposedPlan, PlanValidationError } from './validate';
import { classifyGoalTier, TIER_TARGETS, distanceCategoryOf } from './goal-tiers';
import { ULTRA_UNSUPPORTED_REASON } from './supported-distances';
import { predictRaceTime } from '@/lib/training/vdot';

// The archetype corpus lives in `./sim-matrix` (extracted 2026-08-28) so the
// dosing gate (`_dosing_sweep_gate.test.ts`) can drive the IDENTICAL matrix
// without importing this test file. Add arcs THERE; every gate sweeps them.
import { matrix, isUltra, arcStr, simInputsForArc, type Arc } from './sim-matrix';
import { REACH_BRANCHES, HISTORY_SHAPES, QUALITY_INFLATION_ENV, type ReachBranch } from './history-shapes';
import { SHORT_LAYOFF_WEEKS } from './generate';
// CORPUS-ADJ-1 (2026-09-04) · the adjudication layer, reached from THIS corpus.
// The owner: "The adjudicator being unreachable from the primary plan corpus is
// not acceptable." `adjudication-corpus.ts` is the translation — it authors no
// verdict of its own; every one below comes out of `adjudication/adjudicate.ts`.
import {
  ADJ_REACH_BRANCHES, adjReachOf, adjudicateColdStartBlock, adjudicateComposedBlock,
  type AdjReachBranch, type CorpusAdjudication,
} from './adjudication-corpus';
import { PROMOTION_DIMENSIONS } from './adjudication/contract';
import { RACE_DISTANCE_KEYS, type RaceDistanceKey } from './adjudication/cold-start';

const catOfMi = (mi: number) => distanceCategoryOf(mi);

const FIRM: Record<string, number> = {};
const WARN: Record<string, number> = {};
const examples: Record<string, string> = {};
const firm = (k: string, a: Arc) => { FIRM[k] = (FIRM[k] || 0) + 1; if (!examples[k]) examples[k] = arcStr(a); };
const warn = (k: string, a: Arc) => { WARN[k] = (WARN[k] || 0) + 1; if (!examples[k]) examples[k] = arcStr(a); };

// ── HIST-1 (2026-08-30) · the coverage ledger, and the probe families ───────
//
// CLAUDE.md Rule 15: "Coverage is not the count of cases that pass. It is the
// set of code paths any case can reach." Everything below states coverage that
// way. `REACHED` records which branch of which mechanism each archetype
// actually visited, and the gate asserts every named branch was visited at
// least once — so a change that makes one unreachable fails LOUDLY rather than
// letting the corpus go quietly back to grading runners with no past.
const REACHED = new Map<ReachBranch, number>();
/** Per-shape, so a shape's declared `reaches` is an ASSERTION rather than a
 *  comment. A shape that stops reaching what it claims is the exact failure
 *  this corpus exists to end — a mechanism gated on something the fixtures
 *  never populate is decoration, and so is a fixture that says it exercises a
 *  mechanism and does not. */
const REACHED_BY_SHAPE = new Map<string, Set<ReachBranch>>();
let currentShape: string | null = null;
const reach = (b: ReachBranch) => {
  REACHED.set(b, (REACHED.get(b) ?? 0) + 1);
  if (currentShape) {
    const s = REACHED_BY_SHAPE.get(currentShape) ?? new Set<ReachBranch>();
    s.add(b);
    REACHED_BY_SHAPE.set(currentShape, s);
  }
};

/** One probe arc's measurements, collected for comparison after the sweep.
 *  A single archetype cannot express "the floor binds" or "the ramp ramps" —
 *  those are statements about two runners who differ in one input. */
interface ProbeRow {
  arc: Arc;
  ok: boolean;
  /** Smallest easy day in the first non-BASE, non-TAPER training week. */
  firstWeekMinEasyMi: number;
  /** Largest easy day anywhere in a non-BASE, non-TAPER training week. */
  peakEasyMi: number;
  /** Quality days in the first quality-bearing week, and in the densest week. */
  firstQualityCount: number;
  peakQualityCount: number;
  /** The plan's opening weekly volumes · what the ramp base buys. Summed over
   *  three weeks because a single realized week carries up to ~3 mi of
   *  day-snapping noise (`layoutWeek` rounds `perEasy` to whole miles across up
   *  to five easy days), and a monotonicity check tight enough to be useful on
   *  the budget is meaningless on the realized sum of one week. */
  openingMi: number[];
  /** The DECISION the walk is about, straight off `RampBaseEvidence` — no
   *  rounding in it at all, so this side of the assertion can be exact. */
  rampBaseMi: number;
  rampNote: string;
}
const PROBES = new Map<string, ProbeRow[]>();

// ── CORPUS-ADJ-1 · the adjudication ledger ─────────────────────────────────
//
// Same discipline as `REACHED` above and for the same reason one level up: the
// whole `lib/plan/adjudication/` layer was unreachable from this corpus, so
// 11,598 archetypes said nothing about whether the blocks they compose can be
// JUSTIFIED — only whether each week is individually legal, which is precisely
// the check `contract.ts` says every other gate in this engine already is.
//
// WHAT THIS LEDGER CANNOT FAIL ON (Rule 22), and it is a short list because the
// bridge's own header carries the long one:
//   · A DIMENSION'S FAILING DIRECTION. The bridge is a correct caller by
//     construction — it holds inside a taper, it gates every CONDITIONAL — so
//     `taperIntegrity` and `athleteSpecificSupport` are REACHED here and cannot
//     be made to fail here. `_promotion_dimensions.test.ts` owns that half, one
//     constructed case per dimension with the other nine asserted still true.
//   · WHETHER A BLOCK THAT PROMOTES IS A GOOD BLOCK. Adjudicable is not the
//     same as well-coached, and this ledger only ever says the first.
/**
 * The distances `Research/00a`'s volume table states a beginner band for.
 * `SimDistance` also carries '100k' beyond them; anything outside this set gets
 * a NULL research allowance rather than a borrowed one.
 */
const COLD_START_DISTANCES: ReadonlySet<string> = new Set(RACE_DISTANCE_KEYS);

const ADJ_REACHED = new Map<AdjReachBranch, number>();
/** Per promotion dimension: how many archetypes it BLOCKED. Rule 22 §2 asks for
 *  the distribution, not the count, and a dimension that blocks nothing across
 *  the whole corpus is a finding whether or not it is a defect. */
const ADJ_BLOCKED_BY = new Map<string, number>();
/** Rule 22 · the PUSH / HOLD balance, printed. An engine that only ever holds
 *  is the Rule 21 disposition, and it must be visible as a number rather than
 *  hidden behind a green tick. */
const ADJ_CHOSEN = new Map<string, number>();
let ADJ_BLOCKS = 0;
let ADJ_PROMOTED = 0;
/** One worked example per blocking dimension, so the log is actionable. */
const ADJ_EXAMPLE: Record<string, string> = {};
/**
 * ADJ-STACK-1 · THE OPEN FINDING, AS A RATCHET (CLAUDE.md Rule 18 §4).
 *
 * Four archetypes compose a week that peaks in VOLUME, LONGEST RUN and STRESSOR
 * COUNT simultaneously against that runner's own rendered history, and push it.
 * `contract.ts` calls that "the week nothing in this repository was checking",
 * and `checkPromotion` blocks on it by name.
 *
 * They are all the same runner: `fromNothing` — two weeks of training, three
 * short runs a week, nothing before them. For a runner with almost no history
 * every week is a peak in all three quantities at once, so this is arguably the
 * detector meeting a runner it cannot say anything useful about rather than the
 * composer misbehaving. It is NOT waved away on that argument, because deciding
 * it needs `generate.ts`, which this file does not own, and because the same
 * shape on a runner WITH a history would be a real defect.
 *
 * Asserted EXACTLY, in both directions, so it cannot drift either way:
 *   · an archetype JOINING it  → a block that used to be adjudicable stopped
 *                                being one. Fails.
 *   · an archetype LEAVING it  → it was fixed, and the entry must be deleted
 *                                rather than left as a stale exemption.
 */
const ADJ_STACKED_PEAK_OPEN = [
  '10k/beginner/f5/m0/L0-3/goal/hist:fromNothing',
  '5k/beginner/f5/m0/L0-3/goal/hist:fromNothing',
  'half/beginner/f5/m0/L0-3/goal/hist:fromNothing',
  'marathon/beginner/f5/m0/L0-3/goal/hist:fromNothing',
];
const ADJ_STACKED_PEAK_SEEN: string[] = [];

function recordAdjudication(a: Arc, adj: CorpusAdjudication) {
  ADJ_BLOCKS++;
  for (const b of adjReachOf(adj)) ADJ_REACHED.set(b, (ADJ_REACHED.get(b) ?? 0) + 1);
  for (const t of adj.result.traces) ADJ_CHOSEN.set(t.chosen, (ADJ_CHOSEN.get(t.chosen) ?? 0) + 1);
  if (adj.result.mayPromote) { ADJ_PROMOTED++; return; }
  if (!adj.result.check.stackedStress) ADJ_STACKED_PEAK_SEEN.push(arcStr(a));
  for (const d of PROMOTION_DIMENSIONS) {
    if (adj.result.check[d]) continue;
    ADJ_BLOCKED_BY.set(d, (ADJ_BLOCKED_BY.get(d) ?? 0) + 1);
    if (!ADJ_EXAMPLE[d]) {
      const line = adj.result.blockedBecause.find((s) => s.startsWith(`${d} ·`)) ?? '(no message)';
      ADJ_EXAMPLE[d] = `${arcStr(a)} :: ${line.slice(0, 200)}`;
    }
  }
}

/** How many opening weeks the ramp walk averages over. Three, so per-day
 *  rounding in any one of them cannot dominate the comparison. */
const RAMP_WALK_WEEKS = 3;
/**
 * Day-snapping slack allowed per week on the realized walk, and where the
 * number comes from.
 *
 * `layoutWeek` computes `perEasyRaw = Math.round(remainingMi / easyCount)` and
 * then gives that SAME whole number to every easy day, so the realized week
 * moves in steps of `easyCount` miles as `remainingMi` crosses a half-mile-per-
 * easy-day boundary. These walk weeks carry four easy days, so the realized
 * total can swing +/- 2 mi for an input change of a single mile, with no
 * decision having changed at all.
 *
 * Observed on the unmodified engine at the 0.70 -> 0.72 step: the long run
 * grows by 1 mi (14.6 -> 15.0 recent long), `remainingMi` falls 30.5 -> 29.5,
 * `perEasyRaw` rounds 8 -> 7, and the week loses 4 easy miles to gain 1 long
 * one — a net 3 mi, or 1.8 mi/wk across the three opening weeks.
 *
 * THAT IS A REAL RULE 9 CANDIDATE and it is reported below rather than hidden
 * by this constant: a behavioural quantity should not move in four-mile steps
 * because a divisor rounded. It sits in `layoutWeek`, which this file does not
 * own. The tolerance is set at the ARITHMETIC bound (easyCount / 2) so the
 * check still catches anything an order of magnitude larger — a re-introduced
 * `lifted` gate moves these weeks by ~10 mi/wk, five times this.
 */
const RAMP_WALK_SNAP_MI = 2.0;
/** Anything above one day-snap is worth naming even when it is under the
 *  arithmetic bound, so the rounding steps stay visible instead of being
 *  quietly absorbed by the tolerance. */
const RAMP_WALK_NOTABLE_MI = 0.5;

/**
 * RULE 12 EXEMPTION · KNOWN-OPEN, NAMED, AND A RATCHET (CLAUDE.md Rule 18 §4).
 *
 * The easy-day floor pairs below hand the engine two otherwise-identical
 * runners whose demonstrated easy day differs by three miles. In THESE families
 * the larger number changes nothing, because `layoutWeek` computes
 * `flooredPerEasy = Math.min(effectiveFloor, perEasyBudgetCap)` — the runner's
 * own demonstrated easy day loses to whatever the week has left after the long
 * run and the quality sessions are priced. That is CLAUDE.md Rule 12 verbatim:
 * "Easy running is sized before quality, never with the remainder."
 *
 * It is a LIVE DEFECT with an owner (`_coach_sensible.test.ts`, deliberately
 * red on exactly this), so it is carried here as an honest exemption rather
 * than loosened away or silently passed. Rule 7: a claim that reveals a real
 * violation is never weakened.
 *
 * The list is asserted EXACTLY, in both directions:
 *   · a family joining it   → the floor got weaker somewhere. Fails.
 *   · a family leaving it   → Rule 12 was fixed. Fails until this entry is
 *                             deleted, which is what stops a stale exemption
 *                             from quietly making the check mean nothing.
 * `easyfloor:steady:half` is deliberately NOT here: it is the family where the
 * floor DOES bind, and it is what proves the mechanism is wired at all rather
 * than merely absent.
 */
const EASYFLOOR_RULE12_EXEMPT = [
  'easyfloor:postRaceShallow:half',
  'easyfloor:postRaceShallow:marathon',
  'easyfloor:steady:marathon',
];
const EASYFLOOR_INERT: string[] = [];

function grade(a: Arc) {
  const built = buildSimPlan(simInputsForArc(a) as any);
  // ULTRA-OUT-1 (2026-08-19) · ultra archetypes are graded on the REFUSAL, not on
  // the plan. The owner removed ultra authorship ("lets remove ultra plans and
  // training for now"), so for these the only correct outcome is a clean, honest
  // decline carrying the runner-facing reason. They stay in the matrix precisely
  // so this stays asserted: a sweep that simply dropped 50K and 100K would go
  // quiet the moment authorship re-opened by accident.
  //
  // `justRun` is deliberately NOT in scope. That archetype has no target at
  // all — the engine plans a generic consistency block off the half-marathon
  // reference, and the '50k' on the arc is a label the sweep carries, not an
  // event anyone is training for. Refusing it would deny a plan to a runner
  // who never asked for an ultra one.
  if (isUltra(a.distance) && a.goalMode !== 'justRun') {
    if (built.ok) firm(`ULTRA_AUTHORED ${a.distance}`, a);
    else if (built.reason !== ULTRA_UNSUPPORTED_REASON) {
      firm(`ULTRA_WRONG_REFUSAL: ${String(built.reason).slice(0, 40)}`, a);
    }
    return;
  }
  // And the invariant behind that check, asserted for EVERY archetype rather
  // than only the ones the matrix labels ultra: whatever the engine decided to
  // plan for, it is never an ultra distance.
  if (built.ok && catOfMi(built.raceDistanceMi) === 'ultra') {
    firm(`ULTRA_AUTHORED_VIA ${a.goalMode}/${a.distance}`, a); return;
  }
  if (!built.ok) {
    // CC2-2 · a true-zero base (bucket 0) legitimately REFUSES an aggressive or long goal (couch→marathon
    // in 18wk isn't safe) — a clean friendly refusal there is correct, not a failure. But a short BY-FEEL
    // runner must still get a gentle plan (this is what BRK-2/CC2-1 guarantee), and any non-zero base must
    // always plan.
    const zeroBase = a.weeklyMileageBucket === 0;
    const shortByFeel = (a.distance === '5k' || a.distance === '10k' || a.distance === 'half') && a.goalTimeSec == null;
    // HIST-1 · a probe arc that refuses is a failure of the probe, not a
    // graceful outcome — the family exists to be compared, and half a pair
    // compares to nothing. Recorded so the post-sweep assertion names it.
    if (a.probe) recordProbe(a, null);
    if (zeroBase && !shortByFeel) return; // graceful refusal is the correct outcome
    firm(`GEN_FAIL: ${built.reason}`.slice(0, 60), a); return;
  }

  // ── HIST-1 · the coverage ledger ─────────────────────────────────────────
  if (a.history) { recordReach(a, built); currentShape = null; }
  if (a.probe) recordProbe(a, built);

  // ── CORPUS-ADJ-1 · the ADJUDICATOR, on this archetype's real block ───────
  //
  // Every history-bearing arc, not a sample of them. The layer is pure and
  // costs a few hundred microseconds a block, and sampling would reintroduce
  // the thing being fixed: a mechanism most of the corpus cannot reach.
  if (a.history) {
    const adj = adjudicateComposedBlock({
      rendered: a.history,
      weeks: built.composed.weeks as any,
      blockStartISO: simInputsForArc(a).startDateISO,
      windowDescribed: `${a.history.shapeId} · 16 rendered weeks`,
    });
    // Null here means "no history", which this branch has already excluded, so
    // a null is a real defect in the bridge rather than a quiet skip (Rule 11).
    if (adj == null) firm('ADJ_BRIDGE_RETURNED_NULL_FOR_A_RUNNER_WITH_A_PAST', a);
    else recordAdjudication(a, adj);
  } else {
    /* ── COLD START · the corpus reaches it (2026-09-05, Rule 15) ──────────
     *
     * `RenderedHistory.peakWeeklyMi` is typed `number` and is never null, so
     * no HISTORY-BEARING archetype can be a cold start and the branch above
     * cannot reach the policy at all. The arcs with no history are the ones
     * that can, and they are the majority of the cross-product — which is
     * also the production population: six of seven active plans belong to
     * accounts with zero canonical runs.
     *
     * Before this branch existed those arcs were adjudicated by nothing.
     */
    const adj = adjudicateColdStartBlock({
      weeks: built.composed.weeks as any,
      // Rule 11 · a distance with no beginner row in the volume table gets a
      // NULL allowance, which leaves the prescription CONDITIONAL with a gate
      // rather than sized off a band that does not exist for it.
      raceDistance: COLD_START_DISTANCES.has(a.distance)
        ? (a.distance as RaceDistanceKey) : null,
      why: 'this archetype carries no rendered history at all',
    });
    recordAdjudication(a, adj);
  }

  // Grade BOTH connection states a new runner can be in: a COLD-START signup (no Strava → prod sets
  // trailingAvgWeeklyMi null, the peak-vs-trailing ramp check is skipped) AND a STRAVA-CONNECTED
  // runner (trailingAvg = their recent volume → the ramp check applies). Both must produce a valid
  // plan — a low-base runner who connects Strava must not be DENIED a plan.
  const recentWk = built.derived.recentWeeklyMi;
  for (const [conn, trailing] of [['cold', null], ['strava', recentWk > 0 ? recentWk : null]] as [string, number | null][]) {
    const ctx = { ...built.validateCtx, trailingAvgWeeklyMi: trailing };
    try { validateComposedPlan(built.composed, built.raceDistanceMi, built.mode, ctx); }
    catch (e) { if (e instanceof PlanValidationError) for (const v of e.violations) firm(`VALIDATOR[${conn}]: ${v.replace(/Week \S+/, 'Week X').replace(/\d+(\.\d+)?mi/g, 'Nmi').slice(0, 64)}`, a); else throw e; }
  }

  const cat = distanceCategoryOf(built.raceDistanceMi); // engine's actual distance (justRun → hm reference)
  // COLD-1 · grade against the SAME evidence the engine saw. `bestRecentVdotOverride` is
  // the only measured-fitness signal in the matrix, and since TIEREVIDENCE-2 it is the ONLY
  // thing that moves the row at all: `a.experienceLevel` no longer reaches the classifier,
  // so an archetype with no measured fitness is graded against `developing` whatever the
  // matrix declared for it. That is the answer key tracking the engine, which is what this
  // key exists to do — if the two resolved the tier differently every conformance assertion
  // below would be noise.
  const demonstratedPaceSec = built.derived.bestRecentVdot != null
    ? (() => { const t = predictRaceTime(built.derived.bestRecentVdot, built.raceDistanceMi); return t != null ? Math.round(t / built.raceDistanceMi) : null; })()
    : null;
  const tier = classifyGoalTier(a.goalTimeSec ? Math.round(a.goalTimeSec / built.raceDistanceMi) : null, built.raceDistanceMi, demonstratedPaceSec);
  const band = TIER_TARGETS[cat][tier];
  const recentLong = built.derived.recentLongMi;       // ENGINE-derived (post coherence-clamp)
  const recentWeekly = built.derived.recentWeeklyMi;

  const weeks = built.composed.weeks;
  const train = weeks.filter((w: any) => !w.isRaceWeek);
  const peakWk = Math.max(0, ...train.map((w: any) => w.weeklyMi));
  const longs = weeks.flatMap((w: any) => w.days.filter((d: any) => d.isLong && d.type !== 'race').map((d: any) => d.distanceMi));
  const peakLong = Math.max(0, ...longs);

  // ── FIRM research-conformance ── (band overshoot is a RACE-PREP concept; maintenance/recovery
  // hold a base-proportional long, not a band-bound one — SP-6, validated separately)
  if (built.mode === 'race-prep' && peakLong > band.peakLongMiBand[1] + 3) firm(`LONG_OVERSHOOT ${cat}/${tier} peak>${band.peakLongMiBand[1]}+3`, a);
  // overshoot only if the peak exceeds BOTH the band ceiling AND a safe ramp from the reported
  // base — a runner who genuinely reports 45mpw legitimately builds to ~base×1.15 even if their
  // experience tier's band is lower (respecting the base is correct, not over-building).
  /* TIEREVIDENCE-2 (2026-09-02) · A THIRD ESCAPE, and it is the one the block
   * bound ITSELF with.
   *
   * The two clauses below are a template band and the runner's 28-day MEAN.
   * Neither is the quantity the composer actually sized the block against once
   * a runner has history: that is `plannedPeakLoad` — their own demonstrated
   * PEAK WEEK grown by doctrine's per-cycle figure — published on the block as
   * `authored_state.tier_peak_weekly_band[1]` and spent by
   * `lib/plan/adaptive-ramp.ts` as the ceiling adaptation may never cross.
   *
   * It went from unreachable to reachable here for a mechanical reason: with
   * the self-declared experience level removed, a `hist:steady` half-marathon
   * archetype's row moves from `advanced` (band top 85, so the first clause
   * needed a 106 mi/wk peak) to `intermediate` (top 45, needing only 56.25),
   * while its demonstrated peak week legitimately licenses more than 1.20x its
   * 28-day mean. Two archetypes landed in that gap. The plan is right and the
   * grading proxy was incomplete: a block peaking at or under its OWN published
   * evidence ceiling has not overshot anything (Rule 16 · grade against the
   * quantity the engine bound itself with, not a second one that means
   * something else).
   *
   * The clause is narrow on purpose. It exempts only a peak inside the ceiling
   * the block published, so a plan that overshoots its own ceiling still fires,
   * and a block carrying no published ceiling gets no exemption at all. */
  const publishedUpper = (() => {
    const b = (built.composed.authoredState as Record<string, unknown> | undefined)?.tier_peak_weekly_band;
    return Array.isArray(b) && typeof b[1] === 'number' && b[1] > 0 ? (b[1] as number) : null;
  })();
  const insideOwnCeiling = publishedUpper != null && peakWk <= publishedUpper + 0.05;
  if (peakWk > band.peakWeeklyMileageBand[1] * 1.25 && peakWk > recentWeekly * 1.20 && !insideOwnCeiling) firm(`WK_OVERSHOOT ${cat}/${tier} peak>band×1.25 & base×1.20`, a);
  for (const w of weeks) {
    if (w.isRaceWeek) continue;
    const realized = w.days.filter((d: any) => d.type !== 'race').reduce((s: number, d: any) => s + d.distanceMi, 0);
    if (Math.abs(realized - w.weeklyMi) > 0.3) { firm('WEEKLY_NEQ_REALIZED', a); break; }
  }
  for (const w of weeks) {
    if (w.isRaceWeek || w.phase === 'TAPER') continue;
    if (w.days.every((d: any) => d.type === 'rest' || d.distanceMi === 0)) { firm(`EMPTY_WEEK ${w.phase}`, a); break; }
  }
  for (const w of weeks) {
    if (w.tPaceSec != null && (w.tPaceSec < 200 || w.tPaceSec > 1000)) { firm(`PACE_INSANE ${w.tPaceSec}`, a); break; }
  }
  // ramp: week-0 long must be ≤110% of recent (+1mi rounding) when recent is meaningful
  if (recentLong >= 6 && longs.length && longs[0] > recentLong * 1.10 + 1.0) firm('RAMP_HOT_WK1', a);

  // ── WARN (band-reaching, race-prep only — maintenance/recovery hold BELOW the band by design) ──
  if (built.mode === 'race-prep') {
    // SIM-COH-1 exemption: skip underreach checks when the archetype's inputs are inherently
    // inconsistent (weekly mileage × frequency implies an average run longer than the longest-run
    // bucket allows). These archetypes represent impossible self-reports; the engine now caps the
    // long at the bucket ceiling (correct), so the plan legitimately underreaches — that's expected
    // behaviour, not a defect. Consistent inputs still trigger underreach as before.
    const BUCKET_CEIL: Record<string, number> = { '0-3': 3, '3-6': 6, '6-10': 10, '10+': 999 };
    // SIM-COH-2 (2026-08-19) · the implied average run is over the days the
    // runner can ACTUALLY run, which is their stated frequency capped by their
    // available days — not the stated frequency alone.
    //
    // The `availableDays` archetypes are where this bit. `f5` with only Sat and
    // Sun available is a TWO-day plan; measuring its 30 mi/wk self-report over
    // five days implies a 6-mile average and looks consistent, while over the
    // two days it can be run it implies FIFTEEN miles a run and busts the very
    // '6-10' longest-run bucket the archetype also claims. That is precisely
    // the impossible self-report SIM-COH-1 was written to exempt; it was just
    // measuring against the wrong denominator to see it.
    const schedulableDays = Math.min(a.weeklyFrequency || 7, a.availableDays?.length || 7);
    const impliedAvgRun = recentWeekly / Math.max(1, schedulableDays);
    const inputsConsistent = impliedAvgRun <= (BUCKET_CEIL[a.longestRunBucket] ?? 999);
    if (inputsConsistent) {
      // The long run is a per-SESSION quantity · a plan running fewer days does
      // not get a smaller long run, so this band is compared as published.
      if (recentLong >= band.peakLongMiBand[0] && peakLong < band.peakLongMiBand[0] * 0.75) warn(`LONG_UNDERREACH ${cat}/${tier}`, a);

      /* WK-FREQ-1 (2026-08-19) · WEEKLY VOLUME IS A PER-WEEK QUANTITY, SO THE
       * BAND ONLY MEANS ANYTHING ALONGSIDE THE DAY COUNT IT WAS PUBLISHED FOR.
       *
       * Research/22 never states a peak weekly volume on its own. Every plan
       * table prints `| Days/week |` directly above `| Peak weekly volume |`:
       * 5K-Advanced is "40-70 mi" at "6-7" days, 10K-Intermediate "30-40 mi" at
       * "5". `TIER_TARGETS[cat][tier].daysPerWeek` is the engine's read of that
       * row, and generate.ts overrides it with the runner's own stated
       * frequency — deliberately, because a 3-day runner gets a 3-day plan.
       *
       * Grading that 3-day plan against a 5-day plan's weekly total asks the
       * engine to deliver five days of volume in three sessions. It cannot,
       * and it should not want to: `peakLongMiBand` caps the long run and
       * `longRunShare` caps what fraction of the week it may be, both of them
       * doctrine-gated. The engine already sits at the TOP of the long-run
       * band in every one of the archetypes this used to flag — a 5K-Advanced
       * 3-day peak week is `long 12 + intervals 7 + easy 10`, with the 12 the
       * ceiling of the published `[8, 12]`. Reaching the unscaled floor would
       * take two more runs of eleven-plus miles each, i.e. three long runs a
       * week for a 5K goal. The plan is right; the expectation was wrong.
       *
       * So the floor is scaled by the days the plan actually runs against the
       * days the band's plan runs, capped at 1 so a plan running MORE days than
       * doctrine's is never given a discount. The precondition scales too,
       * which makes the check apply to strictly MORE archetypes than before,
       * not fewer — a low-frequency runner is now graded rather than skipped. */
      const peakWeek = train.find((w: any) => w.weeklyMi === peakWk);
      const peakWeekRunDays = peakWeek
        ? peakWeek.days.filter((d: any) => d.distanceMi > 0).length
        : band.daysPerWeek;
      const dayScale = Math.min(1, peakWeekRunDays / Math.max(1, band.daysPerWeek));
      const wkFloor = band.peakWeeklyMileageBand[0] * dayScale;
      if (recentWeekly >= wkFloor && peakWk < wkFloor * 0.75) warn(`WK_UNDERREACH ${cat}/${tier}`, a);
    }
    if (a.goalTimeSec && peakLong === 0) warn('NO_LONG', a);
  }
}

// ── HIST-1 · the recorders ──────────────────────────────────────────────────

type Built = Extract<ReturnType<typeof buildSimPlan>, { ok: true }>;

/** Non-BASE, non-TAPER, non-race training weeks · where the easy-day floor and
 *  the density ramp are supposed to be doing something. BASE and TAPER are
 *  exempted by `layoutWeek` itself (`isDeloadOrBase`), so grading them would be
 *  grading the exemption. */
const gradedWeeks = (built: Built) =>
  built.composed.weeks.filter((w: any) => !w.isRaceWeek && w.phase !== 'BASE' && w.phase !== 'TAPER');

const easyMiOf = (w: any): number[] =>
  w.days.filter((d: any) => d.type === 'easy' && d.distanceMi > 0).map((d: any) => d.distanceMi);
const qualityCountOf = (w: any): number =>
  w.days.filter((d: any) => d.isQuality && d.type !== 'race').length;

/**
 * Which branch of which mechanism did this archetype actually visit?
 *
 * Read off the ENGINE's own record wherever one exists — `derived.rampBase` is
 * the `RampBaseEvidence` the composer was handed, and `authoredState
 * .derived_from` is the transparency envelope the plan persists. Reading the
 * engine's answer rather than recomputing it here is the difference between a
 * coverage ledger and a second implementation that can agree with itself while
 * both are wrong (Rule 18: "a check that hardcodes both sides only proves the
 * test agrees with itself").
 */
function recordReach(a: Arc, built: Built) {
  currentShape = a.history!.shapeId;
  const ev = built.derived.rampBase;
  const df = ((built.composed.authoredState as any)?.derived_from ?? {}) as Record<string, unknown>;

  if (ev) {
    reach('ramp:called');
    const layoff = ev.interruptionWeeks > ev.allowedInterruptionWeeks;
    if (!(ev.sustainedMi > 0)) reach('ramp:no-sustained');
    else if (layoff) reach('ramp:layoff');
    else if (ev.lifted) reach('ramp:lifted');
    else reach('ramp:not-lifted');
    if (ev.heldMi > ev.meanMi) reach('ramp:held-binds');
    if (ev.returning) {
      reach('ramp:returning');
      if (ev.heldByCurrent) reach('ramp:entry-week-spent'); else reach('ramp:entry-week-owed');
    }
    if (ev.allowedInterruptionWeeks > SHORT_LAYOFF_WEEKS) reach('ramp:race-extended-allowance');
  }

  // `baseRebuilt` is only OBSERVABLE through `sizeBlocks(…, isMidBlock &&
  // baseRebuilt)`, so it is read where it lands: whether a mid-block runner got
  // a BASE phase. A non-mid-block runner tells us nothing about it and is not
  // counted, which is why `injuryReturn` is deliberately built to still be
  // mid-block.
  if (built.mode === 'race-prep' && (built.composed.authoredState as any)?.is_mid_block === true) {
    const hasBase = built.composed.blocks.phases.some((p: any) => p.label === 'BASE');
    reach(hasBase ? 'base:deficit' : 'base:rebuilt');
  }

  // The easy-day floor · read the number the engine actually recorded being
  // handed, and cross-check it against the corpus's own statement of what this
  // runner's easy day IS, so a drift fails rather than silently making the
  // ledger describe a different runner.
  //
  // RULE8-SIM-1 (2026-08-30) · this used to call `history-shapes`' own
  // `easyMedianOf`, a SECOND 14-calendar-day derivation of a quantity
  // `sim-inputs` already owns — and the moment the engine's copy was corrected
  // to skip the prescribed taper / recovery span (Rule 8) the two disagreed on
  // 57 archetypes. That is this check working, and the answer is not to teach
  // the copy the same trick: Rule 16 says one quantity, one name. It now grades
  // against `simEasyDayMedianMi` itself, fed the arc's OWN race facts through
  // `simPrescribedSpans` and the same `startDateISO` that `simInputsForArc`
  // hands the engine. The check therefore still fires on a real regression —
  // an arc whose engine reading stops matching its own history — and can no
  // longer fire on two implementations of one idea drifting apart.
  const engineEasyMedian = typeof df['easyDayMedianMi'] === 'number' ? (df['easyDayMedianMi'] as number) : null;
  if (engineEasyMedian != null && a.history) {
    const arcInputs = simInputsForArc(a);
    const mine = a.history.easyDayMedianOverrideMi ?? simEasyDayMedianMi(
      a.history.dailyMiMostRecentFirst,
      arcInputs.startDateISO,
      simPrescribedSpans(arcInputs.startDateISO, arcInputs.lastRaceFinishedDaysAgo, arcInputs.lastRaceDistance),
    );
    if (Math.abs(mine - engineEasyMedian) > 1e-9) firm(`EASY_MEDIAN_DRIFT sim=${engineEasyMedian} corpus=${mine}`, a);
    if (engineEasyMedian > 3) reach('easy:floor-armed');
    else if (engineEasyMedian === 0) reach('easy:floor-dark');
  }

  // The density ramp · `recentQ` below both the tier's density and the
  // runner's own prefs is what makes `densityForWeek` ramp at all.
  const q = typeof df['recentQualityPerWeek'] === 'number' ? (df['recentQualityPerWeek'] as number) : null;
  if (q != null && built.mode === 'race-prep') {
    const wks = gradedWeeks(built).filter((w: any) => qualityCountOf(w) > 0);
    const first = wks.length ? qualityCountOf(wks[0]) : 0;
    const peak = wks.reduce((m: number, w: any) => Math.max(m, qualityCountOf(w)), 0);
    if (first < peak) reach('density:ramps'); else if (peak > 0) reach('density:habit-at-target');
    // QUALITYFLOOR-1 · the ramp brings quality BACK; it never removes it.
    //
    // The condition is `Math.round(q) === 0`, not `q === 0`, because that is
    // what `densityForWeek` actually computes: at week 0 `stepsUp` is 0, so
    // `ramped = Math.round(recentQ)`, and a post-marathon runner measured at
    // 0.25 sessions/week rounds to zero exactly as a runner measured at zero
    // does. Writing `q === 0` here would have let the floor's real trigger sit
    // unwatched while the ledger claimed otherwise.
    if (Math.round(q) === 0 && first >= 1) reach('density:return-floor');
    if (Math.round(q) === 0 && wks.length === 0 && built.composed.blocks.phases.some((p: any) => p.label !== 'BASE' && p.label !== 'TAPER')) {
      firm('DENSITY_ZERO_ERASED_QUALITY', a);
    }
  }
}

function recordProbe(a: Arc, built: Built | null) {
  const key = a.probe!.family;
  const rows = PROBES.get(key) ?? [];
  if (!built) {
    rows.push({ arc: a, ok: false, firstWeekMinEasyMi: 0, peakEasyMi: 0, firstQualityCount: 0, peakQualityCount: 0, openingMi: [], rampBaseMi: 0, rampNote: '' });
  } else {
    const wks = gradedWeeks(built);
    const withEasy = wks.filter((w: any) => easyMiOf(w).length > 0);
    const withQ = wks.filter((w: any) => qualityCountOf(w) > 0);
    const ev = built.derived.rampBase;
    rows.push({
      arc: a, ok: true,
      firstWeekMinEasyMi: withEasy.length ? Math.min(...easyMiOf(withEasy[0])) : 0,
      peakEasyMi: withEasy.reduce((m: number, w: any) => Math.max(m, ...easyMiOf(w)), 0),
      firstQualityCount: withQ.length ? qualityCountOf(withQ[0]) : 0,
      peakQualityCount: wks.reduce((m: number, w: any) => Math.max(m, qualityCountOf(w)), 0),
      openingMi: built.composed.weeks.slice(0, RAMP_WALK_WEEKS).map((w: any) => w.weeklyMi),
      rampBaseMi: ev?.baseMi ?? 0,
      rampNote: ev ? `base ${ev.baseMi} held ${ev.heldMi} lift:${ev.lifted ? 1 : 0} hbc:${ev.heldByCurrent ? 1 : 0}` : '-',
    });
  }
  PROBES.set(key, rows);
}

describe('ALL-USER conformance sweep', () => {
  // Composing 9294 plans takes ~2s alone and several times that when the whole
  // suite is running in parallel around it, against vitest's 5s default. A gate
  // that goes red because the machine was busy teaches people to re-run it
  // until it passes, which is how a real regression gets waved through. The
  // timeout is generous on purpose; nothing about the assertions changes.
  it('every archetype is research-conformant', () => {
    let n = 0;
    let withHist = 0;
    for (const a of matrix()) {
      // HIST-1 · BYTE-STABILITY, PINNED. `simInputsForArc` replaced a literal
      // that lived in this file and in the dosing gate. For an arc with no
      // history it must produce EXACTLY what that literal produced, or the
      // corpus has quietly become a different corpus and its 11,598 rows stop
      // being a regression net. Asserted here rather than checked once by hand,
      // because a hand-check is a claim and only a check is in force (Rule 20).
      if (!a.history) {
        expect(simInputsForArc(a), `simInputsForArc drifted from the pre-HIST-1 literal: ${arcStr(a)}`).toEqual({
          ...a, startDateISO: '2026-07-06', raceDateISO: a.raceDateISO ?? '', lastRaceFinishedDaysAgo: 0, lastRaceDistance: null,
          raceHistory: [], longRunDay: 'sun', availableDays: a.availableDays ?? [],
        } as any);
      }
      grade(a); n++; if (a.history) withHist++;
    }
    gradeProbeFamilies();
    const firmTotal = Object.values(FIRM).reduce((s, v) => s + v, 0);
    const warnTotal = Object.values(WARN).reduce((s, v) => s + v, 0);
    console.log(`\n=== SWEPT ${n} archetypes ===`);
    console.log(`FIRM failures: ${firmTotal} across ${Object.keys(FIRM).length} types`);
    for (const [k, v] of Object.entries(FIRM).sort((a, b) => b[1] - a[1])) console.log(`  [${v}] ${k}  e.g. ${examples[k]}`);
    console.log(`WARN: ${warnTotal} across ${Object.keys(WARN).length} types`);
    for (const [k, v] of Object.entries(WARN).sort((a, b) => b[1] - a[1])) console.log(`  [${v}] ${k}  e.g. ${examples[k]}`);

    // ── HIST-1 · COVERAGE, STATED AS PATHS REACHED (CLAUDE.md Rule 15) ──────
    //
    // "Treat a green sweep as evidence about what it EXERCISED, never as
    // evidence about the engine." So the sweep says what it exercised.
    const missing = REACH_BRANCHES.filter((b) => !(REACHED.get(b) ?? 0));
    console.log(`\n=== HISTORY COVERAGE · ${withHist} archetypes carry a past ===`);
    for (const b of REACH_BRANCHES) console.log(`  [${String(REACHED.get(b) ?? 0).padStart(4)}] ${b}`);
    if (missing.length) console.log(`  UNREACHED: ${missing.join(', ')}`);

    // Rule 18 §2 · assert liveness. A branch that stops being reachable fails
    // here rather than quietly reverting the corpus to runners with no past.
    // This is the assertion that would have caught the original blindness on
    // the day it was introduced.
    expect(missing, `mechanisms the corpus can no longer REACH: ${missing.join(', ')}`).toEqual([]);

    // Rule 15: "when you add a mechanism, ask which corpus case reaches it and
    // NAME THAT CASE in the test." Each shape declares its branches in
    // `history-shapes.ts`; here the declaration is checked against what the
    // shape's own arcs actually visited, so a claim cannot survive as prose.
    const shapeGaps: string[] = [];
    for (const spec of HISTORY_SHAPES) {
      const got = REACHED_BY_SHAPE.get(spec.id) ?? new Set();
      const gaps = spec.reaches.filter((b) => !got.has(b));
      if (gaps.length) shapeGaps.push(`${spec.id} claims but never reaches: ${gaps.join(', ')}`);
    }
    expect(shapeGaps, `a history shape no longer exercises what it says it does:\n  ${shapeGaps.join('\n  ')}`).toEqual([]);

    // ── CORPUS-ADJ-1 · THE ADJUDICATOR'S COVERAGE, STATED THE SAME WAY ─────
    console.log(`\n=== ADJUDICATION · ${ADJ_BLOCKS} blocks adjudicated · ${ADJ_PROMOTED} promoted, `
      + `${ADJ_BLOCKS - ADJ_PROMOTED} blocked ===`);
    for (const b of ADJ_REACH_BRANCHES) console.log(`  [${String(ADJ_REACHED.get(b) ?? 0).padStart(5)}] ${b}`);
    console.log('  --- promotion dimensions, by how many blocks each one STOPPED ---');
    for (const d of PROMOTION_DIMENSIONS) {
      const n = ADJ_BLOCKED_BY.get(d) ?? 0;
      console.log(`  [${String(n).padStart(5)}] ${d}${n > 0 ? `  e.g. ${ADJ_EXAMPLE[d]}` : ''}`);
    }
    // Rule 22 §2 · the DISTRIBUTION of what the layer chose, not just that it
    // chose something. An adjudicator that only ever holds is the disposition
    // Rule 21 measured at zero upward adaptations, and it would pass every
    // per-week check in this file.
    console.log(`  --- options chosen across every adjudicated week ---`);
    for (const [k, v] of [...ADJ_CHOSEN].sort((x, y) => y[1] - x[1])) console.log(`  [${String(v).padStart(5)}] ${k}`);

    // Rule 18 §2 · LIVENESS. The bridge running over zero blocks would report
    // clean, which is the worst outcome available because it also reports
    // confidence. This is the assertion that makes the ledger mean anything.
    expect(ADJ_BLOCKS, 'the adjudicator was reached by ZERO archetypes, which is the state '
      + 'CORPUS-ADJ-1 exists to end (Rule 15)').toBeGreaterThan(0);

    const adjMissing = ADJ_REACH_BRANCHES.filter((b) => !(ADJ_REACHED.get(b) ?? 0));
    expect(
      adjMissing,
      'adjudication branches the corpus can no longer REACH. Per Rule 15 the corpus needs the '
      + `input, not more rows: ${adjMissing.join(', ')}`,
    ).toEqual([]);

    // Rule 21, pointed at the layer itself. `rankOptions` prefers a SUPPORTED
    // push over a supported hold by construction, so a corpus in which no
    // archetype's block ever advances anywhere means either every archetype is
    // being handed a plan that never pushes, or the ranking stopped working.
    // Either is the finding this project can least afford.
    expect(ADJ_CHOSEN.get('PUSH') ?? 0, 'the adjudicator chose PUSH on ZERO of the weeks in the '
      + 'whole corpus. Rule 21: a plan whose only lever is "do less" is a safety system wearing '
      + 'a coach\'s clothes.').toBeGreaterThan(0);

    // ADJ-STACK-1 · the one open finding, asserted exactly. See the constant.
    expect(
      [...ADJ_STACKED_PEAK_SEEN].sort(),
      'archetypes whose block peaks in volume, longest run AND stressor count in one week and is '
      + 'pushed anyway. MORE than the list = a block that used to be adjudicable stopped being one. '
      + 'FEWER = it was fixed, so delete the entry rather than leaving a stale exemption.',
    ).toEqual([...ADJ_STACKED_PEAK_OPEN].sort());

    // And every OTHER dimension is asserted at zero, so a new class of failure
    // cannot hide behind the one that is known-open. This is the assertion that
    // makes the ledger a gate rather than a log.
    const unexpectedAdjBlocks = PROMOTION_DIMENSIONS
      .filter((d) => d !== 'stackedStress' && (ADJ_BLOCKED_BY.get(d) ?? 0) > 0)
      .map((d) => `${d} × ${ADJ_BLOCKED_BY.get(d)}  e.g. ${ADJ_EXAMPLE[d]}`);
    expect(
      unexpectedAdjBlocks,
      `the adjudicator refused to promote archetype blocks on a dimension with no open finding:\n  ${unexpectedAdjBlocks.join('\n  ')}`,
    ).toEqual([]);

    // THE GATE · every archetype must be research-conformant. If this fails, an engine change
    // regressed some user segment — read the FIRM list above for the exact archetypes + violations.
    expect(firmTotal, `${firmTotal} firm conformance failures across the user matrix — see log`).toBe(0);
    // The Rule 12 exemption, asserted exactly. See EASYFLOOR_RULE12_EXEMPT.
    expect(
      [...EASYFLOOR_INERT].sort(),
      'easy-day-floor families where the budget cap beats the runner\'s demonstrated easy day. '
      + 'MORE than the exempt list = the floor got weaker. FEWER = Rule 12 was fixed, so delete '
      + 'the entry rather than leaving a stale exemption.',
    ).toEqual([...EASYFLOOR_RULE12_EXEMPT].sort());
    // LAST, deliberately · if a falsifier is armed and everything above still
    // passed, the corpus failed to catch what the falsifier re-introduced, and
    // THAT is the finding worth reporting. Ordering this first would mask it
    // behind a housekeeping message.
    expect(process.env[QUALITY_INFLATION_ENV] ?? '', 'quality-inflation falsifier armed and the corpus did NOT catch it').toBe('');
  }, 60_000);
});

/**
 * HIST-1 · the assertions that need TWO runners.
 *
 * Every check above grades one archetype in isolation, which is precisely the
 * shape a discontinuity passes — both sides of a cliff are legal plans. These
 * grade a FAMILY: arcs that differ in exactly one input, compared against each
 * other. Three families, one per mechanism that cannot be seen from a single
 * row.
 */
function gradeProbeFamilies() {
  for (const [family, rows] of PROBES) {
    const bad = rows.filter((r) => !r.ok);
    if (bad.length) { for (const r of bad) firm(`PROBE_REFUSED ${family}`, r.arc); continue; }
    rows.sort((x, y) => x.arc.probe!.step - y.arc.probe!.step);

    if (family.startsWith('easyfloor:')) {
      // The pair: identical runners, one told his demonstrated easy day is 3 mi
      // longer. `layoutWeek`'s floor is monotone by construction, so a smaller
      // prescription off a bigger demonstrated easy day is Rule 9's signature
      // — the fitter runner getting the worse plan.
      const [measured, raised] = rows;
      if (raised.firstWeekMinEasyMi < measured.firstWeekMinEasyMi - 1e-9)
        firm(`EASYFLOOR_NON_MONOTONE ${family} ${measured.firstWeekMinEasyMi}→${raised.firstWeekMinEasyMi}`, raised.arc);
      // And it must actually BUY something. `easyMileFloor` was decoration for
      // all 11,598 archetypes; a floor that never moves a prescription is
      // indistinguishable from one that is not wired at all.
      if (raised.firstWeekMinEasyMi <= measured.firstWeekMinEasyMi + 1e-9
        && raised.peakEasyMi <= measured.peakEasyMi + 1e-9) {
        EASYFLOOR_INERT.push(family);
        warn(`EASYFLOOR_BUDGET_CAP_WINS ${family}`, raised.arc);
      } else reach('easy:floor-binds');
    }

    if (family.startsWith('density:')) {
      // Identical runners, one with a measured quality habit of 0 and one of 2.
      // Rule 5's ramp must open the block BELOW the habit-2 runner and climb.
      const [habit0, habit2] = rows;
      if (habit0.firstQualityCount > habit2.firstQualityCount)
        firm(`DENSITY_INVERTED ${family} 0-habit opened at ${habit0.firstQualityCount} vs ${habit2.firstQualityCount}`, habit0.arc);
      if (habit0.firstQualityCount === habit2.firstQualityCount)
        firm(`DENSITY_RAMP_INERT ${family} (a measured 0 authored the same week as a measured 2)`, habit0.arc);
      // QUALITYFLOOR-1 · never to zero. Research/00b names a day for every
      // distance on which quality comes back, and a race-prep quality week is
      // past it by construction.
      if (habit0.firstQualityCount < 1)
        firm(`DENSITY_ERASED ${family} (a measured 0 authored a build week with no hard running)`, habit0.arc);
    }

    if (family === 'rampladder') {
      // THE WALK. Nine steps of 0.02 of sustained across
      // `RAMP_BASE_RESUME_FRACTION`. The owner sat 0.003 the wrong side of this
      // line; 11,598 archetypes passed on both sides because both sides are
      // legal plans, and nothing sampled the derivative.
      //
      // MONOTONE, not smooth. `restoreSteps` is deliberately step-shaped —
      // doctrine's ladder has rungs — so the assertion is the one Rule 9
      // actually makes: running MORE never buys a SMALLER plan. Any violation
      // is the recurring signature, "the fitter runner gets the worse plan".
      //
      // Asserted on TWO quantities, because they answer different questions:
      //
      //  1. `rampBaseMi` · the DECISION. Continuous by construction since
      //     CURRENTVOL-1 (`max(liftedBase, heldMi)`), carries no day-snapping,
      //     and is asserted EXACTLY. This is the number the `lifted` cliff was
      //     computed from.
      //  2. the realized opening weeks · what the runner actually gets, which
      //     is where a re-introduced cliff would show up even if the base
      //     stayed smooth. Allowed `RAMP_WALK_SNAP_MI` per week of slack,
      //     because `layoutWeek` rounds `perEasy` to whole miles across up to
      //     five easy days and the realized total wobbles by more than a mile
      //     for reasons that are arithmetic rather than coaching. Measured on
      //     the unmodified engine the largest downward wobble is 0.83 mi/wk;
      //     re-introducing the `lifted` gate moves it by an order of magnitude.
      for (let i = 1; i < rows.length; i++) {
        const prev = rows[i - 1], cur = rows[i];
        if (cur.rampBaseMi < prev.rampBaseMi - 1e-9)
          firm(`RAMP_BASE_NON_MONOTONE ${prev.arc.probe!.id}:${prev.rampBaseMi} → ${cur.arc.probe!.id}:${cur.rampBaseMi}`, cur.arc);
        const pMean = prev.openingMi.reduce((s, v) => s + v, 0) / Math.max(1, prev.openingMi.length);
        const cMean = cur.openingMi.reduce((s, v) => s + v, 0) / Math.max(1, cur.openingMi.length);
        if (cMean < pMean - RAMP_WALK_SNAP_MI)
          firm(`RAMP_OPENING_NON_MONOTONE ${prev.arc.probe!.id}:${pMean.toFixed(1)} → ${cur.arc.probe!.id}:${cMean.toFixed(1)} mi/wk`, cur.arc);
        else if (cMean < pMean - RAMP_WALK_NOTABLE_MI)
          warn(`RAMP_OPENING_ROUNDING_STEP ${prev.arc.probe!.id}:${pMean.toFixed(1)} → ${cur.arc.probe!.id}:${cMean.toFixed(1)} mi/wk (perEasy Math.round × easyCount)`, cur.arc);
      }
      for (const r of rows) console.log(`  rampladder ${r.arc.probe!.id} · open ${r.openingMi.join('/')} · ${r.rampNote}`);
      // REPORTED, NOT FAILED · a Rule 9 candidate this walk found on its first
      // run, in `POSTRACE-RESTORE-1`'s `heldByCurrent`. It flips false→true the
      // moment `heldMi` reaches `liftedBase`, and `restoreSteps` then DROPS the
      // ladder's re-entry rung — so the opening week jumps from doctrine's 70%
      // rung straight to its 85% rung on about a mile of history. It moves
      // UPWARD, so it is not the fitter-runner-gets-less signature and this
      // gate does not fail on it, but it is a behavioural switch derived from
      // comparing two computed quantities, which Rule 9 says gets a walk.
      // `generate.ts` is not this file's to change; the finding is the report.
      let biggestJump = 0, at = '';
      for (let i = 1; i < rows.length; i++) {
        const d = (rows[i].openingMi[0] ?? 0) - (rows[i - 1].openingMi[0] ?? 0);
        if (d > biggestJump) { biggestJump = d; at = `${rows[i - 1].arc.probe!.id}→${rows[i].arc.probe!.id}`; }
      }
      console.log(`  rampladder · largest UPWARD week-0 step ${biggestJump.toFixed(1)} mi at ${at} (heldByCurrent flip · reported, see comment)`);
    }
  }
}
