import pg from 'pg';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8').split('\n').reduce((a,l)=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)a[m[1]]=m[2].replace(/^["']|["']$/g,'');return a;},{});
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const sql = fs.readFileSync('db/migrations/110_p35_p39.sql','utf8');
console.log('Applying migration 110…');
try {
  await pool.query(sql);
  console.log('OK');
} catch (e) {
  console.log('Error:', e.message);
  // pgcrypto for gen_random_uuid — try enabling
  if (e.message.includes('gen_random_uuid') || e.message.includes('pgcrypto')) {
    console.log('Enabling pgcrypto…');
    await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await pool.query(sql);
    console.log('OK (with pgcrypto)');
  } else throw e;
}
await pool.end();
