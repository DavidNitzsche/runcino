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

      // 2026-06-01 · soft drift now AUTO-APPLIES (David's zero-gaps
      // directive · "no opening the app required"). Generator gaps
      // that previously made auto-rebuild risky for mid-block runners
      // are fixed (spec-builder.ts + detectMidBlock) so the rebuilt
      // plan preserves quality + carries pace targets + workout specs
      // from row one.
      //
      // To avoid thrashing on borderline drift, take ONLY THE HIGHEST-
      // SEVERITY signal per run · multiple signals (e.g. volume_drift
      // + staleness simultaneously) collapse into one rebuild.
      // Idempotency · skip if a rebuild already fired in last 24h via
      // any drift signal kind.
      const recent = await hasPendingProposal(u, report.planId, 'volume_drift')
        || await hasPendingProposal(u, report.planId, 'vdot_drift')
        || await hasPendingProposal(u, report.planId, 'staleness');
      if (recent) {
        r.signals_skipped = report.signals.length;
      } else if (report.primary) {
        const signal = report.primary;
        // Run the rebuild via fireAutoRebuild · same path the hard-drift
        // hooks use · same audit shape · same dedupe window.
        try {
          const { fireAutoRebuild } = await import('@/lib/plan/auto-rebuild');
          // Look up the goal race slug for the plan
          const plan = (await pool.query<{ race_id: string | null }>(
            `SELECT race_id FROM training_plans WHERE id = $1`,
            [report.planId],
          ).catch(() => ({ rows: [] }))).rows[0];
          if (plan?.race_id) {
            await fireAutoRebuild({
              userUuid: u,
              raceSlug: plan.race_id,
              // Map drift kind → AutoRebuildKind · we reuse the existing
              // hard-drift kinds since drift IS a recalibration trigger.
              // The proposal row's `reasons.drift_kind` carries the soft
              // signal that fired so the runner sees why.
              kind: 'goal_time_changed',  // synthetic · "recalibrate"
              reasons: {
                drift_kind: signal.kind,
                message: signal.message,
                severity: signal.severity,
                ...signal.details,
              },
              source: 'drift_cron_auto',
            });
            r.proposals_written++;
          }
        } catch (e: unknown) {
          // If auto-rebuild fails, fall back to writing a pending proposal
          // (the old behavior · runner sees a card to manually accept)
          await pool.query(
            `INSERT INTO plan_proposals
               (user_uuid, plan_id, proposal_kind, reasons, status, source, created_at)
             VALUES ($1, $2, $3, $4::jsonb, 'pending', 'drift_cron_fallback', NOW())`,
            [
              u, report.planId, signal.kind,
              JSON.stringify({
                message: signal.message,
                severity: signal.severity,
                auto_rebuild_error: e instanceof Error ? e.message : String(e),
                ...signal.details,
              }),
            ],
          );
          r.proposals_written++;
        }
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
