/**
 * /api/races/rebuild-all, backfill every saved race through the
 * current pacing pipeline.
 *
 * Used once after material changes to the pacing math (pace floor,
 * canonical race distance, threshold-based elevation gain) so existing
 * plans reflect the same rules new plans get.
 *
 * Loops every saved race and POSTs each through /api/races/[slug]/rebuild
 * over loopback. Preserves race meta (name, date, distance, goal,
 * priority) and actualResult; only the plan object refreshes.
 *
 * Returns a per-slug summary so the caller can see what updated.
 */

import { listRacesDB } from '../../../../lib/race-store';

export async function POST(req: Request) {
  const races = await listRacesDB();
  // Same fix as /api/races/[slug]/rebuild, Railway's req.url origin
  // is 0.0.0.0:$PORT which can't be fetched from inside the same
  // container. Use the public domain when it's set in env.
  const origin = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : new URL(req.url).origin;
  const todayISO = new Date().toISOString().slice(0, 10);

  // Past races are locked, they're historical artifacts (the plan
  // alongside the actualResult tells the story of what was planned vs
  // what happened). Rebuilding them would erase that history. Only
  // touch upcoming races, where the plan is still a living document.
  const upcoming = races.filter(r => r.meta.date >= todayISO);
  const skipped = races.length - upcoming.length;

  const results: Array<{ slug: string; ok: boolean; error?: string }> = [];

  for (const race of upcoming) {
    try {
      // Snap to the canonical race distance when within 5%, fixes
      // races built before the canonical-distance picker existed (which
      // saved the GPS-measured 13.24 instead of 13.10 for halves, etc).
      const distanceMi = snapToCanonical(race.meta.distanceMi);

      const res = await fetch(`${origin}/api/races/${encodeURIComponent(race.slug)}/rebuild`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          raceName: race.meta.name,
          raceDate: race.meta.date,
          distanceMi,
          goalFinishS: parseGoalSeconds(race.meta.goalDisplay),
          strategy: 'even_effort',
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        results.push({ slug: race.slug, ok: false, error: txt.slice(0, 200) });
      } else {
        results.push({ slug: race.slug, ok: true });
      }
    } catch (e) {
      results.push({ slug: race.slug, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return Response.json({
    ok: results.every(r => r.ok),
    rebuilt: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    results,
  });
}

function parseGoalSeconds(s: string): number {
  const m = s.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}

/** Round near-canonical distances to the official race distance.
 *  Within 5% of a canonical (5K / 10K / half / marathon) → snap to it.
 *  Else preserve the user-entered distance. */
function snapToCanonical(mi: number): number {
  const CANON = [3.10, 6.21, 13.10, 26.22];
  for (const c of CANON) {
    if (Math.abs(mi - c) / c < 0.05) return c;
  }
  return mi;
}
