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
 * ─── LEDGER-1 (2026-09-05) · EVERY EXIT LANDS IN THE DECISION LEDGER ────────
 *
 * `plan_mutation_rejections` (migration 150) records what this boundary
 * REFUSED. It has never recorded what it PERMITTED. So the audit surface in
 * front of the only door into `plan_workouts` could answer "what did we stop"
 * and could not answer "what did we do" — which is CLAUDE.md Rule 21's
 * question, and the reason its census of 309 production intents had to be
 * reconstructed sideways out of `coach_intents`.
 *
 * Every exit of this function ATTEMPTS a `plan_decision_ledger` (migration 166)
 * write: the successes, the rejections, the bypass, the no-plan refusal, the
 * authority refusal that throws before a connection is opened, and the crash.
 * `scripts/check-decision-ledger.sh` guard 1 walks the exits and fails when one
 * of them does not.
 *
 * STATUSWORDS-1 (2026-09-05) · this paragraph used to say the ledger "is now
 * written on every exit". It is not, and saying so conflated BUILT with
 * DEPLOYED (Rule 19). Migration 166 IS NOT APPLIED TO PRODUCTION — deliberately;
 * DDL needs the owner's per-statement go — so on the live database every one of
 * those exits currently resolves to `state: 'table_absent'` and a
 * `DECISION NOT RECORDED` line on stderr. `decision-ledger.ts` says this
 * correctly in its own header and this file did not. What is true today: the
 * code path is complete and gated; the rows do not exist yet.
 *
 * Two properties are worth naming because they are what make it a ledger:
 *
 *   · DIRECTION IS MEASURED, NEVER DECLARED. No caller supplies it. It is
 *     computed from the before/after snapshots this boundary already holds, on
 *     prescribed distance and prescribed pace — the two axes the mission
 *     statement names. `lib/brain/ledger/ledger-entry.ts` is where, and its own
 *     header explains why declaring it is the failure mode.
 *   · IT SURVIVES A REBUILD. `plan_lineage_id` is carried from the plan being
 *     replaced onto the plan replacing it, which is why `replacedPlanId` is
 *     read BEFORE `apply` archives the outgoing plan rather than reconstructed
 *     afterwards.
 *
 * `training_plans.adaptation_log` is UNCHANGED and `applyAdaptations` keeps
 * appending to it — `docs/OVERNIGHT-REPORT.md` records consumers deriving
 * "last changed" as `max(adaptation_log.ts)`. What changes is its INTENDED
 * status: it is a per-plan convenience index and this table is MEANT to be the
 * record of truth, for the two reasons migration 166's header sets out (it
 * lives inside the thing a rebuild discards, and its only writer is the
 * nightly cron). Until 166 is applied, `adaptation_log` is still the only
 * durable record there is, and it is still emptied by every rebuild.
 *
 * ─── ADDING A NEW WRITER ─────────────────────────────────────────────────────
 *
 * Do not issue `INSERT/UPDATE/DELETE ... plan_workouts` directly. Put the
 * statement inside a `mutatePlan({ apply })` callback and declare what it
 * touches. `_mutation_boundary.test.ts` scans the source tree and fails the
 * build if a writer appears outside this door.
 */
import { mutationIsPermitted, type AuthorityClass } from '@/lib/brain/mutation/authority';
import {
  recordDecision,
  recordDecisionInTransaction,
  markUndoneInTransaction,
  resolvePlanLineage,
  type LedgerExecutor,
} from '@/lib/brain/ledger/decision-ledger';
import {
  demandDelta,
  directionOfDelta,
  leverOfDelta,
  scopeOfChange,
  PLAN_MUTATION_BOUNDARY_MODEL_VERSION,
  type LedgerDecision,
  type LedgerEntry,
  type LedgerRunnerResponse,
  type LedgerSourceMode,
} from '@/lib/brain/ledger/ledger-entry';
import { pool } from '@/lib/db/pool';
// CALLERHONESTY-1 / LINEAGEREAD-1 (2026-09-13) · `rowOrNull` is gone from this
// file. Every read here now branches on `attempt().ok` explicitly, because
// every one of them decides whether a write may commit or what gets written
// into the durable ledger, and `rowOrNull`'s `?? null` idiom re-collapses the
// two states it exists to keep apart the moment a caller reaches for it.
import { attempt } from '@/lib/db/read';
import type { PoolClient } from 'pg';
import { validateComposedPlan, PlanValidationError } from './validate';
import type { ComposePlanResult, ComposedWeek, DayPlan } from './generate';
import type { PlanMode } from './goal-tiers';
import type { PlanPrescription } from './plan-delta';
import { weekContainsRace } from './race-week';

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
  /**
   * LEDGER-1 (2026-09-05) · read by NOTHING in the validator, and deliberately
   * absent from `structuralFingerprint`. It exists so the boundary can measure
   * which way a `'derivations'` mutation moved the prescription — a re-anchor
   * moves every pace and no distance, and a direction read off distance alone
   * would call that NEUTRAL forever.
   *
   * Optional so every existing construction of this row shape still compiles;
   * `snapshotPlan` always populates it.
   */
  pace_target_s_per_mi?: number | null;
}

/** Everything the validator can be run against, straight off the three tables. */
export interface PlanSnapshot {
  planId: string;
  phases: PlanPhaseRow[];
  weeks: PlanWeekRow[];
  workouts: PlanWorkoutRow[];
  /**
   * AUTHOREDSTATE-READBACK-1 (2026-09-08) · the persisted
   * `training_plans.authored_state`, read back verbatim.
   *
   * Was absent from this snapshot entirely — `snapshotPlan` queried
   * `plan_phases`/`plan_weeks`/`plan_workouts` and nothing else, and
   * `rehydratePlan` handed the validator a hardcoded `{}`, on the header
   * claim "the validator never reads it." That claim was true once and
   * stopped being true when `validateComposedPlan` grew per-finding context
   * filters that DO read it — `embeddedRaces` (COMBINED-STRESS-1) and
   * `travelShaped` (TRAVEL-1) both read `result.authoredState` directly. A
   * stale, unenforced claim in a comment is exactly Rule 20's shape: nothing
   * gated it, so nobody noticed it went false.
   *
   * Consequence, measured on the runner's own real, currently-active plan:
   * `pln_7636bcc0a201bf2d`'s `authored_state.embedded_races` correctly
   * records "Run Malibu" (2026-11-08, B-effort half). Composing FRESH, the
   * validator reads that key, `weekFullyInsideRecoveryWindow` correctly
   * exempts the fully-consumed 2026-11-09 recovery week from §5, and the
   * plan authors clean. Read back through `violationsOf` (the
   * authorship-drift check `lib/plan/mutate.ts` runs after every mutation),
   * `authoredState` arrived as `{}`, `embeddedRaces` was empty,
   * `weekFullyInsideRecoveryWindow` returned false for every week, and §5
   * flagged "Week 2026-11-09 (RACE-SPECIFIC): no quality sessions
   * prescribed" — a real violation on the SAME plan the authoring-time
   * validator had just accepted as correct, five minutes apart, off the SAME
   * doctrine-cited exemption, because one caller could see its own inputs
   * and the other could not. Not a composer defect; a read-back one.
   */
  authoredState: Record<string, unknown>;
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
 * `authoredState` is `snap.authoredState`, read back verbatim from
 * `training_plans.authored_state` (AUTHOREDSTATE-READBACK-1) — see
 * `PlanSnapshot.authoredState`'s own doc comment for why this stopped being
 * safe to hardcode to `{}` once the validator grew per-finding context
 * filters (`embeddedRaces`, `travelShaped`) that read it directly.
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
    //
    // RACEPROT-VERIFY-1 (2026-09-09) · `wk.is_race_week` alone only marks the
    // GOAL race's week (race-week.ts's own header: "the column is not wrong"
    // — it just answers a narrower question than this reducer needs). A B/C
    // tune-up's week reads `is_race_week = false`, so its race day's distance
    // was counting into `weeklyMi` on every mutation-time check that reads
    // this snapshot, while the goal race's already excluded correctly.
    // `weekContainsRace` (race-week.ts) is the same day-level detector
    // `dose-guard.ts` already uses for this exact gap — one predicate, not a
    // second inline copy of it (Rule 16).
    const weekHasRace = weekContainsRace({ isRaceWeek: wk.is_race_week, days });
    const weeklyMi = Math.round(
      days.reduce(
        (s, d) => s + ((d.type !== 'race' || !weekHasRace) ? d.distanceMi : 0),
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
    authoredState: snap.authoredState,
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

/**
 * CONTEXTREAD-1 (2026-09-13) · WHICH OF THIS CONTEXT'S OWN READS FAILED.
 *
 * Not the same question as `contextIncomplete`, and that is the whole reason
 * it is a second field rather than a widened first one (Rule 16). Both flags
 * can be true at once and they mean opposite things about how much to trust
 * the numbers around them:
 *
 *   · `contextIncomplete` — the reads SUCCEEDED and the race distance was not
 *     recorded anywhere. A measured absence. `26.2` was substituted.
 *   · `readFailed`        — the read THREW. NOTHING about the runner was
 *     established at all, so every value the validator is about to be handed
 *     is a guess, and this boundary cannot say whether the doctrine check it
 *     is about to run is the one this runner's real context calls for.
 *
 * Rule 11 is the whole ground: "don't know", "measured zero" and "the read
 * failed" are three facts, and a mutation graded against a context that was
 * never read has not been safety-checked. That is sufficient on its own and
 * this comment deliberately does not lean on more. Before this, both reads
 * carried a bare `.catch(() => ({ rows: [] }))`, so a transient failure passed
 * unverified guesses into the very validation that decides whether a mutation
 * lands — and it did it without a log line, which `lib/db/read.ts`'s header
 * names as the floor no read may fall below.
 *
 * ── LEDGERHONESTY-1 (2026-09-13) · WHAT THE FALLBACKS ACTUALLY DO ───────────
 *
 * This block previously claimed `trainingDaysPerWeek: null` means "NO
 * frequency cap". That is FALSE, and it was written into
 * `plan_decision_ledger.explanation` and `plan_mutation_rejections.violations`
 * — durable records — which is the same defect class as the sentence
 * `mutation-refusal.ts` was written to kill. Traced against the validator:
 *
 *   · `trainingDaysPerWeek` has exactly ONE consumer in `validate.ts` (§5,
 *     the quality-coverage check). It SKIPS that check when the value is
 *     `<= 1`, because a one-day-a-week runner gets the long run and not a
 *     separate quality session. There is no frequency cap anywhere in the
 *     validator for a null to disable. A null makes §5 STRICTER, not looser:
 *     the skip does not fire.
 *   · `raceDistanceMi` falling back to 26.2 DOES loosen §1's long-run cap for
 *     every runner whose real race is shorter (5K 14 mi, 10K 17, HM 14/20/22,
 *     marathon 25). It is not the loosest row — ultra is 32 — so a real ultra
 *     runner gets a TIGHTER cap from the fallback than the truth.
 *   · `level: null` loosens §1 for a beginner half-marathoner: the cap reads
 *     20 mi where `'beginner'` would read 14. It does not loosen §3, whose
 *     `GENERAL_RAMP_CEILING[null ?? 'intermediate']` is 1.15 against a
 *     beginner's 1.20.
 *
 * So the fallbacks loosen SOME checks for SOME runners and tighten others.
 * Which is exactly why "the read failed, so this was not verified" is the
 * honest reason to refuse, and "a safety cap was disabled" is not.
 */
export interface MutationContextReadFailure {
  /** `training_plans` (mode, authored_state, race distance) could not be read. */
  plan: boolean;
  /** `profile` (experience level, weekly frequency) could not be read. */
  profile: boolean;
}

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
  /**
   * CONTEXTREAD-1 · PRESENT ONLY WHEN A READ THREW. Absent (undefined) is the
   * ordinary case and means both reads ran. Optional so every existing
   * hand-built fixture of this shape still compiles, and deliberately absent
   * rather than `{plan:false,profile:false}` so `if (ctx.readFailed)` is the
   * whole of the check at every call site.
   */
  readFailed?: MutationContextReadFailure;
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

const SNAPSHOT_EMPTY: Omit<PlanSnapshot, 'planId'> = {
  phases: [], weeks: [], workouts: [], authoredState: {},
};

/** Four SELECTs. Called twice per mutation batch. */
export async function snapshotPlan(tx: Queryable, planId: string): Promise<PlanSnapshot> {
  const [phases, weeks, workouts, plan] = await Promise.all([
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
              is_quality, is_long, sub_label, notes,
              pace_target_s_per_mi::float8 AS pace_target_s_per_mi
         FROM plan_workouts WHERE plan_id = $1`,
      [planId],
    ),
    // AUTHOREDSTATE-READBACK-1 · see the field's own doc comment on
    // `PlanSnapshot`. Without this, `weekFullyInsideRecoveryWindow` and
    // every other per-finding context filter that reads
    // `result.authoredState` is silently blind on every read-back check.
    tx.query<{ authored_state: Record<string, unknown> | null }>(
      `SELECT authored_state FROM training_plans WHERE id = $1`,
      [planId],
    ),
  ]);
  return {
    planId,
    phases: phases.rows,
    weeks: weeks.rows,
    workouts: workouts.rows,
    authoredState: plan.rows[0]?.authored_state ?? {},
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
 *
 * CONTEXTREAD-1 (2026-09-13) · CLAUDE.md Rule 11. Both queries below used to
 * carry a bare `.catch(() => ({ rows: [] }))`. Neither logged, which is the
 * one thing `lib/db/read.ts`'s header says no read may do ("a database call
 * may fail, but it may never fail invisibly"), and — worse — an empty row set
 * here is not a neutral value. It is a GUESS at the runner's context, and the
 * guess is what the doctrine check then grades the mutation against:
 * `raceDistanceMi` falls back to 26.2, `level` to null, `trainingDaysPerWeek`
 * to null. A thirty-second Postgres blip therefore decided whether a plan
 * mutation was allowed to commit, silently, off a context nobody had read.
 *
 * LEDGERHONESTY-1 (2026-09-13) · this passage used to say the fallbacks are
 * uniformly "the MOST PERMISSIVE possible validator input", that 26.2 is the
 * loosest long-run cap row, and that a null `trainingDaysPerWeek` is read as
 * "NO CAP AT ALL". None of the three survives contact with `validate.ts`:
 * ultra's cap is 32 mi and looser than 26.2's row, and `trainingDaysPerWeek`
 * has one consumer there which SKIPS §5's quality-coverage check at `<= 1`, so
 * a null makes that check fire rather than disabling it. The honest ground for
 * refusing is Rule 11 by itself — the read failed, so nothing was verified.
 * See `MutationContextReadFailure`'s header for the full trace.
 *
 * Both now go through `attempt()`, which logs on failure and makes the caller
 * branch. This function still RETURNS a context — it is called from three
 * places with three different correct postures, so choosing the posture is not
 * its job — but the context now carries `readFailed`, and `mutatePlan` refuses
 * a structural mutation outright when it is set. See step 4 there.
 */
export async function loadMutationContext(
  tx: Queryable,
  userUuid: string,
  planId: string,
  todayISO: string,
): Promise<PlanMutationContext> {
  const [planAttempt, profAttempt] = await Promise.all([
    attempt(
      'mutate/context-plan-row',
      tx.query<PlanContextRow>(
        `SELECT tp.mode,
                tp.authored_state,
                (SELECT MAX(pw.distance_mi)::float8 FROM plan_workouts pw
                  WHERE pw.plan_id = tp.id AND pw.type = 'race') AS race_distance_mi
           FROM training_plans tp WHERE tp.id = $1 LIMIT 1`,
        [planId],
      ),
    ),
    attempt(
      'mutate/context-profile-row',
      tx.query<{ experience_level: string | null; weekly_frequency: number | null }>(
        `SELECT experience_level, weekly_frequency FROM profile
          WHERE user_uuid = $1::uuid LIMIT 1`,
        [userUuid],
      ),
    ),
  ]);
  const planRes = planAttempt.ok ? planAttempt.value : { rows: [] as PlanContextRow[] };
  const profRes = profAttempt.ok
    ? profAttempt.value
    : { rows: [] as Array<{ experience_level: string | null; weekly_frequency: number | null }> };
  const readFailed: MutationContextReadFailure | undefined =
    planAttempt.ok && profAttempt.ok
      ? undefined
      : { plan: !planAttempt.ok, profile: !profAttempt.ok };

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
  // RUNFREQ-OWNER-1 (2026-09-07) · a null stated preference used to leave
  // trainingDaysPerWeek null here, so this context could not answer how many
  // days a week the runner takes and the value reached the validator as an
  // unknown. LEDGERHONESTY-1 (2026-09-13) corrects this comment's original
  // justification: it said `validateComposedPlan`'s "frequency cap" reads a
  // null as "no cap". There is no frequency cap in `validate.ts`. The one
  // consumer of this field there (§5) SKIPS the quality-coverage requirement
  // at `<= 1`, so a null makes that check STRICTER, not looser. The fallback
  // below is still right, for the reason that survives: this is the canonical
  // answer to "how many days a week is this runner absorbing" (Rule 16), and a
  // context that carries the measured number rather than an unknown is the one
  // every reader of it should get. Same Rule-8-filtered rank-3 read
  // `loadGeneratorInputs` uses at authoring time. Measured against
  // production: David's account (0645f40c-951d-4ccc-b86e-9979cd26c795) has
  // weekly_frequency = null and derivedTrainingDaysPerWeek = 6.
  // No .catch() here on purpose: derivedTrainingDaysPerWeek's only read goes
  // through rowOrNull, which never rejects (lib/db/read.ts#attempt catches
  // internally) — a wrapping .catch(() => null) would be a second, redundant
  // collapse site the coercion scan correctly flags.
  //
  // KNOWN GAP, NOT AN INVARIANT (round-6 review finding F3, 2026-09-13). This
  // is the ONE context read that does not feed `readFailed`. Inside
  // `derivedTrainingDaysPerWeek`, `rowOrNull` returns null on a failed read
  // and undefined on no rows, and the function collapses BOTH — plus a
  // genuine rank-3 of zero — into a single `null`. So a `runs` read that
  // threw is indistinguishable here from a runner with no measurable habit,
  // which is a Rule 11 collapse and is stated as such rather than papered
  // over. It is left open deliberately: splitting it means a new reading
  // shape on `generate.ts`'s authoring path and a POSTURE decision (refuse, or
  // proceed) that the LEDGERHONESTY-1 trace above materially changes — a null
  // here makes §5 STRICTER, so the substituted value is the safe one and
  // refusing on it is a judgment call, not an obvious fix. Whoever takes it
  // decides that first.
  const derivedFreq = freq == null
    ? await (await import('@/lib/plan/generate')).derivedTrainingDaysPerWeek(userUuid, todayISO)
    : null;

  return {
    // 26.2 is the fallback only when nothing at all resolves. Its long-run cap
    // row (25 mi) is looser than 5K's 14, 10K's 17 and every HM row, so a
    // guessed context leans toward letting a mutation through rather than
    // blocking one on a number we do not actually know. LEDGERHONESTY-1
    // (2026-09-13): it is NOT the loosest row overall — ultra is 32 mi — so
    // for a real ultra runner this guess is the tighter one. Either way the
    // cap being applied is not his, and `contextIncomplete` says so out loud.
    raceDistanceMi: resolvedDistance ?? 26.2,
    contextIncomplete: resolvedDistance == null,
    mode,
    level,
    isSteppingStoneToMarathon: st.horizon_raise != null,
    todayISO,
    trainingDaysPerWeek: freq != null ? Number(freq) : derivedFreq,
    recentWeeklyMi: num(st.recent_avg_mpw) ?? num((st.derived_from as Record<string, unknown> | undefined)?.recentWeeklyMi),
    // CONTEXTREAD-1 · spread so the key is genuinely ABSENT on the happy path
    // rather than present-and-false. `if (ctx.readFailed)` is then the whole
    // check, and a caller cannot half-read it.
    ...(readFailed ? { readFailed } : {}),
  };
}

// ── the door ──────────────────────────────────────────────────────────────────

export type MutationTouch = 'structural' | 'derivations' | 'authorship';

/**
 * CALLERHONESTY-1 (2026-09-13) · WHICH read failed, when the outcome is
 * `plan_verification_failed`. One outcome word, three named causes.
 *
 * Every one of these is a read this boundary must complete BEFORE it can let a
 * write commit, and every one of them used to answer a failure with a
 * plausible-looking empty result:
 *
 *   · `requested-plan-guard`  the caller named a plan_id and we could not
 *                             establish whether it is still active. Collapsing
 *                             this reported the plan as ARCHIVED (false).
 *   · `active-plan-fallback`  no plan_id was named and we could not establish
 *                             which plan is active. Collapsing this reported
 *                             `no_plan` — "this runner has no active plan" —
 *                             which is a specific, meaningful and in this case
 *                             completely fabricated claim.
 *   · `mutation-context`      the validator's own inputs could not be read, so
 *                             the doctrine check would have graded the
 *                             mutation against defaults nobody established.
 *                             Collapsing this did not produce a false
 *                             sentence; it produced a gate that RAN ANYWAY, on
 *                             a context that was never read, and reported the
 *                             result as a verdict.
 *
 * LEDGERHONESTY-1 (2026-09-13) · the third bullet used to say "maximally
 * permissive defaults" and "a SILENTLY WEAKER GATE". Half true at best: the
 * distance fallback does loosen §1 for every non-ultra runner, but a null
 * `trainingDaysPerWeek` makes §5 stricter and a null `level` leaves §3 where
 * it was. Rule 11 alone carries the refusal, and it does not need the
 * overstatement. `MutationContextReadFailure`'s header has the trace.
 */
export type PlanVerificationFailure =
  | 'requested-plan-guard'
  | 'active-plan-fallback'
  | 'mutation-context';

/** The sentence that goes on the record for each. Read out loud, once, here —
 *  a second copy at a call site is how two refusals start describing the same
 *  fact differently (Rule 16). */
const PLAN_VERIFICATION_REASON: Readonly<Record<PlanVerificationFailure, string>> = {
  'requested-plan-guard':
    'could not verify whether the requested plan_id is archived · the read itself failed '
    + '(transient DB error, lock-wait timeout, or similar), not a confirmed archived state',
  'active-plan-fallback':
    'could not resolve which plan is active for this runner · the read itself failed '
    + '(transient DB error, lock-wait timeout, or similar). This is NOT the same fact as '
    + '"this runner has no active plan", which is what the pre-fix swallow reported',
  /* LEDGERHONESTY-1 (2026-09-13) · this string is PERSISTED — it reaches
   * `plan_mutation_rejections.violations` and, through `land`, the decision
   * ledger. It used to assert that the fallbacks run "a STRICTLY MORE
   * PERMISSIVE doctrine check". That is not what `validate.ts` does with them
   * (a null `trainingDaysPerWeek` makes §5 fire rather than skip), and a false
   * claim in a durable record is the exact defect this whole review chain
   * started from. What it says now is the fact that was actually established:
   * the read failed, so the check could not be run against this runner. */
  'mutation-context':
    'could not read the validator context (plan row and/or profile row) for this mutation. '
    + 'the read itself failed, so the doctrine check could only have been run against '
    + 'substituted values that were never established for this runner. it was not run',
};

export type MutationOutcome =
  | 'applied'
  | 'rejected'
  | 'undeclared_structural'
  | 'bypassed'
  | 'authorship_drift'
  | 'no_plan'
  /**
   * SWALLOWEDGUARD-1 (2026-09-13) · Rule 11 — "don't know", "measured zero"
   * and "the read failed" are three facts, never one. This is what `no_plan`
   * was missing: the archived-plan check in step 1 below used to `.catch(()
   * => ({ rows: [] }))` around its own query, so a THROWN read (a transient
   * DB error, a lock-wait timeout, a network blip — anything, not just "the
   * plan doesn't exist") silently became an empty row set, and the code then
   * reported `requestedPlanArchived = true` — a false claim about the
   * runner's actual data, indistinguishable downstream from a plan that is
   * genuinely archived.
   *
   * This outcome is the third, honest state: the read itself failed, so
   * nothing could be verified. It must never collapse into `no_plan`
   * (a false "archived" claim) and must never let the mutation proceed as if
   * the plan were active (a silent bypass of the guard). The mutation is
   * refused either way; the outcome name is what lets a caller — and this
   * outcome's own regression test — tell which refusal actually happened.
   *
   * CALLERHONESTY-1 (2026-09-13) · it now covers THREE reads, not one, because
   * all three answer the same question ("could this boundary establish what it
   * needs before allowing a write") and Rule 16 says one quantity gets one
   * name. `PlanVerificationFailure` below says which read it was, and that
   * word reaches `plan_mutation_rejections.violations` and the ledger's
   * explanation; the OUTCOME stays one word so a caller has one branch to
   * write rather than three that can drift apart.
   */
  | 'plan_verification_failed'
  /**
   * LEDGERATOMIC-1 · THE MUTATION WAS ROLLED BACK BECAUSE ITS RECORD COULD NOT
   * BE WRITTEN. The owner's rule, verbatim: "If the ledger is the durable
   * record of truth, a required ledger failure must prevent or roll back the
   * mutation." This is what that looks like from the caller's side — a returned
   * verdict, not a thrown surprise, so a per-runner cron loop keeps going.
   *
   * NOT the same as `not_attempted` (the mutation threw) and not the same as
   * `rejected` (doctrine refused it). Three facts, three names.
   */
  | 'ledger_unwritten'
  /**
   * An exactly-once mutation whose idempotency key already carried a ledger
   * row. Nothing was applied a second time and the FIRST row still stands.
   * `ok` is false because this call changed nothing; the caller reads the
   * outcome, not the boolean, to tell "already done" from "refused".
   */
  | 'duplicate';

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
  /**
   * WHO IS KNOCKING. Required, and that is the whole point.
   *
   * `mutate.ts` has been the transactional door in front of `plan_workouts`
   * since it was written, and its own header calls itself "the single door".
   * What it never asked was whether the caller was ALLOWED to change training,
   * only whether the result was well formed. So
   * `AUTOMATIC_ADAPTATION_AUTHORITY = false` could be true at the same moment
   * an unattended cron rewrote 76 workouts through `reanchorActivePlan`.
   *
   * Making this REQUIRED is the consolidation: a caller cannot inherit a
   * default, it has to say what kind of change this is, and a
   * COACHING_ADAPTATION is refused while the seam is closed.
   */
  authority: AuthorityClass;
  /**
   * A NAMED, EXPIRING HOLD for a caller that is a coaching adaptation today and
   * has nowhere else to go yet.
   *
   * David listed this as an acceptable disposition and set its terms: "name its
   * exact scope, reason and ledger behavior", and "temporarily hold it with a
   * named owner, blocker and expiry condition". So a hold is not a bypass: it
   * is recorded, it carries all three fields, and the gate fails when one is
   * missing or when the blocker is gone.
   *
   * Required when `authority` is COACHING_ADAPTATION and the seam is closed.
   * Ignored otherwise.
   */
  hold?: { owner: string; blocker: string; expiresWhen: string };
  /**
   * WHAT THE DECISION RESTED ON. Optional, and everything a caller does NOT
   * supply is either measured here or recorded as unknown — never guessed.
   *
   * Note what is absent: there is no `direction` and no `lever`. Those are
   * MEASURED from the before/after snapshots this boundary already holds (see
   * `lib/brain/ledger/ledger-entry.ts`), precisely so a caller cannot label its
   * own downgrade an "adjustment". `lib/plan/adaptation-log.ts` names that
   * hazard about its own log and can only partly answer it, because it sits
   * outside the transaction and never sees the rows.
   */
  ledger?: {
    /** The observations behind the decision, as the caller already holds them. */
    evidence?: readonly unknown[];
    /** How much to trust the estimate this rested on. Omit when there is none. */
    sourceMode?: LedgerSourceMode;
    /** The proposal this mutation applies, when it applies one. */
    proposalId?: string;
    proposal?: unknown;
    /** PENDING when this row IS the proposal and the answer has not come yet. */
    runnerResponse?: LedgerRunnerResponse;
    /** One clause a person can read. Prefixed to the boundary's own account. */
    explanation?: string;
    /** The deciding engine's version, when the caller has one of its own. */
    modelVersion?: string;
    /** Makes a re-run of the same pass refresh its row rather than duplicate. */
    idempotencyKey?: string;
    /**
     * LEDGERATOMIC-1 · EXACTLY ONCE. Requires `idempotencyKey`.
     *
     * The default (`false`) is at-least-once and always has been: a caller that
     * runs its mutation twice applies it twice, and the ledger row refreshes.
     * That is right for a nightly pass re-deriving the same evidence and WRONG
     * for a runner tapping Accept twice, or for a client retrying a request
     * whose response was lost.
     *
     * With this set, the ledger's partial unique index over
     * `(user_uuid, provenance, idempotency_key)` becomes the guard. The second
     * transaction blocks on the index until the first commits, inserts nothing,
     * and the boundary rolls its plan writes back with outcome `duplicate`. It
     * is concurrency-safe rather than merely retry-safe, because the check and
     * the mutation are the same transaction — a `SELECT` first would leave a
     * race between the look and the write.
     *
     * REFUSES when the ledger table is absent, rather than degrading. A
     * once-only guarantee that silently becomes at-least-once is a missing
     * input disabling a safety mechanism (Rule 11), and the caller asked for
     * the guarantee, not for best effort.
     */
    applyOnce?: boolean;
    /**
     * LEDGERATOMIC-1 · THIS MUTATION REVERSES AN EARLIER DECISION.
     *
     * The named row is stamped `undone_at` / `undo_reason` ON THIS
     * TRANSACTION, so the plan going back and the decision being marked
     * reversed are one outcome. If the row is missing or already undone the
     * whole mutation rolls back — undoing the wrong decision is worse than not
     * undoing at all, and a reversal recorded against a plan that never moved
     * back is worse than both.
     */
    undoes?: { id: string; reason: string };
  };
  /** Extra context stored on the rejection record. */
  detail?: Record<string, unknown>;
  /** The writes. Runs inside the boundary's transaction; must not BEGIN,
   *  COMMIT or ROLLBACK. */
  apply: (tx: PoolClient, planId: string) => Promise<T>;
  /**
   * NOOPSTAMP-1 (2026-09-05) · did this mutation actually MOVE the runner's
   * prescription? Optional, and omitting it keeps the old behaviour exactly
   * (`stampAdapted` runs on every commit), so no existing caller changes.
   *
   * ── WHY A CALLER HAS TO ANSWER THIS, AND THE BOUNDARY CANNOT ────────────
   *
   * `last_adapted_at` is not a log. It is the second half of `planVersion`
   * (`${id}:${last_adapted_at}`, `lib/plan/plan-version.ts`), which is what
   * V5 Today, the week strip, the watch snapshot, `brain/proposal/staleness`
   * and the canonical deferral queue all compare against. So stamping it means
   * "the prescription changed" to five consumers and meant "we committed a
   * transaction" to this function, and those are different questions
   * (Rule 16 · one quantity, one name).
   *
   * Measured on production 2026-09-05: all seven active plans carried
   * `last_adapted_at` within 15 seconds of each other — 11:21:27 to 11:21:42
   * UTC, the `snapshot-projections` pass, whose `cron_ok` row is stamped
   * 11:21:42 — while the most recent `plan_adapt_*` coach intent for ANY
   * runner was 2026-09-03 07:53. Nothing adapted; every version moved. The
   * consequences are not cosmetic: `lib/brain/proposal/action.ts` marks a
   * pending proposal stale the moment `planVersion` moves, and
   * `canonical/deferral-queue.ts` expires a deferral with
   * `PLAN_VERSION_CHANGED` on the same signal. A nightly no-op stamp retires
   * every outstanding question the coach has asked the runner.
   *
   * The boundary genuinely cannot answer it: `apply` is an opaque closure and
   * a transaction committing says nothing about whether a prescribed pace
   * moved. `reanchor-plan.ts` is the worked case — all three of its arms write
   * a fresh `pace_blend.reanchored_at` unconditionally, so the row always
   * changes even when `recomputePacesForPlan` reports `workoutsUpdated: 0`.
   * Only the caller holds the number that answers this.
   *
   * When it returns false the plan is NOT stamped and the CURRENT version is
   * read and returned instead, so the ledger still records the version this
   * mutation left behind rather than a null.
   */
  didChange?: (value: T) => boolean;
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

/* ══════════════════════════════════════════════════════════════════════════
 * LEDGER-1 (2026-09-05) · EVERY EXIT OF THIS DOOR LANDS IN THE LEDGER
 *
 * `plan_mutation_rejections` (migration 150) already records what this boundary
 * REFUSED. It has never recorded what it PERMITTED, so the audit surface in
 * front of the only door into `plan_workouts` could answer "what did we stop"
 * and not "what did we do" — and the second question is CLAUDE.md Rule 21's:
 * "the number of UPWARD adaptations is ZERO ... establishing the zero required
 * querying `coach_intents` sideways."
 *
 * So the ledger row is written on EVERY exit, including the successful ones,
 * including the refusal that throws before a connection is even opened, and
 * including the crash. `check-decision-ledger.sh` guard 1 walks this function's
 * exits and fails when one of them does not.
 *
 * ── LEDGERATOMIC-1 (2026-09-05) · AND IT IS THE SAME OUTCOME AS THE MUTATION
 *
 * The original LEDGER-1 wrote every row on a second connection, and argued for
 * it: a refusal recorded inside a rolled-back transaction would roll back with
 * it, leaving a ledger that records every decision except the refusals.
 *
 * True of refusals. False of everything that COMMITS, and the owner named the
 * consequence exactly: "A plan mutation and its ledger record must be one
 * atomic outcome. The system may not: (1) mutate the plan, (2) fail to write
 * the ledger, (3) log an error, (4) return success." That was the literal
 * sequence — `await client.query('COMMIT')`, then `await land(...)`, then
 * `console.error('DECISION NOT RECORDED')`, then `return { ok: true }`.
 *
 * So there are two lanes now, and the split is on a real distinction rather
 * than a convenience:
 *
 *   `landInTx(...)` · BEFORE every COMMIT, on `client`. The row is a
 *     PRECONDITION of the commit. It fails, the transaction rolls back, and
 *     the mutation returns `ledger_unwritten`. There is no interval in which
 *     the plan has moved and the ledger has not, so a process dying anywhere
 *     in the sequence loses both or neither.
 *
 *   `land(...)` · AFTER every ROLLBACK, on `pool`. A refusal has no mutation
 *     to be atomic with; recording it on the transaction that just rolled back
 *     would erase it. This lane keeps LEDGER-1's contract exactly: three
 *     states, never throws, a failure logged and the caller's own outcome
 *     unmasked.
 *
 * `check-decision-ledger.sh` guard 1 walks the exits and fails when one records
 * nothing; guard 4 walks the COMMITs and fails when one is not preceded by an
 * in-transaction write.
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * The mutation is being abandoned BECAUSE OF THE LEDGER, not because of
 * doctrine and not because a statement blew up. Carried as its own error type
 * so the catch-all can tell it from a caller bug and turn it into a returned
 * verdict instead of re-throwing — a cron loop must survive it the same way it
 * survives a rejection.
 */
class LedgerRefusedMutation extends Error {
  constructor(
    readonly kind: 'ledger_unwritten' | 'duplicate',
    message: string,
  ) {
    super(message);
    this.name = 'LedgerRefusedMutation';
  }
}

interface LedgerLanding {
  userUuid: string;
  source: string;
  authority: AuthorityClass;
  authorityVerdict: 'PERMITTED' | 'REFUSED' | 'HELD';
  hold: { owner: string; blocker: string; expiresWhen: string } | null;
  planId: string | null;
  replacedPlanId: string | null;
  /**
   * LINEAGEREAD-1 (2026-09-13) · the lineage lookup THREW, so `replacedPlanId`
   * being null here is "we could not look" and not "there was nothing to
   * find". Three facts, and this is the one that used to be the second
   * (Rule 11). See the read site in `mutatePlan` for why a null here is a
   * PERMANENT false claim rather than a transient one.
   */
  replacedPlanUnknown: boolean;
  planVersion: string | null;
  /** Empty when there was no comparable before-state. Direction reads UNKNOWN. */
  before: readonly PlanWorkoutRow[];
  after: readonly PlanWorkoutRow[];
  decision: LedgerDecision;
  outcome: MutationOutcome | 'not_attempted';
  violations: readonly string[];
  /** The boundary's own sentence about what happened. Never empty. */
  account: string;
  ledger: MutatePlanOptions<unknown>['ledger'];
}

/**
 * Land one decision. Never throws, and never masks the caller's own outcome —
 * the gate on a plan mutation is the rollback, not the audit row, and a ledger
 * outage must not be the thing that takes a runner's nightly cron down.
 *
 * A write that did NOT land is logged at `console.error` with which of the two
 * non-written states it was, because "the decision was recorded" and "the
 * decision happened and nothing recorded it" are the two facts this whole
 * feature exists to keep apart (Rule 11).
 */
async function landDecisionInLedger(l: LedgerLanding): Promise<string | null> {
  try {
    const written = await recordDecision(await buildLedgerEntry(l));
    if (written.state === 'written') return written.id;
    console.error(
      `[plan/mutate] DECISION NOT RECORDED (${written.state}) · source=${l.source} · `
      + `outcome=${l.outcome} · ${written.why}`,
    );
    return null;
  } catch (e) {
    console.error(
      `[plan/mutate] ledger write threw and was contained · source=${l.source} ·`,
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

/**
 * LANE A · the ledger row as a PRECONDITION of the commit.
 *
 * Runs on the caller's open transaction. Every failure mode leaves the
 * transaction unusable and raises `LedgerRefusedMutation`, which the boundary's
 * catch turns into a rolled-back mutation with a named outcome. Nothing here
 * is contained, deliberately: containment is what produced the four-step
 * sequence this whole change exists to remove.
 *
 * LEDGERREQUIRED-1 (2026-09-06) · `table_absent` REFUSES. It used to warn and
 * let the commit through, on the argument that it is "the declared
 * pre-migration state of production." The owner's ruling overturns that
 * argument by name: "There may be no ambiguous or optional ledger behavior
 * for a plan mutation... When the ledger is required and unavailable, the
 * mutation refuses before changing the plan." A structural or derivations
 * mutation with no durable record of what it did or why is exactly the
 * unaudited write this whole ledger exists to end — an absent table does not
 * make that acceptable, it only makes it invisible.
 *
 * The operational consequence, stated rather than buried: until migration 166
 * is applied, EVERY structural/derivations mutation through this door refuses
 * — every proposal accept, every Move-a-Run, every pace change. Plan AUTHORING
 * (`touches === 'authorship'`) is a separate exit and is unaffected; a brand
 * new plan can still be created. This is the conservative direction and it is
 * the one asked for: a runner-accepted mutation nobody can audit is closer to
 * an unaccountable automatic write than a properly governed one, and "do not
 * modify my live plan" is better served by refusing than by silently
 * proceeding unaudited.
 */
async function landDecisionInTransaction(
  tx: LedgerExecutor,
  l: LedgerLanding,
  onceOnly: boolean,
  undoes: { id: string; reason: string } | undefined,
  requireLedger: boolean,
): Promise<string | null> {
  const entry = await buildLedgerEntry(l, tx);
  let written;
  try {
    written = await recordDecisionInTransaction(tx, entry, { onceOnly });
  } catch (e) {
    throw new LedgerRefusedMutation(
      'ledger_unwritten',
      `the decision could not be recorded, so the mutation was rolled back · source=${l.source} · `
      + `outcome=${l.outcome} · ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (written.state === 'duplicate') {
    throw new LedgerRefusedMutation('duplicate', written.why);
  }
  if (written.state === 'table_absent') {
    // LEDGERREQUIRED-1 · refuse, do not warn-and-proceed — for a mutation the
    // ledger is REQUIRED for. Scoped to `requireLedger`, not to every touch:
    // plan AUTHORSHIP (a brand-new `training_plans` row — onboarding, a
    // rebuild) is not the runner-accepted coaching decision this rule is
    // about, and refusing it here would mean no plan could be authored in
    // production at all while migration 166 is pending — a far larger blast
    // radius than "Move-a-Run" or "accept a proposal," and not what was
    // asked for. An undo ALWAYS requires the ledger regardless of
    // `requireLedger`: a reversal with nothing recording it is never sound.
    if (requireLedger || undoes) {
      throw new LedgerRefusedMutation(
        'ledger_unwritten',
        (undoes
          ? `this mutation reverses ledger row ${undoes.id}, and `
          : 'this mutation ')
        + `the ledger table does not exist on this database, so the ${undoes ? 'reversal' : 'decision'} `
        + `cannot be recorded alongside the plan change. source=${l.source} · outcome=${l.outcome} · `
        + written.why,
      );
    }
    console.warn(
      `[plan/mutate] DECISION NOT RECORDED (table_absent, ledger not required for this touch) · `
      + `source=${l.source} · outcome=${l.outcome} · ${written.why}`,
    );
    return null;
  }
  if (undoes) {
    try {
      await markUndoneInTransaction(tx, undoes.id, undoes.reason);
    } catch (e) {
      throw new LedgerRefusedMutation(
        'ledger_unwritten',
        `the undo stamp failed, so the plan reversal was rolled back with it · `
        + `${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  return written.id;
}

/**
 * The row both lanes write. One construction, so the two cannot describe the
 * same decision differently — Rule 16, applied to the ledger's own writer.
 *
 * `on` is the transaction when lane A calls it, so lineage is resolved against
 * the same snapshot the row lands in.
 */
async function buildLedgerEntry(l: LedgerLanding, on?: LedgerExecutor): Promise<LedgerEntry> {
  {
    const delta = demandDelta(l.before, l.after);
    const { scope, fromISO, toISO } = scopeOfChange(l.after, delta.changedWorkoutIds);
    const lineage = await resolvePlanLineage({
      userUuid: l.userUuid,
      planId: l.planId,
      replacedPlanId: l.replacedPlanId,
      // LINEAGEREAD-1 · carries the third state through to the column, so a
      // row whose lineage could not be established is not written as a row
      // that CONFIDENTLY opens a new one.
      replacedPlanUnknown: l.replacedPlanUnknown,
      on,
    });
    const supplied = l.ledger?.explanation;
    return {
      userUuid: l.userUuid,
      planId: l.planId,
      planLineageId: lineage,
      replacedPlanId: l.replacedPlanId,
      planVersion: l.planVersion,
      scope,
      workoutIds: delta.changedWorkoutIds,
      scopeFromISO: fromISO,
      scopeToISO: toISO,
      lever: leverOfDelta(delta),
      direction: directionOfDelta(delta),
      evidence: l.ledger?.evidence ?? [],
      provenance: l.source,
      sourceMode: l.ledger?.sourceMode ?? null,
      // NOT `length > 0 ? … : null`. "No before-state was read" and "the
      // before-state was read and held nothing" are different facts, and a null
      // collapses them (Rule 11). `comparable` carries the distinction, so a
      // reader can tell an authorship from a plan that was genuinely empty.
      beforeState: {
        comparable: delta.comparable,
        workouts: l.before.length,
        prescribedMi: totalMi(l.before),
      },
      afterState: { workouts: l.after.length, prescribedMi: totalMi(l.after), delta },
      authority: l.authority,
      authorityVerdict: l.authorityVerdict,
      hold: l.hold,
      decision: l.decision,
      proposalId: l.ledger?.proposalId ?? null,
      proposal: l.ledger?.proposal ?? null,
      runnerResponse: l.ledger?.runnerResponse ?? null,
      mutationOutcome: l.outcome,
      mutationViolations: l.violations,
      explanation: supplied ? `${supplied} · ${l.account}` : l.account,
      modelVersion: l.ledger?.modelVersion ?? PLAN_MUTATION_BOUNDARY_MODEL_VERSION,
      idempotencyKey: l.ledger?.idempotencyKey ?? null,
    };
  }
}

const totalMi = (rows: readonly PlanWorkoutRow[]): number =>
  Math.round(rows.reduce((s, r) => s + (Number(r.distance_mi) || 0), 0) * 10) / 10;

/**
 * Route a plan mutation through the boundary.
 *
 * Never throws for a validation verdict — a rejection is a returned value, so
 * a per-user cron loop keeps going. Errors thrown by `apply` itself DO
 * propagate (after rollback), because a failing statement is a caller bug and
 * must not be mistaken for a doctrine rejection.
 */
export async function mutatePlan<T>(opts: MutatePlanOptions<T>): Promise<MutatePlanResult<T>> {
  /* ── THE AUTHORITY BOUNDARY (2026-09-05) ──────────────────────────────────
   *
   * One question, asked once, in front of every plan mutation in the app.
   * Before this, the seam governed exactly one caller (`tryAdaptiveBump`) and
   * every other automatic writer went around it without meaning to.
   */
  const verdict = mutationIsPermitted(opts.authority);
  if (!verdict.permitted) {
    const hold = opts.hold;
    if (hold === undefined) {
      // LEDGER-1 · A REFUSAL IS A DECISION. This exit is the one the seam
      // exists for — the engine wanted to change training and was not allowed —
      // and it is exactly the row a reader needs to tell an engine that never
      // pushes from a runner who never earned it. Recorded BEFORE the throw so
      // the throw cannot skip it.
      await landDecisionInLedger({
        userUuid: opts.userUuid,
        source: opts.source,
        authority: opts.authority,
        authorityVerdict: 'REFUSED',
        hold: null,
        planId: opts.planId ?? null,
        replacedPlanId: null,
        replacedPlanUnknown: false,
        planVersion: null,
        before: [],
        after: [],
        decision: 'REFUSE',
        outcome: 'not_attempted',
        violations: [verdict.because],
        account: `${verdict.because}. ${verdict.insteadDo ?? ''}`.trim(),
        // No idempotency key, for the reason spelled out on `land` below: a
        // lane B row never changed the plan, and refreshing the row of a
        // mutation that DID would erase it.
        ledger: opts.ledger ? { ...opts.ledger, idempotencyKey: undefined } : undefined,
      });
      throw new Error(
        `[mutate] REFUSED · ${opts.source} declared ${opts.authority} and ${verdict.because}. `
        + `${verdict.insteadDo ?? ''}`,
      );
    }
    // A hold is permitted, LOUDLY. It is recorded on every run so it cannot
    // become invisible, which is the difference between a hold and a bypass.
    console.log(
      `[mutate] HELD · ${opts.source} is a coaching adaptation running under a named hold · `
      + `owner=${hold.owner} · blocker=${hold.blocker} · expires when ${hold.expiresWhen}`,
    );
  }
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
   * cached client day would never invalidate.
   *
   * STATUSWORDS-1 (2026-09-05) · this sentence used to name
   * `check-planversion-ratchet.sh` as "the gate this closes".
   * `check-planversion-ratchet.sh` does not exist, anywhere in the repo, and
   * never has. Rule 20's corollary: gate the
   * claim or delete the sentence, because a citation nothing verifies is worse
   * than silence — it stops the next reader from checking. The real gates are
   * `lib/plan/_planversion_invalidation.test.ts` (every in-place writer must
   * reach a stamp) and `lib/plan/_noop_stamp.test.ts` (and a writer that knows
   * nothing moved must not).
   *
   * Deliberately excluded: `touches === 'authorship'` (a brand-new
   * `training_plans` row — its `id` already differs, so `planVersion` moves
   * without this) and the no-plan-id short-circuit at step 5 below (nothing
   * was written). Every other exit that COMMITs a write to an EXISTING plan
   * goes through this.
   *
   * LEDGER-1 (2026-09-05) · it now RETURNS the version it stamped, so the
   * ledger row records the `planVersion` the mutation PRODUCED rather than a
   * separate query's guess at it. Same shape `week-loader.ts` and
   * `plan-snapshot.ts` already build (`${id}:${last_adapted_at}`) — Rule 16,
   * one quantity, one definition.
   */
  const stampAdapted = async (
    planIdToStamp: string | null,
    value: T,
  ): Promise<string | null> => {
    if (!planIdToStamp) return null;
    /* NOOPSTAMP-1 · a caller that KNOWS nothing moved says so, and the version
     * signal holds still. Read, never stamped — Rule 11: "we looked and
     * nothing changed" is a third fact beside "we changed it" and "we could
     * not tell", and it must not be reported as either. */
    if (opts.didChange && !opts.didChange(value)) {
      const r = await client.query<{ last_adapted_at: string | null }>(
        `SELECT last_adapted_at::text AS last_adapted_at FROM training_plans WHERE id = $1`,
        [planIdToStamp],
      );
      return `${planIdToStamp}:${r.rows[0]?.last_adapted_at ?? 'none'}`;
    }
    const r = await client.query<{ last_adapted_at: string | null }>(
      `UPDATE training_plans SET last_adapted_at = NOW() WHERE id = $1
        RETURNING last_adapted_at::text AS last_adapted_at`,
      [planIdToStamp],
    );
    return `${planIdToStamp}:${r.rows[0]?.last_adapted_at ?? 'none'}`;
  };

  const fail = (outcome: MutationOutcome, violations: string[], preExisting: string[], planId: string | null): MutatePlanResult<T> => ({
    ok: false, outcome, value: null, violations, preExisting, resolved: [], planId,
  });

  /* LEDGER-1 · the plan this mutation REPLACED, resolved for an authorship
   * BEFORE `apply` archives it. Read here rather than reconstructed afterwards,
   * because after `clearActivePlansFor` runs there is no longer anything that
   * distinguishes "the plan this one replaced" from "some plan this runner
   * archived last March". Plan lineage is the column that makes the ledger
   * survive a rebuild, so it may not rest on a guess. */
  let replacedPlanId: string | null = null;
  /* LINEAGEREAD-1 (2026-09-13) · and the read that fills it can FAIL, which is
   * a third fact the `?? null` below used to erase. See the read site. */
  let replacedPlanUnknown = false;

  /* Set on every exit that commits a write to an existing plan. */
  let producedPlanVersion: string | null = null;

  /* The snapshots the ledger measures direction from. Kept in the function
   * scope rather than passed down, so the catch-all exit can reach them too. */
  let ledgerBefore: readonly PlanWorkoutRow[] = [];
  let ledgerAfter: readonly PlanWorkoutRow[] = [];

  const landing = (
    decision: LedgerDecision,
    outcome: MutationOutcome | 'not_attempted',
    violations: readonly string[],
    account: string,
    planIdForRow: string | null,
  ): LedgerLanding => ({
    userUuid: opts.userUuid,
    source: opts.source,
    authority: opts.authority,
    authorityVerdict: verdict.permitted ? 'PERMITTED' : 'HELD',
    hold: verdict.permitted ? null : (opts.hold ?? null),
    planId: planIdForRow,
    replacedPlanId,
    replacedPlanUnknown,
    planVersion: producedPlanVersion,
    before: ledgerBefore,
    after: ledgerAfter,
    decision,
    outcome,
    violations,
    account,
    ledger: opts.ledger,
  });

  /**
   * LANE B · after a ROLLBACK. Own connection, never throws.
   *
   * ── IT DROPS THE IDEMPOTENCY KEY, AND THAT IS NOT A DETAIL ──────────────
   *
   * Found by test 5 of `_ledger_atomicity.db.test.ts` on its first run, and it
   * would not have been found by reading the code. Lane B inserts
   * `ON CONFLICT … DO UPDATE`, by design, so that a nightly pass re-deriving
   * the same evidence refreshes its row instead of doubling Rule 21's census.
   * A ROLLED-BACK mutation carrying the same key therefore OVERWRITES the row
   * of the mutation that succeeded — the duplicate-accept refusal rewrote the
   * accept it was refusing, turning `applied` into `duplicate` and erasing the
   * only record that the runner's plan had ever moved.
   *
   * Every lane B row is, by construction, a decision that did NOT change the
   * plan. It is a distinct event from whatever holds that key, so it gets no
   * key and stands as its own row. The cost is that a pass rejected twice
   * writes two refusals instead of refreshing one, which is the honest count:
   * it was refused twice.
   */
  const land = (
    decision: LedgerDecision,
    outcome: MutationOutcome | 'not_attempted',
    violations: readonly string[],
    account: string,
    planIdForRow: string | null,
  ): Promise<string | null> => landDecisionInLedger({
    ...landing(decision, outcome, violations, account, planIdForRow),
    ledger: opts.ledger ? { ...opts.ledger, idempotencyKey: undefined } : undefined,
  });

  /**
   * LANE A · before a COMMIT. The caller's transaction, and a precondition of
   * it. Raises `LedgerRefusedMutation`, which the catch below turns into a
   * rolled-back mutation carrying `ledger_unwritten` or `duplicate`.
   */
  const landInTx = (
    decision: LedgerDecision,
    outcome: MutationOutcome | 'not_attempted',
    violations: readonly string[],
    account: string,
    planIdForRow: string | null,
  ): Promise<string | null> => landDecisionInTransaction(
    client,
    landing(decision, outcome, violations, account, planIdForRow),
    opts.ledger?.applyOnce === true,
    opts.ledger?.undoes,
    // LEDGERREQUIRED-1 · required for every touch except a brand-new plan
    // being authored. See landDecisionInTransaction's own comment for why.
    touches !== 'authorship',
  );

  try {
    await client.query('BEGIN');

    // 1 · resolve the plan.
    //
    // ARCHIVEDGUARD-1 (2026-09-12) · Rule 14 — "a query names the population
    // it reads." A caller-supplied `opts.planId` used to be trusted AS-IS: the
    // `archived_iso IS NULL` fallback two blocks below only ran when NO
    // planId was supplied at all. `api/plan/workout/route.ts`'s PATCH resolved
    // ownership with `WHERE id = $1 AND user_uuid = $2` — no archived check —
    // and forwarded that id straight into `planId` here, so any plan_id the
    // runner had ever owned, active or already superseded by a rebuild,
    // reached every non-bypass write this boundary guards.
    //
    // `requestedPlanArchived` marks that failure so it can be REFUSED outright
    // in step 3, rather than falling through to the "no planId supplied"
    // fallback below and silently retargeting the write onto whatever OTHER
    // plan happens to be active right now — landing on the wrong plan is worse
    // than refusing. The `opts.bypass` escape hatch is untouched: it exists
    // precisely for a caller (an admin backfill) that must be able to name a
    // plan without paying for this check.
    //
    // ARCHIVEDGUARD-2 (2026-09-12) · closes the review gap left by
    // ARCHIVEDGUARD-1. That fix checked `archived_iso IS NULL` and the write
    // in `apply` as two separate statements under plain READ COMMITTED, with
    // no lock held in between — so the guarantee only covered a race already
    // resolved BEFORE this SELECT ran, not one developing DURING this
    // transaction. A concurrent `clearActivePlansFor` (generate.ts,
    // seed-from-onboarding.ts) archiving this exact plan and committing in
    // the window between this SELECT and `apply`'s write would sail through
    // undetected — the check had already said "active" and nothing re-asked.
    //
    // `FOR UPDATE` closes it with an ordinary row lock, not an advisory lock,
    // because the row already exists (this is a resolve-then-mutate path, not
    // a create path — advisory locks are for when there is no row to hold a
    // lock on) and because the archiver's own write is a plain `UPDATE
    // training_plans SET archived_iso = ... WHERE ... archived_iso IS NULL`
    // (`clearActivePlansFor`, both implementations) — an UPDATE always takes
    // an implicit row lock on every row it is about to modify, so it is
    // already a *compatible* lock-taker and needed no change of its own.
    // Concretely, under READ COMMITTED:
    //   · this SELECT's FOR UPDATE wins the row first → the archiver's UPDATE
    //     blocks on the same row until this transaction COMMITs or ROLLBACKs,
    //     so the archive can only land AFTER this mutation is fully decided —
    //     never interleaved with it.
    //   · the archiver's UPDATE wins first and commits → this SELECT, once it
    //     acquires the now-free lock, re-evaluates its own WHERE clause
    //     against the just-committed row (standard READ COMMITTED semantics
    //     for a blocked writer/locker) and correctly returns zero rows,
    //     because `archived_iso` is no longer NULL. `requestedPlanArchived`
    //     fires exactly as it does for a race resolved before this ran.
    // Either way there is no window left in which this transaction can both
    // believe the plan is active and commit a write after it has actually
    // been archived.
    let planId: string | null = null;
    let requestedPlanArchived = false;
    // SWALLOWEDGUARD-1 (2026-09-13) · Rule 11. This used to be
    // `.catch(() => ({ rows: [] }))`, which cannot tell "the plan is
    // archived / not owned" (a real, queried negative) apart from "the query
    // itself threw" (a transient DB error, a lock-wait timeout, a network
    // blip). Both collapsed into `requestedPlanArchived = true` — a false
    // "archived" claim reported as fact whenever the read merely failed.
    //
    // `attempt()` (lib/db/read.ts) is the primitive built for exactly this:
    // it forces the caller to branch on `ok` before touching a value, so a
    // failure cannot silently become an answer. `rowOrNull` was considered
    // (it is what the lineage lookup 30 lines below uses) but rejected for
    // THIS call site: `rowOrNull` still returns a single collapsed `null` for
    // "not found" (well, `undefined`) vs "failed" (`null`) — a caller that
    // isn't careful can still do `?? null` and lose the distinction, which is
    // exactly the failure mode this guard exists to prevent. This check's
    // entire reason for existing is "verify not-archived before allowing a
    // write", so a failed read must REFUSE the mutation with its own honest
    // outcome (`plan_verification_failed`, step 3 below) — never fall back to
    // "archived" (false negative reported as fact) and never fall through to
    // "active" (an unverified state waved through silently).
    let planVerificationFailed: PlanVerificationFailure | null = null;
    if (opts.planId) {
      if (opts.bypass) {
        planId = opts.planId;
      } else {
        const activeAttempt = await attempt(
          'mutate/archived-plan-guard',
          client.query<{ id: string }>(
            `SELECT id::text AS id FROM training_plans
              WHERE id = $1 AND user_uuid = $2::uuid AND archived_iso IS NULL
              LIMIT 1
              FOR UPDATE`,
            [opts.planId, opts.userUuid],
          ),
        );
        if (!activeAttempt.ok) {
          planVerificationFailed = 'requested-plan-guard';
        } else {
          const active = activeAttempt.value.rows[0]?.id ?? null;
          if (active) planId = active;
          else requestedPlanArchived = true;
        }
      }
    }
    // SWALLOWEDGUARD-1 · both fallbacks below are also gated on
    // `!planVerificationFailed`. A caller who named a `planId` that we could
    // not verify must not have that unresolved read silently papered over by
    // falling through to a DIFFERENT plan (the workoutId's owner, or
    // whatever else is currently active) — that is the "proceeds as if
    // active" failure mode this fix exists to close, just wearing the
    // fallback's clothes instead of the archived-claim's.
    if (!planId && !requestedPlanArchived && !planVerificationFailed && opts.workoutId) {
      planId = (await client.query<{ plan_id: string }>(
        `SELECT plan_id::text AS plan_id FROM plan_workouts WHERE id = $1 LIMIT 1`,
        [opts.workoutId],
      )).rows[0]?.plan_id ?? null;
    }
    // CALLERHONESTY-1 (2026-09-13) · Rule 11, the same bug one branch over.
    // This is the "no planId was supplied" fallback, and until now it carried
    // the ORIGINAL, unfixed `.catch(() => ({ rows: [] }))` shape — the round-4
    // fix's own test file declared it out of scope on the argument that it
    // "answers a different question". It does answer a different question, and
    // it collapses that answer exactly as badly: a thrown read became zero
    // rows, `planId` stayed null, and step 3 refused with `no_plan` — the
    // affirmative claim "this runner has no active plan", stated as fact about
    // a runner who may well have one, and recorded that way in
    // `plan_mutation_rejections`. `no_plan` is a real and meaningful outcome
    // (a runner genuinely between blocks); that is precisely why "we could not
    // tell" must not wear its name.
    if (!planId && !requestedPlanArchived && !planVerificationFailed && touches !== 'authorship') {
      const fallbackAttempt = await attempt(
        'mutate/active-plan-fallback',
        client.query<{ id: string }>(
          `SELECT id::text AS id FROM training_plans
            WHERE user_uuid = $1::uuid AND archived_iso IS NULL
            ORDER BY authored_iso DESC LIMIT 1`,
          [opts.userUuid],
        ),
      );
      if (!fallbackAttempt.ok) planVerificationFailed = 'active-plan-fallback';
      else planId = fallbackAttempt.value.rows[0]?.id ?? null;
    }

    /* LEDGER-1 · for an authorship, read the plan about to be replaced BEFORE
     * `apply` archives it. See `replacedPlanId`'s declaration for why this
     * cannot be reconstructed afterwards.
     *
     * LINEAGEREAD-1 (2026-09-13) · this used to be `rowOrNull(...)?.id ?? null`
     * and was defended as an argued Rule 11 exemption on the grounds that a
     * lineage lookup is "audit-only" and "must never be the thing that fails a
     * rebuild". The second half of that sentence is still right and this fix
     * keeps it: a failed lookup does NOT refuse the authorship. The first half
     * was wrong, and the `?? null` was doing real damage, because this value is
     * not consumed and discarded — it is WRITTEN DOWN:
     *
     *   · `resolvePlanLineage` reads a null `replacedPlanId` as "nothing was
     *     replaced" and returns the NEW plan's own id, so `plan_lineage_id`
     *     starts a fresh lineage. Every decision ever recorded against the
     *     previous block is then unreachable by lineage, permanently, which is
     *     the one thing that column exists to prevent.
     *   · the account sentence in the authorship exit below literally read
     *     "a new plan was authored and replaced nothing. This row opens its
     *     lineage." A false statement, in a durable ledger, produced by a
     *     transient blip.
     *
     * So: `attempt`, branch, and carry the third state (`replacedPlanUnknown`)
     * into both the lineage value and the sentence. The rebuild still commits. */
    if (touches === 'authorship') {
      const replacedAttempt = await attempt(
        'mutate/lineage-replaced-plan',
        client.query<{ id: string }>(
          `SELECT id::text AS id FROM training_plans
            WHERE user_uuid = $1::uuid AND archived_iso IS NULL
            ORDER BY authored_iso DESC LIMIT 1`,
          [opts.userUuid],
        ),
      );
      if (!replacedAttempt.ok) {
        replacedPlanUnknown = true;
        console.error(
          `[plan/mutate] LINEAGE UNKNOWN · source=${opts.source} · the replaced-plan lookup `
          + 'failed, so this authorship records an UNKNOWN lineage rather than claiming it '
          + 'replaced nothing. The plan itself is unaffected.',
        );
      } else {
        replacedPlanId = replacedAttempt.value.rows[0]?.id ?? null;
      }
    }

    // 2 · the marked bypass. Runs the writes, records the decision, commits.
    if (opts.bypass) {
      const value = await opts.apply(client, planId ?? '');
      if (touches !== 'authorship') producedPlanVersion = await stampAdapted(planId, value);
      // Direction is UNKNOWN here and that is the honest answer, not a gap: the
      // bypass runs its writes before any snapshot is taken, deliberately —
      // it is the escape hatch for a backfill that must not pay for
      // validation — so there is no before-state to measure against. A ledger
      // row that said NEUTRAL would be asserting a measurement nobody made.
      //
      // LEDGERATOMIC-1 · a bypass skips VALIDATION, never the record. The row
      // is written on this transaction before the commit, so even the escape
      // hatch cannot move a plan without saying that it did.
      await landInTx(
        'APPLY', 'bypassed', [],
        `marked bypass · ${opts.bypass.reason} · validation skipped, so no before-state was `
        + 'read and the direction of this change is unmeasured rather than neutral',
        planId,
      );
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
    //
    //     ARCHIVEDGUARD-1 · `requestedPlanArchived` forces this refusal even
    //     when `touches === 'authorship'`, because the caller DID name a
    //     plan — it just failed the archived/ownership check — and that is
    //     never a "nothing to validate against" case that authorship's
    //     no-plan exemption was written for.
    //
    //     SWALLOWEDGUARD-1 · `planVerificationFailed` forces the SAME
    //     refusal, for the SAME reason, but is reported under its own
    //     outcome (`plan_verification_failed`, never `no_plan`) — Rule 11's
    //     "don't know" / "measured zero" / "the read failed" are three facts
    //     a caller or a reader of `plan_decision_ledger` must be able to
    //     tell apart. Collapsing this into `no_plan`/`requestedPlanArchived`
    //     would recreate the exact bug this fixes one label up the stack.
    //
    //     CALLERHONESTY-1 · the ROLLBACK-and-refuse body is a closure now,
    //     because step 4 below has to be able to take the same exit when the
    //     VALIDATOR CONTEXT read fails. One body, so the two exits cannot
    //     describe the same refusal in two different ways (Rule 16).
    /* LEDGERHONESTY-1 (2026-09-13) · the `mutation-context` explanation below
     * lands in `plan_decision_ledger.explanation` and is permanent. It used to
     * claim the fallbacks leave "no weekly-frequency cap at all". There is no
     * weekly-frequency cap in `validate.ts` to lose; the field's only consumer
     * there skips a check at `<= 1`, so a null makes that check FIRE. It now
     * states what happened and nothing more. (Kept out of the `land(...)`
     * argument list on purpose: `_decision_ledger_gate.ts`'s GUARD 1 walks 30
     * lines back from each exit to find its `land` call, and a comment inside
     * the arguments pushes the exit out of that window.) */
    const refuseUnverifiable = async (
      why: PlanVerificationFailure | null,
      planIdForRow: string | null,
    ): Promise<MutatePlanResult<T>> => {
      await client.query('ROLLBACK');
      const reason = why
        ? PLAN_VERIFICATION_REASON[why]
        : requestedPlanArchived
        ? 'the requested plan_id is archived or not owned by this runner, so it is no longer a '
          + 'valid mutation target'
        : 'no active plan resolved for this mutation';
      console.error(
        `[plan/mutate] ${why ? 'UNVERIFIED' : 'NO PLAN'} · source=${opts.source} `
        + `user=${opts.userUuid.slice(0, 8)}`
        + (why ? ` · ${why} READ FAILED, refusing rather than guessing`
          : requestedPlanArchived ? ' · requested plan archived/not-owned' : ''),
      );
      const outcome: MutationOutcome = why ? 'plan_verification_failed' : 'no_plan';
      await recordMutationOutcome({
        userUuid: opts.userUuid, planId: planIdForRow, source: opts.source,
        outcome, violations: [reason],
        preExisting: [], detail: why ? { ...(opts.detail ?? {}), verification_failure: why } : (opts.detail ?? null),
      });
      await land(
        'REFUSE', outcome, [reason],
        why === 'requested-plan-guard'
          ? 'the archived-plan-guard read for the caller-supplied plan_id failed outright, so '
            + 'this boundary could not confirm the plan is active. The write was rolled back '
            + 'rather than reported as "archived" (a false negative) or allowed through as '
            + '"active" (an unverified state). Refusing is the only honest answer to a failed '
            + 'read (CLAUDE.md Rule 11).'
          : why === 'active-plan-fallback'
          ? 'no plan_id was supplied and the read that resolves this runner\'s active plan failed '
            + 'outright. The write was rolled back and reported as UNVERIFIED rather than as '
            + '"this runner has no active plan", which is a different and specific fact this '
            + 'boundary did not establish (CLAUDE.md Rule 11).'
          : why === 'mutation-context'
          ? 'the validator context for this mutation could not be read (the plan row and/or '
            + 'profile row read failed), so the doctrine check could only have been run against '
            + 'substituted values never established for this runner. The write was rolled back '
            + 'rather than graded against a context nobody read (CLAUDE.md Rule 11).'
          : requestedPlanArchived
          ? 'the caller supplied a plan_id that is archived or not owned by this runner. The '
            + 'write was rolled back rather than silently retargeted onto whatever plan is '
            + 'currently active.'
          : 'no active plan could be resolved for this write, so it was rolled back. This row is '
          + 'owned by the runner and by no plan; its lineage is the orphan marker.',
        planIdForRow,
      );
      return fail(outcome, [reason], [], planIdForRow);
    };

    if ((!planId && touches !== 'authorship') || requestedPlanArchived || planVerificationFailed) {
      return refuseUnverifiable(planVerificationFailed, null);
    }

    // 4 · before-snapshot + context (skipped for authorship: there is nothing
    //     to compare a brand-new plan against).
    let before: PlanSnapshot = { planId: planId ?? '', ...SNAPSHOT_EMPTY };
    let ctx: PlanMutationContext | null = null;
    if (touches !== 'authorship' && planId) {
      before = await snapshotPlan(client, planId);
      if (touches === 'structural') {
        ctx = await loadMutationContext(client, opts.userUuid, planId, opts.todayISO);
        // CONTEXTREAD-1 · REFUSE, do not validate against the fallbacks.
        //
        // This is the posture the callers demand rather than one picked for
        // tidiness. A structural mutation's ONLY gate is the differential
        // doctrine verdict computed from this context. When the reads that
        // build it THREW, the verdict is computed from substituted values that
        // were never established for this runner — so it is not a verdict
        // about him, whichever direction the substitutions happen to lean.
        // Rule 11: the read failing and the value being absent are different
        // facts, and only one of them licenses proceeding.
        //
        // LEDGERHONESTY-1 (2026-09-13) · this comment used to argue the
        // stronger claim — that a failed read DISABLES parts of the check,
        // with a null `trainingDaysPerWeek` read as "no frequency cap at all".
        // Traced against `validate.ts`: there is no frequency cap, the field's
        // one consumer SKIPS §5 at `<= 1`, and a null therefore makes §5
        // stricter. The decision below does not change; only the reason,
        // because a decision defended on a false premise is one nobody can
        // check. See `MutationContextReadFailure`'s header.
        //
        // Nothing has been written yet at this point, so refusing here costs
        // the runner one retry and costs him nothing else.
        if (ctx.readFailed) return refuseUnverifiable('mutation-context', planId);
      }
    }
    ledgerBefore = before.workouts;

    // 5 · the writes.
    const value = await opts.apply(client, planId ?? '');

    const afterPlanId =
      (opts.planIdFromResult ? opts.planIdFromResult(value) : null) ?? planId ?? null;
    if (!afterPlanId) {
      // Authorship that produced no plan id — nothing was created. Commit
      // whatever ran (typically a no-op) and say so.
      await landInTx(
        'APPLY', 'applied', [],
        'authorship ran and produced no plan id, so no plan was created. Nothing was '
        + 'prescribed and nothing changed.',
        null,
      );
      await client.query('COMMIT');
      return { ok: true, outcome: 'applied', value, violations: [], preExisting: [], resolved: [], planId: null };
    }

    // 6 · after-snapshot + verdict.
    const after = await snapshotPlan(client, afterPlanId);
    ledgerAfter = after.workouts;

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
        await land(
          'REFUSE', 'undeclared_structural', v,
          'the caller declared a derivations-only write and moved a structural field, so the '
          + 'whole batch was rolled back',
          afterPlanId,
        );
        return fail('undeclared_structural', v, [], afterPlanId);
      }
      producedPlanVersion = await stampAdapted(afterPlanId, value);
      await landInTx(
        'APPLY', 'applied', [],
        'derivations-only write applied · paces, spec, labels and notes moved and the '
        + 'structural fingerprint did not',
        afterPlanId,
      );
      await client.query('COMMIT');
      return { ok: true, outcome: 'applied', value, violations: [], preExisting: [], resolved: [], planId: afterPlanId };
    }

    if (touches === 'authorship') {
      // REPORT ONLY. Never rolls back — see DESIGN DECISION 2.
      //
      // The snapshot and the context are read on the transaction (so they see
      // one consistent view of what was just written), and the VALIDATION runs
      // inside a try. Report-only has to mean report-only: a crash in the
      // validator must not be able to take a runner's plan generation down with
      // it. The pre-persist `validateComposedPlan` is still the gate that
      // decides whether a plan is authored at all.
      //
      // LEDGERATOMIC-1 · the check used to run AFTER the commit, because
      // "report-only" was implemented as "too late to matter". It now runs
      // before, still inside its own try, and the containment is unchanged —
      // a thrown validator leaves `drift` empty and the plan commits, exactly
      // as it did. What changed is that the ledger row can now carry the drift
      // verdict and be part of the same commit, instead of being written on a
      // second connection afterwards where it could be lost.
      const authorCtx = await loadMutationContext(client, opts.userUuid, afterPlanId, opts.todayISO);
      let drift: string[] = [];
      // CONTEXTREAD-1 · the OPPOSITE posture from the structural exit above,
      // and it is the corollary, not an inconsistency. This check is
      // REPORT-ONLY by design (DESIGN DECISION 2): a rolled-back rebuild
      // leaves the runner with no plan at all, which is strictly worse than an
      // ungraded one. So a failed context read must not refuse here.
      //
      // What it must not do either is report "no drift" as though the check
      // had run — the same three-facts problem wearing a green tick. An empty
      // `drift` from a context that could not be read is "we did not look",
      // and that is now said out loud on the row and in the log rather than
      // being indistinguishable from a clean read-back.
      if (authorCtx.readFailed) {
        console.error(
          `[plan/mutate] AUTHORSHIP READ-BACK NOT GRADED · source=${opts.source} `
          + `plan=${afterPlanId} · the validator context could not be read `
          + `(plan=${authorCtx.readFailed.plan} profile=${authorCtx.readFailed.profile}), so this `
          + 'plan was committed WITHOUT a persisted-drift check. Not "no drift found".',
        );
      } else {
        try {
          drift = violationsOf(after, authorCtx);
        } catch (e) {
          console.error(
            `[plan/mutate] authorship read-back check errored (plan commits regardless) · ` +
            `source=${opts.source} ·`,
            e instanceof Error ? e.message : e,
          );
        }
      }
      /* LEDGER-1 · THE ROW THAT MAKES A REBUILD PRESERVE THE LEDGER.
       *
       * `replacedPlanId` was read before `apply` archived it, and
       * `resolvePlanLineage` carries the replaced plan's lineage onto this new
       * plan — so every decision ever made against the old block stays
       * queryable by `plan_lineage_id` after the rebuild that discarded the
       * block itself. This is the whole reason the lineage column exists.
       *
       * Direction is UNKNOWN by construction: `ledgerBefore` is empty for an
       * authorship, because a 14-week new block and four remaining weeks of an
       * old one are not comparable quantities and calling their difference a
       * coaching direction would put fiction into Rule 21's census. */
      await landInTx(
        'APPLY', drift.length > 0 ? 'authorship_drift' : 'applied', drift,
        /* LINEAGEREAD-1 · THREE sentences, because there are three facts. The
         * middle one did not exist and its case was printed as the third —
         * "replaced nothing" — which is an assertion about the runner's plan
         * history made from a read that never completed, written into a
         * durable record that outlives the request. */
        (replacedPlanId
          ? `a new plan was authored, replacing ${replacedPlanId}, whose ledger lineage it `
            + 'inherits. Direction is unmeasured: two different blocks are not comparable.'
          : replacedPlanUnknown
          ? 'a new plan was authored. WHETHER IT REPLACED AN EARLIER PLAN IS UNKNOWN: the lineage '
            + 'lookup failed outright, so this row carries a lineage-unknown marker rather than '
            + 'claiming it replaced nothing. Do not read this row as the start of a lineage. '
            + 'Direction is unmeasured: two different blocks are not comparable.'
          : 'a new plan was authored and replaced nothing. This row opens its lineage.')
        + (authorCtx.readFailed
          ? ' The persisted-drift read-back did NOT run: its validator context could not be read, '
            + 'so an empty violation list here means "not checked", not "clean".'
          : ''),
        afterPlanId,
      );
      await client.query('COMMIT');
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
    // CONTEXTREAD-1 · step 4 already refused on `ctx.readFailed`, so this only
    // fires for the `??` limb — a structural mutation whose plan id was not
    // resolvable until `planIdFromResult` ran. Same reason, same refusal, and
    // it ROLLS BACK writes that have already been issued, which is the point:
    // a write graded by a gate whose inputs did not load has not been graded.
    if (useCtx.readFailed) return refuseUnverifiable('mutation-context', afterPlanId);
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
      await land(
        'REFUSE', 'rejected', diff.introduced,
        `rolled back · this mutation introduced ${diff.introduced.length} doctrine violation(s) `
        + 'the plan did not already carry',
        afterPlanId,
      );
      return fail('rejected', diff.introduced, diff.preExisting, afterPlanId);
    }

    producedPlanVersion = await stampAdapted(afterPlanId, value);
    await landInTx(
      'APPLY', 'applied', [],
      diff.resolved.length > 0
        ? `applied · it also repaired ${diff.resolved.length} pre-existing violation(s)`
        : 'applied · it introduced no doctrine violation the plan did not already carry',
      afterPlanId,
    );
    await client.query('COMMIT');
    return {
      ok: true, outcome: 'applied', value,
      violations: [], preExisting: diff.preExisting, resolved: diff.resolved,
      planId: afterPlanId,
    };
  } catch (e) {
    try { await client.query('ROLLBACK'); }
    catch (rbErr) { releaseErr = rbErr instanceof Error ? rbErr : new Error(String(rbErr)); }

    /* LEDGERATOMIC-1 · THE LEDGER ITSELF STOPPED THIS MUTATION.
     *
     * Not a caller bug and not a doctrine rejection, so it is a RETURNED
     * verdict rather than a re-throw: a per-runner cron loop must survive it
     * exactly the way it survives a rejection. The plan has already been rolled
     * back whole — that is the guarantee, and it is the reason this branch can
     * report `ledger_unwritten` truthfully rather than hedging.
     *
     * The row for it goes down LANE B, on a fresh connection, because the
     * transaction it would have belonged to no longer exists. If that fails
     * too, it is logged and the returned outcome still tells the truth: the
     * plan did not move. */
    if (e instanceof LedgerRefusedMutation) {
      const outcome: MutationOutcome = e.kind;
      const violations = [e.message];
      console.error(
        `[plan/mutate] ${e.kind === 'duplicate' ? 'DUPLICATE' : 'LEDGER UNWRITTEN'} · `
        + `source=${opts.source} · the plan was rolled back whole · ${e.message}`,
      );
      await recordMutationOutcome({
        userUuid: opts.userUuid, planId: opts.planId ?? null, source: opts.source,
        outcome, violations, preExisting: [], detail: opts.detail ?? null,
      });
      await land(
        'REFUSE', outcome, violations,
        e.kind === 'duplicate'
          ? 'this mutation repeats one already recorded under the same idempotency key, so it was '
            + 'rolled back rather than applied a second time. The original decision stands.'
          : 'the plan mutation was rolled back because its ledger record could not be written. '
            + 'The plan did not move.',
        opts.planId ?? null,
      );
      return fail(outcome, violations, [], opts.planId ?? null);
    }

    /* LEDGER-1 · A CRASH IS A DECISION THAT DID NOT HAPPEN, AND THAT IS A FACT
     * WORTH KEEPING. Without this row, the difference between "the engine
     * considered this and declined" and "the engine tried and the statement
     * blew up" is only visible in a log that has already rotated — Rule 11's
     * exact shape. Contained in its own try so a ledger failure can never
     * replace the caller's real error, which is the one that matters. */
    try {
      await land(
        'REFUSE', 'not_attempted', [e instanceof Error ? e.message : String(e)],
        'the mutation threw and was rolled back whole. Nothing was written to the plan.',
        opts.planId ?? null,
      );
    } catch { /* the original error is the one that propagates */ }
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
