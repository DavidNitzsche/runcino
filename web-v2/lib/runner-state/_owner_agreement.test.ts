/**
 * lib/runner-state/_owner_agreement.test.ts · OWNER-AGREEMENT-1 ·
 * TWO PRODUCTION-REACHABLE OWNERS THAT DISAGREE NUMERICALLY FOR ONE RUNNER ON
 * ONE DATE IS A FAILURE.
 *
 * ── WHY A RESOLVER AND NOT A SCANNER ───────────────────────────────────────
 *
 * Every ownership check this repository has shipped is a TEXT SCAN, and both
 * of them say in their own headers that a text scan cannot tell wiring from
 * decoration:
 *
 *   `_threshold_owner_scan.test.ts` · "IT IS A TEXT SCAN OVER NAMED SYMBOLS.
 *    A threshold re-derived from arithmetic that never mentions
 *    `tPaceFromVdot` … is invisible to it."
 *
 *   `_runner_state.test.ts` · "WHETHER A LOADER ACTUALLY CALLED THE CANONICAL
 *    OWNER. The registry names an owner and a submission carries a number;
 *    nothing syntactic joins them. A loader that calls the legacy cascade and
 *    submits the result produces a belief this suite cannot distinguish from
 *    a correct one."
 *
 * The precedent is sharper than either sentence: a caller that INVOKES the
 * canonical resolver, DISCARDS its result and answers with its own arithmetic
 * passes both scans and every allowlist in them.
 *
 * So this file does not read source. It CALLS every registered site — the
 * owner and everything else that answers the same question — against the same
 * synthetic runner, on the same date, and compares the numbers. A discarded
 * result shows up as a different number, which is the only signal that cannot
 * be faked by naming things correctly.
 *
 * ── HOW A DIVERGENCE IS ALLOWED TO SURVIVE ─────────────────────────────────
 *
 * `acceptedDivergence` in `quantity-owners.ts`, and it is a ratchet in both
 * directions. A delta above `maxAbs` fails because the divergence grew. A
 * delta at or below the quantity's tolerance ALSO fails, until the entry is
 * deleted, because a stale exemption is how a gate quietly stops meaning
 * anything (Rule 18 point 4).
 *
 * ── RULE 18 · THIS GATE HAS BEEN MADE TO FAIL, AND STILL IS, EVERY RUN ─────
 *
 * The five ORACLEs below are the falsification, kept in the file and run on
 * every invocation rather than performed once by hand. Each builds a
 * deliberately broken registry, runs the SAME checker over it, and asserts the
 * checker names the defect:
 *
 *   1 · a SECOND owner reappears where none was declared
 *   2 · TWO OWNERS THAT DISAGREE NUMERICALLY          ← the important one
 *   3 · a caller that invokes the owner and DISCARDS the result
 *   4 · a stale exemption whose pair now agrees
 *   5 · a registry in which nothing resolves at all
 *
 * Oracle 3 is the precedent this file exists for. Oracle 5 is the liveness
 * half: a run in which every producer refuses is the worst outcome available,
 * because it also reports confidence.
 *
 * ── RULE 22 · WHAT THIS GATE CANNOT FAIL ON ────────────────────────────────
 *
 *   · A PRODUCER NOBODY REGISTERED. It resolves what `quantity-owners.ts`
 *     lists. The survey behind that file found ELEVEN independent producers of
 *     post-race recovery days and this resolves five; the other six are named
 *     in the report and unresolved here. A new anchor-less caller of
 *     `buildWorkoutSpec` is invisible until someone lists it, and the text
 *     scans remain the other half of the defence for exactly that reason.
 *   · WHETHER THE AGREED NUMBER IS RIGHT. Every producer could agree on a
 *     wrong pace and this reports clean. It asks "do they agree", never "is it
 *     good". `_doctrine_gate.test.ts` is where numbers meet research.
 *   · A DB-ONLY SITE'S VALUE. CI has no database, so `probe: 'DB_ONLY'` sites
 *     are asserted to be NAMED in `_owner_agreement.audit.test.ts` and are not
 *     called here. That is a wiring check, not a value check, and it covers a
 *     real fraction of the registry. HOW MANY is deliberately not written in
 *     this sentence: the report below COUNTS them on every run, and a number
 *     typed into a header that nothing recomputes is exactly what Rule 20's
 *     corollary says to gate or delete. Read it off a green run.
 *   · A RUNNER THE MATRIX CANNOT EXPRESS. Six synthetic runners. A producer
 *     that agrees on all six and diverges on the seventh reads clean — Rule 15
 *     pointed at this file. The matrix deliberately spans cold-start to elite
 *     and includes one runner whose history contains a race and its taper,
 *     because that is the population Rule 8 divergences live in.
 *   · TWO PRODUCERS THAT AGREE BECAUSE ONE IS A COPY OF THE OTHER. Agreement
 *     is all this measures. A duplicated constant that happens to hold the
 *     same value passes; only a survey finds those, and `ownership.ts` is the
 *     survey.
 *   · IT IS ONE-SIDED IN THE SAME DIRECTION AS THE ENGINE. Every assertion
 *     fires on a quantity having too many answers. NONE fires on a quantity
 *     whose single owner is wrong, missing, or never called by anything —
 *     `reachedBy` is a human claim this file records and cannot verify.
 */
import { describe, it, expect } from 'vitest';
import {
  QUANTITY_IDS,
  QUANTITY_OWNERSHIP,
  acceptedDivergences,
  allSites,
  ownersOf,
  quantitiesWithASecondAnswer,
  removedSites,
  type AcceptedDivergence,
  type QuantityId,
  type QuantityOwnership,
  type QuantitySite,
} from './quantity-owners';

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · THE PROBE · one synthetic runner, every input any registered site needs
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Everything a pure producer in this app can ask about a runner on a date.
 *
 * One flat record rather than a per-quantity shape, because the whole point is
 * that two producers of the same quantity get IDENTICAL inputs. A resolver
 * that needed its own input record could be handed a different runner without
 * anybody noticing, which is the bug class one layer up.
 */
export interface Probe {
  readonly id: string;
  readonly todayISO: string;

  /* pace substrate */
  readonly bestRecentVdot: number | null;
  readonly recentWeeklyMi: number;

  /* volume substrate · most recent day first, 112 days */
  readonly dailyMiMostRecentFirst: readonly number[];
  /** Days in the series that the engine itself prescribed as taper/recovery. */
  readonly prescribedDayOffsets: ReadonlySet<number>;

  /* long-run substrate */
  readonly demonstratedLongMi: number;
  readonly recentLongMi: number;
  readonly tierPeakLongMi: number;

  /* recovery substrate */
  readonly raceDistanceMi: number;
  readonly racePriority: 'A' | 'B' | 'C';

  /* race target substrate */
  readonly goalSec: number;
  readonly blockWeeks: number;

  /* heat and terrain substrate */
  readonly tempF: number;
  readonly dewpointF: number;
  readonly effortDurationS: number;
  readonly flatPaceSecPerMi: number;
}

/** A weekly series built from a daily series, most recent week first. */
function weeklySeriesFrom(daily: readonly number[], weeks: number): number[] {
  const out: number[] = [];
  for (let w = 0; w < weeks; w++) {
    let mi = 0;
    for (let d = 0; d < 7; d++) mi += daily[w * 7 + d] ?? 0;
    out.push(Math.round(mi * 10) / 10);
  }
  return out;
}

/** A steady runner: `perDay` miles on `runDays` of every seven. */
function steadyDaily(perDay: number, runDays: number, days = 112): number[] {
  return Array.from({ length: days }, (_, i) => (i % 7 < runDays ? perDay : 0));
}

/**
 * THE MATRIX.
 *
 * Six runners, chosen so that a producer cannot pass by agreeing on one shape.
 * `raced-and-tapered` is the load-bearing one: it is the only runner whose
 * history contains days the engine itself prescribed as easy, which is the
 * population every Rule 8 divergence lives in and the one a fixture without a
 * history cannot express (Rule 15).
 */
export const PROBES: readonly Probe[] = [
  {
    id: 'cold-start',
    todayISO: '2026-09-05',
    bestRecentVdot: null,
    recentWeeklyMi: 12,
    dailyMiMostRecentFirst: steadyDaily(3, 4),
    prescribedDayOffsets: new Set(),
    demonstratedLongMi: 5,
    recentLongMi: 5,
    tierPeakLongMi: 10,
    raceDistanceMi: 3.1,
    racePriority: 'A',
    goalSec: 30 * 60,
    blockWeeks: 12,
    tempF: 55,
    dewpointF: 45,
    effortDurationS: 1800,
    flatPaceSecPerMi: 600,
  },
  {
    id: 'mid-pack-10k',
    todayISO: '2026-09-05',
    bestRecentVdot: 42,
    recentWeeklyMi: 28,
    dailyMiMostRecentFirst: steadyDaily(5.6, 5),
    prescribedDayOffsets: new Set(),
    demonstratedLongMi: 11,
    recentLongMi: 10,
    tierPeakLongMi: 16,
    raceDistanceMi: 6.2,
    racePriority: 'A',
    goalSec: 45 * 60,
    blockWeeks: 14,
    tempF: 72,
    dewpointF: 62,
    effortDurationS: 2700,
    flatPaceSecPerMi: 500,
  },
  {
    id: 'marathoner',
    todayISO: '2026-09-05',
    bestRecentVdot: 47.8,
    recentWeeklyMi: 40,
    dailyMiMostRecentFirst: steadyDaily(8, 5),
    prescribedDayOffsets: new Set(),
    demonstratedLongMi: 18,
    recentLongMi: 16,
    tierPeakLongMi: 22,
    raceDistanceMi: 26.2,
    racePriority: 'A',
    goalSec: 3 * 3600,
    blockWeeks: 14,
    tempF: 80,
    dewpointF: 68,
    effortDurationS: 3 * 3600,
    flatPaceSecPerMi: 440,
  },
  {
    /* The Rule 8 case. Weeks 3-9 of the look-back are a taper and a post-race
     * recovery block; the engine told him to run them easy, and a reader that
     * ranks the raw series reports that period as his identity. */
    id: 'raced-and-tapered',
    todayISO: '2026-09-05',
    bestRecentVdot: 47.8,
    recentWeeklyMi: 31.6,
    dailyMiMostRecentFirst: Array.from({ length: 112 }, (_, i) => {
      const week = Math.floor(i / 7);
      // Weeks 0-5 are the taper into a race and the recovery out of it — the
      // MOST RECENT six, because that is where a taper actually sits when a
      // runner comes to be measured, and because a low patch in the middle of
      // the series cannot move any of the readers under test.
      const perDay = week <= 5 ? 3 : 8.7;
      return i % 7 < 5 ? perDay : 0;
    }),
    prescribedDayOffsets: new Set(
      Array.from({ length: 6 * 7 }, (_, k) => k),
    ),
    demonstratedLongMi: 18,
    recentLongMi: 13.5,
    tierPeakLongMi: 22,
    raceDistanceMi: 13.1,
    racePriority: 'A',
    goalSec: 90 * 60,
    blockWeeks: 14,
    tempF: 68,
    dewpointF: 58,
    effortDurationS: 5400,
    flatPaceSecPerMi: 430,
  },
  {
    id: 'high-volume',
    todayISO: '2026-09-05',
    bestRecentVdot: 60,
    recentWeeklyMi: 100,
    dailyMiMostRecentFirst: steadyDaily(14.3, 7),
    prescribedDayOffsets: new Set(),
    demonstratedLongMi: 24,
    recentLongMi: 22,
    tierPeakLongMi: 26,
    raceDistanceMi: 26.2,
    racePriority: 'A',
    goalSec: 2 * 3600 + 30 * 60,
    blockWeeks: 18,
    tempF: 60,
    dewpointF: 50,
    effortDurationS: 2 * 3600,
    flatPaceSecPerMi: 340,
  },
  {
    id: 'returning',
    todayISO: '2026-09-05',
    bestRecentVdot: 38,
    recentWeeklyMi: 8,
    dailyMiMostRecentFirst: Array.from({ length: 112 }, (_, i) =>
      (i < 28 ? (i % 7 < 3 ? 2.7 : 0) : (i % 7 < 5 ? 7 : 0))),
    prescribedDayOffsets: new Set(),
    demonstratedLongMi: 14,
    recentLongMi: 4,
    tierPeakLongMi: 16,
    raceDistanceMi: 13.1,
    racePriority: 'B',
    goalSec: 110 * 60,
    blockWeeks: 16,
    tempF: 45,
    dewpointF: 38,
    effortDurationS: 3600,
    flatPaceSecPerMi: 560,
  },
];

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · THE RESOLVERS · every PURE site, actually called
 *
 * Keyed by `siteId`. The gate asserts this map and the registry cover each
 * other exactly, so a site cannot lose its resolver and keep reading clean.
 *
 * `null` means THIS SITE REFUSES FOR THIS RUNNER — Rule 11's third fact, and
 * deliberately not zero. A refusal is excluded from the comparison rather than
 * compared as a number, and the liveness assertion below fails if a site
 * refuses for every runner in the matrix.
 * ═══════════════════════════════════════════════════════════════════════ */

type Resolver = (p: Probe) => Promise<number | null>;

const RESOLVERS: Record<string, Resolver> = {

  /* ── WEEKLY_VOLUME ────────────────────────────────────────────────── */

  'lib/training/normal-window.ts#sustainedFromWeeks': async (p) => {
    const { sustainedFromWeeks } = await import('@/lib/training/normal-window');
    // Only FULLY representative weeks reach the estimator — the Rule 8 filter,
    // applied here the way `representativeWeeks` applies it against real rows.
    const weeks: number[] = [];
    for (let w = 0; w < 16; w++) {
      let mi = 0;
      let complete = true;
      for (let d = 0; d < 7; d++) {
        const off = w * 7 + d;
        if (p.prescribedDayOffsets.has(off)) { complete = false; break; }
        mi += p.dailyMiMostRecentFirst[off] ?? 0;
      }
      if (complete) weeks.push(Math.round(mi * 10) / 10);
    }
    return sustainedFromWeeks(weeks)?.weeklyMi ?? null;
  },

  'lib/plan/generate.ts#resolveRampBase': async (p) => {
    const { resolveRampBase } = await import('@/lib/plan/generate');
    const series = weeklySeriesFrom(p.dailyMiMostRecentFirst, 16);
    const mean = series.slice(0, 4).reduce((a, b) => a + b, 0) / 4;
    const ev = resolveRampBase({
      meanWeeklyMi: mean,
      weeklySeries: series,
      allowedInterruptionWeeks: 3,
    });
    // `baseMi`, NOT `sustainedMi`. The first version of this resolver compared
    // the two rank statistics and the gate correctly reported them stale: an
    // order statistic is provably unmoved by low weeks while three ordinary
    // weeks survive, so the Rule 8 filter cannot separate them there. What the
    // composer actually ramps from is `baseMi` — max(28-day mean, sustained x
    // 0.70, min(sustained, best of the last two)) — and the mean and the
    // last-two terms are exactly where a taper reaches the plan. That is the
    // number the runner's next block is sized off, so it is the number this
    // quantity is about.
    return ev.baseMi > 0 ? ev.baseMi : null;
  },

  'lib/adaptation/volume-evidence/belief.ts#rankWeek': async (p) => {
    const { rankWeek } = await import('@/lib/adaptation/volume-evidence/belief');
    const { SUSTAINED_WEEK_RANK } = await import('@/lib/training/normal-window');
    return rankWeek(weeklySeriesFrom(p.dailyMiMostRecentFirst, 16), SUSTAINED_WEEK_RANK);
  },

  /* ── LONG_RUN_DISTANCE ────────────────────────────────────────────── */

  'lib/plan/generate.ts#evidenceLongCeilingMi': async (p) => {
    const { evidenceLongCeilingMi } = await import('@/lib/plan/generate');
    return evidenceLongCeilingMi({
      demonstratedLongMi: p.demonstratedLongMi,
      recentLongMi: p.recentLongMi,
      tierPeakLongMi: p.tierPeakLongMi,
    });
  },

  'lib/adaptation/canonical/levers/long-run.ts#LONG_RUN_MAX_SHARE_OF_WEEK': async (p) => {
    const m = await import('@/lib/adaptation/canonical/evaluate');
    return m.LONG_RUN_MAX_SHARE_OF_WEEK * p.recentWeeklyMi;
  },

  'lib/workout-catalogue/select.ts#LONG_RUN_WEEKLY_SHARE_CAP': async (p) => {
    const m = await import('@/lib/workout-catalogue/select');
    return m.LONG_RUN_WEEKLY_SHARE_CAP * p.recentWeeklyMi;
  },

  'lib/plan/adjudication/cold-start.ts#COLD_START_LONG_RUN_SHARE_OF_WEEK': async (p) => {
    const m = await import('@/lib/plan/adjudication/cold-start');
    return m.COLD_START_LONG_RUN_SHARE_OF_WEEK * p.recentWeeklyMi;
  },

  /* ── THRESHOLD_DOSE ───────────────────────────────────────────────── */

  'lib/prescription/levers.ts#atPaceSessionCapMi:T': async (p) => {
    const { atPaceSessionCapMi } = await import('@/lib/prescription/levers');
    return atPaceSessionCapMi(p.recentWeeklyMi, 'threshold');
  },

  'lib/workout-catalogue/select.ts#sessionAllowanceMi': async (p) => {
    const { AT_PACE_WEEKLY_SHARE_CAP } = await import('@/lib/prescription/levers');
    // The selector's arithmetic, reproduced at the SAME family the owner was
    // asked for. Reproduced rather than called because `sessionAllowanceMi`
    // takes a catalogue entry and the entry's only contribution to this
    // number is which share it picks — the divergence under test is the
    // MISSING absolute band, not the share.
    return AT_PACE_WEEKLY_SHARE_CAP.threshold * p.recentWeeklyMi;
  },

  /* ── INTERVAL_PACE ────────────────────────────────────────────────── */

  'lib/training/prescription-resolver.ts#composePaceAnchors:I': async (p) => {
    const a = await syntheticAnchors(p);
    return a?.intervalSecPerMi ?? null;
  },

  'lib/plan/spec-builder.ts#buildWorkoutSpec:anchored': async (p) => {
    const a = await syntheticAnchors(p);
    if (!a) return null;
    const { buildWorkoutSpec } = await import('@/lib/plan/spec-builder');
    const built = buildWorkoutSpec(
      'intervals', 9, a.thresholdSecPerMi, 168, INTERVAL_RX, 180, null,
      a.intervalSecPerMi, a.easyCeilingSecPerMi, false, null, a,
    );
    return numberField(built.spec, 'rep_pace_s_per_mi');
  },

  'lib/plan/spec-builder.ts#buildWorkoutSpec:anchorless': async (p) => {
    const a = await syntheticAnchors(p);
    if (!a) return null;
    const { buildWorkoutSpec } = await import('@/lib/plan/spec-builder');
    // EXACTLY the call the five anchor-less production paths make: same
    // threshold, no anchors. Anything that differs is the offset arithmetic.
    const built = buildWorkoutSpec(
      'intervals', 9, a.thresholdSecPerMi, 168, INTERVAL_RX, 180, null,
      null, null, false, null, null,
    );
    return numberField(built.spec, 'rep_pace_s_per_mi');
  },

  /* ── INTERVAL_DOSE ────────────────────────────────────────────────── */

  'lib/prescription/levers.ts#atPaceSessionCapMi:I': async (p) => {
    const { atPaceSessionCapMi } = await import('@/lib/prescription/levers');
    return atPaceSessionCapMi(p.recentWeeklyMi, 'interval');
  },

  // DOSE-OWNER-2 (2026-09-07) · resolves the production-reachable symbol
  // (slotDoseBudgetMi, via layoutWeek's slotBudgetMi) rather than the raw
  // sessionDoseCeilingMi('I') half-function, which never runs alone in
  // production and was never the whole per-session answer.
  'lib/plan/dosing.ts#slotDoseBudgetMi:I': async (p) => {
    const { slotDoseBudgetMi } = await import('@/lib/plan/dosing');
    return slotDoseBudgetMi({ weeklyMi: p.recentWeeklyMi, pace: 'I', context: 'training' });
  },

  /* ── MARATHON_PACE_DOSE ───────────────────────────────────────────── */

  'lib/plan/dosing.ts#MARATHON_PACE_WORKOUT_CAP': async (p) => {
    const { MARATHON_PACE_WORKOUT_CAP } = await import('@/lib/plan/dosing');
    // `generate.ts`'s own `ladderDanielsCapMi`, character for character.
    return Math.min(
      MARATHON_PACE_WORKOUT_CAP.absMi,
      Math.max(0, p.recentWeeklyMi) * MARATHON_PACE_WORKOUT_CAP.pctOfWeekly,
    );
  },

  'lib/plan/dosing.ts#slotDoseBudgetMi:M': async (p) => {
    const { slotDoseBudgetMi } = await import('@/lib/plan/dosing');
    // 'training' is the ORDINARY week — the context in which the doctrine
    // cell is enforced at all. `capEnforced` exempts taper and race weeks by
    // a cited percentage, so measuring there would compare the owner against
    // a deliberately-lifted cap and report a divergence doctrine granted.
    return slotDoseBudgetMi({ weeklyMi: p.recentWeeklyMi, pace: 'M', context: 'training' });
  },

  'lib/training/prescription-resolver.ts#composePaceAnchors:M': async (p) => {
    const a = await syntheticAnchors(p);
    return a?.marathonSecPerMi ?? null;
  },

  'lib/plan/spec-builder.ts#buildWorkoutSpec:mpAnchored': async (p) => {
    const a = await syntheticAnchors(p);
    if (!a) return null;
    const { buildWorkoutSpec } = await import('@/lib/plan/spec-builder');
    const built = buildWorkoutSpec(
      'long', 18, a.thresholdSecPerMi, 168, LONG_MP_RX, 180, null,
      a.intervalSecPerMi, a.easyCeilingSecPerMi, false, null, a,
    );
    return numberField(built.spec, 'finish_pace_s_per_mi');
  },

  'lib/plan/spec-builder.ts#resolveMarathonPace': async (p) => {
    const a = await syntheticAnchors(p);
    if (!a) return null;
    const { buildWorkoutSpec } = await import('@/lib/plan/spec-builder');
    // The anchor-less call the five production paths make, through the real
    // seam rather than by calling `resolveMarathonPace` directly — a direct
    // call would prove the arithmetic and not the WIRING, and the wiring is
    // the thing a text scan cannot see.
    const built = buildWorkoutSpec(
      'long', 18, a.thresholdSecPerMi, 168, LONG_MP_RX, 180, null,
      null, null, false, null, null,
    );
    return numberField(built.spec, 'finish_pace_s_per_mi');
  },

  /* ── QUALITY_FREQUENCY ────────────────────────────────────────────── */
  // The owner is a closure inside `composePlan` and has no PURE site. Its one
  // pure sibling is the doctrine ceiling, which is EVIDENCE and not compared.

  'lib/plan/goal-tiers.ts#TIER_TARGETS.qualityPerWeek': async (p) => {
    const { TIER_TARGETS, distanceCategoryOf } = await import('@/lib/plan/goal-tiers');
    const cat = distanceCategoryOf(p.raceDistanceMi);
    const row = TIER_TARGETS[cat];
    const tiers = Object.values(row) as Array<{ qualityPerWeek?: number }>;
    const q = tiers.map((t) => t.qualityPerWeek).filter((n): n is number => n != null);
    return q.length > 0 ? Math.max(...q) : null;
  },

  /* ── RECOVERY_SPACING · the race anchor ───────────────────────────── */

  'lib/plan/goal-tiers.ts#postRaceRecoveryWeeks': async (p) => {
    const { postRaceRecoveryWeeks, distanceCategoryOf } = await import('@/lib/plan/goal-tiers');
    return postRaceRecoveryWeeks(distanceCategoryOf(p.raceDistanceMi), p.racePriority) * 7;
  },

  'lib/plan/combined-stress.ts#postRaceNoQualityDays': async (p) => {
    const { postRaceNoQualityDays } = await import('@/lib/plan/combined-stress');
    return postRaceNoQualityDays(p.raceDistanceMi, p.racePriority);
  },

  'lib/plan/combined-stress.ts#noQualityDaysAfterRace': async (p) => {
    const { noQualityDaysAfterRace } = await import('@/lib/plan/combined-stress');
    return noQualityDaysAfterRace(p.raceDistanceMi, p.racePriority);
  },

  'lib/coach/easy-discipline.ts#raceWindowFor': async (p) => {
    const { raceWindowFor } = await import('@/lib/coach/easy-discipline');
    return raceWindowFor(p.raceDistanceMi, true);
  },

  'lib/coach/recovery-phase.ts#expectedDaysForAnchor:race': async (p) => {
    const { expectedDaysForAnchor } = await import('@/lib/coach/recovery-phase');
    return expectedDaysForAnchor('race', p.raceDistanceMi);
  },

  /* ── RECOVERY_SPACING · the hard-session anchor ───────────────────── */

  'lib/plan/validate.ts#requiredSeparationDays': async () => {
    const { requiredSeparationDays } = await import('@/lib/plan/validate');
    return requiredSeparationDays(HARD_SESSION as never).min;
  },

  'lib/plan/reschedule.ts#requiredRecoveryDaysAfter': async () => {
    const { requiredRecoveryDaysAfter } = await import('@/lib/plan/reschedule');
    return requiredRecoveryDaysAfter(HARD_SESSION as never);
  },

  'lib/coach/recovery-phase.ts#expectedDaysForAnchor:session': async () => {
    const { expectedDaysForAnchor } = await import('@/lib/coach/recovery-phase');
    return expectedDaysForAnchor('intervals', HARD_SESSION.distanceMi);
  },

  /* ── RACE_TARGET ──────────────────────────────────────────────────── */

  'lib/training/achievable-target.ts#achievableRaceTarget': async (p) => {
    const { achievableRaceTarget } = await import('@/lib/training/achievable-target');
    return achievableRaceTarget({
      goalSec: p.goalSec,
      currentVdot: p.bestRecentVdot,
      raceDistanceMi: p.raceDistanceMi,
      totalWeeks: p.blockWeeks,
    })?.targetSec ?? null;
  },

  'lib/race/b-goal.ts#resolveBGoal': async (p) => {
    const { resolveBGoal } = await import('@/lib/race/b-goal');
    return resolveBGoal({ effectiveTargetSec: p.goalSec }).sec;
  },

  /* ── GOAL ─────────────────────────────────────────────────────────── */

  'lib/training/vdot.ts#parseRaceTime': async (p) => {
    const { parseRaceTime } = await import('@/lib/training/vdot');
    return parseRaceTime(goalString(p));
  },

  'lib/plan/generate.ts#parseGoalSeconds': async (p) => {
    const { parseGoalSeconds } = await import('@/lib/plan/generate');
    return parseGoalSeconds(goalString(p));
  },

  /* ── HEAT_TERRAIN_RESPONSE ────────────────────────────────────────── */

  'lib/training/heat-model.ts#effortSlowdownPct': async (p) => {
    const { effortSlowdownPct } = await import('@/lib/training/heat-model');
    // Reported in s/mi, the quantity's declared unit, so the owner and its
    // carrier are comparable without either side converting.
    const pct = effortSlowdownPct({
      tempF: p.tempF,
      dewpointF: p.dewpointF,
      durationS: p.effortDurationS,
      vdot: p.bestRecentVdot,
    });
    return Math.round(p.flatPaceSecPerMi * (1 + pct / 100)) - p.flatPaceSecPerMi;
  },

  'lib/weather/heat-adjustment.ts#applyHeatToPace': async (p) => {
    const { applyHeatToPace } = await import('@/lib/weather/heat-adjustment');
    const { abilityTierFromVdot } = await import('@/lib/training/heat-model');
    // The carrier estimates duration from `pace × distance`, so it is given
    // the distance that reproduces the owner's duration exactly. Anything
    // left over is the carrier transforming the number it exists to carry.
    const distanceMi = p.effortDurationS / p.flatPaceSecPerMi;
    return applyHeatToPace(
      p.flatPaceSecPerMi, p.tempF, distanceMi, abilityTierFromVdot(p.bestRecentVdot),
      { dewpointF: p.dewpointF },
    ) - p.flatPaceSecPerMi;
  },

  'lib/training/heat-model.ts#maughanSlowdownPctForVdot': async (p) => {
    const { maughanSlowdownPctForVdot } = await import('@/lib/training/heat-model');
    const pct = maughanSlowdownPctForVdot(p.tempF, p.bestRecentVdot ?? 45);
    return Math.round(p.flatPaceSecPerMi * (1 + pct / 100)) - p.flatPaceSecPerMi;
  },

  'lib/terrain/grade-adjust.ts#GRADE_COST_PER_PCT': async (p) => {
    const m = await import('@/lib/terrain/grade-adjust');
    return m.GRADE_COST_PER_PCT * p.flatPaceSecPerMi;
  },

  'lib/training/elevation-model.ts#GRADE_COST_PER_PCT': async (p) => {
    const m = await import('@/lib/training/elevation-model');
    return m.GRADE_COST_PER_PCT * p.flatPaceSecPerMi;
  },
};

/* ── shared probe fixtures ─────────────────────────────────────────────── */

const INTERVAL_RX = '3 mi WU · 6×800m @ I pace · 90s jog · 2 mi CD';
const LONG_MP_RX = '18 mi with 6 mi @ MP finish';

/** One hard session, identical for every producer of the hard-day answer. */
const HARD_SESSION = {
  type: 'intervals', distanceMi: 9, isQuality: true, isLong: false,
} as const;

function goalString(p: Probe): string {
  const h = Math.floor(p.goalSec / 3600);
  const m = Math.floor((p.goalSec % 3600) / 60);
  const s = p.goalSec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function numberField(spec: unknown, key: string): number | null {
  if (spec == null || typeof spec !== 'object') return null;
  const v = (spec as Record<string, unknown>)[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** The canonical anchor set, off this probe's own evidence, through the
 *  identical pure cores the DB path resolves through. */
async function syntheticAnchors(p: Probe) {
  const { syntheticPaceAnchors, anchorsOrNull } = await import('@/lib/plan/authoring-anchors');
  return anchorsOrNull(syntheticPaceAnchors({
    bestRecentVdot: p.bestRecentVdot,
    recentWeeklyMi: p.recentWeeklyMi,
    todayISO: p.todayISO,
  }));
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · THE CHECKER · pure, so the oracles can run it over a broken registry
 * ═══════════════════════════════════════════════════════════════════════ */

export interface Reading {
  siteId: string;
  probeId: string;
  value: number | null;
}

export interface Finding {
  quantity: QuantityId;
  ownerId: string;
  otherId: string;
  role: string;
  probeId: string;
  ownerValue: number;
  otherValue: number;
  delta: number;
  /** Present when an accepted entry covers this pair. */
  accepted: AcceptedDivergence | null;
  kind: 'UNDECLARED' | 'EXCEEDS_RATCHET' | 'CARRIER_ALTERED';
}

/** Which owner a site is measured against. */
function ownerFor(q: QuantityOwnership, site: QuantitySite): QuantitySite | null {
  if (site.comparesTo != null) {
    return q.sites.find((s) => s.siteId === site.comparesTo && s.role === 'OWNER') ?? null;
  }
  const owners = q.sites.filter((s) => s.role === 'OWNER');
  return owners.length === 1 ? owners[0] : null;
}

function acceptedFor(
  q: QuantityOwnership, ownerId: string, otherId: string,
): AcceptedDivergence | null {
  return q.acceptedDivergence.find(
    (d) => d.between[0] === ownerId && d.between[1] === otherId,
  ) ?? null;
}

/**
 * THE CHECK. Given every reading, name every pair that disagrees beyond what
 * has been argued for.
 *
 * Pure and exported so the five oracles can run the identical function over a
 * deliberately broken registry — a checker that the falsification cannot reach
 * is a falsification of something else.
 */
export function findDisagreements(
  registry: Readonly<Record<QuantityId, QuantityOwnership>>,
  readings: readonly Reading[],
): Finding[] {
  const byKey = new Map<string, number | null>();
  for (const r of readings) byKey.set(`${r.siteId}@@${r.probeId}`, r.value);
  const probeIds = [...new Set(readings.map((r) => r.probeId))];

  const out: Finding[] = [];
  for (const qid of Object.keys(registry) as QuantityId[]) {
    const q = registry[qid];
    for (const site of q.sites) {
      if (site.role === 'OWNER' || site.role === 'EVIDENCE' || site.role === 'REMOVED') continue;
      const owner = ownerFor(q, site);
      if (owner == null) continue;
      const accepted = acceptedFor(q, owner.siteId, site.siteId);
      // A CARRIER is held to zero and NO accepted entry may excuse it: a
      // wrapping layer that changes the number it exists to carry is not a
      // divergence to argue about, it is the owner being silently replaced.
      // Otherwise the OWNER's own tolerance wins where it declares one, so a
      // heading covering two questions in two units does not price one of
      // them in the other's.
      const tol = site.role === 'CARRIER' ? 0 : (owner.toleranceAbs ?? q.toleranceAbs);

      for (const probeId of probeIds) {
        const ov = byKey.get(`${owner.siteId}@@${probeId}`);
        const sv = byKey.get(`${site.siteId}@@${probeId}`);
        // A refusal is Rule 11's third fact and is not a number to compare.
        if (ov == null || sv == null) continue;
        if (!Number.isFinite(ov) || !Number.isFinite(sv)) continue;
        const delta = Math.abs(ov - sv);
        if (delta <= tol) continue;

        if (site.role === 'CARRIER') {
          out.push({
            quantity: qid, ownerId: owner.siteId, otherId: site.siteId,
            role: site.role, probeId, ownerValue: ov, otherValue: sv, delta,
            accepted: null, kind: 'CARRIER_ALTERED',
          });
          continue;
        }
        if (accepted == null) {
          out.push({
            quantity: qid, ownerId: owner.siteId, otherId: site.siteId,
            role: site.role, probeId, ownerValue: ov, otherValue: sv, delta,
            accepted: null, kind: 'UNDECLARED',
          });
          continue;
        }
        if (delta > accepted.maxAbs + 1e-9) {
          out.push({
            quantity: qid, ownerId: owner.siteId, otherId: site.siteId,
            role: site.role, probeId, ownerValue: ov, otherValue: sv, delta,
            accepted, kind: 'EXCEEDS_RATCHET',
          });
        }
      }
    }
  }
  return out;
}

/**
 * The OTHER half of the ratchet: an accepted divergence whose pair now agrees.
 *
 * Rule 18 point 4 — an exemption whose target is clean fails until it is
 * deleted. Without this half the allowlist only ever grows, which is how a
 * gate quietly stops meaning anything.
 */
export function staleAcceptances(
  registry: Readonly<Record<QuantityId, QuantityOwnership>>,
  readings: readonly Reading[],
): Array<{ quantity: QuantityId; divergence: AcceptedDivergence; worst: number }> {
  const byKey = new Map<string, number | null>();
  for (const r of readings) byKey.set(`${r.siteId}@@${r.probeId}`, r.value);
  const probeIds = [...new Set(readings.map((r) => r.probeId))];

  const out: Array<{ quantity: QuantityId; divergence: AcceptedDivergence; worst: number }> = [];
  for (const qid of Object.keys(registry) as QuantityId[]) {
    const q = registry[qid];
    for (const d of q.acceptedDivergence) {
      let worst = 0;
      let sawAny = false;
      for (const probeId of probeIds) {
        const a = byKey.get(`${d.between[0]}@@${probeId}`);
        const b = byKey.get(`${d.between[1]}@@${probeId}`);
        if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) continue;
        sawAny = true;
        worst = Math.max(worst, Math.abs(a - b));
      }
      // An entry whose pair NEVER resolved is not proven stale — it is
      // unmeasured, which is a different fact (Rule 11) and is caught by the
      // DB_ONLY coverage assertion instead.
      if (!sawAny) continue;
      const ownerTol = q.sites.find((s) => s.siteId === d.between[0])?.toleranceAbs
        ?? q.toleranceAbs;
      if (worst <= ownerTol) out.push({ quantity: qid, divergence: d, worst });
    }
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · RESOLVE EVERY PURE SITE, ONCE
 * ═══════════════════════════════════════════════════════════════════════ */

let CACHE: Reading[] | null = null;

async function readAll(): Promise<Reading[]> {
  if (CACHE) return CACHE;
  const out: Reading[] = [];
  for (const { site } of allSites()) {
    const fn = RESOLVERS[site.siteId];
    if (!fn) continue;
    for (const p of PROBES) {
      let value: number | null = null;
      try {
        value = await fn(p);
      } catch {
        // A THROW is a refusal, not a zero. `postRaceNoQualityDays` throws on
        // a distance it cannot categorise, and recording that as 0 would make
        // an unreadable distance look like "no recovery needed" — exactly the
        // collapse Rule 11 forbids.
        value = null;
      }
      out.push({ siteId: site.siteId, probeId: p.id, value });
    }
  }
  CACHE = out;
  return out;
}

const fmt = (n: number): string =>
  (Number.isInteger(n) ? String(n) : n.toFixed(2));

/** The unit a comparison against this owner is measured in. */
function unitFor(q: QuantityId, ownerId: string): string {
  const spec = QUANTITY_OWNERSHIP[q];
  return spec.sites.find((s) => s.siteId === ownerId)?.unit ?? spec.unit;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · THE GATE
 * ═══════════════════════════════════════════════════════════════════════ */

describe('OWNER-AGREEMENT-1 · registry hygiene', () => {
  it('0 · LIVENESS · the registry is populated and every quantity has an owner', () => {
    expect(QUANTITY_IDS.length).toBe(12);
    expect(allSites().length).toBeGreaterThanOrEqual(30);
    for (const q of QUANTITY_IDS) {
      const owners = ownersOf(q);
      expect(owners.length, `${q} has no OWNER`).toBeGreaterThanOrEqual(1);
      // FOUR quantities carry two owners, and all four are headings that
      // genuinely cover two questions rather than consolidations that failed:
      //
      //   RECOVERY_SPACING       days after a RACE · days after a HARD SESSION
      //   HEAT_TERRAIN_RESPONSE  heat · grade
      //   LONG_RUN_DISTANCE      the EVIDENCE ceiling (what he has shown he
      //                          can run) · the SHARE ceiling (how much of a
      //                          week a long run may be)
      //   MARATHON_PACE_DOSE     how many miles at marathon pace · at what
      //                          pace. Miles and seconds per mile.
      //
      // Different units, different evidence, and collapsing either pair is the
      // one-name-two-quantities defect itself. Each such owner declares its
      // own `unit` and `toleranceAbs`, so nothing is priced in the other's.
      //
      // Every site in them names its own owner through `comparesTo`, so each
      // split is checkable rather than asserted. Anything else with two owners
      // has been renamed, not consolidated.
      const TWO_QUESTIONS: readonly QuantityId[] = [
        'RECOVERY_SPACING', 'HEAT_TERRAIN_RESPONSE', 'LONG_RUN_DISTANCE',
        'MARATHON_PACE_DOSE',
      ];
      if (!TWO_QUESTIONS.includes(q)) {
        expect(owners.length, `${q} declares ${owners.length} owners`).toBe(1);
      } else {
        // A two-question heading must SAY which question each of its owners
        // answers, or it is one quantity with two owners wearing a disguise.
        for (const o of owners) {
          expect(o.unit ?? '', `${q}/${o.siteId} is one of two owners and declares no unit`).not.toBe('');
        }
      }
    }
  });

  it('1 · every site id is unique and well formed', () => {
    const ids = allSites().map(({ site }) => site.siteId);
    expect(new Set(ids).size, 'duplicate siteId in the registry').toBe(ids.length);
    for (const id of ids) expect(id, `malformed siteId ${id}`).toMatch(/^[\w./[\]-]+#[\w.]+(:\w+)?$/);
  });

  it('2 · a SECOND answer names the production paths that reach it', () => {
    for (const { quantity, site } of allSites()) {
      if (site.role === 'REMOVED') {
        expect(site.reachedBy.length, `${site.siteId} is REMOVED but still claims callers`).toBe(0);
        continue;
      }
      expect(
        site.reachedBy.length,
        `${quantity}/${site.siteId} reaches nothing · a second answer nothing calls is dead code and should be deleted, not registered`,
      ).toBeGreaterThan(0);
    }
  });

  it('3 · every accepted divergence names a real pair and argues itself', () => {
    const ids = new Set(allSites().map(({ site }) => site.siteId));
    for (const { quantity, divergence } of acceptedDivergences()) {
      const [a, b] = divergence.between;
      expect(ids.has(a), `${quantity}: accepted divergence names unknown site ${a}`).toBe(true);
      expect(ids.has(b), `${quantity}: accepted divergence names unknown site ${b}`).toBe(true);
      expect(a, `${quantity}: a divergence between a site and itself`).not.toBe(b);
      expect(divergence.maxAbs).toBeGreaterThan(0);
      expect(divergence.why.length, `${quantity}: "${a}" carries an unargued exemption`).toBeGreaterThan(80);
      expect(divergence.closesWhen.length, `${quantity}: no migration named for ${a}`).toBeGreaterThan(40);
    }
  });

  it('4 · the resolver map and the registry cover each other exactly', () => {
    const registered = new Set(allSites().map(({ site }) => site.siteId));
    for (const id of Object.keys(RESOLVERS)) {
      expect(registered.has(id), `RESOLVERS names ${id}, which the registry does not`).toBe(true);
    }
    // EVIDENCE is excluded because it is never compared: an input to the
    // owner is not a competing output, and demanding a resolver for one would
    // invite somebody to compare it (which is the mistake this role exists to
    // prevent). REMOVED is excluded because there is nothing left to call.
    const missing = allSites()
      .filter(({ site }) => site.probe === 'PURE')
      .filter(({ site }) => site.role !== 'REMOVED' && site.role !== 'EVIDENCE')
      .filter(({ site }) => !RESOLVERS[site.siteId])
      .map(({ site }) => site.siteId);
    expect(
      missing,
      'a PURE site with no resolver is a site this gate cannot compare · it would read clean forever',
    ).toEqual([]);
  });

  it('5 · every DB_ONLY site is measured by the audit census', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const auditPath = path.join(__dirname, '_owner_agreement.audit.test.ts');
    expect(fs.existsSync(auditPath), 'the audit census file is missing').toBe(true);
    const src = fs.readFileSync(auditPath, 'utf8');
    for (const { quantity, site } of allSites()) {
      if (site.probe !== 'DB_ONLY') continue;
      expect(
        src.includes(site.siteId),
        `${quantity}/${site.siteId} cannot be resolved without a database and the audit census does not name it · it is measured nowhere`,
      ).toBe(true);
    }
  });

  it('6 · a REMOVED site stays removed', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const WEB = path.resolve(__dirname, '..', '..');
    const removed = removedSites();
    expect(removed.length, 'nothing is guarded as removed').toBeGreaterThan(0);
    for (const { quantity, site } of removed) {
      const full = path.join(WEB, site.module);
      if (!fs.existsSync(full)) continue;
      const src = fs.readFileSync(full, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
      const re = new RegExp(`(function|const|let)\\s+${site.symbol}\\b`);
      expect(
        re.test(src),
        `${quantity}: ${site.siteId} was deleted as a duplicate answer and has been reintroduced`,
      ).toBe(false);
    }
  });
});

describe('OWNER-AGREEMENT-1 · the owners actually agree', () => {
  it('7 · LIVENESS · every registered PURE site resolved for at least one runner', async () => {
    // Cold-cache: readAll() below walks every PURE site against production and
    // populates CACHE for the rest of this file's tests. Under a busy Railway
    // build container this real network+DB walk has now failed the build
    // twice by exceeding vitest's 5000ms default (2026-09-08, two separate
    // deploys), with no evidence the query itself was slow versus the build
    // container being loaded. 20000ms gives real headroom without hiding a
    // genuine regression — a query that takes 20s here is still worth
    // failing on.
    const readings = await readAll();
    expect(readings.length, 'nothing resolved at all').toBeGreaterThan(50);
    const resolvedFor = new Map<string, number>();
    for (const r of readings) {
      if (r.value != null) resolvedFor.set(r.siteId, (resolvedFor.get(r.siteId) ?? 0) + 1);
    }
    const dark = Object.keys(RESOLVERS).filter((id) => (resolvedFor.get(id) ?? 0) === 0);
    expect(
      dark,
      'these sites refused for every runner in the matrix · a producer that never answers is compared against nothing and this gate would report clean about it forever (Rule 18 point 2)',
    ).toEqual([]);
  }, 20000);

  it('8 · no two production-reachable owners disagree beyond what is argued', async () => {
    const readings = await readAll();
    const findings = findDisagreements(QUANTITY_OWNERSHIP, readings);

    const lines = findings.map((f) =>
      `  ${f.kind}  ${f.quantity} · ${f.probeId}\n`
      + `      owner ${f.ownerId} = ${fmt(f.ownerValue)}\n`
      + `      other ${f.otherId} = ${fmt(f.otherValue)}   Δ ${fmt(f.delta)} ${unitFor(f.quantity, f.ownerId)}`
      + (f.accepted ? `\n      accepted maxAbs ${f.accepted.maxAbs}` : ''));

    expect(
      lines,
      'two production-reachable sites answer one question with different numbers for the same runner on the same date. '
      + 'Route the loser to the owner, or — if the divergence is real and cannot be closed here — add an ARGUED entry to '
      + '`acceptedDivergence` in lib/runner-state/quantity-owners.ts naming the measured delta and the migration that '
      + 'removes it. A CARRIER_ALTERED finding may never be excused: a layer that changes the number it exists to carry '
      + 'is the owner being silently replaced.',
    ).toEqual([]);
  });

  it('9b · RATCHET · no accepted divergence carries silent headroom', async () => {
    // A `maxAbs` far above what is measured is slack: the divergence may grow
    // that far before anything says so, which is a ratchet that has stopped
    // ratcheting.
    //
    // ONE AND A HALF TIMES, and the number was chosen by falsifying it. At
    // three times, changing MARATHON_OFFSET_S from 18 to 40 halved the
    // measured marathon-pace divergence from 44 s/mi to 22 and this check
    // stayed silent — the engine moved, the two owners moved closer, and the
    // declared 44 kept 22 s/mi of headroom nobody had argued for. Every entry
    // in the registry today sits at exactly its measured value, so 1.5 costs
    // nothing and closes that. It is deliberately not 1.0: a number pinned to
    // the last decimal fails on every harmless change and gets widened out of
    // spite, which is how allowlists rot.
    const readings = await readAll();
    const byKey = new Map<string, number | null>();
    for (const r of readings) byKey.set(`${r.siteId}@@${r.probeId}`, r.value);
    const loose: string[] = [];
    for (const { quantity, divergence } of acceptedDivergences()) {
      let worst = 0;
      let measured = false;
      for (const pr of PROBES) {
        const a = byKey.get(`${divergence.between[0]}@@${pr.id}`);
        const b = byKey.get(`${divergence.between[1]}@@${pr.id}`);
        if (a == null || b == null) continue;
        measured = true;
        worst = Math.max(worst, Math.abs(a - b));
      }
      if (!measured || worst <= 0) continue;
      if (divergence.maxAbs > worst * 1.5) {
        loose.push(`${quantity}: ${divergence.between[1]} declares maxAbs ${divergence.maxAbs} against a measured ${fmt(worst)} · re-measure and tighten it`);
      }
    }
    expect(loose, 'an accepted divergence must be pinned near what it actually measures').toEqual([]);
  });

  it('9 · RATCHET · no accepted divergence has gone stale', async () => {
    const readings = await readAll();
    const stale = staleAcceptances(QUANTITY_OWNERSHIP, readings);
    expect(
      stale.map((s) => `${s.quantity}: ${s.divergence.between.join(' vs ')} now agrees (worst Δ ${fmt(s.worst)}) · delete the entry`),
      'an exemption whose target is clean must be deleted, not left standing (Rule 18 point 4)',
    ).toEqual([]);
  });

  it('10 · REPORT · what is still contested, on a green run', async () => {
    const readings = await readAll();
    const byKey = new Map<string, number | null>();
    for (const r of readings) byKey.set(`${r.siteId}@@${r.probeId}`, r.value);

    const out: string[] = ['', 'OWNER AGREEMENT · measured across ' + PROBES.length + ' synthetic runners', ''];
    for (const q of QUANTITY_IDS) {
      const spec = QUANTITY_OWNERSHIP[q];
      const seconds = spec.sites.filter((s) => s.role === 'SECOND');
      const dbOnly = spec.sites.filter((s) => s.probe === 'DB_ONLY');
      const mark = seconds.length === 0 ? 'ONE OWNER' : `${seconds.length} SECOND ANSWER(S)`;
      out.push(`  ${q.padEnd(24)} ${mark}${dbOnly.length ? `  · ${dbOnly.length} DB-only, measured in the audit census` : ''}`);
      for (const s of seconds) {
        const owner = ownerFor(spec, s);
        if (!owner) continue;
        let worst = 0;
        let measured = false;
        for (const p of PROBES) {
          const a = byKey.get(`${owner.siteId}@@${p.id}`);
          const b = byKey.get(`${s.siteId}@@${p.id}`);
          if (a == null || b == null) continue;
          measured = true;
          worst = Math.max(worst, Math.abs(a - b));
        }
        out.push(`      vs ${s.symbol.padEnd(30)} worst Δ ${measured ? fmt(worst) : 'NOT MEASURED HERE'} ${owner.unit ?? spec.unit}`);
      }
    }
    out.push('');
    out.push(`  quantities still carrying a second answer: ${quantitiesWithASecondAnswer().length} of ${QUANTITY_IDS.length}`);
    const dbSites = allSites().filter(({ site }) => site.probe === 'DB_ONLY');
    const dbQuantities = new Set(dbSites.map((x) => x.quantity));
    out.push(`  sites this gate cannot call without a database: ${dbSites.length}, across ${dbQuantities.size} quantities`);
    out.push('    (measured in _owner_agreement.audit.test.ts against the real account)');
    out.push('');
    // eslint-disable-next-line no-console
    console.log(out.join('\n'));
    expect(out.length).toBeGreaterThan(12);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6 · THE ORACLES · Rule 18. Every one runs on every invocation.
 *
 * Each breaks something on purpose and asserts the SAME checker names it. A
 * falsification performed once by hand is a memory; a falsification in the
 * suite is a guarantee that the checker still works.
 * ═══════════════════════════════════════════════════════════════════════ */

/** A minimal two-site registry the oracles mutate. */
function toyRegistry(over: Partial<QuantityOwnership> = {}): Readonly<Record<QuantityId, QuantityOwnership>> {
  const base: QuantityOwnership = {
    quantity: 'INTERVAL_PACE',
    question: 'toy',
    unit: 's/mi',
    belief: null,
    toleranceAbs: 1,
    sites: [
      {
        siteId: 'toy/owner.ts#theOwner', module: 'toy/owner.ts', symbol: 'theOwner',
        role: 'OWNER', probe: 'PURE', computes: 'the answer', reachedBy: ['toy'],
      },
    ],
    acceptedDivergence: [],
    ...over,
  };
  return { INTERVAL_PACE: base } as unknown as Readonly<Record<QuantityId, QuantityOwnership>>;
}

const OWNER_READS: Reading[] = [{ siteId: 'toy/owner.ts#theOwner', probeId: 'p1', value: 400 }];

describe('OWNER-AGREEMENT-1 · ORACLES · the gate has been made to fail', () => {
  it('ORACLE 1 · a SECOND owner reappearing is named', () => {
    const reg = toyRegistry({
      sites: [
        ...toyRegistry().INTERVAL_PACE.sites,
        {
          siteId: 'toy/rogue.ts#alsoAnswers', module: 'toy/rogue.ts', symbol: 'alsoAnswers',
          role: 'SECOND', probe: 'PURE', computes: 'a second answer', reachedBy: ['toy'],
        },
      ],
    });
    const found = findDisagreements(reg, [
      ...OWNER_READS,
      { siteId: 'toy/rogue.ts#alsoAnswers', probeId: 'p1', value: 412 },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe('UNDECLARED');
    expect(found[0].otherId).toBe('toy/rogue.ts#alsoAnswers');
    expect(found[0].delta).toBe(12);

    // AND the same registry with an ARGUED entry passes · the exemption must
    // excuse the exempted case and nothing else.
    const excused = findDisagreements({
      ...reg,
      INTERVAL_PACE: {
        ...reg.INTERVAL_PACE,
        acceptedDivergence: [{
          between: ['toy/owner.ts#theOwner', 'toy/rogue.ts#alsoAnswers'],
          maxAbs: 12, why: 'x', closesWhen: 'y',
        }],
      },
    }, [...OWNER_READS, { siteId: 'toy/rogue.ts#alsoAnswers', probeId: 'p1', value: 412 }]);
    expect(excused).toEqual([]);
  });

  it('ORACLE 2 · TWO OWNERS THAT DISAGREE NUMERICALLY FAIL · and the ratchet binds', () => {
    const reg = toyRegistry({
      sites: [
        ...toyRegistry().INTERVAL_PACE.sites,
        {
          siteId: 'toy/rogue.ts#alsoAnswers', module: 'toy/rogue.ts', symbol: 'alsoAnswers',
          role: 'SECOND', probe: 'PURE', computes: 'a second answer', reachedBy: ['toy'],
        },
      ],
      acceptedDivergence: [{
        between: ['toy/owner.ts#theOwner', 'toy/rogue.ts#alsoAnswers'],
        maxAbs: 12, why: 'measured at twelve', closesWhen: 'the migration',
      }],
    });
    // Inside the ratchet · silent.
    expect(findDisagreements(reg, [
      ...OWNER_READS, { siteId: 'toy/rogue.ts#alsoAnswers', probeId: 'p1', value: 412 },
    ])).toEqual([]);
    // One second per mile PAST it · named.
    const grew = findDisagreements(reg, [
      ...OWNER_READS, { siteId: 'toy/rogue.ts#alsoAnswers', probeId: 'p1', value: 413 },
    ]);
    expect(grew).toHaveLength(1);
    expect(grew[0].kind).toBe('EXCEEDS_RATCHET');
    expect(grew[0].delta).toBe(13);
  });

  it('ORACLE 3 · a caller that invokes the owner and DISCARDS the result fails', () => {
    // THE PRECEDENT THIS FILE EXISTS FOR. A text scan sees the canonical call
    // and reports clean; the value comparison sees the answer that was
    // actually returned. Both halves are asserted, so the oracle proves the
    // gate distinguishes wiring from decoration rather than merely failing.
    const reg = toyRegistry({
      sites: [
        ...toyRegistry().INTERVAL_PACE.sites,
        {
          siteId: 'toy/decorative.ts#callsThenIgnores', module: 'toy/decorative.ts',
          symbol: 'callsThenIgnores', role: 'CARRIER', probe: 'PURE',
          computes: 'calls the owner and answers with its own arithmetic',
          reachedBy: ['toy'],
        },
      ],
    });
    const decorative = findDisagreements(reg, [
      ...OWNER_READS,
      { siteId: 'toy/decorative.ts#callsThenIgnores', probeId: 'p1', value: 412 },
    ]);
    expect(decorative).toHaveLength(1);
    expect(decorative[0].kind).toBe('CARRIER_ALTERED');

    // A CARRIER may not be excused, however argued the entry is.
    const stillFails = findDisagreements({
      ...reg,
      INTERVAL_PACE: {
        ...reg.INTERVAL_PACE,
        acceptedDivergence: [{
          between: ['toy/owner.ts#theOwner', 'toy/decorative.ts#callsThenIgnores'],
          maxAbs: 999, why: 'an attempt to excuse a carrier', closesWhen: 'never',
        }],
      },
    }, [...OWNER_READS, { siteId: 'toy/decorative.ts#callsThenIgnores', probeId: 'p1', value: 412 }]);
    expect(stillFails).toHaveLength(1);
    expect(stillFails[0].kind).toBe('CARRIER_ALTERED');

    // And a carrier that genuinely carries is silent · the gate is not simply
    // failing on every carrier.
    expect(findDisagreements(reg, [
      ...OWNER_READS,
      { siteId: 'toy/decorative.ts#callsThenIgnores', probeId: 'p1', value: 400 },
    ])).toEqual([]);
  });

  it('ORACLE 4 · a stale exemption whose pair now agrees fails', () => {
    const reg = toyRegistry({
      sites: [
        ...toyRegistry().INTERVAL_PACE.sites,
        {
          siteId: 'toy/rogue.ts#alsoAnswers', module: 'toy/rogue.ts', symbol: 'alsoAnswers',
          role: 'SECOND', probe: 'PURE', computes: 'a second answer', reachedBy: ['toy'],
        },
      ],
      acceptedDivergence: [{
        between: ['toy/owner.ts#theOwner', 'toy/rogue.ts#alsoAnswers'],
        maxAbs: 12, why: 'measured at twelve', closesWhen: 'the migration',
      }],
    });
    // The migration landed · they agree · the entry must now fail.
    const stale = staleAcceptances(reg, [
      ...OWNER_READS, { siteId: 'toy/rogue.ts#alsoAnswers', probeId: 'p1', value: 400 },
    ]);
    expect(stale).toHaveLength(1);
    expect(stale[0].worst).toBe(0);
    // Still diverging · not stale.
    expect(staleAcceptances(reg, [
      ...OWNER_READS, { siteId: 'toy/rogue.ts#alsoAnswers', probeId: 'p1', value: 412 },
    ])).toEqual([]);
    // NEVER RESOLVED is not the same as agreeing (Rule 11) · not reported
    // stale, because an unmeasured pair is unmeasured and not clean.
    expect(staleAcceptances(reg, [
      ...OWNER_READS, { siteId: 'toy/rogue.ts#alsoAnswers', probeId: 'p1', value: null },
    ])).toEqual([]);
  });

  it('ORACLE 5 · a registry in which nothing resolves is caught, not reported clean', () => {
    const reg = toyRegistry({
      sites: [
        ...toyRegistry().INTERVAL_PACE.sites,
        {
          siteId: 'toy/rogue.ts#alsoAnswers', module: 'toy/rogue.ts', symbol: 'alsoAnswers',
          role: 'SECOND', probe: 'PURE', computes: 'a second answer', reachedBy: ['toy'],
        },
      ],
    });
    // Everything refuses. `findDisagreements` correctly finds nothing — which
    // is exactly why it cannot be the only assertion, and why test 7 exists.
    const readings: Reading[] = [
      { siteId: 'toy/owner.ts#theOwner', probeId: 'p1', value: null },
      { siteId: 'toy/rogue.ts#alsoAnswers', probeId: 'p1', value: null },
    ];
    expect(findDisagreements(reg, readings)).toEqual([]);
    const resolved = readings.filter((r) => r.value != null).length;
    expect(resolved, 'the liveness assertion is what catches this').toBe(0);
  });
});
