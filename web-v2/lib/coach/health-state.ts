/**
 * health-state.ts
 * 30-day health trends (sleep, RHR, HRV, weight, cadence, VO2)
 * for the HEALTH surface. Reads from health_samples.
 */
import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { getCanonicalRunIds, isoDaysBefore } from '@/lib/runs/volume';
import { loadEffectiveMaxHr } from '@/lib/training/max-hr';

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
  /** 2026-06-03 · series28d added for iPhone Direction A bottom-sheet
   *  detail chart. VO2 max is a sparse signal · sample_type='vo2_max'
   *  fires on workouts long/hard enough for Apple's algorithm to update
   *  (~1-3× per week for trained runners). Series is interpolated daily
   *  via last-value-carry-forward so the chart line is continuous · null
   *  entries only at the start when the runner has no historical reading.
   *  Length is always 28, oldest → newest. */
  vo2:    { current: number | null; series28d: (number | null)[] };
  // 2026-06-01 · Quick Win summaries
  wristTemp:       { current: number | null; baseline: number | null; deltaC: number | null };
  respiratoryRate: { current: number | null; baseline: number | null; delta: number | null };
  spo2:            { current: number | null; baseline: number | null };
  bodyFat:         { current: number | null; delta30: number | null };
  leanMass:        { current: number | null; delta30: number | null };
  maxHr:           { current: number | null };
  // 2026-06-01 · sleep consistency · bedtime variability over last 7 nights
  sleepConsistency: { variabilityMin: number | null; avgBedtimeISO: string | null };
  // 2026-06-01 · active energy (iPhone 031fe5fd ships daily kcal totals,
  // bumps to ~180 buckets/run once TF updates). Current = today's total ·
  // avg7 = 7-day rolling average · series = 14-day chart strip.
  activeEnergy: {
    today: number | null;
    avg7: number | null;
    series: { date: string; kcal: number }[];
  };
  // 2026-06-01 · menstrual cycle (iPhone 0fa7d55a). Gender-gated by
  // caller (seed.ts reads biologicalSex). Null when no data exists ·
  // either runner is not female, opt-in not flipped, or cycle data
  // hasn't synced yet. Phase encoding: 1=menstrual 2=follicular
  // 3=ovulatory 4=luteal.
  cyclePhase: {
    dayOfCycle: number | null;
    phase: 1 | 2 | 3 | 4 | null;
    phaseLabel: 'menstrual' | 'follicular' | 'ovulatory' | 'luteal' | null;
  };
  // 2026-06-01 · sleep stages (iPhone b58abfc3 ships per-night minutes).
  // Each is a 7-night avg. Null when no data yet (pre-build, no watch).
  // 2026-06-03 · series fields extended 14→28 nights for iPhone Direction
  // A bottom-sheet detail charts. light + awake series added (were sparse
  // in the original shape · iPhone wants all 4 stages on the chart spec).
  sleepStages: {
    deepMin: number | null;
    remMin: number | null;
    lightMin: number | null;
    awakeMin: number | null;
    deepSeries:  { date: string; min: number }[];
    remSeries:   { date: string; min: number }[];
    lightSeries: { date: string; min: number }[];
    awakeSeries: { date: string; min: number }[];
    /** 2026-06-01 · sleep architecture regularity. Standard deviation
     *  of (REM minutes / total sleep minutes) across the last 7 nights.
     *  Saw et al. doctrine: stable architecture = recovered. Higher
     *  variance = the runner's recovery cycles are unstable. Null
     *  when fewer than 4 nights of stage data. */
    remRatioStdev: number | null;
    /** Plain-language verdict per the doctrine bands. */
    architectureVerdict: 'stable' | 'mixed' | 'unstable' | null;
    /** 2026-06-01 · Power moves #6 · architecture vs quantity framing.
     *  Distinguishes "architecture is fine, hours are the problem" from
     *  "architecture is also off." Renders next to sleep tile. */
    architectureFraming: {
      deepPct: number;          // deep / total · 0-100
      remPct: number;           // REM / total · 0-100
      hoursTotal: number;
      verdict: 'healthy_architecture' | 'architecture_off';
      framing: string;          // coach-voice plain English
    } | null;
  };
  // Watch-list signal
  watchMode: 'steady' | 'watch-amber' | 'watch-red' | 'green';
  watchItems: { label: string; status: 'amber' | 'red'; note: string }[];

  /** 2026-06-03 · iPhone Direction A · FORM METRICS (6 placeholder cards).
   *  Sourced from runs.data per-workout fields (avgPowerW, avgVertOscCm,
   *  avgStrideLengthM, avgGctMs, avgCadence) which the watch + iPhone HK
   *  ingest already populates. Each metric: current (most recent run),
   *  14d avg, 28d avg. Null when no run in the window has the field.
   *
   *  lrBalance is NULL · HK ships running.balance type but our ingest
   *  doesn't surface it yet. When iPhone agent adds it on the ingest
   *  payload, it'll auto-populate here. */
  /** 2026-06-03 · series28d = 28-element array, OLDEST → NEWEST, one entry
   *  per day. Form metrics only exist on run-days · rest-day entries are
   *  null (sparse array policy per iPhone brief). iPhone bottom-sheet
   *  hero chart reads series28d directly; falls back to its synthetic
   *  fabrication when null or length < 14. */
  runForm: {
    cadenceSpm:        { current: number | null; avg14d: number | null; avg28d: number | null; series28d: (number | null)[] };
    runPowerW:         { current: number | null; avg14d: number | null; avg28d: number | null; series28d: (number | null)[] };
    strideLengthM:     { current: number | null; avg14d: number | null; avg28d: number | null; series28d: (number | null)[] };
    vertOscCm:         { current: number | null; avg14d: number | null; avg28d: number | null; series28d: (number | null)[] };
    groundContactMs:   { current: number | null; avg14d: number | null; avg28d: number | null; series28d: (number | null)[] };
    lrBalancePct:      { current: number | null; avg14d: number | null; avg28d: number | null; series28d: (number | null)[] };
  };

  /** 2026-06-03 · iPhone Direction A · DAILY READINESS series · 7-day.
   *  From readiness_snapshots (one row per day via nightly cron). Empty
   *  array on cold-start runners (no snapshots yet). */
  dailyReadiness: { date: string; score: number; band: string }[];

  /** 2026-06-03 · iPhone Direction A · BODY metrics extras. respRate +
   *  wristTemp already exist at top level · this adds bodyTempC. Currently
   *  always null (no sample_type yet) · placeholder slot for when iPhone
   *  ingest starts shipping HKQuantityTypeIdentifierBodyTemperature. */
  bodyTemp: { currentC: number | null; baselineC: number | null; series30d: { date: string; tempC: number }[] };

  /** 2026-06-03 · iPhone Direction A · DEEPER INSIGHTS (4-8 cards).
   *  Engine-authored from existing coach signals (TSB, sleep debt, day-
   *  of-week patterns, heat correlation, etc.). iPhone renders in order
   *  received · no client-side prioritization. */
  insights: Array<{
    id: string;
    eyebrow: string;
    title: string;
    body: string;
  }>;

  /** 2026-06-03 · iPhone Direction A · OVERVIEW bottom cards.
   *  Authored coach-voice content. Each can be null when the data
   *  doesn't warrant the card. */
  overview: {
    /** THE STORY · 2-3 sentence synthesis + streak data. */
    story: {
      paragraph: string;
      sleepBelowBaselineDays: number;
      hrvBelowBaselineDays: number;
    } | null;
    /** WATCHING TOMORROW · 2-3 forecast bullets. */
    watchingTomorrow: {
      bullets: string[];
      forecastChips: string[];
    } | null;
    /** RECOVERY PHASE · post-hard-session tracker. */
    recoveryPhase: {
      anchor: string;            // "Long run · 14mi Sun"
      percentRecovered: number;  // 0-100
      dayOf: string;             // "Day 2 of 4"
      pillars: Array<{
        label: string;
        percent: number;
        status: 'red' | 'amber' | 'green';
      }>;
      muscleStatus: string;
      earliestQualitySession: string;
    } | null;
  };

  /** 2026-06-03 · iPhone Direction A · VO2 trend enrichment. Extends
   *  the existing vo2.current with a 30-day % change + coach voice. */
  vo2Trend: {
    pctChange30d: number | null;     // e.g. 2.4 = +2.4%
    coach: string | null;            // one-liner narrative
  };
}

export async function loadHealthState(userId: string): Promise<HealthState> {
  const today = await runnerToday(userId);

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
    sleepDeepRows,
    sleepRemRows,
    sleepLightRows,
    sleepAwakeRows,
    activeEnergyRows,
    cycleDayRow,
    cyclePhaseRow,
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
            AND id = ANY($3::bigint[])
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
      // Phase B · one canonical dedup. A dupe would weight one run's cadence 2×.
      [userId, today, await getCanonicalRunIds(userId, isoDaysBefore(today, 60), today)]
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
    // Max HR · canonical via loadEffectiveMaxHr (user_override → 12-month
    // observed → manual stored → null). Doctrine doc: lib/training/max-hr.ts.
    loadEffectiveMaxHr(userId, today).then((eff) => ({
      value: eff.bpm ?? 0,
    })),
    // Sleep bedtime times · for consistency / variability calc.
    // sleep_hours sample_date IS the night-of date · use recorded_at
    // (the timestamp the watch wrote it) as proxy for bedtime.
    pool.query(
      `SELECT sample_date::date AS d, recorded_at
         FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'sleep_hours'
          AND sample_date >= ($2::date - interval '28 days')
        ORDER BY sample_date ASC`,
      [userId, today]
    ).then((r) => r.rows),
    // 2026-06-01 · sleep stages from iPhone b58abfc3. Per-stage minute
    // counts per night. 2026-06-03 · extended 14→28 nights for iPhone
    // Direction A · bottom-sheet detail charts read the same series and
    // the 14-night window cut off the trend tail. 28 lines up with the
    // runForm series28d.
    pool.query(
      `SELECT sample_date::date AS d, value FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'sleep_deep_minutes'
          AND sample_date >= ($2::date - interval '28 days')
        ORDER BY sample_date ASC`,
      [userId, today]
    ).then((r) => r.rows),
    pool.query(
      `SELECT sample_date::date AS d, value FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'sleep_rem_minutes'
          AND sample_date >= ($2::date - interval '28 days')
        ORDER BY sample_date ASC`,
      [userId, today]
    ).then((r) => r.rows),
    pool.query(
      `SELECT sample_date::date AS d, value FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'sleep_light_minutes'
          AND sample_date >= ($2::date - interval '28 days')
        ORDER BY sample_date ASC`,
      [userId, today]
    ).then((r) => r.rows),
    pool.query(
      `SELECT sample_date::date AS d, value FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'sleep_awake_minutes'
          AND sample_date >= ($2::date - interval '28 days')
        ORDER BY sample_date ASC`,
      [userId, today]
    ).then((r) => r.rows),
    // 2026-06-01 · active energy daily totals · iPhone 031fe5fd. Sums
    // per-day kcal across the 14d window. Once TF updates push the ~180
    // sub-day buckets, SUM gives the same daily total · this query is
    // forward-compatible without a rewrite.
    pool.query(
      `SELECT sample_date::date AS d, SUM(value::numeric) AS value
         FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'active_energy'
          AND sample_date >= ($2::date - interval '14 days')
        GROUP BY sample_date::date
        ORDER BY sample_date::date ASC`,
      [userId, today]
    ).then((r) => r.rows),
    // 2026-06-01 · menstrual cycle day · most-recent value (iPhone refreshes
    // daily so MAX(value) on most recent date = today's day-of-cycle).
    pool.query(
      `SELECT value FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'menstrual_cycle_day'
          AND sample_date >= ($2::date - interval '2 days')
        ORDER BY sample_date DESC, recorded_at DESC LIMIT 1`,
      [userId, today]
    ).then((r) => r.rows[0]),
    pool.query(
      `SELECT value FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'menstrual_cycle_phase'
          AND sample_date >= ($2::date - interval '2 days')
        ORDER BY sample_date DESC, recorded_at DESC LIMIT 1`,
      [userId, today]
    ).then((r) => r.rows[0]),
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
  const rhr3 = rhrAll.slice(-3);
  const rhrCurrent = rhr3.length ? Math.round(rhr3.reduce((s, x) => s + x, 0) / rhr3.length) : null;
  const rhrBaseline = rhrAll.length >= 14
    ? Math.round(rhrAll.slice(0, -7).reduce((s, x) => s + x, 0) / Math.max(1, rhrAll.length - 7))
    : (rhrAll.length ? Math.round(rhrAll.reduce((s, x) => s + x, 0) / rhrAll.length) : null);
  const rhrDelta = (rhrCurrent != null && rhrBaseline != null) ? rhrCurrent - rhrBaseline : null;

  // HRV
  const median = (xs: number[]): number => {
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };
  const hrvSeries = hrvRows.map((r: any) => ({
    date: r.d.toISOString().slice(0, 10),
    ms: Math.round(Number(r.v)),
  })).slice(-30);
  const hrvAll = hrvSeries.map((r) => r.ms);
  const hrv7 = hrvAll.slice(-7);
  // 2026-06-09 · regression-audit G3 · MEDIAN, not mean. A single
  // partial-night artifact dragged the 7-day mean hard in production
  // (2026-06-08: a 29 ms read — corrected to 46 on re-sync — scored
  // readiness 38 PULL-BACK and fired pull-back advice). 29 ms is inside
  // any sane hard bounds, so the ingest clamp can't catch it; the median
  // ignores one outlier completely once ≥3 days exist. Sub-3-day windows
  // keep the residual risk — that's data scarcity, not windowing.
  const hrvCurrent = hrv7.length ? Math.round(median(hrv7)) : null;
  // 2026-06-04 · stable baseline · mean of last 30d EXCLUDING last 7
  // (the runner's "settled" state, not drifting with a recent streak).
  // Matches state-loader.ts loadStableBaseline + glance-state.ts +
  // forecasts.ts so the driver row, BODY tile, and forecast all
  // converge on the same number. David's QC: driver row HRV baseline
  // 57 vs BODY tile 54 was an old whole-30d-mean artifact.
  const hrvBaseline = hrvAll.length >= 14
    ? Math.round(hrvAll.slice(0, -7).reduce((s, x) => s + x, 0) / Math.max(1, hrvAll.length - 7))
    : (hrvAll.length ? Math.round(hrvAll.reduce((s, x) => s + x, 0) / hrvAll.length) : null);
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

  // 2026-06-01 · Sleep stages · 7-night avg per stage + 14-night deep/REM
  // series for the trend strip. Null when iPhone hasn't shipped data yet
  // OR runner doesn't wear watch overnight.
  const stageAvg = (rows: any[]): number | null => {
    const xs = rows.map((r) => Number(r.value)).filter((v) => Number.isFinite(v) && v >= 0);
    const last7 = xs.slice(-7);
    if (last7.length === 0) return null;
    return Math.round(last7.reduce((s, x) => s + x, 0) / last7.length);
  };
  const stageSeries = (rows: any[]): { date: string; min: number }[] =>
    rows.map((r) => ({
      date: r.d.toISOString ? r.d.toISOString().slice(0, 10) : String(r.d),
      min: Math.round(Number(r.value)),
    })).filter((p) => Number.isFinite(p.min) && p.min >= 0);
  // 2026-06-01 · sleep architecture regularity (Saw et al.). Compute
  // REM/total ratio per night, then SD of those ratios across the last
  // 7 nights. Higher SD = more night-to-night variance = unstable
  // architecture. < 0.04 stable · 0.04-0.07 mixed · >= 0.07 unstable.
  const remRatioPerNight: number[] = [];
  // Build per-date map of stage minutes so we can pair them per night.
  const stageMap = new Map<string, { deep?: number; rem?: number; light?: number; awake?: number }>();
  const stuff = (rows: any[], k: 'deep'|'rem'|'light'|'awake') => {
    for (const r of (rows ?? [])) {
      const d = r.d.toISOString ? r.d.toISOString().slice(0, 10) : String(r.d);
      const v = Number(r.value);
      if (!Number.isFinite(v) || v < 0) continue;
      const cur = stageMap.get(d) ?? {};
      cur[k] = v;
      stageMap.set(d, cur);
    }
  };
  stuff(sleepDeepRows as any[], 'deep');
  stuff(sleepRemRows as any[], 'rem');
  stuff(sleepLightRows as any[], 'light');
  stuff(sleepAwakeRows as any[], 'awake');
  for (const [, stages] of [...stageMap].sort(([a],[b]) => a < b ? -1 : 1).slice(-7)) {
    const total = (stages.deep ?? 0) + (stages.rem ?? 0) + (stages.light ?? 0);
    if (total > 0 && stages.rem != null) {
      remRatioPerNight.push(stages.rem / total);
    }
  }
  let remRatioStdev: number | null = null;
  let architectureVerdict: 'stable' | 'mixed' | 'unstable' | null = null;
  if (remRatioPerNight.length >= 4) {
    const mean = remRatioPerNight.reduce((s, x) => s + x, 0) / remRatioPerNight.length;
    const variance = remRatioPerNight.reduce((s, x) => s + (x - mean) ** 2, 0) / remRatioPerNight.length;
    remRatioStdev = +Math.sqrt(variance).toFixed(3);
    architectureVerdict = remRatioStdev < 0.04 ? 'stable'
      : remRatioStdev < 0.07 ? 'mixed' : 'unstable';
  }
  // 2026-06-01 · Power moves #6 · architecture vs quantity framing.
  // If the runner slept SHORT but the ratios (deep%, REM%) are in
  // the normal range, the architecture is fine and hours are the
  // story. If ratios are off (deep < 12% or > 25%, REM < 15% or
  // > 30%), the architecture itself is disturbed and rest alone
  // won't fully fix it.
  const deepAvg = stageAvg(sleepDeepRows as any[]);
  const remAvg  = stageAvg(sleepRemRows  as any[]);
  const lightAvg = stageAvg(sleepLightRows as any[]);
  let architectureFraming: {
    deepPct: number; remPct: number; hoursTotal: number;
    verdict: 'healthy_architecture' | 'architecture_off';
    framing: string;
  } | null = null;
  if (deepAvg != null && remAvg != null && lightAvg != null) {
    const totalMin = deepAvg + remAvg + lightAvg;
    if (totalMin > 0) {
      const deepPct = Math.round((deepAvg / totalMin) * 100);
      const remPct = Math.round((remAvg / totalMin) * 100);
      const hoursTotal = +(totalMin / 60).toFixed(1);
      const architectureHealthy = deepPct >= 12 && deepPct <= 25 && remPct >= 15 && remPct <= 30;
      const verdict = architectureHealthy ? 'healthy_architecture' : 'architecture_off';
      let framing: string;
      if (architectureHealthy && hoursTotal < 7) {
        framing = `Architecture is healthy (${deepPct}% deep, ${remPct}% REM). The issue is hours · push bedtime tonight.`;
      } else if (architectureHealthy) {
        framing = `Architecture is healthy (${deepPct}% deep, ${remPct}% REM) and hours are in the band.`;
      } else if (hoursTotal < 7) {
        framing = `Architecture is also off (${deepPct}% deep, ${remPct}% REM) on top of low hours · two stories stacking.`;
      } else {
        framing = `Hours are fine but architecture is off (${deepPct}% deep, ${remPct}% REM) · check stress + bedtime caffeine.`;
      }
      architectureFraming = { deepPct, remPct, hoursTotal, verdict, framing };
    }
  }
  const sleepStagesOut = {
    deepMin:  deepAvg,
    remMin:   remAvg,
    lightMin: lightAvg,
    awakeMin: stageAvg(sleepAwakeRows as any[]),
    deepSeries:  stageSeries(sleepDeepRows  as any[]),
    remSeries:   stageSeries(sleepRemRows   as any[]),
    lightSeries: stageSeries(sleepLightRows as any[]),
    awakeSeries: stageSeries(sleepAwakeRows as any[]),
    remRatioStdev,
    architectureVerdict,
    architectureFraming,
  };

  // 2026-06-01 · Active energy daily kcal · iPhone 031fe5fd.
  const aeSeries = (activeEnergyRows as any[]).map((r) => ({
    date: r.d.toISOString ? r.d.toISOString().slice(0, 10) : String(r.d),
    kcal: Math.round(Number(r.value) || 0),
  })).filter((p) => Number.isFinite(p.kcal));
  const aeToday = aeSeries.at(-1)?.kcal ?? null;
  const aeLast7 = aeSeries.slice(-7).map((p) => p.kcal).filter((v) => v > 0);
  const aeAvg7 = aeLast7.length >= 3
    ? Math.round(aeLast7.reduce((s, x) => s + x, 0) / aeLast7.length)
    : null;
  const activeEnergyOut = {
    today: aeToday != null && aeToday > 0 ? aeToday : null,
    avg7: aeAvg7,
    series: aeSeries,
  };

  // 2026-06-01 · Cycle phase · iPhone 0fa7d55a. Caller (seed.ts) is
  // responsible for the female-gated render · we always expose the
  // shape, even for non-female users, so the type is stable.
  const PHASE_LABELS: Record<1 | 2 | 3 | 4, 'menstrual' | 'follicular' | 'ovulatory' | 'luteal'> = {
    1: 'menstrual', 2: 'follicular', 3: 'ovulatory', 4: 'luteal',
  };
  const cycleDay = cycleDayRow?.value != null ? Math.round(Number(cycleDayRow.value)) : null;
  const cyclePhaseNum = cyclePhaseRow?.value != null ? Math.round(Number(cyclePhaseRow.value)) : null;
  const cyclePhaseOut = {
    dayOfCycle: cycleDay != null && cycleDay >= 1 && cycleDay <= 60 ? cycleDay : null,
    phase: (cyclePhaseNum != null && cyclePhaseNum >= 1 && cyclePhaseNum <= 4
      ? cyclePhaseNum as 1 | 2 | 3 | 4
      : null),
    phaseLabel: (cyclePhaseNum != null && cyclePhaseNum >= 1 && cyclePhaseNum <= 4
      ? PHASE_LABELS[cyclePhaseNum as 1 | 2 | 3 | 4]
      : null),
  };

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
    vo2: { current: vo2Current, series28d: buildVo2Series28d(vo2Series, today) },
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
    sleepStages: sleepStagesOut,
    activeEnergy: activeEnergyOut,
    cyclePhase: cyclePhaseOut,
    watchMode,
    watchItems,
    // 2026-06-03 · iPhone Direction A · additive Direction A fields.
    // Loaded via loadDirectionAFields helper to keep loadHealthState
    // readable. Each section returns null/empty gracefully.
    ...(await loadDirectionAFields(userId, today, {
      vo2Current,
      hrvBelowBaselineDays: hrvBelowBaselineDaysCount(hrvSeries, hrvBaseline),
      sleepBelowBaselineDays: sleepBelowBaselineDaysCount(sleepSeries, avg30n),
    })),
  };
}

/* ────────────────────────── Direction A loaders ────────────────────── */

/** 2026-06-03 · iPhone Direction A · loads runForm, dailyReadiness,
 *  bodyTemp, insights, overview, vo2Trend fields. Each section is
 *  best-effort · failures return safe defaults. */
async function loadDirectionAFields(
  userId: string,
  today: string,
  signals: {
    vo2Current: number | null;
    hrvBelowBaselineDays: number;
    sleepBelowBaselineDays: number;
  },
): Promise<{
  runForm: HealthState['runForm'];
  dailyReadiness: HealthState['dailyReadiness'];
  bodyTemp: HealthState['bodyTemp'];
  insights: HealthState['insights'];
  overview: HealthState['overview'];
  vo2Trend: HealthState['vo2Trend'];
}> {
  const [runForm, dailyReadiness, bodyTemp, insights, overview, vo2Trend] = await Promise.all([
    loadRunForm(userId, today),
    loadDailyReadiness(userId, today),
    loadBodyTemp(userId, today),
    loadInsights(userId, today),
    loadOverview(userId, today, signals),
    loadVo2Trend(userId, today, signals.vo2Current),
  ]);
  return { runForm, dailyReadiness, bodyTemp, insights, overview, vo2Trend };
}

/** Per-metric current+14d+28d from runs.data. Single query per metric
 *  reads the most-recent value + 14d/28d averages in one pass. */
async function loadRunForm(userId: string, today: string): Promise<HealthState['runForm']> {
  // Each form metric is the avg field on runs.data:
  //   cadenceSpm     · data->>'avgCadence'         (130-220 sanity range)
  //   runPowerW      · data->>'avgPowerW'          (50-600 sanity range)
  //   strideLengthM  · data->>'avgStrideLengthM'   (0.5-2.5 sanity range)
  //   vertOscCm      · data->>'avgVertOscCm'       (3-15 sanity range)
  //   groundContactMs· data->>'avgGctMs'           (150-400 sanity range)
  //
  // lrBalance is NOT in our ingest payload yet · always returns null.
  // When iPhone agent adds it to /api/ingest/workout body, surface it
  // here as data->>'avgLrBalancePct' (proposed field name).
  type MetricKey = 'avgCadence' | 'avgPowerW' | 'avgStrideLengthM' | 'avgVertOscCm' | 'avgGctMs';
  type Bounds = { lo: number; hi: number };
  const metrics: Array<{ key: MetricKey; bounds: Bounds; out: keyof Omit<HealthState['runForm'], 'lrBalancePct'> }> = [
    { key: 'avgCadence',        bounds: { lo: 130, hi: 220 }, out: 'cadenceSpm' },
    { key: 'avgPowerW',         bounds: { lo: 50, hi: 600 },  out: 'runPowerW' },
    { key: 'avgStrideLengthM',  bounds: { lo: 0.5, hi: 2.5 }, out: 'strideLengthM' },
    { key: 'avgVertOscCm',      bounds: { lo: 3, hi: 15 },    out: 'vertOscCm' },
    { key: 'avgGctMs',          bounds: { lo: 150, hi: 400 }, out: 'groundContactMs' },
  ];

  // Empty 28-element series · iPhone uses length-≥14 as the
  // "use real data" trigger so we ship the placeholder when there's no
  // signal at all. Rest-day entries stay null (sparse policy).
  const emptySeries28 = (): (number | null)[] => new Array(28).fill(null);
  const out: HealthState['runForm'] = {
    cadenceSpm:      { current: null, avg14d: null, avg28d: null, series28d: emptySeries28() },
    runPowerW:       { current: null, avg14d: null, avg28d: null, series28d: emptySeries28() },
    strideLengthM:   { current: null, avg14d: null, avg28d: null, series28d: emptySeries28() },
    vertOscCm:       { current: null, avg14d: null, avg28d: null, series28d: emptySeries28() },
    groundContactMs: { current: null, avg14d: null, avg28d: null, series28d: emptySeries28() },
    lrBalancePct:    { current: null, avg14d: null, avg28d: null, series28d: emptySeries28() },
  };

  await Promise.all(metrics.map(async (m) => {
    try {
      // 2026-06-03 · iPhone Direction A · split the load into two queries
      // so the per-day series can stream alongside the aggregate scalars.
      // Could collapse to a single query via a CTE but the readability
      // win + tiny extra round-trip aren't a concern at this scale.
      const [aggR, seriesR] = await Promise.all([
        pool.query<{
          current_v: string | null;
          avg14: string | null;
          avg28: string | null;
        }>(
          `WITH recent AS (
             SELECT (data->>'${m.key}')::numeric AS v,
                    COALESCE(data->>'date', LEFT(data->>'startLocal',10))::date AS d
               FROM runs
              WHERE user_uuid = $1::uuid
                AND NOT (data ? 'mergedIntoId')
                AND data->>'${m.key}' IS NOT NULL
                AND (data->>'${m.key}')::numeric BETWEEN ${m.bounds.lo} AND ${m.bounds.hi}
                AND COALESCE(data->>'date', LEFT(data->>'startLocal',10))::date >= ($2::date - interval '28 days')
                AND COALESCE(data->>'date', LEFT(data->>'startLocal',10))::date <= $2::date
           )
           SELECT
             (SELECT v::text FROM recent ORDER BY d DESC LIMIT 1)               AS current_v,
             (SELECT AVG(v)::text FROM recent WHERE d >= ($2::date - interval '14 days')) AS avg14,
             (SELECT AVG(v)::text FROM recent)                                   AS avg28`,
          [userId, today],
        ),
        // Daily series · LEFT JOIN against a 28-day date spine so rest
        // days surface as NULL. When multiple runs land on one day
        // (unusual but possible) we take the day's average · matches
        // how the chart-tap detail screen would frame "your day's value."
        pool.query<{ d: string; v: string | null }>(
          `WITH spine AS (
             SELECT (($2::date - interval '27 days') + (n || ' days')::interval)::date AS d
               FROM generate_series(0, 27) AS n
           )
           SELECT spine.d::text AS d, AVG((r.data->>'${m.key}')::numeric)::text AS v
             FROM spine
        LEFT JOIN runs r
                  ON r.user_uuid = $1::uuid
                 AND NOT (r.data ? 'mergedIntoId')
                 AND r.data->>'${m.key}' IS NOT NULL
                 AND (r.data->>'${m.key}')::numeric BETWEEN ${m.bounds.lo} AND ${m.bounds.hi}
                 AND COALESCE(r.data->>'date', LEFT(r.data->>'startLocal',10))::date = spine.d
            GROUP BY spine.d
            ORDER BY spine.d ASC`,
          [userId, today],
        ),
      ]);
      const row = aggR.rows[0];
      const series28d: (number | null)[] = seriesR.rows.map((r) =>
        r.v != null ? +Number(r.v).toFixed(2) : null
      );
      // Defensive · spine query SHOULD return 28 rows but pad/trim if not.
      while (series28d.length < 28) series28d.unshift(null);
      if (series28d.length > 28) series28d.splice(0, series28d.length - 28);

      if (row) {
        out[m.out] = {
          current: row.current_v != null ? +Number(row.current_v).toFixed(2) : null,
          avg14d: row.avg14 != null ? +Number(row.avg14).toFixed(2) : null,
          avg28d: row.avg28 != null ? +Number(row.avg28).toFixed(2) : null,
          series28d,
        };
      } else {
        // Aggregate query returned nothing but series may still have
        // entries · expose what we have.
        out[m.out] = { current: null, avg14d: null, avg28d: null, series28d };
      }
    } catch (e) {
      console.warn(`[health/runForm] ${m.key} query failed:`, e instanceof Error ? e.message : String(e));
    }
  }));

  return out;
}

/** Last 7 days of readiness_snapshots. Empty when cold-start. */
async function loadDailyReadiness(userId: string, today: string): Promise<HealthState['dailyReadiness']> {
  try {
    const r = await pool.query<{ sample_date: string; score: number | string; band: string }>(
      `SELECT sample_date::text, score, band
         FROM readiness_snapshots
        WHERE COALESCE(user_uuid::text, user_id::text) = $1
          AND sample_date >= ($2::date - interval '7 days')
          AND sample_date <= $2::date
        ORDER BY sample_date ASC`,
      [userId, today],
    );
    return r.rows.map((row) => ({
      date: row.sample_date,
      score: Number(row.score),
      band: row.band,
    }));
  } catch {
    return [];
  }
}

/** Body temperature · sample_type='body_temperature'. Currently never
 *  populated by ingest · returns all-null. Slot ready for iPhone's
 *  HKQuantityTypeIdentifierBodyTemperature ingest. */
async function loadBodyTemp(userId: string, today: string): Promise<HealthState['bodyTemp']> {
  try {
    const r = await pool.query<{ sample_date: string; value: number | string }>(
      `SELECT sample_date::text, value FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1
          AND sample_type = 'body_temperature'
          AND sample_date >= ($2::date - interval '30 days')
        ORDER BY sample_date ASC`,
      [userId, today],
    );
    const series30d = r.rows.map((row) => ({
      date: row.sample_date,
      tempC: +Number(row.value).toFixed(2),
    }));
    const currentC = series30d.length > 0 ? series30d[series30d.length - 1].tempC : null;
    const baselineC = series30d.length >= 7
      ? +(series30d.reduce((s, x) => s + x.tempC, 0) / series30d.length).toFixed(2)
      : null;
    return { currentC, baselineC, series30d };
  } catch {
    return { currentC: null, baselineC: null, series30d: [] };
  }
}

/** Engine-authored insights · 4-8 cards from coach signals. Reads
 *  training_form + load_acwr + sleep stats + day-of-week patterns +
 *  heat-effort correlation when available. Each item is independent ·
 *  the function emits whatever signals are present. */
async function loadInsights(userId: string, today: string): Promise<HealthState['insights']> {
  const insights: HealthState['insights'] = [];

  // Insight 1: TRAINING LOAD · human-readable form state, no PMC jargon
  try {
    const { computeTrainingForm } = await import('@/lib/coach/training-form');
    const form = await computeTrainingForm(userId);
    if (form) {
      const direction = form.trend7 > 5 ? 'Building this week.' : form.trend7 < -5 ? 'Load easing this week.' : 'Steady this week.';
      insights.push({
        id: 'training_form',
        eyebrow: 'TRAINING LOAD',
        title: form.label,   // "Productive" / "Neutral" / "Fatigued" — plain English
        body: direction,
      });
    }
  } catch { /* skip on error */ }

  // Insight 2: SLEEP DEBT · last 7 nights vs target
  // 2026-06-03 · disclosure-honest · counts ACTUAL nights tracked, not
  // assumed 7. When a runner skipped wearing the watch for some nights,
  // we report the deficit over the nights we have, AND we name the
  // count ("over 6 of 7 nights"). When fewer than 4 nights are tracked,
  // we skip the insight entirely · too sparse to claim a trend.
  try {
    const r = await pool.query<{ avg7: string | null; deficit_h: string | null; night_count: string | null }>(
      `SELECT AVG(value)::text AS avg7,
              SUM(GREATEST(0, 7.5 - value))::text AS deficit_h,
              COUNT(*)::text AS night_count
         FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1
          AND sample_type = 'sleep_hours'
          AND sample_date >= ($2::date - interval '7 days')
          AND sample_date <= $2::date
          AND value > 0`,    // 0-hour rows are HK glitches · skip
      [userId, today],
    );
    const avg7 = r.rows[0]?.avg7 ? Number(r.rows[0].avg7) : null;
    const deficit = r.rows[0]?.deficit_h ? Number(r.rows[0].deficit_h) : null;
    const nightCount = r.rows[0]?.night_count ? Number(r.rows[0].night_count) : 0;
    if (avg7 != null && deficit != null && nightCount >= 4) {
      const ofN = nightCount < 7 ? ` (${nightCount} of 7 nights tracked)` : '';
      // No prescriptive commands — state the observation, not an instruction.
      const debtNote = deficit > 5 ? 'Running a meaningful deficit.' : deficit > 2 ? 'Mild deficit.' : 'On track.';
      insights.push({
        id: 'sleep_debt',
        eyebrow: 'SLEEP DEBT',
        title: `${deficit.toFixed(1)}h short of target${ofN}`,
        body: `Avg ${avg7.toFixed(1)}h vs 7.5h target. ${debtNote}`,
      });
    }
  } catch { /* skip */ }

  // Insight 3: HEAT · most recent run weather context
  try {
    const r = await pool.query<{ data: any }>(
      `SELECT data FROM runs
        WHERE user_uuid = $1::uuid AND NOT (data ? 'mergedIntoId')
          AND (data->'weather')::text != 'null'
          AND COALESCE(data->>'date', LEFT(data->>'startLocal',10))::date >= ($2::date - interval '7 days')
        ORDER BY COALESCE(data->>'date', LEFT(data->>'startLocal',10)) DESC LIMIT 1`,
      [userId, today],
    );
    const d = r.rows[0]?.data;
    const tempPeak = d?.weather?.temp_f_peak;
    if (typeof tempPeak === 'number' && tempPeak >= 75) {
      insights.push({
        id: 'heat',
        eyebrow: 'HEAT',
        title: `Latest run peaked ${Math.round(tempPeak)}°F`,
        body: `Heat above 75°F costs roughly 1% pace per 5°F. Start earlier or shorten the long run on hot days.`,
      });
    }
  } catch { /* skip */ }

  // Insight 4: DAY OF WEEK · pattern-specific title derived from the insight text
  try {
    const { computeDowPatterns } = await import('@/lib/coach/dow-patterns');
    const dp = await computeDowPatterns(userId);
    if (dp?.insights && dp.insights.length > 0) {
      const text = dp.insights[0];
      // "HRV consistently lowest on FRI · …" → "HRV lowest on Fridays"
      // "RHR highest on MON · …"             → "Elevated HR on Mondays"
      // "Sleep shortest on TUE · …"          → "Less sleep on Tuesdays"
      const dayMatch = text.match(/on (\w+)/);
      const dayStr = dayMatch ? `${dayMatch[1]}s` : '';  // "FRIs", "MONs", etc.
      let title = 'Weekly pattern';
      if (text.startsWith('HRV'))   title = dayStr ? `HRV lowest on ${dayStr}` : 'HRV pattern';
      else if (text.startsWith('RHR'))   title = dayStr ? `Elevated HR on ${dayStr}` : 'HR pattern';
      else if (text.startsWith('Sleep')) title = dayStr ? `Less sleep on ${dayStr}` : 'Sleep pattern';
      insights.push({
        id: 'day_of_week',
        eyebrow: 'DAY OF WEEK',
        title,
        body: text,
      });
    }
  } catch { /* skip · dow-patterns may not have data */ }

  return insights;
}

/** OVERVIEW bottom cards · Story / Watching Tomorrow / Recovery Phase.
 *  Lightweight authoring · each card returns null when data doesn't
 *  warrant the surface. */
async function loadOverview(
  userId: string,
  today: string,
  signals: {
    vo2Current: number | null;
    hrvBelowBaselineDays: number;
    sleepBelowBaselineDays: number;
  },
): Promise<HealthState['overview']> {
  // STORY · synthesis paragraph + streak counts
  let story: HealthState['overview']['story'] = null;
  if (signals.hrvBelowBaselineDays > 0 || signals.sleepBelowBaselineDays > 0) {
    const parts: string[] = [];
    if (signals.sleepBelowBaselineDays >= 3) {
      parts.push(`${signals.sleepBelowBaselineDays} nights below sleep baseline`);
    }
    if (signals.hrvBelowBaselineDays >= 3) {
      parts.push(`${signals.hrvBelowBaselineDays} days HRV below baseline`);
    }
    const paragraph = parts.length > 0
      ? `Recent stretch · ${parts.join(' · ')}. ${signals.hrvBelowBaselineDays >= 5 || signals.sleepBelowBaselineDays >= 5 ? 'Time for a true recovery day before the next quality block.' : 'Watch tomorrow morning · if HRV is still under, ease the next quality.'}`
      : `Last week tracked clean · sleep + HRV stayed at or above baseline. Maintenance work is doing its job.`;
    story = {
      paragraph,
      sleepBelowBaselineDays: signals.sleepBelowBaselineDays,
      hrvBelowBaselineDays: signals.hrvBelowBaselineDays,
    };
  }

  // WATCHING TOMORROW · simple forecasts from current signals
  const bullets: string[] = [];
  const forecastChips: string[] = [];
  if (signals.sleepBelowBaselineDays >= 2) {
    bullets.push('Sleep · hit 8+ tonight to start the debt unwind');
    forecastChips.push('Sleep critical');
  }
  if (signals.hrvBelowBaselineDays >= 3) {
    bullets.push('HRV · expect a slower morning recovery if debt persists');
    forecastChips.push('HRV watch');
  }
  if (bullets.length === 0) {
    bullets.push('All signals in band · trust the plan');
  }
  const watchingTomorrow: HealthState['overview']['watchingTomorrow'] = {
    bullets,
    forecastChips,
  };

  // RECOVERY PHASE · only fires when there was a HARD session in last 4 days.
  // Anchored to the most recent type='long' or 'intervals' or 'threshold' or 'tempo'.
  let recoveryPhase: HealthState['overview']['recoveryPhase'] = null;
  try {
    const r = await pool.query<{
      date_iso: string; type: string; mi: string;
    }>(
      `SELECT pw.date_iso, pw.type, pw.distance_mi::text AS mi
         FROM plan_workouts pw
         JOIN training_plans tp ON tp.id = pw.plan_id
         JOIN runs r ON r.user_uuid = tp.user_uuid::uuid
                    AND NOT (r.data ? 'mergedIntoId')
                    AND COALESCE(r.data->>'date', LEFT(r.data->>'startLocal',10))::date = pw.date_iso::date
        WHERE tp.user_uuid = $1::uuid
          AND tp.archived_iso IS NULL
          AND pw.type IN ('long', 'intervals', 'threshold', 'tempo')
          AND pw.date_iso::date >= ($2::date - interval '4 days')
          AND pw.date_iso::date < $2::date
        ORDER BY pw.date_iso DESC LIMIT 1`,
      [userId, today],
    );
    const hard = r.rows[0];
    if (hard) {
      const daysSince = Math.max(0, Math.round(
        (Date.parse(today + 'T12:00:00Z') - Date.parse(hard.date_iso + 'T12:00:00Z')) / 86400000
      ));
      const recoveryDays = hard.type === 'long' ? 4 : hard.type === 'intervals' ? 3 : 2;
      const percentRecovered = Math.min(100, Math.round((daysSince / recoveryDays) * 100));
      const dayOf = `Day ${Math.min(daysSince + 1, recoveryDays)} of ${recoveryDays}`;
      const label = hard.type === 'long' ? `Long run · ${Number(hard.mi).toFixed(0)}mi`
        : hard.type === 'intervals' ? `Intervals · ${Number(hard.mi).toFixed(1)}mi`
        : hard.type === 'threshold' ? `Threshold · ${Number(hard.mi).toFixed(1)}mi`
        : `Tempo · ${Number(hard.mi).toFixed(1)}mi`;
      // Pillars are heuristic · all green when recovery is on track
      const status: 'red' | 'amber' | 'green' = percentRecovered >= 80 ? 'green'
        : percentRecovered >= 50 ? 'amber' : 'red';
      recoveryPhase = {
        anchor: label,
        percentRecovered,
        dayOf,
        pillars: [
          { label: 'Sleep',  percent: percentRecovered, status },
          { label: 'HRV',    percent: percentRecovered, status },
          { label: 'RHR',    percent: percentRecovered, status },
          { label: 'Glycogen', percent: percentRecovered, status },
        ],
        muscleStatus: percentRecovered >= 80 ? 'Loose · ready' : percentRecovered >= 50 ? 'Easing out' : 'Stiff · go easy',
        earliestQualitySession: `${recoveryDays - daysSince}d`,
      };
    }
  } catch { /* skip · best-effort */ }

  return { story, watchingTomorrow, recoveryPhase };
}

/** VO2 trend · % change over 30 days + one-liner narrative. */
async function loadVo2Trend(
  userId: string,
  today: string,
  current: number | null,
): Promise<HealthState['vo2Trend']> {
  if (current == null) return { pctChange30d: null, coach: null };
  try {
    const r = await pool.query<{ value: string | null }>(
      `SELECT AVG(value)::text AS value FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1
          AND sample_type = 'vo2_max'
          AND recorded_at >= NOW() - interval '60 days'
          AND recorded_at <  NOW() - interval '30 days'`,
      [userId],
    );
    const baseline30dAgo = r.rows[0]?.value ? Number(r.rows[0].value) : null;
    if (baseline30dAgo == null || baseline30dAgo <= 0) {
      return { pctChange30d: null, coach: `VO₂ ${current.toFixed(1)} · baseline forming` };
    }
    const pct = +(((current - baseline30dAgo) / baseline30dAgo) * 100).toFixed(1);
    const direction = pct > 1 ? 'rising' : pct < -1 ? 'easing' : 'steady';
    return {
      pctChange30d: pct,
      coach: `${pct >= 0 ? '+' : ''}${pct}% over 30d · ${direction}`,
    };
  } catch {
    return { pctChange30d: null, coach: null };
  }
}

/** Counter helpers · reused inside the loaders.
 *  2026-06-03 · MISSING data is honestly missing · these counters only
 *  count rows that exist (where the runner wore the watch). A skipped
 *  night doesn't count as "below baseline" because we don't know what
 *  the value would have been. Also filters out zero-value rows · HK
 *  occasionally writes a 0-hour row when sync fails partway, and we
 *  don't want that pretending to be a "0h slept" night. */
function hrvBelowBaselineDaysCount(
  series: { date: string; ms: number }[],
  baseline: number | null,
): number {
  if (!baseline || baseline <= 0) return 0;
  return series.filter((s) => s.ms > 0 && s.ms < baseline).length;
}

function sleepBelowBaselineDaysCount(
  series: { date: string; hours: number }[],
  baseline: number | null,
): number {
  if (!baseline || baseline <= 0) return 0;
  return series.filter((s) => s.hours > 0 && s.hours < baseline).length;
}

/**
 * 2026-06-03 · iPhone Direction A · build a continuous 28-day VO2 series
 * from the sparse vo2_max sample stream. Apple's algorithm only emits
 * a new reading on workouts that satisfy the calibration criteria · for
 * trained runners that's 1-3 readings per week, with long gaps possible
 * during taper or recovery weeks.
 *
 * Policy: last-value-carry-forward (LVCF) interpolation. Each day in the
 * 28-day window inherits the most-recent reading on or before that day.
 * Returns null only for days BEFORE the first reading · the chart
 * gracefully ignores leading nulls. Length is always 28, oldest → newest.
 *
 * Why LVCF over sparse-null: VO2 is a stock signal (your aerobic
 * ceiling persists between readings · it's not a per-day metric like
 * sleep or HRV). A null gap on rest days would mislead the runner into
 * thinking "my VO2 dropped." LVCF holds the line until a fresh reading
 * moves it.
 */
function buildVo2Series28d(
  vo2Series: { date: string; v: number }[],
  today: string,
): (number | null)[] {
  const out: (number | null)[] = new Array(28).fill(null);
  if (!vo2Series.length) return out;
  // Build a date → value index for fast lookup.
  const byDate = new Map<string, number>();
  for (const r of vo2Series) byDate.set(r.date, r.v);
  // Sort readings ASC so we can do LVCF in one pass.
  const sorted = [...vo2Series].sort((a, b) => a.date.localeCompare(b.date));

  const toIso = (d: Date): string => d.toISOString().slice(0, 10);
  // 27 days back through today, inclusive.
  const todayDate = new Date(`${today}T12:00:00Z`);
  const start = new Date(todayDate);
  start.setUTCDate(start.getUTCDate() - 27);

  let lastVal: number | null = null;
  // Seed lastVal with the most-recent reading STRICTLY BEFORE the window
  // (so a runner who tested last month doesn't get nulls at the front).
  for (const r of sorted) {
    if (r.date < toIso(start)) lastVal = r.v;
    else break;
  }

  for (let i = 0; i < 28; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    const iso = toIso(d);
    if (byDate.has(iso)) lastVal = byDate.get(iso)!;
    out[i] = lastVal != null ? +lastVal.toFixed(1) : null;
  }
  return out;
}
