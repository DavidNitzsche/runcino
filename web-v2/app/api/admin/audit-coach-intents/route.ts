/**
 * GET /api/admin/audit-coach-intents
 *
 * Read-only diagnostic · why does the WhatChangedExpander show "No
 * plan adaptations in the last 30 days" when the runner has recent
 * adapter activity (the week-strip chip surfaces a "was X" annotation
 * on the restored Tue 6/02 row)?
 *
 * The chip data comes from `seed.season.adaptations` (built by
 * seed.ts:loadPlanAdapts, filters `WHERE ci.user_id = $1`).
 * The expander data comes from `/api/coach/intents` (filters
 * `WHERE COALESCE(user_uuid::text, user_id) = $1`).
 *
 * If both filters resolve to the same $1, both queries find the
 * same rows. If a writer landed rows with the user_uuid column
 * NULL (or the user_id column NULL), one filter finds and the other
 * misses. This endpoint surfaces:
 *
 *   - userId from auth · the value both filters use as $1
 *   - row count by (user_id matches, user_uuid matches, BOTH match) ·
 *     in the last 30 days, reason LIKE 'plan_adapt%'
 *   - last 5 plan_adapt_* rows with both column values + ts + reason
 *   - the most-recent restore + downgrade events on the runner's plan
 *
 * Doctrine · this is OPERATIONAL (per CLAUDE.md): agent-built diagnostic,
 * read-only, rate-limited by being agent-invoked. Run it, surface
 * the result, don't bury it in a status doc.
 */

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  try {
    // Row counts under each filter strategy.
    const countByFilter = await pool.query<{ kind: string; n: string }>(
      `SELECT 'user_id_match' AS kind, COUNT(*)::text AS n
         FROM coach_intents
        WHERE user_id::text = $1
          AND ts >= NOW() - INTERVAL '30 days'
          AND reason LIKE 'plan_adapt%'
       UNION ALL
       SELECT 'user_uuid_match',  COUNT(*)::text
         FROM coach_intents
        WHERE user_uuid::text = $1
          AND ts >= NOW() - INTERVAL '30 days'
          AND reason LIKE 'plan_adapt%'
       UNION ALL
       SELECT 'coalesce_match', COUNT(*)::text
         FROM coach_intents
        WHERE COALESCE(user_uuid::text, user_id::text) = $1
          AND ts >= NOW() - INTERVAL '30 days'
          AND reason LIKE 'plan_adapt%'
       UNION ALL
       SELECT 'user_id_match_ALL_TIME', COUNT(*)::text
         FROM coach_intents
        WHERE user_id::text = $1
          AND reason LIKE 'plan_adapt%'
       UNION ALL
       SELECT 'user_uuid_match_ALL_TIME', COUNT(*)::text
         FROM coach_intents
        WHERE user_uuid::text = $1
          AND reason LIKE 'plan_adapt%'
       UNION ALL
       SELECT 'any_reason_30d', COUNT(*)::text
         FROM coach_intents
        WHERE COALESCE(user_uuid::text, user_id::text) = $1
          AND ts >= NOW() - INTERVAL '30 days'`,
      [userId]
    );

    // Last 5 plan_adapt rows · show both column values so we can see
    // which column is being populated.
    const recent = await pool.query<{
      ts: string;
      reason: string;
      user_id_txt: string | null;
      user_uuid_txt: string | null;
      both_match: boolean;
      field: string | null;
      value: string | null;
    }>(
      `SELECT ts::text,
              reason,
              user_id::text AS user_id_txt,
              user_uuid::text AS user_uuid_txt,
              (user_id::text = $1 AND user_uuid::text = $1) AS both_match,
              field,
              value
         FROM coach_intents
        WHERE (user_id::text = $1 OR user_uuid::text = $1)
          AND reason LIKE 'plan_adapt%'
        ORDER BY ts DESC
        LIMIT 5`,
      [userId]
    );

    // Distinct reason strings for this runner (any time).
    const reasons = await pool.query<{ reason: string; n: string }>(
      `SELECT reason, COUNT(*)::text AS n
         FROM coach_intents
        WHERE (user_id::text = $1 OR user_uuid::text = $1)
        GROUP BY reason
        ORDER BY MAX(ts) DESC
        LIMIT 20`,
      [userId]
    );

    return NextResponse.json({
      ok: true,
      userId,
      counts: countByFilter.rows.reduce((acc, r) => {
        acc[r.kind] = parseInt(r.n, 10);
        return acc;
      }, {} as Record<string, number>),
      recent: recent.rows,
      reasons: reasons.rows.map(r => ({ reason: r.reason, n: parseInt(r.n, 10) })),
    });
  } catch (e: unknown) {
    return NextResponse.json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }, { status: 500 });
  }
}
