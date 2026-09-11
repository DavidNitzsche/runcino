/**
 * lib/runs/plan-match-ambiguity.ts · the ONE write site for an ambiguous
 * plan-day match refusal (WATCHMATCH-1, Rule 11, Rule 20).
 *
 * `lib/runs/plan-type-stamp.ts`'s `selectMatchingPlanDay` refuses to guess
 * when more than one of a day's prescriptions plausibly matches a completed
 * activity's distance. Per Rule 20 ("a product rule with no gate is a
 * hypothesis") a refusal nobody can see is worth exactly as much as the
 * silent guess it replaced — a `console.warn` is lost the moment the log
 * rotates, and this app's own history is full of "wired, tested and inert"
 * mechanisms nobody could prove had ever fired.
 *
 * No manual-resolution UI exists yet for this state (2026-09-11). This is
 * the logged-event half of that surface: a durable, queryable row so the
 * next pass that builds a resolution UI (or just an audit query, the way
 * Rule 21's zero-upward-adaptations finding was established by querying
 * `coach_intents` sideways) has something to read.
 *
 * Deliberately `acknowledged_at = NOW()` at write time — this reason is
 * NEVER meant to reach `lib/coach/state-loader.ts`'s "pending intents" query
 * (`WHERE acknowledged_at IS NULL`), which currently feeds an (unused, but
 * live-queried) `pendingIntents` field on every CoachState load. An
 * ambiguous-match refusal is an engineering signal about identity, not
 * something the coach voice should ever try to phrase to the runner — so it
 * is written already-acknowledged: present in the audit trail, absent from
 * anything that treats "unacknowledged" as "waiting to be spoken."
 *
 * Best-effort, non-fatal — a failed audit write must never block the
 * completion write it is auditing.
 */
import { pool } from '@/lib/db/pool';
import type { PlanDayMatchRefusal } from './plan-type-stamp';

export async function recordPlanMatchAmbiguity(
  userId: string,
  source: string,
  refusal: PlanDayMatchRefusal,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO coach_intents (user_id, user_uuid, reason, field, value, acknowledged_at)
       VALUES ($1, $1, 'plan_match_ambiguous', $2, $3, NOW())`,
      [
        userId,
        `${refusal.dateISO}#${source}`,
        JSON.stringify({ ...refusal, source }),
      ],
    );
  } catch (e: unknown) {
    console.warn('[plan-match-ambiguity] record failed:',
      e instanceof Error ? e.message : String(e));
  }
}
