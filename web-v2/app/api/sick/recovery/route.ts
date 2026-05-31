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

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

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
      [DAVID_USER_ID],
    )).rows[0];

    if (!active) {
      return NextResponse.json({ error: 'no active sick episode' }, { status: 404 });
    }

    await pool.query(
      `INSERT INTO sick_recovery (episode_id, response) VALUES ($1, $2)`,
      [active.id, body.today],
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
