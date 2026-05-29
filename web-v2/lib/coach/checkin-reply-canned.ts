/**
 * checkin-reply-canned.ts — deterministic canned-reply matrix for
 * post-run check-ins. Lifted out of the old checkin-reply.ts (which
 * was deleted in the 2026-05-28 LLM rip) so the /api/checkin endpoint
 * can still acknowledge a chip-tap inline without any LLM call.
 *
 * Cardinal Rule #1 (PROJECT.md, locked 2026-05-28): "Zero LLM ·
 * anywhere · ever." This matrix is the only voice the check-in
 * acknowledgment will speak until tone polishing returns in a future
 * round.
 */

/**
 * Returns a single-sentence canned reply for the (workout_kind,
 * execution chip, body chip) combo. Returns null when no canned line
 * fits the combo (rare). Caller falls back to `defaultReply`.
 */
export function pickCannedReply(
  kind: string | null | undefined,
  execution: string | null | undefined,
  body: string | null | undefined,
): string | null {
  const k = (kind ?? '').toLowerCase();
  const e = (execution ?? '').toLowerCase();
  const b = (body ?? '').toLowerCase();

  // Recovery / shakeout — body alone drives the reply.
  if (k === 'recovery' || !e) {
    if (b === 'fresh')  return 'Recovery done, body fresh. Building back.';
    if (b === 'worked') return 'Recovery run, legs felt it. Normal.';
    if (b === 'cooked') return 'Even recovery felt hard. Tomorrow likely lighter.';
  }

  // Easy / shakeout execution chips.
  if (k === 'easy') {
    if (e === 'chatty' && b === 'fresh')  return 'Easy day done right. Aerobic miles in the bank.';
    if (e === 'chatty' && b === 'worked') return 'Chatty pace, legs feeling it. Normal for the week.';
    if (e === 'chatty' && b === 'cooked') return "Easy was easy but the legs are flagging. Worth watching.";
    if (e === 'controlled' && b === 'fresh')  return 'Controlled effort, body fresh. Solid execution.';
    if (e === 'controlled' && b === 'worked') return 'Held it in check. Legs absorbed the work.';
    if (e === 'controlled' && b === 'cooked') return "Held the lid on but body's spent. Worth watching.";
    if (e === 'pushed' && b === 'fresh')  return "Easy that wasn't easy. Body says fresh — fitness keeps showing up.";
    if (e === 'pushed' && b === 'worked') return 'Pushed to hold easy pace. Fatigue is real today.';
    if (e === 'pushed' && b === 'cooked') return "Pushed and paid. Tomorrow's prescription will reflect this.";
  }

  // Quality (threshold / tempo / intervals).
  if (k === 'quality') {
    if (e === 'nailed' && b === 'fresh')  return "Workout in the bag and body holding. That's the green light.";
    if (e === 'nailed' && b === 'worked') return 'Reps landed clean. Body felt it, normal after quality.';
    if (e === 'nailed' && b === 'cooked') return "Nailed the splits but the body's smoked. Recovery matters tomorrow.";
    if (e === 'grinded' && b === 'fresh')  return 'Grinded through it. Body bouncing back, strong sign.';
    if (e === 'grinded' && b === 'worked') return 'Hard work, body knows it. The session got done.';
    if (e === 'grinded' && b === 'cooked') return 'Grinded and emptied the tank. Honor that tomorrow.';
    if (e === 'missed' && b === 'fresh')  return "Reps slipped but body's intact. We'll regroup next session.";
    if (e === 'missed' && b === 'worked') return "Couldn't hold the splits. Body's worked, accumulated fatigue maybe.";
    if (e === 'missed' && b === 'cooked') return 'Workout fell apart and body wrecked. Backing off makes sense.';
  }

  // Long run.
  if (k === 'long') {
    if (e === 'strong' && b === 'fresh')  return "Long run strong end to end. That's the engine building.";
    if (e === 'strong' && b === 'worked') return 'Held strong, finished with miles in the legs. Good rep.';
    if (e === 'strong' && b === 'cooked') return 'Strong through but emptied the well. Tomorrow easy.';
    if (e === 'faded' && b === 'fresh')  return 'Faded late but body bouncing back. Endurance still building.';
    if (e === 'faded' && b === 'worked') return 'Late miles got hard. Body worked. Normal for a stretch run.';
    if (e === 'faded' && b === 'cooked') return 'Hit the limit late and emptied. Recovery is the priority.';
    if (e === 'walled' && b === 'fresh')  return "Hit the wall but body's resilient. Worth a fueling look.";
    if (e === 'walled' && b === 'worked') return "Walled. Body's spent. Refuel and rest.";
    if (e === 'walled' && b === 'cooked') return 'Walled and wrecked. Tomorrow is easy or off.';
  }

  // Race.
  if (k === 'race') {
    if (e === 'crushed_goal' && b === 'fresh')  return "Goal crushed and body says ready for more. That's a level shift.";
    if (e === 'crushed_goal' && b === 'worked') return 'Goal crushed, body honestly worked. Earned it.';
    if (e === 'crushed_goal' && b === 'cooked') return 'Crushed it and gave everything. Honor the recovery now.';
    if (e === 'on_goal' && b === 'fresh')  return 'On goal, body fresh. Race execution dialed.';
    if (e === 'on_goal' && b === 'worked') return "Hit the goal honestly. Body worked. That's a quality day.";
    if (e === 'on_goal' && b === 'cooked') return "On goal but emptied the tank. That's what race day takes.";
    if (e === 'missed_goal' && b === 'fresh')  return "Missed the time, body felt fine. Pacing or course noise — let's debrief.";
    if (e === 'missed_goal' && b === 'worked') return "Missed it, body worked hard. Didn't go the way you wanted.";
    if (e === 'missed_goal' && b === 'cooked') return 'Missed and cooked. Tough one. Recovery first, postmortem later.';
  }

  // No canned line fits — caller falls back to defaultReply.
  return null;
}

/**
 * Default reply when no canned line fits AND the runner submitted no
 * niggle text. Used in place of the old LLM fallback.
 */
export function defaultReply(kind: string | null | undefined): string {
  const k = (kind ?? '').toLowerCase();
  if (k === 'race')     return 'Got it. Race in the log.';
  if (k === 'quality')  return 'Got it. Session in the log.';
  if (k === 'long')     return 'Got it. Long run in the log.';
  if (k === 'easy')     return 'Got it. Easy in the log.';
  if (k === 'recovery') return 'Got it. Recovery in the log.';
  return 'Got it. Run logged.';
}

/**
 * Acknowledgment when the runner wrote a free-text niggle. The text
 * itself is persisted on the check-in row; this just confirms receipt.
 */
export function niggleAckReply(niggleText: string): string {
  const t = niggleText.trim();
  if (!t) return defaultReply(null);
  const snippet = t.length > 60 ? t.slice(0, 57).trimEnd() + '…' : t;
  return `Got it. Noted: "${snippet}"`;
}
