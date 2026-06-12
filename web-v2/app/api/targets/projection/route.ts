/**
 * GET /api/targets/projection?distance_mi=13.1&race_slug=foo
 *
 * iPhone-side data feed for the redesigned Targets "Closing the gap"
 * panel. Composes the EXACT same per-runner-per-race chunks the web
 * GapPanel reads off the seed's GoalRace block (see
 * web-v2/components/faff-app/seed.ts L1185-L1295) — both surfaces
 * consume one contract, one set of doctrine helpers, one source of
 * truth.
 *
 * Helpers reused verbatim from the seed enrichment:
 *   · lib/training/course-impact.ts   · computeCourseImpact
 *   · lib/training/race-conditions.ts · computeRaceConditions
 *   · lib/coach/pacing-discipline.ts  · computePacingDiscipline
 *   · lib/coach/projection-levers.ts  · computeProjectionLevers
 *
 * Spec: designs/briefs/targets-gap-panel-backend-brief.md §2.1-§2.4.
 *
 * Response shape (lenient on client · iPhone uses decodeIfPresent
 * everywhere):
 *   {
 *     ok: true,
 *     status: "on_track" | "watch" | "off" | "race_week" | "cold",
 *     vdot, projectionSec, goalSec,
 *     raceSlug, raceName, raceDate, daysAway, distanceMi, location,
 *     totalGapSec, fitnessSec,
 *     courseImpactSec, courseSource, courseElevGainFtPerMi,
 *     conditionsImpactSec, conditionsSource,
 *     executionBufferSec, executionSource, executionCV, executionN,
 *     levers: Lever[],
 *     heldDays, lastMove,
 *   }
 *
 * Cold path: no VDOT / no goal race → ok=true with nulls. The iPhone
 * panel renders TargetsProjectionColdState.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';
import { loadProjectionSeries, loadLatestVdotWithAnchor } from '@/lib/training/projection-snapshots';
import { predictRaceTime, parseRaceTime, formatRaceTime } from '@/lib/training/vdot';
import { loadProfileState } from '@/lib/coach/profile-state';
import { computeCourseImpact } from '@/lib/training/course-impact';
import { computeRaceConditions } from '@/lib/training/race-conditions';
import { computePacingDiscipline } from '@/lib/coach/pacing-discipline';
import { computeProjectionLevers } from '@/lib/coach/projection-levers';
import { computeConfidenceInterval, computeConfidenceLabel } from '@/lib/training/goal-projection';

export const dynamic = 'force-dynamic';

// ─── VDOT-move history helpers (iPhone "held N days" + "last move") ───

function lastMoveFromSeries(
  series: Array<{ date: string; vdot: number | null }>,
): { iso: string; prevVdot: number; newVdot: number; deltaVdot: number; source: string } | null {
  if (series.length < 2) return null;
  let prev: number | null = null;
  let last: { iso: string; prevVdot: number; newVdot: number } | null = null;
  for (const row of series) {
    if (row.vdot == null) continue;
    if (prev != null && Math.abs(row.vdot - prev) >= 0.1) {
      last = { iso: row.date, prevVdot: prev, newVdot: row.vdot };
    }
    prev = row.vdot;
  }
  if (!last) return null;
  return {
    ...last,
    deltaVdot: Math.round((last.newVdot - last.prevVdot) * 10) / 10,
    source: 'projection_snapshots',
  };
}

function heldDays(
  series: Array<{ date: string; vdot: number | null }>,
  latestVdot: number | null,
): number {
  if (latestVdot == null || series.length === 0) return 0;
  let count = 0;
  for (let i = series.length - 1; i >= 0; i--) {
    const v = series[i].vdot;
    if (v == null || Math.abs(v - latestVdot) >= 0.1) break;
    count++;
  }
  return count;
}

function toGoalStatus(s: string): 'on-track' | 'watching' | 'off-track' {
  if (s === 'off') return 'off-track';
  if (s === 'watch') return 'watching';
  return 'on-track';
}

function statusFor(projSec: number | null, goalSec: number | null, daysAway: number | null) {
  if (daysAway != null && daysAway <= 7 && daysAway >= 0) return 'race_week';
  if (projSec == null || goalSec == null) return 'cold';
  const ratio = projSec / goalSec;
  if (ratio > 1.08) return 'off';
  if (ratio > 1.03) return 'watch';
  return 'on_track';
}

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const url = new URL(req.url);
  const distanceQ = Number(url.searchParams.get('distance_mi') ?? '13.1');
  const slugQ = url.searchParams.get('race_slug');

  try {
    // ─── 1. Goal race · either explicit slug or the active A-race ───
    const raceQ = slugQ
      ? await pool.query<{
          slug: string; name: string; date: string; goal: string | null;
          distance_mi: number | null; location: string | null;
          course_geometry: { bbox?: { minLat?: number; maxLat?: number; minLon?: number; maxLon?: number } } | null;
          goal_safe: string | null;
        }>(
          `SELECT slug, name, date::text AS date, goal, distance_mi, location, course_geometry,
                  meta->>'goalSafeDisplay' AS goal_safe
             FROM races
            WHERE slug = $1 AND user_uuid = $2`,
          [slugQ, userId],
        )
      : await pool.query<{
          slug: string; name: string; date: string; goal: string | null;
          distance_mi: number | null; location: string | null;
          course_geometry: { bbox?: { minLat?: number; maxLat?: number; minLon?: number; maxLon?: number } } | null;
          goal_safe: string | null;
        }>(
          `SELECT slug, name, date::text AS date, goal, distance_mi, location, course_geometry,
                  meta->>'goalSafeDisplay' AS goal_safe
             FROM races
            WHERE user_uuid = $1
              AND priority = 'A'
              AND date >= CURRENT_DATE
            ORDER BY date ASC LIMIT 1`,
          [userId],
        );
    const race = raceQ.rows[0] ?? null;

    // Use the race row's distance_mi when present; fall back to the
    // query-param distance (iPhone might ask before a race is set).
    const distanceMi = race?.distance_mi ?? distanceQ;
    const goalSec = race?.goal ? parseRaceTime(race.goal) : null;
    const goalSafeSec = race?.goal_safe ? parseRaceTime(race.goal_safe) : null;
    const daysAway = race?.date
      ? Math.round((new Date(race.date + 'T12:00:00Z').getTime() - Date.now()) / 86400000)
      : null;

    // ─── 2. VDOT + projection · series first, profile fallback ───
    //   The snapshot trend gives us VDOT history + the latest projection
    //   for free. When it hasn't run yet for this user / distance, fall
    //   back to the profile-state VDOT (same source seed.ts L383 uses
    //   for goalRace.projected). Same single source of truth · no ad-hoc
    //   recomputation per surface.
    const series = await loadProjectionSeries(userId, distanceMi, 90);
    const latest = series.length > 0 ? series[series.length - 1] : null;
    let vdot = latest?.vdot ?? null;
    let projectionSec = latest?.projectionSec ?? null;

    // Distance-agnostic fallback · the latest snapshot at ANY distance — the
    // same source the web seed reads (loadLatestVdotWithAnchor). Without this
    // the iPhone cold-started ("baseline needed") whenever no projection
    // snapshot existed at the queried distance, e.g. a Half-marathon anchor
    // while the panel asks at the 13.1 default, even though a perfectly good
    // anchor VDOT existed at another distance. The web never saw this because
    // its seed already reads the distance-agnostic anchor.
    if (vdot == null) {
      const anchor = await loadLatestVdotWithAnchor(userId).catch(() => null);
      if (anchor?.vdot != null) vdot = anchor.vdot;
    }
    // Last resort · the profile-state VDOT.
    if (vdot == null) {
      const profileState = await loadProfileState(userId).catch(() => null);
      vdot = profileState?.physiology?.vdot ?? null;
    }
    // Derive today's projected race time from whatever VDOT resolved.
    if (projectionSec == null && vdot != null) {
      projectionSec = predictRaceTime(vdot, distanceMi) ?? null;
    }

    // ─── 3. GapPanel chunks · per-race-per-runner ───────────────
    //   Mirrors the enrichment in seed.ts L1185-L1295 verbatim so the
    //   iPhone and web read identical numbers. Helper signatures owned
    //   by the canonical doctrine modules · no duplication.

    let courseImpactSec: number | null = null;
    let courseSource: 'editorial' | 'crowd' | 'stub' | null = null;
    let courseElevGainFtPerMi: number | null = null;

    let conditionsImpactSec: number | null = null;
    let conditionsSource: 'forecast' | 'climate' | null = null;
    let conditionsSafetyMessage: string | null = null;

    let executionBufferSec = 30;
    let executionSource: 'observed' | 'default' = 'default';
    let executionCV: number | null = null;
    let executionN = 0;

    let levers: Array<unknown> = [];

    if (race?.slug && goalSec && goalSec > 0 && distanceMi) {
      // 3a · course_library row (elevation) + race bbox center (lat/lng
      // for forecast). One round-trip · same query the seed runs.
      const [courseLibRes, raceRowRes] = await Promise.all([
        pool.query<{ source: string | null; elevation_gain_ft: number | null; net_elevation_ft: number | null }>(
          `SELECT source, elevation_gain_ft, net_elevation_ft
             FROM course_library WHERE slug = $1`,
          [race.slug],
        ).catch(() => ({ rows: [] })),
        Promise.resolve({ rows: race ? [race] : [] }),
      ]);
      const courseLibRow = courseLibRes.rows[0];
      const bbox = raceRowRes.rows[0]?.course_geometry?.bbox ?? null;
      const raceLat = bbox?.minLat != null && bbox?.maxLat != null
        ? (Number(bbox.minLat) + Number(bbox.maxLat)) / 2 : null;
      const raceLng = bbox?.minLon != null && bbox?.maxLon != null
        ? (Number(bbox.minLon) + Number(bbox.maxLon)) / 2 : null;

      // 3b · §2.2 Course chunk
      const courseImpact = computeCourseImpact(
        {
          distanceMi,
          goalSec,
          elevationGainFt: courseLibRow?.elevation_gain_ft ?? null,
          netElevationFt: courseLibRow?.net_elevation_ft ?? null,
        },
        (courseLibRow?.source as 'editorial' | 'crowd' | 'stub' | null) ?? null,
      );
      courseImpactSec = courseImpact.seconds;
      courseSource = courseImpact.source;
      courseElevGainFtPerMi = courseImpact.elevGainFtPerMi;

      // 3c · §2.1 Conditions chunk (async · best-effort)
      if (race.date) {
        const conditions = await computeRaceConditions({
          raceSlug: race.slug,
          raceDateISO: race.date,
          location: race.location,
          raceLat,
          raceLng,
          distanceMi,
          goalSec,
          vdot,
        }).catch(() => null);
        if (conditions) {
          conditionsImpactSec = conditions.seconds;
          conditionsSource = conditions.source;
          conditionsSafetyMessage = conditions.safetyMessage;
        }
      }
    }

    // 3d · §2.3 Execution chunk · runs even without a goal race so the
    //      cold-start panel can already show the user's pacing baseline.
    const pacing = await computePacingDiscipline(userId, 90).catch(() => null);
    if (pacing) {
      executionBufferSec = pacing.bufferSec;
      executionSource = pacing.source;
      executionCV = pacing.cv;
      executionN = pacing.n;
    }

    // 3e · §2.4 Hit list · needs all 3 chunks above
    let totalGapSec = 0;
    let fitnessSec = 0;
    if (race?.slug && race.date && goalSec && goalSec > 0 && distanceMi && projectionSec) {
      totalGapSec = Math.max(0, projectionSec - goalSec);
      const courseImp = courseImpactSec ?? 0;
      const condImp = conditionsImpactSec ?? 0;
      const execImp = executionBufferSec;
      fitnessSec = Math.max(0, totalGapSec - courseImp - condImp - execImp);

      levers = await computeProjectionLevers({
        userUuid: userId,
        goalRace: {
          slug: race.slug,
          name: race.name,
          date: race.date,
          daysAway: daysAway ?? 0,
          distanceMi,
          location: race.location,
        },
        projectionSec,
        goalSec,
        currentVdot: vdot,
        gap: {
          fitness: fitnessSec,
          conditions: condImp,
          course: courseImp,
          execution: execImp,
        },
      }).catch(() => []);
    }

    const status = statusFor(projectionSec, goalSec, daysAway);
    const goalStatus = toGoalStatus(status);
    const confidenceInterval = computeConfidenceInterval({
      centerSec: projectionSec,
      raceDistanceMi: distanceMi,
      status: goalStatus,
      pacing: { cv: executionCV, source: executionSource },
    });
    const confidenceLabel = (vdot != null && goalSec != null)
      ? computeConfidenceLabel({
          goalSec,
          raceDistanceMi: distanceMi,
          vdot,
          daysToRace: daysAway,
          status: goalStatus,
        })
      : null;
    const lastMove = lastMoveFromSeries(series);
    const held = heldDays(series, vdot);

    // All four standard Daniels distances via the canonical predictRaceTime
    // (binary-search on rawVdot). iPhone renders these directly — no local
    // race-time math on any client surface.
    const STANDARD_RACES: Array<{ distance: string; mi: number }> = [
      { distance: '5K', mi: 3.10686 },
      { distance: '10K', mi: 6.21371 },
      { distance: 'Half', mi: 13.1094 },
      { distance: 'Marathon', mi: 26.2188 },
    ];
    const raceProjections = vdot != null
      ? STANDARD_RACES
          .map(r => ({ distance: r.distance, time: formatRaceTime(predictRaceTime(vdot, r.mi)) }))
          .filter((r): r is { distance: string; time: string } => r.time != null)
      : null;

    return NextResponse.json({
      ok: true,
      status,
      vdot,
      projectionSec,
      goalSec,
      goalSafeSec: goalSafeSec ?? null,
      raceSlug: race?.slug ?? null,
      raceName: race?.name ?? null,
      raceDate: race?.date ?? null,
      daysAway,
      distanceMi: race?.distance_mi ?? null,
      location: race?.location ?? null,
      totalGapSec,
      fitnessSec,
      courseImpactSec,
      courseSource,
      courseElevGainFtPerMi,
      conditionsImpactSec,
      conditionsSource,
      conditionsSafetyMessage,
      executionBufferSec,
      executionSource,
      executionCV,
      executionN,
      levers,
      heldDays: held,
      lastMove,
      raceProjections,
      confidenceInterval,
      confidenceLabel,
    });
  } catch (err: any) {
    console.error('[api/targets/projection] failed:', err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'lookup failed' },
      { status: 500 },
    );
  }
}
