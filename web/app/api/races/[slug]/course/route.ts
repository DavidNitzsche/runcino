/**
 * GET /api/races/[slug]/course
 *
 * Lightweight course payload for the native race-detail screen. The
 * raw GPX is ~1.6 MB — far too heavy to ship to a phone — so this
 * endpoint parses it server-side (analyzeGpx) and returns a
 * DOWNSAMPLED geometry (~160 points) plus the stored phase-by-phase
 * pacing and net-elevation stats. One call gives the detail screen
 * everything it needs to draw the map, the elevation profile with
 * grade bands, and the pacing table.
 *
 * Anon-readable (mirrors /api/races): logged-in users get their own
 * race, anonymous callers fall back to the legacy 'me' demo race so
 * the simulator design-preview renders.
 *
 * Response:
 *   { ok, slug, name, date, distanceMi, goalDisplay, strategy,
 *     stats: { gainFt, lossFt, netFt, minFt, maxFt, distanceMi },
 *     coords: [[lat, lon], …],                 // map polyline
 *     samples: [{ d: mi, e: ft, g: gradePct }], // elevation profile
 *     phases: [{ label, startMi, endMi, distanceMi, targetPaceDisplay,
 *                targetPaceSPerMi, cumulativeTimeDisplay, meanGradePct,
 *                gainFt, lossFt, note }] }
 *   404 when the race or its GPX is missing.
 */

import { NextResponse } from 'next/server';
import { getRaceDB } from '@/lib/race-store';
import { ensureSeed } from '@/lib/seed-server';
import { requireActiveUser } from '@/lib/auth';
import { analyzeGpx } from '@/lib/gpx-analysis';

const M_PER_MI = 1609.344;
const FT_PER_M = 3.28084;
const TARGET_POINTS = 160;

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  await ensureSeed();
  const { slug } = await params;
  if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 });

  let userId: string | undefined;
  try { userId = (await requireActiveUser()).id; } catch { /* anon ok */ }

  const race = await getRaceDB(slug, userId);
  if (!race) return NextResponse.json({ error: 'Race not found', slug }, { status: 404 });
  if (!race.gpxText) return NextResponse.json({ error: 'Race has no GPX', slug }, { status: 404 });

  let analysis;
  try {
    analysis = analyzeGpx(race.gpxText);
  } catch (e) {
    console.warn('[api/races/course] analyzeGpx failed for', slug, e);
    return NextResponse.json({ error: 'Could not parse course GPX', slug }, { status: 422 });
  }

  const { trkpts, cumDistM, gradesPct, stats } = analysis;
  const n = trkpts.length;

  // Prefer DEM elevations (parallel to trkpts) when present — they're
  // cleaner than barometric/GPS ele. Fall back to GPX ele otherwise.
  const dem = race.demElevations;
  const eleM = (dem && dem.length === n) ? dem : trkpts.map((p) => p[2]);

  const totalDistM = cumDistM[n - 1] || (race.meta.distanceMi * M_PER_MI);

  // Evenly sample by cumulative distance so the profile + map are
  // distance-linear regardless of GPS point clustering.
  const coords: Array<[number, number]> = [];
  const samples: Array<{ d: number; e: number; g: number }> = [];
  const steps = Math.min(TARGET_POINTS, n);
  let j = 0;
  for (let i = 0; i < steps; i++) {
    const targetM = (totalDistM * i) / (steps - 1);
    while (j < n - 1 && cumDistM[j + 1] < targetM) j++;
    const lat = trkpts[j][0];
    const lon = trkpts[j][1];
    coords.push([Number(lat.toFixed(5)), Number(lon.toFixed(5))]);
    samples.push({
      d: Number((cumDistM[j] / M_PER_MI).toFixed(3)),
      e: Math.round(eleM[j] * FT_PER_M),
      g: Number((gradesPct[Math.min(j, gradesPct.length - 1)] ?? 0).toFixed(1)),
    });
  }

  const minFt = Math.round(stats.minEleM * FT_PER_M);
  const maxFt = Math.round(stats.maxEleM * FT_PER_M);

  const plan = race.plan;
  const phases = (plan?.phases ?? []).map((p) => ({
    label: p.label,
    startMi: p.start_mi,
    endMi: p.end_mi,
    distanceMi: p.distance_mi,
    targetPaceDisplay: p.target_pace_display,
    targetPaceSPerMi: p.target_pace_s_per_mi,
    cumulativeTimeDisplay: p.cumulative_time_display,
    meanGradePct: p.mean_grade_pct,
    gainFt: p.elevation_gain_ft,
    lossFt: p.elevation_loss_ft,
    note: p.note,
  }));

  return NextResponse.json({
    ok: true,
    slug,
    name: race.meta.name,
    date: race.meta.date,
    distanceMi: race.meta.distanceMi,
    goalDisplay: race.meta.goalDisplay,
    strategy: plan?.goal?.strategy ?? null,
    stats: {
      gainFt: Math.round(plan?.race?.total_gain_ft ?? stats.gainFt),
      lossFt: Math.round(plan?.race?.total_loss_ft ?? stats.lossFt),
      netFt: Math.round((plan?.race?.total_gain_ft ?? stats.gainFt) - (plan?.race?.total_loss_ft ?? stats.lossFt)),
      minFt,
      maxFt,
      distanceMi: Number((totalDistM / M_PER_MI).toFixed(2)),
    },
    coords,
    samples,
    phases,
  });
}
