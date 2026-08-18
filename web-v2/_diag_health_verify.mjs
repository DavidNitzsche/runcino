import pg from 'pg';
import { readFileSync } from 'fs';
const { Client } = pg;
const env = readFileSync(new URL('./.env.local', import.meta.url), 'utf8');
const dbUrl = env.split('\n').find(l => l.startsWith('DATABASE_URL=')).split('=').slice(1).join('=').trim();
const client = new Client({ connectionString: dbUrl });
await client.connect();
const UUID = '0645f40c-951d-4ccc-b86e-9979cd26c795';

// ── 0. Find correct UUID column for health_samples ────────────────────────
const hkUuid = await client.query(`
  SELECT 'user_uuid' AS col, COUNT(*) AS n FROM health_samples WHERE user_uuid = $1
  UNION ALL
  SELECT 'user_id',          COUNT(*)       FROM health_samples WHERE user_id   = $1
`, [UUID]);
console.log('health_samples row counts by UUID column:', hkUuid.rows);
const hkCol = hkUuid.rows.find(r => Number(r.n) > 0)?.col ?? 'user_uuid';
console.log('  → using column:', hkCol);

// ── 1. HK biometrics ──────────────────────────────────────────────────────
const hk = await client.query(`
  SELECT sample_type,
         to_char(sample_date, 'YYYY-MM-DD') AS dt,
         ROUND(value::numeric, 1) AS val
  FROM health_samples
  WHERE ${hkCol} = $1
    AND sample_type IN ('sleep_duration_h','hrv_rmssd_ms','resting_hr_bpm')
    AND sample_date >= CURRENT_DATE - INTERVAL '10 days'
  ORDER BY sample_type, sample_date DESC
`, [UUID]);

console.log('\n=== HK SAMPLES last 10d ===');
hk.rows.forEach(r => console.log(`  ${r.sample_type.padEnd(22)} ${r.dt}  ${r.val}`));

const sleep7 = hk.rows.filter(r => r.sample_type === 'sleep_duration_h').slice(0, 7).map(r => Number(r.val));
const hrv7   = hk.rows.filter(r => r.sample_type === 'hrv_rmssd_ms').slice(0, 7).map(r => Number(r.val));
const rhr3   = hk.rows.filter(r => r.sample_type === 'resting_hr_bpm').slice(0, 3).map(r => Number(r.val));
const avg    = a => a.length ? (a.reduce((s,x)=>s+x,0)/a.length).toFixed(1) : 'n/a';
const median = a => { if (!a.length) return 'n/a'; const s=[...a].sort((x,y)=>x-y); const m=Math.floor(s.length/2); return (s.length%2 ? s[m] : (s[m-1]+s[m])/2).toFixed(1); };

const sleepTotalH = sleep7.reduce((s,x)=>s+x,0);
const lastNight = hk.rows.find(r => r.sample_type === 'sleep_duration_h');
const lnH = lastNight ? Math.floor(Number(lastNight.val)) : null;
const lnM = lastNight ? Math.round((Number(lastNight.val) - lnH) * 60) : null;

console.log('\n=== DERIVED vs DISPLAY ===');
console.log(`  Sleep 7-night avg:  ${avg(sleep7)}h    display=6.8h   weekly total=${sleepTotalH.toFixed(1)}h (5h short = target ${(7*8-sleepTotalH).toFixed(1)}h?)`);
console.log(`  HRV 7d median:      ${median(hrv7)}ms   display=51ms   data=[${hrv7.join(',')}]`);
console.log(`  RHR 3d avg:         ${avg(rhr3)}bpm  display=49bpm  data=[${rhr3.join(',')}]`);
console.log(`  Last night:         ${lnH}h ${lnM}m  display=6h 47m  (${lastNight?.dt})`);

// ── 2. Weekly mileage — canonical dedup ───────────────────────────────────
// Week = Mon Jun 15 – Sun Jun 21 (long_run_day=Sunday → Mon-Sun week)
// Use NOT mergedIntoId IS NOT NULL to exclude dupes per Cluster 1 dedup
const wk = await client.query(`
  SELECT COUNT(*) AS runs,
         ROUND(SUM((data->>'distanceMi')::float)::numeric, 1) AS mi
  FROM runs
  WHERE user_uuid = $1
    AND (data->>'startLocal')::date >= '2026-06-15'
    AND (data->>'startLocal')::date <= '2026-06-21'
    AND COALESCE((data->>'mergedIntoId'), '') = ''
`, [UUID]);
console.log('\n=== THIS WEEK (Jun 15-21, deduped) ===');
console.log(`  ${wk.rows[0].runs} runs, ${wk.rows[0].mi}mi   display=27.7mi`);

// Also check raw (for comparison)
const wkRaw = await client.query(`
  SELECT COUNT(*) AS runs,
         ROUND(SUM((data->>'distanceMi')::float)::numeric, 1) AS mi
  FROM runs
  WHERE user_uuid = $1
    AND (data->>'startLocal')::date >= '2026-06-15'
    AND (data->>'startLocal')::date <= '2026-06-21'
`, [UUID]);
console.log(`  raw (no dedup): ${wkRaw.rows[0].runs} runs, ${wkRaw.rows[0].mi}mi`);

// ── 3. Races table ────────────────────────────────────────────────────────
const raceCols = await client.query(`
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'races' ORDER BY ordinal_position
`);
console.log('\nraces cols:', raceCols.rows.map(r=>r.column_name).join(', '));

const race = await client.query(`
  SELECT * FROM races
  WHERE user_uuid = $1 AND race_date >= CURRENT_DATE
  ORDER BY race_date LIMIT 1
`, [UUID]);
if (race.rows[0]) {
  const r = race.rows[0];
  const days = Math.ceil((new Date(r.race_date) - new Date('2026-06-18')) / 86400000);
  console.log(`\n=== NEXT RACE ===`);
  console.log(`  ${JSON.stringify(r)}`);
  console.log(`  ${days}d away = ${(days/7).toFixed(1)}wk, ceil=${Math.ceil(days/7)}wk   display=9 WK`);
}

await client.end();
