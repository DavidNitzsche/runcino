/**
 * _simulate_horizon.mjs · simulates the Rule 11 horizon-aware override
 * for David's race schedule. Queries his races + AFC's current target,
 * computes which horizon races qualify and what the override would be.
 *
 * Doesn't actually rebuild the plan · that happens when the next
 * race-mutation / drift cron / accepted proposal fires. This is the
 * doctrine-trace tool that verifies the wiring against live data.
 *
 * Usage: node scripts/_simulate_horizon.mjs
 */
import { Pool } from 'pg';

const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL not set.'); process.exit(1); }
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

// Mirror lib/plan/goal-tiers.ts § TIER_TARGETS for the 4 relevant cells
const TIER_TARGETS = {
  hm: {
    advanced:     { peakLongMiBand: [15, 17], longRunShare: 0.25, peakWeeklyMileageBand: [55, 85], qualityPerWeek: 2 },
    intermediate: { peakLongMiBand: [12, 14], longRunShare: 0.30, peakWeeklyMileageBand: [35, 45], qualityPerWeek: 2 },
  },
  m: {
    advanced:     { peakLongMiBand: [20, 22], longRunShare: 0.30, peakWeeklyMileageBand: [55, 75], qualityPerWeek: 2 },
    intermediate: { peakLongMiBand: [18, 20], longRunShare: 0.34, peakWeeklyMileageBand: [40, 55], qualityPerWeek: 2 },
  },
  '10k': {
    advanced:     { peakLongMiBand: [10, 13], longRunShare: 0.24, peakWeeklyMileageBand: [40, 55], qualityPerWeek: 2 },
  },
  '5k': {
    advanced:     { peakLongMiBand: [8, 12],  longRunShare: 0.22, peakWeeklyMileageBand: [35, 50], qualityPerWeek: 2 },
  },
};
function distCat(mi) {
  if (mi <= 4)  return '5k';
  if (mi <= 8)  return '10k';
  if (mi <= 17) return 'hm';
  if (mi <= 30) return 'm';
  return 'ultra';
}
function classifyTier(goalPaceSec, mi) {
  const cat = distCat(mi);
  if (cat === 'hm') {
    if (goalPaceSec <= 360) return 'elite';
    if (goalPaceSec <= 420) return 'advanced';
    if (goalPaceSec <= 555) return 'intermediate';
    return 'developing';
  }
  if (cat === 'm') {
    if (goalPaceSec <= 360) return 'elite';
    if (goalPaceSec <= 420) return 'advanced';
    if (goalPaceSec <= 555) return 'intermediate';
    return 'developing';
  }
  if (cat === '10k') {
    if (goalPaceSec <= 345) return 'elite';
    if (goalPaceSec <= 390) return 'advanced';
    if (goalPaceSec <= 510) return 'intermediate';
    return 'developing';
  }
  if (cat === '5k') {
    if (goalPaceSec <= 330) return 'elite';
    if (goalPaceSec <= 360) return 'advanced';
    if (goalPaceSec <= 480) return 'intermediate';
    return 'developing';
  }
  return 'intermediate';
}
function parseRaceTime(s) {
  const m = String(s || '').trim().match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  if (m[3] != null) return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
  const first = +m[1], second = +m[2];
  return first <= 9 ? first * 3600 + second * 60 : first * 60 + second;
}

async function main() {
  // 1. Current plan + race
  const plan = (await pool.query(
    `SELECT id, race_id FROM training_plans WHERE user_uuid = $1 AND archived_iso IS NULL ORDER BY authored_iso DESC LIMIT 1`,
    [DAVID],
  )).rows[0];
  if (!plan) { console.log('No plan.'); process.exit(0); }
  const currentMeta = (await pool.query(
    `SELECT meta FROM races WHERE slug = $1`, [plan.race_id],
  )).rows[0]?.meta || {};
  const curDate = currentMeta.date;
  const curMi = Number(currentMeta.distanceMi);
  const curGoalSec = parseRaceTime(currentMeta.goalDisplay);
  const curPace = curGoalSec ? curGoalSec / curMi : null;
  const curTier = curPace ? classifyTier(curPace, curMi) : 'intermediate';
  const curBands = TIER_TARGETS[distCat(curMi)]?.[curTier];

  console.log(`\n=== Current race: ${currentMeta.name} ===`);
  console.log(`  date: ${curDate} · ${curMi}mi · goal ${currentMeta.goalDisplay} (${curPace?.toFixed(1)}s/mi) · tier ${distCat(curMi)} ${curTier}`);
  if (curBands) {
    console.log(`  peak weekly band: [${curBands.peakWeeklyMileageBand}] · long band: [${curBands.peakLongMiBand}] · long share: ${curBands.longRunShare}`);
  }

  // 2. Horizon races (same filter as composePlan wrapper)
  const horizon = (await pool.query(
    `SELECT slug, meta FROM races
      WHERE user_uuid = $1
        AND (meta->>'date')::date > $2::date
        AND (meta->>'date')::date <= ($2::date + interval '168 days')
        AND meta->>'priority' IN ('A','B')
        AND (meta->>'distanceMi')::numeric > $3::numeric
      ORDER BY (meta->>'date')::date`,
    [DAVID, curDate, curMi],
  )).rows;

  console.log(`\n=== Horizon races (A/B, >${curMi}mi, within 24wk) ===`);
  if (horizon.length === 0) {
    console.log('  (none)');
    process.exit(0);
  }
  let bestCap = curBands?.peakLongMiBand[1] ?? 17;
  let bestShare = curBands?.longRunShare ?? 0.25;
  let bestRace = null;
  for (const h of horizon) {
    const m = h.meta || {};
    const hMi = Number(m.distanceMi);
    const hGoalSec = parseRaceTime(m.goalDisplay);
    const hPace = hGoalSec ? hGoalSec / hMi : null;
    const hTier = hPace ? classifyTier(hPace, hMi) : 'intermediate';
    const hBands = TIER_TARGETS[distCat(hMi)]?.[hTier];
    console.log(`  ${m.date} · ${m.priority} · ${m.name} · ${hMi.toFixed(1)}mi · ${m.goalDisplay} · tier ${distCat(hMi)} ${hTier}`);
    if (hBands) {
      console.log(`    long band [${hBands.peakLongMiBand}] · share ${hBands.longRunShare} · weekly band [${hBands.peakWeeklyMileageBand}]`);
      if (hBands.peakLongMiBand[1] > bestCap || hBands.longRunShare > bestShare) {
        if (hBands.peakLongMiBand[1] > bestCap) bestCap = hBands.peakLongMiBand[1];
        if (hBands.longRunShare > bestShare) bestShare = hBands.longRunShare;
        bestRace = { name: m.name, date: m.date, distanceMi: hMi };
      }
    }
  }

  console.log(`\n=== Horizon override ===`);
  if (!bestRace) {
    console.log(`  (no horizon race exceeds current tier · no override)`);
    process.exit(0);
  }
  console.log(`  DRIVER: ${bestRace.name} (${bestRace.date})`);
  console.log(`  long cap : ${curBands.peakLongMiBand[1]}mi → ${bestCap}mi`);
  console.log(`  long share: ${curBands.longRunShare} → ${bestShare}`);
  const newWeekly = [Math.round((curBands.peakWeeklyMileageBand[0] + curBands.peakWeeklyMileageBand[1]) / 2), curBands.peakWeeklyMileageBand[1]];
  console.log(`  weekly band: [${curBands.peakWeeklyMileageBand}] → [${newWeekly}]`);
  console.log(`  (lower-band shifts toward mid; upper stays at HM cap so quality doesn't blow up)`);

  console.log(`\n=== What the rebuilt plan would look like (estimated peak week) ===`);
  // Plan ramps from baseMi=35 toward upper-band 70-ish. Cap at peak.
  const peakWk = Math.min(curBands.peakWeeklyMileageBand[1], Math.round(35 * Math.pow(1.10, 8)));
  const peakLong = Math.min(bestCap, Math.round(peakWk * bestShare));
  console.log(`  est. peak weekly: ~${peakWk}mi (from base 35 ramping at 10%/wk)`);
  console.log(`  est. peak long  : round(${peakWk} × ${bestShare}) = ${peakLong}mi (capped at ${bestCap})`);

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
