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
 *     · streak: ≥ STREAK_NIGHTS consecutive nights under the floor
 *     · trend:  7-night avg under the floor, held two consecutive weeks
 *   Clears silently after 5 consecutive nights at or above the floor.
 *   No daily nag — one standing fact that escalates the surfaces that
 *   already exist (Health card, WHAT-TO-DO line, quality-day forward link).
 *
 * ── 2026-08-19 · sleep-target reconciliation ──────────────────────────
 *
 * This module carried TWO more sleep numbers — a 7.0h nightly bar and a
 * separate 6.5h trend bar — and neither was read out of the research. 7.0h
 * sits BELOW doctrine's lowest target (7.5h at 20-40 mpw), so the flag stayed
 * silent through nights doctrine already counts as a deficit, and it did not
 * move at all for a runner at 80 mpw whose target is 9h.
 *
 * Both are now `sleepFloorForMileage` (tier-rules.ts) — the doctrine target
 * for the runner's own mileage, less the engine's one named tolerance,
 * registry-bound as TIER.sleep-floor-rises-with-mileage.
 *
 * THE SECOND NUMBER IS GONE ENTIRELY rather than rescaled. A streak and a
 * trend are two readings of the same deficit, and what distinguishes them is
 * PERSISTENCE, not depth: the streak is consecutive nights under the floor,
 * the trend is a 7-night average under the floor held two weeks running. That
 * removes an invented constant instead of re-deriving one.
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
// 2026-08-19 · ONE sleep target · Research/00b, mileage-scaled.
import { sleepFloorForMileage, SLEEP_FLOOR_TOLERANCE_H } from './tier-rules';
import { computeAcwr } from './acwr';

export const STREAK_NIGHTS = 10;
const CLEAR_NIGHTS = 5;

export interface SleepCoaching {
  flag: {
    active: true;
    kind: 'streak' | 'trend';
    /** Consecutive nights under the doctrine floor, ending last night. */
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

  // 2026-08-19 · the floor is doctrine's, scaled to this runner's habitual
  // weekly mileage. `chronic28` is null until a full chronic window is
  // observable, in which case doctrine's entry row stands.
  const load = await computeAcwr(userUuid, today).catch(() => null);
  const floorH = sleepFloorForMileage(load?.chronic28 != null ? load.chronic28 * 7 : null);

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

    // Clear gate first: 5 consecutive nights at or above the floor → no flag
    // regardless of history.
    const recentlyCleared = nights.slice(0, CLEAR_NIGHTS).length === CLEAR_NIGHTS
      && nights.slice(0, CLEAR_NIGHTS).every((n) => n.h >= floorH);

    let streakNights = 0;
    for (const n of nights) {
      if (n.h < floorH) streakNights++;
      else break;
    }
    const prevWeekAvg = nights.length >= 14
      ? Math.round(avg(nights.slice(7, 14).map((n) => n.h)) * 10) / 10
      : null;
    // Streak and trend differ by PERSISTENCE, not by depth · one floor.
    const trendActive = avg7 < floorH && prevWeekAvg != null && prevWeekAvg < floorH;

    if (!recentlyCleared && (streakNights >= STREAK_NIGHTS || trendActive)) {
      const kind: 'streak' | 'trend' = streakNights >= STREAK_NIGHTS ? 'streak' : 'trend';
      const headline = kind === 'streak'
        ? `Night ${streakNights} under ${floorH}h.`
        : `Two weeks averaging ${avg7}h.`;
      // 2026-08-19 · coach voice · this line used to read "The plan assumes
      // recovery you're not banking ... Target tonight: in bed for 7:30",
      // which is a lecture with a bedtime in it. The owner's standing line is
      // that a product moralising about a short night is one he deletes. State
      // the target, state what it is for, stop.
      // toFixed, not bare addition · 6.8 + 0.7 is 7.499999999999999 in
      // binary floating point, and the runner should not read that.
      const targetH = (floorH + SLEEP_FLOOR_TOLERANCE_H).toFixed(1);
      const detail = `Your mileage puts the target at ${targetH}h. The adaptation from this block lands in that sleep.`;
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
