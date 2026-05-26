// One-off: after today's Apple Watch HKWorkout lands via the new HK importer,
// fold in the 15-min easy-pace warmup that the Faff watch app failed to
// record (David did the warmup, but the watch app glitched and shipped a
// hollow 40-sec shell — which has been deleted).
//
// What this does:
//   - finds the latest 2026-05-26 run row in strava_activities for David
//   - bumps distanceMi by +1.7mi (15min @ ~8:50/mi easy pace)
//   - bumps durationSec/movingSec by +900s (15min)
//   - prepends a "Faff warmup (added by hand)" synthetic split at mile 0
//   - sets data.warmupAddedManually = true so we can audit it later
//   - busts the briefing cache
//
// Run AFTER David opens iPhone build 78 and the HK importer ingests the
// Apple Watch run. Safe to re-run — idempotent on the warmupAddedManually flag.
import pg from 'pg';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8').split('\n').reduce((a,l)=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)a[m[1]]=m[2].replace(/^["']|["']$/g,'');return a;},{});
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const userId = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const WARMUP_MI  = 1.7;     // 15 min @ ~8:50/mi
const WARMUP_SEC = 15 * 60; // 900s

const rows = (await pool.query(
  `SELECT id, data FROM strava_activities
    WHERE user_uuid = $1
      AND data->>'date' = '2026-05-26'
      AND (data->>'distanceMi')::numeric > 1.0
      AND NOT (data ? 'mergedIntoId')
    ORDER BY data->>'startLocal' DESC NULLS LAST
    LIMIT 1`, [userId]
)).rows;

if (rows.length === 0) {
  console.log('No real run found for today yet. Open the iPhone app to trigger HK import, then re-run.');
  await pool.end();
  process.exit(0);
}
const row = rows[0];
if (row.data.warmupAddedManually) {
  console.log(`Row id=${row.id} already has warmupAddedManually=true. Skipping.`);
  await pool.end();
  process.exit(0);
}

const oldDist = Number(row.data.distanceMi ?? 0);
const oldDur  = Number(row.data.durationSec ?? 0);
const oldMov  = Number(row.data.movingSec ?? oldDur);
const newDist = Math.round((oldDist + WARMUP_MI) * 100) / 100;
const newDur  = oldDur + WARMUP_SEC;
const newMov  = oldMov + WARMUP_SEC;

// New avg pace per mile = newDur / newDist
const sPerMi = Math.round(newDur / newDist);
const newAvgPace = `${Math.floor(sPerMi / 60)}:${String(sPerMi % 60).padStart(2,'0')}`;

const warmupSplit = {
  mile: 0,
  pace: '8:50',
  elev_ft: 0,
  note: 'Faff warmup (added by hand — watch glitch did not record properly)'
};
const existingSplits = Array.isArray(row.data.splits) ? row.data.splits : [];

function mmss(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

const patch = {
  ...row.data,
  distanceMi: newDist,
  durationSec: newDur,
  movingSec: newMov,
  movingTimeS: newMov,            // legacy alias readers use
  timeMoving: mmss(newMov),       // formatted string the modal renders
  avgPaceMinPerMi: newAvgPace,
  splits: [warmupSplit, ...existingSplits],
  warmupAddedManually: true,
  warmupAddedAt: new Date().toISOString(),
  warmupNote: '15-min easy warmup in Faff watch app — watch app did not record, hand-added',
};

console.log(`Patching id=${row.id}:`);
console.log(`  distance ${oldDist}mi → ${newDist}mi (+${WARMUP_MI})`);
console.log(`  duration ${oldDur}s → ${newDur}s (+${WARMUP_SEC})`);
console.log(`  pace was ${row.data.avgPaceMinPerMi ?? '?'} → ${newAvgPace}`);

await pool.query(`UPDATE strava_activities SET data = $1 WHERE id = $2`, [patch, row.id]);
console.log('Update OK.');

const cb = await pool.query(`DELETE FROM briefings WHERE user_id::text = $1`, [userId]);
console.log(`Busted ${cb.rowCount} briefing rows.`);

await pool.end();
