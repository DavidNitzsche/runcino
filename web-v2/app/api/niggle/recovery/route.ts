/**
 * POST /api/niggle/recovery — body { today: 'better'|'same'|'worse'|'gone' }
 *
 * Records one daily trend check on the runner's active niggle. The chip
 * row under the Sibling MiniTileGrid POSTs here. Spec: deck §SECTION 06.
 *
 * Rules per the design doc:
 *   - 'gone'   → clears the parent niggle (sets cleared_at = now()).
 *   - 'worse'  → trend logged, severity stays on the original row (we
 *                don't auto-escalate; trend feeds the resolver's read).
 *   - 'better' → trend logged. (Future · drops grade after two consecutive.)
 *   - 'same'   → trend logged.
 *
 * Returns { active: boolean, trend: response }. active=false iff 'gone'.
 */

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';
import { runnerTimezone } from '@/lib/runtime/runner-tz';
import { nothingOpenBody } from '@/lib/health/checkin-refusal';

type NiggleTrend = 'better' | 'same' | 'worse' | 'gone';

interface RecoveryBody {
  today: NiggleTrend;
}

async function readJson(req: NextRequest): Promise<Partial<RecoveryBody>> {
  try {
    const text = await req.text();
    if (!text) return {};
    return JSON.parse(text) as Partial<RecoveryBody>;
  } catch {
    return {};
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const body = await readJson(req);
  const valid: NiggleTrend[] = ['better', 'same', 'worse', 'gone'];
  if (!body.today || !valid.includes(body.today)) {
    return NextResponse.json(
      { error: 'today must be one of better|same|worse|gone' },
      { status: 400 },
    );
  }

  try {
    // Find active niggle (scoped to caller)
    const active = (await pool.query(
      `SELECT id FROM niggles
        WHERE COALESCE(user_uuid, user_id) = $1 AND cleared_at IS NULL
        ORDER BY logged_at DESC
        LIMIT 1`,
      [userId],
    )).rows[0];

    if (!active) {
      // INJURYCHECKIN-1 · a DETERMINISTIC, PERMANENT "no". See
      // `lib/health/checkin-refusal.ts` for why this carries a sentence and
      // what the phone does with it: this is the injury-flare screen's own
      // check-in row, and it 404s every single time for a runner whose flare
      // came from `runner_injuries` rather than from a flagged niggle.
      return NextResponse.json(nothingOpenBody('niggle'), { status: 404 });
    }

    // INJURYCHECKIN-1 · A RETRY MUST NOT LOG THE SAME ANSWER TWICE.
    //
    // TODAYWRITE-2 gave `POST /api/sick` and `POST /api/niggle` a natural-key
    // guard for exactly this mechanism (the phone bounds a request at 12s, so
    // a write that lands and answers slowly is indistinguishable on the phone
    // from one that never left, and the row offers a Retry). It did NOT reach
    // the RECOVERY routes, which stayed bare INSERTs — one answer plus one
    // retry-after-lost-response wrote two identical trend rows.
    //
    // The natural key is the same shape as the report routes': everything
    // that identifies the thing being said. For a DAILY trend check that is
    // the niggle, the answer, and the runner's own day — so a genuine change
    // of mind ('better' after 'same') still lands, and so does the same
    // answer given again tomorrow. Only "the same answer, about the same
    // niggle, on the same day" is treated as the request already served.
    //
    // The day is the RUNNER'S, not the server's: a UTC date rolls at 17:00
    // Pacific, which would split one evening's check-in across two days.
    const tz = await runnerTimezone(userId);
    const ins = await pool.query(
      `WITH existing AS (
         SELECT id FROM niggle_recovery
          WHERE niggle_id = $1::bigint
            AND response = $2
            AND (logged_at AT TIME ZONE $3)::date = (now() AT TIME ZONE $3)::date
          ORDER BY logged_at ASC
          LIMIT 1
       ), inserted AS (
         INSERT INTO niggle_recovery (niggle_id, response)
         SELECT $1::bigint, $2
          WHERE NOT EXISTS (SELECT 1 FROM existing)
         RETURNING id
       )
       SELECT id, true  AS is_new FROM inserted
       UNION ALL
       SELECT id, false AS is_new FROM existing`,
      [active.id, body.today, tz],
    );
    // Rule 21 · observable. A silent dedup and a silent duplicate look
    // identical from outside, which is what let the report-route version of
    // this survive until a reviewer counted rows.
    const deduplicated = ins.rows[0]?.is_new === false;

    // 'gone' clears the parent niggle.
    //
    // TODAYWRITE-2 (2026-09-08) · EVERY active niggle, not the one row the
    // select above happened to pick. Same incident and same reasoning as
    // `app/api/sick/recovery/route.ts` — read that one for the full account.
    // The trend row above stays against the niggle the runner was looking at.
    if (body.today === 'gone') {
      const cleared = await pool.query(
        `UPDATE niggles
            SET cleared_at = now()
          WHERE COALESCE(user_uuid, user_id) = $1
            AND cleared_at IS NULL`,
        [userId],
      );
      return NextResponse.json({
        active: false, trend: 'gone', cleared: cleared.rowCount ?? 0, deduplicated,
      });
    }

    return NextResponse.json({ active: true, trend: body.today, deduplicated });
  } catch (err: any) {
    return NextResponse.json(
      { error: 'recovery insert failed', detail: err?.message ?? String(err) },
      { status: 500 },
    );
  }
}

export const dynamic = 'force-dynamic';
