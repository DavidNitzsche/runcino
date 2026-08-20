import { Pool } from 'pg';
const pool = new Pool({connectionString: process.env.DATABASE_URL, ssl: {rejectUnauthorized: false}});
const uid = "0645f40c-951d-4ccc-b86e-9979cd26c795";

// Check what's stored in max_hr samples
console.log("\n[max_hr 30d distribution]");
const r1 = await pool.query(`
  SELECT MIN(value) as min_v, MAX(value) as max_v, AVG(value)::numeric(10,1) as avg_v, COUNT(*) as cnt
    FROM health_samples
   WHERE COALESCE(user_uuid, user_id) = $1
     AND sample_type = 'max_hr'
     AND sample_date >= NOW() - interval '30 days'
`, [uid]);
console.log(JSON.stringify(r1.rows[0], null, 2));

console.log("\n[max_hr last 14 raw]");
const r1b = await pool.query(`
  SELECT sample_date, value, recorded_at
    FROM health_samples
   WHERE COALESCE(user_uuid, user_id) = $1
     AND sample_type = 'max_hr'
   ORDER BY sample_date DESC LIMIT 14
`, [uid]);
for (const row of r1b.rows) console.log(`  ${row.sample_date?.toISOString?.()?.slice(0,10) ?? row.sample_date}  v=${row.value}`);

// profile max_hr override
console.log("\n[profile.data]");
const r2 = await pool.query(`SELECT data FROM profiles WHERE user_uuid=$1::uuid OR user_id=$1`, [uid]);
const p = r2.rows[0]?.data ?? {};
console.log(JSON.stringify({maxHr: p.maxHr, age: p.age, biological_sex: p.biological_sex, biologicalSex: p.biologicalSex, restingHr: p.restingHr, restingHR: p.restingHR}, null, 2));

// runs.avgCadence
console.log("\n[runs.avgCadence recent]");
const r3 = await pool.query(`
  SELECT (data->>'date')::date AS d, data->>'avgCadence' AS cad, data->>'maxHr' AS max_hr
    FROM runs
   WHERE user_uuid = $1::uuid
     AND NOT (data ? 'mergedIntoId')
     AND (data->>'date')::date >= NOW() - interval '30 days'
   ORDER BY (data->>'date')::date DESC LIMIT 15
`, [uid]);
for (const row of r3.rows) console.log(`  ${row.d?.toISOString?.()?.slice(0,10) ?? row.d}  cad=${row.cad}  maxHr=${row.max_hr}`);

await pool.end();
