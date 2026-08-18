/**
 * Direct DB equivalent of POST /api/admin/backfill-splits?days=14
 * Same logic as the endpoint, runs against write DB directly.
 */
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
process.env.DATABASE_URL = env.match(/^DATABASE_URL=(.+)$/m)[1].replace(/^["']|["']$/g,'').trim();
const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });

function deriveSplitsFromPaceSamples(phases) {
  if (!Array.isArray(phases) || phases.length === 0) return null;
  const flat = [];
  let distOffset = 0, tOffset = 0;
  for (const phase of phases) {
    const ps = phase.paceSamples ?? [];
    const hs = phase.hrSamples ?? [];
    if (ps.length === 0) { distOffset += Number(phase.actualDistanceMi ?? 0); tOffset += Number(phase.actualDurationSec ?? 0); continue; }
    const hrByT = new Map();
    for (const h of hs) { if (h.bpm != null && h.bpm > 0) hrByT.set(h.tSec, h.bpm); }
    for (const s of ps) {
      if (s.distMi == null) continue;
      flat.push({ tSec: s.tSec + tOffset, distMi: s.distMi + distOffset, bpm: hrByT.get(s.tSec) ?? null });
    }
    distOffset += Number(phase.actualDistanceMi ?? (ps[ps.length-1]?.distMi ?? 0));
    tOffset    += Number(phase.actualDurationSec ?? (ps[ps.length-1]?.tSec  ?? 0));
  }
  if (flat.length < 2) return null;
  flat.sort((a, b) => a.tSec - b.tSec);
  const splits = [];
  let mileNo = 1, prevCrossT = 0;
  for (let i = 1; i < flat.length; i++) {
    const prev = flat[i-1], curr = flat[i];
    const span = curr.distMi - prev.distMi;
    if (span <= 0) continue;
    while (curr.distMi >= mileNo && prev.distMi < mileNo) {
      const frac = (mileNo - prev.distMi) / span;
      const crossT = prev.tSec + frac * (curr.tSec - prev.tSec);
      const elapsedSec = Math.round(crossT - prevCrossT);
      if (elapsedSec >= 120 && elapsedSec <= 3600) {
        const win = flat.filter(s => s.tSec >= prevCrossT && s.tSec <= crossT && s.bpm != null);
        const avgHr = win.length > 0 ? Math.round(win.reduce((s,x)=>s+x.bpm,0)/win.length) : null;
        splits.push({ mile: mileNo, pace: `${Math.floor(elapsedSec/60)}:${String(elapsedSec%60).padStart(2,'0')}`, hr: avgHr, paceSecPerMi: elapsedSec });
      }
      prevCrossT = crossT;
      mileNo++;
    }
  }
  return splits.length > 0 ? splits : null;
}

// Stub detection: a single-entry split on a run > 1.5mi is always a stub
// regardless of what pace fields it has (the read-time normalizer converts
// paceSecPerMi → pace at render, but the raw row may have either shape).
// Don't filter on pace field presence — filter on length=1 + multi-mile.
const runs = (await pool.query(`
  SELECT id::text AS id,
         (data->>'date') AS date,
         (data->>'distanceMi')::float AS dist_mi,
         (data->>'client_workout_id') AS client_workout_id
  FROM runs
  WHERE user_uuid = $1
    AND (data->>'source') = 'watch'
    AND (data->>'mergedIntoId') IS NULL
    AND (data->>'date')::date >= (CURRENT_DATE - 14 * INTERVAL '1 day')
    AND (data->>'distanceMi')::float > 1.5
    AND (
      data->'splits' IS NULL
      OR jsonb_array_length(data->'splits') = 0
      OR jsonb_array_length(data->'splits') = 1
    )
  ORDER BY (data->>'date') DESC
`, [DAVID])).rows;

console.log(`Runs to process: ${runs.length}`);
const results = [];

for (const run of runs) {
  if (!run.client_workout_id) { results.push({ date: run.date, status: 'no_workout_id' }); continue; }
  const ci = (await pool.query(
    `SELECT value FROM coach_intents WHERE user_uuid=$1 AND field=$2 ORDER BY id DESC LIMIT 1`,
    [DAVID, run.client_workout_id]
  )).rows[0];
  if (!ci) { results.push({ date: run.date, dist: run.dist_mi, status: 'no_coach_intent' }); continue; }

  let body = null;
  try { body = typeof ci.value === 'string' ? JSON.parse(ci.value) : ci.value; } catch { /* */ }
  if (!body) { results.push({ date: run.date, dist: run.dist_mi, status: 'parse_failed' }); continue; }

  const phases = body.phases ?? [];
  const paceSampleCount = phases.reduce((s,p)=>s+(p.paceSamples?.length??0), 0);
  const splits = deriveSplitsFromPaceSamples(phases);

  if (!splits || splits.length === 0) {
    results.push({ date: run.date, dist: run.dist_mi, paceSampleCount, status: 'no_splits_derived' });
    continue;
  }

  await pool.query(
    `UPDATE runs SET data = jsonb_set(data, '{splits}', $1::jsonb) WHERE id = $2::BIGINT AND user_uuid = $3`,
    [JSON.stringify(splits), run.id, DAVID]
  );
  results.push({ date: run.date, dist: run.dist_mi, milesRecovered: splits.length, status: 'ok' });
}

const fixed = results.filter(r => r.status === 'ok').length;
console.log(JSON.stringify({ fixed, runsScanned: runs.length, results }, null, 2));

// RO verification of June 5 canonical watch row
console.log('\n── June 5 verification ────────────────────────────');
const v = (await pool.query(`
  SELECT id::text, (data->>'distanceMi')::float AS dist_mi,
         jsonb_array_length(COALESCE(data->'splits','[]'::jsonb)) AS split_count,
         (data->>'splits_unreliable') AS splits_unreliable,
         data->'splits' AS splits
  FROM runs WHERE user_uuid=$1 AND (data->>'source')='watch' AND (data->>'date')='2026-06-05' LIMIT 1
`, [DAVID])).rows[0];

if (v) {
  const ok = (v.split_count >= 6) && v.splits?.every(s => s.pace != null);
  console.log(`split_count=${v.split_count}  splits_unreliable=${v.splits_unreliable ?? 'null'}  all_have_pace=${v.splits?.every(s=>s.pace!=null)}  PASS=${ok}`);
  for (const s of (v.splits ?? [])) {
    console.log(`  mile=${s.mile}  pace=${s.pace}  hr=${s.hr ?? 'null'}  paceSecPerMi=${s.paceSecPerMi}`);
  }
} else { console.log('row not found'); }

await pool.end();
