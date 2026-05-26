/**
 * POST /api/cron/run-adaptations  (P38)
 *
 * Daily adaptation pass — detects triggers (missed key workout, RHR
 * spike, sleep crater, volume overshoot) and applies actions to
 * plan_workouts. Idempotent.
 *
 * Auth: CRON_SECRET. Schedule: 07:15 UTC = 00:15 PT (between briefing
 * cron at 07:05 and weather cron at 07:30). Adaptation must happen
 * BEFORE the morning briefing reads the plan so the coach sees the
 * adapted state.
 *
 * Runs over all active users (training_plans with archived_iso IS NULL).
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { detectAdaptations, applyAdaptations } from '@/lib/plan/adapt';
import { bustBriefingCache } from '@/lib/coach/cache';
import { raiseAlert } from '@/lib/ops/alerts';

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
  }
  const auth = req.headers.get('authorization') ?? '';
  if (auth.replace(/^Bearer\s+/i, '').trim() !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let userIds: string[] = [];
  try {
    userIds = (await pool.query(
      `SELECT DISTINCT user_uuid::text AS uid FROM training_plans
        WHERE archived_iso IS NULL AND user_uuid IS NOT NULL`,
    )).rows.map((r: any) => r.uid);
  } catch (e: any) {
    return NextResponse.json({ error: 'failed to list users', detail: e.message }, { status: 500 });
  }

  const results: Array<{ user_id: string; triggers: number; applied: number; error?: string }> = [];
  for (const uid of userIds) {
    try {
      const { triggers, actions } = await detectAdaptations(uid);
      const applied = await applyAdaptations(uid, actions);
      if (applied > 0) await bustBriefingCache(uid);
      results.push({ user_id: uid, triggers: triggers.length, applied });
    } catch (e: any) {
      results.push({ user_id: uid, triggers: 0, applied: 0, error: e?.message ?? String(e) });
      await raiseAlert({
        kind: 'regen_fail',
        severity: 'warn',
        message: `Adaptation failed for ${uid}: ${e?.message}`,
        source: 'cron/run-adaptations',
      }).catch(() => {});
    }
  }
  const totalApplied = results.reduce((a, r) => a + r.applied, 0);
  return NextResponse.json({
    ok: true,
    users: userIds.length,
    total_applied: totalApplied,
    results,
    timestamp: new Date().toISOString(),
  });
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/cron/run-adaptations',
    auth: 'Authorization: Bearer <CRON_SECRET>',
    schedule: '15 7 * * * UTC (00:15 PT)',
  });
}
