/**
 * lib/plan/adjudication/rolling-boundary-evaluator.ts · THE SCHEDULED
 * EVALUATION `rolling-boundary.ts` NEVER HAD.
 *
 * ── THE GAP THIS CLOSES ─────────────────────────────────────────────────────
 *
 * `rolling-boundary.ts` computes three decisions and its own header is
 * explicit about what it cannot do: "It cannot write. It returns the exact
 * mutation each boundary WOULD make." LIVESEQ-2 (2026-09-05, `app/api/cron/
 * run-adaptations/route.ts`) wired the SCHEDULING half — `boundariesForWeek`
 * queues three `reassessment_schedule` rows a night, one per boundary, via
 * `scheduleReassessment`. Nothing wired the other half. Grepping the whole
 * repo for `boundaryBeforeWeek(`, `boundaryAfterQuality(` and
 * `boundaryAfterRace(` outside `rolling-boundary.ts` itself and its own test
 * turns up nothing — a scheduled promise with no evaluator reading it back is
 * exactly the "wired, tested and inert" failure CLAUDE.md names as this
 * codebase's signature defect, one layer further along the pipe than the
 * ones already found: the SCHEDULE reaches production (in `SHADOW`, per
 * `lib/brain/orchestration/steps.ts` step 12, blocked on migration 167); the
 * QUESTION the schedule exists to ask again was never re-asked.
 *
 * This file is that evaluator. It is deliberately NOT wired into
 * `run-adaptations/route.ts` in this change — that file had concurrent work
 * in flight the night this was written and touching it risked exactly the
 * kind of collision CLAUDE.md's branching section warns about. The call site
 * this needs is documented at the bottom of this header rather than applied
 * blind.
 *
 * ── "COMPLETE DEMAND", STATED PRECISELY ─────────────────────────────────────
 *
 * The owner's own correction on the thing this whole file exists to prevent:
 * "three stressors versus three stressors is not enough to prove equivalent
 * demand." A boundary that reads a week's demand from a PARTIAL window — the
 * week still in progress, or a week whose completion nobody has confirmed yet
 * — can misjudge a crossing in either direction, which is exactly Rule 9's
 * cliff shape wearing a data-freshness costume instead of a threshold one.
 * So `readCompletedWeek` below REFUSES (Rule 11 — never guesses) unless the
 * week it is pricing has fully elapsed as of the day being evaluated, and
 * `evaluateBoundary1FromReadings` refuses again, independently, on the same
 * question, so a caller that skips the reader's own guard cannot still reach
 * a partial-week verdict through the pure path. Both refusals are
 * independently tested below (`_rolling_boundary_evaluator.test.ts`).
 *
 * ── WHERE EACH INPUT COMES FROM, AND WHERE IT DOES NOT ──────────────────────
 *
 * BOUNDARY 1 (week_demand_step) is fully wired to real production reads:
 *   · prescribed weekly mi / longest / quality minutes for trailing weeks AND
 *     the proposed week come from `lib/plan/adjudication/live-sequence.ts`'s
 *     `loadPlannedWeeks` (the SAME reader LIVESEQ-1/2 already uses) plus one
 *     small `plan_workouts.workout_spec` read priced through
 *     `qualityMinutesOfWeek` — reused, not re-implemented (Rule 16).
 *   · COMPLETED weekly mi / longest come from `mileageByDay`
 *     (`lib/runs/volume.ts`), the app's one canonical mileage reader
 *     (Rule 14's `CANONICAL_ROW_SQL`).
 *   · completed quality minutes for a trailing week are the authored work of
 *     only the sessions that have a matching real run that week — the same
 *     technique `demonstratedWeeksFrom` (`lib/adaptation/canonical-shadow/
 *     demand-input.ts`) already uses for the (different, richer) weekly-
 *     demand model, cited rather than duplicated blind.
 *   · the prescribed-dip filter (`demandBaseline`'s `isPrescribedDip`) uses
 *     `LiveWeek.isTaper` / `LiveWeek.isRaceWeek`, the SAME two flags the
 *     wired sequence loader already computes. This is a NARROWER proxy than
 *     the canonical `prescribedNonNormalWeek` (`lib/adaptation/canonical/
 *     input.ts`), which also reads authored plan mode and post-race recovery
 *     windows — named here as a real, stated scoping choice rather than a
 *     silent approximation, because building the fuller `WeekObservation`
 *     this file would need is a second substrate loader this task's time
 *     budget does not cover honestly.
 *   · the step is no longer graded against a flat allowance at all. As of
 *     2026-09-06 the owner ruled out `RERAMP_WEEKLY_GROWTH - 1` (and the
 *     0.15 this file's own test once used) as EITHER binary threshold —
 *     `RERAMP_WEEKLY_GROWTH` prices `Research/22 §14`'s comeback-from-absence
 *     ramp, a different question, and "no abrupt verdict change at 10% or
 *     15%" rules out a flat cutoff regardless of which citation backed it.
 *     `rolling-boundary.ts#demandStepConfidence` is the replacement: one
 *     continuous confidence number folding the growth step and a
 *     `DemandStepContext` (recent execution, baseline cleanliness,
 *     fatigue/safety, training phase, runway) together. This file's job is
 *     assembling that context from real reads — `recentExecutionCleanlinessOf`,
 *     `baselineFreedomFromDipOf`, `trainingPhaseOpennessFor` and
 *     `runwayOpennessFor` below — honestly, including where a real reader
 *     (fatigue/safety) does not exist yet.
 *
 * BOUNDARY 2 (weekend_after_quality) has its DISPATCH and MUTATION plumbing
 * complete, but the one input it needs — whether the mid-week session graded
 * FULL/SUBSTANTIAL/PARTIAL/DIFFERENT/INSUFFICIENT — is NOT computed here.
 * `gradeStimulus` (`lib/adaptation/canonical/stimulus.ts`) needs a prescribed
 * per-segment work duration that `lib/adaptation/canonical-shadow/
 * live-input.ts`'s own header already documents as unbuilt ("most live
 * sessions will grade INSUFFICIENT until a work-duration parser is built").
 * Building a second, narrower parser here to avoid that gap would be exactly
 * the second engine `docs/BRAIN_CONSTITUTION.md` forbids for a question that
 * already has one canonical owner. `readAbsorbedGrade` below is therefore an
 * HONEST stub: it always returns `null` (ungraded) until that parser exists
 * anywhere in the app, which makes boundary 2 REFUSE in production rather
 * than fabricate a grade — a stated, not a hidden, gap (Rule 20).
 *
 * BOUNDARY 3 (long_run_after_race) reads the race's DECLARED priority from
 * `races.meta.priority` and classifies by `Research/00b`'s own "Recovery by
 * Effort (A/B/C Race)" table, reusing `GRADED_RACE_PRIORITIES` /
 * `isGradedRacePriority` from `lib/race/effort-authority.ts` — the app's
 * existing owner of that exact table — rather than re-deriving the mapping:
 * A → TRUE_RACE, B → THRESHOLD_LIKE, C → CONTROLLED_C, ungraded → UNRELIABLE.
 * This is the DECLARED class, not a pace-verified actual effort, which is the
 * same conservative posture `effort-authority.ts`'s own header states for
 * its own consumer ("grades the DECLARED class... a downgrade can only ever
 * lower authority"). Note the ungraded mapping deliberately DIVERGES from
 * `selectionAuthority`'s own convention (which grades ungraded at the C row
 * for evidence-weighting reasons): boundary 3 is a safety-facing decision, an
 * unREADABLE priority is not evidence the effort was mild, and `UNRELIABLE`
 * already reduces conservatively by rolling-boundary's own design — mapping
 * ungraded there is the more honest fit for THIS consumer, not a disagreement
 * with that file's own reasoning for a different one.
 *
 * ── WHAT THIS FILE DOES WITH A DECISION, GIVEN AUTOMATIC_ADAPTATION_AUTHORITY
 *    IS FALSE ──────────────────────────────────────────────────────────────
 *
 * It never mutates a plan. `resolveEvaluatedBoundary` records the verdict and
 * the exact mutation the boundary WOULD make onto the scheduled item itself
 * (`resultingDecision` / `resultingDecisionDetail`, via `resolveReassessment`
 * — a durable, queryable record once migration 167 lands) and logs it, the
 * same "reachable and recorded is a different state from surfaced" posture
 * `lib/brain/orchestration/steps.ts` already states for step 9, and the same
 * report-don't-write posture LIVESEQ-1 already took one function up this same
 * file. It does not call `lib/plan/workout-proposals.ts` or `lib/brain/
 * proposal/*` — both use a different action/trigger type shape built for a
 * different engine, and wiring a THIRD proposal pathway into either without
 * reading their full contracts risks exactly the "second owner for one
 * decision" `docs/BRAIN_CONSTITUTION.md` forbids. Surfacing a REDUCE verdict
 * to the runner as an actionable proposal is real, follow-on work, named here
 * rather than done blind.
 *
 * ── ROLLINGBOUNDARY-EVAL-1 (2026-09-06) · THE CALL SITE, NOW APPLIED ────────
 *
 * `app/api/cron/run-adaptations/route.ts` calls
 * `evaluateDueRollingBoundariesForUser(uid, today)` in its own try/catch,
 * immediately after the LIVESEQ-2 block that schedules these three
 * boundaries every night (search `ROLLINGBOUNDARY-EVAL-1` in that file). A
 * throw here costs only this one runner's rolling-boundary pass, matching
 * every other best-effort mechanism in that loop.
 *
 * This reads this runner's own DUE rolling-boundary items (Rule 14 · scoped
 * to `uid`, never a global sweep from inside a per-runner loop) and resolves
 * each. It is intentionally NOT a new cron: `lib/ops/reassessment-scheduler
 * .ts`'s own header quotes `cron-ledger.ts`'s argument against that shape —
 * "another schedule is another thing that can silently stop firing."
 *
 * What this does NOT yet claim: migration 167 (`reassessment_schedule`) is
 * drafted and unapplied to production, so every call answers `table_absent`
 * today, honestly, exactly like steps 12 and 16 already do in
 * `lib/brain/orchestration/steps.ts`. The moment 167 lands, this evaluator
 * starts actually resolving due items with no further code change.
 */
import { pool } from '@/lib/db/pool';
import { mileageByDay } from '@/lib/runs/volume';
import { qualityMinutesOfWeek } from './quality-minutes';
import { roundTo } from '@/lib/format/run';
import { loadPlannedWeeks, type LiveWeek } from './live-sequence';
import { GRADED_RACE_PRIORITIES, isGradedRacePriority } from '@/lib/race/effort-authority';
import {
  priceWeek, demandBaseline, boundaryBeforeWeek, boundaryAfterQuality, boundaryAfterRace, clamp01,
  NEUTRAL_FATIGUE_SAFETY_CLEARANCE, NEUTRAL_UNKNOWN_CONTEXT,
  type WeekDemand, type BoundaryDecision, type RaceEffort, type DemandStepContext,
} from './rolling-boundary';
import {
  loadLiveQueue, resolveReassessment, type ScheduledReassessment,
} from '@/lib/ops/reassessment-scheduler';

void GRADED_RACE_PRIORITIES; // referenced for the doc block above; the runtime use is isGradedRacePriority

/**
 * "Available runway" (`DemandStepContext.runwayOpenness`) · how many
 * authored weeks remain after the proposed one. Full openness at this many
 * weeks or more remaining, ramping continuously down to zero at none — a
 * stated, arbitrary-but-argued constant (there is no doctrine citation for
 * "how many weeks of runway is enough"; four is roughly one training-cycle
 * micro-block), not a re-derivation of a doctrine number.
 */
const RUNWAY_FULL_WEEKS = 4;

/** How many of the authored plan's OWN weeks fall strictly after `weekStartISO`. */
function weeksRemainingAfter(planWeeks: ReadonlyMap<string, LiveWeek>, weekStartISO: string): number {
  let n = 0;
  for (const ws of planWeeks.keys()) if (ws > weekStartISO) n += 1;
  return n;
}

/** `DemandStepContext.runwayOpenness` for the week being proposed. */
function runwayOpennessFor(planWeeks: ReadonlyMap<string, LiveWeek>, weekStartISO: string): number {
  return clamp01(weeksRemainingAfter(planWeeks, weekStartISO) / RUNWAY_FULL_WEEKS);
}

/** `DemandStepContext.trainingPhaseOpenness` for the week being proposed —
 *  zero when the PROPOSED week is itself a taper or a race week, one
 *  otherwise. Defaults to open (1) only when the week cannot be found at all,
 *  which should not happen on this path (the caller already resolved a
 *  `WeekDemand` for it) — never a silent "assume closed" or "assume open" for
 *  a week that IS resolvable, per Rule 11. */
function trainingPhaseOpennessFor(planWeeks: ReadonlyMap<string, LiveWeek>, weekStartISO: string): number {
  const week = planWeeks.get(weekStartISO);
  if (!week) return 1;
  return week.isTaper || week.isRaceWeek ? 0 : 1;
}

/**
 * `DemandStepContext.recentExecutionCleanliness` · the average, across every
 * trailing week that carries a real prescription, of how much of it actually
 * landed (capped at 1.0 — over-running the prescription is not "more clean").
 * Weeks with no prescribed mileage (a prescribedMi of 0) are skipped rather
 * than counted as either clean or dirty, since there is nothing to measure
 * completion against. Empty trailing (nothing to average) reads as the
 * neutral midpoint, not as clean — Rule 11 again.
 */
function recentExecutionCleanlinessOf(trailing: readonly CompletedWeekReading[]): number {
  const ratios = trailing
    .filter((w) => w.prescribedMi > 0)
    .map((w) => clamp01(w.weeklyMi / w.prescribedMi));
  if (ratios.length === 0) return NEUTRAL_UNKNOWN_CONTEXT;
  return ratios.reduce((a, b) => a + b, 0) / ratios.length;
}

/**
 * `DemandStepContext.baselineFreedomFromDip` · the fraction of the trailing
 * weeks that were NOT a prescribed dip (taper/race/recovery). `demandBaseline`
 * already refuses outright when every trailing week was a dip; this is the
 * continuous read of the weeks it did not refuse on — a baseline built from
 * three clean weeks is more trustworthy support than one built from two clean
 * and one race week, even though both pass the all-dip refusal.
 */
function baselineFreedomFromDipOf(trailing: readonly CompletedWeekReading[]): number {
  if (trailing.length === 0) return NEUTRAL_UNKNOWN_CONTEXT;
  const clean = trailing.filter((w) => !w.isPrescribedDip).length;
  return clean / trailing.length;
}

const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const daysOfWeek = (weekStartISO: string): string[] =>
  Array.from({ length: 7 }, (_, i) => addDays(weekStartISO, i));

/* ══════════════════════════════════════════════════════════════════════════
 * BOUNDARY 1 · PURE DECISION OVER ALREADY-READ, COMPLETE DATA
 * ═══════════════════════════════════════════════════════════════════════ */

export interface CompletedWeekReading {
  readonly weekStartISO: string;
  /** ACTUAL completed mileage, `mileageByDay` summed. */
  readonly weeklyMi: number;
  /** ACTUAL longest single day. */
  readonly longRunMi: number;
  /** ACTUAL quality minutes: authored work of sessions that were really run. */
  readonly qualityMinutes: number;
  /** What the plan prescribed for this same week, for the completion ratio. */
  readonly prescribedMi: number;
  readonly isPrescribedDip: boolean;
  /** The last calendar day of this week — the reading is not COMPLETE before it. */
  readonly weekEndISO: string;
}

export type CompletedWeekResult =
  | { readonly ok: true; readonly reading: CompletedWeekReading }
  | { readonly ok: false; readonly why: string };

/**
 * The pure core: given already-gathered complete readings, price them and
 * call `boundaryBeforeWeek`. Never touches the database, so this is where
 * Rule 9 continuity and the completeness refusal are unit-tested without a
 * live connection.
 */
export function evaluateBoundary1FromReadings(args: {
  /** Oldest to newest; the LAST entry is "the preceding week". */
  readonly trailing: readonly CompletedWeekReading[];
  readonly proposed: WeekDemand;
  readonly todayISO: string;
  readonly targetWorkoutId: string | null;
  readonly targetDateISO: string | null;
  /** "Training phase" and "available runway" — real reads the caller owns
   *  (they need the whole authored block, which this pure function does not
   *  see), passed through rather than re-derived here. */
  readonly trainingPhaseOpenness: number;
  readonly runwayOpenness: number;
  /** "Fatigue, safety" — override for tests / a future real reader. Defaults
   *  to the honest neutral until an ACWR/HRV feed exists (Rule 11). */
  readonly fatigueSafetyClearance?: number;
}): BoundaryDecision {
  if (args.trailing.length === 0) {
    return {
      verdict: 'REFUSE',
      because: 'no trailing week is readable, so a step cannot be sized against anything',
      mutation: null,
    };
  }
  const preceding = args.trailing[args.trailing.length - 1];
  // COMPLETE DEMAND, ENFORCED HERE TOO (not only in the reader): a week is
  // never scored until every one of its days is in the past. Independently
  // re-checked from the reader's own guard so a caller that constructs
  // `CompletedWeekReading` by hand (as the tests below do, deliberately, to
  // prove this) cannot walk around it.
  if (args.todayISO < preceding.weekEndISO) {
    return {
      verdict: 'REFUSE',
      because: `the preceding week (${preceding.weekStartISO}) has not fully elapsed as of `
        + `${args.todayISO} · a step is sized off a complete week, never a partial one`,
      mutation: null,
    };
  }

  const trailingPriced = args.trailing.map((w) => priceWeek(w));
  const dipByWeek = new Map(args.trailing.map((w) => [w.weekStartISO, w.isPrescribedDip]));
  const baseline = demandBaseline(trailingPriced, (weekStartISO) => dipByWeek.get(weekStartISO) ?? false);

  const completionRatio = preceding.prescribedMi > 0 ? preceding.weeklyMi / preceding.prescribedMi : null;

  const context: DemandStepContext = {
    recentExecutionCleanliness: recentExecutionCleanlinessOf(args.trailing),
    baselineFreedomFromDip: baselineFreedomFromDipOf(args.trailing),
    fatigueSafetyClearance: args.fatigueSafetyClearance ?? NEUTRAL_FATIGUE_SAFETY_CLEARANCE,
    trainingPhaseOpenness: args.trainingPhaseOpenness,
    runwayOpenness: args.runwayOpenness,
  };

  return boundaryBeforeWeek({
    proposed: args.proposed,
    baseline,
    completionRatio,
    context,
    targetWorkoutId: args.targetWorkoutId,
    targetDateISO: args.targetDateISO,
  });
}

/**
 * THE DATABASE READ. Complete-or-refuse, per the header above.
 *
 * `planWeeks` is the already-loaded `loadPlannedWeeks` result so this never
 * issues its own duplicate of that query (Rule 16) — callers load it once per
 * runner and pass the same map into every week this reads.
 */
export async function readCompletedWeek(
  userUuid: string,
  planWeeks: ReadonlyMap<string, LiveWeek>,
  weekStartISO: string,
  todayISO: string,
): Promise<CompletedWeekResult> {
  const week = planWeeks.get(weekStartISO);
  if (!week) {
    return { ok: false, why: `no prescribed week starts ${weekStartISO} in the active plan` };
  }
  const days = daysOfWeek(weekStartISO);
  const weekEndISO = days[days.length - 1];
  if (todayISO < weekEndISO) {
    return {
      ok: false,
      why: `${weekStartISO} has not fully elapsed as of ${todayISO}; a complete-demand reader `
        + 'refuses a partial week rather than pricing what has run so far',
    };
  }

  let mileage: Awaited<ReturnType<typeof mileageByDay>>;
  try {
    mileage = await mileageByDay(userUuid, weekStartISO, weekEndISO);
  } catch (e) {
    return { ok: false, why: `reading completed mileage failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  let weeklyMi = 0;
  let longRunMi = 0;
  for (const v of mileage.values()) {
    weeklyMi += v.mi;
    if (v.mi > longRunMi) longRunMi = v.mi;
  }
  weeklyMi = roundTo(weeklyMi);

  // Quality minutes ACTUALLY delivered: only the prescribed quality/long rows
  // that have a matching real run that day count (same technique
  // `demonstratedWeeksFrom` uses in `demand-input.ts` — cited above, not
  // duplicated blind).
  const ranQualityRows = week.rows.filter((r) => r.stressor !== null && mileage.has(r.dateISO));
  let qualityMinutes = 0;
  if (ranQualityRows.length > 0) {
    let specRows: { date_iso: string; workout_spec: Record<string, unknown> | null; is_quality: boolean | null; is_long: boolean | null }[];
    try {
      const r = await pool.query<{
        date_iso: string; workout_spec: Record<string, unknown> | null;
        is_quality: boolean | null; is_long: boolean | null;
      }>(
        `SELECT pw.date_iso::text AS date_iso, pw.workout_spec, pw.is_quality, pw.is_long
           FROM plan_workouts pw
          WHERE pw.id = ANY($1::uuid[])`,
        [ranQualityRows.map((r) => r.id)],
      );
      specRows = r.rows;
    } catch (e) {
      return { ok: false, why: `reading workout specs for ${weekStartISO} failed: ${e instanceof Error ? e.message : String(e)}` };
    }
    const q = qualityMinutesOfWeek(specRows.map((r) => ({
      dateISO: r.date_iso, spec: r.workout_spec, isQuality: r.is_quality === true, isLong: r.is_long === true,
    })));
    // Rule 11 · an unpriceable session makes the WEEK'S quality unknown, and
    // this reader refuses rather than reporting a partial sum as the total —
    // a partial sum here understates completed demand, which is the
    // direction that would let boundary 1 miss a real overreach.
    if (q.minutes === null) {
      return { ok: false, why: `${weekStartISO}'s completed quality work could not be priced: ${q.why}` };
    }
    qualityMinutes = q.minutes;
  }

  return {
    ok: true,
    reading: {
      weekStartISO,
      weeklyMi,
      longRunMi,
      qualityMinutes,
      prescribedMi: week.weeklyMi,
      isPrescribedDip: week.isTaper || week.isRaceWeek,
      weekEndISO,
    },
  };
}

/**
 * Prescribed demand for the week not yet run — the proposed week boundary 1
 * compares against. Reads `plan_workouts.workout_spec` for that week's rows
 * (already known from `planWeeks`) and prices quality minutes off the
 * PRESCRIPTION, same technique `prescribedWeekQuantities` in `demand-input.ts`
 * uses for the richer model — not re-derived from scratch.
 */
export async function readProposedWeekDemand(
  planWeeks: ReadonlyMap<string, LiveWeek>,
  weekStartISO: string,
): Promise<{ ok: true; demand: WeekDemand } | { ok: false; why: string }> {
  const week = planWeeks.get(weekStartISO);
  if (!week) return { ok: false, why: `no prescribed week starts ${weekStartISO} in the active plan` };
  const qualityRows = week.rows.filter((r) => r.stressor !== null);
  let qualityMinutes = 0;
  if (qualityRows.length > 0) {
    let specRows: { date_iso: string; workout_spec: Record<string, unknown> | null; is_quality: boolean | null; is_long: boolean | null }[];
    try {
      const r = await pool.query<{
        date_iso: string; workout_spec: Record<string, unknown> | null;
        is_quality: boolean | null; is_long: boolean | null;
      }>(
        `SELECT pw.date_iso::text AS date_iso, pw.workout_spec, pw.is_quality, pw.is_long
           FROM plan_workouts pw
          WHERE pw.id = ANY($1::uuid[])`,
        [qualityRows.map((r) => r.id)],
      );
      specRows = r.rows;
    } catch (e) {
      return { ok: false, why: `reading workout specs for ${weekStartISO} failed: ${e instanceof Error ? e.message : String(e)}` };
    }
    const q = qualityMinutesOfWeek(specRows.map((r) => ({
      dateISO: r.date_iso, spec: r.workout_spec, isQuality: r.is_quality === true, isLong: r.is_long === true,
    })));
    if (q.minutes === null) {
      return { ok: false, why: `${weekStartISO}'s prescribed quality work could not be priced: ${q.why}` };
    }
    qualityMinutes = q.minutes;
  }
  return {
    ok: true,
    demand: priceWeek({
      weekStartISO, weeklyMi: week.weeklyMi, longRunMi: week.longestMi, qualityMinutes,
    }),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * BOUNDARY 2 · DISPATCH AND MUTATION PLUMBING, HONEST ABOUT THE MISSING INPUT
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * `null` always, deliberately — see the header's BOUNDARY 2 section. The
 * function exists (rather than inlining `null` at the call site) so the day a
 * real stimulus-grade reader lands elsewhere in the app, this is the one place
 * that changes.
 */
export async function readAbsorbedGrade(
  _userUuid: string,
  _dateISO: string,
): Promise<'FULL' | 'PARTIAL' | 'POOR' | null> {
  return null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * BOUNDARY 3 · DECLARED RACE PRIORITY, `Research/00b`'S OWN A/B/C TABLE
 * ═══════════════════════════════════════════════════════════════════════ */

export function raceEffortFromDeclaredPriority(priority: string | null | undefined): RaceEffort {
  const p = String(priority ?? '').trim().toUpperCase();
  if (!isGradedRacePriority(p)) return 'UNRELIABLE';
  if (p === 'A') return 'TRUE_RACE';
  if (p === 'B') return 'THRESHOLD_LIKE';
  return 'CONTROLLED_C'; // 'C'
}

export async function readRaceEffortForWeek(
  userUuid: string,
  weekStartISO: string,
): Promise<{ ok: true; effort: RaceEffort } | { ok: false; why: string }> {
  const days = daysOfWeek(weekStartISO);
  try {
    const r = await pool.query<{ meta: Record<string, unknown> | null }>(
      `SELECT meta FROM races WHERE user_uuid = $1::uuid`,
      [userUuid],
    );
    const inWeek = r.rows.find((row) => {
      const d = row.meta?.date;
      return typeof d === 'string' && days.includes(d.slice(0, 10));
    });
    if (!inWeek) return { ok: false, why: `no race row falls inside ${weekStartISO}` };
    const priority = typeof inWeek.meta?.priority === 'string' ? inWeek.meta.priority : null;
    return { ok: true, effort: raceEffortFromDeclaredPriority(priority) };
  } catch (e) {
    return { ok: false, why: `reading the race table failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE ORCHESTRATOR · one item in, one resolution out, never a mutation
 * ═══════════════════════════════════════════════════════════════════════ */

/** The three rolling-boundary reason codes, and the one place their sequence
 *  is stated — a week's own boundary 1 leads to its boundary 2 leads to its
 *  boundary 3, which is the last of the three (Rule 16: one definition, not a
 *  hard-coded sequence re-typed per caller). */
export type RollingBoundaryReasonCode = 'week_demand_step' | 'weekend_after_quality' | 'long_run_after_race';

export const ROLLING_BOUNDARY_REASON_CODES: ReadonlySet<string> = new Set<RollingBoundaryReasonCode>([
  'week_demand_step', 'weekend_after_quality', 'long_run_after_race',
]);

function isRollingBoundaryReasonCode(code: string): code is RollingBoundaryReasonCode {
  return ROLLING_BOUNDARY_REASON_CODES.has(code);
}

const NEXT_ROLLING_BOUNDARY: Record<RollingBoundaryReasonCode, RollingBoundaryReasonCode | null> = {
  week_demand_step: 'weekend_after_quality',
  weekend_after_quality: 'long_run_after_race',
  long_run_after_race: null,
};

export interface EligiblePlanWorkoutRow {
  readonly id: string;
  readonly dateISO: string;
}

export interface EvaluatedBoundary {
  readonly itemId: string;
  readonly resolved: boolean;
  readonly decision: BoundaryDecision | null;
  readonly why: string;
  /** What this run had to work with, named in words a person can audit —
   *  every value `decision` was actually computed from. */
  readonly availableEvidence: readonly string[];
  /** What it did NOT have: an unwired reader, a failed read, or evidence that
   *  simply does not exist for this week. Never silently absent — Rule 11
   *  says "don't know" is its own fact, not a blank. */
  readonly missingEvidence: readonly string[];
  /** The EXACT `plan_workouts` rows this boundary could still change — the
   *  full candidate set the decision was drawn from, whether or not it
   *  ultimately named one in `decision.mutation`. Empty when nothing in the
   *  week is eligible. */
  readonly eligiblePlanWorkoutRows: readonly EligiblePlanWorkoutRow[];
  /** The next rolling boundary in THIS week's own sequence, or null when this
   *  was the last of the three (boundary 3 / `long_run_after_race`). */
  readonly nextBoundary: RollingBoundaryReasonCode | null;
}

/**
 * Evaluates and RESOLVES one due rolling-boundary item. Never mutates a plan
 * row — `resolveReassessment` writes only onto the scheduler's own table, and
 * `AUTOMATIC_ADAPTATION_AUTHORITY` is never read or touched here.
 */
export async function evaluateAndResolveRollingBoundaryItem(
  item: ScheduledReassessment,
  planWeeks: ReadonlyMap<string, LiveWeek>,
): Promise<EvaluatedBoundary> {
  const nextBoundary = isRollingBoundaryReasonCode(item.reasonCode)
    ? NEXT_ROLLING_BOUNDARY[item.reasonCode] : null;

  const weekStartISO = typeof item.payload.weekStartISO === 'string' ? item.payload.weekStartISO : null;
  if (weekStartISO === null) {
    return {
      itemId: item.id, resolved: false, decision: null, why: 'payload carried no weekStartISO',
      availableEvidence: [], eligiblePlanWorkoutRows: [], nextBoundary,
      missingEvidence: ['weekStartISO could not be read from the scheduled item\'s own payload'],
    };
  }

  let decision: BoundaryDecision;
  const availableEvidence: string[] = [];
  const missingEvidence: string[] = [];
  let eligiblePlanWorkoutRows: readonly EligiblePlanWorkoutRow[] = [];

  if (item.reasonCode === 'week_demand_step') {
    const trailingStarts = [addDays(weekStartISO, -21), addDays(weekStartISO, -14), addDays(weekStartISO, -7)];
    const trailingResults = await Promise.all(
      trailingStarts.map((ws) => readCompletedWeek(item.userUuid, planWeeks, ws, item.assessOnISO)),
    );
    const failed = trailingResults.find((r): r is { ok: false; why: string } => !r.ok);
    if (failed) {
      decision = { verdict: 'REFUSE', because: failed.why, mutation: null };
      missingEvidence.push(failed.why);
    } else {
      const trailing = trailingResults.map((r) => (r as { ok: true; reading: CompletedWeekReading }).reading);
      availableEvidence.push(`trailing weeks read: ${trailing.map((t) => t.weekStartISO).join(', ')}`);
      const proposed = await readProposedWeekDemand(planWeeks, weekStartISO);
      const candidates = reducibleCandidates(planWeeks.get(weekStartISO) ?? null);
      eligiblePlanWorkoutRows = candidates;
      if (!proposed.ok) {
        decision = { verdict: 'REFUSE', because: proposed.why, mutation: null };
        missingEvidence.push(proposed.why);
      } else {
        availableEvidence.push(`proposed week ${weekStartISO}'s demand priced`);
        const trainingPhaseOpenness = trainingPhaseOpennessFor(planWeeks, weekStartISO);
        const runwayOpenness = runwayOpennessFor(planWeeks, weekStartISO);
        availableEvidence.push(
          `training-phase openness ${trainingPhaseOpenness.toFixed(2)}`,
          `runway openness ${runwayOpenness.toFixed(2)} (${weeksRemainingAfter(planWeeks, weekStartISO)} authored weeks remain)`,
          `recent-execution and baseline-cleanliness context computed from ${trailing.length} trailing week(s)`,
        );
        missingEvidence.push(
          'fatigue/safety clearance: no ACWR/HRV reader is wired into this evaluator yet · the '
          + `neutral ${NEUTRAL_FATIGUE_SAFETY_CLEARANCE} is used rather than assuming clean (Rule 11)`,
        );
        if (candidates.length === 0) missingEvidence.push('no reducible quality session found in the proposed week');
        const target = bestOf(candidates, planWeeks.get(weekStartISO) ?? null);
        decision = evaluateBoundary1FromReadings({
          trailing,
          proposed: proposed.demand,
          todayISO: item.assessOnISO,
          targetWorkoutId: target?.id ?? null,
          targetDateISO: target?.dateISO ?? null,
          trainingPhaseOpenness,
          runwayOpenness,
        });
      }
    }
  } else if (item.reasonCode === 'weekend_after_quality') {
    const week = planWeeks.get(weekStartISO) ?? null;
    const qualityRow = week?.rows.find((r) => r.stressor !== null && r.stressor !== 'race' && !r.stressor.includes('long')) ?? null;
    const longRow = week ? [...week.rows].reverse().find((r) => r.stressor?.includes('long')) ?? null : null;
    eligiblePlanWorkoutRows = longRow ? [{ id: longRow.id, dateISO: longRow.dateISO }] : [];
    if (qualityRow) availableEvidence.push(`mid-week quality row: ${qualityRow.dateISO}`);
    else missingEvidence.push(`no mid-week quality row found in ${weekStartISO}`);
    if (longRow) availableEvidence.push(`weekend long row: ${longRow.dateISO} (${longRow.distanceMi} mi)`);
    else missingEvidence.push(`no weekend long row found in ${weekStartISO}`);
    const absorbed = qualityRow ? await readAbsorbedGrade(item.userUuid, qualityRow.dateISO) : null;
    if (absorbed === null) {
      missingEvidence.push(
        'mid-week stimulus absorption grade: no reader is built yet (readAbsorbedGrade is an honest '
        + 'stub · gradeStimulus needs a prescribed-work-duration parser that does not exist anywhere '
        + 'in the app today)',
      );
    } else {
      availableEvidence.push(`mid-week absorption graded: ${absorbed}`);
    }
    decision = boundaryAfterQuality({
      absorbed,
      weekendLongWorkoutId: longRow?.id ?? null,
      weekendLongDateISO: longRow?.dateISO ?? null,
      weekendLongMi: longRow?.distanceMi ?? null,
    });
  } else if (item.reasonCode === 'long_run_after_race') {
    const week = planWeeks.get(weekStartISO) ?? null;
    const longRow = week ? [...week.rows].reverse().find((r) => r.stressor?.includes('long')) ?? null : null;
    if (!longRow) {
      decision = { verdict: 'REFUSE', because: `${weekStartISO} carries no long run row to size against the race`, mutation: null };
      missingEvidence.push(`no long run row found in ${weekStartISO}`);
    } else {
      eligiblePlanWorkoutRows = [{ id: longRow.id, dateISO: longRow.dateISO }];
      availableEvidence.push(`long run row: ${longRow.dateISO} (${longRow.distanceMi} mi)`);
      const effort = await readRaceEffortForWeek(item.userUuid, weekStartISO);
      if (!effort.ok) {
        decision = { verdict: 'REFUSE', because: effort.why, mutation: null };
        missingEvidence.push(effort.why);
      } else {
        availableEvidence.push(`declared race priority classified as ${effort.effort}`);
        decision = boundaryAfterRace({
          effort: effort.effort, longWorkoutId: longRow.id, longDateISO: longRow.dateISO, longMi: longRow.distanceMi,
        });
      }
    }
  } else {
    return {
      itemId: item.id, resolved: false, decision: null,
      why: `reasonCode "${item.reasonCode}" is not one of the three rolling boundaries`,
      availableEvidence: [], eligiblePlanWorkoutRows: [], nextBoundary,
      missingEvidence: [`reasonCode "${item.reasonCode}" is not one of the three rolling boundaries`],
    };
  }

  const detail = decision.mutation
    ? `${decision.because} · mutation proposed (not applied · AUTOMATIC_ADAPTATION_AUTHORITY is false): `
      + JSON.stringify(decision.mutation)
    : decision.because;
  const res = await resolveReassessment({
    id: item.id, status: 'RESOLVED', decision: decision.verdict, detail,
  });
  if (res.state !== 'ok') {
    return {
      itemId: item.id, resolved: false, decision, why: `resolveReassessment: ${res.state} · ${res.why}`,
      availableEvidence, missingEvidence, eligiblePlanWorkoutRows, nextBoundary,
    };
  }
  console.log(
    `[rolling-boundary-evaluator] ${item.userUuid.slice(0, 8)} · ${item.reasonCode} · ${decision.verdict} · ${decision.because}`,
  );
  return {
    itemId: item.id, resolved: res.value, decision, why: detail,
    availableEvidence, missingEvidence, eligiblePlanWorkoutRows, nextBoundary,
  };
}

/**
 * Every non-race, non-long quality row in the week — the FULL candidate set
 * boundary 1's mutation could still touch, not just the one it picks. Split
 * out from the old single-target picker so `EvaluatedBoundary
 * .eligiblePlanWorkoutRows` can report all of them, per the full
 * result-shape requirement (item 10): "the exact plan_workouts rows still
 * eligible to change", not only the one row a mutation happened to name.
 */
function reducibleCandidates(week: LiveWeek | null): readonly EligiblePlanWorkoutRow[] {
  if (!week) return [];
  return week.rows
    .filter((r) => r.stressor !== null && r.stressor !== 'race' && !r.stressor.includes('long'))
    .map((r) => ({ id: r.id, dateISO: r.dateISO }));
}

/** The largest of the candidates — mirrors `boundaryBeforeWeek`'s own
 *  mutation text ("convert the LARGEST non-race, non-long quality session to
 *  easy"). Takes the full week so it can read each candidate's distance,
 *  which `EligiblePlanWorkoutRow` deliberately does not carry (that shape is
 *  for reporting, not for picking). */
function bestOf(
  candidates: readonly EligiblePlanWorkoutRow[], week: LiveWeek | null,
): { readonly id: string; readonly dateISO: string } | null {
  // An if-statement, deliberately, not `candidates.length > 0 ? … : null` —
  // the ternary shape is exactly what `lib/audit/coercion-scan.ts` flags as a
  // zero-erasure site (COERCION-1), and here `null` correctly means "no
  // candidate", not a swallowed unknown, so the honest fix is to keep the
  // logic out of the ternary shape entirely rather than take on an argued
  // exemption for a pattern this easy to avoid.
  if (candidates.length === 0 || week === null) return null;
  const byId = new Map(week.rows.map((r) => [r.id, r.distanceMi]));
  let best = candidates[0];
  for (const c of candidates) if ((byId.get(c.id) ?? 0) > (byId.get(best.id) ?? 0)) best = c;
  return best;
}

/**
 * ONE RUNNER'S DUE ROLLING BOUNDARIES, evaluated and resolved.
 *
 * Rule 14 · scoped to `userUuid` via `loadLiveQueue`, never a global sweep —
 * this is meant to be called from inside the existing per-runner nightly
 * loop, not as its own cron.
 */
export async function evaluateDueRollingBoundariesForUser(
  userUuid: string,
  todayISO: string,
): Promise<readonly EvaluatedBoundary[]> {
  const queue = await loadLiveQueue(userUuid);
  if (queue.state !== 'ok') return [];
  const due = queue.value.filter(
    (i) => i.status === 'DUE' && i.assessOnISO <= todayISO && ROLLING_BOUNDARY_REASON_CODES.has(i.reasonCode),
  );
  if (due.length === 0) return [];

  const seq = await loadPlannedWeeks(userUuid);
  if (!seq.ok) {
    return due.map((item) => ({
      itemId: item.id, resolved: false, decision: null, why: seq.why,
      availableEvidence: [], eligiblePlanWorkoutRows: [],
      missingEvidence: [`the active plan could not be read: ${seq.why}`],
      nextBoundary: isRollingBoundaryReasonCode(item.reasonCode) ? NEXT_ROLLING_BOUNDARY[item.reasonCode] : null,
    }));
  }
  const planWeeks = new Map(seq.weeks.map((w) => [w.weekStartISO, w]));

  const out: EvaluatedBoundary[] = [];
  for (const item of due) {
    out.push(await evaluateAndResolveRollingBoundaryItem(item, planWeeks));
  }
  return out;
}
