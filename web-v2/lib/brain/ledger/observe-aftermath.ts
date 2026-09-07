/**
 * lib/brain/ledger/observe-aftermath.ts · WHAT ACTUALLY HAPPENED AFTER.
 *
 * The reader half of step 16, split from the classifier so the classifier stays
 * pure and walkable and this stays the ONE place the aftermath is read
 * (Rule 16). A second reader would be a second opinion about what a runner did.
 *
 * Every field is null when it could not be read, never zero. Rule 11 is the
 * whole contract here: a window with no runs recorded and a window the reader
 * could not open are opposite facts, and the classifier turns the second into
 * UNRESOLVED rather than into a verdict.
 */

import { pool } from '@/lib/db/pool';
import { attempt } from '@/lib/db/read';
import { CANONICAL_ROW_SQL } from '@/lib/runs/volume';
import { runDaySql, runDistanceMiSql } from '@/lib/runs/run-shape';
import { loadSafetyInputs } from '@/lib/safety/load-safety';
import type { ObservedAftermath } from './outcome';

const UNREAD: ObservedAftermath = {
  prescribedMi: null, completedMi: null, deterioratedSessions: null, gradedSessions: null,
  painOrInjuryReported: null, laterPerformanceImproved: null, missedPrescribedDays: null,
};

export async function observeAftermath(
  d: { readonly user_uuid: string },
  fromISO: string,
  toISO: string,
): Promise<ObservedAftermath> {
  /* Rule 14 · the scope is stated. Canonical rows only (`mergedIntoId` marks a
   * duplicate that must not be counted twice), and the ACTIVE plan only — the
   * owner alone has 49 plan versions, and a join on user_uuid reads them all. */

  /* ── OBSERVEAFTERMATH-1 (2026-09-07) · THE READ THAT ALWAYS FAILED ───────
   *
   * The `comp` CTE below compared `runDaySql()` against `$2::date`, and
   * `runDaySql()` returns TEXT — `COALESCE(data->>'date', LEFT(data->>
   * 'startLocal', 10))`. Postgres has no `text >= date` operator, so the whole
   * statement threw 42883 EVERY TIME, `attempt` returned not-ok, and this
   * function answered `UNREAD` for every decision ever judged. Step 16's sweep
   * therefore reported `UNRESOLVED` for all of them — the engine could not
   * tell whether a single one of its own decisions had worked.
   *
   * Found by running the nightly cron against real data (Rule 13). No test
   * caught it because none of them reached this query with a live pool, which
   * is Rule 15 exactly: a mechanism no case can reach is untested however many
   * cases pass.
   *
   * The fix compares TEXT on both sides rather than casting the run side to
   * `::date`. ISO-8601 days sort lexicographically, so the comparison is
   * exact, and a malformed `startLocal` fallback then MISMATCHES instead of
   * throwing — one unreadable row can no longer destroy the whole reading
   * (Rule 11).
   *
   * AND THE PART THAT COST A SECOND ROUND. Removing the casts from the `comp`
   * CTE alone did NOT fix it, and the query kept throwing the identical error.
   * A bound parameter has ONE type for the whole statement, and the surviving
   * `$2::date` in the `pres` CTE typed `$2` as `date` — so `comp`'s
   * cast-free `text >= $2` was still `text >= date`. Both CTEs now compare
   * text, which is exact for ISO-8601 and is what both columns actually hold
   * (`plan_workouts.date_iso` is TEXT as well).
   *
   * The first fix looked right, typechecked, and was still wrong. It was
   * caught by running it (Rule 13) and by nothing else. */
  const r = await attempt(
    'ledger/observe-aftermath',
    pool.query<{
      prescribed: string | null; completed: string | null;
      graded: string | null; missed: string | null;
    }>(
      `WITH pres AS (
         SELECT coalesce(sum(pw.distance_mi), 0) AS mi,
                count(*) FILTER (WHERE pw.type <> 'rest') AS days
           FROM plan_workouts pw
           JOIN training_plans tp ON tp.id = pw.plan_id
          WHERE tp.user_uuid = $1::uuid
            AND tp.archived_iso IS NULL
            -- OBSERVEAFTERMATH-1 · text on both sides here too. See the header.
            AND pw.date_iso >= $2 AND pw.date_iso < $3
       ), comp AS (
         SELECT coalesce(sum(${runDistanceMiSql()}), 0) AS mi,
                count(*) AS runs
           FROM runs
          WHERE user_uuid = $1::uuid
            AND ${CANONICAL_ROW_SQL}
            -- OBSERVEAFTERMATH-1 · text on both sides, deliberately. See above.
            AND ${runDaySql()} >= $2
            AND ${runDaySql()} < $3
       )
       SELECT pres.mi::text AS prescribed, comp.mi::text AS completed,
              comp.runs::text AS graded,
              greatest(pres.days - comp.runs, 0)::text AS missed
         FROM pres, comp`,
      [d.user_uuid, fromISO, toISO],
    ),
  );
  if (!r.ok) return UNREAD;
  const row = r.value.rows[0];
  if (!row) return UNREAD;

  const num = (v: string | null): number | null =>
    v === null ? null : Number.isFinite(Number(v)) ? Number(v) : null;

  /* Pain and injury come from the SAFETY OWNER, not from a second read of the
   * health tables here. `lib/safety/load-safety.ts` is the one author of what a
   * runner's injury, illness and niggle state is, and `_safety_ownership.test.ts`
   * enforces that — it caught this file querying `runner_injuries` and `niggles`
   * directly on the first full run.
   *
   * Rule 11 survives the delegation: a source that could not be read resolves
   * UNKNOWN there, and UNKNOWN becomes `null` here rather than `false`. "He
   * reported nothing" and "nobody could ask" are different facts, and the second
   * must never vindicate a decision that hurt him. */
  const safety = await attempt(
    'ledger/observe-aftermath · safety',
    loadSafetyInputs(d.user_uuid, { todayISO: toISO }),
  );
  const painOrInjuryReported: boolean | null = safety.ok
    ? readablePain(safety.value)
    : null;

  return {
    prescribedMi: num(row.prescribed),
    completedMi: num(row.completed),
    // Deterioration and later performance are not read here yet; null is the
    // honest value and the classifier prices the missing evidence down rather
    // than assuming it was fine.
    deterioratedSessions: null,
    gradedSessions: num(row.graded),
    painOrInjuryReported,
    laterPerformanceImproved: null,
    missedPrescribedDays: num(row.missed),
  };
}

/**
 * True when a source SAYS there was pain, false when every source says there was
 * none, and null when any of them could not answer.
 *
 * Null on a partial read is deliberate and conservative in the direction that
 * matters: an unread niggle table must not be reported as "he was fine".
 */
function readablePain(inputs: Awaited<ReturnType<typeof loadSafetyInputs>>): boolean | null {
  const sources = [inputs.injury, inputs.illness, inputs.niggle];
  // A source that FAILED to read makes the whole answer unknown. Rule 11 in the
  // conservative direction: an unread niggle table must never be reported as
  // "he was fine" on a decision that may have hurt him.
  if (sources.some((s) => !s.ok)) return null;
  return sources.some((s) => s.ok && s.value !== null);
}
