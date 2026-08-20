// STATE AUDIT 2026-06-09 · Part 0: orientation — user, tables, basic counts. RO.
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL_RO, ssl: { rejectUnauthorized: false } });

const q = async (label, sql, params = []) => {
  try {
    const r = await pool.query(sql, params);
    console.log(`\n=== ${label} ===`);
    console.table(r.rows);
    return r.rows;
  } catch (e) {
    console.log(`\n=== ${label} === ERROR: ${e.message}`);
    return [];
  }
};

await q('users', `SELECT id, email, created_at::date FROM users ORDER BY created_at LIMIT 5`);
await q('profile', `SELECT user_uuid, display_name, timezone, max_hr, lthr, resting_hr, vdot, birthday, experience_level FROM profile LIMIT 5`);
await q('tables', `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`);
await q('runs count by source', `SELECT data->>'source' AS source, COUNT(*), MIN(COALESCE(data->>'date', LEFT(data->>'startLocal',10))) AS first, MAX(COALESCE(data->>'date', LEFT(data->>'startLocal',10))) AS last FROM runs GROUP BY 1 ORDER BY 2 DESC`);
await q('training_plans', `SELECT id, user_uuid, race_slug, status, archived_iso, created_iso, meta->>'lockedAt' AS locked_at FROM training_plans ORDER BY created_iso DESC LIMIT 8`);
await pool.end();
