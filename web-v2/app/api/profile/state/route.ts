/**
 * GET /api/profile/state — full ProfileState for iPhone parity.
 *
 * Returns the same shape that lib/coach/profile-state.ts ships to the
 * web /profile page: identity (name/sex/age/city/height), physiology
 * (computed MaxHR / RHR / VDOT / LTHR / zones), and connection state.
 * Shoes + nextARace + preferences are omitted here — those have their
 * own dedicated endpoints (/api/shoes, /api/races, /api/settings) the
 * iPhone already calls. Keeping this trim avoids over-fetching on
 * /profile mount.
 *
 * 2026-05-27: shipped after David noticed the iPhone /profile was
 * showing hardcoded "David Nitzsche / MALE · 40 · LOS ANGELES" string
 * literals while the web /profile read real values from the DB. Same
 * data, same screen, both surfaces.
 */
import { NextRequest, NextResponse } from 'next/server';
import { loadProfileState } from '@/lib/coach/profile-state';
import { requireUserId } from '@/lib/auth/session';

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  try {
    const state = await loadProfileState(userId);
    // Trim to the bits the iPhone /profile actually renders. Shoes /
    // nextARace / preferences are fetched separately by their own iPhone
    // surfaces — no need to ship them here.
    return NextResponse.json({
      identity: state.identity,
      physiology: {
        max_hr:        state.physiology.max_hr,
        max_hr_source: state.physiology.max_hr_source,
        rhr:           state.physiology.rhr,
        vo2:           state.physiology.vo2,
        weight_lb:     state.physiology.weight_lb,
        vdot:          state.physiology.vdot,
        lthr:          state.physiology.lthr,
      },
      connections: state.connections,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 });
  }
}
