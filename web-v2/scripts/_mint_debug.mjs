import pg from 'pg'; import fs from 'node:fs'; import crypto from 'node:crypto';
const env=Object.fromEntries(fs.readFileSync('/private/tmp/core-closure-0904/web-v2/.env.local','utf8').split('\n').map(l=>l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(m=>[m[1],m[2].trim()]));
const U='0645f40c-951d-4ccc-b86e-9979cd26c795';
const MODE=process.argv[2];
const token = process.env.FAFF_DEBUG_TOKEN || crypto.randomBytes(32).toString('hex');
const hash = crypto.createHash('sha256').update(token).digest('hex');
const c=new pg.Client({connectionString:env.DATABASE_URL,ssl:{rejectUnauthorized:false}});await c.connect();
if(MODE==='preview'){
  const {rows}=await c.query("SELECT count(*) n FROM sessions WHERE user_uuid=$1::uuid AND revoked_at IS NULL AND expires_at>NOW()",[U]);
  console.log('PREVIEW ONLY — no write performed.');
  console.log('  live unrevoked sessions for this user now:', rows[0].n);
  console.log('  statement that WOULD run (1 row INSERT):');
  console.log("    INSERT INTO sessions (id,user_id,user_uuid,session_token,kind,expires_at,created_at,last_used_at,user_agent)");
  console.log("    VALUES (gen_random_uuid(), $U, $U, <sha256 of a fresh 32-byte token>, 'debug-verify-2026-09-04',");
  console.log("            NOW() + INTERVAL '1 hour', NOW(), NOW(), 'claude-code physical-verification');");
  console.log('  rollback: UPDATE sessions SET revoked_at=NOW() WHERE kind=$kind  (1 row)');
} else if(MODE==='mint'){
  const {rows}=await c.query(
   `INSERT INTO sessions (id,user_id,user_uuid,session_token,kind,expires_at,created_at,last_used_at,user_agent)
    VALUES (gen_random_uuid(),$1::uuid,$1::uuid,$2,'debug-verify-2026-09-04',NOW()+INTERVAL '1 hour',NOW(),NOW(),'claude-code physical-verification')
    RETURNING id::text, kind, expires_at`,[U,hash]);
  console.log('MINTED 1 row:', JSON.stringify(rows[0]));
  fs.writeFileSync('/tmp/faff-debug-token.txt', token);
  console.log('token written to /tmp/faff-debug-token.txt (not printed)');
} else if(MODE==='revoke'){
  const {rowCount}=await c.query("UPDATE sessions SET revoked_at=NOW() WHERE kind='debug-verify-2026-09-04' AND revoked_at IS NULL",[]);
  console.log('REVOKED rows:', rowCount);
  const {rows}=await c.query("SELECT count(*) n FROM sessions WHERE kind='debug-verify-2026-09-04' AND revoked_at IS NULL");
  console.log('remaining unrevoked debug sessions:', rows[0].n);
  try{fs.unlinkSync('/tmp/faff-debug-token.txt');}catch{}
}
await c.end();
