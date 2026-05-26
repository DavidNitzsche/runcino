import pg from 'pg';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8').split('\n').reduce((a,l)=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)a[m[1]]=m[2].replace(/^["']|["']$/g,'');return a;},{});
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const sql = fs.readFileSync('db/migrations/107_p30_p31_p32_p33_p34.sql','utf8');
console.log('Applying migration 107…');
await pool.query(sql);
console.log('OK');
await pool.end();
