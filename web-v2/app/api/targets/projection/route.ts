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
 *     goalSource, goalLabel, goalDateISO, summaryLine,   // 2026-07-06 · P1-12
 *   }
 *
 * Goal-mode (no race row): when no races row resolves, the goal falls back
 * to profile tt_goal_* (distance + target time) and the active goal-mode
 * plan's goal_iso deadline — the SAME anchor generate.ts GOAL-MODE built the
 * plan from. 2026-07-06 · P1-12 / P1-53.
 *
 * Cold path: no VDOT / no goal race / no fitness goal → ok=true with nulls.
 * The iPhone panel renders TargetsProjectionColdState.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';
import { loadProjectionSeries, loadLatestVdotWithAnchor } from '@/lib/training/projection-snapshots';
import { predictRaceTime, parseRaceTime, formatRaceTime, goalDistanceMiFromCode, DANIELS_MAX_VALID_DISTANCE_MI } from '@/lib/training/vdot';
import { loadProfileState } from '@/lib/coach/profile-state';
import { computeCourseImpact } from '@/lib/training/course-impact';
import { computeRaceConditions } from '@/lib/training/race-conditions';
import { computePacingDiscipline } from '@/lib/coach/pacing-discipline';
import { computeProjectionLevers } from '@/lib/coach/projection-levers';
import { computeConfidenceInterval, computeConfidenceLabel, computeGoalProjection, reconcileStatusWithConfidence } from '@/lib/training/goal-projection';
import { composeTargetsSummaryLine } from '@/lib/training/targets-summary';

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
          `SELECT slug,
                  meta->>'name'                              AS name,
                  meta->>'date'                              AS date,
                  COALESCE(meta->>'goalDisplay', meta->>'goal') AS goal,
                  (meta->>'distanceMi')::float               AS distance_mi,
                  meta->>'location'                          AS location,
                  course_geometry,
                  meta->>'goalSafeDisplay'                   AS goal_safe
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
          `SELECT slug,
                  meta->>'name'                              AS name,
                  meta->>'date'                              AS date,
                  COALESCE(meta->>'goalDisplay', meta->>'goal') AS goal,
                  (meta->>'distanceMi')::float               AS distance_mi,
                  meta->>'location'                          AS location,
                  course_geometry,
                  meta->>'goalSafeDisplay'                   AS goal_safe
             FROM races
            WHERE user_uuid = $1
              AND meta->>'priority' = 'A'
              AND (meta->>'date')::date >= CURRENT_DATE
            ORDER BY (meta->>'date')::date ASC LIMIT 1`,
          [userId],
        );
    const race = raceQ.rows[0] ?? null;

    // ─── 1b. No-race fitness-goal fallback (2026-07-06 · P1-12 / P1-53) ───
    // Goal-mode runners (tt_goal_* set via /api/profile/goal · plan generated
    // by generate.ts GOAL-MODE with race_id = NULL) never resolve a races row,
    // so this route anchored their projection to the 13.1 query default with
    // goalSec null — a half-marathon trajectory next to a "5K · TARGET 25:00"
    // tile, status 'cold', and "On track for —." copy. Resolve the SAME goal
    // the plan was built for: profile tt_goal_* for distance + target time,
    // the active goal-mode plan's goal_iso for the deadline (persistPlan
    // writes the synthetic target date there · generate.ts persistPlan INSERT).
    let goalSource: 'race' | 'fitness_goal' | null = race ? 'race' : null;
    let goalLabel: string | null = null;
    let goalModeDistanceMi: number | null = null;
    let goalModeSec: number | null = null;
    let goalDateISO: string | null = race?.date ?? null;
    if (!race) {
      const prof = (await pool.query<{ d: string | null; t: string | null; s: number | string | null }>(
        `SELECT tt_goal_distance AS d, tt_goal_time AS t, tt_goal_time_seconds AS s
           FROM profile WHERE user_uuid = $1::uuid LIMIT 1`,
        [userId],
      ).catch(() => ({ rows: [] }))).rows[0];
      const dMi = goalDistanceMiFromCode(prof?.d);
      if (prof?.d && dMi != null) {
        goalSource = 'fitness_goal';
        goalLabel = prof.d;
        goalModeDistanceMi = dMi;
        // tt_goal_time_seconds is authoritative (written by /api/profile/goal);
        // legacy onboarding rows carry only a display string (or a range like
        // "22-25", which parseRaceTime rejects → trend copy, never a dash).
        goalModeSec = prof.s != null ? Number(prof.s) : parseRaceTime(prof.t);
        if (goalModeSec != null && goalModeSec <= 0) goalModeSec = null;
        // Deadline = the active goal-mode plan's goal_iso (text column).
        goalDateISO = (await pool.query<{ goal_iso: string | null }>(
          `SELECT goal_iso FROM training_plans
            WHERE user_uuid = $1::uuid AND archived_iso IS NULL AND race_id IS NULL
              AND authored_state->>'goal_mode' = 'true'
            ORDER BY authored_iso DESC LIMIT 1`,
          [userId],
        ).catch(() => ({ rows: [] }))).rows[0]?.goal_iso ?? null;
      }
    }

    // Use the race row's distance_mi when present; then the fitness goal's
    // distance; fall back to the query-param distance (iPhone might ask
    // before a race or goal is set).
    const distanceMi = race?.distance_mi ?? goalModeDistanceMi ?? distanceQ;
    // 2026-07-07 · ultra-honesty audit P2-70 · the Daniels equivalence this
    // whole route runs on (predictRaceTime/vdotFromRace) stops being valid
    // past the marathon (Research/02 §6.2/§14 rule 6); DANIELS_MAX_VALID_DISTANCE_MI
    // now nulls those functions out beyond it, so `projectionSec` and every
    // downstream gap/lever chunk below already degrade to honest zeros/nulls
    // for a 50K/50M/100K/100M target — no per-branch change needed there.
    // This flag is additive: it tells the client WHY the numbers are absent
    // (an ultra target, not a cold-start/no-data state) so the panel can
    // render "ultra projections aren't supported yet" instead of the
    // ambiguous cold-start copy. distanceQ's 13.1 default never trips this
    // (13.1 < 26.3) so the pre-goal/pre-race iPhone cold path is unaffected.
    const unsupportedDistance = distanceMi != null && distanceMi > DANIELS_MAX_VALID_DISTANCE_MI;
    const goalSec = race ? (race.goal ? parseRaceTime(race.goal) : null) : goalModeSec;
    const goalSafeSec = race?.goal_safe ? parseRaceTime(race.goal_safe) : null;
    const daysAway = goalDateISO
      ? Math.round((new Date(goalDateISO.slice(0, 10) + 'T12:00:00Z').getTime() - Date.now()) / 86400000)
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
    // AUDIT #36 · capture the VDOT ANCHOR (date + distance), not just the VDOT.
    // computeConfidenceInterval applies a §13.7 ±8% override when the anchor is
    // >180 days stale (Research/02); the web seed threads it but this route
    // dropped it, so the iPhone showed a falsely-confident ±2.5% band for the
    // same stale anchor. Load the anchor unconditionally (one cheap query) so we
    // have the date even when vdot came from the series — same snapshot source.
    const anchor = await loadLatestVdotWithAnchor(userId).catch(() => null);
    if (vdot == null && anchor?.vdot != null) vdot = anchor.vdot;
    // Last resort · the profile-state VDOT (also carries the anchor fallback).
    const profileState = await loadProfileState(userId).catch(() => null);
    if (vdot == null) {
      vdot = profileState?.physiology?.vdot ?? null;
    }
    // Anchor date/distance · snapshot first, profile fallback (mirrors seed.ts).
    const vdotAnchorDateISO =
      anchor?.anchorDateISO ?? profileState?.physiology?.vdot_anchor_date ?? null;
    const vdotAnchorDistanceMi =
      anchor?.anchorDistanceMi ?? profileState?.physiology?.vdot_anchor_distance_mi ?? null;
    // Derive today's projected race time from whatever VDOT resolved.
    if (projectionSec == null && vdot != null) {
      projectionSec = predictRaceTime(vdot, distanceMi) ?? null;
    }

    // 2026-06-12 · the goal-seeking trajectory · the ONE engine both surfaces
    // read (same computeGoalProjection the web seed uses). Carries the upgrade
    // gear (aheadOfGoal / planUnderBuilt / overPerformanceBonusVdot) + the
    // goal-seeking projectedSec, and below it drives `status` so the native Goal
    // tab shows the same number + status as web — no second projection engine.
    // Dormant unless genuinely over-performing. Best-effort.
    const gp = (vdot != null && goalSec != null && daysAway != null)
      ? await computeGoalProjection({
          userUuid: userId, goalSec, raceDistanceMi: distanceMi, vdot, daysToRace: daysAway,
          // AUDIT #36 · thread the anchor so the projection's internal CI gets
          // the §13.7 stale override, matching the web seed.
          vdotAnchorDateISO, vdotAnchorDistanceMi,
        }).catch(() => null)
      : null;
    const traj = gp?.trajectory ?? null;

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

    // ─── 4. Accrued estimate · the "TODAY" column that moves week by week ───
    // Replaces the frozen current-fitness snapshot with a training-progress
    // estimate: anchor VDOT + the gain accrued so far in the build (based on
    // fraction of plan completed × execution quality from the trajectory).
    // Converges toward trajectoryProjectedSec by race day.
    const planSpanQ = await pool.query<{ total_weeks: number | string }>(
      `SELECT ((MAX(pw.date_iso::date) - MIN(pw.date_iso::date)) / 7 + 1)::int AS total_weeks
         FROM plan_workouts pw
         JOIN training_plans tp ON tp.id = pw.plan_id
        WHERE tp.user_uuid = $1::uuid AND tp.archived_iso IS NULL`,
      [userId],
    ).catch(() => ({ rows: [] }));
    const totalPlanWeeks = planSpanQ.rows[0]?.total_weeks != null
      ? Number(planSpanQ.rows[0].total_weeks) : null;

    let trajectoryAccruedSec: number | null = null;
    if (traj && totalPlanWeeks && totalPlanWeeks > 0 && daysAway != null && vdot != null) {
      const weeksToRace = daysAway / 7;
      const completedWeeks = Math.max(0, totalPlanWeeks - weeksToRace);
      const completedFraction = Math.min(1, completedWeeks / totalPlanWeeks);
      const accruedVdot = vdot + traj.projectedGainVdot * completedFraction;
      trajectoryAccruedSec = predictRaceTime(accruedVdot, distanceMi) ?? null;
    }

    // Status from the trajectory — the SAME logic web's TargetsView uses — so
    // native and web agree. Race-week stays a time-based override (real races
    // only — a goal-mode deadline week is not a race week; 2026-07-06);
    // statusFor is the cold fallback only when there's no trajectory (no
    // vdot/goal/date).
    const rawStatus = (race != null && daysAway != null && daysAway <= 7 && daysAway >= 0) ? 'race_week'
      : traj ? (traj.reachable ? 'on_track' : traj.gapVdot <= 1.5 ? 'watch' : 'off')
      : statusFor(projectionSec, goalSec, race != null ? daysAway : null);
    const confidenceLabel = (vdot != null && goalSec != null)
      ? computeConfidenceLabel({
          goalSec,
          raceDistanceMi: distanceMi,
          vdot,
          daysToRace: daysAway,
          status: toGoalStatus(rawStatus),
        })
      : null;
    // 2026-07-06 · P1-14 · LOW confidence and ON PACE cannot coexist on one
    // payload. The runway cap in fitness-trajectory closes the main path; this
    // gate closes the short-runway edge (see reconcileStatusWithConfidence).
    const status = reconcileStatusWithConfidence(rawStatus, confidenceLabel?.tier);
    const goalStatus = toGoalStatus(status);
    // 2026-06-16 · band re-anchored to the race-day projection (the
    // goal-seeking trajectory) so it reads "where you'll likely finish" with
    // the goal sitting inside it, not the frozen current-fitness number.
    const confidenceInterval = computeConfidenceInterval({
      centerSec: traj?.projectedSec ?? projectionSec,
      raceDistanceMi: distanceMi,
      status: goalStatus,
      pacing: { cv: executionCV, source: executionSource },
      // AUDIT #36 · stale-anchor ±8% override (Research/02 §13.7) — the web seed
      // passes this; without it the iPhone band stayed falsely narrow.
      vdotAnchorDateISO, vdotAnchorDistanceMi,
    });
    const lastMove = lastMoveFromSeries(series);
    const held = heldDays(series, vdot);

    // 2026-07-06 · P1-12 / P2-28 · server-composed summary sentence. Never
    // "On track for —.": with a target time it speaks in real formatted
    // times; without one it emits trend copy (current fitness direction from
    // the same series signals above) or a set-a-goal nudge. Additive — the
    // iPhone panel adopts it in the native wave; until then it composes its
    // own line client-side.
    const summaryLine = composeTargetsSummaryLine({
      status,
      goalSec,
      projectedSec: traj?.projectedSec ?? projectionSec,
      goalSource,
      raceName: race?.name ?? null,
      daysAway,
      vdot,
      lastMove,
      heldDays: held,
      unsupportedDistance,
    });

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
      // Goal-mode runners get their goal's distance here (was null → the
      // iPhone fell back to its own 13.1 default). Race rows unchanged.
      distanceMi: race?.distance_mi ?? goalModeDistanceMi ?? null,
      location: race?.location ?? null,
      // 2026-07-07 · ultra-honesty audit P2-70 · true when distanceMi is past
      // the Daniels validity range — vdot/projectionSec/trajectory/levers are
      // all honestly null/zeroed for this reason (see DANIELS_MAX_VALID_
      // DISTANCE_MI gate in lib/training/vdot.ts), not a cold-start/no-data
      // state. Client surfaces read this to render "not supported yet" copy
      // instead of the ambiguous cold-start prompt.
      unsupportedDistance,
      // 2026-07-06 · P1-12 · goal provenance for goal-mode parity. Additive.
      //   goalSource  · 'race' | 'fitness_goal' | null
      //   goalLabel   · the tt_goal distance label ('5K', 'Half Marathon', …)
      //   goalDateISO · race date, or the goal plan's deadline (goal_iso)
      goalSource,
      goalLabel,
      goalDateISO,
      summaryLine,
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
      // 2026-06-12 · upgrade gear (trajectory-derived) for the native Goal tab.
      // aheadOfGoal → render the "AHEAD" headline; planUnderBuilt → advisory
      // (rebuild is web-only); trajectoryProjectedSec is the goal-seeking
      // projection (vs projectionSec, which stays current-fitness).
      aheadOfGoal: traj?.aheadOfGoal ?? false,
      planUnderBuilt: traj?.planUnderBuilt ?? null,
      overPerformanceBonusVdot: traj?.overPerformanceBonusVdot ?? 0,
      trajectoryProjectedSec: traj?.projectedSec ?? null,
      // 2026-06-18 · the "TODAY" accrued estimate · anchor VDOT + gain accrued
      // so far based on fraction of plan completed. Moves week-by-week as training
      // accumulates; converges toward trajectoryProjectedSec by race day.
      trajectoryAccruedSec,
      // 2026-06-16 · THE READOUT · the trajectory levers, surfaced so the
      // native Goal panel can show WHY (execution / plan intensity / runway),
      // not just the outcome.
      executionQuality: traj?.executionQuality ?? null,
      planBuiltForGoal: traj?.planBuiltForGoal ?? null,
      plannedTargetVdot: traj?.plannedTargetVdot ?? null,
      projectedGainVdot: traj?.projectedGainVdot ?? null,
      goalVdot: traj?.goalVdot ?? null,
      currentVdot: traj?.currentVdot ?? vdot,
      buildWeeks: traj?.buildWeeks ?? null,
      gapVdot: traj?.gapVdot ?? null,
    });
  } catch (err: any) {
    console.error('[api/targets/projection] failed:', err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'lookup failed' },
      { status: 500 },
    );
  }
}
