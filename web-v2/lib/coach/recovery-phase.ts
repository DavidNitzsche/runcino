/**
 * lib/coach/recovery-phase.ts · post-session recovery tracker (power move #15).
 *
 * Identifies the most recent anchor hard session (race / long run /
 * intervals / tempo / threshold), tracks day-N-of-expected recovery
 * across HRV / RHR / sleep / HR Recovery / wrist temp / RR, and
 * surfaces muscle signals derived from form metrics on the easy runs
 * that follow.
 *
 * Doctrine:
 *   · Friel · 1 day per mile recovery for marathons
 *   · Half marathon · 5-7 days full recovery
 *   · Long run 15+ mi · 36-48h glycogen, 3-5 days muscles
 *   · Intervals / threshold · 24-72h
 *   · Research/15 · DOMS peaks 24-48h post-eccentric load
 *
 * Per-pillar bounce-back:
 *   - Capture each pillar's value the day of the session (day_0)
 *   - Capture today's value
 *   - Compare against pre-session baseline
 *   - pct_recovered = (current - peak_deficit) / (baseline - peak_deficit)
 *
 * Muscle signals: form metrics on easy runs after the anchor session.
 *   - Cadence on those easy runs vs typical · low = neuromuscular fatigue
 *   - GCT stretched vs typical · stiff legs
 *   - Stride length shortened · eccentric muscle damage signal
 *   - Run power degraded · muscle output not back yet
 *
 * Returns null when no anchor session found in the last 14 days OR the
 * runner is far enough out that recovery should be complete (anchor +
 * expectedDays + 1 < today).
 */

import { pool } from '@/lib/db/pool';

export type AnchorType = 'race' | 'long' | 'intervals' | 'tempo' | 'threshold';

export interface RecoveryPhase {
  anchor: {
    runId: string;
    date: string;             // YYYY-MM-DD
    type: AnchorType;
    label: string;            // "Sunday's 14mi long run"
    distanceMi: number;
    movingTimeS: number;
  };
  daysSince: number;
  expectedDaysToRecover: number;
  percentRecovered: number;   // 0-100
  pillars: Array<{
    key: 'hrv' | 'rhr' | 'sleep' | 'hr_recovery' | 'wrist_temp' | 'resp_rate';
    label: string;
    day0Value: number | null;
    currentValue: number | null;
    baselineValue: number | null;
    pctRecovered: number;     // 0-100 per pillar
  }>;
  muscleSignals: {
    cadenceSpm: number | null;
    cadenceDelta: number | null;        // signed · negative = lower than typical
    gctMs: number | null;
    gctDelta: number | null;             // signed · positive = stretched
    strideM: number | null;
    strideDelta: number | null;          // signed · negative = shortened
    runPowerW: number | null;
    runPowerDelta: number | null;        // signed
    summary: string;                     // plain English
  } | null;
  nextQualityGreenLight: {
    date: string;             // YYYY-MM-DD
    daysOut: number;
    reason: string;
  };
  message: string;            // one-line coach-voice summary
}

// Doctrine timelines · days to full recovery per session type.
function expectedDays(type: AnchorType, distanceMi: number): number {
  switch (type) {
    case 'race':
      // Friel rule: 1 day per mile for marathons. Half = 5-7d. 10k = 2-3d. 5k = 1-2d.
      if (distanceMi >= 26) return Math.min(28, Math.round(distanceMi));
      if (distanceMi >= 13) return 6;
      if (distanceMi >= 6) return 3;
      return 2;
    case 'long':
      // 36-48h glycogen, 3-5d muscles. Longer = more.
      if (distanceMi >= 20) return 5;
      if (distanceMi >= 15) return 4;
      return 3;
    case 'intervals':
    case 'tempo':
    case 'threshold':
      return 2;
  }
}

function detectType(runRow: { type: string | null; dist: number }): AnchorType | null {
  const t = (runRow.type ?? '').toLowerCase();
  if (t === 'race') return 'race';
  if (t === 'long' || (runRow.dist >= 12 && !t)) return 'long';
  if (t === 'intervals' || t === 'speed') return 'intervals';
  if (t === 'tempo' || t === 'threshold') return 'tempo';
  return null;
}

function formatAnchorLabel(date: string, type: AnchorType, distanceMi: number): string {
  const d = new Date(date + 'T12:00:00Z');
  const day = d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  if (type === 'race') return `${day}'s race · ${distanceMi.toFixed(1)}mi`;
  if (type === 'long') return `${day}'s ${Math.round(distanceMi)}mi long run`;
  if (type === 'intervals') return `${day}'s interval session`;
  if (type === 'tempo' || type === 'threshold') return `${day}'s tempo session`;
  return `${day}'s run`;
}

export async function computeRecoveryPhase(userUuid: string): Promise<RecoveryPhase | null> {
  const today = new Date().toISOString().slice(0, 10);

  // 1 · Find the most recent anchor hard session in the last 14 days.
  const runRows = await pool.query<{
    id: string; date: string; type: string | null; dist: number | string;
    moving: number | string | null;
  }>(
    `SELECT id::text, data->>'date' AS date, data->>'type' AS type,
            (data->>'distanceMi')::numeric AS dist,
            (data->>'movingTimeS')::numeric AS moving
       FROM runs
      WHERE user_uuid = $1::uuid
        AND NOT (data ? 'mergedIntoId')
        AND (data->>'date')::date >= ($2::date - interval '14 days')
        AND (data->>'date')::date <= $2::date
      ORDER BY (data->>'date')::date DESC`,
    [userUuid, today],
  ).then((r) => r.rows).catch(() => []);

  let anchor: RecoveryPhase['anchor'] | null = null;
  for (const r of runRows) {
    const dist = Number(r.dist);
    const type = detectType({ type: r.type, dist });
    if (!type) continue;
    anchor = {
      runId: r.id,
      date: r.date,
      type,
      label: formatAnchorLabel(r.date, type, dist),
      distanceMi: +dist.toFixed(1),
      movingTimeS: Number(r.moving) || 0,
    };
    break;  // most-recent
  }
  if (!anchor) return null;

  const anchorDate = new Date(anchor.date + 'T12:00:00Z');
  const todayDate = new Date(today + 'T12:00:00Z');
  const daysSince = Math.round((todayDate.getTime() - anchorDate.getTime()) / 86400000);
  const expDays = expectedDays(anchor.type, anchor.distanceMi);
  // Skip if recovery is conceptually complete (avoid stale anchors).
  if (daysSince > expDays + 1) return null;

  // 2 · Per-pillar bounce-back tracking.
  // For each pillar, compute the value on anchor date, today, and a
  // 30-day baseline excluding the post-anchor window.
  const pillars = await loadPillarBounceBack(userUuid, anchor.date, today);

  // 3 · Recovery % weighted by Plews-style importance
  const weights: Record<string, number> = {
    hrv: 0.30, sleep: 0.28, rhr: 0.24, hr_recovery: 0.10, wrist_temp: 0.05, resp_rate: 0.03,
  };
  let weightedSum = 0;
  let weightTotal = 0;
  for (const p of pillars) {
    const w = weights[p.key] ?? 0;
    if (p.pctRecovered != null && p.day0Value != null && p.baselineValue != null) {
      weightedSum += p.pctRecovered * w;
      weightTotal += w;
    }
  }
  const percentRecovered = weightTotal > 0 ? Math.round(weightedSum / weightTotal) : 50;

  // 4 · Muscle signals from form metrics on easy runs after anchor.
  const muscleSignals = await loadMuscleSignals(userUuid, anchor.date, today);

  // 5 · Next quality green-light date.
  const nextGreenLight = computeNextQualityGreenLight(anchor, daysSince, expDays, percentRecovered);

  // 6 · One-line message.
  const message = composeRecoveryMessage(anchor, daysSince, expDays, percentRecovered);

  return {
    anchor,
    daysSince,
    expectedDaysToRecover: expDays,
    percentRecovered,
    pillars,
    muscleSignals,
    nextQualityGreenLight: nextGreenLight,
    message,
  };
}

// ─── helpers ──────────────────────────────────────────────────────────

async function loadPillarBounceBack(
  userUuid: string,
  anchorDate: string,
  today: string,
): Promise<RecoveryPhase['pillars']> {
  const pillarSpecs: Array<{ key: RecoveryPhase['pillars'][number]['key']; sampleType: string; label: string; isLowerBetter: boolean }> = [
    { key: 'hrv', sampleType: 'hrv', label: 'HRV', isLowerBetter: false },
    { key: 'rhr', sampleType: 'resting_hr', label: 'RHR', isLowerBetter: true },
    { key: 'sleep', sampleType: 'sleep_hours', label: 'SLEEP', isLowerBetter: false },
    { key: 'hr_recovery', sampleType: 'hr_recovery', label: 'HR RECOVERY', isLowerBetter: false },
    { key: 'wrist_temp', sampleType: 'wrist_temp', label: 'WRIST TEMP', isLowerBetter: true },
    { key: 'resp_rate', sampleType: 'respiratory_rate', label: 'RESP RATE', isLowerBetter: true },
  ];

  const out: RecoveryPhase['pillars'] = [];
  for (const spec of pillarSpecs) {
    // Baseline · 30 days BEFORE the anchor.
    const baselineR = await pool.query<{ avg: number | string | null }>(
      `SELECT AVG(value::numeric) AS avg FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = $2
          AND sample_date >= ($3::date - interval '30 days')
          AND sample_date < $3::date`,
      [userUuid, spec.sampleType, anchorDate],
    ).then((r) => r.rows[0]).catch(() => ({ avg: null }));
    const day0R = await pool.query<{ avg: number | string | null }>(
      `SELECT AVG(value::numeric) AS avg FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = $2
          AND sample_date = $3::date`,
      [userUuid, spec.sampleType, anchorDate],
    ).then((r) => r.rows[0]).catch(() => ({ avg: null }));
    const currentR = await pool.query<{ avg: number | string | null }>(
      `SELECT AVG(value::numeric) AS avg FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = $2
          AND sample_date = $3::date`,
      [userUuid, spec.sampleType, today],
    ).then((r) => r.rows[0]).catch(() => ({ avg: null }));

    const baseline = baselineR?.avg != null ? Number(baselineR.avg) : null;
    const day0 = day0R?.avg != null ? Number(day0R.avg) : null;
    const current = currentR?.avg != null ? Number(currentR.avg) : null;

    // pct_recovered: 100 = back to baseline, 0 = still at day-0 deficit.
    // If isLowerBetter (RHR, wrist temp, RR), invert the math.
    let pctRecovered = 0;
    if (baseline != null && day0 != null && current != null) {
      const peakDeficit = spec.isLowerBetter ? Math.max(0, day0 - baseline) : Math.max(0, baseline - day0);
      if (peakDeficit === 0) {
        pctRecovered = 100;
      } else {
        const currentDeficit = spec.isLowerBetter ? Math.max(0, current - baseline) : Math.max(0, baseline - current);
        pctRecovered = Math.round(Math.max(0, Math.min(100, (1 - currentDeficit / peakDeficit) * 100)));
      }
    } else if (baseline != null && current != null && day0 == null) {
      // No day-0 reading · assume pillar is at baseline if current is too.
      const diff = spec.isLowerBetter ? Math.abs(current - baseline) : Math.abs(baseline - current);
      pctRecovered = diff < 0.5 ? 90 : 50;
    }

    out.push({
      key: spec.key,
      label: spec.label,
      day0Value: day0 != null ? +day0.toFixed(1) : null,
      currentValue: current != null ? +current.toFixed(1) : null,
      baselineValue: baseline != null ? +baseline.toFixed(1) : null,
      pctRecovered,
    });
  }
  return out;
}

async function loadMuscleSignals(
  userUuid: string,
  anchorDate: string,
  today: string,
): Promise<RecoveryPhase['muscleSignals']> {
  // Average form metrics from easy runs AFTER anchor.
  // 2026-06-01 · field names in runs.data: avgCadence, avgPowerW,
  // avgStrideLengthM. Ground contact lives on per-split rows · null
  // at the run level for now.
  const afterRows = await pool.query<{ cadence: number | string | null; stride: number | string | null; power: number | string | null }>(
    `SELECT (data->>'avgCadence')::numeric AS cadence,
            (data->>'avgStrideLengthM')::numeric AS stride,
            (data->>'avgPowerW')::numeric AS power
       FROM runs
      WHERE user_uuid = $1::uuid
        AND NOT (data ? 'mergedIntoId')
        AND (data->>'date')::date > $2::date
        AND (data->>'date')::date <= $3::date
        AND COALESCE(data->>'type', 'easy') IN ('easy', 'recovery', '', 'shakeout')
      ORDER BY (data->>'date')::date DESC LIMIT 3`,
    [userUuid, anchorDate, today],
  ).then((r) => r.rows.map((r) => ({ ...r, gct: null }))).catch(() => []);

  // Baseline form metrics from easy runs BEFORE anchor (30d window).
  const beforeRows = await pool.query<{ cadence: number | string | null; stride: number | string | null; power: number | string | null }>(
    `SELECT (data->>'avgCadence')::numeric AS cadence,
            (data->>'avgStrideLengthM')::numeric AS stride,
            (data->>'avgPowerW')::numeric AS power
       FROM runs
      WHERE user_uuid = $1::uuid
        AND NOT (data ? 'mergedIntoId')
        AND (data->>'date')::date >= ($2::date - interval '30 days')
        AND (data->>'date')::date < $2::date
        AND COALESCE(data->>'type', 'easy') IN ('easy', 'recovery', '', 'shakeout')`,
    [userUuid, anchorDate],
  ).then((r) => r.rows.map((r) => ({ ...r, gct: null }))).catch(() => []);

  if (afterRows.length === 0) return null;

  const avg = (rows: Array<Record<string, number | string | null>>, k: string): number | null => {
    const xs = rows.map((r) => Number(r[k])).filter((v) => Number.isFinite(v) && v > 0);
    if (xs.length === 0) return null;
    return xs.reduce((s, x) => s + x, 0) / xs.length;
  };

  const cadenceAfter = avg(afterRows, 'cadence');
  const cadenceBefore = avg(beforeRows, 'cadence');
  const gctAfter = avg(afterRows, 'gct');
  const gctBefore = avg(beforeRows, 'gct');
  const strideAfter = avg(afterRows, 'stride');
  const strideBefore = avg(beforeRows, 'stride');
  const powerAfter = avg(afterRows, 'power');
  const powerBefore = avg(beforeRows, 'power');

  const cadenceDelta = (cadenceAfter != null && cadenceBefore != null)
    ? +(cadenceAfter - cadenceBefore).toFixed(1) : null;
  const gctDelta = (gctAfter != null && gctBefore != null)
    ? +(gctAfter - gctBefore).toFixed(0) : null;
  const strideDelta = (strideAfter != null && strideBefore != null)
    ? +((strideAfter - strideBefore) / strideBefore * 100).toFixed(1) : null;  // %
  const powerDelta = (powerAfter != null && powerBefore != null)
    ? +(powerAfter - powerBefore).toFixed(0) : null;

  const fatigueSignals: string[] = [];
  if (cadenceDelta != null && cadenceDelta < -3) fatigueSignals.push('cadence dropped');
  if (gctDelta != null && gctDelta > 8) fatigueSignals.push('ground contact stretched');
  if (strideDelta != null && strideDelta < -3) fatigueSignals.push('stride shortened');
  if (powerDelta != null && powerDelta < -10) fatigueSignals.push('power degraded');

  let summary: string;
  if (fatigueSignals.length === 0) {
    summary = `Form metrics on subsequent easy runs are within normal range · muscle recovery on track.`;
  } else if (fatigueSignals.length === 1) {
    summary = `${fatigueSignals[0][0].toUpperCase() + fatigueSignals[0].slice(1)} on easy runs after · classic eccentric load signal · still recovering.`;
  } else {
    summary = `Multiple fatigue signals (${fatigueSignals.join(', ')}) · neuromuscular system still loaded.`;
  }

  return {
    cadenceSpm: cadenceAfter != null ? Math.round(cadenceAfter) : null,
    cadenceDelta,
    gctMs: gctAfter != null ? Math.round(gctAfter) : null,
    gctDelta,
    strideM: strideAfter != null ? +strideAfter.toFixed(2) : null,
    strideDelta,
    runPowerW: powerAfter != null ? Math.round(powerAfter) : null,
    runPowerDelta: powerDelta,
    summary,
  };
}

function computeNextQualityGreenLight(
  anchor: RecoveryPhase['anchor'],
  daysSince: number,
  expDays: number,
  percentRecovered: number,
): RecoveryPhase['nextQualityGreenLight'] {
  // Green-light when ≥ 80% recovered OR daysSince >= expDays.
  let daysOut: number;
  let reason: string;
  if (percentRecovered >= 80 || daysSince >= expDays) {
    daysOut = 0;
    reason = `Body is ${percentRecovered}% recovered · ready for the next quality session.`;
  } else {
    // Estimate based on average recovery rate (1/expDays of the deficit per day).
    const deficit = 100 - percentRecovered;
    const recoveryRate = 100 / expDays;
    daysOut = Math.max(1, Math.ceil(deficit / recoveryRate));
    reason = `${percentRecovered}% recovered · projected green light in ~${daysOut} day${daysOut === 1 ? '' : 's'}.`;
  }
  const greenDate = new Date();
  greenDate.setUTCDate(greenDate.getUTCDate() + daysOut);
  return { date: greenDate.toISOString().slice(0, 10), daysOut, reason };
}

function composeRecoveryMessage(
  anchor: RecoveryPhase['anchor'],
  daysSince: number,
  expDays: number,
  percentRecovered: number,
): string {
  if (daysSince === 0) {
    return `${anchor.label} just landed · day 0 of ~${expDays} expected recovery.`;
  }
  if (percentRecovered >= 85) {
    return `Day ${daysSince} of ${expDays} · ${percentRecovered}% recovered from ${anchor.label}. Body is mostly back.`;
  }
  if (percentRecovered >= 50) {
    return `Day ${daysSince} of ${expDays} · ${percentRecovered}% recovered from ${anchor.label}. Recovery on schedule.`;
  }
  return `Day ${daysSince} of ${expDays} · ${percentRecovered}% recovered from ${anchor.label}. Behind expected curve · check sleep + load.`;
}
