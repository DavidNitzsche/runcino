// POST /api/cron/snapshot-projections
//
// Daily VDOT + projection snapshot for every active user. Runs once
// per day; cheap to re-run (UPSERTs idempotently on the
// (user_uuid, snapshot_date, distance_mi) UNIQUE).
//
// Snapshots are read by race-header.ts to compute the projection-trend
// delta without re-running the full VDOT chain across 180 days of data
// on every page load.
//
// For each active user:
//   1. Read recent A/B races (last 180d, with actual_result preference)
//   2. Read recent quality runs (last 60d, ≥4mi, ≥80%MHR or quality-typed)
//   3. Compute bestRecentVdot off race + run candidates
//   4. Compute projection for each canonical distance (HM, M) + the user's
//      anchored race distance if different
//   5. UPSERT projection_snapshots row
//
// Auth: same CRON_SECRET as other cron routes.

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import {
  bestRecentVdot, predictRaceTime, parseRaceTime,
} from '@/lib/training/vdot';
import { recordProjectionSnapshot } from '@/lib/training/projection-snapshots';

export const maxDuration = 60;

const CANONICAL_DISTANCES = [13.1, 26.2]; // HM + M; race-anchored distance added per user

interface RaceRow {
  slug: string;
  meta?: Record<string, unknown>;
  actual_result?: Record<string, unknown>;
}
interface RunRow {
  id: string;
  data: Record<string, unknown>;
}

function distFromLabel(label: string | null | undefined): number | null {
  const l = String(label ?? '').toLowerCase();
  if (l.includes('marathon') && !l.includes('half')) return 26.2;
  if (l.includes('half') || l.includes('21k')) return 13.1;
  if (l.includes('10k')) return 6.2;
  if (l.includes('5k')) return 3.1;
  return null;
}

async function snapshotForUser(userUuid: string, today: string): Promise<{ vdot: number | null; snapshots: Array<{ distance: number; sec: number | null }> }> {
  // Pull race rows (180d window, A/B only).
  const raceRows = (await pool.query<RaceRow>(
    `SELECT slug, meta, actual_result FROM races
      WHERE user_uuid = $1
        AND (meta->>'date')::date >= ($2::date - interval '180 days')::date
        AND (meta->>'date')::date < $2::date
        AND meta->>'priority' IN ('A', 'B')`,
    [userUuid, today],
  ).catch(() => ({ rows: [] }))).rows;

  // Strava match-fallback runs (window-wide).
  const earliestDate = raceRows.length
    ? raceRows.reduce((min: string, r) => {
        const d = (r.meta?.date as string) ?? '';
        return !min || (d && d < min) ? d : min;
      }, '')
    : '';
  const matchRuns = earliestDate
    ? (await pool.query<RunRow>(
        `SELECT id::text AS id, data FROM runs
          WHERE user_uuid = $1
            AND NOT (data ? 'mergedIntoId')
            AND (data->>'distanceMi')::numeric > 2.5
            AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) >= $2
            AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) <= $3`,
        [userUuid, earliestDate, today],
      ).catch(() => ({ rows: [] }))).rows
    : [];

  const raceCandidates = raceRows.map((r) => {
    const m = (r.meta ?? {}) as Record<string, unknown>;
    const ar = (r.actual_result ?? {}) as Record<string, unknown>;
    const distMi = m.distanceMi ? Number(m.distanceMi) : distFromLabel(m.distanceLabel as string);
    let finishSec: number | null = ar.finishS != null ? Number(ar.finishS) : null;
    if (!finishSec) finishSec = parseRaceTime(m.finishTime as string);
    if (!finishSec && distMi && m.date) {
      let best: Record<string, unknown> | null = null;
      let bestScore = Infinity;
      for (const c of matchRuns) {
        const d = c.data;
        const day = (d.date as string) || String(d.startLocal ?? '').slice(0, 10);
        if (!day) continue;
        const dayDelta = Math.abs((Date.parse(day + 'T12:00:00Z') - Date.parse((m.date as string) + 'T12:00:00Z')) / 86400000);
        if (dayDelta > 1) continue;
        const miDelta = Math.abs(Number(d.distanceMi) - distMi);
        if (miDelta > 2.0) continue;
        const score = dayDelta * 10 + miDelta;
        if (score < bestScore) { best = d; bestScore = score; }
      }
      if (best) finishSec = Number(best.movingTimeS) || Number(best.elapsedTimeS) || null;
    }
    return {
      slug: r.slug,
      name: (m.name as string) ?? r.slug,
      date: (m.date as string) ?? '',
      priority: ((m.priority as string) ?? null) as 'A' | 'B' | 'C' | null,
      distance_mi: distMi,
      finish_seconds: finishSec,
    };
  });

  // Recent quality runs (last 60d) for training-derived VDOT.
  // Excludes runs on race days (race effort belongs in the races ladder).
  const qualityCutoff = new Date(Date.parse(today + 'T12:00:00Z') - 60 * 86400000).toISOString().slice(0, 10);
  const recentRuns = (await pool.query<{
    id: string; date: string; workout_type: string | null;
    distance_mi: string | null; finish_seconds: string | null; avg_hr: string | null;
  }>(
    `SELECT sa.id::text AS id,
            COALESCE(sa.data->>'date', LEFT(sa.data->>'startLocal',10)) AS date,
            sa.data->>'workoutType' AS workout_type,
            (sa.data->>'distanceMi')::numeric AS distance_mi,
            (sa.data->>'movingTimeS')::numeric AS finish_seconds,
            (sa.data->>'avgHr')::numeric AS avg_hr
       FROM runs sa
      WHERE sa.user_uuid = $1
        AND NOT (sa.data ? 'mergedIntoId')
        AND COALESCE(sa.data->>'date', LEFT(sa.data->>'startLocal',10)) >= $2
        AND COALESCE(sa.data->>'date', LEFT(sa.data->>'startLocal',10)) < $3
        AND (sa.data->>'distanceMi')::numeric >= 4
        AND (sa.data->>'movingTimeS')::numeric > 60
        AND NOT EXISTS (
          SELECT 1 FROM races r
           WHERE r.user_uuid = $1
             AND ABS((r.meta->>'date')::date - COALESCE(sa.data->>'date', LEFT(sa.data->>'startLocal',10))::date) <= 1
        )`,
    [userUuid, qualityCutoff, today],
  ).catch(() => ({ rows: [] }))).rows;

  const userMaxHr = (await pool.query(
    `SELECT COALESCE(max_hr_override, max_hr) AS m FROM users WHERE id = $1`,
    [userUuid],
  ).catch(() => ({ rows: [] }))).rows[0]?.m;
  const maxHrValue = userMaxHr != null ? Number(userMaxHr) : null;

  const runCandidates = recentRuns.map((r) => ({
    id: String(r.id),
    date: r.date,
    workout_type: r.workout_type,
    distance_mi: r.distance_mi != null ? Number(r.distance_mi) : null,
    finish_seconds: r.finish_seconds != null ? Number(r.finish_seconds) : null,
    avg_hr: r.avg_hr != null ? Number(r.avg_hr) : null,
    max_hr: maxHrValue,
  }));

  const { best } = bestRecentVdot(raceCandidates, today, 180, runCandidates);
  const vdot = best?.vdot ?? null;

  // Race-anchored distance (if active plan ties to a race).
  const planRow = (await pool.query<{ race_id: string | null }>(
    `SELECT race_id FROM training_plans
      WHERE user_uuid = $1 AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [userUuid],
  ).catch(() => ({ rows: [] }))).rows[0];
  let anchorDistance: number | null = null;
  let anchorSlug: string | null = null;
  if (planRow?.race_id) {
    const raceMeta = (await pool.query<{ meta?: Record<string, unknown> }>(
      `SELECT meta FROM races WHERE slug = $1`, [planRow.race_id],
    ).catch(() => ({ rows: [] }))).rows[0]?.meta;
    if (raceMeta) {
      anchorDistance = raceMeta.distanceMi ? Number(raceMeta.distanceMi) : distFromLabel(raceMeta.distanceLabel as string);
      anchorSlug = planRow.race_id;
    }
  }

  const distancesToSnapshot = new Set([...CANONICAL_DISTANCES]);
  if (anchorDistance && !distancesToSnapshot.has(anchorDistance)) distancesToSnapshot.add(anchorDistance);

  const snapshots: Array<{ distance: number; sec: number | null }> = [];
  for (const d of distancesToSnapshot) {
    const projSec = vdot != null ? predictRaceTime(vdot, d) : null;
    await recordProjectionSnapshot(userUuid, today, d, vdot, projSec, anchorSlug, 'cron-daily');
    snapshots.push({ distance: d, sec: projSec });
  }
  return { vdot, snapshots };
}

export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({
      error: 'CRON_SECRET not configured.',
    }, { status: 503 });
  }
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (token !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const userIds = (await pool.query<{ user_uuid: string }>(
    `SELECT DISTINCT user_uuid FROM training_plans
      WHERE archived_iso IS NULL AND user_uuid IS NOT NULL`,
  ).catch(() => ({ rows: [] }))).rows.map((r) => r.user_uuid);

  // Always include David (legacy 'me'-anchored).
  const DAVID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';
  if (!userIds.includes(DAVID)) userIds.push(DAVID);

  const results: Array<{ user_uuid: string; vdot: number | null; snapshots: Array<{ distance: number; sec: number | null }>; error?: string }> = [];
  for (const u of userIds) {
    try {
      const r = await snapshotForUser(u, today);
      results.push({ user_uuid: u, vdot: r.vdot, snapshots: r.snapshots });
    } catch (e: unknown) {
      results.push({
        user_uuid: u, vdot: null, snapshots: [],
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return NextResponse.json({
    ok: results.every((r) => !r.error),
    today,
    users: results.length,
    results,
  });
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/cron/snapshot-projections',
    auth: 'Authorization: Bearer <CRON_SECRET>',
    recommended_schedule: '30 7 * * *  (daily at 00:30 PT = 07:30 UTC)',
  });
}
