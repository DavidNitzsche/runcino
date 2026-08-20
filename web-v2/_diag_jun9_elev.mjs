import { Pool } from 'pg';
const pool = new Pool({connectionString: process.env.DATABASE_URL_RO, ssl: {rejectUnauthorized: false}});

// Jun 9 runs — data is in jsonb
const runs = await pool.query(`
  SELECT
    r.id,
    r.user_uuid,
    to_char((r.data->>'startDate')::timestamptz AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD HH24:MI') as started_local,
    (r.data->>'distanceMi')::float as distance_mi,
    (r.data->>'elevGainFt')::float as elev_gain_ft,
    r.data->>'elevGainSource' as elev_gain_source,
    r.data->>'source' as source,
    CASE WHEN r.data->'splits' IS NOT NULL THEN jsonb_array_length(r.data->'splits') ELSE 0 END as split_count
  FROM runs r
  WHERE (r.data->>'startDate')::timestamptz >= '2026-06-09'::date AT TIME ZONE 'America/Los_Angeles'
    AND (r.data->>'startDate')::timestamptz < '2026-06-10'::date AT TIME ZONE 'America/Los_Angeles'
  ORDER BY (r.data->>'startDate')::timestamptz
`);

console.log("[Jun 9 runs]");
for (const row of runs.rows) {
  console.log(JSON.stringify(row, null, 2));
}

if (runs.rows.length > 0) {
  for (const run of runs.rows) {
    if (parseInt(run.split_count) > 0) {
      console.log("\n[Splits for run " + run.id + "]");
      const r2 = await pool.query("SELECT data->'splits' as sp FROM runs WHERE id=$1", [run.id]);
      const sp = r2.rows[0]?.sp;
      if (sp && sp.length > 0) {
        console.log("split[0] keys:", Object.keys(sp[0]));
        sp.slice(0,5).forEach((s,i) => console.log(" ["+i+"]", JSON.stringify({
          elev_change_ft: s.elev_change_ft,
          elevation_difference: s.elevation_difference,
          elev_ft: s.elev_ft,
        })));
        const pos = sp.reduce((a,s) => {
          const v = Number(s.elev_change_ft ?? s.elevation_difference ?? s.elev_ft ?? 0);
          return a + (v > 0 ? v : 0);
        }, 0);
        console.log("splits-positive sum:", pos.toFixed(1), "ft");
      } else {
        console.log("no splits array");
      }
    }
  }
}

await pool.end();
