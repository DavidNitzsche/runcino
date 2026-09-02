/**
 * projection-snapshots — daily snapshots of (VDOT, projection_sec) per user
 * per race distance, used by race-header.ts to compute the projection-trend
 * delta without re-running the full VDOT chain on every read.
 *
 * Schema lives in db/migrations/123_projection_snapshots.sql.
 *
 * Write path: cron at 00:30 local (or any time a snapshot is desired) calls
 *   recordProjectionSnapshot(userUuid, today, distanceMi, vdot, projSec, raceSlug)
 *
 * Read path: race-header (or any trend consumer) calls
 *   loadProjectionSnapshot(userUuid, asOfDate, distanceMi)
 * which returns the snapshot for that exact date, or null if none exists.
 *
 * Race-header currently falls back to a live re-compute when no snapshot
 * exists (V1 graceful degradation). Once the cron has been running for
 * 30+ days, snapshots will be the primary read path.
 */
import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { addDaysToDayKey } from '@/lib/runtime/day-key';

export interface ProjectionSnapshot {
  user_uuid: string;
  snapshot_date: string;
  distance_mi: number;
  vdot: number | null;
  projection_sec: number | null;
  race_slug: string | null;
  source: string;
  /** ISO date of the race/run that produced the stored VDOT. Null pre-migration-125. */
  vdot_anchor_date: string | null;
  /** Distance (miles) of that race/run. Null pre-migration-125. */
  vdot_anchor_distance_mi: number | null;
}

/**
 * Persist a snapshot. Idempotent via UNIQUE (user_uuid, snapshot_date,
 * distance_mi); a second call for the same key UPSERTs.
 */
export async function recordProjectionSnapshot(
  userUuid: string,
  snapshotDateISO: string,
  distanceMi: number,
  vdot: number | null,
  projectionSec: number | null,
  raceSlug: string | null,
  anchorDateISO: string | null = null,
  anchorDistanceMi: number | null = null,
  source = 'cron',
): Promise<void> {
  await pool.query(
    `INSERT INTO projection_snapshots
       (user_uuid, snapshot_date, distance_mi, vdot, projection_sec, race_slug,
        vdot_anchor_date, vdot_anchor_distance_mi, source)
     VALUES ($1, $2::date, $3, $4, $5, $6, $7::date, $8, $9)
     ON CONFLICT (user_uuid, snapshot_date, distance_mi)
     DO UPDATE SET
       vdot = EXCLUDED.vdot,
       projection_sec = EXCLUDED.projection_sec,
       race_slug = EXCLUDED.race_slug,
       vdot_anchor_date = EXCLUDED.vdot_anchor_date,
       vdot_anchor_distance_mi = EXCLUDED.vdot_anchor_distance_mi,
       source = EXCLUDED.source`,
    [userUuid, snapshotDateISO, distanceMi, vdot, projectionSec, raceSlug,
     anchorDateISO, anchorDistanceMi, source],
  );
}

/**
 * Read the exact snapshot for (user, date, distance). Returns null if no
 * snapshot was recorded for that day (cron didn't run, user wasn't onboarded,
 * etc.). Callers should fall back to live computation in that case.
 */
export async function loadProjectionSnapshot(
  userUuid: string,
  snapshotDateISO: string,
  distanceMi: number,
): Promise<ProjectionSnapshot | null> {
  const r = await pool.query<ProjectionSnapshot>(
    `SELECT user_uuid::text AS user_uuid,
            snapshot_date::text AS snapshot_date,
            distance_mi::float AS distance_mi,
            vdot::float AS vdot,
            projection_sec, race_slug, source
       FROM projection_snapshots
      WHERE user_uuid = $1
        AND snapshot_date = $2::date
        AND distance_mi = $3
      LIMIT 1`,
    [userUuid, snapshotDateISO, distanceMi],
  ).catch(() => ({ rows: [] }));
  return r.rows[0] ?? null;
}

/**
 * Read the nearest snapshot at or before `snapshotDateISO`. Useful when the
 * cron hasn't fired for the exact date (weekend, deploy, daylight savings)
 * but a slightly older snapshot is good enough for trend math.
 */
export async function loadNearestSnapshot(
  userUuid: string,
  snapshotDateISO: string,
  distanceMi: number,
  maxLookbackDays = 7,
): Promise<ProjectionSnapshot | null> {
  const cutoff = new Date(Date.parse(snapshotDateISO + 'T12:00:00Z') - maxLookbackDays * 86400000)
    .toISOString().slice(0, 10);
  const r = await pool.query<ProjectionSnapshot>(
    `SELECT user_uuid::text AS user_uuid,
            snapshot_date::text AS snapshot_date,
            distance_mi::float AS distance_mi,
            vdot::float AS vdot,
            projection_sec, race_slug, source
       FROM projection_snapshots
      WHERE user_uuid = $1
        AND distance_mi = $2
        AND snapshot_date BETWEEN $3::date AND $4::date
      ORDER BY snapshot_date DESC
      LIMIT 1`,
    [userUuid, distanceMi, cutoff, snapshotDateISO],
  ).catch(() => ({ rows: [] }));
  return r.rows[0] ?? null;
}

/**
 * Trend series — last N days of snapshots for a (user, distance). Used by
 * the TargetsView projection-trend chart. Returns oldest → newest so the
 * caller can render left-to-right.
 */
export async function loadProjectionSeries(
  userUuid: string,
  distanceMi: number,
  daysBack = 90,
): Promise<Array<{ date: string; projectionSec: number | null; vdot: number | null }>> {
  // Trim the trend window on the RUNNER's calendar. A server-UTC cutoff
  // adds or drops a day of the chart depending on the hour the page is
  // loaded, which makes the same series look different at 4pm and 6pm.
  const cutoff = addDaysToDayKey(await runnerToday(userUuid), -daysBack);
  const r = await pool.query<{ d: string; ps: number | null; v: number | null }>(
    `SELECT snapshot_date::text AS d,
            projection_sec AS ps,
            vdot::float AS v
       FROM projection_snapshots
      WHERE user_uuid = $1
        AND distance_mi = $2
        AND snapshot_date >= $3::date
      ORDER BY snapshot_date ASC`,
    [userUuid, distanceMi, cutoff],
  ).catch(() => ({ rows: [] }));
  return r.rows.map((row) => ({ date: row.d, projectionSec: row.ps, vdot: row.v }));
}

/**
 * Latest VDOT for a user, regardless of race distance. Used by profile-state
 * so the display reads the cron-written snapshot rather than re-running the
 * full race-candidate chain on every /profile load.
 *
 * Returns null on error — callers treat null as "no VDOT yet"
 * (cold-start), not as a failure that should block generation.
 */
export async function loadLatestVdotForUser(userUuid: string): Promise<number | null> {
  const r = await pool.query<{ vdot: number }>(
    `SELECT vdot::float AS vdot
       FROM projection_snapshots
      WHERE user_uuid = $1
        AND vdot IS NOT NULL
      ORDER BY snapshot_date DESC
      LIMIT 1`,
    [userUuid],
  ).catch(() => ({ rows: [] }));
  return r.rows[0]?.vdot ?? null;
}

/**
 * DEPRECATED SHELL · SECOND-OWNER-5 (2026-09-02). Its OWN query is deleted;
 * this delegates to `resolveCurrentVdotSnapshot` and flattens the refusal.
 *
 * ── WHAT IT WAS, AND WHAT IT COST ──────────────────────────────────────────
 *
 * A second, independent answer to "what is this runner's VDOT", sitting in
 * this very file beside the disciplined one. Its query was
 * `ORDER BY snapshot_date DESC LIMIT 1` with:
 *
 *   · NO AGE BOUND. `bestRecentVdot` fades a value (0.1 VDOT per 14 days past
 *     56, expiring at 84); a snapshot is faded as of its OWN date and never
 *     again, so a snapshot N days old is under-faded by exactly N days. The
 *     owner's snapshot history carries real gaps of 7, 9 and 15 days, and in
 *     one of those windows the value moved 44.1 → 46.3 → 47.7 in three days.
 *     A 15-day gap there serves a number 3.6 VDOT wrong, confidently.
 *   · NO TIE-BREAK. Production holds THREE rows per (user, snapshot_date);
 *     which one came back was the planner's choice (Rule 14).
 *   · A `.catch(() => ({ rows: [] }))`, so a failed read and an empty table
 *     were the same answer (Rule 11).
 *
 * It had six live callers, one of them `app/api/v5/races` — the primary iPhone
 * races surface — feeding Goal Feasibility (§L) and the heat detector.
 *
 * ── WHY IT IS A SHELL RATHER THAN DELETED ──────────────────────────────────
 *
 * Every caller this change could reach now calls `resolveCurrentVdotSnapshot`
 * directly and branches on the refusal: `lib/coach/profile-state.ts`,
 * `app/api/v5/races`, `app/api/targets/projection`, `components/faff-app/seed`.
 *
 * ONE importer remains — `lib/plan/goal-gap.ts` — and it is inside a tree
 * another agent is concurrently rewriting, so editing it here would collide.
 * The symbol survives for that single caller ONLY, with its own query gone, so
 * the three defects above are fixed for it too without the file being touched.
 * `lib/training/_vdot_snapshot_owner.test.ts` pins the importer set to exactly
 * that one file and FAILS if anything else picks this up, or if `goal-gap.ts`
 * stops importing it — at which point this function is deleted outright.
 *
 * ── THE ONE BEHAVIOURAL CHANGE, STATED ─────────────────────────────────────
 *
 * A snapshot older than `VDOT_SNAPSHOT_MAX_AGE_DAYS` now returns `vdot: null`
 * where it used to return the stale number. That is the defect, not a
 * regression: a value the app cannot honestly call current is not one to hand
 * a goal-feasibility verdict. Measured on the reference runner 2026-09-02,
 * both readers returned 47.7 with anchor 2026-09-01 / 4.03 mi and `ageDays: 0`,
 * so today it is a no-op; it differs only in exactly the case it exists for.
 *
 * The flattening to `null` is itself a Rule 11 loss and is why this shape does
 * not spread: the reason is logged here rather than discarded, and the caller
 * that wants the three states calls the resolver.
 */
export async function loadLatestVdotWithAnchor(
  userUuid: string,
): Promise<{ vdot: number | null; anchorDateISO: string | null; anchorDistanceMi: number | null }> {
  const read = await resolveCurrentVdotSnapshot(userUuid);
  if (!read.ok) {
    console.warn(
      `[projection-snapshots] loadLatestVdotWithAnchor · current VDOT unavailable · ${read.reason} · ${read.detail}`,
    );
    return { vdot: null, anchorDateISO: null, anchorDistanceMi: null };
  }
  return {
    vdot: read.vdot,
    anchorDateISO: read.anchorDateISO,
    anchorDistanceMi: read.anchorDistanceMi,
  };
}


/* ═══════════════ THE canonical "what is this runner's VDOT" read ══════════ */

/**
 * How old a snapshot may be before this resolver refuses to hand it over as
 * "current fitness".
 *
 * F-6, verified in production: `bestRecentVdot` has a whole fade apparatus
 * (`FADE_PER_14D` = 0.1 VDOT per 14 days past `VDOT_FULL_VALUE_DAYS` = 56,
 * expiring at `VDOT_EXPIRY_DAYS` = 84). A SNAPSHOT bypasses all of it, because
 * the row was faded as of its OWN date and never again. So a snapshot N days
 * old is under-faded by exactly N days, silently — and this is not
 * theoretical: the owner's snapshot history carries real gaps of 7, 9 and 15
 * days (2026-03-31 → 2026-05-30), with only 101 of 155 days in that span
 * carrying a row at all.
 *
 * Fourteen days is `FADE_PER_14D`'s own period: it is the longest gap that can
 * cost at most ONE fade step, which is the largest error doctrine's own
 * machinery treats as a single increment. Past that the resolver refuses
 * rather than handing back a number that is confidently wrong (Rule 11 — a
 * refusal is a correct answer; a stale value presented as current is not).
 */
export const VDOT_SNAPSHOT_MAX_AGE_DAYS = 14;

/**
 * Rule 11 as a type. Three states, and the refusal branch carries no `vdot`
 * field at all, so `read.vdot` does not compile until the caller has branched
 * — the same device `NormalReading<T>` and `PaceAnchorRead` use, and for the
 * same reason.
 *
 * `NO_SNAPSHOT` and `READ_FAILED` are deliberately separate. A cold-start
 * runner with no snapshot and a database that just refused a query are
 * opposite facts, and the four hand-copied readers this replaces collapsed
 * them into `null` — three of them behind `.catch(() => ({ rows: [] }))`, so a
 * failed read became "no VDOT", which became `establishedPaceFor → null`,
 * which SUPPRESSED the finding entirely. A guard that silently switches itself
 * off when its input fails is the exact shape Rule 11 exists to stop.
 */
export type VdotSnapshotRead =
  | {
      ok: true;
      vdot: number;
      snapshotDateISO: string;
      /** Days between the snapshot and the date asked about. */
      ageDays: number;
      /** ISO date of the race/run the stored VDOT was derived from. */
      anchorDateISO: string | null;
      anchorDistanceMi: number | null;
    }
  | { ok: false; reason: 'NO_SNAPSHOT' | 'READ_FAILED' | 'STALE'; detail: string };

/**
 * THE current-VDOT snapshot read. One definition, one population, one
 * staleness posture.
 *
 * F-6: this replaced FOUR byte-identical hand-copied queries in
 * `lib/adaptation/load.ts`, `lib/coach/fitness-evidence.ts`,
 * `lib/coach/race-replacement.ts` and `lib/coach/threshold-pattern.ts`, each
 * of which justified itself in its own header with a "house rule" — "where a
 * reader does not exist, each caller carries its own one-line copy" — which is
 * precisely the reasoning Rule 16 exists to refuse. A reader DID exist
 * (`loadLatestVdotForUser`, in this file); nobody called it.
 *
 * RULE 14 · THE POPULATION IS NAMED. Production carries THREE rows per
 * `snapshot_date` per user (one per `race_slug`, two with `race_slug` NULL),
 * and `ORDER BY snapshot_date DESC LIMIT 1` had no tie-break at all — which of
 * the three came back was up to the planner. They agree today, so this was
 * latent rather than live, and it is now closed: the order is
 * `snapshot_date DESC, distance_mi DESC, race_slug NULLS LAST`, which is
 * total, and the query says so.
 *
 * NO `.catch(() => ({ rows: [] }))`. A failed read returns `READ_FAILED` and
 * the caller must decide; it does not silently become "this runner has no
 * fitness".
 */
export async function resolveCurrentVdotSnapshot(
  userUuid: string,
  todayISO?: string,
): Promise<VdotSnapshotRead> {
  /* RULE 11 · a failed date read is its own refusal, not a null that flows on.
   * Written as try/catch rather than `.catch(() => null)` deliberately: the
   * coercion scanner cannot see that a later `if (today == null)` branch makes
   * the collapse harmless, and a reader cannot either. The failure returns
   * from here, where it happened. */
  let today: string;
  try {
    today = todayISO ?? (await runnerToday(userUuid));
  } catch (err) {
    return {
      ok: false,
      reason: 'READ_FAILED',
      detail: `could not resolve the runner's own date: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  let rows: Array<{ vdot: number; snapshot_date: string; anchor_date: string | null; anchor_dist: number | null }>;
  try {
    const r = await pool.query<{
      vdot: number; snapshot_date: string; anchor_date: string | null; anchor_dist: number | null;
    }>(
      `SELECT vdot::float                        AS vdot,
              snapshot_date::text                AS snapshot_date,
              vdot_anchor_date::text             AS anchor_date,
              vdot_anchor_distance_mi::float     AS anchor_dist
         FROM projection_snapshots
        WHERE user_uuid = $1::uuid
          AND vdot IS NOT NULL
        -- RULE 14 · a TOTAL order. Production holds three rows per
        -- (user, snapshot_date); without the last two keys which one came
        -- back was the planner's choice.
        ORDER BY snapshot_date DESC, distance_mi DESC, race_slug NULLS LAST
        LIMIT 1`,
      [userUuid],
    );
    rows = r.rows;
  } catch (err) {
    return {
      ok: false,
      reason: 'READ_FAILED',
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  const row = rows[0];
  if (!row || row.vdot == null || !Number.isFinite(Number(row.vdot))) {
    return { ok: false, reason: 'NO_SNAPSHOT', detail: 'no projection_snapshots row carries a vdot' };
  }

  const ageDays = Math.max(
    0,
    Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${row.snapshot_date}T12:00:00Z`)) / 86_400_000),
  );
  if (ageDays > VDOT_SNAPSHOT_MAX_AGE_DAYS) {
    return {
      ok: false,
      reason: 'STALE',
      detail: `snapshot is ${ageDays}d old (max ${VDOT_SNAPSHOT_MAX_AGE_DAYS}d) — it was faded as of ${row.snapshot_date}, not today`,
    };
  }

  return {
    ok: true,
    vdot: Number(row.vdot),
    snapshotDateISO: row.snapshot_date,
    ageDays,
    anchorDateISO: row.anchor_date ?? null,
    anchorDistanceMi: row.anchor_dist ?? null,
  };
}
