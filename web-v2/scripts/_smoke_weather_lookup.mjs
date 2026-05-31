/**
 * Smoke test: hit lookupTempF + baselineTempF for one of David's recent
 * runs and assert non-null values come back. Run from web-v2/.
 */
import pg from 'pg';
import fs from 'fs';

const env = fs.readFileSync('.env.local','utf8').split('\n').reduce((a,l)=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)a[m[1]]=m[2].replace(/^["']|["']$/g,'');return a;},{});
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';

function round1(n) { return Math.round(n * 10) / 10; }

async function lookupTempF(lat, lon, dateISO) {
  const r = await pool.query(
    `SELECT temperature_f FROM workout_weather_cache
      WHERE lat_round = $1::numeric(4,1)
        AND lon_round = $2::numeric(5,1)
        AND date = $3::date LIMIT 1`,
    [round1(lat), round1(lon), dateISO]);
  return r.rows[0]?.temperature_f == null ? null : Number(r.rows[0].temperature_f);
}

async function baselineTempF(lat, lon, todayISO, windowDays = 14) {
  const r = await pool.query(
    `SELECT AVG(temperature_f) AS avg FROM workout_weather_cache
      WHERE lat_round = $1::numeric(4,1) AND lon_round = $2::numeric(5,1)
        AND date BETWEEN $3::date - $4::int AND $3::date
        AND temperature_f IS NOT NULL`,
    [round1(lat), round1(lon), todayISO, windowDays]);
  return r.rows[0]?.avg == null ? null : Math.round(Number(r.rows[0].avg));
}

// Pull a recent David activity with coords
const row = (await pool.query(`
  SELECT id, data->>'date' AS date,
         data->'startLatLng' AS sll,
         data->'weather'->>'temp_f' AS w_temp,
         data->>'tempF' AS tempF
   FROM runs
  WHERE user_uuid = $1 AND data ? 'startLatLng'
  ORDER BY (data->>'date') DESC LIMIT 1
`, [DAVID])).rows[0];

console.log('Recent David activity:', row.id, row.date, 'coords=', JSON.stringify(row.sll), 'weather.temp_f=', row.w_temp, 'tempF=', row.tempF);

const [lat, lon] = row.sll;
const t = await lookupTempF(lat, lon, row.date);
console.log(`lookupTempF(${lat}, ${lon}, '${row.date}') → ${t}`);

const today = new Date().toISOString().slice(0, 10);
const b = await baselineTempF(lat, lon, today, 14);
console.log(`baselineTempF(${lat}, ${lon}, '${today}', 14) → ${b}`);

// Also test the home-base call shape used by prescription
const home = (await pool.query(`
  SELECT (data->'startLatLng'->>0)::text AS lat,
         (data->'startLatLng'->>1)::text AS lng
   FROM runs
  WHERE user_uuid = $1 AND data ? 'startLatLng'
  ORDER BY (data->>'date') DESC LIMIT 1
`, [DAVID])).rows[0];
const hl = Number(home.lat), hg = Number(home.lng);
const bh = await baselineTempF(hl, hg, today, 14);
console.log(`home baseline(${hl}, ${hg}, '${today}', 14) → ${bh}`);

// Quick distribution
const dist = await pool.query(`
  SELECT lat_round, lon_round, COUNT(*) AS n,
         MIN(date) AS earliest, MAX(date) AS latest,
         ROUND(AVG(temperature_f)::numeric, 1) AS avg_temp
   FROM workout_weather_cache GROUP BY lat_round, lon_round ORDER BY n DESC
`);
console.log('\nCache by grid cell:');
console.table(dist.rows);

const passT = t != null;
const passB = b != null;
console.log(`\n${passT && passB ? 'PASS' : 'FAIL'} — lookupTempF=${passT ? 'ok' : 'NULL'}, baselineTempF=${passB ? 'ok' : 'NULL'}`);

await pool.end();
