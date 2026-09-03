/**
 * lib/training/marathon-pace-contract.ts · S1.4 · THE MARATHON PACES, NAMED.
 *
 * ── WHAT WENT WRONG ─────────────────────────────────────────────────────────
 *
 * Measured on the owner's account at the 2026-08-30 authoring instant. Four
 * numbers live at once, none wrong on its own terms:
 *
 *   stated goal                    3:00:00   6:52/mi
 *   current projection             3:23:53   7:47/mi   confidence 0.52
 *   marathon-pace TRAINING         —         7:52/mi   band 7:40-8:08
 *   expected race day (forecast)   3:19:57   7:38/mi   confidence 0.23
 *   execution target               3:13:20   7:22/mi   ← what he is told to race
 *
 * He rehearses 7:52 and is told to race 7:22. Twenty-nine seconds a mile over
 * 26.2 miles, with nothing in the block at that pace and no sentence anywhere
 * explaining the jump.
 *
 * `race-outlook.ts` already kept the first four apart BY NAME, and that work
 * stands — this file never recomputes any of them. What was missing:
 *
 *   1 · THE ACTIVE NUMBER WAS THE WRONG ONE. `execution.targetSec` came from
 *       `stated_goal_clamped_to_range_edge`: a 3:00 goal, faster than
 *       everything, pulled the target to the FAST EDGE of a range whose own
 *       confidence is 0.23 and whose gain carries the reason
 *       `HISTORICAL_RESPONSE_UNKNOWN_POPULATION_RATE`. That is the goal
 *       selecting the most optimistic point the model can produce — the goal
 *       reaching a prescription, arriving through the race door instead of the
 *       training door.
 *   2 · A SIXTH QUANTITY. Every authored marathon-effort session needs its own
 *       target and there was none: the block priced every MP mile at one static
 *       `anchors.marathonSecPerMi`, so "the progression" was a flat line.
 *   3 · THE SEAM. Nothing checked that the last rehearsal and the race-day
 *       target were within reach of each other.
 *
 * ── THE OWNER'S RULING, Q7 (locked 2026-09-03) ──────────────────────────────
 *
 *   | Aspirational goal              3:00        never used as capacity
 *   | Active current-evidence target ~3:24 · 7:47/mi   the PROJECTION-derived
 *   |                                value, used wherever one current
 *   |                                execution number is required
 *   | Likely range                   the canonical current-evidence range
 *   | Conditional upside             ~3:13-3:15  with explicit criteria
 *
 *   "3:13:30 must not be labelled the current execution target merely because
 *    it is the fast edge of a wide range." And: "Do not average the projection
 *    and goal to manufacture a compromise target."
 *
 * So the goal's pull is REMOVED rather than re-weighted (Constitution: prefer
 * deletion before addition), the ACTIVE execution number becomes the current
 * projection, the block's forecast stays a separate named quantity, and the
 * range's fast edge is re-typed as `conditional_upside` with its criteria
 * written down. No new tuning constant enters the engine.
 *
 * ── THE SIX QUANTITIES, AND WHO OWNS EACH ───────────────────────────────────
 *
 *   aspirational_goal        the runner's. `races.meta.goalDisplay`. Echoed and
 *                            compared, NEVER capacity, never prices a session,
 *                            never pulls a projection.
 *   current_projection       Race Prediction · `race-outlook.currentProjection`.
 *                            THE ACTIVE EXECUTION TARGET (Q7).
 *   training_prescription    Pace Prescription · `anchors.marathonSecPerMi`
 *                            with `marathonRangeSecPerMi` as its honest band.
 *                            Today's sustainable marathon effort.
 *   block_forecast           Race Prediction · `race-outlook.expectedRaceDay`.
 *                            Where the block is DESIGNED to move him. A
 *                            forecast with a named assumption, not a
 *                            prescription (`PROGRESSIVE_BASELINE_DOCTRINE.md`
 *                            "what every meaningful progression must state" §6).
 *   conditional_upside       a FASTER outcome that is not active. It becomes
 *                            the prescription only when named evidence arrives.
 *   workout_marathon_effort  THIS FILE. One authored session's pace RANGE,
 *                            resolved from the runner's own band and the
 *                            session's role in the block's ladder.
 *
 * ── WHAT THIS FILE MAY NOT DO ───────────────────────────────────────────────
 *
 * No database, no fitness model, no exponent fitting, no goal arithmetic beyond
 * comparison, and no HR model — the HR ceiling comes from the canonical HR
 * owner and is passed in (`ADAPTATION_ENGINE_CONTRACT.md` Q30: "Do not hardcode
 * 160 bpm if the canonical model produces a different defensible ceiling").
 * `_marathon_pace_contract.test.ts` asserts the no-database property rather
 * than this sentence claiming it (Rule 20).
 */

/** The six quantities. A marathon number in this system is one of these. */
export type MarathonPaceQuantity =
  | 'aspirational_goal'
  | 'current_projection'
  | 'training_prescription'
  | 'block_forecast'
  | 'conditional_upside'
  | 'workout_marathon_effort';

/**
 * What an authored session REHEARSES. Not decoration: it is the difference
 * between "run today's honest marathon effort" and "run the pace the block
 * forecasts", and a session that cannot say which is one nobody can grade.
 */
export type MarathonRehearsalKind = 'current_capability' | 'forecast_development';

/**
 * `Research/01` §"Pace zone width and lock-in rules" gives marathon pace a
 * ±5 s/mi window, and `Research/08` §3's race-execution band is the same 5.
 * One number, used for the width of a prescribed marathon-effort RANGE and for
 * how far race day may sit from the block's last rehearsal.
 *
 * Duplicated as a named constant here rather than imported from
 * `lib/race/race-outlook.ts` because that module reaches the database and this
 * one may not; `MPCONTRACT.pace-band-is-one-number` pins the two together in CI
 * so they cannot drift apart silently (Rule 16).
 */
export const MARATHON_PACE_BAND_S_PER_MI = 5;

/**
 * Q8's marathon-effort pace ladder, expressed as a fraction of the runner's OWN
 * published band rather than as the hardcoded clock times in the ruling.
 *
 *   | Early marathon-specific work | 7:50-7:55/mi                          |
 *   | Middle progression           | ~7:45-7:50/mi                         |
 *   | Later peak-specific work     | ~7:38-7:45/mi, only after development |
 *   | Taper rehearsal              | preserve the most recently supported  |
 *
 * The ruling states those as "directional bounds, NOT hardcoded values —
 * resolve exact prescriptions through the canonical pace and load contracts."
 * So `t` interpolates from the anchor's POINT estimate (`marathonSecPerMi`, the
 * runner's honest marathon effort today) to the FAST EDGE of its own published
 * band (`marathonRangeSecPerMi[0]`). On the reference runner that span is
 * 7:52 → 7:40, and the three rungs land at 7:52 / 7:46 / 7:40 — inside all
 * three of the ruling's bands, without a single clock time in the code.
 *
 * The span is the ANCHOR'S OWN uncertainty, so the ladder can never prescribe a
 * pace the pace resolver did not publish. It spends headroom doctrine already
 * allows; it does not widen a band or weaken a guard.
 */
export const MARATHON_EFFORT_LADDER_T = {
  /** "Early marathon-specific work · 7:50-7:55/mi" — today's honest effort. */
  early: 0,
  /** "Middle progression · ~7:45-7:50/mi". */
  middle: 0.5,
  /** "Later peak-specific work · ~7:38-7:45/mi, only after preceding development." */
  later: 1,
} as const;

export interface MarathonPaceContract {
  /** The runner's stated goal, as a pace. Null when he has stated none. */
  aspirationalGoalSecPerMi: number | null;
  /** What the evidence says he could race NOW. THE ACTIVE EXECUTION TARGET. */
  currentProjectionSecPerMi: number | null;
  currentProjectionRangeSecPerMi: readonly [number, number] | null;
  /** Today's sustainable marathon effort — the point estimate. */
  trainingPrescriptionSecPerMi: number;
  /**
   * The honest band around it, FAST edge first. `Research/01` §"Pace zone width
   * and lock-in rules" gives M a ±5 s/mi window; this band is wider because it
   * spans the population exponent and the runner's own fitted one, and that
   * width is the headroom the ladder is allowed to spend.
   */
  trainingBandSecPerMi: readonly [number, number];
  /**
   * Where the block is DESIGNED to move him. A forecast, never the active
   * number, and it carries the assumption that produced it.
   */
  blockForecast: {
    paceSecPerMi: number;
    finishSec: number;
    confidence: number | null;
    /** `PROGRESSIVE_BASELINE_DOCTRINE.md` §6 · the named response assumption. */
    assumption: string;
  } | null;
  /** A faster OUTCOME that is not active until the criteria below are met. */
  conditionalUpside: {
    paceSecPerMi: number;
    finishSec: number;
    criteria: readonly string[];
  } | null;
}

/**
 * The evidence that would make the conditional upside the active target.
 * The owner's own ruling, 2026-09-02, verbatim in substance:
 *
 *   "marathon-effort work progressing toward ~7:23-7:30/mi; controlled HR and
 *    acceptable late-session deterioration in a substantial marathon-specific
 *    long run; repeatability across more than one session; a Run Malibu result
 *    consistent with ~3:13-3:15; and successful absorption of the higher-volume
 *    portion."
 *
 * These are OBSERVATIONS, not automation. Nothing in this codebase evaluates
 * them and promotes the target — `docs/PLAN_SIMPLIFICATION_DOCTRINE.md` has
 * adaptation disabled, and a conditional that quietly promoted itself would be
 * exactly the automatic mutation doctrine removed. They exist so the runner can
 * see what the faster number is waiting on.
 */
export const CONDITIONAL_UPSIDE_CRITERIA: readonly string[] = [
  'Marathon-effort sessions completed inside the prescribed range with heart rate under the ceiling.',
  'A substantial marathon-specific long run finished without late-session deterioration.',
  'The same quality repeated in a second session, not shown once.',
  'A tune-up race consistent with the faster target.',
  'The higher-volume weeks of the block absorbed, not merely attempted.',
];

/**
 * Build the contract from quantities their own owners have already resolved.
 * Every argument is a number someone else is responsible for; this function
 * chooses nothing physiological.
 */
export function marathonPaceContract(args: {
  aspirationalGoalSecPerMi: number | null;
  currentProjectionSecPerMi: number | null;
  currentProjectionRangeSecPerMi: readonly [number, number] | null;
  trainingPrescriptionSecPerMi: number;
  trainingBandSecPerMi: readonly [number, number] | null;
  blockForecast: { paceSecPerMi: number; finishSec: number; confidence: number | null; assumption: string } | null;
  /** The fast edge of the block forecast's range — the upside, if there is one. */
  upsidePaceSecPerMi: number | null;
  upsideFinishSec: number | null;
}): MarathonPaceContract {
  const point = args.trainingPrescriptionSecPerMi;
  // Rule 11 · a missing band is not a zero-width band. With no band the ladder
  // has no headroom to spend and every session sits on the point, which is
  // honest: an engine that cannot say how uncertain the pace is may not spend
  // that uncertainty.
  const band: readonly [number, number] = args.trainingBandSecPerMi
    ? [Math.min(...args.trainingBandSecPerMi), Math.max(...args.trainingBandSecPerMi)]
    : [point, point];
  const active = args.currentProjectionSecPerMi;
  const upside = args.upsidePaceSecPerMi != null && args.upsideFinishSec != null
    // An UPSIDE is faster than the active target or it is not an upside.
    // Nothing here manufactures one from the goal.
    && (active == null || args.upsidePaceSecPerMi < active)
    ? { paceSecPerMi: args.upsidePaceSecPerMi, finishSec: args.upsideFinishSec, criteria: CONDITIONAL_UPSIDE_CRITERIA }
    : null;
  return {
    aspirationalGoalSecPerMi: args.aspirationalGoalSecPerMi,
    currentProjectionSecPerMi: active,
    currentProjectionRangeSecPerMi: args.currentProjectionRangeSecPerMi,
    trainingPrescriptionSecPerMi: point,
    trainingBandSecPerMi: band,
    blockForecast: args.blockForecast,
    conditionalUpside: upside,
  };
}

/**
 * THE SIXTH QUANTITY · one authored marathon-effort session's prescription.
 *
 * `ADAPTATION_ENGINE_CONTRACT.md` Q30 fixes the form: "A pace range, plus a
 * canonical HR ceiling, plus plain-language effort guidance. Every
 * marathon-effort prescription carries: the pace range for that workout and
 * phase · an HR ceiling from the canonical HR owner · how the effort should
 * feel · what to do when pace, HR, terrain and conditions disagree."
 */
export interface MarathonEffortPrescription {
  /** Fast edge first. Width is `Research/01`'s ±5 s/mi M window. */
  rangeSecPerMi: readonly [number, number];
  /** The midpoint, for callers that can only carry one number. */
  paceSecPerMi: number;
  /** From the canonical HR owner. Null when it could not be resolved. */
  hrCeilingBpm: number | null;
  rehearses: MarathonRehearsalKind;
  /**
   * What the block is assuming about training response to schedule this pace.
   * `PROGRESSIVE_BASELINE_DOCTRINE.md`: "A forecast with a named assumption can
   * be replaced by evidence; an unlabelled number cannot."
   */
  assumption: string;
  /**
   * The pace to fall back to when the forecast is not confirmed. The ruling
   * requires every future pace step to carry one, so the runner is never left
   * with a target and no alternative.
   */
  fallbackSecPerMi: number;
  /** How it should feel, and what to do when the channels disagree. */
  guidance: string;
}

/**
 * Resolve one session's marathon-effort prescription.
 *
 * ── WHY THIS IS NOT A LINEAR MARCH ──────────────────────────────────────────
 *
 * The ruling is explicit: "No mechanical linear march from 7:52 toward the 6:52
 * goal." Two properties keep this honest:
 *
 *   · The ladder's far end is the FAST EDGE OF THE RUNNER'S OWN BAND, not the
 *     goal. It cannot walk past what the pace resolver published, however long
 *     the block is or however ambitious the goal.
 *   · `t` comes from the session's ROLE, not from its index. A block with six
 *     marathon-specific sessions does not get six pace steps; it gets the three
 *     the ruling names, and every taper session HOLDS at the most recently
 *     supported pace ("preserve the most recently supported effort; no large
 *     new pace jump").
 *
 * Continuity (Rule 9): the pace is continuous and monotone in `t`, and `t` is a
 * discrete role label rather than a threshold on a measured quantity — so there
 * is no boundary for a hair's difference of input to fall either side of.
 */
export function marathonEffortPrescription(args: {
  contract: MarathonPaceContract;
  /** 0 = today's effort · 1 = the fast edge of the runner's own band. */
  ladderT: number;
  /** The canonical HR ceiling for this session. Passed, never derived here. */
  hrCeilingBpm: number | null;
  /** Miles at marathon effort in this session — used only in the guidance. */
  mpMi: number;
}): MarathonEffortPrescription {
  const { contract } = args;
  const t = Math.max(0, Math.min(1, Number.isFinite(args.ladderT) ? args.ladderT : 0));
  const point = contract.trainingPrescriptionSecPerMi;
  const fastEdge = contract.trainingBandSecPerMi[0];
  // `Math.min(0, …)` guards the degenerate case where the published band's fast
  // edge is SLOWER than the point. Progression can then only hold, which is the
  // correct refusal: there is no headroom to spend and inventing some would be
  // manufacturing push.
  const headroom = Math.min(0, fastEdge - point);
  const paceSecPerMi = Math.round(point + t * headroom);
  const rangeSecPerMi: readonly [number, number] = [
    paceSecPerMi - MARATHON_PACE_BAND_S_PER_MI,
    paceSecPerMi + MARATHON_PACE_BAND_S_PER_MI,
  ];
  /*
   * REHEARSAL-1 (2026-09-03) · GATED ON THE PACE THAT MOVED, NOT ON THE LADDER
   * POSITION.
   *
   * This read `t > 0`, which is a statement about where the session sits on the
   * ladder, and then reported it as a statement about what the session
   * REHEARSES — which is a statement about its PACE. Rule 16: a sentence
   * asserting a fact about a measurement is gated on that measurement or it is
   * not said.
   *
   * The two facts come apart whenever the runner's published band has no
   * headroom in it, which `headroom = Math.min(0, …)` four lines up already
   * recognises and calls "the correct refusal". The refusal was then labelled
   * `forecast_development` anyway, and the sentence beside it read "The block
   * develops marathon-specific endurance by 0 s/mi" — a forecast of nothing,
   * announced as a forecast.
   *
   * Reachable in the shipped corpus today, not hypothetically: `cimBlock()` in
   * `_mp_doctrine.test.ts` composes through `syntheticPaceAnchors`, whose
   * marathon band clamps to the easy-ceiling separation and collapses to
   * `[460, 460]`. Every rung of that block came out at one pace, every one of
   * them saying it developed the runner by zero (Rule 15 · the corpus case is
   * named because a mechanism no case reaches is untested).
   *
   * `developmentSecPerMi` is the seconds this session actually asks for beyond
   * today's supported effort. Zero of them is holding, and holding is
   * `current_capability` however far up the ladder the role sits.
   */
  const developmentSecPerMi = Math.max(0, point - paceSecPerMi);
  const rehearses: MarathonRehearsalKind = developmentSecPerMi > 0
    ? 'forecast_development'
    : 'current_capability';
  const assumption = developmentSecPerMi <= 0
    ? 'None. This is the pace your own evidence carries today.'
    : `The block develops marathon-specific endurance by ${developmentSecPerMi} s/mi inside your published marathon band. That is a forecast, not a measurement, and completed sessions replace it.`;
  // The fallback is always today's supported effort — the number that needs no
  // forecast to be true.
  const fallbackSecPerMi = point;
  const guidance = [
    `Run the marathon-effort miles at ${fmtPace(rangeSecPerMi[0])}-${fmtPace(rangeSecPerMi[1])}.`,
    args.hrCeilingBpm != null
      ? `Keep heart rate under ${args.hrCeilingBpm}.`
      : 'Keep the effort controlled and sustainable.',
    'It should feel like work you could hold, not like a test.',
    'On hills, in heat, or into wind, protect the effort and let the pace go.',
    // REHEARSAL-1 · same gate. Offering a fallback to the pace the session is
    // already prescribed at is a sentence that tells the runner nothing.
    developmentSecPerMi > 0
      ? `If the pace will not come at that effort, run ${fmtPace(fallbackSecPerMi)} and take the session.`
      : 'If the pace comes easily, hold it anyway. The duration is the work here.',
  ].join(' ');
  return { rangeSecPerMi, paceSecPerMi, hrCeilingBpm: args.hrCeilingBpm, rehearses, assumption, fallbackSecPerMi, guidance };
}

/**
 * The seam · does the block make the race-day target credible?
 *
 * Called with the LAST marathon-effort pace the plan ACTUALLY authored, not the
 * pace the ladder intended — a dose the dosing caps or the intensity floor
 * shaved away never happened, and a check that reads intent instead of output is
 * the shape Rule 18 keeps catching.
 */
export interface MarathonSeam {
  lastRehearsalSecPerMi: number | null;
  executionSecPerMi: number | null;
  gapSecPerMi: number | null;
  credible: boolean;
  reason: string;
}

export function marathonSeam(args: {
  lastRehearsalSecPerMi: number | null;
  executionSecPerMi: number | null;
}): MarathonSeam {
  const { lastRehearsalSecPerMi, executionSecPerMi } = args;
  // Rule 11 · three facts. No rehearsal and no target are different absences,
  // and neither is a credible seam.
  if (lastRehearsalSecPerMi == null || executionSecPerMi == null) {
    return {
      lastRehearsalSecPerMi, executionSecPerMi, gapSecPerMi: null, credible: false,
      reason: lastRehearsalSecPerMi == null
        ? 'The block authored no marathon-effort session, so nothing rehearses race day.'
        : 'No execution target resolved, so there is nothing for the block to make credible.',
    };
  }
  const gapSecPerMi = lastRehearsalSecPerMi - executionSecPerMi;
  // A target SLOWER than the last rehearsal is credible by construction: he has
  // already run faster than he is being asked to race.
  const credible = gapSecPerMi <= MARATHON_PACE_BAND_S_PER_MI;
  const reason = credible
    ? gapSecPerMi <= 0
      ? 'Race day is at or slower than the block’s last marathon-effort session.'
      : `Race day is ${Math.round(gapSecPerMi)} s/mi faster than the block’s last marathon-effort session, inside one pace band.`
    : `Race day is ${Math.round(gapSecPerMi)} s/mi faster than anything the block rehearses. The target is not carried by the training.`;
  return { lastRehearsalSecPerMi, executionSecPerMi, gapSecPerMi, credible, reason };
}

function fmtPace(sec: number): string {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
