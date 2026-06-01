// One-shot smoke test for /api/strength DELETE round-trip.
// Provisions a temporary session for the first user, exercises the
// four landed-brief curl flows from inside Node + node-fetch.
//
// Cleans up the session row + any test strength rows on exit.

import { Client } from 'pg';
import crypto from 'crypto';

const DATABASE_URL = process.env.DATABASE_URL;
const BASE = process.env.FAFF_BASE ?? 'https://www.faff.run';
if (!DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(2); }

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function newToken() { return crypto.randomBytes(32).toString('hex'); }

const HKUUID = 'SMOKE-TEST-' + Date.now();
const c = new Client({ connectionString: DATABASE_URL });
await c.connect();

const users = await c.query(
  "SELECT id::text AS uuid, email, name AS full_name FROM users WHERE email = 'dnitch85@me.com' LIMIT 1",
);
if (users.rows.length === 0) { console.error('no users'); await c.end(); process.exit(2); }
const me = users.rows[0];
console.log('user:', me.email, me.uuid);

// Provision a session
const token = newToken();
const hash = sha256(token);
await c.query(
  `INSERT INTO sessions (session_token, user_id, user_uuid, expires_at, kind)
   VALUES ($1, $2, $2, NOW() + interval '1 hour', 'smoke-test')`,
  [hash, me.uuid],
);
console.log('session: provisioned');

async function call(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await r.json(); } catch {}
  return { status: r.status, json };
}

const results = [];
console.log('\n── 1. POST · insert HK strength row ──');
const r1 = await call('POST', '/api/strength', {
  date: new Date().toISOString().slice(0, 10),
  session_type: 'strength',
  duration_min: 45,
  source: 'apple_health',
  hk_uuid: HKUUID,
});
console.log(r1);
results.push(['POST insert', r1.status === 200 && r1.json?.ok === true]);

console.log('\n── 2. DELETE · should remove and return deleted=1 ──');
const r2 = await call('DELETE', '/api/strength?hk_uuid=' + encodeURIComponent(HKUUID));
console.log(r2);
results.push(['DELETE 1st', r2.status === 200 && r2.json?.deleted === 1]);

console.log('\n── 3. DELETE again · idempotent, deleted=0 ──');
const r3 = await call('DELETE', '/api/strength?hk_uuid=' + encodeURIComponent(HKUUID));
console.log(r3);
results.push(['DELETE idempotent', r3.status === 200 && r3.json?.deleted === 0]);

console.log('\n── 4. DELETE · missing hk_uuid · 400 ──');
const r4 = await call('DELETE', '/api/strength');
console.log(r4);
results.push(['DELETE 400', r4.status === 400 && /hk_uuid required/i.test(r4.json?.error || '')]);

console.log('\n── 5. Confirm row absence via GET ──');
const r5 = await call('GET', '/api/strength?days=2');
const stillThere = (r5.json?.sessions ?? r5.json?.rows ?? []).some(
  (s) => s.hk_uuid === HKUUID || s.hkUuid === HKUUID,
);
console.log({ status: r5.status, count: (r5.json?.sessions ?? r5.json?.rows ?? []).length, stillThere });
results.push(['Row absent after DELETE', !stillThere]);

// Cleanup
await c.query(`DELETE FROM sessions WHERE session_token = $1`, [hash]);
await c.query(`DELETE FROM strength_sessions WHERE hk_uuid = $1`, [HKUUID]);
await c.end();

console.log('\n── Results ──');
for (const [name, ok] of results) console.log(ok ? '✓' : '✗', name);
const pass = results.every(([, ok]) => ok);
console.log(pass ? '\nALL PASS' : '\nFAILED');
process.exit(pass ? 0 : 1);
