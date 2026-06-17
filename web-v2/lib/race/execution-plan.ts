/**
 * lib/race/execution-plan.ts · the Race Execution Plan.
 *
 * 2026-06-09 state-audit Tier 1.1 · the audit's verdict: "no
 * race-execution product. The knowledge base already contains
 * everything needed; the product never composes it." This module is
 * that composition · one pure function that turns (goal, physiology,
 * conditions, CI) into the complete race-morning brief:
 *
 *   · per-mile split targets (first-mile allowance + controlled
 *     even/negative split, Research/08 §3.4)
 *   · B-goal trigger conditions (objective mid-race abort criteria)
 *   · heat decision tree (Research/06 table at the start-hour temp,
 *     via the unified heat model)
 *   · warm-up timeline anchored to the gun (Research/08 §12.1)
 *   · fueling + carb-load doctrine (Research/08 §10.1)
 *
 * Pure + all-runner: no DB access, no Date.now(). Callers (web race
 * page, /api/watch/today race day, iPhone race view) supply the data
 * and render the same plan. Numbers derive from the runner's own
 * physiology where present (LTHR, pacing CI); the documented defaults
 * fire only when data is absent.
 *
 * Cite: Research/08-pacing-and-race-week.md §3.1/§3.4 (pacing),
 *       §6.1 (HR ceilings), §10.1 (carb load), §12.1 (warm-up),
 *       §18.2 (execution-error costs);
 *       Research/06-weather-adjustments.md §1/§12 via heat-model.
 */

import { maughanSlowdownPct, durationHeatScale, abilityTierFromVdot } from '@/lib/training/heat-model';
import { parseStartHour } from '@/lib/training/race-conditions';

export interface RaceSplitTarget {
  /** Mile number, 1-based. The final entry covers the partial mile. */
  mile: number;
  /** Distance this split covers (1.0, or the final partial). */
  distanceMi: number;
  /** Target pace for the split, s/mi. */
  paceSPerMi: number;
  /** Cumulative elapsed at the END of this split, seconds. */
  cumulativeSec: number;
  /** Segment label · 'settle' | 'find rhythm' | 'goal pace' | 'push'. */
  label: 'settle' | 'find rhythm' | 'goal pace' | 'push';
}

export interface BGoalTrigger {
  /** Checkpoint mile. */
  atMile: number;
  /** Trip when avg HR to this point exceeds this. Null when the runner
   *  has no LTHR/maxHr anchor. */
  hrAboveBpm: number | null;
  /** Trip when avg pace to this point is slower than this (s/mi). */
  paceSlowerThanSPerMi: number;
  /** What to do when tripped. */
  action: string;
}

export interface HeatRule {
  /** Fires when the start-line temp is at or above this (°F). */
  ifStartTempAtLeastF: number;
  /** Add this to every split target, s/mi. */
  addSPerMi: number;
  note: string;
}

export interface WarmupStep {
  /** Minutes before the gun (positive = before). */
  minutesBeforeGun: number;
  /** Clock time "6:15 AM" when gun time known, else null. */
  clock: string | null;
  step: string;
}

/** One scheduled fuel intake during the race. */
export interface FuelScheduleStop {
  /** Mile to take the serving (rounded to 0.1). */
  mi: number;
  /** Elapsed minutes at that mile, at goal pace. */
  atMin: number;
}

/**
 * Structured race-fueling recommendation · the coach amount + schedule.
 *
 * Derived from the runner's entered product (races.meta.fuelProduct /
 * fuelCarbsPerServingG / fuelCadenceMin / fuelCarbsPerHourTargetG) when
 * present, else the runner-level default product (users.fuel_*), else a
 * research-grounded default rate (Research/18 §1: 60 g/hr single-source
 * floor, up to 90 with a trained gut on a glucose:fructose blend).
 *
 * The phone renders servings + schedule + target rate + product; the
 * watch maps `scheduleMi` to gel haptics.
 */
export interface RaceFuelingPlan {
  /** Carbs-per-hour target the plan is built to (g/hr). */
  targetCarbsPerHourG: number;
  /** Total servings to carry for the whole race at goal pace. */
  recommendedServings: number;
  /** Product the schedule is built around ("Maurten Gel 100" / "gel"). */
  productName: string;
  /** Carbs in one serving (g). */
  carbsPerServingG: number;
  /** Total carbs the schedule delivers (g) · servings × carbsPerServing. */
  totalCarbsG: number;
  /** Mile-anchored intake schedule (the watch reads `mi`). */
  scheduleMi: FuelScheduleStop[];
  /** Minute-anchored intake schedule (mirror of scheduleMi, for prose). */
  scheduleMin: number[];
  /** True when nothing was entered and these are research defaults the
   *  phone should prompt the runner to confirm ("enter your fueling"). */
  isDefault: boolean;
  /** Coach one-liner · "5 Maurten Gel 100s · ~75 g/hr · every 25 min." */
  shortLine: string;
  /** Research citation for the target rate. */
  citation: string;
}

export interface RaceExecutionPlan {
  goalSec: number;
  goalPaceSPerMi: number;
  distanceMi: number;
  /** B-goal · null when the race has none. */
  bGoalSec: number | null;
  bGoalPaceSPerMi: number | null;
  /** First-mile allowance over goal pace, s/mi (Research/08 §3.1: a
   *  half's first mile runs +10-15s; we prescribe the midpoint). */
  firstMileAllowanceSPerMi: number;
  splits: RaceSplitTarget[];
  bGoalTriggers: BGoalTrigger[];
  heatRules: HeatRule[];
  warmup: WarmupStep[];
  /** Doctrine prose lines (carb-load, breakfast, caffeine). Kept for the
   *  briefing surfaces; the structured amount/schedule is `fuelingPlan`. */
  fueling: string[];
  /** Structured fuel recommendation · servings + schedule + rate (the
   *  phone + watch consume this). Never null — defaults when no entry. */
  fuelingPlan: RaceFuelingPlan;
  /** One-paragraph strategy line for the briefing surfaces. */
  strategyLine: string;
  /** CI context · "fitness says 1:31:56–1:37:52" · null at cold start. */
  ciNote: string | null;
}

/** Research/18 §1 default during-race carb rate when nothing is entered.
 *  60 g/hr is the single-source glucose floor above which most runners
 *  hit GI distress; a trained gut on a 1:0.8 glucose:fructose blend goes
 *  to ~90. We default to 60 (safe, broadly tolerated) and the coach copy
 *  notes the higher ceiling. Cite: Research/18-fueling-products.md §1. */
export const DEFAULT_RACE_CARBS_PER_HOUR_G = 60;
/** Default serving size (g carbs) when no product entered · matches the
 *  mid-pack gel (GU/SiS GO ≈ 22 g). Cite: Research/18 §3. */
export const DEFAULT_SERVING_CARBS_G = 22;

export interface RaceFuelingInput {
  /** Product name, e.g. "Maurten Gel 100". */
  product?: string | null;
  /** Carbs per serving (g), e.g. 25 for a Maurten 100. */
  carbsPerServingG?: number | null;
  /** Take one serving every N minutes (the runner's cadence). */
  cadenceMin?: number | null;
  /** Direct g/hr target if the runner sets the rate, not the cadence. */
  carbsPerHourTargetG?: number | null;
}

const fmtPace = (s: number): string => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const fmtClock = (sec: number): string => {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.round(sec % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};

/** Gun time ("7:00 AM" / "07:00" · the race page Gun chip formats, via
 *  parseStartHour) + offset minutes → "6:15 AM". Null in → null out. */
function clockFromGun(startTimeLocal: string | null | undefined, minutesBefore: number): string | null {
  const startHour = parseStartHour(startTimeLocal);
  if (startHour == null) return null;
  let total = Math.round(startHour * 60) - minutesBefore;
  while (total < 0) total += 24 * 60;
  const h24 = Math.floor(total / 60) % 24;
  const mm = total % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
}

/**
 * Compute the structured fuel recommendation for a race.
 *
 * The math, all from Research/18-fueling-products.md:
 *   1. Target rate (g/hr): the runner's entered rate, else the rate
 *      implied by (servingCarbs ÷ cadence × 60), else the §1 default 60.
 *      Distances under ~50 min need no fuel (§11 · 5K/10K: 0 g/hr).
 *   2. Total carbs = targetRate × raceDurationHours (goalSec).
 *   3. Servings = ceil(totalCarbs ÷ servingCarbs) — round UP so the
 *      runner never under-carries the target.
 *   4. Schedule: place servings on the runner's cadence (every N min),
 *      first at ~cadence min, none inside the last ~10 min (a gel at the
 *      line is a cue nobody can use). When no cadence is entered, derive
 *      it from servings spread evenly across the race.
 *
 * `entered`/runner-default precedence is the caller's job (it passes the
 * resolved product); `isDefault` flags when EVERYTHING fell through to
 * documented defaults so the phone can prompt the runner to confirm.
 */
export function computeRaceFueling(args: {
  goalSec: number;
  distanceMi: number;
  goalPaceSPerMi: number;
  fuel?: RaceFuelingInput | null;
  /** True when no per-race AND no runner-default product was supplied. */
  isDefault?: boolean;
}): RaceFuelingPlan {
  const { goalSec, goalPaceSPerMi } = args;
  const fuel = args.fuel ?? {};
  const durationHr = goalSec / 3600;
  const durationMin = goalSec / 60;

  const servingCarbs = fuel.carbsPerServingG && fuel.carbsPerServingG > 0
    ? fuel.carbsPerServingG
    : DEFAULT_SERVING_CARBS_G;
  const productName = fuel.product?.trim() ? fuel.product.trim() : 'gel';

  // ── Target rate (g/hr) ────────────────────────────────────────────
  // Under ~50 min (5K/10K) no fuel is needed · Research/18 §11.
  let targetRate: number;
  if (durationMin < 50) {
    targetRate = 0;
  } else if (fuel.carbsPerHourTargetG && fuel.carbsPerHourTargetG > 0) {
    targetRate = fuel.carbsPerHourTargetG;
  } else if (fuel.cadenceMin && fuel.cadenceMin > 0) {
    // Cadence + serving size implies a rate.
    targetRate = Math.round((servingCarbs * 60) / fuel.cadenceMin);
  } else {
    targetRate = DEFAULT_RACE_CARBS_PER_HOUR_G;
  }

  if (targetRate <= 0) {
    return {
      targetCarbsPerHourG: 0,
      recommendedServings: 0,
      productName,
      carbsPerServingG: servingCarbs,
      totalCarbsG: 0,
      scheduleMi: [],
      scheduleMin: [],
      isDefault: args.isDefault ?? false,
      shortLine: 'No on-course fuel needed — pre-race breakfast covers a race this short.',
      citation: 'Research/18-fueling-products.md §11 (5K/10K: 0 g/hr)',
    };
  }

  // ── Total carbs + servings (round UP so target is always met) ─────
  const totalCarbsTarget = targetRate * durationHr;
  const recommendedServings = Math.max(1, Math.ceil(totalCarbsTarget / servingCarbs));
  const totalCarbsG = Math.round(recommendedServings * servingCarbs);

  // ── Schedule on cadence ───────────────────────────────────────────
  // Use the entered cadence; else spread servings evenly. First gel at
  // the cadence mark (not mile 0), and clamp the last to ~10 min before
  // the finish so every cue is actionable.
  const lastUsableMin = Math.max(0, durationMin - 10);
  const cadence = fuel.cadenceMin && fuel.cadenceMin > 0
    ? fuel.cadenceMin
    : Math.max(15, Math.round(lastUsableMin / recommendedServings));

  const scheduleMin: number[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < recommendedServings; i++) {
    const at = Math.min(lastUsableMin, Math.round((i + 1) * cadence));
    if (seen.has(at)) continue;       // dedupe when the clamp folds two together
    seen.add(at);
    scheduleMin.push(at);
  }

  const scheduleMi: FuelScheduleStop[] = scheduleMin.map((min) => ({
    // mile reached at goal pace by `min` minutes.
    mi: Math.round(((min * 60) / goalPaceSPerMi) * 10) / 10,
    atMin: min,
  }));

  const servings = scheduleMin.length;
  const plural = servings === 1 ? productName : `${productName}s`;
  const cadenceTxt = fuel.cadenceMin && fuel.cadenceMin > 0
    ? `every ${fuel.cadenceMin} min`
    : `~every ${cadence} min`;
  const shortLine = `${servings} ${plural} · ~${targetRate} g/hr · ${cadenceTxt}.`;

  return {
    targetCarbsPerHourG: targetRate,
    recommendedServings: servings,
    productName,
    carbsPerServingG: servingCarbs,
    totalCarbsG,
    scheduleMi,
    scheduleMin,
    isDefault: args.isDefault ?? false,
    shortLine,
    citation: 'Research/18-fueling-products.md §1 + §11 (60 g/hr floor; trained gut to 90 on glucose:fructose 1:0.8)',
  };
}

/**
 * Compose the execution plan. All inputs optional except goal +
 * distance; everything else degrades to documented defaults.
 */
export function composeRaceExecutionPlan(args: {
  goalSec: number;
  distanceMi: number;
  bGoalSec?: number | null;
  lthr?: number | null;
  maxHr?: number | null;
  vdot?: number | null;
  /** Pacing CI on the current-fitness projection (goal-projection.ts). */
  ci?: { loSec: number; hiSec: number } | null;
  /** "HH:MM" local gun time (races.meta.startTimeLocal). */
  startTimeLocal?: string | null;
  /** Resolved fuel product (per-race meta → runner default → none). The
   *  caller resolves precedence; pass what was found. */
  fuel?: RaceFuelingInput | null;
  /** True when neither a per-race nor runner-default product was found,
   *  so the structured plan is built on documented defaults. */
  fuelIsDefault?: boolean;
}): RaceExecutionPlan | null {
  const { goalSec, distanceMi } = args;
  if (!goalSec || goalSec <= 0 || !distanceMi || distanceMi <= 0) return null;

  const goalPace = goalSec / distanceMi;
  const bGoalSec = args.bGoalSec ?? null;
  const bGoalPace = bGoalSec != null ? bGoalSec / distanceMi : null;

  // ── Splits · Research/08 §3.4 HM template ─────────────────────────
  // Mile 1: +12 s/mi (midpoint of the +10-15 doctrine band).
  // Miles 2-3: +6 (midpoint of +5-10).
  // The early give-back is repaid across the remaining miles so the
  // cumulative still lands ON the goal · the repayment spread keeps
  // per-mile correction under ~3 s/mi (invisible effort change, real
  // arithmetic honesty).
  const FIRST_MILE_ALLOWANCE = 12;
  const EARLY_ALLOWANCE = 6;
  const wholeMiles = Math.floor(distanceMi);
  const finalPartial = Number((distanceMi - wholeMiles).toFixed(3));
  const nSplits = wholeMiles + (finalPartial > 0.005 ? 1 : 0);

  // Give-back seconds banked in miles 1-3.
  const earlyMiles = Math.min(3, wholeMiles);
  const giveBack = FIRST_MILE_ALLOWANCE + (earlyMiles >= 2 ? EARLY_ALLOWANCE : 0) + (earlyMiles >= 3 ? EARLY_ALLOWANCE : 0);
  const repayMiles = Math.max(1, distanceMi - earlyMiles);
  const repayPerMi = giveBack / repayMiles;

  const splits: RaceSplitTarget[] = [];
  let cumulative = 0;
  for (let i = 1; i <= nSplits; i++) {
    const isFinal = i === nSplits && finalPartial > 0.005;
    const dist = isFinal ? finalPartial : 1.0;
    const milesToGo = distanceMi - (i - 1);
    let pace: number;
    let label: RaceSplitTarget['label'];
    if (i === 1) {
      pace = goalPace + FIRST_MILE_ALLOWANCE;
      label = 'settle';
    } else if (i <= 3) {
      pace = goalPace + EARLY_ALLOWANCE;
      label = 'find rhythm';
    } else if (milesToGo <= 3.2) {
      pace = goalPace - repayPerMi;
      label = 'push';
    } else {
      pace = goalPace - repayPerMi;
      label = 'goal pace';
    }
    cumulative += pace * dist;
    splits.push({
      mile: i,
      distanceMi: dist,
      paceSPerMi: Math.round(pace),
      cumulativeSec: Math.round(cumulative),
      label,
    });
  }
  // Snap the final cumulative to the goal exactly (rounding residue).
  if (splits.length > 0) splits[splits.length - 1].cumulativeSec = goalSec;

  // ── B-goal triggers · objective, checked once at the checkpoint ───
  // HR: sustained avg above LTHR by the 5-mile mark means the A-goal
  // effort is already threshold-plus with 8+ miles to run · Research/08
  // §6.1 caps an HM at 96-100% LTHR · LTHR + 3 is "clearly above the
  // band," not noise. Pace: ≥ ~23 s/mi (≈5%) adrift of goal by mile 5
  // is the §18.2 unrecoverable zone — chasing it back is the blow-up.
  const triggerHr = args.lthr != null
    ? args.lthr + 3
    : args.maxHr != null ? Math.round(args.maxHr * 0.91) : null;
  const triggerPace = Math.round(goalPace + 23);
  const bGoalTriggers: BGoalTrigger[] = [{
    atMile: 5,
    hrAboveBpm: triggerHr,
    paceSlowerThanSPerMi: triggerPace,
    action: bGoalPace != null
      ? `Shift to the B goal (${fmtClock(bGoalSec!)} · ${fmtPace(bGoalPace)}/mi). Settle for 2 miles, then run even. Finishing strong at B beats blowing up chasing A.`
      : `Back off 15 s/mi for 2 miles and reassess. Finishing strong beats blowing up.`,
  }];

  // ── Heat decision tree · unified doctrine model at race duration ──
  const tier = abilityTierFromVdot(args.vdot);
  const durScale = durationHeatScale(goalSec);
  const heatRules: HeatRule[] = [65, 70, 75, 80].map((t) => {
    const pct = maughanSlowdownPct(t, tier) * durScale;
    const add = Math.round(goalPace * pct / 100);
    return {
      ifStartTempAtLeastF: t,
      addSPerMi: add,
      note: t >= 75
        ? `${t}°F at the gun · add ${add}s/mi and consider racing the B plan from the start.`
        : `${t}°F at the gun · add ${add}s/mi to every split. The heat is physics, not fitness.`,
    };
  }).filter((r) => r.addSPerMi > 0);

  // ── Warm-up · Research/08 §12.1 (HM: 0.5-1.5mi easy + drills +
  //    3-4 strides @ race pace, 10-15 min total, done ~15 min out) ──
  const warmup: WarmupStep[] = [
    { minutesBeforeGun: 45, clock: clockFromGun(args.startTimeLocal, 45), step: 'Easy jog 1 mile. Conversational, nothing more.' },
    { minutesBeforeGun: 30, clock: clockFromGun(args.startTimeLocal, 30), step: 'Drills: leg swings, A-skips, 2×30s high knees.' },
    { minutesBeforeGun: 25, clock: clockFromGun(args.startTimeLocal, 25), step: `3-4 × 20s strides at race pace (${fmtPace(goalPace)}/mi feel). Full recovery between.` },
    { minutesBeforeGun: 15, clock: clockFromGun(args.startTimeLocal, 15), step: 'In the corral. Sips of water only from here.' },
  ];

  // ── Fueling · Research/08 §10.1 (race-morning) + structured plan ──
  // Structured amount/schedule (the phone + watch consume this). Carb
  // intake during the race is grounded in Research/18 §1/§11; the prose
  // below covers carb-load + breakfast + caffeine which are separate
  // (Research/08 §10.1).
  const fuelingPlan = computeRaceFueling({
    goalSec,
    distanceMi,
    goalPaceSPerMi: goalPace,
    fuel: args.fuel,
    isDefault: args.fuelIsDefault ?? (args.fuel == null),
  });
  const onCourseLine = fuelingPlan.targetCarbsPerHourG > 0
    ? `On course: ${fuelingPlan.shortLine}`
    : (distanceMi >= 12
        ? 'On course: one gel ~10 min before the gun, one at ~mile 7-8 with water.'
        : 'On course: one gel ~10 min before the gun if the race runs past 50 minutes.');
  const fueling: string[] = [
    'Carb load 7-8 g/kg across the 24-36h before. Plain food you know.',
    'Race morning: normal breakfast 2.5-3h out. Nothing new.',
    onCourseLine,
    'Caffeine: normal coffee at breakfast. Optional caffeinated gel at mile 8.',
  ];
  if (fuelingPlan.isDefault && fuelingPlan.targetCarbsPerHourG > 0) {
    fueling.push('Enter your race fuel to lock the exact product and schedule.');
  }

  // ── Strategy line + CI context ────────────────────────────────────
  const strategyLine =
    `Open at ${fmtPace(goalPace + FIRST_MILE_ALLOWANCE)} for the first mile. ` +
    `Find ${fmtPace(goalPace + EARLY_ALLOWANCE)} through 3. ` +
    `Then it's ${fmtPace(goalPace - repayPerMi)}s the rest of the way · the early patience comes back to you. ` +
    `Push the last 5K on feel.`;
  const ciNote = args.ci
    ? `Current fitness says ${fmtClock(args.ci.loSec)}–${fmtClock(args.ci.hiSec)}. The plan above is the path to the goal edge of that band.`
    : null;

  return {
    goalSec,
    goalPaceSPerMi: Math.round(goalPace),
    distanceMi,
    bGoalSec,
    bGoalPaceSPerMi: bGoalPace != null ? Math.round(bGoalPace) : null,
    firstMileAllowanceSPerMi: FIRST_MILE_ALLOWANCE,
    splits,
    bGoalTriggers,
    heatRules,
    warmup,
    fueling,
    fuelingPlan,
    strategyLine,
    ciNote,
  };
}
