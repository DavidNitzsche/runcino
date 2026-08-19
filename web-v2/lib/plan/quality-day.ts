/**
 * lib/plan/quality-day.ts · how many miles a quality DAY is.
 *
 * ## The defect this closes
 *
 * `layoutWeek` sized a quality day as a flat share of weekly volume —
 * `qualityShare = 0.22`, split across the week's quality days. At 55 mi/wk over
 * two quality days that is 6.05 miles for the whole day. Warm-up and cool-down
 * come out of it first, so the runner reached roughly three miles of actual
 * threshold work against a doctrine band of four to eight, on a week whose
 * Daniels cap allowed five and a half.
 *
 * The error is a CATEGORY error, and it is worth naming precisely because the
 * number 0.22 looks defensible on its own. Daniels' at-pace caps (T ≤10% of
 * weekly mileage, I ≤8%, R ≤5%) and the 75-80% easy floor are statements about
 * INTENSITY — they govern the miles run at threshold or above. A quality day's
 * warm-up and cool-down are not those miles. `Research/04-workout-vocabulary.md`
 * §5.3 says so in the same table that states the cap: "Warmup/cooldown | 2-3 mi
 * E each side". E is easy. Charging a day's easy legs against its hard budget
 * spends the intensity allowance twice and leaves the workout short.
 *
 * The cost was not theoretical. With the overload trajectory in place, weeks 5
 * and 6 of a marathon block rendered IDENTICALLY: the trajectory earned 3x13
 * min and then 2x20 min, and the day budget cut both back to the same 26
 * minutes it could afford. The binding constraint on the runner's progression
 * was an arithmetic convenience, sitting ahead of every physiological cap in
 * the engine.
 *
 * ## What a quality day is instead
 *
 *     warm-up (E)  +  at-pace work (doctrine-capped)  +  jog floats (E)  +  cool-down (E)
 *
 * The at-pace half is bounded by `atPaceSessionCapMi` — Daniels' share of the
 * week AND the session band §5.1/§6.1 state in miles. The easy half is bounded
 * by what doctrine prescribes for the session, scaled down when the runner is
 * too small to afford the whole dose.
 *
 * ## This RELOCATES easy miles · it does not add them
 *
 * The property to hold on to. `layoutWeek` fills the remaining days with
 * `remainingMi = weeklyMi - allocated`, so a bigger quality day makes the
 * standalone easy days smaller by exactly as much. The week's total is
 * unchanged and its easy miles are still easy miles — they have moved onto the
 * day that needs them, which is where doctrine always had them. What changes is
 * the intensity distribution, and only because the at-pace work is finally
 * allowed to reach the volume the caps already permitted; the 75% easy floor in
 * `intensity-distribution.ts` still holds it, and `applyIntensityFloor` still
 * corrects a week that drifts under.
 *
 * If a future change here makes the WEEKLY total move, it is wrong.
 */
import {
  AT_PACE_SESSION_MI,
  atPaceSessionCapMi,
  type WorkShape,
} from '@/lib/prescription/levers';

export type QualityFamily = keyof typeof AT_PACE_SESSION_MI;

/**
 * Doctrine's warm-up and cool-down for one quality session, in easy miles.
 *
 * `Research/04-workout-vocabulary.md` §5.2 and §5.3 both give threshold work
 * "Warmup/cooldown | 2-3 mi E each side"; §6.2 gives VO2 work "2-3 mi E +
 * drills + 2-4 strides; 1-2 mi E cooldown" — the same warm-up, a shorter
 * cool-down, because a rep session is already finished by its last jog float
 * where a tempo is not.
 *
 * The engine spends the BOTTOM of each band. A warm-up is a preparation cost
 * paid in fatigue and in the runner's morning; doctrine's minimum is what the
 * session needs, and the top of the band belongs to the runner who wants it,
 * not to a generator choosing on their behalf.
 */
export const QUALITY_WARMUP_MI: Record<QualityFamily, number> = {
  threshold: 2,
  interval: 2,
  // ZONE-R-1 · §7.4's own warm-up row is "Drills + 4 strides" — it states no
  // mileage, because R work is track work and §17.1 "Standard warmup protocol"
  // is where the mileage lives: "1. Easy jog | 10–20 min (1–2 mi)" and
  // "6. Cooldown jog | 10–20 min (1–2 mi)". Bottom of the band, like the two
  // rows above it.
  repetition: 1,
};
export const QUALITY_COOLDOWN_MI: Record<QualityFamily, number> = {
  threshold: 2,
  interval: 1,
  repetition: 1,
};

/**
 * The pace a jog float and a warm-up mile are run at, s/mi.
 *
 * `spec-builder.ts` converts every rest interval to mileage at this number
 * (`restMi = restS / 540`), and the day this module sizes is the day that spec
 * is built against. Deriving it a second way is how the two drift.
 */
export const JOG_PACE_S_PER_MI = 540;

/**
 * Scale doctrine's warm-up and cool-down to a session smaller than the one
 * doctrine was describing.
 *
 * A 20 mi/wk runner's threshold cap is two miles at pace. Handing them
 * doctrine's full 2 + 2 would make the warm-up and cool-down twice the workout
 * and the day a fifth of their week — the shape the brief warns about, where
 * the quality day swallows the week. So the easy legs shrink in proportion to
 * how far the session sits below the at-pace volume doctrine's own WU/CD
 * numbers were quoted against (§5.3 pairs "2-3 mi each side" with "4-8 mi" at
 * pace; §6.2 pairs its numbers with §6.1's "3-6 mi").
 *
 * At or above that reference the scale is 1 and doctrine applies unmodified —
 * a warm-up does not keep growing because the runner does.
 */
export function warmupCooldownMi(
  family: QualityFamily,
  atPaceMi: number,
): { warmupMi: number; cooldownMi: number } {
  const reference = AT_PACE_SESSION_MI[family].min;
  const scale = reference > 0 ? Math.min(1, Math.max(0, atPaceMi) / reference) : 1;
  return {
    warmupMi: Number((QUALITY_WARMUP_MI[family] * scale).toFixed(2)),
    cooldownMi: Number((QUALITY_COOLDOWN_MI[family] * scale).toFixed(2)),
  };
}

/** Miles of easy jogging between reps. Continuous efforts have none. */
export function floatMi(reps: number, recoveryMinutes: number): number {
  if (!(reps > 1) || !(recoveryMinutes > 0)) return 0;
  return Number((((reps - 1) * recoveryMinutes * 60) / JOG_PACE_S_PER_MI).toFixed(2));
}

/** At-pace miles a rep shape carries at its own work pace. */
export function atPaceMiOf(shape: WorkShape): number {
  if (!(shape.paceSPerMi > 0)) return 0;
  return Number(((shape.reps * shape.repMinutes * 60) / shape.paceSPerMi).toFixed(2));
}

export interface QualityDay {
  atPaceMi: number;
  warmupMi: number;
  cooldownMi: number;
  floatMi: number;
  /** The whole day, rounded to the tenth the plan stores distances in. */
  dayMi: number;
}

/**
 * Compose a quality day from its parts.
 *
 * `ceilingMi` is the caller's structural bound — `layoutWeek` passes
 * `qualityCeiling` (the long run stays the week's longest run, and no single
 * day takes 0.6 of the week). When it binds, the EASY legs give way first: the
 * warm-up and cool-down are the part of the day that can shrink without
 * changing what the session is, and cutting the at-pace work to protect a full
 * warm-up would reintroduce the defect this module exists to remove. Only when
 * the ceiling is tighter than the work plus a minimal warm-up does the day
 * report short, and the caller's own rep clamp handles that case.
 */
export function composeQualityDay(args: {
  family: QualityFamily;
  atPaceMi: number;
  /** Jog recovery inside the session, in miles. Continuous work passes 0. */
  floatMi?: number;
  ceilingMi?: number | null;
}): QualityDay {
  const atPaceMi = Math.max(0, args.atPaceMi);
  const floats = Math.max(0, args.floatMi ?? 0);
  let { warmupMi, cooldownMi } = warmupCooldownMi(args.family, atPaceMi);

  // Never budget LESS warm-up or cool-down than `spec-builder` will insist on.
  //
  // It re-imposes its own floors — 30% of the day capped at 1.5 mi, 25% capped
  // at 1.0 — when it turns this day into the spec a watch runs, and if the day
  // reserved less it takes the difference out of the REPS. A VO2 session is
  // where this bites: doctrine's cool-down is a single mile (§6.2) against
  // spec-builder's 1.0 floor, so seven hundredths of a mile of disagreement
  // dropped a rep off a six-rep set. Two implementations of one rule is how
  // they drift; this makes the day the looser of the two by construction.
  // The floors depend on the day and the day on the floors, so it settles.
  for (let i = 0; i < 3; i++) {
    const day = warmupMi + atPaceMi + floats + cooldownMi;
    const wuFloor = Math.max(0.5, Math.min(1.5, day * 0.3));
    const cdFloor = Math.max(0.5, Math.min(1.0, day * 0.25));
    if (warmupMi >= wuFloor - 1e-9 && cooldownMi >= cdFloor - 1e-9) break;
    warmupMi = Math.max(warmupMi, wuFloor);
    cooldownMi = Math.max(cooldownMi, cdFloor);
  }
  warmupMi = Number(warmupMi.toFixed(2));
  cooldownMi = Number(cooldownMi.toFixed(2));

  const ceiling = args.ceilingMi != null && args.ceilingMi > 0 ? args.ceilingMi : Infinity;
  const over = warmupMi + atPaceMi + floats + cooldownMi - ceiling;
  if (over > 0) {
    // Give back proportionally so neither leg vanishes while the other stays
    // whole, and never below the floors `spec-builder` will re-impose anyway —
    // a budget promising less warm-up than the spec builds is the sub_label/spec
    // drift this codebase has already paid for twice.
    const easy = warmupMi + cooldownMi;
    const keep = Math.max(0, easy - over);
    const ratio = easy > 0 ? keep / easy : 0;
    warmupMi = Number(Math.max(Math.min(warmupMi, 1.5), warmupMi * ratio).toFixed(2));
    cooldownMi = Number(Math.max(Math.min(cooldownMi, 1.0), cooldownMi * ratio).toFixed(2));
  }

  const dayMi = Number((warmupMi + atPaceMi + floats + cooldownMi).toFixed(1));
  return { atPaceMi, warmupMi, cooldownMi, floatMi: floats, dayMi };
}

/**
 * The largest quality day of `family` a `weeklyMi` week can author.
 *
 * Used where the composer needs a day SIZE before it has a session — the
 * race-prep long-run cap reserves room for the week's quality days before the
 * week's workout types are resolved. Sized off the at-pace cap rather than off
 * any particular prescription, so it is an upper bound and the reservation is
 * never short.
 */
export function maxQualityDayMi(args: {
  family: QualityFamily;
  weeklyMi: number;
  paceSPerMi: number | null;
  ceilingMi?: number | null;
}): number {
  const atPaceMi = atPaceSessionCapMi(args.weeklyMi, args.family);
  // Recovery at doctrine's own ratio: cruise floats run one minute per mile of
  // work (§5.3), VO2 floats run roughly the rep (§6). Both land near the same
  // place per at-pace mile once the rep window is applied, and this is a
  // reservation, so the more generous read is the safe one.
  const paceS = args.paceSPerMi != null && args.paceSPerMi > 0 ? args.paceSPerMi : JOG_PACE_S_PER_MI;
  const floats = args.family === 'interval'
    ? Number(((atPaceMi * paceS) / JOG_PACE_S_PER_MI).toFixed(2))
    : Number(((atPaceMi * 60) / JOG_PACE_S_PER_MI).toFixed(2));
  return composeQualityDay({ family: args.family, atPaceMi, floatMi: floats, ceilingMi: args.ceilingMi }).dayMi;
}
