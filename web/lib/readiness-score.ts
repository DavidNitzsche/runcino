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
import { formatCrossReference, type CrossReference } from './coach-voice';
import type { Z2CoverageFinding } from './z2-coverage';
import { hardEffortFloorBpm } from './hr-zones';

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
  /** V7 cross-reference to another /overview surface that plausibly
   *  contributes to the readiness state.  Fires only when the
   *  earned-not-decorative relevance check passes (see
   *  resolveCrossRef below).  Null when no related finding is informing
   *  this one. */
  crossRef?: CrossReference | null;
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

/** One-word body-state label for tight surfaces (watch glance, complication,
 *  the iPhone readiness pill). Maps the green/yellow/red state to the words
 *  the watch model documents: "Primed" / "Hold easy" / "Back off". */
export function readinessLabelFor(state: ReadinessFinding['state']): string {
  switch (state) {
    case 'green':  return 'Primed';
    case 'yellow': return 'Hold easy';
    case 'red':    return 'Back off';
  }
}

/**
 * V7 · resolveCrossRef · earned-not-decorative cross-reference check.
 *
 * V5 (Z2 stimulus check) → C6 (readiness) cross-ref fires when ALL of:
 *
 *   · readiness state is yellow or red (green doesn't need an explanation)
 *   · V5 is firing (z2Finding.shouldRender === true)
 *   · V5 plausibly contributes — at least one readiness input that
 *     reduced the score is in the same causal family as V5's finding.
 *     V5 means easy runs were too hard; that elevates yesterday's
 *     load + freshness markers.  If yesterday or freshness pushed the
 *     score down, V5 is plausibly part of the story.
 *
 * Relation: 'consistent with' (default) — corroboration without
 * overclaiming causation.  Both surfaces observe elevated effort from
 * different angles; we don't assert V5 caused C6.
 *
 * Returns null when the check fails — topic overlap alone is not
 * enough to fire a cross-reference (Rule 1 from CROSS-REFERENCE
 * DISCIPLINE in coach-voice.ts).
 */
export function resolveCrossRef(
  state: ReadinessFinding['state'],
  inputs: ReadinessFinding['inputs'],
  z2Finding: Z2CoverageFinding | null,
): CrossReference | null {
  if (state === 'green') return null;
  if (!z2Finding || !z2Finding.shouldRender) return null;

  const fatigueRelevantInputs = inputs.filter(
    (i) => i.delta < 0 && (i.name === 'yesterday' || i.name === 'freshness' || i.name === 'load-7d'),
  );
  if (fatigueRelevantInputs.length === 0) return null;

  return formatCrossReference({
    relatedLabel: 'Z2 stimulus check',
    surface: '/overview',
    anchor: 'z2-stimulus-check',
    relation: 'consistent with',
  });
}

export async function computeReadinessScore(
  userId: string,
  todayIso: string,
  userMaxHr: number | null,
  restingHr: number | null,
  z2Finding: Z2CoverageFinding | null = null,
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
    // HR fields can be decimals (e.g. 143.7) on HealthKit-enriched
    // activities, so cast via NUMERIC + ROUND — a bare ::INTEGER throws
    // "invalid input syntax for type integer" and nulls the whole score.
    `SELECT data->>'date'              AS date,
            ROUND((data->>'workoutType')::NUMERIC)::INTEGER AS workout_type,
            (data->>'distanceMi')::TEXT  AS distance,
            ROUND((data->>'avgHr')::NUMERIC)::INTEGER    AS avg_hr,
            ROUND((data->>'maxHr')::NUMERIC)::INTEGER    AS max_hr
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

  // "Hard by HR" = average HR at/above the Threshold-zone floor (Z4),
  // Karvonen %HRR when resting HR is known. Single shared definition
  // (lib/hr-zones.ts) so readiness, plan-building and the run debrief
  // can't drift apart. Research/03 §4 (Z4 80–90%) + §5 (Karvonen).
  const hardFloor = hardEffortFloorBpm(userMaxHr, restingHr);

  // Sleep + HRV + resting-HR inputs are wired below from health_samples.

  // ── Yesterday's load ──
  const yesterdayActivity = rows.find((r) => r.date === yesterdayIso);
  if (yesterdayActivity) {
    const distance = Number(yesterdayActivity.distance) || 0;
    const isHardByType = yesterdayActivity.workout_type === 3;
    const isHardByHr = hardFloor && yesterdayActivity.avg_hr
      ? yesterdayActivity.avg_hr >= hardFloor
      : false;
    const isLong = distance >= 9;
    const isHard = isHardByType || isHardByHr;

    if (isHard) {
      score -= 15;
      const why = isHardByHr ? `avg HR ${yesterdayActivity.avg_hr} ≥ threshold floor ${hardFloor}` : 'tagged a hard workout';
      inputs.push({ name: 'yesterday', delta: -15, note: `hard session yesterday (${why})` });
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
    if (hardFloor && r.avg_hr && r.avg_hr >= hardFloor) return true;
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

  // Freshness rewards a genuine easy stretch (+10) and penalizes ACUTE
  // overload only — back-to-back hard days without recovery between
  // (≥2 in 3 days). A SINGLE hard session 2–3 days ago is normal training
  // rhythm: you absorb one quality day within ~48h (Research/00b §In-week
  // recovery), and the 'yesterday' input already handles the acute case —
  // so a lone recent quality day no longer double-dings or chronically
  // pins readiness to yellow.
  if (hardLast5 === 0) {
    score += 10;
    inputs.push({ name: 'freshness', delta: +10, note: 'fresh — no hard sessions in 5 days' });
  } else if (hardLast3 >= 2) {
    score -= 10;
    inputs.push({ name: 'freshness', delta: -10, note: `${hardLast3} hard days back-to-back in the last 3 — limited recovery between` });
  }
  if (hardLast7 >= 4) {
    score -= 10;
    inputs.push({ name: 'load-7d', delta: -10, note: `${hardLast7} hard sessions in last 7 days (high load)` });
  }

  // Note: weekly mileage-vs-prescribed is intentionally NOT a readiness
  // input (the score is about recovery/freshness, not plan adherence —
  // mileage progress lives in its own card). We deliberately don't list it
  // as a "missing" input, since that read as a confusing "unavailable" note
  // sitting right next to the mileage bar.

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

  // ── HealthKit recovery vitals · HRV, resting HR, last-night sleep ──
  //    All cited to Research/03 §9–§10 (HRV/RHR baselines) and Research/00b
  //    §Sleep. Baselines = trailing mean over the window (excluding the
  //    latest reading). Skipped (logged as missing) when too few samples.
  try {
    const hsRows = await query<{ sample_type: string; value: string; sample_date: string }>(
      `SELECT sample_type, value::text AS value, sample_date::text AS sample_date
         FROM health_samples
        WHERE user_id = $1
          AND sample_type IN ('hrv', 'resting_hr', 'sleep_hours')
          AND sample_date >= (CURRENT_DATE - INTERVAL '35 days')
        ORDER BY sample_date DESC`,
      [userId],
    );
    const series = (t: string) => hsRows.filter((r) => r.sample_type === t).map((r) => Number(r.value)).filter((n) => isFinite(n));

    // HRV — latest vs trailing baseline. Research/03 §10: ~20% below
    // baseline = poor recovery; >1 SD below = reduce intensity.
    const hrv = series('hrv');
    if (hrv.length >= 4) {
      const latest = hrv[0];
      const base = hrv.slice(1).reduce((s, n) => s + n, 0) / (hrv.length - 1);
      const dropPct = base > 0 ? (base - latest) / base : 0;
      if (dropPct >= 0.20) { score -= 12; inputs.push({ name: 'hrv', delta: -12, note: `HRV ${Math.round(latest)}ms is ${Math.round(dropPct * 100)}% below your ${Math.round(base)}ms baseline — poor recovery` }); }
      else if (dropPct >= 0.10) { score -= 6; inputs.push({ name: 'hrv', delta: -6, note: `HRV ${Math.round(latest)}ms dipping below your ${Math.round(base)}ms baseline` }); }
      else if (dropPct <= -0.10) { score += 5; inputs.push({ name: 'hrv', delta: +5, note: `HRV ${Math.round(latest)}ms above your ${Math.round(base)}ms baseline — well recovered` }); }
    } else { missing.push('hrv (need a few days of baseline)'); }

    // Resting HR — latest vs baseline. Research/03 §9: +7 bpm over baseline
    // → easy day; ±3–4 bpm is normal noise.
    const rhr = series('resting_hr');
    if (rhr.length >= 4) {
      const latest = rhr[0];
      const base = rhr.slice(1).reduce((s, n) => s + n, 0) / (rhr.length - 1);
      const delta = latest - base;
      if (delta >= 7) { score -= 10; inputs.push({ name: 'resting-hr', delta: -10, note: `Resting HR ${Math.round(latest)} is +${Math.round(delta)} over your ${Math.round(base)} baseline — back off` }); }
      else if (delta >= 4) { score -= 5; inputs.push({ name: 'resting-hr', delta: -5, note: `Resting HR ${Math.round(latest)} slightly elevated vs ${Math.round(base)} baseline` }); }
      else if (delta <= -3) { score += 3; inputs.push({ name: 'resting-hr', delta: +3, note: `Resting HR ${Math.round(latest)} below your ${Math.round(base)} baseline — recovered` }); }
    } else { missing.push('resting-hr (need a few days of baseline)'); }

    // Sleep — last night. Research/00b §Sleep: <6h significant decrement;
    // §8.1 general floor 7h.
    const sleep = series('sleep_hours');
    if (sleep.length >= 1) {
      const last = sleep[0];
      if (last < 6) { score -= 10; inputs.push({ name: 'sleep', delta: -10, note: `${last.toFixed(1)}h last night — under 6h is a real decrement` }); }
      else if (last < 7) { score -= 5; inputs.push({ name: 'sleep', delta: -5, note: `${last.toFixed(1)}h last night — below the 7h floor` }); }
      else if (last >= 8.5) { score += 5; inputs.push({ name: 'sleep', delta: +5, note: `${last.toFixed(1)}h last night — fully banked` }); }
      else { score += 3; inputs.push({ name: 'sleep', delta: +3, note: `${last.toFixed(1)}h last night — adequate` }); }
    } else { missing.push('sleep'); }
  } catch {
    missing.push('hrv'); missing.push('resting-hr'); missing.push('sleep');
  }

  score = clamp(score, 0, 100);
  const state = stateFor(score);
  const crossRef = resolveCrossRef(state, inputs, z2Finding);

  return {
    score,
    state,
    recommendation: recommendationFor(state),
    inputs,
    missingInputs: missing,
    crossRef,
  };
}
