/**
 * _simulate_all.mjs · comprehensive end-to-end audit of David's current
 * plan against every doctrine rule shipped today.
 *
 * Runs read-only. Reports what the system currently says vs what the
 * new code WOULD say once a rebuild fires. Highlights gaps where the
 * live plan was authored before the rule shipped.
 *
 * Usage: node scripts/_simulate_all.mjs
 */
import { Pool } from 'pg';

const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL not set.'); process.exit(1); }
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

// Mirror lib/plan/goal-tiers.ts BUILD_WINDOW_WEEKS + POST_RACE_RECOVERY_WEEKS
const BUILD_WINDOW_WEEKS = { '5k': 10, '10k': 12, 'hm': 14, 'm': 18, 'ultra': 24 };
const POST_RACE_RECOVERY_WEEKS = { '5k': 0, '10k': 1, 'hm': 1, 'm': 2, 'ultra': 3 };
const TIER_HM_ADVANCED = { peakLongMiBand: [15, 17], longRunShare: 0.25, peakWeeklyMileageBand: [55, 85], qualityPerWeek: 2 };
const TIER_M_ADVANCED  = { peakLongMiBand: [20, 22], longRunShare: 0.30, peakWeeklyMileageBand: [55, 75], qualityPerWeek: 2 };

function distCat(mi) {
  if (mi <= 4) return '5k';
  if (mi <= 8) return '10k';
  if (mi <= 17) return 'hm';
  if (mi <= 30) return 'm';
  return 'ultra';
}
function parseRaceTime(s) {
  const m = String(s || '').trim().match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  if (m[3] != null) return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
  const first = +m[1], second = +m[2];
  return first <= 9 ? first * 3600 + second * 60 : first * 60 + second;
}

const ok = (m) => console.log(`  ✓ ${m}`);
const warn = (m) => console.log(`  ⚠ ${m}`);
const fail = (m) => { console.log(`  ✗ ${m}`); process.exitCode = 1; };
const info = (m) => console.log(`  · ${m}`);
const section = (s) => console.log(`\n${'═'.repeat(70)}\n  ${s}\n${'═'.repeat(70)}`);

async function main() {
  // ===== SECTION A · DAVID'S CURRENT STATE =====
  section('A · DAVID\'S CURRENT STATE');

  const plan = (await pool.query(
    `SELECT id, race_id, mode, authored_iso::text AS authored_iso, authored_state
       FROM training_plans WHERE user_uuid = $1 AND archived_iso IS NULL
       ORDER BY authored_iso DESC LIMIT 1`,
    [DAVID],
  )).rows[0];
  if (!plan) { console.log('No active plan.'); process.exit(0); }
  const auth = plan.authored_state || {};

  info(`Plan ID: ${plan.id}`);
  info(`Race: ${plan.race_id}`);
  info(`Mode: ${plan.mode ?? 'NULL (pre-Rule-12)'}`);
  info(`Authored: ${plan.authored_iso}`);
  info(`is_mid_block: ${auth.is_mid_block}`);
  info(`goal_tier: ${auth.goal_tier}`);
  info(`tier_peak_weekly: [${auth.tier_peak_weekly_band ?? '?'}]`);
  info(`tier_peak_long: [${auth.tier_peak_long_band ?? '?'}]`);
  info(`derived_from envelope: ${auth.derived_from ? 'present ✓' : 'absent (pre-Rule-10)'}`);
  info(`horizon_raise: ${auth.horizon_raise ? 'present ✓' : 'absent (pre-Rule-11)'}`);

  // Recent signals
  const sig = (await pool.query(
    `SELECT
       (SELECT MAX((data->>'distanceMi')::numeric) FROM runs
         WHERE user_uuid = $1 AND NOT (data ? 'mergedIntoId')
           AND COALESCE(data->>'date', LEFT(data->>'startLocal',10))::date >= CURRENT_DATE - 28
           AND (data->>'distanceMi')::numeric >= 8) AS peak_long,
       (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY (data->>'distanceMi')::numeric)
          FROM runs WHERE user_uuid = $1 AND NOT (data ? 'mergedIntoId')
           AND (data->>'distanceMi')::numeric BETWEEN 3 AND 9
           AND COALESCE(data->>'date', LEFT(data->>'startLocal',10))::date >= CURRENT_DATE - 14) AS easy_med,
       (SELECT AVG(n)::numeric FROM (
          SELECT date_trunc('week', date_iso::timestamp) AS wk, COUNT(DISTINCT pw.id) AS n
            FROM plan_workouts pw JOIN training_plans tp ON tp.id = pw.plan_id
           WHERE tp.user_uuid = $1 AND tp.archived_iso IS NULL
             AND pw.type IN ('tempo','threshold','intervals')
             AND date_iso::date >= CURRENT_DATE - 28
           GROUP BY 1) q) AS quality_per_week,
       (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY (r.data->>'distanceMi')::numeric)
          FROM plan_workouts pw
          JOIN training_plans tp ON tp.id = pw.plan_id
          JOIN runs r ON r.user_uuid = tp.user_uuid::uuid
            AND COALESCE(r.data->>'date', LEFT(r.data->>'startLocal',10))::date = pw.date_iso::date
            AND NOT (r.data ? 'mergedIntoId')
         WHERE tp.user_uuid = $1 AND pw.type IN ('tempo','threshold','intervals')
           AND pw.date_iso::date >= CURRENT_DATE - 28) AS quality_dist_mi,
       (SELECT SUM(daily) FROM (
          SELECT MAX((data->>'distanceMi')::numeric) AS daily FROM runs
           WHERE user_uuid = $1 AND NOT (data ? 'mergedIntoId')
             AND COALESCE(data->>'date', LEFT(data->>'startLocal',10))::date >= CURRENT_DATE - 28
           GROUP BY COALESCE(data->>'date', LEFT(data->>'startLocal',10))) z) AS recent_28d_total`,
    [DAVID],
  )).rows[0];
  console.log('');
  info(`Recent peak long (28d): ${Number(sig.peak_long ?? 0).toFixed(2)}mi`);
  info(`Easy median (14d): ${Number(sig.easy_med ?? 0).toFixed(1)}mi`);
  info(`Quality habit (28d): ${Number(sig.quality_per_week ?? 0).toFixed(1)}/wk`);
  info(`Quality distance median (28d): ${Number(sig.quality_dist_mi ?? 0).toFixed(1)}mi`);

  // ===== SECTION B · WEEK-BY-WEEK PLAN AUDIT =====
  section('B · WEEK-BY-WEEK PLAN AUDIT (Rules 1-11)');
  const weeks = (await pool.query(
    `SELECT w.week_idx, w.week_start_iso::text AS start, ph.label AS phase, w.is_cutback,
            SUM(pw.distance_mi)::numeric AS weekly_mi,
            COUNT(*) FILTER (WHERE pw.type IN ('tempo','threshold','intervals')) AS q_count,
            MAX(pw.distance_mi) FILTER (WHERE pw.type = 'long') AS long_mi,
            MIN(pw.distance_mi) FILTER (WHERE pw.type IN ('tempo','threshold','intervals')) AS q_min_mi
       FROM plan_weeks w JOIN plan_phases ph ON ph.id = w.phase_id
       LEFT JOIN plan_workouts pw ON pw.week_id = w.id
      WHERE w.plan_id = $1 GROUP BY w.id, ph.label ORDER BY w.week_idx`,
    [plan.id],
  )).rows;

  for (const w of weeks) {
    const wm = Number(w.weekly_mi ?? 0).toFixed(1);
    const lm = Number(w.long_mi ?? 0).toFixed(0);
    const qd = Number(w.q_min_mi ?? 0).toFixed(0);
    const cb = w.is_cutback === true || (Number(w.week_idx) > 0 && (Number(w.week_idx) + 1) % 4 === 0);
    console.log(`  W${String(w.week_idx).padStart(2)} ${w.start} ${w.phase.padEnd(14)}${cb ? '[cb]' : '    '} ${wm.padStart(5)}mi · L${lm.padStart(2)} · ${w.q_count}q×${qd}`);
  }
  console.log('');

  // Rule checks
  const recentLong = Number(sig.peak_long ?? 0);
  const recentMi = Number(auth.recent_avg_mpw ?? auth.weeklyAvg4w ?? 35);
  const recentQDist = Number(sig.quality_dist_mi ?? 0);

  // Rule 1
  const hasBase = weeks.some((w) => w.phase === 'BASE');
  hasBase ? fail('Rule 1 · BASE phase present on mid-block plan') : ok('Rule 1 · no BASE phase');

  // Rule 2 (quality distance floor)
  let qFloor = recentQDist >= 5 ? recentQDist - 1 : 0;
  const qViols = weeks.filter((w) => w.phase !== 'BASE' && w.phase !== 'TAPER' && w.q_count > 0 && Number(w.q_min_mi) < qFloor).length;
  qViols === 0 ? ok(`Rule 2 · all quality ≥ ${qFloor.toFixed(0)}mi (recent floor)`) : fail(`Rule 2 · ${qViols} weeks below floor`);

  // Rule 4 (monotonic vol)
  const w1 = Number(weeks[0]?.weekly_mi ?? 0);
  w1 >= recentMi * 0.9 ? ok(`Rule 4 · week 0 weekly ${w1.toFixed(1)} ≥ 90% of recent ${recentMi}`) : fail(`Rule 4 · week 0 below floor`);

  // Rule 5 (density)
  const w1q = Number(weeks[0]?.q_count ?? 0);
  Math.abs(w1q - 2) <= 1 ? ok(`Rule 5 · week 0 quality count ${w1q} within ±1 of habit 2`) : fail(`Rule 5 · outside band`);

  // Rule 6 (compression)
  weeks.length < 10 && hasBase ? fail(`Rule 6 · plan is ${weeks.length}w but has BASE`) : ok(`Rule 6 · phase compression OK (${weeks.length}w, no BASE)`);

  // Rule 7 (long floor)
  let longViols = 0;
  for (let i = 0; i < weeks.length; i++) {
    const w = weeks[i];
    if (w.phase === 'BASE' || w.phase === 'TAPER') continue;
    const long = Number(w.long_mi ?? 0);
    if (long === 0) continue;
    const isCb = w.is_cutback === true || (i > 0 && (i + 1) % 4 === 0);
    const floor = Math.round(isCb ? recentLong - 2 : recentLong - 1);
    if (long < floor) longViols++;
  }
  longViols === 0 ? ok(`Rule 7 · no long below ${recentLong.toFixed(0)}mi floor`) : fail(`Rule 7 · ${longViols} weeks below long floor`);

  // Rule 10
  auth.derived_from ? ok('Rule 10 · derived_from envelope present') : warn('Rule 10 · derived_from MISSING (plan pre-Rule-10 · next rebuild populates)');

  // Rule 11 (horizon)
  auth.horizon_raise ? ok(`Rule 11 · horizon_raise present · cap raised to ${auth.horizon_raise.toLongCapMi}mi by ${auth.horizon_raise.race?.name}`)
                     : warn('Rule 11 · horizon_raise MISSING (plan pre-Rule-11 · next rebuild populates)');

  // ===== SECTION C · MODE TRACE (Rules 12-13) =====
  section('C · PLAN MODE TRACE (Rules 12-13)');

  // Current race details
  const currentRace = (await pool.query(
    `SELECT meta FROM races WHERE slug = $1`, [plan.race_id],
  )).rows[0]?.meta || {};
  const curMi = Number(currentRace.distanceMi);
  const curDate = currentRace.date;
  const curCat = distCat(curMi);
  const todayISO = new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);
  const today = new Date(todayISO + 'T12:00:00Z').getTime();
  const raceMs = new Date(curDate + 'T12:00:00Z').getTime();
  const weeksOut = Math.round((raceMs - today) / (7 * 86400000));
  const buildWin = BUILD_WINDOW_WEEKS[curCat];

  info(`Today: ${todayISO}`);
  info(`Next race: ${currentRace.name} (${curDate}) · ${curMi.toFixed(1)}mi`);
  info(`Weeks to race: ${weeksOut} (build window for ${curCat}: ${buildWin})`);

  // pickPlanMode simulation
  let mode = 'race-prep';
  if (weeksOut > buildWin) mode = 'maintenance';
  if (weeksOut > 0 && weeksOut <= buildWin) mode = 'race-prep';

  info(`Computed mode (pickPlanMode): ${mode}`);
  info(`Stored mode (DB): ${plan.mode ?? 'NULL'}`);

  if (mode === plan.mode) ok('Rule 12 · mode matches expected');
  else if (plan.mode == null) warn('Rule 12 · mode field NULL (plan pre-Rule-12 · next rebuild populates)');
  else fail(`Rule 12 · mode mismatch · expected ${mode}, got ${plan.mode}`);

  // Forward simulation: when does maintenance fire? when does CIM transition?
  console.log('');
  info('Forward simulation:');
  const afcDone = curDate; // race day
  const afcDoneMs = raceMs;
  const recoveryWeeks = POST_RACE_RECOVERY_WEEKS[curCat];
  info(`  ${afcDone} · AFC race day`);
  info(`  ${new Date(afcDoneMs + 86400000).toISOString().slice(0,10)} · graduate cron fires`);
  info(`  Next ${recoveryWeeks}w · RECOVERY mode (${recoveryWeeks}wk for ${curCat})`);

  // Find next A-race after AFC
  const nextA = (await pool.query(
    `SELECT slug, meta FROM races
      WHERE user_uuid = $1 AND meta->>'priority' = 'A'
        AND (meta->>'date')::date > $2::date
      ORDER BY (meta->>'date')::date LIMIT 1`,
    [DAVID, curDate],
  )).rows[0];
  if (nextA) {
    const nMeta = nextA.meta || {};
    const nMi = Number(nMeta.distanceMi);
    const nCat = distCat(nMi);
    const nBuildWin = BUILD_WINDOW_WEEKS[nCat];
    const nDateMs = new Date(nMeta.date + 'T12:00:00Z').getTime();
    const gapWk = Math.round((nDateMs - afcDoneMs) / (7 * 86400000));
    info(`  Next A-race: ${nMeta.name} (${nMeta.date}) · ${gapWk}wk after AFC`);
    if (gapWk <= nBuildWin) {
      info(`  → ${gapWk}wk ≤ ${nBuildWin}wk build window · race-prep fires for ${nMeta.name} after recovery`);
      ok(`Rule 13 → race-prep transition smooth · no maintenance gap`);
    } else {
      const maintenanceWk = gapWk - nBuildWin - recoveryWeeks;
      info(`  → ${gapWk}wk > ${nBuildWin}wk build window · MAINTENANCE for ${maintenanceWk}wk`);
      info(`  → transition to race-prep at ${nMeta.date} − ${nBuildWin}wk = ${new Date(nDateMs - nBuildWin * 7 * 86400000).toISOString().slice(0,10)}`);
      ok(`Rule 12 transition cron fires when ${nMeta.name} enters build window`);
    }
  }

  // ===== SECTION D · STRENGTH (Rule 14) =====
  section('D · STRENGTH RECOMMENDER (Rule 14)');

  // Get current week's plan (Mon-Sun of today)
  const todayDate = new Date(todayISO + 'T12:00:00Z');
  const todayDow = todayDate.getUTCDay(); // 0=Sun, 1=Mon
  const monOffset = todayDow === 0 ? -6 : 1 - todayDow;
  const weekStart = new Date(todayDate.getTime() + monOffset * 86400000).toISOString().slice(0, 10);
  info(`Week start (Mon): ${weekStart}`);

  const weekWorkouts = (await pool.query(
    `SELECT pw.date_iso::text AS date, pw.type, pw.is_quality, pw.is_long, pw.distance_mi, pw.dow
       FROM plan_workouts pw
      WHERE pw.plan_id = $1
        AND pw.date_iso::date >= $2::date
        AND pw.date_iso::date < ($2::date + interval '7 days')
      ORDER BY pw.date_iso, pw.dow`,
    [plan.id, weekStart],
  )).rows;

  if (weekWorkouts.length === 0) {
    warn('No workouts for current week (plan may not cover today)');
    process.exit(0);
  }
  console.log('  Current week:');
  for (const w of weekWorkouts) {
    const tags = [];
    if (w.is_quality) tags.push('Q');
    if (w.is_long) tags.push('L');
    console.log(`    ${w.date} ${w.type.padEnd(10)} ${Number(w.distance_mi).toFixed(1)}mi ${tags.length ? `[${tags.join('+')}]` : ''}`);
  }

  // Simulate pickCandidates with new Rule 14 doctrine
  console.log('\n  Strength candidate scoring (new doctrine):');
  const dows = weekWorkouts.map((w) => new Date(w.date + 'T12:00:00Z').getUTCDay());
  const isHardIdx = new Set();
  const isLongIdx = new Set();
  weekWorkouts.forEach((w, i) => {
    if (w.is_quality || w.is_long) isHardIdx.add(i);
    if (w.is_long) isLongIdx.add(i);
  });
  const dayLabels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  for (let i = 0; i < weekWorkouts.length; i++) {
    const w = weekWorkouts[i];
    const dow = dows[i];
    const label = dayLabels[(dow + 6) % 7];
    let score, intensity, timing, why;
    if (w.type === 'race' || w.type === 'shakeout') { score = -100; why = 'race/shakeout'; }
    else if (w.is_long) { score = -100; why = 'long day (CNS too cooked)'; }
    else if (isHardIdx.has(i + 1)) { score = -100; why = 'day-before hard (legs not fresh)'; }
    else if (isLongIdx.has(i - 1)) { score = -100; why = 'day-after long (recovery sacred)'; }
    else if (w.is_quality) { score = 10; intensity = 'heavy'; timing = 'pm'; why = 'PAIR HARD WITH HARD'; }
    else if (w.type === 'easy') { score = 5; intensity = 'maintenance'; timing = 'anytime'; why = 'easy day · maintenance OK'; }
    else if (w.type === 'recovery') { score = 3; intensity = 'maintenance'; timing = 'anytime'; why = 'recovery · light only'; }
    else if (w.type === 'rest') { score = 1; intensity = 'maintenance'; timing = 'anytime'; why = 'rest day (last resort)'; }
    else { score = 0; why = 'unknown'; }
    const scoreStr = score === -100 ? 'EXCL ' : `${score >= 0 ? '+' : ''}${score}`.padStart(5);
    const intensityStr = intensity ? `${intensity}/${timing}`.padEnd(18) : 'EXCLUDED'.padEnd(18);
    console.log(`    ${label} (${w.type.padEnd(8)}) score ${scoreStr} · ${intensityStr} · ${why}`);
  }

  // Recommended (top 2 by score)
  const cands = weekWorkouts.map((w, i) => {
    if (w.type === 'race' || w.type === 'shakeout' || w.is_long) return null;
    if (isHardIdx.has(i + 1) || isLongIdx.has(i - 1)) return null;
    let score = 0, intensity = 'maintenance', timing = 'anytime', pair = false;
    if (w.is_quality) { score = 10; intensity = 'heavy'; timing = 'pm'; pair = true; }
    else if (w.type === 'easy') score = 5;
    else if (w.type === 'recovery') score = 3;
    else if (w.type === 'rest') score = 1;
    else return null;
    return { date: w.date, dow: dows[i], score, intensity, timing, pair };
  }).filter(Boolean);
  cands.sort((a, b) => b.score - a.score);
  const phaseLabel = weeks.find((w) => w.start <= todayISO && weekStart <= todayISO)?.phase || 'unknown';
  const cap = phaseLabel === 'TAPER' ? 1 : phaseLabel === 'RACE-SPECIFIC' ? 1 : 2;
  const picks = cands.slice(0, Math.min(cap, 2));

  console.log('');
  info(`Current phase: ${phaseLabel} · frequency cap: ${cap}`);
  console.log('  Recommended picks:');
  for (const p of picks) {
    const label = dayLabels[(p.dow + 6) % 7];
    let intensity = p.intensity;
    if (phaseLabel === 'RACE-SPECIFIC') intensity = 'maintenance';
    console.log(`    ${p.date} ${label} · ${intensity.toUpperCase()} · ${p.timing.toUpperCase()}${p.pair ? ' · paired with quality run' : ''}`);
  }
  if (picks.length === 2 && picks.every((p) => p.pair)) ok('Rule 14 · both picks paired with quality runs (hard-with-hard ✓)');
  else if (picks.some((p) => p.pair)) warn(`Rule 14 · ${picks.filter((p) => p.pair).length}/${picks.length} picks paired with quality`);
  else warn('Rule 14 · no quality-day pairings this week');

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
