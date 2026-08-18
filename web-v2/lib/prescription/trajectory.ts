/**
 * The authored overload trajectory · "calendar proposes".
 *
 * `Design/adaptive-progression-engine.md` §3 splits progression in two:
 *
 *   > The plan carries a default overload trajectory (W1 24 min -> W2 27 ->
 *   > W3 30 -> W4 recovery -> W5 32 -> W6 34). Progression against it is
 *   > conditional. ... Calendar time proposes progression. Evidence permits or
 *   > modifies it. Calendar time does not update fitness.
 *
 * This module is the FIRST half only — the default trajectory an authored plan
 * carries. The second half (evidence permitting or modifying it) lives with the
 * adaptation model and runs after the runner has actually run something.
 *
 * ## What was there before
 *
 * Nothing. `resolvePrescriptions(cat, phase, level)` resolved ONE string per
 * (distance category, phase, level) and every week of that phase rendered that
 * same string — no week index ever reached rep count or rep duration. The only
 * thing that moved week to week was the pace, and it moved on the calendar
 * (`blendedTPaceForWeek`'s `weekIdx` term, deleted in `fbc61eb9`). So the
 * engine's single progression mechanism was the one the doctrine forbids, and
 * deleting it correctly left the plan frozen: fourteen weeks of the same
 * threshold session at the same pace.
 *
 * ## What this does
 *
 * Every generic quality session in a block now carries a `WorkShape` — reps,
 * minutes per rep, recovery, pace, intent. Week over week the shape is walked
 * through `selectLever` + `advanceShape`, which are the doctrine's own lever
 * ladder and Daniels' own caps. The canonical result, straight out of §2:
 *
 *     W1  4x7 min  @ current threshold effort
 *     W2  4x9 min  @ same effort            (duration lever)
 *     W3  3x12 min @ same effort            (density lever · higher continuity)
 *     W4  recovery                          (no step; the shape holds)
 *     W5  3x14 min @ same effort            (duration lever)
 *
 * ## Pace does not move here, and that is the point
 *
 * At authoring there is no execution evidence, so the adaptation model returns
 * `normal` — "progress as planned" — and `selectLever` gates the pace lever on
 * BOTH exhausting every cheaper lever AND a `strong` band. `normal` can never
 * reach it. A block authored today therefore prescribes demonstrated-fitness
 * pace for its whole length while the stimulus grows underneath it, which is
 * exactly rule 7: "Fitness may stay flat while training progresses."
 *
 * The pace a shape carries is the week's own `tPaceSec`, which since
 * `fbc61eb9` moves only on measured evidence. Nothing here reads a week index
 * to derive a pace, and `EVIDENCE.no-calendar-pace-advance` stays true.
 *
 * ## Scope
 *
 * The GENERIC threshold and interval slots — the ones whose prescription is
 * `rx.threshold` / `rx.intervals`, which is the fixed string the defect is
 * about. The named `Research/04` §15 vocabulary families (hills, fartlek,
 * cutdown, wave tempo, Canova 2K, race-pace sessions) are distinct workouts
 * with doses doctrine states by name; they already rotate week to week, and
 * their prescription string is where their IDENTITY lives. They are left alone
 * deliberately, not by omission.
 */

import {
  advanceShape,
  assignZone,
  atPaceSessionCapMi,
  selectLever,
  totalWorkMinutes,
  CRUISE_RECOVERY_MIN_PER_WORK_MI,
  INTERVAL_REP_MINUTES,
  LIMITER_LEVERS,
  WEEK_LEVEL_LEVERS,
  type ChallengeZone,
  type ProgressionLever,
  type WorkShape,
} from './levers';
import {
  classifyAdaptation,
  type AdaptationInput,
  type AdaptationVerdict,
} from '@/lib/adaptation/adaptation-model';
import { parsePrescription, parseTimeReps } from '@/lib/plan/prescription-parser';
import { atPaceMiOf, composeQualityDay, floatMi as floatMiOf } from '@/lib/plan/quality-day';

/** Which of Daniels' at-pace cap families a session falls under. */
export type SessionFamily = 'threshold' | 'interval';

/**
 * The verdict an authored plan progresses against.
 *
 * Doctrine §3's table gives `normal` -> "progress as planned", and a plan being
 * authored has by definition no execution evidence behind it. Rather than hand-
 * writing that verdict, this asks the real model with everything unknown — so
 * if the model's honest-abstain behaviour ever changes, the authored default
 * changes with it instead of quietly disagreeing.
 */
export function authoringAdaptation(): AdaptationVerdict {
  const blank: AdaptationInput = {
    keySessionsPlanned: null, keySessionsCompleted: null, targetVerdicts: null,
    repConsistency: null, rpeReported: null, rpeHarderThanExpected: null,
    decouplingVerdicts: null, lateDriftBpm: null, easyDiscipline: null,
    recoveryPctOfExpected: null, readinessBelowNormalDays: null, readinessWindowDays: null,
    weeklyPlannedMi: null, weeklyActualMi: null, trainingForm: null,
    distinctEvidenceWeeks: null, adapterDowngrades: null,
    niggleSeverity: null, illnessActive: null, injuryActive: null,
  };
  return classifyAdaptation(blank);
}

/**
 * The ladder a session's own energy system walks when no limiter has been
 * diagnosed.
 *
 * These are §11's own rows, read as a statement about the SESSION rather than
 * about the runner: threshold work grows by duration, then by density, and only
 * eventually by pace; VO2 work grows by rep duration, then by rep count. At
 * authoring the engine has no performance curve to diagnose a real limiter
 * from, so it does not claim one — `selectLever` is handed these as `preferred`,
 * which it treats as strictly weaker than a diagnosed limiter.
 */
export const SESSION_LADDER: Record<SessionFamily, readonly ProgressionLever[]> = {
  threshold: LIMITER_LEVERS.threshold,
  interval: LIMITER_LEVERS.speed_reserve,
};

const LADDER_REASON =
  'no limiter is diagnosed at authoring, so the session\'s own energy system sets the ladder';

/** The smallest rep any quality session may be cut to when a week cannot
 *  afford the trajectory's current shape. Doctrine's own shortest prescribed
 *  quality repetition (`Research/04-workout-vocabulary.md` §6, VO2 reps run
 *  3-5 min); below it the interval stops being a quality rep at all. */
export const MIN_QUALITY_REP_MINUTES = INTERVAL_REP_MINUTES.min;

export interface TrajectoryStep {
  /** The shape to prescribe THIS week, after the week's affordability clamp. */
  shape: WorkShape;
  /** The lever that moved the trajectory this week. Null on a seed week, a
   *  deload, or a week where every lever was at its cap. */
  lever: ProgressionLever | null;
  /** One line stating what changed, in the coach register. */
  change: string;
  /** True when the trajectory wanted to advance and every lever was capped. */
  held: boolean;
  /** True when the week could not afford the trajectory's shape and the
   *  prescription was cut to fit. The trajectory itself is unaffected. */
  clamped: boolean;
  /**
   * The mileage the DAY should carry, when the caller asked for the day to be
   * sized from the session rather than the session cut to fit a day.
   *
   * Null under the legacy `dayBudgetMi` contract, where the caller already
   * knows the day and this module's job was only to fit inside it.
   */
  dayMi: number | null;
  zone: ChallengeZone;
  /** Rendered prescription. Round-trips through `parseTimeReps`, so the spec a
   *  runner's watch executes is parsed back out of this exact string. */
  label: string;
}

interface TrackState {
  shape: WorkShape;
  recentLevers: ProgressionLever[];
  cyclesSinceProbe: number;
  /** The zone the seed named ("T pace", "I-T transition"). */
  paceTag: string | null;
}

/* --------------------------------------------------------------- rendering */

function formatRest(restS: number): string {
  if (restS < 120) return `${Math.round(restS)}s jog`;
  const m = Math.floor(restS / 60);
  const s = Math.round(restS % 60);
  return s === 0 ? `${m} min jog` : `${m}:${String(s).padStart(2, '0')} jog`;
}

/**
 * The prescription a runner reads, rendered FROM the shape.
 *
 * The label and the numbers cannot disagree because there is only one set of
 * numbers: `buildWorkoutSpec` parses this string straight back through
 * `parseTimeReps` to build the spec the watch runs. `renderRoundTrips` below
 * is the assertion of that, and it is checked in the trajectory's own test.
 *
 * The pace is named by ZONE ("@ T pace", "@ I pace") rather than printed as a
 * number, deliberately. The spec resolves the zone to the week's own pace, and
 * that pace is re-derived every time evidence lands (`recomputePacesForPlan`).
 * A number frozen into the label would be correct on the day it was authored
 * and a lie the first time a race moved the anchor — the sub_label/spec drift
 * this codebase has already paid for twice.
 */
export function renderShapeLabel(
  shape: WorkShape,
  family: SessionFamily,
  paceTag?: string | null,
): string {
  const tag = `@ ${paceTag || (family === 'interval' ? 'I pace' : 'T pace')}`;
  const mins = Math.round(shape.repMinutes);
  if (shape.reps <= 1) return `1×${mins} min ${tag}`;
  return `${shape.reps}×${mins} min ${tag} · ${formatRest(Math.round(shape.recoveryMinutes * 60))}`;
}

/**
 * The zone the seed prescription named, so the trajectory does not relabel a
 * session it only resized.
 *
 * The marathon's rep session is authored "@ I-T transition" and its spec paces
 * at T-18, which is deliberately NOT Daniels' I (`buildWorkoutSpec`'s intervals
 * branch says so at length). Rendering it "@ I pace" would be the label making
 * a claim about the pace that the number underneath does not support — a
 * smaller version of exactly the drift this module exists to remove.
 */
export function paceTagOf(prescription: string | null | undefined): string | null {
  if (!prescription) return null;
  const m = prescription.match(/@\s*([^·•]+?)\s*(?:[·•]|$)/);
  const tag = m?.[1]?.trim();
  return tag ? tag : null;
}

/** Does a rendered label parse back to the shape it was rendered from? */
export function renderRoundTrips(shape: WorkShape, family: SessionFamily, paceTag?: string | null): boolean {
  const label = renderShapeLabel(shape, family, paceTag);
  // A distance-rep read would take priority in spec-builder, so it must miss.
  if (parsePrescription(label) != null) return false;
  const back = parseTimeReps(label);
  if (back == null) return false;
  if (back.reps !== shape.reps) return false;
  if (back.durationS !== Math.round(shape.repMinutes) * 60) return false;
  if (shape.reps > 1 && back.restS !== Math.round(shape.recoveryMinutes * 60)) return false;
  return true;
}

/* ------------------------------------------------------------------- seeds */

/**
 * Turn a resolved prescription string into the shape a block opens on.
 *
 * The seed is the prescription the engine ALREADY authored — "4x1mi @ T pace ·
 * 90s jog" — re-expressed in the units the levers move. A block therefore opens
 * exactly where it opened before this module existed, at the doctrine dose
 * `workout_library` (or the inline catalog) states, and only the weeks AFTER
 * week one differ. Nothing here invents an opening session.
 *
 * Distance becomes time at the session's own work pace, which is what makes the
 * duration lever meaningful: one threshold mile is seven minutes for one runner
 * and eleven for another, and doctrine's rep windows are stated in minutes.
 */
export function seedShapeFrom(
  prescription: string | null | undefined,
  paceSPerMi: number,
): WorkShape | null {
  if (!prescription || !(paceSPerMi > 0)) return null;

  const dist = parsePrescription(prescription);
  if (dist != null) {
    const repMinutes = Math.max(1, Math.round((dist.repDistanceMi * paceSPerMi) / 60));
    return {
      reps: dist.reps,
      repMinutes,
      recoveryMinutes: dist.restS != null
        ? dist.restS / 60
        : Math.max(1, Math.round((repMinutes * 60) / paceSPerMi) * CRUISE_RECOVERY_MIN_PER_WORK_MI),
      paceSPerMi,
      zone: 'ESTABLISHED',
    };
  }

  const timed = parseTimeReps(prescription);
  if (timed != null) {
    return {
      reps: timed.reps,
      repMinutes: Math.max(1, Math.round(timed.durationS / 60)),
      recoveryMinutes: (timed.restS ?? 90) / 60,
      paceSPerMi,
      zone: 'ESTABLISHED',
    };
  }

  // Continuous tempos and prose prescriptions carry no rep geometry. The
  // caller keeps its own string; this module has nothing to say about them.
  return null;
}

/* ----------------------------------------------------------- affordability */

/**
 * Minutes of at-pace work ONE session on a `weeklyMi` week can carry.
 *
 * Both of doctrine's bounds: Daniels' share of weekly mileage, and the session
 * band §5.1 / §6.1 state in miles. The share alone lets a high-mileage runner
 * past the top of the band the workout is defined by.
 */
export function atPaceCapMinutes(weeklyMi: number, family: SessionFamily, paceSPerMi: number): number {
  return (atPaceSessionCapMi(weeklyMi, family) * paceSPerMi) / 60;
}

/**
 * Cut a shape down to what THIS week can afford, without touching the
 * trajectory.
 *
 * A build's volume curve rises and falls — a cutback week is 20-25% below the
 * weeks either side of it — and Daniels' at-pace cap is a share of the week's
 * mileage, so the same session is inside doctrine in one week and outside it in
 * the next. The trajectory holds the shape the block has EARNED; this decides
 * what the week can pay for. Reps come off first (the doctrine cap is on total
 * at-pace volume, and fewer reps of the same length preserves the session's
 * character); only when a single rep still overshoots does the rep itself
 * shorten, and never below doctrine's shortest quality repetition.
 */
export function clampToWeek(shape: WorkShape, weeklyMi: number, family: SessionFamily): WorkShape {
  return clampToAtPaceMinutes(shape, atPaceCapMinutes(weeklyMi, family, shape.paceSPerMi));
}

/**
 * The same cut against an explicit ceiling in minutes.
 *
 * `clampToWeek` derives its ceiling from Daniels' share of the week, which is
 * the usual bound. A caller occasionally knows a TIGHTER one — a marathon-pace
 * long week, where the §4.4 cadence session and a full structured session
 * together would breach the week's intensity allowance and the structured
 * session is the one that gives way.
 */
export function clampToAtPaceMinutes(shape: WorkShape, cap: number): WorkShape {
  if (!(cap > 0) || totalWorkMinutes(shape) <= cap) return shape;
  let reps = shape.reps;
  while (reps > 1 && reps * shape.repMinutes > cap) reps--;
  let repMinutes = shape.repMinutes;
  if (reps * repMinutes > cap) {
    repMinutes = Math.max(MIN_QUALITY_REP_MINUTES, Math.floor(cap / reps));
  }
  if (reps === shape.reps && repMinutes === shape.repMinutes) return shape;
  return { ...shape, reps, repMinutes };
}

/**
 * Cut a shape down to the DAY it is printed on.
 *
 * Separate from the weekly share cap and both are needed: the week's cap says
 * how much at-pace work the block can absorb, the day's budget says how much
 * running is scheduled for Tuesday. `buildWorkoutSpec` enforces the day budget
 * on its own — it has to, since a prescription can come from the workout
 * library — but if it enforced it ALONE the label would promise six reps over a
 * spec that runs four, which is the sub_label/spec drift this codebase has
 * fixed twice. Applying the same arithmetic here means the rendered label is
 * already true when the spec is built from it.
 *
 * The floors mirror `timeRepSpec`'s exactly. Two implementations of one rule is
 * how they drift, so the trajectory's own test builds a real spec from a real
 * label and asserts the rep counts match.
 */
export function clampToDay(shape: WorkShape, dayBudgetMi: number, restMinutes: number): WorkShape {
  if (!(dayBudgetMi > 0) || !(shape.paceSPerMi > 0)) return shape;
  const wuFloor = Math.max(0.5, Math.min(1.5, dayBudgetMi * 0.3));
  const cdFloor = Math.max(0.5, Math.min(1.0, dayBudgetMi * 0.25));
  const restMi = (restMinutes * 60) / 540;

  // Longest rep that fits at a given rep count, capped at what was earned.
  const longestAt = (reps: number): number => {
    const roomMi = dayBudgetMi - wuFloor - cdFloor - Math.max(0, reps - 1) * restMi;
    return Math.min(shape.repMinutes, Math.floor((roomMi * shape.paceSPerMi) / 60 / reps));
  };
  if (longestAt(shape.reps) >= shape.repMinutes) return shape;

  // The day cannot hold the whole shape, so prescribe as much of the earned
  // stimulus as it CAN hold. Dropping a rep and shortening the rep are both
  // available and neither dominates — floats cost mileage, so fewer longer reps
  // sometimes fit more work than more shorter ones — so take whichever carries
  // the most at-pace minutes, and break a tie toward the rep count the
  // trajectory actually earned.
  let best: { reps: number; repMinutes: number; work: number } | null = null;
  for (let reps = shape.reps; reps >= 1; reps--) {
    const repMinutes = longestAt(reps);
    if (repMinutes < MIN_QUALITY_REP_MINUTES) continue;
    const work = reps * repMinutes;
    if (!best || work > best.work) best = { reps, repMinutes, work };
  }
  // Nothing legal fits: the day is too short for any doctrine-length rep. One
  // minimum rep is the honest floor — a smaller one would not be quality work.
  if (!best) return { ...shape, reps: 1, repMinutes: MIN_QUALITY_REP_MINUTES };
  if (best.reps === shape.reps && best.repMinutes === shape.repMinutes) return shape;
  return { ...shape, reps: best.reps, repMinutes: best.repMinutes };
}

/* --------------------------------------------------------------- the walker */

/**
 * The block's default overload trajectory, walked one week at a time.
 *
 * Stateful and ordered: the caller must step the weeks in ascending order,
 * which is how `composePlan` already drives `layoutWeek`. Each quality track
 * (threshold, interval) carries its own shape and its own lever history, so a
 * block that alternates a threshold session with a rep session progresses both
 * independently rather than treating them as one ladder.
 */
export class OverloadTrajectory {
  private readonly tracks = new Map<SessionFamily, TrackState>();
  private readonly verdict: AdaptationVerdict;
  /** Every step taken, for the audit surfaces and the sim. */
  readonly log: Array<TrajectoryStep & { weekIdx: number; family: SessionFamily }> = [];

  constructor(verdict?: AdaptationVerdict) {
    this.verdict = verdict ?? authoringAdaptation();
  }

  /**
   * Advance (or hold) one quality track for one week and return what to
   * prescribe. Returns null when the seed prescription carries no rep geometry
   * — a continuous tempo, a prose session — and the caller should keep its own
   * string.
   */
  step(args: {
    family: SessionFamily;
    weekIdx: number;
    /** The resolved prescription for this slot, used only to seed the track. */
    seedPrescription: string | null | undefined;
    /** The week's work pace for this family (s/mi). Threshold sessions take the
     *  week's T; rep sessions take its I. Evidence-derived, never calendar. */
    paceSPerMi: number | null;
    /** The week's planned mileage, for the at-pace caps. */
    weeklyMi: number;
    /** The mileage the week allocated to THIS quality day. The session's
     *  warm-up, reps, floats and cool-down have to fit inside it.
     *
     *  Ignored when `sizeDay` is set — the two are opposite contracts and
     *  `sizeDay` is the one that stops the day budget being the binding
     *  constraint on the runner's progression. */
    dayBudgetMi: number;
    /**
     * Size the DAY from the session instead of cutting the session to fit the
     * day.
     *
     * The day the runner is asked to run is warm-up + work + floats +
     * cool-down, and only the middle term is intensity. Handing the trajectory
     * a whole-day budget charged the easy legs against the hard allowance, so
     * a week whose Daniels cap permitted 5.6 threshold miles prescribed 3.4 and
     * two consecutive weeks of earned progression rendered as one session.
     *
     * `ceilingMi` remains a hard bound — `layoutWeek` passes the rule that the
     * long run stays the week's longest run. When it binds the warm-up and
     * cool-down give way before the work does.
     */
    sizeDay?: {
      ceilingMi: number | null;
      /** A tighter at-pace ceiling than Daniels' share, in miles, when the
       *  caller knows one. Null leaves the share cap alone. */
      atPaceCapMi?: number | null;
    } | null;
    /** True on a cutback / deload week. Doctrine §2's W4: the trajectory does
     *  not step. The deload is the point of the week. */
    isDeload: boolean;
  }): TrajectoryStep | null {
    const { family, weekIdx, seedPrescription, weeklyMi, dayBudgetMi, isDeload } = args;
    const pace = args.paceSPerMi;
    if (pace == null || !(pace > 0)) return null;

    let track = this.tracks.get(family);
    let seeded = false;
    if (!track) {
      const seed = seedShapeFrom(seedPrescription, pace);
      if (!seed) return null;
      track = {
        shape: seed,
        recentLevers: [],
        cyclesSinceProbe: 0,
        paceTag: paceTagOf(seedPrescription),
      };
      this.tracks.set(family, track);
      seeded = true;
    }

    // Re-anchor the carried shape on this week's pace before any cap maths.
    // Without evidence the pace never moves and this is a no-op; with evidence
    // it means the caps are computed against the pace actually prescribed.
    track.shape = { ...track.shape, paceSPerMi: pace };

    let lever: ProgressionLever | null = null;
    let change = 'opening dose for the block';
    let held = false;

    if (seeded) {
      // The seed IS the week's prescription. Advancing on the same week it
      // first appears would skip the dose doctrine states.
    } else if (isDeload) {
      // Doctrine §2's W4 and §13: a recovery week absorbs the block; it does
      // not carry a progression step, and the trajectory resumes from where it
      // stood rather than from the deload.
      change = 'recovery week — the stimulus holds';
    } else {
      const capped: ProgressionLever[] = [];
      for (;;) {
        const sel = selectLever({
          limiter: null,
          preferred: SESSION_LADDER[family],
          preferredReason: LADDER_REASON,
          unavailable: WEEK_LEVEL_LEVERS,
          adaptation: this.verdict,
          recentLevers: track.recentLevers,
          exhausted: capped,
        });
        if (!sel) break;
        const res = advanceShape({
          shape: track.shape,
          lever: sel.lever,
          stepMultiplier: this.verdict.stepMultiplier,
          weeklyMi,
          family,
        });
        if (res.capped) { capped.push(sel.lever); continue; }
        track.shape = res.shape;
        track.recentLevers.push(sel.lever);
        lever = sel.lever;
        change = res.change;
        break;
      }
      if (lever == null) {
        // A held session is a correct outcome, not a failure: the runner is
        // already at the volume doctrine allows for the mileage they are
        // running, and more of it would be over the cap rather than progress.
        held = true;
        change = 'every lever is at its doctrine cap — the session holds';
      }
    }

    track.cyclesSinceProbe++;
    const zone = assignZone({
      adaptation: this.verdict.band,
      lever,
      cyclesSinceProbe: track.cyclesSinceProbe,
    });
    if (zone === 'PROBE') track.cyclesSinceProbe = 0;

    // The week's own at-pace cap always applies — it is Daniels' share of the
    // mileage the runner is actually running, and a cutback week cuts the
    // mileage the share is of.
    let afford = clampToWeek({ ...track.shape, zone }, weeklyMi, family);
    let dayMi: number | null = null;
    if (args.sizeDay) {
      const ceilingMi = args.sizeDay.ceilingMi;
      const atPaceCapMi = args.sizeDay.atPaceCapMi;
      if (atPaceCapMi != null && atPaceCapMi >= 0) {
        afford = clampToAtPaceMinutes(afford, (atPaceCapMi * afford.paceSPerMi) / 60);
      }
      const composed = () => composeQualityDay({
        family,
        atPaceMi: atPaceMiOf(afford),
        floatMi: floatMiOf(afford.reps, afford.recoveryMinutes),
        ceilingMi,
      });
      let day = composed();
      // A ceiling tight enough that the work itself does not fit inside it,
      // once a minimal warm-up and cool-down are paid for, is the one case
      // where the session still has to come down. Cutting reps here rather
      // than leaving the day over its bound is what keeps the rendered label
      // true of the spec `buildWorkoutSpec` builds from it.
      if (ceilingMi != null && ceilingMi > 0 && day.dayMi > ceilingMi + 0.05) {
        afford = clampToDay(afford, ceilingMi, afford.recoveryMinutes);
        day = composed();
      }
      dayMi = Math.min(day.dayMi, ceilingMi != null && ceilingMi > 0 ? ceilingMi : day.dayMi);
    } else {
      afford = clampToDay(afford, dayBudgetMi, track.shape.recoveryMinutes);
    }
    const step: TrajectoryStep = {
      shape: afford,
      lever,
      change,
      held,
      clamped: afford.reps !== track.shape.reps || afford.repMinutes !== track.shape.repMinutes,
      dayMi,
      zone,
      label: renderShapeLabel(afford, family, track.paceTag),
    };
    this.log.push({ ...step, weekIdx, family });
    return step;
  }
}
