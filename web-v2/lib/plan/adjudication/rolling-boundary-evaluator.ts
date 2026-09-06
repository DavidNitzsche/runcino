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
 *   · the step allowance (`allowedStepShare`) is `RERAMP_WEEKLY_GROWTH - 1`
 *     from `lib/plan/adapt.ts` — the app's own "§14 '10% rule strictly
 *     enforced'" constant — imported, not retyped (Rule 7 / Rule 16).
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
import { RERAMP_WEEKLY_GROWTH } from '@/lib/plan/adapt';
import { roundTo } from '@/lib/format/run';
import { loadPlannedWeeks, type LiveWeek } from './live-sequence';
import { GRADED_RACE_PRIORITIES, isGradedRacePriority } from '@/lib/race/effort-authority';
import {
  priceWeek, demandBaseline, boundaryBeforeWeek, boundaryAfterQuality, boundaryAfterRace,
  type WeekDemand, type BoundaryDecision, type RaceEffort,
} from './rolling-boundary';
import {
  loadLiveQueue, resolveReassessment, type ScheduledReassessment,
} from '@/lib/ops/reassessment-scheduler';

void GRADED_RACE_PRIORITIES; // referenced for the doc block above; the runtime use is isGradedRacePriority

/**
 * §14 "10% rule strictly enforced" (`lib/plan/adapt.ts`). One definition,
 * imported rather than retyped, per Rule 16.
 */
export const ROLLING_BOUNDARY_ALLOWED_STEP_SHARE = RERAMP_WEEKLY_GROWTH - 1;

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
  readonly allowedStepShare?: number;
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

  return boundaryBeforeWeek({
    proposed: args.proposed,
    baseline,
    completionRatio,
    allowedStepShare: args.allowedStepShare ?? ROLLING_BOUNDARY_ALLOWED_STEP_SHARE,
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

export interface EvaluatedBoundary {
  readonly itemId: string;
  readonly resolved: boolean;
  readonly decision: BoundaryDecision | null;
  readonly why: string;
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
  const weekStartISO = typeof item.payload.weekStartISO === 'string' ? item.payload.weekStartISO : null;
  if (weekStartISO === null) {
    return { itemId: item.id, resolved: false, decision: null, why: 'payload carried no weekStartISO' };
  }

  let decision: BoundaryDecision;

  if (item.reasonCode === 'week_demand_step') {
    const trailingStarts = [addDays(weekStartISO, -21), addDays(weekStartISO, -14), addDays(weekStartISO, -7)];
    const trailingResults = await Promise.all(
      trailingStarts.map((ws) => readCompletedWeek(item.userUuid, planWeeks, ws, item.assessOnISO)),
    );
    const failed = trailingResults.find((r): r is { ok: false; why: string } => !r.ok);
    if (failed) {
      decision = { verdict: 'REFUSE', because: failed.why, mutation: null };
    } else {
      const trailing = trailingResults.map((r) => (r as { ok: true; reading: CompletedWeekReading }).reading);
      const proposed = await readProposedWeekDemand(planWeeks, weekStartISO);
      if (!proposed.ok) {
        decision = { verdict: 'REFUSE', because: proposed.why, mutation: null };
      } else {
        const target = pickReducibleTarget(planWeeks.get(weekStartISO) ?? null);
        decision = evaluateBoundary1FromReadings({
          trailing,
          proposed: proposed.demand,
          todayISO: item.assessOnISO,
          targetWorkoutId: target?.id ?? null,
          targetDateISO: target?.dateISO ?? null,
        });
      }
    }
  } else if (item.reasonCode === 'weekend_after_quality') {
    const week = planWeeks.get(weekStartISO) ?? null;
    const qualityRow = week?.rows.find((r) => r.stressor !== null && r.stressor !== 'race' && !r.stressor.includes('long')) ?? null;
    const longRow = week ? [...week.rows].reverse().find((r) => r.stressor?.includes('long')) ?? null : null;
    const absorbed = qualityRow ? await readAbsorbedGrade(item.userUuid, qualityRow.dateISO) : null;
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
    } else {
      const effort = await readRaceEffortForWeek(item.userUuid, weekStartISO);
      if (!effort.ok) {
        decision = { verdict: 'REFUSE', because: effort.why, mutation: null };
      } else {
        decision = boundaryAfterRace({
          effort: effort.effort, longWorkoutId: longRow.id, longDateISO: longRow.dateISO, longMi: longRow.distanceMi,
        });
      }
    }
  } else {
    return {
      itemId: item.id, resolved: false, decision: null,
      why: `reasonCode "${item.reasonCode}" is not one of the three rolling boundaries`,
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
    return { itemId: item.id, resolved: false, decision, why: `resolveReassessment: ${res.state} · ${res.why}` };
  }
  console.log(
    `[rolling-boundary-evaluator] ${item.userUuid.slice(0, 8)} · ${item.reasonCode} · ${decision.verdict} · ${decision.because}`,
  );
  return { itemId: item.id, resolved: res.value, decision, why: detail };
}

function pickReducibleTarget(
  week: LiveWeek | null,
): { readonly id: string; readonly dateISO: string } | null {
  if (!week) return null;
  // The largest non-race, non-long quality session, mirroring
  // `boundaryBeforeWeek`'s own mutation text ("convert the largest non-race,
  // non-long quality session to easy").
  const candidates = week.rows.filter(
    (r) => r.stressor !== null && r.stressor !== 'race' && !r.stressor.includes('long'),
  );
  if (candidates.length === 0) return null;
  let best = candidates[0];
  for (const c of candidates) if (c.distanceMi > best.distanceMi) best = c;
  return { id: best.id, dateISO: best.dateISO };
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
  const ROLLING_REASON_CODES = new Set(['week_demand_step', 'weekend_after_quality', 'long_run_after_race']);
  const queue = await loadLiveQueue(userUuid);
  if (queue.state !== 'ok') return [];
  const due = queue.value.filter((i) => i.status === 'DUE' && i.assessOnISO <= todayISO && ROLLING_REASON_CODES.has(i.reasonCode));
  if (due.length === 0) return [];

  const seq = await loadPlannedWeeks(userUuid);
  if (!seq.ok) {
    return due.map((item) => ({ itemId: item.id, resolved: false, decision: null, why: seq.why }));
  }
  const planWeeks = new Map(seq.weeks.map((w) => [w.weekStartISO, w]));

  const out: EvaluatedBoundary[] = [];
  for (const item of due) {
    out.push(await evaluateAndResolveRollingBoundaryItem(item, planWeeks));
  }
  return out;
}
