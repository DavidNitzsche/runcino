/**
 * lib/notifications/projection-changed.ts — push when the Races card's
 * "Projected" moves >= 30s day-over-day.
 *
 * David, 2026-08-26: asked for this the day 878c623c switched "Projected"
 * from a frozen current-VDOT snapshot to computeGoalProjection's live
 * execution-scaled trajectory — the number now actually moves as training
 * happens, so it's worth knowing about. Threshold picked to skip the
 * model's ordinary day-to-day wobble and only fire on a real move.
 *
 * Mirrors lib/notifications/session-moved.ts: snapshot before/after,
 * gate on a genuine change, enqueue for next-morning 07:15 local rather
 * than sending synchronously — never mid-run, never at night.
 */
import { recordGoalProjectionSnapshot, loadPreviousGoalProjectionSec } from '@/lib/training/goal-projection-snapshots';
import { formatRaceTime } from '@/lib/training/vdot';
import { runnerTimezone } from '@/lib/runtime/runner-tz';
import { renderProjectionChanged } from './templates';
import { enqueueNotification, nextMorning0715 } from './enqueue';
import { MEANINGFUL_MOVE_SEC } from '@/lib/training/projection-trend';

/**
 * 2026-08-30 · this 30 was declared here and, once the Races chart needed the
 * same "did it actually move" bar, would have been declared twice. It now
 * lives in lib/training/projection-trend.ts and both readers import it, so
 * the push and the chart cannot disagree about what a move is.
 */
const THRESHOLD_SEC = MEANINGFUL_MOVE_SEC;

export interface ProjectionChangeCheck {
  sent: boolean;
  reason: 'no_projection' | 'no_prior_snapshot' | 'below_threshold' | 'changed' | 'error';
  /**
   * Whether today's row actually landed in `goal_projection_snapshots`.
   *
   * This exists because it did not, for days, and nothing said so. The write
   * was `.catch(() => null)` and the route reported `reason:
   * 'no_prior_snapshot'` — which is also what a healthy cold start looks
   * like — while migration 155 sat unapplied in prod and the table the
   * Races chart now reads was never created. A write that fails must be
   * distinguishable from a write that had nothing to compare against.
   */
  recorded: boolean;
}

/**
 * Records today's snapshot unconditionally (so tomorrow has something to
 * diff against even when nothing fires today), then enqueues a push only
 * when the move against the most recent PRIOR snapshot is >= 30s.
 *
 * Never throws — a notification must never fail the cron's snapshot write.
 */
export async function checkAndNotifyProjectionChange(args: {
  userUuid: string;
  raceSlug: string;
  raceName: string;
  todayISO: string;
  projectedSec: number | null;
}): Promise<ProjectionChangeCheck> {
  const { userUuid, raceSlug, raceName, todayISO, projectedSec } = args;
  if (projectedSec == null) return { sent: false, reason: 'no_projection', recorded: false };

  const previousSec = await loadPreviousGoalProjectionSec(userUuid, raceSlug, todayISO).catch(() => null);
  const recorded = await recordGoalProjectionSnapshot(userUuid, raceSlug, todayISO, projectedSec)
    .then(() => true)
    .catch((e: unknown) => {
      console.error('[projection-changed] snapshot write failed:', userUuid, raceSlug, e);
      return false;
    });

  if (previousSec == null) return { sent: false, reason: 'no_prior_snapshot', recorded };
  if (Math.abs(projectedSec - previousSec) < THRESHOLD_SEC) return { sent: false, reason: 'below_threshold', recorded };

  try {
    const nowDisplay = formatRaceTime(projectedSec);
    const wasDisplay = formatRaceTime(previousSec);
    if (!nowDisplay || !wasDisplay) return { sent: false, reason: 'error', recorded };
    const tz = await runnerTimezone(userUuid);
    const fireAt = nextMorning0715(new Date(), tz);
    const tpl = renderProjectionChanged({
      user_id: userUuid,
      race_slug: raceSlug,
      race_name: raceName,
      date_iso: todayISO,
      now_display: nowDisplay,
      was_display: wasDisplay,
    });
    await enqueueNotification(userUuid, tpl, fireAt);
    return { sent: true, reason: 'changed', recorded };
  } catch {
    return { sent: false, reason: 'error', recorded };
  }
}
