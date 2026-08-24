/**
 * lib/notifications/session-moved.ts — the sender `renderSessionMoved` never had.
 *
 * The template, the `session_moved_enabled` settings row, the prefs field and
 * the `FAFF_SESSION_MOVED` APNs mapping all shipped on 2026-08-23 in 718fec78,
 * with no caller. It was the only one of twelve templates with zero senders, so
 * the runner has been looking at a default-ON toggle that does nothing.
 *
 * ── The gate (owner's ruling, 2026-08-24) ────────────────────────────────
 *
 *   "It fires when today's session ACTUALLY changed overnight — gated on the
 *    label genuinely differing, not on the adapter merely having run."
 *
 * So this module does not ask the adapter what it did. It photographs the
 * session BEFORE `applyAdaptations` and again AFTER, renders the same
 * runner-facing label from both, and sends only when those two strings
 * differ. An adapter pass that touched a row and left the runner's day
 * looking identical is not news, and neither is a day that was adapted last
 * Tuesday — which is what gating on `AdaptationInfo.wasAdapted` would have
 * given, since that flag compares against the plan AS AUTHORED and stays true
 * forever.
 *
 * ── Which day ────────────────────────────────────────────────────────────
 *
 * NOT `runnerToday`. The adaptation cron fires at 03:00 UTC, which is 20:00 PT
 * the PREVIOUS evening (moved there deliberately: "I dont want to wake up to
 * change runs"). At that moment `runnerToday` is the day that is four hours
 * from being over — the runner has already run it or already hasn't. The day
 * this notification is about is the one they wake into.
 *
 * So the target day is derived FROM the fire time rather than computed beside
 * it: the push is scheduled for the next 07:15 in the runner's own zone, and
 * the day it is about is whatever calendar day that instant falls on there.
 * The two can then never disagree, in any timezone or at any hour the cron
 * happens to be dispatched by hand.
 *
 * ── The copy, and Rule 2 ─────────────────────────────────────────────────
 *
 * Rule 2 says one signal never changes a session, that three independent
 * domains must converge, and that copy names the convergence and never a
 * single cause. In this codebase that rule is implemented in
 * `lib/coach/convergence.ts` and gates exactly one detector —
 * `detectReadinessPullback`. The other detectors that can move a session are
 * event-driven, not signal-driven: a logged injury, a missed key workout, a
 * race result, a volume week. This sender therefore CAN fire on a change that
 * no convergence produced, and per the ruling's own instruction the copy says
 * so by saying nothing: it never asserts a cause of its own.
 *
 * What it carries instead is the adapter's OWN reason string for that row,
 * composed upstream and already citation-scrubbed. When the change was
 * readiness-driven that string is `convergenceCopy(verdict)`, which already
 * names the convergence; when it was a niggle it names the niggle. The
 * sentence is true either way and over-claims in neither. With no reason on
 * file the clause drops and the template falls back to "Today changed
 * overnight", which is a fact rather than a diagnosis.
 */

import { pool } from '@/lib/db/pool';
import { runnerTimezone } from '@/lib/runtime/runner-tz';
import { renderSessionMoved } from './templates';
import { enqueueNotification, nextMorning0715 } from './enqueue';

/** One day's prescription, reduced to the fields a runner can see. */
export interface SessionSnapshot {
  workoutId: string;
  type: string;
  subLabel: string | null;
  distanceMi: number | null;
  /** Short, lock-screen-shaped name · "Easy 4.0 mi". What the push SAYS. */
  label: string;
  /** Every runner-facing field, normalised · what the gate COMPARES. */
  changeKey: string;
}

/** Title-case a single plan word without shouting an already-cased one. */
function titleCase(s: string): string {
  const t = s.trim();
  if (!t) return t;
  // Plan `type` values are lowercase tokens ('easy', 'threshold'). Anything
  // already carrying capitals is left alone rather than re-cased.
  return /[A-Z]/.test(t) ? t : t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * The name the notification prints.
 *
 * TYPE plus distance, deliberately, and NOT the sub-label. Real `sub_label`
 * values are whole prescriptions — "1.5 mi WU · 3 mi @ T · 1.5 mi CD",
 * "EASY · 6×20s strides" — which produce "1.5 mi WU · 3 mi @ T · 1.5 mi CD 6.0
 * mi" on a lock screen, shouting and double-stating the distance. (Caught in
 * the dry run against live plans before this ever reached a device.) The
 * detail lives one tap away behind the template's `faff://today` deeplink;
 * the push names the shape.
 */
export function sessionLabel(row: {
  type: string; distanceMi: number | null;
} | null): string | null {
  if (!row) return null;
  if (row.type === 'rest') return 'Rest';
  const name = titleCase(row.type);
  const mi = row.distanceMi;
  return mi != null && mi > 0 ? `${name} ${mi.toFixed(1)} mi` : name;
}

/**
 * What the gate compares · finer than what the push prints.
 *
 * All three fields `adaptation-info` calls runner-facing, so "genuinely
 * differing" means the same thing here as it does on the lobby banner. A
 * threshold session re-structured at the same type and distance, or re-paced
 * by a VDOT recompute, IS a change to the runner's day even though the short
 * label is unmoved — the sentence then states the day and lets the adapter's
 * own reason carry why.
 *
 * Distance is fixed to one decimal, which is both how it prints and the
 * epsilon that keeps a numeric round-trip (4.0 coming back as 4.001) from
 * reading as a change. A null and a zero collapse to the same token — a rest
 * row carries 0 from one writer and NULL from another, and the runner's day
 * is the same day either way.
 */
export function sessionChangeKey(row: {
  type: string; subLabel: string | null; distanceMi: number | null;
} | null): string | null {
  if (!row) return null;
  const mi = row.distanceMi != null && row.distanceMi > 0 ? row.distanceMi.toFixed(1) : '-';
  return `${row.type}|${(row.subLabel ?? '').trim()}|${mi}`;
}

/** True when the day the runner will wake into genuinely reads differently.
 *
 *  Covers the three shapes of change, and only those:
 *    · the prescription moved (easy 6 became easy 4, tempo became easy, a
 *      threshold session was re-structured or re-paced)
 *    · a session appeared on a day that had none
 *    · the session left the day entirely (rescheduled away)
 *  A row swapped for a different row that prescribes the same thing is NOT a
 *  change, because nothing the runner can see is different. That is the
 *  ruling: the gate is the prescription, never "the adapter ran". */
export function sessionGenuinelyChanged(
  before: SessionSnapshot | null,
  after: SessionSnapshot | null,
): boolean {
  if (before == null && after == null) return false;
  if (before == null || after == null) return true;
  return before.changeKey !== after.changeKey;
}

/** Read one day's prescription off the ACTIVE plan.
 *
 *  Plan-scoped, not user-and-date scoped: a runner carries rows from archived
 *  plans on the very same dates, and a bare LIMIT 1 across all of them picks
 *  arbitrarily (the defect fixed in the skip nudge on 2026-08-21). Rest rows
 *  sort last so a real session always wins a day that holds both.
 *
 *  THROWS on a read failure rather than returning null. A failed read is not
 *  knowledge about the runner's day, and null here means "no session that
 *  day" — which the gate reads as the session having VANISHED, and would push
 *  about. The caller catches and sends nothing. */
export async function snapshotSession(
  userId: string,
  dateIso: string,
): Promise<SessionSnapshot | null> {
  const row = (await pool.query<{
    id: string; type: string; sub_label: string | null; distance_mi: string | null;
  }>(
    `SELECT pw.id::text AS id, pw.type, pw.sub_label, pw.distance_mi
       FROM plan_workouts pw
       JOIN training_plans tp ON tp.id = pw.plan_id
      WHERE tp.user_uuid = $1
        AND tp.archived_iso IS NULL
        AND pw.date_iso = $2
      ORDER BY (pw.type = 'rest') ASC
      LIMIT 1`,
    [userId, dateIso],
  )).rows[0];
  if (!row) return null;
  const distanceMi = row.distance_mi == null ? null : Number(row.distance_mi);
  const shape = { type: row.type, subLabel: row.sub_label, distanceMi };
  const label = sessionLabel(shape);
  const changeKey = sessionChangeKey(shape);
  if (label == null || changeKey == null) return null;
  return { workoutId: row.id, ...shape, label, changeKey };
}

/**
 * The adapter's own sentence for what it did to this row, trimmed to the
 * observation.
 *
 * NEVER synthesized. The whys are written at the action site and scrubbed of
 * `Research/` citations on the way into `coach_intents`; this reads the most
 * recent one back and keeps the FIRST sentence, which is the observation
 * ("Volume 55mi exceeded your usual 43mi week"), dropping the mechanical
 * clause that follows it ("Shave next 7 days 17%"). A lock-screen title is not
 * where the engine narrates its own bookkeeping.
 */
export async function adapterReasonFor(workoutId: string): Promise<string | null> {
  try {
    const row = (await pool.query<{ why: string | null; reason: string | null }>(
      `SELECT ci.value->>'why' AS why, ci.reason
         FROM coach_intents ci
        WHERE ci.field = $1
          AND ci.reason LIKE 'plan_adapt%'
        ORDER BY ci.ts DESC
        LIMIT 1`,
      [workoutId],
    )).rows[0];
    const raw = row?.why?.trim();
    if (!raw) return null;
    const { stripResearchCitations } = await import('@/lib/plan/strip-citations');
    const clean = stripResearchCitations(raw).trim();
    if (!clean) return null;
    const first = clean.split(/(?<=\.)\s+/)[0]?.trim() ?? clean;
    return first.replace(/\s*[.·]\s*$/, '') || null;
  } catch {
    return null;
  }
}

export interface SessionMovedTarget {
  /** The day the push will be about · the runner-local date of `fireAt`. */
  dateIso: string;
  fireAt: Date;
}

/** The day the runner wakes into, and the instant the push should land on it.
 *  Derived together so they can never disagree. */
export async function nextMorningTarget(userId: string): Promise<SessionMovedTarget> {
  const tz = await runnerTimezone(userId);
  const fireAt = nextMorning0715(new Date(), tz);
  const dateIso = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(fireAt);
  return { dateIso, fireAt };
}

/**
 * Enqueue the session-moved push, if and only if the day genuinely changed.
 *
 * Returns what it decided, so the cron can report it and a test can assert it
 * without a device anywhere near the loop. Never throws: a notification is
 * never allowed to fail an adaptation pass.
 */
export async function notifySessionMoved(args: {
  userId: string;
  target: SessionMovedTarget;
  before: SessionSnapshot | null;
  after: SessionSnapshot | null;
}): Promise<{ sent: boolean; reason: 'changed' | 'unchanged' }> {
  const { userId, target, before, after } = args;
  if (!sessionGenuinelyChanged(before, after)) return { sent: false, reason: 'unchanged' };
  try {
    // A session that left the day entirely leaves the day at rest, which is
    // what the runner will find there.
    const nowLabel = after?.label ?? 'Rest';
    // The was-clause is DROPPED when the short labels match — a threshold
    // session re-structured or re-paced at the same type and distance would
    // otherwise render "Today is Threshold 6.0 mi · it was Threshold 6.0 mi",
    // which says a change happened and then denies it. The template already
    // drops the clause on a null, and the reason carries the why.
    const wasLabel = before && before.label !== nowLabel ? before.label : null;
    const reason = after ? await adapterReasonFor(after.workoutId) : null;
    const tpl = renderSessionMoved({
      user_id: userId,
      date_iso: target.dateIso,
      now_label: nowLabel,
      was_label: wasLabel,
      reason,
    });
    await enqueueNotification(userId, tpl, target.fireAt);
    return { sent: true, reason: 'changed' };
  } catch {
    return { sent: false, reason: 'unchanged' };
  }
}
