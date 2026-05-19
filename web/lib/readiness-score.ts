/**
 * C6 · Daily readiness score · /overview TodayCard
 *
 * Composite 0-100 from inputs the system already tracks. Three-state
 * interpretation (per David spec round 5):
 *
 *   80+    · "Green. Hit today's prescription as written."
 *   60-79  · "Yellow. Watch effort. Consider easy substitution if HR
 *            runs high early."
 *   <60    · "Red. Recommend swapping for easy or recovery."
 *
 * SURFACE-ONLY DISCIPLINE (locked with David)
 *   This score never modifies the plan automatically. It's a coaching
 *   recommendation surface; the runner decides what to do with it.
 *   No auto-substitution. No auto-rest. The plan stays as written
 *   unless the runner explicitly swaps.
 *
 * INPUTS (with graceful degradation per Rule 3 surface-attribution):
 *   - Yesterday's load        · workoutType + distance + avgHr/maxHr
 *   - Days since last hard    · workoutType=3 activities in last 14 days
 *   - Hard sessions last 7d   · ditto
 *   - Mileage % of prescribed · this week so far vs synthetic-plan target
 *   - Signal 2 HR-pace drift  · Z2 pace delta from adaptive-vdot-signal2
 *
 * MISSING INPUTS
 *   When an input is unavailable (no sleep integration, no activities
 *   yet, signal 2 below volume gate, etc.), the score is computed
 *   from the inputs that ARE available and the missing ones are listed
 *   in `missingInputs` so the surface can say "Score 72 (sleep data
 *   unavailable — uses load + freshness only)."
 *
 * SUSPENSION
 *   When the user is marked injured (activity_gap_status='injured'),
 *   the score returns null and the surface is silent. Same per-finding
 *   context-filter discipline as L7 + V5.
 *
 * SCORING (transparent and tunable):
 *   Start at 75 (neutral baseline)
 *   ── load adjustments ──
 *   Yesterday HARD            -15
 *   Yesterday LONG (>9 mi)    -10
 *   Yesterday easy / rest      +5
 *   ── freshness ──
 *   0 hard in last 5 days     +10
 *   1+ hard in last 3 days    -10
 *   4+ hard in last 7 days    -10
 *   ── volume ──
 *   This week >110% prescribed -10
 *   This week  <80% prescribed -5   (light week — caveat: may be by choice)
 *   ── HR-pace drift ──
 *   Signal 2 Δ ≤ -10 s/mi      +5   (faster at fixed HR = fit)
 *   Signal 2 Δ ≥ +10 s/mi     -10   (slower at fixed HR = fatigued)
 *
 *   Final clamped to [0, 100].
 */

import { query } from './db';
import { computeSignal2 } from './adaptive-vdot-signal2';
import { computeStravaGap } from './strava-gap';

export interface ReadinessFinding {
  /** 0-100 composite score, OR null when surface should be silent. */
  score: number | null;
  state: 'green' | 'yellow' | 'red';
  /** Plain-language recommendation tied to the state. */
  recommendation: string;
  /** Inputs that contributed and their score deltas (transparent
   *  scoring per the locked discipline). */
  inputs: Array<{ name: string; delta: number; note: string }>;
  /** Inputs we WOULD have used if available — listed so the surface
   *  can be transparent about gaps. */
  missingInputs: string[];
  /** Suppress reason when score is null. */
  suppressReason?: 'injured' | 'no-data';
}

interface ActivityRow {
  date: string;
  workout_type: number | null;
  distance: string;
  avg_hr: number | null;
  max_hr: number | null;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function stateFor(score: number): ReadinessFinding['state'] {
  if (score >= 80) return 'green';
  if (score >= 60) return 'yellow';
  return 'red';
}

function recommendationFor(state: ReadinessFinding['state']): string {
  switch (state) {
    case 'green':  return 'Green. Hit today\'s prescription as written.';
    case 'yellow': return 'Yellow. Watch effort. Consider easy substitution if HR runs high early.';
    case 'red':    return 'Red. Recommend swapping today\'s session for easy or recovery.';
  }
}

export async function computeReadinessScore(
  userId: string,
  todayIso: string,
  userMaxHr: number | null,
  restingHr: number | null,
): Promise<ReadinessFinding> {
  // Suspension check first (per Rule 5 · per-finding context filter).
  try {
    const gap = await computeStravaGap(userId, todayIso);
    if (gap.signalsSuspended) {
      return {
        score: null,
        state: 'green',
        recommendation: '',
        inputs: [],
        missingInputs: [],
        suppressReason: 'injured',
      };
    }
  } catch { /* non-fatal */ }

  const last14StartIso = new Date(Date.parse(todayIso + 'T00:00:00Z') - 14 * 86_400_000)
    .toISOString().slice(0, 10);
  const yesterdayIso = new Date(Date.parse(todayIso + 'T00:00:00Z') - 1 * 86_400_000)
    .toISOString().slice(0, 10);

  // Pull last 14 days of activities in one query.
  const rows = await query<ActivityRow>(
    `SELECT data->>'date'              AS date,
            (data->>'workoutType')::INTEGER AS workout_type,
            (data->>'distanceMi')::TEXT  AS distance,
            (data->>'avgHr')::INTEGER    AS avg_hr,
            (data->>'maxHr')::INTEGER    AS max_hr
       FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND (data->>'date') >= $2
        AND (data->>'date') < $3
        AND (data->>'distanceMi')::NUMERIC > 0
      ORDER BY (data->>'date') DESC`,
    [userId, last14StartIso, todayIso],
  );

  const inputs: ReadinessFinding['inputs'] = [];
  const missing: string[] = [];
  let score = 75;

  // ── Sleep input · not integrated yet (no Apple Health / Oura webhook). ──
  missing.push('sleep');

  // ── Yesterday's load ──
  const yesterdayActivity = rows.find((r) => r.date === yesterdayIso);
  if (yesterdayActivity) {
    const distance = Number(yesterdayActivity.distance) || 0;
    const isHardByType = yesterdayActivity.workout_type === 3;
    const isHardByHr = userMaxHr && yesterdayActivity.avg_hr
      ? yesterdayActivity.avg_hr >= userMaxHr * 0.80
      : false;
    const isLong = distance >= 9;
    const isHard = isHardByType || isHardByHr;

    if (isHard) {
      score -= 15;
      inputs.push({ name: 'yesterday', delta: -15, note: 'hard session (workout-type 3 OR avg HR ≥80% max)' });
    } else if (isLong) {
      score -= 10;
      inputs.push({ name: 'yesterday', delta: -10, note: `long run (${distance.toFixed(1)} mi ≥ 9 mi)` });
    } else {
      score += 5;
      inputs.push({ name: 'yesterday', delta: +5, note: `easy run (${distance.toFixed(1)} mi)` });
    }
  } else {
    score += 5;
    inputs.push({ name: 'yesterday', delta: +5, note: 'rest day' });
  }

  // ── Freshness · days since last hard ──
  const hardSessions = rows.filter((r) => {
    if (r.workout_type === 3) return true;
    if (userMaxHr && r.avg_hr && r.avg_hr >= userMaxHr * 0.85) return true;
    return false;
  });
  const last3StartIso = new Date(Date.parse(todayIso + 'T00:00:00Z') - 3 * 86_400_000)
    .toISOString().slice(0, 10);
  const last5StartIso = new Date(Date.parse(todayIso + 'T00:00:00Z') - 5 * 86_400_000)
    .toISOString().slice(0, 10);
  const last7StartIso = new Date(Date.parse(todayIso + 'T00:00:00Z') - 7 * 86_400_000)
    .toISOString().slice(0, 10);
  const hardLast3 = hardSessions.filter((r) => r.date >= last3StartIso).length;
  const hardLast5 = hardSessions.filter((r) => r.date >= last5StartIso).length;
  const hardLast7 = hardSessions.filter((r) => r.date >= last7StartIso).length;

  if (hardLast5 === 0) {
    score += 10;
    inputs.push({ name: 'freshness', delta: +10, note: '0 hard sessions in last 5 days' });
  } else if (hardLast3 >= 1) {
    score -= 10;
    inputs.push({ name: 'freshness', delta: -10, note: `${hardLast3} hard session(s) in last 3 days` });
  }
  if (hardLast7 >= 4) {
    score -= 10;
    inputs.push({ name: 'load-7d', delta: -10, note: `${hardLast7} hard sessions in last 7 days (high load)` });
  }

  // ── Mileage % of prescribed this week · not wired yet
  //    (synthetic-plan prescribed-mileage lookup would need a server
  //    helper that knows the current week). Note as missing for now. ──
  missing.push('mileage-vs-prescribed');

  // ── Signal 2 HR-pace drift ──
  try {
    const sig2 = await computeSignal2(userId, new Date(todayIso + 'T12:00:00Z'), userMaxHr, restingHr);
    if (sig2.deltaSPerMi != null && sig2.enoughVolume) {
      if (sig2.deltaSPerMi <= -10) {
        score += 5;
        inputs.push({ name: 'hr-pace-drift', delta: +5, note: `Z2 pace ${Math.abs(sig2.deltaSPerMi)}s/mi faster at fixed HR` });
      } else if (sig2.deltaSPerMi >= 10) {
        score -= 10;
        inputs.push({ name: 'hr-pace-drift', delta: -10, note: `Z2 pace ${sig2.deltaSPerMi}s/mi slower at fixed HR` });
      }
    } else {
      missing.push('hr-pace-drift (signal 2 below volume gate)');
    }
  } catch {
    missing.push('hr-pace-drift');
  }

  score = clamp(score, 0, 100);
  const state = stateFor(score);

  return {
    score,
    state,
    recommendation: recommendationFor(state),
    inputs,
    missingInputs: missing,
  };
}
