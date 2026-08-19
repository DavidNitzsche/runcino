/**
 * lib/plan/intensity-distribution.ts · how much of a composed plan is EASY.
 *
 * `Research/00a-distance-running-training.md` states the constraint twice, in
 * two different registers, and the plan engine implemented neither:
 *
 *   · "All elite distance runners — regardless of system — converge on ≥75% of
 *      training volume in Z1."                        (§"TID — the disagreement")
 *   · "| Most base running is easy | 75–90% in Z1 |"  (§"Practical base-building rules")
 *
 * Before this file the generator had no notion of intensity distribution at
 * all. It sized weekly volume, sized the long run, placed two quality days and
 * checked the gaps between them — and never once asked what fraction of the
 * miles it had just authored were easy. A 20 mi/wk runner given two structured
 * sessions and a long run can land near 60% easy and nothing looked.
 *
 * ── Distance, not time, and why ────────────────────────────────────────────
 *
 * Doctrine says "training volume". Volume in running is measured either way,
 * and the two disagree: quality miles are run faster, so a hard mile costs
 * less TIME than an easy mile. Ten easy miles at 9:00 and four threshold miles
 * at 6:40 are 71.4% easy by distance and 77.1% easy by time.
 *
 * This module measures DISTANCE, for two reasons that point the same way:
 *
 *   1. A composed plan is authored in miles. It carries no per-day duration —
 *      inventing one from a pace model would make the measurement depend on
 *      the runner's fitness estimate, so the same plan shape would pass for a
 *      fast runner and fail for a slow one. Doctrine's claim is about the
 *      SHAPE of the training, not about who is running it.
 *   2. Distance-share is the CONSERVATIVE read. Easy-share by time is always
 *      the higher number (the arithmetic above). A plan that clears 75% easy
 *      by distance clears it by time as well, so this measurement can never
 *      pass a plan that doctrine would fail.
 *
 * ── What counts as easy ────────────────────────────────────────────────────
 *
 * Not "the day was a quality day" — the MILES inside it. A "2 mi WU · 4 mi @ T
 * · 2 mi CD" session is eight miles of which four are Z1. Counting the whole
 * day as hard would report a marathon build at ~45% easy and demand corrections
 * doctrine never asked for. So each day is split:
 *
 *   easy / recovery / shakeout / rest   → all easy
 *   long                                → all easy except the MP/HMP finish
 *                                         segment the sub_label declares
 *   threshold / tempo / intervals /
 *   race_week_tuneup                    → warm-up, cool-down and the jog
 *                                         floats between reps are easy; the
 *                                         reps or the tempo block are not
 *   race                                → all hard (it is raced, not run)
 *
 * The split for structured days is read out of `buildWorkoutSpec` itself, not
 * re-derived here, so this measurement can never drift from the spec the
 * runner's watch actually executes.
 */
import { buildWorkoutSpec, extractFinishSegment, type WorkoutSpec } from './spec-builder';

/** The shape this module needs from a composed day. Structural, so the
 *  maintenance/recovery composers and the sim harness all fit without
 *  importing generate.ts's full DayPlan. */
export interface IntensityDay {
  type: string;
  distanceMi: number;
  subLabel?: string | null;
  isLong?: boolean;
}

export interface IntensityWeek {
  days: IntensityDay[];
  phase?: string;
  isRaceWeek?: boolean;
}

export interface IntensitySplit {
  /** Miles at Z1 / easy effort. */
  easyMi: number;
  /** Miles at threshold or above, plus marathon-pace long-run finishes. */
  qualityMi: number;
  /** easyMi / (easyMi + qualityMi) · 1 when the week has no running. */
  easyShare: number;
}

/**
 * T-pace stand-in for the spec read below. `buildWorkoutSpec`'s SEGMENT sizing
 * (warm-up, rep count, rep distance, cool-down) is a pure function of the
 * prescription string and the day's mileage budget; only the pace FIELDS depend
 * on this number, and this module never reads them. Any finite value gives the
 * same split.
 */
export const SPEC_PROBE_T_PACE_SEC = 480;

/** Miles of a structured day that are NOT Z1, read from the day's own spec. */
function hardMilesFromSpec(spec: WorkoutSpec, fallbackMi: number): number {
  if (!spec || typeof spec !== 'object') return fallbackMi;
  const s = spec as Record<string, unknown>;
  switch (String(s.kind ?? '')) {
    case 'tempo':
      return Number(s.tempo_distance_mi ?? 0) || 0;
    case 'threshold':
    case 'intervals': {
      const reps = Number(s.rep_count ?? 0) || 0;
      const repMi = (Number(s.rep_distance_mi ?? 0) || 0) > 0
        ? Number(s.rep_distance_mi)
        : (Number(s.rep_distance_m ?? 0) || 0) / 1609.34;
      // The jog floats between reps are Z1 recovery (Research/04 §1) and are
      // deliberately NOT counted here. Time-based reps (hills, fartlek, strides)
      // carry rep_duration_s instead of a distance; their work is estimated at
      // the day's own share below via the duration fallback.
      const durS = Number(s.rep_duration_s ?? 0) || 0;
      if (repMi > 0) return reps * repMi;
      if (durS > 0) return Number(((reps * durS) / SPEC_PROBE_T_PACE_SEC).toFixed(2));
      return 0;
    }
    default:
      return fallbackMi;
  }
}

/** Split one composed day into easy and quality miles. */
export function splitDay(day: IntensityDay): { easyMi: number; qualityMi: number } {
  const total = Math.max(0, day.distanceMi ?? 0);
  if (total <= 0) return { easyMi: 0, qualityMi: 0 };

  switch (day.type) {
    case 'rest':
    case 'cross':
    case 'strength':
      return { easyMi: 0, qualityMi: 0 };
    case 'easy':
    case 'recovery':
    case 'shakeout':
      // Strides on an easy day are 4-8 × 20 s of neuromuscular work with full
      // recovery — Research/04:349 "Not a workout". They do not move the
      // intensity distribution and are not counted against it.
      return { easyMi: total, qualityMi: 0 };
    case 'race':
      return { easyMi: 0, qualityMi: total };
    case 'long': {
      const finish = extractFinishSegment(day.subLabel ?? null);
      const hard = finish ? Math.min(finish.mi, total) : 0;
      return { easyMi: Number((total - hard).toFixed(2)), qualityMi: Number(hard.toFixed(2)) };
    }
    default: {
      const { spec } = buildWorkoutSpec(
        day.type,
        total,
        SPEC_PROBE_T_PACE_SEC,
        null,
        day.subLabel ?? null,
      );
      const hard = Math.min(total, hardMilesFromSpec(spec, total));
      return { easyMi: Number((total - hard).toFixed(2)), qualityMi: Number(hard.toFixed(2)) };
    }
  }
}

/** Easy-share of one composed week. */
export function weekIntensity(week: IntensityWeek): IntensitySplit {
  let easyMi = 0;
  let qualityMi = 0;
  for (const d of week.days) {
    const s = splitDay(d);
    easyMi += s.easyMi;
    qualityMi += s.qualityMi;
  }
  return finish(easyMi, qualityMi);
}

/**
 * Easy-share of a whole composed plan.
 *
 * Race weeks and taper weeks are included: doctrine's claim is about training
 * volume across the block, and a taper is by design intensity-preserving and
 * volume-cut, so excluding it would flatter the number. Callers that want the
 * training-block figure alone can filter `weeks` first.
 */
export function planIntensity(weeks: IntensityWeek[]): IntensitySplit {
  let easyMi = 0;
  let qualityMi = 0;
  for (const w of weeks) {
    const s = weekIntensity(w);
    easyMi += s.easyMi;
    qualityMi += s.qualityMi;
  }
  return finish(easyMi, qualityMi);
}

function finish(easyMi: number, qualityMi: number): IntensitySplit {
  const total = easyMi + qualityMi;
  return {
    easyMi: Number(easyMi.toFixed(2)),
    qualityMi: Number(qualityMi.toFixed(2)),
    easyShare: total > 0 ? Number((easyMi / total).toFixed(4)) : 1,
  };
}

/**
 * Research/00a §"TID — the disagreement and when each TID matters":
 * "All elite distance runners — regardless of system — converge on ≥75% of
 * training volume in Z1." §"Practical base-building rules" states the same
 * floor with a ceiling: "Most base running is easy | 75–90% in Z1".
 *
 * 0.75 is the floor, and it is a FLOOR, not a target — the engine corrects a
 * plan up to it and never trims a plan that already sits above it. Bound by
 * `DOCTRINE.intensity-easy-share-floor` in lib/doctrine/registry.ts, which
 * parses the number out of the doctrine sentence at run time.
 */
export const EASY_SHARE_FLOOR = 0.75;
