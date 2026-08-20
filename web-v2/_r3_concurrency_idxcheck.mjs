import pg from 'pg';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8');
const m = env.match(/^DATABASE_URL_RO=(.+)$/m);
const url = m[1].trim().replace(/^["']|["']$/g,'');
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
const idx = await c.query(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename='training_plans' ORDER BY indexname`);
console.log('=== INDEXES on training_plans ===');
for (const r of idx.rows) console.log(r.indexname, '::', r.indexdef);
const valid = await c.query(`
  SELECT c.relname AS idx, i.indisvalid, i.indisunique, pg_get_expr(i.indpred, i.indrelid) AS pred
  FROM pg_class c JOIN pg_index i ON i.indexrelid=c.oid JOIN pg_class t ON t.oid=i.indrelid
  WHERE t.relname='training_plans' AND i.indisunique=true`);
console.log('\n=== UNIQUE index detail (indisvalid matters) ===');
for (const r of valid.rows) console.log(JSON.stringify(r));
const dup = await c.query(`
  SELECT user_uuid, COUNT(*) AS n FROM training_plans
  WHERE archived_iso IS NULL AND user_uuid IS NOT NULL
  GROUP BY user_uuid HAVING COUNT(*)>1 ORDER BY n DESC LIMIT 20`);
console.log('\n=== users with >1 ACTIVE plan RIGHT NOW ===', dup.rowCount);
for (const r of dup.rows) console.log(r.user_uuid,'=>',r.n);
// test user current state
const tu = await c.query(`
  SELECT id, archived_iso, archive_reason, authored_iso
  FROM training_plans WHERE user_uuid='b8b75dd8-0000-0000-0000-000000000000'
  ORDER BY authored_iso DESC NULLS LAST LIMIT 8`).catch(e=>({rows:[],err:e.message}));
console.log('\n=== test-user plans (may need real uuid) ===', tu.err||tu.rowCount);
await c.end();
