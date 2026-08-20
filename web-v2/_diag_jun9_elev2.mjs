import { Pool } from 'pg';
const pool = new Pool({connectionString: process.env.DATABASE_URL_RO, ssl: {rejectUnauthorized: false}});

// Get the Jun 9 run in detail
const r = await pool.query("SELECT id, data FROM runs WHERE data->>'date' = '2026-06-09' ORDER BY id DESC LIMIT 3");
for (const row of r.rows) {
  console.log("=== run", row.id, "===");
  console.log("elevGainFt:", row.data.elevGainFt);
  console.log("elevGainSource:", row.data.elevGainSource);
  console.log("distanceMi:", row.data.distanceMi);
  console.log("source:", row.data.source);
  const splits = row.data.splits;
  if (splits) {
    console.log("splits count:", splits.length);
    console.log("split[0] keys:", Object.keys(splits[0]));
    splits.slice(0,5).forEach((s,i) => console.log(" ["+i+"]", JSON.stringify({
      elev_change_ft: s.elev_change_ft,
      elevation_difference: s.elevation_difference,
      elev_ft: s.elev_ft,
      pace: s.pace,
    })));
    const pos = splits.reduce((a,s) => {
      const v = Number(s.elev_change_ft ?? s.elevation_difference ?? s.elev_ft ?? 0);
      return a + (v > 0 ? v : 0);
    }, 0);
    const neg = splits.reduce((a,s) => {
      const v = Number(s.elev_change_ft ?? s.elevation_difference ?? s.elev_ft ?? 0);
      return a + (v < 0 ? v : 0);
    }, 0);
    console.log("splits-positive sum:", pos.toFixed(1), "ft");
    console.log("splits-negative sum:", neg.toFixed(1), "ft");
  } else {
    console.log("NO SPLITS");
  }
}
await pool.end();
