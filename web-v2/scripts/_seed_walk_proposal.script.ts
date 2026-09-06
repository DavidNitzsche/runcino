/**
 * scripts/_seed_walk_proposal.script.ts · put ONE pending proposal in the walk
 * database, through the app's own writer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT CALLS `writeWorkoutProposals` RATHER THAN INSERTING
 *
 * Rule 13 is about rendering the real code path. A hand-written INSERT would
 * produce a row that LOOKS like a proposal and skips every rule the writer
 * enforces — the sealed-day check, the past-date refusal, the pending-dedup,
 * the citation scrub on the reason, the action-schema serialisation. A card
 * rendered off such a row proves the card renders, not that the loop works.
 *
 * So this hands the real writer a real `AdaptationAction` and lets it decide.
 * If the writer refuses, that is a finding, not something to route around.
 *
 * SCRATCH ONLY. It refuses any DATABASE_URL that is not loopback, before it
 * opens a connection. There is no flag that makes it write a remote database.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS CANNOT PROVE (Rule 22)
 *
 * · That the CRON would have produced this proposal. It hands the writer an
 *   action directly; `detectAdaptations` never runs. The card is real and the
 *   row is real, but "the engine would have proposed this tonight" is not
 *   something this script establishes.
 * · Anything about the accept path. It only creates the thing to be accepted.
 */
import { pool } from '@/lib/db/pool';
import { writeWorkoutProposals } from '@/lib/plan/workout-proposals';
import type { AdaptationAction, AdaptationTrigger } from '@/lib/plan/adapt';

async function main() {
  const url = process.env.DATABASE_URL ?? '';
  if (!/^postgres(ql)?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url)) {
    console.error(`REFUSING · DATABASE_URL is not loopback.`);
    process.exit(2);
  }

  const userUuid = process.env.WALK_USER_UUID;
  const workoutId = process.env.WALK_WORKOUT_ID;
  if (!userUuid || !workoutId) {
    console.error('REFUSING · set WALK_USER_UUID and WALK_WORKOUT_ID.');
    process.exit(2);
  }

  const before = await pool.query<{ id: string; type: string; distance_mi: string }>(
    `SELECT id, type, distance_mi FROM plan_workouts WHERE id = $1`, [workoutId],
  );
  console.log('target session BEFORE:', before.rows[0]);

  const trigger: AdaptationTrigger = {
    kind: 'volume_overshoot',
    severity: 'warn',
    reason: 'Resting heart rate has run above your baseline for four days. '
          + 'Taking the edge off this tempo keeps the week intact.',
    evidence: { rhr_above_days: 4, rhr_delta_bpm: 5 },
  };
  // `why` carries the FACT, not the disposition. The writer refuses a
  // load-reducing proposal whose why asserts a preference — correctly, and it
  // refused the first version of this script, which is the gate working.
  const action: AdaptationAction = {
    kind: 'downgrade',
    workoutIds: [workoutId],
    newType: 'easy',
    sourceTrigger: 'volume_overshoot',
    why: 'Resting heart rate has sat 5 bpm above your baseline for four days running.',
  };

  const written = await writeWorkoutProposals(userUuid, [action], [trigger]);
  console.log(`writeWorkoutProposals wrote ${written} proposal(s)`);

  const rows = await pool.query(
    `SELECT id, plan_workout_id, workout_date_iso, action_kind, status, reason
       FROM plan_workout_proposals WHERE status = 'pending' ORDER BY id DESC`,
  );
  console.log('pending rows now:', JSON.stringify(rows.rows, null, 2));
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
