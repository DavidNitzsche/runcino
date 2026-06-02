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
  // P2 #11 (2026-05-30): VO2 max trend. HealthKit only emits 1-2 readings
  // per week so we widen the window to 6 months for a meaningful chart.
  vo2Series:    { date: string; v: number }[];       // up to 6 months
  // 2026-06-01 · Health page Quick Wins · 30d series for new tiles.
  wristTempSeries:        { date: string; tempC: number }[];
  respiratoryRateSeries:  { date: string; bpm: number }[];
  spo2Series:             { date: string; pct: number }[];
  bodyFatSeries:          { date: string; pct: number }[];
  leanMassSeries:         { date: string; kg: number }[];
  // Summary
  sleep: { avg7n: number | null; avg30n: number | null; deficit7: number };
  rhr:   { current: number | null; baseline: number | null; delta: number | null };
  hrv:   { current: number | null; baseline: number | null; pctAboveBaseline: number | null };
  weight:{ current: number | null; delta30: number | null };
  cadence:{ baseline: number | null };
  vo2:    { current: number | null };
  // 2026-06-01 · Quick Win summaries
  wristTemp:       { current: number | null; baseline: number | null; deltaC: number | null };
  respiratoryRate: { current: number | null; baseline: number | null; delta: number | null };
  spo2:            { current: number | null; baseline: number | null };
  bodyFat:         { current: number | null; delta30: number | null };
  leanMass:        { current: number | null; delta30: number | null };
  maxHr:           { current: number | null };
  // 2026-06-01 · sleep consistency · bedtime variability over last 7 nights
  sleepConsistency: { variabilityMin: number | null; avgBedtimeISO: string | null };
  // Watch-list signal
  watchMode: 'steady' | 'watch-amber' | 'watch-red' | 'green';
  watchItems: { label: string; status: 'amber' | 'red'; note: string }[];
}

export async function loadHealthState(userId: string): Promise<HealthState> {
  const today = new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);

  // 2026-05-27: was 6 sequential awaits = 6× round-trip latency. Now all
  // six health_samples queries fire in parallel via Promise.all — they
  // touch the same table with different filters, so the pg pool serves
  // them concurrently. Roughly 5/6 of the latency falls away.
  //
  // We don't fold into one UNION query because each has different
  // aggregations (raw values vs date-grouped AVG) and the data shapes
  // diverge enough that the post-processing would get awkward.
  const [
    sleepRows,
    rhrRows,
    hrvRows,
    wRows,
    cadRow,
    vo2Row,
    // 2026-06-01 · Quick Win queries · order matches Promise.all below.
    wristTempRows,
    respRateRows,
    spo2Rows,
    bodyFatRows,
    leanMassRows,
    maxHrRow,
    sleepBedtimeRows,
    vo2SeriesRows,
  ] = await Promise.all([
    pool.query(
      `SELECT sample_date, value FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'sleep_hours'
          AND sample_date >= ($2::date - interval '30 days')
          AND sample_date <= $2::date
        ORDER BY sample_date ASC`,
      [userId, today]
    ).then((r) => r.rows),
    pool.query(
      `SELECT recorded_at::date AS d, AVG(value)::numeric AS v FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'resting_hr'
          AND recorded_at >= NOW() - interval '60 days'
        GROUP BY recorded_at::date
        ORDER BY d ASC`,
      [userId]
    ).then((r) => r.rows),
    pool.query(
      `SELECT recorded_at::date AS d, AVG(value)::numeric AS v FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'hrv'
          AND recorded_at >= NOW() - interval '60 days'
        GROUP BY recorded_at::date
        ORDER BY d ASC`,
      [userId]
    ).then((r) => r.rows),
    pool.query(
      `SELECT sample_date, value FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'body_mass'
          AND sample_date >= ($2::date - interval '30 days')
          AND sample_date <= $2::date
        ORDER BY sample_date ASC`,
      [userId, today]
    ).then((r) => r.rows),
    // 2026-06-01 · cadence baseline now prefers `runs.avgCadence`
    // (actual running cadence) over `health_samples.cadence` (daily
    // average · includes walking · drags baseline down by ~6-10 spm).
    // Falls back to health_samples when runs has no avgCadence yet
    // (manual entry, Strava-only ingest, brand-new runner).
    pool.query(
      `WITH run_cadence AS (
         SELECT AVG((data->>'avgCadence')::numeric)::numeric AS avg
           FROM runs
          WHERE user_uuid = $1::uuid
            AND NOT (data ? 'mergedIntoId')
            AND data->>'avgCadence' IS NOT NULL
            AND (data->>'avgCadence')::numeric BETWEEN 130 AND 220
            AND (data->>'date')::date >= ($2::date - interval '60 days')
       ),
       hk_cadence AS (
         SELECT AVG(value)::numeric AS avg FROM health_samples
          WHERE COALESCE(user_uuid, user_id) = $1
            AND sample_type = 'cadence'
            AND sample_date >= ($2::date - interval '60 days')
       )
       SELECT COALESCE(rc.avg, hc.avg) AS avg
         FROM run_cadence rc, hk_cadence hc`,
      [userId, today]
    ).then((r) => r.rows[0]),
    pool.query(
      `SELECT value FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'vo2_max'
        ORDER BY recorded_at DESC LIMIT 1`,
      [userId]
    ).then((r) => r.rows[0]),
    // Series for the trend chart. 6-month window — HealthKit ships VO2 max
    // sparsely (1-2 readings/wk) so 30 days is too few points for a chart.
    // 2026-06-01 · Quick Win queries · all in parallel for latency.
    // Wrist temp · Apple Watch nightly skin temp. 30d series.
    pool.query(
      `SELECT sample_date::date AS d, value FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'wrist_temp'
          AND sample_date >= ($2::date - interval '30 days')
        ORDER BY sample_date ASC`,
      [userId, today]
    ).then((r) => r.rows),
    // Respiratory rate · nightly average from HK.
    pool.query(
      `SELECT sample_date::date AS d, value FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'respiratory_rate'
          AND sample_date >= ($2::date - interval '30 days')
        ORDER BY sample_date ASC`,
      [userId, today]
    ).then((r) => r.rows),
    // SpO2 · nightly avg.
    pool.query(
      `SELECT sample_date::date AS d, value FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'spo2'
          AND sample_date >= ($2::date - interval '30 days')
        ORDER BY sample_date ASC`,
      [userId, today]
    ).then((r) => r.rows),
    // Body fat % · weekly cadence.
    pool.query(
      `SELECT sample_date::date AS d, value FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'body_fat_pct'
          AND sample_date >= ($2::date - interval '90 days')
        ORDER BY sample_date ASC`,
      [userId, today]
    ).then((r) => r.rows),
    // Lean mass · weekly cadence.
    pool.query(
      `SELECT sample_date::date AS d, value FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'lean_mass'
          AND sample_date >= ($2::date - interval '90 days')
        ORDER BY sample_date ASC`,
      [userId, today]
    ).then((r) => r.rows),
    // Max HR · TRUE max over the last 30d (informs zone math + HRR).
    // Picking single-most-recent gave the last activity's max which
    // could be a 58bpm walk. MAX over a window is the real ceiling.
    pool.query<{ value: number | string }>(
      `SELECT MAX(value::numeric) AS value
         FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'max_hr'
          AND sample_date >= ($2::date - interval '30 days')`,
      [userId, today]
    ).then((r) => r.rows[0]),
    // Sleep bedtime times · for consistency / variability calc.
    // sleep_hours sample_date IS the night-of date · use recorded_at
    // (the timestamp the watch wrote it) as proxy for bedtime.
    pool.query(
      `SELECT sample_date::date AS d, recorded_at
         FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'sleep_hours'
          AND sample_date >= ($2::date - interval '14 days')
        ORDER BY sample_date ASC`,
      [userId, today]
    ).then((r) => r.rows),
    pool.query(
      `SELECT sample_date::date AS d, value FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'vo2_max'
          AND sample_date >= ($2::date - interval '180 days')
        ORDER BY sample_date ASC`,
      [userId, today]
    ).then((r) => r.rows),
  ]);

  // Sleep
  const sleepSeries = sleepRows.map((r: any) => ({
    date: r.sample_date.toISOString ? r.sample_date.toISOString().slice(0, 10) : String(r.sample_date),
    hours: Number(r.value),
  })).filter((d: any) => d.hours > 0);
  const sleepLast7 = sleepSeries.slice(-7).map((d) => d.hours);
  const avg7n = sleepLast7.length ? +(sleepLast7.reduce((s, x) => s + x, 0) / sleepLast7.length).toFixed(1) : null;
  const avg30n = sleepSeries.length ? +(sleepSeries.reduce((s, x) => s + x.hours, 0) / sleepSeries.length).toFixed(1) : null;
  const deficit7 = +sleepLast7.reduce((s, x) => s + Math.max(0, 7.5 - x), 0).toFixed(1);

  // RHR
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

  // Weight
  const weightSeries = wRows.map((r: any) => ({
    date: r.sample_date.toISOString ? r.sample_date.toISOString().slice(0, 10) : String(r.sample_date),
    lb: +(Number(r.value) * 2.20462).toFixed(1),
  }));
  const weightCurrent = weightSeries.at(-1)?.lb ?? null;
  const weightFirst   = weightSeries[0]?.lb ?? null;
  const weightDelta30 = (weightCurrent != null && weightFirst != null) ? +(weightCurrent - weightFirst).toFixed(1) : null;

  // Cadence baseline
  const cadenceBaseline = cadRow?.avg ? Math.round(Number(cadRow.avg)) : null;

  // VO2 — current reading + 6-month series for the trend chart.
  const vo2Current = vo2Row?.value ? +Number(vo2Row.value).toFixed(1) : null;
  const vo2Series = (vo2SeriesRows ?? []).map((r: { d: Date | string; value: number | string }) => ({
    date: r.d instanceof Date ? r.d.toISOString().slice(0, 10) : String(r.d),
    v: +Number(r.value).toFixed(1),
  })).filter((d) => d.v > 0);

  // 2026-06-01 · Quick Win signals from health_samples.
  const mapSeries = <T>(rows: any[], key: string, transform: (v: number) => T): { date: string; [k: string]: any }[] =>
    rows.map((r: any) => ({
      date: r.d instanceof Date ? r.d.toISOString().slice(0, 10) : String(r.d),
      [key]: transform(Number(r.value)),
    })).filter((d: any) => Number.isFinite(d[key]));

  const wristTempSeries = mapSeries(wristTempRows, 'tempC', (v) => +v.toFixed(2));
  const respiratoryRateSeries = mapSeries(respRateRows, 'bpm', (v) => +v.toFixed(1));
  const spo2Series = mapSeries(spo2Rows, 'pct', (v) => Math.round(v));
  const bodyFatSeries = mapSeries(bodyFatRows, 'pct', (v) => +v.toFixed(1));
  const leanMassSeries = mapSeries(leanMassRows, 'kg', (v) => +v.toFixed(1));

  // Wrist temp · current vs 30d baseline. Apple Watch outputs delta-from-
  // user-baseline · we store the absolute value. Compute our own delta.
  const wristTempVals = wristTempSeries.map((d) => d.tempC as number);
  const wristTempCurrent = wristTempVals.at(-1) ?? null;
  const wristTempBaseline = wristTempVals.length >= 7
    ? +(wristTempVals.slice(0, -3).reduce((s, x) => s + x, 0) / Math.max(1, wristTempVals.length - 3)).toFixed(2)
    : null;
  const wristTempDeltaC = (wristTempCurrent != null && wristTempBaseline != null)
    ? +(wristTempCurrent - wristTempBaseline).toFixed(2) : null;

  // Respiratory rate · 7-night avg vs 30d baseline.
  const rrVals = respiratoryRateSeries.map((d) => d.bpm as number);
  const rrCurrent = rrVals.length >= 7
    ? +(rrVals.slice(-7).reduce((s, x) => s + x, 0) / 7).toFixed(1)
    : (rrVals.at(-1) ?? null);
  const rrBaseline = rrVals.length >= 14
    ? +(rrVals.slice(0, -7).reduce((s, x) => s + x, 0) / Math.max(1, rrVals.length - 7)).toFixed(1)
    : null;
  const rrDelta = (rrCurrent != null && rrBaseline != null)
    ? +(rrCurrent - rrBaseline).toFixed(1) : null;

  // SpO2 · most recent + 30d baseline.
  const spo2Vals = spo2Series.map((d) => d.pct as number);
  const spo2Current = spo2Vals.at(-1) ?? null;
  const spo2Baseline = spo2Vals.length
    ? Math.round(spo2Vals.reduce((s, x) => s + x, 0) / spo2Vals.length)
    : null;

  // Body fat % · current + 30d delta.
  const bfVals = bodyFatSeries.map((d) => d.pct as number);
  const bfCurrent = bfVals.at(-1) ?? null;
  const bfFirst = bfVals[0] ?? null;
  const bfDelta30 = (bfCurrent != null && bfFirst != null) ? +(bfCurrent - bfFirst).toFixed(1) : null;

  // Lean mass · current + 30d delta. Stored as kg (HK native).
  const lmVals = leanMassSeries.map((d) => d.kg as number);
  const lmCurrent = lmVals.at(-1) ?? null;
  const lmFirst = lmVals[0] ?? null;
  const lmDelta30 = (lmCurrent != null && lmFirst != null) ? +(lmCurrent - lmFirst).toFixed(1) : null;

  // Max HR · most recent.
  const maxHrCurrent = maxHrRow?.value != null ? Math.round(Number(maxHrRow.value)) : null;

  // Sleep consistency · bedtime variability. Use recorded_at as bedtime
  // proxy (when watch wrote the sleep sample) · compute stddev of the
  // local-time minute-of-day across the last 7 nights.
  const bedtimeMinutes: number[] = (sleepBedtimeRows as any[]).map((r) => {
    if (!r.recorded_at) return null;
    const ts = r.recorded_at instanceof Date ? r.recorded_at : new Date(r.recorded_at);
    if (!Number.isFinite(ts.getTime())) return null;
    // Use UTC hours/minutes · all rows share the same offset adjustment.
    return ts.getUTCHours() * 60 + ts.getUTCMinutes();
  }).filter((m: number | null): m is number => m != null).slice(-7);
  let sleepConsistencyVarMin: number | null = null;
  let sleepConsistencyAvgBedtimeISO: string | null = null;
  if (bedtimeMinutes.length >= 4) {
    const mean = bedtimeMinutes.reduce((s, x) => s + x, 0) / bedtimeMinutes.length;
    const variance = bedtimeMinutes.reduce((s, x) => s + (x - mean) ** 2, 0) / bedtimeMinutes.length;
    const sd = Math.round(Math.sqrt(variance));
    // Sanity check: if ALL recorded_at land on the same minute (the
    // watch wrote sample_date midnight for every row), bedtime can't
    // be derived from this field. Surface null rather than fake "±0".
    const allSameMinute = sd === 0;
    if (!allSameMinute) {
      sleepConsistencyVarMin = sd;
      const meanH = Math.floor(mean / 60), meanM = Math.round(mean % 60);
      sleepConsistencyAvgBedtimeISO = `${String(meanH).padStart(2, '0')}:${String(meanM).padStart(2, '0')}`;
    }
  }

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
      note: `${rhrCurrent} vs ${rhrBaseline} baseline (+${rhrDelta}). Common during a volume step-up · watching whether it settles.` });
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
    sleepSeries, rhrSeries, hrvSeries, weightSeries, vo2Series,
    // 2026-06-01 · Quick Win series for tiles.
    wristTempSeries: wristTempSeries as { date: string; tempC: number }[],
    respiratoryRateSeries: respiratoryRateSeries as { date: string; bpm: number }[],
    spo2Series: spo2Series as { date: string; pct: number }[],
    bodyFatSeries: bodyFatSeries as { date: string; pct: number }[],
    leanMassSeries: leanMassSeries as { date: string; kg: number }[],
    sleep: { avg7n, avg30n, deficit7 },
    rhr: { current: rhrCurrent, baseline: rhrBaseline, delta: rhrDelta },
    hrv: { current: hrvCurrent, baseline: hrvBaseline, pctAboveBaseline: hrvPct },
    weight: { current: weightCurrent, delta30: weightDelta30 },
    cadence: { baseline: cadenceBaseline },
    vo2: { current: vo2Current },
    wristTemp:       { current: wristTempCurrent, baseline: wristTempBaseline, deltaC: wristTempDeltaC },
    respiratoryRate: { current: rrCurrent, baseline: rrBaseline, delta: rrDelta },
    spo2:            { current: spo2Current, baseline: spo2Baseline },
    bodyFat:         { current: bfCurrent, delta30: bfDelta30 },
    leanMass:        { current: lmCurrent, delta30: lmDelta30 },
    maxHr:           { current: maxHrCurrent },
    sleepConsistency: {
      variabilityMin: sleepConsistencyVarMin,
      avgBedtimeISO: sleepConsistencyAvgBedtimeISO,
    },
    watchMode,
    watchItems,
  };
}
