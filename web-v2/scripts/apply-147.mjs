import pg from 'pg';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8').split('\n').reduce((a,l)=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)a[m[1]]=m[2].replace(/^["']|["']$/g,'');return a;},{});
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

console.log('Applying migration 147 (profile.tt_goal_plan_weeks)…');
const sql = fs.readFileSync('db/migrations/147_profile_tt_goal_plan_weeks.sql', 'utf8');
await pool.query(sql);

const col = await pool.query(`
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_name = 'profile' AND column_name = 'tt_goal_plan_weeks'`);
console.log('✓ tt_goal_plan_weeks column:', col.rows.length ? `present (${col.rows[0].data_type})` : 'MISSING');

await pool.end();
