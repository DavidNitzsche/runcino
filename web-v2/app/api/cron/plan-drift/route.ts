// POST /api/cron/plan-drift
//
// Nightly scan of every active plan for drift signals. For each
// runner: load the active plan, compute DriftReport, and persist a
// pending plan_proposals row when one or more signals fire.
//
// Idempotent · we check hasPendingProposal before writing so the
// nightly run doesn't pile up identical "volume drift" rows.
//
// Same auth pattern as the other cron routes.

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { detectDrift, hasPendingProposal } from '@/lib/plan/drift-monitor';

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

  const userIds = (await pool.query<{ user_uuid: string }>(
    `SELECT DISTINCT user_uuid FROM training_plans
      WHERE archived_iso IS NULL AND user_uuid IS NOT NULL`,
  ).catch(() => ({ rows: [] }))).rows.map((r) => r.user_uuid);

  // Always include the default user (David's UUID · same pattern as the
  // other crons).
  const DEFAULT = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';
  if (!userIds.includes(DEFAULT)) userIds.push(DEFAULT);

  type UserResult = {
    user_uuid: string;
    plan_id: string | null;
    signals_found: number;
    proposals_written: number;
    signals_skipped: number;        // pending row already exists
    error?: string;
  };
  const results: UserResult[] = [];

  for (const u of userIds) {
    const r: UserResult = {
      user_uuid: u,
      plan_id: null,
      signals_found: 0,
      proposals_written: 0,
      signals_skipped: 0,
    };
    try {
      const report = await detectDrift(u);
      if (!report) {
        results.push(r);
        continue;
      }
      r.plan_id = report.planId;
      r.signals_found = report.signals.length;

      // Write each fresh signal as a pending proposal.
      for (const signal of report.signals) {
        const exists = await hasPendingProposal(u, report.planId, signal.kind);
        if (exists) {
          r.signals_skipped++;
          continue;
        }
        await pool.query(
          `INSERT INTO plan_proposals
             (user_uuid, plan_id, proposal_kind, reasons, status, source, created_at)
           VALUES ($1, $2, $3, $4::jsonb, 'pending', 'drift_cron', NOW())`,
          [
            u,
            report.planId,
            signal.kind,
            JSON.stringify({
              message: signal.message,
              severity: signal.severity,
              ...signal.details,
            }),
          ],
        );
        r.proposals_written++;
      }
    } catch (e: unknown) {
      r.error = e instanceof Error ? e.message : String(e);
    }
    results.push(r);
  }

  return NextResponse.json({
    ok: results.every((r) => !r.error),
    today: new Date().toISOString().slice(0, 10),
    users: results.length,
    written: results.reduce((s, r) => s + r.proposals_written, 0),
    skipped: results.reduce((s, r) => s + r.signals_skipped, 0),
    errors: results.filter((r) => r.error).length,
    results,
  });
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/cron/plan-drift',
    auth: 'Authorization: Bearer <CRON_SECRET>',
    recommended_schedule: '0 9 * * *  (daily at 02:00 PT = 09:00 UTC · runs AFTER snapshot-projections + readiness-snapshot)',
    triggers: [
      'volume_drift · current 28d avg deviates >40% from authored 4wk avg',
      'vdot_drift · current VDOT deviates >2 from plan anchor (inferred from T-pace)',
      'staleness · plan authored >8 weeks ago',
    ],
    note: 'Idempotent · checks for an existing pending proposal of the same kind before writing. Soft-drift only; hard-drift (race date / goal time / A-race add-or-remove) is handled by immediate-fire hooks at the route level.',
  });
}
