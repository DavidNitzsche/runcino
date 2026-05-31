/**
 * GET /api/gpx/search?q=race+name&distanceMi=13.1[&toleranceMi=0.5]
 *
 * Returns ranked GPX candidates for the given race name. Tier 1 hits
 * Strava Routes via the user's OAuth token (see lib/gpx/finder.ts).
 *
 * Response:
 * {
 *   candidates: GpxCandidate[],
 *   sourcesAttempted: ['strava_routes'],
 *   reason?: string   // present when no candidates + a recoverable cause
 * }
 *
 * Caller: web /races/[slug] "Find course" flow + iPhone race-detail sheet.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import { findGpxCandidates } from '@/lib/gpx/finder';

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const q = req.nextUrl.searchParams.get('q')?.trim();
  if (!q) {
    return NextResponse.json({ error: 'q (race name) required' }, { status: 400 });
  }
  const expectedDistanceMi = req.nextUrl.searchParams.get('distanceMi');
  const toleranceMi = req.nextUrl.searchParams.get('toleranceMi');

  try {
    const result = await findGpxCandidates(userId, {
      q,
      expectedDistanceMi: expectedDistanceMi ? Number(expectedDistanceMi) : undefined,
      toleranceMi: toleranceMi ? Number(toleranceMi) : undefined,
    });
    return NextResponse.json(result);
  } catch (e: any) {
    console.error('[/api/gpx/search] error:', e?.message);
    return NextResponse.json({ error: e?.message ?? 'search failed' }, { status: 500 });
  }
}
