/**
 * run-state.ts — load a single activity by id for the drill-down view.
 */
import { pool } from '@/lib/db/pool';

export interface RunDetail {
  id: string;
  date: string;
  name: string | null;
  distance_mi: number;
  pace: string | null;
  time_moving: string | null;
  hr_avg: number | null;
  hr_max: number | null;
  cadence_avg: number | null;
  temp_f: number | null;
  elev_gain_ft: number | null;
  splits: { mile: number; pace: string | null; hr: number | null; cadence: number | null }[];
  hrZonePcts: { z1: number; z2: number; z3: number; z4: number; z5: number };
}

export async function loadRunDetail(userId: string, activityId: string): Promise<RunDetail | null> {
  // The id passed in is whatever the briefing surfaced — could be a strava id,
  // or a synthesized id like `${date}-${distance}`. Try a few lookups.
  const r = (await pool.query(
    `SELECT data FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND (data->>'id' = $2 OR data->>'activityId' = $2)
      LIMIT 1`,
    [userId, activityId]
  )).rows[0]?.data;
  if (!r) return null;

  const splits = Array.isArray(r.splits) ? r.splits.map((s: any, i: number) => ({
    mile: s.mile ?? (i + 1),
    pace: s.pace ?? s.pace_min_per_mi ?? null,
    hr: Number(s.hr) || null,
    cadence: Number(s.cadence) || null,
  })) : [];

  const hrPcts = r.hrZonePcts ?? r.hr_zones ?? { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };

  return {
    id: r.id ?? r.activityId ?? activityId,
    date: r.date || (r.startLocal ?? '').slice(0, 10),
    name: r.name ?? null,
    distance_mi: Number(r.distanceMi) || 0,
    pace: r.avgPaceMinPerMi || r.pace || null,
    time_moving: r.timeMoving || r.duration || null,
    hr_avg: Number(r.avgHr) || null,
    hr_max: Number(r.maxHr) || null,
    cadence_avg: Number(r.avgCadence) || null,
    temp_f: Number(r.tempF) || null,
    elev_gain_ft: Number(r.elevGainFt) || null,
    splits,
    hrZonePcts: {
      z1: Number(hrPcts.z1) || 0, z2: Number(hrPcts.z2) || 0, z3: Number(hrPcts.z3) || 0,
      z4: Number(hrPcts.z4) || 0, z5: Number(hrPcts.z5) || 0,
    },
  };
}
