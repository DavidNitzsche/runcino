/**
 * GET /api/admin/race-hr-diagnostic
 *
 * Diagnostic for the max-HR investigation David flagged on 2026-05-19:
 * pulls avg HR + max HR + workout-type per recent race so you can
 * see whether stored max HR is being sustained for the whole race
 * (suggesting stored max is too low) or only spiked at the finish
 * (suggesting stored max is close to true).
 *
 * Returns avgHr/maxHr/duration/canonicalLabel for every race-tagged
 * Strava activity in the last 18 months. Sorts newest-first.
 *
 * Sustained-effort signature: avgHr/storedMax > 0.88 for HM, > 0.92
 * for 10K. If David's Sombrero shows avg HR 170+ at stored max 175,
 * stored max is too low (you can't sustain 97% of true max for HM).
 *
 * Read-only. Admin-only.
 */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { query } from '@/lib/db';

interface RaceHrRow {
  id: string;
  date: string;
  name: string;
  distance_mi: number;
  canonical_label: string | null;
  workout_type: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  moving_time_s: number;
}

function fmtTime(s: number | null): string {
  if (s == null || s <= 0) return ', ';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

export async function GET() {
  const admin = await requireAdmin();

  const eighteenMonthsAgo = new Date(Date.now() - 540 * 86_400_000)
    .toISOString().slice(0, 10);

  const rows = await query<RaceHrRow>(
    `SELECT
        id::text                                  AS id,
        data->>'date'                             AS date,
        COALESCE(data->>'name', '')               AS name,
        (data->>'distanceMi')::NUMERIC            AS distance_mi,
        data->>'canonicalLabel'                   AS canonical_label,
        (data->>'workoutType')::INTEGER           AS workout_type,
        (data->>'avgHr')::NUMERIC                 AS avg_hr,
        (data->>'maxHr')::NUMERIC                 AS max_hr,
        (data->>'movingTimeS')::NUMERIC           AS moving_time_s
       FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND (data->>'date') >= $2
        AND (
          (data->>'workoutType')::INTEGER = 1
          OR data->>'canonicalLabel' IS NOT NULL
        )
      ORDER BY (data->>'date') DESC
      LIMIT 30`,
    [admin.id, eighteenMonthsAgo],
  );

  // Pull stored max HR for reference ratio
  const userRows = await query<{ max_hr: number | null }>(
    `SELECT max_hr FROM users WHERE id = $1 LIMIT 1`,
    [admin.id],
  );
  const storedMaxHr = userRows[0]?.max_hr ?? null;

  // For each race, compute avg/stored ratio + sustainability flag
  const races = rows.map((r) => {
    const avg = r.avg_hr != null ? Number(r.avg_hr) : null;
    const max = r.max_hr != null ? Number(r.max_hr) : null;
    const distMi = Number(r.distance_mi);
    const ratio = avg && storedMaxHr ? avg / storedMaxHr : null;
    const ratioPct = ratio != null ? Math.round(ratio * 100) : null;

    // LTHR thresholds, trained runners sustain at most ~92% of true
    // max for HM, ~95% for 10K, ~98% for 5K. Above those caps, the
    // stored max is suspect.
    let lthrCap: number | null = null;
    let lthrCapPct: number | null = null;
    let suspect = false;
    if (avg && storedMaxHr) {
      if (distMi >= 13.0 && distMi < 25) { lthrCapPct = 92; }
      else if (distMi >= 5.5 && distMi < 7.5) { lthrCapPct = 95; }
      else if (distMi >= 2.8 && distMi < 3.5) { lthrCapPct = 98; }
      if (lthrCapPct != null) {
        lthrCap = Math.round(storedMaxHr * (lthrCapPct / 100));
        suspect = avg > lthrCap;
      }
    }

    return {
      stravaId: r.id,
      date: r.date,
      name: r.name,
      distanceMi: distMi,
      canonicalLabel: r.canonical_label,
      workoutType: r.workout_type,
      avgHr: avg,
      maxHrInActivity: max,
      durationDisplay: fmtTime(Number(r.moving_time_s)),
      vsStoredMaxPct: ratioPct,
      lthrCapPct,
      lthrCapBpm: lthrCap,
      suspect,
      note: suspect && lthrCap
        ? `avg HR ${avg} > LTHR cap ${lthrCap} (${lthrCapPct}% of stored ${storedMaxHr}), stored max is probably too low`
        : ratio != null
        ? `avg ${ratioPct}% of stored max, within LTHR band`
        : null,
    };
  });

  return NextResponse.json({
    storedMaxHr,
    races,
    summary: {
      racesAnalyzed: races.length,
      suspectRaces: races.filter((r) => r.suspect).length,
      hint: races.some((r) => r.suspect)
        ? 'At least one race shows avg HR above the LTHR cap for its distance, stored max HR is probably too low. Review the suspect rows.'
        : 'All races show avg HR within the LTHR cap. Stored max HR looks consistent with race performance.',
    },
  });
}
