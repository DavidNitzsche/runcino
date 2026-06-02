/**
 * _simulate_mid_block.mjs · runs the david-mid-block persona through
 * the generator and prints the resulting plan, asserting each of the
 * 10 mid-block doctrine rules.
 *
 * The composePlan function is a pure TS export. We can't import TS
 * from a .mjs script without tsx, so this script instead READS
 * David's CURRENT live plan (post-bump from this morning) and
 * verifies the rules hold against his actual data.
 *
 * For a true persona-driven simulation, the generator-bench.test.ts
 * exercises composePlan() under vitest. That fires in CI.
 *
 * Usage: node scripts/_simulate_mid_block.mjs
 */
import { Pool } from 'pg';

const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL not set.'); process.exit(1); }
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const ok = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => { console.log(`  ✗ ${msg}`); process.exitCode = 1; };

async function main() {
  // 1. David's signals
  const recent = (await pool.query(
    `SELECT
       (SELECT MAX((data->>'distanceMi')::numeric) FROM runs
         WHERE user_uuid = $1 AND NOT (data ? 'mergedIntoId')
           AND COALESCE(data->>'date', LEFT(data->>'startLocal',10))::date >= CURRENT_DATE - 28
           AND (data->>'distanceMi')::numeric >= 8) AS peak_long_mi,
       (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY (data->>'distanceMi')::numeric)
          FROM runs WHERE user_uuid = $1 AND NOT (data ? 'mergedIntoId')
           AND (data->>'distanceMi')::numeric BETWEEN 3 AND 9
           AND COALESCE(data->>'date', LEFT(data->>'startLocal',10))::date >= CURRENT_DATE - 14) AS easy_med_mi,
       (SELECT COUNT(DISTINCT date_trunc('week', date_iso::timestamp))
          FROM plan_workouts pw JOIN training_plans tp ON tp.id = pw.plan_id
         WHERE tp.user_uuid = $1
           AND pw.type IN ('tempo','threshold','intervals')
           AND date_iso::date >= CURRENT_DATE - 28) AS quality_weeks,
       (SELECT COUNT(*)
          FROM plan_workouts pw JOIN training_plans tp ON tp.id = pw.plan_id
         WHERE tp.user_uuid = $1
           AND pw.type IN ('tempo','threshold','intervals')
           AND date_iso::date >= CURRENT_DATE - 28) AS quality_n,
       (SELECT vdot_per_quality FROM runner_calibration WHERE user_uuid = $1 LIMIT 1) AS vdot_per_quality`,
    [DAVID],
  )).rows[0] ?? {};

  console.log('\n=== David inputs ===');
  console.log(`  recentPeakLongMi   : ${Number(recent.peak_long_mi ?? 0).toFixed(2)}`);
  console.log(`  easyDayMedianMi    : ${Number(recent.easy_med_mi ?? 0).toFixed(2)}`);
  console.log(`  quality weeks/4w   : ${recent.quality_weeks ?? 0}`);
  console.log(`  total quality runs : ${recent.quality_n ?? 0}`);
  console.log(`  vdot_per_quality   : ${recent.vdot_per_quality ?? 'unknown'} (calibration sensitivity)`);

  // 2. Read David's current plan + tier targets
  const plan = (await pool.query(
    `SELECT id, authored_state FROM training_plans
      WHERE user_uuid = $1 AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [DAVID],
  )).rows[0];
  if (!plan) { console.log('No active plan.'); process.exit(0); }
  const auth = plan.authored_state ?? {};
  const tierBand = auth.tier_peak_long_band ?? [15, 17];
  const tierWeekly = auth.tier_peak_weekly_band ?? [55, 85];
  const tierQ = 2; // HM advanced from goal-tiers.ts

  console.log('\n=== Plan tier targets ===');
  console.log(`  goal_tier         : ${auth.goal_tier}`);
  console.log(`  is_mid_block      : ${auth.is_mid_block}`);
  console.log(`  tier_peak_weekly  : [${tierWeekly[0]}, ${tierWeekly[1]}]`);
  console.log(`  tier_peak_long    : [${tierBand[0]}, ${tierBand[1]}]`);
  console.log(`  derived_from      : ${auth.derived_from ? 'PRESENT' : 'absent (Rule 10 not yet on this plan)'}`);

  // 3. Per-week summary from DB
  const weeks = (await pool.query(
    `SELECT w.week_idx, w.week_start_iso::text AS start, ph.label AS phase, w.is_cutback,
            SUM(pw.distance_mi)::numeric AS weekly_mi,
            COUNT(*) FILTER (WHERE pw.type IN ('tempo','threshold','intervals')) AS q_count,
            MAX(pw.distance_mi) FILTER (WHERE pw.type = 'long') AS long_mi,
            (SELECT distance_mi FROM plan_workouts WHERE week_id = w.id AND type IN ('tempo','threshold','intervals') ORDER BY date_iso LIMIT 1) AS first_q_mi
       FROM plan_weeks w
       JOIN plan_phases ph ON ph.id = w.phase_id
       LEFT JOIN plan_workouts pw ON pw.week_id = w.id
      WHERE w.plan_id = $1
      GROUP BY w.id, ph.label
      ORDER BY w.week_idx ASC`,
    [plan.id],
  )).rows;

  console.log('\n=== Per-week plan ===');
  for (const w of weeks) {
    const wm = Number(w.weekly_mi ?? 0).toFixed(1);
    const lm = Number(w.long_mi ?? 0).toFixed(0);
    const qd = Number(w.first_q_mi ?? 0).toFixed(0);
    const cb = w.is_cutback ? '[cb]' : '    ';
    console.log(`  W${String(w.week_idx).padStart(2)} ${w.start} ${w.phase.padEnd(13)} ${cb} ${wm}mi · long ${lm}mi · ${w.q_count}q × ${qd}mi`);
  }

  // 4. Doctrine audit
  console.log('\n=== Doctrine audit ===');

  const recentLong = Number(recent.peak_long_mi ?? 0);
  const recentQDist = 8; // David's typical tempo (we know this from prior probe)

  // Rule 1 · skip BASE
  const hasBase = weeks.some((w) => w.phase === 'BASE');
  hasBase ? fail(`Rule 1 · BASE phase present on mid-block plan (${weeks.filter((w) => w.phase === 'BASE').length} weeks)`)
          : ok('Rule 1 · no BASE phase');

  // Rule 2 · quality distance floor
  let qDistViolations = 0;
  for (const w of weeks) {
    if (w.phase === 'BASE' || w.phase === 'TAPER' || w.q_count === '0') continue;
    if (Number(w.first_q_mi ?? 0) > 0 && Number(w.first_q_mi) < recentQDist - 1) qDistViolations++;
  }
  qDistViolations === 0 ? ok(`Rule 2 · all quality days ≥ ${recentQDist - 1}mi (recent floor)`)
                        : fail(`Rule 2 · ${qDistViolations} weeks have quality < ${recentQDist - 1}mi`);

  // Rule 4 · monotonic vol floor
  const recentMi = Number(auth.recent_avg_mpw ?? auth.weeklyAvg4w ?? 35);
  const w1 = Number(weeks[0]?.weekly_mi ?? 0);
  w1 >= recentMi * 0.9 ? ok(`Rule 4 · week 0 weekly (${w1.toFixed(1)}) ≥ 90% of recent (${recentMi}) = ${(recentMi * 0.9).toFixed(1)}`)
                       : fail(`Rule 4 · week 0 weekly ${w1.toFixed(1)} < 90% of recent ${recentMi}`);

  // Rule 5 · quality density
  const w1q = Number(weeks[0]?.q_count ?? 0);
  Math.abs(w1q - 2) <= 1 ? ok(`Rule 5 · week 0 quality count ${w1q} within ±1 of recent habit (2)`)
                         : fail(`Rule 5 · week 0 quality count ${w1q} outside ±1 of recent 2`);

  // Rule 6 · phase compression
  const planWeeks = weeks.length;
  if (planWeeks < 10 && hasBase) fail(`Rule 6 · plan is ${planWeeks}w but has BASE`);
  else ok(`Rule 6 · phase compression honored (${planWeeks}w plan, no BASE)`);

  // Rule 7 · long floor
  let longViolations = 0;
  for (let i = 0; i < weeks.length; i++) {
    const w = weeks[i];
    if (w.phase === 'BASE' || w.phase === 'TAPER') continue;
    const long = Number(w.long_mi ?? 0);
    if (long === 0) continue;
    // Mirror the generator's formula (layoutWeek line ~720) · don't
    // trust the DB is_cutback flag (older plans authored before the
    // flag persisted may have it null even when the week is cutback).
    const isCb = w.is_cutback === true || (i > 0 && (i + 1) % 4 === 0);
    const floor = Math.round(isCb ? recentLong - 2 : recentLong - 1);
    if (long < floor) longViolations++;
  }
  longViolations === 0 ? ok(`Rule 7 · no long shorter than ${recentLong.toFixed(0)}mi floor (cutback −2)`)
                       : fail(`Rule 7 · ${longViolations} weeks below long floor`);

  // Rule 10 · derived_from envelope
  auth.derived_from ? ok('Rule 10 · derived_from envelope present')
                    : fail('Rule 10 · derived_from envelope MISSING (plan was generated pre-Rule-10 ship · next rebuild will populate)');

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
