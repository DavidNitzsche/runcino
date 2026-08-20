import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
process.env.DATABASE_URL = env.match(/^DATABASE_URL=(.+)$/m)[1].replace(/^["']|["']$/g,'').trim();
const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });

function reconstructBody(value) {
  if (!value || typeof value !== 'object') return null;
  const keys = Object.keys(value);
  const isCharArray = keys.length > 10 && keys.every(k => /^\d+$/.test(k));
  if (isCharArray) {
    try { return JSON.parse(keys.sort((a,b)=>+a-+b).map(k=>value[k]).join('')); } catch { return null; }
  }
  return value;
}

// All watch runs in the last 30 days with their coach_intents
const runs = (await pool.query(`
  SELECT r.id::text, (r.data->>'date') AS date, (r.data->>'distanceMi')::float AS dist_mi,
         (r.data->>'client_workout_id') AS wid,
         (r.data->>'type') AS run_type,
         jsonb_array_length(COALESCE(r.data->'splits','[]'::jsonb)) AS splits_on_row
  FROM runs r
  WHERE r.user_uuid=$1 AND (r.data->>'source')='watch'
    AND (r.data->>'date')::date >= (CURRENT_DATE - INTERVAL '30 days')
    AND (r.data->>'mergedIntoId') IS NULL
  ORDER BY (r.data->>'date') DESC
`, [DAVID])).rows;

console.log(`\nWatch canonical runs last 30 days: ${runs.length}\n`);
console.log('date        type        dist    splits_on_row  paceSamples  lastDistMi  distMatch  histInDB');
console.log('─'.repeat(95));

for (const r of runs) {
  const ci = (await pool.query(
    `SELECT value FROM coach_intents WHERE user_uuid=$1 AND field=$2 ORDER BY id DESC LIMIT 1`,
    [DAVID, r.wid]
  )).rows[0];

  if (!ci) { console.log(`${r.date}  ${String(r.run_type??'?').padEnd(10)}  ${String(r.dist_mi?.toFixed(2)??'?').padStart(5)}mi  splits=${r.splits_on_row}  NO COACH_INTENT`); continue; }

  const body = reconstructBody(ci.value);
  if (!body) { console.log(`${r.date}  ${String(r.run_type??'?').padEnd(10)}  ${String(r.dist_mi?.toFixed(2)??'?').padStart(5)}mi  splits=${r.splits_on_row}  RECONSTRUCT_FAILED`); continue; }

  const phases = body.phases ?? [];
  let totalPaceSamples = 0, lastDistMi = null;
  for (const p of phases) {
    const ps = p.paceSamples ?? [];
    totalPaceSamples += ps.length;
    if (ps.length > 0) {
      const last = ps[ps.length-1];
      lastDistMi = (lastDistMi ?? 0) + (last.distMi ?? 0);
    }
  }
  const distMatch = lastDistMi != null ? Math.abs(lastDistMi - r.dist_mi) < 0.1 ? 'YES' : `DELTA=${(lastDistMi-r.dist_mi).toFixed(3)}` : 'N/A';
  const hasSamples = totalPaceSamples > 0;
  console.log(`${r.date}  ${String(r.run_type??'easy').padEnd(10)}  ${String(r.dist_mi?.toFixed(2)??'?').padStart(5)}mi  splits=${r.splits_on_row}  ps=${String(totalPaceSamples).padStart(4)}  lastDist=${lastDistMi?.toFixed(3)??'null'}  ${distMatch.padEnd(12)}  ${hasSamples?'YES':'NO'}`);
}
await pool.end();
