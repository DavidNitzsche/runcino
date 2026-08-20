import pg from 'pg'; import fs from 'fs';
const env=fs.readFileSync('.env.local','utf8');
const url=env.match(/^DATABASE_URL_RO=(.+)$/m)[1].trim().replace(/^["']|["']$/g,'');
const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}}); await c.connect();
const UUID='b8b75dd8-2a04-48b4-8896-44897d9e0b25';

// 1. ALL constraints on training_plans (unique/pk/exclusion)
const cons=await c.query(`
  SELECT conname, contype, pg_get_constraintdef(oid) AS def
  FROM pg_constraint WHERE conrelid='training_plans'::regclass ORDER BY contype`);
console.log('=== CONSTRAINTS on training_plans ===');
for(const r of cons.rows) console.log(`[${r.contype}] ${r.conname} :: ${r.def}`);

// 2. The two identical-microsecond plans from the prior auditor's Promise.all
const twins=await c.query(`
  SELECT id, to_char(authored_iso,'YYYY-MM-DD HH24:MI:SS.US') AS authored,
         to_char(archived_iso,'YYYY-MM-DD HH24:MI:SS.US') AS archived,
         archive_reason, race_id
  FROM training_plans
  WHERE user_uuid=$1 AND authored_iso = '2026-06-21 23:11:39.498'::timestamptz
  ORDER BY id`,[UUID]);
console.log('\n=== TWIN plans authored @ exact same instant (prior auditor Promise.all) ===', twins.rowCount);
for(const r of twins.rows) console.log(JSON.stringify(r));

// 3. Were they EVER simultaneously active? (both archived later, by the cleanup)
//    Check: any window where 2 rows had archived_iso IS NULL is gone now (cleaned), but
//    the fact both were inserted with archived_iso=NULL and both later archived by the SAME
//    manual cleanup reason proves the double-active state existed.
const sameReason=await c.query(`
  SELECT archive_reason, COUNT(*) n, MIN(to_char(authored_iso,'HH24:MI:SS.US')) min_auth, MAX(to_char(authored_iso,'HH24:MI:SS.US')) max_auth
  FROM training_plans WHERE user_uuid=$1 AND archive_reason='r3_audit_cleanup_concurrency'
  GROUP BY archive_reason`,[UUID]);
console.log('\n=== plans archived by the concurrency-cleanup (proves a human/script had to clean up >1 active) ===');
for(const r of sameReason.rows) console.log(JSON.stringify(r));

// 4. broader: ANY two plans for ANY user with byte-identical authored_iso microsecond (concurrency fingerprint)
const fp=await c.query(`
  SELECT user_uuid::text uu, to_char(authored_iso,'YYYY-MM-DD HH24:MI:SS.US') auth, COUNT(*) n
  FROM training_plans WHERE user_uuid IS NOT NULL
  GROUP BY user_uuid, authored_iso HAVING COUNT(*)>1
  ORDER BY n DESC, auth DESC LIMIT 20`);
console.log('\n=== concurrency fingerprint: same-user same-microsecond multi-insert (any user) ===', fp.rowCount);
for(const r of fp.rows) console.log(r.uu.slice(0,8), r.auth, '->', r.n);
await c.end();
