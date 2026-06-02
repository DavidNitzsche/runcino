/**
 * _bump_long_floor.mjs · one-off · retroactively apply the 2026-06-03
 * long-floor fix to David's active plan.
 *
 * The bug: layoutWeek sized long runs from `weeklyMi × longShare`
 * where `weeklyMi` was the volumeCurve target (e.g. 35.7 for David's
 * baseline), NOT the actual emerging weekly total (e.g. 42.5 after
 * easyMileFloor inflated easies). Result: Sunday long was 9mi when
 * David's recent 5/31 long was 12.36mi.
 *
 * The fix (now live in lib/plan/generate.ts): long = max(longMiRaw,
 * recentPeakLongMi - cutbackMargin) capped at tier upper.
 *
 * This script applies the new policy to David's existing plan_workouts
 * rows · only UPs the long-run distance where the existing row is below
 * the new floor. Never decreases.
 *
 * Usage:
 *   node scripts/_bump_long_floor.mjs          (dry-run, print diffs)
 *   node scripts/_bump_long_floor.mjs --commit (apply UPDATE)
 */
import { Pool } from 'pg';

const COMMIT = process.argv.includes('--commit');
const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL not set.'); process.exit(1); }
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

async function main() {
  // 1. Find David's active plan
  const plan = (await pool.query(
    `SELECT id, race_id, authored_iso FROM training_plans
      WHERE user_uuid = $1 AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [DAVID],
  )).rows[0];
  if (!plan) { console.log('No active plan.'); process.exit(0); }
  console.log(`Plan ${plan.id} · race ${plan.race_id}`);

  // 2. Read recent peak long from runs (last 28d, >= 8mi)
  const recentLong = Number((await pool.query(
    `SELECT MAX((data->>'distanceMi')::numeric)::text AS mi
       FROM runs
      WHERE user_uuid = $1
        AND NOT (data ? 'mergedIntoId')
        AND COALESCE(data->>'date', LEFT(data->>'startLocal',10))::date >= CURRENT_DATE - 28
        AND (data->>'distanceMi')::numeric >= 8`,
    [DAVID],
  )).rows[0]?.mi ?? 0);
  console.log(`Recent peak long: ${recentLong}mi`);
  if (recentLong < 8) { console.log('No recent long >= 8mi · skip.'); process.exit(0); }

  // 3. Read tier upper bound from authored_state
  const auth = (await pool.query(
    `SELECT authored_state->'tier_peak_long_band' AS band FROM training_plans WHERE id = $1`,
    [plan.id],
  )).rows[0];
  const tierBand = auth?.band ?? [15, 17];
  const tierUpper = Number(tierBand[1] ?? 17);
  console.log(`Tier peak long band: [${tierBand[0]}, ${tierUpper}]`);

  // 4. Pull all long rows ordered by date · join through plan_weeks +
  //    plan_phases to get phase label and week_idx
  const longs = (await pool.query(
    `SELECT pw.id, pw.date_iso, pw.distance_mi, pw.workout_spec,
            pw.week_id, ph.label AS phase, w.week_idx, w.is_cutback
       FROM plan_workouts pw
       JOIN plan_weeks w ON w.id = pw.week_id
       JOIN plan_phases ph ON ph.id = w.phase_id
      WHERE pw.plan_id = $1
        AND pw.type = 'long'
      ORDER BY pw.date_iso ASC`,
    [plan.id],
  )).rows;
  console.log(`Found ${longs.length} long-run rows.`);

  // 5. For each row, compute new long via the same policy
  const updates = [];
  for (const row of longs) {
    // Skip TAPER and race weeks · they don't need floor
    if (row.phase === 'TAPER') continue;
    const wIdx = Number(row.week_idx);
    // Prefer DB's authoritative is_cutback flag if present
    const isCutback = row.is_cutback === true
      ? true
      : (wIdx > 0 && (wIdx + 1) % 4 === 0);
    const floor = Math.round(recentLong - (isCutback ? 2 : 0));
    const current = Number(row.distance_mi);
    const newDist = Math.min(Math.max(current, floor), tierUpper);
    if (newDist > current) {
      updates.push({ id: row.id, date: row.date_iso, oldMi: current, newMi: newDist, phase: row.phase, wIdx, cutback: isCutback });
    }
  }

  console.log('\n=== Updates needed ===');
  for (const u of updates) {
    console.log(`  W${u.wIdx} (${u.date}) · ${u.phase}${u.cutback ? ' [cutback]' : ''} · ${u.oldMi}mi → ${u.newMi}mi`);
  }

  if (updates.length === 0) { console.log('All longs already meet the floor.'); process.exit(0); }

  if (!COMMIT) {
    console.log(`\n(dry-run · pass --commit to apply ${updates.length} UPDATEs)`);
    process.exit(0);
  }

  // 6. Apply UPDATEs to plan_workouts (distance_mi AND workout_spec.distanceMi)
  console.log('\nApplying updates...');
  for (const u of updates) {
    // Update both the row's distance_mi and its spec's distanceMi
    await pool.query(
      `UPDATE plan_workouts
          SET distance_mi = $1,
              workout_spec = jsonb_set(
                COALESCE(workout_spec, '{}'::jsonb),
                '{distanceMi}',
                to_jsonb($1::numeric)
              )
        WHERE id = $2`,
      [u.newMi, u.id],
    );
    // Audit row in coach_intents (engine-driven bump)
    await pool.query(
      `INSERT INTO coach_intents (user_uuid, user_id, ts, reason, field, value)
       VALUES ($1, $1, NOW(), 'plan_adapt_long_floor', $2, $3)`,
      [DAVID, u.id, JSON.stringify({ oldMi: u.oldMi, newMi: u.newMi, reason: 'recent_long_floor', recentLong })],
    );
  }
  console.log(`Applied ${updates.length} updates + audit rows.`);

  // Note · plan_weeks has no distance_total column; the simulator and
  // reader sum on read (lib/plan/simulator.ts uses SUM(pw.distance_mi)).
  // No resum step needed.

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
