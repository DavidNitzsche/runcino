/**
 * Seed initial projection_snapshots for David so the trend has a past
 * anchor immediately. Without this, the trend computation falls back to
 * live recompute (which works, just slightly slower).
 *
 * Writes snapshots at TODAY-N for N in [0, 7, 14, 21, 30, 45, 60] —
 * mirroring what the daily cron would have produced if it had been
 * running since the start of the 60d window. Uses asOfDate so each
 * snapshot reflects the VDOT David WOULD have had on that day.
 */
import { Pool } from 'pg';

const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const DISTANCES = [13.1, 26.2];
const TODAY = new Date().toISOString().slice(0, 10);

function kmFromMi(mi) { return mi * 1.609344; }
function vo2Cost(s) { return -4.6 + 0.182258*s + 0.000104*s*s; }
function pctVO2(min) { return 0.8 + 0.1894393*Math.exp(-0.012778*min) + 0.2989558*Math.exp(-0.1932605*min); }
function rawVdot(fs, mi) {
  if (!fs || fs <= 0 || !mi || mi <= 0) return null;
  const meters = kmFromMi(mi) * 1000;
  const minutes = fs / 60;
  return vo2Cost(meters / minutes) / pctVO2(minutes);
}
function vdotFromRace(fs, mi) {
  const v = rawVdot(fs, mi);
  if (v == null || v < 30 || v > 85) return null;
  return Math.round(v * 10) / 10;
}
function predictRaceTime(vdot, mi) {
  if (!vdot || !mi) return null;
  let lo = mi*150, hi = mi*1500, mid = (lo+hi)/2;
  for (let i = 0; i < 60; i++) {
    mid = (lo+hi)/2;
    const v = rawVdot(mid, mi);
    if (v == null) break;
    if (v > vdot) lo = mid; else hi = mid;
  }
  return Math.round(mid);
}
function parseTime(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  if (m[3] != null) return +m[1]*3600 + +m[2]*60 + +m[3];
  return +m[1]*60 + +m[2];
}
const QUALITY = new Set(['threshold','tempo','cruise','intervals','vo2','vo2max','marathon_pace','mp','race','time_trial','tune_up']);
function vdotFromRun({ finishSeconds, distanceMi, workoutType, avgHr, maxHr }) {
  if (!finishSeconds || finishSeconds < 60) return null;
  if (!distanceMi || distanceMi < 4) return null;
  const isQuality = QUALITY.has(String(workoutType ?? '').toLowerCase());
  const hrFloor = maxHr ? maxHr * 0.80 : null;
  const isHard = avgHr != null && hrFloor != null && avgHr >= hrFloor;
  if (!isQuality && !isHard) return null;
  return vdotFromRace(finishSeconds, distanceMi);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function computeVdotAsOf(asOf) {
  const raceRows = (await pool.query(
    `SELECT slug, meta, actual_result FROM races
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND (meta->>'date')::date >= ($2::date - interval '180 days')::date
        AND (meta->>'date')::date < $2::date
        AND meta->>'priority' IN ('A','B')`,
    [DAVID, asOf]
  ).catch(() => ({ rows: [] }))).rows;

  const raceCands = raceRows.map(r => {
    const m = r.meta || {};
    const ar = r.actual_result || {};
    const distMi = m.distanceMi ? Number(m.distanceMi) : null;
    let fs = ar.finishS != null ? Number(ar.finishS) : null;
    if (!fs) fs = parseTime(m.finishTime);
    return { date: m.date ?? '', priority: m.priority ?? null, distance_mi: distMi, finish_seconds: fs };
  });

  const qualityCutoff = new Date(Date.parse(asOf + 'T12:00:00Z') - 60 * 86400000).toISOString().slice(0,10);
  const runRows = (await pool.query(
    `SELECT
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
    [DAVID, qualityCutoff, asOf]
  ).catch(() => ({ rows: [] }))).rows;

  const maxHr = (await pool.query(`SELECT COALESCE(max_hr_override, max_hr) AS m FROM users WHERE id=$1`, [DAVID])).rows[0]?.m;
  const maxHrValue = maxHr != null ? Number(maxHr) : null;

  const candidates = [];
  for (const r of raceCands) {
    if (!r.date || !r.distance_mi || !r.finish_seconds || r.priority === 'C') continue;
    const v = vdotFromRace(r.finish_seconds, r.distance_mi);
    if (v != null) candidates.push({ source: 'race', vdot: v });
  }
  for (const r of runRows) {
    const v = vdotFromRun({
      finishSeconds: r.finish_seconds != null ? Number(r.finish_seconds) : null,
      distanceMi: r.distance_mi != null ? Number(r.distance_mi) : null,
      workoutType: r.workout_type,
      avgHr: r.avg_hr != null ? Number(r.avg_hr) : null,
      maxHr: maxHrValue,
    });
    if (v != null) candidates.push({ source: 'run', vdot: v });
  }
  const sortKey = c => c.source === 'race' ? c.vdot : c.vdot - 1;
  const best = candidates.sort((a,b) => sortKey(b) - sortKey(a))[0];
  return best?.vdot ?? null;
}

try {
  const offsets = [0, 7, 14, 21, 30, 45, 60];
  for (const offset of offsets) {
    const asOf = new Date(Date.parse(TODAY + 'T12:00:00Z') - offset * 86400000).toISOString().slice(0,10);
    const vdot = await computeVdotAsOf(asOf);
    for (const dist of DISTANCES) {
      const proj = vdot != null ? predictRaceTime(vdot, dist) : null;
      await pool.query(
        `INSERT INTO projection_snapshots
           (user_uuid, snapshot_date, distance_mi, vdot, projection_sec, race_slug, source)
         VALUES ($1, $2::date, $3, $4, $5, $6, $7)
         ON CONFLICT (user_uuid, snapshot_date, distance_mi)
         DO UPDATE SET vdot=EXCLUDED.vdot, projection_sec=EXCLUDED.projection_sec, source=EXCLUDED.source`,
        [DAVID, asOf, dist, vdot, proj, 'americas-finest-city', 'seed-script']
      );
      console.log(`  ${asOf} · ${dist}mi · VDOT ${vdot ?? 'null'} · proj ${proj ?? 'null'}s`);
    }
  }
  const total = (await pool.query(`SELECT COUNT(*)::int AS c FROM projection_snapshots WHERE user_uuid = $1`, [DAVID])).rows[0].c;
  console.log(`\nTotal snapshots for David: ${total}`);
} catch (e) { console.error(e); }
finally { await pool.end(); }
