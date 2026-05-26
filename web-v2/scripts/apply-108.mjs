import pg from 'pg';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8').split('\n').reduce((a,l)=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)a[m[1]]=m[2].replace(/^["']|["']$/g,'');return a;},{});
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const sql = fs.readFileSync('db/migrations/108_p34_p36_p37.sql','utf8');
console.log('Applying migration 108…');
await pool.query(sql);
console.log('OK');
await pool.end();
