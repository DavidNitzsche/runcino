/**
 * Ongoing large-shift guard · "Your VDOT moved >2pts since last reviewed"
 *
 * The companion to L7's per-workout adaptive bumps. Where L7 watches
 * training execution between races for fitness drift, this guard
 * watches the AGGREGATE VDOT itself, the resolved value rendered
 * on /profile and consumed by every prescription. If a fresh race
 * result lands and shifts aggregate VDOT by >2 points without the
 * user reviewing, the banner surfaces:
 *
 *   "Your VDOT moved from X to Y since you last reviewed. Review?"
 *
 * Same banner shape as suspect-ceiling + L7 (evidence + reasoning +
 * recommendation + falsifier + agency). Three actions:
 *
 *   Apply        · accept the new VDOT (record review at current)
 *   Dismiss(30D) · suppress for 30 days regardless of further drift
 *   Investigate  · 24-hour snooze ("I'm looking into this")
 *
 * BASELINE
 *   On first /profile load, vdot_last_reviewed is set to current
 *   aggregate VDOT (no banner on day one). Subsequent shifts >2pts
 *   trigger the banner.
 *
 * CONTEXT FILTERS (per CLAUDE.md rule #5, per-finding context filters)
 *   - race-week suppression (within 7 days of any race)
 *   - 30-day Dismiss respected
 *   - 24-hour Investigate snooze respected
 *
 * The shift threshold is locked at 2.0 VDOT points per David's spec
 * 2026-05-19 round 4. Below that, normal session-to-session noise.
 */

import { query } from './db';
import { RACE_RECENCY_DAYS } from './adaptive-vdot-signals';

export const SHIFT_FIRE_THRESHOLD = 2.0;
export const DISMISS_SUPPRESS_DAYS = 30;
export const SNOOZE_HOURS = 24;

export interface VdotShiftFinding {
  shouldRender: boolean;
  suppressReason?: 'no-baseline' | 'within-threshold' | 'dismissed' | 'snoozed' | 'race-week';
  currentVdot: number | null;
  lastReviewed: number | null;
  lastReviewedAt: string | null;
  shiftPoints: number | null;
  /** Positive = VDOT up (faster). */
  direction: 'up' | 'down' | null;
}

/** Compute the shift-guard finding. Returns null when no current VDOT
 *  is computable (no race history). */
export async function computeVdotShiftFinding(
  userId: string,
  currentVdot: number | null,
  todayIso: string,
): Promise<VdotShiftFinding> {
  const empty: VdotShiftFinding = {
    shouldRender: false,
    currentVdot,
    lastReviewed: null,
    lastReviewedAt: null,
    shiftPoints: null,
    direction: null,
  };
  if (!currentVdot || !Number.isFinite(currentVdot)) {
    return { ...empty, suppressReason: 'no-baseline' };
  }

  // Read baseline + suppress timestamps in one round-trip.
  const rows = await query<{
    last_reviewed: string | null;
    last_reviewed_at: Date | null;
    dismissed_at: Date | null;
    snoozed_at: Date | null;
  }>(
    `SELECT
        vdot_last_reviewed::TEXT      AS last_reviewed,
        vdot_last_reviewed_at         AS last_reviewed_at,
        vdot_shift_dismissed_at       AS dismissed_at,
        vdot_shift_snoozed_at         AS snoozed_at
       FROM users WHERE id = $1 LIMIT 1`,
    [userId],
  );
  const row = rows[0];
  const lastReviewedRaw = row?.last_reviewed;
  const lastReviewed = lastReviewedRaw != null ? Number(lastReviewedRaw) : null;
  const lastReviewedAt = row?.last_reviewed_at?.toISOString() ?? null;

  // First-time baseline: write current value, don't fire yet.
  if (lastReviewed == null || !Number.isFinite(lastReviewed)) {
    try {
      await query(
        `UPDATE users SET vdot_last_reviewed = $2, vdot_last_reviewed_at = NOW() WHERE id = $1`,
        [userId, currentVdot],
      );
    } catch { /* baseline write failure isn't fatal */ }
    return { ...empty, lastReviewed: currentVdot, suppressReason: 'no-baseline' };
  }

  const shiftPoints = Math.round((currentVdot - lastReviewed) * 10) / 10;
  const absShift = Math.abs(shiftPoints);
  const direction: VdotShiftFinding['direction'] =
    shiftPoints > 0 ? 'up' : shiftPoints < 0 ? 'down' : null;

  // Race-week suppression, reuse same calendar query approach as L7.
  // Per CLAUDE.md rule #5: this surface applies its OWN race-recency
  // check (doesn't inherit from any parent). If a race sits within
  // ±RACE_RECENCY_DAYS of today, the VDOT may have just shifted from
  // a fresh result, give the runner a moment to absorb the race
  // before pushing the review prompt.
  try {
    const padDays = RACE_RECENCY_DAYS;
    const padStart = new Date(Date.parse(todayIso + 'T00:00:00Z') - padDays * 86_400_000)
      .toISOString().slice(0, 10);
    const padEnd = new Date(Date.parse(todayIso + 'T00:00:00Z') + padDays * 86_400_000)
      .toISOString().slice(0, 10);
    const raceRows = await query<{ date: string }>(
      `SELECT meta->>'date' AS date FROM races
        WHERE (user_uuid = $1 OR user_uuid IS NULL)
          AND meta->>'date' BETWEEN $2 AND $3
        LIMIT 1`,
      [userId, padStart, padEnd],
    );
    if (raceRows.length > 0) {
      return {
        ...empty,
        lastReviewed,
        lastReviewedAt,
        shiftPoints,
        direction,
        suppressReason: 'race-week',
      };
    }
  } catch { /* race-week check non-fatal */ }

  // Dismiss / snooze checks.
  const dismissedAt = row?.dismissed_at;
  if (dismissedAt) {
    const ageDays = (Date.now() - new Date(dismissedAt).getTime()) / 86_400_000;
    if (ageDays < DISMISS_SUPPRESS_DAYS) {
      return {
        ...empty,
        lastReviewed,
        lastReviewedAt,
        shiftPoints,
        direction,
        suppressReason: 'dismissed',
      };
    }
  }
  const snoozedAt = row?.snoozed_at;
  if (snoozedAt) {
    const ageHours = (Date.now() - new Date(snoozedAt).getTime()) / 3_600_000;
    if (ageHours < SNOOZE_HOURS) {
      return {
        ...empty,
        lastReviewed,
        lastReviewedAt,
        shiftPoints,
        direction,
        suppressReason: 'snoozed',
      };
    }
  }

  if (absShift < SHIFT_FIRE_THRESHOLD) {
    return {
      ...empty,
      lastReviewed,
      lastReviewedAt,
      shiftPoints,
      direction,
      suppressReason: 'within-threshold',
    };
  }

  return {
    shouldRender: true,
    currentVdot,
    lastReviewed,
    lastReviewedAt,
    shiftPoints,
    direction,
  };
}

/** Record a review event, clears snooze + dismiss, writes the
 *  current VDOT as the new baseline. Called by the Apply action. */
export async function recordVdotReview(userId: string, currentVdot: number): Promise<void> {
  await query(
    `UPDATE users SET
       vdot_last_reviewed     = $2,
       vdot_last_reviewed_at  = NOW(),
       vdot_shift_dismissed_at = NULL,
       vdot_shift_snoozed_at   = NULL
     WHERE id = $1`,
    [userId, currentVdot],
  );
}

export async function dismissVdotShift(userId: string): Promise<void> {
  await query(
    `UPDATE users SET vdot_shift_dismissed_at = NOW() WHERE id = $1`,
    [userId],
  );
}

export async function snoozeVdotShift(userId: string): Promise<void> {
  await query(
    `UPDATE users SET vdot_shift_snoozed_at = NOW() WHERE id = $1`,
    [userId],
  );
}
