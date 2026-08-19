/**
 * GET /api/admin/plan-mutation-rejections
 *
 * Read-only view of the plan mutation boundary's audit trail
 * (`plan_mutation_rejections`, db/migrations/150). This is the "recorded so it
 * is visible" half of the rejection policy in lib/plan/mutate.ts — a refused
 * adaptation that nobody ever sees is the same class of bug as an unguarded
 * write, so the refusals have somewhere to be read.
 *
 * Query:
 *   ?limit=50              rows to return (default 50, max 500)
 *   ?outcome=rejected      filter to one outcome
 *   ?user=<uuid>           filter to one runner
 *   ?since=YYYY-MM-DD      only rows at/after this date
 *
 * Outcomes: rejected · undeclared_structural · bypassed · authorship_drift ·
 * no_plan. See the migration header for what each means.
 *
 * Admin-scoped. Diagnostics only — nothing here mutates.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireAdmin } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const sp = req.nextUrl.searchParams;
  const limit = Math.min(500, Math.max(1, Number(sp.get('limit')) || 50));
  const outcome = sp.get('outcome');
  const user = sp.get('user');
  const since = sp.get('since');

  const where: string[] = [];
  const params: unknown[] = [];
  if (outcome) { params.push(outcome); where.push(`outcome = $${params.length}`); }
  if (user) { params.push(user); where.push(`user_uuid = $${params.length}::uuid`); }
  if (since && /^\d{4}-\d{2}-\d{2}$/.test(since)) {
    params.push(since); where.push(`at >= $${params.length}::date`);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  try {
    const rows = (await pool.query(
      `SELECT id, at, user_uuid::text AS user_uuid, plan_id, source, outcome,
              violations, pre_existing, detail
         FROM plan_mutation_rejections
         ${whereSql}
        ORDER BY at DESC
        LIMIT ${limit}`,
      params,
    )).rows;

    const counts = (await pool.query(
      `SELECT outcome, COUNT(*)::int AS n
         FROM plan_mutation_rejections
         ${whereSql}
        GROUP BY outcome
        ORDER BY n DESC`,
      params,
    )).rows;

    return NextResponse.json({ ok: true, counts, rows });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        ok: false,
        error: msg,
        hint: 'Did you apply web-v2/db/migrations/150_plan_mutation_rejections.sql?',
      },
      { status: 500 },
    );
  }
}
