/**
 * GET    /api/niggle  — { active: NiggleRow | null }
 * POST   /api/niggle  — body { body_part, side?, severity, status, note? }
 *                       Returns { niggle_id, active: true }
 * DELETE /api/niggle  — clears the most recent active niggle (sets cleared_at).
 *                       Returns { active: false }
 *
 * "Niggle" = mild musculoskeletal flag the runner reports. The runner can
 * still train; the plan does NOT pause. resolveDayState routes /today
 * through the `niggle` surface so the workout renders with awareness.
 *
 * v1 supports a SINGLE active niggle per user. The most recent active row
 * is treated as "the niggle"; older un-cleared rows are tolerated in the
 * schema but ignored by GET. (Multi-niggle is a v1.1 design problem per
 * the deck's footer Q3.)
 *
 * Single-user beta pattern: user_id is DEFAULT_USER_ID. Same posture as
 * app/api/today/skip/route.ts.
 *
 * Spec: docs/2026-05-28-niggle-sick-logging.html §SECTION 02 (modal),
 *       §SECTION 04 (state on /today), §SECTION 06 (recovery).
 */

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

interface NigglePostBody {
  body_part: string;
  side?: 'left' | 'right' | 'both' | null;
  severity: number;          // 1-10 (runner-anchored scale per deck §02)
  status: 'just_started' | 'few_days' | 'weeks';
  note?: string | null;
}

async function readJson<T>(req: NextRequest): Promise<Partial<T>> {
  try {
    const text = await req.text();
    if (!text) return {};
    return JSON.parse(text) as Partial<T>;
  } catch {
    return {};
  }
}

export async function GET() {
  try {
    const row = (await pool.query(
      `SELECT id, body_part, side, severity, status, note, logged_at, cleared_at
         FROM niggles
        WHERE user_id = $1 AND cleared_at IS NULL
        ORDER BY logged_at DESC
        LIMIT 1`,
      [DAVID_USER_ID],
    )).rows[0];
    return NextResponse.json({ active: row ?? null });
  } catch (err: any) {
    return NextResponse.json({ active: null, warning: err?.message ?? String(err) });
  }
}

export async function POST(req: NextRequest) {
  const body = await readJson<NigglePostBody>(req);
  if (!body.body_part || typeof body.severity !== 'number' || !body.status) {
    return NextResponse.json(
      { error: 'missing required fields', need: ['body_part', 'severity', 'status'] },
      { status: 400 },
    );
  }
  if (body.severity < 1 || body.severity > 10) {
    return NextResponse.json({ error: 'severity must be 1-10' }, { status: 400 });
  }

  try {
    const ins = await pool.query(
      `INSERT INTO niggles (user_id, body_part, side, severity, status, note)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        DAVID_USER_ID,
        body.body_part,
        body.side ?? null,
        body.severity,
        body.status,
        body.note ?? null,
      ],
    );
    return NextResponse.json({ niggle_id: ins.rows[0].id, active: true });
  } catch (err: any) {
    return NextResponse.json({
      error: 'niggle insert failed',
      detail: err?.message ?? String(err),
      hint: 'Did you apply web-v2/db/migrations/116_niggles.sql?',
    }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await pool.query(
      `UPDATE niggles
          SET cleared_at = now()
        WHERE id = (
          SELECT id FROM niggles
           WHERE user_id = $1 AND cleared_at IS NULL
           ORDER BY logged_at DESC
           LIMIT 1
        )`,
      [DAVID_USER_ID],
    );
    return NextResponse.json({ active: false });
  } catch (err: any) {
    return NextResponse.json({
      error: 'niggle delete failed',
      detail: err?.message ?? String(err),
    }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
