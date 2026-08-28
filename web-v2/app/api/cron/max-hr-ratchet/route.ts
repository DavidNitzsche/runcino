// POST /api/cron/max-hr-ratchet
//
// Daily standalone ratchet of users.max_hr to the canonical 12-month
// observed ceiling. Sister job to /api/cron/snapshot-projections (which
// also calls ratchetUsersMaxHr inline) — this keeps users.max_hr fresh
// even if the projection-snapshot cron stops running for any reason.
//
// Doctrine: lib/training/max-hr.ts.
//
//   The HRmax field on users is sovereign for legacy raw-SQL readers
//   (race-header SELECT, zone math fallbacks). If we never write to
//   it, those readers see whatever was set at signup (probably null
//   for new users) regardless of how much harder the runner trains.
//
// Pattern mirrors /api/cron/readiness-snapshot: shared CRON_SECRET,
// walks every active user, ratchets each, returns per-user results.
//
// Schedule (GitHub Actions): 30 8 * * * UTC = 01:30 PT. Runs after
// snapshot-projections (which fires at 15 8). If snapshot-projections
// is healthy, this is a no-op (already ratcheted by inline call). If
// snapshot-projections is broken, this guarantees the value still
// updates daily.

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { ratchetUsersMaxHr } from '@/lib/training/max-hr';
import { refreshProfileBiometrics } from '@/lib/training/biometrics-refresh';

export const maxDuration = 60;

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

  // 2026-06-03 · per-user TZ · ratchet anchored to runner's calendar day.
  const { runnerToday } = await import('@/lib/runtime/runner-tz');

  // Walk every active user. Same source as readiness-snapshot: any user
  // with an active plan. (2026-06-10 · multi-user: dropped the hardcoded
  // default-user append — the SELECT is the population.)
  const userIds = (await pool.query<{ user_uuid: string }>(
    `SELECT DISTINCT user_uuid FROM training_plans
      WHERE archived_iso IS NULL AND user_uuid IS NOT NULL`,
  ).catch(() => ({ rows: [] }))).rows.map((r) => r.user_uuid);

  const results: Array<{
    userUuid: string;
    newMax: number | null;
    rhr?: number | null;
    rhrSamples?: number;
    vo2?: number | null;
    error?: string;
  }> = [];
  let ratcheted = 0;
  let biometricsRefreshed = 0;

  for (const u of userIds) {
    try {
      const today = await runnerToday(u);
      const newMax = await ratchetUsersMaxHr(u, today);
      // 2026-08-28 · sibling snapshot: profile.rhr (7-day rolling · doctrine
      // Research/15-wearable-data.md "Establishing a baseline") and
      // profile.vo2max_apple (latest sample · display/reference only, never
      // pace input). Same posture as the max_hr ratchet this cron exists
      // for — keep the stored profile columns fresh for readers that bypass
      // the live resolvers, which had been NULL forever because nothing
      // wrote them. See lib/training/biometrics-refresh.ts.
      const bio = await refreshProfileBiometrics(u, today);
      if (bio.wrote.rhr || bio.wrote.vo2) biometricsRefreshed++;
      results.push({
        userUuid: u.slice(0, 8) + '…',
        newMax,
        rhr: bio.rhrBpm,
        rhrSamples: bio.rhrSamples,
        vo2: bio.vo2max,
      });
      if (newMax != null) ratcheted++;
    } catch (e: unknown) {
      results.push({
        userUuid: u.slice(0, 8) + '…',
        newMax: null,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    users: userIds.length,
    ratcheted,
    biometrics_refreshed: biometricsRefreshed,
    per_user: results,
    timestamp: new Date().toISOString(),
  });
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/cron/max-hr-ratchet',
    auth: 'Authorization: Bearer <CRON_SECRET>',
    description: 'Daily ratchet users.max_hr + profile.hrmax_observed to the 12-month observed ceiling, and refresh profile.rhr (7-day rolling) + profile.vo2max_apple (latest sample) for every active user.',
  });
}
