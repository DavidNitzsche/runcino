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

const THRESHOLD_SEC = 30;

export interface ProjectionChangeCheck {
  sent: boolean;
  reason: 'no_projection' | 'no_prior_snapshot' | 'below_threshold' | 'changed' | 'error';
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
  if (projectedSec == null) return { sent: false, reason: 'no_projection' };

  const previousSec = await loadPreviousGoalProjectionSec(userUuid, raceSlug, todayISO).catch(() => null);
  await recordGoalProjectionSnapshot(userUuid, raceSlug, todayISO, projectedSec).catch(() => null);

  if (previousSec == null) return { sent: false, reason: 'no_prior_snapshot' };
  if (Math.abs(projectedSec - previousSec) < THRESHOLD_SEC) return { sent: false, reason: 'below_threshold' };

  try {
    const nowDisplay = formatRaceTime(projectedSec);
    const wasDisplay = formatRaceTime(previousSec);
    if (!nowDisplay || !wasDisplay) return { sent: false, reason: 'error' };
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
    return { sent: true, reason: 'changed' };
  } catch {
    return { sent: false, reason: 'error' };
  }
}
