/**
 * lib/brain/orchestration/move-orchestrator.ts · MOVE-A-RUN, RE-ADJUDICATED.
 *
 * The owner's item 9, verbatim: "Move-a-Run must invoke the canonical
 * orchestrator." After a PROPOSED move: recalculate BOTH affected weeks,
 * recalculate demand, recheck hard-session spacing, recheck long-run placement,
 * recheck race / recovery / taper proximity, reevaluate conditional doses,
 * reevaluate scheduled gates, reevaluate deferrals, detect conflicts, recommend
 * a better date, apply under RUNNER authority, ledger atomically, sync phone and
 * Watch, undo.
 *
 * ── WHY THIS FILE EXISTS AND NOT MORE CODE IN reschedule.ts ────────────────
 *
 * `docs/reports/brain-2026-09-05/HANDBACK-ONE-BRAIN.md` recorded the previous
 * pass's answer:
 *
 *     "It does **not** re-adjudicate: `weekly-demand.ts` reaches
 *      `lib/adaptation/**`, a forbidden directory for that surface."
 *
 * The owner's ruling: **folder ownership cannot justify incomplete coaching.**
 *
 * The forbidden edge is real and it is right. `_reschedule_not_adaptation.test.ts`
 * stops the rescheduling surface reaching the adaptation engine, because a
 * reschedule that could change TRAINING is the one thing the rescheduling
 * contract forbids. That gate is not weakened here — not by one entry.
 *
 * What changed is the DIRECTION. The gate says so itself, in its own Rule 22
 * paragraph: *"Adaptation reaching INTO rescheduling. The forbidden direction
 * here is reschedule -> adapt; the reverse would be a different arrangement and
 * a legitimate one."* This module is that reverse arrangement. It sits ABOVE
 * both: it asks `lib/plan/reschedule.ts` for candidates, prices them through
 * `lib/plan/adjudication/`, reads the queues in `lib/ops/`, and applies through
 * the one mutation boundary. `lib/plan/reschedule.ts` is unchanged and still
 * cannot reach an adaptation module.
 *
 * The seam the two speak across is `lib/coaching-contract/move-readjudication.ts`,
 * a LEAF that imports nothing at all, so a mover can hold a `Readjudicator`
 * without acquiring one byte of reachability into the adaptation engine.
 *
 * ── WHAT IT REUSES RATHER THAN RE-DERIVES  (Rule 16) ───────────────────────
 *
 * Nothing here is a second opinion. Every reading has one owner and this file
 * calls it:
 *
 *   separation       `reschedule.ts:separationFindings`   — one quantity, date-linear
 *   race proximity   `reschedule.ts:raceProximityFindings` — RS-9's day-grain read
 *   dosing           `reschedule.ts:dosingBreachesOf`      — the Daniels table
 *   candidates+rank  `reschedule.ts:recommendReschedule`   — the decision owner
 *   demand           `adjudication/rolling-boundary:priceWeek` -> `projectPlanLoad`
 *   quality minutes  `adjudication/quality-minutes:qualityMinutesOfWeek`
 *   one-at-a-time    `adjudication/live-sequence:findSequenceFindings`
 *   the queues       `ops/reassessment-scheduler:loadLiveQueue`
 *   phase vocabulary `canonical-phase.ts` (the sealed engine's one door)
 *   authority        `brain/mutation/authority:mutationIsPermitted`
 *   the ledger       `brain/ledger/decision-ledger:recordDecision`
 *
 * The only arithmetic this file owns is DIFFERENTIAL: it runs a reading before
 * the move and again after, and reports what the move INTRODUCED. That is the
 * same discipline RS-9 already applies to race proximity, and it matters:
 * a week that already breaks spacing is not the move's fault, and refusing on
 * an inherited violation would make every option in a crowded week illegal.
 *
 * ── AUTHORITY  (hard constraint) ───────────────────────────────────────────
 *
 * `AUTOMATIC_ADAPTATION_AUTHORITY` is untouched and stays the literal `false`.
 * A move applies ONLY under `RUNNER_ACCEPTED`, and `applyMove` passes that
 * literal to `mutationIsPermitted` before it touches anything and refuses on a
 * non-permitted verdict rather than proceeding. Re-adjudication itself is a
 * PURE READ: `readjudicateMove` opens no transaction and issues only SELECTs.
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ────────────────────────────────
 *
 * · **A mover that never calls it.** Three older paths can still move a workout
 *   (`POST /api/today/reschedule`, `POST /api/plan/change` scenario `move_day`,
 *   `PATCH /api/plan/workout`). Wiring is a property of those routes, not of
 *   this module, and the census in `_move_readjudication.test.ts` is what
 *   watches it. Two of the three are still unwired and the handback says so.
 * · **A week whose quality minutes cannot be priced.** `qualityMinutesOfWeek`
 *   returns unknown when any session in the week carries no readable spec, and
 *   DEMAND then REFUSES rather than pricing the miles alone — because pricing
 *   miles alone would be a second demand model with the same name (Rule 16).
 *   On a block authored before the spec builder that refusal is the normal
 *   answer, and the verdict is INCOMPLETE, not CLEAR.
 * · **Whether the demand coefficients are right.** `plan-load.ts` admits they
 *   are crude. This compares the same quantity on both sides, which is all the
 *   comparison needs, and proves nothing about the weights.
 * · **A move applied by SQL, by a cron, or by a route that lies about its
 *   authority.** The authority argument is passed in, and a caller that passes
 *   `RUNNER_ACCEPTED` for an unattended write is not caught here.
 * · **Whether the Watch actually redrew.** Sync here means the plan version
 *   moved and the briefing memo was busted, so the next fetch from either
 *   device sees the new plan. It sends no push and wakes no device; a Watch
 *   that never launches again never learns.
 * · **A better date that is better on the mover's cost scale and worse in
 *   life.** `betterDate` reports the cost of both sides so the recommendation
 *   can be argued with, and it never applies itself.
 */

import { pool } from '@/lib/db/pool';
import { roundTo } from '@/lib/format/run';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';
import { planVersionOf } from '@/lib/plan/plan-version';
import { loadPlanShape, type PlanShape } from '@/lib/plan/replan-scenarios';
import {
  recommendReschedule,
  applyReschedule,
  undoReschedule,
  resolveConstraint,
  timelineOf,
  applyEditsToTimeline,
  separationFindings,
  raceProximityFindings,
  loadRaceCalendar,
  weekRolesOf,
  isDemanding,
  labelOf,
  addDaysISO,
  daysBetweenISO,
  totalDeficit,
  type Timeline,
  type PlanDay,
  type RescheduleOption,
  type RescheduleRowEdit,
  type SeparationFinding,
  type RaceEntry,
  type WeekRole,
  type AvailabilityConstraint,
} from '@/lib/plan/reschedule';
import { priceWeek, demandBaseline } from '@/lib/plan/adjudication/rolling-boundary';
import { qualityMinutesOfWeek } from '@/lib/plan/adjudication/quality-minutes';
import {
  stressorNameOf,
  findSequenceFindings,
  type LiveWeek,
} from '@/lib/plan/adjudication/live-sequence';
import { loadLiveQueue, type ScheduledReassessment } from '@/lib/ops/reassessment-scheduler';
import { mutationIsPermitted, type AuthorityClass } from '@/lib/brain/mutation/authority';
import { recordDecision } from '@/lib/brain/ledger/decision-ledger';
import { PLAN_MUTATION_BOUNDARY_MODEL_VERSION } from '@/lib/brain/ledger/ledger-entry';
import { phaseFromAuthoredLabel } from './canonical-phase';
import {
  READJUDICATION_CHECKS,
  affectedWeeks,
  verdictOf,
  allFindings,
  type AffectedWeeks,
  type BetterDate,
  type CheckOutcome,
  type ProposedMove,
  type ReadjudicationCheck,
  type ReadjudicationFinding,
  type ReadjudicationReport,
  type ReadjudicationRequest,
  type Readjudicator,
} from '@/lib/coaching-contract/move-readjudication';

/* ══════════════════════════════════════════════════════════════════════════
 * SMALL SHARED SHAPES
 * ═══════════════════════════════════════════════════════════════════════ */

/*
 * WHY THE NINE CHECKS ARE EXPORTED.
 *
 * Rule 15: a mechanism the corpus cannot REACH is untested however many cases
 * pass. `readjudicateMove` opens a pool, and a gate that could only drive it
 * through a database would be a gate that runs on one machine and is skipped
 * everywhere else -- which is how `_sweep_allusers` ended up unable to express
 * a runner with a history at all.
 *
 * Each check is a PURE FUNCTION of day maps, races and a queue reading, so the
 * suite drives every one of them directly with the exact shapes production
 * hands them, including the two cases the owner named: a move that breaks
 * hard-session spacing, and a long run landed beside a race.
 *
 * They are exported for that reason and for no other. Nothing outside this
 * module and its suite calls one, and `_move_readjudication.test.ts` asserts
 * that: an outside caller assembling its own subset of the nine would be a
 * second, quieter re-adjudication with no verdict.
 */

type Checks = Record<ReadjudicationCheck, CheckOutcome>;

/** A refusal for every check, one sentence. Used when the plan cannot be read. */
function allRefused(why: string): Checks {
  const out = {} as Checks;
  for (const c of READJUDICATION_CHECKS) out[c] = { state: 'refused', why };
  return out;
}

/**
 * MOVEREADJUDICATE-2 · a caller that already holds an `AvailabilityConstraint`
 * (every apply path does — it is required to actually move the row) splits it
 * back into the neutral contract's two plain arrays, rather than re-deriving
 * or re-asking. One conversion, used everywhere `readjudicateMove` is called
 * alongside an apply, so the gate and the write always search the same
 * candidate set.
 */
function constraintToDates(
  c: AvailabilityConstraint,
): { unavailableDates: readonly string[]; availableDates: readonly string[] } {
  if (c.kind === 'UNAVAILABLE_DATES') return { unavailableDates: c.dates, availableDates: [] };
  if (c.kind === 'AVAILABLE_DATES') return { unavailableDates: [], availableDates: c.dates };
  return { unavailableDates: [], availableDates: [] };
}

const finding = (
  check: ReadjudicationCheck,
  severity: ReadjudicationFinding['severity'],
  what: string,
  onISO: string | null,
  magnitude: number | null,
  citation: string,
): ReadjudicationFinding => ({ check, severity, what, onISO, magnitude, citation });

/** One owner for tenth-of-a-mile rounding: `lib/format/run.ts`. A hand-rolled
 *  copy is what `_format_lint` exists to catch, and it caught this one. */
const round1 = (n: number): number => roundTo(n);
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/* ══════════════════════════════════════════════════════════════════════════
 * WEEK PRICING · one place, both sides of the move
 * ═══════════════════════════════════════════════════════════════════════ */

interface WeekPrice {
  readonly startISO: string;
  readonly weeklyMi: number;
  readonly longRunMi: number;
  /** Null when the week carries a session no spec reader can price (Rule 11). */
  readonly qualityMinutes: number | null;
  readonly qualityWhy: string;
  /** Null exactly when `qualityMinutes` is null. */
  readonly demandIndex: number | null;
  readonly phase: string;
  readonly isCutback: boolean;
  readonly isRaceWeek: boolean;
}

/**
 * Price one plan week from a day map.
 *
 * The map is keyed by the date each row ENDS UP on, so the same function prices
 * the week before the move (`tl.byDate`) and after it (`applyEditsToTimeline`).
 * One function, both sides — a hand-rolled "after" would be a second opinion
 * about what a week costs and would drift the first time a coefficient moved.
 *
 * Race-week mileage excludes the race row itself, matching `weekMiles` in
 * `replan-scenarios.ts`. Copying that convention rather than inventing one is
 * why the two surfaces report the same weekly number for the same week.
 */
export function priceOneWeek(
  week: PlanShape['weeks'][number],
  days: Map<string, PlanDay>,
): WeekPrice {
  const inWeek: PlanDay[] = [];
  for (let iso = week.startISO; iso <= week.endISO; iso = addDaysISO(iso, 1)) {
    const d = days.get(iso);
    if (d) inWeek.push(d);
  }
  let weeklyMi = 0;
  let longRunMi = 0;
  for (const d of inWeek) {
    if (d.type === 'race' && week.containsRace) continue;
    weeklyMi += d.distanceMi;
    if (d.isLong && d.type !== 'race') longRunMi = Math.max(longRunMi, d.distanceMi);
  }
  const q = qualityMinutesOfWeek(inWeek.map((d) => ({
    dateISO: d.dateISO, spec: d.spec, isQuality: d.isQuality, isLong: d.isLong,
  })));
  const priced = q.minutes === null ? null : priceWeek({
    weekStartISO: week.startISO,
    weeklyMi: round1(weeklyMi),
    longRunMi: round1(longRunMi),
    qualityMinutes: q.minutes,
  });
  return {
    startISO: week.startISO,
    weeklyMi: round1(weeklyMi),
    longRunMi: round1(longRunMi),
    qualityMinutes: q.minutes,
    qualityWhy: q.why,
    demandIndex: priced ? priced.load.demandIndex : null,
    phase: week.phase,
    isCutback: week.isCutback,
    isRaceWeek: week.isRaceWeek,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE MOVE'S EDIT SET
 * ═══════════════════════════════════════════════════════════════════════ */

const rowStateOf = (d: PlanDay) => ({
  dateISO: d.dateISO,
  type: d.type,
  distanceMi: d.distanceMi,
  isQuality: d.isQuality,
  isLong: d.isLong,
  subLabel: d.subLabel,
  paceTargetSPerMi: d.paceTargetSPerMi,
  spec: d.spec,
});

/**
 * The edits a bare move performs, when the ranked set has no option for the
 * destination.
 *
 * This is deliberately the SAME shape `/api/today/reschedule` writes — the row
 * relocates and whatever sits on the destination takes the vacated day — so the
 * report describes what that route would actually do rather than an idealised
 * move it would not perform. A synthesized set is only ever used to PRICE a
 * refused destination; nothing applies from here.
 *
 * NEVER-DELETE-1 holds: it is a permutation of dates over existing rows. No
 * INSERT, no DELETE, so `permutationFault` is satisfied by construction.
 */
export function synthesizeEdits(tl: Timeline, target: PlanDay, toISO: string): RescheduleRowEdit[] {
  const displaced = tl.byDate.get(toISO) ?? null;
  const edits: RescheduleRowEdit[] = [{
    planWorkoutId: target.id,
    before: rowStateOf(target),
    after: { ...rowStateOf(target), dateISO: toISO },
    why: `moved to ${toISO}`,
  }];
  if (displaced && displaced.id !== target.id) {
    edits.push({
      planWorkoutId: displaced.id,
      before: rowStateOf(displaced),
      after: { ...rowStateOf(displaced), dateISO: target.dateISO },
      why: `took the day ${target.dateISO} the moved session vacated`,
    });
  }
  return edits;
}

/* ══════════════════════════════════════════════════════════════════════════
 * SEQUENCE · the one-stressor-at-a-time detector, on both sides
 * ═══════════════════════════════════════════════════════════════════════ */

/** Monday of the week containing `iso`. The sequence layer's own boundary. */
function mondayOf(iso: string): string {
  const d = new Date(Date.parse(`${iso}T00:00:00Z`));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/**
 * Build the sequence layer's `LiveWeek[]` from a day map.
 *
 * Monday-anchored, because that is the boundary `findSequenceFindings` was
 * calibrated against and `live-sequence.ts` argues for at length. Using the
 * plan's own long-run-anchored weeks here would move miles between adjacent
 * weeks and quietly change the detector's thresholds — the same "a checker that
 * counts differently from the rule it enforces reports clean" failure that file
 * records having already made once.
 */
interface MutableLiveWeek {
  weekStartISO: string;
  weeklyMi: number;
  longestMi: number;
  stressors: string[];
  mpMi: number;
  isTaper: boolean;
  isRaceWeek: boolean;
  containsRace: boolean;
  rows: Array<{ id: string; dateISO: string; type: string; distanceMi: number; stressor: string | null }>;
}

/**
 * RACEWEEK-CONSOLIDATION-1 (2026-09-11) · this used to set `wk.isRaceWeek =
 * true` off `d.type === 'race'` alone — ANY race day, goal or B/C tune-up —
 * which is `containsRace` under the wrong name (Rule 16). It fed straight
 * into `detectSimultaneousStressAddition`'s `window.every((w) => w.isTaper ||
 * w.isRaceWeek)` REFUSAL check (`adjudicate.ts`), the same "is this a
 * prescribed dip" question that file's own header argues at length must stay
 * GOAL-only — a B/C tune-up week over-classified as a dip makes that refusal
 * fire MORE often, which suppresses a real one-stressor-at-a-time finding
 * `conflictCheck` should have raised on a reschedule move, not the safe
 * direction.
 *
 * Fixed by threading the real goal-week starts through from `PlanShape` (the
 * one place this pure day-map function did not otherwise have it) and
 * carrying `containsRace` as its own field, exactly as `adjudicate.ts` and
 * `live-sequence.ts` now do for the same shape.
 */
export function liveWeeksFrom(
  days: Map<string, PlanDay>,
  taperDays: ReadonlySet<string>,
  goalWeekStarts: ReadonlySet<string> = new Set(),
): readonly LiveWeek[] {
  const byWeek = new Map<string, MutableLiveWeek>();
  const sorted = [...days.values()].sort((a, b) => (a.dateISO < b.dateISO ? -1 : 1));
  for (const d of sorted) {
    const start = mondayOf(d.dateISO);
    let wk = byWeek.get(start);
    if (!wk) {
      wk = {
        weekStartISO: start, weeklyMi: 0, longestMi: 0, stressors: [], mpMi: 0,
        isTaper: false, isRaceWeek: goalWeekStarts.has(start), containsRace: false, rows: [],
      };
      byWeek.set(start, wk);
    }
    wk.weeklyMi = round1(wk.weeklyMi + d.distanceMi);
    if (d.distanceMi > wk.longestMi) wk.longestMi = d.distanceMi;
    const stressor = stressorNameOf(d.type, d.subLabel, d.isQuality, d.isLong);
    if (stressor) wk.stressors.push(stressor);
    if (d.type === 'race') wk.containsRace = true;
    if (taperDays.has(d.dateISO)) wk.isTaper = true;
    wk.rows.push({
      id: d.id, dateISO: d.dateISO, type: d.type, distanceMi: d.distanceMi, stressor,
    });
  }
  return [...byWeek.values()].sort((a, b) => a.weekStartISO.localeCompare(b.weekStartISO));
}

/** Every day the plan itself authored inside a taper phase. One read, reused. */
export function taperDaysOf(shape: PlanShape): ReadonlySet<string> {
  const out = new Set<string>();
  for (const w of shape.weeks) {
    if (phaseFromAuthoredLabel(w.phase) !== 'TAPER') continue;
    for (const d of w.days) out.add(d.dateISO);
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * READ · the nine checks
 * ═══════════════════════════════════════════════════════════════════════ */

export interface MoveReadOptions {
  /** Injected for tests. Never used in production, which passes the pool. */
  readonly client?: { query: typeof pool.query };
}

/**
 * RE-ADJUDICATE A PROPOSED MOVE. Pure read: no transaction, SELECTs only.
 *
 * Every one of the nine checks answers, or says why it could not. The verdict
 * is derived by the contract from what the checks returned, never asserted
 * here, so this function cannot report a move clean over a check that did not
 * happen.
 */
export const readjudicateMove: Readjudicator = async (
  req: ReadjudicationRequest,
): Promise<ReadjudicationReport> => readjudicateMoveWith(req, {});

export async function readjudicateMoveWith(
  req: ReadjudicationRequest,
  opts: MoveReadOptions,
): Promise<ReadjudicationReport> {
  const client = opts.client ?? pool;
  const { move, todayISO, userUuid } = req;

  const shape = await loadPlanShape(userUuid, client);
  if (!shape) {
    return {
      move,
      weeks: affectedWeeks(move.fromISO, move.toISO),
      checks: allRefused('there is no active training plan to re-adjudicate against'),
      betterDate: null,
      planId: '',
      planVersion: '',
      asOfISO: todayISO,
    };
  }

  const planVersion = await currentPlanVersion(shape.planId, client);
  const tl = timelineOf(shape);
  const target = tl.byId.get(move.planWorkoutId) ?? tl.byDate.get(move.fromISO) ?? null;
  if (!target) {
    return {
      move,
      weeks: affectedWeeks(move.fromISO, move.toISO),
      checks: allRefused('nothing is prescribed on the day this move claims to come from'),
      betterDate: null,
      planId: shape.planId,
      planVersion,
      asOfISO: todayISO,
    };
  }

  const weekOfDate = (iso: string): PlanShape['weeks'][number] | null =>
    shape.weeks.find((w) => w.startISO <= iso && iso <= w.endISO) ?? null;
  const fromWeek = weekOfDate(target.dateISO);
  const toWeek = weekOfDate(move.toISO);
  const weeks: AffectedWeeks = affectedWeeks(
    fromWeek?.startISO ?? target.dateISO,
    toWeek?.startISO ?? move.toISO,
  );

  const races = await loadRaceCalendar(userUuid, client);
  const roles = weekRolesOf(shape, races);

  /* ── the ranked set, from the decision owner ───────────────────────────── */
  //
  // MOVEREADJUDICATE-2 · the caller's REAL availability, never invented here.
  // This used to hardcode `{ kind: 'UNAVAILABLE_DATES', dates: [target.
  // dateISO] }` regardless of what the runner actually said, which searches a
  // DIFFERENT candidate set than the one his real GET/POST computed with his
  // real answer (or UNKNOWN, when he gave none — the common case, since RS-2
  // opens with nothing marked). Verified live: with the runner's actual
  // UNKNOWN constraint, 2026-09-16 ranked option 1; with this line's invented
  // UNAVAILABLE_DATES, CONFLICTS refused the same date on the same request as
  // "not among the dates the coach can offer" — a fact that was never true.
  // `resolveConstraint` is the one function every other caller in this file
  // already uses for the same three-state shape (Rule 16); this makes the
  // port ASK rather than assume.
  const constraint: AvailabilityConstraint = resolveConstraint(
    [...(req.unavailableDates ?? [])], [...(req.availableDates ?? [])],
  );
  const rec = await recommendReschedule({
    userUuid,
    todayISO,
    planWorkoutId: target.id,
    constraint,
    // Q31 · the destination may be in an adjacent week, and a search that could
    // not reach it would report "no option for that date" for the wrong reason.
    allowAdjacentWeek: weeks.crossesWeekBoundary,
    client,
  });
  const options: readonly RescheduleOption[] = rec.ok ? rec.recommendation.options : [];
  const chosen = options.find((o) => o.newDateISO === move.toISO) ?? null;
  const refusal = rec.ok
    ? rec.recommendation.refusals.find((r) => r.dateISO === move.toISO) ?? null
    : null;

  const edits = chosen ? chosen.edits : synthesizeEdits(tl, target, move.toISO);
  const after = applyEditsToTimeline(tl, edits);

  const checks = {} as Checks;

  /* ── 1 · BOTH AFFECTED WEEKS ───────────────────────────────────────────── */
  if (!fromWeek || !toWeek) {
    checks.BOTH_WEEKS = {
      state: 'refused',
      why: `${!fromWeek ? move.fromISO : move.toISO} falls outside every authored plan week, so `
        + 'the week it belongs to could not be recalculated. That is not the same as nothing '
        + 'changing there.',
    };
  } else {
    const wks = weeks.crossesWeekBoundary ? [fromWeek, toWeek] : [fromWeek];
    const f: ReadjudicationFinding[] = [];
    for (const w of wks) {
      const before = priceOneWeek(w, tl.byDate);
      const now = priceOneWeek(w, after);
      const dMi = round1(now.weeklyMi - before.weeklyMi);
      const dLong = round1(now.longRunMi - before.longRunMi);
      if (dMi !== 0 || dLong !== 0) {
        f.push(finding(
          'BOTH_WEEKS', 'COSTS',
          `The week of ${w.startISO} goes ${before.weeklyMi} to ${now.weeklyMi} mi`
          + (dLong !== 0 ? `, longest run ${before.longRunMi} to ${now.longRunMi} mi` : '')
          + '.',
          w.startISO, dMi,
          'lib/plan/replan-scenarios.ts weekMiles · the plan week, race row excluded on race week',
        ));
      }
    }
    checks.BOTH_WEEKS = {
      state: 'ran',
      findings: f,
      read: weeks.crossesWeekBoundary
        ? `both weeks recalculated: ${fromWeek.startISO} and ${toWeek.startISO}`
        : `one week recalculated: ${fromWeek.startISO}. The move does not cross a week boundary, `
          + 'and the source and destination weeks are the same week.',
    };
  }

  /* ── 2 · DEMAND ────────────────────────────────────────────────────────── */
  checks.DEMAND = demandCheck(shape, tl, after, weeks, fromWeek, toWeek);

  /* ── 3 · HARD-SESSION SPACING ──────────────────────────────────────────── */
  checks.HARD_SESSION_SPACING = spacingCheck(tl, after, target, move);

  /* ── 4 · LONG-RUN PLACEMENT ────────────────────────────────────────────── */
  checks.LONG_RUN_PLACEMENT = longRunCheck(tl, after, target, move, races);

  /* ── 5 · RACE, RECOVERY AND TAPER PROXIMITY ────────────────────────────── */
  checks.RACE_RECOVERY_TAPER_PROXIMITY =
    raceCheck(target, move, races, roles, toWeek, chosen);

  /* ── the three queue-backed checks share ONE read ──────────────────────── */
  const queue = await loadLiveQueue(userUuid);
  checks.CONDITIONAL_DOSES = conditionalDoseCheck(queue, chosen, weeks);
  checks.SCHEDULED_GATES = scheduledGateCheck(queue, weeks, move);
  checks.DEFERRALS = deferralCheck(queue, planVersion);

  /* ── 9 · CONFLICTS ─────────────────────────────────────────────────────── */
  // RACEWEEK-CONSOLIDATION-1 · the real goal-week starts, from the plan's own
  // `is_race_week` column — the ONLY thing that lets `liveWeeksFrom` tell a
  // goal week's prescribed dip apart from a B/C tune-up that merely races.
  const goalWeekStarts = new Set(
    shape.weeks.filter((w) => w.isRaceWeek).map((w) => mondayOf(w.startISO)),
  );
  checks.CONFLICTS = conflictCheck(tl, after, taperDaysOf(shape), refusal, chosen, move, goalWeekStarts);

  /* ── a better date ─────────────────────────────────────────────────────── */
  const betterDate = betterDateOf(options, chosen, move);

  return {
    move, weeks, checks, betterDate,
    planId: shape.planId, planVersion, asOfISO: todayISO,
  };
}

/* ── check 2 ─────────────────────────────────────────────────────────────── */

export function demandCheck(
  shape: PlanShape,
  tl: Timeline,
  after: Map<string, PlanDay>,
  weeks: AffectedWeeks,
  fromWeek: PlanShape['weeks'][number] | null,
  toWeek: PlanShape['weeks'][number] | null,
): CheckOutcome {
  const wks = [fromWeek, ...(weeks.crossesWeekBoundary ? [toWeek] : [])]
    .filter((w): w is PlanShape['weeks'][number] => w != null);
  if (wks.length === 0) {
    return { state: 'refused', why: 'neither affected day falls in an authored plan week, so no week could be priced' };
  }

  const f: ReadjudicationFinding[] = [];
  const unpriceable: string[] = [];

  for (const w of wks) {
    const before = priceOneWeek(w, tl.byDate);
    const now = priceOneWeek(w, after);
    if (before.demandIndex === null || now.demandIndex === null) {
      unpriceable.push(`${w.startISO}: ${before.qualityWhy}`);
      continue;
    }
    const delta = round3(now.demandIndex - before.demandIndex);

    // The trailing three PLAN weeks before this one, priced as authored. A
    // prescribed dip cannot set the baseline (Rule 8) — `demandBaseline` says
    // so and refuses rather than reading a taper as normal.
    const idx = shape.weeks.findIndex((x) => x.startISO === w.startISO);
    const trailing = shape.weeks.slice(Math.max(0, idx - 3), idx)
      .map((x) => {
        const p = priceOneWeek(x, tl.byDate);
        return p.demandIndex === null ? null : priceWeek({
          weekStartISO: x.startISO,
          weeklyMi: p.weeklyMi, longRunMi: p.longRunMi, qualityMinutes: p.qualityMinutes ?? 0,
        });
      })
      .filter((x): x is NonNullable<typeof x> => x != null);
    const dipAt = new Map(shape.weeks.map((x) => [
      x.startISO,
      x.isCutback || x.isRaceWeek || phaseFromAuthoredLabel(x.phase) === 'TAPER',
    ]));
    const base = demandBaseline(trailing, (iso) => dipAt.get(iso) === true);

    const phase = phaseFromAuthoredLabel(w.phase);
    if (delta !== 0) {
      f.push(finding(
        'DEMAND',
        // Rule 9 · demand is CONTINUOUS and never refuses. It can change an
        // option's RANK; it can never change whether the option exists.
        'COSTS',
        `Demand for the week of ${w.startISO} moves ${before.demandIndex} to ${now.demandIndex} `
        + `(${delta > 0 ? '+' : ''}${delta}) in ${phase}`
        + (base.known
          ? `, against a trailing-three baseline of ${base.demandIndex} from ${base.fromWeekISO}.`
          : `. There is no baseline to read: ${base.why}.`),
        w.startISO, delta,
        'lib/adaptation/canonical/plan-load.ts projectPlanLoad, via lib/plan/adjudication/rolling-boundary.ts',
      ));
    }
  }

  if (unpriceable.length > 0 && f.length === 0) {
    return {
      state: 'refused',
      why: `demand could not be recalculated: ${unpriceable.join('; ')}. The week is reported `
        + 'unknown rather than priced on its miles alone, because pricing miles without quality '
        + 'minutes would be a second answer to what a week costs under the same name.',
    };
  }
  if (unpriceable.length > 0) {
    f.push(finding(
      'DEMAND', 'NOTES',
      `One affected week could not be priced: ${unpriceable.join('; ')}.`,
      null, null,
      'lib/plan/adjudication/quality-minutes.ts · an unreadable session makes the week unknown',
    ));
  }
  return {
    state: 'ran',
    findings: f,
    read: `${wks.length} week${wks.length === 1 ? '' : 's'} re-priced through projectPlanLoad`,
  };
}

/* ── check 3 ─────────────────────────────────────────────────────────────── */

/**
 * Spacing, DIFFERENTIALLY.
 *
 * The window is the fortnight around the move, which is wide enough to see the
 * pair on either side of a cross-week landing and narrow enough that a deficit
 * six weeks away is not attributed to this move.
 *
 * Only a deficit the move INTRODUCES refuses. A pair that was already too close
 * before the move stays too close after it and is not this move's fault; making
 * it one would make every option in a crowded week illegal, which is how a gate
 * stops meaning anything.
 */
export function spacingCheck(
  tl: Timeline,
  after: Map<string, PlanDay>,
  target: PlanDay,
  move: ProposedMove,
): CheckOutcome {
  const lo = [target.dateISO, move.toISO].sort()[0];
  const hi = [target.dateISO, move.toISO].sort()[1];
  const fromISO = addDaysISO(lo, -7);
  const toISO = addDaysISO(hi, 7);

  const before = separationFindings(tl.byDate, fromISO, toISO);
  const now = separationFindings(after, fromISO, toISO);

  const key = (s: SeparationFinding): string => `${s.earlierISO}|${s.laterISO}`;
  const had = new Map(before.map((s) => [key(s), s]));

  const f: ReadjudicationFinding[] = [];
  for (const s of now) {
    if (s.deficitDays <= 0) continue;
    const prior = had.get(key(s));
    if (prior && prior.deficitDays >= s.deficitDays) continue;   // inherited
    f.push(finding(
      'HARD_SESSION_SPACING', 'REFUSES',
      `${s.earlierLabel} on ${s.earlierISO} and ${s.laterLabel} on ${s.laterISO} would sit `
      + `${s.interveningDays} clear day${s.interveningDays === 1 ? '' : 's'} apart. `
      + `That pairing needs ${s.requiredDays}.`,
      s.laterISO, null,
      'lib/plan/validate.ts §9 requiredSeparationDays · RESCHEDULING_CONTRACT.md Q32',
    ));
  }

  const introduced = totalDeficit(now) - totalDeficit(before);
  return {
    state: 'ran',
    findings: f,
    read: `separation read over ${fromISO}..${toISO}: ${before.length} pairs before, `
      + `${now.length} after, ${introduced > 0 ? `${introduced} deficit-days introduced` : 'no deficit introduced'}`,
  };
}

/* ── check 4 ─────────────────────────────────────────────────────────────── */

/**
 * LONG-RUN PLACEMENT, which is three questions and not one.
 *
 * 1 · Does the move put the long run on or beside a race? Beside a race is the
 *     case the owner named, and it is not covered by check 5: check 5 reads
 *     races the runner has ALREADY RUN and asks what recovery they owe. A race
 *     the day AFTER the long run owes nothing yet and is invisible there.
 * 2 · Does the week still have its long run? A move that lands the long run in
 *     the next week leaves the first week without one, and the aerobic spine of
 *     a marathon block is not something to lose silently.
 * 3 · Is the long run still the week's longest run?
 */
export function longRunCheck(
  tl: Timeline,
  after: Map<string, PlanDay>,
  target: PlanDay,
  move: ProposedMove,
  races: readonly RaceEntry[],
): CheckOutcome {
  const movedIsLong = target.isLong === true && target.type !== 'race';
  const f: ReadjudicationFinding[] = [];

  // 1 · a race on, or immediately either side of, the destination.
  if (movedIsLong) {
    for (const race of races) {
      const gap = daysBetweenISO(race.dateISO, move.toISO);
      if (Math.abs(gap) > 1) continue;
      f.push(finding(
        'LONG_RUN_PLACEMENT', 'REFUSES',
        gap === 0
          ? `${race.name} is on ${race.dateISO}. The long run does not go on race day.`
          : gap === -1
            ? `${race.name} is on ${race.dateISO}, the day after. A long run the day before a `
              + 'race is not a taper, it is the race run twice.'
            : `${race.name} was on ${race.dateISO}, the day before. The long run does not go on `
              + 'the day after a race.',
        move.toISO, null,
        'Research/00b §"Recovery by Effort" · RESCHEDULING_CONTRACT.md Q34',
      ));
    }
  }

  // 2 and 3 · the week's long run, before and after, Monday-anchored so the
  // question is about a training week rather than about the plan's own boundary.
  const wkStart = mondayOf(move.toISO);
  const longestIn = (days: Map<string, PlanDay>, start: string): PlanDay | null => {
    let best: PlanDay | null = null;
    for (let i = 0; i < 7; i += 1) {
      const d = days.get(addDaysISO(start, i));
      if (!d || d.type === 'race') continue;
      if (!best || d.distanceMi > best.distanceMi) best = d;
    }
    return best;
  };
  for (const start of new Set([mondayOf(target.dateISO), wkStart])) {
    const b = longestIn(tl.byDate, start);
    const a = longestIn(after, start);
    const hadLong = [...Array(7).keys()]
      .some((i) => tl.byDate.get(addDaysISO(start, i))?.isLong === true);
    const hasLong = [...Array(7).keys()]
      .some((i) => after.get(addDaysISO(start, i))?.isLong === true);
    if (hadLong && !hasLong) {
      f.push(finding(
        'LONG_RUN_PLACEMENT', 'REFUSES',
        `The week of ${start} would be left with no long run at all.`,
        start, null,
        'CLAUDE.md Rule 12 · the aerobic base is sized first and is not what gets cut',
      ));
    }
    if (a && b && a.id !== b.id && a.isLong !== true && b.isLong === true) {
      f.push(finding(
        'LONG_RUN_PLACEMENT', 'COSTS',
        `In the week of ${start} the longest run would no longer be the long run: `
        + `${labelOf(a)} on ${a.dateISO} is longer.`,
        start, round1(a.distanceMi - b.distanceMi),
        'lib/plan/reschedule.ts familyOf · the long run is the week\'s spine',
      ));
    }
  }

  if (!movedIsLong && f.length === 0) {
    return {
      state: 'ran',
      findings: [],
      read: 'the moved session is not a long run, and no week loses or reorders its long run',
    };
  }
  return {
    state: 'ran',
    findings: f,
    read: `long-run placement read on ${move.toISO} against ${races.length} race${races.length === 1 ? '' : 's'}`,
  };
}

/* ── check 5 ─────────────────────────────────────────────────────────────── */

export function raceCheck(
  target: PlanDay,
  move: ProposedMove,
  races: readonly RaceEntry[],
  roles: Map<string, WeekRole>,
  toWeek: PlanShape['weeks'][number] | null,
  chosen: RescheduleOption | null,
): CheckOutcome {
  // RS-9's reading, at DAY grain, differentially: a window the session already
  // sits inside on its authored day is inherited and introduces nothing.
  const at = (iso: string) => raceProximityFindings({
    dateISO: iso,
    carriesQuality: target.isQuality === true,
    isLongRun: target.isLong === true,
    races,
  });
  const inherited = new Set(at(target.dateISO).map((x) => `${x.kind}|${x.raceSlug}`));
  const f: ReadjudicationFinding[] = [];

  for (const p of at(move.toISO)) {
    const key = `${p.kind}|${p.raceSlug}`;
    if (p.kind === 'UNPRICEABLE_RACE') {
      f.push(finding('RACE_RECOVERY_TAPER_PROXIMITY', 'NOTES', p.message, move.toISO, null,
        'lib/plan/reschedule.ts raceProximityFindings · Rule 11, a race we could not price'));
      continue;
    }
    if (inherited.has(key)) {
      f.push(finding('RACE_RECOVERY_TAPER_PROXIMITY', 'NOTES',
        `${p.message} The session already sat inside that window on its own day, so the move `
        + 'does not introduce it.', move.toISO, null,
        'RS-9 · differential, only a window the move introduces refuses'));
      continue;
    }
    f.push(finding(
      'RACE_RECOVERY_TAPER_PROXIMITY',
      p.kind === 'QUALITY_IN_NO_QUALITY_WINDOW' ? 'REFUSES' : 'COSTS',
      p.message, move.toISO,
      p.longRunFactor ?? null,
      'Research/00b §"Recovery by Effort" via lib/plan/combined-stress.ts',
    ));
  }

  // Taper and A-race weeks, at week grain. Q34 · nothing is imported into one.
  const role = toWeek ? roles.get(toWeek.id) : undefined;
  const destIsTaper = toWeek != null
    && (phaseFromAuthoredLabel(toWeek.phase) === 'TAPER' || role?.isTaper === true);
  if (destIsTaper) {
    f.push(finding(
      'RACE_RECOVERY_TAPER_PROXIMITY', 'REFUSES',
      `The week of ${toWeek!.startISO} is a taper. Work does not get imported into a taper week.`,
      toWeek!.startISO, null,
      'RESCHEDULING_CONTRACT.md Q34 · Research/08 §9.1',
    ));
  }

  return {
    state: 'ran',
    findings: f,
    read: `race proximity read at day grain against ${races.length} race`
      + `${races.length === 1 ? '' : 's'}; destination week `
      + `${toWeek ? toWeek.startISO : 'unknown'}${chosen ? ', ranked option present' : ''}`,
  };
}

/* ── checks 6, 7, 8 · the reassessment queue ─────────────────────────────── */

type Queue = Awaited<ReturnType<typeof loadLiveQueue>>;

/**
 * Rule 11, and the reason these three checks are separate functions over ONE
 * read: `table_absent`, `failed` and "the queue is empty" are three different
 * facts, and every one of them must reach the report as itself. Migration 167
 * is not applied to production, so on the live app all three of these REFUSE,
 * the verdict is INCOMPLETE, and the runner is told which questions could not
 * be asked. That is the honest answer and it is deliberately not hidden.
 */
function queueRefusal(q: Queue, what: string): CheckOutcome | null {
  if (q.state === 'ok') return null;
  return {
    state: 'refused',
    why: q.state === 'table_absent'
      ? `${what} could not be re-evaluated: ${q.why} That is not the same as there being none.`
      : `${what} could not be re-evaluated: ${q.why}`,
  };
}

const GATE_KINDS = new Set([
  'EARNING_GATE', 'POST_RACE_RECOVERY_CHECK', 'RETURN_TO_TRAINING_STAGE',
  'PROPOSAL_EXPIRATION', 'FAILED_EVALUATION',
]);

export function conditionalDoseCheck(
  q: Queue, chosen: RescheduleOption | null, weeks: AffectedWeeks,
): CheckOutcome {
  const f: ReadjudicationFinding[] = [];

  // The dosing half the mover already computed. `dosingShareNotes` can only
  // ever hold the harmless kind — an option that ADDED intensity past a cap is
  // not offered at all — so these are reported and never blocking.
  for (const d of chosen?.dosingShareNotes ?? []) {
    f.push(finding(
      'CONDITIONAL_DOSES', 'NOTES',
      `${d.pace} work is ${d.sharePct}% of the week of ${d.weekStartISO ?? 'unknown'}, over its `
      + `${d.capMi} mi cap by ${d.overByMi} mi. The share rose because the week got smaller, not `
      + 'because intensity was added.',
      d.weekStartISO, d.overByMi,
      'lib/plan/dosing.ts weekDosingFindings · Research/22',
    ));
  }

  const refused = queueRefusal(q, 'conditional doses');
  if (refused) {
    return f.length === 0 ? refused : {
      state: 'refused',
      why: `${refused.state === 'refused' ? refused.why : ''} The mover's own dosing reading did `
        + `run and found ${f.length}.`,
    };
  }
  const items = (q as Extract<Queue, { state: 'ok' }>).value
    .filter((i: ScheduledReassessment) => i.kind === 'CONDITIONAL_DOSE');
  for (const i of items) {
    const touched = i.assessOnISO >= weeks.fromWeekStartISO || i.assessOnISO >= weeks.toWeekStartISO;
    if (!touched) continue;
    f.push(finding(
      'CONDITIONAL_DOSES', 'COSTS',
      `A conditional dose is queued for ${i.assessOnISO}: ${i.reasonDetail}`,
      i.assessOnISO, null,
      'lib/ops/reassessment-scheduler.ts · kind CONDITIONAL_DOSE',
    ));
  }
  return {
    state: 'ran',
    findings: f,
    read: `${items.length} conditional dose${items.length === 1 ? '' : 's'} on the queue, plus `
      + `${chosen?.dosingShareNotes.length ?? 0} dosing share note${(chosen?.dosingShareNotes.length ?? 0) === 1 ? '' : 's'} from the mover`,
  };
}

export function scheduledGateCheck(q: Queue, weeks: AffectedWeeks, move: ProposedMove): CheckOutcome {
  const refused = queueRefusal(q, 'scheduled gates');
  if (refused) return refused;
  const items = (q as Extract<Queue, { state: 'ok' }>).value
    .filter((i: ScheduledReassessment) => GATE_KINDS.has(i.kind));
  const f: ReadjudicationFinding[] = [];
  for (const i of items) {
    // A gate due between the two days is the one a move can step over.
    const lo = [move.fromISO, move.toISO].sort()[0];
    const hi = [move.fromISO, move.toISO].sort()[1];
    if (i.assessOnISO < lo || i.assessOnISO > hi) continue;
    f.push(finding(
      'SCHEDULED_GATES', 'COSTS',
      `A ${i.kind.toLowerCase().replace(/_/g, ' ')} is due on ${i.assessOnISO}, between the day `
      + `this session leaves and the day it lands: ${i.reasonDetail}`,
      i.assessOnISO, null,
      'lib/ops/reassessment-scheduler.ts · the seven kinds',
    ));
  }
  void weeks;
  return {
    state: 'ran',
    findings: f,
    read: `${items.length} scheduled gate${items.length === 1 ? '' : 's'} live on the queue`,
  };
}

/**
 * DEFERRALS.
 *
 * The consequence a move has on the deferral queue is structural and it is easy
 * to miss: a structural mutation bumps `training_plans.last_adapted_at`, which
 * is the second half of `planVersion`, and `reconsiderAtBoundary` expires any
 * queued item whose `planVersion` no longer matches — `PLAN_VERSION_CHANGED`,
 * "the before-value this change moved from is no longer what is prescribed".
 *
 * So moving one run RETIRES every progression the engine had queued for later.
 * That is defensible and it is not free, and a runner who is never told is a
 * runner whose queued upward adaptation vanished for a reason nobody recorded —
 * exactly the ambiguity Rule 21 exists to remove.
 */
export function deferralCheck(q: Queue, planVersionNow: string): CheckOutcome {
  const refused = queueRefusal(q, 'deferrals');
  if (refused) return refused;
  const items = (q as Extract<Queue, { state: 'ok' }>).value
    .filter((i: ScheduledReassessment) => i.kind === 'DEFERRAL');
  const f: ReadjudicationFinding[] = [];
  const stale = items.filter((i) => i.planVersion !== planVersionNow);
  if (items.length > 0) {
    f.push(finding(
      'DEFERRALS', 'COSTS',
      `${items.length} queued progression${items.length === 1 ? '' : 's'} would be reconsidered `
      + 'at the next boundary. Applying this move bumps the plan version, which retires every one '
      + 'of them as PLAN_VERSION_CHANGED rather than carrying them across.',
      null, items.length,
      'lib/adaptation/canonical/deferral-queue.ts reconsiderAtBoundary · PLAN_VERSION_CHANGED',
    ));
  }
  if (stale.length > 0) {
    f.push(finding(
      'DEFERRALS', 'NOTES',
      `${stale.length} of them were already queued against an older plan version and would have `
      + 'been retired at the next boundary regardless of this move.',
      null, stale.length,
      'lib/adaptation/canonical/deferral-queue.ts · structural expiries are checked first',
    ));
  }
  return {
    state: 'ran',
    findings: f,
    read: `${items.length} deferral${items.length === 1 ? '' : 's'} live against plan version ${planVersionNow}`,
  };
}

/* ── check 9 ─────────────────────────────────────────────────────────────── */

/**
 * CONFLICTS · what the move does to the SEQUENCE, plus the mover's own refusal.
 *
 * The sequence layer's one-stressor-at-a-time detector is the reading no
 * point-sampling gate can make, and it is the one the folder boundary was
 * keeping away from this surface. Differential again: a week that already added
 * mileage and intensity together is not this move's doing.
 */
export function conflictCheck(
  tl: Timeline,
  after: Map<string, PlanDay>,
  taperDays: ReadonlySet<string>,
  refusal: { dateISO: string; reason: string; cause: string } | null,
  chosen: RescheduleOption | null,
  move: ProposedMove,
  goalWeekStarts: ReadonlySet<string> = new Set(),
): CheckOutcome {
  const f: ReadjudicationFinding[] = [];

  if (refusal) {
    f.push(finding(
      'CONFLICTS', 'REFUSES',
      `${refusal.reason} (${refusal.cause})`,
      refusal.dateISO, null,
      'lib/plan/reschedule.ts dateVerdict · the mover\'s own refusal, carried verbatim',
    ));
  } else if (!chosen) {
    f.push(finding(
      'CONFLICTS', 'REFUSES',
      `${move.toISO} is not among the dates the coach can offer for this session, and no reason `
      + 'was recorded for it. Treat that as a refusal rather than as approval.',
      move.toISO, null,
      'CLAUDE.md Rule 11 · an absence is not a clean answer',
    ));
  }

  const beforeSeq = findSequenceFindings(liveWeeksFrom(tl.byDate, taperDays, goalWeekStarts), move.fromISO);
  const afterSeq = findSequenceFindings(liveWeeksFrom(after, taperDays, goalWeekStarts), move.fromISO);
  const had = new Set(beforeSeq.map((s) => s.weekStartISO));
  for (const s of afterSeq) {
    if (had.has(s.weekStartISO)) continue;
    f.push(finding(
      'CONFLICTS', 'REFUSES',
      `The week of ${s.weekStartISO} would add mileage and intensity at the same time: ${s.why}`,
      s.weekStartISO, round1(s.volumeStep),
      'Research/00a · one stressor at a time, via lib/plan/adjudication/adjudicate.ts',
    ));
  }

  return {
    state: 'ran',
    findings: f,
    read: `sequence read over ${beforeSeq.length} pre-existing finding`
      + `${beforeSeq.length === 1 ? '' : 's'} and ${afterSeq.length} after the move`,
  };
}

/* ── a better date ───────────────────────────────────────────────────────── */

/**
 * The best-ranked option, when it is not the one he proposed.
 *
 * `null` is a real answer and is returned whenever the proposed date is already
 * the top option or there is nothing to compare against. A recommendation
 * invented to look helpful is worse than none, and both costs are reported so
 * the ranking can be argued with rather than trusted.
 */
export function betterDateOf(
  options: readonly RescheduleOption[],
  chosen: RescheduleOption | null,
  move: ProposedMove,
): BetterDate | null {
  const best = options.find((o) => o.rank === 1) ?? options[0] ?? null;
  if (!best || best.newDateISO === move.toISO) return null;
  const proposedCost = chosen ? chosen.cost.total : Number.POSITIVE_INFINITY;
  if (chosen && best.cost.total >= proposedCost) return null;
  return {
    dateISO: best.newDateISO,
    why: chosen
      ? `${best.whyRankedHere} It costs ${round3(proposedCost - best.cost.total)} less than `
        + `${move.toISO} on the same scale.`
      : `${move.toISO} is not available for this session. ${best.whyRankedHere}`,
    proposedCost: Number.isFinite(proposedCost) ? round3(proposedCost) : -1,
    recommendedCost: round3(best.cost.total),
  };
}

/* ── plan version ────────────────────────────────────────────────────────── */

async function currentPlanVersion(
  planId: string, client: { query: typeof pool.query },
): Promise<string> {
  const r = await client.query<{ last_adapted_at: string | null }>(
    `SELECT last_adapted_at::text AS last_adapted_at FROM training_plans WHERE id = $1`,
    [planId],
  );
  return planVersionOf({ id: planId, last_adapted_at: r.rows[0]?.last_adapted_at ?? null });
}

/* ══════════════════════════════════════════════════════════════════════════
 * APPLY · under RUNNER authority, ledgered, synced
 * ═══════════════════════════════════════════════════════════════════════ */

export type MoveOutcome =
  | {
      ok: true;
      decisionId: string;
      report: ReadjudicationReport;
      /** The plan version AFTER the move. What the phone and Watch refetch on. */
      planVersion: string;
      summary: unknown;
      ledger: 'written' | 'table_absent' | 'failed';
    }
  | {
      ok: false;
      code: 'no_plan' | 'not_found' | 'bad_request' | 'plan_moved' | 'rejected'
          | 'sealed' | 'immovable' | 'no_record_table' | 'readjudication_refused'
          | 'authority_refused';
      reason: string;
      report?: ReadjudicationReport;
      violations?: string[];
    };

export interface ApplyMoveInput {
  readonly userUuid: string;
  readonly todayISO: string;
  readonly move: ProposedMove;
  readonly optionId: string;
  readonly token: string;
  readonly constraint: AvailabilityConstraint;
  readonly allowAdjacentWeek?: boolean;
  /**
   * Required, and it must be a RUNNER class. Passed rather than assumed so a
   * caller has to classify itself, which is the whole mechanism
   * `MutatePlanOptions.authority` introduced.
   */
  readonly authority: AuthorityClass;
  /**
   * Apply anyway over a REFUSED re-adjudication. Only the runner can set this,
   * and only after reading the refusals — a move he insists on is his plan and
   * the coach states the cost rather than blocking him. Defaults to false, so
   * the safe direction is the one that needs no argument.
   */
  readonly overrideRefusals?: boolean;
}

/**
 * APPLY. The only writer here, and it writes nothing until three things hold:
 * re-adjudication has run, the authority class is permitted, and the mover's
 * own token still matches the plan.
 */
export async function applyMove(input: ApplyMoveInput): Promise<MoveOutcome> {
  /* 1 · authority, BEFORE anything is read for a write. */
  const verdict = mutationIsPermitted(input.authority);
  if (!verdict.permitted) {
    return {
      ok: false, code: 'authority_refused',
      reason: `${verdict.because}. ${verdict.insteadDo ?? ''}`.trim(),
    };
  }
  if (input.authority !== 'RUNNER_ACCEPTED' && input.authority !== 'RUNNER_INITIATED') {
    // Belt and braces, and deliberately not folded into the verdict above:
    // LIFECYCLE and AUTHORSHIP are both PERMITTED classes and neither may move
    // a prescribed session. `lifecycleClaimIsHonest` says why — `date_iso` is
    // a demand-bearing column.
    return {
      ok: false, code: 'authority_refused',
      reason: `a move changes date_iso, which the runner experiences as his training. `
        + `${input.authority} is not a class that may do that. A move applies under `
        + 'RUNNER_ACCEPTED or RUNNER_INITIATED and under nothing else.',
    };
  }

  /* 2 · re-adjudicate. The SAME constraint `applyReschedule` below is about to
   * apply under — never a second, invented one (MOVEREADJUDICATE-2). */
  const report = await readjudicateMove({
    userUuid: input.userUuid, todayISO: input.todayISO, move: input.move,
    ...constraintToDates(input.constraint),
  });
  const v = verdictOf(report);
  if (v === 'REFUSED' && input.overrideRefusals !== true) {
    return {
      ok: false, code: 'readjudication_refused',
      reason: allFindings(report)
        .filter((f) => f.severity === 'REFUSES')
        .map((f) => f.what)
        .join(' '),
      report,
    };
  }

  /* 3 · apply, through the one mutation boundary. */
  // `input.move.planWorkoutId` is `''` (never undefined) on the by-date shape
  // POST /api/plan/move accepts — forward `fromISO` as `dateISO` too, or
  // `recommendReschedule` inside `applyReschedule` sees neither a usable id
  // nor a date and refuses `not_found` for a request that named its day fine.
  const applied = await applyReschedule({
    userUuid: input.userUuid,
    todayISO: input.todayISO,
    planWorkoutId: input.move.planWorkoutId || undefined,
    dateISO: input.move.planWorkoutId ? undefined : (input.move.fromISO || undefined),
    constraint: input.constraint,
    optionId: input.optionId,
    token: input.token,
    allowAdjacentWeek: input.allowAdjacentWeek,
  });
  if (!applied.ok) {
    return { ok: false, code: applied.code, reason: applied.reason, report, violations: applied.violations };
  }

  /* 4 · the ledger. */
  const planVersion = await currentPlanVersion(applied.decision.planId, pool);
  const write = await recordDecision({
    userUuid: input.userUuid,
    planId: applied.decision.planId,
    planLineageId: applied.decision.planId,
    replacedPlanId: null,
    planVersion,
    scope: 'WORKOUT',
    workoutIds: applied.decision.edits.map((e) => e.planWorkoutId),
    scopeFromISO: applied.decision.original.dateISO,
    scopeToISO: applied.decision.newDateISO,
    lever: 'SCHEDULE',
    // A move changes WHEN, not how much. `adaptation-log.ts` reaches the same
    // answer for the same reason and it is imported nowhere here only because
    // the two logs have different row shapes; the reasoning is quoted rather
    // than re-argued: "a reschedule genuinely moves no load, and recording it
    // as UP or DOWN would put noise into the exact count this exists to make
    // trustworthy."
    direction: 'NEUTRAL',
    evidence: [{
      readjudication: report.checks,
      verdict: v,
      betterDate: report.betterDate,
      overrode: input.overrideRefusals === true,
    }],
    provenance: 'brain/orchestration/move-orchestrator',
    sourceMode: null,
    beforeState: applied.decision.original,
    afterState: { dateISO: applied.decision.newDateISO, moveKind: applied.decision.moveKind },
    authority: input.authority,
    authorityVerdict: 'PERMITTED',
    hold: null,
    decision: 'APPLY',
    proposalId: applied.decision.optionId,
    proposal: null,
    runnerResponse: 'ACCEPTED',
    mutationOutcome: 'applied',
    mutationViolations: [],
    explanation: `Moved ${applied.decision.original.type} from `
      + `${applied.decision.original.dateISO} to ${applied.decision.newDateISO}. `
      + `Re-adjudication: ${v}.`,
    modelVersion: PLAN_MUTATION_BOUNDARY_MODEL_VERSION,
    idempotencyKey: `move:${applied.decision.decisionId}`,
  });

  /* 5 · sync. The plan version has already moved (mutatePlan stamps
   *     last_adapted_at), which is what every phone and Watch fetch compares
   *     against; the memo bust is what stops a cached briefing describing the
   *     old day. Neither wakes a device — see this file's Rule 22 note. */
  await bustBriefingCacheForEvent(input.userUuid, 'plan_swap');

  return {
    ok: true,
    decisionId: applied.decision.decisionId,
    report,
    planVersion,
    summary: applied.summary,
    ledger: write.state,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * UNDO
 * ═══════════════════════════════════════════════════════════════════════ */

export type UndoMoveOutcome =
  | { ok: true; decisionId: string; restored: number; planVersion: string; ledger: 'written' | 'table_absent' | 'failed' }
  | { ok: false; code: string; reason: string; violations?: string[] };

/**
 * Put it back, and say so in the ledger.
 *
 * The restoration itself is `undoReschedule`'s — it re-applies each edit's
 * BEFORE state, read at propose time and stored verbatim on the decision. This
 * adds the two things that were missing: the undo is recorded as a decision in
 * its own right, and the phone and Watch are told the plan moved again.
 */
export async function undoMove(opts: {
  userUuid: string; todayISO: string; decisionId: string;
}): Promise<UndoMoveOutcome> {
  const out = await undoReschedule(opts);
  if (!out.ok) return { ok: false, code: out.code, reason: out.reason, violations: out.violations };

  const plan = await pool.query<{ id: string; last_adapted_at: string | null }>(
    `SELECT id, last_adapted_at::text AS last_adapted_at FROM training_plans
      WHERE user_uuid = $1::uuid AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [opts.userUuid],
  );
  const row = plan.rows[0] ?? null;
  const planVersion = row ? planVersionOf(row) : '';

  const write = await recordDecision({
    userUuid: opts.userUuid,
    planId: row?.id ?? null,
    planLineageId: row?.id ?? `orphan:${opts.userUuid}`,
    replacedPlanId: null,
    planVersion: planVersion || null,
    scope: 'WORKOUT',
    workoutIds: [],
    scopeFromISO: null,
    scopeToISO: null,
    lever: 'SCHEDULE',
    direction: 'NEUTRAL',
    evidence: [{ undidDecisionId: opts.decisionId, rowsRestored: out.restored }],
    provenance: 'brain/orchestration/move-orchestrator#undo',
    sourceMode: null,
    beforeState: null,
    afterState: null,
    authority: 'RUNNER_INITIATED',
    authorityVerdict: 'PERMITTED',
    hold: null,
    decision: 'UNDO',
    proposalId: null,
    proposal: null,
    runnerResponse: 'ACCEPTED',
    mutationOutcome: 'applied',
    mutationViolations: [],
    explanation: `Undid move ${opts.decisionId}; ${out.restored} row`
      + `${out.restored === 1 ? '' : 's'} put back exactly as they stood.`,
    modelVersion: PLAN_MUTATION_BOUNDARY_MODEL_VERSION,
    idempotencyKey: `move-undo:${opts.decisionId}`,
  });

  await bustBriefingCacheForEvent(opts.userUuid, 'plan_swap');

  return {
    ok: true,
    decisionId: opts.decisionId,
    restored: out.restored,
    planVersion,
    ledger: write.state,
  };
}

/** Re-exported so a caller has one import for the whole surface (Rule 17). */
export { verdictOf, allFindings } from '@/lib/coaching-contract/move-readjudication';
export { isDemanding };
