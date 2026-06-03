/**
 * lib/coach/block-comparison.ts · this build vs reference build.
 *
 * Compares recovery + load metrics across the runner's current 4-8
 * week training block against a reference block (peak-fitness build
 * or last race build).
 *
 * Generic mechanism: walks the runner's history, picks the most
 * recent A-race finish OR the highest-VDOT 4-week window as the
 * reference. Falls back to "first 4-week window of available data"
 * for runners without a race history.
 */

import { pool } from '@/lib/db/pool';

export interface BlockComparison {
  currentBlock: {
    label: string;        // "Current build (last 4 weeks)"
    weeks: number;
    avgSleepH: number | null;
    avgHrvMs: number | null;
    avgRhrBpm: number | null;
  };
  referenceBlock: {
    label: string;        // "vs Berlin build" or "vs your peak fitness window"
    weeks: number;
    avgSleepH: number | null;
    avgHrvMs: number | null;
    avgRhrBpm: number | null;
  };
  deltas: {
    sleepH: number | null;
    hrvMs: number | null;
    rhrBpm: number | null;
  };
  message: string;
}

async function loadWindowAverages(userUuid: string, startDate: string, endDate: string): Promise<{
  sleep: number | null; hrv: number | null; rhr: number | null;
}> {
  const [sleep, hrv, rhr] = await Promise.all([
    pool.query<{ avg: number | string | null }>(
      `SELECT AVG(value::numeric) AS avg FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'sleep_hours'
          AND sample_date >= $2::date AND sample_date <= $3::date`,
      [userUuid, startDate, endDate],
    ).then((r) => r.rows[0]?.avg ?? null).catch(() => null),
    pool.query<{ avg: number | string | null }>(
      `SELECT AVG(value::numeric) AS avg FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'hrv'
          AND recorded_at::date >= $2::date AND recorded_at::date <= $3::date`,
      [userUuid, startDate, endDate],
    ).then((r) => r.rows[0]?.avg ?? null).catch(() => null),
    pool.query<{ avg: number | string | null }>(
      `SELECT AVG(value::numeric) AS avg FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'resting_hr'
          AND recorded_at::date >= $2::date AND recorded_at::date <= $3::date`,
      [userUuid, startDate, endDate],
    ).then((r) => r.rows[0]?.avg ?? null).catch(() => null),
  ]);
  return {
    sleep: sleep != null ? Number(sleep) : null,
    hrv: hrv != null ? Number(hrv) : null,
    rhr: rhr != null ? Number(rhr) : null,
  };
}

export async function computeBlockComparison(userUuid: string): Promise<BlockComparison | null> {
  const today = new Date().toISOString().slice(0, 10);

  // Current block: last 28 days.
  const currentStart = new Date();
  currentStart.setUTCDate(currentStart.getUTCDate() - 28);
  const currentStartStr = currentStart.toISOString().slice(0, 10);
  const current = await loadWindowAverages(userUuid, currentStartStr, today);

  // Reference: most-recent A-race finish · or peak-VDOT window.
  const raceRow = (await pool.query<{ date: string; name: string | null }>(
    `SELECT (meta->>'date')::text AS date, meta->>'name' AS name
       FROM races
      WHERE user_uuid = $1
        AND meta->>'priority' = 'A'
        AND (meta->>'date')::date < CURRENT_DATE
        AND (meta->>'date')::date >= CURRENT_DATE - interval '12 months'
      ORDER BY (meta->>'date')::date DESC LIMIT 1`,
    [userUuid],
  ).catch(() => ({ rows: [] }))).rows[0];

  let refLabel: string;
  let refStartStr: string;
  let refEndStr: string;

  if (raceRow?.date) {
    // Reference = 28 days BEFORE the race (the taper + build that produced
    // the race result).
    const raceDate = new Date(raceRow.date + 'T12:00:00Z');
    const refEnd = new Date(raceDate);
    refEnd.setUTCDate(refEnd.getUTCDate() - 1);
    const refStart = new Date(refEnd);
    refStart.setUTCDate(refStart.getUTCDate() - 28);
    refStartStr = refStart.toISOString().slice(0, 10);
    refEndStr = refEnd.toISOString().slice(0, 10);
    // 2026-06-03 · dropped the leading "vs " from the label. The Health
    // page renderer prepends "VS " in display ("VS {label}") so the old
    // value produced "VS VS LA MARATHON BUILD". Now the label carries
    // the build name only · "VS LA MARATHON BUILD" reads cleanly.
    refLabel = `${(raceRow.name ?? 'last A-race').split(' ').slice(0, 3).join(' ')} build`;
  } else {
    // Fallback: 60-90 days ago.
    const refStart = new Date();
    refStart.setUTCDate(refStart.getUTCDate() - 90);
    const refEnd = new Date();
    refEnd.setUTCDate(refEnd.getUTCDate() - 62);
    refStartStr = refStart.toISOString().slice(0, 10);
    refEndStr = refEnd.toISOString().slice(0, 10);
    // Same dedupe as above · renderer adds "VS ".
    refLabel = '~60-90 days ago';
  }

  const reference = await loadWindowAverages(userUuid, refStartStr, refEndStr);

  // Skip if both windows have no data.
  if (current.sleep == null && current.hrv == null && current.rhr == null) return null;
  if (reference.sleep == null && reference.hrv == null && reference.rhr == null) return null;

  const sleepH = current.sleep != null && reference.sleep != null
    ? +(current.sleep - reference.sleep).toFixed(2) : null;
  const hrvMs = current.hrv != null && reference.hrv != null
    ? Math.round(current.hrv - reference.hrv) : null;
  const rhrBpm = current.rhr != null && reference.rhr != null
    ? Math.round(current.rhr - reference.rhr) : null;

  // Compose the message.
  const movers: string[] = [];
  if (sleepH != null && Math.abs(sleepH) >= 0.3) {
    movers.push(`sleep ${sleepH > 0 ? '+' : ''}${sleepH.toFixed(1)}h`);
  }
  if (hrvMs != null && Math.abs(hrvMs) >= 3) {
    movers.push(`HRV ${hrvMs > 0 ? '+' : ''}${hrvMs}ms`);
  }
  if (rhrBpm != null && Math.abs(rhrBpm) >= 2) {
    movers.push(`RHR ${rhrBpm > 0 ? '+' : ''}${rhrBpm}bpm`);
  }
  const message = movers.length === 0
    ? `${refLabel.replace('vs ', '')} · recovery metrics tracking similar to the reference window.`
    : `${refLabel} · ${movers.join(' · ')}.`;

  return {
    currentBlock: {
      label: 'Current build (last 4 weeks)',
      weeks: 4,
      avgSleepH: current.sleep != null ? +current.sleep.toFixed(1) : null,
      avgHrvMs: current.hrv != null ? Math.round(current.hrv) : null,
      avgRhrBpm: current.rhr != null ? Math.round(current.rhr) : null,
    },
    referenceBlock: {
      label: refLabel,
      weeks: 4,
      avgSleepH: reference.sleep != null ? +reference.sleep.toFixed(1) : null,
      avgHrvMs: reference.hrv != null ? Math.round(reference.hrv) : null,
      avgRhrBpm: reference.rhr != null ? Math.round(reference.rhr) : null,
    },
    deltas: { sleepH, hrvMs, rhrBpm },
    message,
  };
}
