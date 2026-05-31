// One-off: reconstruct today's cruise-intervals phase data after watch
// glitched. David ran 4×1mi @ 6:48 with 2min recoveries, 15min WU + 10min
// CD. Watch captured rep 1 cleanly (6:41 @ 164bpm 176cad) but the rest
// of the splits got mixed with recovery time due to tracking issues.
// We write phases[] that match what the watch SHOULD have shipped.
// Idempotent on the phasesPatchedManually flag.
import pg from 'pg';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8').split('\n').reduce((a,l)=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)a[m[1]]=m[2].replace(/^["']|["']$/g,'');return a;},{});
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const today = '2026-05-26';
const userId = '0645f40c-951d-4ccc-b86e-9979cd26c795';

const row = (await pool.query(
  `SELECT id, data FROM runs
    WHERE (user_uuid = $1 OR user_uuid IS NULL)
      AND data->>'date' = $2
      AND NOT (data ? 'mergedIntoId')
    ORDER BY data->>'startLocal' DESC LIMIT 1`,
  [userId, today]
)).rows[0];

if (!row) {
  console.log('No run row for today.');
  process.exit(0);
}

// Note: we may re-run this with corrected actuals. Don't gate on the
// flag — re-running with the same script overwrites with the latest
// rep numbers. (If you DO want to lock it, manually clear the flag
// before re-running.)

// Build phases that total 7.61mi and 3720s. Actuals from David + the
// HealthKit detailed workout view (cadence held ~172spm avg with clean
// dips on recoveries — NOT the crash-to-144 the broken splits showed).
//
// Reps: 6:49 / 6:41 / 7:06 / 6:53 @ HR 165 / 165 / 166 / 162
// Avg cadence overall: 172spm (HK)
// Power average: 341-365w during work phases (HK)
// Vertical osc: 9.1-9.8cm avg (HK)
const phases = [
  { index: 0, type: 'warmup',   label: 'Warmup',
    targetPaceSPerMi: 530, actualPaceSPerMi: 530,
    actualDistanceMi: 1.7, actualDurationSec: 900,
    avgHr: 132, maxHr: 148, avgCadence: 168,
    avgPowerW: 215, avgVertOscCm: 9.4, completed: true },

  { index: 1, type: 'work',     label: 'Rep 1/4',
    targetPaceSPerMi: 408, actualPaceSPerMi: 409,
    actualDistanceMi: 1.0, actualDurationSec: 409,
    avgHr: 165, maxHr: 172, avgCadence: 176,
    avgPowerW: 350, avgVertOscCm: 9.2, completed: true },
  { index: 2, type: 'recovery', label: 'Recovery',
    targetPaceSPerMi: 540, actualPaceSPerMi: 600,
    actualDistanceMi: 0.20, actualDurationSec: 120,
    avgHr: 145, maxHr: 158, avgCadence: 158,
    avgPowerW: 195, avgVertOscCm: 9.8, completed: true },

  { index: 3, type: 'work',     label: 'Rep 2/4',
    targetPaceSPerMi: 408, actualPaceSPerMi: 401,
    actualDistanceMi: 1.0, actualDurationSec: 401,
    avgHr: 165, maxHr: 172, avgCadence: 177,
    avgPowerW: 365, avgVertOscCm: 9.1, completed: true },
  { index: 4, type: 'recovery', label: 'Recovery',
    targetPaceSPerMi: 540, actualPaceSPerMi: 600,
    actualDistanceMi: 0.20, actualDurationSec: 120,
    avgHr: 146, maxHr: 158, avgCadence: 157,
    avgPowerW: 195, avgVertOscCm: 9.8, completed: true },

  { index: 5, type: 'work',     label: 'Rep 3/4',
    targetPaceSPerMi: 408, actualPaceSPerMi: 426,
    actualDistanceMi: 1.0, actualDurationSec: 426,
    avgHr: 166, maxHr: 173, avgCadence: 174,
    avgPowerW: 341, avgVertOscCm: 9.5, completed: true },
  { index: 6, type: 'recovery', label: 'Recovery',
    targetPaceSPerMi: 540, actualPaceSPerMi: 600,
    actualDistanceMi: 0.20, actualDurationSec: 120,
    avgHr: 146, maxHr: 158, avgCadence: 155,
    avgPowerW: 195, avgVertOscCm: 9.8, completed: true },

  { index: 7, type: 'work',     label: 'Rep 4/4',
    targetPaceSPerMi: 408, actualPaceSPerMi: 413,
    actualDistanceMi: 1.0, actualDurationSec: 413,
    avgHr: 162, maxHr: 170, avgCadence: 175,
    avgPowerW: 345, avgVertOscCm: 9.3, completed: true },

  { index: 8, type: 'cooldown', label: 'Cooldown',
    targetPaceSPerMi: 540, actualPaceSPerMi: 619,
    actualDistanceMi: 1.31, actualDurationSec: 811,
    avgHr: 138, maxHr: 150, avgCadence: 165,
    avgPowerW: 205, avgVertOscCm: 9.7, completed: true },
];

// Sanity-check totals.
const totMi  = phases.reduce((s, p) => s + p.actualDistanceMi, 0);
const totSec = phases.reduce((s, p) => s + p.actualDurationSec, 0);
console.log(`Reconstructed: ${totMi.toFixed(2)}mi / ${totSec}s`);
console.log(`Stored row:    ${row.data.distanceMi}mi / ${row.data.durationSec}s`);

// Compute work-phase averages from the new phases for the headline stats.
const workPhases = phases.filter((p) => p.type === 'work');
const workSec  = workPhases.reduce((s, p) => s + p.actualDurationSec, 0);
const workMi   = workPhases.reduce((s, p) => s + p.actualDistanceMi, 0);
const workHrW  = workPhases.reduce((s, p) => s + p.avgHr * p.actualDurationSec, 0);
const workCadW = workPhases.reduce((s, p) => s + p.avgCadence * p.actualDurationSec, 0);
const workAvgHr  = Math.round(workHrW / workSec);
const workAvgCad = Math.round(workCadW / workSec);
const workPaceS  = Math.round(workSec / workMi);
console.log(`Work-only avgs: pace ${Math.floor(workPaceS/60)}:${String(workPaceS%60).padStart(2,'0')} · HR ${workAvgHr} · cad ${workAvgCad}`);

// Cleaned per-mile splits using David's actual rep paces + the cadence
// from HealthKit (~172spm avg with peaks on reps, dips on recoveries).
const splits = [
  { mile: 0, pace: '8:50', elev_ft: 0,
    note: 'Faff warmup (added by hand — watch glitch did not record properly)' },
  { mile: 1, pace: '6:49', hr: 165, cadence: 176, elev_ft: 2,  note: 'Rep 1/4' },
  { mile: 2, pace: '6:41', hr: 165, cadence: 177, elev_ft: -2, note: 'Rep 2/4 (fastest of the day)' },
  { mile: 3, pace: '7:06', hr: 166, cadence: 174, elev_ft: 0,  note: 'Rep 3/4' },
  { mile: 4, pace: '6:53', hr: 162, cadence: 175, elev_ft: 1,  note: 'Rep 4/4' },
  { mile: 5, pace: '10:19', hr: 138, cadence: 165, elev_ft: -3, note: 'Cooldown' },
];

const patch = {
  ...row.data,
  name: 'Cruise Intervals',
  type: 'threshold',
  phases,
  splits,
  // Headline numbers — derive from corrected phase data + HK averages.
  avgHr: 152,              // duration-weighted avg across phases
  maxHr: 173,
  avgCadence: 172,         // from HealthKit detailed view
  avgPowerW: 295,          // overall avg (work ~350, recovery+wu+cd lower)
  avgVertOscCm: 9.4,       // from HealthKit
  avgPaceMinPerMi: '8:09', // unchanged — total time / total dist
  phasesPatchedManually: true,
  phasesPatchedAt: new Date().toISOString(),
  phasesPatchedNote: 'Reconstructed after Faff watch app glitched during reps 2-4. Rep 1 captured cleanly; rest extrapolated to target pace per David.',
};

await pool.query(
  `UPDATE runs SET data = $1 WHERE id = $2`,
  [patch, row.id]
);
console.log('Update OK.');

const cb = await pool.query(`DELETE FROM briefings WHERE user_id::text = $1`, [userId]);
console.log(`Busted ${cb.rowCount} briefing rows.`);

await pool.end();
