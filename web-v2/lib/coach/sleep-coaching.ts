/**
 * lib/coach/sleep-coaching.ts · the standing sleep flag + race-week
 * sleep banking. Phase 2 (3.4) of the state-audit fixes.
 *
 * The audit's loudest unanswered signal: 6.4h nightly through a 45-mile
 * LOADED week produced a −9 readiness pillar and zero escalation.
 * Readiness grades each morning in isolation; nothing owns the TREND.
 * This module is trend-level coaching:
 *
 *   STANDING FLAG (escalation · Research/00b §sleep — recovery
 *   hierarchy #1):
 *     · streak: ≥ STREAK_NIGHTS consecutive nights < 7.0h
 *     · trend:  7-night avg < 6.5h held across two consecutive weeks
 *   Clears silently after 5 consecutive nights ≥ 7.0h. No daily nag —
 *   one standing fact that escalates the surfaces that already exist
 *   (Health card, WHAT-TO-DO line, quality-day forward link).
 *
 *   SLEEP BANKING (race week · Research/08 §sleep-banking):
 *     active T-7 → race day for the next A-race. Target 8–8.5h; the
 *     two-nights-out night is the one that counts (race-eve sleep is
 *     usually poor and matters less).
 *
 * Pure read · health_samples.sleep_hours + races meta. All-runner.
 */
import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';

export const STREAK_NIGHTS = 10;
const TARGET_H = 7.0;
const TREND_AVG_H = 6.5;
const CLEAR_NIGHTS = 5;

export interface SleepCoaching {
  flag: {
    active: true;
    kind: 'streak' | 'trend';
    /** Consecutive nights under 7.0h ending last night. */
    streakNights: number;
    /** 7-night average, 1dp. */
    avg7: number;
    /** 14-night average, 1dp. */
    avg14: number;
    /** Coach line for the card headline. */
    headline: string;
    /** Supporting line · the why + the ask. */
    detail: string;
    /** Forward link for a quality day (null when tomorrow isn't quality). */
    qualityForwardLine: string | null;
  } | null;
  banking: {
    active: true;
    raceName: string;
    raceDateISO: string;
    daysToRace: number;
    targetLine: string;
    keyNightLine: string;
  } | null;
}

export async function computeSleepCoaching(userUuid: string): Promise<SleepCoaching> {
  const today = await runnerToday(userUuid);

  // Last 21 nights, newest first. sample_date is the wake date.
  const nights = (await pool.query<{ d: string; h: string }>(
    `SELECT sample_date::text AS d, value::text AS h
       FROM health_samples
      WHERE user_uuid = $1::uuid
        AND sample_type = 'sleep_hours'
        AND sample_date > $2::date - 21
        AND sample_date <= $2::date
      ORDER BY sample_date DESC`,
    [userUuid, today],
  ).catch(() => ({ rows: [] }))).rows
    .map((r) => ({ d: r.d.slice(0, 10), h: Number(r.h) }))
    .filter((r) => Number.isFinite(r.h) && r.h > 0);

  let flag: SleepCoaching['flag'] = null;
  if (nights.length >= 7) {
    const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    const avg7 = Math.round(avg(nights.slice(0, 7).map((n) => n.h)) * 10) / 10;
    const avg14 = nights.length >= 14
      ? Math.round(avg(nights.slice(0, 14).map((n) => n.h)) * 10) / 10
      : avg7;

    // Clear gate first: 5 consecutive ≥ 7.0 → no flag regardless of history.
    const recentlyCleared = nights.slice(0, CLEAR_NIGHTS).length === CLEAR_NIGHTS
      && nights.slice(0, CLEAR_NIGHTS).every((n) => n.h >= TARGET_H);

    let streakNights = 0;
    for (const n of nights) {
      if (n.h < TARGET_H) streakNights++;
      else break;
    }
    const prevWeekAvg = nights.length >= 14
      ? Math.round(avg(nights.slice(7, 14).map((n) => n.h)) * 10) / 10
      : null;
    const trendActive = avg7 < TREND_AVG_H && prevWeekAvg != null && prevWeekAvg < TREND_AVG_H;

    if (!recentlyCleared && (streakNights >= STREAK_NIGHTS || trendActive)) {
      const kind: 'streak' | 'trend' = streakNights >= STREAK_NIGHTS ? 'streak' : 'trend';
      const headline = kind === 'streak'
        ? `Night ${streakNights} under 7 hours.`
        : `Two weeks averaging ${avg7}h.`;
      const detail = `The plan assumes recovery you're not banking. Fitness is built in the sleep after the work, not the work. Target tonight: in bed for 7:30.`;
      // Forward link: is tomorrow a quality day on the active plan?
      const tomorrowQ = (await pool.query<{ type: string; sub_label: string | null }>(
        `SELECT pw.type, pw.sub_label
           FROM plan_workouts pw JOIN training_plans tp ON tp.id = pw.plan_id
          WHERE tp.user_uuid = $1::uuid AND tp.archived_iso IS NULL
            AND pw.date_iso = ($2::date + 1)::text
            AND pw.type IN ('tempo','threshold','intervals','race_week_tuneup','long')
          LIMIT 1`,
        [userUuid, today],
      ).catch(() => ({ rows: [] }))).rows[0];
      const qualityForwardLine = tomorrowQ
        ? `Tomorrow's ${tomorrowQ.sub_label ?? tomorrowQ.type} lands on a ${avg7}h week. Expect the HR line to come up early. The honest fix is tonight, not tomorrow.`
        : null;
      flag = { active: true, kind, streakNights, avg7, avg14, headline, detail, qualityForwardLine };
    }
  }

  // Banking: next A-race within 7 days.
  let banking: SleepCoaching['banking'] = null;
  const race = (await pool.query<{ slug: string; name: string | null; date: string }>(
    `SELECT slug, meta->>'name' AS name, meta->>'date' AS date
       FROM races
      WHERE user_uuid = $1::uuid
        AND meta->>'priority' = 'A'
        AND (meta->>'date')::date >= $2::date
        AND (meta->>'date')::date <= $2::date + 7
      ORDER BY meta->>'date' ASC
      LIMIT 1`,
    [userUuid, today],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (race?.date) {
    const daysToRace = Math.round(
      (Date.parse(race.date + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 86400000,
    );
    banking = {
      active: true,
      raceName: race.name ?? race.slug,
      raceDateISO: race.date,
      daysToRace,
      targetLine: `Race week: 8 to 8.5 hours nightly. Sleep is the only training left that works now.`,
      keyNightLine: daysToRace >= 2
        ? `The night two days out is the one that counts. Race-eve sleep is usually rough and matters less. Bank it early.`
        : `Tonight's sleep won't make or break it · the banking is done. Get off your feet, lights out early, no scrolling the forecast.`,
    };
  }

  return { flag, banking };
}
