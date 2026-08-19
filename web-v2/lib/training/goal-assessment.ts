/**
 * lib/training/goal-assessment.ts · the honest read on a stated goal.
 *
 * ── What was missing ──────────────────────────────────────────────────────
 *
 * The app accepted whatever goal the runner typed and reported a gap against
 * it, forever. It had no way to say "that is aggressive", no way to name what
 * the build is genuinely worth, and no second number to report progress
 * against while the stated goal stayed on the board. A runner could sit four
 * months in a block being told, truthfully, how far behind a goal they were,
 * and never once be told the goal was the thing that did not fit.
 *
 * This module produces that read: a feasibility verdict, a SAFE target and a
 * STRETCH target, one plain sentence, and cautions that name the limiter.
 *
 * ── The three rules it obeys ──────────────────────────────────────────────
 *
 * 1. THE GOAL DOES NOT DRIVE THE PACES. Locked ruling (`feedback_execution_is_
 *    the_lever`): paces come from measured evidence, the goal is ambition.
 *    Nothing here writes a pace, a VDOT anchor, or a plan. It reads.
 *
 * 2. NOTHING MODELLED IS PRESENTED AS MEASURED. Every field that comes out of
 *    the gain model carries `basis: 'projected'`. `currentEquivalentSec` is
 *    the one field derived from evidence (the runner's own VDOT through the
 *    Daniels table) and is labelled as an equivalence, not a result.
 *
 * 3. NEVER SCOLD. An ambitious goal is a good thing to have. The verdict names
 *    what the build is worth and says the goal stays on the board. House voice
 *    (Design/running-app-design-brief-v2.md): short, direct, no hype, no
 *    exclamation marks, no emoji, no em dashes.
 *
 * ── Where the numbers come from ───────────────────────────────────────────
 *
 * Every threshold is doctrine, and every one of them is bound by a claim:
 *
 *   · the gain band            Research/01 §"Testing cadence" (reassess every
 *                              4-6 weeks, +1 VDOT) → lib/training/vdot-gain-
 *                              rate.ts, ADAPTATION.vdot-gain-rate
 *   · the latent headroom      Research/01 §"Triggers to retest" ("Add 2-3
 *                              VDOT points") → LATENT_VDOT_UPGRADE_MAX
 *   · the volume floor         Research/00a §"Volume table" beginner column →
 *                              MIN_WEEKLY_MI_FOR_DISTANCE,
 *                              VOLUME.goal-assessment-floor
 *   · anchor staleness         Research/01 freshness window → VDOT_FULL_
 *                              VALUE_DAYS / VDOT_EXPIRY_DAYS (already bound)
 *   · the marathon lag         Research/01 §"Marathon-specific correction"
 *                              (subtract 1.5 VDOT without a marathon block)
 *
 * A prototype in this repo (adaptive-engine/src/goal/assess.ts) has the right
 * SHAPE and the right VOICE and is worth reading for both. Not one number was
 * taken from it: it carries zero `Research/` references across 6,700 lines,
 * and its rates, multipliers and volume multiples are all uncited.
 *
 * ── Per-finding context filters ───────────────────────────────────────────
 *
 * CLAUDE.md §"Per-finding context filters", locked 2026-05-19: a surface that
 * aggregates N findings runs N filter applications, one per finding. The
 * surface-level guard does not protect the sub-findings. So each caution below
 * asks its OWN question about context rather than inheriting one from the
 * assessment:
 *
 *   · the VOLUME caution asks "is volume low because the runner is tapering or
 *     recovering from a race?" — a taper week is the plan working, not a
 *     limiter, and blaming it would repeat the exact V5-Z2 defect.
 *   · the EVIDENCE caution asks "is the anchor stale?" and skips entirely when
 *     the runner has a fresh one, regardless of how thin the rest looks.
 *   · the RUNWAY caution asks "is there a date at all?" — a no-date goal has
 *     no short runway to warn about.
 *   · the MARATHON-LAG caution asks "is the anchor a short race?" and never
 *     fires off distance alone.
 *
 * Cite: Research/01-pace-zones-vdot.md §"Testing cadence"
 * Cite: Research/00a-distance-running-training.md §"Volume Guidelines by Experience and Distance"
 */

import { predictRaceTime, vdotFromRace, formatRaceTime, VDOT_FULL_VALUE_DAYS } from './vdot';
import {
  VDOT_GAIN_PER_WEEK_MAX,
  VDOT_GAIN_PER_WEEK_CONSERVATIVE,
  MAX_BLOCK_GAIN_VDOT,
  LATENT_VDOT_UPGRADE_MAX,
} from './vdot-gain-rate';
import { taperWeeksForDistance } from './fitness-trajectory';
import { distanceCategoryOrNull, type DistanceCategory } from '@/lib/race/distance-category';

/**
 * How the stated goal sits against what the build can deliver.
 *
 *   comfortable   · today's fitness already covers it
 *   realistic     · inside the SLOW edge of the doctrine gain band
 *   ambitious     · needs the FAST edge, held the whole way
 *   aggressive    · beyond the modelled build, inside the latent headroom
 *                   doctrine recognises off a single strong performance
 *   out-of-reach  · beyond both
 *   open-ended    · a real gap with NO date on it. Not out of reach — there is
 *                   no deadline for it to be out of reach of. The honest
 *                   answer is how long, not whether, so the assessment
 *                   reports a weeks-to-reach band instead of a verdict about
 *                   a runway that does not exist.
 *   date-passed   · the goal date is behind us
 *   unreadable    · no usable fitness evidence yet, or a distance past the
 *                   Daniels validity range
 */
export type GoalFeasibility =
  | 'comfortable'
  | 'realistic'
  | 'ambitious'
  | 'aggressive'
  | 'out-of-reach'
  | 'open-ended'
  | 'date-passed'
  | 'unreadable';

/**
 * Minimum weekly mileage a distance genuinely wants, miles.
 *
 * The LOW edge of the "Beginner (just finishing)" column in Research/00a's
 * §"Volume table — miles per week (km in parentheses)". Deliberately the
 * gentlest number in the doc: this gates a caution, not a plan, and a caution
 * that fires on a competent recreational runner is a caution people learn to
 * ignore. Bound by VOLUME.goal-assessment-floor, which parses the column.
 *
 * The ultra row uses the 50K row, which is the shortest ultra doctrine tables.
 */
export const MIN_WEEKLY_MI_FOR_DISTANCE: Readonly<Record<DistanceCategory, number>> = {
  '5k': 10,
  '10k': 15,
  'hm': 20,
  'm': 25,
  'ultra': 30,
};

export interface GoalAssessmentContext {
  /** Inside a planned taper or race week · volume is deliberately down. */
  inTaperOrRaceWeek?: boolean | null;
  /** Inside the post-race recovery block · volume is deliberately down. */
  inPostRaceRecovery?: boolean | null;
  /** Distance (mi) of the race/effort the current VDOT is anchored on. Drives
   *  the marathon-specific lag caution and nothing else. */
  anchorDistanceMi?: number | null;
  /** Age of that anchor in days. Drives the evidence caution and nothing else. */
  anchorAgeDays?: number | null;
  /** Has the runner done a marathon-specific block (Research/01 defines it as
   *  >=6 weeks of long runs >=18 mi and MP work >=6 mi)? null = unknown, which
   *  suppresses the caution rather than assuming either way. */
  marathonSpecificBlockDone?: boolean | null;
}

export interface GoalAssessmentInput {
  distanceMi: number;
  goalSec: number;
  /** Race day or goal deadline. Null for an open-ended distance goal. */
  goalDateISO: string | null;
  /** The runner's today, not the server's. */
  todayISO: string;
  /** Measured current fitness. Null at cold start. */
  currentVdot: number | null;
  /** 0..1 measured execution signal. Null when there is none yet, and an
   *  absent signal must not score against the runner (the same posture as
   *  CONVENTION.absent-pillars-do-not-score). */
  executionQuality?: number | null;
  /** Measured recent weekly mileage, miles. */
  recentWeeklyMi?: number | null;
  context?: GoalAssessmentContext;
}

export interface GoalAssessment {
  distanceMi: number;
  goalSec: number;
  goalDateISO: string | null;
  /** Weeks from today to the goal date. Null when there is no date. */
  weeksAvailable: number | null;
  /** Weeks of that runway that actually build fitness (runway minus this
   *  distance's taper). Null when there is no date. */
  buildWeeks: number | null;

  /** Measured. The runner's own VDOT. */
  currentVdot: number | null;
  /** Derived from measured VDOT through the Daniels table. An EQUIVALENCE of
   *  today's fitness, not a result the runner ran. */
  currentEquivalentSec: number | null;
  /** What the goal time demands. Null when the goal maps off the table. */
  requiredVdot: number | null;
  /** VDOT/week the goal needs from here. Null with no date or no fitness. */
  requiredVdotRatePerWeek: number | null;

  /** The doctrine gain band, echoed so a surface can show the comparison. */
  plausibleVdotRatePerWeek: { conservative: number; max: number };

  feasibility: GoalFeasibility;
  /** PROJECTED. What the build is worth at the conservative edge of the
   *  doctrine band, scaled by measured execution. Null when unreadable. */
  safeTargetSec: number | null;
  /** PROJECTED. The same at the fast edge, assuming clean execution. */
  stretchTargetSec: number | null;
  /** The target the app should report progress against while the stated goal
   *  stays on the board. The goal itself whenever the goal is inside the
   *  build; the safe target once it is not. */
  reportAgainstSec: number | null;
  /** True when reportAgainstSec is NOT the stated goal, i.e. the surface is
   *  showing an honest second number. */
  reportingAgainstSafeTarget: boolean;

  /** PROJECTED. For an open-ended goal (no date), how many weeks of build the
   *  doctrine band says the gap is worth: `min` at the fast edge, `max` at the
   *  slow edge. Null whenever there IS a date, because then the question is
   *  whether the runway covers it, not how long it would take. */
  weeksToReach: { min: number; max: number } | null;

  /** One sentence, house voice. */
  statement: string;
  /** Zero or more limiter notes, each independently context-filtered. */
  cautions: string[];

  /** Everything above that came out of the gain model is modelled, not
   *  measured. No surface may render these as observed fitness. */
  basis: 'projected';
}

const SEC_PER_DAY = 86400000;

function weeksBetween(fromISO: string, toISO: string): number {
  const a = Date.parse(fromISO.slice(0, 10) + 'T12:00:00Z');
  const b = Date.parse(toISO.slice(0, 10) + 'T12:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  return (b - a) / SEC_PER_DAY / 7;
}

function fmt(sec: number | null): string {
  return formatRaceTime(sec) ?? '—';
}

/** "14 weeks" / "1 week". Rounded, because nobody races on 13.6 weeks. */
function weeksPhrase(weeks: number): string {
  const w = Math.max(0, Math.round(weeks));
  return w === 1 ? '1 week' : `${w} weeks`;
}

/**
 * Assess a stated goal. Pure · `todayISO` keeps it deterministic and the
 * caller owns every read.
 */
export function assessGoal(input: GoalAssessmentInput): GoalAssessment {
  const {
    distanceMi,
    goalSec,
    goalDateISO,
    todayISO,
    currentVdot,
    recentWeeklyMi = null,
  } = input;
  const ctx = input.context ?? {};

  const plausible = {
    conservative: VDOT_GAIN_PER_WEEK_CONSERVATIVE,
    max: VDOT_GAIN_PER_WEEK_MAX,
  };

  const rawWeeks = goalDateISO ? weeksBetween(todayISO, goalDateISO) : null;
  const datePassed = rawWeeks != null && Number.isFinite(rawWeeks) && rawWeeks < 0;
  const weeksAvailable =
    rawWeeks == null || !Number.isFinite(rawWeeks) ? null : Math.max(0, rawWeeks);
  const taperWeeks = taperWeeksForDistance(distanceMi);
  const buildWeeks = weeksAvailable == null ? null : Math.max(0, weeksAvailable - taperWeeks);

  const currentEquivalentSec =
    currentVdot != null && currentVdot > 0 ? predictRaceTime(currentVdot, distanceMi) : null;
  const requiredVdot = vdotFromRace(goalSec, distanceMi);

  const base = {
    distanceMi,
    goalSec,
    goalDateISO,
    weeksAvailable: weeksAvailable == null ? null : Math.round(weeksAvailable * 10) / 10,
    buildWeeks: buildWeeks == null ? null : Math.round(buildWeeks * 10) / 10,
    currentVdot,
    currentEquivalentSec: currentEquivalentSec == null ? null : Math.round(currentEquivalentSec),
    requiredVdot: requiredVdot == null ? null : Math.round(requiredVdot * 10) / 10,
    plausibleVdotRatePerWeek: plausible,
    basis: 'projected' as const,
  };

  // ── the goal date is behind us ──────────────────────────────────────────
  // Checked before everything else: no verdict about a build is meaningful
  // once the runway is negative, and quietly reporting a gap against a date
  // that has passed is how a stale goal survives a whole season.
  if (datePassed) {
    return {
      ...base,
      weeksAvailable: 0,
      buildWeeks: 0,
      requiredVdotRatePerWeek: null,
      feasibility: 'date-passed',
      safeTargetSec: null,
      stretchTargetSec: null,
      reportAgainstSec: null,
      reportingAgainstSafeTarget: false,
      weeksToReach: null,
      statement: `The ${fmt(goalSec)} target date has passed. Set a new date and this reads again.`,
      cautions: [],
    };
  }

  // ── no usable fitness evidence, or an unreadable distance ───────────────
  // currentEquivalentSec is null when there is no VDOT (cold start) OR when
  // the distance is past the Daniels validity range (predictRaceTime refuses
  // beyond the marathon). Both mean the same thing here: nothing honest to
  // say about what the build is worth. Say that rather than a number.
  if (currentVdot == null || !(currentVdot > 0) || currentEquivalentSec == null) {
    return {
      ...base,
      requiredVdotRatePerWeek: null,
      feasibility: 'unreadable',
      safeTargetSec: null,
      stretchTargetSec: null,
      reportAgainstSec: null,
      reportingAgainstSafeTarget: false,
      weeksToReach: null,
      statement:
        'Not enough logged running yet to say what this goal is worth. A race or a hard time trial would settle it.',
      cautions: [],
    };
  }

  // ── an open-ended goal ──────────────────────────────────────────────────
  // No date means no runway, and a goal cannot be out of reach of a deadline
  // that does not exist. Before this branch existed, a 5K runner asking for six
  // VDOT points with no date read "out of reach ... a bigger jump than training
  // delivers in the time" — a verdict about time, delivered to someone who had
  // not named any. The honest question is HOW LONG, and doctrine answers it
  // directly: the gap divided by each edge of the reassessment band.
  if (goalDateISO == null) {
    const requiredVdotOpen = requiredVdot;
    const gainNeeded =
      requiredVdotOpen == null
        ? (goalSec >= currentEquivalentSec ? 0 : null)
        : requiredVdotOpen - currentVdot;
    if (gainNeeded != null && gainNeeded <= 0) {
      return {
        ...base,
        requiredVdotRatePerWeek: null,
        feasibility: 'comfortable',
        safeTargetSec: null,
        stretchTargetSec: null,
        reportAgainstSec: goalSec,
        reportingAgainstSafeTarget: false,
        weeksToReach: null,
        statement: composeStatement({
          feasibility: 'comfortable',
          goalSec,
          currentEquivalentSec,
          safeTargetSec: null,
          weeksAvailable: null,
          weeksToReach: null,
        }),
        cautions: composeCautions({
          feasibility: 'comfortable', distanceMi, weeksAvailable: null, recentWeeklyMi, ctx,
        }),
      };
    }
    if (gainNeeded == null) {
      // Off the TOP of the table · unreadable, same as the dated case.
      return {
        ...base,
        requiredVdotRatePerWeek: null,
        feasibility: 'unreadable',
        safeTargetSec: null,
        stretchTargetSec: null,
        reportAgainstSec: null,
        reportingAgainstSafeTarget: false,
        weeksToReach: null,
        statement: composeStatement({
          feasibility: 'unreadable', goalSec, currentEquivalentSec,
          safeTargetSec: null, weeksAvailable: null, weeksToReach: null,
        }),
        cautions: [],
      };
    }
    const weeksToReach = {
      min: Math.ceil(gainNeeded / plausible.max),
      max: Math.ceil(gainNeeded / plausible.conservative),
    };
    const openCautions = composeCautions({
      feasibility: 'open-ended', distanceMi, weeksAvailable: null, recentWeeklyMi, ctx,
    });
    if (gainNeeded > MAX_BLOCK_GAIN_VDOT) {
      // Beyond one block's ceiling the weeks band is an extrapolation across
      // blocks, and doctrine says adaptation saturates as a runner approaches
      // their ceiling (Research/00a §"Aerobic Base Development"). Say so.
      openCautions.unshift(
        'This is more than one training block delivers. The estimate assumes several blocks back to back, and it will get sharper with every race or time trial.',
      );
    }
    return {
      ...base,
      requiredVdotRatePerWeek: null,
      feasibility: 'open-ended',
      safeTargetSec: null,
      stretchTargetSec: null,
      reportAgainstSec: goalSec,
      reportingAgainstSafeTarget: false,
      weeksToReach,
      statement: composeStatement({
        feasibility: 'open-ended',
        goalSec,
        currentEquivalentSec,
        safeTargetSec: null,
        weeksAvailable: null,
        weeksToReach,
      }),
      cautions: openCautions,
    };
  }

  // ── the gain band, over the weeks that actually build ───────────────────
  // Execution scales the SAFE edge only. The stretch edge is what a clean
  // block delivers, which is what makes it a stretch. An absent execution
  // signal scores 1.0: absence of evidence is not evidence of a bad block.
  const exec =
    input.executionQuality == null ? 1 : Math.max(0, Math.min(1, input.executionQuality));
  const bw = buildWeeks ?? 0;
  const safeGain = Math.min(MAX_BLOCK_GAIN_VDOT, plausible.conservative * bw * exec);
  const stretchGain = Math.min(MAX_BLOCK_GAIN_VDOT, plausible.max * bw);

  const safeTargetSec = predictRaceTime(currentVdot + safeGain, distanceMi);
  const stretchTargetSec = predictRaceTime(currentVdot + stretchGain, distanceMi);

  // A goal off the bottom of the Daniels table (slower than VDOT 30) has no
  // requiredVdot to compare. The seconds comparison is still honest, so read
  // it directly rather than synthesising a VDOT for the goal.
  const goalIsSlowerThanToday = goalSec >= currentEquivalentSec;
  const requiredGain = requiredVdot == null ? (goalIsSlowerThanToday ? 0 : null) : requiredVdot - currentVdot;

  const requiredVdotRatePerWeek =
    requiredGain != null && weeksAvailable != null && weeksAvailable > 0
      ? Math.round((requiredGain / weeksAvailable) * 1000) / 1000
      : null;

  let feasibility: GoalFeasibility;
  if (requiredGain == null) {
    // Off the TOP of the table (faster than VDOT 85). generate.ts's GOAL-4
    // guard is the designated gate for that; from here it is unreadable.
    feasibility = 'unreadable';
  } else if (requiredGain <= 0) {
    feasibility = 'comfortable';
  } else if (bw <= 0) {
    // A goal that needs a gain with no build weeks left: the taper expresses
    // fitness, it does not add any. Whether that is aggressive or out of
    // reach is decided by the latent headroom alone.
    feasibility = requiredGain <= LATENT_VDOT_UPGRADE_MAX ? 'aggressive' : 'out-of-reach';
  } else if (requiredGain <= safeGain) {
    feasibility = 'realistic';
  } else if (requiredGain <= stretchGain) {
    feasibility = 'ambitious';
  } else if (requiredGain <= stretchGain + LATENT_VDOT_UPGRADE_MAX) {
    feasibility = 'aggressive';
  } else {
    feasibility = 'out-of-reach';
  }

  // Report against the goal while the goal is inside what the build delivers.
  // Past that, report against the safe target and say so. The stated goal is
  // never removed; the plan keeps training for it.
  const reportingAgainstSafeTarget =
    (feasibility === 'aggressive' || feasibility === 'out-of-reach') && safeTargetSec != null;
  const reportAgainstSec = reportingAgainstSafeTarget ? Math.round(safeTargetSec!) : goalSec;

  const statement = composeStatement({
    feasibility,
    goalSec,
    currentEquivalentSec,
    safeTargetSec,
    weeksAvailable,
    weeksToReach: null,
  });

  const cautions = composeCautions({
    feasibility,
    distanceMi,
    weeksAvailable,
    recentWeeklyMi,
    ctx,
  });

  return {
    ...base,
    requiredVdotRatePerWeek,
    feasibility,
    safeTargetSec: safeTargetSec == null ? null : Math.round(safeTargetSec),
    stretchTargetSec: stretchTargetSec == null ? null : Math.round(stretchTargetSec),
    reportAgainstSec,
    reportingAgainstSafeTarget,
    weeksToReach: null,
    statement,
    cautions,
  };
}

// ─── voice ─────────────────────────────────────────────────────────────────

/**
 * One sentence per verdict. House voice: short, direct, no hype, no
 * exclamation marks, no emoji, no em dashes, and never a word of blame for an
 * ambitious goal. Exported for the copy test.
 */
export function composeStatement(x: {
  feasibility: GoalFeasibility;
  goalSec: number;
  currentEquivalentSec: number | null;
  safeTargetSec: number | null;
  weeksAvailable: number | null;
  weeksToReach?: { min: number; max: number } | null;
}): string {
  const goal = fmt(x.goalSec);
  const now = fmt(x.currentEquivalentSec);
  const safe = fmt(x.safeTargetSec);
  const inWeeks = x.weeksAvailable == null ? '' : ` in ${weeksPhrase(x.weeksAvailable)}`;

  switch (x.feasibility) {
    case 'comfortable':
      return `${goal} is inside what you can already run. Today's fitness is worth about ${now}. The plan will aim past the number you set.`;
    case 'realistic':
      return `${goal}${inWeeks} is a realistic ask. Today's fitness is worth about ${now}, and the build has the time to cover the rest.`;
    case 'ambitious':
      return `${goal}${inWeeks} is ambitious and still on the table. Today's fitness is worth about ${now}. It needs the top of what a build delivers, held the whole way.`;
    case 'aggressive':
      return `${goal}${inWeeks} is aggressive. Today's fitness is worth about ${now}, and the goal asks for more than a block this length reliably delivers. ${safe} is the honest target. The goal stays on the board and the plan keeps training for it.`;
    case 'out-of-reach':
      return `${goal}${inWeeks} is out of reach from ${now}. That is a bigger jump than training delivers in the time. ${safe} is what this build is genuinely worth. The goal stays on the board; the plan will train for what is achievable.`;
    case 'open-ended': {
      const w = x.weeksToReach;
      const span = w == null
        ? 'a while'
        : w.min === w.max
          ? weeksPhrase(w.min)
          : `${w.min} to ${w.max} weeks`;
      return `${goal} is a real jump from ${now}. At the rate a build delivers, that is ${span} of work. No date is set, so the plan keeps building toward it.`;
    }
    case 'date-passed':
      return `The ${goal} target date has passed. Set a new date and this reads again.`;
    default:
      return 'Not enough logged running yet to say what this goal is worth. A race or a hard time trial would settle it.';
  }
}

/**
 * Limiter notes. Each one applies its OWN context filter (CLAUDE.md
 * §"Per-finding context filters") rather than inheriting the assessment's.
 * Exported for tests.
 */
export function composeCautions(x: {
  feasibility: GoalFeasibility;
  distanceMi: number;
  weeksAvailable: number | null;
  recentWeeklyMi: number | null;
  ctx: GoalAssessmentContext;
}): string[] {
  const out: string[] = [];
  const cat = distanceCategoryOrNull(x.distanceMi);

  // ── VOLUME ──────────────────────────────────────────────────────────────
  // Own filter: a taper week and a post-race recovery week are the PLAN
  // holding volume down on purpose. Blaming the runner's volume there is the
  // exact shape of the V5 Z2 defect (a taper workout read as an easy-day
  // problem), so this finding asks its own question about phase before it
  // fires, regardless of what the surface as a whole concluded.
  const volumeIsDeliberatelyLow =
    x.ctx.inTaperOrRaceWeek === true || x.ctx.inPostRaceRecovery === true;
  if (
    !volumeIsDeliberatelyLow &&
    cat != null &&
    x.recentWeeklyMi != null &&
    x.recentWeeklyMi > 0 &&
    x.recentWeeklyMi < MIN_WEEKLY_MI_FOR_DISTANCE[cat]
  ) {
    out.push(
      `Weekly volume is short of what ${distanceWord(cat)} wants. That gap, not speed, is the limiter.`,
    );
  }

  // ── RUNWAY ──────────────────────────────────────────────────────────────
  // Own filter: no date means no short runway to warn about. A goal with no
  // deadline is a perfectly good goal.
  if (x.weeksAvailable != null && cat != null) {
    const shortRunway = x.weeksAvailable < SHORT_RUNWAY_WEEKS[cat];
    if (shortRunway && x.weeksAvailable > 0) {
      out.push(
        `${weeksPhrase(x.weeksAvailable)} is short for ${distanceWord(cat)} build. The plan will prioritise arriving healthy over hitting a number.`,
      );
    }
  }

  // ── EVIDENCE ────────────────────────────────────────────────────────────
  // Own filter: this is about the ANCHOR, not the goal. A runner with a race
  // three weeks ago gets no caution here no matter how aggressive the goal.
  if (x.ctx.anchorAgeDays != null && x.ctx.anchorAgeDays > VDOT_FULL_VALUE_DAYS) {
    out.push(
      'This reads off a fitness anchor that is getting old. A race or a hard time trial in the next few weeks would sharpen it.',
    );
  }

  // ── MARATHON-SPECIFIC LAG ───────────────────────────────────────────────
  // Research/01 §"Marathon-specific correction": a VDOT taken from a 5K or
  // 10K over-reads marathon fitness by ~1.5 points without a marathon block.
  // Own filter: needs BOTH a marathon-class goal AND a short-race anchor AND
  // a known-false marathon block. Unknown suppresses it; the caution would be
  // guessing otherwise.
  if (
    cat === 'm' &&
    x.ctx.anchorDistanceMi != null &&
    x.ctx.anchorDistanceMi > 0 &&
    x.ctx.anchorDistanceMi <= 10 &&
    x.ctx.marathonSpecificBlockDone === false
  ) {
    out.push(
      'This fitness read comes from a short race. Marathon fitness lags it until the long runs and race-pace work are in.',
    );
  }

  // ── REPORTING POSTURE ───────────────────────────────────────────────────
  // Always last, and only when the app is about to show a second number, so
  // the runner learns why before they see it.
  if (x.feasibility === 'aggressive' || x.feasibility === 'out-of-reach') {
    out.push(
      'Training stays pointed at the goal. Progress gets reported against the safe target so the read stays honest.',
    );
  }

  return out;
}

/**
 * The runway below which a build for this distance is short.
 *
 * Not physiology and deliberately not dressed as it: it is the shortest plan
 * Research/22 publishes for each distance, used as the line under which the
 * app says "this is short" rather than pretending a block exists. Recorded in
 * the doctrine lint's UNBOUND_TABLES for exactly that reason.
 */
const SHORT_RUNWAY_WEEKS: Readonly<Record<DistanceCategory, number>> = {
  '5k': 8,
  '10k': 9,
  'hm': 10,
  'm': 12,
  'ultra': 16,
};

function distanceWord(cat: DistanceCategory): string {
  switch (cat) {
    case '5k': return 'a 5K';
    case '10k': return 'a 10K';
    case 'hm': return 'a half marathon';
    case 'm': return 'a marathon';
    case 'ultra': return 'an ultra';
  }
}
