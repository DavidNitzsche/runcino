// RO diagnostic — shoe-tracking current state. Read-only; refuses any non-RO URL.
import fs from 'node:fs';
import pg from 'pg';

const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const RO_URL = (env.match(/^DATABASE_URL_RO=(.*)$/m)?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
if (!RO_URL || !/faff_readonly/.test(RO_URL)) {
  console.error('REFUSING: DATABASE_URL_RO must name faff_readonly'); process.exit(1);
}
const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const pool = new pg.Pool({ connectionString: RO_URL });

const q = async (label, sql, params = []) => {
  try { const r = await pool.query(sql, params); console.log(`\n### ${label}`); console.table(r.rows); }
  catch (e) { console.log(`\n### ${label}\n  ERROR: ${e.message}`); }
};

console.log('user:', (await pool.query('SELECT current_user')).rows[0].current_user);

await q('1. auto-assign EVER fired (whole DB)',
  `SELECT COUNT(*) FILTER (WHERE shoe_auto_assigned_at IS NOT NULL) AS auto_assigned,
          COUNT(*) FILTER (WHERE shoe_id IS NOT NULL) AS any_shoe,
          COUNT(*) AS total_runs FROM runs`);

await q('2. shoe_auto_assigned_at column exists?',
  `SELECT column_name FROM information_schema.columns
    WHERE table_name='runs' AND column_name IN ('shoe_id','shoe_auto_assigned_at')`);

await q('3. David garage (shoes)',
  `SELECT id, brand, model, run_types, preferred, retired,
          mileage::numeric AS stored_mi, mileage_cap::numeric AS cap
     FROM shoes WHERE user_uuid=$1 ORDER BY retired, preferred DESC, id`, [DAVID]);

await q('4. David day_actions shoe picks (the dead write)',
  `SELECT date_iso, note AS shoe_id, to_char(created_at,'YYYY-MM-DD HH24:MI') AS created
     FROM day_actions WHERE COALESCE(user_uuid,user_id)=$1 AND action='shoe'
    ORDER BY date_iso DESC LIMIT 20`, [DAVID]);

await q('5. David last 15 canonical runs — shoe state + source',
  `SELECT COALESCE(data->>'date', LEFT(data->>'startLocal',10)) AS d,
          data->>'source' AS source,
          ROUND((data->>'distanceMi')::numeric,2) AS mi,
          shoe_id,
          (shoe_auto_assigned_at IS NOT NULL) AS auto,
          (data ? 'gear') AS has_gear
     FROM runs
    WHERE user_uuid=$1 AND NOT (data ? 'mergedIntoId')
      AND absorbed_into_canonical_at IS NULL
    ORDER BY d DESC LIMIT 15`, [DAVID]);

await q('6. stored mileage vs canonical-run sum per assigned shoe',
  `WITH per_day AS (
     SELECT shoe_id, COALESCE(data->>'date', LEFT(data->>'startLocal',10))::date AS d,
            MAX((data->>'distanceMi')::numeric) AS mi
       FROM runs WHERE user_uuid=$1 AND shoe_id IS NOT NULL AND NOT (data ? 'mergedIntoId')
      GROUP BY shoe_id, 2)
   SELECT s.id, s.brand||' '||s.model AS shoe,
          s.mileage::numeric AS stored_mi,
          COALESCE(SUM(p.mi),0)::numeric(10,2) AS canonical_sum_mi,
          COUNT(p.d) AS assigned_runs
     FROM shoes s LEFT JOIN per_day p ON p.shoe_id=s.id
    WHERE s.user_uuid=$1 GROUP BY s.id, s.brand, s.model, s.mileage
    ORDER BY s.id`, [DAVID]);

await q('7. run source distribution (last 90d) — how dominant is watch/HK',
  `SELECT COALESCE(data->>'source','(null)') AS source, COUNT(*) AS runs
     FROM runs WHERE user_uuid=$1 AND NOT (data ? 'mergedIntoId')
       AND absorbed_into_canonical_at IS NULL
       AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) >= '2026-03-10'
    GROUP BY 1 ORDER BY 2 DESC`, [DAVID]);

await pool.end();
