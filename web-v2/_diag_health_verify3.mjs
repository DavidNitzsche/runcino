import pg from 'pg';
import { readFileSync } from 'fs';
const { Client } = pg;
const env = readFileSync(new URL('./.env.local', import.meta.url), 'utf8');
const dbUrl = env.split('\n').find(l => l.startsWith('DATABASE_URL=')).split('=').slice(1).join('=').trim();
const client = new Client({ connectionString: dbUrl });
await client.connect();
const UUID = '0645f40c-951d-4ccc-b86e-9979cd26c795';

// ── 1. HK with correct sample_type names ─────────────────────────────────
const hk = await client.query(`
  SELECT sample_type, to_char(sample_date, 'YYYY-MM-DD') AS dt, ROUND(value::numeric, 2) AS val
  FROM health_samples
  WHERE user_uuid = $1
    AND sample_type IN ('sleep_hours','hrv','resting_hr')
  ORDER BY sample_date DESC
  LIMIT 30
`, [UUID]);
console.log('=== HK samples (correct type names) ===');
hk.rows.forEach(r => console.log(`  ${r.sample_type.padEnd(15)} ${r.dt}  ${r.val}`));

const sleep7 = hk.rows.filter(r => r.sample_type === 'sleep_hours').slice(0, 7).map(r => Number(r.val));
const hrv7   = hk.rows.filter(r => r.sample_type === 'hrv').slice(0, 7).map(r => Number(r.val));
const rhr3   = hk.rows.filter(r => r.sample_type === 'resting_hr').slice(0, 3).map(r => Number(r.val));
const avg    = a => a.length ? (a.reduce((s,x)=>s+x,0)/a.length).toFixed(1) : 'n/a';
const median = a => { if (!a.length) return 'n/a'; const s=[...a].sort((x,y)=>x-y); const m=Math.floor(s.length/2); return (s.length%2 ? s[m] : (s[m-1]+s[m])/2).toFixed(1); };
const lastNight = hk.rows.find(r => r.sample_type === 'sleep_hours');
const lnRaw = lastNight ? Number(lastNight.val) : null;
const lnH = lnRaw ? Math.floor(lnRaw) : null;
const lnM = lnRaw ? Math.round((lnRaw - lnH) * 60) : null;

const sleepTotal = sleep7.reduce((s,x)=>s+x,0);
console.log('\n=== DERIVED vs DISPLAY ===');
console.log(`  Sleep 7-night avg:  ${avg(sleep7)}h   display=6.8h   total=${sleepTotal.toFixed(1)}h`);
console.log(`  HRV 7d median:      ${median(hrv7)}ms  display=51ms   data=[${hrv7.join(',')}]`);
console.log(`  RHR 3d avg:         ${avg(rhr3)}bpm display=49bpm  data=[${rhr3.join(',')}]`);
console.log(`  Last night:         ${lnH}h ${lnM}m  display=6h 47m  (${lastNight?.dt} raw=${lnRaw})`);

// ── 2. AFC race — inspect JSONB ────────────────────────────────────────────
const afc = await client.query(`
  SELECT slug, meta, plan FROM races WHERE slug = 'americas-finest-city'
`, []);
if (afc.rows[0]) {
  console.log('\n=== AFC race meta (keys) ===');
  const meta = afc.rows[0].meta ?? {};
  const plan = afc.rows[0].plan ?? {};
  console.log('meta:', JSON.stringify(meta, null, 2));
  console.log('plan (top-level keys):', Object.keys(plan).join(', '));
  // Look for race date anywhere in plan
  const findDate = (obj, prefix='') => {
    for (const [k,v] of Object.entries(obj||{})) {
      if (typeof v === 'string' && /\d{4}-\d{2}-\d{2}/.test(v)) console.log(`  plan.${prefix}${k} = ${v}`);
      if (v && typeof v === 'object' && !Array.isArray(v)) findDate(v, prefix+k+'.');
    }
  };
  findDate(plan);
}

// ── 3. ACWR — find what the app actually computes ─────────────────────────
// Try: Acute = this week (Jun 15-18 through today), Chronic = last 4 full weeks avg
const weeklyMi = await client.query(`
  SELECT
    to_char(date_trunc('week', (data->>'startLocal')::timestamp + interval '1 day') - interval '1 day', 'YYYY-MM-DD') AS week_start_mon,
    ROUND(SUM((data->>'distanceMi')::float)::numeric, 1) AS mi
  FROM runs
  WHERE user_uuid = $1
    AND (data->>'startLocal')::date >= '2026-05-01'
    AND COALESCE((data->>'mergedIntoId'), '') = ''
  GROUP BY week_start_mon
  ORDER BY week_start_mon DESC
  LIMIT 8
`, [UUID]);
console.log('\n=== Weekly mileage (Mon weeks) ===');
weeklyMi.rows.forEach(r => console.log(`  ${r.week_start_mon}  ${r.mi}mi`));

// Compute ACWR: acute = this week (partial), chronic = 4-week rolling avg of PREVIOUS weeks
const weeks = weeklyMi.rows.map(r => Number(r.mi));
const acuteMi = weeks[0] ?? 0; // current partial week
const chronic4 = weeks.length >= 4 ? (weeks.slice(1,5).reduce((s,x)=>s+x,0)/4).toFixed(1) : 'n/a';
const acwr = chronic4 !== 'n/a' ? (acuteMi / Number(chronic4)).toFixed(2) : 'n/a';
console.log(`\nAcute (current week partial): ${acuteMi}mi`);
console.log(`Chronic 4-wk avg (prev 4 full weeks): ${chronic4}mi/wk`);
console.log(`ACWR: ${acwr}   display=0.88`);

await client.end();
