/**
 * _verify_uuid_unification.mjs · post-126 unification probe.
 *
 * For every table that migration 126 touched, asserts:
 *   - user_uuid column exists and is uuid-typed
 *   - has a FK to users(id)
 *   - has an index on user_uuid
 *   - ZERO rows have user_id NOT NULL but user_uuid IS NULL (i.e., fully backfilled)
 *
 * Also confirms the BOTH-column legacy tables (training_plans, profile,
 * coach_proposals, etc.) are similarly clean — every row that has a user_id
 * also has a user_uuid.
 *
 * Run with: node scripts/_verify_uuid_unification.mjs
 */
import pg from 'pg';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8').split('\n').reduce((a,l)=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)a[m[1]]=m[2].replace(/^["']|["']$/g,'');return a;},{});
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Tables migration 126 added user_uuid to.
const MIGRATION_126_TABLES = [
  'briefings','check_ins','coach_intent','coach_intents','coach_usage',
  'connector_tokens','day_actions','device_tokens','health_samples','niggles',
  'notifications_log','notifications_pending','sessions','sick_episodes',
  'workout_completions','workout_routes',
];

// Tables that already had BOTH user_id text + user_uuid uuid (pre-126).
const BOTH_LEGACY_TABLES = [
  'coach_actions','coach_proposals','coach_reads_cache','cross_training_sessions',
  'daily_checkin','personal_goals','post_run_rpe','profile','runner_illnesses',
  'runner_injuries','runner_notes','skipped_workouts','strength_sessions',
  'training_plans','user_prefs',
];

let pass = 0, total = 0, fail = 0;

function ok(label) { console.log(`  OK   ${label}`); pass++; total++; }
function bad(label, detail = '') { console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`); fail++; total++; }

console.log('=== Schema check: migration 126 tables ===');
for (const t of MIGRATION_126_TABLES) {
  const cols = (await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1 AND column_name='user_uuid'`,
    [t]
  )).rows;
  if (cols.length === 0 || cols[0].data_type !== 'uuid') {
    bad(`${t}.user_uuid column`, cols[0]?.data_type ?? 'missing');
    continue;
  }
  // FK?
  const fks = (await pool.query(
    `SELECT 1 FROM pg_constraint c
      JOIN pg_attribute a ON a.attnum = ANY(c.conkey) AND a.attrelid = c.conrelid
     WHERE c.contype='f' AND c.conrelid::regclass::text=$1
       AND a.attname='user_uuid' AND c.confrelid::regclass::text='users'`,
    [t]
  )).rows;
  if (fks.length === 0) {
    bad(`${t}.user_uuid FK to users`, 'missing');
    continue;
  }
  // Index?
  const idx = (await pool.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename=$1 AND indexdef LIKE '%(user_uuid%'`,
    [t]
  )).rows;
  if (idx.length === 0) {
    bad(`${t}.user_uuid index`, 'missing');
    continue;
  }
  ok(`${t} — user_uuid + FK + index present`);
}

console.log('\n=== Backfill check: no orphan user_id without user_uuid ===');
for (const t of [...MIGRATION_126_TABLES, ...BOTH_LEGACY_TABLES]) {
  try {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS n FROM "${t}" WHERE user_id IS NOT NULL AND user_uuid IS NULL`
    );
    const n = r.rows[0].n;
    if (n === 0) ok(`${t} — zero rows with user_id but no user_uuid`);
    else bad(`${t} — ${n} rows have user_id but NULL user_uuid`);
  } catch (e) {
    bad(`${t} — query failed: ${e.message}`);
  }
}

console.log('\n=== David visibility on user_uuid ===');
const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
for (const t of [...MIGRATION_126_TABLES, ...BOTH_LEGACY_TABLES]) {
  try {
    const r = await pool.query(`SELECT COUNT(*)::int AS n FROM "${t}" WHERE user_uuid = $1`, [DAVID]);
    const n = r.rows[0].n;
    // Tables with rows that David should own.
    const expectsDavid = ['training_plans','profile','user_prefs','niggles','sessions','health_samples',
                          'coach_usage','briefings','check_ins','coach_intents','coach_actions',
                          'coach_proposals','daily_checkin','day_actions','connector_tokens',
                          'device_tokens','notifications_pending','workout_completions','workout_routes',
                          'post_run_rpe','sick_episodes'];
    if (expectsDavid.includes(t) && n === 0) {
      bad(`${t} — David has 0 rows on user_uuid (expected some)`);
    } else {
      ok(`${t} — David has ${n} rows on user_uuid`);
    }
  } catch (e) {
    bad(`${t} — query failed: ${e.message}`);
  }
}

console.log(`\n=== Summary ===`);
console.log(`  pass=${pass}  fail=${fail}  total=${total}`);
await pool.end();
process.exit(fail === 0 ? 0 : 1);
