/**
 * lib/postrun/load.ts · the database shell for `lib/postrun/experience.ts`.
 *
 * ONE loader, called by BOTH post-run surfaces. That is the whole point: the
 * brief's first P0 is that Today-after-run and Run Detail "independently
 * compose nearly the same experience from different payloads", and two call
 * sites assembling the same arguments is a parity you have to re-prove after
 * every edit. One loader is a parity you get by construction.
 *
 * ── RULE 14 · THE POPULATION EVERY QUERY READS ──────────────────────────────
 *
 * Stated once, here, because a copy that drifts is the defect class:
 *
 *   · Runs — this `user_uuid`, CANONICAL rows only (`CANONICAL_ROW_SQL`, the
 *     one definition). A merged twin is a duplicate of an activity, not an
 *     activity.
 *   · Plan days — the ACTIVE plan only, joined through `training_plans` with
 *     `archived_iso IS NULL`. Joining `plan_workouts` on `user_uuid` alone
 *     reads every archived version of the plan (ACTIVEPLAN-1), which is how
 *     one week once counted 59 quality sessions.
 *   · Watch completion — `coach_intents` for this runner, matched on the
 *     field's own date suffix where it carries one and otherwise on the
 *     timestamp converted to the RUNNER'S timezone. Same convention as
 *     `loadPhaseBreakdown`; a treadmill completion carries no suffix and a
 *     UTC-date comparison lands it on the wrong day.
 *   · Adaptations — this runner's `plan_adapt_*` intents stamped on or after
 *     the run's own date. Anything earlier is about a different run.
 *
 * ── RULE 11 · WHAT A FAILED READ RETURNS ────────────────────────────────────
 *
 * Every optional load below distinguishes "we looked and found nothing" from
 * "the look failed", and hands the composer the difference. `adaptations` is
 * the sharp case: `[]` produces `PlanImpact.status = 'UNCHANGED'`, `null`
 * produces `'UNKNOWN'`, and printing the first when the second is true is a
 * claim the app did not earn.
 */
import { pool } from '@/lib/db/pool';
import { CANONICAL_ROW_SQL } from '@/lib/runs/volume';
import { runDaySql, runDistanceMiSql, runIdentityMatchSql } from '@/lib/runs/run-shape';
import { runnerTimezoneOrPacific } from '@/lib/runtime/runner-tz';
import { resolveWorkoutVerdict, phasesFromCompletion } from '@/lib/execution/verdict';
import { classifyStoredActivity } from '@/lib/evidence/load-activity-evidence';
import { resolveThresholdCapacity } from '@/lib/training/capacity-resolver';
import { displayTypeFor } from '@/lib/faff/v5-today';
import { workHrCeiling, overallHrCeiling } from '@/lib/prescription/hr-ceiling';
import { runAvgHr } from '@/lib/runs/run-shape';
import { matchRaceForRun, normalizeDataWorkoutType, type RaceForMatch } from '@/lib/runs/log-enrich';
import { distanceMiFromLabel } from '@/lib/race/distance';
import {
  composePostRunExperience,
  type PostRunAdaptation,
  type PostRunExperienceV1,
  type PostRunInput,
} from './experience';
import type { ActivityEvidenceResult } from '@/lib/evidence/activity-evidence';

/** Which `coach_intents.reason` values are a PLAN CHANGE.
 *
 *  An explicit list, not a `LIKE 'plan_adapt%'`, so a future reason has to be
 *  classified deliberately rather than inherited by its prefix. `vdot_auto_recalc`
 *  is here because a re-anchor reprices every unsealed workout, which is a plan
 *  change the runner can see. */
export const PLAN_CHANGE_REASONS: readonly string[] = [
  'plan_adapt_downgrade',
  'plan_adapt_reschedule',
  'plan_adapt_drop_missed',
  'plan_adapt_overridden',
  'plan_adapt_long_floor',
  'plan_adapt_gap',
  'vdot_auto_recalc',
];

/**
 * The engine's own sentence, minus the parts written for an engineer.
 *
 * `plan_adapt_*` rows carry a `why` that a runner could mostly read, with a
 * doctrine citation welded onto the end — "First run back is easy, not
 * quality. Research/22 §14: 1-7 days, resume plan, one easy day instead of
 * first quality." Quoting it whole puts a research reference on the runner's
 * phone; re-wording it invents a claim about a decision this file did not
 * make. So: keep the sentences that carry no citation, drop the ones that do,
 * and return null when nothing survives.
 *
 * ASSERTS THE SHAPE OF WHAT SURVIVES, not the absence of the citation — the
 * citation-scrub bug this repo already shipped ("Cruise intervals · Research/04
 * §5.3." became "Cruise intervals.3.") passed an absence-only test.
 */
export function runnerSafeWhy(why: unknown): string | null {
  if (typeof why !== 'string') return null;
  const kept = why
    .split(/(?<=\.)\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/Research\//i.test(s) && !/§/.test(s));
  if (kept.length === 0) return null;
  const out = kept.join(' ').trim();
  if (out.length === 0) return null;
  return out;
}

export interface PostRunRef {
  /** Either an explicit run id (any spelling the app uses) … */
  runId?: string;
  /** … or the runner's local day, for the Today-after-run surface. */
  dateISO?: string;
}

interface RunRow { id: string; data: Record<string, any> }

async function loadRun(userId: string, ref: PostRunRef): Promise<RunRow | null> {
  if (ref.runId) {
    const r = await pool.query<RunRow>(
      `SELECT id::text AS id, data
         FROM runs
        WHERE user_uuid = $1
          AND ${CANONICAL_ROW_SQL}
          AND ${runIdentityMatchSql('$2')}
        LIMIT 1`,
      [userId, String(ref.runId)],
    );
    if (r.rows[0]) return r.rows[0];
  }
  if (ref.dateISO) {
    // The day's LONGEST canonical run — the same pick `/api/v5/today` makes
    // for its poster, so the two cannot describe different runs.
    const r = await pool.query<RunRow>(
      `SELECT id::text AS id, data
         FROM runs
        WHERE user_uuid = $1
          AND ${CANONICAL_ROW_SQL}
          AND ${runDaySql()} = $2
        ORDER BY ${runDistanceMiSql()} DESC NULLS LAST
        LIMIT 1`,
      [userId, ref.dateISO],
    );
    if (r.rows[0]) return r.rows[0];
  }
  return null;
}

/**
 * THE STORED PHASE ARRAY FOR ONE RUN. One owner, three rungs.
 *
 * Extracted from `loadPostRunExperience` on 2026-09-03 so that
 * `detail-load.ts` — which needs the RAW elements for their `paceSamples`
 * and `hrSamples`, which `GradedPhase` deliberately does not carry — reads
 * the same array through the same ladder rather than writing a second one.
 * A second copy of this resolution is a second answer to "which completion is
 * this run's", and the answer that copy would most likely give is the one
 * SIMROW-1 was written to stop.
 *
 * The three rungs, most specific first, and each a different fact:
 *
 *   1 · the intent this run NAMES via `watchCompletionRef` — one payload, by
 *       id, so a simulator row posted the same day cannot win;
 *   2 · the run row's OWN `data.phases`, written verbatim by the same request;
 *   3 · the legacy date match for rows predating `watchCompletionRef`,
 *       bounded so a `sim-` field can never satisfy it.
 *
 * NOT WRAPPED IN A CATCH. `runnerTimezoneOrPacific` already answers "this
 * runner has no stored timezone" by name; a catch here would also swallow a
 * database failure and answer it with Pacific, which is a guess wearing a
 * default's clothes (Rule 11).
 */
export async function resolveStoredPhases(
  userId: string,
  dateISO: string,
  data: Record<string, any>,
): Promise<unknown[]> {
  const completionRef = [data.watchCompletionRef, data.client_workout_id]
    .find((v) => typeof v === 'string' && v.length > 0) as string | undefined;

  let intentValue: unknown = null;
  if (completionRef) {
    const byRef = await pool.query<{ value: unknown }>(
      `SELECT value FROM coach_intents
        WHERE COALESCE(user_uuid, user_id) = $1 AND reason = 'watch_completion'
          AND field = $2
        ORDER BY ts DESC LIMIT 1`,
      [userId, completionRef],
    );
    intentValue = byRef.rows[0]?.value ?? null;
  }

  let phases = intentValue != null ? phasesFromCompletion(intentValue) : [];
  if (phases.length === 0) phases = phasesFromCompletion(data.phases);
  if (phases.length === 0) {
    const tz = await runnerTimezoneOrPacific(userId);
    const intentRes = await pool.query<{ value: unknown }>(
      `SELECT value FROM coach_intents
        WHERE COALESCE(user_uuid, user_id) = $1 AND reason = 'watch_completion'
          AND field NOT LIKE 'sim-%'
          AND (CASE WHEN field ~ '-[0-9]{4}-[0-9]{2}-[0-9]{2}(#[0-9]+)?$'
                    THEN field ~ ('-' || $2::text || '(#[0-9]+)?$')
                    ELSE (ts AT TIME ZONE $3::text)::date = $2::date END)
        ORDER BY ts DESC LIMIT 1`,
      [userId, dateISO, tz],
    );
    phases = phasesFromCompletion(intentRes.rows[0]?.value);
  }
  return phases;
}

/**
 * Compose the canonical post-run experience for one run.
 *
 * Returns null ONLY when there is no such run for this runner. Every other
 * failure is expressed inside the object, because a surface that draws nothing
 * cannot tell a missing run from a failed load and the runner then sees an
 * empty screen with no reason on it (Rule 11).
 */
export async function loadPostRunExperience(
  userId: string,
  ref: PostRunRef,
): Promise<PostRunExperienceV1 | null> {
  const runRow = await loadRun(userId, ref);
  if (!runRow) return null;
  const data = runRow.data ?? {};
  const dateISO = String(data.date ?? String(data.startLocal ?? '').slice(0, 10));

  // ── the ACTIVE plan's row for the day ────────────────────────────────────
  const planRes = await pool.query<{
    plan_id: string; type: string | null; distance_mi: string | number | null;
    workout_spec: Record<string, unknown> | null; sub_label: string | null;
  }>(
    `SELECT pw.plan_id, pw.type, pw.distance_mi, pw.workout_spec, pw.sub_label
       FROM plan_workouts pw
       JOIN training_plans tp ON tp.id = pw.plan_id
      WHERE tp.user_uuid = $1::uuid
        AND tp.archived_iso IS NULL
        AND pw.date_iso = $2
      ORDER BY pw.id ASC
      LIMIT 1`,
    [userId, dateISO],
  );
  const planRow = planRes.rows[0] ?? null;

  const activePlanRes = await pool.query<{ id: string }>(
    `SELECT id FROM training_plans WHERE user_uuid = $1::uuid AND archived_iso IS NULL ORDER BY authored_iso DESC LIMIT 1`,
    [userId],
  );
  const activePlanId = planRow?.plan_id ?? activePlanRes.rows[0]?.id ?? null;

  /* ── does this run match a recorded RACE (RACEWORD-1, 2026-09-03) ─────────
   *
   * `plannedType` above answers "what did the plan prescribe for this day",
   * and is null on any race that predates a plan, was never scheduled as
   * one, or was a spontaneous entry — which is common for a runner's actual
   * race history. The Americas Finest City half has no matching
   * `plan_workouts` row at all, so `plannedType` is null and the composer
   * had no way to know its five course segments are not repetitions of one
   * thing: `readExecution` printed "Most of the reps sat outside the
   * prescribed range" over named segments (Point Loma Climb, The Drop,
   * Mission Bay...), the same category error `reading-scope.ts`'s grid
   * caption had independently.
   *
   * `matchRaceForRun` against the `races` table is this app's one existing
   * answer to "is this run actually a race" — already proven for the run
   * log's display name (`lib/coach/run-state.ts`'s `runDisplayName`, same
   * query shape). Reused here rather than re-derived, and kept as its own
   * field rather than folded into `plannedType` — PRESCRIBED and ACTUAL are
   * different facts (Rule 16), and a run that races when the plan called
   * for an easy day should not silently look plan-prescribed. */
  let raceMatched = false;
  try {
    const distanceMi = Number(data.distanceMi) || 0;
    if (dateISO) {
      const raceRows = await pool.query<{ slug: string; meta: Record<string, unknown> }>(
        `SELECT slug, meta FROM races WHERE user_uuid = $1 AND meta->>'date' LIKE $2 || '%'`,
        [userId, dateISO],
      );
      const racesForMatch: RaceForMatch[] = raceRows.rows.map((raw) => {
        const meta = (raw.meta ?? {}) as Record<string, unknown>;
        const explicit = meta.distanceMi != null ? Number(meta.distanceMi) : null;
        return {
          slug: String(raw.slug),
          name: meta.name != null ? String(meta.name) : null,
          date: meta.date != null ? String(meta.date).slice(0, 10) : null,
          distanceMi: explicit != null && isFinite(explicit) && explicit > 0
            ? explicit
            : distanceMiFromLabel((meta.distanceLabel as string | null) ?? null),
        };
      });
      const workoutTypeHint = normalizeDataWorkoutType(data.workoutType)
        ?? normalizeDataWorkoutType(data.type)
        ?? null;
      raceMatched = matchRaceForRun({ date: dateISO, distanceMi, workoutTypeHint }, racesForMatch) != null;
    }
  } catch (e) {
    // Best-effort, matching run-state.ts's own posture on this exact query —
    // a failure here loses a nicety (the correct noun), not a safety guard.
    console.error('[postrun/load] race match unresolved — will read as not a race:', e);
  }

  // ── the wrist's completion payload for the day ───────────────────────────
  // NOT wrapped in a catch. `runnerTimezoneOrPacific` already answers the
  // "this runner has no stored timezone" case by name; a catch here would also
  // swallow a database failure and answer it with Pacific, which is a guess
  // wearing a default's clothes (Rule 11).
  /* ── RULE 14 · WHICH COMPLETION IS *THIS RUN'S* (SIMROW-1, 2026-09-02) ────
   *
   * This read used to be "the runner's most recent `watch_completion` intent
   * whose timestamp lands on the run's day", and on 2026-09-02 that returned a
   * SIMULATOR PAYLOAD. Three intents matched the day in production:
   *
   *     sim-recovery-live#1038                              3 phases
   *     sim-recovery-live#1101                              3 phases
   *     0645f40c-...-2026-09-02#0919                       13 phases  ← his run
   *
   * `ORDER BY ts DESC LIMIT 1` took the first. So the post-run screen for his
   * real easy-plus-strides session was composed from a 0.18 mi "Warm-up", a
   * 0.09 mi "Work" at 344 against 391, and a "Recovery" — and it graded that
   * as his workout. It is why the live screen read "The work block came in
   * ahead of the ceiling" over a run that has no such block. Every number the
   * runner saw belonged to somebody's test.
   *
   * The date branch cannot tell them apart by construction: a field with no
   * `-YYYY-MM-DD` suffix falls through to a timestamp comparison, which is the
   * same for every payload posted that day. This is exactly Rule 14's shape —
   * filtering on the runner is not the same as filtering on the right rows.
   *
   * The run row already carries the answer. `watchCompletionRef` is the
   * completion's own `workoutId`, stamped on the row by the same POST that
   * wrote the intent, so it names ONE payload. Three rungs, most specific
   * first, and each is a different fact:
   *
   *   1 · the intent this run says it came from;
   *   2 · the run row's OWN `data.phases`, written verbatim by the same
   *       request — a copy of the same array, on the row it belongs to;
   *   3 · the legacy date match, for rows predating `watchCompletionRef`,
   *       and now bounded to fields that look like a real completion so a
   *       `sim-` payload can never win it.
   */
  const phases = await resolveStoredPhases(userId, dateISO, data);

  // THE canonical grade. Never re-derived on a surface.
  const verdict = resolveWorkoutVerdict({
    type: planRow?.type ?? (data.workoutType as string | null) ?? null,
    spec: planRow?.workout_spec ?? null,
    phases,
  });

  // ── the Evidence Engine ──────────────────────────────────────────────────
  // Null on a failed or impossible classification, which the composer renders
  // as `UNREAD` rather than as "not enough evidence".
  //
  // NOT wrapped in a catch. `classifyStoredActivity` already returns null for
  // "no such canonical row", which is the answer `UNREAD` renders; a catch
  // would fold a database failure into that same null and the runner would
  // read "has not been read yet" over an outage. A throw reaches the route,
  // which omits the section rather than filling it with a guess.
  /* ── THE CANONICAL CURRENT BELIEF (closure 6, 2026-09-02) ────────────────
   *
   * This call used to pass no options at all, so `currentBelief` was null on
   * every post-run classification this app has ever run. The consequence is
   * not that the tension read was weak — it is that it could not happen:
   * `readBeliefTension` refuses immediately with `no_belief_supplied`, so
   * `PostRunEvidenceImpact.role === 'CHALLENGES'` has never once been reached
   * from a post-run surface, for any run, for any runner. A field that exists
   * and cannot fire is exactly the failure this programme is about.
   *
   * `resolveThresholdCapacity` is the owner CLAUDE.md names by name — "one
   * canonical resolver per derived value (`resolveThresholdCapacity()`, not
   * four copies)" — and it is asked for the RUN'S OWN DATE, not today's, so a
   * run opened from history is compared against the belief that stood when it
   * happened rather than against a number resolved months later.
   *
   * RULE 11 ON THE FAILURE. A throw here must not become "no tension". It is
   * caught, named, and passed as null — which `readEvidence` now reports as
   * `CURRENT_BELIEF_NOT_SUPPLIED_TO_CLASSIFIER` and refuses to narrate as
   * "supports your current threshold range". The belief resolver is a heavy
   * multi-query read and a post-run screen must not fail because it did. */
  let currentBelief: { thresholdPaceSecPerMi: number; thresholdConfidence: number; asOf: string } | null = null;
  try {
    const belief = await resolveThresholdCapacity(userId, dateISO);
    if (belief?.paceSecPerMi != null && Number.isFinite(belief.paceSecPerMi)) {
      currentBelief = {
        thresholdPaceSecPerMi: belief.paceSecPerMi,
        thresholdConfidence: belief.confidence,
        asOf: dateISO,
      };
    }
  } catch (e) {
    console.error('[postrun/load] threshold belief unresolved — tension read will refuse:', e);
  }

  let evidence: ActivityEvidenceResult | null = null;
  if (/^-?\d+$/.test(runRow.id)) {
    evidence = await classifyStoredActivity(userId, runRow.id, { currentBelief });
  }

  // ── the runner's own effort answer ───────────────────────────────────────
  const rpeIds = Array.from(new Set(
    [data.activityId, data.id, runRow.id].filter((v) => v != null).map(String),
  ));
  const rpeRes = await pool.query<{ rpe: number | null }>(
    `SELECT rpe FROM post_run_rpe
      WHERE (user_uuid = $1 OR user_id::text = $1::text)
        AND activity_id = ANY($2::text[])
      -- THE RUNNER'S OWN ANSWER WINS. pullSync auto-imports Strava's
      -- perceived_exertion and stamps it 'auto-imported from strava', so a run
      -- the runner answered can still collect a later row from the importer.
      -- Ordering by time alone replaces what he said with what Strava guessed.
      -- Same clause as /api/v5/today and lib/watch/build-workout.ts.
      ORDER BY (notes IS DISTINCT FROM 'auto-imported from strava') DESC,
               logged_at DESC
      LIMIT 1`,
    [userId, rpeIds],
  );
  const rpe = rpeRes.rows[0]?.rpe ?? null;

  // ── what moved in the plan since this run ────────────────────────────────
  // `null` on a failed read. See the header.
  let adaptations: PostRunAdaptation[] | null = null;
  try {
    /* RULE 14 · THE WINDOW IS BOUNDED AT BOTH ENDS.
     *
     * This was `ts >= $3::date` with no upper bound, so every adaptation the
     * engine had EVER recorded after a run's date counted as "the plan moved
     * after this run". Swept over the runner's own 40 most recent runs on
     * 2026-09-02, that reported `UPDATED` on five historical days whose
     * "change" was a missed-long note filed a week later about a different
     * run. A query that reads the right runner and the wrong rows is the
     * defect Rule 14 is named for.
     *
     * Two days is the honest window: `run-adaptations` is a nightly cron, and
     * Rule 23's own measurements have it firing five to twelve hours late, so
     * one day is too tight to catch a late pass and three would reach the next
     * run's. A pass that has not fired yet returns nothing, which reads as
     * `UNCHANGED` — correct, because nothing has moved. */
    const rows = await pool.query<{ reason: string; value: unknown }>(
      `SELECT reason, value FROM coach_intents
        WHERE COALESCE(user_uuid, user_id) = $1
          AND reason = ANY($2::text[])
          AND ts >= $3::date
          AND ts < ($3::date + INTERVAL '2 days')
        ORDER BY ts DESC
        LIMIT 8`,
      [userId, PLAN_CHANGE_REASONS as string[], dateISO],
    );
    adaptations = rows.rows.map((r): PostRunAdaptation => {
      let v: any = r.value;
      if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
      return { reason: r.reason, display: runnerSafeWhy(v?.why) ?? 'The plan was adjusted.' };
    });
  } catch {
    adaptations = null;
  }

  /* THE CEILINGS, PER SCOPE, from their one owner.
   *
   * `workHrCeiling` reads the spec's own `pass` rule — "Pass: avgHr <= 164 on
   * the work" on the owner's 2026-09-01 threshold session — which no server
   * reader had ever looked at. `overallHrCeiling` is `hr_cap_bpm` and nothing
   * else. Neither falls through to the other: they bound different quantities
   * and `readCost` pairs each with the mean it may honestly be read against. */
  const workCeiling = workHrCeiling(planRow?.workout_spec ?? null);
  const overallCeiling = overallHrCeiling(planRow?.workout_spec ?? null);

  // SENSOR-LIMITED comes from the Evidence Engine's own per-signal grading
  // where we have it, and from the row's bare facts where we do not. It is
  // never inferred from an absent number alone.
  const sig = evidence?.eligibility.signals ?? null;
  const sensorLimited = sig
    ? (sig.hr === 'unusable' || sig.hr === 'low') && (sig.pace === 'unusable' || sig.pace === 'low')
    : evidence != null
      ? !evidence.eligibility.admissible
      : false;

  const input: PostRunInput = {
    runId: runRow.id,
    dateISO,
    plannedType: planRow?.type ?? null,
    plannedTypeDisplay: planRow?.type ? displayTypeFor(planRow.type, planRow.sub_label) : null,
    plannedDistanceMi: planRow?.distance_mi != null ? Number(planRow.distance_mi) : null,
    raceMatched,
    verdict,
    evidence,
    workHrCeilingBpm: workCeiling?.bpm ?? null,
    overallHrCeilingBpm: overallCeiling?.bpm ?? null,
    wholeRunHrBpm: runAvgHr(data as any),
    rpe: rpe != null ? Number(rpe) : null,
    adaptations,
    hasActivePlan: activePlanId != null,
    activePlanId,
    sensorLimited,
    /* THE SPEC'S OWN STRIDE COUNT. Three states, not two (Rule 11): a number
     * is what the session asked for, 0 is a session that asked for none, and
     * null is "there was no plan row to read", which is the only state that
     * must not license the label-matching fallback in `isStridePhase`. */
    stridesPrescribed: (() => {
      const spec = planRow?.workout_spec;
      if (!spec || typeof spec !== 'object') return null;
      const n = Number((spec as Record<string, unknown>).strides_reps ?? 0);
      return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
    })(),
    /* THE THREE QUANTITIES `readCapture` RECONCILES, read from three different
     * places on the row because they are three different facts. On the
     * 2026-09-02 run they are 6.41 mi, 5.98 mi and 5.00 mi, and every one of
     * them is correct. */
    recordedDistanceMi: Number.isFinite(Number(data.distanceMi)) ? Number(data.distanceMi) : null,
    recordedDurationSec: Number.isFinite(Number(data.durationSec)) ? Number(data.durationSec) : null,
    structuredDistanceMi: (() => {
      const list = verdict.phases;
      if (list.length === 0) return null;
      let mi = 0;
      let any = false;
      for (const p of list) if (p.actualDistanceMi != null) { mi += p.actualDistanceMi; any = true; }
      return any ? Math.round(mi * 100) / 100 : null;
    })(),
    structuredDurationSec: (() => {
      const list = verdict.phases;
      if (list.length === 0) return null;
      let sec = 0;
      let any = false;
      for (const p of list) if (p.actualDurationSec != null) { sec += p.actualDurationSec; any = true; }
      return any ? Math.round(sec) : null;
    })(),
    /* WHAT THE MILE TABLE CAN DRAW. Read straight off the stored array rather
     * than through `pickSplits`, because the question here is only "how much of
     * the run do these rows cover" — the richer which-array-wins resolution
     * belongs to the surface that draws them, and duplicating it would be a
     * second answer to a question that has an owner (Rule 16). A split with no
     * length is one mile, which is the same convention `splitsCoverageMi`
     * uses. */
    splitCount: Array.isArray(data.splits) ? (data.splits as unknown[]).length : null,
    splitDistanceMi: Array.isArray(data.splits)
      ? Math.round((data.splits as Array<Record<string, unknown>>).reduce((a, sp) => {
          const raw = sp.distanceMi ?? sp.distance_mi;
          const d = raw == null ? 1 : Number(raw);
          return a + (Number.isFinite(d) && d > 0 ? d : 1);
        }, 0) * 100) / 100
      : null,
    /* PROVENANCE, because it changes what may be said. See `readCapture`. */
    correctedManually: !!(data.manualCorrection && typeof data.manualCorrection === 'object'),
    clockAudit: (() => {
      const a = data.clockAudit;
      if (!a || typeof a !== 'object') return null;
      const r = a as Record<string, unknown>;
      const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : null);
      // `pausedSec` and `declinedSec` are deliberately NOT carried. No Swift
      // file sends either, so the route's `Number(body.pausedSec) || 0` makes
      // both structurally zero on every row, and a zero meaning "nobody said"
      // must not travel beside three real measurements (Rule 11).
      return { driftSec: n(r.driftSec), wallSec: n(r.wallSec), countedSec: n(r.countedSec) };
    })(),
  };
  return composePostRunExperience(input);
}
