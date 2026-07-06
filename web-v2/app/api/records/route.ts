/**
 * GET /api/records — personal records, source-of-truth compliant.
 *
 * 2026-07-06 · phone+watch audit P1-7 · the iPhone Activity 'Personal
 * records' card computed records client-side from /api/log training runs
 * and never read races.actual_result — a GPS-glitched jog could headline
 * as FASTEST PACE forever while a curated HM PR stayed invisible. This
 * endpoint is the server-side replacement: curated race results first
 * (actual_result.finishS, then meta.finishTime), training-run bests only
 * as provisional:true + source:'training_run' entries with the canonical
 * 'Training effort · race to lock in' caption.
 *
 * ADDITIVE: /api/log is untouched — every field the shipped iPhone build
 * reads keeps its shape. The phone adopts this endpoint in a later wave.
 *
 * Shape:
 *   {
 *     records: [ { key, label, timeS, timeDisplay, paceDisplay, dateISO,
 *                  name, slug, distanceMi, source, provisional,
 *                  provisionalLabel } ],
 *     training: { longestRun, biggestWeek }   // always training_run-sourced
 *   }
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import { loadPersonalRecords } from '@/lib/race/personal-records';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  try {
    const result = await loadPersonalRecords(userId);
    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[api/records]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
