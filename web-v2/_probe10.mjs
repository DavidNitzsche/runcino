import { Pool } from 'pg';
const pool = new Pool({connectionString: process.env.DATABASE_URL, ssl: {rejectUnauthorized: false}});
const uid = "0645f40c-951d-4ccc-b86e-9979cd26c795";

// Simulate the form metrics SQL query
console.log("[form metrics from HK filtered by run-day]");
const r = await pool.query(`
  SELECT hs.sample_type, hs.sample_date::date AS d, hs.value
    FROM health_samples hs
   WHERE COALESCE(hs.user_uuid, hs.user_id::uuid) = $1::uuid
     AND hs.sample_type IN ('ground_contact_time','vertical_oscillation','vertical_ratio')
     AND hs.sample_date >= NOW() - interval '60 days'
     AND EXISTS (
       SELECT 1 FROM runs r
        WHERE r.user_uuid = $1::uuid
          AND NOT (r.data ? 'mergedIntoId')
          AND (r.data->>'date')::date = hs.sample_date
     )
   ORDER BY hs.sample_date ASC
`, [uid]);
const byType = {};
for (const row of r.rows) {
  const d = row.d.toISOString().slice(0,10);
  byType[row.sample_type] = byType[row.sample_type] || [];
  byType[row.sample_type].push({d, v: Number(row.value)});
}
for (const k of Object.keys(byType)) {
  const xs = byType[k];
  console.log(`  ${k}: latest=${xs.at(-1).v} on ${xs.at(-1).d} (cnt=${xs.length})`);
}

// what runs have for power, stride, cadence in last 30 days
console.log("\n[runs with power/stride/cadence last 30d]");
const r2 = await pool.query(`
  SELECT (data->>'date')::date AS d, data->>'avgCadence' AS cad, data->>'avgPowerW' AS pw, data->>'avgStrideLengthM' AS st
    FROM runs
   WHERE user_uuid = $1::uuid AND NOT (data ? 'mergedIntoId')
     AND (data->>'date')::date >= NOW() - interval '7 days'
   ORDER BY d DESC LIMIT 10
`, [uid]);
for (const row of r2.rows) {
  console.log(`  ${row.d.toISOString().slice(0,10)} cad=${row.cad} pw=${row.pw} st=${row.st}`);
}

// VO2 series
console.log("\n[vo2_max last 30d]");
const r3 = await pool.query(`
  SELECT sample_date::date AS d, value FROM health_samples
   WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'vo2_max'
     AND sample_date >= NOW() - interval '30 days'
   ORDER BY sample_date DESC LIMIT 20
`, [uid]);
for (const row of r3.rows) {
  console.log(`  ${row.d.toISOString().slice(0,10)} v=${row.value}`);
}

// Test the architecture verdict math: 7-night REM ratio std-dev
console.log("\n[architectureVerdict computation last 7n]");
const r4a = await pool.query(`SELECT sample_date::date AS d, value FROM health_samples WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'sleep_deep_minutes' AND sample_date >= NOW() - interval '28 days' ORDER BY sample_date DESC`, [uid]);
const r4b = await pool.query(`SELECT sample_date::date AS d, value FROM health_samples WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'sleep_rem_minutes' AND sample_date >= NOW() - interval '28 days' ORDER BY sample_date DESC`, [uid]);
const r4c = await pool.query(`SELECT sample_date::date AS d, value FROM health_samples WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'sleep_light_minutes' AND sample_date >= NOW() - interval '28 days' ORDER BY sample_date DESC`, [uid]);
const r4d = await pool.query(`SELECT sample_date::date AS d, value FROM health_samples WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'sleep_awake_minutes' AND sample_date >= NOW() - interval '28 days' ORDER BY sample_date DESC`, [uid]);
const stageMap = new Map();
const stuff = (rows, k) => {
  for (const r of rows) {
    const d = r.d.toISOString().slice(0,10);
    const v = Number(r.value);
    if (!Number.isFinite(v) || v < 0) continue;
    const cur = stageMap.get(d) ?? {};
    cur[k] = v;
    stageMap.set(d, cur);
  }
};
stuff(r4a.rows, 'deep'); stuff(r4b.rows, 'rem'); stuff(r4c.rows, 'light'); stuff(r4d.rows, 'awake');
const sorted = [...stageMap].sort(([a],[b]) => a.localeCompare(b)).slice(-7);
const ratios = [];
for (const [d, s] of sorted) {
  const total = (s.deep ?? 0) + (s.rem ?? 0) + (s.light ?? 0);
  if (total > 0 && s.rem != null) {
    const ratio = s.rem / total;
    ratios.push({d, rem: s.rem, total, ratio: ratio.toFixed(3)});
    console.log(`  ${d} deep=${s.deep} rem=${s.rem} light=${s.light} ratio=${ratio.toFixed(3)}`);
  }
}
const rrs = ratios.map(r => parseFloat(r.ratio));
if (rrs.length >= 4) {
  const mean = rrs.reduce((s,x)=>s+x,0)/rrs.length;
  const variance = rrs.reduce((s,x)=>s+(x-mean)**2,0)/rrs.length;
  const stdev = Math.sqrt(variance);
  const verdict = stdev < 0.04 ? 'stable' : stdev < 0.07 ? 'mixed' : 'unstable';
  console.log(`  stdev=${stdev.toFixed(3)} verdict=${verdict}`);
}

await pool.end();
