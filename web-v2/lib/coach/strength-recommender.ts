/**
 * lib/coach/strength-recommender.ts · per-runner strength-day picker.
 *
 * Replaces the frontend's pickStrengthDays() heuristic (which only
 * looked at week shape · no per-user signal). This file owns the
 * decision: which 0-2 days this week get a "+ STRENGTH" annotation,
 * what's the runner's habit state, and (when dormant) what coach
 * intent to emit.
 *
 * Generic across all users · queries by userUuid + planId, no
 * hardcoded runner identity, no chat fallback.
 *
 * Doctrine: Research/07-strength-programming.md
 *   1. Default 2 sessions/wk for distance runners in base/build
 *   2. Easy or recovery days only · never quality, never long
 *   3. Never day-BEFORE quality or long
 *   4. Keep ≥1 pure rest day per week
 *   5. Race week → 0 strength · taper week → ≤1 maintenance
 *   6. ACWR >1.5 → drop to 1 strength/wk on a recovery day
 *
 * Doctrine NOT enforced here (intentional follow-ups):
 *   · Per-phase set/rep prescriptions (Research/07 §4) · the recommender
 *     only picks DAYS, not exercises. Runner picks the session.
 *   · Plyometric contact-count progression (Research/07 §6) · same.
 *
 * Brief: designs/briefs/strength-recommender-backend-brief.md
 */

import { pool } from '@/lib/db/pool';

export type StrengthHabit = 'on_track' | 'building' | 'lapsed' | 'dormant' | 'unknown';

export interface StrengthCoachIntent {
  severity: 'soft' | 'firm' | 'urgent';
  body: string;
}

export interface StrengthRecommendation {
  /** ISO YYYY-MM-DD dates for the target Mon-Sun week. 0-2 entries.
   *  Empty when: race week within 7d, runner has active injury we know
   *  about, plan loaded but week is all rest with no good slot. */
  recommendedDays: string[];
  /** Why these days · one sentence, plain English. */
  reason: string;
  /** Status of the runner's logged strength habit. Derived from
   *  strength_sessions over the last 28 days. */
  habit: StrengthHabit;
  /** Coach-intent payload when habit='dormant' (≥21 days without a
   *  session). Frontend renders via the existing coach_intents pipeline.
   *  Null in every other habit state. */
  coachIntent: StrengthCoachIntent | null;
}

// ─── Tuning constants · doctrine-derived ────────────────────────────────

const DEFAULT_STRENGTH_DAYS_PER_WEEK = 2;
const HABIT_WINDOW_DAYS = 28;
const ACWR_HIGH_SPIKE_THRESHOLD = 1.5;
const RACE_WEEK_WINDOW_DAYS = 7;
const TAPER_WINDOW_DAYS = 14;
const DORMANT_THRESHOLD_DAYS = 21;

// ─── Top-level entry ────────────────────────────────────────────────────

/**
 * Recommend strength days for the runner's Mon-Sun week starting on
 * `weekStartISO`. Reads plan + race + history; returns the decision.
 *
 * Stable across the week · same (userId, weekStartISO) always returns
 * the same recommendation, so the "+ STRENGTH" chip doesn't jitter
 * day-to-day.
 *
 * Returns a "no data" recommendation when the plan isn't loaded yet.
 * Returns an empty days array when this is race week, the plan is
 * dormant, or there's no acceptable slot.
 */
export async function recommendStrengthDays(
  userUuid: string,
  weekStartISO: string,
): Promise<StrengthRecommendation> {
  // 1. Load the week's plan workouts
  const weekDays = await loadWeekWorkouts(userUuid, weekStartISO);

  // 2. Load runner habit + preferences + readiness gate
  const [habit, prefs, raceContext, loadContext, readinessGate] = await Promise.all([
    loadHabit(userUuid),
    loadPreferences(userUuid),
    loadRaceContext(userUuid, weekStartISO),
    loadLoadContext(userUuid),
    loadReadinessGate(userUuid),
  ]);

  const coachIntent = habit === 'dormant' ? buildDormantIntent() : null;

  // 3. Race-week / taper override · zero or one strength max
  if (raceContext.kind === 'race_week') {
    return {
      recommendedDays: [],
      reason: 'Race week · zero strength. Save the legs.',
      habit, coachIntent,
    };
  }

  // 3.5 · Readiness pullback override (2026-06-01 · David's gap fix).
  // Per Research/07 · heavy lifting under high fatigue increases
  // injury risk. When the readiness brief signals pull-back or has
  // active streaks, the strength recommender now matches what the
  // run-adapter is doing · same source of truth, no contradictory
  // signals to the runner.
  if (readinessGate.suppressAll) {
    return {
      recommendedDays: [],
      reason: readinessGate.reason,
      habit, coachIntent,
    };
  }

  // 4. Build candidate pool · easy or recovery days only, respecting
  //    adjacency rules.
  const candidates = pickCandidates(weekDays);
  if (candidates.length === 0) {
    return {
      recommendedDays: [],
      reason: weekDays.length === 0
        ? 'Plan not loaded for this week yet.'
        : 'No acceptable slot this week (every easy day is adjacent to a quality or long run).',
      habit, coachIntent,
    };
  }

  // 5. Decide HOW MANY to recommend
  const maxFromRunner = prefs.daysPerWeek;
  const maxFromPhase = raceContext.kind === 'taper_week' ? 1 : DEFAULT_STRENGTH_DAYS_PER_WEEK;
  const maxFromLoad = (loadContext.acwr != null && loadContext.acwr > ACWR_HIGH_SPIKE_THRESHOLD) ? 1 : DEFAULT_STRENGTH_DAYS_PER_WEEK;
  // Readiness streak (without full pull-back) drops to 1 maintenance ·
  // Research/07 same doctrine as ACWR-spike rule. Maintenance is fine
  // under recoverable fatigue; piling on a second heavy day is not.
  const maxFromReadiness = readinessGate.capAtOne ? 1 : DEFAULT_STRENGTH_DAYS_PER_WEEK;
  const target = Math.min(maxFromRunner, maxFromPhase, maxFromLoad, maxFromReadiness, candidates.length);

  // 6. Pick the best `target` candidates. Stable selection: rank by
  //    isolation score (distance from nearest quality/long) so the runner
  //    gets the most-rested-around days first.
  candidates.sort((a, b) => b.isolationScore - a.isolationScore);

  // Ensure we don't strand the runner with zero pure rest days. Find
  // the candidate that would leave at least 1 unselected rest day after
  // picking. If the only viable picks are rest days AND removing them
  // would leave 0 rest days, fall back to maxFromPhase = 1.
  const restDaysInWeek = weekDays.filter(d => d.type === 'rest').length;
  let picked = candidates.slice(0, target).map(c => c.date);
  const restPicked = picked.filter(d => {
    const day = weekDays.find(w => w.date === d);
    return day?.type === 'rest';
  }).length;
  if (restDaysInWeek > 0 && restDaysInWeek - restPicked === 0) {
    // Would leave zero rest. Drop one rest-day pick to preserve.
    const lastRestPickIdx = [...picked].reverse().findIndex(d => {
      const day = weekDays.find(w => w.date === d);
      return day?.type === 'rest';
    });
    if (lastRestPickIdx >= 0) {
      picked = picked.filter((_, i) => i !== picked.length - 1 - lastRestPickIdx);
    }
  }

  // Sort the final picks chronologically for stable display.
  picked.sort();

  return {
    recommendedDays: picked,
    reason: buildReason(picked, weekDays, raceContext, loadContext, readinessGate),
    habit, coachIntent,
  };
}

// ─── Habit detection ────────────────────────────────────────────────────

async function loadHabit(userUuid: string): Promise<StrengthHabit> {
  const sessions = (await pool.query<{ date: Date }>(
    `SELECT date FROM strength_sessions
      WHERE user_uuid = $1
        AND date >= CURRENT_DATE - $2::int
      ORDER BY date DESC`,
    [userUuid, HABIT_WINDOW_DAYS],
  ).catch(() => ({ rows: [] }))).rows;

  if (sessions.length === 0) {
    // Distinguish "new runner" from "lapsed/dormant" by checking history.
    const anyEver = (await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM strength_sessions WHERE user_uuid = $1 LIMIT 1`,
      [userUuid],
    ).catch(() => ({ rows: [{ n: '0' }] }))).rows[0];
    return Number(anyEver?.n ?? 0) > 0 ? 'dormant' : 'unknown';
  }

  // Days since most recent session
  const mostRecent = sessions[0].date;
  const daysSince = Math.floor((Date.now() - mostRecent.getTime()) / 86400000);

  if (daysSince >= DORMANT_THRESHOLD_DAYS) return 'dormant';
  if (daysSince >= 14) return 'lapsed';

  // Count distinct days (multiple sessions same day = 1 for habit)
  const distinct7 = new Set(sessions.filter(s => Date.now() - s.date.getTime() <= 7 * 86400000)
                                   .map(s => s.date.toISOString().slice(0, 10))).size;
  const distinct14 = new Set(sessions.filter(s => Date.now() - s.date.getTime() <= 14 * 86400000)
                                    .map(s => s.date.toISOString().slice(0, 10))).size;
  if (distinct7 >= 1 && distinct14 >= 2) return 'on_track';
  return 'building';
}

function buildDormantIntent(): StrengthCoachIntent {
  return {
    severity: 'firm',
    body:
      `It has been over 3 weeks since your last logged strength session. ` +
      `Two short sessions a week protects your hips and hamstrings, ` +
      `especially as mileage climbs. Today is an easy day · 20 minutes is enough.`,
  };
}

// ─── Plan + preferences + race + load context ───────────────────────────

interface WeekDay {
  date: string;
  dow: number;            // 0 Mon ... 6 Sun
  type: string;
  isQuality: boolean;
  isLong: boolean;
  distanceMi: number;
}

async function loadWeekWorkouts(userUuid: string, weekStartISO: string): Promise<WeekDay[]> {
  const endISO = isoAddDays(weekStartISO, 6);
  const rows = (await pool.query<{
    date_iso: string;
    type: string;
    distance_mi: string | null;
    is_quality: boolean | null;
    is_long: boolean | null;
  }>(
    `SELECT pw.date_iso, pw.type, pw.distance_mi, pw.is_quality, pw.is_long
       FROM plan_workouts pw
       JOIN training_plans tp ON tp.id = pw.plan_id
      WHERE tp.user_uuid = $1
        AND tp.archived_iso IS NULL
        AND pw.date_iso >= $2 AND pw.date_iso <= $3
      ORDER BY pw.date_iso ASC`,
    [userUuid, weekStartISO, endISO],
  ).catch(() => ({ rows: [] }))).rows;

  return rows.map(r => ({
    date: r.date_iso,
    dow: dowFromISO(r.date_iso),
    type: r.type,
    isQuality: Boolean(r.is_quality),
    isLong: Boolean(r.is_long),
    distanceMi: r.distance_mi != null ? Number(r.distance_mi) : 0,
  }));
}

interface Prefs {
  daysPerWeek: number;
  crossTrainModes: string[];
}

async function loadPreferences(userUuid: string): Promise<Prefs> {
  const r = (await pool.query<{
    cross_training_modes: string[] | null;
  }>(
    `SELECT cross_training_modes FROM profile WHERE user_uuid = $1 LIMIT 1`,
    [userUuid],
  ).catch(() => ({ rows: [] }))).rows[0];
  // profile.strength_days_per_week column doesn't exist yet; default to 2.
  // When it lands, switch to: r?.strength_days_per_week ?? DEFAULT
  return {
    daysPerWeek: DEFAULT_STRENGTH_DAYS_PER_WEEK,
    crossTrainModes: Array.isArray(r?.cross_training_modes) ? r.cross_training_modes : [],
  };
}

interface RaceContext {
  kind: 'race_week' | 'taper_week' | 'normal';
  daysToRace: number | null;
}

async function loadRaceContext(userUuid: string, weekStartISO: string): Promise<RaceContext> {
  const weekEndISO = isoAddDays(weekStartISO, 6);
  const r = (await pool.query<{ date: string }>(
    `SELECT meta->>'date' AS date FROM races
      WHERE user_uuid = $1
        AND meta->>'priority' IN ('A', 'B')
        AND (meta->>'date')::date >= $2::date
      ORDER BY (meta->>'date')::date ASC LIMIT 1`,
    [userUuid, weekStartISO],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!r?.date) return { kind: 'normal', daysToRace: null };

  const raceMs = Date.parse(r.date + 'T12:00:00Z');
  const weekStartMs = Date.parse(weekStartISO + 'T00:00:00Z');
  const weekEndMs = Date.parse(weekEndISO + 'T23:59:59Z');
  const daysToRace = Math.round((raceMs - weekStartMs) / 86400000);

  // Race within this week or next 7 days = race week
  if (raceMs >= weekStartMs && raceMs <= weekEndMs + 0) {
    return { kind: 'race_week', daysToRace };
  }
  if (daysToRace > 0 && daysToRace <= TAPER_WINDOW_DAYS) {
    return { kind: 'taper_week', daysToRace };
  }
  return { kind: 'normal', daysToRace };
}

interface LoadContext {
  acwr: number | null;
}

interface ReadinessGate {
  /** True when the readiness brief signals composite pull-back ·
   *  recommender returns empty days. Per Research/07 · heavy lifting
   *  under multi-pillar fatigue is injury risk. */
  suppressAll: boolean;
  /** True when ≥1 active 3+ day streak (sleep, HRV, RHR). Drops the
   *  weekly cap to 1 maintenance session. Same severity-band as the
   *  ACWR > 1.5 rule. */
  capAtOne: boolean;
  /** Plain-language reason for the recommendation copy. Empty when
   *  no gate fires (the recommender uses its normal copy). */
  reason: string;
}

/**
 * Read the readiness brief and decide whether strength should suppress
 * or cap. Best-effort · returns "no gate" on failure so the recommender
 * degrades to its prior behavior (ACWR-only fatigue gate).
 *
 * Same source of truth the run-adapter reads (lib/plan/adapt.ts ·
 * detectReadinessPullback). Two systems, one signal · no more
 * contradictory readouts to the runner.
 */
async function loadReadinessGate(userUuid: string): Promise<ReadinessGate> {
  try {
    const { loadCoachState } = await import('@/lib/coach/state-loader');
    const { loadReadinessBrief } = await import('@/lib/coach/readiness-brief');
    const state = await loadCoachState(userUuid);
    if (!state) return { suppressAll: false, capAtOne: false, reason: '' };
    const brief = await loadReadinessBrief(userUuid, state);
    if (!brief) return { suppressAll: false, capAtOne: false, reason: '' };

    const isPullback = brief.band === 'pull-back';
    const streaks = brief.streaks ?? [];

    if (isPullback) {
      const streakDesc = streaks.length > 0
        ? ` (${streaks[0].pillar.toUpperCase()} ${streaks[0].direction} ${streaks[0].days}d)`
        : '';
      return {
        suppressAll: true,
        capAtOne: false,
        reason: `Strength suppressed this week · composite readiness in pull-back band${streakDesc}. Heavy lifting under multi-pillar fatigue is injury risk per Research/07.`,
      };
    }
    if (streaks.length >= 1) {
      const s = streaks[0];
      return {
        suppressAll: false,
        capAtOne: true,
        reason: `Strength capped at 1 maintenance session · ${s.pillar.toUpperCase()} ${s.direction} for ${s.days} days. Hold form, skip the second heavy day.`,
      };
    }
    return { suppressAll: false, capAtOne: false, reason: '' };
  } catch {
    return { suppressAll: false, capAtOne: false, reason: '' };
  }
}

async function loadLoadContext(userUuid: string): Promise<LoadContext> {
  // Quick ACWR derivation · acute (7d) / chronic (28d). Same query
  // shape readiness uses.
  const r = (await pool.query<{ acute: string; chronic: string }>(
    `SELECT
        COALESCE(SUM((data->>'distanceMi')::numeric) FILTER (
          WHERE COALESCE(data->>'date', LEFT(data->>'startLocal', 10))::date
                >= CURRENT_DATE - 7
        ), 0)::text AS acute,
        COALESCE(SUM((data->>'distanceMi')::numeric) FILTER (
          WHERE COALESCE(data->>'date', LEFT(data->>'startLocal', 10))::date
                >= CURRENT_DATE - 28
        ), 0)::text AS chronic
      FROM runs
     WHERE user_uuid = $1
       AND NOT (data ? 'mergedIntoId')`,
    [userUuid],
  ).catch(() => ({ rows: [{ acute: '0', chronic: '0' }] }))).rows[0];
  const acute = Number(r?.acute ?? 0) / 7;
  const chronic = Number(r?.chronic ?? 0) / 28;
  if (chronic === 0) return { acwr: null };
  return { acwr: Math.round((acute / chronic) * 100) / 100 };
}

// ─── Candidate scoring ──────────────────────────────────────────────────

interface Candidate {
  date: string;
  type: string;
  /** How isolated this day is from the nearest quality/long. Higher =
   *  better placement. 0 = adjacent to a hard day · 6 = whole week away. */
  isolationScore: number;
}

/**
 * Pick the candidate pool · easy/recovery days only, never adjacent to
 * a quality or long run, respect the "1+ pure rest day" rule.
 */
function pickCandidates(weekDays: WeekDay[]): Candidate[] {
  if (weekDays.length === 0) return [];

  const hardDayIndexes = new Set<number>();
  weekDays.forEach((d, i) => { if (d.isQuality || d.isLong) hardDayIndexes.add(i); });

  const candidates: Candidate[] = [];
  for (let i = 0; i < weekDays.length; i++) {
    const day = weekDays[i];
    // Skip quality/long days themselves.
    if (day.isQuality || day.isLong) continue;
    // Skip race day if present.
    if (day.type === 'race' || day.type === 'shakeout' || day.type === 'race_week_tuneup') continue;
    // Day-BEFORE quality or long is also off-limits per Research/07.
    if (hardDayIndexes.has(i + 1)) continue;
    // Acceptable: easy / recovery / rest days that don't precede a hard day.
    if (day.type !== 'easy' && day.type !== 'recovery' && day.type !== 'rest') continue;

    // Isolation score · distance from nearest hard day in this week.
    let nearestHardDist = 7;
    for (const hi of hardDayIndexes) {
      nearestHardDist = Math.min(nearestHardDist, Math.abs(i - hi));
    }
    candidates.push({
      date: day.date,
      type: day.type,
      isolationScore: nearestHardDist,
    });
  }
  return candidates;
}

// ─── Copy synthesis ─────────────────────────────────────────────────────

function buildReason(
  picked: string[],
  weekDays: WeekDay[],
  raceCtx: RaceContext,
  loadCtx: LoadContext,
  readinessGate: ReadinessGate,
): string {
  if (picked.length === 0) {
    return 'No strength surfaced this week.';
  }
  const dayLabels = picked.map(iso => {
    const dow = dowFromISO(iso);
    return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][dow];
  });
  const list = dayLabels.length === 1 ? dayLabels[0] : `${dayLabels.slice(0, -1).join(' + ')} + ${dayLabels.at(-1)}`;

  const reasons: string[] = [];
  // Type characterization · singular/plural aware
  const types = picked.map(iso => weekDays.find(d => d.date === iso)?.type ?? 'easy');
  const allEasy = types.every(t => t === 'easy');
  const anyRest = types.some(t => t === 'rest');
  if (allEasy) reasons.push(picked.length === 1 ? 'easy day' : 'both easy days');
  else if (anyRest) reasons.push(picked.length === 1 ? 'rest day' : 'rest day + easy day');
  // Adjacency to hard days
  reasons.push(picked.length === 1 ? 'not adjacent to a quality session' : 'neither adjacent to a quality session');

  let suffix = '';
  // Readiness signal takes precedence over ACWR · it's the multi-pillar
  // composite that includes ACWR as one of its inputs.
  if (readinessGate.capAtOne && picked.length === 1) {
    const s = readinessGate.reason.split('·')[1]?.trim() ?? 'readiness signal';
    suffix = ` · dropped to 1 maintenance (${s})`;
  } else if (raceCtx.kind === 'taper_week') {
    suffix = ' · maintenance only, race in 8-14 days';
  } else if (loadCtx.acwr != null && loadCtx.acwr > ACWR_HIGH_SPIKE_THRESHOLD) {
    suffix = ` · dropped to 1 session (ACWR ${loadCtx.acwr.toFixed(1)} · high)`;
  }
  return `${list} · ${reasons.join(', ')}${suffix}.`;
}

// ─── ISO helpers ────────────────────────────────────────────────────────

function isoAddDays(iso: string, n: number): string {
  const t = Date.parse(iso + 'T00:00:00Z');
  return new Date(t + n * 86400000).toISOString().slice(0, 10);
}

/** 0 Mon, 1 Tue, ... 6 Sun · matches the brief's expected ISO[] order. */
function dowFromISO(iso: string): number {
  const t = Date.parse(iso + 'T12:00:00Z');
  const jsDow = new Date(t).getUTCDay();  // 0 Sun..6 Sat
  return (jsDow + 6) % 7;                 // 0 Mon..6 Sun
}

// ─── Coach intent emitter ───────────────────────────────────────────────

/**
 * Write the dormant coach_intent row when the runner has been dormant
 * for 21+ days. Idempotent · checks for an existing strength_recommend
 * intent in the last 14 days before writing.
 *
 * Called by glance-state.ts after recommendStrengthDays returns ·
 * the recommender itself stays pure (no side effects).
 */
export async function emitStrengthCoachIntent(
  userUuid: string,
  rec: StrengthRecommendation,
): Promise<void> {
  if (!rec.coachIntent) return;
  const recent = (await pool.query<{ id: number }>(
    `SELECT id FROM coach_intents
      WHERE (user_uuid = $1::uuid OR user_id = $1::text)
        AND reason = 'strength_recommend'
        AND ts >= NOW() - interval '14 days'
      LIMIT 1`,
    [userUuid],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (recent) return;
  await pool.query(
    `INSERT INTO coach_intents (user_uuid, ts, reason, field, value)
     VALUES ($1::uuid, NOW(), 'strength_recommend', $2, $3)`,
    [userUuid, rec.coachIntent.severity, rec.coachIntent.body],
  ).catch(() => {});
}
