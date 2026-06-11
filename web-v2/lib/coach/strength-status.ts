/**
 * lib/coach/strength-status.ts · reconcile what was recommended vs
 * what was actually logged.
 *
 * The strength recommender (lib/coach/strength-recommender.ts) picks
 * 0-2 days per week. HK importer + manual logging both write into
 * strength_sessions. This file is the diff: what was recommended,
 * what was confirmed, what was missed, what was bonus.
 *
 * Three buckets per week:
 *
 *   · confirmed · session logged on a recommended day
 *   · skipped   · recommended day passed with no logged session
 *   · bonus     · session logged on a non-recommended day
 *
 * Drives:
 *   · Today briefing chip · "Strength logged 2/2 this week" / "1/2 + 1 bonus"
 *   · Habit signal precision · confirmed-from-HK is a stronger habit
 *     signal than self-logged. Recommender's habit field can later
 *     differentiate.
 *   · skipped → next week's recommender raises priority + may emit a
 *     coach intent.
 */

import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';

export interface StrengthDay {
  date: string;                  // ISO YYYY-MM-DD
  sessionId: number | null;
  source: 'manual' | 'apple_health' | 'watch' | 'strava' | null;
  durationMin: number | null;
  sessionType: string | null;
}

export interface StrengthWeekStatus {
  weekStartISO: string;          // Monday of the week
  weekEndISO: string;            // Sunday of the week
  recommended: string[];         // dates the recommender picked
  /** Days where session was logged on a recommended day. */
  confirmed: StrengthDay[];
  /** Recommended dates that PASSED (today or earlier) with no session. */
  skipped: string[];
  /** Sessions logged on non-recommended days. Worth surfacing because
   *  they count toward habit + load (per the ACWR fold) but the runner
   *  may not realize they "earned credit" for a freelance session. */
  bonus: StrengthDay[];
  /** Summary string for the chip · "2/2 this week" / "1/2 + 1 bonus". */
  summary: string;
}

/**
 * Reconcile recommendedDays against actual strength_sessions for a week.
 * The recommendedDays must come from the recommender (or
 * glance.recommendedStrengthDays) · this function doesn't re-derive.
 *
 * weekStartISO is the Monday. weekEndISO derived as +6 days. Sessions
 * are pulled from strength_sessions with date in the range.
 */
export async function loadStrengthWeekStatus(
  userUuid: string,
  weekStartISO: string,
  recommendedDays: string[],
): Promise<StrengthWeekStatus> {
  const weekEndISO = addDaysISO(weekStartISO, 6);
  const todayISO = await runnerToday(userUuid);

  // 2026-06-10 · onboarding floor. A brand-new runner who joined midweek
  // never "skipped" the strength days that fell before they had an
  // account — counting them as missed greets first-time users with
  // "1 day missed" on day one (David caught this 3 clicks into
  // onboarding). Floor the skipped check at the join date.
  const joinedISO: string | null = (await pool.query<{ d: string | null }>(
    `SELECT to_char(LEAST(
              COALESCE(p.onboarded_at, u.created_at),
              COALESCE(u.created_at, p.onboarded_at)
            ), 'YYYY-MM-DD') AS d
       FROM users u LEFT JOIN profile p ON p.user_uuid = u.id
      WHERE u.id = $1::uuid LIMIT 1`,
    [userUuid],
  ).catch(() => ({ rows: [] as Array<{ d: string | null }> }))).rows[0]?.d ?? null;

  const rows = (await pool.query<{
    id: number;
    date: string;
    source: string;
    duration_min: number | null;
    session_type: string | null;
  }>(
    `SELECT id, date::text AS date, source, duration_min, session_type
       FROM strength_sessions
      WHERE user_uuid = $1::uuid
        AND date >= $2::date AND date <= $3::date
      ORDER BY date ASC, created_at ASC`,
    [userUuid, weekStartISO, weekEndISO],
  ).catch(() => ({ rows: [] }))).rows;

  // Bucket sessions by date · supports multiple sessions same day
  // (multi-session days count once for "confirmed", others go to bonus).
  type SessRow = (typeof rows)[number];
  const byDate = new Map<string, SessRow[]>();
  for (const r of rows) {
    const list = byDate.get(r.date);
    if (list) list.push(r);
    else byDate.set(r.date, [r]);
  }

  const recommendedSet = new Set(recommendedDays);
  const confirmed: StrengthDay[] = [];
  const bonus: StrengthDay[] = [];

  for (const [date, sessions] of byDate) {
    const isRecommended = recommendedSet.has(date);
    const first = sessions[0];
    const day: StrengthDay = {
      date,
      sessionId: first.id,
      source: first.source as StrengthDay['source'],
      durationMin: first.duration_min,
      sessionType: first.session_type,
    };
    if (isRecommended) {
      confirmed.push(day);
      // Additional same-day sessions count as bonus.
      for (const extra of sessions.slice(1)) {
        bonus.push({
          date,
          sessionId: extra.id,
          source: extra.source as StrengthDay['source'],
          durationMin: extra.duration_min,
          sessionType: extra.session_type,
        });
      }
    } else {
      for (const s of sessions) {
        bonus.push({
          date,
          sessionId: s.id,
          source: s.source as StrengthDay['source'],
          durationMin: s.duration_min,
          sessionType: s.session_type,
        });
      }
    }
  }

  // Skipped · recommended dates that are TODAY or earlier AND have no
  // logged session yet. Future recommended dates are still in scope ·
  // not yet skipped.
  const skipped: string[] = [];
  for (const date of recommendedDays) {
    if (date >= todayISO) continue;            // today or future · not skipped yet
    if (joinedISO && date < joinedISO) continue; // before the runner joined · never theirs to skip
    if (byDate.has(date)) continue;            // logged · not skipped
    skipped.push(date);
  }

  const summary = buildSummary(recommendedDays.length, confirmed.length, bonus.length, skipped.length);

  return {
    weekStartISO,
    weekEndISO,
    recommended: recommendedDays,
    confirmed,
    skipped,
    bonus,
    summary,
  };
}

function buildSummary(
  recommendedCount: number,
  confirmedCount: number,
  bonusCount: number,
  skippedCount: number,
): string {
  if (recommendedCount === 0 && bonusCount === 0) {
    return 'No strength surfaced this week';
  }
  if (recommendedCount === 0 && bonusCount > 0) {
    return `${bonusCount} bonus session${bonusCount === 1 ? '' : 's'} this week (none scheduled)`;
  }
  const base = `${confirmedCount}/${recommendedCount} this week`;
  if (bonusCount > 0 && skippedCount > 0) {
    return `${base} · ${skippedCount} skipped · ${bonusCount} bonus`;
  }
  if (bonusCount > 0) {
    return `${base} + ${bonusCount} bonus`;
  }
  if (skippedCount > 0 && confirmedCount === 0) {
    return `0/${recommendedCount} this week · ${skippedCount} day${skippedCount === 1 ? '' : 's'} missed`;
  }
  if (skippedCount > 0) {
    return `${base} · ${skippedCount} skipped`;
  }
  return base;
}

function addDaysISO(iso: string, n: number): string {
  const t = Date.parse(iso + 'T00:00:00Z');
  return new Date(t + n * 86400000).toISOString().slice(0, 10);
}
