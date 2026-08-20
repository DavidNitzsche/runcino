// Verify the REAL edited expandSpecToPhases emits isFinishSegment on the
// finish phase, against the real Jun 28 spec (RO). Run:
//   node --experimental-strip-types scripts/_verify_expand_finish.mts
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { expandSpecToPhases } from '../lib/training/expand-spec.ts';

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const RO = env.match(/^DATABASE_URL_RO=(.+)$/m)![1].replace(/^["']|["']$/g, '').trim();
const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const pool = new Pool({ connectionString: RO, ssl: { rejectUnauthorized: false }, max: 2 });

console.log('current_user =', (await pool.query('SELECT current_user')).rows[0].current_user);

for (const date of ['2026-06-28', '2026-07-19']) {
  const wo = (await pool.query(
    `SELECT pw.distance_mi, pw.workout_spec
       FROM plan_workouts pw
       JOIN training_plans tp ON tp.id = pw.plan_id
      WHERE tp.user_uuid=$1 AND tp.archived_iso IS NULL AND pw.date_iso=$2
      ORDER BY tp.authored_iso DESC LIMIT 1`, [DAVID, date])).rows[0];
  const phases = expandSpecToPhases({
    spec: wo.workout_spec,
    totalMi: Number(wo.distance_mi),
    easyPaceSec: 540,
    recoveryPaceSec: 540,
    toleranceSec: 20,
  });
  console.log(`\n${date} · ${wo.distance_mi} mi · ${phases?.length} phases`);
  phases?.forEach((p, i) =>
    console.log(`  [${i}] ${p.label.padEnd(22)} target=${p.targetPaceSPerMi}  isFinishSegment=${(p as any).isFinishSegment ?? false}`));
  console.log(`  → phases[1].isFinishSegment === true ?  ${(phases?.[1] as any)?.isFinishSegment === true}`);
}
await pool.end();
