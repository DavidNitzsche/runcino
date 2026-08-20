/**
 * GET /api/v5/block — the iPhone v5 Block screen.
 *
 * Thin route: auth, then hand off to `lib/plan/v5-block.ts`, which composes
 * the payload from `loadTrainingState` (phase arc, all sixteen weeks, panel
 * stats) plus the workout library (Gap B1) and the change-the-plan sheet's
 * scenario-availability list. See that file's header for the full picture.
 *
 * READ-ONLY — nothing here writes a row.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import { loadV5Block } from '@/lib/plan/v5-block';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  try {
    const block = await loadV5Block(userId);
    return NextResponse.json(block);
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
