// PRODUCTION WRITE BARRIER · this file is verification tooling, so it is fenced.
// The fence refuses any database write unless DATABASE_URL is provably loopback,
// and stamps every outgoing request X-Faff-Verification so middleware.ts refuses
// a mutation that would reach production. See scripts/_verification-fence.mjs.
import './_verification-fence.mjs';
import pg from 'pg';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8').split('\n').reduce((a,l)=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)a[m[1]]=m[2].replace(/^["']|["']$/g,'');return a;},{});
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const r = await pool.query(`DELETE FROM runs WHERE data->>'source' = 'apple_watch_test' RETURNING id, data->>'client_workout_id' AS k`);
console.log('Deleted', r.rowCount, 'test rows:', r.rows.map(x=>x.k));
// 2026-08-24 · the briefing cache-bust that used to run here is gone. The
// `briefings` table was dropped from prod, and lib/coach/cache.ts has been a
// no-op shim since the zero-LLM rule landed — /api/briefing recomputes the
// fact block on every read, so deleting the test runs above is enough.
await pool.end();
