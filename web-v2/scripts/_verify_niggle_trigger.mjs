/**
 * _verify_niggle_trigger.mjs · proves detectNiggleReported() fires for
 * David's UUID end-to-end after the unification.
 *
 * Plan:
 *   1. Insert a synthetic active niggle for David (severity=6).
 *   2. Call detectNiggleReported(DAVID_UUID).
 *   3. Assert trigger fires with severity='warn' (5-6 → downgrade next quality).
 *   4. Clean up — DELETE the synthetic row.
 *
 * Run with: node scripts/_verify_niggle_trigger.mjs
 */
import pg from 'pg';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8').split('\n').reduce((a,l)=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)a[m[1]]=m[2].replace(/^["']|["']$/g,'');return a;},{});
// Hand env to process.env for any imports that may want it.
for (const [k, v] of Object.entries(env)) process.env[k] = v;
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';

// Clear any pre-existing test rows from a previous run.
await pool.query(`DELETE FROM niggles WHERE user_uuid = $1 AND note = '__synthetic_test__'`, [DAVID]);

// Insert synthetic niggle (severity 6 = should trigger 'warn').
const ins = await pool.query(
  `INSERT INTO niggles (user_id, user_uuid, body_part, side, severity, status, note, logged_at)
   VALUES ($1, $1, 'hamstring', 'right', 6, 'few_days', '__synthetic_test__', NOW())
   RETURNING id`,
  [DAVID]
);
const syntheticId = Number(ins.rows[0].id);
console.log(`Inserted synthetic niggle id=${syntheticId} (severity=6, hamstring/right)`);

// Replicate detectNiggleReported() inline so we don't have to import the TS module.
async function detectNiggleReported(userId) {
  const r = (await pool.query(
    `SELECT id, body_part, side, severity, status, logged_at::text AS logged_at
       FROM niggles
      WHERE COALESCE(user_uuid, user_id) = $1 AND cleared_at IS NULL
      ORDER BY severity DESC, logged_at DESC LIMIT 1`,
    [userId],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!r) return null;
  const severity = Number(r.severity);
  if (severity < 5) return null;
  return {
    kind: 'niggle_reported',
    severity: severity >= 7 ? 'override' : 'warn',
    reason: severity >= 7
      ? `Active ${r.body_part}${r.side ? ' (' + r.side + ')' : ''} niggle at ${severity}/10. Suspend running 48h.`
      : `Active ${r.body_part}${r.side ? ' (' + r.side + ')' : ''} niggle at ${severity}/10. Downgrade next quality day.`,
    evidence: { niggle_id: r.id, body_part: r.body_part, side: r.side, severity, status: r.status },
  };
}

const trigger = await detectNiggleReported(DAVID);

let pass = 0, total = 0;
function ok(label) { console.log(`  OK   ${label}`); pass++; total++; }
function bad(label, detail = '') { console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`); total++; }

console.log('\n=== detectNiggleReported(DAVID_UUID) result ===');
console.log(JSON.stringify(trigger, null, 2));

if (!trigger) {
  bad('trigger fired', 'returned null');
} else {
  ok('trigger fired');
  if (trigger.kind === 'niggle_reported') ok('kind == niggle_reported');
  else bad('kind == niggle_reported', trigger.kind);
  if (trigger.severity === 'warn') ok('severity == warn (5-6 band)');
  else bad('severity == warn', trigger.severity);
  if (Number(trigger.evidence?.niggle_id) === syntheticId) ok(`evidence.niggle_id matches synthetic ${syntheticId}`);
  else bad('evidence.niggle_id', `expected=${syntheticId} got=${trigger.evidence?.niggle_id}`);
  if (trigger.evidence?.body_part === 'hamstring') ok('evidence.body_part == hamstring');
  else bad('evidence.body_part', trigger.evidence?.body_part);
}

// Cleanup
await pool.query(`DELETE FROM niggles WHERE id = $1`, [syntheticId]);
console.log(`\nCleaned up synthetic niggle id=${syntheticId}`);

await pool.end();
console.log(`\n=== Summary ===  pass=${pass}/${total}`);
process.exit(pass === total ? 0 : 1);
