import { Pool } from 'pg';
const pool = new Pool({connectionString: process.env.DATABASE_URL_RO, ssl: {rejectUnauthorized: false}});
const r = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='runs' ORDER BY ordinal_position LIMIT 25");
r.rows.forEach(c => console.log(c.column_name, c.data_type));
await pool.end();
