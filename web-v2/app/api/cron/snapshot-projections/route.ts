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
  bestRecentVdot, predictRaceTime,
} from '@/lib/training/vdot';
import { recordProjectionSnapshot } from '@/lib/training/projection-snapshots';
import { loadEffectiveMaxHr, ratchetUsersMaxHr } from '@/lib/training/max-hr';
import { loadVdotInputs } from '@/lib/training/vdot-inputs';

export const maxDuration = 60;

const CANONICAL_DISTANCES = [13.1, 26.2]; // HM + M; race-anchored distance added per user

function distFromLabel(label: string | null | undefined): number | null {
  const l = String(label ?? '').toLowerCase();
  if (l.includes('marathon') && !l.includes('half')) return 26.2;
  if (l.includes('half') || l.includes('21k')) return 13.1;
  if (l.includes('10k')) return 6.2;
  if (l.includes('5k')) return 3.1;
  return null;
}

async function snapshotForUser(userUuid: string, today: string): Promise<{ vdot: number | null; snapshots: Array<{ distance: number; sec: number | null }> }> {
  // Ratchet stored max_hr if a new ceiling was observed this year.
  // loadVdotInputs calls loadEffectiveMaxHr internally for the run-candidate
  // HR gate; we call it separately here for the ratchet side effect only.
  const effMaxHr = await loadEffectiveMaxHr(userUuid, today);
  if (effMaxHr.source === 'observed_12mo') {
    await ratchetUsersMaxHr(userUuid, today).catch(() => null);
  }

  // Race + run candidates via the shared canonical loader.
  // Throws on DB error — the outer loop catches per-user, logs, and continues
  // rather than storing VDOT=null from a transient failure.
  const { raceCandidates, runCandidates } = await loadVdotInputs(userUuid, today);
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
    // 2026-06-05 · backend audit P0-6 fix · scope race lookup by user.
    // Cite docs/2026-06-05-backend-audit.html § P0-6.
    const raceMeta = (await pool.query<{ meta?: Record<string, unknown> }>(
      `SELECT meta FROM races WHERE slug = $1 AND user_uuid = $2`,
      [planRow.race_id, userUuid],
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
    await recordProjectionSnapshot(
      userUuid, today, d, vdot, projSec, anchorSlug,
      best?.date ?? null, best?.distance_mi ?? null, 'cron-daily',
    );
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

  // 2026-06-03 · per-user TZ · each runner's snapshot is anchored to
  // their calendar day, not the server's UTC day.
  const { runnerToday } = await import('@/lib/runtime/runner-tz');
  const userIds = (await pool.query<{ user_uuid: string }>(
    `SELECT DISTINCT user_uuid FROM training_plans
      WHERE archived_iso IS NULL AND user_uuid IS NOT NULL`,
  ).catch(() => ({ rows: [] }))).rows.map((r) => r.user_uuid);

  // 2026-06-10 · multi-user: the SELECT above IS the population — no
  // hardcoded-user append. (Pre-signup this force-included David's UUID
  // as legacy-row paranoia; every active plan now carries user_uuid.)

  const results: Array<{ user_uuid: string; vdot: number | null; snapshots: Array<{ distance: number; sec: number | null }>; error?: string }> = [];
  for (const u of userIds) {
    try {
      const today = await runnerToday(u);
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
    // 2026-06-03 · per-runner today now resolved inside the loop;
    // top-level stamp is server UTC (a moment, not a calendar day).
    timestamp: new Date().toISOString(),
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
