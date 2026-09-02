/**
 * lib/race/execution-plan.ts · the Race Execution Plan.
 *
 * 2026-06-09 state-audit Tier 1.1 · the audit's verdict: "no
 * race-execution product. The knowledge base already contains
 * everything needed; the product never composes it." This module is
 * that composition · one pure function that turns (goal, physiology,
 * conditions, CI) into the complete race-morning brief:
 *
 *   · per-mile split targets (the distance's own opening allowance +
 *     controlled even/negative split, Research/08 §3.1 + §3.2-3.5, via
 *     the shared tables in lib/race/distance-doctrine.ts)
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

import { effortSlowdownPct, abilityTierFromVdot } from '@/lib/training/heat-model';
import { parseStartHour } from '@/lib/training/race-conditions';
import {
  raceOpeningPlan,
  raceCheckpointMi,
  raceAbortHrBpm,
  RACE_PACE_ABORT_FRACTION,
  raceWarmup,
  warmupStridesBlockMin,
  raceCarbLoad,
  raceCarbsPerHourTarget,
  durationOnlyCarbTarget,
  raceDistanceCategory,
  RACE_PRERACE_MEAL_G_PER_KG,
} from './distance-doctrine';

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
  /** First-mile allowance over goal pace, s/mi · the distance's own row of
   *  Research/08 §3.1 (:58-64), via lib/race/distance-doctrine.ts. 5K +2,
   *  10K +7, HM +12, M +15. Was the half's +12 for every distance. */
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

/** 60 g/hr · Research/18 §1 (:27): the threshold above which single-source
 *  glucose causes GI distress in most runners. Kept as a named constant
 *  because it is the ceiling the coach copy warns against, NOT a default —
 *  the default rate is the distance's own §11 row
 *  (raceCarbsPerHourTarget, lib/race/distance-doctrine.ts). Shipping this
 *  number as the universal default is what put a marathon-class rate on a
 *  half and a gel inside a 20-minute 5K. */
export const SINGLE_SOURCE_GI_THRESHOLD_G_PER_HR = 60;
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
 *   1. Target rate (g/hr): the §11 row for the RACE DISTANCE, floor-raised
 *      by the §1 duration table (raceCarbsPerHourTarget). A runner's own
 *      entered rate or cadence overrides it — except where doctrine says
 *      zero (5K/10K, §11 :369-370), which no entry can override: a gel
 *      inside a 20-minute race is the defect, not a preference.
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

  // ── Target rate (g/hr) · the DISTANCE's row, not the marathon's ───
  // Research/18 §11 (:367-376): 5K 0 · 10K 0-30 · HM 30-60 · M 60-90,
  // floor-raised by the §1 duration table when a race runs long for its
  // distance. Doctrine-zero wins over any entered product.
  // An unknown distance has no row here. Fall back to the §1 DURATION table,
  // which needs no distance — never to another distance's row.
  const doctrineRate = raceCarbsPerHourTarget(args.distanceMi, goalSec)
    ?? durationOnlyCarbTarget(goalSec);
  let targetRate: number;
  if (doctrineRate.isZero) {
    targetRate = 0;
  } else if (fuel.carbsPerHourTargetG && fuel.carbsPerHourTargetG > 0) {
    targetRate = fuel.carbsPerHourTargetG;
  } else if (fuel.cadenceMin && fuel.cadenceMin > 0) {
    // Cadence + serving size implies a rate.
    targetRate = Math.round((servingCarbs * 60) / fuel.cadenceMin);
  } else {
    targetRate = doctrineRate.targetGPerHr;
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
      shortLine: 'No on-course fuel needed · pre-race breakfast covers a race this short.',
      citation: doctrineRate.citation,
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
    citation: doctrineRate.citation,
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
  /**
   * CEFFORT-1 (2026-09-02) · 'controlled' for a C race.
   *
   * `Research/00b` §"Recovery by Effort" grades a C race as a hard workout
   * substitute, "Strong effort, no taper". A hard workout has no closing
   * push and no race-day abort ceiling: telling a runner to "push the final
   * mile on feel" over a controlled effort is a sentence asserting a fact
   * about an intensity it is not gated on (Rule 16), and it is exactly what
   * this day must not say when an 18-mile long run follows it the next
   * morning. Default 'race' leaves every existing caller byte-identical.
   */
  effortCharacter?: 'race' | 'controlled';
}): RaceExecutionPlan | null {
  const { goalSec, distanceMi } = args;
  if (!goalSec || goalSec <= 0 || !distanceMi || distanceMi <= 0) return null;
  // 2026-08-18 · one resolution of the distance for the whole plan. Every
  // per-distance table below is read at THIS category; when the distance falls
  // outside every doctrine row there is no execution plan to compose, and the
  // caller renders nothing rather than the half's race morning.
  const cat = raceDistanceCategory(distanceMi);
  if (cat == null) return null;

  const goalPace = goalSec / distanceMi;
  const bGoalSec = args.bGoalSec ?? null;
  const bGoalPace = bGoalSec != null ? bGoalSec / distanceMi : null;

  // ── Splits · the distance's own row of Research/08 §3.1 ───────────
  // ONE opening model, shared with the watch (build-workout's settle
  // phase), the course pacing arc (lib/race/pacing.ts) and the web
  // pacing blocks (race-detail-pacing.ts). 5K opens +2, 10K +7, HM +12,
  // M +15 through mile 1, then the early block (HM miles 2-3 at +6, M
  // miles 2-10 at +5 · the "10-10-10" template).
  //
  // The early give-back is repaid across the remaining miles so the
  // cumulative still lands ON the goal, and the resulting negative split
  // stays inside §4.3's 1-2% band at every distance.
  const opening = raceOpeningPlan({ goalSec, distanceMi });
  if (opening == null) return null;
  const wholeMiles = Math.floor(distanceMi);
  const finalPartial = Number((distanceMi - wholeMiles).toFixed(3));
  const nSplits = wholeMiles + (finalPartial > 0.005 ? 1 : 0);
  // The closing push is the final 20% (§3.5 :117 · "miles 21-26" of a
  // marathon), not a flat 3.2 miles that swallows a whole 5K.
  const pushFromMi = distanceMi * 0.8;

  const splits: RaceSplitTarget[] = [];
  let cumulative = 0;
  for (let i = 1; i <= nSplits; i++) {
    const isFinal = i === nSplits && finalPartial > 0.005;
    const dist = isFinal ? finalPartial : 1.0;
    const startMi = i - 1;
    let pace: number;
    let label: RaceSplitTarget['label'];
    if (startMi < 1) {
      pace = opening.settlePaceSPerMi;
      label = 'settle';
    } else if (startMi < opening.openingMi) {
      pace = opening.earlyPaceSPerMi;
      label = 'find rhythm';
    } else if (startMi >= pushFromMi && args.effortCharacter !== 'controlled') {
      // CEFFORT-1 · a controlled effort has no closing push. The PACE is
      // unchanged either way (it is the same repaid number); what changes is
      // that the row no longer tells him to empty the tank.
      pace = opening.repaidPaceSPerMi;
      label = 'push';
    } else {
      pace = opening.repaidPaceSPerMi;
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
  // HR: sustained avg above the distance's own §6.1 ceiling means the
  // A-goal effort is already unsustainable with most of the race to run.
  // The ceiling is per-distance (5K 105-110% LTHR, HM 96-100%, M 88-95%);
  // LTHR+3 for everyone let a marathoner sit at threshold by mile 5 with
  // the trigger reading fine. Pace: 5% adrift of goal at the checkpoint
  // is the §18.2 unrecoverable zone — chasing it back is the blow-up.
  // The checkpoint itself is proportional (38% of the race), so a 5K's
  // check happens inside the 5K instead of at a mile it never reaches.
  const triggerHr = raceAbortHrBpm({
    distanceMi, lthr: args.lthr, maxHr: args.maxHr,
    // CEFFORT-1 · the abort ceiling belongs to the effort prescribed, not to
    // the distance alone. A 179 bpm trigger over a controlled 10K licenses
    // the race the pace target no longer asks for.
    effortCharacter: args.effortCharacter,
  });
  const triggerPace = Math.round(goalPace * (1 + RACE_PACE_ABORT_FRACTION));
  const bGoalTriggers: BGoalTrigger[] = [{
    atMile: raceCheckpointMi(distanceMi),
    hrAboveBpm: triggerHr,
    paceSlowerThanSPerMi: triggerPace,
    action: bGoalPace != null
      ? `Shift to the B goal (${fmtClock(bGoalSec!)} · ${fmtPace(bGoalPace)}/mi). Settle for 2 miles, then run even. Finishing strong at B beats blowing up chasing A.`
      : `Back off 15 s/mi for 2 miles and reassess. Finishing strong beats blowing up.`,
  }];

  // ── Heat decision tree · unified doctrine model at race duration ──
  // 2026-08-17 · routed through effortSlowdownPct, the shared model's single
  // entry point, rather than composing maughanSlowdownPct × durationHeatScale
  // by hand — one of the five hand-rolled pre-processors cluster 5 removed.
  // This table is a "if the gun reads X°F" ladder built weeks out, so the
  // dewpoint and the sky are genuinely unknown and are passed as such; the
  // race-day Conditions chunk prices the real forecast.
  // Rule 9 · the VDOT itself, not the tier it would collapse to: the ability
  // axis is interpolated like every other axis of the model.
  const heatRules: HeatRule[] = [65, 70, 75, 80].map((t) => {
    const pct = effortSlowdownPct({ tempF: t, durationS: goalSec, vdot: args.vdot });
    const add = Math.round(goalPace * pct / 100);
    return {
      ifStartTempAtLeastF: t,
      addSPerMi: add,
      note: t >= 75
        ? `${t}°F at the gun · add ${add}s/mi and consider racing the B plan from the start.`
        : `${t}°F at the gun · add ${add}s/mi to every split. The heat is physics, not fitness.`,
    };
  }).filter((r) => r.addSPerMi > 0);

  // ── Warm-up · Research/08 §12.1 (:588-593) + Research/10 (:110-146) ──
  // "The shorter the race, the longer the warmup." The app used to ship
  // the half's protocol — 45 min out, 1 mile, drills, 3-4 strides — to
  // every distance, including the marathon, where §12.1 wants 5-10 min
  // and Research/10 (:133) says "No strides. Conserve glycogen."
  // Timeline is built BACKWARDS from the corral so the whole block lands
  // inside the distance's own total-time band.
  const wu = raceWarmup(distanceMi);
  if (wu == null) return null;
  const stridesBlockMin = warmupStridesBlockMin(wu);
  const corralAt = wu.corralMinBeforeGun;
  const stridesAt = corralAt + stridesBlockMin;
  const drillsAt = stridesAt + wu.drillsMin;
  const easyAt = drillsAt + wu.easyMin;
  const easyStep = wu.mode === 'jog'
    ? `Easy jog ${wu.easyMiBand ? `${wu.easyMiBand[0]}-${wu.easyMiBand[1]} miles` : `${wu.easyMin} min`} (${wu.easyMin} min). Conversational, nothing more.`
    : `Walk ${wu.easyMin} min, or jog 3-5 min if you want the legs turning over. The first miles of the race are the rest of the warm-up.`;
  const drillsStep = wu.mode === 'jog'
    ? 'Drills: leg swings, A-skips, 2×30s high knees.'
    : 'Brief dynamic only: leg swings, ankle circles, hip openers.';
  const warmup: WarmupStep[] = [
    { minutesBeforeGun: easyAt, clock: clockFromGun(args.startTimeLocal, easyAt), step: easyStep },
    { minutesBeforeGun: drillsAt, clock: clockFromGun(args.startTimeLocal, drillsAt), step: drillsStep },
  ];
  if (wu.strides > 0) {
    warmup.push({
      minutesBeforeGun: stridesAt,
      clock: clockFromGun(args.startTimeLocal, stridesAt),
      step: `${wu.strides} × 20s strides at ${wu.stridesPace}. Full recovery between.`,
    });
  }
  warmup.push({
    minutesBeforeGun: corralAt,
    clock: clockFromGun(args.startTimeLocal, corralAt),
    step: 'In the corral. Sips of water only from here.',
  });

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
    : 'On course: nothing. Water at the aid stations if it is warm.';

  // Carb load · Research/08 §10.1 (:452-457) BY DISTANCE. The app shipped
  // the HALF row (7-8 g/kg, 24-36h) to marathoners, who need 8-12 across
  // 36-48h — under-loaded by about a third — and to 5K runners, who need
  // no load at all (:450 · supercompensation matters over 90 min).
  const load = raceCarbLoad(distanceMi);
  if (load == null) return null;
  const meal = RACE_PRERACE_MEAL_G_PER_KG[cat];
  const mealTxt = meal[0] === meal[1] ? `${meal[0]} g/kg` : `${meal[0]}-${meal[1]} g/kg`;
  const loadLine = load.needsLoad && load.hoursBand
    ? `Carb load ${load.gPerKgBand[0]}-${load.gPerKgBand[1]} g/kg/day across the ${load.hoursBand[0]}-${load.hoursBand[1]}h before. Plain food you know.`
    : `No carb load needed. Normal training carbs, ${load.gPerKgBand[0]}-${load.gPerKgBand[1]} g/kg/day.`;

  // Caffeine · Research/18 §11 (:369-372). 5K/10K are pre-race only; the
  // half takes one caffeinated gel mid-race; the marathon takes two.
  const caffeineLine =
    cat === '5k' || cat === '10k'
      ? 'Caffeine: pre-race only. Normal coffee 45-60 min before the gun. Nothing on course.'
      : cat === 'hm'
        ? `Caffeine: coffee 45-60 min before the gun, one caffeinated gel around mile ${Math.round(distanceMi / 2)}.`
        : cat === 'm'
          ? 'Caffeine: 200 mg before the gun, 100 mg at mile 13, 100 mg at mile 20.'
          : 'Caffeine: 200 mg before the gun, then 50-100 mg an hour once you are moving.';

  const fueling: string[] = [
    loadLine,
    `Race morning: breakfast ${mealTxt} carbs, 2.5-3h out. Nothing new.`,
    onCourseLine,
    caffeineLine,
  ];
  if (fuelingPlan.isDefault && fuelingPlan.targetCarbsPerHourG > 0) {
    fueling.push('Enter your race fuel to lock the exact product and schedule.');
  }

  // ── Strategy line + CI context ────────────────────────────────────
  // Reads off the same opening model as the splits, so the prose and the
  // numbers can never drift apart.
  const pushMiles = Math.max(1, Math.round(distanceMi * 0.2));
  const openLine = opening.firstMileAllowanceSPerMi <= 3
    ? `Open at ${fmtPace(opening.settlePaceSPerMi)} · goal pace, not a second faster. `
    : `Open at ${fmtPace(opening.settlePaceSPerMi)} for the first mile. `;
  const earlyLine = opening.openingMi > 1
    ? `Hold ${fmtPace(opening.earlyPaceSPerMi)} through ${Math.round(opening.openingMi)}. `
    : '';
  const strategyLine = args.effortCharacter === 'controlled'
    ? openLine + earlyLine +
      `Then it's ${fmtPace(opening.repaidPaceSPerMi)}s the rest of the way. ` +
      'Controlled the whole way. This is the week\u2019s hard session, not a race, so finish it able to run tomorrow.'
    : openLine + earlyLine +
      `Then it's ${fmtPace(opening.repaidPaceSPerMi)}s the rest of the way · the early patience comes back to you. ` +
      `Push the final ${pushMiles === 1 ? 'mile' : `${pushMiles} miles`} on feel.`;
  const ciNote = args.ci
    ? `Current fitness says ${fmtClock(args.ci.loSec)}–${fmtClock(args.ci.hiSec)}. The plan above is the path to the goal edge of that band.`
    : null;

  return {
    goalSec,
    goalPaceSPerMi: Math.round(goalPace),
    distanceMi,
    bGoalSec,
    bGoalPaceSPerMi: bGoalPace != null ? Math.round(bGoalPace) : null,
    firstMileAllowanceSPerMi: opening.firstMileAllowanceSPerMi,
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
