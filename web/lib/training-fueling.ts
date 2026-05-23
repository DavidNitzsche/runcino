/**
 * Training fueling — gel + carb plan for any run, cited to
 * Research/18-fueling-products.md (§1 carb intake by duration; §3 product
 * profiles; §11 workout-specific fueling; §13 gut training, Costa et al.).
 *
 * The race version lives in lib/fueling.ts (phase-anchored to a race
 * course). This module is the TRAINING side, time-anchored so it works
 * for any prescribed run and is straightforward to fire on the watch
 * during a session.
 *
 * Two layers:
 *   1. Base rate by duration + workout type + heat (Research/18 §1).
 *   2. Race-aware "gut training" ramp (Research/18 §13, Costa et al.) —
 *      when an A-race is set, long-run carb targets ramp from a base
 *      habit (30 g/hr) up to race target over the build/peak phases so
 *      the runner has practiced race-day fueling MULTIPLE times before
 *      race day. "Gut training is reversible — detrains within ~2 weeks
 *      of stopping" (§13), so the rehearsal stays close to race week.
 *
 * The engine returns a single FuelingPlan the UI and watch both consume:
 *   - shortLine for the Today card (one line, plain English)
 *   - why    for the workout-detail / why-this surface
 *   - atMins for the watch (fires a haptic + screen prompt at each)
 */

/** Carbs per typical gel (g). Most popular gels are 22–25 g; we round at
 *  22 so the count never under-shoots the target intake. (Research/18 §3
 *  GU Original 22 g; Maurten 100 25 g; SiS GO 22 g.) */
export const DEFAULT_GEL_CARBS_G = 22;

/** Default race-day carb target when the user hasn't pinned one. 75 g/hr
 *  sits in the comfortable upper band of single-blend tolerance for a
 *  trained gut (§1: 60–90 g/hr for 2.5–3 hr; §13 build-progress week 4). */
export const DEFAULT_RACE_TARGET_G_PER_HR = 75;

export type WorkoutFuelingType = 'easy' | 'long' | 'quality' | 'race' | 'rest';

export interface FuelingInput {
  /** Estimated total run duration (minutes). Pace × distance from the
   *  prescribed workout. The runner's actual pace will vary, but the watch
   *  fires by elapsed time, so estimates are fine. */
  durationEstMin: number;
  /** Distance in miles, used only for the "why" copy reference. */
  distanceMi?: number | null;
  /** Workout type drives whether intensity penalizes gut tolerance (§1
   *  caveats: high-intensity efforts reduce gut tolerance). */
  workoutType: WorkoutFuelingType;
  /** Forecast temperature at run start (°F). Triggers the heat adjustment
   *  (§1: "Heat / altitude / high-intensity efforts reduce gut tolerance —
   *  back off 10–20%"). */
  tempF?: number | null;
  /** Days to the user's next A-race, when set. Drives the Costa
   *  gut-training ramp on long runs in the build/peak phase. */
  daysToARace?: number | null;
  /** Race-day carb target in g/hr (user-set or DEFAULT_RACE_TARGET_G_PER_HR).
   *  Used as the ceiling the long-run ramp climbs toward. */
  raceFuelTargetGPerHr?: number | null;
  /** Carbs per gel the runner actually uses (g). Defaults to 22 g (typical
   *  GU / SiS sachet). Set to e.g. 25 (Maurten 100), 40 (Maurten 160), or
   *  44 (SiS Beta Fuel 80) so the number of gels in the plan matches the
   *  actual product the runner pulls from the cupboard. (Research/18 §3
   *  product profiles.) */
  gelCarbsG?: number | null;
  /** Display name of the runner's chosen product, e.g. "Maurten 100".
   *  Drops into the user-facing copy so prompts read "2 Maurten 100s" not
   *  generic "2 gels". null → falls back to "gel(s)". */
  gelLabel?: string | null;
}

export interface FuelingPlan {
  /** False for short / rest runs where no fuel is warranted. */
  needed: boolean;
  /** Number of gels to take during the run. */
  gels: number;
  /** Minute marks (from run start) for each gel — what the watch fires on. */
  atMins: number[];
  /** Target carb intake rate (g/hr). */
  gPerHr: number;
  /** Total carbs across all gels (g). */
  totalCarbsG: number;
  /** True when this is a race-day fuel rehearsal (full race target on a
   *  long run inside the final ~6 weeks before race). */
  isRehearsal: boolean;
  /** True when heat back-off was applied. */
  heatAdjusted: boolean;
  /** One-line plain-English summary for the Today card. */
  shortLine: string;
  /** Longer plain-English explanation for the workout-detail / why-this
   *  surface. Sub-sentences feed the post-run debrief too. */
  why: string;
}

const NONE: Readonly<FuelingPlan> = Object.freeze({
  needed: false,
  gels: 0,
  atMins: [],
  gPerHr: 0,
  totalCarbsG: 0,
  isRehearsal: false,
  heatAdjusted: false,
  shortLine: '',
  why: '',
});

/** Pretty-format a minute count for the user-facing copy ("45 min" or
 *  "1:30 in" when over an hour, to keep the eye honest at long durations). */
function fmtMin(m: number): string {
  const r = Math.round(m);
  if (r < 60) return `${r} min`;
  const h = Math.floor(r / 60);
  const mm = r % 60;
  return mm === 0 ? `${h}:00` : `${h}:${String(mm).padStart(2, '0')}`;
}

/** Base carb target by duration + workout type, per Research/18 §1 + §11.
 *  Returns g/hr or 0 when no fuel is warranted. */
function baseTargetGPerHr(durationMin: number, type: WorkoutFuelingType): number {
  if (type === 'rest') return 0;
  if (durationMin < 60) return 0;                              // §1: <45 → none; up to 60 still optional
  if (durationMin < 75) return type === 'quality' ? 30 : 0;    // §11: quality ≥75 min wants fueling
  if (durationMin < 120) return 30;                            // §1: 1–2.5 hr → 30–60 g/hr; start low
  if (durationMin < 150) return 45;                            // mid-band
  if (durationMin < 180) return 60;                            // §1: 2.5–3 hr → 60–90 g/hr
  return 75;                                                   // §1: >3 hr → 90 g/hr territory
}

/** Costa et al. 6-week progressive build (Research/18 §13 table). Returns
 *  the g/hr target for a LONG RUN this many days from the A-race, ramping
 *  from the base habit (30 g/hr) up to the race target by ~2 weeks out so
 *  the runner has rehearsed race fueling MULTIPLE times before race day. */
function rampedLongRunTarget(
  daysToRace: number,
  raceTarget: number,
): number {
  // Clamp the race target into a sane band (§1: 60–120 g/hr).
  const t = Math.max(60, Math.min(120, raceTarget));
  if (daysToRace < 0) return 0;                  // past race day — no ramp
  if (daysToRace <= 14) return t;                // weeks -2 to 0: full race target (rehearsal)
  if (daysToRace <= 28) return Math.max(75, t - 15);   // 2–4 weeks out
  if (daysToRace <= 42) return 75;               // 4–6 weeks out
  if (daysToRace <= 56) return 60;               // 6–8 weeks out
  if (daysToRace <= 84) return 45;               // 8–12 weeks out
  return 30;                                     // 12+ weeks: base habit
}

/** Apply heat adjustment per Research/18 §1: heat reduces gut tolerance,
 *  back off 10–20%. Hot day → −15% (the middle of the band). */
function applyHeat(target: number, tempF: number | null | undefined): { target: number; adjusted: boolean } {
  if (tempF == null || target === 0) return { target, adjusted: false };
  if (tempF >= 80) return { target: Math.round(target * 0.80), adjusted: true };   // very hot: −20%
  if (tempF >= 75) return { target: Math.round(target * 0.85), adjusted: true };   // hot: −15%
  return { target, adjusted: false };
}

/** Distribute N gels across the run, anchored to time. First gel at the
 *  earlier of (30 min in) or (interval/2). Subsequent gels every `interval`
 *  minutes (capped at 30 min for high-rate fueling). */
function gelTimings(durationMin: number, gels: number): number[] {
  if (gels <= 0) return [];
  const usable = Math.max(durationMin - 5, 20);   // last 5 min: too late for absorption
  const interval = Math.min(45, usable / gels);   // upper bound: 45 min between gels
  const first = Math.min(30, Math.round(interval / 1.5));
  const out: number[] = [];
  for (let i = 0; i < gels; i++) {
    const t = Math.round(first + i * interval);
    if (t < durationMin - 3) out.push(t);
  }
  return out;
}

/**
 * The engine. Pure function. Same input → same output, no DB / clock.
 */
export function planTrainingFueling(input: FuelingInput): FuelingPlan {
  const dur = Math.max(0, Math.round(input.durationEstMin));
  if (input.workoutType === 'rest' || dur < 60) return NONE;

  // 1. Base target (duration / type).
  let target = baseTargetGPerHr(dur, input.workoutType);

  // 2. Gut-training ramp on long runs that point at an A-race.
  let isRehearsal = false;
  if (
    input.workoutType === 'long' &&
    input.daysToARace != null &&
    input.daysToARace >= 0
  ) {
    const raceTarget = input.raceFuelTargetGPerHr ?? DEFAULT_RACE_TARGET_G_PER_HR;
    const ramped = rampedLongRunTarget(input.daysToARace, raceTarget);
    if (ramped > target) target = ramped;
    if (input.daysToARace <= 28 && target >= raceTarget) isRehearsal = true;
  }

  // 3. Heat back-off.
  const heat = applyHeat(target, input.tempF);
  target = heat.target;

  if (target === 0) return NONE;

  // 4. Compute gels needed using the runner's actual gel size, so the plan
  //    matches what they'll pull from the cupboard. Bigger gels = fewer.
  const gelG = (input.gelCarbsG != null && input.gelCarbsG > 0)
    ? Math.round(input.gelCarbsG)
    : DEFAULT_GEL_CARBS_G;
  const totalCarbsG = Math.round((target * dur) / 60);
  const gels = Math.max(1, Math.round(totalCarbsG / gelG));
  const atMins = gelTimings(dur, gels);

  // 5. Plain-English copy. Use the runner's product name when set so prompts
  //    read "2 Maurten 100s" not generic "2 gels". (NO research citations in
  //    user text — citations live in code comments, not on screen.)
  const whens = atMins.length === 1
    ? `~${fmtMin(atMins[0])} in`
    : `~${atMins.slice(0, -1).map(fmtMin).join(', ')} & ${fmtMin(atMins[atMins.length - 1])} in`;
  const productSingular = (input.gelLabel && input.gelLabel.trim()) || 'gel';
  const productPlural = gels === 1
    ? productSingular
    : (input.gelLabel ? `${input.gelLabel.trim()}s` : 'gels');
  const productPhrase = `${gels} ${gels === 1 ? productSingular : productPlural}`;

  let shortLine: string;
  let why: string;
  if (isRehearsal) {
    shortLine = `Fuel rehearsal: ${productPhrase} at race target (${target} g/hr), ${whens}.`;
    why = `Race-day rehearsal. ${productPhrase} at the same rate and roughly the same spacing you'll run on race day, so race day isn't a surprise to your gut.`;
  } else if (target <= 45) {
    shortLine = `Fuel: ${productPhrase}, ${whens}.`;
    why = `Long runs over ~75 min start to drain glycogen. ${productPhrase} (${target} g/hr) keeps the tank topped up so the last miles don't fall off, and builds the habit your gut needs before race day.`;
  } else {
    shortLine = `Fuel: ${productPhrase} (${target} g/hr), ${whens}.`;
    why = `${dur >= 150 ? 'Two-plus hours of running' : 'Quality work this long'} needs steady carbs. ${productPhrase} at ~${target} g/hr, ${heat.adjusted ? 'reduced for heat. ' : ''}standard endurance fueling rate.`;
  }
  if (heat.adjusted && !isRehearsal) {
    shortLine = shortLine.replace(/\.$/, ` · hot day, dialed back.`);
  }

  return {
    needed: true,
    gels,
    atMins,
    gPerHr: target,
    totalCarbsG,
    isRehearsal,
    heatAdjusted: heat.adjusted,
    shortLine,
    why,
  };
}
