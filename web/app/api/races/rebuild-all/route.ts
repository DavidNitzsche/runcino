/**
 * /api/races/rebuild-all — backfill every saved race through the
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
  const origin = new URL(req.url).origin;
  const results: Array<{ slug: string; ok: boolean; error?: string }> = [];

  for (const race of races) {
    try {
      const res = await fetch(`${origin}/api/races/${encodeURIComponent(race.slug)}/rebuild`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          // Re-pass the existing meta so /rebuild keeps everything in
          // place. The point is to refresh the plan, not change anything.
          raceName: race.meta.name,
          raceDate: race.meta.date,
          distanceMi: race.meta.distanceMi,
          // Goal time → seconds.
          goalFinishS: parseGoalSeconds(race.meta.goalDisplay),
          // Default strategy on rebuild — even_effort matches what most
          // races used originally.
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
