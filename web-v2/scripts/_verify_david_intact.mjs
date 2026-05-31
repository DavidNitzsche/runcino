import pg from 'pg';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8').split('\n').reduce((a,l)=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)a[m[1]]=m[2].replace(/^["']|["']$/g,'');return a;},{});
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';

const checks = [
  ['training_plans active',     `SELECT COUNT(*) AS n FROM training_plans WHERE user_uuid = $1 AND archived_iso IS NULL`,           1],
  ['training_plans archived',   `SELECT COUNT(*) AS n FROM training_plans WHERE user_uuid = $1 AND archived_iso IS NOT NULL`,       20],
  ['strava_activities',         `SELECT COUNT(*) AS n FROM strava_activities WHERE user_uuid = $1`,                                 100],
  ['races',                     `SELECT COUNT(*) AS n FROM races WHERE user_uuid = $1`,                                             8],
  ['shoes',                     `SELECT COUNT(*) AS n FROM shoes WHERE user_uuid = $1`,                                             5],
  ['profile',                   `SELECT COUNT(*) AS n FROM profile WHERE user_uuid = $1`,                                           1],
  ['niggles',                   `SELECT COUNT(*) AS n FROM niggles WHERE user_uuid = $1`,                                           0],
  ['post_run_rpe',              `SELECT COUNT(*) AS n FROM post_run_rpe WHERE user_uuid = $1`,                                      0],
];
console.log('Verifying David\'s data is still readable post-leak-fix…\n');
let pass = 0, total = 0;
for (const [label, sql, minimum] of checks) {
  total++;
  try {
    const n = Number((await pool.query(sql, [DAVID])).rows[0].n);
    const ok = n >= minimum;
    console.log(`  ${ok ? '✓' : '⚠'} ${label.padEnd(28)} got=${String(n).padStart(4)}  (min ${minimum})`);
    if (ok) pass++;
  } catch (e) { console.log(`  ⚠ ${label.padEnd(28)} ERR ${e.message}`); }
}
console.log(`\n${pass}/${total} David checks pass`);
await pool.end();
