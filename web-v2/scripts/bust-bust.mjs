import pg from 'pg';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8').split('\n').reduce((a,l)=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)a[m[1]]=m[2].replace(/^["']|["']$/g,'');return a;},{});
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const r = await pool.query(`DELETE FROM briefings WHERE user_id::text='0645f40c-951d-4ccc-b86e-9979cd26c795'`);
console.log('Busted', r.rowCount, 'briefings');
await pool.end();
