/**
 * Compute max HR from a user's Strava activity history.
 *
 * Max heart rate is the peak HR observed across all activities. The
 * highest reading from any one workout is the runner's measured
 * ceiling. We bias toward higher-effort sources (races > intervals >
 * long runs > easy runs) so a glitchy spike on an easy day doesn't
 * overwhelm a real race-day peak.
 *
 * Strategy:
 *   1. Pull all strava_activities for the user where maxHr is set
 *   2. Sanity-filter — drop anything <140 (likely a glitch) or >220
 *      (likely a glitch)
 *   3. Take the highest value — that's the measured max ceiling
 *   4. Bias note: if highest came from a race, that's the most
 *      trustworthy. If from an easy run, the user probably had a
 *      bad reading.
 *
 * Returns:
 *   { value: 187, source: { id: '12345', name: 'Big Sur Marathon', date: '2026-04-26', workoutType: 1 } }
 *   or null when no activity has a usable HR reading.
 */

import { query } from './db';

export interface ComputedMaxHr {
  value: number;
  source: {
    id: string;
    name: string;
    date: string;
    /** Strava workoutType: 0=default, 1=race, 2=long, 3=workout. */
    workoutType: number | null;
    distanceMi: number;
  };
  /** Top-N peak HR readings — for showing "confirmed across N runs"
   *  in the UI. Empty if only one or two valid sources. */
  topReadings: Array<{
    id: string;
    name: string;
    date: string;
    workoutType: number | null;
    distanceMi: number;
    hr: number;
  }>;
}

interface ActivityRow {
  id: string;
  data: {
    name?: string;
    maxHr?: number | null;
    workoutType?: number | null;
    distanceMi?: number;
    date?: string;
    startLocal?: string;
  };
}

export async function computeMaxHrFromActivities(userId: string): Promise<ComputedMaxHr | null> {
  // Pull more candidates so multi-source confirmation is meaningful.
  const rows = await query<ActivityRow>(
    `SELECT id::text AS id, data
       FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND (data->>'maxHr')::NUMERIC IS NOT NULL
        AND (data->>'maxHr')::NUMERIC >= 140
        AND (data->>'maxHr')::NUMERIC <= 220
      ORDER BY (data->>'maxHr')::NUMERIC DESC
      LIMIT 25`,
    [userId],
  );
  if (rows.length === 0) return null;

  // Top reading wins. If the top is from an easy run AND a race or
  // hard workout is within 3 bpm, prefer the race/workout (more
  // trustworthy signal).
  let best = rows[0];
  const topHr = Number(best.data.maxHr) || 0;
  for (const r of rows.slice(1)) {
    const hr = Number(r.data.maxHr) || 0;
    const isHardWorkout = r.data.workoutType === 1 || r.data.workoutType === 3;
    const topIsHardWorkout = best.data.workoutType === 1 || best.data.workoutType === 3;
    if (!topIsHardWorkout && isHardWorkout && hr >= topHr - 3) {
      best = r;
    }
  }

  const d = best.data;
  // Build top-N readings list — useful for "confirmed across N runs"
  // confidence UI. Only include readings within 8 bpm of the peak
  // (anything further is a different effort level, not a peak).
  const bestHr = Math.round(Number(d.maxHr) || 0);
  const topReadings = rows
    .filter((r) => {
      const hr = Number(r.data.maxHr) || 0;
      return hr >= bestHr - 8;
    })
    .slice(0, 8)
    .map((r) => ({
      id: r.id,
      name: r.data.name || 'Run',
      date: r.data.date || (r.data.startLocal || '').slice(0, 10),
      workoutType: r.data.workoutType ?? null,
      distanceMi: Number(r.data.distanceMi) || 0,
      hr: Math.round(Number(r.data.maxHr) || 0),
    }));

  return {
    value: bestHr,
    source: {
      id: best.id,
      name: d.name || 'Run',
      date: d.date || (d.startLocal || '').slice(0, 10),
      workoutType: d.workoutType ?? null,
      distanceMi: Number(d.distanceMi) || 0,
    },
    topReadings,
  };
}

/**
 * Resolve the effective max HR for a user:
 *   - prefer the stored override on users.max_hr (manual user input)
 *   - fall back to the computed value from activity history
 *   - returns null when neither exists
 */
export async function resolveEffectiveMaxHr(userId: string): Promise<{
  value: number | null;
  source: 'manual' | 'auto' | 'computed' | 'none';
  computed?: ComputedMaxHr | null;
  /** The automatic value (Apple-ingest `max_hr` → computed activity peak),
   *  regardless of whether a manual override is winning. Lets the UI offer
   *  "Apple Health now sees N — use it" when a higher peak appears. */
  autoValue?: number | null;
}> {
  const rows = await query<{ max_hr: number | null; max_hr_override: number | null }>(
    `SELECT max_hr, max_hr_override FROM users WHERE id = $1 LIMIT 1`,
    [userId],
  );
  const override = rows[0]?.max_hr_override ?? null;
  const auto = rows[0]?.max_hr ?? null;   // Apple-ingest ratcheted value
  // Resolve the AUTO value: stored Apple value, else computed activity peak.
  let autoValue = auto;
  let computed: ComputedMaxHr | null = null;
  if (autoValue == null) {
    computed = await computeMaxHrFromActivities(userId);
    autoValue = computed?.value ?? null;
  }
  // Manual override wins until cleared.
  if (override) {
    return { value: override, source: 'manual', autoValue, computed };
  }
  if (auto) {
    return { value: auto, source: 'auto', autoValue, computed };
  }
  if (computed) {
    return { value: computed.value, source: 'computed', computed, autoValue };
  }
  return { value: null, source: 'none', autoValue: null };
}
