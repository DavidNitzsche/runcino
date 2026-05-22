/**
 * GET /api/admin/l7-signal-view
 *
 * Diagnostic: shows what L7 Signal 1 sees in the user's last 6 weeks
 * of threshold-effort workouts. Builds the same activity → context
 * → observation pipeline the live signal uses, then surfaces EVERY
 * observation (faster, slower, AND filtered-out) along with per-
 * workout context attenuation.
 *
 * Use case: "Has my signal been waiting to fire because heat or
 * race-recency wasn't filtered before? Now that the filters are in,
 * what does the signal actually see?", David, 2026-05-19 round 4.
 *
 * Returns full SignalObservation shape per workout, plus the rolled-
 * up faster/slower counts and weights, plus the verdict the same
 * inputs would produce in the live UI. Read-only.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requireAdminOrOpToken } from '@/lib/auth';
import { query } from '@/lib/db';
import {
  evaluateActivities,
  LOOKBACK_DAYS,
  HEAT_CEILING_F,
  RACE_RECENCY_DAYS,
  type ActivityData,
  type ActivityContext,
} from '@/lib/adaptive-vdot-signals';
import { getWorkoutTemperatureF } from '@/lib/workout-weather';
import { resolveEffectiveMaxHr } from '@/lib/compute-max-hr';
import { computeAggregateVdot } from '@/lib/compute-vdot';
import { buildAdaptiveVdotVerdict } from '@/lib/adaptive-vdot-verdict';

interface ActivityRow {
  id: string;
  data: ActivityData;
}

function fmtPace(s: number | null): string {
  if (s == null || s <= 0) return ', ';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}/mi`;
}

export async function GET(req: NextRequest) {
  const admin = await requireAdminOrOpToken(req);
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const cutoffIso = new Date(today.getTime() - LOOKBACK_DAYS * 86_400_000)
    .toISOString().slice(0, 10);

  // Same query the live signal uses.
  const rows = await query<ActivityRow>(
    `SELECT id::text AS id, data
       FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND (data->>'date') >= $2
        AND (data->>'distanceMi')::NUMERIC BETWEEN 3 AND 15
        AND (data->>'movingTimeS')::NUMERIC > 0
        AND (data->>'avgHr')::NUMERIC > 0
        AND COALESCE((data->>'workoutType')::INTEGER, 0) != 1
      ORDER BY (data->>'date') DESC
      LIMIT 50`,
    [admin.id, cutoffIso],
  );

  // Race calendar in window (with padding for recency filter).
  const padDays = RACE_RECENCY_DAYS + 1;
  const padStart = new Date(Date.parse(cutoffIso + 'T00:00:00Z') - padDays * 86_400_000)
    .toISOString().slice(0, 10);
  const padEnd = new Date(Date.parse(todayIso + 'T00:00:00Z') + padDays * 86_400_000)
    .toISOString().slice(0, 10);
  const raceRows = await query<{ date: string; name: string }>(
    `SELECT meta->>'date' AS date, meta->>'name' AS name
       FROM races
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND meta->>'date' BETWEEN $2 AND $3
      ORDER BY meta->>'date'`,
    [admin.id, padStart, padEnd],
  );
  const raceDates = raceRows.map((r) => r.date).filter(Boolean);

  // Resolve VDOT + max HR via the same resolvers the live signal uses.
  const aggVdot = await computeAggregateVdot(admin.id);
  const currentVdot = aggVdot?.value ?? 45;
  const maxHrResolved = await resolveEffectiveMaxHr(admin.id);
  const maxHr = maxHrResolved.value ?? null;

  // Resolve per-workout context (weather + race-recency).
  const enriched = await Promise.all(
    rows.map(async (r) => {
      const data = r.data;
      const date = data.date ?? null;
      let temperatureF: number | null = null;
      if (data.startLatLng && date) {
        temperatureF = await getWorkoutTemperatureF(data.startLatLng[0], data.startLatLng[1], date);
      }
      let daysToNearestRace: number | null = null;
      if (date && raceDates.length > 0) {
        const workoutMs = Date.parse(date + 'T12:00:00Z');
        let minAbs = Number.POSITIVE_INFINITY;
        for (const rd of raceDates) {
          const raceMs = Date.parse(rd + 'T12:00:00Z');
          const days = Math.abs(Math.round((raceMs - workoutMs) / 86_400_000));
          if (days < minAbs) minAbs = days;
        }
        if (Number.isFinite(minAbs)) daysToNearestRace = minAbs;
      }
      const context: ActivityContext = { temperatureF, daysToNearestRace };
      return { data, context };
    }),
  );

  const result = evaluateActivities(enriched, currentVdot, maxHr);

  // Build the verdict the same way the live UI does.
  const verdict = await buildAdaptiveVdotVerdict(admin.id, currentVdot, maxHr, today);

  return NextResponse.json({
    window: { from: cutoffIso, to: todayIso, lookbackDays: LOOKBACK_DAYS },
    inputs: {
      currentVdot,
      maxHr,
      racesInScope: raceRows.map((r) => ({ date: r.date, name: r.name })),
    },
    filters: {
      heatCeilingF: HEAT_CEILING_F,
      raceRecencyDays: RACE_RECENCY_DAYS,
      hrMissingAttenuation: 0.6,
    },
    candidates: {
      total: rows.length,
      passedThresholdGate: result.observations.length,
    },
    rollup: {
      fasterCount: result.fasterCount,
      fasterWeight: Math.round(result.fasterWeight * 100) / 100,
      slowerCount: result.slowerCount,
      slowerWeight: Math.round(result.slowerWeight * 100) / 100,
      firesUp: result.fasterCount >= 3 && result.fasterWeight >= 2.5,
      firesDown: result.slowerCount >= 2 && result.slowerWeight >= 1.5,
    },
    observations: result.observations.map((o) => ({
      date: o.date,
      label: o.workoutLabel,
      actualPace: fmtPace(o.actualPaceS),
      prescribedPace: fmtPace(o.prescribedPaceS),
      paceDeltaS: o.paceDeltaS,
      avgHr: o.actualAvgHr,
      hrInRange: o.hrInRange,
      temperatureF: o.temperatureF,
      daysToNearestRace: o.daysToNearestRace,
      context: o.context,
      faster: o.faster,
      slower: o.slower,
      weight: o.weight,
      verdict: o.faster
        ? 'COUNTS · faster'
        : o.slower
        ? 'COUNTS · slower'
        : o.context.length > 0
        ? `FILTERED · ${o.context.join(', ')}`
        : 'NEUTRAL · within pace band',
    })),
    verdict: {
      hasFinding: verdict.hasFinding,
      dismissed: verdict.dismissed,
      recommendationKind: verdict.recommendation.kind,
      reason: verdict.recommendation.reason,
    },
    summary: {
      hint: result.fasterCount >= 3 && result.fasterWeight >= 2.5
        ? `${result.fasterCount} faster observations at ${result.fasterWeight.toFixed(1)}w, bump should fire.`
        : result.observations.length >= 3
          ? `${result.observations.length} threshold-band workouts found; ${result.fasterCount} flagged faster after filters (need 3 obs + 2.5w to fire UP). Below threshold, system correctly waiting.`
          : `Only ${result.observations.length} threshold-band workouts in last ${LOOKBACK_DAYS} days. Need 3 to evaluate, system waiting on more data.`,
    },
  });
}
