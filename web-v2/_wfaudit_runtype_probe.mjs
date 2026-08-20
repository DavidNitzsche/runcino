// RO probe · verdict-lthr wave1 · runs.data.type value distribution + easy-run avgHr presence.
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const q = await pool.query(`
  SELECT COALESCE(data->>'type','<null>') AS type, COUNT(*) AS n,
         COUNT(*) FILTER (WHERE (data->>'avgHr')::numeric > 0) AS with_hr
    FROM runs GROUP BY 1 ORDER BY n DESC LIMIT 15`);
console.table(q.rows);
const p = await pool.query(`SELECT user_uuid, lthr, max_hr FROM profile LIMIT 5`).catch(e => ({ rows: [], err: String(e) }));
console.log('profile sample:', JSON.stringify(p.rows ?? p.err));
await pool.end();
