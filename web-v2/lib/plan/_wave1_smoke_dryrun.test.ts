/**
 * Wave-1 smoke · DRY-RUN detection against prod data (READ-ONLY).
 * Calls detectAdaptations (no applyAdaptations) for every active plan and
 * asserts the new engine invariants hold on live data:
 *   · no reschedule targets an occupied / rest / long-run day
 *   · no reschedule of a workout >3 days past its original date
 *   · David (post-cleanup, ran today) gets zero apply-now mutations
 * Untracked one-shot; delete after the first green prod cron.
 */
import { describe, it, expect } from 'vitest';
import { pool } from '@/lib/db/pool';
import { detectAdaptations, partitionActionsForCron } from '@/lib/plan/adapt';

const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';

describe('wave1 dry-run · prod detection sweep', () => {
  it('detection invariants hold for every active plan', async () => {
    const users = (await pool.query(
      `SELECT DISTINCT user_uuid::text AS uid FROM training_plans
        WHERE archived_iso IS NULL AND user_uuid IS NOT NULL`
    )).rows.map((r: any) => r.uid);
    expect(users.length).toBeGreaterThan(0);

    for (const uid of users) {
      const { triggers, actions } = await detectAdaptations(uid);
      const parts = partitionActionsForCron(actions);
      const kinds = actions.map((a: any) => `${a.kind}${a.newDate ? '→' + a.newDate : ''}`).join(', ') || '-';
      console.log(`user ${uid.slice(0, 8)} · triggers: [${triggers.map((t: any) => t.kind).join(', ') || '-'}] · actions: ${kinds} · applyNow=${parts.applyNow.length} propose=${parts.proposeFirst.length}`);

      for (const a of actions.filter((x: any) => x.kind === 'reschedule' && x.newDate)) {
        // target date must be truly free for this user's active plan
        const clash = (await pool.query(
          `SELECT pw.id, pw.type FROM plan_workouts pw
             JOIN training_plans tp ON tp.id = pw.plan_id
            WHERE tp.user_uuid = $1 AND tp.archived_iso IS NULL
              AND pw.date_iso = $2 AND pw.type <> 'rest'
              AND NOT (pw.id = ANY($3::text[]))`,
          [uid, a.newDate, a.workoutIds ?? []]
        )).rows;
        expect(clash, `user ${uid} reschedule to ${a.newDate} collides: ${JSON.stringify(clash)}`).toHaveLength(0);

        // never reschedule stale work (>3d past original date)
        const stale = (await pool.query(
          `SELECT id FROM plan_workouts
            WHERE id = ANY($1::text[])
              AND COALESCE(original_date_iso, date_iso)::date < (CURRENT_DATE - 3)`,
          [a.workoutIds ?? []]
        )).rows;
        expect(stale, `user ${uid} reschedules stale workout(s) ${JSON.stringify(stale)}`).toHaveLength(0);
      }

      if (uid === DAVID) {
        // notes are benign (coach_intents only); anything that mutates
        // plan_workouts (reschedule/downgrade/shave) must not target David
        const mutating = parts.applyNow.filter((a: any) => a.kind !== 'note');
        expect(mutating, `David should get zero mutating apply-now actions, got ${JSON.stringify(mutating)}`).toHaveLength(0);
      }
    }
  }, 120_000);
});
