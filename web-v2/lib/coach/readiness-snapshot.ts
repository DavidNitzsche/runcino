/**
 * lib/coach/readiness-snapshot.ts · daily snapshot writer.
 *
 * Persists today's per-pillar values + score + active streaks into
 * readiness_snapshots so the morning brief can render the 14-day
 * trend chart + mover delta without recomputing the historical score.
 *
 * Called nightly by /api/cron/readiness-snapshot. Idempotent on
 * (user_uuid, snapshot_date) · re-running the same day overwrites.
 *
 * Returns the upserted row id (or null when there's nothing to write
 * · brand-new user with zero signal).
 */

import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { loadCoachState } from '@/lib/coach/state-loader';
import { computeReadiness } from './readiness';
import { loadReadinessHistory } from './readiness-history';

export interface SnapshotResult {
  userUuid: string;
  date: string;
  score: number | null;
  band: string;
  written: boolean;
  reason?: string;
}

export async function writeReadinessSnapshot(
  userUuid: string,
  todayISO?: string,
): Promise<SnapshotResult> {
  const date = todayISO ?? await runnerToday(userUuid);

  const state = await loadCoachState(userUuid).catch(() => null);
  if (!state) {
    return { userUuid, date, score: 70, band: 'ready', written: false, reason: 'no_state' };
  }

  const breakdown = computeReadiness(state);

  // Bail out for runners with zero recoverable data · no point snapshotting
  // a default 70 every night before any HealthKit data lands.
  const allNoData = breakdown.inputs.every(
    (i) => i.observedV === 'no data' || i.observedV === 'building history',
  );
  if (allNoData) {
    return { userUuid, date, score: breakdown.score, band: breakdown.band, written: false, reason: 'no_data' };
  }

  // Per-pillar JSONB · canonical shape (see migration 131 comment).
  const pillars: Record<string, unknown> = {};
  for (const input of breakdown.inputs) {
    pillars[input.key] = {
      weight: input.weight,
      observedV: input.observedV,
      observedSub: input.observedSub,
    };
  }

  // Streaks · compact, brief reads it for surfacing
  const history = await loadReadinessHistory(userUuid).catch(() => null);
  const streaks = history ? buildSimpleStreaks(history, breakdown) : [];

  await pool.query(
    `INSERT INTO readiness_snapshots
       (user_uuid, snapshot_date, score, band, pillars, streaks, computed_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, NOW())
     ON CONFLICT (user_uuid, snapshot_date)
     DO UPDATE SET
       score = EXCLUDED.score,
       band = EXCLUDED.band,
       pillars = EXCLUDED.pillars,
       streaks = EXCLUDED.streaks,
       computed_at = NOW()`,
    [userUuid, date, breakdown.score, breakdown.band, JSON.stringify(pillars), JSON.stringify(streaks)],
  );

  return { userUuid, date, score: breakdown.score, band: breakdown.band, written: true };
}

/**
 * Slim streak detector for the snapshot row. The full brief composer
 * has a richer version; this one just produces { pillar, days, direction,
 * startDate } so the snapshot row carries enough for the next day's
 * brief to detect persistence cheaply.
 */
function buildSimpleStreaks(
  history: Awaited<ReturnType<typeof loadReadinessHistory>>,
  _breakdown: ReturnType<typeof computeReadiness>,
): Array<{ pillar: string; days: number; direction: 'above' | 'below'; startDate: string }> {
  const streaks: Array<{ pillar: string; days: number; direction: 'above' | 'below'; startDate: string }> = [];

  // Sleep streak (consecutive below 7.5h)
  let n = 0;
  for (let i = history.sleep.length - 1; i >= 0; i--) {
    if (history.sleep[i].value < 7.5) n++; else break;
  }
  if (n >= 3) {
    streaks.push({
      pillar: 'sleep', days: n, direction: 'below',
      startDate: history.sleep.at(-n)?.date ?? '',
    });
  }

  // RHR streak (consecutive ≥3 bpm above 60d baseline)
  if (history.rhr.length >= 7) {
    const baseline = history.rhr.slice(0, -7).reduce((s, p) => s + p.value, 0) /
                     Math.max(1, history.rhr.length - 7);
    n = 0;
    for (let i = history.rhr.length - 1; i >= 0; i--) {
      if (history.rhr[i].value - baseline >= 3) n++; else break;
    }
    if (n >= 3) {
      streaks.push({
        pillar: 'rhr', days: n, direction: 'above',
        startDate: history.rhr.at(-n)?.date ?? '',
      });
    }
  }

  // HRV streak (consecutive below 60d avg)
  if (history.hrv.length >= 7) {
    const avg = history.hrv.reduce((s, p) => s + p.value, 0) / history.hrv.length;
    n = 0;
    for (let i = history.hrv.length - 1; i >= 0; i--) {
      if (history.hrv[i].value < avg) n++; else break;
    }
    if (n >= 3) {
      streaks.push({
        pillar: 'hrv', days: n, direction: 'below',
        startDate: history.hrv.at(-n)?.date ?? '',
      });
    }
  }

  return streaks;
}
