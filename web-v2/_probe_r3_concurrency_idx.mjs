import { readFileSync } from 'fs';
import pg from 'pg';
const env = readFileSync('.env.local','utf8');
const m = env.match(/^DATABASE_URL_RO=(.*)$/m);
let url = m ? m[1].trim().replace(/^["']|["']$/g,'') : null;
if (!url) { console.error('NO RO URL'); process.exit(1); }
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
const idx = await c.query(`
  SELECT i.relname AS index_name, ix.indisunique, ix.indisvalid,
         pg_get_indexdef(ix.indexrelid) AS def
  FROM pg_index ix
  JOIN pg_class i ON i.oid = ix.indexrelid
  JOIN pg_class t ON t.oid = ix.indrelid
  WHERE t.relname = 'training_plans'
  ORDER BY ix.indisunique DESC, i.relname;
`);
console.log('=== ALL INDEXES ON training_plans ===');
for (const r of idx.rows) console.log(`${r.indisunique?'UNIQUE':'      '} valid=${r.indisvalid} | ${r.index_name} | ${r.def}`);
const uqActive = idx.rows.find(r => r.indisunique && /archived_iso\s+IS\s+NULL/i.test(r.def) && /user_uuid/i.test(r.def));
console.log('\n=== VERDICT ===');
console.log('partial-unique-active-index present?', uqActive ? `YES (${uqActive.index_name}, valid=${uqActive.indisvalid})` : 'NO');
const dup = await c.query(`
  SELECT user_uuid, COUNT(*) n FROM training_plans
  WHERE archived_iso IS NULL AND user_uuid IS NOT NULL
  GROUP BY user_uuid HAVING COUNT(*) > 1 ORDER BY n DESC LIMIT 10;
`);
console.log('\n=== CURRENT DUPLICATE ACTIVE PLANS (should be 0) ===');
console.log(dup.rows.length === 0 ? '(none — 0 users with >1 active plan)' : JSON.stringify(dup.rows));
await c.end();
