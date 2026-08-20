import { Pool } from 'pg';
const pool = new Pool({connectionString: process.env.DATABASE_URL_RO, ssl: {rejectUnauthorized: false}});

// What date fields does data have?
const sample = await pool.query("SELECT data FROM runs ORDER BY fetched_at DESC LIMIT 3");
for (const row of sample.rows) {
  const keys = Object.keys(row.data).filter(k => k.toLowerCase().includes('date') || k.toLowerCase().includes('start') || k.toLowerCase().includes('time'));
  console.log("date/time keys:", keys);
  keys.forEach(k => console.log("  ", k, "=", row.data[k]));
  console.log("  distanceMi:", row.data.distanceMi, "elevGainFt:", row.data.elevGainFt, "elevGainSource:", row.data.elevGainSource);
  console.log("  source:", row.data.source);
  console.log("  fetched_at:", row.data.fetched_at);
  console.log("---");
}
await pool.end();
