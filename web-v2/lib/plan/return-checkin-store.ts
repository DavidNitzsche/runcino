/**
 * lib/plan/return-checkin-store.ts · DB access for the return-to-run ladder.
 *
 * `runner_injuries` has no jsonb column at all (id, site, severity,
 * return_protocol, notes, start_date, expected_return_date, resolved_date,
 * created_at — see `app/api/injuries/route.ts`'s schema comment), so the
 * check-in history that drives `lib/plan/return-ladder.ts` cannot live there
 * without a migration. NO DDL — so it lives as additive rows in
 * `coach_intents`, the same generic append-only event table
 * `lib/coach/coach-log.ts` and `lib/coach/episode-log.ts` already write
 * arbitrary reason-tagged jsonb events to. One row per check-in,
 * `reason = 'v5_return_checkin'`, `field = <injury id>`.
 */
import { pool } from '@/lib/db/pool';
import { resolveInjuryProtocol, type ResolvedInjuryProtocol } from './injury-protocols';
import type { ReturnCheckinEvent, ReturnCheckinOutcome } from './return-ladder';

export interface ActiveInjuryRow {
  id: string;
  site: string;
  severity: 'minor' | 'moderate' | 'major';
  notes: string | null;
  returnProtocol: string | null;
  startDate: string;
}

/**
 * The injury the return ladder tracks: the most recent row that is still
 * open, or was resolved in the last 30 days — same window
 * `GET /api/injuries` already uses for "recently healed still informs
 * return-to-run framing".
 */
export async function loadActiveInjuryForReturn(userId: string): Promise<ActiveInjuryRow | null> {
  const row = (await pool.query<{
    id: number; site: string; severity: string; notes: string | null;
    return_protocol: string | null; start_date: string;
  }>(
    `SELECT id, site, severity, notes, return_protocol, start_date::text AS start_date
       FROM runner_injuries
      WHERE user_uuid = $1
        AND (resolved_date IS NULL OR resolved_date >= CURRENT_DATE - INTERVAL '30 days')
      ORDER BY (resolved_date IS NULL) DESC, start_date DESC
      LIMIT 1`,
    [userId],
    // RULE THREE. No `.catch(() => ({ rows: [] }))` here. Null from this
    // function means "nothing is flagged", and both callers turn that into a
    // 404 refusal the phone renders as the entire screen: "Nothing is flagged
    // right now, so there is no ladder to climb." Told to a runner who IS on
    // the ladder, because a read failed, that is a wrong answer delivered
    // with confidence. A throw reaches the route's catch and becomes the
    // outage screen, which is retryable and true.
  )).rows[0];
  if (!row) return null;
  const severity = row.severity === 'moderate' || row.severity === 'major' ? row.severity : 'minor';
  return {
    id: String(row.id),
    site: row.site,
    severity,
    notes: row.notes,
    returnProtocol: row.return_protocol,
    startDate: row.start_date,
  };
}

export function protocolForInjury(injury: ActiveInjuryRow): ResolvedInjuryProtocol {
  return resolveInjuryProtocol({
    site: injury.site,
    notes: injury.notes,
    returnProtocol: injury.returnProtocol,
    severity: injury.severity,
  });
}

/** Every check-in logged against this injury, oldest first. */
export async function loadReturnCheckins(userId: string, injuryId: string): Promise<ReturnCheckinEvent[]> {
  const rows = (await pool.query<{ value: unknown; ts: Date }>(
    `SELECT value, ts FROM coach_intents
      WHERE COALESCE(user_uuid, user_id) = $1
        AND reason = 'v5_return_checkin'
        AND field = $2
      ORDER BY ts ASC`,
    [userId, injuryId],
  ).catch(() => ({ rows: [] }))).rows;
  const events: ReturnCheckinEvent[] = [];
  for (const r of rows) {
    let v: Record<string, unknown> = {};
    try { v = typeof r.value === 'string' ? JSON.parse(r.value) : ((r.value ?? {}) as Record<string, unknown>); }
    catch { v = {}; }
    const outcome = v.outcome === 'silent' || v.outcome === 'something_off' ? v.outcome : null;
    if (!outcome) continue;
    const at = r.ts instanceof Date ? r.ts.toISOString() : String(r.ts);
    events.push({ at, outcome });
  }
  return events;
}

/** Record one new check-in. */
export async function recordReturnCheckin(
  userId: string,
  injuryId: string,
  outcome: ReturnCheckinOutcome,
): Promise<ReturnCheckinEvent> {
  const at = new Date().toISOString();
  await pool.query(
    `INSERT INTO coach_intents (user_id, user_uuid, reason, field, value, acknowledged_at)
     VALUES ($1, $1, $2, $3, $4, NOW())`,
    [userId, 'v5_return_checkin', injuryId, JSON.stringify({ outcome, at })],
  );
  return { at, outcome };
}
