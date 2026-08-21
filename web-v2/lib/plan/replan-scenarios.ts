/**
 * lib/plan/replan-scenarios.ts · THE "CHANGE THE PLAN" SHEET, BACKEND SIDE.
 *
 * ─── what this is ───────────────────────────────────────────────────────────
 *
 * The iPhone design's Block screen carries one row, "Change the plan", which
 * opens a sheet: pick a scenario, read the coach's stated trade-off, then
 * confirm or back out. Propose-then-confirm. The reading is the point — a
 * runner who cannot see what a change costs cannot decide whether to make it.
 *
 * Nothing in the system previewed a whole-plan change before committing it.
 * `/api/plan/replan` wrote first and linked to the diff afterwards;
 * `/api/plan/simulate` runs the engine against synthetic onboarding answers
 * and so cannot diff against a live plan; `/api/plan/diff` compares two plans
 * that both already exist. This module is the missing middle: it computes the
 * exact rows a scenario would write, says what that costs in coach voice, and
 * writes nothing until the caller confirms the same proposal it read.
 *
 * ─── SURGICAL, NOT A RE-AUTHOR ──────────────────────────────────────────────
 *
 * The design's four scenarios are all LOCAL. A cutback is one week. Travel is a
 * date range. An extra day is one weekday from one week onward. Only "another
 * race" is a whole-block question, and that one already has a real
 * implementation (`embedMidBlockRaces`, reached through `fireAutoRebuild`) and
 * is delegated to it rather than written twice.
 *
 * `/api/plan/replan`'s three reasons all ran `generatePlan`, archiving the plan
 * and re-deriving everything from today's inputs. That is why its `fromISO` and
 * `toISO` were inert: a re-author has nowhere to put "take weeks 10 and 11
 * out". It could not deliver the consequence its own copy promised, and it
 * could not be previewed, because the answer depended on the whole generator.
 *
 * Editing the live plan instead buys three things at once:
 *   · the change is PREVIEWABLE — the after-state is computed, not emergent
 *   · the change is EXACT — the named weeks are the weeks that move
 *   · the change is DETERMINISTIC — same plan plus same request, same rows
 *
 * ─── WHERE THE DOCTRINE COMES FROM ──────────────────────────────────────────
 *
 * Every number below is bound to a claim in `lib/doctrine/registry.ts`
 * (CLAUDE.md Rule 7), so a doctrine edit fails the build rather than drifting:
 *
 *   REQUESTED_CUTBACK_WEEK_CUT        Research/00b §Depth of Cutback by Mileage Tier
 *   REQUESTED_CUTBACK_LONG_CUT_BAND   the same table's own long-run notes
 *   cut order (volume, long, 2nd quality)  Research/00b §What to Cut First
 *   REENTRY_ACWR_CEILING / _WEEKS     Research/00a §ACWR risk zones, mirrored
 *                                     from `validate.ts` so the two cannot part
 *   LONG_RUN_WOW_MAX_PCT              mirrored from `validate.ts` CONSTRAINTS
 *
 * The last two are DELIBERATE MIRRORS, not second opinions. This module has to
 * predict what `validateComposedPlan` will say about a shape it has not written
 * yet, and a prediction made against a different number is worse than no
 * prediction: it produces a change the runner confirms and the boundary then
 * refuses. The registry claim asserts the mirrors still equal the originals.
 *
 * ─── WHAT IT NEVER DOES ─────────────────────────────────────────────────────
 *
 *   · It never writes outside `mutatePlan`. Every scenario's `apply` is one
 *     callback inside the boundary's transaction, so a change that introduces
 *     a doctrine violation rolls back whole and returns the violation strings.
 *   · It never makes miles up. Nothing lost to travel is redistributed; a
 *     cutback's miles are removed, not moved; an extra day redivides the miles
 *     the week already had. A week's volume changes only where a scenario says
 *     out loud that it changes.
 *   · It never quotes a modelled outcome as a fact. Every number in a
 *     trade-off sentence is a PRESCRIBED plan number that the runner can go
 *     and look at. Where an outcome genuinely is not knowable in advance —
 *     "another race" hands the block to the generator — the caveat says so
 *     rather than inventing a mileage.
 *   · It never uses a clock, `Math.random`, or a locale. `todayISO` is the
 *     runner's own date, passed in.
 */
import { createHash } from 'crypto';
import type { PoolClient } from 'pg';
import { pool } from '@/lib/db/pool';
import { mutatePlan } from '@/lib/plan/mutate';
import { weekDosingFindings, type DosingFinding, type DosingWeek } from '@/lib/plan/dosing';
import { distanceMiFromLabel } from '@/lib/race/distance';
import { suppressDriftNearRace } from '@/lib/plan/drift-proposal-policy';

// ── doctrine constants ───────────────────────────────────────────────────────

/**
 * How much a REQUESTED cutback takes off the week it is asked for.
 *
 * Research/00b §"Depth of Cutback by Mileage Tier" publishes a reduction band
 * per mileage tier: 20-30% at the three lower tiers, 25-35% at 80+. A single
 * requested depth has to be legal at every tier a runner of this app can be in,
 * so it sits in the intersection, at its floor. Deeper is not safer — the same
 * table's prose says a cutback that goes too deep "stops being a cutback and
 * starts being a rest week".
 *
 * This is deliberately NOT the generator's authored deload (`volumeCurve`'s
 * 0.80). That one is a scheduled step in a curve; this one is a runner asking
 * for a week back, and the answer to a request should be the middle of the
 * doctrine band rather than its shallowest edge.
 */
export const REQUESTED_CUTBACK_WEEK_CUT = 0.25;

/**
 * And how much comes off the long run, as a band rather than a point: the
 * chosen value also has to leave the FOLLOWING week's long inside the
 * week-over-week ceiling, so the depth is picked from this band per plan
 * instead of fixed. Read off the same doctrine table's long-run notes.
 */
export const REQUESTED_CUTBACK_LONG_CUT_BAND: readonly [number, number] = [0.20, 0.30];

/**
 * The acute-to-chronic red line, MIRRORED from `lib/plan/validate.ts` §6.
 *
 * A travel gap creates zero weeks, and a zero week drags the four-week mean
 * down hard: coming straight back to a full week after two weeks away is an
 * acute:chronic ratio of 2.0, which the validator refuses and which doctrine
 * grades high risk. So the return is ramped — and it has to be ramped against
 * the SAME number the validator will judge it by, or this module proposes a
 * change the boundary then rolls back.
 */
export const REENTRY_ACWR_CEILING = 1.5;
export const REENTRY_ACWR_CHRONIC_WEEKS = 4;

/**
 * The validator's own small-absolute exemption, mirrored for the same reason:
 * at low volume a percentage jump is misleading, so a step of this many miles
 * or fewer is never a spike however it reads as a ratio.
 */
export const REENTRY_SMALL_STEP_MI = 4;

/** The long-run week-over-week ceiling, mirrored from `validate.ts` CONSTRAINTS. */
export const LONG_RUN_WOW_MAX_PCT = 30;

/** Miles below which a run is not worth prescribing; nothing is scaled under it. */
const MIN_RUN_MI = 1;

// ── request + result shapes ─────────────────────────────────────────────────

export type ChangeScenario = 'cutback' | 'travel' | 'extra_day' | 'another_race' | 'move_day';

export const CHANGE_SCENARIOS: readonly ChangeScenario[] = [
  'cutback', 'travel', 'extra_day', 'another_race', 'move_day',
] as const;

export interface ChangeRequest {
  scenario: ChangeScenario;
  /** cutback · which plan week to cut. Defaults to the next fully-future week. */
  weekIdx?: number;
  /** extra_day · the first plan week the extra day applies to. Same default. */
  fromWeekIdx?: number;
  /** extra_day · which weekday becomes a running day. 0=Sun .. 6=Sat. */
  dow?: number;
  /** travel · inclusive window the runner cannot run. */
  fromISO?: string;
  toISO?: string;
  /** another_race · a race already on file, dated inside the plan window. */
  raceSlug?: string;
  /** move_day · the workout being moved, and where it goes. */
  dateISO?: string;
  toDateISO?: string;
}

export interface DayChange {
  dateISO: string;
  dow: number;
  before: { type: string; distanceMi: number; subLabel: string | null };
  after: { type: string; distanceMi: number; subLabel: string | null };
}

export interface WeekChange {
  weekIdx: number;
  startISO: string;
  phase: string;
  milesBefore: number;
  milesAfter: number;
  longBefore: number;
  longAfter: number;
  qualityBefore: number;
  qualityAfter: number;
  /** The chip the Block screen puts on the week row. */
  flag: string | null;
}

export interface ChangeProposal {
  scenario: ChangeScenario;
  /** The sheet's confirm-button label. */
  verb: string;
  /** One line naming what is about to happen. */
  headline: string;
  /** The coach's stated trade-off. This is the thing the runner reads. */
  tradeOff: string;
  /** Anything in the sentence above that is not a prescribed plan number. */
  caveats: string[];
  /** Binds a confirm to the proposal that was read. */
  token: string;
  planId: string;
  effect: {
    weeks: WeekChange[];
    days: DayChange[];
    milesDelta: number;
    firstAffectedISO: string | null;
    lastAffectedISO: string | null;
    /** True when applying hands the block to the generator instead of editing rows. */
    rebuilds: boolean;
  };
  /** The Block screen's "Changed" list entry, once applied. */
  changed: { label: string; sub: string };
}

export type ChangeOutcome =
  | { ok: true; proposal: ChangeProposal }
  | { ok: false; code: 'no_plan' | 'unavailable' | 'bad_request'; reason: string; detail?: Record<string, unknown> };

export type ApplyOutcome =
  | { ok: true; proposal: ChangeProposal; planId: string; rebuiltPlanId?: string; diffUrl?: string }
  | {
      ok: false;
      code: 'no_plan' | 'unavailable' | 'bad_request' | 'plan_moved' | 'rejected' | 'dosing_breach' | 'rebuild_failed';
      reason: string;
      violations?: string[];
      findings?: DosingFinding[];
      detail?: Record<string, unknown>;
    };

// ── the live plan, as these scenarios need it ───────────────────────────────

interface PlanDayRow {
  id: string;
  weekId: string;
  dateISO: string;
  dow: number;
  type: string;
  distanceMi: number;
  isQuality: boolean;
  isLong: boolean;
  subLabel: string | null;
  paceTargetSPerMi: number | null;
  spec: Record<string, unknown> | null;
}

interface PlanWeekShape {
  id: string;
  weekIdx: number;
  startISO: string;
  endISO: string;
  phase: string;
  isRaceWeek: boolean;
  isCutback: boolean;
  days: PlanDayRow[];
}

export interface PlanShape {
  planId: string;
  userUuid: string;
  mode: string;
  raceId: string | null;
  /** The date this block is building toward. Not the same as the last week it authored. */
  goalISO: string | null;
  weeks: PlanWeekShape[];
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
/** Every distance this module writes lands on a half mile · the locked plan-row rounding. */
const roundHalf = (n: number): number => Math.round(n * 2) / 2;
const addDaysISO = (iso: string, days: number): string =>
  new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

/** Weekly mileage, by the same rule `rehydratePlan` uses: day-sum, race excluded on race week. */
function weekMiles(week: PlanWeekShape, override?: Map<string, number>): number {
  let sum = 0;
  for (const d of week.days) {
    if (d.type === 'race' && week.isRaceWeek) continue;
    sum += override?.get(d.id) ?? d.distanceMi;
  }
  return round1(sum);
}

function weekLong(week: PlanWeekShape, override?: Map<string, number>): number {
  let m = 0;
  for (const d of week.days) {
    if (!d.isLong || d.type === 'race') continue;
    m = Math.max(m, override?.get(d.id) ?? d.distanceMi);
  }
  return round1(m);
}

export async function loadPlanShape(
  userUuid: string,
  client: { query: typeof pool.query } = pool,
): Promise<PlanShape | null> {
  // 2026-08-21 perf · GET /api/v5/block called this FOUR times per request,
  // three queries each, all sequential. Memoized only on the default pool:
  // a caller that passes its own `client` may be inside a transaction reading
  // its own uncommitted writes, and must never be served another caller's
  // snapshot. Callers treat PlanShape as read-only (scenarios carry their
  // edits in override maps rather than mutating days), so one shared instance
  // is safe. Request-scoped — see lib/runtime/request-memo.ts.
  if (client !== pool) return loadPlanShapeUncached(userUuid, client);
  const { memo } = await import('@/lib/runtime/request-memo');
  return memo(`planShape:${userUuid}`, () => loadPlanShapeUncached(userUuid, client));
}

async function loadPlanShapeUncached(
  userUuid: string,
  client: { query: typeof pool.query } = pool,
): Promise<PlanShape | null> {
  const plan = (await client.query<{
    id: string; mode: string | null; race_id: string | null; goal_iso: string | null;
  }>(
    `SELECT id, mode, race_id, goal_iso FROM training_plans
      WHERE user_uuid = $1::uuid AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [userUuid],
  )).rows[0];
  if (!plan) return null;

  // 2026-08-21 perf · both reads need only plan.id, so they were waiting on
  // each other for nothing. Concurrent halves the round-trip DEPTH of this
  // loader from three to two.
  const [weeksRes, daysRes] = await Promise.all([
    client.query<{
      id: string; week_idx: number; week_start_iso: string; phase: string | null;
      is_race_week: boolean | null; is_cutback: boolean | null;
    }>(
      `SELECT w.id, w.week_idx, w.week_start_iso, ph.label AS phase, w.is_race_week, w.is_cutback
         FROM plan_weeks w LEFT JOIN plan_phases ph ON ph.id = w.phase_id
        WHERE w.plan_id = $1 ORDER BY w.week_idx ASC`,
      [plan.id],
    ),
    client.query<{
      id: string; week_id: string | null; date_iso: string; dow: number; type: string;
      distance_mi: string | null; is_quality: boolean | null; is_long: boolean | null;
      sub_label: string | null; pace_target_s_per_mi: number | null;
      workout_spec: Record<string, unknown> | null;
    }>(
      `SELECT id, week_id, date_iso, dow, type, distance_mi, is_quality, is_long,
              sub_label, pace_target_s_per_mi, workout_spec
         FROM plan_workouts WHERE plan_id = $1 ORDER BY date_iso ASC`,
      [plan.id],
    ),
  ]);
  const weeks = weeksRes.rows;
  const days = daysRes.rows;

  const byWeek = new Map<string, PlanDayRow[]>();
  for (const d of days) {
    if (!d.week_id) continue;
    const row: PlanDayRow = {
      id: d.id,
      weekId: d.week_id,
      dateISO: d.date_iso,
      dow: Number(d.dow),
      type: String(d.type),
      distanceMi: d.distance_mi != null ? Number(d.distance_mi) : 0,
      isQuality: d.is_quality === true,
      isLong: d.is_long === true,
      subLabel: d.sub_label,
      paceTargetSPerMi: d.pace_target_s_per_mi != null ? Number(d.pace_target_s_per_mi) : null,
      spec: d.workout_spec ?? null,
    };
    const list = byWeek.get(d.week_id);
    if (list) list.push(row); else byWeek.set(d.week_id, [row]);
  }

  return {
    planId: plan.id,
    userUuid,
    mode: String(plan.mode ?? 'race-prep'),
    raceId: plan.race_id,
    goalISO: isISO(plan.goal_iso) ? plan.goal_iso : null,
    weeks: weeks.map((w) => ({
      id: w.id,
      weekIdx: Number(w.week_idx),
      startISO: w.week_start_iso,
      endISO: addDaysISO(w.week_start_iso, 6),
      phase: String(w.phase ?? 'BASE').toUpperCase(),
      isRaceWeek: w.is_race_week === true,
      isCutback: w.is_cutback === true,
      days: (byWeek.get(w.id) ?? []).slice().sort((a, b) => (a.dateISO < b.dateISO ? -1 : 1)),
    })),
  };
}

// ── the edit set a scenario produces ────────────────────────────────────────

interface RowEdit {
  row: PlanDayRow;
  type: string;
  distanceMi: number;
  isQuality: boolean;
  isLong: boolean;
  subLabel: string | null;
  /** undefined = leave the column alone. */
  paceTargetSPerMi?: number | null;
  spec?: Record<string, unknown> | null;
}

interface WeekFlagEdit {
  weekId: string;
  isCutback: boolean;
}

interface EditSet {
  rows: RowEdit[];
  weekFlags: WeekFlagEdit[];
  touchedWeekIds: Set<string>;
}

const emptyEdits = (): EditSet => ({ rows: [], weekFlags: [], touchedWeekIds: new Set() });

/** The after-state of one day, edits applied. */
function afterOf(row: PlanDayRow, edits: Map<string, RowEdit>): PlanDayRow {
  const e = edits.get(row.id);
  if (!e) return row;
  return {
    ...row,
    type: e.type,
    distanceMi: e.distanceMi,
    isQuality: e.isQuality,
    isLong: e.isLong,
    subLabel: e.subLabel,
    paceTargetSPerMi: e.paceTargetSPerMi !== undefined ? e.paceTargetSPerMi : row.paceTargetSPerMi,
    spec: e.spec !== undefined ? e.spec : row.spec,
  };
}

// ── shared doctrine helpers ─────────────────────────────────────────────────

/**
 * `validate.ts` §9's own recovery requirement, mirrored so a proposal can be
 * checked before it is offered rather than after it is refused: intervals need
 * two easy days after, threshold / tempo / long need one, an easy day (which is
 * what a fartlek is typed as) needs none.
 */
const reqGap = (t: string): number => (t === 'intervals' ? 2 : t === 'easy' ? 0 : 1);

/** Does this set of days satisfy the stimulus-gap rule? Mirrors validate.ts §9. */
export function stimulusGapOk(days: PlanDayRow[]): boolean {
  const hard = days
    .filter((d) => (d.isQuality || d.isLong)
      && d.type !== 'race' && d.type !== 'shakeout' && d.type !== 'race_week_tuneup')
    .map((d) => ({ dow: d.dow, g: reqGap(d.type) }))
    .sort((a, b) => a.dow - b.dow);
  if (hard.length < 2) return true;
  const requiredTotal = hard.reduce((s, h) => s + h.g, 0);
  if (requiredTotal > 7 - hard.length) return true; // over-constrained · best-achievable
  for (let i = 0; i < hard.length; i++) {
    const cur = hard[i];
    const nxt = hard[(i + 1) % hard.length];
    const between = ((nxt.dow - cur.dow + 7) % 7) - 1;
    if (between < cur.g) return false;
  }
  return true;
}

/** The week as `lib/plan/dosing.ts` reads it, so a proposal can be priced before it is offered. */
function dosingWeekOf(week: PlanWeekShape, edits: Map<string, RowEdit>): DosingWeek {
  return {
    startISO: week.startISO,
    phase: week.phase,
    isRaceWeek: week.isRaceWeek,
    days: week.days.map((d) => {
      const a = afterOf(d, edits);
      return { type: a.type, distanceMi: a.distanceMi, subLabel: a.subLabel, isLong: a.isLong };
    }),
  };
}

/** Every enforced dosing breach the edit set would introduce, week by week. */
function dosingBreaches(shape: PlanShape, edits: Map<string, RowEdit>, weekIds: Set<string>): DosingFinding[] {
  const out: DosingFinding[] = [];
  for (const week of shape.weeks) {
    if (!weekIds.has(week.id)) continue;
    const before = weekDosingFindings(dosingWeekOf(week, new Map()));
    const after = weekDosingFindings(dosingWeekOf(week, edits));
    const known = new Set(before.map((f) => `${f.pace}|${f.scope}|${f.basis}`));
    for (const f of after) {
      if (!known.has(`${f.pace}|${f.scope}|${f.basis}`)) out.push(f);
    }
  }
  return out;
}

/**
 * Strip a long run's marathon- or half-pace finish.
 *
 * A deload week that shortens the long and keeps its at-pace finish is asking
 * for less volume and the same intensity, which is the opposite of what
 * Research/00b §"What to Cut First" orders. Removing it is also what keeps the
 * M dose from rising as a share of a week that just got smaller.
 */
function stripLongFinish(row: PlanDayRow, newMi: number): { subLabel: string; spec: Record<string, unknown> | null; stripped: string | null } {
  const spec = row.spec ? { ...row.spec } : null;
  const label = spec && typeof spec.finish_label === 'string' ? spec.finish_label : null;
  if (spec) {
    delete spec.finish_mi;
    delete spec.finish_label;
    delete spec.finish_pace_s_per_mi;
    if (Array.isArray(spec.fuel_mi)) {
      spec.fuel_mi = (spec.fuel_mi as unknown[])
        .map((v) => Number(v))
        .filter((v) => Number.isFinite(v) && v < newMi);
    }
  }
  return { subLabel: 'LONG', spec, stripped: label };
}

/** An easy run's row shape, used when a day is demoted or added. */
const EASY_LABEL = 'EASY';

/**
 * What an easy day in THIS week looks like, copied rather than re-derived.
 *
 * `plan_workouts` carries a check constraint — `workout_spec_required` — that
 * refuses any non-rest row with a null spec, so a day that becomes an easy run
 * has to arrive with one. Building a fresh spec would mean re-deriving this
 * runner's T-pace, HR anchors and stride dose from scratch, and every one of
 * those numbers is already sitting on the easy day next to it. Copying the
 * week's own template keeps the new day identical in kind to the runs around
 * it and invents nothing.
 *
 * `fuel_mi` markers past the new distance are dropped: a fuel cue at mile 9 on
 * a 4-mile run is a cue that never arrives.
 */
function easyTemplateFor(
  week: PlanWeekShape, newMi: number, excludeId?: string,
): { subLabel: string; spec: Record<string, unknown>; paceTargetSPerMi: number | null } {
  const sib = week.days.find((d) =>
    d.id !== excludeId && d.type === 'easy' && !d.isQuality && !d.isLong
    && d.distanceMi > 0 && d.spec != null);
  if (!sib || !sib.spec) {
    return { subLabel: EASY_LABEL, spec: { kind: 'easy', fuel_mi: [], hr_cap_bpm: null }, paceTargetSPerMi: null };
  }
  const spec: Record<string, unknown> = { ...sib.spec };
  if (Array.isArray(spec.fuel_mi)) {
    spec.fuel_mi = (spec.fuel_mi as unknown[]).map(Number).filter((v) => Number.isFinite(v) && v < newMi);
  }
  return { subLabel: sib.subLabel ?? EASY_LABEL, spec, paceTargetSPerMi: sib.paceTargetSPerMi };
}

// ── scenario · CUTBACK ──────────────────────────────────────────────────────

interface CutbackPlanned {
  week: PlanWeekShape;
  edits: EditSet;
  milesBefore: number;
  milesAfter: number;
  longBefore: number;
  longAfter: number;
  demoted: string | null;
  finishStripped: string | null;
  achievedCutPct: number;
}

/**
 * Pick the deepest long-run cut that is legal in BOTH directions.
 *
 * Doctrine's band is the first constraint. The second is that the following
 * week's long is not moving, so a long cut too deep turns the week after into a
 * week-over-week jump the validator refuses — the rebound is the thing that
 * actually bites, and it is invisible if you only look at the week being cut.
 * Returns null when the two constraints do not overlap, which is the honest
 * answer for a week whose long is already smaller than the one after it.
 */
export function cutbackLongTarget(longBefore: number, nextLong: number): number | null {
  if (!(longBefore > 0)) return null;
  // Every distance this app writes lands on a half mile, so the candidates are
  // enumerated at that granularity and each one is tested against the two real
  // predicates. Deriving the endpoints by rounding the band instead was wrong in
  // a way only a short long run showed: 70% of 6 miles rounds to 4.0, which is a
  // 33% cut and outside the band doctrine publishes. Test the cut, not the
  // rounded edge.
  const [lo, hi] = REQUESTED_CUTBACK_LONG_CUT_BAND;
  const rebound = nextLong > 0 ? nextLong / (1 + LONG_RUN_WOW_MAX_PCT / 100) : 0;
  let best: number | null = null;
  for (let val = roundHalf(longBefore) - 0.5; val >= MIN_RUN_MI - 1e-9; val -= 0.5) {
    const cut = (longBefore - val) / longBefore;
    if (cut < lo - 1e-9) continue;          // too shallow to be a cutback yet
    if (cut > hi + 1e-9) break;             // past the band · nothing deeper qualifies
    if (val < rebound - 1e-9) continue;     // legal here, a jump in the week after
    best = val; // the loop descends, so the last value kept is the deepest legal one
  }
  return best;
}

function planCutback(shape: PlanShape, weekIdx: number, todayISO: string): CutbackPlanned | { unavailable: string } {
  const week = shape.weeks.find((w) => w.weekIdx === weekIdx);
  if (!week) return { unavailable: `There is no week ${weekIdx + 1} in this block.` };
  if (week.startISO <= todayISO) {
    return { unavailable: `Week ${weekIdx + 1} has already started. A cutback goes on a week you have not run yet.` };
  }
  if (week.isRaceWeek) return { unavailable: 'That is race week. It is already the easiest week in the block.' };
  if (week.phase === 'TAPER') return { unavailable: `Week ${weekIdx + 1} is a taper week. The taper is already a cutback, and cutting it again would leave you flat on race day.` };
  if (week.isCutback) return { unavailable: `Week ${weekIdx + 1} is already a cutback.` };

  const milesBefore = weekMiles(week);
  if (!(milesBefore > 0)) return { unavailable: `Week ${weekIdx + 1} has no running in it to cut.` };

  const target = roundHalf(milesBefore * (1 - REQUESTED_CUTBACK_WEEK_CUT));
  const edits = emptyEdits();
  const byId = new Map<string, RowEdit>();
  const put = (e: RowEdit) => { byId.set(e.row.id, e); };

  // 1 · the long. Research/00b §"What to Cut First" puts total volume first and
  //     the long second, but the long is the single biggest lever in the week,
  //     so it is sized first and the easy days then absorb whatever is left.
  const longRow = week.days.find((d) => d.isLong && d.type !== 'race' && d.distanceMi > 0) ?? null;
  const longBefore = longRow ? longRow.distanceMi : 0;
  const nextWeek = shape.weeks.find((w) => w.weekIdx === weekIdx + 1);
  const nextLong = nextWeek ? weekLong(nextWeek) : 0;
  let longAfter = longBefore;
  let finishStripped: string | null = null;
  if (longRow) {
    const t = cutbackLongTarget(longBefore, nextLong);
    if (t != null && t < longBefore) {
      longAfter = t;
      const { subLabel, spec, stripped } = stripLongFinish(longRow, t);
      finishStripped = stripped;
      put({
        row: longRow, type: longRow.type, distanceMi: t,
        isQuality: longRow.isQuality, isLong: true, subLabel, spec,
      });
    }
  }

  // 2 · the second quality session. Doctrine's third lever, and the one that
  //     keeps the easy days from being starved to reach the band.
  const qualityRows = week.days
    .filter((d) => d.isQuality && d.type !== 'race' && d.type !== 'race_week_tuneup')
    .sort((a, b) => (a.dateISO < b.dateISO ? -1 : 1));
  let demoted: string | null = null;
  let demotedRow: PlanDayRow | null = null;
  if (qualityRows.length >= 2) {
    demotedRow = qualityRows[qualityRows.length - 1];
    demoted = demotedRow.type;
  }

  // 3 · easy volume carries the remainder. Everything that is not the long, not
  //     a kept quality session and not a race is scaled toward the target.
  const kept = new Set(qualityRows.filter((r) => r.id !== demotedRow?.id).map((r) => r.id));
  const flexible = week.days.filter((d) =>
    d.type !== 'rest' && d.type !== 'race' && d.distanceMi > 0
    && !d.isLong && !kept.has(d.id));

  const fixedMi = week.days.reduce((s, d) => {
    if (d.type === 'race' && week.isRaceWeek) return s;
    if (d.isLong && d.type !== 'race') return s + longAfter;
    if (kept.has(d.id)) return s + d.distanceMi;
    if (flexible.some((f) => f.id === d.id)) return s;
    return s + d.distanceMi;
  }, 0);

  const flexBefore = flexible.reduce((s, d) => s + d.distanceMi, 0);
  const flexTarget = Math.max(0, target - fixedMi);
  const factor = flexBefore > 0 ? Math.min(1, flexTarget / flexBefore) : 1;

  for (const d of flexible) {
    const scaled = Math.max(MIN_RUN_MI, roundHalf(d.distanceMi * factor));
    const isDemoted = d.id === demotedRow?.id;
    const existing = byId.get(d.id);
    const tpl = isDemoted ? easyTemplateFor(week, scaled, d.id) : null;
    put({
      row: d,
      type: isDemoted ? 'easy' : d.type,
      distanceMi: scaled,
      isQuality: isDemoted ? false : d.isQuality,
      isLong: false,
      subLabel: tpl ? tpl.subLabel : (existing?.subLabel ?? d.subLabel),
      ...(tpl ? { paceTargetSPerMi: tpl.paceTargetSPerMi, spec: tpl.spec } : {}),
    });
  }

  edits.rows = [...byId.values()];
  edits.touchedWeekIds.add(week.id);
  edits.weekFlags.push({ weekId: week.id, isCutback: true });

  const milesAfter = weekMiles(week, new Map(edits.rows.map((e) => [e.row.id, e.distanceMi])));
  const achievedCutPct = milesBefore > 0 ? ((milesBefore - milesAfter) / milesBefore) * 100 : 0;

  if (achievedCutPct < REQUESTED_CUTBACK_LONG_CUT_BAND[0] * 100 - 0.5) {
    return {
      unavailable:
        `Week ${weekIdx + 1} cannot lose ${Math.round(REQUESTED_CUTBACK_WEEK_CUT * 100)}% without cutting the ` +
        'session the block is built around. There is not enough easy volume in it to take out.',
    };
  }

  return {
    week, edits, milesBefore, milesAfter, longBefore, longAfter, demoted, finishStripped,
    achievedCutPct,
  };
}

// ── scenario · EXTRA DAY ────────────────────────────────────────────────────

const DOW_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

interface ExtraDayPlanned {
  edits: EditSet;
  weeks: PlanWeekShape[];
  dow: number;
  fromWeekIdx: number;
  perDayBefore: number;
  perDayAfter: number;
  skipped: number;
}

function planExtraDay(
  shape: PlanShape, dow: number, fromWeekIdx: number, todayISO: string,
): ExtraDayPlanned | { unavailable: string } {
  const edits = emptyEdits();
  const byId = new Map<string, RowEdit>();
  const touched: PlanWeekShape[] = [];
  let skipped = 0;
  let perDayBefore = 0;
  let perDayAfter = 0;

  for (const week of shape.weeks) {
    if (week.weekIdx < fromWeekIdx) continue;
    if (week.startISO <= todayISO) continue;
    // The taper takes days OUT. Adding one to it would fight the taper the
    // validator is about to check, and the design's own copy says the runner
    // goes back to five days in the taper anyway.
    if (week.isRaceWeek || week.phase === 'TAPER') continue;

    const slot = week.days.find((d) => d.dow === dow);
    if (!slot || slot.type !== 'rest' || slot.distanceMi > 0) { skipped++; continue; }

    const easyRows = week.days.filter((d) =>
      d.type === 'easy' && !d.isQuality && !d.isLong && d.distanceMi > 0);
    const pool = easyRows.reduce((s, d) => s + d.distanceMi, 0);
    const n = easyRows.length + 1;
    if (!(pool > 0) || pool / n < MIN_RUN_MI) { skipped++; continue; }

    // The week's miles do not change · they are redivided. Every day but the
    // largest takes the rounded share, and the largest carries the remainder so
    // the sum is exact rather than approximately right.
    const share = Math.max(MIN_RUN_MI, roundHalf(pool / n));
    const ordered = [...easyRows].sort((a, b) => b.distanceMi - a.distanceMi);
    const carrier = ordered[0];
    let assigned = 0;
    const targets = new Map<string, number>();
    targets.set(slot.id, share);
    assigned += share;
    for (const d of ordered.slice(1)) { targets.set(d.id, share); assigned += share; }
    const carrierMi = roundHalf(Math.max(MIN_RUN_MI, pool - assigned));
    targets.set(carrier.id, carrierMi);

    // Long-primacy · nothing added or reshaped may out-run the long.
    const longMi = weekLong(week);
    if (longMi > 0 && [...targets.values()].some((v) => v > longMi + 0.15)) { skipped++; continue; }

    const tpl = easyTemplateFor(week, share, slot.id);
    const stage = new Map(byId);
    stage.set(slot.id, {
      row: slot, type: 'easy', distanceMi: share, isQuality: false, isLong: false,
      subLabel: tpl.subLabel, paceTargetSPerMi: tpl.paceTargetSPerMi, spec: tpl.spec,
    });
    for (const d of easyRows) {
      const mi = targets.get(d.id);
      if (mi == null || mi === d.distanceMi) continue;
      stage.set(d.id, {
        row: d, type: d.type, distanceMi: mi, isQuality: d.isQuality, isLong: d.isLong,
        subLabel: d.subLabel,
      });
    }

    const afterDays = week.days.map((d) => afterOf(d, stage));
    if (!stimulusGapOk(afterDays)) { skipped++; continue; }

    for (const [k, v] of stage) byId.set(k, v);
    edits.touchedWeekIds.add(week.id);
    touched.push(week);
    if (perDayBefore === 0) {
      perDayBefore = round1(pool / Math.max(1, easyRows.length));
      perDayAfter = share;
    }
  }

  if (touched.length === 0) {
    return {
      unavailable:
        `${DOW_NAME[dow]} is not a free day in the weeks ahead, or those weeks have too little easy ` +
        'running to split another way. Pick a day that is currently rest.',
    };
  }

  edits.rows = [...byId.values()];
  return { edits, weeks: touched, dow, fromWeekIdx, perDayBefore, perDayAfter, skipped };
}

// ── scenario · TRAVEL ───────────────────────────────────────────────────────

const AWAY_LABEL = 'AWAY';

interface TravelPlanned {
  edits: EditSet;
  lostMi: number;
  clearedWeeks: PlanWeekShape[];
  movedLong: { fromISO: string; toISO: string } | null;
  /** A long run inside the window that could not be salvaged. It is simply lost. */
  lostLong: { dateISO: string; distanceMi: number } | null;
  reentry: Array<{ weekIdx: number; before: number; after: number }>;
  fromISO: string;
  toISO: string;
}

/**
 * Cap a week so the acute:chronic ratio the validator computes stays at or
 * under doctrine's high-risk line.
 *
 * `curr / mean(prev3, curr) ≤ CEILING` rearranges to
 * `curr ≤ CEILING × sum(prev3) / (WEEKS − CEILING)`. The validator's own
 * small-step exemption applies on top, so a week that is only a few miles above
 * the one before it is never capped however the ratio reads.
 */
export function reentryCeilingMi(prevWeeks: number[], prevMi: number): number {
  const s = prevWeeks.reduce((a, b) => a + b, 0);
  const acwrLimit = (REENTRY_ACWR_CEILING * s) / (REENTRY_ACWR_CHRONIC_WEEKS - REENTRY_ACWR_CEILING);
  return Math.max(prevMi + REENTRY_SMALL_STEP_MI, acwrLimit);
}

function planTravel(
  shape: PlanShape, fromISO: string, toISO: string, todayISO: string,
): TravelPlanned | { unavailable: string } {
  if (fromISO <= todayISO) {
    return { unavailable: 'Pick a window that starts tomorrow or later. Days already gone are logged, not planned.' };
  }
  const inWindow = (iso: string) => iso >= fromISO && iso <= toISO;

  const raceWeek = shape.weeks.find((w) => w.isRaceWeek);
  if (raceWeek && shape.weeks.some((w) => w.isRaceWeek && w.days.some((d) => inWindow(d.dateISO)))) {
    return {
      unavailable:
        'That window covers race week. Being away then is not a plan change, it is a different race. ' +
        'Move the race date instead.',
    };
  }
  void raceWeek;

  const edits = emptyEdits();
  const byId = new Map<string, RowEdit>();
  const cleared: PlanWeekShape[] = [];
  let lostMi = 0;

  for (const week of shape.weeks) {
    const hits = week.days.filter((d) => inWindow(d.dateISO) && d.dateISO > todayISO);
    if (hits.length === 0) continue;
    cleared.push(week);
    for (const d of hits) {
      if (d.type === 'rest' && d.distanceMi === 0) continue;
      lostMi += d.distanceMi;
      byId.set(d.id, {
        row: d, type: 'rest', distanceMi: 0, isQuality: false, isLong: false,
        subLabel: AWAY_LABEL, paceTargetSPerMi: null, spec: null,
      });
    }
    edits.touchedWeekIds.add(week.id);
  }

  if (byId.size === 0) {
    return { unavailable: 'There is nothing prescribed in that window, so nothing changes.' };
  }

  // Salvage · at most one long run per week, and only into a day that is
  // already rest, is outside the window, and leaves the stimulus gap intact.
  // Everything else is simply lost. Miles are not banked and not made up.
  let movedLong: { fromISO: string; toISO: string } | null = null;
  let lostLong: { dateISO: string; distanceMi: number } | null = null;
  for (const week of cleared) {
    const long = week.days.find((d) =>
      d.isLong && d.type !== 'race' && inWindow(d.dateISO) && d.dateISO > todayISO && d.distanceMi > 0);
    if (!long) continue;
    if (movedLong) { if (!lostLong) lostLong = { dateISO: long.dateISO, distanceMi: long.distanceMi }; continue; }
    const slots = week.days.filter((d) =>
      d.type === 'rest' && d.distanceMi === 0 && !inWindow(d.dateISO) && d.dateISO > todayISO);
    for (const slot of slots) {
      const stage = new Map(byId);
      stage.set(slot.id, {
        row: slot, type: long.type, distanceMi: long.distanceMi, isQuality: long.isQuality,
        isLong: true, subLabel: long.subLabel, paceTargetSPerMi: long.paceTargetSPerMi, spec: long.spec,
      });
      const afterDays = week.days.map((d) => afterOf(d, stage));
      if (!stimulusGapOk(afterDays)) continue;
      const longMi = Math.max(...afterDays.filter((d) => d.isLong).map((d) => d.distanceMi), 0);
      if (afterDays.some((d) => !d.isLong && d.type !== 'race' && d.type !== 'rest' && d.distanceMi > longMi + 0.15)) continue;
      for (const [k, v] of stage) byId.set(k, v);
      movedLong = { fromISO: long.dateISO, toISO: slot.dateISO };
      lostMi -= long.distanceMi;
      break;
    }
    if (!movedLong && !lostLong) lostLong = { dateISO: long.dateISO, distanceMi: long.distanceMi };
  }

  // Re-entry · a zero week drags the four-week mean down, so the climb back has
  // to be ramped or the validator refuses it. Walk forward from the first week
  // after the window, capping each against the weeks as they now stand.
  const reentry: Array<{ weekIdx: number; before: number; after: number }> = [];
  const nonRace = shape.weeks.filter((w) => !w.isRaceWeek);
  const mi = new Map<string, number>();
  const distOverride = new Map<string, number>(
    [...byId.values()].map((e) => [e.row.id, e.distanceMi]),
  );
  for (const w of nonRace) mi.set(w.id, weekMiles(w, distOverride));

  const lastClearedIdx = Math.max(...cleared.map((w) => w.weekIdx));
  for (let i = 1; i < nonRace.length; i++) {
    const w = nonRace[i];
    if (w.weekIdx <= lastClearedIdx) continue;
    if (shape.mode !== 'race-prep') break; // §6 is a race-prep check
    const prevMi = mi.get(nonRace[i - 1].id) ?? 0;
    const curr = mi.get(w.id) ?? 0;
    if (!(prevMi >= 0) || curr - prevMi <= REENTRY_SMALL_STEP_MI) continue;
    const window = nonRace
      .slice(Math.max(0, i - (REENTRY_ACWR_CHRONIC_WEEKS - 1)), i)
      .map((x) => mi.get(x.id) ?? 0);
    const ceiling = roundHalf(reentryCeilingMi(window, prevMi));
    if (curr <= ceiling + 1e-9) continue;

    // WHICH LEVERS, AND IN WHAT ORDER. Three rules, each of them load-bearing.
    //
    //   · QUALITY SESSIONS ARE NOT SCALED. Their distance is the sum of a
    //     prescription their spec states by name — "3×7 min @ I · 60s jog" plus
    //     warm-up and cool-down — so shrinking `distance_mi` while the spec says
    //     otherwise produces a day whose label and dose disagree. Leaving them
    //     whole also keeps §5's quality coverage intact on a QUALITY or
    //     RACE-SPECIFIC week, which dropping them would break outright.
    //   · THE LONG GOES FIRST. A twelve-mile long run three days after two weeks
    //     of nothing is the spike this whole ramp exists to stop, and Research/
    //     00a's own single-session rule says the same thing about a run far
    //     beyond the longest of the last thirty days. Cutting easy days to their
    //     floor and leaving the long at full would hit the weekly number and
    //     miss the point.
    //   · BUT NOT PAST THE REBOUND. The week after this one is not moving, so a
    //     long cut too deep here is a week-over-week jump there. The floor is
    //     whatever leaves the next week's long inside the ceiling.
    const longRow = w.days.find((d) => d.isLong && d.type !== 'race' && d.distanceMi > 0) ?? null;
    const easyRows = w.days.filter((d) =>
      d.type !== 'rest' && d.type !== 'race' && !d.isLong && !d.isQuality && d.distanceMi > 0);
    const qualityMi = w.days
      .filter((d) => d.isQuality && d.type !== 'race' && !d.isLong)
      .reduce((s, d) => s + d.distanceMi, 0);
    const easyBefore = easyRows.reduce((s, d) => s + d.distanceMi, 0);
    if (!(easyBefore > 0) && !longRow) continue;

    const nextLong = i + 1 < nonRace.length ? weekLong(nonRace[i + 1], distOverride) : 0;
    const longFloor = longRow
      ? Math.max(MIN_RUN_MI, roundHalf(Math.ceil((nextLong / (1 + LONG_RUN_WOW_MAX_PCT / 100)) * 2) / 2))
      : 0;
    const longBeforeMi = longRow ? longRow.distanceMi : 0;
    // The long and the easy days come down TOGETHER, at the same rate, so the
    // week keeps its shape instead of turning into a full long run flanked by
    // one-mile jogs. The long's own floor then pulls it back up if the
    // proportional figure would make the following week a jump.
    const flexBefore = longBeforeMi + easyBefore;
    const flexTarget = Math.max(0, ceiling - qualityMi);
    const factor = flexBefore > 0 ? Math.min(1, flexTarget / flexBefore) : 1;
    const longTarget = longRow
      ? Math.min(longBeforeMi, Math.max(longFloor, roundHalf(longBeforeMi * factor)))
      : 0;
    const easyTarget = Math.max(easyRows.length * MIN_RUN_MI, flexTarget - longTarget);
    const easyFactor = easyBefore > 0 ? Math.min(1, easyTarget / easyBefore) : 1;

    const target = new Map<string, number>();
    if (longRow) target.set(longRow.id, longTarget);
    for (const d of easyRows) target.set(d.id, Math.max(MIN_RUN_MI, roundHalf(d.distanceMi * easyFactor)));

    // Rounding to the half mile can leave the week a fraction over the line the
    // whole ramp exists to stay under, and "a fraction over" is still a
    // rejection. Shave the largest easy day until it is not, or until every easy
    // day is at the floor and there is nothing honest left to take.
    const total = () => qualityMi
      + (longRow ? (target.get(longRow.id) ?? 0) : 0)
      + easyRows.reduce((s, d) => s + (target.get(d.id) ?? 0), 0);
    for (let guard = 0; guard < 200 && total() > ceiling + 1e-9; guard++) {
      const biggest = easyRows
        .filter((d) => (target.get(d.id) ?? 0) > MIN_RUN_MI)
        .sort((a, b) => (target.get(b.id) ?? 0) - (target.get(a.id) ?? 0))[0];
      if (!biggest) break;
      target.set(biggest.id, roundHalf((target.get(biggest.id) ?? 0) - 0.5));
    }

    if (longRow && longTarget < longBeforeMi) {
      const { subLabel, spec } = stripLongFinish(longRow, longTarget);
      byId.set(longRow.id, {
        row: longRow, type: longRow.type, distanceMi: longTarget,
        isQuality: longRow.isQuality, isLong: true, subLabel, spec,
      });
      distOverride.set(longRow.id, longTarget);
    }
    for (const d of easyRows) {
      const scaled = target.get(d.id) ?? d.distanceMi;
      if (scaled === d.distanceMi) continue;
      byId.set(d.id, {
        row: d, type: d.type, distanceMi: scaled, isQuality: d.isQuality, isLong: d.isLong,
        subLabel: d.subLabel,
      });
      distOverride.set(d.id, scaled);
    }
    // THE DOSE MOVES WITH THE WEEK, AND THE SESSION HAS TO MOVE WITH IT.
    //
    // A quality session is priced as a SHARE of the week it sits in. Ramping the
    // week down without touching the session raises that share: three sevens at
    // I is 2.6 mi, which is 7% of a 35-mile week and 13% of a 20-mile one, and
    // Daniels caps I at 8%. So a week that comes back smaller cannot carry the
    // session it was authored to carry, and the honest answer to "can I do my
    // intervals in my first week back from two weeks away" is no.
    //
    // Sessions are replaced by easy running, largest dose first, until the week
    // is inside the caps. Their miles stay in the week — this is an intensity
    // decision, not a volume one, and the ramp already settled the volume.
    const demoted = demoteUntilDosingFits(w, byId, distOverride);
    if (demoted.length) {
      // §5 · a quality-phase week that still HAS running must still carry a
      // quality session, and Research/00b says the same thing about a deload
      // ("keep one quality session"). When the ramp has priced every session in
      // the week out of its own dose cap, the two doctrines genuinely disagree
      // and no surgical edit satisfies both. Say so, rather than proposing a
      // change the boundary will roll back and calling that a preview.
      const stillQuality = w.days.map((d) => afterOf(d, byId))
        .some((d) => d.isQuality && d.type !== 'race');
      const qualityPhase = w.phase === 'QUALITY' || w.phase === 'RACE-SPECIFIC';
      if (!stillQuality && qualityPhase && !w.isRaceWeek && w.endISO >= todayISO) {
        return {
          unavailable:
            `Being away that long is not a week off, it is a different block. ${cap(weekNo(w.weekIdx))} would `
            + 'come back too small to carry the session it is built around, and dropping that session '
            + 'leaves a race-specific week with no quality in it at all. Take a shorter window, or tell '
            + 'me the new race date and the block gets rebuilt from where you actually are.',
        };
      }
    }

    const after = weekMiles(w, distOverride);
    mi.set(w.id, after);
    edits.touchedWeekIds.add(w.id);
    if (after !== curr) reentry.push({ weekIdx: w.weekIdx, before: curr, after });
  }

  edits.rows = [...byId.values()];
  return { edits, lostMi: round1(Math.max(0, lostMi)), clearedWeeks: cleared, movedLong, lostLong, reentry, fromISO, toISO };
}

/**
 * Replace quality sessions with easy running until the week is inside Daniels'
 * enforced dosing caps, biggest dose first.
 *
 * Only ever demotes; never shrinks a session's distance. Shrinking would leave
 * `distance_mi` disagreeing with the prescription its own spec states by name —
 * a two-mile day labelled "3×7 min @ I · 60s jog" — and a session the runner
 * cannot afford is better named as the easy run it has become than served as a
 * workout it no longer is.
 *
 * Returns the types it demoted, in the order it demoted them.
 */
function demoteUntilDosingFits(
  week: PlanWeekShape,
  byId: Map<string, RowEdit>,
  distOverride: Map<string, number>,
): string[] {
  const demoted: string[] = [];
  for (let guard = 0; guard < 8; guard++) {
    const findings = weekDosingFindings(dosingWeekOf(week, byId)).filter((f) => f.enforced);
    if (findings.length === 0) break;
    const candidates = week.days
      .map((d) => afterOf(d, byId))
      .filter((d) => d.isQuality && d.type !== 'race' && d.type !== 'race_week_tuneup' && d.distanceMi > 0)
      .sort((a, b) => b.distanceMi - a.distanceMi);
    const worst = candidates[0];
    if (!worst) break;
    const src = week.days.find((d) => d.id === worst.id)!;
    const mi = distOverride.get(src.id) ?? byId.get(src.id)?.distanceMi ?? src.distanceMi;
    const tpl = easyTemplateFor(week, mi, src.id);
    byId.set(src.id, {
      row: src, type: 'easy', distanceMi: mi, isQuality: false, isLong: src.isLong,
      subLabel: tpl.subLabel, paceTargetSPerMi: tpl.paceTargetSPerMi, spec: tpl.spec,
    });
    demoted.push(src.type);
  }
  return demoted;
}

// ── scenario · MOVE A SCHEDULED DAY ─────────────────────────────────────────

interface MoveDayPlanned {
  edits: EditSet;
  week: PlanWeekShape;
  from: PlanDayRow;
  to: PlanDayRow;
}

function planMoveDay(
  shape: PlanShape, dateISO: string, toDateISO: string, todayISO: string,
): MoveDayPlanned | { unavailable: string } {
  if (dateISO <= todayISO || toDateISO <= todayISO) {
    return { unavailable: 'Both days have to be ahead of you. A day already gone is a run you did or did not do.' };
  }
  const week = shape.weeks.find((w) => w.days.some((d) => d.dateISO === dateISO));
  if (!week) return { unavailable: 'There is nothing prescribed on that day.' };
  const from = week.days.find((d) => d.dateISO === dateISO)!;
  const to = week.days.find((d) => d.dateISO === toDateISO);
  if (!to) {
    return { unavailable: 'A session moves inside its own week. Moving it to another week would change what that week is for.' };
  }
  if (from.type === 'rest') return { unavailable: 'That day is already rest.' };
  if (from.type === 'race') return { unavailable: 'The race does not move. Change the race date if the race moved.' };
  if (to.type !== 'rest' || to.distanceMi > 0) {
    return { unavailable: `${DOW_NAME[to.dow]} already has a run on it. Pick a rest day.` };
  }

  const edits = emptyEdits();
  const byId = new Map<string, RowEdit>();
  byId.set(to.id, {
    row: to, type: from.type, distanceMi: from.distanceMi, isQuality: from.isQuality,
    isLong: from.isLong, subLabel: from.subLabel, paceTargetSPerMi: from.paceTargetSPerMi, spec: from.spec,
  });
  byId.set(from.id, {
    row: from, type: 'rest', distanceMi: 0, isQuality: false, isLong: false,
    subLabel: 'REST', paceTargetSPerMi: null, spec: null,
  });

  const afterDays = week.days.map((d) => afterOf(d, byId));
  if (!stimulusGapOk(afterDays)) {
    return {
      unavailable:
        `On ${DOW_NAME[to.dow]} that session lands too close to the week's other hard day. ` +
        'Hard days need a day of easy running between them, and intervals need two.',
    };
  }
  const longMi = Math.max(...afterDays.filter((d) => d.isLong && d.type !== 'race').map((d) => d.distanceMi), 0);
  if (longMi > 0 && afterDays.some((d) => !d.isLong && d.type !== 'race' && d.type !== 'rest' && d.distanceMi > longMi + 0.15)) {
    return { unavailable: 'That move would leave a weekday run longer than the long run.' };
  }

  edits.rows = [...byId.values()];
  edits.touchedWeekIds.add(week.id);
  return { edits, week, from, to };
}

// ── scenario · ANOTHER RACE ─────────────────────────────────────────────────

interface AnotherRacePlanned {
  slug: string;
  name: string;
  dateISO: string;
  distanceMi: number;
  priority: 'B' | 'C';
  week: PlanWeekShape;
  weeksToTarget: number;
  displacedQuality: string | null;
  targetSlug: string | null;
}

/**
 * The three "another race" gates that do NOT depend on which race — whether
 * this block is even shaped to take a tune-up at all. Extracted 2026-08-19 so
 * `GET /api/v5/block`'s scenario list (the sheet's up-front availability
 * check, before the runner has picked a race) can ask this exact question
 * without a slug, and without re-implementing the rule. `planAnotherRace`
 * below runs the SAME checks, in the SAME order, via this function — one
 * place the three refusal strings live.
 */
export function anotherRaceBlockGate(
  shape: PlanShape, todayISO: string,
): { ok: true } | { unavailable: string } {
  // WHO ACTUALLY EMBEDS A TUNE-UP. `embedMidBlockRaces` runs inside
  // `composePlan`, the race-prep composer, and nowhere else — a maintenance or
  // recovery block is authored by a different function that never sees
  // `midBlockRaces`. Firing the rebuild anyway would archive the plan, author
  // an identical one, and report success for a change that did not happen.
  if (shape.mode !== 'race-prep') {
    return {
      unavailable:
        'This block is holding a base rather than building to a race, so it is not shaped around '
        + 'tune-ups. The race stays on your calendar and the plan picks it up when the build starts.',
    };
  }
  // The same guard `POST /api/race` puts in front of this rebuild: inside the
  // last fortnight the block is taper and race week, and re-authoring it is the
  // one thing a runner two weeks out does not need.
  if (suppressDriftNearRace(shape.goalISO, todayISO)) {
    return {
      unavailable:
        'You are inside the last two weeks before your race. The block does not get re-cut now. '
        + 'Add the race and it counts from the other side.',
    };
  }
  // And the rebuild is anchored on the race the block is FOR. Without one there
  // is nothing to re-author toward.
  if (!shape.raceId) {
    return {
      unavailable:
        'This block is built to a goal rather than to a race on your calendar, so there is no target '
        + 'to rebuild around. Make one of them the target race first.',
    };
  }
  return { ok: true };
}

async function planAnotherRace(
  shape: PlanShape, slug: string, todayISO: string,
): Promise<AnotherRacePlanned | { unavailable: string }> {
  // `races` is a jsonb-shaped table · name, date, priority and the distance
  // label all live in `meta`, and slugs are per-user, not global.
  const row = (await pool.query<{ slug: string; meta: Record<string, unknown> | null }>(
    `SELECT slug, meta FROM races WHERE slug = $1 AND user_uuid = $2::uuid LIMIT 1`,
    [slug, shape.userUuid],
  )).rows[0];
  if (!row) return { unavailable: 'That race is not on file yet. Add it first, then come back here.' };
  const meta = row.meta ?? {};
  const race = {
    slug: row.slug,
    name: typeof meta.name === 'string' && meta.name ? meta.name : row.slug,
    date: typeof meta.date === 'string' ? meta.date : '',
    distanceLabel: typeof meta.distanceLabel === 'string' ? meta.distanceLabel : null,
  };
  if (!isISO(race.date)) return { unavailable: 'That race has no date on it yet.' };

  const gate = anotherRaceBlockGate(shape, todayISO);
  if ('unavailable' in gate) return gate;
  if (race.date <= todayISO) return { unavailable: 'That race has already been run.' };
  if (shape.raceId && race.slug === shape.raceId) {
    return { unavailable: 'That is the race this block is already built for.' };
  }

  const week = shape.weeks.find((w) => race.date >= w.startISO && race.date <= w.endISO);
  if (!week) return { unavailable: 'That race falls outside this block, so the plan does not have to change for it yet.' };
  if (week.days.some((d) => d.type === 'race' && d.dateISO === race.date)) {
    return { unavailable: 'That race is already in the plan.' };
  }

  const rawPriority = String(meta.priority ?? 'C').toUpperCase();
  if (rawPriority !== 'B' && rawPriority !== 'C') {
    return {
      unavailable:
        'Only a B or C race is embedded into a block. Mark it B or C on the race, or make it the target and ' +
        'the block gets rebuilt around it.',
    };
  }
  const priority = rawPriority as 'B' | 'C';

  const displaced = week.days
    .filter((d) => d.isQuality && d.type !== 'race')
    .sort((a, b) => Math.abs(Date.parse(a.dateISO) - Date.parse(race.date)) - Math.abs(Date.parse(b.dateISO) - Date.parse(race.date)))[0] ?? null;
  const QUALITY_NOUN: Record<string, string> = {
    threshold: 'threshold session', tempo: 'tempo session', intervals: 'interval session',
    vo2max: 'VO2 session', race_week_tuneup: 'tune-up',
  };

  // Weeks to the TARGET, measured against the goal date. Measuring against the
  // last week the block happens to hold would say "1 week out" for a race three
  // months before a marathon whose maintenance block only reaches September.
  const lastWeek = shape.weeks[shape.weeks.length - 1];
  const weeksToTarget = shape.goalISO
    ? Math.max(0, Math.round((Date.parse(`${shape.goalISO}T12:00:00Z`) - Date.parse(`${race.date}T12:00:00Z`)) / (7 * 86400000)))
    : Math.max(0, (lastWeek?.weekIdx ?? week.weekIdx) - week.weekIdx);

  return {
    slug: race.slug,
    name: race.name,
    dateISO: race.date,
    distanceMi: distanceMiFromLabel(race.distanceLabel) ?? 0,
    priority,
    week,
    weeksToTarget,
    displacedQuality: displaced ? (QUALITY_NOUN[displaced.type] ?? 'quality session') : null,
    targetSlug: shape.raceId,
  };
}

// ── copy ────────────────────────────────────────────────────────────────────

const mi = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const weekNo = (idx: number): string => `week ${idx + 1}`;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'] as const;

/** No locale, no clock · the runner's own date string, spelled out. */
function dateWords(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  void y;
  return `${d} ${MONTHS[(m ?? 1) - 1]}`;
}

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

// ── proposal assembly ───────────────────────────────────────────────────────

function weekChangesOf(shape: PlanShape, edits: EditSet, flag: (w: PlanWeekShape) => string | null): WeekChange[] {
  const byId = new Map(edits.rows.map((e) => [e.row.id, e]));
  const dist = new Map(edits.rows.map((e) => [e.row.id, e.distanceMi]));
  const out: WeekChange[] = [];
  for (const w of shape.weeks) {
    if (!edits.touchedWeekIds.has(w.id)) continue;
    out.push({
      weekIdx: w.weekIdx,
      startISO: w.startISO,
      phase: w.phase,
      milesBefore: weekMiles(w),
      milesAfter: weekMiles(w, dist),
      longBefore: weekLong(w),
      longAfter: weekLong(w, dist),
      qualityBefore: w.days.filter((d) => d.isQuality && d.type !== 'race').length,
      qualityAfter: w.days.map((d) => afterOf(d, byId)).filter((d) => d.isQuality && d.type !== 'race').length,
      flag: flag(w),
    });
  }
  return out.sort((a, b) => a.weekIdx - b.weekIdx);
}

function dayChangesOf(shape: PlanShape, edits: EditSet): DayChange[] {
  const rows = new Map<string, PlanDayRow>();
  for (const w of shape.weeks) for (const d of w.days) rows.set(d.id, d);
  return edits.rows
    .map((e) => {
      const b = rows.get(e.row.id)!;
      return {
        dateISO: b.dateISO,
        dow: b.dow,
        before: { type: b.type, distanceMi: b.distanceMi, subLabel: b.subLabel },
        after: { type: e.type, distanceMi: e.distanceMi, subLabel: e.subLabel },
      };
    })
    .filter((c) =>
      c.before.type !== c.after.type
      || c.before.distanceMi !== c.after.distanceMi
      || c.before.subLabel !== c.after.subLabel)
    .sort((a, b) => (a.dateISO < b.dateISO ? -1 : 1));
}

/**
 * Binds a confirm to the proposal that was read.
 *
 * The token is a hash of the plan's structural state plus the request, so a
 * confirm arriving after the nightly adapter has moved the same rows does not
 * silently apply to a plan the runner never saw. Deterministic: no salt, no
 * clock, no random.
 */
function proposalToken(shape: PlanShape, req: ChangeRequest): string {
  const structure = shape.weeks
    .map((w) => `${w.weekIdx}|${w.startISO}|${w.phase}|${w.isRaceWeek ? 1 : 0}|${w.isCutback ? 1 : 0}|` +
      w.days.map((d) => `${d.dateISO}:${d.type}:${d.distanceMi}:${d.isQuality ? 1 : 0}:${d.isLong ? 1 : 0}`).join(','))
    .join('\n');
  const request = CHANGE_KEYS.map((k) => `${k}=${req[k] ?? ''}`).join('&');
  return createHash('sha256')
    .update(`${shape.planId}\n${request}\n${structure}`)
    .digest('hex')
    .slice(0, 32);
}

const CHANGE_KEYS = [
  'scenario', 'weekIdx', 'fromWeekIdx', 'dow', 'fromISO', 'toISO', 'raceSlug', 'dateISO', 'toDateISO',
] as const satisfies readonly (keyof ChangeRequest)[];

// ── the public entry point · PROPOSE ────────────────────────────────────────

/** The next week the runner has not started yet · the default subject of a change. */
function nextFutureWeekIdx(shape: PlanShape, todayISO: string): number | null {
  const w = shape.weeks.find((x) => x.startISO > todayISO && !x.isRaceWeek);
  return w ? w.weekIdx : null;
}

export async function proposeChange(
  userUuid: string, todayISO: string, req: ChangeRequest,
): Promise<ChangeOutcome> {
  const shape = await loadPlanShape(userUuid);
  if (!shape) {
    return { ok: false, code: 'no_plan', reason: 'There is no active plan to change yet.' };
  }
  const token = proposalToken(shape, req);
  const base = { planId: shape.planId, token };

  if (req.scenario === 'cutback') {
    const idx = req.weekIdx ?? nextFutureWeekIdx(shape, todayISO);
    if (idx == null) return { ok: false, code: 'unavailable', reason: 'There is no future week left in this block to cut back.' };
    const p = planCutback(shape, idx, todayISO);
    if ('unavailable' in p) return { ok: false, code: 'unavailable', reason: p.unavailable };

    const parts: string[] = [];
    parts.push(
      `${cap(weekNo(p.week.weekIdx))} drops from ${mi(p.milesBefore)} mi to ${mi(p.milesAfter)}` +
      (p.longAfter < p.longBefore ? ` and the long from ${mi(p.longBefore)} to ${mi(p.longAfter)}` : '') +
      ` · that is ${Math.round(p.achievedCutPct)}% off the week.`);
    const second: string[] = [];
    if (p.demoted) second.push('the second quality session becomes an easy run');
    if (p.finishStripped) second.push(`the ${p.finishStripped}-pace finish comes off the long`);
    if (second.length) parts.push(`${cap(joinList(second))}.`);
    // Only when there was a hard week to lose. Said unconditionally, this
    // told a runner cutting back a RECOVERY week that they were giving up a
    // hard week of the build — the opposite of what that week is for. The
    // cost is real when the week carried quality or was already a cutback;
    // otherwise the miles above are the whole story.
    const hadQuality = p.week.days.some(d => d.isQuality);
    if (hadQuality || p.demoted || p.finishStripped) {
      parts.push('You lose a hard week of the build.');
    }
    parts.push(`Nothing before or after ${weekNo(p.week.weekIdx)} moves, and the race date does not change.`);

    return {
      ok: true,
      proposal: {
        ...base,
        scenario: 'cutback',
        verb: `Cut ${weekNo(p.week.weekIdx)} back`,
        headline: `${cap(weekNo(p.week.weekIdx))} becomes a cutback`,
        tradeOff: parts.join(' '),
        caveats: [],
        effect: {
          weeks: weekChangesOf(shape, p.edits, () => 'Cutback'),
          days: dayChangesOf(shape, p.edits),
          milesDelta: round1(p.milesAfter - p.milesBefore),
          ...affectedRange(p.edits),
          rebuilds: false,
        },
        changed: {
          label: `${cap(weekNo(p.week.weekIdx))} cut back`,
          sub: `${mi(p.milesBefore)} mi became ${mi(p.milesAfter)} · long run ${mi(p.longAfter)}`,
        },
      },
    };
  }

  if (req.scenario === 'extra_day') {
    if (req.dow == null || !Number.isInteger(req.dow) || req.dow < 0 || req.dow > 6) {
      return { ok: false, code: 'bad_request', reason: 'Say which day of the week becomes a running day.' };
    }
    const from = req.fromWeekIdx ?? nextFutureWeekIdx(shape, todayISO);
    if (from == null) return { ok: false, code: 'unavailable', reason: 'There is no future week left in this block to change.' };
    const p = planExtraDay(shape, req.dow, from, todayISO);
    if ('unavailable' in p) return { ok: false, code: 'unavailable', reason: p.unavailable };

    const dayName = DOW_NAME[p.dow];
    const runDays = p.weeks[0].days.filter((d) => d.type !== 'rest' && d.distanceMi > 0).length;
    const parts = [
      `From ${weekNo(p.fromWeekIdx)} you run ${runDays + 1} days instead of ${runDays}.`,
      `The weeks keep their miles, so they come off the runs you already have: your easy days go from ` +
        `${mi(p.perDayBefore)} to ${mi(p.perDayAfter)} and ${dayName} picks up ${mi(p.perDayAfter)}.`,
      'The long run and the quality sessions are untouched.',
      'There is one fewer rest day to absorb a bad night.',
    ];
    if (p.skipped > 0) {
      parts.push(`${p.skipped} week${p.skipped === 1 ? '' : 's'} ${p.skipped === 1 ? 'is' : 'are'} left alone: the taper takes days out, not in.`);
    }

    return {
      ok: true,
      proposal: {
        ...base,
        scenario: 'extra_day',
        verb: `Run ${runDays + 1} days`,
        headline: `${dayName} becomes a running day from ${weekNo(p.fromWeekIdx)}`,
        tradeOff: parts.join(' '),
        caveats: [
          'This changes the plan, not your saved weekly-frequency setting. A full rebuild would go back to '
          + 'the setting unless you change that too.',
        ],
        effect: {
          weeks: weekChangesOf(shape, p.edits, () => null),
          days: dayChangesOf(shape, p.edits),
          milesDelta: 0,
          ...affectedRange(p.edits),
          rebuilds: false,
        },
        changed: {
          label: `${runDays + 1} days a week`,
          sub: `Same miles, one more day · from ${weekNo(p.fromWeekIdx)}`,
        },
      },
    };
  }

  if (req.scenario === 'travel') {
    const { fromISO, toISO } = req;
    if (!isISO(fromISO) || !isISO(toISO) || toISO < fromISO) {
      return { ok: false, code: 'bad_request', reason: 'Give the first and last day you are away.' };
    }
    const p = planTravel(shape, fromISO, toISO, todayISO);
    if ('unavailable' in p) return { ok: false, code: 'unavailable', reason: p.unavailable };

    const weekLabels = joinList(p.clearedWeeks.map((w) => weekNo(w.weekIdx)));
    const parts = [
      `You are out from ${dateWords(p.fromISO)} to ${dateWords(p.toISO)}.`,
      `${mi(p.lostMi)} mi come out of ${weekLabels} and they are not made up anywhere · you cannot bank miles.`,
    ];
    if (p.movedLong) {
      parts.push(`The long run on ${dateWords(p.movedLong.fromISO)} moves to ${dateWords(p.movedLong.toISO)}, which is the only day in that week that takes it.`);
    } else if (p.lostLong) {
      parts.push(
        `The ${mi(p.lostLong.distanceMi)} mi long run on ${dateWords(p.lostLong.dateISO)} goes with it · there is nowhere ` +
        'in that week to put it that leaves the spacing between hard days intact.');
    } else {
      parts.push('Nothing is pushed into the days around the window to make up for it.');
    }
    if (p.reentry.length) {
      const r = joinList(p.reentry.map((x) => `${weekNo(x.weekIdx)} at ${mi(x.after)} rather than ${mi(x.before)}`));
      parts.push(`You come back through ${r}, because a jump straight back to full is past the acute-to-chronic line doctrine calls high risk.`);
    }
    parts.push('The race date and the taper do not move.');

    return {
      ok: true,
      proposal: {
        ...base,
        scenario: 'travel',
        verb: p.clearedWeeks.length > 1 ? `Take ${weekLabels} out` : 'Take those days out',
        headline: `Away from ${dateWords(p.fromISO)} to ${dateWords(p.toISO)}`,
        tradeOff: parts.join(' '),
        caveats: [],
        effect: {
          weeks: weekChangesOf(shape, p.edits, (w) =>
            weekMiles(w, new Map(p.edits.rows.map((e) => [e.row.id, e.distanceMi]))) === 0 ? 'Away' : null),
          days: dayChangesOf(shape, p.edits),
          milesDelta: -p.lostMi,
          ...affectedRange(p.edits),
          rebuilds: false,
        },
        changed: {
          label: p.clearedWeeks.length > 1 ? `${cap(weekLabels)} out` : `Away ${dateWords(p.fromISO)} to ${dateWords(p.toISO)}`,
          sub: `${mi(p.lostMi)} mi lost${p.reentry.length ? ' · the return is ramped' : ''}`,
        },
      },
    };
  }

  if (req.scenario === 'move_day') {
    if (!isISO(req.dateISO) || !isISO(req.toDateISO)) {
      return { ok: false, code: 'bad_request', reason: 'Say which session moves and which day it moves to.' };
    }
    const p = planMoveDay(shape, req.dateISO, req.toDateISO, todayISO);
    if ('unavailable' in p) return { ok: false, code: 'unavailable', reason: p.unavailable };

    const label = p.from.isLong ? 'long run' : p.from.isQuality ? `${p.from.type} session` : 'easy run';
    const parts = [
      `Your ${label} moves from ${DOW_NAME[p.from.dow]} ${dateWords(p.from.dateISO)} to ${DOW_NAME[p.to.dow]} ${dateWords(p.to.dateISO)}.`,
      `${cap(DOW_NAME[p.from.dow])} becomes rest.`,
      `The week keeps its ${mi(weekMiles(p.week))} mi and its hard days stay spaced the way doctrine asks.`,
    ];
    return {
      ok: true,
      proposal: {
        ...base,
        scenario: 'move_day',
        verb: `Move it to ${DOW_NAME[p.to.dow]}`,
        headline: `${cap(label)} moves to ${DOW_NAME[p.to.dow]}`,
        tradeOff: parts.join(' '),
        caveats: [],
        effect: {
          weeks: weekChangesOf(shape, p.edits, () => null),
          days: dayChangesOf(shape, p.edits),
          milesDelta: 0,
          ...affectedRange(p.edits),
          rebuilds: false,
        },
        changed: {
          label: `${cap(label)} on ${DOW_NAME[p.to.dow]}`,
          sub: `Moved from ${DOW_NAME[p.from.dow]} ${dateWords(p.from.dateISO)}`,
        },
      },
    };
  }

  // another_race
  if (!req.raceSlug) {
    return { ok: false, code: 'bad_request', reason: 'Say which race.' };
  }
  const p = await planAnotherRace(shape, req.raceSlug, todayISO);
  if ('unavailable' in p) return { ok: false, code: 'unavailable', reason: p.unavailable };

  const distLabel = p.distanceMi > 0 ? `${p.distanceMi >= 26 ? 'marathon' : p.distanceMi >= 13 ? 'half' : `${Math.round(p.distanceMi * 1.609344)}k`}` : 'race';
  const parts = [
    `${p.name} on ${dateWords(p.dateISO)} lands in ${weekNo(p.week.weekIdx)}.`,
  ];
  if (p.priority === 'C') {
    parts.push('It becomes that week\'s quality session and the days either side go easy.');
  } else {
    parts.push('The two days before it ease off and the days after it stay easy until you have recovered, so that week reads as a cutback.');
  }
  if (p.displacedQuality) {
    // The displaced session is named by its LABEL, not its `type` column · a
    // fartlek is typed 'easy' with isQuality true, and "you trade a easy
    // session" is both ungrammatical and wrong about what is being given up.
    parts.push(
      `You trade that week's ${p.displacedQuality} for a real fitness read`
      + (p.weeksToTarget > 0 ? ` ${p.weeksToTarget} week${p.weeksToTarget === 1 ? '' : 's'} out` : '')
      + '.');
  }
  parts.push('The long run is not displaced unless the race falls on it.');
  parts.push('The rest of the block is re-authored from where you are now, so other weeks can move by a mile or two. Nothing before today changes.');

  return {
    ok: true,
    proposal: {
      ...base,
      scenario: 'another_race',
      verb: `Put the ${distLabel} in`,
      headline: `${p.name} in ${weekNo(p.week.weekIdx)}`,
      tradeOff: parts.join(' '),
      caveats: [
        'The week mileages after this are re-authored by the plan engine, not the numbers above. '
        + 'The diff shows exactly what moved once it has run.',
      ],
      effect: {
        weeks: [{
          weekIdx: p.week.weekIdx,
          startISO: p.week.startISO,
          phase: p.week.phase,
          milesBefore: weekMiles(p.week),
          milesAfter: weekMiles(p.week),
          longBefore: weekLong(p.week),
          longAfter: weekLong(p.week),
          qualityBefore: p.week.days.filter((d) => d.isQuality && d.type !== 'race').length,
          qualityAfter: p.week.days.filter((d) => d.isQuality && d.type !== 'race').length,
          flag: distLabel,
        }],
        days: [],
        milesDelta: 0,
        firstAffectedISO: p.week.startISO,
        lastAffectedISO: shape.weeks[shape.weeks.length - 1]?.endISO ?? p.week.endISO,
        rebuilds: true,
      },
      changed: {
        label: `${p.name} in ${weekNo(p.week.weekIdx)}`,
        sub: p.displacedQuality ? 'Replaces the quality session' : 'Added to the block',
      },
    },
  };
}

function affectedRange(edits: EditSet): { firstAffectedISO: string | null; lastAffectedISO: string | null } {
  const dates = edits.rows.map((e) => e.row.dateISO).sort();
  return { firstAffectedISO: dates[0] ?? null, lastAffectedISO: dates[dates.length - 1] ?? null };
}

const isISO = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const cap = (s: string): string => (s.length ? s[0].toUpperCase() + s.slice(1) : s);

// ── the public entry point · APPLY ──────────────────────────────────────────

export interface ApplyDeps {
  /** Injected so the route owns the rebuild import and this module stays testable. */
  rebuild?: (args: { userUuid: string; targetSlug: string | null; raceSlug: string })
    => Promise<{ ok: boolean; reason?: string; oldPlanId?: string; newPlanId?: string }>;
}

export async function applyChange(
  userUuid: string, todayISO: string, req: ChangeRequest, token: string | null, deps: ApplyDeps = {},
): Promise<ApplyOutcome> {
  const proposed = await proposeChange(userUuid, todayISO, req);
  if (!proposed.ok) return proposed;
  const proposal = proposed.proposal;

  if (token && token !== proposal.token) {
    return {
      ok: false,
      code: 'plan_moved',
      reason: 'The plan has changed since you read this. Look at it again before you confirm.',
    };
  }

  // "Another race" is not a row edit · it is the block being re-authored around
  // a race the runner has entered, and that path already exists end to end.
  if (proposal.effect.rebuilds) {
    if (!deps.rebuild) {
      return { ok: false, code: 'rebuild_failed', reason: 'The rebuild path was not wired in for this call.' };
    }
    const r = await deps.rebuild({
      userUuid,
      targetSlug: null,
      raceSlug: String(req.raceSlug),
    });
    if (!r.ok || !r.newPlanId) {
      return { ok: false, code: 'rebuild_failed', reason: r.reason ?? 'The block could not be rebuilt.' };
    }
    return {
      ok: true,
      proposal,
      planId: proposal.planId,
      rebuiltPlanId: r.newPlanId,
      diffUrl: r.oldPlanId ? `/api/plan/diff?from=${r.oldPlanId}&to=${r.newPlanId}` : undefined,
    };
  }

  const shape = await loadPlanShape(userUuid);
  if (!shape) return { ok: false, code: 'no_plan', reason: 'There is no active plan to change.' };

  const edits = editsFor(shape, todayISO, req);
  if (!edits) return { ok: false, code: 'unavailable', reason: proposal.tradeOff };

  // Dosing is checked BEFORE the boundary, because `validateComposedPlan`'s §10
  // is advisory and `mutatePlan` does not request it. A cutback or an extra day
  // that pushed a week past Daniels' share caps would otherwise commit.
  const byId = new Map(edits.rows.map((e) => [e.row.id, e]));
  const breaches = dosingBreaches(shape, byId, edits.touchedWeekIds);
  if (breaches.length) {
    return {
      ok: false,
      code: 'dosing_breach',
      reason: 'That change would put a week past the weekly limits on hard running. It has not been made.',
      findings: breaches,
    };
  }

  const boundary = await mutatePlan<number>({
    userUuid,
    source: `api/plan/change ${req.scenario}`,
    todayISO,
    planId: shape.planId,
    detail: { scenario: req.scenario, request: pickRequest(req), rows: edits.rows.length },
    apply: async (tx: PoolClient) => {
      for (const e of edits.rows) {
        const sets = [
          'type = $3', 'distance_mi = $4', 'is_quality = $5', 'is_long = $6', 'sub_label = $7',
        ];
        const vals: unknown[] = [
          shape.planId, e.row.id, e.type, e.distanceMi, e.isQuality, e.isLong, e.subLabel,
        ];
        if (e.paceTargetSPerMi !== undefined) {
          vals.push(e.paceTargetSPerMi);
          sets.push(`pace_target_s_per_mi = $${vals.length}`);
        }
        if (e.spec !== undefined) {
          vals.push(e.spec == null ? null : JSON.stringify(e.spec));
          sets.push(`workout_spec = $${vals.length}::jsonb`);
        }
        await tx.query(
          `UPDATE plan_workouts SET ${sets.join(', ')} WHERE plan_id = $1 AND id = $2`,
          vals,
        );
      }
      for (const f of edits.weekFlags) {
        await tx.query(`UPDATE plan_weeks SET is_cutback = $2 WHERE id = $1`, [f.weekId, f.isCutback]);
      }
      return edits.rows.length;
    },
  });

  if (!boundary.ok) {
    return {
      ok: false,
      code: 'rejected',
      reason: 'That change would break the plan\'s own rules, so it was not made.',
      violations: boundary.violations,
    };
  }

  await pool.query(
    `INSERT INTO plan_proposals
       (user_uuid, plan_id, proposal_kind, reasons, status, source, created_at, resolved_at)
     VALUES ($1, $2, 'plan_change', $3::jsonb, 'accepted', 'plan-change-sheet', NOW(), NOW())`,
    [userUuid, shape.planId, JSON.stringify({
      scenario: req.scenario,
      request: pickRequest(req),
      headline: proposal.headline,
      trade_off: proposal.tradeOff,
      changed: proposal.changed,
      miles_delta: proposal.effect.milesDelta,
      weeks: proposal.effect.weeks.map((w) => ({ week_idx: w.weekIdx, before: w.milesBefore, after: w.milesAfter })),
    })],
  ).catch((e: unknown) => console.warn('[plan/change] audit row failed:', (e as Error)?.message));

  return { ok: true, proposal, planId: shape.planId };
}

function pickRequest(req: ChangeRequest): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of CHANGE_KEYS) if (req[k] != null) out[k] = req[k];
  return out;
}

/** Re-derive the same edit set the proposal described. Same inputs, same rows. */
function editsFor(shape: PlanShape, todayISO: string, req: ChangeRequest): EditSet | null {
  switch (req.scenario) {
    case 'cutback': {
      const idx = req.weekIdx ?? nextFutureWeekIdx(shape, todayISO);
      if (idx == null) return null;
      const p = planCutback(shape, idx, todayISO);
      return 'unavailable' in p ? null : p.edits;
    }
    case 'extra_day': {
      const from = req.fromWeekIdx ?? nextFutureWeekIdx(shape, todayISO);
      if (from == null || req.dow == null) return null;
      const p = planExtraDay(shape, req.dow, from, todayISO);
      return 'unavailable' in p ? null : p.edits;
    }
    case 'travel': {
      if (!isISO(req.fromISO) || !isISO(req.toISO)) return null;
      const p = planTravel(shape, req.fromISO, req.toISO, todayISO);
      return 'unavailable' in p ? null : p.edits;
    }
    case 'move_day': {
      if (!isISO(req.dateISO) || !isISO(req.toDateISO)) return null;
      const p = planMoveDay(shape, req.dateISO, req.toDateISO, todayISO);
      return 'unavailable' in p ? null : p.edits;
    }
    default:
      return null;
  }
}
