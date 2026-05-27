/**
 * GET /api/usage?days=14
 *
 * P43 — daily LLM spend rollup. Useful for verifying steady-state cost
 * vs testing spikes. Returns per-day briefing counts + token totals
 * + USD cost.
 */
import { NextRequest, NextResponse } from 'next/server';
import { dailyRollup } from '@/lib/coach/usage';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const days = Math.min(Number(req.nextUrl.searchParams.get('days') ?? '14'), 90);
  try {
    const r = await dailyRollup(days);
    return NextResponse.json(r);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}
