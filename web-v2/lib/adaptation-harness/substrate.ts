/**
 * lib/adaptation-harness/substrate.ts · the runner the harness drives.
 *
 * ## What the substrate is
 *
 * The owner's real rows, copied out of production by
 * `scripts/adapt-harness-substrate.sh`, with ONE transform applied: the whole
 * history is slid forward in time by a whole number of weeks, so that a block
 * he actually ran straddles today instead of sitting in the past.
 *
 * That transform is the entire trick, and it is worth stating precisely why it
 * is honest. The engine asks the clock what day it is (`runnerToday`) and there
 * is no seam to inject a different answer without editing engine files this
 * session does not own. So instead of moving the clock to the data, the harness
 * moves the data to the clock — by a multiple of seven days, so every session
 * keeps its day of the week, and by the SAME offset for the plan and for the
 * runs, so every executed session stays married to the session that prescribed
 * it. Runs that would land in the future are dropped, which leaves a continuous
 * real history ending today.
 *
 * What the engine then sees is: this runner, these sessions, this execution,
 * these readiness snapshots — mid-block, with weeks still ahead of him. Nothing
 * is invented. CLAUDE.md Rule 15's complaint about the 11,598-archetype sweep is
 * that `hist` is null for every case; here `hist` is his.
 *
 * ## What each world adds on top
 *
 * A named, minimal mutation — a missed session, a session run faster than
 * prescribed, a week under-run against its prescription. Every one is declared in
 * `worlds.harness.test.ts` and applied through the functions below, so a reader
 * can see exactly what was synthesised and exactly what was real.
 *
 * ## Isolation
 *
 * `resetToBase()` restores every public table from the pristine `base` schema
 * before each world. A world cannot inherit another world's mutations, and it
 * cannot inherit its own from a previous run — which matters because these
 * scenarios write, and a harness whose second run disagrees with its first is
 * not evidence of anything.
 */

import { assertHarnessDatabase, OWNER_UUID } from './fence';

assertHarnessDatabase();

// Imported AFTER the fence, so a misconfigured run throws before a pool exists.
import { pool } from '@/lib/db/pool';
import { rowOrNull } from '@/lib/db/read';
// Rule 14 · there is ONE answer to "which run is canonical", and filtering on
// the absorption stamp instead once zeroed 63 miles of this runner's history.
// The harness reads the same predicate the app reads, or it is not a substrate
// of the app.
import { CANONICAL_ROW_SQL } from '@/lib/runs/volume';

/* ------------------------------------------------------------------- dates */

const DAY_MS = 86_400_000;

export function plusDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY_MS);
}

/** Today in the OWNER'S timezone, resolved the way the engine resolves it. */
export async function harnessToday(): Promise<string> {
  const { runnerToday } = await import('@/lib/runtime/runner-tz');
  return runnerToday(OWNER_UUID);
}

/* -------------------------------------------------------------------- reset */

/**
 * Restore every public table from the `base` snapshot.
 *
 * `session_replication_role = replica` suspends foreign-key triggers for the
 * restore; visiting 50-odd tables in catalogue order is not a topological
 * order, and the snapshot is internally consistent by construction, so the
 * constraints have nothing to tell us mid-restore.
 */
/**
 * Run the harness's OWN bookkeeping with production's grandfathered CHECK
 * constraints temporarily lifted, then put them back exactly as they were.
 *
 * This is worth stating precisely, because it looks like cheating and is not.
 * Production's constraints are NOT VALID — `workout_spec_required` is the live
 * case: it says a non-rest row must carry a `workout_spec`, and 3,918 of the
 * owner's plan_workouts predate it. NOT VALID grandfathers rows that are
 * ALREADY there, and only there: re-inserting one during a restore, or so much
 * as touching one with an UPDATE, is judged as new. So the harness cannot copy
 * his history back or slide its dates without tripping a rule production has
 * never applied to those rows.
 *
 * Lifted for the harness's own transforms only. They go back on — NOT VALID,
 * production's own posture — before any engine code runs, so an engine write
 * that produced a shape production would refuse still fails here.
 */
async function withGrandfatheredChecksLifted(
  client: { query: (q: string, v?: unknown[]) => Promise<{ rows: any[] }> },
  body: () => Promise<void>,
): Promise<void> {
  const checks = (await client.query(
    `SELECT rel.relname AS tbl, con.conname AS name, pg_get_constraintdef(con.oid) AS def
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = rel.relnamespace AND n.nspname = 'public'
      WHERE con.contype = 'c' AND con.convalidated = false`,
  )).rows as Array<{ tbl: string; name: string; def: string }>;
  for (const c of checks) {
    await client.query(`ALTER TABLE public."${c.tbl}" DROP CONSTRAINT "${c.name}"`);
  }
  try {
    await body();
  } finally {
    for (const c of checks) {
      await client.query(
        `ALTER TABLE public."${c.tbl}" ADD CONSTRAINT "${c.name}" ${c.def.replace(/ NOT VALID$/, '')} NOT VALID`,
      ).catch(() => {});
    }
  }
}

export async function resetToBase(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`SET session_replication_role = replica`);
    const { rows } = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );
    if (rows.length === 0) {
      throw new Error('[harness] reset found zero tables — the substrate has not been built. Run scripts/adapt-harness-substrate.sh.');
    }
    await client.query('BEGIN');
    await withGrandfatheredChecksLifted(client as never, async () => {
      // One statement, every table, CASCADE. `session_replication_role` suspends
      // FK TRIGGERS but TRUNCATE checks referencing tables structurally, so it
      // has to see the whole set at once or it refuses each one in turn.
      const all = rows.map((r) => `public."${r.tablename}"`).join(', ');
      await client.query(`TRUNCATE TABLE ${all} CASCADE`);
      for (const r of rows) {
        await client.query(`INSERT INTO public."${r.tablename}" SELECT * FROM base."${r.tablename}"`);
      }
    });
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await client.query(`SET session_replication_role = origin`).catch(() => {});
    client.release();
  }
}

/* ---------------------------------------------------------------- the shift */

export interface Substrate {
  /** The plan the harness put under today. */
  planId: string;
  /** Whole days the whole history moved. Always a multiple of 7. */
  offsetDays: number;
  todayISO: string;
  /** The shifted block's first and last prescribed day. */
  blockStartISO: string;
  blockEndISO: string;
  /** Prescribed days still ahead of the runner. This is what "the plan gets
   *  harder on the weeks not yet run" is asserted against. */
  futureDays: number;
  /** Real runs surviving the shift — his actual executed history. */
  runsKept: number;
  /** Does the plan carry the tier bands the volume ramp reads? */
  hasTierBands: boolean;
}

/**
 * Choose the source block, slide the whole world onto today, and make it active.
 *
 * The block is chosen by evidence rather than by name: the most recently
 * authored plan carrying enough prescribed days to have future weeks in it.
 * That is his America's Finest City build today; it will be the CIM build once
 * that is authored, and the harness needs no edit for the changeover.
 */
export async function shiftRealBlockOntoToday(opts?: {
  /** How many weeks of unrun plan to leave ahead of today. */
  remainingWeeks?: number;
}): Promise<Substrate> {
  const remainingWeeks = opts?.remainingWeeks ?? 3;
  const todayISO = await harnessToday();

  const src = (await pool.query<{
    id: string; d0: string; d1: string; n: string; has_bands: boolean;
  }>(
    `SELECT tp.id,
            MIN(pw.date_iso) AS d0,
            MAX(pw.date_iso) AS d1,
            COUNT(*)::text   AS n,
            (tp.authored_state ? 'tier_peak_weekly_band') AS has_bands
       FROM training_plans tp
       JOIN plan_workouts pw ON pw.plan_id = tp.id
      WHERE tp.user_uuid = $1::uuid
      GROUP BY tp.id, tp.authored_iso, tp.authored_state
     HAVING COUNT(*) >= 40
      ORDER BY tp.authored_iso DESC
      LIMIT 1`,
    [OWNER_UUID],
  )).rows[0];

  if (!src) {
    throw new Error(
      '[harness] no plan with 40+ prescribed days in the substrate. '
      + 'Every scenario needs a block with future weeks in it; there is nothing to drive.',
    );
  }

  // Land today `remainingWeeks` before the block's last day, snapped to a whole
  // number of weeks so every session keeps its day of the week.
  const wantedSourceToday = plusDays(src.d1, -remainingWeeks * 7);
  const offsetDays = 7 * Math.round(daysBetween(wantedSourceToday, todayISO) / 7);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL session_replication_role = replica`);
    await withGrandfatheredChecksLifted(client as never, async () => {

    // Plan geometry. `date_iso` and `week_start_iso` are TEXT day keys.
    await client.query(
      `UPDATE plan_workouts SET
         date_iso = to_char(date_iso::date + $2::int, 'YYYY-MM-DD'),
         original_date_iso = CASE WHEN original_date_iso IS NULL THEN NULL
                                  ELSE to_char(original_date_iso::date + $2::int, 'YYYY-MM-DD') END
       WHERE user_uuid = $1::uuid`,
      [OWNER_UUID, offsetDays],
    );
    await client.query(
      `UPDATE plan_weeks SET week_start_iso = to_char(week_start_iso::date + $2::int, 'YYYY-MM-DD')
        WHERE user_uuid = $1::uuid`,
      [OWNER_UUID, offsetDays],
    );
    await client.query(
      `UPDATE training_plans SET
         goal_iso = CASE WHEN goal_iso IS NULL THEN NULL
                         ELSE to_char(goal_iso::date + $2::int, 'YYYY-MM-DD') END,
         authored_iso = authored_iso + make_interval(days => $2::int)
       WHERE user_uuid = $1::uuid`,
      [OWNER_UUID, offsetDays],
    );

    // Races move with the calendar they anchor. `dateNearRace`, the taper
    // window and every race-recency filter read these.
    await client.query(
      `UPDATE races SET meta = meta || jsonb_build_object(
          'date', to_char((meta->>'date')::date + $2::int, 'YYYY-MM-DD'))
        WHERE user_uuid = $1::uuid AND (meta->>'date') ~ '^\\d{4}-\\d{2}-\\d{2}$'`,
      [OWNER_UUID, offsetDays],
    );

    // Execution. Both day keys move together — `runDaySql` reads `date` with a
    // `startLocal` prefix fallback, and leaving one behind would split a run's
    // identity across two days depending on which reader asked.
    await client.query(
      `UPDATE runs SET data = data
         || jsonb_build_object('date', to_char((data->>'date')::date + $2::int, 'YYYY-MM-DD'))
         || CASE WHEN data ? 'startLocal'
                 THEN jsonb_build_object('startLocal',
                        to_char((LEFT(data->>'startLocal',10))::date + $2::int, 'YYYY-MM-DD')
                        || SUBSTRING(data->>'startLocal' FROM 11))
                 ELSE '{}'::jsonb END
       WHERE user_uuid = $1::uuid AND (data->>'date') ~ '^\\d{4}-\\d{2}-\\d{2}$'`,
      [OWNER_UUID, offsetDays],
    );

    // The adapter's own history of THIS block moves with the block, and
    // anything that then lands in the future is deleted — those intents
    // describe decisions about days the runner has not reached yet. Because his
    // real intents run right up to now, shifting them forward clears the table,
    // which is the correct starting state for a harness: each world drives the
    // adapter against a block it has not yet adapted. The intents that matter
    // to a gate — the 48-hour pull-back window, the 7-day bump cooldown, the
    // once-per-week progression marker — are then written by the run under
    // test rather than inherited from production, so a scenario's verdict is
    // about the scenario. World 0 reports on the real, unshifted record.
    await client.query(
      `UPDATE coach_intents SET ts = ts + make_interval(days => $2::int)
        WHERE COALESCE(user_uuid, user_id) = $1::uuid`,
      [OWNER_UUID, offsetDays],
    );

    // ── WHAT IS DELIBERATELY *NOT* SHIFTED ───────────────────────────────
    //
    // `health_samples`, `readiness_snapshots` and `projection_snapshots` stay
    // on their real calendar dates.
    //
    // They already run right up to today — his watch has been syncing the
    // whole time — so sliding them forward and then dropping what landed in
    // the future would open a 35-day hole ending TODAY, which is precisely the
    // window the convergence and cooldown display readers depend on.
    //
    // 2026-09-02 · this comment used to argue the hole in terms of
    // `detectRampSignals` grading an absent readiness row GREEN. That gate is
    // gone: the runner owns his readiness, and the ramp's first gate now reads
    // ACWR off `runs`, which IS shifted with the block. The hole would still
    // be wrong for the display readers, so the rows still stay put — but the
    // Rule 11 argument now belongs to `_acwr_ramp_bound.test.ts`, where the
    // refusal it describes is actually asserted.
    //
    // The consequence is stated rather than hidden: the biometric series is his
    // real recent one and the executed runs are his real ones from the
    // corresponding weeks of the block. Both are real; they are five weeks
    // apart in provenance. Nothing in the adaptation path joins a run to a
    // biometric sample by date, so this decouples nothing the engine reads
    // together.
    for (const hop of [10000 + offsetDays, -10000]) {
      await client.query(
        `UPDATE day_actions SET date_iso = to_char(date_iso::date + $2::int, 'YYYY-MM-DD')
          WHERE user_uuid = $1::uuid AND date_iso ~ '^\\d{4}-\\d{2}-\\d{2}$'`,
        [OWNER_UUID, hop],
      ).catch(() => {});
    }

    // Anything the shift pushed past today is not history. Dropping it leaves a
    // continuous real record that ends today, which is what every "recent
    // window" reader in the engine is entitled to assume.
    await client.query(
      `DELETE FROM runs WHERE user_uuid = $1::uuid AND (data->>'date') > $2`,
      [OWNER_UUID, todayISO],
    );
    await client.query(
      `DELETE FROM coach_intents WHERE COALESCE(user_uuid, user_id) = $1::uuid AND ts > NOW()`,
      [OWNER_UUID],
    );

    // One active plan · Rule 14. `clearActivePlansFor` never deletes a plan's
    // workouts, so all 47 versions still carry rows; a reader that joins on
    // user_uuid alone reads every one of them. The harness makes exactly one
    // plan active so the engine's own scoping is what is under test.
    await client.query(
      `UPDATE training_plans SET archived_iso = NOW()
        WHERE user_uuid = $1::uuid AND id <> $2 AND archived_iso IS NULL`,
      [OWNER_UUID, src.id],
    );
    await client.query(
      `UPDATE training_plans SET archived_iso = NULL, archive_reason = NULL WHERE id = $1`,
      [src.id],
    );

    });
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  const after = (await pool.query<{ d0: string; d1: string; future: string; kept: string }>(
    `SELECT MIN(pw.date_iso) AS d0, MAX(pw.date_iso) AS d1,
            COUNT(*) FILTER (WHERE pw.date_iso > $2)::text AS future,
            (SELECT COUNT(*)::text FROM runs r WHERE r.user_uuid = $3::uuid
               AND ${CANONICAL_ROW_SQL.replace(/\bdata\b/g, 'r.data')}) AS kept
       FROM plan_workouts pw WHERE pw.plan_id = $1`,
    [src.id, todayISO, OWNER_UUID],
  )).rows[0];

  return {
    planId: src.id,
    offsetDays,
    todayISO,
    blockStartISO: after.d0,
    blockEndISO: after.d1,
    futureDays: Number(after.future),
    runsKept: Number(after.kept),
    hasTierBands: src.has_bands,
  };
}

/* ------------------------------------------------------- reading the plan */

export interface PlanDay {
  id: string;
  dateISO: string;
  type: string;
  distanceMi: number | null;
  isQuality: boolean;
  subLabel: string | null;
  paceTargetSPerMi: number | null;
  hasProgressionBlock: boolean;
}

/** The prescription as it currently stands, for a date window. */
export async function readPlanDays(
  planId: string, fromISO: string, toISO: string,
): Promise<PlanDay[]> {
  const { rows } = await pool.query<{
    id: string; date_iso: string; type: string; distance_mi: string | null;
    is_quality: boolean | null; sub_label: string | null;
    pace_target_s_per_mi: string | null; has_prog: boolean;
  }>(
    `SELECT pw.id::text AS id, pw.date_iso::text AS date_iso, pw.type,
            pw.distance_mi::text AS distance_mi, pw.is_quality, pw.sub_label,
            pw.pace_target_s_per_mi::text AS pace_target_s_per_mi,
            COALESCE(pw.workout_spec ? 'progression', false) AS has_prog
       FROM plan_workouts pw
      WHERE pw.plan_id = $1 AND pw.date_iso >= $2 AND pw.date_iso <= $3
      ORDER BY pw.date_iso`,
    [planId, fromISO, toISO],
  );
  return rows.map((r) => ({
    id: r.id,
    dateISO: r.date_iso,
    type: r.type,
    distanceMi: r.distance_mi != null ? Number(r.distance_mi) : null,
    isQuality: r.is_quality === true,
    subLabel: r.sub_label,
    paceTargetSPerMi: r.pace_target_s_per_mi != null ? Number(r.pace_target_s_per_mi) : null,
    hasProgressionBlock: r.has_prog,
  }));
}

/* --------------------------------------------------- synthesised variation */

/**
 * Erase the run that satisfied a prescribed session, so the engine sees it as
 * not done. Nothing else about the day changes — the prescription is still
 * there, still on its date. This is what "he fell short" is, in data.
 *
 * Returns the number of runs removed, so a caller can assert it actually
 * changed something rather than asserting against a day he never ran anyway.
 */
export async function missSessionOn(dateISO: string): Promise<number> {
  const r = await pool.query(
    `DELETE FROM runs WHERE user_uuid = $1::uuid
       AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) = $2`,
    [OWNER_UUID, dateISO],
  );
  return r.rowCount ?? 0;
}

/**
 * Pose a genuinely missed key session, on the engine's own definition of one.
 *
 * `detectMissedKeyWorkout` marks a session done when ANY canonical run within
 * ±1 day reached `completionThresholdMi` — 60% of the prescription, distance
 * only, no regard for what the run was. So removing the tempo day's run is not
 * enough: an ordinary 7-mile easy run the day before clears the bar for a
 * 4-mile tempo and the session reads as completed.
 *
 * This shrinks any run in the ±1 window that would clear the bar to just under
 * it, rather than deleting days he ran. He still ran; none of those runs is
 * long enough to stand in for the session. That is the scenario the owner
 * described — the key workout did not happen — expressed in the terms the
 * detector actually reads.
 *
 * Returns how many runs had to be shrunk, so a scenario can report whether the
 * miss was posed by removing one run or by clearing a neighbour as well.
 */
export async function clearCompletionWindow(dateISO: string, thresholdMi: number): Promise<number> {
  const r = await pool.query(
    `UPDATE runs SET data = data || jsonb_build_object('distanceMi', $4::numeric)
      WHERE user_uuid = $1::uuid
        AND ${CANONICAL_ROW_SQL}
        AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10))
            BETWEEN to_char($2::date - 1, 'YYYY-MM-DD') AND to_char($2::date + 1, 'YYYY-MM-DD')
        AND (data->>'distanceMi')::numeric >= $3::numeric`,
    [OWNER_UUID, dateISO, thresholdMi, Math.max(0.5, thresholdMi - 0.5)],
  );
  return r.rowCount ?? 0;
}

/**
 * Make a real executed run FASTER, by a fraction, keeping its distance.
 *
 * This is the variation World 3 rests on and it is deliberately the smallest
 * one that means anything: the same run, on the same day, over the same ground,
 * completed quicker. Moving pace means moving the duration keys the execution
 * reader prices off — `movingTimeS`, `durationSec` and the derived
 * `avgPaceSPerMi` — together, so no reader can see a run that disagrees with
 * itself.
 */
export async function runFasterOn(dateISO: string, fraction: number): Promise<number> {
  const factor = 1 - fraction;
  const r = await pool.query(
    `UPDATE runs SET data = data
       || (CASE WHEN data ? 'movingTimeS'    THEN jsonb_build_object('movingTimeS',    ROUND((data->>'movingTimeS')::numeric    * $3)) ELSE '{}'::jsonb END)
       || (CASE WHEN data ? 'movingSec'      THEN jsonb_build_object('movingSec',      ROUND((data->>'movingSec')::numeric      * $3)) ELSE '{}'::jsonb END)
       || (CASE WHEN data ? 'durationSec'    THEN jsonb_build_object('durationSec',    ROUND((data->>'durationSec')::numeric    * $3)) ELSE '{}'::jsonb END)
       || (CASE WHEN data ? 'elapsedSec'     THEN jsonb_build_object('elapsedSec',     ROUND((data->>'elapsedSec')::numeric     * $3)) ELSE '{}'::jsonb END)
       || (CASE WHEN data ? 'avgPaceSPerMi'  THEN jsonb_build_object('avgPaceSPerMi',  ROUND((data->>'avgPaceSPerMi')::numeric  * $3)) ELSE '{}'::jsonb END)
      WHERE user_uuid = $1::uuid
        AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) = $2`,
    [OWNER_UUID, dateISO, factor],
  );
  return r.rowCount ?? 0;
}

/** Shave a whole week's executed mileage by a fraction, run by run. */
export async function underRunWeek(fromISO: string, toISO: string, fraction: number): Promise<number> {
  const factor = 1 - fraction;
  const r = await pool.query(
    `UPDATE runs SET data = data
       || jsonb_build_object('distanceMi', ROUND((data->>'distanceMi')::numeric * $4, 2))
      WHERE user_uuid = $1::uuid
        AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) BETWEEN $2 AND $3`,
    [OWNER_UUID, fromISO, toISO, factor],
  );
  return r.rowCount ?? 0;
}

/**
 * The most recent decision recorded by the plan mutation boundary.
 *
 * `mutatePlan` rolls a whole action batch back when it INTRODUCES a doctrine
 * violation, records the reason in `plan_mutation_rejections`, and returns a
 * failure. `tryAdaptiveBump` does not read that return — it reports its bump
 * summary whether or not the write survived. Without this reader the harness
 * would see "bump applied" beside an unchanged plan and have no way to say
 * which of the two was the misleading fact.
 */
export async function lastMutationRejection(sinceISO: string): Promise<
  { source: string; outcome: string; violations: unknown; at: string } | null
> {
  // `rowOrNull`, not a swallowed catch. Three states, and the harness needs all
  // three: a rejection row, no rejection row (the mutation committed), and a
  // read that failed. Collapsing the last two would let the report say "no
  // rejection recorded" about a table it could not read, which is the exact
  // sentence the harness exists to stop the ENGINE saying.
  const row = await rowOrNull<{ source: string; outcome: string; violations: unknown; at: string }>(
    'harness · last mutation rejection',
    pool.query<{ source: string; outcome: string; violations: unknown; at: string }>(
      `SELECT source, outcome, violations, at::text AS at
         FROM plan_mutation_rejections
        WHERE user_uuid = $1::uuid AND at >= $2::timestamptz
        ORDER BY at DESC LIMIT 1`,
      [OWNER_UUID, sinceISO],
    ),
  );
  if (row === null) {
    throw new Error(
      '[harness] could not read plan_mutation_rejections. The harness will not report '
      + '"no rejection recorded" about a table it failed to read.',
    );
  }
  return row ?? null;
}

/**
 * Move the runner's long-run day so that TODAY is day 0 of a training week.
 *
 * Declared loudly because it is the one substrate parameter that is not his.
 * `progressionPassDue` only fires on the first three days of a training week,
 * and the training week ends on `long_run_day` (locked 2026-06-16). His is
 * Sunday, so on four days in seven the weekly progression cycle cannot be due
 * at all and a harness that only ran on the other three would be useless. This
 * moves the boundary, not the evidence: no run, no prescription and no
 * readiness reading changes.
 */
export async function anchorTrainingWeekToToday(todayISO: string): Promise<number> {
  const todayDow = new Date(`${todayISO}T12:00:00Z`).getUTCDay();
  const longRunDow = (todayDow + 6) % 7;
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  await pool.query(
    `UPDATE user_prefs SET long_run_dow = $2, long_run_day = $3 WHERE user_uuid = $1::uuid`,
    [OWNER_UUID, longRunDow, names[longRunDow]],
  );
  return longRunDow;
}

/** Clear the once-per-week marker so the progression cycle can run again. */
export async function clearProgressionMarker(): Promise<void> {
  await pool.query(
    `DELETE FROM coach_intents
      WHERE COALESCE(user_uuid, user_id) = $1::uuid AND reason = 'plan_adapt_progression'`,
    [OWNER_UUID],
  );
}

/** Every `coach_intents` reason written for the owner, newest first. */
export async function intentsSince(tsISO: string): Promise<Array<{ reason: string; field: string | null; why: string | null }>> {
  const { rows } = await pool.query<{ reason: string; field: string | null; why: string | null }>(
    // `coach_intents.value` is TEXT holding JSON, not jsonb — the engine's own
    // readers cast it the same way (`value::jsonb->>'week_start_iso'` in
    // progression-pass.ts). Without the cast the read fails outright.
    `SELECT reason, field, value::jsonb->>'why' AS why
       FROM coach_intents
      WHERE COALESCE(user_uuid, user_id) = $1::uuid AND ts >= $2::timestamptz
      ORDER BY ts DESC`,
    [OWNER_UUID, tsISO],
  );
  return rows;
}
