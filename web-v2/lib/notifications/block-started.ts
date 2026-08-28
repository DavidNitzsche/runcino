/**
 * lib/notifications/block-started.ts — the coach note for the recovery →
 * next-block handoff.
 *
 * David, 2026-08-28: the recovery→build transition is doctrine-driven and
 * non-optional, so the plan-drift cron auto-applies it (fireAutoRebuild,
 * undo on the notice card) instead of raising a card nobody answers — of
 * forty engine-raised cards this runner has answered zero. The half of that
 * bargain this module carries: the runner has to WAKE UP knowing the block
 * changed, not discover it from a reset week counter.
 *
 * Mirrors lib/notifications/projection-changed.ts: read the primitives the
 * template needs, enqueue for next-morning 07:15 runner-local, never throw —
 * a notification must never fail the cron's transition.
 */
import { pool } from '@/lib/db/pool';
import { rowOrNull } from '@/lib/db/read';
import { runnerTimezone } from '@/lib/runtime/runner-tz';
import { renderBlockStarted } from './templates';
import { enqueueNotification, nextMorning0715 } from './enqueue';

export interface BlockStartedCheck {
  sent: boolean;
  reason: 'enqueued' | 'no_plan' | 'error';
}

/**
 * Enqueue the "Recovery is done" note for a block fireAutoRebuild just
 * landed. Reads the new plan's mode and week count off the database rather
 * than trusting the caller's composition — the note describes what was
 * PERSISTED. Dedup rides the new plan id, so one block notifies once no
 * matter how many ticks see it.
 */
export async function notifyBlockStarted(args: {
  userUuid: string;
  raceSlug: string;
  newPlanId: string;
}): Promise<BlockStartedCheck> {
  const { userUuid, raceSlug, newPlanId } = args;
  try {
    const plan = (await pool.query<{ mode: string | null; weeks: string | null }>(
      `SELECT tp.mode::text AS mode,
              (SELECT COUNT(*) FROM plan_weeks pw WHERE pw.plan_id = tp.id)::text AS weeks
         FROM training_plans tp
        WHERE tp.id = $1 AND tp.user_uuid = $2::uuid`,
      [newPlanId, userUuid],
    )).rows[0];
    if (!plan) return { sent: false, reason: 'no_plan' };

    // A failed name read degrades to the slug — logged, never fatal.
    const nameRow = await rowOrNull(
      'notifications/block-started · race name',
      pool.query<{ name: string | null }>(
        `SELECT meta->>'name' AS name FROM races
          WHERE slug = $1 AND user_uuid = $2::uuid`,
        [raceSlug, userUuid],
      ),
    );
    const raceName = nameRow?.name ?? raceSlug;

    const weeksN = plan.weeks != null ? Number(plan.weeks) : NaN;
    const tz = await runnerTimezone(userUuid);
    const fireAt = nextMorning0715(new Date(), tz);
    const tpl = renderBlockStarted({
      user_id: userUuid,
      race_name: raceName,
      race_slug: raceSlug,
      mode: plan.mode,
      weeks: Number.isFinite(weeksN) && weeksN > 0 ? weeksN : null,
      new_plan_id: newPlanId,
    });
    await enqueueNotification(userUuid, tpl, fireAt);
    return { sent: true, reason: 'enqueued' };
  } catch {
    return { sent: false, reason: 'error' };
  }
}
