/**
 * lib/adaptation/canonical-shadow/live-input.ts · THE LIVE, READ-ONLY LOADER.
 *
 * Builds a `CanonicalAdaptationInput` (`lib/adaptation/canonical/input.ts`)
 * for ONE athlete AS OF NOW, from production data, over the fenced
 * `read-only-db.ts` connection only. This is a NEW, SMALLER loader — it does
 * not reuse `scripts/adaptation-real-replay/build-input.ts`, and that is a
 * deliberate scoping call worth stating rather than leaving implicit:
 *
 *   · `build-input.ts` lives under `scripts/`, outside the Next.js build's
 *     import graph. Reaching into it from `web-v2/lib` would pull a
 *     scripts-only module (and its siblings `snapshot.ts` / `sealed-history
 *     .ts` / `asof.ts`, built for a JSON-file replay, not a live query) into
 *     the production bundle — exactly the shape of import CLAUDE.md Rule 19
 *     names as the failure class ("a dynamic import is still a bundled
 *     edge"). Moving that machinery into `web-v2/lib` instead is a
 *     defensible follow-up, but it is a real refactor of a 1,100-line file
 *     with its own tested no-lookahead guarantees, and undertaking it under
 *     tonight's time budget risks the worse outcome: a subtly wrong
 *     transplant that LOOKS reused-and-trusted.
 *   · What IS reused, deliberately, is every already-production
 *     `@/lib/...` primitive `build-input.ts` itself calls for physiological
 *     judgement: `runDistanceMi` / `runPaceSecPerMi` / `runAvgHr` /
 *     `runPhases` / `splitsWithHrAndPace` (`lib/runs/run-shape.ts`),
 *     `wireVerdictLandedTheWork` (`lib/training/execution-semantics.ts`),
 *     `gradeStimulus` (`lib/adaptation/canonical/stimulus.ts`), and
 *     `distanceMiOfMeta` (`lib/race/distance.ts`). The judgement is made by
 *     the SAME canonical functions either way; only the orchestration layer
 *     around them is new.
 *
 * ── WHAT THIS LOADER DELIBERATELY REFUSES RATHER THAN GUESSES ──────────────
 *
 * Per Rule 11, a refusal beats a fabricated pass. Two places this loader is
 * conservative on purpose, named so the next pass knows exactly what to
 * deepen:
 *
 *   1. STIMULUS GRADING (`buildGradedSession`). `gradeStimulus`'s C1/C2
 *      (work duration / segment completion) need a PRESCRIBED work duration
 *      per segment, which lives inside `plan_workouts.workout_spec`'s
 *      interval structure — a parser this loader does not yet have. Rather
 *      than approximate it, C1/C2 are supplied as `absent()`, which
 *      `gradeStimulus` itself resolves to `INSUFFICIENT` (its own rule: "the
 *      work denominator itself must be readable, or there is nothing to
 *      grade"). C3 (pace) and C4 (HR) ARE read, from watch/phone phase data
 *      when present, because those numbers are already parsed and reconciled
 *      by `run-shape.ts` and need no additional interpretation here — but a
 *      session with no phases at all (`dataCompleteAndSegmented: false`)
 *      resolves to `INSUFFICIENT` before either channel is even read, via
 *      `gradeStimulus`'s own C7 precondition.
 *      CONSEQUENCE, STATED PLAINLY: most live sessions will grade
 *      `INSUFFICIENT` until a work-duration parser is built, which means the
 *      THRESHOLD_PACE lever will mostly REFUSE for lack of qualifying
 *      evidence in this first wiring. A REFUSE is an honest output — the
 *      canonical engine's own contract treats it as a successful evaluation,
 *      not an error — and it is a categorically safer failure mode than a
 *      confidently wrong FULL/SUBSTANTIAL grade feeding a pace change.
 *   2. LONG-RUN THIRDS (`buildThirds`). Built from `splitsWithHrAndPace`,
 *      comparing the mean of the middle third of splits against the final
 *      third. `comparable` is only `true` when there are at least 6 splits
 *      (so each third has at least 2), which is a coarser segmentation than
 *      the contract's own requirement that thirds "describe genuinely
 *      comparable prescribed work" — it cannot detect a prescription that
 *      varies pace across the run, which the contract says should REFUSE.
 *      An honest `comparable: false` with too few splits is the safe
 *      direction; a false `comparable: true` on a pace-varying prescription
 *      is not, and is exactly the class of gap named above rather than
 *      hidden.
 */
import {
  measured, absent, failed,
  type CanonicalAdaptationInput, type CapacityBelief,
  type ComparableThirds, type EvaluationBoundary, type GradedSession,
  type LongRunObservation, type Measured, type Provenance, type WeekObservation,
  type AuthoredPlanMode,
} from '@/lib/adaptation/canonical/input';
import { gradeStimulus, type StimulusInput } from '@/lib/adaptation/canonical/stimulus';
import { workHrCeilingFor } from '@/lib/adaptation/canonical/work-hr-ceiling';
import { workTraceIsCredible } from '@/lib/adaptation/canonical/hr-trace-credibility';
import {
  asRunData, runDay, runDaySql, runDistanceMi, runPaceSecPerMi, runAvgHr, runPhases,
  runNotMergedSql, splitsWithHrAndPace, type RunData,
} from '@/lib/runs/run-shape';
import { wireVerdictLandedTheWork } from '@/lib/training/execution-semantics';
import { distanceMiOfMeta } from '@/lib/race/distance';
import { resolveAthleteWeeklyDemandCeiling } from '@/lib/adaptation/canonical/demand-ceiling';
import {
  contextForWeek, demonstratedWeeksFrom, prescribedWeekQuantities,
  type DemandSubstrate, type RanRace,
} from './demand-input';
import { roQuery } from './read-only-db';

/* ══════════════════════════════════════════════════════════════════════════
 * SMALL HELPERS
 * ═══════════════════════════════════════════════════════════════════════ */

const DAY_MS = 86_400_000;
const day = (iso: string): string => iso.slice(0, 10);
const addDays = (iso: string, n: number): string =>
  new Date(Date.parse(`${day(iso)}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

/** Monday of the ISO week containing `iso` — the plan's own week grid,
 *  matching `scripts/adaptation-real-replay/build-input.ts`'s definition so
 *  a future reconciliation between the two has one fewer thing to argue
 *  about. */
function weekStartOf(iso: string): string {
  const d = new Date(Date.parse(`${day(iso)}T12:00:00Z`));
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  return addDays(day(iso), -dow);
}

const CANONICAL_RACE_DISTANCES: ReadonlyArray<{ key: 'FIVE_K' | 'TEN_K' | 'HALF' | 'MARATHON'; mi: number }> = [
  { key: 'FIVE_K', mi: 3.1 },
  { key: 'TEN_K', mi: 6.2 },
  { key: 'HALF', mi: 13.1 },
  { key: 'MARATHON', mi: 26.2 },
];

/** Nearest of the four canonical race-distance categories, by absolute
 *  difference. `input.ts`'s `RaceCalendar.raceDistance` is a closed union of
 *  exactly these four; a race at a distance the union does not carry (a 10
 *  mile, an ultra) is mapped to its nearest doctrine category rather than
 *  left unrepresentable — the same posture `Research/22`'s own template
 *  table takes for off-menu distances. */
function nearestCanonicalDistance(mi: number): 'FIVE_K' | 'TEN_K' | 'HALF' | 'MARATHON' {
  let best = CANONICAL_RACE_DISTANCES[0];
  let bestDiff = Math.abs(mi - best.mi);
  for (const c of CANONICAL_RACE_DISTANCES.slice(1)) {
    const diff = Math.abs(mi - c.mi);
    if (diff < bestDiff) { best = c; bestDiff = diff; }
  }
  return best.key;
}

/* ══════════════════════════════════════════════════════════════════════════
 * DB ROW SHAPES
 * ═══════════════════════════════════════════════════════════════════════ */

interface ActivePlanRow {
  id: string;
  mode: string | null;
  race_id: string | null;
  authored_iso: string;
  authored_state: Record<string, unknown> | null;
}

interface PlanWeekRow {
  id: string;
  week_idx: number;
  week_start_iso: string;
  is_race_week: boolean;
  is_cutback: boolean;
}

interface PlanWorkoutRow {
  id: string;
  week_id: string | null;
  date_iso: string;
  type: string | null;
  distance_mi: string | number | null;
  pace_target_s_per_mi: string | number | null;
  workout_spec: Record<string, unknown> | null;
  is_quality: boolean;
  is_long: boolean;
  sub_label: string | null;
}

interface RunRow {
  id: string;
  data: unknown;
}

interface RaceRow {
  slug: string;
  meta: Record<string, unknown> | null;
  plan: Record<string, unknown> | null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * DB READS · every one goes through `roQuery`, which refuses anything but a
 * SELECT before it reaches the wire (`read-only-db.ts`).
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Which plan a build is about. Rule 14 · the population is stated, never
 * inferred from a date argument.
 *
 * `ACTIVE` is the live posture and the default: the one unarchived plan, which
 * is the only plan a live evaluation may ever propose against.
 *
 * `AS_AUTHORED_AT` is for HISTORICAL REPLAY ONLY. It selects the most recently
 * authored plan on or before the as-of date, INCLUDING archived ones, because
 * the plan that was live in July has since been archived and a replay that
 * priced July's evidence against September's plan is not a replay. Nothing on
 * any live path may pass it: `_counterfactual.script.ts` is the only caller,
 * and it is a script.
 */
export type PlanSelection = 'ACTIVE' | 'AS_AUTHORED_AT';

async function readPlan(
  userUuid: string,
  asOfISO: string,
  selection: PlanSelection,
): Promise<ActivePlanRow | null> {
  const r = selection === 'ACTIVE'
    ? await roQuery<ActivePlanRow>(
      `SELECT id::text AS id, mode, race_id, authored_iso::text AS authored_iso, authored_state
         FROM training_plans
        WHERE user_uuid = $1::uuid AND archived_iso IS NULL
        ORDER BY authored_iso DESC
        LIMIT 1`,
      [userUuid],
    )
    : await roQuery<ActivePlanRow>(
      `SELECT id::text AS id, mode, race_id, authored_iso::text AS authored_iso, authored_state
         FROM training_plans
        WHERE user_uuid = $1::uuid AND authored_iso::date <= $2::date
        ORDER BY authored_iso DESC
        LIMIT 1`,
      [userUuid, asOfISO],
    );
  return r.rows[0] ?? null;
}

async function readPlanWeeks(planId: string): Promise<PlanWeekRow[]> {
  const r = await roQuery<PlanWeekRow>(
    `SELECT id::text AS id, week_idx, week_start_iso::text AS week_start_iso,
            is_race_week, is_cutback
       FROM plan_weeks WHERE plan_id = $1 ORDER BY week_idx`,
    [planId],
  );
  return r.rows;
}

async function readPlanWorkouts(planId: string): Promise<PlanWorkoutRow[]> {
  const r = await roQuery<PlanWorkoutRow>(
    `SELECT id::text AS id, week_id::text AS week_id, date_iso::text AS date_iso, type,
            distance_mi, pace_target_s_per_mi, workout_spec, is_quality, is_long, sub_label
       FROM plan_workouts WHERE plan_id = $1 ORDER BY date_iso`,
    [planId],
  );
  return r.rows;
}

/** Every canonical (non-absorbed) run for this user on or after `sinceISO`.
 *  Rule 14: the ONE canonical predicate, imported rather than re-typed. */
/**
 * Runs in `[sinceISO, untilISO)`.
 *
 * The upper bound was added 2026-09-04 and is a no-op for the live cron, which
 * passes today. It matters for any caller that passes a PAST `nowISO`: without
 * it this query returns runs the athlete had not yet done at that date, and
 * while every downstream consumer here already filters per-use, `evidenceVersion`
 * and `belief.oldestSupportingDateISO` were both read straight off this list.
 * A loader that claims to build an input AS OF a date must not be able to see
 * past it at all, which is cheaper to guarantee here than to remember at four
 * call sites (Rule 16).
 */
async function readRecentRuns(
  userUuid: string,
  sinceISO: string,
  untilISO: string,
): Promise<RunRow[]> {
  const r = await roQuery<RunRow>(
    `SELECT id::text AS id, data
       FROM runs
      WHERE user_uuid = $1::uuid
        AND ${runDaySql()} >= $2
        AND ${runDaySql()} < $3
        AND ${runNotMergedSql()}
      ORDER BY ${runDaySql()} ASC`,
    [userUuid, sinceISO, untilISO],
  );
  return r.rows;
}

/**
 * Races this athlete has already RUN, for the demand model's recovery term.
 *
 * Rule 14 · the population is stated: this user by uuid, races dated on or
 * before the evaluation date. `meta` carries the date and the distance, which
 * is the same pair `distanceMiOfMeta` already reads for the target race.
 *
 * RULE 11 · the CALLER keeps "the read failed" apart from "he has not raced".
 * An empty array means he has not raced before this date; a thrown error means
 * nobody knows, and the caller passes `null` rather than an empty list.
 */
async function readRacesRun(userUuid: string, asOf: string): Promise<RanRace[]> {
  const r = await roQuery<RaceRow>(
    `SELECT slug, meta, plan FROM races WHERE user_uuid = $1::uuid`,
    [userUuid],
  );
  const out: RanRace[] = [];
  for (const row of r.rows) {
    const d = row.meta?.date;
    if (typeof d !== 'string' || d.length < 10) continue;
    const dateISO = d.slice(0, 10);
    if (dateISO > asOf) continue;
    out.push({ dateISO, distanceMi: distanceMiOfMeta(row.meta) });
  }
  return out;
}

async function readRace(slug: string, userUuid: string): Promise<RaceRow | null> {
  const r = await roQuery<RaceRow>(
    `SELECT slug, meta, plan FROM races WHERE slug = $1 AND user_uuid = $2::uuid`,
    [slug, userUuid],
  );
  return r.rows[0] ?? null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * SESSION GRADING · the conservative posture the header describes
 * ═══════════════════════════════════════════════════════════════════════ */

function sessionTests(w: PlanWorkoutRow): GradedSession['tests'] {
  const t = `${w.type ?? ''} ${w.sub_label ?? ''}`.toLowerCase();
  if (w.is_long) return 'LONG_RUN';
  if (/threshold|tempo|cruise/.test(t)) return 'THRESHOLD';
  if (/interval|repeat|rep\b|vo2|speed/.test(t)) return 'HIGH_INTENSITY';
  if (/marathon.?pace|\bmp\b/.test(t)) return 'MARATHON_EFFORT';
  return 'EASY';
}

function provenanceFor(run: RunData, activityId: string, dateISO: string): Provenance {
  const indoor = String((run as Record<string, unknown>).indoor ?? '').toLowerCase() === 'true'
    || (run as Record<string, unknown>).sportType === 'treadmill';
  return {
    activityId,
    dateISO,
    // Conservative: only the ONE flag this loader can detect cheaply and
    // confidently (treadmill), never a guess at hills/wind/heat/altitude —
    // an unclaimed flag is not evidence the session was clean, and a
    // fabricated one is worse than none. `qualifiesAsThresholdEvidence` /
    // `qualifiesAsLongRunEvidence` (`admissibility.ts`) apply their own
    // per-lever rules on top of whatever this array carries.
    paceFlags: indoor ? ['TREADMILL_UNCALIBRATED'] : [],
    truncation: { truncated: false, completeWorkPhasesCaptured: true, note: '' },
    treadmill: indoor,
  };
}

/** See the file header · C1/C2 supplied as `absent()`, which resolves to
 *  INSUFFICIENT via `gradeStimulus`'s own precondition rather than a guess. */
function buildGradedSession(args: {
  activityId: string;
  dateISO: string;
  run: RunData;
  workout: PlanWorkoutRow;
}): GradedSession {
  const { activityId, dateISO, run, workout } = args;
  const provenance = provenanceFor(run, activityId, dateISO);
  const phases = runPhases(run);
  const workPhases = phases.filter((p) => p.type === 'work');
  const hasPhases = workPhases.length > 0;

  const targetPaceSecPerMi = num(workout.workout_spec?.tempo_pace_s_per_mi)
    ?? num(workout.pace_target_s_per_mi)
    ?? null;

  let actualWorkPaceSecPerMi: Measured<number> = absent('no work-phase pace recorded');
  let meanWorkHrBpm: Measured<number> = absent('no work-phase heart rate recorded');
  let workSegmentHrBpm: Array<Measured<number>> = [];
  let acceptableSegments: Measured<number> = absent('no per-segment verdict recorded');

  if (hasPhases) {
    const paces = workPhases.map((p) => p.actualPaceSPerMi).filter((v): v is number => v != null);
    if (paces.length > 0) {
      actualWorkPaceSecPerMi = measured(sum(paces) / paces.length);
    }
    const hrs = workPhases.map((p) => p.avgHr).filter((v): v is number => v != null);
    if (hrs.length > 0) {
      meanWorkHrBpm = measured(sum(hrs) / hrs.length);
    }
    workSegmentHrBpm = workPhases.map((p) => (p.avgHr != null ? measured(p.avgHr) : absent('phase HR not recorded')));
    const withVerdict = workPhases.filter((p) => p.verdict != null);
    if (withVerdict.length > 0) {
      acceptableSegments = measured(withVerdict.filter((p) => wireVerdictLandedTheWork(p.verdict)).length);
    }
  }

  // HRCEILING-1 · not taken at face value. A generic aerobic cap stamped on a
  // quality row is a pre-ZONEBAND-1 artefact and is not a bound on threshold or
  // interval work; `workHrCeilingFor` is the one owner of that distinction and
  // the replay harness calls the same function. See its header for the measured
  // cost of not doing this.
  const hrCapBpm = num(workout.workout_spec?.hr_cap_bpm);

  const input: StimulusInput = {
    // See file header · deliberately absent rather than approximated.
    prescribedWorkSeconds: 0,
    completedWorkSeconds: absent('prescribed per-segment work duration not parsed from workout_spec'),
    prescribedSegments: hasPhases ? workPhases.length : 0,
    acceptableSegments,
    targetWorkPaceSecPerMi: targetPaceSecPerMi ?? 0,
    actualWorkPaceSecPerMi,
    meanWorkHrBpm,
    hrCeilingBpm: workHrCeilingFor(sessionTests(workout), hrCapBpm),
    workSegmentHrBpm,
    hrReliable: isHrReliable(run),
    majorLateCollapse: absent('late-session comparison not built for live evaluation yet'),
    prescribedRecoverySeconds: 0,
    actualRecoverySeconds: absent('recovery duration not parsed from workout_spec'),
    dataCompleteAndSegmented: hasPhases,
    paceDiscountFlags: provenance.paceFlags,
  };

  const assessment = gradeStimulus(input);

  return {
    provenance,
    tests: sessionTests(workout),
    grade: assessment.grade,
    workPaceSecPerMi: runPaceSecPerMi(run) != null ? measured(runPaceSecPerMi(run)!) : absent('whole-run pace unreadable'),
    // C13/Q20's threshold-equivalent conversion belongs to the pace-
    // prescription owner, not this loader. Conservatively absent for
    // non-race sessions; a THRESHOLD-tested session's demonstrated pace
    // stands in for it directly, matching the doctrine's own base case
    // ("for a threshold workout the two are the same number").
    thresholdEquivalentPaceSecPerMi: sessionTests(workout) === 'THRESHOLD' && actualWorkPaceSecPerMi.ok
      ? actualWorkPaceSecPerMi
      : absent('no threshold-equivalent conversion available for this session'),
    thirds: { // Not built for quality-session grading (only for long runs) —
      // deterioration within a threshold/interval SET is a distinct, harder
      // question this loader does not attempt tonight.
      middlePaceSecPerMi: absent('not evaluated for quality sessions'),
      finalPaceSecPerMi: absent('not evaluated for quality sessions'),
      middleHrBpm: absent('not evaluated for quality sessions'),
      finalHrBpm: absent('not evaluated for quality sessions'),
      comparable: false,
    },
    raceDistance: null,
  };
}

/**
 * HRFLATLINE-1 (2026-09-04) · reliable means MEASURED, not merely present.
 *
 * This asked only whether the run-level average sat in a human range. The
 * owner's 2026-09-03 hill session averages about 125 and sails through, and its
 * trace is not a heart rate: eight distinct values across 21 phases and ~460
 * samples, Hill 1 holding exactly 134 bpm for all 18 samples of a 60-second
 * rep, Hill 5 holding 103. A heart rate does not do that, and it does not FALL
 * into a hill rep.
 *
 * HRPHASE-1, landed the same day, correctly stopped discarding those readings —
 * `phaseAvgHr` now derives a phase mean from `hrSamples` when no top-level
 * `avgHr` exists, because throwing away a reading that is sitting on the row is
 * not honest. The consequence is that these held values now BECOME the numbers
 * C4 grades against, and the failure runs both ways: 103 bpm reads as a
 * comfortably-under-ceiling session that was never measured, and a held-high
 * value reads as an over-cooked one.
 *
 * Rule 11's other half: "don't know" is not "failed", and PRESENT is not
 * READABLE. Scoped deliberately to the ADAPTATION evidence path, where a wrong
 * HR moves a capacity belief. What the runner SEES is `runPhases`' question and
 * is not changed here — see the report for that follow-up.
 */
function isHrReliable(run: RunData): boolean {
  const avg = runAvgHr(run);
  if (avg == null || avg <= 60 || avg >= 220) return false;
  // The RAW phases, not `runPhases`. The normalizer exposes the derived
  // `avgHr` and not the samples it came from, and widening a shared type that
  // every surface reads — for a check only the evidence path needs — would be
  // the wrong trade. Read here, judged here.
  const raw = Array.isArray((run as { phases?: unknown }).phases)
    ? ((run as { phases?: unknown[] }).phases ?? [])
    : [];
  const work = raw
    .filter((p): p is Record<string, unknown> =>
      !!p && typeof p === 'object' && (p as Record<string, unknown>).type === 'work')
    .map((p) => ({
      label: typeof p.label === 'string' ? p.label : null,
      samples: (Array.isArray(p.hrSamples) ? p.hrSamples : [])
        .map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>).bpm : null))
        .filter((n): n is number => typeof n === 'number' && Number.isFinite(n)),
    }));
  return workTraceIsCredible(work).credible;
}

/** Long-run thirds from mile splits · see file header for the coarseness
 *  this accepts. */
function buildThirds(run: RunData): ComparableThirds {
  const splits = splitsWithHrAndPace((run as Record<string, unknown>).splits);
  if (splits.length < 6) {
    return {
      middlePaceSecPerMi: absent(`only ${splits.length} splits recorded, fewer than the 6 needed for a comparable middle/final third`),
      finalPaceSecPerMi: absent(`only ${splits.length} splits recorded, fewer than the 6 needed for a comparable middle/final third`),
      middleHrBpm: absent('too few splits for a comparable third'),
      finalHrBpm: absent('too few splits for a comparable third'),
      comparable: false,
    };
  }
  const n = splits.length;
  const thirdSize = Math.floor(n / 3);
  const middle = splits.slice(thirdSize, thirdSize * 2);
  const final = splits.slice(thirdSize * 2);
  const mean = (xs: number[]): number => sum(xs) / xs.length;
  return {
    middlePaceSecPerMi: measured(mean(middle.map((s) => s.paceSec))),
    finalPaceSecPerMi: measured(mean(final.map((s) => s.paceSec))),
    middleHrBpm: measured(mean(middle.map((s) => s.hr))),
    finalHrBpm: measured(mean(final.map((s) => s.hr))),
    comparable: true,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE BUILDER
 * ═══════════════════════════════════════════════════════════════════════ */

export interface LiveInputResult {
  readonly input: CanonicalAdaptationInput | null;
  /** Why no input could be built, when `input` is null. Rule 11: a refusal
   *  names its cause rather than looking like "nothing to report". */
  readonly refusal: string | null;
}

/**
 * Build a `CanonicalAdaptationInput` for `userUuid` AS OF NOW. Read-only,
 * best-effort: never throws for ordinary missing data (that becomes
 * `input.readable = false`, which `evaluateAdaptation` itself turns into an
 * honest REFUSE on every lever), but DOES surface as `refusal` the cases
 * where there is nothing to evaluate at all (no active plan, no linked
 * race).
 */
export async function buildLiveCanonicalInput(
  userUuid: string,
  nowISO: string = new Date().toISOString(),
  planSelection: PlanSelection = 'ACTIVE',
): Promise<LiveInputResult> {
  const asOf = day(nowISO);

  let plan: ActivePlanRow | null;
  try {
    plan = await readPlan(userUuid, asOf, planSelection);
  } catch (e) {
    return { input: null, refusal: `Could not read the active plan: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!plan) {
    return {
      input: null,
      refusal: planSelection === 'ACTIVE'
        ? 'No active plan for this athlete.'
        : `No plan had been authored for this athlete on or before ${asOf}.`,
    };
  }

  let race: RaceRow | null = null;
  if (plan.race_id) {
    try {
      race = await readRace(plan.race_id, userUuid);
    } catch { /* handled below as "no race" */ }
  }
  if (!race) return { input: null, refusal: `Active plan ${plan.id} has no readable linked race.` };

  const raceDistMi = distanceMiOfMeta(race.meta);
  const raceDateISO = (race.meta?.date as string | undefined) ?? null;
  if (raceDistMi == null || !raceDateISO) {
    return { input: null, refusal: `Race ${race.slug} is missing a distance or a date.` };
  }
  const racePlanGoal = (race.plan as { goal?: { finish_time_s?: unknown } } | null)?.goal;
  const goalSec = num(racePlanGoal?.finish_time_s);

  let weeks: PlanWeekRow[];
  let workouts: PlanWorkoutRow[];
  try {
    [weeks, workouts] = await Promise.all([readPlanWeeks(plan.id), readPlanWorkouts(plan.id)]);
  } catch (e) {
    return { input: null, refusal: `Could not read the plan structure: ${e instanceof Error ? e.message : String(e)}` };
  }

  const LOOKBACK_DAYS = 84; // 12 weeks — enough for the volume lever's 3-week
  // window plus margin, and for the long-run lever's 2-lookback with gaps.
  const sinceISO = addDays(asOf, -LOOKBACK_DAYS);

  let runs: RunRow[];
  try {
    runs = await readRecentRuns(userUuid, sinceISO, asOf);
  } catch (e) {
    // Rule 11 · the read FAILED, which is not the same as "no runs". Feed
    // `readable: false` through rather than an empty history, so
    // `evaluateAdaptation` returns REFUSE with the right reason on every
    // lever instead of a confident HOLD off a fabricated empty season.
    return buildUnreadableInput(userUuid, plan, workouts, raceDateISO, raceDistMi, goalSec, asOf,
      `Could not read recent training: ${e instanceof Error ? e.message : String(e)}`);
  }

  const runData = runs.map((r) => ({ id: r.id, d: asRunData(r.data), dateISO: runDay(asRunData(r.data)) ?? '' }))
    .filter((r) => r.dateISO !== '');

  /* ── WEEKS · prescribed against completed, current week excluded ────────── */

  const workoutsByDate = new Map<string, PlanWorkoutRow>();
  for (const w of workouts) workoutsByDate.set(w.date_iso, w);
  const weekByStart = new Map<string, PlanWeekRow>();
  for (const w of weeks) weekByStart.set(w.week_start_iso, w);

  const pastWeekStarts = [...new Set(runData.map((r) => weekStartOf(r.dateISO))
    .concat(workouts.filter((w) => w.date_iso < asOf).map((w) => weekStartOf(w.date_iso))))]
    .filter((ws) => ws < weekStartOf(asOf))
    .sort();

  const weekObservations: WeekObservation[] = pastWeekStarts.map((ws) => {
    const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i)).filter((d) => d < asOf);
    const pres = days.map((d) => workoutsByDate.get(d)).filter((w): w is PlanWorkoutRow => w != null);
    const prescribedMi = sum(pres.map((w) => num(w.distance_mi) ?? 0));
    const inWeek = runData.filter((r) => days.includes(r.dateISO));
    const unreadable = inWeek.filter((r) => runDistanceMi(r.d) === null);
    const completedMi: Measured<number> = unreadable.length > 0
      ? failed(`${unreadable.length} activities in this week have no readable distance`)
      : measured(sum(inWeek.map((r) => runDistanceMi(r.d) ?? 0)));
    const pw = weekByStart.get(ws) ?? null;
    const planIsRecovery = (plan!.mode ?? '').toLowerCase() === 'recovery';
    const planIsTaper = (plan!.mode ?? '').toLowerCase().includes('taper');
    const authoredPlanMode: AuthoredPlanMode = planIsRecovery ? 'RECOVERY' : planIsTaper ? 'TAPER' : 'BUILD';
    return {
      weekStartISO: ws,
      prescribedMi,
      completedMi,
      isCutback: pw?.is_cutback ?? false,
      authoredPlanMode,
      dataComplete: unreadable.length === 0,
    };
  });

  /* ── QUALITY SESSIONS · matched activity ↔ prescribed quality workout ───── */

  const qualitySessions: GradedSession[] = [];
  for (const w of workouts.filter((x) => x.is_quality && x.date_iso < asOf)) {
    const match = runData.find((r) => r.dateISO === w.date_iso);
    if (!match) continue;
    qualitySessions.push(buildGradedSession({ activityId: match.id, dateISO: match.dateISO, run: match.d, workout: w }));
  }

  /* ── LONG RUNS · the two most recent, per the contract's own count ──────── */

  const longRunObservations: LongRunObservation[] = [];
  const longWorkouts = workouts.filter((x) => x.is_long && x.date_iso < asOf).sort((a, b) => b.date_iso.localeCompare(a.date_iso));
  for (const w of longWorkouts) {
    const match = runData.find((r) => r.dateISO === w.date_iso);
    if (!match) continue;
    const nextDayWorkout = workoutsByDate.get(addDays(w.date_iso, 1))
      ?? workoutsByDate.get(addDays(w.date_iso, 2));
    const nextRun = nextDayWorkout ? runData.find((r) => r.dateISO === nextDayWorkout.date_iso) : undefined;
    longRunObservations.push({
      provenance: provenanceFor(match.d, match.id, match.dateISO),
      prescribedMi: num(w.distance_mi) ?? 0,
      completedMi: runDistanceMi(match.d) != null ? measured(runDistanceMi(match.d)!) : failed('long run has no readable distance'),
      thirds: buildThirds(match.d),
      // Conservative on purpose: this loader does not grade the FOLLOWING
      // session for material execution failure attributable to the long
      // run (that needs the same deeper stimulus reading this file's header
      // already defers). A completed key session the next day reads as
      // "not a KNOWN failure" — true — never a positive judgement it is not
      // equipped to make. Absent, not false, when no key session has run
      // yet at all, matching Q22's own instruction that this is a refusal
      // input, not a pass.
      followingKeySessionOk: nextRun == null || nextDayWorkout == null
        ? absent('no following key session has run yet')
        : measured(true),
    });
    if (longRunObservations.length >= 2) break;
  }

  /* ── BELIEF · carried, not computed ──────────────────────────────────────
   *
   * Per `input.ts`'s own contract: "the current belief, CARRIED not
   * computed." The honest live seed is what the runner is currently being
   * asked to run, mirroring `build-input.ts`'s own seeding argument for the
   * replay ("the honest seed... is what the runner was actually being asked
   * to run"). Threshold from the plan's own authored pace; weekly volume and
   * long-run mi from the CURRENT week's own prescription, since nothing has
   * ever progressed via the canonical engine yet (it is unwired from any
   * mutating path) — so "currently prescribed" and "currently believed" are
   * the same number until the day this engine's own proposals start being
   * accepted somewhere.
   */
  const currentWeekStart = weekStartOf(asOf);
  const thisWeekWorkouts = workouts.filter((w) => weekStartOf(w.date_iso) === currentWeekStart);
  const nextWeekStart = addDays(currentWeekStart, 7);
  const nextWeekWorkouts = workouts.filter((w) => weekStartOf(w.date_iso) === nextWeekStart);

  const belief: CapacityBelief = {
    thresholdPaceSecPerMi: num(plan.authored_state?.t_pace_s_per_mi) ?? num(plan.authored_state?.tPaceSPerMi) ?? 0,
    weeklyVolumeMi: sum(thisWeekWorkouts.map((w) => num(w.distance_mi) ?? 0)),
    longRunMi: Math.max(0, ...thisWeekWorkouts.filter((w) => w.is_long).map((w) => num(w.distance_mi) ?? 0), 0),
    supportingSessionCount: qualitySessions.filter((s) => s.grade === 'FULL' || s.grade === 'SUBSTANTIAL').length,
    oldestSupportingDateISO: qualitySessions.length > 0 ? qualitySessions[0].provenance.dateISO : null,
  };

  if (belief.thresholdPaceSecPerMi <= 0) {
    return { input: null, refusal: `Active plan ${plan.id} has no readable threshold pace in authored_state — nothing to carry as belief.` };
  }

  /* ── BOUNDARIES · cutback / race / taper, from the plan's own week flags ── */

  const futureCutbackWeek = weeks.find((w) => w.week_start_iso >= currentWeekStart && w.is_cutback);
  const futureRaceWeek = weeks.find((w) => w.week_start_iso >= currentWeekStart && w.is_race_week);
  const isTaperPlan = (plan.mode ?? '').toLowerCase().includes('taper');

  /* ── THE DEMAND CEILING · rule 1's only input ─────────────────────────────
   *
   * RULE 11 · the race read is wrapped on its own, because a failed read of
   * the race table and "he has not raced" are different facts and only one of
   * them lets the recovery term price. A throw here would abort the whole
   * evaluation over a term the model treats as one of seven.
   */
  let racesRun: RanRace[] | null = null;
  try {
    racesRun = await readRacesRun(userUuid, asOf);
  } catch {
    racesRun = null;
  }

  const substrate: DemandSubstrate = {
    asOfISO: asOf,
    runs: runData.map((r) => ({ dateISO: r.dateISO, distanceMi: runDistanceMi(r.d) })),
    sessions: workouts.map((w) => ({
      dateISO: w.date_iso,
      distanceMi: num(w.distance_mi),
      isQuality: w.is_quality,
      isLong: w.is_long,
      spec: w.workout_spec,
    })),
    cutbackWeekStarts: weeks.filter((w) => w.is_cutback || w.is_race_week).map((w) => w.week_start_iso),
    racesRun,
    weekObservations,
  };

  // The week rule 1 is about is the one a proposal would first affect: NEXT
  // week, the same week `plan.nextWeekPrescribedMi` describes. Pricing this
  // week instead would measure a proposal against a week it cannot change.
  const nextWeekQuantities = prescribedWeekQuantities(substrate, nextWeekStart);
  const ceiling = resolveAthleteWeeklyDemandCeiling({
    context: contextForWeek(substrate, nextWeekStart),
    week: {
      weeklyMi: nextWeekQuantities.weeklyMi ?? Number.NaN,
      longRunMi: nextWeekQuantities.longRunMi ?? Number.NaN,
      // RULE 11 · this is where the old literal `0` lived. A week whose quality
      // cannot be priced now REFUSES rather than pricing a pace correction at
      // zero added demand, which is what made rule 1 unable to defer one.
      qualityMinutes: nextWeekQuantities.qualityMinutes ?? Number.NaN,
      thresholdAnchorDeltaSecPerMi: 0,
    },
    demonstratedWeeks: demonstratedWeeksFrom(substrate),
  });

  const input: CanonicalAdaptationInput = {
    athleteId: userUuid,
    planVersion: plan.id,
    // The evidence epoch: the most recent completed-run date this loader
    // saw, so two evaluations over unchanged evidence collide on the same
    // idempotency key (per `decision-record.ts`'s own contract) rather than
    // re-raising a proposal every night on identical evidence.
    evidenceVersion: runData.length > 0 ? runData[runData.length - 1].dateISO : `no-runs-as-of-${asOf}`,
    evaluatedAtISO: nowISO,
    boundary: resolveBoundary(asOf),
    belief,
    race: { raceDateISO, raceDistance: nearestCanonicalDistance(raceDistMi) },
    goal: {
      goalFinishSeconds: goalSec ?? Math.round(raceDistMi * belief.thresholdPaceSecPerMi),
      goalPaceSecPerMi: goalSec != null ? Math.round(goalSec / raceDistMi) : belief.thresholdPaceSecPerMi,
    },
    plan: {
      planVersion: plan.id,
      nextWeekStartISO: nextWeekStart,
      nextWeekPrescribedMi: sum(nextWeekWorkouts.map((w) => num(w.distance_mi) ?? 0)),
      nextWeekLongRunMi: Math.max(0, ...nextWeekWorkouts.filter((w) => w.is_long).map((w) => num(w.distance_mi) ?? 0), 0),
      // Parsed from the authored `workout_spec` by `qualityMinutesOfWeek`,
      // which is a parse and not an estimate. It used to be a literal `0` with
      // a comment saying it was "not read live yet" — a hard-coded zero
      // standing in for an unread quantity, and it had a real consequence: a
      // zero-quality week prices a threshold-pace proposal at zero added
      // demand, so rule 1 could never defer a pace correction however full the
      // week was.
      //
      // RULE 11, and the limit of what this field can express: it is typed
      // `number`, so a week whose quality cannot be priced still arrives as 0
      // here. That zero is CONTAINED — the ceiling resolver above refuses on
      // the same unknown, so rule 1 cannot fire, and the only thing the zero
      // reaches is the reported demand share on a record that already carries
      // a FAILED ceiling posture explaining why.
      nextWeekQualityMinutes: nextWeekQuantities.qualityMinutes ?? 0,
      nextCutbackBoundaryISO: futureCutbackWeek?.week_start_iso ?? null,
      nextRaceBoundaryISO: futureRaceWeek?.week_start_iso ?? (raceDateISO >= asOf ? raceDateISO : null),
      taperStartISO: isTaperPlan ? plan.authored_iso.slice(0, 10) : null,
      futureThresholdSessionIds: workouts
        .filter((w) => w.date_iso >= asOf && /threshold|tempo|cruise/.test(`${w.type ?? ''} ${w.sub_label ?? ''}`.toLowerCase()))
        .map((w) => w.id),
      // Per-cycle step/anchor-move counters need a durable ledger this
      // loader does not have yet (nothing has ever progressed via this
      // engine). Zero/false is the honest starting state, not a guess.
      stepsTakenThisCycle: { THRESHOLD_PACE: 0, WEEKLY_VOLUME: 0, LONG_RUN: 0 },
      anchorMovedTodayForLever: { THRESHOLD_PACE: false, WEEKLY_VOLUME: false, LONG_RUN: false },
    },
    qualitySessions,
    weeks: weekObservations,
    longRuns: longRunObservations,
    // THE DEMAND MODEL, wired 2026-09-04.
    //
    // This used to read `absent('no weekly demand model is wired into this app
    // yet')`, and the consequence was stated here in as many words:
    // arbitration's rule 1, the week-level demand test, COULD NOT FIRE on any
    // live evaluation. It is now resolved out of
    // `lib/plan/adjudication/weekly-demand.ts` through
    // `canonical/demand-ceiling.ts`, against this athlete's own ABSORBED
    // weeks, with Rule 8's habit filter applied to those weeks and NOT to the
    // absorbed-load terms that price them — `demand-input.ts` states which
    // reader is on which side of the corollary, one by one.
    //
    // It is still frequently ABSENT, and that is correct rather than a
    // regression: a runner with no absorbed week yet has no ceiling, and the
    // refusal says so instead of inventing one. Every posture — READ, ABSENT,
    // FAILED — travels out on `ArbitrationResult.demandCeiling`, onto
    // `CanonicalEvaluation.demandCeiling`, and onto every decision record as
    // `INV_DEMAND_CEILING_POSTURE_STATED`. A reader of a live shadow record
    // can therefore tell "the week had room" from "nobody knew what the week's
    // ceiling was", which is the whole of Rule 11.
    athleteCeilingWeeklyDemand: ceiling,
    readable: true,
  };

  return { input, refusal: null };
}

/** `EvaluationBoundary` for a live cron cycle: `WEEKLY_BOUNDARY` on the
 *  runner's own long-run day (matching `docs/ADAPTATION_ENGINE_CONTRACT.md`
 *  "at the weekly boundary once the week's evidence has settled" — the same
 *  day the app already treats as the week's edge, per CLAUDE.md's "week
 *  boundary = long-run day" note), `SESSION_COMPLETED` otherwise. Both are
 *  legitimate per the contract; the cron fires once daily, so this is the
 *  simplest honest classification available without a per-session trigger. */
function resolveBoundary(asOfISO: string): EvaluationBoundary {
  const dow = new Date(Date.parse(`${asOfISO}T12:00:00Z`)).getUTCDay(); // 0 = Sunday
  return dow === 0 ? 'WEEKLY_BOUNDARY' : 'SESSION_COMPLETED';
}

function buildUnreadableInput(
  userUuid: string, plan: ActivePlanRow, workouts: PlanWorkoutRow[],
  raceDateISO: string, raceDistMi: number, goalSec: number | null, asOf: string,
  _reason: string,
): LiveInputResult {
  const belief: CapacityBelief = {
    thresholdPaceSecPerMi: num(plan.authored_state?.t_pace_s_per_mi) ?? 0,
    weeklyVolumeMi: 0, longRunMi: 0, supportingSessionCount: 0, oldestSupportingDateISO: null,
  };
  const nextWeekStart = addDays(weekStartOf(asOf), 7);
  void workouts;
  return {
    input: {
      athleteId: userUuid, planVersion: plan.id, evidenceVersion: `unreadable-${asOf}`,
      evaluatedAtISO: asOf, boundary: resolveBoundary(asOf), belief,
      race: { raceDateISO, raceDistance: nearestCanonicalDistance(raceDistMi) },
      goal: {
        goalFinishSeconds: goalSec ?? Math.round(raceDistMi * (belief.thresholdPaceSecPerMi || 1)),
        goalPaceSecPerMi: goalSec != null ? Math.round(goalSec / raceDistMi) : belief.thresholdPaceSecPerMi,
      },
      plan: {
        planVersion: plan.id, nextWeekStartISO: nextWeekStart, nextWeekPrescribedMi: 0,
        nextWeekLongRunMi: 0, nextWeekQualityMinutes: 0, nextCutbackBoundaryISO: null,
        nextRaceBoundaryISO: raceDateISO >= asOf ? raceDateISO : null, taperStartISO: null,
        futureThresholdSessionIds: [],
        stepsTakenThisCycle: { THRESHOLD_PACE: 0, WEEKLY_VOLUME: 0, LONG_RUN: 0 },
        anchorMovedTodayForLever: { THRESHOLD_PACE: false, WEEKLY_VOLUME: false, LONG_RUN: false },
      },
      qualitySessions: [], weeks: [], longRuns: [],
      athleteCeilingWeeklyDemand: failed(
        'the training data for this athlete could not be read, so no week could be priced '
        + 'against a ceiling',
      ),
      readable: false,
    },
    refusal: null,
  };
}

export const _internal = { weekStartOf, nearestCanonicalDistance, sessionTests };
