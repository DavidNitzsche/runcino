/**
 * lib/plan/progression-pass.ts · the weekly cycle that connects the two halves
 * of `Design/adaptive-progression-engine.md` §3.
 *
 * ## What was disconnected
 *
 * Both halves existed and neither could see the other.
 *
 *   · CALENDAR PROPOSES. `lib/prescription/trajectory.ts` gives every generic
 *     quality session a `WorkShape` and grows it week over week by duration,
 *     then density. Authored into the plan, and since PROGRESSION-PERSIST-1 the
 *     shape survives onto `plan_workouts.workout_spec` under a `progression` key.
 *
 *   · EVIDENCE PERMITS OR MODIFIES. `lib/plan/progression-gate.ts`
 *     `resolveProgressionStep` takes the planned shape, the previously
 *     prescribed shape and an `AdaptationVerdict` and returns TAKE /
 *     ACCELERATE / HOLD / BACK_OFF. Pure, seventeen tests, and NOTHING CALLED
 *     IT. It decided correctly and ran never.
 *
 * So a block that started going badly kept prescribing the escalation it had
 * drawn up in week one, which is doctrine's rule 9 — "poor adaptation should
 * hold or reduce progression regardless of what the calendar expected" —
 * inverted.
 *
 * This module is the cycle. Once per training week it reads how the runner is
 * absorbing the work and resolves the week's upcoming quality sessions against
 * it.
 *
 * ## The one mechanism worth reading closely · resuming a paused ladder
 *
 * A HOLD repeats last week's session. The trap is what happens the week AFTER
 * the runner recovers. The calendar has kept climbing the whole time — it
 * proposed 4x11, then 3x15, then 3x17 — so taking "the planned step" on the
 * recovery week would hand a runner who has been sitting at 4x9 a session three
 * rungs above where they paused. That is the calendar deciding fitness by
 * elapsed time, which is the engine's first non-negotiable rule.
 *
 * The fix is to step from where the RUNNER is, using the lever the CALENDAR
 * intended:
 *
 *     planned = advanceShape(what was actually prescribed last week,
 *                            the lever this week's authored step used)
 *
 * Applied only once the two have diverged. While they agree — which is every
 * week of a block that is going fine — the authored shape is used verbatim and
 * this module writes nothing at all, so a healthy plan is untouched byte for
 * byte. It is also why the row has to remember both numbers; see
 * `progression-spec.ts`'s `authored` field.
 *
 * ## What this module will not do
 *
 * It does not move PACE, in either direction. Every decision here is duration,
 * reps or recovery — the cheap levers. Backing off is about dose; deciding the
 * runner got slower is the fitness model's job and it moves on measurement
 * (`recomputePacesForPlan`), never on a bad fortnight. The rendered label
 * therefore keeps its zone tag ("@ T pace") and the row's `pace_target_s_per_mi`
 * is rewritten to the value it already had.
 *
 * It does not move WEEKLY VOLUME. The day keeps its mileage and the work inside
 * it changes; a held session's freed miles become warm-up and cool-down, which
 * are easy miles by definition. Doctrine §12 asks for one variable at a time,
 * and volume has its own levers, its own curve and its own week-level owner.
 *
 * It does not read daily readiness. The verdict it consumes already excludes
 * it — readiness informs, it never acts (locked 2026-08-17).
 */

import {
  advanceShape,
  assignZone,
  type ProgressionLever,
  type WorkShape,
} from '@/lib/prescription/levers';
import {
  clampToDay,
  clampToWeek,
  paceTagOf,
  renderShapeLabel,
  type SessionFamily,
} from '@/lib/prescription/trajectory';
import { resolveProgressionStep, type ProgressionAction } from './progression-gate';
import type { AdaptationVerdict } from '@/lib/adaptation/adaptation-model';
import { trainingWeekWindow } from '@/lib/notifications/week-window';
import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { loadSettings } from '@/lib/coach/settings';
import {
  progressionSpecFields,
  preserveProgressionSql,
  readProgressionSpec,
  type GateStamp,
} from './progression-spec';
import { buildWorkoutSpec, capSpecToDistance } from './spec-builder';
import { primaryZone } from './prescription-parser';

/* ------------------------------------------------------------------ timing */

/**
 * How many days into a training week the pass may still fire.
 *
 * It is meant to run on the first day of the week, before any of that week's
 * quality is run. But the cron is a single daily fire on a schedule that can be
 * missed — a deploy, an outage, a user created mid-week — and a gate that
 * silently skips a whole cycle because one cron tick was lost is worse than one
 * that catches up a day late. Two days is enough slack to cover a missed tick
 * while still landing before a mid-week quality day; anything later and the
 * week is better left to next week's pass, which will read the same evidence
 * plus that week's.
 */
export const PASS_CATCHUP_DAYS = 2;

/**
 * Should the weekly pass run today?
 *
 * Pure, so the boundary rule is testable without a clock or a database. The
 * training week ENDS on the runner's `long_run_day` and starts the day after —
 * `trainingWeekWindow` is the single source of truth for that arithmetic
 * (locked 2026-06-16), shared with `/api/plan/week` and the weekly check-in
 * cron. Anchoring the cycle on ISO Monday instead would split a Saturday-long
 * runner's week in half and read one week's evidence against another week's
 * plan.
 *
 * `lastPassWeekStartISO` is the week the pass last ran for. It is what makes
 * this once-per-week rather than once-per-day: the same week never fires twice,
 * however many times the cron runs.
 */
export function progressionPassDue(args: {
  todayISO: string;
  /** Runner-local day of week for todayISO, 0=Sun..6=Sat. */
  todayDow: number;
  /** 0=Sun..6=Sat, from `user_settings.long_run_day`. */
  longRunDow: number;
  /** Week start the pass last ran for, or null if it never has. */
  lastPassWeekStartISO: string | null;
}): { due: boolean; weekStartISO: string; weekEndISO: string; dayIndex: number } {
  const { week_start_iso: weekStartISO, week_end_iso: weekEndISO } =
    trainingWeekWindow(args.todayISO, args.todayDow, args.longRunDow);
  const dayIndex = Math.round(
    (Date.parse(args.todayISO + 'T12:00:00Z') - Date.parse(weekStartISO + 'T12:00:00Z')) / 86_400_000,
  );
  const due = dayIndex >= 0
    && dayIndex <= PASS_CATCHUP_DAYS
    && args.lastPassWeekStartISO !== weekStartISO;
  return { due, weekStartISO, weekEndISO, dayIndex };
}

/* ------------------------------------------------------------------- types */

/** One trajectory-owned quality row in the week being resolved. */
export interface ProgressionTarget {
  workoutId: string;
  dateISO: string;
  family: SessionFamily;
  /** What the row currently prescribes — the comparison a no-op is measured
   *  against, so an unchanged week writes nothing. */
  current: WorkShape;
  /** The calendar's proposal for this session. Equals `current` on a row the
   *  gate has never touched. */
  authored: WorkShape;
  /** The lever the calendar pulled to reach `authored`. Null on a seed week or
   *  a week where every lever was already at its doctrine cap. */
  authoredLever: ProgressionLever | null;
  /** The day's mileage, which the resolved session has to fit inside. */
  dayBudgetMi: number | null;
}

/** What was actually prescribed for this family most recently, and what the
 *  calendar had wanted for the same session. */
export interface PriorPrescription {
  family: SessionFamily;
  dateISO: string;
  prescribed: WorkShape;
  authored: WorkShape;
}

export interface ProgressionResolution {
  workoutId: string;
  dateISO: string;
  family: SessionFamily;
  action: ProgressionAction;
  /** The shape to prescribe. */
  shape: WorkShape;
  /** The calendar's proposal, carried onto the row so the next cycle can see
   *  the divergence. */
  authored: WorkShape;
  authoredLever: ProgressionLever | null;
  /** The lever behind THIS week's prescription. Null unless the step was
   *  actually taken (HOLD and BACK_OFF pull nothing). */
  lever: ProgressionLever | null;
  /** One line in the coach register. */
  why: string;
  /** False when the resolved shape is what the row already carries — the
   *  caller writes nothing, which is the common case. */
  changed: boolean;
}

/* -------------------------------------------------------------------- core */

/**
 * Resolve one training week's quality sessions against the adaptation verdict.
 *
 * Pure. Every input is a plain value, which is what lets the whole cycle —
 * including a multi-week block where the runner degrades and then recovers — be
 * simulated without a database.
 */
export function resolveWeekProgression(args: {
  targets: ProgressionTarget[];
  /** The most recent prescription per family, from the weeks before this one. */
  prior: Map<SessionFamily, PriorPrescription>;
  verdict: AdaptationVerdict;
  /** The week's planned mileage, for the doctrine caps. */
  weeklyMi: number;
}): ProgressionResolution[] {
  const { targets, prior, verdict, weeklyMi } = args;
  const out: ProgressionResolution[] = [];

  for (const target of targets) {
    const p = prior.get(target.family) ?? null;

    // Re-anchor every carried shape on the pace the ROW currently prescribes,
    // before any cap arithmetic. The trajectory does the same thing week to
    // week, and for the same reason: pace moves only when evidence moves it
    // (`recomputePacesForPlan`), and a shape carried forward from a week priced
    // at the old anchor would compute its Daniels caps against a pace nobody is
    // being asked to run. Without evidence this is a no-op.
    const pace = target.current.paceSPerMi;
    const previous = p ? { ...p.prescribed, paceSPerMi: pace } : null;
    const priorAuthored = p ? { ...p.authored, paceSPerMi: pace } : null;

    // The step the calendar is proposing THIS week, expressed from where the
    // runner actually is. See the module header — this is the resume-the-ladder
    // mechanism, and it is deliberately inert until a divergence exists.
    const planned = plannedStep({
      authored: target.authored,
      authoredLever: target.authoredLever,
      previous,
      priorAuthored,
      weeklyMi,
      family: target.family,
    });

    const decision = resolveProgressionStep({
      planned,
      previous,
      verdict,
      weeklyMi,
      family: target.family,
      lever: target.authoredLever,
    });

    // Size only what this pass COMPUTED.
    //
    // The authored shape already went through both of these clamps when the
    // plan was written, against this same week. Re-running them on a decision
    // that simply took the plan verbatim would re-derive a number the authoring
    // pipeline had already settled, and any disagreement between the two — a
    // rounding difference, a week whose mileage has since been shaved — would
    // surface as a rewrite the evidence never asked for. A gate that edits a
    // plan it agreed with is indistinguishable from one that is malfunctioning.
    //
    // Anything the pass derived — an acceleration, a held shape carried across
    // from another week, a ladder resumed from a pause — has never been sized
    // against this week, so it gets exactly the sizing authoring would have
    // given it: what Daniels' share of the week allows, then what the day can
    // physically hold once a warm-up, the jog floats and a cool-down are paid
    // for. That is what keeps the rendered label true of the spec built from it,
    // which is the sub_label/spec drift this codebase has fixed twice.
    let shape = decision.shape;
    if (!sameShape(shape, target.authored)) {
      shape = clampToWeek(shape, weeklyMi, target.family);
      if (target.dayBudgetMi != null && target.dayBudgetMi > 0) {
        shape = clampToDay(shape, target.dayBudgetMi, shape.recoveryMinutes);
      }
    }

    // The intent of the session follows the verdict, not the previous week's
    // label: doctrine §4 puts marginal and poor adaptation on ESTABLISHED work
    // unconditionally, and a held session is by definition accumulating rather
    // than overloading. `cyclesSinceProbe: 0` withholds PROBE from this pass on
    // purpose — a probe is a deliberate reach past demonstrated capability, and
    // introducing one from an adaptation sweep would be the gate making a claim
    // about the runner that the authoring trajectory is the right place to make.
    const lever = decision.action === 'TAKE' || decision.action === 'ACCELERATE'
      ? target.authoredLever
      : null;
    shape = {
      ...shape,
      zone: assignZone({ adaptation: verdict.band, lever, cyclesSinceProbe: 0 }),
    };

    const changed = !sameShape(shape, target.current);

    out.push({
      workoutId: target.workoutId,
      dateISO: target.dateISO,
      family: target.family,
      action: decision.action,
      shape,
      authored: target.authored,
      authoredLever: target.authoredLever,
      lever,
      // A TAKE that CHANGES the row is the resume case, and the gate's stock
      // line for it — "staying on the planned progression" — would be false
      // about a session that no longer matches the plan. Say what actually
      // happened: the ladder is moving again, from where it stopped.
      why: decision.action === 'TAKE' && changed
        ? 'Picking the progression back up from where it paused rather than from where the calendar had got to. '
          + 'You did not train the weeks that were held, so this steps up from the session you last did.'
        : decision.why,
      changed,
    });
  }

  return out;
}

/**
 * The step the calendar proposes this week, measured from where the runner is.
 *
 * Two cases, and the distinction is the whole point:
 *
 *   · NOT DIVERGED — the runner took last week's step as authored, so the
 *     authored shape for this week already IS "previous plus one step". Used
 *     verbatim. This is every week of a block that is going fine, and it is
 *     what makes the pass byte-stable on a healthy plan.
 *
 *   · DIVERGED — a previous cycle held or reduced, so the authored shape has
 *     kept climbing without the runner. Re-derive the step from what was
 *     actually prescribed, pulling the same lever the calendar chose, so the
 *     ladder resumes one rung above the pause instead of wherever the calendar
 *     had reached.
 */
function plannedStep(args: {
  authored: WorkShape;
  authoredLever: ProgressionLever | null;
  previous: WorkShape | null;
  priorAuthored: WorkShape | null;
  weeklyMi: number;
  family: SessionFamily;
}): WorkShape {
  const { authored, authoredLever, previous, priorAuthored, weeklyMi, family } = args;
  if (previous == null || priorAuthored == null) return authored;
  if (sameShape(previous, priorAuthored)) return authored;

  // Diverged. The calendar authored no step this week (a seed, a week where
  // every lever was already capped) — so there is nothing to add to the held
  // shape, and the held shape is the proposal.
  if (authoredLever == null) return previous;

  const stepped = advanceShape({
    shape: previous,
    lever: authoredLever,
    // A full planned step, never the verdict's multiplier. This is the CALENDAR
    // half of doctrine §3 being reconstructed; whether the runner takes it, and
    // whether they take a little more, is `resolveProgressionStep`'s decision
    // immediately afterwards, and applying the multiplier here would apply it
    // twice.
    stepMultiplier: 1,
    weeklyMi,
    family,
  });
  // Capped at the runner's current volume: the proposal is to hold, because
  // there is no legal step to propose.
  return stepped.capped ? previous : stepped.shape;
}

export function sameShape(a: WorkShape, b: WorkShape): boolean {
  return a.reps === b.reps
    && Math.abs(a.repMinutes - b.repMinutes) < 0.005
    && Math.abs(a.recoveryMinutes - b.recoveryMinutes) < 0.005
    && Math.round(a.paceSPerMi) === Math.round(b.paceSPerMi);
}

/* --------------------------------------------------------------- rendering */

/**
 * The prescription string for a resolved session.
 *
 * Delegates to the trajectory's own renderer rather than growing a second one:
 * `buildWorkoutSpec` parses this exact string back through `parseTimeReps` to
 * build the spec a watch executes, and `renderRoundTrips` is the standing
 * assertion that it survives the trip. Two renderers would be two definitions
 * of one workout.
 *
 * `paceTag` carries the zone the row already named — a marathon block's rep
 * session is authored "@ I-T transition" and paces at T-18, which is
 * deliberately not Daniels' I. Re-labelling it "@ I pace" would make the label
 * claim something the number under it does not support.
 */
export function renderResolution(res: ProgressionResolution, paceTag: string | null): string {
  return renderShapeLabel(res.shape, res.family, paceTag);
}

/* ------------------------------------------------------------------ loader */

/** How far back a "current stimulus" may sit and still be worth holding.
 *  Past three weeks the runner has not done that session recently enough for
 *  repeating it to mean anything, and the authored seed is the honest answer. */
export const PRIOR_LOOKBACK_DAYS = 21;

/** The row the reshape writer needs, beyond the resolution itself. */
export interface ProgressionRowContext {
  type: string;
  distanceMi: number | null;
  subLabel: string | null;
}

export interface ProgressionWeek {
  planId: string;
  todayISO: string;
  weekStartISO: string;
  weekEndISO: string;
  weeklyMi: number;
  targets: ProgressionTarget[];
  prior: Map<SessionFamily, PriorPrescription>;
  context: Map<string, ProgressionRowContext>;
  /** Lactate-threshold HR from the plan's authored state, so a rebuilt spec
   *  keeps the HR ceiling it already carried. */
  lthr: number | null;
}

const DOW_OF: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

/**
 * Which cap family a persisted row falls under.
 *
 * ZONE-R-1 (2026-08-19) · read off the row's own PRESCRIPTION rather than off
 * its type alone. `Research/01`'s dosing table caps three paces and the type
 * only distinguishes two of them: a `threshold` row prescribing §5.4's
 * sub-threshold intervals and an `intervals` row prescribing §7.4's 200 m
 * repeats both used to come back as the type's default family, which is the
 * wrong cap in the second case by a factor of nearly two. `primaryZone` is the
 * same reading `buildWorkoutSpec` paces off and `dosing.ts` charges off, so all
 * three agree about what a row is by construction.
 *
 * Type still decides when the prescription declares no zone, and every
 * prescription the engine wrote before this declares one that maps back to the
 * type's own family — so nothing existing changes hands.
 */
export function familyOfType(type: string, prescription?: string | null): SessionFamily | null {
  const declared = ZONE_SESSION_FAMILY[primaryZone(prescription) ?? ''] ?? null;
  // PROGRESSION-DOSE-1 (2026-08-30) · `tempo` joins `threshold`, on doctrine
  // rather than on convenience. `Research/01` § "Pace prescription by workout
  // type" gives "Tempo (continuous)" and "Cruise intervals" the SAME Daniels
  // zone (T), the same pace anchor, the same RPE 7-8 and the same 88-92%
  // HRmax; the concept table above it lists them as "T" and "T (broken)". A
  // tempo is the threshold ladder run continuously.
  //
  // It was already treated that way on the composer's sizing path
  // (`doseTrackOfType`), and not here, so a tempo row carrying a persisted
  // dose would have been read as belonging to no family and skipped — the
  // reader half of the same Rule 16 split. On this runner's block that is 8 of
  // 24 quality slots.
  if (type === 'threshold' || type === 'tempo') return declared ?? 'threshold';
  if (type === 'intervals' || type === 'vo2max') return declared ?? 'interval';
  return null;
}

/** `Research/04`'s zone shorthand onto `Research/01`'s three capped rows. The
 *  same mapping `ZONE_DOSE_PACE` states for the dosing gate; T/I/R here because
 *  the trajectory speaks in cap families and the gate speaks in pace letters. */
const ZONE_SESSION_FAMILY: Record<string, SessionFamily | undefined> = {
  T: 'threshold', ST: 'threshold', HM: 'threshold',
  I: 'interval', '5K': 'interval', '10K': 'interval', '3K': 'interval',
  R: 'repetition', mile: 'repetition',
};

/**
 * Load everything the weekly pass needs for one runner, or null when it should
 * not run.
 *
 * Returns null — quietly and by design — in each of these cases:
 *
 *   · not the start of a training week, or this week has already been resolved
 *   · no active plan
 *   · the upcoming week is a CUTBACK, a RACE WEEK or in the TAPER. The
 *     trajectory does not step on those weeks (doctrine §2's W4: "a recovery
 *     week absorbs the block; it does not carry a progression step"), so the
 *     gate has no proposed step to permit or refuse. Backing a struggling
 *     runner off inside a deload would also double-count relief the week is
 *     already giving them.
 *   · the week carries no trajectory-owned quality session
 *
 * A row is trajectory-owned exactly when it carries a `progression` block, so
 * ownership is read rather than re-derived. The named `Research/04` §15
 * vocabulary families, the taper's marathon-pace block and a beginner's fartlek
 * carry doses doctrine states by name, never got a block, and are untouched
 * here for the same reason the trajectory leaves them alone.
 */
export async function loadProgressionWeek(userId: string): Promise<ProgressionWeek | null> {
  return (await diagnoseProgressionWeek(userId)).week;
}

/**
 * WHY the pass produced nothing, when it produced nothing.
 *
 * `loadProgressionWeek` returns `null` for five structurally different reasons
 * and a caller that only sees `null` cannot tell them apart. That was harmless
 * while the only caller was the pass itself — it wants to do nothing in all
 * five cases — and stopped being harmless the moment the Adaptation Engine
 * started REPORTING one of them. It reported the same sentence for all five:
 * "no plan row carries a progression block, an authoring gap". On five days in
 * seven the true answer is "the pass already ran for this week", which is not
 * a gap and not about the plan at all.
 *
 * Rule 11 in the small, and Rule 16: one name may not carry five facts.
 */
export type ProgressionWeekSkip =
  | 'PASS_NOT_DUE'
  | 'NO_ACTIVE_PLAN'
  | 'NO_ROWS_IN_WEEK'
  | 'WEEK_TAKES_NO_STEP'
  | 'NO_AUTHORED_PROGRESSION_BLOCK';

export interface ProgressionWeekDiagnosis {
  week: ProgressionWeek | null;
  /** Null exactly when `week` is non-null. */
  skip: ProgressionWeekSkip | null;
}

/**
 * WHY a plan week takes no progression step, off the week's own flags — or
 * null when it steps.
 *
 * THE one definition (Rule 16). This predicate decides `WEEK_TAKES_NO_STEP`
 * for the density pass below, and since 2026-09-02 the Adaptation Engine's
 * VOLUME and DURATION levers read the same answer through
 * `lib/adaptation/load-adaptation-engine.ts` (`WeekAheadRead`), so the three
 * levers cannot disagree about which weeks are sized down on purpose. Pure, so
 * the engine's own tests can walk it without a database.
 */
export function weekRowNoStepReason(r: {
  is_cutback: boolean | null;
  is_race_week: boolean | null;
  phase: string | null;
}): 'CUTBACK' | 'RACE_WEEK' | 'TAPER' | null {
  if (r.is_cutback === true) return 'CUTBACK';
  if (r.is_race_week === true) return 'RACE_WEEK';
  if ((r.phase ?? '') === 'TAPER') return 'TAPER';
  return null;
}

/**
 * The same load, with the reason kept. `loadProgressionWeek` is the thin
 * wrapper so no existing caller changes behaviour by one byte.
 */
export async function diagnoseProgressionWeek(userId: string): Promise<ProgressionWeekDiagnosis> {
  const todayISO = await runnerToday(userId);
  const settings = await loadSettings(userId);
  const longRunDow = DOW_OF[settings.long_run_day] ?? 0;
  const todayDow = new Date(todayISO + 'T12:00:00Z').getUTCDay();

  // ── 2026-09-02 · THIS MARKER IS RE-BASED, NOT LEFT READING A DEAD TABLE ──
  //
  // The once-per-week marker used to be written ONLY by an APPLIED reshape
  // (`plan_adapt_progression`, adapt.ts). The 2026-09-02 seal means an
  // unattended reshape is never applied, so that reason stopped being written
  // by the cron — and this read would have returned null forever, leaving the
  // guard permanently open and the pass firing on all three catch-up mornings
  // of every week instead of one.
  //
  // That is precisely the Rule 11 shape a seal is most likely to create: a
  // guard that silently stops guarding because the input it reads was deleted
  // upstream. So the read is widened rather than the guard abandoned. The
  // question this marker answers is "has this week's pass already been
  // DECIDED", and a decision the seam refused is still a decision — the pass
  // ran, resolved the week, and recorded the outcome as `plan_adapt_sealed`.
  // Both rows mean "done for this week".
  //
  // The two reasons stay DISTINCT everywhere else on purpose: a sealed note
  // must never be mistaken for work performed (see
  // lib/plan/adaptation-authority.ts, and the pace-anchor deferral that would
  // have frozen the block's paces if it had been). This is the one reader for
  // which they genuinely mean the same thing, and it says so rather than
  // quietly merging them.
  //
  // The `value ? 'week_start_iso'` filter is load-bearing: `plan_adapt_sealed`
  // is a shared namespace and most of its rows (a refused recompute, a refused
  // bump) carry no week marker, so without it the newest sealed row of any
  // kind would answer null and the guard would be open again one layer deeper.
  // The `LIKE '{%'` guard is the `missedAlreadyHandledSql` idiom:
  // `coach_intents.value` is TEXT and some reasons store a bare string, so an
  // unguarded `::jsonb` cast can throw on a row this predicate is not about.
  const lastPass = (await pool.query<{ week_start: string | null }>(
    `SELECT value::jsonb->>'week_start_iso' AS week_start
       FROM coach_intents
      WHERE COALESCE(user_uuid, user_id) = $1::uuid
        AND reason IN ('plan_adapt_progression', 'plan_adapt_sealed')
        AND value LIKE '{%'
        AND value::jsonb ? 'week_start_iso'
      ORDER BY ts DESC LIMIT 1`,
    [userId],
  ).catch(() => ({ rows: [] as Array<{ week_start: string | null }> }))).rows[0]?.week_start ?? null;

  const due = progressionPassDue({ todayISO, todayDow, longRunDow, lastPassWeekStartISO: lastPass });
  if (!due.due) return { week: null, skip: 'PASS_NOT_DUE' };

  const plan = (await pool.query<{ id: string; authored_state: Record<string, unknown> | null }>(
    `SELECT id, authored_state FROM training_plans
      WHERE user_uuid = $1 AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [userId],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!plan) return { week: null, skip: 'NO_ACTIVE_PLAN' };

  const st = (plan.authored_state ?? {}) as Record<string, unknown>;
  const lthr = st.lthr_bpm != null ? Number(st.lthr_bpm) : null;

  // The week's rows, with the flags that decide whether the week steps at all.
  const weekRows = (await pool.query<{
    id: string; date_iso: string; type: string; distance_mi: string | null;
    sub_label: string | null; workout_spec: unknown;
    is_cutback: boolean | null; is_race_week: boolean | null; phase: string | null;
  }>(
    `SELECT pw.id::text AS id, pw.date_iso::text AS date_iso, pw.type,
            pw.distance_mi::text AS distance_mi, pw.sub_label, pw.workout_spec,
            wk.is_cutback, wk.is_race_week, ph.label AS phase
       FROM plan_workouts pw
       LEFT JOIN plan_weeks wk ON wk.id = pw.week_id
       LEFT JOIN plan_phases ph ON ph.id = wk.phase_id
      WHERE pw.plan_id = $1
        AND pw.date_iso::date >= $2::date
        AND pw.date_iso::date <= $3::date
      ORDER BY pw.date_iso::date ASC`,
    [plan.id, due.weekStartISO, due.weekEndISO],
  ).catch(() => ({ rows: [] }))).rows;
  if (weekRows.length === 0) return { week: null, skip: 'NO_ROWS_IN_WEEK' };

  if (weekRows.some((r) => weekRowNoStepReason(r) != null)) {
    return { week: null, skip: 'WEEK_TAKES_NO_STEP' };
  }

  // The week's own planned mileage, which is what Daniels' at-pace share is a
  // share OF. Summed from the rows rather than read from a column so it always
  // describes the week as it currently stands, shaves and all.
  let weeklyMi = 0;
  for (const r of weekRows) weeklyMi += r.distance_mi != null ? Number(r.distance_mi) : 0;

  const targets: ProgressionTarget[] = [];
  const context = new Map<string, ProgressionRowContext>();
  for (const r of weekRows) {
    // Never rewrite a day that has already arrived. The seal filter in
    // `applyAdaptations` independently refuses any date carrying a completed
    // run; this is the cheaper half of the same rule, and it also declines to
    // rewrite a day the runner simply missed — that session is history now.
    if (r.date_iso < todayISO) continue;
    const family = familyOfType(r.type, r.sub_label);
    if (family == null) continue;
    const block = readProgressionSpec(r.workout_spec);
    if (block == null) continue;
    targets.push({
      workoutId: r.id,
      dateISO: r.date_iso,
      family,
      current: block.shape,
      authored: block.authored?.shape ?? block.shape,
      authoredLever: block.authored?.lever ?? block.lever,
      dayBudgetMi: r.distance_mi != null ? Number(r.distance_mi) : null,
    });
    context.set(r.id, {
      type: r.type,
      distanceMi: r.distance_mi != null ? Number(r.distance_mi) : null,
      subLabel: r.sub_label,
    });
  }
  if (targets.length === 0) return { week: null, skip: 'NO_AUTHORED_PROGRESSION_BLOCK' };

  // What was actually prescribed most recently, per family, from the weeks
  // BEFORE this one. Scoped to the active plan: a rebuild re-authors the whole
  // trajectory from its own seed, so a shape from a superseded plan describes a
  // ladder that no longer exists.
  //
  // DELOAD WEEKS ARE SKIPPED, and this is load-bearing rather than tidy. A
  // cutback week's session is clamped to the reduced mileage — Daniels' share
  // is a share of what the runner is actually running — so its row carries a
  // deliberately small shape that the runner never earned their way down to.
  // Treating it as "the current stimulus" would do two wrong things at once:
  // hold a struggling runner at the deload dose, and, worse, ERASE a pause. A
  // deload row has no divergence recorded on it (the gate skips those weeks),
  // so if it were the prior, the week after a deload would read as "on plan"
  // and jump the ladder back to wherever the calendar had climbed to while the
  // runner was being held. The trajectory itself resumes from its pre-deload
  // shape for exactly this reason; the gate has to agree with it.
  const lookbackISO = new Date(
    Date.parse(due.weekStartISO + 'T12:00:00Z') - PRIOR_LOOKBACK_DAYS * 86_400_000,
  ).toISOString().slice(0, 10);
  const priorRows = (await pool.query<{
    date_iso: string; type: string; sub_label: string | null; workout_spec: unknown;
  }>(
    `SELECT pw.date_iso::text AS date_iso, pw.type, pw.sub_label, pw.workout_spec
       FROM plan_workouts pw
       LEFT JOIN plan_weeks wk ON wk.id = pw.week_id
       LEFT JOIN plan_phases ph ON ph.id = wk.phase_id
      WHERE pw.plan_id = $1
        AND pw.date_iso::date < $2::date
        AND pw.date_iso::date >= $3::date
        AND COALESCE(wk.is_cutback, false) = false
        AND COALESCE(wk.is_race_week, false) = false
        AND COALESCE(ph.label, '') <> 'TAPER'
      ORDER BY pw.date_iso::date DESC`,
    [plan.id, due.weekStartISO, lookbackISO],
  ).catch(() => ({ rows: [] }))).rows;

  const prior = new Map<SessionFamily, PriorPrescription>();
  for (const r of priorRows) {
    const family = familyOfType(r.type, r.sub_label);
    if (family == null || prior.has(family)) continue;
    const block = readProgressionSpec(r.workout_spec);
    if (block == null) continue;
    prior.set(family, {
      family,
      dateISO: r.date_iso,
      prescribed: block.shape,
      authored: block.authored?.shape ?? block.shape,
    });
  }

  return {
    week: {
      planId: plan.id,
      todayISO,
      weekStartISO: due.weekStartISO,
      weekEndISO: due.weekEndISO,
      weeklyMi,
      targets,
      prior,
      context,
      lthr,
    },
    skip: null,
  };
}

/* ------------------------------------------------------------------ writer */

/**
 * Rewrite one row to the shape the gate resolved.
 *
 * `workout_spec`, `sub_label` and `pace_target_s_per_mi` are written together
 * from ONE source — the rendered label — so they cannot disagree. The chain is
 * the same one `persistPlan` runs at authoring:
 *
 *     shape -> renderShapeLabel -> buildWorkoutSpec (parses the label back)
 *           -> capSpecToDistance -> attach the block -> subLabelFromSpec
 *
 * Two things are held fixed on purpose. The work PACE is passed in as both the
 * threshold anchor and the I-pace anchor, so `buildWorkoutSpec` prices the reps
 * at exactly the number the row already carried and `pace_target_s_per_mi` is
 * rewritten to its own value — the gate moves dose, never pace. And the DAY's
 * mileage is the budget the spec is built against rather than something this
 * function recomputes, so a held session's freed miles land in the warm-up and
 * cool-down and the week's volume is untouched.
 *
 * Rule 6: `workout_spec` is a multi-writer jsonb column and this rewrite is for
 * the SAME session, so it goes through `preserveProgressionSql`. The new spec
 * always carries a block, so the guard passes the new one through — the wrapper
 * is there because a future edit that stopped emitting a block would otherwise
 * silently erase the trajectory's shape, which is exactly how this codebase
 * lost `strava_activities.data.splits` and `races.actual_result`.
 *
 * PLAN MUTATION BOUNDARY (2026-08-18). `client` must be a transaction the
 * boundary already owns — today that is always `applyAdaptations`, whose whole
 * action loop runs inside `mutatePlan`. This function deliberately does not
 * enter the door itself: it is one statement inside a larger coherent batch,
 * and validating it alone would judge an intermediate state of that batch.
 *
 * What it writes is `workout_spec`, `sub_label`, `original_sub_label` and
 * `pace_target_s_per_mi` — the geometry of the work inside the session, never
 * its date, type, distance or quality flag. So even standing alone it could not
 * move an invariant; the batch it belongs to is what needs the gate.
 */
export async function applyProgressionReshape(
  client: { query: typeof pool.query },
  args: {
    workoutId: string;
    row: ProgressionRowContext;
    resolution: ProgressionResolution;
    band: GateStamp['band'];
    lthr: number | null;
  },
): Promise<boolean> {
  const { row, resolution } = args;
  if (row.distanceMi == null || !(row.distanceMi > 0)) return false;

  // Is this still the session the gate resolved?
  //
  // Actions apply in one transaction and the gate's are last, so an earlier
  // action in the SAME pass can have changed this row underneath us. The live
  // case is a niggle at 5-6 out of 10: it downgrades the next quality day to
  // easy, clearing the type, the label and the pace — and a reshape landing
  // afterwards would write a threshold spec onto a row that is now an easy run,
  // producing exactly the contradictory state the downgrade path documents at
  // length ("type=easy but sub_label='Cruise Intervals' + pace=T-pace"). The
  // severity that fires this is below the one `runnerIsCompromised` filters on,
  // so the detector's context filter cannot catch it.
  //
  // Re-reading the type is the general guard rather than a niggle-specific one:
  // any writer that makes this row a different session wins, because it acted
  // on something more urgent than a dose adjustment.
  const live = (await client.query<{ type: string; distance_mi: string | null; sub_label: string | null }>(
    `SELECT type, distance_mi::text, sub_label FROM plan_workouts WHERE id = $1 LIMIT 1`,
    [args.workoutId],
  ).catch(() => ({ rows: [] as Array<{ type: string; distance_mi: string | null; sub_label: string | null }> }))).rows[0];
  if (!live || live.type !== row.type) {
    console.log(`[progression] skip reshape ${args.workoutId} · row is now '${live?.type ?? 'gone'}', was '${row.type}'`);
    return false;
  }
  // Deliberately NOT gated on the action. A TAKE usually changes nothing and
  // never reaches here, because the detector only emits actions for resolutions
  // it marked `changed` — but a TAKE that RESUMES a paused ladder does change
  // the row, and refusing to write it would leave the runner on the calendar's
  // accumulated session, which is the one thing this whole cycle exists to
  // prevent. `changed` is the authority on whether to write; the action names
  // what was decided.
  //
  // Everything below reads the LIVE row rather than the snapshot taken at
  // detect time, for the same reason: a volume shave applying earlier in this
  // transaction has already moved the mileage, and sizing the session against
  // the stale number is how a label ends up promising more work than the day
  // carries.
  const liveMi = live.distance_mi != null ? Number(live.distance_mi) : row.distanceMi;
  if (!(liveMi > 0)) return false;
  const paceTag = paceTagOf(live.sub_label ?? row.subLabel);
  const label = renderResolution(resolution, paceTag);
  const workPace = resolution.shape.paceSPerMi;
  const built = buildWorkoutSpec(
    row.type,
    liveMi,
    workPace,
    args.lthr,
    label,
    null,        // maxHr · re-derives on the next full rebuild, same posture as
                 // adapt.ts rebuildWorkoutDerivations and recomputePacesForPlan
    null,        // goalPaceSPerMi · only the race branch reads it
    workPace,    // iPaceSec · the rep session's own pace, so a reshape cannot
                 // move it. Ignored by the threshold branch.
    null,
  );
  if (!built.spec) return false;

  const capped = capSpecToDistance(built.spec, liveMi) as Record<string, unknown>;
  const diverged = !sameShape(resolution.shape, resolution.authored);
  const spec = {
    ...capped,
    ...progressionSpecFields({
      shape: resolution.shape,
      lever: resolution.lever,
      zone: resolution.shape.zone,
      // `capSpecToDistance` and `timeRepSpec` can both drop a rep the day
      // cannot hold. The block has to describe the session actually
      // PRESCRIBED — that is what the next cycle will hold or step from — so
      // the spec's own count wins over the intent whenever they differ.
      repsOverride: Number(capped.rep_count ?? 0) || null,
      // Only when the two have actually parted company. A row whose
      // prescription lands back on the calendar's own proposal is not diverged
      // and does not need a second copy of the same shape.
      authored: diverged
        ? { shape: resolution.authored, lever: resolution.authoredLever }
        : null,
      gate: { action: resolution.action, band: args.band, at: new Date().toISOString() },
    }),
  };

  const { subLabelFromSpec } = await import('@/lib/training/expand-spec');
  const derivedLabel = subLabelFromSpec(spec as Parameters<typeof subLabelFromSpec>[0]);

  await client.query(
    // `original_sub_label` is what makes the change VISIBLE. `adaptation-info`
    // reads it against the current label to decide `wasAdapted`, and pairs it
    // with the coach_intents row this action writes to render "was CRUISE
    // INTERVALS · <why>". A change the runner cannot see is the failure mode
    // the deploy doctrine warns about; COALESCE keeps the FIRST authored label
    // across repeated reshapes, so the comparison stays against the plan the
    // runner was originally given.
    `UPDATE plan_workouts
        SET workout_spec = ${preserveProgressionSql('$1')},
            original_sub_label = COALESCE(original_sub_label, sub_label),
            sub_label = COALESCE($2, sub_label),
            pace_target_s_per_mi = COALESCE($3, pace_target_s_per_mi)
      WHERE id = $4`,
    [JSON.stringify(spec), derivedLabel, built.paceTargetSPerMi, args.workoutId],
  );
  return true;
}
