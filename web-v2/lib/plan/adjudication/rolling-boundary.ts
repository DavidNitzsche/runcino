/**
 * lib/plan/adjudication/rolling-boundary.ts · THREE DECISIONS, NOT ONE GATE.
 *
 * ── WHY THE SINGLE GATE WAS THE WRONG SHAPE ────────────────────────────────
 *
 * `CIM0921GATE.md` proposed one assessment on 2026-09-20 with eight conditions,
 * and the owner's ruling on reading it was: "Do not use one impossible gate."
 * He is right, and for a reason worth writing down. A single gate has to decide
 * on 09-20 what the week will cost, using evidence that does not exist yet —
 * how the Tuesday tempo is absorbed, and what the Saturday 10K actually turns
 * out to be. It must therefore either guess or refuse, and a gate that refuses
 * is a gate that never fires.
 *
 * Three boundaries each decide with the evidence available AT that moment, and
 * each can only change what is still ahead of it. That is the difference
 * between a forecast and a decision.
 *
 * ── AND WHY STRESSOR COUNT WAS THE WRONG MEASURE ───────────────────────────
 *
 * The gate document's finding was that the week goes "2 to 3 stressors" and so
 * violates `Research/00a`'s one-at-a-time rule. Measured against the engine's
 * own detector it does not: the baseline is the MAXIMUM over the trailing three
 * weeks, and 2026-08-31 already carried three.
 *
 * The owner's response is the correct one and it goes further than the
 * correction: "three stressors versus three stressors is not enough to prove
 * equivalent demand. A controlled 10K followed immediately by 17 miles may cost
 * more than the earlier three-stressor week."
 *
 * So these boundaries compare DEMAND — `projectPlanLoad`'s index, which prices
 * weekly miles, the long-run surcharge and quality minutes together — and not a
 * count of hard days. Measured on the live block, the difference matters:
 *
 *   week        mi   long  qmin   demand   Δ vs trailing-3 max
 *   2026-08-31  46.5  15    102    83.91          —
 *   2026-09-14  46.8  16.5   65    72.38      -13.7%
 *   2026-09-21  55.2  17    110    95.75      +14.1%      ← by mileage: +17.9%
 *   2026-10-26  60    21.5  130   108.28       +9.6%      ← the block's real peak
 *
 * By demand the step is SMALLER than by mileage, because 08-31 already carried
 * 102 quality minutes. And 09-21 is not the block's stress point: the same
 * runner is asked for 108.3 five weeks later.
 *
 * ── WHAT THIS FILE CANNOT DO (Rule 22) ─────────────────────────────────────
 *
 * · It cannot write. It returns the exact mutation each boundary WOULD make.
 * · It cannot see the future. Boundary 1 deliberately does not try to price the
 *   Saturday race; that is boundary 3's job and boundary 3 has the evidence.
 * · It does not decide whether the demand model's coefficients are right. They
 *   are crude and their own header admits it. What it fixes is comparing the
 *   same quantity on both sides (Rule 16), which counting stressors did not.
 */

import { projectPlanLoad, type ProjectedPlanLoad } from './canonical-demand';
import type { ScheduleRequest } from '@/lib/ops/reassessment-scheduler';
import { roundTo } from '@/lib/format/run';

/** One week, priced. */
export interface WeekDemand {
  readonly weekStartISO: string;
  readonly load: ProjectedPlanLoad;
}

export function priceWeek(w: {
  weekStartISO: string; weeklyMi: number; longRunMi: number; qualityMinutes: number;
}): WeekDemand {
  return {
    weekStartISO: w.weekStartISO,
    // The anchor is held at zero: a ceiling is a property of the athlete, not
    // of any proposal, and the same reasoning applies to a baseline.
    load: projectPlanLoad({
      weeklyMi: w.weeklyMi, longRunMi: w.longRunMi,
      qualityMinutes: w.qualityMinutes, thresholdAnchorDeltaSecPerMi: 0,
    }),
  };
}

/**
 * The demand baseline: the HIGHEST of the trailing three weeks.
 *
 * A maximum, not a mean, for the reason CLAUDE.md Rule 8 gives one level up —
 * a cutback, a taper or a race week is not the runner's normal, and a mean
 * lets one of them drag the baseline down and manufacture a finding. A maximum
 * is immune to a dip by construction.
 *
 * Refuses (Rule 11) rather than guessing when every trailing week is a
 * prescribed dip: there is no baseline to read, and that is "do not know".
 */
export type Baseline =
  | { readonly known: true; readonly demandIndex: number; readonly fromWeekISO: string }
  | { readonly known: false; readonly why: string };

export function demandBaseline(
  trailing: readonly WeekDemand[],
  isPrescribedDip: (weekStartISO: string) => boolean,
): Baseline {
  const window = trailing.slice(-3).filter((w) => w.load.weeklyMi > 0);
  if (window.length === 0) return { known: false, why: 'no trailing weeks to read' };
  if (window.every((w) => isPrescribedDip(w.weekStartISO))) {
    return {
      known: false,
      why: 'every week in the baseline window was a prescribed dip, so there is no normal to '
        + 'measure against',
    };
  }
  let best = window[0];
  for (const w of window) if (w.load.demandIndex > best.load.demandIndex) best = w;
  return { known: true, demandIndex: best.load.demandIndex, fromWeekISO: best.weekStartISO };
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE BOUNDARIES
 * ═══════════════════════════════════════════════════════════════════════ */

export type BoundaryVerdict = 'PROCEED' | 'REDUCE' | 'REFUSE';

export interface BoundaryDecision {
  readonly verdict: BoundaryVerdict;
  readonly because: string;
  /** The exact change, or null when the answer is to proceed unchanged. */
  readonly mutation: ProposedMutation | null;
}

export interface ProposedMutation {
  readonly planWorkoutId: string;
  readonly dateISO: string;
  readonly change: string;
  readonly newType?: string;
  readonly newDistanceMi?: number;
}

/**
 * BOUNDARY 1 · before the week. Assessed the day the week is authored to start.
 *
 * The question: is this week's DEMAND still a reasonable step on what the
 * runner has actually completed?
 *
 * Continuous, per Rule 9. There is no "46.8 or failure" cliff — the completed
 * mileage is read as a proportion, and a week completed at 90% supports a
 * proportionally smaller step rather than falling off an edge. A hair's
 * difference in what he ran must not produce a categorically different plan.
 */
export function boundaryBeforeWeek(args: {
  readonly proposed: WeekDemand;
  readonly baseline: Baseline;
  readonly completionRatio: number | null;
  readonly allowedStepShare: number;
  readonly targetWorkoutId: string | null;
  readonly targetDateISO: string | null;
}): BoundaryDecision {
  if (!args.baseline.known) {
    return { verdict: 'REFUSE', because: args.baseline.why, mutation: null };
  }
  if (args.completionRatio === null) {
    return {
      verdict: 'REFUSE',
      because: 'the completed volume of the preceding week could not be read, and a step is '
        + 'sized off what he actually did',
      mutation: null,
    };
  }
  const step = args.proposed.load.demandIndex / args.baseline.demandIndex - 1;
  const allowed = allowedStepFor(args.completionRatio, args.allowedStepShare);
  if (step <= allowed) {
    return {
      verdict: 'PROCEED',
      because: `demand rises ${pct(step)} on the highest of the trailing three weeks `
        + `(${args.baseline.fromWeekISO}), inside the ${pct(allowed)} this completion supports`,
      mutation: null,
    };
  }
  if (args.targetWorkoutId === null || args.targetDateISO === null) {
    return {
      verdict: 'REFUSE',
      because: `demand rises ${pct(step)} against ${pct(allowed)} allowed, and no session in `
        + 'the week can be reduced without cutting the long run or a race',
      mutation: null,
    };
  }
  return {
    verdict: 'REDUCE',
    because: `demand rises ${pct(step)} on ${args.baseline.fromWeekISO}, past the `
      + `${pct(allowed)} this completion supports`,
    mutation: {
      planWorkoutId: args.targetWorkoutId,
      dateISO: args.targetDateISO,
      change: 'convert the largest non-race, non-long quality session to easy',
      newType: 'easy',
    },
  };
}

/**
 * BOUNDARY 2 · after the mid-week quality session.
 *
 * The question the owner set: "If the tempo is poorly absorbed, adjust the
 * weekend rather than pretending Tuesday never occurred."
 *
 * That sentence is the whole design. The alternative — deciding the weekend on
 * 09-20 and never revisiting it — is what makes a single gate dishonest, and
 * dropping the Tuesday session from the record once it has been run is the same
 * error pointed backwards.
 */
export function boundaryAfterQuality(args: {
  readonly absorbed: 'FULL' | 'PARTIAL' | 'POOR' | null;
  readonly weekendLongWorkoutId: string | null;
  readonly weekendLongDateISO: string | null;
  readonly weekendLongMi: number | null;
}): BoundaryDecision {
  if (args.absorbed === null) {
    // Rule 11 · an unread session is not a well-absorbed one. But it is also
    // not evidence of a problem, so this refuses rather than reducing: the
    // weekend stands and boundary 3 still gets its say.
    return {
      verdict: 'REFUSE',
      because: 'the quality session could not be graded, so it says nothing either way about '
        + 'the weekend',
      mutation: null,
    };
  }
  if (args.absorbed !== 'POOR') {
    return {
      verdict: 'PROCEED',
      because: `the quality session graded ${args.absorbed}, so the weekend stands as authored`,
      mutation: null,
    };
  }
  if (args.weekendLongWorkoutId === null || args.weekendLongDateISO === null
    || args.weekendLongMi === null) {
    return {
      verdict: 'REFUSE',
      because: 'the session was poorly absorbed and the weekend long run could not be resolved',
      mutation: null,
    };
  }
  return {
    verdict: 'REDUCE',
    because: 'the mid-week quality session was poorly absorbed, so the weekend is adjusted '
      + 'rather than the Tuesday being treated as though it had not happened',
    mutation: {
      planWorkoutId: args.weekendLongWorkoutId,
      dateISO: args.weekendLongDateISO,
      change: 'shorten the long run to the last supported distance',
      newDistanceMi: roundTo(args.weekendLongMi * 0.85),
    },
  };
}

/**
 * BOUNDARY 3 · after the race, before the long run.
 *
 * The question: what did that race actually COST? A C-effort tune-up and a true
 * race effort are different facts about the same finish line, and the day after
 * is the only moment the answer can still change the long run.
 */
export type RaceEffort = 'CONTROLLED_C' | 'THRESHOLD_LIKE' | 'TRUE_RACE' | 'UNRELIABLE';

export function boundaryAfterRace(args: {
  readonly effort: RaceEffort;
  readonly longWorkoutId: string;
  readonly longDateISO: string;
  readonly longMi: number;
}): BoundaryDecision {
  switch (args.effort) {
    case 'CONTROLLED_C':
      return {
        verdict: 'PROCEED',
        because: 'the race was run as the controlled effort it was prescribed as, so the long '
          + 'run stands',
        mutation: null,
      };
    case 'THRESHOLD_LIKE':
      return {
        verdict: 'REDUCE',
        because: 'the race was run at threshold rather than as a controlled effort, so it cost '
          + 'more than the week was priced for',
        mutation: {
          planWorkoutId: args.longWorkoutId, dateISO: args.longDateISO,
          change: 'shorten the long run',
          newDistanceMi: roundTo(args.longMi * 0.9),
        },
      };
    case 'TRUE_RACE':
      return {
        verdict: 'REDUCE',
        because: 'the race was a true maximal effort the day before a long run, and '
          + '`Research/00b` prices recovery from that in days rather than hours',
        mutation: {
          planWorkoutId: args.longWorkoutId, dateISO: args.longDateISO,
          change: 'shorten the long run substantially',
          newDistanceMi: roundTo(args.longMi * 0.75),
        },
      };
    case 'UNRELIABLE':
      // Rule 11 again, and the safe direction differs from boundary 2's. Here
      // the race HAPPENED and only its cost is unknown, so the conservative
      // answer is to ease rather than to stand pat.
      return {
        verdict: 'REDUCE',
        because: 'the race happened and its effort could not be classified; the cost is '
          + 'unknown rather than zero',
        mutation: {
          planWorkoutId: args.longWorkoutId, dateISO: args.longDateISO,
          change: 'shorten the long run',
          newDistanceMi: roundTo(args.longMi * 0.9),
        },
      };
  }
}

/**
 * How much of the authored step this completion supports.
 *
 * EXPORTED so the continuity gate can walk THIS rather than the verdict, and
 * that distinction is the whole of Rule 9. My first gate walked the verdict
 * across the boundary and asserted it flipped at most once — and a hard
 * threshold satisfies that too, so replacing this line with
 * `completionRatio >= 0.95 ? share : 0` passed the test. Which is precisely
 * what Rule 9's own audit says of every other gate in this engine: "every gate
 * samples the output space at POINTS and asks whether each point is legal.
 * That is exactly the check a discontinuity passes, because both sides of a
 * cliff are legal plans. Nothing sampled the derivative."
 *
 * A verdict is discrete by nature. The quantity behind it must not be.
 */
export function allowedStepFor(completionRatio: number, allowedStepShare: number): number {
  return allowedStepShare * clamp01(completionRatio);
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;

/* ══════════════════════════════════════════════════════════════════════════
 * PERSISTING THE THREE · so a boundary is a commitment, not a plan to remember
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * The three boundaries for one week, as durable scheduler rows.
 *
 * Written as requests rather than as writes, for the same reason the boundaries
 * return mutations rather than applying them: nothing here has authority. The
 * caller schedules them.
 *
 * Rule 23 shapes the dates. Each `assessOnISO` is the last day the answer can
 * still change the thing it is about — assessing a week's size on the day it
 * starts, or a long run's size after it has been run, is a decision that
 * arrives too late to be one. `overdueAfterISO` is one day later, so a boundary
 * that silently never fires RAISES rather than passing unnoticed. Lateness must
 * be harmless, and a boundary that never ran must be NOTICED.
 *
 * `idempotencyKey` is the week plus the boundary, so the nightly sweep can
 * re-request these every night and get one row each. A scheduler that grows a
 * duplicate per tick is a scheduler nobody can read.
 */
export function boundariesForWeek(args: {
  readonly userUuid: string;
  readonly planId: string;
  readonly planVersion: string;
  readonly weekStartISO: string;
  /** The day before the week begins. Boundary 1. */
  readonly assessBeforeISO: string;
  /** The morning after the mid-week quality session. Boundary 2. */
  readonly assessAfterQualityISO: string;
  /** The morning after the race, before the long run. Boundary 3. */
  readonly assessAfterRaceISO: string;
  readonly todayISO: string;
}): readonly ScheduleRequest[] {
  const base = {
    userUuid: args.userUuid,
    planId: args.planId,
    planVersion: args.planVersion,
    queuedAtISO: args.todayISO,
  } as const;

  return [
    {
      ...base,
      kind: 'EARNING_GATE',
      reasonCode: 'week_demand_step',
      reasonDetail: 'Does the completed preceding week support the demand step this week asks '
        + 'for? Read continuously, not as a pass mark.',
      assessOnISO: args.assessBeforeISO,
      overdueAfterISO: nextDay(args.assessBeforeISO),
      lever: 'WEEKLY_VOLUME',
      idempotencyKey: `rolling:${args.weekStartISO}:before`,
      payload: { boundary: 1, weekStartISO: args.weekStartISO },
    },
    {
      ...base,
      kind: 'CONDITIONAL_DOSE',
      reasonCode: 'weekend_after_quality',
      reasonDetail: 'If the mid-week quality session was poorly absorbed, adjust the weekend '
        + 'rather than pretending Tuesday never occurred.',
      assessOnISO: args.assessAfterQualityISO,
      overdueAfterISO: nextDay(args.assessAfterQualityISO),
      lever: 'LONG_RUN',
      idempotencyKey: `rolling:${args.weekStartISO}:after-quality`,
      payload: { boundary: 2, weekStartISO: args.weekStartISO },
    },
    {
      ...base,
      kind: 'CONDITIONAL_DOSE',
      reasonCode: 'long_run_after_race',
      reasonDetail: 'Classify what the race actually cost: controlled, threshold-like, a true '
        + 'race, or unreadable. Size the long run to that rather than to the label it was '
        + 'prescribed under.',
      assessOnISO: args.assessAfterRaceISO,
      overdueAfterISO: nextDay(args.assessAfterRaceISO),
      lever: 'LONG_RUN',
      idempotencyKey: `rolling:${args.weekStartISO}:after-race`,
      payload: { boundary: 3, weekStartISO: args.weekStartISO },
    },
  ];
}

function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Where the three boundaries fall for a given week, read off its own sessions.
 *
 * Generalised deliberately. The 2026-09-21 week is the one that prompted this,
 * but a rule written for one week of one runner is the feature-specific
 * override the Constitution forbids, and it would go stale the moment he moved
 * a session. Every week has a day before it, a first quality session, and
 * either a race or a long run; those are the three moments at which new
 * evidence exists and the rest of the week can still change.
 *
 * Returns null when the week has nothing to assess — no quality and no long
 * run is an easy week, and scheduling three assessments for it would be noise.
 */
export function boundaryDatesForWeek(week: {
  readonly weekStartISO: string;
  readonly rows: readonly {
    readonly dateISO: string; readonly stressor: string | null;
  }[];
}): {
  readonly assessBeforeISO: string;
  readonly assessAfterQualityISO: string;
  readonly assessAfterRaceISO: string;
} | null {
  const sorted = [...week.rows].sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  const quality = sorted.find(
    (r) => r.stressor != null && r.stressor !== 'race' && !r.stressor.includes('long'),
  );
  const race = sorted.find((r) => r.stressor === 'race');
  const long = [...sorted].reverse().find((r) => r.stressor?.includes('long'));
  if (!quality && !race && !long) return null;

  // The last row that can still be changed by each answer, and no later.
  const anchorForThird = race ?? long ?? quality;
  const anchorForSecond = quality ?? race ?? long;
  if (!anchorForThird || !anchorForSecond) return null;

  return {
    assessBeforeISO: prevDay(week.weekStartISO),
    assessAfterQualityISO: nextDay(anchorForSecond.dateISO),
    assessAfterRaceISO: nextDay(anchorForThird.dateISO),
  };
}

function prevDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
