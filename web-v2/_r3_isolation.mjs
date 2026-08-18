import pg from 'pg'; import fs from 'fs';
const env=fs.readFileSync('.env.local','utf8');
const url=env.match(/^DATABASE_URL_RO=(.+)$/m)[1].trim().replace(/^["']|["']$/g,'');
const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}}); await c.connect();
const r=await c.query(`SHOW default_transaction_isolation`);
console.log('prod default_transaction_isolation =', r.rows[0].default_transaction_isolation);
const v=await c.query(`SELECT version()`);
console.log('pg version:', v.rows[0].version.split(',')[0]);
await c.end();
