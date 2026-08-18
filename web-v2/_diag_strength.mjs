// READ-ONLY diagnostic: does David's HK strength reach strength_sessions?
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const uid = '0645f40c-951d-4ccc-b86e-9979cd26c795';

function row(s) { return s.map(x => String(x ?? '·')).join('  '); }

// 0) confirm who this is
const who = await pool.query(
  `SELECT u.id, u.email, to_char(u.created_at,'YYYY-MM-DD') AS created
     FROM users u WHERE u.id = $1::uuid`, [uid]);
console.log('=== user ===');
console.log(who.rows[0] ?? '(no user row)');

// 1) does strength_sessions table exist + columns
const cols = await pool.query(
  `SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = 'strength_sessions' ORDER BY ordinal_position`);
console.log('\n=== strength_sessions columns ===');
console.log(cols.rows.map(c => `${c.column_name}:${c.data_type}`).join(', ') || '(table missing)');

// 2) ALL strength_sessions for David, ever (count + by source)
const total = await pool.query(
  `SELECT source, COUNT(*) AS n, MIN(date)::text AS first, MAX(date)::text AS last
     FROM strength_sessions WHERE user_uuid = $1::uuid GROUP BY source ORDER BY source`, [uid]);
console.log('\n=== strength_sessions ALL-TIME by source ===');
if (!total.rows.length) console.log('  (ZERO rows ever — nothing has ingested)');
for (const r of total.rows) console.log('  ', row([r.source, 'n='+r.n, 'first='+r.first, 'last='+r.last]));

// 3) recent 35 days, detailed
const recent = await pool.query(
  `SELECT date::text AS date, source, session_type, duration_min,
          LEFT(COALESCE(hk_uuid,''),8) AS hk8, to_char(created_at,'YYYY-MM-DD HH24:MI') AS created
     FROM strength_sessions
    WHERE user_uuid = $1::uuid AND date >= CURRENT_DATE - 35
    ORDER BY date DESC, created_at DESC`, [uid]);
console.log('\n=== strength_sessions last 35d ===');
console.log('  date        source        type            min  hk8       created(UTC)');
if (!recent.rows.length) console.log('  (none in last 35d)');
for (const r of recent.rows)
  console.log('  ', row([r.date, (r.source||'·').padEnd(12), (r.session_type||'·').padEnd(14), String(r.duration_min||'·').padStart(3), (r.hk8||'·').padEnd(8), r.created]));

// 4) sanity: most recent runs (is the account syncing at all?)
const runs = await pool.query(
  `SELECT COALESCE(data->>'date', LEFT(data->>'startLocal',10)) AS d,
          data->>'source' AS src, ROUND((data->>'distanceMi')::numeric,1) AS mi
     FROM runs WHERE user_uuid = $1::uuid AND NOT (data ? 'mergedIntoId')
    ORDER BY 1 DESC LIMIT 6`, [uid]);
console.log('\n=== last 6 runs (account-alive check) ===');
for (const r of runs.rows) console.log('  ', row([r.d, (r.src||'·').padEnd(12), r.mi+'mi']));

// 5) this week window (Mon..Sun containing today, PT)
const wk = await pool.query(
  `SELECT to_char(date_trunc('week', (now() AT TIME ZONE 'America/Los_Angeles'))::date,'YYYY-MM-DD') AS mon,
          to_char((date_trunc('week', (now() AT TIME ZONE 'America/Los_Angeles'))::date + 6),'YYYY-MM-DD') AS sun,
          to_char((now() AT TIME ZONE 'America/Los_Angeles')::date,'YYYY-MM-DD') AS today`);
console.log('\n=== current week (PT) ===');
console.log('  ', wk.rows[0]);

await pool.end();
