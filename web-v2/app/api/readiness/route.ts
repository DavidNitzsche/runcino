/**
 * GET /api/readiness
 *
 * P27.2 — fixes the iPhone hardcoded "88" placeholder.
 *
 * Returns the runner's current readiness score + label + per-input
 * breakdown. The iPhone TODAY readiness ring + the watch face glance
 * both consume this. The coach also computes readiness internally via
 * computeReadiness; this endpoint is a thin wrapper for clients that
 * want the number without invoking the full briefing pipeline.
 *
 * Response shape:
 * {
 *   score: 78,                       // 0-100
 *   band: "Hold easy",               // Primed / Hold easy / Back off
 *   label: "Hold easy",              // alias for watch face
 *   inputs: [{ key, label, observedV, weight, meaning }, ...]
 * }
 *
 * Honest about data gaps: if the runner has no health_samples yet (e.g.
 * a fresh install before the iPhone has synced any HK data), score may
 * be null and inputs lists what's missing.
 */
import { NextRequest, NextResponse } from 'next/server';
import { loadCoachState } from '@/lib/coach/state-loader';
import { computeReadiness } from '@/lib/coach/readiness';
import { requireUserId } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  try {
    const state = await loadCoachState(userId);
    const r = computeReadiness(state);
    return NextResponse.json({
      score: r.score,
      band: r.band,
      label: r.label,
      inputs: r.inputs.map((i) => ({
        key: i.key,
        label: i.label,
        observedV: i.observedV,
        observedSub: i.observedSub,
        weight: i.weight,
        meaning: i.meaning,
      })),
      // Phase 12 (2026-05-28) · per-metric values for the iPhone
      // Sibling MiniTiles. Without these the SLEEP / RHR / HRV / LOAD
      // tiles render `—` (see Faff/Util/FaffAdapter.swift → bodyTiles).
      // Web doesn't read these from this endpoint — its glance loader
      // already carries them inline — so adding them is non-breaking
      // for every existing caller (web reads { score, band, label,
      // inputs } only).
      sleep7Avg: state.sleep7Avg ?? null,
      rhrCurrent: state.rhrCurrent ?? null,
      rhrBaseline: state.rhrBaseline ?? null,
      hrvCurrent: state.hrvCurrent ?? null,
      hrvBaseline: state.hrvBaseline ?? null,
      loadAcwr: state.loadAcwr ?? null,
    });
  } catch (err: any) {
    console.error('[api/readiness] failed:', err);
    return NextResponse.json({ error: err.message ?? 'readiness compute failed' }, { status: 500 });
  }
}
