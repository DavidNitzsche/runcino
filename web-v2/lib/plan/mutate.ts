/**
 * lib/plan/mutate.ts · THE PLAN MUTATION BOUNDARY.
 *
 * ─── why this file exists ────────────────────────────────────────────────────
 *
 * There was a funnel for how a plan is BORN and none for how it CHANGES.
 * `validateComposedPlan` is a real runtime gate — it throws on the doctrine
 * invariants and no plan is written when it fires — but it was called in
 * exactly two places (`generate.ts`, `/api/plan/simulate`). Meanwhile fourteen
 * files issued raw `UPDATE plan_workouts` / `INSERT` / `DELETE` statements
 * against the same rows, and thirteen of them validated nothing at all.
 *
 * The sharpest case is `adapt.ts`, the 03:00 nightly cron. Its `field_test`
 * limb issues `SET type='tempo', is_quality=true` on an arbitrary future day.
 * That can ADD threshold work to a week, next to the long run, with no check
 * on the result — the stimulus-gap rule (Research/00b:55-60), the quality
 * coverage rule and the long-primacy rule were all reachable-but-unguarded
 * after authorship. Every invariant the validator enforces could be silently
 * broken the night after the plan was authored.
 *
 * This module is the single door in front of `plan_workouts`. It does not
 * change the table, the watch payload, the native app, or any API response
 * shape. It puts a gate in front of the writes.
 *
 * ─── how it works ────────────────────────────────────────────────────────────
 *
 *   1. open a transaction
 *   2. snapshot the plan BEFORE (three SELECTs) and rehydrate it into the
 *      `ComposePlanResult` shape `validateComposedPlan` consumes
 *   3. run the caller's `apply(tx)` — the actual writes, unchanged
 *   4. snapshot + rehydrate AFTER
 *   5. compare, then COMMIT or ROLLBACK
 *
 * ─── DESIGN DECISION 1 · differential, not absolute ──────────────────────────
 *
 * A mutation is rejected for the violations it INTRODUCES, never for the ones
 * it inherited. This is the difference between a boundary and a booby trap.
 *
 * Plans in the database were authored by older engine versions, under older
 * validator rules, and some of them carry violations the current validator
 * would flag. An absolute gate would refuse every adaptation on every one of
 * those plans forever — the runner's cron would go dark and the failure would
 * look like "the adapter does nothing", which is the hardest kind of bug to
 * see. Differential validation asks the only question a mutation boundary can
 * honestly ask: *did this change make the plan worse against doctrine?*
 *
 * Pre-existing violations are not swallowed. They are returned on every result
 * and recorded on every rejection, so a plan that is already out of doctrine
 * is visible rather than merely tolerated.
 *
 * A second, quieter benefit: because both sides of the diff are validated with
 * the SAME context, an imprecise context (see "context reconstruction" below)
 * cannot manufacture a rejection. It shifts both sides equally.
 *
 * ─── DESIGN DECISION 2 · three declared mutation kinds ───────────────────────
 *
 *   'structural'   (default) — the mutation may change what is prescribed.
 *                  Full rehydrate + differential validate. Introduced
 *                  violations → ROLLBACK.
 *
 *   'derivations'  — the caller declares it touches ONLY
 *                  pace_target_s_per_mi / workout_spec / sub_label / notes:
 *                  fields no invariant reads. Validation is skipped, and the
 *                  declaration is PROVEN rather than trusted — the boundary
 *                  fingerprints (id, date_iso, dow, type, distance_mi,
 *                  is_quality, is_long) before and after and rolls back if the
 *                  fingerprint moved. A false declaration is itself a
 *                  rejection, recorded as `undeclared_structural`.
 *
 *   'authorship'   — plan CREATION (generate.ts). There is no before-state to
 *                  diff against; the plan was already validated in memory by
 *                  `validateComposedPlan` before persistence. Here the
 *                  boundary re-reads what was actually WRITTEN and validates
 *                  that, which is the one thing nothing checked: `persistPlan`
 *                  re-derives distances from the workout spec, overlays sealed
 *                  days from the prior plan, and caps spec distance — all
 *                  AFTER the in-memory validation passed. Divergence here is
 *                  REPORT-ONLY (outcome `authorship_drift`) and never rolls
 *                  back. Rolling back a rebuild would leave a runner with no
 *                  plan at all, which is a strictly worse outcome than a plan
 *                  that drifted by half a mile. See the note at that call site.
 *
 * ─── DESIGN DECISION 3 · rejection is recorded, never silent, never fatal ────
 *
 * A rejected adaptation that nobody ever sees is the same class of bug as an
 * unguarded write. So:
 *
 *   · the transaction rolls back — the plan is byte-identical to before
 *   · a row lands in `plan_mutation_rejections` (see
 *     db/migrations/150_plan_mutation_rejections.sql) on a SEPARATE connection,
 *     because the mutation's own transaction is gone
 *   · a `[plan/mutate] REJECTED` line goes to the log
 *   · `mutatePlan` RETURNS `{ ok: false }`. It does not throw.
 *
 * The last point is the one that keeps the cron alive. `applyAdaptations` runs
 * inside a per-user loop; a throw would abort the sweep and every user after
 * the first bad one would go un-adapted. A returned rejection lets the caller
 * log and continue. API routes turn it into a 409 with the violation list.
 *
 * If the rejection table does not exist yet, the write fails soft to
 * `console.error` — the boundary must never be the thing that breaks a cron.
 *
 * ─── PERFORMANCE · what is checked, and what the trade-off is ────────────────
 *
 * Validation is scoped by BATCH, not by statement, and it is FULL-PLAN.
 *
 *   · Cost per batch: 6 SELECTs (3 before, 3 after) over one plan — roughly
 *     one plan row, ~4 phases, ~16 weeks and ~100 workouts — plus two runs of
 *     a pure in-memory validator, plus one small context query.
 *   · `applyAdaptations` wraps its WHOLE action loop in one `mutatePlan` call,
 *     so the nightly cron pays this once per user WITH adaptations to apply,
 *     not once per UPDATE. Users with no actions return before the boundary is
 *     entered at all.
 *   · Nothing is narrowed. Every invariant that can be evaluated on persisted
 *     state is evaluated over the whole plan, so the cross-week rules
 *     (week-over-week ramp, taper descent, peak-vs-base) are genuinely
 *     checked rather than approximated inside a window.
 *
 * The trade-off taken: full validation, batched. The trade-off rejected:
 * per-statement validation, which would have been ~34 rehydrations per cron
 * user and would have forced a scoped, week-windowed check that silently
 * cannot see the taper or the ramp.
 *
 * ─── HONEST LIMITS · invariants this boundary CANNOT enforce ─────────────────
 *
 * `validateComposedPlan` runs on an in-memory `ComposePlanResult`. Rehydration
 * from `plan_workouts` + `plan_weeks` + `plan_phases` is faithful for every
 * field the validator reads EXCEPT the two below. This list is exhaustive and
 * was derived by walking every read in validate.ts.
 *
 *   §0 vols/weeklyMi coherence — NOT ENFORCEABLE, and never can be.
 *      `vols` is the volume-curve budget series that `composePlan` produces
 *      and `finalize` re-snapshots. It is not persisted anywhere. Rehydration
 *      sets `vols` FROM the realized `weeklyMi`, so the check compares a value
 *      against itself and is structurally incapable of firing. It is an
 *      author-time coherence check between two in-memory series; after
 *      persistence only one of the two series still exists. Nothing is
 *      pretended here: the check runs, it passes vacuously, and it is listed
 *      as unenforceable rather than counted as coverage.
 *
 *   §2 prior-plan corruption check — NOT APPLICABLE, deliberately skipped.
 *      It compares a NEWLY COMPOSED plan's peak long against the plan it is
 *      about to REPLACE. A mutation edits the plan in place; there is no
 *      replaced plan, and the "prior" it would compare against is the same
 *      plan one statement ago. `priorPlanPeakLongMi` is passed null, which is
 *      the validator's own documented skip. A mutation that collapses the long
 *      run is still caught, by §4 (long-run week-over-week) and §7
 *      (long-primacy).
 *
 * Everything else IS enforced, on the real persisted rows:
 *
 *   §1 long-run peak vs the per-distance doctrine cap        ENFORCED
 *   §3 peak weekly volume vs the safe-ramp ceiling           ENFORCED (see note)
 *   §4 long-run week-over-week increase                      ENFORCED
 *   §4b taper present · depth floor · depth ceiling ·
 *      per-week doctrine target · monotone descent           ENFORCED
 *   §5 quality coverage in QUALITY / RACE-SPECIFIC weeks     ENFORCED
 *   §6 weekly volume week-over-week arc                      ENFORCED
 *   §7 long-primacy (the long is the week's longest run)     ENFORCED
 *   §8 race-week chronology (nothing after race day)         ENFORCED
 *   §9 stimulus-gap adjacency (Research/00b:55-60)           ENFORCED
 *   §10 Daniels dosing caps                                  advisory in
 *      validate.ts itself (`onDosing`); not requested here, so not computed.
 *
 *   Note on §3: the ramp base is read from the plan's own `authored_state`
 *   (`recent_avg_mpw`), not re-queried from 28 days of run history. The check
 *   therefore asks "has a mutation pushed peak volume past the ramp this plan
 *   was authored against", which is the right question for a mutation, and it
 *   costs no extra query. A fresh trailing-average read would ask a different
 *   question (has the runner's base moved since authoring) that belongs to
 *   re-authoring, not to a single edit.
 *
 * ─── CONTEXT RECONSTRUCTION ──────────────────────────────────────────────────
 *
 * The validator needs runner context the plan rows do not carry. Sources:
 *
 *   raceDistanceMi   authored_state.race_distance_mi → authored_state
 *                    .goal_distance_mi → the plan's own race-day row's
 *                    distance_mi. Unresolvable → `contextIncomplete`, recorded.
 *   mode             training_plans.mode → authored_state.mode → 'race-prep'.
 *   level            profile.experience_level.
 *   trainingDaysPerWeek  profile.weekly_frequency.
 *   isSteppingStoneToMarathon  authored_state.horizon_raise present.
 *   priorPlanPeakLongMi  null · see §2 above.
 *   trailingAvgWeeklyMi  null · see the §3 note above.
 *   recentWeeklyMi   authored_state.recent_avg_mpw.
 *   qualityStrandedByAvailability  false. This flag only ever RELAXES §5, and
 *                    under differential validation a plan whose quality was
 *                    stranded at authoring has no quality to lose, so its §5
 *                    findings appear identically on both sides of the diff and
 *                    read as pre-existing. Passing false is conservative and
 *                    cannot manufacture a rejection.
 *
 * ─── ADDING A NEW WRITER ─────────────────────────────────────────────────────
 *
 * Do not issue `INSERT/UPDATE/DELETE ... plan_workouts` directly. Put the
 * statement inside a `mutatePlan({ apply })` callback and declare what it
 * touches. `_mutation_boundary.test.ts` scans the source tree and fails the
 * build if a writer appears outside this door.
 */
import { pool } from '@/lib/db/pool';
import type { PoolClient } from 'pg';
import { validateComposedPlan, PlanValidationError } from './validate';
import type { ComposePlanResult, ComposedWeek, DayPlan } from './generate';
import type { PlanMode } from './goal-tiers';
import type { PlanPrescription } from './plan-delta';

// ── row shapes ────────────────────────────────────────────────────────────────

export interface PlanPhaseRow {
  id: string;
  label: string;
  start_week_idx: number;
  end_week_idx: number;
  rationale: string | null;
  citation: string | null;
}

export interface PlanWeekRow {
  id: string;
  week_idx: number;
  week_start_iso: string;
  phase_id: string | null;
  is_race_week: boolean;
  is_cutback: boolean | null;
}

export interface PlanWorkoutRow {
  id: string;
  week_id: string | null;
  date_iso: string;
  dow: number;
  type: string;
  distance_mi: number | null;
  is_quality: boolean | null;
  is_long: boolean | null;
  sub_label: string | null;
  notes: string | null;
}

/** Everything the validator can be run against, straight off the three tables. */
export interface PlanSnapshot {
  planId: string;
  phases: PlanPhaseRow[];
  weeks: PlanWeekRow[];
  workouts: PlanWorkoutRow[];
}

// ── rehydration (PURE) ────────────────────────────────────────────────────────

/**
 * Rebuild the in-memory `ComposePlanResult` the validator consumes from the
 * persisted rows.
 *
 * The one number that has to be derived rather than read is `weeklyMi`, and it
 * is derived by the SAME formula `finalizeComposedPlan`'s VOL-1 reconcile uses
 * (generate.ts): the realized day-sum, with the race itself excluded on the
 * race week. Getting this wrong in either direction would move the taper-depth
 * and week-over-week checks off their author-time meaning, so it is copied
 * deliberately rather than reinvented.
 *
 * `vols` is set equal to `weeklyMi` — see the §0 note in the file header.
 * `authoredState` is `{}`; the validator never reads it.
 */
export function rehydratePlan(snap: PlanSnapshot): ComposePlanResult {
  const phaseLabel = new Map<string, string>();
  for (const p of snap.phases) phaseLabel.set(p.id, p.label);

  const byWeek = new Map<string, PlanWorkoutRow[]>();
  for (const w of snap.workouts) {
    const key = w.week_id ?? '';
    const list = byWeek.get(key);
    if (list) list.push(w);
    else byWeek.set(key, [w]);
  }

  const orderedWeeks = [...snap.weeks].sort((a, b) => a.week_idx - b.week_idx);

  const weeks: ComposedWeek[] = orderedWeeks.map((wk) => {
    const rows = byWeek.get(wk.id) ?? [];
    const days: DayPlan[] = rows
      .slice()
      .sort((a, b) => (a.date_iso < b.date_iso ? -1 : a.date_iso > b.date_iso ? 1 : 0))
      .map((r) => ({
        dow: Number(r.dow) as DayPlan['dow'],
        // The persisted `type` column is wider than the composer's union — the
        // adapter can write 'recovery', legacy rows can carry 'cross'. The
        // validator only ever compares it against string literals and feeds it
        // to reqGap(), both of which are total over any string, so the widened
        // value is carried through rather than coerced into a lie.
        type: String(r.type) as DayPlan['type'],
        distanceMi: r.distance_mi != null ? Number(r.distance_mi) : 0,
        isQuality: r.is_quality === true,
        isLong: r.is_long === true,
        subLabel: r.sub_label,
        notes: r.notes ?? '',
      }));
    // VOL-1 (generate.ts) · realized day-sum, race excluded on the race week.
    const weeklyMi = Math.round(
      days.reduce(
        (s, d) => s + ((d.type !== 'race' || !wk.is_race_week) ? d.distanceMi : 0),
        0,
      ) * 10,
    ) / 10;
    return {
      startISO: wk.week_start_iso,
      phase: wk.phase_id != null ? (phaseLabel.get(wk.phase_id) ?? 'BASE') : 'BASE',
      weeklyMi,
      days,
      isRaceWeek: wk.is_race_week === true,
      isCutback: wk.is_cutback === true,
    };
  });

  const phases = [...snap.phases]
    .sort((a, b) => a.start_week_idx - b.start_week_idx)
    .map((p) => ({
      label: p.label,
      weeks: Math.max(0, Number(p.end_week_idx) - Number(p.start_week_idx) + 1),
      rationale: p.rationale ?? '',
      citation: p.citation ?? '',
    }));

  return {
    weeks,
    blocks: { totalWeeks: weeks.length, phases },
    totalWeeks: weeks.length,
    vols: weeks.map((w) => w.weeklyMi),
    authoredState: {},
  };
}

/**
 * The fields any invariant can read, as a stable string. Used to PROVE a
 * `'derivations'` declaration instead of trusting it.
 *
 * Deliberately excludes pace_target_s_per_mi / workout_spec / sub_label /
 * notes — those are exactly the fields a derivations-only writer is allowed to
 * move, and no check in validate.ts reads any of them.
 */
export function structuralFingerprint(snap: PlanSnapshot): string {
  const weeks = [...snap.weeks]
    .sort((a, b) => a.week_idx - b.week_idx)
    .map((w) => `${w.week_idx}|${w.week_start_iso}|${w.phase_id ?? ''}|${w.is_race_week ? 1 : 0}|${w.is_cutback ? 1 : 0}`)
    .join('\n');
  const wkos = [...snap.workouts]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((w) =>
      `${w.id}|${w.week_id ?? ''}|${w.date_iso}|${w.dow}|${w.type}|` +
      `${w.distance_mi != null ? Number(w.distance_mi).toFixed(2) : 'null'}|` +
      `${w.is_quality ? 1 : 0}|${w.is_long ? 1 : 0}`,
    )
    .join('\n');
  const phases = [...snap.phases]
    .sort((a, b) => a.start_week_idx - b.start_week_idx)
    .map((p) => `${p.label}|${p.start_week_idx}|${p.end_week_idx}`)
    .join('\n');
  return `PHASES\n${phases}\nWEEKS\n${weeks}\nWORKOUTS\n${wkos}`;
}

// ── validation (PURE) ─────────────────────────────────────────────────────────

/** The runner + plan context the validator needs, reconstructed post-hoc. */
export interface PlanMutationContext {
  raceDistanceMi: number;
  mode: PlanMode;
  level: 'beginner' | 'intermediate' | 'advanced' | 'advanced_plus' | null;
  isSteppingStoneToMarathon: boolean;
  todayISO: string;
  trainingDaysPerWeek: number | null;
  recentWeeklyMi: number | null;
  /** True when raceDistanceMi could not be resolved from persisted state and a
   *  fallback was used. Recorded on every rejection so a validation run made
   *  against a guessed distance is never mistaken for one made against a known
   *  one. */
  contextIncomplete: boolean;
}

/**
 * Run the real validator over a rehydrated snapshot and return its violation
 * strings. Never throws: a `PlanValidationError` is the expected outcome and
 * its `violations` array is the return value.
 *
 * Anything OTHER than a PlanValidationError is re-thrown — a crash inside the
 * validator is a bug in the validator, not a verdict on the plan, and
 * swallowing it would turn a broken gate into a silently open one.
 */
export function violationsOf(snap: PlanSnapshot, ctx: PlanMutationContext): string[] {
  const plan = rehydratePlan(snap);
  if (plan.weeks.length === 0) return [];
  try {
    validateComposedPlan(plan, ctx.raceDistanceMi, ctx.mode, {
      level: ctx.level,
      isSteppingStoneToMarathon: ctx.isSteppingStoneToMarathon,
      // §2 · not applicable to an in-place mutation. See the file header.
      priorPlanPeakLongMi: null,
      todayISO: ctx.todayISO,
      // §3 · the ramp base is the plan's own authoring base, not a fresh
      // trailing average. See the file header's note on §3.
      trailingAvgWeeklyMi: null,
      trainingDaysPerWeek: ctx.trainingDaysPerWeek,
      qualityStrandedByAvailability: false,
      recentWeeklyMi: ctx.recentWeeklyMi,
    });
    return [];
  } catch (e) {
    if (e instanceof PlanValidationError) return e.violations;
    throw e;
  }
}

export interface ViolationDiff {
  /** Present after, absent before. These are what a mutation is rejected for. */
  introduced: string[];
  /** Present on both sides. Reported, never blocking. */
  preExisting: string[];
  /** Present before, absent after. A mutation that repairs doctrine. */
  resolved: string[];
}

/**
 * Set-difference on violation strings.
 *
 * String identity is the right key here and not a shortcut: every violation
 * message in validate.ts embeds the week's `startISO` (or the week index) plus
 * the offending numbers, so "week 2026-09-07 has no quality" and "week
 * 2026-09-14 has no quality" are distinct entries, and the SAME defect on the
 * SAME week produces a byte-identical string on both sides of the diff. A
 * violation whose NUMBERS changed (a taper that was 22% shallow and is now 31%
 * shallow) reads as introduced, which is the correct verdict — the mutation
 * made an existing problem worse.
 */
export function diffViolations(before: string[], after: string[]): ViolationDiff {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    introduced: after.filter((v) => !beforeSet.has(v)),
    preExisting: after.filter((v) => beforeSet.has(v)),
    resolved: before.filter((v) => !afterSet.has(v)),
  };
}

// ── DB shell ──────────────────────────────────────────────────────────────────

type Queryable = { query: PoolClient['query'] };

const SNAPSHOT_EMPTY: Omit<PlanSnapshot, 'planId'> = { phases: [], weeks: [], workouts: [] };

/** Three SELECTs. Called twice per mutation batch. */
export async function snapshotPlan(tx: Queryable, planId: string): Promise<PlanSnapshot> {
  const [phases, weeks, workouts] = await Promise.all([
    tx.query<PlanPhaseRow>(
      `SELECT id::text AS id, label, start_week_idx, end_week_idx, rationale, citation
         FROM plan_phases WHERE plan_id = $1 ORDER BY start_week_idx ASC`,
      [planId],
    ),
    tx.query<PlanWeekRow>(
      `SELECT id::text AS id, week_idx, week_start_iso::text AS week_start_iso,
              phase_id::text AS phase_id, is_race_week, is_cutback
         FROM plan_weeks WHERE plan_id = $1 ORDER BY week_idx ASC`,
      [planId],
    ),
    tx.query<PlanWorkoutRow>(
      `SELECT id::text AS id, week_id::text AS week_id, date_iso::text AS date_iso,
              dow, type, distance_mi::float8 AS distance_mi,
              is_quality, is_long, sub_label, notes
         FROM plan_workouts WHERE plan_id = $1`,
      [planId],
    ),
  ]);
  return {
    planId,
    phases: phases.rows,
    weeks: weeks.rows,
    workouts: workouts.rows,
  };
}

/**
 * 2026-08-25 · THE SAME THREE TABLES, READ FOR A DIFFERENT QUESTION.
 *
 * `snapshotPlan` above serves the VALIDATOR, so it selects the fields
 * `validateComposedPlan` reads and no others. `snapshotPrescription` serves the
 * question "did this rebuild change anything the runner would notice", which
 * needs a wider set: `pace_target_s_per_mi` and `workout_spec` are not read by
 * any invariant, and are exactly what a re-anchor moves.
 *
 * Kept as a second reader rather than a widening of `snapshotPlan` on purpose.
 * `structuralFingerprint` is built from that snapshot and is load-bearing for
 * the `derivations` declaration proof — it must NOT start seeing pace and spec,
 * or a legitimate derivations-only write would begin rolling itself back.
 *
 * The block-level fields (mode, race, goal date) come off `training_plans`, so
 * a rebuild that re-points at a different race is never mistaken for a no-op
 * even when it lands the same days. That is the `race_graduate` case.
 */
export async function snapshotPrescription(
  tx: Queryable,
  planId: string,
): Promise<PlanPrescription> {
  const [planRes, weekRes, dayRes] = await Promise.all([
    tx.query<{ mode: string | null; race_id: string | null; goal_iso: string | null }>(
      `SELECT mode, race_id, goal_iso::text AS goal_iso
         FROM training_plans WHERE id = $1 LIMIT 1`,
      [planId],
    ),
    tx.query<{ week_start_iso: string; label: string | null; is_race_week: boolean | null; is_cutback: boolean | null }>(
      `SELECT w.week_start_iso::text AS week_start_iso, p.label,
              w.is_race_week, w.is_cutback
         FROM plan_weeks w
         LEFT JOIN plan_phases p ON p.id = w.phase_id
        WHERE w.plan_id = $1
        ORDER BY w.week_idx ASC`,
      [planId],
    ),
    tx.query<{
      date_iso: string; type: string; distance_mi: string | null;
      pace_target_s_per_mi: string | null; sub_label: string | null;
      workout_spec: unknown; is_quality: boolean | null; is_long: boolean | null;
      notes: string | null;
    }>(
      `SELECT date_iso::text AS date_iso, type, distance_mi::text AS distance_mi,
              pace_target_s_per_mi::text AS pace_target_s_per_mi, sub_label,
              workout_spec, is_quality, is_long, notes
         FROM plan_workouts WHERE plan_id = $1`,
      [planId],
    ),
  ]);

  const plan = planRes.rows[0];
  return {
    planId,
    mode: plan?.mode ?? null,
    raceId: plan?.race_id ?? null,
    goalISO: plan?.goal_iso ? String(plan.goal_iso).slice(0, 10) : null,
    weeks: weekRes.rows.map((w) => ({
      startISO: String(w.week_start_iso).slice(0, 10),
      phase: w.label ?? '',
      isRaceWeek: w.is_race_week === true,
      isCutback: w.is_cutback === true,
    })),
    days: dayRes.rows.map((d) => ({
      dateISO: String(d.date_iso).slice(0, 10),
      type: String(d.type),
      distanceMi: d.distance_mi != null ? Number(d.distance_mi) : null,
      paceTargetSPerMi: d.pace_target_s_per_mi != null ? Number(d.pace_target_s_per_mi) : null,
      subLabel: d.sub_label,
      workoutSpec: d.workout_spec ?? null,
      isQuality: d.is_quality === true,
      isLong: d.is_long === true,
      notes: d.notes,
    })),
  };
}

/**
 * The runner's single active plan, as a prescription, or NULL.
 *
 * NULL is returned for "no active plan" AND for "more than one active plan".
 * The second is supposed to be impossible — `training_plans_active_uq`
 * (migration 142) is a unique partial index on `(user_uuid) WHERE archived_iso
 * IS NULL` — but the no-op gate's action is to ROLL A REBUILD BACK, and rolling
 * back on a match with one of two active plans would leave the other one
 * standing. When the invariant this depends on is not holding, the gate
 * declines to act rather than acting on half a picture.
 */
export async function snapshotActivePrescription(
  tx: Queryable,
  userUuid: string,
): Promise<PlanPrescription | null> {
  const rows = (await tx.query<{ id: string }>(
    `SELECT id::text AS id FROM training_plans
      WHERE user_uuid = $1::uuid AND archived_iso IS NULL`,
    [userUuid],
  )).rows;
  if (rows.length !== 1) return null;
  return snapshotPrescription(tx, rows[0].id);
}

interface PlanContextRow {
  mode: string | null;
  authored_state: Record<string, unknown> | null;
  race_distance_mi: number | null;
}

/**
 * One query set, once per mutation batch, to reconstruct what the validator
 * needs and the rows do not carry. See "CONTEXT RECONSTRUCTION" in the header.
 */
export async function loadMutationContext(
  tx: Queryable,
  userUuid: string,
  planId: string,
  todayISO: string,
): Promise<PlanMutationContext> {
  const [planRes, profRes] = await Promise.all([
    tx.query<PlanContextRow>(
      `SELECT tp.mode,
              tp.authored_state,
              (SELECT MAX(pw.distance_mi)::float8 FROM plan_workouts pw
                WHERE pw.plan_id = tp.id AND pw.type = 'race') AS race_distance_mi
         FROM training_plans tp WHERE tp.id = $1 LIMIT 1`,
      [planId],
    ).catch(() => ({ rows: [] as PlanContextRow[] })),
    tx.query<{ experience_level: string | null; weekly_frequency: number | null }>(
      `SELECT experience_level, weekly_frequency FROM profile
        WHERE user_uuid = $1::uuid LIMIT 1`,
      [userUuid],
    ).catch(() => ({ rows: [] as Array<{ experience_level: string | null; weekly_frequency: number | null }> })),
  ]);

  const plan = planRes.rows[0];
  const st = (plan?.authored_state ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const resolvedDistance =
    num(st.race_distance_mi) ?? num(st.goal_distance_mi) ?? num(plan?.race_distance_mi);

  const rawMode = (plan?.mode ?? st.mode ?? 'race-prep') as string;
  const mode: PlanMode =
    rawMode === 'maintenance' || rawMode === 'recovery' ? rawMode : 'race-prep';

  const lvl = profRes.rows[0]?.experience_level ?? null;
  const level =
    lvl === 'beginner' || lvl === 'intermediate' || lvl === 'advanced' || lvl === 'advanced_plus'
      ? lvl
      : null;

  const freq = profRes.rows[0]?.weekly_frequency;

  return {
    // 26.2 is the fallback only when nothing at all resolves. It is the most
    // PERMISSIVE distance row in CONSTRAINTS for the long-run cap, so a guessed
    // context leans toward letting a mutation through rather than blocking one
    // on a number we do not actually know. `contextIncomplete` says so out loud.
    raceDistanceMi: resolvedDistance ?? 26.2,
    contextIncomplete: resolvedDistance == null,
    mode,
    level,
    isSteppingStoneToMarathon: st.horizon_raise != null,
    todayISO,
    trainingDaysPerWeek: freq != null ? Number(freq) : null,
    recentWeeklyMi: num(st.recent_avg_mpw) ?? num((st.derived_from as Record<string, unknown> | undefined)?.recentWeeklyMi),
  };
}

// ── the door ──────────────────────────────────────────────────────────────────

export type MutationTouch = 'structural' | 'derivations' | 'authorship';

export type MutationOutcome =
  | 'applied'
  | 'rejected'
  | 'undeclared_structural'
  | 'bypassed'
  | 'authorship_drift'
  | 'no_plan';

export interface MutatePlanOptions<T> {
  /** Owning runner. Used for context + the rejection record. */
  userUuid: string;
  /** Named write site, e.g. `adapt/apply`, `api/plan/workout PATCH`. Appears
   *  verbatim in the rejection record and the log line. */
  source: string;
  /** Runner-local today (YYYY-MM-DD). The validator skips sealed past weeks
   *  against it, so a wrong value here would re-litigate history. */
  todayISO: string;
  /** The plan being mutated. Omit only when `planIdFromResult` supplies it. */
  planId?: string | null;
  /** Resolve the plan from a workout id when the caller only has that. */
  workoutId?: string | null;
  /** Creation path only: the plan id is not known until `apply` has run. */
  planIdFromResult?: (value: T) => string | null | undefined;
  /** What the mutation is allowed to change. Default 'structural'. */
  touches?: MutationTouch;
  /**
   * THE ESCAPE HATCH, and the only one. Skips validation entirely, records
   * outcome `bypassed` with this reason, and logs it. An unmarked bypass is
   * how this whole problem started; a marked one is a decision with a name on
   * it. Currently used by exactly one caller — see
   * `app/api/admin/backfill-workout-spec/route.ts`.
   */
  bypass?: { reason: string };
  /** Extra context stored on the rejection record. */
  detail?: Record<string, unknown>;
  /** The writes. Runs inside the boundary's transaction; must not BEGIN,
   *  COMMIT or ROLLBACK. */
  apply: (tx: PoolClient, planId: string) => Promise<T>;
}

export interface MutatePlanResult<T> {
  ok: boolean;
  outcome: MutationOutcome;
  value: T | null;
  /** Violations this mutation INTRODUCED. Empty on success. */
  violations: string[];
  /** Violations the plan already carried. Reported on success too. */
  preExisting: string[];
  /** Violations this mutation REPAIRED. */
  resolved: string[];
  planId: string | null;
}

/**
 * Route a plan mutation through the boundary.
 *
 * Never throws for a validation verdict — a rejection is a returned value, so
 * a per-user cron loop keeps going. Errors thrown by `apply` itself DO
 * propagate (after rollback), because a failing statement is a caller bug and
 * must not be mistaken for a doctrine rejection.
 */
export async function mutatePlan<T>(opts: MutatePlanOptions<T>): Promise<MutatePlanResult<T>> {
  const touches = opts.touches ?? 'structural';
  const client = await pool.connect();
  let releaseErr: Error | undefined;

  /**
   * PLANVERSION-1 (2026-09-03) · this is the ONE place `last_adapted_at`
   * gets stamped for an in-place mutation, so no future writer can alter
   * `plan_workouts` / `training_plans.authored_state` through this boundary
   * without moving the version signal the client caches against.
   *
   * Found the hard way: `reanchor-plan.ts` (the daily `snapshot-projections`
   * cron's own re-anchor, and the `race-authority` fallback) rewrites
   * `pace_target_s_per_mi` and `authored_state` through `bypass`/`derivations`
   * on this exact boundary, and neither path stamped the plan — a runner's
   * prescribed paces could move with `planVersion` never noticing, so a
   * cached client day would never invalidate. `check-planversion-ratchet.sh`
   * is the gate this closes; see that script's header for the registry it
   * verifies against.
   *
   * Deliberately excluded: `touches === 'authorship'` (a brand-new
   * `training_plans` row — its `id` already differs, so `planVersion` moves
   * without this) and the no-plan-id short-circuit at step 5 below (nothing
   * was written). Every other exit that COMMITs a write to an EXISTING plan
   * goes through this.
   */
  const stampAdapted = async (planIdToStamp: string | null) => {
    if (!planIdToStamp) return;
    await client.query(
      `UPDATE training_plans SET last_adapted_at = NOW() WHERE id = $1`,
      [planIdToStamp],
    );
  };

  const fail = (outcome: MutationOutcome, violations: string[], preExisting: string[], planId: string | null): MutatePlanResult<T> => ({
    ok: false, outcome, value: null, violations, preExisting, resolved: [], planId,
  });

  try {
    await client.query('BEGIN');

    // 1 · resolve the plan.
    let planId = opts.planId ?? null;
    if (!planId && opts.workoutId) {
      planId = (await client.query<{ plan_id: string }>(
        `SELECT plan_id::text AS plan_id FROM plan_workouts WHERE id = $1 LIMIT 1`,
        [opts.workoutId],
      )).rows[0]?.plan_id ?? null;
    }
    if (!planId && touches !== 'authorship') {
      planId = (await client.query<{ id: string }>(
        `SELECT id::text AS id FROM training_plans
          WHERE user_uuid = $1::uuid AND archived_iso IS NULL
          ORDER BY authored_iso DESC LIMIT 1`,
        [opts.userUuid],
      ).catch(() => ({ rows: [] as Array<{ id: string }> }))).rows[0]?.id ?? null;
    }

    // 2 · the marked bypass. Runs the writes, records the decision, commits.
    if (opts.bypass) {
      const value = await opts.apply(client, planId ?? '');
      if (touches !== 'authorship') await stampAdapted(planId);
      await client.query('COMMIT');
      console.warn(
        `[plan/mutate] BYPASS · source=${opts.source} plan=${planId ?? 'none'} · ${opts.bypass.reason}`,
      );
      await recordMutationOutcome({
        userUuid: opts.userUuid, planId, source: opts.source,
        outcome: 'bypassed', violations: [], preExisting: [],
        detail: { ...(opts.detail ?? {}), bypass_reason: opts.bypass.reason },
      });
      return { ok: true, outcome: 'bypassed', value, violations: [], preExisting: [], resolved: [], planId };
    }

    // 3 · no plan to validate against. The writes are still refused rather
    //     than waved through — a plan_workouts write with no resolvable owning
    //     plan is exactly the shape this boundary exists to make visible.
    if (!planId && touches !== 'authorship') {
      await client.query('ROLLBACK');
      console.error(`[plan/mutate] NO PLAN · source=${opts.source} user=${opts.userUuid.slice(0, 8)}`);
      await recordMutationOutcome({
        userUuid: opts.userUuid, planId: null, source: opts.source,
        outcome: 'no_plan', violations: ['no active plan resolved for this mutation'],
        preExisting: [], detail: opts.detail ?? null,
      });
      return fail('no_plan', ['no active plan resolved for this mutation'], [], null);
    }

    // 4 · before-snapshot + context (skipped for authorship: there is nothing
    //     to compare a brand-new plan against).
    let before: PlanSnapshot = { planId: planId ?? '', ...SNAPSHOT_EMPTY };
    let ctx: PlanMutationContext | null = null;
    if (touches !== 'authorship' && planId) {
      before = await snapshotPlan(client, planId);
      if (touches === 'structural') {
        ctx = await loadMutationContext(client, opts.userUuid, planId, opts.todayISO);
      }
    }

    // 5 · the writes.
    const value = await opts.apply(client, planId ?? '');

    const afterPlanId =
      (opts.planIdFromResult ? opts.planIdFromResult(value) : null) ?? planId ?? null;
    if (!afterPlanId) {
      // Authorship that produced no plan id — nothing was created. Commit
      // whatever ran (typically a no-op) and say so.
      await client.query('COMMIT');
      return { ok: true, outcome: 'applied', value, violations: [], preExisting: [], resolved: [], planId: null };
    }

    // 6 · after-snapshot + verdict.
    const after = await snapshotPlan(client, afterPlanId);

    if (touches === 'derivations') {
      // Prove the declaration rather than trusting it.
      if (structuralFingerprint(before) !== structuralFingerprint(after)) {
        await client.query('ROLLBACK');
        const v = [
          'mutation declared `derivations` but changed structural fields ' +
          '(one of: date_iso, dow, type, distance_mi, is_quality, is_long, or the row set)',
        ];
        console.error(`[plan/mutate] UNDECLARED STRUCTURAL · source=${opts.source} plan=${afterPlanId}`);
        await recordMutationOutcome({
          userUuid: opts.userUuid, planId: afterPlanId, source: opts.source,
          outcome: 'undeclared_structural', violations: v, preExisting: [],
          detail: opts.detail ?? null,
        });
        return fail('undeclared_structural', v, [], afterPlanId);
      }
      await stampAdapted(afterPlanId);
      await client.query('COMMIT');
      return { ok: true, outcome: 'applied', value, violations: [], preExisting: [], resolved: [], planId: afterPlanId };
    }

    if (touches === 'authorship') {
      // REPORT ONLY. Never rolls back — see DESIGN DECISION 2.
      //
      // The snapshot and the context are read on the transaction (so they see
      // one consistent view of what was just written), but the VALIDATION runs
      // after COMMIT and inside a try. Report-only has to mean report-only: a
      // crash in the validator must not be able to take a runner's plan
      // generation down with it. The pre-persist `validateComposedPlan` is
      // still the gate that decides whether a plan is authored at all.
      const authorCtx = await loadMutationContext(client, opts.userUuid, afterPlanId, opts.todayISO);
      await client.query('COMMIT');
      let drift: string[] = [];
      try {
        drift = violationsOf(after, authorCtx);
      } catch (e) {
        console.error(
          `[plan/mutate] authorship read-back check errored (plan committed regardless) · ` +
          `source=${opts.source} ·`,
          e instanceof Error ? e.message : e,
        );
      }
      if (drift.length > 0) {
        console.warn(
          `[plan/mutate] AUTHORSHIP DRIFT · source=${opts.source} plan=${afterPlanId} · ` +
          `${drift.length} violation(s) present in the PERSISTED plan that the in-memory ` +
          `validation did not see · committed (a rolled-back rebuild leaves the runner with no plan)`,
        );
        await recordMutationOutcome({
          userUuid: opts.userUuid, planId: afterPlanId, source: opts.source,
          outcome: 'authorship_drift', violations: drift, preExisting: [],
          detail: { ...(opts.detail ?? {}), context_incomplete: authorCtx.contextIncomplete },
        });
      }
      return {
        ok: true, outcome: drift.length > 0 ? 'authorship_drift' : 'applied',
        value, violations: [], preExisting: drift, resolved: [], planId: afterPlanId,
      };
    }

    // structural · the differential verdict.
    const useCtx = ctx ?? await loadMutationContext(client, opts.userUuid, afterPlanId, opts.todayISO);
    const beforeV = violationsOf(before, useCtx);
    const afterV = violationsOf(after, useCtx);
    const diff = diffViolations(beforeV, afterV);

    if (diff.introduced.length > 0) {
      await client.query('ROLLBACK');
      console.error(
        `[plan/mutate] REJECTED · source=${opts.source} plan=${afterPlanId} · ` +
        `${diff.introduced.length} introduced violation(s):\n` +
        diff.introduced.map((v) => `  · ${v}`).join('\n'),
      );
      await recordMutationOutcome({
        userUuid: opts.userUuid, planId: afterPlanId, source: opts.source,
        outcome: 'rejected', violations: diff.introduced, preExisting: diff.preExisting,
        detail: { ...(opts.detail ?? {}), context_incomplete: useCtx.contextIncomplete },
      });
      return fail('rejected', diff.introduced, diff.preExisting, afterPlanId);
    }

    await stampAdapted(afterPlanId);
    await client.query('COMMIT');
    return {
      ok: true, outcome: 'applied', value,
      violations: [], preExisting: diff.preExisting, resolved: diff.resolved,
      planId: afterPlanId,
    };
  } catch (e) {
    try { await client.query('ROLLBACK'); }
    catch (rbErr) { releaseErr = rbErr instanceof Error ? rbErr : new Error(String(rbErr)); }
    throw e;
  } finally {
    client.release(releaseErr);
  }
}

// ── the record ────────────────────────────────────────────────────────────────

/**
 * Land the outcome on a SEPARATE connection — the mutation's own transaction
 * has been rolled back by the time this runs, so writing it there would erase
 * the very record of the rejection.
 *
 * Fails soft. If migration 150 has not been applied the boundary must still
 * work; the console line is the fallback record. The gate is the rollback, not
 * the audit row.
 */
export async function recordMutationOutcome(rec: {
  userUuid: string;
  planId: string | null;
  source: string;
  outcome: MutationOutcome;
  violations: string[];
  preExisting: string[];
  detail?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO plan_mutation_rejections
         (user_uuid, plan_id, source, outcome, violations, pre_existing, detail)
       VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)`,
      [
        rec.userUuid,
        rec.planId,
        rec.source,
        rec.outcome,
        JSON.stringify(rec.violations),
        JSON.stringify(rec.preExisting),
        rec.detail ? JSON.stringify(rec.detail) : null,
      ],
    );
  } catch (e) {
    console.error(
      `[plan/mutate] could not record outcome (${rec.outcome}, source=${rec.source}) · ` +
      `is db/migrations/150_plan_mutation_rejections.sql applied? ·`,
      e instanceof Error ? e.message : e,
    );
  }
}
