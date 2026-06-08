/**
 * lib/shoe/auto-assign.ts · assign a shoe to a freshly-ingested run when
 * it landed without one. This is THE fix for watch/HealthKit runs, which
 * carry no Strava `gear` and so never matched the gear-only assigners —
 * auto-assign had never once fired in production (Overnight Item 16).
 *
 * Called from the single post-write chokepoint (post-write-hooks.ts
 * afterRunWrite) so one wire-in covers watch + HK + manual + future
 * ingest paths.
 *
 * Resolution priority (David's GO):
 *   1. Explicit /today pick   · day_actions(action='shoe') for the date
 *   2. Strava gear match      · matchShoeByGear (rare; watch/HK have none)
 *   3. Run-type recommend     · recommendShoe(garage, plannedType)
 *
 * Writes shoe_id + shoe_auto_assigned_at ONLY when shoe_id IS NULL — the
 * guard makes it idempotent and keeps it from clobbering a manual pick.
 * The stamp is set on every system-applied branch (including the day
 * pick) so a per-run modal assignment — which leaves the stamp NULL —
 * stays the most-specific signal and is never overridden.
 */
import { pool } from '@/lib/db/pool';
import { matchShoeByGear } from './gear-match';
import { computeShoeMileage } from './mileage';
import { recommendShoe, planTypeToShoeType, type GarageShoe } from './recommend';

export type ShoeAssignResult =
  | { status: 'skipped'; reason: string }
  | { status: 'fired'; shoeId: number; via: 'day_actions' | 'gear' | 'recommend' };

/**
 * Assign a shoe to `runId` (the BIGINT row id) when it has none.
 * Best-effort · returns a summary; never throws to the caller.
 */
export async function assignShoeIfMissing(
  userUuid: string,
  runId: string,
): Promise<ShoeAssignResult> {
  const row = (await pool.query<{
    shoe_id: number | null;
    d: string | null;
    dl: string | null;
    gear: unknown;
  }>(
    `SELECT shoe_id,
            data->>'date'                  AS d,
            LEFT(data->>'startLocal', 10)  AS dl,
            data->'gear'                   AS gear
       FROM runs
      WHERE user_uuid = $1 AND id = $2::BIGINT
      LIMIT 1`,
    [userUuid, runId],
  )).rows[0];

  if (!row) return { status: 'skipped', reason: 'run not found' };
  if (row.shoe_id != null) return { status: 'skipped', reason: 'already assigned' };

  const date = row.d ?? row.dl;
  if (!date) return { status: 'skipped', reason: 'run has no date' };

  let shoeId: number | null = null;
  let via: 'day_actions' | 'gear' | 'recommend' = 'recommend';

  // 1. Explicit /today pick — the runner said so, it wins.
  shoeId = await pickFromDayActions(userUuid, date);
  if (shoeId != null) via = 'day_actions';

  // 2. Strava gear (rare — watch/HK never carry it; Strava paths usually
  //    assign before this runs, but cover the case where they didn't).
  if (shoeId == null && row.gear) {
    shoeId = await matchShoeByGear({ userUuid, gear: row.gear });
    if (shoeId != null) via = 'gear';
  }

  // 3. Run-type recommend from the planned workout for that date.
  if (shoeId == null) {
    const plannedType = await resolvePlannedType(userUuid, date);
    const garage = await loadGarage(userUuid);
    const rec = recommendShoe(garage, planTypeToShoeType(plannedType));
    if (rec) {
      shoeId = Number(rec.id);
      via = 'recommend';
    }
  }

  if (shoeId == null) return { status: 'skipped', reason: 'no candidate shoe' };

  // Guarded write — only fills a still-null shoe_id (idempotent, race-safe).
  const upd = await pool.query(
    `UPDATE runs
        SET shoe_id = $1::int, shoe_auto_assigned_at = NOW()
      WHERE user_uuid = $2 AND id = $3::BIGINT AND shoe_id IS NULL
     RETURNING id`,
    [shoeId, userUuid, runId],
  );
  if (upd.rowCount === 0) return { status: 'skipped', reason: 'lost race · already assigned' };
  return { status: 'fired', shoeId, via };
}

/** The runner's explicit /today shoe pick for a date, validated as owned. */
async function pickFromDayActions(userUuid: string, date: string): Promise<number | null> {
  const note = (await pool.query<{ note: string | null }>(
    `SELECT note FROM day_actions
      WHERE COALESCE(user_uuid, user_id) = $1 AND date_iso = $2 AND action = 'shoe'
      LIMIT 1`,
    [userUuid, date],
  ).catch(() => ({ rows: [] as Array<{ note: string | null }> }))).rows[0]?.note;
  if (!note) return null;
  const id = Number(note);
  if (!Number.isFinite(id)) return null;
  // Confirm the picked shoe still exists for this runner (stale id guard).
  const owned = (await pool.query<{ id: number }>(
    `SELECT id FROM shoes WHERE id = $1 AND user_uuid = $2 LIMIT 1`,
    [id, userUuid],
  )).rows[0];
  return owned ? id : null;
}

/** Planned workout type for the date from the active plan, or null. */
async function resolvePlannedType(userUuid: string, date: string): Promise<string | null> {
  const pw = (await pool.query<{ type: string | null }>(
    `SELECT pw.type
       FROM plan_workouts pw
       JOIN training_plans tp ON tp.id = pw.plan_id
      WHERE tp.user_uuid = $1
        AND tp.archived_iso IS NULL
        AND pw.date_iso = $2
      LIMIT 1`,
    [userUuid, date],
  ).catch(() => ({ rows: [] as Array<{ type: string | null }> }))).rows[0];
  return pw?.type ?? null;
}

/** Active (non-retired) shoes with ON-READ mileage for the wear tiebreak. */
async function loadGarage(userUuid: string): Promise<GarageShoe[]> {
  const [rows, miles] = await Promise.all([
    pool.query(
      `SELECT id, brand, model, run_types,
              COALESCE(mileage_cap, 400)::numeric AS cap,
              COALESCE(preferred, false) AS preferred,
              COALESCE(retired, false)  AS retired
         FROM shoes
        WHERE user_uuid = $1 AND COALESCE(retired, false) = false`,
      [userUuid],
    ).then((r) => r.rows).catch(() => [] as any[]),
    computeShoeMileage(userUuid),
  ]);
  return rows.map((s: any) => ({
    id: Number(s.id),
    brand: s.brand,
    model: s.model,
    runTypes: s.run_types ?? [],
    // Real tracked miles — NOT the stale stored column — so the
    // lowest-mileage tiebreak actually spreads wear.
    mileage: miles.get(Number(s.id)) ?? 0,
    cap: s.cap == null ? null : Number(s.cap),
    preferred: s.preferred,
    retired: s.retired,
  }));
}
