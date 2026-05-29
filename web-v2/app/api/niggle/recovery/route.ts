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

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

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
  const body = await readJson(req);
  const valid: NiggleTrend[] = ['better', 'same', 'worse', 'gone'];
  if (!body.today || !valid.includes(body.today)) {
    return NextResponse.json(
      { error: 'today must be one of better|same|worse|gone' },
      { status: 400 },
    );
  }

  try {
    // Find active niggle
    const active = (await pool.query(
      `SELECT id FROM niggles
        WHERE user_id = $1 AND cleared_at IS NULL
        ORDER BY logged_at DESC
        LIMIT 1`,
      [DAVID_USER_ID],
    )).rows[0];

    if (!active) {
      return NextResponse.json({ error: 'no active niggle' }, { status: 404 });
    }

    await pool.query(
      `INSERT INTO niggle_recovery (niggle_id, response) VALUES ($1, $2)`,
      [active.id, body.today],
    );

    // 'gone' clears the parent niggle.
    if (body.today === 'gone') {
      await pool.query(
        `UPDATE niggles SET cleared_at = now() WHERE id = $1`,
        [active.id],
      );
      return NextResponse.json({ active: false, trend: 'gone' });
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
