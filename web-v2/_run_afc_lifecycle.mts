// One-shot operational run: auto-provisional result detection for David.
// Exactly what the plan-drift cron will do on its next tick; run today per
// David's explicit direction (2026-08-17). Idempotent: SQL guards no-op
// on rerun, and the cron tomorrow will find everything already done.
import { detectAndLogProvisionalResults } from './lib/race/auto-result';
import { pool } from './lib/db/pool';

const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';

const outcomes = await detectAndLogProvisionalResults(DAVID);
console.log(JSON.stringify(outcomes, null, 2));

const check = await pool.query(
  `SELECT slug, actual_result->>'finishDisplay' AS finish,
          actual_result->>'provisional' AS provisional,
          actual_result->>'source' AS source
     FROM races WHERE user_uuid = $1 AND slug = 'americas-finest-city'`, [DAVID]);
console.log('race row:', JSON.stringify(check.rows[0]));

const plans = await pool.query(
  `SELECT id, mode, race_id, archived_iso IS NOT NULL AS archived, archive_reason
     FROM training_plans WHERE user_uuid = $1
    ORDER BY authored_iso DESC LIMIT 3`, [DAVID]);
console.log('plans:', JSON.stringify(plans.rows, null, 1));

const pw = await pool.query(
  `SELECT MIN(date_iso) AS first, MAX(date_iso) AS last, COUNT(*) AS n
     FROM plan_workouts pw JOIN training_plans tp ON tp.id = pw.plan_id
    WHERE tp.user_uuid = $1 AND tp.archived_iso IS NULL`, [DAVID]);
console.log('active plan span:', JSON.stringify(pw.rows[0]));

await pool.end();
process.exit(0);
