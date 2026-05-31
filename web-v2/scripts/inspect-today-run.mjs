// Quick inspection: what's the plan for today + what's stored for today's run?
import pg from 'pg';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8').split('\n').reduce((a,l)=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)a[m[1]]=m[2].replace(/^["']|["']$/g,'');return a;},{});
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const today = '2026-05-26';
const userId = '0645f40c-951d-4ccc-b86e-9979cd26c795';

console.log('═══ PLANNED WORKOUT ═══');
const plan = (await pool.query(
  `SELECT pw.type, pw.distance_mi, pw.notes
     FROM plan_workouts pw
     JOIN training_plans tp ON tp.id = pw.plan_id
    WHERE tp.user_uuid = $1 AND tp.archived_iso IS NULL
      AND pw.date_iso = $2`,
  [userId, today]
)).rows[0];
console.log(JSON.stringify(plan, null, 2));

console.log('\n═══ STORED RUN ROW ═══');
const run = (await pool.query(
  `SELECT data FROM runs
    WHERE (user_uuid = $1 OR user_uuid IS NULL)
      AND data->>'date' = $2
      AND NOT (data ? 'mergedIntoId')
    ORDER BY data->>'startLocal' DESC LIMIT 1`,
  [userId, today]
)).rows[0];
if (run) {
  const d = run.data;
  console.log('  id:', d.id ?? d.activityId);
  console.log('  name:', d.name);
  console.log('  type:', d.type);
  console.log('  distanceMi:', d.distanceMi);
  console.log('  durationSec:', d.durationSec);
  console.log('  movingSec:', d.movingSec);
  console.log('  avgPaceMinPerMi:', d.avgPaceMinPerMi);
  console.log('  avgHr:', d.avgHr);
  console.log('  maxHr:', d.maxHr);
  console.log('  avgCadence:', d.avgCadence);
  console.log('  splits[' + (d.splits?.length ?? 0) + ']:', JSON.stringify(d.splits ?? [], null, 2));
  console.log('  phases[' + (d.phases?.length ?? 0) + ']:', JSON.stringify(d.phases ?? [], null, 2));
  console.log('  warmupAddedManually:', d.warmupAddedManually);
} else {
  console.log('  (no run row for today)');
}

await pool.end();
