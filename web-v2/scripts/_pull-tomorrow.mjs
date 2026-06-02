import pg from 'pg';
import { readFileSync } from 'fs';
const env = readFileSync('/Volumes/WP/06 Claude Code/Runcino/web-v2/.env.local', 'utf8');
for (const line of env.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
// PDT (UTC-7) local date — matches the web API
const ymd = (d) => d.toISOString().slice(0, 10);
const today = ymd(new Date(Date.now() - 7 * 3600000));
const tomorrow = ymd(new Date(Date.now() - 7 * 3600000 + 86400000));
console.log(`Local today: ${today}   tomorrow: ${tomorrow}\n`);

const cols = (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='profile' ORDER BY ordinal_position`)).rows.map(r=>r.column_name);
const nameCol = cols.find(c => c.toLowerCase().includes('name')) || cols[1];
console.log(`profile columns: ${cols.join(', ')}\n`);

const users = await pool.query(`SELECT user_uuid, ${nameCol} AS name FROM profile LIMIT 5`);
console.log("Users:");
for (const u of users.rows) console.log(`  ${u.name || '?'}  uuid=${u.user_uuid}`);
const userId = users.rows[0].user_uuid;
console.log();

const plan = (await pool.query(
  `SELECT id, authored_iso FROM training_plans WHERE user_uuid = $1 AND archived_iso IS NULL ORDER BY authored_iso DESC LIMIT 1`,
  [userId]
)).rows[0];
console.log(`Active plan id=${plan.id} authored=${plan.authored_iso}\n`);

console.log(`This week's plan rows (★ = tomorrow):`);
const wk = await pool.query(
  `SELECT date_iso, dow, type, distance_mi, sub_label FROM plan_workouts WHERE plan_id = $1 AND date_iso::date BETWEEN $2::date AND ($2::date + 6) ORDER BY date_iso`,
  [plan.id, today]
);
for (const r of wk.rows) {
  const star = r.date_iso === tomorrow ? '★' : ' ';
  console.log(`  ${star} ${r.date_iso} ${r.dow}  ${(r.type||'').padEnd(14)}  ${(r.distance_mi??'').toString().padStart(6)} mi   ${r.sub_label||''}`);
}
console.log();

const wo = (await pool.query(
  `SELECT date_iso, dow, type, distance_mi, sub_label FROM plan_workouts WHERE plan_id = $1 AND date_iso = $2::text`,
  [plan.id, tomorrow]
)).rows[0];
if (!wo) { console.log(`Nothing on ${tomorrow}`); process.exit(0); }
console.log(`Tomorrow's row: ${JSON.stringify(wo, null, 2)}\n`);

await pool.end();
