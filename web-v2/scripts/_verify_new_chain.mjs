/**
 * End-to-end verification of the new VDOT chain.
 *
 * Exercises:
 *   1. Race + run VDOT candidates (the canonical-source ladder)
 *   2. Training-derived VDOT (vdotFromRun)
 *   3. Projection for AFC / CIM / LA Marathon
 *   4. Projection trend (today vs 30 days ago)
 *   5. Cap-at-85 verification (synthetic elite-pace run should clamp)
 *
 * Mirrors the production code paths in loadCurrentVdot + bestRecentVdot.
 */
import { Pool } from 'pg';

// Inline the Daniels math (can't import .ts from .mjs without tsx).
function kmFromMi(mi) { return mi * 1.609344; }
function vo2Cost(s) { return -4.6 + 0.182258 * s + 0.000104 * s * s; }
function pctVO2(min) {
  return 0.8 + 0.1894393 * Math.exp(-0.012778 * min) + 0.2989558 * Math.exp(-0.1932605 * min);
}
function rawVdot(fs, mi) {
  if (!fs || fs <= 0 || !mi || mi <= 0) return null;
  const meters = kmFromMi(mi) * 1000;
  const minutes = fs / 60;
  const speed = meters / minutes;
  const vo2 = vo2Cost(speed);
  const pct = pctVO2(minutes);
  return vo2 / pct;
}
function vdotFromRace(fs, mi) {
  if (!fs || fs < 60) return null;
  const v = rawVdot(fs, mi);
  if (v == null) return null;
  if (v < 30 || v > 85) return null;
  return Math.round(v * 10) / 10;
}
function predictRaceTime(vdot, mi) {
  if (!vdot || vdot <= 0 || !mi || mi <= 0) return null;
  let lo = mi * 150, hi = mi * 1500, mid = (lo + hi) / 2;
  for (let i = 0; i < 60; i++) {
    mid = (lo + hi) / 2;
    const v = rawVdot(mid, mi);
    if (v == null) break;
    if (v > vdot) lo = mid; else hi = mid;
  }
  return Math.round(mid);
}
function fmtTime(s) {
  if (s == null) return null;
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}
function parseTime(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  if (m[3] != null) return +m[1]*3600 + +m[2]*60 + +m[3];
  return +m[1]*60 + +m[2];
}

const QUALITY_RUN_TYPES = new Set([
  'threshold', 'tempo', 'cruise', 'intervals', 'vo2', 'vo2max',
  'marathon_pace', 'mp', 'race', 'time_trial', 'tune_up',
]);
function vdotFromRun({ finishSeconds, distanceMi, workoutType, avgHr, maxHr }) {
  if (!finishSeconds || finishSeconds < 60) return null;
  if (!distanceMi || distanceMi < 4) return null;
  const isQuality = QUALITY_RUN_TYPES.has(String(workoutType ?? '').toLowerCase());
  const hrFloor = maxHr ? maxHr * 0.80 : null;
  const isHardEffort = avgHr != null && hrFloor != null && avgHr >= hrFloor;
  if (!isQuality && !isHardEffort) return null;
  return vdotFromRace(finishSeconds, distanceMi);
}

async function loadCurrentVdot(pool, userId, today, asOfDate) {
  const asOf = asOfDate ?? today;
  const raceRows = (await pool.query(
    `SELECT slug, meta, actual_result FROM races
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND (meta->>'date')::date >= ($2::date - interval '180 days')::date
        AND (meta->>'date')::date < $2::date
        AND meta->>'priority' IN ('A', 'B')`,
    [userId, asOf]
  ).catch(() => ({ rows: [] }))).rows;

  function distFromLabel(label) {
    const l = String(label ?? '').toLowerCase();
    if (l.includes('marathon') && !l.includes('half')) return 26.2;
    if (l.includes('half') || l.includes('21k')) return 13.1;
    if (l.includes('10k')) return 6.2;
    if (l.includes('5k')) return 3.1;
    return null;
  }

  const raceCands = raceRows.map(r => {
    const m = r.meta || {};
    const ar = r.actual_result || {};
    const distMi = m.distanceMi ? Number(m.distanceMi) : distFromLabel(m.distanceLabel);
    let finishSec = ar.finishS != null ? Number(ar.finishS) : null;
    if (!finishSec) finishSec = parseTime(m.finishTime);
    return {
      slug: r.slug, name: m.name ?? r.slug, date: m.date ?? '',
      priority: m.priority ?? null,
      distance_mi: distMi, finish_seconds: finishSec,
    };
  });

  const qualityCutoff = new Date(Date.parse(asOf + 'T12:00:00Z') - 60 * 86400000).toISOString().slice(0, 10);
  const runRows = (await pool.query(
    `SELECT
       sa.id::text AS id,
       COALESCE(sa.data->>'date', LEFT(sa.data->>'startLocal',10)) AS date,
       sa.data->>'workoutType' AS workout_type,
       (sa.data->>'distanceMi')::numeric AS distance_mi,
       (sa.data->>'movingTimeS')::numeric AS finish_seconds,
       (sa.data->>'avgHr')::numeric AS avg_hr
       FROM runs sa
      WHERE (sa.user_uuid = $1 OR sa.user_uuid IS NULL)
        AND NOT (sa.data ? 'mergedIntoId')
        AND COALESCE(sa.data->>'date', LEFT(sa.data->>'startLocal',10)) >= $2
        AND COALESCE(sa.data->>'date', LEFT(sa.data->>'startLocal',10)) < $3
        AND (sa.data->>'distanceMi')::numeric >= 4
        AND (sa.data->>'movingTimeS')::numeric > 60
        AND NOT EXISTS (
          SELECT 1 FROM races r
           WHERE (r.user_uuid = $1 OR r.user_uuid IS NULL)
             AND ABS((r.meta->>'date')::date - COALESCE(sa.data->>'date', LEFT(sa.data->>'startLocal',10))::date) <= 1
        )`,
    [userId, qualityCutoff, asOf]
  ).catch(() => ({ rows: [] }))).rows;

  const userMaxHr = (await pool.query(
    `SELECT COALESCE(max_hr_override, max_hr) AS m FROM users WHERE id = $1`,
    [userId]
  ).catch(() => ({ rows: [] }))).rows[0]?.m;
  const maxHrValue = userMaxHr != null ? Number(userMaxHr) : null;

  // bestRecentVdot logic — race candidates + run candidates, with race+0, run-1 tiebreak.
  const cutoff = new Date(Date.parse(asOf + 'T12:00:00Z') - 180 * 86400000).toISOString().slice(0,10);
  const raceVdots = [];
  for (const r of raceCands) {
    if (!r.date || !r.distance_mi || !r.finish_seconds) continue;
    if (r.date < cutoff) continue;
    if (r.priority === 'C') continue;
    const v = vdotFromRace(r.finish_seconds, r.distance_mi);
    if (v == null) continue;
    raceVdots.push({ source: 'race', ...r, vdot: v });
  }
  const runVdots = [];
  for (const r of runRows) {
    if (!r.date || r.date < cutoff) continue;
    const distMi = r.distance_mi != null ? Number(r.distance_mi) : null;
    const finishSec = r.finish_seconds != null ? Number(r.finish_seconds) : null;
    const avgHr = r.avg_hr != null ? Number(r.avg_hr) : null;
    const v = vdotFromRun({ finishSeconds: finishSec, distanceMi: distMi, workoutType: r.workout_type, avgHr, maxHr: maxHrValue });
    if (v == null) continue;
    runVdots.push({ source: 'run', id: r.id, date: r.date, workout_type: r.workout_type,
                    distance_mi: distMi, finish_seconds: finishSec, vdot: v });
  }
  const sortKey = c => c.source === 'race' ? c.vdot : c.vdot - 1;
  const all = [...raceVdots, ...runVdots].sort((a,b) => sortKey(b) - sortKey(a));
  return { best: all[0] ?? null, considered: all };
}

const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

try {
  const today = new Date().toISOString().slice(0, 10);
  const past30 = new Date(Date.parse(today + 'T12:00:00Z') - 30 * 86400000).toISOString().slice(0, 10);

  console.log('Today:', today, '· 30d ago:', past30);

  // CURRENT
  console.log('\n=== CURRENT (as-of today) ===');
  const cur = await loadCurrentVdot(pool, DAVID, today);
  console.log('best:', JSON.stringify(cur.best, null, 2));
  console.log('candidates considered:');
  for (const c of cur.considered.slice(0, 15)) {
    const sortKey = c.source === 'race' ? c.vdot.toFixed(1) : (c.vdot - 1).toFixed(1) + '*';
    console.log(`  [${c.source}] VDOT ${c.vdot.toFixed(1)} (sort=${sortKey}) · ${c.date} · ${c.distance_mi}mi · ${fmtTime(c.finish_seconds)}` + (c.source === 'race' ? ` · ${c.slug}` : ` · ${c.workout_type ?? '<no type>'}`));
  }

  // 30 DAYS AGO
  console.log('\n=== 30 DAYS AGO (as-of ' + past30 + ') ===');
  const past = await loadCurrentVdot(pool, DAVID, today, past30);
  console.log('best:', JSON.stringify(past.best, null, 2));

  // Projections + trend
  console.log('\n=== PROJECTIONS ===');
  const races = [
    { name: 'AFC Half', dist: 13.1, goal: '1:30:00' },
    { name: 'CIM Marathon', dist: 26.22, goal: '3:00:00' },
    { name: 'LA Marathon 2027', dist: 26.22, goal: '3:31:00' },
  ];
  for (const r of races) {
    const curSec = cur.best ? predictRaceTime(cur.best.vdot, r.dist) : null;
    const pastSec = past.best ? predictRaceTime(past.best.vdot, r.dist) : null;
    const delta = curSec != null && pastSec != null ? curSec - pastSec : null;
    console.log(`${r.name.padEnd(20)} goal ${r.goal} · current ${fmtTime(curSec)} · 30d ago ${fmtTime(pastSec) ?? 'null'} · trend ${delta != null ? (delta > 0 ? '+' : '') + delta + 's (' + (delta > 0 ? 'slower' : 'faster') + ')' : 'null'}`);
  }

  // Cap-at-85 verification
  console.log('\n=== CAP-AT-85 SANITY ===');
  const cap_tests = [
    { label: '5K @ 13:00 (elite-elite)', fs: 13*60, mi: 3.1 },
    { label: '5K @ 14:00 (elite)',        fs: 14*60, mi: 3.1 },
    { label: '5K @ 15:00 (sub-elite)',    fs: 15*60, mi: 3.1 },
    { label: 'Marathon 2:05 (WR-ish)',    fs: 2*3600 + 5*60, mi: 26.2 },
    { label: 'Marathon 2:08 (sub-elite)', fs: 2*3600 + 8*60, mi: 26.2 },
    { label: 'Marathon 3:00 (mid-pack)',  fs: 3*3600, mi: 26.2 },
  ];
  for (const t of cap_tests) {
    const v = vdotFromRace(t.fs, t.mi);
    const raw = rawVdot(t.fs, t.mi);
    console.log(`${t.label.padEnd(38)} VDOT ${v ?? 'null (clamped)'}, raw ${raw?.toFixed(1) ?? 'null'}`);
  }
} catch (e) { console.error(e); }
finally { await pool.end(); }
