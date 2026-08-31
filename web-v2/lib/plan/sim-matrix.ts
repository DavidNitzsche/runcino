/**
 * sim-matrix.ts · THE all-user archetype matrix (extracted 2026-08-28).
 *
 * This generator IS the sweep's corpus — every meaningful user archetype
 * across the full onboarding input matrix, plus the targeted arcs
 * (available-days geometry, elite tiers, PR-seeded paces) that cover the
 * rungs the cross-product alone never instantiates.
 *
 * Extracted verbatim from `_sweep_allusers.test.ts` so a second gate can
 * drive the SAME corpus without importing a test file (vitest would register
 * its describes twice) and without a copy that drifts. The sweep imports it
 * back; the two files grade different things over one matrix:
 *
 *   · `_sweep_allusers.test.ts` — research conformance (bands, ramps,
 *     validator, structure).
 *   · `_dosing_sweep_gate.test.ts` — Daniels' dosing caps (Research/01
 *     §"Dosing rules — Daniels' caps"), the measurement the owner's
 *     "measure, then enforce if clean" ruling asked for, kept as a gate.
 *
 * Do not add arcs here casually: every consumer sweeps the whole generator,
 * so a new arc is a new obligation on every gate at once. That is the point.
 *
 * ── HIST-1 (2026-08-30) · THE CORPUS HAS TWO HALVES NOW ────────────────────
 *
 * The cross-product above describes runners with no PAST. That was the whole
 * corpus until CLAUDE.md Rule 15 was locked about it: `Arc` had no history
 * fields, so `sim-inputs.ts`'s `hist` was null for all 11,598 archetypes, and
 * four doctrine mechanisms were unreachable by any of them —
 * `resolveRampBase`, `baseRebuilt`, the easy-day floor, and Rule 5's
 * quality-density ramp. Every defect that mattered on 2026-08-30 lived in
 * those four. "Adding archetypes would never have helped — the corpus cannot
 * express a runner with a history at all, and every real runner has one."
 *
 * So `historyArcs()` appends a second half whose arcs carry one. It is small
 * on purpose (Rule 15's standard is PATHS REACHED, not cases run) and it is
 * sized to reach branches rather than to multiply rows: eight `Research/`-
 * derived shapes in `./history-shapes`, four race distances, three sizes, and
 * three PROBE FAMILIES that are graded by COMPARISON because "the floor
 * binds", "the ramp ramps" and "the base moves continuously" are statements
 * about two runners and no single archetype can make them.
 *
 * The first half is unchanged and BYTE-STABLE: `simInputsForArc` produces
 * exactly the literal both gates used to inline for any arc with no history,
 * pinned by an assertion in `_sweep_allusers.test.ts`, and verified by hashing
 * every composed plan for all 11,598 across the change (identical sha256).
 */
import type { SimDistance, SimInputs } from './sim-constants';
import {
  HISTORY_SHAPES,
  renderHistory,
  inflatedQualityPerWeek,
  type HistoryShapeSpec,
  type RenderedHistory,
} from './history-shapes';

export const DISTANCES: SimDistance[] = ['5k', '10k', 'half', 'marathon', '50k', '100k'];
// COLD-1 (2026-08-17) · `null` IS the production state — `profile.experience_level` is
// NULL on real accounts and the sweep could not see it, so the rung where a typed goal
// time picked the tier by itself was never graded. Keep it first: it is the default a
// new signup lands on.
export const EXPERIENCE = [null, 'beginner', 'intermediate', 'advanced', 'advanced_plus'];
export const FREQ = [3, 4, 5, 6];
// CC2-2 (2026-06-23) · bucket 0 = true-zero base. The refuse-vs-plan boundary (where BRK-2/CC2-1 live)
// was untested — lowest fed was recentWeeklyMiFromBucket(5)=10. Split-graded in grade().
export const MILEAGE = [0, 5, 15, 25, 35, 45];
export const LONGEST = ['0-3', '3-6', '6-10', '10+'];
// representative goal times that, with the experience clamp, exercise tiers
export const GOAL_SEC: Record<SimDistance, number> = { '5k': 1350, '10k': 2700, half: 6300, marathon: 13500, '50k': 18000, '100k': 43200 };
export const WEEKS: Record<SimDistance, number> = { '5k': 10, '10k': 12, half: 14, marathon: 18, '50k': 22, '100k': 24 };

export const catOf: Record<SimDistance, '5k' | '10k' | 'hm' | 'm' | 'ultra'> = { '5k': '5k', '10k': '10k', half: 'hm', marathon: 'm', '50k': 'ultra', '100k': 'ultra' };
export const isUltra = (d: SimDistance) => catOf[d] === 'ultra';

export type Arc = {
  goalMode: 'goal' | 'justRun' | 'race'; distance: SimDistance; experienceLevel: string | null;
  weeklyFrequency: number; weeklyMileageBucket: number; longestRunBucket: string;
  goalTimeSec: number | null; planWeeks: number; raceDateISO?: string; availableDays?: string[];
  bestRecentVdotOverride?: number;
  /**
   * HIST-1 (2026-08-30, CLAUDE.md Rule 15) · THE ARCHETYPE'S PAST.
   *
   * Absent on every arc the cross-product yields, which is what keeps the
   * existing corpus byte-identical: `sim-inputs.ts` only builds `hist` when
   * `dailyMiMostRecentFirst` is present, and every anchor falls back to the
   * onboarding buckets exactly as before.
   *
   * Present, it is the whole reason four doctrine mechanisms stop being dark.
   * It is never hand-written per arc — `withHistory` renders it from a
   * `HistoryShapeSpec` so the mileage series, the quality density, the easy-day
   * median and the race behind the quiet stretch all describe ONE runner.
   */
  history?: ArcHistory;
  /**
   * HIST-1 · a label for a set of arcs that must be COMPARED rather than
   * graded one at a time. `_sweep_allusers.test.ts` collects them by
   * `id`/`step` and asserts across the family: the easy-day floor binds, the
   * density ramp ramps, and the ramp base moves continuously across
   * `RAMP_BASE_RESUME_FRACTION`. A single archetype cannot express any of
   * those, which is the second half of why the corpus was blind.
   */
  probe?: { family: string; id: string; step: number };
};

/** HIST-1 · the rendered past plus the shape it came from, so a gate can say
 *  which branches this arc was written to reach. */
export type ArcHistory = RenderedHistory & {
  shapeId: string;
  reaches: HistoryShapeSpec['reaches'];
  /** Overrides applied AFTER the render · the differential probes move exactly
   *  ONE input and hold the rest, which is what makes them falsifiers. A probe
   *  that changed two things at once could not say which one moved the plan. */
  easyDayMedianOverrideMi?: number;
  recentQualityPerWeekOverride?: number;
};

/**
 * HIST-1 · `Arc` → the exact `SimInputs` every gate over this corpus builds.
 *
 * There was one copy of this literal in `_sweep_allusers.test.ts` and another
 * in `_dosing_sweep_gate.test.ts`, whose own comment promises "exactly the
 * inputs the conformance sweep hands `buildSimPlan`, so the two gates measure
 * the same plans byte-for-byte". Both hardcoded `lastRaceFinishedDaysAgo: 0`
 * and `lastRaceDistance: null` AFTER the `...a` spread, so an arc that carries
 * a race would have been silently stripped of it in both — the two gates would
 * have gone on agreeing while both graded a runner the matrix no longer
 * describes. Rule 16: one quantity, one name.
 *
 * Byte-identical to the old literal for every history-free arc.
 */
export function simInputsForArc(a: Arc): SimInputs {
  const h = a.history;
  return {
    ...a,
    startDateISO: '2026-07-06',
    raceDateISO: a.raceDateISO ?? '',
    lastRaceFinishedDaysAgo: h?.lastRaceFinishedDaysAgo ?? 0,
    lastRaceDistance: h?.lastRaceDistance ?? null,
    ...(h?.lastRacePriority ? { lastRacePriority: h.lastRacePriority } : {}),
    raceHistory: [],
    longRunDay: 'sun',
    availableDays: a.availableDays ?? [],
    ...(h
      ? {
          dailyMiMostRecentFirst: h.dailyMiMostRecentFirst,
          // The falsifier stands where the DB reader's answer entered the
          // composer, so it overrides a probe's deliberate habit exactly as
          // the plan-version join did. Null in every normal run.
          recentQualityPerWeek: inflatedQualityPerWeek()
            ?? h.recentQualityPerWeekOverride ?? h.recentQualityPerWeek,
          recentQualityDistanceMi: h.recentQualityDistanceMi,
          isMidBlock: h.isMidBlock,
          ...(h.easyDayMedianOverrideMi != null ? { easyDayMedianMi: h.easyDayMedianOverrideMi } : {}),
        }
      : {}),
  } as unknown as SimInputs;
}

/** HIST-1 · attach a rendered history to an arc. */
export function withHistory(
  a: Arc,
  spec: HistoryShapeSpec,
  sustainedMi: number,
  extra?: Partial<Pick<ArcHistory, 'easyDayMedianOverrideMi' | 'recentQualityPerWeekOverride'>>,
): Arc {
  return {
    ...a,
    history: {
      ...renderHistory(spec, sustainedMi, a.weeklyFrequency),
      shapeId: spec.id,
      reaches: spec.reaches,
      ...(extra ?? {}),
    },
  };
}

/**
 * HIST-1 · the RAMP-BASE CONTINUITY LADDER, as a shape.
 *
 * `mean4Frac` is the 28-day mean as a fraction of the runner's sustained level
 * — the single quantity `RAMP_BASE_RESUME_FRACTION` (0.70) is compared against
 * and the one the `lifted` cliff turned on. Walking it in small steps is the
 * only way a corpus can sample the DERIVATIVE rather than sampling points on
 * either side of a cliff and finding both legal, which is exactly what 11,598
 * archetypes did.
 *
 * The tail holds FOUR weeks at 1.00 so `RAMP_BASE_SUSTAINED_RANK`'s third-
 * highest week is pinned at 1.00 for every step of the walk. Without that,
 * moving the recent weeks would move the denominator too and the walk would be
 * measuring two things at once.
 *
 * The recent-four profile sums to 4.00, so their mean is exactly `mean4Frac`,
 * and its peak (1.26 x) stays under 1.00 for every `mean4Frac` this ladder
 * uses. Shape and quality density are the post-race runner's: this is the
 * owner's own situation walked across the line he sat 0.1 mi from.
 */
export function rampLadderShape(mean4Frac: number): HistoryShapeSpec {
  const recent = [1.10, 0.90, 0.74, 1.26].map((p) => Math.round(p * mean4Frac * 1000) / 1000);
  return {
    id: `rampLadder@${mean4Frac.toFixed(2)}`,
    what: `Two weeks past an A-priority half, holding ${(mean4Frac * 100).toFixed(0)}% of sustained.`,
    cite: 'Research/22 §14 return ladder + Research/00b half-marathon recovery window',
    weekFrac: [...recent, 1.00, 1.00, 1.00, 1.00, 0.92, 0.95, 0.90, 0.94, 0.88, 0.93, 0.91, 0.96],
    weekQuality: [0, 0, 1, 2, 2, 2, 2, 2, 1, 2, 2, 2, 1, 2, 2, 2],
    race: { daysAgo: 14, distance: 'half', priority: 'A' },
    reaches: ['ramp:called', 'ramp:returning'],
  };
}

export function* matrix(): Generator<Arc> {
  for (const distance of DISTANCES)
    for (const experienceLevel of EXPERIENCE)
      for (const weeklyFrequency of FREQ)
        for (const weeklyMileageBucket of MILEAGE)
          for (const longestRunBucket of LONGEST) {
            const common = { distance, experienceLevel, weeklyFrequency, weeklyMileageBucket, longestRunBucket };
            // goal mode (race-prep) — with a goal time and by-feel
            for (const goal of [GOAL_SEC[distance], null])
              yield { ...common, goalMode: 'goal', goalTimeSec: goal, planWeeks: WEEKS[distance] };
            // just-run (maintenance / consistency block)
            yield { ...common, goalMode: 'justRun', goalTimeSec: null, planWeeks: 0 };
            // far-out race (≥26 weeks → maintenance until the build window opens)
            yield { ...common, goalMode: 'race', goalTimeSec: GOAL_SEC[distance], planWeeks: 0, raceDateISO: '2027-03-01' };
          }
  // GOAL-1 · available_days geometry (the scheduler↔validator dead-end that left a saved goal with
  // NO plan). Purely geometric, so a reduced cross over distance × constraining set × freq suffices:
  // adjacent pairs (NOQ-mode fold), tight pairs (GAP-mode downgrade), weekday-only, full-week.
  const AVAIL_SETS = [['sat', 'sun'], ['mon', 'fri'], ['sun', 'fri'], ['tue', 'thu', 'sat'], ['mon', 'tue', 'wed', 'thu', 'fri']];
  for (const distance of DISTANCES)
    for (const availableDays of AVAIL_SETS)
      for (const weeklyFrequency of [3, 5])
        yield { goalMode: 'goal', distance, experienceLevel: 'intermediate', weeklyFrequency, weeklyMileageBucket: 25, longestRunBucket: '6-10', goalTimeSec: GOAL_SEC[distance], planWeeks: WEEKS[distance], availableDays };
  // CC-5 · elite-tier coverage — the 5 elite (cat,tier) rows are otherwise never instantiated (a single
  // moderate GOAL_SEC + by-feel only reaches intermediate/advanced). Elite goal × advanced experience
  // (so the clamp doesn't fight) × high mileage so the band is reachable.
  const ELITE_GOAL: Record<SimDistance, number> = { '5k': 1000, '10k': 2050, half: 4650, marathon: 9300, '50k': 16200, '100k': 39000 };
  for (const distance of DISTANCES)
    yield { goalMode: 'goal', distance, experienceLevel: 'advanced', weeklyFrequency: 6, weeklyMileageBucket: 45, longestRunBucket: '10+', goalTimeSec: ELITE_GOAL[distance], planWeeks: WEEKS[distance] };
  // CC-4 · PR-seeded pace path (bestRecentVdotOverride) — the matrix otherwise always passes the empty
  // raceHistory, so the fitness-anchored pace path ships ungraded. A slow + a fast fitness signal: a
  // fast PR on a low base must not push peak above the safe ramp, and paces must stay sane.
  for (const distance of DISTANCES)
    for (const bestRecentVdotOverride of [38, 55])
      yield { goalMode: 'goal', distance, experienceLevel: 'intermediate', weeklyFrequency: 5, weeklyMileageBucket: 25, longestRunBucket: '6-10', goalTimeSec: GOAL_SEC[distance], planWeeks: WEEKS[distance], bestRecentVdotOverride };
  // HIST-1 (2026-08-30) · the arcs that carry a PAST. Everything above this
  // line composes byte-for-byte as it did before — `sim-inputs.ts` builds
  // `hist` only when `dailyMiMostRecentFirst` is present, and none of them
  // carry it.
  yield* historyArcs();
}

// ── HIST-1 · the history corpus ─────────────────────────────────────────────
//
// SIZED FOR BRANCHES, NOT ROWS. 11,598 x N histories is a combinatorial trap
// that makes the suite unrunnable and buys nothing: the cross-product's other
// axes (goal time, longest-run bucket, available days) do not gate any of the
// four dark mechanisms, so multiplying them through a history reaches the same
// code twice. What DOES change which branch is taken is the SHAPE of the past,
// the race behind it, the runner's size, and — for three of the four mechanisms
// — a second arc to compare against. So the corpus below is:
//
//   A · every shape x four race distances                   (branch coverage)
//   B · the two load-bearing shapes x two sizes x two day    (the easy-day floor
//       counts                                               and the MLR path)
//   C · every shape through the non-race composers           (ANCHORFIT-1's own
//                                                             stated purpose)
//   D · three PROBE FAMILIES that are graded by comparison   (the floor binds,
//                                                             the ramp ramps,
//                                                             the base moves
//                                                             continuously)
//
// The coverage argument is stated as branches reached, not as a case count, and
// `_sweep_allusers.test.ts` asserts every branch in `REACH_BRANCHES` was
// actually visited — so a change that makes one unreachable fails loudly
// instead of going quiet, which is the failure this whole corpus exists to end.

/** Race distances the history arcs sweep. Ultra is excluded on purpose: the
 *  sweep grades those on the REFUSAL, which no history can change. */
const HIST_DISTANCES: SimDistance[] = ['5k', '10k', 'half', 'marathon'];

/** Sustained weekly volumes · the level a shape's fractions are expressed
 *  against. Three sizes, because `TIER_TARGETS`, `mlrPeakMi` and the easy-day
 *  budget all behave differently at 22 mi/wk and at 55. */
const HIST_SUSTAINED = { low: 22, mid: 38, high: 55 } as const;

/**
 * The self-report a runner of this size would actually give.
 *
 * A history arc must be COHERENT with its own onboarding answers, or the
 * sweep's `inputsConsistent` exemption skips it and the arc grades nothing.
 * More importantly, an incoherent archetype produces findings that are about
 * the fixture rather than the engine — a "55 mi/wk intermediate runner with a
 * 1:45 half goal" is nobody, and grading his plan against the intermediate band
 * asks the engine to answer for a contradiction this corpus invented.
 *
 * Experience scales with volume for the same reason. `EXPERIENCE_OPTIONS`
 * calls its top rung "You follow a plan, race often, and think in phases and
 * paces", which is what fifty-five miles a week means.
 */
function selfReportFor(sustainedMi: number): { weeklyMileageBucket: number; longestRunBucket: string; experienceLevel: string } {
  if (sustainedMi < 12) return { weeklyMileageBucket: 0, longestRunBucket: '0-3', experienceLevel: 'beginner' };
  if (sustainedMi < 30) return { weeklyMileageBucket: 15, longestRunBucket: '6-10', experienceLevel: 'intermediate' };
  if (sustainedMi < 45) return { weeklyMileageBucket: 35, longestRunBucket: '10+', experienceLevel: 'intermediate' };
  return { weeklyMileageBucket: 45, longestRunBucket: '10+', experienceLevel: 'advanced' };
}

function histBase(distance: SimDistance, sustainedMi: number, weeklyFrequency: number): Arc {
  return {
    goalMode: 'goal', distance, weeklyFrequency,
    ...selfReportFor(sustainedMi),
    goalTimeSec: GOAL_SEC[distance], planWeeks: WEEKS[distance],
  };
}

function* historyArcs(): Generator<Arc> {
  // ── A · every shape x every race distance ──────────────────────────────
  for (const spec of HISTORY_SHAPES)
    for (const distance of HIST_DISTANCES) {
      const sus = HISTORY_SUSTAINED_FOR(spec.id);
      yield withHistory(histBase(distance, sus, 5), spec, sus);
    }

  // ── B · size and day-count, on the two shapes the easy-day floor lives in ──
  for (const id of ['steady', 'postRaceShallow'])
    for (const distance of ['half', 'marathon'] as SimDistance[])
      for (const size of ['low', 'high'] as const)
        for (const weeklyFrequency of [4, 6]) {
          const spec = HISTORY_SHAPES.find((s) => s.id === id)!;
          const sus = HIST_SUSTAINED[size];
          yield withHistory(histBase(distance, sus, weeklyFrequency), spec, sus);
        }

  // ── C · the non-race composers, which read `measuredPeakWeeklyMi` and
  //        `recentPeakWeeklyMi` — the two anchors ANCHORFIT-1 added and that
  //        no archetype could reach, because every one of them pinned the
  //        measured peak to the 28-day mean (the pre-DOCTRINE-4 proxy the
  //        reverse-taper defect came from). ──────────────────────────────────
  for (const spec of HISTORY_SHAPES) {
    const sus = HISTORY_SUSTAINED_FOR(spec.id);
    yield withHistory(
      { ...histBase('half', sus, 5), goalMode: 'justRun', goalTimeSec: null, planWeeks: 0 },
      spec, sus,
    );
  }
  // A real race behind a far-out goal · `pickPlanMode` routes these through
  // `composeRecoveryPlan` / `composeMaintenancePlan` with a measured peak.
  for (const id of ['postRaceShallow', 'postRaceDeep', 'racesMonthly']) {
    const spec = HISTORY_SHAPES.find((s) => s.id === id)!;
    const sus = HISTORY_SUSTAINED_FOR(id);
    yield withHistory(
      { ...histBase('marathon', sus, 5), goalMode: 'race', planWeeks: 0, raceDateISO: '2027-03-01' },
      spec, sus,
    );
  }

  // ── D1 · EASY-DAY FLOOR · a pair that differs in exactly one number ───────
  //
  // Two arcs, same history, same volume, same everything — except one is told
  // the runner's demonstrated easy day is three miles longer. The floor is
  // monotone by construction (`max(floor, raw)` then `min(…, easySep)`), so the
  // pair proves two separate things a single archetype cannot: that a longer
  // demonstrated easy day never buys a SHORTER prescription (Rule 9's "the
  // fitter runner gets the worse plan"), and that it actually buys a longer one
  // somewhere — i.e. that `easyMileFloor` is live rather than decorative, which
  // is what it was for all 11,598.
  for (const id of ['steady', 'postRaceShallow'])
    for (const distance of ['half', 'marathon'] as SimDistance[]) {
      const spec = HISTORY_SHAPES.find((s) => s.id === id)!;
      const sus = HISTORY_SUSTAINED_FOR(id);
      const base = histBase(distance, sus, 6);
      const rendered = withHistory(base, spec, sus).history!;
      const family = `easyfloor:${id}:${distance}`;
      yield { ...withHistory(base, spec, sus), probe: { family, id: 'measured', step: 0 } };
      yield {
        ...withHistory(base, spec, sus, { easyDayMedianOverrideMi: rendered.easyDayMedianMi + 3 }),
        probe: { family, id: 'raised', step: 1 },
      };
    }

  // ── D2 · QUALITY-DENSITY RAMP · the same pairing, on density ─────────────
  //
  // Rule 5's ramp had never fired for any runner whose plan had been rebuilt,
  // which was everyone, and nothing noticed because the corpus never handed it
  // a habit at all. These pairs hand it a measured 0 and a measured 2 over an
  // otherwise identical runner, so "the ramp ramps" becomes an assertion
  // instead of an assumption.
  for (const id of ['steady', 'postRaceShallow'])
    for (const distance of ['half', 'marathon'] as SimDistance[]) {
      const spec = HISTORY_SHAPES.find((s) => s.id === id)!;
      const sus = HISTORY_SUSTAINED_FOR(id);
      const base = histBase(distance, sus, 6);
      const family = `density:${id}:${distance}`;
      yield { ...withHistory(base, spec, sus, { recentQualityPerWeekOverride: 0 }), probe: { family, id: 'habit0', step: 0 } };
      yield { ...withHistory(base, spec, sus, { recentQualityPerWeekOverride: 2 }), probe: { family, id: 'habit2', step: 1 } };
    }

  // ── D3 · THE RAMP-BASE WALK · samples the derivative, not the points ─────
  //
  // Nine steps of 0.02 of sustained across `RAMP_BASE_RESUME_FRACTION`. The
  // owner sat 0.003 the wrong side of this line and it cost him his CIM build,
  // and 11,598 archetypes passed on both sides of it because both sides are
  // legal plans. Nothing sampled the derivative until this walk.
  for (let step = 0; step < 9; step++) {
    const mean4 = Math.round((0.60 + step * 0.02) * 100) / 100;
    const spec = rampLadderShape(mean4);
    const sus = HIST_SUSTAINED.high;
    yield {
      ...withHistory(histBase('marathon', sus, 6), spec, sus),
      probe: { family: 'rampladder', id: mean4.toFixed(2), step },
    };
  }
}

/** Per-shape sustained level · a racer-every-month and a post-marathon runner
 *  are not the same size, and rendering them at one number would make the
 *  corpus a set of volume variants rather than a set of runners. */
function HISTORY_SUSTAINED_FOR(id: string): number {
  switch (id) {
    // The from-nothing runner is a from-nothing runner at every distance;
    // rendering him at 38 mi/wk would make him somebody else.
    case 'fromNothing': return 8;
    case 'postRaceDeep': return HIST_SUSTAINED.high;   // a marathoner
    case 'racesMonthly': return HIST_SUSTAINED.mid;
    case 'injuryReturn': return HIST_SUSTAINED.mid;
    default: return HIST_SUSTAINED.mid;
  }
}

export const arcStr = (a: Arc) =>
  `${a.distance}/${a.experienceLevel}/f${a.weeklyFrequency}/m${a.weeklyMileageBucket}/L${a.longestRunBucket}/${a.goalTimeSec ? 'goal' : 'byfeel'}`
  + (a.history ? `/hist:${a.history.shapeId}` : '')
  + (a.probe ? `/probe:${a.probe.family}#${a.probe.id}` : '');
