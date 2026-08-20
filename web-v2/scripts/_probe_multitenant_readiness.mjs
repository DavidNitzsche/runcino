// Read-only multi-tenancy ground-truth probe (faff_readonly role).
import { readFileSync } from 'node:fs';
import pg from 'pg';

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const ro = env.match(/^DATABASE_URL_RO=(.+)$/m)?.[1]?.trim();
if (!ro) { console.error('no RO url'); process.exit(1); }
const pool = new pg.Pool({ connectionString: ro, max: 1 });

const q = (sql, params = []) => pool.query(sql, params).then(r => r.rows);

// 4. The plan_* chain: confirm scoping is transitive-only
const planCols = await q(`
  SELECT table_name, string_agg(column_name::text, ', ' ORDER BY ordinal_position) AS cols
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name IN ('training_plans','plan_phases','plan_weeks','plan_workouts','plan_mutations','plan_workout_proposals')
   GROUP BY table_name`);
console.log('\nPLAN CHAIN COLUMNS:');
for (const r of planCols) console.log(`  ${r.table_name}: ${r.cols}`);

// 5. Single-user leftovers + the new coach_today_cache
for (const t of ['coach_today_cache', 'workout_rpe', 'strava_sync_state', 'strava_webhook_subscriptions', 'strava_webhook_events', 'workout_library', 'ops_alerts']) {
  const cols = await q(`SELECT string_agg(column_name::text, ', ' ORDER BY ordinal_position) AS cols FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [t]);
  console.log(`\n${t}: ${cols[0]?.cols ?? 'MISSING'}`);
}

// 5b. coach_today_cache sample keys (is it keyed per user?)
const ctc = await q(`SELECT * FROM coach_today_cache LIMIT 3`);
console.log('\ncoach_today_cache sample rows (values truncated):');
for (const r of ctc) {
  const slim = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' && v.length > 60 ? v.slice(0, 60) + '…' : v]));
  console.log(' ', JSON.stringify(slim));
}

// 6. doctrine / research storage in DB?
const doctrine = await q(`
  SELECT table_name FROM information_schema.tables
   WHERE table_schema='public' AND (table_name ILIKE '%doctrine%' OR table_name ILIKE '%research%' OR table_name ILIKE '%knowledge%')`);
console.log('\nDOCTRINE-LIKE TABLES:', doctrine.map(r => r.table_name).join(', ') || 'none');

// 7. RLS check
const rls = await q(`SELECT relname FROM pg_class WHERE relrowsecurity = true AND relnamespace = 'public'::regnamespace`);
console.log('RLS-ENABLED TABLES:', rls.map(r => r.relname).join(', ') || 'none');

await pool.end();
