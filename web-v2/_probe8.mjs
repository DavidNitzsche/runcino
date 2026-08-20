import { Pool } from 'pg';
const pool = new Pool({connectionString: process.env.DATABASE_URL, ssl: {rejectUnauthorized: false}});
const uid = "0645f40c-951d-4ccc-b86e-9979cd26c795";

// users cols
console.log("[users cols]");
const t = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='users' ORDER BY ordinal_position`);
for (const r of t.rows) console.log("  " + r.column_name);

console.log("\n[users row]");
const r = await pool.query(`SELECT * FROM users WHERE id=$1`, [uid]);
for (const k of Object.keys(r.rows[0])) {
  const v = r.rows[0][k];
  if (typeof v === 'string' && v.length > 100) console.log(`  ${k}: ${v.slice(0,100)}…`);
  else console.log(`  ${k}: ${v}`);
}

await pool.end();
