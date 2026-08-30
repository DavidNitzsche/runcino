/**
 * P27.3 — automatic run de-duplication (the writer).
 *
 * One physical run can land as multiple `runs` rows from different ingest
 * paths that share no id (watch keys on workoutId, HK on HKWorkout.uuid,
 * Strava on its activity id). autoMergeForDate flags the dupes: it clusters
 * a day's rows by physical-run identity, picks the canonical, sets
 * `data.mergedIntoId` on every loser, and absorbs the losers' unique fields
 * into the canonical (lib/runs/canonical.ts).
 *
 * Identity (isSameRun) + canonical selection (pickCanonical) live in
 * lib/runs/identity.ts and are the SAME logic the read-time volume reader
 * (lib/runs/volume.ts:mileageByDay) uses — so write- and read-time dedup can
 * never disagree. Idempotent.
 */
import { pool } from '@/lib/db/pool';
import { runDaySql } from '@/lib/runs/run-shape';
import { runnerToday, runnerTimezoneOrPacific } from '@/lib/runtime/runner-tz';
import { enhanceCanonicalFromAbsorbed } from '@/lib/runs/canonical';
import { planMergeOps, type RunRow } from '@/lib/runs/identity';
import { mileageByDay } from '@/lib/runs/volume';

/**
 * Run auto-merge for one user's runs on a given local date.
 *
 * @param userId  Postgres uuid for the runner
 * @param dateISO YYYY-MM-DD, the runner-local date. Callers MUST pass the
 *                run's own startLocal-derived date (Fix 1) — the UTC-now
 *                default only applies when called bare.
 * @returns count of rows whose mergedIntoId state changed.
 */
export async function autoMergeForDate(
  userId: string,
  dateISO?: string,
): Promise<{ changed: number; clusters: number }> {
  const date = dateISO ?? await runnerToday(userId);

  // 2026-07-06 · audit P1-51 · bare wall-clock startLocal values are
  // interpreted in the RUNNER'S timezone (LA fallback preserves the
  // pre-multiuser behavior for null-tz profiles). Rows with an explicit
  // data.timezone are unaffected — identity.ts prefers the row's own tz.
  // Resolved BEFORE the lock so the lock is held for flag writes only.
  const runnerTz = await runnerTimezoneOrPacific(userId);

  /* ══════════════════════════════════════════════════════════════════════
   * ONE PASS AT A TIME, AND ALL OF IT OR NONE OF IT
   *
   * 2026-08-30. This function is called from /api/watch/workouts/complete,
   * /api/ingest/workout, /api/strava/webhook, /api/run/manual and the nightly
   * cron/dedupe-runs — five callers that routinely fire for the SAME
   * (user, date) within seconds of each other, because one physical run
   * arrives from three providers at once.
   *
   * It used to read its rows on the pool, plan against that snapshot, and
   * apply the plan as independent `await pool.query` statements. Two passes
   * whose snapshots disagreed about which row was canonical could therefore
   * interleave their statements, and the interleaving that mints the orphan
   * needs only three of them in the wrong order:
   *
   *   stale pass  · sets    R → C          (R is the loser, says the old plan)
   *   fresh pass  · clears  R              (strip BOTH markers · R is canonical now)
   *   stale pass  · stamps  R absorbed     (the old plan's last step)
   *
   * R ends up stamped, pointerless, and canonical — with the fresh pass having
   * already pointed the real duplicates at it. Seven of the owner's days, 63.0
   * miles, invisible for up to ten weeks. `lib/audit/automatic-mutation-
   * registry.ts` had already written down that this pass was "NOT
   * TRANSACTIONAL" and ran "with no advisory lock"; this is that debt paid.
   *
   * The transaction-scoped advisory lock serialises passes for one (user,
   * date) and nothing else — two runners, or one runner's two days, still run
   * in parallel. The rows are re-read INSIDE the lock, so a pass that waited
   * plans against what the pass ahead of it committed rather than against the
   * state it saw before queuing. The plan then commits whole, so there is no
   * middle a concurrent reader or a crash can observe.
   *
   * The absorptions stay OUTSIDE the transaction on purpose: they are a
   * read-modify-write per loser that must not take a single bad row's failure
   * as a reason to roll back everyone else's flags, and they hold no lock
   * while doing HTTP-free but multi-statement work. Their safety comes from
   * canonical.ts's conditional stamp, which refuses to write a stamp the
   * committed state no longer entitles it to.
   * ═══════════════════════════════════════════════════════════════════ */
  const client = await pool.connect();
  let rows: RunRow[] = [];
  let clears: string[] = [];
  let sets: Array<{ id: string; canonicalId: string }> = [];
  let absorptions: Array<{ canonicalId: string; loserId: string }> = [];
  let clusters = 0;
  let changed = 0;
  try {
    await client.query('BEGIN');
    // Held until COMMIT/ROLLBACK. hashtext() gives the two int4 keys the
    // two-argument form wants, so (user, date) never collides with (user,
    // other date).
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext($2::text))`,
      [userId, date],
    );

    // Load ALL of the day's rows UNFILTERED (merged + unmerged). planMergeOps
    // re-derives the canonical state from physical-run identity, so it can heal
    // a day whose flags are corrupt — a circular A↔B pair, a row orphaned by a
    // prior unstable clustering, or a canonical left holding a stale absorption
    // stamp — not just flag fresh dupes. `absorbed_into_canonical_at` is
    // selected because that last case is invisible without it.
    rows = (await client.query(
      `SELECT id::text AS id, user_uuid::text AS user_uuid, data,
              absorbed_into_canonical_at::text AS "absorbedAt"
         FROM runs
        WHERE user_uuid = $1
          AND ${runDaySql()} = $2`,
      [userId, date],
    )).rows as RunRow[];

    if (rows.length === 0) {
      await client.query('COMMIT');
      return { changed: 0, clusters: 0 };
    }

    ({ clears, sets, absorptions, clusters } = planMergeOps(rows, runnerTz));

    // ORDER MATTERS · clear canonical/orphan flags FIRST, then point the
    // losers. A loser is therefore never set to point at a row that still
    // points back, so no circular mergedIntoId can survive a merge pass (the
    // 2026-06-07 bug class that zeroed 5 of David's days in volume.ts).
    for (const id of clears) {
      // 2026-06-11 · clear absorbed_into_canonical_at TOO. A row promoted from
      // loser → canonical (its mergedIntoId removed) kept a stale absorbed
      // stamp from when it WAS a loser, and readers that filtered on the stamp
      // dropped the promoted canonical entirely.
      // A non-merged row is canonical; it is not "absorbed into" anything.
      await client.query(
        `UPDATE runs SET data = data - 'mergedIntoId', absorbed_into_canonical_at = NULL WHERE id = $1::BIGINT`,
        [id],
      );
      changed++;
    }
    for (const { id, canonicalId } of sets) {
      await client.query(
        `UPDATE runs SET data = jsonb_set(data, '{mergedIntoId}', to_jsonb($1::BIGINT)) WHERE id = $2::BIGINT`,
        [canonicalId, id],
      );
      changed++;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // Absorb each loser's unique fields into its canonical. Idempotent; a single
  // bad row never blocks the rest. Runs AFTER the flag transaction has
  // COMMITTED so the absorber's read-modify-write of the canonical sees the
  // cleared (no-mergedIntoId) state, and so its own conditional stamp reads
  // committed flags rather than this pass's uncommitted ones.
  let stampsRefused = 0;
  for (const { canonicalId, loserId } of absorptions) {
    const loser = rows.find((r) => r.id === loserId);
    if (!loser?.user_uuid) continue;
    try {
      const res = await enhanceCanonicalFromAbsorbed({
        canonicalId,
        absorbedRow: { id: loser.id, data: loser.data ?? {}, user_uuid: loser.user_uuid },
      });
      if (res.stampRefused) stampsRefused++;
    } catch (err) {
      console.warn('[merge] absorber failed for', loserId, '→', canonicalId, err);
    }
  }
  if (stampsRefused > 0) {
    // Not an error — a refused stamp is the guard working. Worth a line so a
    // sustained rate is visible rather than inferred from a mileage total.
    console.warn(
      `[merge] autoMergeForDate · user=${userId.slice(0, 8)} date=${date} · ` +
      `${stampsRefused} absorption stamp(s) refused · a concurrent pass changed the plan under this one.`,
    );
  }

  // Loud log when a >1-row day produced no flag change — historically the
  // parallel-ingest race (each endpoint saw only its own row). Now rarer:
  // Fix 1 fires autoMerge on the correct startLocal-derived date from both
  // ingest paths, so both rows are present when the second one lands.
  if (rows.length >= 2 && clears.length === 0 && sets.length === 0) {
    const sources = rows.map((r) => r.data?.source ?? '?').join(',');
    console.warn(
      `[merge] autoMergeForDate · user=${userId.slice(0, 8)} date=${date} · ` +
      `${rows.length} rows · ${clusters} clusters · 0 merges fired · sources=${sources}`,
    );
  }

  return { changed, clusters };
}

/**
 * Convenience: re-merge the latest N days (after a webhook or backfill).
 * Sequential — cheap, and ordering doesn't matter.
 */
export async function autoMergeRecent(
  userId: string,
  days: number = 3,
): Promise<{ totalChanged: number }> {
  const today = new Date();
  let totalChanged = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const { changed } = await autoMergeForDate(userId, d.toISOString().slice(0, 10));
    totalChanged += changed;
  }
  return { totalChanged };
}

/**
 * Canonical mileage per day — thin wrapper over the single reader
 * (lib/runs/volume.ts:mileageByDay), kept for its existing call sites
 * (state-loader, glance-state, plan/week, onboarding/strava-history).
 * Phase B migrates those to mileageByDay directly and removes this.
 */
export async function canonicalMileageByDay(
  userId: string,
  fromDate: string,
  toDate: string,
): Promise<Map<string, { mi: number; canonicalIds: string[] }>> {
  return mileageByDay(userId, fromDate, toDate);
}
