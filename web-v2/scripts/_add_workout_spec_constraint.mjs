/**
 * _add_workout_spec_constraint.mjs · one-off · add CHECK constraint
 * to plan_workouts enforcing workout_spec presence for non-rest rows.
 *
 * Per iPhone agent's Tier 2.c brief 2026-06-02 · doctrine guard so
 * future inserts can't silently ship a quality workout with NULL spec
 * (the bug class that fragmented the read pipeline). Adds the
 * constraint as NOT VALID so existing archived rows with NULL specs
 * don't trigger immediate errors · future inserts MUST satisfy it.
 *
 * Doctrine: every non-rest/cross/strength row needs a spec. The spec
 * is what expandSpecToPhases reads (the single source of truth for
 * phase rendering across web/iPhone/watch).
 *
 * Run: node web-v2/scripts/_add_workout_spec_constraint.mjs
 *      node web-v2/scripts/_add_workout_spec_constraint.mjs --validate
 *        (the validate flag runs VALIDATE CONSTRAINT against existing
 *         rows · only safe after a full backfill)
 */
import { Pool } from 'pg';

const VALIDATE = process.argv.includes('--validate');
const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL not set.'); process.exit(1); }
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

async function main() {
  // Step 1 · check if constraint already exists.
  const existing = (await pool.query(
    `SELECT 1 FROM pg_constraint
      WHERE conname = 'workout_spec_required'
        AND conrelid = 'plan_workouts'::regclass`,
  )).rowCount;

  if (!existing) {
    console.log('Adding CHECK constraint workout_spec_required (NOT VALID)...');
    await pool.query(
      `ALTER TABLE plan_workouts
        ADD CONSTRAINT workout_spec_required
        CHECK (
          type IN ('rest', 'cross', 'strength')
          OR workout_spec IS NOT NULL
        )
        NOT VALID`,
    );
    console.log('Added. Future inserts must include workout_spec for non-rest types.');
  } else {
    console.log('Constraint workout_spec_required already exists. Skipping ADD.');
  }

  if (VALIDATE) {
    // Pre-count violations.
    const viol = (await pool.query(
      `SELECT COUNT(*)::text AS n
         FROM plan_workouts
        WHERE type NOT IN ('rest','cross','strength')
          AND workout_spec IS NULL`,
    )).rows[0];
    console.log(`Existing rows that violate constraint: ${viol.n}`);
    if (Number(viol.n) > 0) {
      console.log('REFUSING VALIDATE · backfill the violators first.');
      process.exit(2);
    }
    console.log('Running VALIDATE CONSTRAINT...');
    await pool.query(
      `ALTER TABLE plan_workouts VALIDATE CONSTRAINT workout_spec_required`,
    );
    console.log('Validated. Constraint now strict against existing rows too.');
  } else {
    console.log('(skip · pass --validate to run VALIDATE CONSTRAINT after backfill)');
  }

  // Smoke test · try a violating insert (should fail).
  try {
    await pool.query(
      `INSERT INTO plan_workouts (id, plan_id, week_id, date_iso, dow, type, distance_mi)
       VALUES ('test_constraint_violation', 'NOPE', 'NOPE', '2099-01-01', 0, 'intervals', 5)`,
    );
    console.log('SMOKE FAIL · violating insert succeeded · constraint did not catch.');
    await pool.query(`DELETE FROM plan_workouts WHERE id = 'test_constraint_violation'`);
  } catch (e) {
    if (String(e.message ?? e).includes('workout_spec_required')) {
      console.log('Smoke OK · violating insert rejected by constraint.');
    } else {
      console.log('Smoke caught a different error (expected · plan_id FK probably):', String(e.message).slice(0, 100));
    }
  }

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
