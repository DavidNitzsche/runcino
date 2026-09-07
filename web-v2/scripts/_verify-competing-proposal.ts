/**
 * scripts/_verify-competing-proposal.ts · COMPETINGPROPOSAL-1 real-data check.
 *
 * Verifies against a local scratch copy of David's real production rows
 * (`faff_visual_walk`, with migrations 166/167 applied locally for this
 * check) that two competing proposals for the same workout now produce an
 * explicit arbitration result — a durable winner, a durable loser, a reason,
 * and a reassessment date — instead of a silent skip.
 *
 * NOT run against production. `DATABASE_URL` must point at the local scratch
 * database; see scripts/walk-substrate.sh for the loopback-only pattern this
 * borrows.
 *
 *   DATABASE_URL=postgresql://localhost:5432/faff_visual_walk \
 *     node scripts/_bundle-script.mjs scripts/_verify-competing-proposal.ts
 */
import { pool } from '@/lib/db/pool';
import { writeWorkoutProposals } from '@/lib/plan/workout-proposals';
import type { AdaptationAction, AdaptationTrigger } from '@/lib/plan/adapt';

const USER = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const WORKOUT_A = 'wko_7d8d87c29fe046fa'; // tempo 6.2mi, 2026-09-08 (scenario A: defer)
const WORKOUT_B = 'wko_d19936ca5659c63b'; // easy 5mi, 2026-09-09 (scenario B: safety override)

async function reset(workoutId: string) {
  await pool.query(`DELETE FROM plan_workout_proposals WHERE plan_workout_id = $1`, [workoutId]);
  await pool.query(
    `DELETE FROM plan_decision_ledger WHERE workout_ids @> jsonb_build_array($1::text)`,
    [workoutId],
  );
  await pool.query(`DELETE FROM reassessment_schedule WHERE payload->>'workoutId' = $1`, [workoutId]);
}

async function dump(label: string, workoutId: string) {
  console.log(`\n── ${label} ──`);
  const props = await pool.query(
    `SELECT id, action_kind, status, resolved_at IS NOT NULL AS resolved
       FROM plan_workout_proposals WHERE plan_workout_id = $1 ORDER BY id`,
    [workoutId],
  );
  console.log('plan_workout_proposals:', JSON.stringify(props.rows));
  const ledger = await pool.query(
    `SELECT id, decision, lever, authority_verdict, explanation
       FROM plan_decision_ledger WHERE workout_ids @> jsonb_build_array($1::text) ORDER BY id`,
    [workoutId],
  );
  console.log('plan_decision_ledger:', JSON.stringify(ledger.rows, null, 0));
  const reassess = await pool.query(
    `SELECT id, kind, reason_code, assess_on_iso, status
       FROM reassessment_schedule WHERE payload->>'workoutId' = $1 ORDER BY id`,
    [workoutId],
  );
  console.log('reassessment_schedule:', JSON.stringify(reassess.rows));
}

function trig(reason: string): AdaptationTrigger[] {
  return [{ kind: 'readiness_pullback', reason, evidence: {} } as unknown as AdaptationTrigger];
}

async function scenarioA() {
  await reset(WORKOUT_A);
  console.log('\n\n════ SCENARIO A · two evidenced downgrades compete for one workout ════');

  const first: AdaptationAction = {
    kind: 'downgrade', workoutIds: [WORKOUT_A], newType: 'easy',
    why: 'HRV down 3 days running and RHR elevated 6bpm above baseline',
  };
  const n1 = await writeWorkoutProposals(USER, [first], trig('HRV down 3 days running'));
  console.log(`first writeWorkoutProposals → wrote ${n1}`);
  await dump('after FIRST action', WORKOUT_A);

  const second: AdaptationAction = {
    kind: 'downgrade', workoutIds: [WORKOUT_A], newType: 'rest',
    why: 'sleep duration down 90 minutes for 4 consecutive nights, HR elevated',
  };
  const n2 = await writeWorkoutProposals(USER, [second], trig('sleep duration down 90 minutes'));
  console.log(`second (competing) writeWorkoutProposals → wrote ${n2}`);
  await dump('after SECOND (competing) action', WORKOUT_A);
}

async function scenarioB() {
  await reset(WORKOUT_B);
  console.log('\n\n════ SCENARIO B · a pending PUSH, then an evidenced safety decline ════');

  const push: AdaptationAction = {
    kind: 'mark_upgrade', workoutIds: [WORKOUT_B],
    bumps: [{ workoutId: WORKOUT_B, newDistanceMi: 6 }],
    why: 'four consecutive weeks at or above target load with no missed sessions',
  };
  const n1 = await writeWorkoutProposals(USER, [push], trig('sustained load, adaptive ramp'));
  console.log(`first (push) writeWorkoutProposals → wrote ${n1}`);
  await dump('after PUSH proposal', WORKOUT_B);

  const decline: AdaptationAction = {
    kind: 'downgrade', workoutIds: [WORKOUT_B], newType: 'rest',
    why: 'HRV down 5 days running and resting heart rate elevated 8bpm above baseline',
  };
  const n2 = await writeWorkoutProposals(USER, [decline], trig('HRV down 5 days running'));
  console.log(`second (safety decline) writeWorkoutProposals → wrote ${n2}`);
  await dump('after SAFETY DECLINE (should supersede the push)', WORKOUT_B);
}

async function main() {
  await scenarioA();
  await scenarioB();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
