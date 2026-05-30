import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// SIM-08: What does the data layer look like for a fresh user with NO data?
// We CREATE a synthetic user row + nothing else, then query every state
// loader's source as a brand-new user would.

const SYNTH = '99999999-0000-0000-0000-000000000001';

try {
  // Clean up any prior synthetic
  await pool.query(`DELETE FROM users WHERE id = $1`, [SYNTH]);

  // Insert a barebones user (just id + email + name + auth fields)
  await pool.query(
    `INSERT INTO users (id, email, password_hash, name, status, is_admin, timezone)
     VALUES ($1, $2, $3, $4, 'active', false, $5)
     ON CONFLICT (id) DO NOTHING`,
    [SYNTH, 'sim-cold-start@example.test', 'NO_HASH', 'Cold Start Test', 'America/Los_Angeles']
  );

  console.log('=== SIM-08 · Cold-start user data layer ===');

  const checks = [
    { name: 'users row', sql: `SELECT id, email, name, age, sex, max_hr, resting_hr FROM users WHERE id=$1` },
    { name: 'profile row', sql: `SELECT user_uuid, height_cm, lthr, experience_level FROM profile WHERE user_uuid=$1` },
    { name: 'user_prefs row', sql: `SELECT user_uuid, long_run_dow FROM user_prefs WHERE user_uuid=$1` },
    { name: 'training_plans active', sql: `SELECT id, mode FROM training_plans WHERE user_uuid=$1 AND archived_iso IS NULL` },
    { name: 'strava_activities', sql: `SELECT COUNT(*)::int AS n FROM strava_activities WHERE user_uuid=$1` },
    { name: 'health_samples', sql: `SELECT COUNT(*)::int AS n FROM health_samples WHERE user_id=$1` },
    { name: 'races', sql: `SELECT slug FROM races WHERE user_uuid=$1` },
    { name: 'connector_tokens', sql: `SELECT provider FROM connector_tokens WHERE user_id=$1` },
    { name: 'check_ins', sql: `SELECT COUNT(*)::int AS n FROM check_ins WHERE user_id=$1` },
    { name: 'shoes', sql: `SELECT id FROM shoes WHERE user_uuid=$1` },
  ];

  for (const c of checks) {
    const r = await pool.query(c.sql, [SYNTH]).catch(e => ({ rows: [], err: e.message }));
    console.log(`  ${c.name.padEnd(25)} → ${r.rows.length} rows${r.err ? ' (err: ' + r.err + ')' : ''}`);
    if (r.rows.length > 0 && r.rows.length <= 3) {
      for (const row of r.rows) console.log(`    ${JSON.stringify(row)}`);
    }
  }

  console.log('\n=== What does the state-loader see for a cold-start user? ===');
  // Simulate the loadCoachState path
  const planQuery = await pool.query(
    `SELECT id FROM training_plans WHERE (user_uuid = $1 OR user_id = 'me') AND archived_iso IS NULL ORDER BY authored_iso DESC LIMIT 1`,
    [SYNTH]
  );
  console.log(`  plan lookup → ${planQuery.rows.length === 0 ? 'NULL (no plan yet)' : planQuery.rows[0].id}`);

  const nextARaceQuery = await pool.query(
    `SELECT slug FROM races WHERE (user_uuid = $1 OR user_uuid IS NULL) AND meta->>'priority' = 'A' AND (meta->>'date')::date >= CURRENT_DATE ORDER BY (meta->>'date') ASC LIMIT 1`,
    [SYNTH]
  );
  console.log(`  next A-race → ${nextARaceQuery.rows.length === 0 ? 'NULL (no race yet)' : nextARaceQuery.rows[0].slug}`);

  const profQuery = await pool.query(
    `SELECT lthr, experience_level FROM profile WHERE user_uuid = $1 OR (user_uuid IS NULL AND user_id = 'me')`,
    [SYNTH]
  );
  console.log(`  profile lookup → ${profQuery.rows.length === 0 ? 'NULL (no profile)' : JSON.stringify(profQuery.rows[0])}`);

  console.log('\n=== Cleanup ===');
  await pool.query(`DELETE FROM users WHERE id = $1`, [SYNTH]);
  console.log('  synth user deleted');
} catch (e) { console.error(e); }
finally { await pool.end(); }
