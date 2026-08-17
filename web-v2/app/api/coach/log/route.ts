/**
 * GET /api/coach/log · the coach's log, paged (newest first).
 *
 * 2026-08-17 · coach-experience pass. Read surface for
 * lib/coach/coach-log.ts — week closes, phase boundaries, all-time
 * firsts, and fitness shifts (every recompute_paces the engine ever
 * applied, spoken instead of silent).
 *
 * Query params:
 *   limit   · 1-100, default 20
 *   before  · ISO timestamp cursor from a previous page's nextBefore
 *
 * Response (wire contract · stable + additive for native):
 *   {
 *     ok: true,
 *     entries: [{
 *       id: string,
 *       kind: 'week_close' | 'phase_boundary' | 'first_ever' | 'fitness_shift',
 *       dateISO: 'YYYY-MM-DD',   // the day the entry is about
 *       title: string,           // short eyebrow · "WEEK CLOSED" / "PHASE" / "FIRST" / "FITNESS"
 *       body: string,            // the coach's line · plain English, no citations
 *       meta: object,            // kind-specific numbers (totalMi, vdot, ...)
 *       ts: string               // ISO timestamp the entry was written
 *     }],
 *     nextBefore: string | null  // pass as ?before= for the next page
 *   }
 *
 * Native mount is a follow-up — decode entries[] leniently (unknown
 * kinds render as plain title+body rows).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import { loadCoachLog } from '@/lib/coach/coach-log';

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const params = req.nextUrl.searchParams;
  const limitRaw = Number(params.get('limit') ?? 20);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.round(limitRaw), 1), 100) : 20;
  const before = params.get('before');

  try {
    const page = await loadCoachLog(userId, { limit, before: before ?? null });
    return NextResponse.json({ ok: true, ...page });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }, { status: 500 });
  }
}
