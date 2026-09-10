/**
 * lib/plan/volume-evidence-loader.ts · VOLUMESEAM-1 · THE READ THAT MAKES THE
 * VOLUME-EVIDENCE DIRECTORY REACH A RUNNER.
 *
 * ── WHY THIS FILE IS IN `lib/plan` AND NOT IN `lib/adaptation` ────────────
 *
 * `lib/adaptation/_zero_mutation_scan.test.ts` walks `lib/adaptation`
 * recursively and fails any file there that names a plan writer or writes a
 * table it does not own. That guard is correct and stays. So the seam between
 * "the evidence directory computes" and "the runner is offered something"
 * lives OUTSIDE it, in exactly two files — this one, which only READS, and
 * `volume-evidence-proposal.ts`, which raises the card.
 *
 * The import of `@/lib/adaptation/volume-evidence/*` from here is not an
 * accident to be tolerated; it is the auditable seam, and it is recorded as
 * one in `_zero_mutation_scan.test.ts`'s `PERMITTED_EXTERNAL_IMPORTS` ratchet
 * with its reason written out.
 *
 * ── RULE 14 · THE POPULATION THIS FILE READS, NAMED ───────────────────────
 *
 * Every query here states its scope, and each one is a defect this repo has
 * already shipped once:
 *
 * · runs · `resolveDateRangeExecutions` (`lib/execution/day-resolver.ts`),
 *   which resolves through `getCanonicalRunIds` and `runNotMergedSql`. So the
 *   canonical predicate is `NOT (data ? 'mergedIntoId')` and it is the ONE
 *   copy, never re-typed here. On the reference account 76 merged run-days
 *   carrying 946.9 mi sit inside a single year; reading them would manufacture
 *   a surplus in most weeks of it.
 * · prescriptions · the same resolver, which reads the prescription side
 *   through `ownedDaysSql` — REIGN-AWARE. The plan that owned each date, not
 *   "the active plan" (which would price January against a block authored in
 *   September) and not "every `plan_workouts` row for this user" (which is the
 *   47-versions defect Rule 14 is named for; this account carries 49).
 * · plan weeks · keyed on `(plan_id, week_start_iso)`, and the phase label is
 *   JOINED on `plan_phases (id, plan_id)` rather than on `phase_id` alone,
 *   because phase rows exist for every version this runner has ever had.
 * · future weeks · the ACTIVE plan only (`archived_iso IS NULL`), because a
 *   proposal is an offer about the plan on his phone.
 * · races · every race with a real result, for Rule 8's windows, resolved
 *   through `prescribedWindowsFrom` rather than a hand-rolled window.
 *
 * ── RULE 11 · WHAT A REFUSAL LOOKS LIKE HERE ──────────────────────────────
 *
 * `VolumeEvidenceLoad`'s refusal branch carries NO `window` field, so a caller
 * cannot spend an empty read as "he has no evidence". Every refusal says which
 * of the three facts it is. In particular a runner with no active plan, a plan
 * with no load contract stamp, and a plan whose weeks all lie in the past are
 * THREE DIFFERENT refusals, and they are not collapsed.
 *
 * ── RULE 22 · WHAT A GATE OVER THIS FILE CANNOT FAIL ON ───────────────────
 *
 * · It cannot fail on a WRONG WEEK GRID. The grid is `plan_weeks.week_start_iso`
 *   of the plan that owned each week. A block authored with the wrong week
 *   boundary produces weeks that are internally consistent and wrong, and no
 *   assertion here can see it.
 * · It cannot fail on a run that never synced, or on a mis-dated one. An
 *   absent row and a run that did not happen are indistinguishable from the
 *   database, which is why the FOLLOWING week's completion is read as a
 *   measurement rather than as proof of anything.
 * · It cannot fail on deterioration or heart-rate credibility. Neither is
 *   reconstructed here; both arrive as REFUSALS, which withhold a raise rather
 *   than granting one. That is the conservative direction and it means this
 *   loader can under-report evidence and never over-report it.
 * · It cannot fail on the seam being shut. It returns a read.
 * · It cannot tell ILLNESS_OR_INJURY from MISSED_TRAINING. Nothing in this
 *   schema records that a week was short because the runner was sick or
 *   hurt, so `declaredCause` never resolves to ILLNESS_OR_INJURY here and
 *   `classifyLowWeek` answers MISSED_TRAINING for one, which withholds
 *   rather than grants — the safe direction.
 *
 * TRAVELWINDOW-1 (2026-09-09) · TRAVEL_OR_LIFE IS NO LONGER ONE OF THOSE
 * BLIND SPOTS. `travel_windows` (the runner's own declared away-dates,
 * `lib/plan/travel-store.ts`) is joined into this read the same way Rule 8's
 * race windows already are two lines below: read once for the whole
 * historical range, then asked per week. A week any of whose days falls
 * inside a travel window now stamps `declaredCause: measured('TRAVEL_OR_LIFE')`
 * BEFORE `classifyLowWeek` ever sees it, so three or more consecutive travel
 * weeks can no longer fall through to `GENUINE_CAPACITY_LOSS` and lower a
 * belief that was never about capacity at all (the exact shape Rule 8's
 * corollary warns about, and the gap this file's own header used to name).
 * Catch-guarded with an empty-array fallback per `travel-store.ts`'s own
 * convention (the table may not exist, or the read may fail) — a runner with
 * no declared travel reads byte-identically to before this landed.
 */
import { pool } from '@/lib/db/pool';
import { roundTo } from '@/lib/format/run';
import { resolveDateRangeExecutions } from '@/lib/execution/day-resolver';
import {
  prescribedWindowsFrom,
  isPrescribedNonNormal,
  SUSTAINED_WEEK_RANK,
  type RanRace,
} from '@/lib/training/normal-window';
import { distanceMiOfMeta } from '@/lib/race/distance';
// TRAVELWINDOW-1 · the runner's own declared travel dates, read through the
// SAME accessor `generate.ts`'s authoring pass and `adapt.ts`'s reschedule
// search already use (`travel-store.ts`'s own header names both). No second
// reader of `travel_windows` invented for this file.
import { travelWindowsOverlapping } from '@/lib/plan/travel-store';
import { isTravelDay, type TravelWindow } from '@/lib/plan/travel-windows';
/* RUN-SHAPE LINT · the sanctioned fragments, never a hand-rolled literal.
 * Nothing checks that a hand-typed jsonb key names a real one, and there is
 * exactly one correct answer to "which run is the merge loser" (Rule 14). */
import { runDaySql, runMergedIntoIdSql } from '@/lib/runs/run-shape';
import { runAvgHr, runMovingSec, runTempF, type RunData } from '@/lib/runs/run-shape';
/* PAHR-QUANTITY-1 · the whole-run terrain read, reused rather than
 * re-derived: `resolveRunTerrain` already knows the four elevation
 * conventions `runs.data` carries and the treadmill trap, and this file has
 * no business re-deciding any of that for a readability check (Rule 16). */
import { resolveRunTerrain } from '@/lib/terrain/run-terrain';
/* CONDITIONS 2 AND 3, RECONSTRUCTED RATHER THAN REFUSED · Rule 16.
 * `canonical-shadow/live-input.ts` already owns "is this heart-rate trace
 * worth grading" and "what were this run's thirds", and both are pure
 * functions of one `RunData`. Importing them is what stops this file becoming
 * a second, quieter answer to two questions the canonical engine owns. */
import { isHrReliable, buildThirds } from '@/lib/adaptation/canonical-shadow/live-input';
import {
  assessDeterioration, deteriorationPattern, steadyEffortReadabilityFrac,
  type DeteriorationResult, type SessionEnvironmentalContext,
} from '@/lib/adaptation/canonical/deterioration';
/* Rule 16 · `plan_phases.label` has ONE translator, and this is it. The first
 * cut of `phaseIntentOf` below hand-rolled a switch over BASE/BUILD/PEAK, and
 * the production probe showed what that costs: the live block's phases are
 * QUALITY and RACE-SPECIFIC, neither of which that switch had heard of, so
 * every week of the runner's actual marathon block read as UNKNOWN and the
 * lane refused on a phase it had simply failed to parse. */
import { phaseFromAuthoredLabel } from '@/lib/adaptation/canonical/phase-priority';
import type { HrTraceVerdict } from '@/lib/adaptation/canonical/hr-trace-credibility';
import type { LoadContractStamp } from '@/lib/plan/load-progression-contract';
// Rule 16 · the ONE reader of the authored stamp. Re-typing the
// `authored_state` key lookup here would be a second chance to disagree about
// where a runner's ceiling was authored, and this one already knows the
// pre-contract case.
import { readLoadContractStamp } from '@/lib/plan/adaptive-ramp';
// THE SEAM. Recorded in `_zero_mutation_scan.test.ts`'s permitted-imports
// ratchet; nothing else in `lib/plan` may reach this directory.
import type { CompletedWeek } from '@/lib/adaptation/volume-evidence/after-each-week';
import type { PhaseIntent } from '@/lib/adaptation/volume-evidence/respond';
import {
  absent, failed, measured,
  VOLUME_MIN_CONSECUTIVE_WEEKS,
  VOLUME_WEEK_COMPLETION_MIN_FRAC,
  type FutureWeek,
  type Measured,
  type SurplusRun,
} from '@/lib/adaptation/volume-evidence/contract';

/** One row of the active plan a raise could land on. */
export interface FutureRow {
  readonly planWorkoutId: string;
  readonly dateISO: string;
  readonly type: string;
  readonly distanceMi: number | null;
  readonly isLong: boolean;
  readonly isQuality: boolean;
  readonly planVersion: string;
}

export interface VolumeEvidenceWindow {
  readonly asOfISO: string;
  /** The runner this window was read for. Carried so the decision half needs no caller context. */
  readonly athleteId: string;
  readonly planId: string;
  /** Completed weeks, ascending. What `demonstratedLoadAfterEachWeek` folds. */
  readonly weeks: readonly CompletedWeek[];
  /** Every week of the active plan from `asOfISO` forward, protected ones included. */
  readonly futureWeeks: readonly FutureWeek[];
  /** The rows inside each future week, so a raise can name exact changes. */
  readonly futureRowsByWeek: ReadonlyMap<string, readonly FutureRow[]>;
  readonly weekBeforeFirstFuture: FutureWeek | null;
  readonly phase: PhaseIntent;
  readonly distanceFloorMi: number;
  readonly templatePeakBandMi: readonly [number, number] | null;
  readonly nextBoundaryISO: string | null;
  /** Upward volume steps already taken in this cutback cycle. */
  readonly stepsTakenThisCycle: number;
  readonly sustainedRank: number;
  readonly minConsecutiveWeeksForLoss: number;
  /** Rule 14, measured rather than argued: what the population actually was. */
  readonly population: {
    readonly completedWeeksRead: number;
    readonly canonicalRunsRead: number;
    readonly mergedRunsExcluded: number;
    readonly planVersionsOnAccount: number;
    readonly racesWithResults: number;
  };
}

export type VolumeEvidenceLoad =
  | { readonly ok: true; readonly window: VolumeEvidenceWindow }
  | { readonly ok: false; readonly because: string };

/** How far back the fold reads. Whole weeks, aligned to the plan's own grid. */
export const LOOKBACK_WEEKS = 26;

const addDays = (iso: string, n: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

interface PlanRow { id: string; authored: string; archived: string | null }
interface WeekRow {
  plan_id: string; week_start_iso: string;
  is_cutback: boolean; is_race_week: boolean; phase_label: string | null;
}
interface RowRow {
  id: string; plan_id: string; date_iso: string; type: string;
  distance_mi: string | null; is_long: boolean; is_quality: boolean;
}

/**
 * `plan_phases.label` -> the intent `respondToVolumeEvidence` reads.
 *
 * BASE and BUILD both answer BUILD: `Research/00a` §"Volume progression rules"
 * is a statement about building, and a base phase is the phase whose entire
 * purpose is volume. PEAK is a building week too. TAPER, RACE_WEEK and
 * RECOVERY are not, and `PHASES_THAT_BENEFIT_FROM_MORE_VOLUME` refuses them.
 *
 * An UNRECOGNISED label answers UNKNOWN, which also refuses. Rule 11: a label
 * nobody can read must not default to the permissive answer.
 */
export function phaseIntentOf(label: string | null, isRaceWeek: boolean): PhaseIntent {
  if (isRaceWeek) return 'RACE_WEEK';
  switch (phaseFromAuthoredLabel(label)) {
    /* BASE and QUALITY are both BUILDING phases on the weekly-volume axis.
     * `Research/00a` §"Volume progression rules" is a statement about
     * building, and a base phase is the phase whose entire purpose is volume;
     * a quality phase is still climbing toward the peak. */
    case 'BASE':
    case 'QUALITY': return 'BUILD';
    /* RACE_SPECIFIC is where the block peaks. A peak week is a building week. */
    case 'RACE_SPECIFIC': return 'PEAK';
    case 'TAPER': return 'TAPER';
    case 'RECOVERY': return 'RECOVERY';
    /* MAINTENANCE is deliberately NOT a growing phase — it holds volume — so
     * it refuses, and it refuses as UNKNOWN rather than being relabelled a
     * recovery block, because those are different weeks and a runner-facing
     * sentence calling one the other would be Rule 16 at the level of prose. */
    case 'MAINTENANCE':
    default: return 'UNKNOWN';
  }
}

/**
 * THE READ.
 *
 * `asOfISO` is passed rather than read from a clock so the whole path is
 * replayable against a past date, which is what CLAUDE.md Rule 21's "prove it
 * fires on real history" actually requires of a caller.
 */
export async function loadVolumeEvidence(
  userUuid: string,
  asOfISO: string,
  opts: { lookbackWeeks?: number } = {},
): Promise<VolumeEvidenceLoad> {
  const lookback = opts.lookbackWeeks ?? LOOKBACK_WEEKS;

  /* ── 1 · the plans, and the ACTIVE one ─────────────────────────────── */

  let plans: PlanRow[];
  try {
    plans = (await pool.query<PlanRow>(
      `SELECT id::text AS id,
              to_char(authored_iso,'YYYY-MM-DD') AS authored,
              to_char(archived_iso,'YYYY-MM-DD') AS archived
         FROM training_plans WHERE user_uuid = $1::uuid ORDER BY authored_iso`,
      [userUuid],
    )).rows;
  } catch (e) {
    return { ok: false, because: `The plan list could not be read: ${msg(e)}` };
  }
  if (plans.length === 0) {
    return { ok: false, because: 'This runner has no training plan, so there is no prescription to measure a surplus against.' };
  }
  const active = plans.filter((p) => p.archived == null).at(-1) ?? null;
  if (active == null) {
    return { ok: false, because: 'Every plan on this account is archived. A proposal is an offer about a live plan.' };
  }

  /* ── 2 · the load contract stamp · Rule 16, the authored numbers ────── */

  let stamp: LoadContractStamp | null = null;
  try {
    const r = await pool.query<{ authored_state: Record<string, unknown> | null }>(
      `SELECT authored_state FROM training_plans WHERE id = $1`,
      [active.id],
    );
    stamp = readLoadContractStamp(r.rows[0]?.authored_state ?? {});
  } catch (e) {
    return { ok: false, because: `The plan's load contract stamp could not be read: ${msg(e)}` };
  }
  if (stamp == null) {
    return {
      ok: false,
      because: 'The active plan carries no load progression contract stamp, so the envelope this '
        + 'evidence would be measured against was never authored. Recomputing one here would be a '
        + 'second owner of "how much load".',
    };
  }

  /* ── 3 · the week grid, from the plans that authored it ─────────────── */

  let weekRows: WeekRow[];
  try {
    /* RULE 14, AND THE PROBE EARNED THIS ONE ON ITS FIRST RUN.
     *
     * This said `WHERE w.user_uuid = $1::uuid`, which looks like the same
     * discipline every other query here applies and is NOT. Measured on the
     * live account 2026-09-05: **88 of 672 `plan_weeks` rows carry a NULL
     * `user_uuid`, and all 15 weeks of the CURRENTLY ACTIVE plan are among
     * them.** The column is populated on older rows and stopped being
     * populated at some point, so a filter on it silently returned a block
     * that ended 2026-08-24 while the live plan runs to 2026-11-30 — and the
     * lane refused with "the block is over", confidently, about a plan with
     * fourteen weeks left in it.
     *
     * A week belongs to a PLAN and the plan belongs to the runner. Joining
     * through `training_plans` states that, cannot be defeated by an
     * unpopulated denormalised column, and is the population this reader
     * actually means. The same defect is live in
     * `lib/adaptation/volume-evidence/_replay_real_history.script.ts`.
     *
     * Rule 14's other half applies too: the first version of this query
     * REPRODUCED the bug rather than revealing it, because it reused the
     * reader's own filter. It was found by querying raw and comparing. */
    weekRows = (await pool.query<WeekRow>(
      `SELECT w.plan_id::text AS plan_id, w.week_start_iso::text AS week_start_iso,
              w.is_cutback, w.is_race_week, p.label AS phase_label
         FROM plan_weeks w
         JOIN training_plans tp ON tp.id = w.plan_id AND tp.user_uuid = $1::uuid
         LEFT JOIN plan_phases p ON p.id = w.phase_id AND p.plan_id = w.plan_id`,
      [userUuid],
    )).rows;
  } catch (e) {
    return { ok: false, because: `The plan weeks could not be read: ${msg(e)}` };
  }
  const weekFlag = new Map(weekRows.map((w) => [`${w.plan_id}|${w.week_start_iso}`, w]));

  /** The plan that was live on `iso`. Rule 14: not "the active plan". */
  const planAt = (iso: string): PlanRow | null => {
    const live = plans.filter((p) => p.authored <= iso && (p.archived == null || p.archived > iso));
    return live.at(-1) ?? null;
  };

  /* The grid itself. Every distinct `week_start_iso` the account's plans have
   * authored, inside the look-back, ascending. Using the plans' own week
   * boundary rather than a hard-coded Monday is what keeps this agreeing with
   * `/api/plan/week`, which is the single source of truth for where a week
   * ends on this account. */
  const fromISO = addDays(asOfISO, -lookback * 7);
  const grid = [...new Set(weekRows.map((w) => w.week_start_iso))]
    .filter((ws) => ws >= fromISO && ws < asOfISO)
    .sort();
  if (grid.length === 0) {
    return {
      ok: false,
      because: `No plan week starts inside the ${lookback} weeks before ${asOfISO}. There is no `
        + 'prescription in the window, which is not the same as a runner who ran nothing.',
    };
  }

  /* ── 4 · executions, resolved · Rule 14's canonical predicate ───────── */

  /* COERCION-1 · this was `await planEnd(...).catch(() => null)`, and the scan
   * caught it on the first run. The null branch is a REAL state ("this plan
   * has no dated workouts"), and swallowing the read failure into the same
   * null would silently shrink the execution window — which does not report an
   * error, it reports FEWER FUTURE WEEKS, and a raise that lands on the wrong
   * week is the one failure mode this lane cannot afford. Three states, and
   * the failure refuses. */
  const planEndRead = await planEnd(active.id);
  if (!planEndRead.ok) {
    return { ok: false, because: `The active plan's last dated workout could not be read: ${planEndRead.because}` };
  }
  const planEndISO = planEndRead.value;
  const untilISO = planEndISO == null ? addDays(asOfISO, 7 * 20) : addDays(planEndISO, 1);
  let resolved: Awaited<ReturnType<typeof resolveDateRangeExecutions>>;
  try {
    resolved = await resolveDateRangeExecutions(userUuid, grid[0], untilISO);
  } catch (e) {
    return { ok: false, because: `Executions could not be resolved: ${msg(e)}` };
  }

  /* Merged rows never reach `resolveDateRangeExecutions` — it filters them at
   * the query. Counted separately so Rule 14's claim is MEASURED here rather
   * than asserted in the header. */
  let mergedRunsExcluded = 0;
  try {
    mergedRunsExcluded = Number((await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM runs r
        WHERE r.user_uuid = $1::uuid AND ${runMergedIntoIdSql('r')} IS NOT NULL
          AND ${runDaySql('r')} >= $2 AND ${runDaySql('r')} < $3`,
      [userUuid, grid[0], asOfISO],
    )).rows[0]?.n ?? 0);
  } catch {
    // A count that could not be read is a reporting gap, never a reason to
    // refuse the evidence itself. Left at zero and labelled by the caller.
    mergedRunsExcluded = -1;
  }

  /* ── 5 · races, for Rule 8's windows ────────────────────────────────── */

  let ranRaces: RanRace[] = [];
  try {
    const raceRows = (await pool.query<{ slug: string; d: string | null; meta: unknown; pri: string | null; has: boolean }>(
      `SELECT slug, meta->>'date' AS d, meta, meta->>'priority' AS pri,
              (actual_result IS NOT NULL) AS has
         FROM races WHERE user_uuid = $1::uuid`,
      [userUuid],
    )).rows;
    ranRaces = raceRows
      .filter((r) => r.has && r.d != null && r.d <= asOfISO)
      .map((r) => ({
        slug: r.slug,
        dateISO: r.d as string,
        distanceMi: distanceMiOfMeta(r.meta as Parameters<typeof distanceMiOfMeta>[0]) ?? 0,
        priority: r.pri,
      }))
      .filter((r) => r.distanceMi > 0);
  } catch (e) {
    return { ok: false, because: `The race calendar could not be read, and Rule 8's windows cannot be drawn without it: ${msg(e)}` };
  }
  const windows = prescribedWindowsFrom(ranRaces);

  /* ── 5b · travel windows, for `declaredCause` (TRAVELWINDOW-1) ──────────
   *
   * Read once for the whole historical range (`grid[0]` through `asOfISO`,
   * the same span the week loop below walks), not per week — one query,
   * asked per week the same way Rule 8's `windows` above already is.
   * Catch-guarded with an empty fallback: the table may not exist yet
   * (migration 159 is applied manually, per `travel-store.ts`'s own header),
   * and a runner with no declared travel must read byte-identically to
   * before this existed, never as a refusal of the whole evidence window. */
  let travelWindows: TravelWindow[] = [];
  try {
    travelWindows = await travelWindowsOverlapping(userUuid, grid[0], asOfISO);
  } catch {
    travelWindows = [];
  }

  /* ── 6 · one CompletedWeek per grid week ────────────────────────────── */

  const weeks: CompletedWeek[] = [];
  let canonicalRunsRead = 0;
  for (let i = 0; i < grid.length; i += 1) {
    const ws = grid[i];
    const weekEnd = i + 1 < grid.length ? grid[i + 1] : addDays(ws, 7);
    const plan = planAt(ws);
    const flag = plan == null ? null : weekFlag.get(`${plan.id}|${ws}`) ?? null;

    let prescribedMi = 0;
    const runs: SurplusRun[] = [];
    /** Every canonical run in the week. Condition 2 (telemetry) reads these. */
    const weekRuns: RunData[] = [];
    /**
     * The week's KEY sessions only — the runs that satisfied a LONG or QUALITY
     * prescription. Condition 3 (deterioration) reads these and nothing else.
     *
     * The production probe is what forced this narrowing, and the number it
     * produced is the argument: assessing every run in the week, easy days
     * included, refused 2026-06-15 — the one week on this account with a real
     * admissible surplus — on "one session showed late deterioration". A
     * slower final third on an easy run is a runner easing home, and
     * `canonical-shadow/live-input.ts` builds thirds for LONG RUNS alone for
     * exactly that reason ("Long-run thirds from mile splits"). Reading a
     * recovery jog as a collapsing session is how a guard that exists for key
     * sessions becomes a wall in front of the whole upward lane.
     */
    const weekKeyRuns: { run: RunData; subLabel: string | null }[] = [];
    for (let d = ws; d < weekEnd; d = addDays(d, 1)) {
      const day = resolved.get(d);
      if (day == null) continue;
      for (const p of day.prescriptions) {
        prescribedMi += p.distanceMi ?? 0;
        if (p.matchedRun == null) continue;
        canonicalRunsRead += 1;
        weekRuns.push(p.matchedRun.data);
        if (p.isLong || p.isQuality) {
          // STEADYEFFORT-1 · the matched prescription's own sub_label travels
          // with its run, so the deterioration reading can tell a prescribed
          // fast-finish/progression from a genuine late fade.
          weekKeyRuns.push({ run: p.matchedRun.data, subLabel: p.subLabel });
        }
        runs.push({
          activityId: p.matchedRun.runId,
          dateISO: d,
          distanceMi: p.matchedRun.distanceMi == null
            ? failed('the run carries no readable distance')
            : measured(p.matchedRun.distanceMi),
          match: p.matchedRun.match,
          mergedIntoAnother: false,
          isRace: ranRaces.some((r) => r.dateISO === d),
          prescribedMi: p.distanceMi,
          movedFromDateISO: null,
        });
      }
      for (const s of day.supplementalRuns) {
        canonicalRunsRead += 1;
        weekRuns.push(s.data);
        runs.push({
          activityId: s.runId,
          dateISO: d,
          distanceMi: s.distanceMi == null
            ? failed('the run carries no readable distance')
            : measured(s.distanceMi),
          match: 'supplemental',
          mergedIntoAnother: false,
          isRace: ranRaces.some((r) => r.dateISO === d),
          prescribedMi: null,
          movedFromDateISO: null,
        });
      }
    }

    /* Rule 8's OTHER filter. Any day of the week inside a taper lead-in or a
     * post-race recovery window for a race he actually ran. */
    /* `isPrescribedNonNormal` returns a BOOLEAN, and the first cut of this
     * loop wrote `!= null`, which is true for `false`. Every one of the
     * runner's seventeen weeks came back inside a race window, including
     * weeks two months from any race, and the lane refused with a reason that
     * was individually plausible and completely wrong. Caught by the
     * production probe on its second run, which is the only thing that could
     * have caught it: every synthetic fixture sets this flag directly. */
    let inWindow = false;
    for (let d = ws; d < weekEnd && !inWindow; d = addDays(d, 1)) {
      inWindow = isPrescribedNonNormal(d, windows);
    }

    weeks.push({
      week: {
        weekStartISO: ws,
        prescribedMi: roundTo(prescribedMi),
        runs,
        authoredPlanMode: planModeOf(flag?.phase_label ?? null),
        isCutback: flag?.is_cutback === true,
        isRaceWeek: flag?.is_race_week === true,
        inPrescribedRaceWindow: inWindow,
        dataComplete: true,
      },
      conditions: {
        /* Condition 1 · identity. `resolveDateRangeExecutions` tiered every
         * run above, so every contributing run has a tier. */
        identityResolved: measured(true),
        /* Conditions 2 and 3 · READ, not assumed and not refused wholesale.
         * Both walk the week's own runs; see the two helpers below for what
         * each of the three Rule 11 states means here. */
        telemetry: telemetryOf(weekRuns),
        deterioration: deteriorationOf(weekKeyRuns),
        /* Condition 3's second half · the grades of the week's KEY sessions.
         * Deliberately EMPTY, and that is a MEASURED empty rather than a
         * refusal: `admit.ts` reads a zero-length array as "no key session was
         * prescribed", which is the honest reading for a lever that spends
         * DISTANCE. Grading a session's stimulus is `canonical/stimulus.ts`'s
         * question and reaching for it here would make this file a second
         * grader (Rule 16). The cost is stated in this file's header: a week
         * whose quality sessions established nothing can still contribute
         * volume evidence, bounded by the deterioration read above. */
        keySessionGrades: [],
        painOrInjuryReported: absent('no pain or injury report exists for this account'),
        unplannedRecoveryTaken: absent('unplanned recovery is not recorded on this account'),
        absorptionCompletionBar: VOLUME_WEEK_COMPLETION_MIN_FRAC,
      },
      /* TRAVELWINDOW-1 · a declared travel window is Rule 11's "somebody told
       * us" — measured, not absent — and it is checked here, at the one
       * place `declaredCause` is produced, so `classifyLowWeek` (which
       * already has a TRAVEL_OR_LIFE branch above ILLNESS_OR_INJURY and
       * above the consecutive-capacity-loss check) sees it before any low
       * week from this window could otherwise fall through to
       * GENUINE_CAPACITY_LOSS. Illness has no source in this schema and
       * stays absent, per this file's own header.
       */
      declaredCause: declaredCauseForWeek(ws, weekEnd, travelWindows),
    });
  }

  /* ── 7 · the future half, from the ACTIVE plan only ─────────────────── */

  let rowRows: RowRow[];
  try {
    rowRows = (await pool.query<RowRow>(
      `SELECT id::text AS id, plan_id::text AS plan_id, date_iso::text AS date_iso, type,
              distance_mi::text AS distance_mi, is_long, is_quality
         FROM plan_workouts WHERE plan_id = $1 AND type <> 'rest' ORDER BY date_iso, id`,
      [active.id],
    )).rows;
  } catch (e) {
    return { ok: false, because: `The active plan's workouts could not be read: ${msg(e)}` };
  }

  const activeWeeks = weekRows.filter((w) => w.plan_id === active.id)
    .sort((a, b) => a.week_start_iso.localeCompare(b.week_start_iso));
  const futureWeeks: FutureWeek[] = [];
  const futureRowsByWeek = new Map<string, FutureRow[]>();
  let weekBeforeFirstFuture: FutureWeek | null = null;

  for (let i = 0; i < activeWeeks.length; i += 1) {
    const w = activeWeeks[i];
    const end = i + 1 < activeWeeks.length
      ? activeWeeks[i + 1].week_start_iso : addDays(w.week_start_iso, 7);
    const rows = rowRows.filter((r) => r.date_iso >= w.week_start_iso && r.date_iso < end);
    const rowsMapped: FutureRow[] = rows.map((r) => ({
      planWorkoutId: r.id,
      dateISO: r.date_iso,
      type: r.type,
      distanceMi: r.distance_mi == null ? null : Number(r.distance_mi),
      isLong: r.is_long,
      isQuality: r.is_quality,
      planVersion: active.id,
    }));
    const prescribedMi = roundTo(rowsMapped.reduce((a, r) => a + (r.distanceMi ?? 0), 0));

    /* SEALED · a completed run has already matched a prescription in this
     * week. A week the runner has started answering is not a week a proposal
     * may quietly re-write underneath him. */
    let sealed = false;
    for (const r of rows) {
      const day = resolved.get(r.date_iso);
      if (day != null && day.prescriptions.some((p) => p.id === r.id && p.matchedRun != null)) {
        sealed = true;
        break;
      }
    }

    const fw: FutureWeek = {
      weekStartISO: w.week_start_iso,
      prescribedMi,
      sealed,
      isCutback: w.is_cutback === true,
      isTaper: (w.phase_label ?? '').toUpperCase() === 'TAPER',
      isRaceWeek: w.is_race_week === true,
      stressors: stressorsOf(rowsMapped),
      longestMi: rowsMapped.reduce((a, r) => Math.max(a, r.distanceMi ?? 0), 0),
      mpMi: roundTo(rowsMapped.filter((r) => /marathon|mp\b/i.test(r.type))
        .reduce((a, r) => a + (r.distanceMi ?? 0), 0)),
    };
    if (w.week_start_iso < asOfISO) {
      weekBeforeFirstFuture = fw;
      continue;
    }
    futureWeeks.push(fw);
    futureRowsByWeek.set(w.week_start_iso, rowsMapped);
  }

  if (futureWeeks.length === 0) {
    return {
      ok: false,
      because: 'The active plan has no week starting on or after today, so there is nothing left in '
        + 'it a raise could land on. The block is over, not the evidence.',
    };
  }

  /* ── 8 · phase, cadence and the boundary ────────────────────────────── */

  const currentWeek = activeWeeks.filter((w) => w.week_start_iso <= asOfISO).at(-1)
    ?? activeWeeks[0];
  const phase = phaseIntentOf(currentWeek.phase_label, currentWeek.is_race_week === true);

  /* The last cutback in the ACTIVE plan on or before today opens the current
   * cycle. Upward steps are counted from there, which is what makes
   * `VOLUME_MAX_STEPS_PER_CUTBACK_CYCLE` mean one step per cycle rather than
   * one step ever. */
  const cycleStart = activeWeeks.filter((w) => w.is_cutback && w.week_start_iso <= asOfISO)
    .at(-1)?.week_start_iso ?? activeWeeks[0].week_start_iso;
  let stepsTakenThisCycle = 0;
  try {
    stepsTakenThisCycle = Number((await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM plan_workout_proposals
        WHERE user_uuid = $1::uuid AND action_kind = 'mark_upgrade'
          AND status = 'accepted' AND workout_date_iso >= $2`,
      [userUuid, cycleStart],
    )).rows[0]?.n ?? 0);
  } catch (e) {
    /* Rule 11 · a cadence bound that could not be read must not read as
     * "no steps taken", which is the permissive answer. Refuse. */
    return {
      ok: false,
      because: `Whether a volume step has already been taken in this cutback cycle could not be `
        + `read: ${msg(e)}. Proceeding would spend the cycle's one step twice.`,
    };
  }

  const nextBoundaryISO = futureWeeks.find((w) => w.isCutback)?.weekStartISO ?? null;

  return {
    ok: true,
    window: {
      asOfISO,
      athleteId: userUuid,
      planId: active.id,
      weeks,
      futureWeeks,
      futureRowsByWeek,
      weekBeforeFirstFuture,
      phase,
      distanceFloorMi: stamp.distance_floor_mi,
      templatePeakBandMi: stamp.template_peak_band_mi ?? null,
      nextBoundaryISO,
      stepsTakenThisCycle,
      sustainedRank: SUSTAINED_WEEK_RANK,
      minConsecutiveWeeksForLoss: VOLUME_MIN_CONSECUTIVE_WEEKS,
      population: {
        completedWeeksRead: weeks.length,
        canonicalRunsRead,
        mergedRunsExcluded,
        planVersionsOnAccount: plans.length,
        racesWithResults: ranRaces.length,
      },
    },
  };
}

/**
 * CONDITION 2 · is the week's heart-rate telemetry usable.
 *
 * THREE STATES, and the middle one is the one that matters (Rule 11):
 *
 *   ABSENT   no run in the week carries a heart-rate reading at all. `admit.ts`
 *            reads this as MET, and says why in as many words: "distance is
 *            what this reading spends". A week of easy running off a watch
 *            with no strap is not a week that FAILED a telemetry test.
 *   MEASURED at least one run carries a trace, and `isHrReliable` judged them.
 *            One incredible trace in the week is enough to say so, because the
 *            question is whether this week's telemetry can be trusted, not
 *            whether some of it can.
 *   FAILED    unreachable from here by construction, and deliberately so: a
 *            row that could not be read never reaches this function, because
 *            `resolveDateRangeExecutions` would not have returned it.
 */
export function telemetryOf(runs: readonly RunData[]): Measured<HrTraceVerdict> {
  const withHr = runs.filter((r) => runAvgHr(r) != null);
  if (withHr.length === 0) {
    return absent('no run in this week carries a heart-rate reading');
  }
  const bad = withHr.filter((r) => !isHrReliable(r));
  return measured(bad.length === 0
    ? { credible: true, why: null }
    : {
      credible: false,
      why: `${bad.length} of ${withHr.length} runs in this week carry a heart-rate trace that `
        + 'does not hold together',
    });
}

/**
 * CONDITION 3 · did a session in this week fall away late.
 *
 * Assessed over the week's KEY SESSIONS ONLY — the runs that satisfied a long
 * or quality prescription — through `assessDeterioration`, the canonical
 * owner, and rolled up by `deteriorationPattern`, also the canonical owner.
 * Nothing here judges a session; it supplies thirds and reads the verdict.
 *
 * The narrowing to key sessions is not a loosening. `admit.ts`'s condition 3
 * asks whether "the run did not materially deteriorate", and the run it means
 * is the one carrying the week's stimulus. An easy day that finishes slower
 * than its middle third is a runner easing home; counting it made the guard
 * refuse the only week on the reference account with a real surplus. See this
 * file's header for the measurement.
 *
 * A run with too few splits comes back UNKNOWN, which `deteriorationPattern`
 * counts SEPARATELY from clean. That separation is the whole point:
 * `admit.ts` blocks on `deterioratedCount > 0`, never on `unknownCount`, so a
 * week nobody could read withholds nothing and grants nothing. A week with NO
 * runs at all still returns a measured pattern of zeroes, which is honest —
 * there was no session to fall away.
 *
 * `truncation` is passed as not-truncated because a run whose splits reach a
 * final third was, by that fact, recorded to the end. Reading a truncation
 * flag that this schema does not carry would be inventing a fact.
 */
/**
 * PAHR-QUANTITY-1 · what Research/03 §12 needs to know before trusting a
 * decoupling reading, read off the SAME `RunData` `buildThirds` already
 * reduced to pace and heart rate. Absent rather than guessed wherever the
 * row does not carry the fact (Rule 11) — `decouplingReadabilityFrac` treats
 * an absent factor as fully readable, per its own doc, so this function's
 * job is only to say what IS known, never to fill a gap with an assumption.
 */
/**
 * STEADYEFFORT-1 (2026-09-06) · `subLabel` is the matched `plan_workouts.
 * sub_label` for this exact run, when one exists — the prescribed phase
 * structure `steadyEffortReadabilityFrac` needs to tell a deliberate
 * fast-finish/progression from a genuine fade. `null` for a supplemental run,
 * a race, or any run whose prescription this caller did not carry forward —
 * Rule 11: no prescription to check is not evidence the run was uniform.
 */
function environmentalContextOf(r: RunData, subLabel: string | null): SessionEnvironmentalContext {
  const durationSec = runMovingSec(r);
  const tempF = runTempF(r);
  // `resolveRunTerrain` reads the four elevation conventions `runs.data`
  // carries and the treadmill trap; this file does not re-decide any of
  // that, it only reads the ONE number (`deltaSPerMi`) this readability
  // check needs (Rule 16).
  const terrain = resolveRunTerrain(r as unknown as Parameters<typeof resolveRunTerrain>[0]);
  // `basis` 'none' (no elevation signal at all) and 'treadmill-incline-unknown'
  // (a treadmill row whose belt angle was never recorded) BOTH resolve to
  // `deltaSPerMi: 0` inside `runGradeAdjustment`, and that zero means "we did
  // not check", not "this run was measured flat" (Rule 11) — reading it as a
  // measured zero would tell `decouplingReadabilityFrac` this run definitely
  // had no terrain confound when the honest answer is nobody knows.
  const terrainKnown = terrain.basis !== 'none' && terrain.basis !== 'treadmill-incline-unknown';
  return {
    analyzedDurationMin: durationSec != null && durationSec > 0
      ? measured(durationSec / 60)
      : absent('no moving time recorded for this run'),
    terrainDeltaSPerMi: terrainKnown
      ? measured(terrain.deltaSPerMi)
      : absent(`no usable terrain signal on this run (basis: ${terrain.basis})`),
    tempF: tempF != null ? measured(tempF) : absent('no weather recorded for this run'),
    steadyEffortFrac: steadyEffortReadabilityFrac(subLabel, r.distanceMi ?? 0),
  };
}

export function deteriorationOf(
  keyRuns: readonly { run: RunData; subLabel: string | null }[],
): Measured<ReturnType<typeof deteriorationPattern>> {
  const results: DeteriorationResult[] = keyRuns.map(({ run, subLabel }) => assessDeterioration(
    buildThirds(run),
    { truncated: false, completeWorkPhasesCaptured: true, note: '' },
    environmentalContextOf(run, subLabel),
  ));
  return measured(deteriorationPattern(results));
}

/**
 * TRAVELWINDOW-1 · what `declaredCause` becomes for one grid week, given the
 * runner's own declared travel windows. Pure — no DB, no clock — so it is
 * directly testable the same way `raceSuppressesOvershoot`
 * (`adapt.ts`/`_overshoot_race_recency.test.ts`) already is, without needing
 * to stand up the whole `loadVolumeEvidence` query chain.
 *
 * `weekEndISO` is EXCLUSIVE, matching every other week-boundary walk in this
 * file (the grid's own `weekEnd`). A week where ANY day falls inside ANY
 * travel window declares TRAVEL_OR_LIFE for the whole week — see the call
 * site for why a partial-week travel day is not treated as a partial cause.
 *
 * Illness has no source in this schema (this file's own header says so), so
 * this function can only ever answer TRAVEL_OR_LIFE or ABSENT — never
 * ILLNESS_OR_INJURY, which stays a real, distinct, currently-unreachable
 * branch of `classifyLowWeek` until something declares it.
 */
export function declaredCauseForWeek(
  weekStartISO: string,
  weekEndISO: string,
  travelWindows: readonly TravelWindow[],
): Measured<'TRAVEL_OR_LIFE' | 'ILLNESS_OR_INJURY'> {
  for (let d = weekStartISO; d < weekEndISO; d = addDays(d, 1)) {
    if (isTravelDay(d, travelWindows)) return measured('TRAVEL_OR_LIFE');
  }
  return absent('nothing on this account records why a week came in short');
}

/** The phase label as the week's AUTHORING INTENT, which is Rule 8's first filter. */
function planModeOf(label: string | null): 'BUILD' | 'RECOVERY' | 'TAPER' | 'UNKNOWN' {
  switch ((label ?? '').toUpperCase()) {
    case 'BASE':
    case 'BUILD':
    case 'PEAK': return 'BUILD';
    case 'TAPER': return 'TAPER';
    case 'RECOVERY': return 'RECOVERY';
    default: return 'UNKNOWN';
  }
}

/**
 * The named stressors in a week, for `detectSimultaneousStressAddition`.
 *
 * Deliberately coarse and deliberately NOT a second workout taxonomy: it names
 * the three stressors doctrine's one-stressor-at-a-time row is stated about.
 * Rule 22, said where it bites: this loader's stressor naming is exactly what
 * step 7 of `respondToVolumeEvidence` is only as good as, and a week whose
 * quality rows are typed unusually will under-report.
 */
export function stressorsOf(rows: readonly FutureRow[]): string[] {
  const out = new Set<string>();
  for (const r of rows) {
    if (r.isQuality) out.add('quality');
    if (r.isLong) out.add('long');
    if (/marathon|mp\b/i.test(r.type)) out.add('marathon_pace');
  }
  return [...out].sort();
}

/**
 * The plan's last dated workout, in three states.
 *
 * `value: null` means the plan HAS no dated workout — real, and handled by
 * falling back to a fixed horizon. A failed read is a refusal and carries no
 * `value` field at all, so a caller cannot spend one as the other (Rule 11,
 * and the shape `NormalReading<T>` established).
 */
async function planEnd(
  planId: string,
): Promise<{ ok: true; value: string | null } | { ok: false; because: string }> {
  try {
    const r = await pool.query<{ d: string | null }>(
      `SELECT max(date_iso)::text AS d FROM plan_workouts WHERE plan_id = $1`, [planId],
    );
    return { ok: true, value: r.rows[0]?.d ?? null };
  } catch (e) {
    return { ok: false, because: msg(e) };
  }
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
