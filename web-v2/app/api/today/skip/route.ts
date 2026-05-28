/**
 * POST   /api/today/skip   { date? }  — record an explicit skip for `date` (default today)
 * DELETE /api/today/skip   { date? }  — undo the skip
 *
 * "Skip" = "the plan said run today and I'm actively choosing not to. Not
 * sick, not injured, just skipping." Distinct from rest (plan-prescribed),
 * missed (passive), or sick/niggle (health). See db/migrations/114_day_actions.sql
 * for the full semantics rationale.
 *
 * Single-user beta pattern: user_id comes from process.env.DEFAULT_USER_ID
 * (matches app/api/checkin/route.ts:25). `today` is computed with the same
 * -7h offset as lib/coach/glance-state.ts:56 so the API and the glance
 * loader agree on what "today" means.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

interface SkipBody {
  date?: string;
}

function todayIso(): string {
  // Matches lib/coach/glance-state.ts:56 — the runner's local "today" lags
  // UTC by up to 7h, so we anchor the date to a 7h shifted clock. Keeps
  // the early-morning runner from seeing yesterday's surface flip to today
  // mid-stride.
  return new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);
}

async function readBody(req: NextRequest): Promise<SkipBody> {
  try {
    const text = await req.text();
    if (!text) return {};
    return JSON.parse(text) as SkipBody;
  } catch {
    return {};
  }
}

export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const date = body.date ?? todayIso();

  try {
    await pool.query(
      `INSERT INTO day_actions (user_id, date_iso, action)
       VALUES ($1, $2, 'skip')
       ON CONFLICT (user_id, date_iso, action) DO NOTHING`,
      [DAVID_USER_ID, date],
    );
  } catch (err: any) {
    return NextResponse.json({
      error: 'skip insert failed',
      detail: err?.message ?? String(err),
      hint: 'Did you apply web-v2/db/migrations/114_day_actions.sql?',
    }, { status: 500 });
  }

  return NextResponse.json({ skipped: true, date });
}

export async function DELETE(req: NextRequest) {
  const body = await readBody(req);
  const date = body.date ?? todayIso();

  try {
    await pool.query(
      `DELETE FROM day_actions
        WHERE user_id = $1 AND date_iso = $2 AND action = 'skip'`,
      [DAVID_USER_ID, date],
    );
  } catch (err: any) {
    return NextResponse.json({
      error: 'skip delete failed',
      detail: err?.message ?? String(err),
    }, { status: 500 });
  }

  return NextResponse.json({ skipped: false, date });
}

export const dynamic = 'force-dynamic';
