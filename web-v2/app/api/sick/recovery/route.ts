/**
 * POST /api/sick/recovery — body { today: 'better'|'same'|'worse'|'recovered' }
 *
 * Records one daily trend check on the runner's active sick episode. The
 * "Ready to run?" CTA on the return-gate card POSTs { today: 'recovered' }.
 *
 * Rules per the design doc §07:
 *   - 'recovered' → clears the episode (sets cleared_at = now()). The
 *                   resolver next reads no active episode → returns to
 *                   the base-4 surface (easy/long/quality/rest).
 *   - 'better'    → trend logged.
 *   - 'same'      → trend logged.
 *   - 'worse'     → trend logged. (Future · could escalate to a
 *                   "consider clinical input" surface on day 7+.)
 *
 * The recovery gates (fever-free 24h + sleep ≥ 7h + RHR within +5 of
 * baseline) are EVALUATED in the resolver/glance-state — the API doesn't
 * gate the 'recovered' POST. The UI hides the CTA until gates clear.
 */

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { attempt } from '@/lib/db/read';
import { requireUserId } from '@/lib/auth/session';

type SickTrend = 'better' | 'same' | 'worse' | 'recovered';

interface RecoveryBody {
  today: SickTrend;
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
  const valid: SickTrend[] = ['better', 'same', 'worse', 'recovered'];
  if (!body.today || !valid.includes(body.today)) {
    return NextResponse.json(
      { error: 'today must be one of better|same|worse|recovered' },
      { status: 400 },
    );
  }

  try {
    const active = (await pool.query(
      `SELECT id FROM sick_episodes
        WHERE COALESCE(user_uuid, user_id) = $1 AND cleared_at IS NULL
        ORDER BY logged_at DESC
        LIMIT 1`,
      [userId],
    )).rows[0];

    if (!active) {
      return NextResponse.json({ error: 'no active sick episode' }, { status: 404 });
    }

    // 2026-08-24 · `sick_recovery` did not exist in production — migration 117
    // declares it alongside `sick_episodes` and only the first table landed.
    // This INSERT threw, the handler answered 500 "recovery insert failed", and
    // the `cleared_at` update below never ran. A runner tapping "recovered" got
    // an error and STAYED MARKED SICK, so the plan stayed paused on an illness
    // they had told us was over.
    //
    // Two fixes, and the order matters. The table now exists (migration 154,
    // applied to prod 2026-08-24), so the trend row lands. And this `attempt()`
    // stays regardless: clearing the episode is what the runner asked for, the
    // append-only log is not worth blocking it, and the state change must not
    // be reachable by a failure in the line above it. Falsified by injecting an
    // INSERT failure on a local clone — the episode still cleared, Today still
    // handed the day back to the plan, and the failure was loud in the log.
    await attempt(
      'api/sick/recovery · trend row',
      pool.query(
        `INSERT INTO sick_recovery (episode_id, response) VALUES ($1, $2)`,
        [active.id, body.today],
      ),
    );

    if (body.today === 'recovered') {
      await pool.query(
        `UPDATE sick_episodes SET cleared_at = now() WHERE id = $1`,
        [active.id],
      );
      return NextResponse.json({ active: false, trend: 'recovered' });
    }

    return NextResponse.json({ active: true, trend: body.today });
  } catch (err: any) {
    return NextResponse.json(
      { error: 'recovery insert failed', detail: err?.message ?? String(err) },
      { status: 500 },
    );
  }
}

export const dynamic = 'force-dynamic';
