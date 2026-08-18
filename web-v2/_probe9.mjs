import { Pool } from 'pg';
const pool = new Pool({connectionString: process.env.DATABASE_URL, ssl: {rejectUnauthorized: false}});
const uid = "0645f40c-951d-4ccc-b86e-9979cd26c795";

// Simulate sleep series last 30d like the seed
const sleepSeries = await pool.query(`
  SELECT sample_date::text AS d, value FROM health_samples
  WHERE COALESCE(user_uuid,user_id)=$1 AND sample_type='sleep_hours'
    AND sample_date >= NOW() - interval '30 days'
  ORDER BY sample_date ASC
`, [uid]);
const ss = sleepSeries.rows.map(r => ({d: r.d, h: Number(r.value)})).filter(r => r.h > 0);
console.log(`[sleep_hours last 30d cnt=${ss.length}]`);
const last7 = ss.slice(-7);
const avg7 = last7.length ? +(last7.reduce((s,r)=>s+r.h,0)/last7.length).toFixed(1) : null;
const avg30 = ss.length ? +(ss.reduce((s,r)=>s+r.h,0)/ss.length).toFixed(1) : null;
console.log(`  last 7 = ${last7.map(r => `${r.d.slice(5)}=${r.h}h`).join(', ')}`);
console.log(`  avg7n = ${avg7}`);
console.log(`  avg30n = ${avg30}`);
console.log(`  last_night (Health tile value) = ${ss.at(-1)?.h}h on ${ss.at(-1)?.d}`);

// HRV baseline (mean of last 30d EXCLUDING last 7) and current
console.log('\n[hrv computation]');
const hrvSeries = await pool.query(`
  SELECT recorded_at::date AS d, AVG(value)::numeric AS v
    FROM health_samples
   WHERE COALESCE(user_uuid,user_id)=$1 AND sample_type='hrv'
     AND recorded_at >= NOW() - interval '60 days'
   GROUP BY recorded_at::date ORDER BY d ASC
`, [uid]);
const hrv30 = hrvSeries.rows.slice(-30).map(r => Math.round(Number(r.v)));
console.log(`  last 30d hrv (rounded ms): ${hrv30.join(', ')}`);
console.log(`  current = ${hrv30.at(-1)}`);
const baseline = hrv30.length >= 14
  ? Math.round(hrv30.slice(0, -7).reduce((s,x)=>s+x,0) / Math.max(1, hrv30.length - 7))
  : null;
console.log(`  baseline (30d ex last 7) = ${baseline}`);

// RHR
console.log('\n[rhr computation]');
const rhrSeries = await pool.query(`
  SELECT recorded_at::date AS d, AVG(value)::numeric AS v
    FROM health_samples
   WHERE COALESCE(user_uuid,user_id)=$1 AND sample_type='resting_hr'
     AND recorded_at >= NOW() - interval '60 days'
   GROUP BY recorded_at::date ORDER BY d ASC
`, [uid]);
const rhr30 = rhrSeries.rows.slice(-30).map(r => Math.round(Number(r.v)));
console.log(`  last 30d rhr: ${rhr30.join(', ')}`);
console.log(`  current = ${rhr30.at(-1)}`);
const rhrBaseline = rhr30.length >= 14
  ? Math.round(rhr30.slice(0, -7).reduce((s,x)=>s+x,0) / Math.max(1, rhr30.length - 7))
  : null;
console.log(`  baseline (30d ex last 7) = ${rhrBaseline}`);
console.log(`  delta = ${rhr30.at(-1) - rhrBaseline}`);

// Form metrics
console.log('\n[form metrics from health_samples · seed pulls these]');
for (const mt of ['cadence','ground_contact_time','vertical_oscillation','vertical_ratio','stride_length','run_power']) {
  const r = await pool.query(`
    SELECT sample_date::text AS d, value FROM health_samples
    WHERE COALESCE(user_uuid,user_id)=$1 AND sample_type=$2
      AND sample_date >= NOW() - interval '60 days'
    ORDER BY sample_date DESC LIMIT 3
  `, [uid, mt]);
  if (r.rows.length === 0) {
    console.log(`  ${mt}: NO DATA in 60d`);
  } else {
    console.log(`  ${mt}: latest=${r.rows[0].value} on ${r.rows[0].d} (cnt=${r.rows.length}/3)`);
  }
}

await pool.end();
