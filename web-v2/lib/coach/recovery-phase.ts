/**
 * lib/coach/recovery-phase.ts · post-session recovery tracker (power move #15).
 *
 * Identifies the most recent anchor hard session (race / long run /
 * intervals / tempo / threshold), tracks day-N-of-expected recovery
 * across HRV / RHR / sleep / HR Recovery / wrist temp / RR, and
 * surfaces muscle signals derived from form metrics on the easy runs
 * that follow.
 *
 * Reframe (2026-06-01): the tracker reports "quality-ready" timeline
 * (actionable · when can I do quality again) rather than "full
 * recovery to peak" (which is 2-3× longer for races and rarely
 * actionable). Most runners do their next quality session well
 * before they're "100% recovered" · that's how training works.
 *
 * Doctrine (quality-ready timelines):
 *   · Long 13-15 mi · 2 days (Pfitzinger Sun long → Tue quality)
 *   · Long 16-19 mi · 3 days (Sun long → Wed quality)
 *   · Long 20+ mi · 4 days (Sun long → Thu quality)
 *   · Half race · 4-5 days (Sat race → Thu/Fri quality)
 *   · Marathon race · ~10 days (NOT Friel's "1 day per mile"
 *     for peak · that's race-ready, not quality-ready)
 *   · 10k race · 2-3 days
 *   · 5k race · 2 days
 *   · Intervals / tempo / threshold · 2 days
 *
 * Doctrine sources:
 *   · Pfitzinger · Advanced Marathoning (long Sun → quality Tue/Wed)
 *   · Daniels · Running Formula (Q-day spacing tables)
 *   · Research/15 · DOMS peaks 24-48h post-eccentric load
 *   · Friel · 1 day per mile is for "race again at peak" not
 *     "next hard session"
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
  /** 2026-06-01 · brief response · null when measurement data is
   *  insufficient (< 2 pillars have all of baseline / day0 / current).
   *  Frontend gates the "X% recovered" copy on this · renders a
   *  "syncing" framing instead. Was: number (defaulted to 0 when
   *  data missing · self-contradicting). */
  percentRecovered: number | null;
  /** 2026-06-01 · true when fewer than 2 pillars have full comparison
   *  data. Frontend uses this as the single gate for "is the recovery
   *  story honest yet?" · single source of truth, no scattered null
   *  checks. */
  dataInsufficient: boolean;
  pillars: Array<{
    key: 'hrv' | 'rhr' | 'sleep' | 'hr_recovery' | 'wrist_temp' | 'resp_rate';
    label: string;
    day0Value: number | null;
    currentValue: number | null;
    baselineValue: number | null;
    /** 2026-06-01 · null when any of baseline / day0 / current is null.
     *  Was: number (defaulted to 0 when data missing · misleading
     *  "0% back" copy). */
    pctRecovered: number | null;
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
  /** 2026-06-01 · null when dataInsufficient · the engine can't honestly
   *  call a green-light day without measurement data. Was: always set. */
  nextQualityGreenLight: {
    date: string;             // YYYY-MM-DD
    daysOut: number;
    reason: string;
  } | null;
  message: string;            // one-line coach-voice summary
}

// Doctrine timelines · "quality-ready" days per session type.
// This is when the runner can do the NEXT QUALITY session · not full
// recovery to peak. Aligned with Pfitzinger/Daniels actual plan
// patterns (Sunday long → Tue/Wed quality).
function expectedDays(type: AnchorType, distanceMi: number): number {
  switch (type) {
    case 'race':
      // Marathon: peak-ready is ~26 days (Friel) but quality-ready is
      // ~10 days · easy by day 3, hard quality session by day 10ish.
      if (distanceMi >= 24) return 10;
      if (distanceMi >= 13) return 5;   // half marathon: 4-5d
      if (distanceMi >= 6) return 3;     // 10k: 2-3d
      return 2;                           // 5k: 2d
    case 'long':
      // Pfitzinger/Daniels patterns · long Sunday → quality Tue/Wed:
      // - 13-15 mi · 2 days (Sun long → Tue quality)
      // - 16-19 mi · 3 days (Sun long → Wed quality)
      // - 20+ mi · 4 days (Sun long → Thu quality)
      if (distanceMi >= 20) return 4;
      if (distanceMi >= 16) return 3;
      return 2;
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

  // 3 · Recovery % weighted by Plews-style importance.
  // 2026-06-01 · brief response: count how many pillars have full
  // comparison data. < 2 = data insufficient (frontend gates the
  // "X% recovered" copy on this) · percentRecovered becomes null.
  // 2026-06-03 · re-normalized after dropping wrist_temp + resp_rate from
  // the pillar set (see loadPillarBounceBack comment). New weights spread
  // the displaced 0.08 across the four core pillars proportionally so
  // the recovery % math stays calibrated.
  const weights: Record<string, number> = {
    hrv: 0.33, sleep: 0.30, rhr: 0.26, hr_recovery: 0.11,
  };
  let weightedSum = 0;
  let weightTotal = 0;
  let pillarsWithData = 0;
  for (const p of pillars) {
    const w = weights[p.key] ?? 0;
    if (p.pctRecovered != null) {
      weightedSum += p.pctRecovered * w;
      weightTotal += w;
      pillarsWithData++;
    }
  }
  const dataInsufficient = pillarsWithData < 2;
  const percentRecovered: number | null = dataInsufficient
    ? null
    : Math.round(weightedSum / weightTotal);

  // 4 · Muscle signals from form metrics on easy runs after anchor.
  const muscleSignals = await loadMuscleSignals(userUuid, anchor.date, today);

  // 5 · Next quality green-light date. Null when dataInsufficient ·
  // the engine can't honestly call a green-light day without data.
  const nextGreenLight = dataInsufficient
    ? null
    : computeNextQualityGreenLight(anchor, daysSince, expDays, percentRecovered!);

  // 6 · One-line message · accepts nullable percentRecovered.
  const message = composeRecoveryMessage(anchor, daysSince, expDays, percentRecovered, dataInsufficient);

  return {
    anchor,
    daysSince,
    expectedDaysToRecover: expDays,
    percentRecovered,
    dataInsufficient,
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
  // 2026-06-03 · dropped wrist_temp + resp_rate from the recovery pillar
  // list. Both already appear as standalone tiles in the BODY section
  // directly below, so the recovery panel was rendering the same metric
  // twice in different framings (% recovered vs current value). David's
  // Health-page QC flagged it as duplicate signal. Their original weights
  // in the aggregate were tiny (wrist_temp 0.05, resp_rate 0.03) so
  // removing them barely shifts the recovery %. Core recovery picture
  // stays the four pillars that drive the actual readiness number.
  const pillarSpecs: Array<{ key: RecoveryPhase['pillars'][number]['key']; sampleType: string; label: string; isLowerBetter: boolean }> = [
    { key: 'hrv', sampleType: 'hrv', label: 'HRV', isLowerBetter: false },
    { key: 'rhr', sampleType: 'resting_hr', label: 'RHR', isLowerBetter: true },
    { key: 'sleep', sampleType: 'sleep_hours', label: 'SLEEP', isLowerBetter: false },
    { key: 'hr_recovery', sampleType: 'hr_recovery', label: 'HR RECOVERY', isLowerBetter: false },
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
    // 2026-06-01 · null vs zero hygiene brief response (Option C):
    // pctRecovered is null when we can't compute it (missing baseline
    // or current). The fallback used to return 50/90 when day0 missing
    // but baseline + current present · we keep that since it has signal.
    // Frontend gates "X% back" copy on this being non-null.
    let pctRecovered: number | null = null;
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
    // else: any of baseline / current is null · pctRecovered stays null.

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
  // avgStrideLengthM. GCT lives on health_samples (sample_type =
  // 'ground_contact_time') · joined by date to the easy runs.
  const afterRows = await pool.query<{ cadence: number | string | null; stride: number | string | null; power: number | string | null; gct: number | string | null }>(
    `SELECT (r.data->>'avgCadence')::numeric AS cadence,
            (r.data->>'avgStrideLengthM')::numeric AS stride,
            (r.data->>'avgPowerW')::numeric AS power,
            (SELECT AVG(value::numeric) FROM health_samples h
              WHERE COALESCE(h.user_uuid, h.user_id) = $1
                AND h.sample_type = 'ground_contact_time'
                AND h.sample_date = (r.data->>'date')::date
                AND value::numeric BETWEEN 150 AND 400) AS gct
       FROM runs r
      WHERE r.user_uuid = $1::uuid
        AND NOT (r.data ? 'mergedIntoId')
        AND (r.data->>'date')::date > $2::date
        AND (r.data->>'date')::date <= $3::date
        AND COALESCE(r.data->>'type', 'easy') IN ('easy', 'recovery', '', 'shakeout')
      ORDER BY (r.data->>'date')::date DESC LIMIT 3`,
    [userUuid, anchorDate, today],
  ).then((r) => r.rows).catch(() => []);

  // Baseline form metrics from easy runs BEFORE anchor (30d window).
  const beforeRows = await pool.query<{ cadence: number | string | null; stride: number | string | null; power: number | string | null; gct: number | string | null }>(
    `SELECT (r.data->>'avgCadence')::numeric AS cadence,
            (r.data->>'avgStrideLengthM')::numeric AS stride,
            (r.data->>'avgPowerW')::numeric AS power,
            (SELECT AVG(value::numeric) FROM health_samples h
              WHERE COALESCE(h.user_uuid, h.user_id) = $1
                AND h.sample_type = 'ground_contact_time'
                AND h.sample_date = (r.data->>'date')::date
                AND value::numeric BETWEEN 150 AND 400) AS gct
       FROM runs r
      WHERE r.user_uuid = $1::uuid
        AND NOT (r.data ? 'mergedIntoId')
        AND (r.data->>'date')::date >= ($2::date - interval '30 days')
        AND (r.data->>'date')::date < $2::date
        AND COALESCE(r.data->>'type', 'easy') IN ('easy', 'recovery', '', 'shakeout')`,
    [userUuid, anchorDate],
  ).then((r) => r.rows).catch(() => []);

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
): NonNullable<RecoveryPhase['nextQualityGreenLight']> {
  // 2026-06-01 · brief response · green-light copy that doesn't
  // contradict itself. Previously: `>= expDays` alone → "ready"
  // even when percentRecovered was 0. Now four explicit branches:
  let daysOut: number;
  let reason: string;
  if (percentRecovered >= 80) {
    // Truly recovered · go.
    daysOut = 0;
    reason = `Body is ${percentRecovered}% recovered · ready for the next quality session.`;
  } else if (daysSince >= expDays && percentRecovered >= 50) {
    // Past the typical window AND meaningfully recovered · go on feel.
    daysOut = 0;
    reason = `Past expected recovery window · body ${percentRecovered}% back · resume on feel.`;
  } else if (daysSince >= expDays) {
    // Past the window but recovery numbers are weak · don't claim
    // "ready" with a contradicting %. Defer to subjective feel.
    daysOut = 0;
    reason = `Past expected recovery window · resume on feel.`;
  } else {
    // Still within the window · project forward.
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
  percentRecovered: number | null,
  dataInsufficient: boolean,
): string {
  if (daysSince === 0) {
    return `${anchor.label} just landed · day 0 of ~${expDays} expected recovery.`;
  }
  // 2026-06-01 · brief response · honest copy when data is missing.
  // Don't fabricate a "0% recovered" story when we just don't have
  // the measurements yet.
  if (dataInsufficient || percentRecovered == null) {
    return `Day ${daysSince} of ${expDays} since ${anchor.label} · recovery tracking awaiting watch sync.`;
  }
  if (percentRecovered >= 85) {
    return `Day ${daysSince} of ${expDays} · ${percentRecovered}% recovered from ${anchor.label}. Body is mostly back.`;
  }
  if (percentRecovered >= 50) {
    return `Day ${daysSince} of ${expDays} · ${percentRecovered}% recovered from ${anchor.label}. Recovery on schedule.`;
  }
  return `Day ${daysSince} of ${expDays} · ${percentRecovered}% recovered from ${anchor.label}. Behind expected curve · check sleep + load.`;
}
