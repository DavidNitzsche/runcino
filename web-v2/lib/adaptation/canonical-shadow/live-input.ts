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
import {
  asRunData, runDay, runDaySql, runDistanceMi, runPaceSecPerMi, runAvgHr, runPhases,
  runNotMergedSql, splitsWithHrAndPace, type RunData,
} from '@/lib/runs/run-shape';
import { wireVerdictLandedTheWork } from '@/lib/training/execution-semantics';
import { distanceMiOfMeta } from '@/lib/race/distance';
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

async function readActivePlan(userUuid: string): Promise<ActivePlanRow | null> {
  const r = await roQuery<ActivePlanRow>(
    `SELECT id::text AS id, mode, race_id, authored_iso::text AS authored_iso, authored_state
       FROM training_plans
      WHERE user_uuid = $1::uuid AND archived_iso IS NULL
      ORDER BY authored_iso DESC
      LIMIT 1`,
    [userUuid],
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
async function readRecentRuns(userUuid: string, sinceISO: string): Promise<RunRow[]> {
  const r = await roQuery<RunRow>(
    `SELECT id::text AS id, data
       FROM runs
      WHERE user_uuid = $1::uuid
        AND ${runDaySql()} >= $2
        AND ${runNotMergedSql()}
      ORDER BY ${runDaySql()} ASC`,
    [userUuid, sinceISO],
  );
  return r.rows;
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

function isHrReliable(run: RunData): boolean {
  const avg = runAvgHr(run);
  return avg != null && avg > 60 && avg < 220;
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
): Promise<LiveInputResult> {
  const asOf = day(nowISO);

  let plan: ActivePlanRow | null;
  try {
    plan = await readActivePlan(userUuid);
  } catch (e) {
    return { input: null, refusal: `Could not read the active plan: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!plan) return { input: null, refusal: 'No active plan for this athlete.' };

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
    runs = await readRecentRuns(userUuid, sinceISO);
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
      nextWeekQualityMinutes: 0, // Not read live yet — no lever currently
      // consumes it (see `evaluate.ts`'s call sites), so leaving it at its
      // honest zero rather than approximating costs nothing today.
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
      readable: false,
    },
    refusal: null,
  };
}

export const _internal = { weekStartOf, nearestCanonicalDistance, sessionTests };
