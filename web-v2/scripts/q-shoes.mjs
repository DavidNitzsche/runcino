import pg from 'pg';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8').split('\n').reduce((a,l)=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)a[m[1]]=m[2].replace(/^["']|["']$/g,'');return a;},{});
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const r = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='shoes' ORDER BY ordinal_position`);
for (const c of r.rows) console.log(' ', c.column_name, c.data_type);
await pool.end();
