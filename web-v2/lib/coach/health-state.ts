/**
 * health-state.ts
 * 30-day health trends (sleep, RHR, HRV, weight, cadence, VO2)
 * for the HEALTH surface. Reads from health_samples.
 */
import { pool } from '@/lib/db/pool';

export interface HealthState {
  today: string;
  // 30-day daily series for bar charts
  sleepSeries: { date: string; hours: number }[];   // last 30 nights
  rhrSeries:   { date: string; bpm: number }[];     // last 30 days
  hrvSeries:   { date: string; ms: number }[];      // last 30 nights
  weightSeries: { date: string; lb: number }[];      // last 30 days
  // Summary
  sleep: { avg7n: number | null; avg30n: number | null; deficit7: number };
  rhr:   { current: number | null; baseline: number | null; delta: number | null };
  hrv:   { current: number | null; baseline: number | null; pctAboveBaseline: number | null };
  weight:{ current: number | null; delta30: number | null };
  cadence:{ baseline: number | null };
  vo2:    { current: number | null };
  // Watch-list signal
  watchMode: 'steady' | 'watch-amber' | 'watch-red' | 'green';
  watchItems: { label: string; status: 'amber' | 'red'; note: string }[];
}

export async function loadHealthState(userId: string): Promise<HealthState> {
  const today = new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);

  // Sleep 30 nights
  const sleepRows = (await pool.query(
    `SELECT sample_date, value FROM health_samples
      WHERE user_id = $1 AND sample_type = 'sleep_hours'
        AND sample_date >= ($2::date - interval '30 days')
        AND sample_date <= $2::date
      ORDER BY sample_date ASC`,
    [userId, today]
  )).rows;
  const sleepSeries = sleepRows.map((r: any) => ({
    date: r.sample_date.toISOString ? r.sample_date.toISOString().slice(0, 10) : String(r.sample_date),
    hours: Number(r.value),
  })).filter((d: any) => d.hours > 0);

  const sleepLast7 = sleepSeries.slice(-7).map((d) => d.hours);
  const avg7n = sleepLast7.length ? +(sleepLast7.reduce((s, x) => s + x, 0) / sleepLast7.length).toFixed(1) : null;
  const avg30n = sleepSeries.length ? +(sleepSeries.reduce((s, x) => s + x.hours, 0) / sleepSeries.length).toFixed(1) : null;
  const deficit7 = +sleepLast7.reduce((s, x) => s + Math.max(0, 7.5 - x), 0).toFixed(1);

  // RHR 30 days
  const rhrRows = (await pool.query(
    `SELECT recorded_at::date AS d, AVG(value)::numeric AS v FROM health_samples
      WHERE user_id = $1 AND sample_type = 'resting_hr'
        AND recorded_at >= NOW() - interval '60 days'
      GROUP BY recorded_at::date
      ORDER BY d ASC`,
    [userId]
  )).rows;
  const rhrSeries = rhrRows.map((r: any) => ({
    date: r.d.toISOString().slice(0, 10),
    bpm: Math.round(Number(r.v)),
  })).slice(-30);
  const rhrAll = rhrSeries.map((r) => r.bpm);
  const rhrCurrent = rhrAll.at(-1) ?? null;
  const rhrBaseline = rhrAll.length >= 14
    ? Math.round(rhrAll.slice(0, -7).reduce((s, x) => s + x, 0) / Math.max(1, rhrAll.length - 7))
    : (rhrAll.length ? Math.round(rhrAll.reduce((s, x) => s + x, 0) / rhrAll.length) : null);
  const rhrDelta = (rhrCurrent != null && rhrBaseline != null) ? rhrCurrent - rhrBaseline : null;

  // HRV
  const hrvRows = (await pool.query(
    `SELECT recorded_at::date AS d, AVG(value)::numeric AS v FROM health_samples
      WHERE user_id = $1 AND sample_type = 'hrv'
        AND recorded_at >= NOW() - interval '60 days'
      GROUP BY recorded_at::date
      ORDER BY d ASC`,
    [userId]
  )).rows;
  const hrvSeries = hrvRows.map((r: any) => ({
    date: r.d.toISOString().slice(0, 10),
    ms: Math.round(Number(r.v)),
  })).slice(-30);
  const hrvAll = hrvSeries.map((r) => r.ms);
  const hrvCurrent = hrvAll.at(-1) ?? null;
  const hrvBaseline = hrvAll.length
    ? Math.round(hrvAll.reduce((s, x) => s + x, 0) / hrvAll.length)
    : null;
  const hrvPct = (hrvCurrent != null && hrvBaseline != null && hrvBaseline > 0)
    ? Math.round(((hrvCurrent - hrvBaseline) / hrvBaseline) * 100) : null;

  // Weight (kg → lb)
  const wRows = (await pool.query(
    `SELECT sample_date, value FROM health_samples
      WHERE user_id = $1 AND sample_type = 'body_mass'
        AND sample_date >= ($2::date - interval '30 days')
        AND sample_date <= $2::date
      ORDER BY sample_date ASC`,
    [userId, today]
  )).rows;
  const weightSeries = wRows.map((r: any) => ({
    date: r.sample_date.toISOString ? r.sample_date.toISOString().slice(0, 10) : String(r.sample_date),
    lb: +(Number(r.value) * 2.20462).toFixed(1),
  }));
  const weightCurrent = weightSeries.at(-1)?.lb ?? null;
  const weightFirst   = weightSeries[0]?.lb ?? null;
  const weightDelta30 = (weightCurrent != null && weightFirst != null) ? +(weightCurrent - weightFirst).toFixed(1) : null;

  // Cadence baseline
  const cad = (await pool.query(
    `SELECT AVG(value)::numeric AS avg FROM health_samples
      WHERE user_id = $1 AND sample_type = 'cadence'
        AND sample_date >= ($2::date - interval '60 days')`,
    [userId, today]
  )).rows[0];
  const cadenceBaseline = cad?.avg ? Math.round(Number(cad.avg)) : null;

  // VO2
  const v = (await pool.query(
    `SELECT value FROM health_samples
      WHERE user_id = $1 AND sample_type = 'vo2_max'
      ORDER BY recorded_at DESC LIMIT 1`,
    [userId]
  )).rows[0];
  const vo2Current = v?.value ? +Number(v.value).toFixed(1) : null;

  // Watch-list logic
  const rhrElevated     = rhrDelta != null && rhrDelta >= 5;
  const rhrSustainedRed = rhrDelta != null && rhrDelta >= 8;
  const sleepShort      = deficit7 >= 3;
  const sleepCrash      = deficit7 >= 5;
  let watchMode: HealthState['watchMode'] = 'steady';
  const watchItems: HealthState['watchItems'] = [];
  if (rhrSustainedRed) {
    watchItems.push({ label: 'RHR · SUSTAINED ELEVATED', status: 'red',
      note: `${rhrCurrent} vs ${rhrBaseline} baseline (+${rhrDelta}). Not resolving with rest days.` });
  } else if (rhrElevated) {
    watchItems.push({ label: 'RHR · ELEVATED', status: 'amber',
      note: `${rhrCurrent} vs ${rhrBaseline} baseline (+${rhrDelta}). Common during a volume step-up — watching whether it settles.` });
  }
  if (sleepCrash) {
    watchItems.push({ label: 'SLEEP · DEFICIT GROWING', status: 'red',
      note: `${avg7n}h avg vs 7.5h target. ~${deficit7}h debt and still accumulating.` });
  } else if (sleepShort) {
    watchItems.push({ label: 'SLEEP · 3-WEEK DEFICIT', status: 'amber',
      note: `${avg7n}h vs 7.5h target. ~${deficit7}h cumulative.` });
  }
  if (rhrSustainedRed && sleepCrash) watchMode = 'watch-red';
  else if (watchItems.length) watchMode = 'watch-amber';
  else if (sleepSeries.length && (avg7n ?? 0) >= 7.5 && (rhrDelta ?? 0) <= 0) watchMode = 'green';
  else watchMode = 'steady';

  return {
    today,
    sleepSeries, rhrSeries, hrvSeries, weightSeries,
    sleep: { avg7n, avg30n, deficit7 },
    rhr: { current: rhrCurrent, baseline: rhrBaseline, delta: rhrDelta },
    hrv: { current: hrvCurrent, baseline: hrvBaseline, pctAboveBaseline: hrvPct },
    weight: { current: weightCurrent, delta30: weightDelta30 },
    cadence: { baseline: cadenceBaseline },
    vo2: { current: vo2Current },
    watchMode,
    watchItems,
  };
}
