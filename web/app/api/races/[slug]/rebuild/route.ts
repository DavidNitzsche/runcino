/**
 * /api/races/[slug]/rebuild — re-run the pacing pipeline against the
 * race\'s saved GPX with updated meta, then persist.
 *
 * Body: {
 *   raceName?, raceDate?, goalFinishS?, strategy?, toleranceSPerMi?,
 *   distanceMi?  // canonical distance the runner thinks of (13.1 for half),
 *                // used for headline display + last-mile label
 * }
 *
 * Anything not sent falls back to the existing meta. The GPX itself is
 * never re-uploaded — we read it from the row in Postgres. After the
 * plan rebuilds, the row\'s plan + meta are upserted in place.
 *
 * actualResult is preserved untouched. The point of rebuild is to
 * refresh the PLAN (e.g., apply the new pace-floor clamp, change
 * strategy, fix a wrong goal time) without losing what already
 * happened on race day.
 */

import { getRaceDB, saveRaceDB } from '../../../../../lib/race-store';
import { resolveGelSpec } from '../../../../../lib/gel-lookup';
import { coachCarbRate } from '../../../../../lib/coach-carb-rate';
import type { FaffPlan } from '../../../../../lib/types';

interface RebuildBody {
  raceName?: string;
  raceDate?: string;
  goalFinishS?: number;
  strategy?: 'even_effort' | 'even_split' | 'negative_split';
  toleranceSPerMi?: number;
  distanceMi?: number;
  // Fueling — the user types ONLY which gel they're using. The coach
  // figures out carbs per serving (via known-gel cache → Claude
  // lookup) and the right carb rate (driven by race effort, not the
  // user). Sending `null` for gelCarbsG or carbTargetGPerHr clears
  // any prior override so the coach reruns the math.
  gelBrand?: string;
  gelCarbsG?: number | null;
  carbTargetGPerHr?: number | null;
}

function parseGoalHMS(s: string): number | null {
  const m = s.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let body: RebuildBody;
  try { body = await req.json(); }
  catch { return new Response('Invalid JSON', { status: 400 }); }

  const existing = await getRaceDB(slug);
  if (!existing) return new Response('Not found', { status: 404 });

  // Resolve effective inputs — caller-provided values override the
  // existing meta; anything not sent stays as it was.
  const goalFinishS = body.goalFinishS ?? parseGoalHMS(existing.meta.goalDisplay);
  if (goalFinishS == null) return new Response('Missing or invalid goalFinishS', { status: 400 });
  const raceName = body.raceName ?? existing.meta.name;
  const raceDate = body.raceDate ?? existing.meta.date;
  const strategy = body.strategy ?? 'even_effort';
  const toleranceSPerMi = body.toleranceSPerMi ?? 10;
  const headlineDistance = body.distanceMi ?? existing.meta.distanceMi;

  // Fueling — let the coach figure it out from the brand alone.
  //   - When the user types a brand, look it up (cache → Claude) to get
  //     carbs per serving. The user never types carbs.
  //   - When the user explicitly sends gelCarbsG (legacy/admin path),
  //     honor it. Same for carbTargetGPerHr.
  //   - When neither is set, fall back to whatever's in the existing
  //     plan, then planner defaults.
  const existingFuel = existing.plan?.fueling;
  const gelBrand = body.gelBrand ?? existingFuel?.gel_brand;
  let gelCarbsG: number | undefined =
    body.gelCarbsG === null ? undefined                    // explicit clear
    : body.gelCarbsG ?? existingFuel?.gel_carbs_g;          // fall through
  if (gelCarbsG === undefined && gelBrand) {
    // Coach-resolved: look up the gel's spec by brand name.
    const spec = await resolveGelSpec(gelBrand, process.env.ANTHROPIC_API_KEY);
    gelCarbsG = spec.carbsG;
  }
  let carbTargetGPerHr: number | undefined =
    body.carbTargetGPerHr === null ? undefined
    : body.carbTargetGPerHr ?? existingFuel?.carb_target_g_per_hr;
  if (carbTargetGPerHr === undefined) {
    // Coach-resolved: rate scales with effort duration.
    carbTargetGPerHr = coachCarbRate(goalFinishS);
  }

  // Reuse the build-plan endpoint over loopback so we don't duplicate
  // its assembly logic. On Railway, req.url's origin is the internal
  // 0.0.0.0:$PORT host which isn't reachable via fetch from inside
  // the same container — fall back to the public domain set in env.
  const origin = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : new URL(req.url).origin;
  const buildRes = await fetch(`${origin}/api/build-plan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      gpxText: existing.gpxText,
      courseSlug: existing.meta.courseSlug,
      raceName,
      raceDate,
      goalFinishS,
      strategy,
      toleranceSPerMi,
      gelBrand,
      gelCarbsG,
      carbTargetGPerHr,
      // Manual flow: pass neutral fitness defaults like /races/new does.
      fitness: {
        baselineName: 'Self-reported',
        baselineFinish: '0:00:00',
        baselineMonthsAgo: 0,
        weeklyMileage: 0,
        weeklyMileageTrend: 0,
        longestLongRunMi: 0,
        longestLongRunAgeWk: 0,
        restingHr: 0,
        restingHrTrend: 0,
      },
      claudeRationale: null,
    }),
  });
  if (!buildRes.ok) {
    const txt = await buildRes.text();
    return new Response(`Rebuild failed: ${buildRes.status} ${txt.slice(0, 200)}`, { status: 500 });
  }
  const data = await buildRes.json() as { planJsonText: string; summary: { raceName: string; courseSlug: string; goalDisplay: string } };
  const plan = JSON.parse(data.planJsonText) as FaffPlan;

  // Persist — preserve actualResult, refresh plan + meta.
  await saveRaceDB({
    slug,
    plan,
    gpxText: existing.gpxText,
    savedAt: new Date().toISOString(),
    meta: {
      name: raceName,
      date: raceDate,
      distanceMi: headlineDistance,
      goalDisplay: data.summary.goalDisplay,
      courseSlug: existing.meta.courseSlug,
    },
    actualResult: existing.actualResult,
  });

  return Response.json({ ok: true, slug });
}
