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
   *  call a green-light day without measurement data. Was: always set.
   *  2026-06-03 · this field is now stubbed (computeNextQualityGreenLight
   *  returns an empty envelope) per no-reactive-coach. Frontend ignores
   *  it. Kept on the type so iPhone consumers don't have to migrate. */
  nextQualityGreenLight: {
    date: string;             // YYYY-MM-DD
    daysOut: number;
    reason: string;
  } | null;
  message: string;            // one-line coach-voice summary
  /** 2026-06-03 · static doctrine reference for the expected window.
   *  Renders below the recovery message as info ("Typical window for a
   *  13–15mi long run: 2 days · Pfitzinger"). Runner reads the doctrine
   *  and decides what it means · not weaponized as a countdown. */
  expectedWindowDoctrine: string;
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

/**
 * 2026-06-03 · doctrine reference for the expected recovery window.
 * Renders below the recovery message as static info ("Typical window
 * for a 13–15mi long run: 2 days · Pfitzinger"). NOT a countdown ·
 * runner reads the doctrine and decides what it means for them.
 */
function formatExpectedWindowDoctrine(type: AnchorType, distanceMi: number, expDays: number): string {
  const dayWord = expDays === 1 ? 'day' : 'days';
  if (type === 'race') {
    if (distanceMi >= 24) return `Typical quality-ready window after a marathon: ${expDays} ${dayWord} (Pfitzinger / Daniels). Peak-ready is ~26 days.`;
    if (distanceMi >= 13) return `Typical quality-ready window after a half marathon: ${expDays} ${dayWord} (Pfitzinger).`;
    if (distanceMi >= 6) return `Typical quality-ready window after a 10k: ${expDays} ${dayWord} (Daniels).`;
    return `Typical quality-ready window after a 5k: ${expDays} ${dayWord} (Daniels).`;
  }
  if (type === 'long') {
    const band = distanceMi >= 20 ? '20+mi' : distanceMi >= 16 ? '16–19mi' : '13–15mi';
    return `Typical quality-ready window for a ${band} long run: ${expDays} ${dayWord} (Pfitzinger).`;
  }
  return `Typical quality-ready window after intervals or tempo: ${expDays} ${dayWord} (Daniels).`;
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
  // 2026-06-03 · removed the day-based skip (was: daysSince > expDays + 1
  // → null). The timer made the panel vanish in UTC-rollover at midnight
  // on day 4, regardless of whether the runner's body was actually back.
  // For David's case: Sunday 12mi → expDays=2 → panel disappeared Thu UTC
  // (Wed evening Pacific) even though HRV was still -17 below baseline
  // and SLEEP had a 10-day streak.
  //
  // New rule (per David's design call · Q1d):
  //   · Hide ONLY when percentRecovered >= 80 (body actually back), OR
  //   · A newer hard session lands and becomes the new anchor (handled
  //     by the most-recent-first loop above · the newer session wins).
  // Otherwise the panel stays as long as there's signal to track.

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

  // 2026-06-03 · Q1d skip · hide the panel only when the body is
  // actually back (≥ 80%). Below that, keep rendering — the runner
  // has real signal to look at. Newer hard sessions auto-supersede
  // by virtue of the most-recent-first loop above.
  if (percentRecovered != null && percentRecovered >= 80) return null;

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
    expectedWindowDoctrine: formatExpectedWindowDoctrine(anchor.type, anchor.distanceMi, expDays),
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
    // 2026-06-03 · `current` now looks back up to 2 days · server UTC vs
    // runner-TZ misalignment was making today's readings appear "missing"
    // for the entire panel until the watch wrote them, which dropped all
    // pillars to null → "null%". Now we take the most recent reading
    // within the last 3 days (today + 2 fallback).
    const currentR = await pool.query<{ avg: number | string | null }>(
      `SELECT AVG(value::numeric) AS avg FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = $2
          AND sample_date = (
            SELECT MAX(sample_date) FROM health_samples
             WHERE COALESCE(user_uuid, user_id) = $1
               AND sample_type = $2
               AND sample_date >= ($3::date - interval '2 days')
               AND sample_date <= $3::date
          )`,
      [userUuid, spec.sampleType, today],
    ).then((r) => r.rows[0]).catch(() => ({ avg: null }));

    const baseline = baselineR?.avg != null ? Number(baselineR.avg) : null;
    const day0 = day0R?.avg != null ? Number(day0R.avg) : null;
    const current = currentR?.avg != null ? Number(currentR.avg) : null;

    // 2026-06-03 · three-branch pillar math · fixes the "100% back"
    // contradiction David flagged when SLEEP read 100% recovered while
    // the BODY tile said "6:06h · 10-day streak below target."
    //
    // The old math measured deficit-from-session only. If session day
    // happened to have a good reading (or better than baseline), there
    // was "no deficit to recover from" → 100%. But chronic state can
    // still be in a hole regardless of session timing.
    //
    // New branches per pillar:
    //   1. current is at/better than baseline → fully back (100)
    //   2. current is between baseline and day0 (session worsened it,
    //      not yet fully back) → standard recovery curve
    //   3. current is below baseline (chronic hole) → percent reflects
    //      how deep the chronic hole is, NOT how far from session-day-0.
    //      Eliminates the "100% back" / "10-day streak" contradiction.
    //
    // `significantBand` is the deficit at which the pillar reads 0%.
    // 15% of baseline is a defensible "this is a real hole" threshold
    // for HRV/SLEEP/RHR/HR_RECOVERY.
    let pctRecovered: number | null = null;
    if (baseline != null && day0 != null && current != null) {
      // Signed delta to baseline · positive means worse-than-baseline
      // (accounts for isLowerBetter).
      const baselineToDay0 = spec.isLowerBetter ? day0 - baseline : baseline - day0;
      const baselineToCurrent = spec.isLowerBetter ? current - baseline : baseline - current;
      if (baselineToCurrent <= 0) {
        // Branch 1 · current matches or exceeds baseline · fully back.
        pctRecovered = 100;
      } else if (baselineToDay0 > 0 && baselineToCurrent < baselineToDay0) {
        // Branch 2 · standard recovery curve · current is between
        // session-day deficit and baseline.
        pctRecovered = Math.round(Math.max(0, Math.min(100, 100 * (1 - baselineToCurrent / baselineToDay0))));
      } else {
        // Branch 3 · chronic hole · current is below baseline AND
        // either session day was at/above baseline OR current is even
        // worse than session day. Either way the honest read is "how
        // deep is the chronic deficit", not "how far back from session".
        const significantBand = Math.max(0.5, Math.abs(baseline) * 0.15);
        pctRecovered = Math.round(Math.max(0, Math.min(100, 100 * (1 - baselineToCurrent / significantBand))));
      }
    } else if (baseline != null && current != null && day0 == null) {
      // No day-0 reading · score against baseline directly · same
      // three-branch logic without the curve fallback.
      const baselineToCurrent = spec.isLowerBetter ? current - baseline : baseline - current;
      if (baselineToCurrent <= 0) {
        pctRecovered = 100;
      } else {
        const significantBand = Math.max(0.5, Math.abs(baseline) * 0.15);
        pctRecovered = Math.round(Math.max(0, Math.min(100, 100 * (1 - baselineToCurrent / significantBand))));
      }
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

  // 2026-06-03 · description, not verdict. "Muscle recovery on track"
  // was mildly prescriptive (implied an expected trajectory the runner
  // didn't sign up for). Now states what the form metrics show.
  let summary: string;
  if (fatigueSignals.length === 0) {
    summary = `Form metrics on the easy runs since are within your normal range.`;
  } else if (fatigueSignals.length === 1) {
    summary = `${fatigueSignals[0][0].toUpperCase() + fatigueSignals[0].slice(1)} on the easy runs since · classic eccentric load signal.`;
  } else {
    summary = `Multiple fatigue signals (${fatigueSignals.join(', ')}) · the neuromuscular system is still loaded.`;
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
  // 2026-06-03 · gutted per no-reactive-coach doctrine. The engine no
  // longer says "Earliest quality session · YYYY-MM-DD · resume on feel"
  // because that is prescription (the runner reads the recovery picture
  // and decides). David's QC: "this whole section is nice but doesnt
  // seem like its working right · resume on feel? not sure what this
  // means exactly." The whole "green-light" frame violates the plan-is-
  // the-runner's-plan doctrine.
  //
  // Function kept as a stub returning a near-empty envelope so the
  // RecoveryPhase type doesn't have to change shape (iPhone reads this
  // field too); web frontend now ignores it.
  return {
    date: anchor.date,
    daysOut: 0,
    reason: '',
  };
}

function composeRecoveryMessage(
  anchor: RecoveryPhase['anchor'],
  daysSince: number,
  expDays: number,
  percentRecovered: number | null,
  dataInsufficient: boolean,
): string {
  // 2026-06-03 · plain coach voice describing the recovery picture.
  // No countdown timer ("Day N of M expected" goes wrong once daysSince
  // exceeds expDays), no quality-day prescription. Describes state,
  // runner reads it. Expected-window info renders separately as a
  // doctrine reference line in the frontend (Q4 design call).
  const sincePart = daysSince === 0
    ? `Today's ${anchor.label.replace(/^[A-Z]/, (c) => c.toLowerCase())}`
    : daysSince === 1
      ? `1 day after ${anchor.label}`
      : `${daysSince} days after ${anchor.label}`;
  if (dataInsufficient || percentRecovered == null) {
    return `${sincePart}. Recovery tracking is still waiting on watch syncs.`;
  }
  if (percentRecovered >= 65) {
    return `${sincePart}. ${percentRecovered}% across the recovery pillars · the body is most of the way back.`;
  }
  if (percentRecovered >= 35) {
    return `${sincePart}. ${percentRecovered}% across the recovery pillars · the body is still working through it.`;
  }
  return `${sincePart}. ${percentRecovered}% across the recovery pillars · the body is still in the hole.`;
}
