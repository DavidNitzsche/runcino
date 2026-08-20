import { Pool } from 'pg';
const pool = new Pool({connectionString: process.env.DATABASE_URL, ssl: {rejectUnauthorized: false}});

const r = await pool.query(`
  UPDATE runs
  SET data = jsonb_set(
      jsonb_set(data, '{elevGainFt}', 'null'::jsonb),
      '{elevGainSource}', '"absent"'
    )
  WHERE id = -182722411215424
    AND data->>'date' = '2026-06-09'
  RETURNING id, data->>'elevGainFt' as elev_after, data->>'elevGainSource' as source_after
`);
console.log("rows updated:", r.rowCount);
if (r.rows.length > 0) {
  console.log("after:", JSON.stringify(r.rows[0]));
}
await pool.end();
