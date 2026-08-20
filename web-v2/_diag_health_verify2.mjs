import pg from 'pg';
import { readFileSync } from 'fs';
const { Client } = pg;
const env = readFileSync(new URL('./.env.local', import.meta.url), 'utf8');
const dbUrl = env.split('\n').find(l => l.startsWith('DATABASE_URL=')).split('=').slice(1).join('=').trim();
const client = new Client({ connectionString: dbUrl });
await client.connect();
const UUID = '0645f40c-951d-4ccc-b86e-9979cd26c795';

// ── 1. Health samples: when is the most recent data? ─────────────────────
const hkLast = await client.query(`
  SELECT sample_type,
         to_char(MAX(sample_date), 'YYYY-MM-DD') AS latest,
         to_char(MIN(sample_date), 'YYYY-MM-DD') AS oldest,
         COUNT(*) AS n
  FROM health_samples
  WHERE user_uuid = $1
  GROUP BY sample_type
  ORDER BY sample_type
`, [UUID]);
console.log('=== health_samples by type ===');
hkLast.rows.forEach(r =>
  console.log(`  ${r.sample_type.padEnd(25)} n=${String(r.n).padStart(4)}  ${r.oldest} → ${r.latest}`)
);

// ── 2. Most recent samples (no date filter) ────────────────────────────────
const hk = await client.query(`
  SELECT sample_type, to_char(sample_date, 'YYYY-MM-DD') AS dt, ROUND(value::numeric, 1) AS val
  FROM health_samples
  WHERE user_uuid = $1
    AND sample_type IN ('sleep_duration_h','hrv_rmssd_ms','resting_hr_bpm')
  ORDER BY sample_date DESC
  LIMIT 20
`, [UUID]);
console.log('\n=== most recent HK samples (no cutoff) ===');
hk.rows.forEach(r => console.log(`  ${r.sample_type.padEnd(22)} ${r.dt}  ${r.val}`));

const sleep7 = hk.rows.filter(r => r.sample_type === 'sleep_duration_h').slice(0, 7).map(r => Number(r.val));
const hrv7   = hk.rows.filter(r => r.sample_type === 'hrv_rmssd_ms').slice(0, 7).map(r => Number(r.val));
const rhr3   = hk.rows.filter(r => r.sample_type === 'resting_hr_bpm').slice(0, 3).map(r => Number(r.val));
const avg    = a => a.length ? (a.reduce((s,x)=>s+x,0)/a.length).toFixed(1) : 'n/a';
const median = a => { if (!a.length) return 'n/a'; const s=[...a].sort((x,y)=>x-y); const m=Math.floor(s.length/2); return (s.length%2 ? s[m] : (s[m-1]+s[m])/2).toFixed(1); };
const lastNight = hk.rows.find(r => r.sample_type === 'sleep_duration_h');
const lnH = lastNight ? Math.floor(Number(lastNight.val)) : null;
const lnM = lastNight ? Math.round((Number(lastNight.val) - lnH) * 60) : null;
console.log('\n=== DERIVED vs DISPLAY ===');
console.log(`  Sleep 7-night avg:  ${avg(sleep7)}h   display=6.8h`);
console.log(`  HRV 7d median:      ${median(hrv7)}ms  display=51ms`);
console.log(`  RHR 3d avg:         ${avg(rhr3)}bpm display=49bpm`);
console.log(`  Last night:         ${lnH}h ${lnM}m  display=6h 47m`);

// ── 3. Races — find next race from JSONB ─────────────────────────────────
// Columns: slug, plan, gpx_text, meta, actual_result, saved_at, user_uuid, ...
const raceRaw = await client.query(`
  SELECT slug,
         meta,
         plan,
         saved_at
  FROM races
  WHERE user_uuid = $1
  ORDER BY saved_at DESC
  LIMIT 5
`, [UUID]);
console.log('\n=== RACES ===');
raceRaw.rows.forEach(r => {
  const meta = r.meta ?? {};
  const plan = r.plan ?? {};
  // race_date may be in meta or plan
  const raceDate = meta.race_date ?? plan.raceDate ?? meta.raceDate ?? plan.race_date ?? null;
  const raceName = meta.race_name ?? plan.raceName ?? meta.name ?? plan.name ?? meta.title ?? slug;
  console.log(`  slug=${r.slug}  name=${raceName}  race_date=${raceDate}  saved=${r.saved_at?.toISOString().slice(0,10)}`);
  if (raceDate) {
    const today = new Date('2026-06-18');
    const rd = new Date(raceDate);
    const days = Math.ceil((rd - today) / 86400000);
    console.log(`    → ${days}d away = ${(days/7).toFixed(1)}wk, ceil=${Math.ceil(days/7)}wk   display=9 WK`);
  }
});

// ── 4. ACWR — load 0.88 ──────────────────────────────────────────────────
// Chronic = 42-day avg weekly mi; Acute = last 7d mi
// Week = Mon-Sun. Today = Jun 18 Thu.
// Acute window: last 7 days = Jun 12-18
const acute = await client.query(`
  SELECT ROUND(SUM((data->>'distanceMi')::float)::numeric, 2) AS mi
  FROM runs
  WHERE user_uuid = $1
    AND (data->>'startLocal')::date >= '2026-06-12'
    AND (data->>'startLocal')::date <= '2026-06-18'
    AND COALESCE((data->>'mergedIntoId'), '') = ''
`, [UUID]);
// Chronic: 6-week rolling avg starting 42 days back = Apr 7 to Jun 17
const chronic = await client.query(`
  SELECT ROUND(SUM((data->>'distanceMi')::float)::numeric / 6.0, 2) AS mi_per_wk
  FROM runs
  WHERE user_uuid = $1
    AND (data->>'startLocal')::date >= '2026-04-07'
    AND (data->>'startLocal')::date <= '2026-06-17'
    AND COALESCE((data->>'mergedIntoId'), '') = ''
`, [UUID]);
const acuteMi  = Number(acute.rows[0].mi);
const chronicWkMi = Number(chronic.rows[0].mi_per_wk);
const acwr = chronicWkMi > 0 ? (acuteMi / chronicWkMi).toFixed(2) : 'n/a';
console.log('\n=== ACWR ===');
console.log(`  Acute (Jun 12-18): ${acuteMi}mi`);
console.log(`  Chronic 6wk avg:   ${chronicWkMi}mi/wk`);
console.log(`  ACWR:              ${acwr}   display=0.88`);

await client.end();
