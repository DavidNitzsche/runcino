import { Pool } from 'pg';
const pool = new Pool({connectionString: process.env.DATABASE_URL, ssl: {rejectUnauthorized: false}});
const uid = "0645f40c-951d-4ccc-b86e-9979cd26c795";

// 12-month max_hr
console.log("[hk max_hr 12mo MAX]");
const r1 = await pool.query(`SELECT MAX(value::numeric) AS v FROM health_samples WHERE COALESCE(user_uuid,user_id)=$1 AND sample_type='max_hr' AND sample_date >= NOW() - interval '365 days'`, [uid]);
console.log(`  hk_max=${r1.rows[0].v}`);

console.log("[runs maxHr 12mo MAX]");
const r2 = await pool.query(`SELECT MAX((data->>'maxHr')::numeric) AS v FROM runs WHERE user_uuid=$1::uuid AND NOT (data ? 'mergedIntoId') AND data->>'maxHr' IS NOT NULL AND (data->>'maxHr')::numeric BETWEEN 100 AND 230 AND (data->>'date')::date >= NOW() - interval '365 days'`, [uid]);
console.log(`  runs_max=${r2.rows[0].v}`);

// users table
console.log("\n[users row for david]");
const r3 = await pool.query(`SELECT id, email, max_hr, max_hr_override, biological_sex, dob FROM users WHERE id=$1`, [uid]);
console.log(JSON.stringify(r3.rows[0], null, 2));

// runner_profile
console.log("\n[runner_profile if exists]");
const r4 = await pool.query(`SELECT * FROM runner_profile WHERE user_uuid=$1::uuid LIMIT 1`, [uid]);
if (r4.rows[0]) {
  for (const k of Object.keys(r4.rows[0])) {
    const v = r4.rows[0][k];
    if (typeof v === 'object' && v !== null) console.log(`  ${k}: ${JSON.stringify(v).slice(0,150)}`);
    else console.log(`  ${k}: ${v}`);
  }
}

await pool.end();
