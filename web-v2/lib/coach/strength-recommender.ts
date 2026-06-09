/**
 * lib/coach/strength-recommender.ts · per-runner strength-day picker.
 *
 * Owns the decision: which 0-2 days this week get a "+ STRENGTH"
 * annotation, what intensity (heavy/maintenance/mobility), what's the
 * runner's habit state, and (when dormant) what coach intent to emit.
 *
 * Generic across all users.
 *
 * 2026-06-03 REWRITE · Rule 14 · doctrine alignment.
 * The previous version forbade quality/long days and ONLY allowed
 * easy/recovery/rest. That's the OPPOSITE of Research/07 + Pfitz +
 * Daniels: pair hard with hard, keep easy days truly easy.
 *
 * Correct doctrine (Research/07-strength-programming.md):
 *   1. Heavy strength on hard-run days (PM, ≥4-6h after AM quality)
 *      · "Hard day hard, easy day easy" preserves recovery
 *   2. Maintenance/light only on recovery days
 *   3. NEVER day-BEFORE a quality or long run (legs not fresh)
 *   4. NEVER on long-run day or day after long (CNS depletion)
 *   5. Keep ≥1 pure rest day per week
 *   6. Race week → 0 · last heavy 7-10 days before race
 *   7. Per-phase frequency curve:
 *        build (QUALITY phase): 2/wk · heavy
 *        peak  (RACE-SPECIFIC):  1-2/wk · maintenance (cut sets)
 *        taper:                  1/wk · maintenance · 0 in last 7d
 *        race week:              0
 *        maintenance mode:       2-3/wk · heavier loads OK
 *        recovery mode:          0 (week 1) · mobility only (week 2+)
 *   8. ACWR > 1.5 OR readiness streak → drop to 1 maintenance
 *
 * Citations:
 *   · Research/07-strength-programming.md (canonical)
 *   · Blagrove, Howatson, Hayes (Sports Med 2018) · 5-15% RE gain
 *   · Beattie et al. (Sports Med 2017) · max + explosive lifting
 *   · Pfitzinger Advanced Marathoning Appx A · hard-day pairing
 *   · Hudson Run Faster Ch.8 · phase-specific strength morphing
 *
 * Doctrine NOT enforced here (intentional follow-ups):
 *   · Per-phase set/rep prescriptions (Research/07 §4) · runner picks
 *     the exercises; recommender picks DAY + INTENSITY tag.
 *   · Plyometric contact-count progression (Research/07 §6) · same.
 *
 * Brief: docs/PLAN_ENGINE_MID_BLOCK_DOCTRINE.md §Rule 14
 */

import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';

export type StrengthHabit = 'on_track' | 'building' | 'lapsed' | 'dormant' | 'unknown';

export interface StrengthCoachIntent {
  severity: 'soft' | 'firm' | 'urgent';
  body: string;
}

/** 2026-06-03 · Rule 14 · per-pick intensity tag.
 *   heavy       · max-strength lifts (3-5 reps @ 85%+ 1RM) · build phase
 *                 same-day-as-quality only · "hard with hard"
 *   maintenance · same exercises, reduced sets · peak phase + recovery days
 *   mobility    · bodyweight + foam roll only · taper week, post-race recovery
 *  Cite: Research/07 §4 (set/rep prescriptions) + Hudson Run Faster Ch.8. */
export type StrengthIntensity = 'heavy' | 'maintenance' | 'mobility';

/** 2026-06-03 · Rule 14 · timing relative to the day's run.
 *   pm        · do AFTER the day's run (≥4-6h gap). Required when paired
 *               with a quality run on the same day. Cite: Research/07 §3.
 *   anytime   · flex placement (easy/recovery day · no AM run hard stress). */
export type StrengthTiming = 'pm' | 'anytime';

export interface StrengthPick {
  date: string;
  intensity: StrengthIntensity;
  timing: StrengthTiming;
  /** True when paired same-day with a quality/long run (hard-with-hard). */
  pairedWithRun: boolean;
}

export interface StrengthRecommendation {
  /** ISO YYYY-MM-DD dates for the target Mon-Sun week. 0-2 entries.
   *  Empty when: race week within 7d, runner has active injury we know
   *  about, plan loaded but week is all rest with no good slot.
   *  Kept for back-compat · prefer `picks` for new consumers (carries
   *  intensity + timing tags). */
  recommendedDays: string[];
  /** 2026-06-03 · Rule 14 · enriched picks with intensity + timing. */
  picks: StrengthPick[];
  /** Why these days · one sentence, plain English. */
  reason: string;
  /** Status of the runner's logged strength habit. Derived from
   *  strength_sessions over the last 28 days. */
  habit: StrengthHabit;
  /** Coach-intent payload when habit='dormant' (≥21 days without a
   *  session). Frontend renders via the existing coach_intents pipeline.
   *  Null in every other habit state. */
  coachIntent: StrengthCoachIntent | null;
  /** 2026-06-01 · readiness-gate result that drove this recommendation.
   *  Used by emitStrengthSkipIntent to write the audit row. Null when
   *  no readiness gate fired (race-week + ACWR-only paths surface via
   *  the regular `reason` field). NOT rendered by the frontend ·
   *  internal audit signal. */
  _readinessGate?: {
    suppressed: boolean;
    capped: boolean;
    reason: string;
  };
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
      picks: [],
      reason: 'Race week · Zero strength. Save the legs.',
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
      picks: [],
      reason: readinessGate.reason,
      habit, coachIntent,
      _readinessGate: { suppressed: true, capped: false, reason: readinessGate.reason },
    };
  }

  // 4. Build candidate pool · easy or recovery days only, respecting
  //    adjacency rules.
  const candidates = pickCandidates(weekDays);
  if (candidates.length === 0) {
    return {
      recommendedDays: [],
      picks: [],
      reason: weekDays.length === 0
        ? 'Plan not loaded for this week yet.'
        : 'No acceptable slot this week (every viable day is a long run or adjacent to one).',
      habit, coachIntent,
    };
  }

  // 5. Decide HOW MANY to recommend (per-phase frequency curve · Rule 14).
  const phaseContext = await loadPhaseContext(userUuid, weekStartISO);
  const maxFromRunner = prefs.daysPerWeek;
  const maxFromPhase = phaseFrequencyCap(phaseContext, raceContext);
  const maxFromLoad = (loadContext.acwr != null && loadContext.acwr > ACWR_HIGH_SPIKE_THRESHOLD) ? 1 : DEFAULT_STRENGTH_DAYS_PER_WEEK;
  // Readiness streak (without full pull-back) drops to 1 maintenance ·
  // Research/07 same doctrine as ACWR-spike rule. Maintenance is fine
  // under recoverable fatigue; piling on a second heavy day is not.
  const maxFromReadiness = readinessGate.capAtOne ? 1 : DEFAULT_STRENGTH_DAYS_PER_WEEK;
  const target = Math.min(maxFromRunner, maxFromPhase, maxFromLoad, maxFromReadiness, candidates.length);

  // 5b. Mode-aware intensity demotion · per-phase frequency cap doesn't
  //     touch intensity tags. Demote heavy → maintenance when phase
  //     calls for it (peak / taper / maintenance mode / recovery mode).
  const demoteHeavy = shouldDemoteHeavy(phaseContext, raceContext);

  // 6. Pick the best `target` candidates. Sort by preference score
  //    (quality days first per "hard with hard" doctrine).
  candidates.sort((a, b) => b.preferenceScore - a.preferenceScore);

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

  // Build enriched picks with intensity + timing (Rule 14).
  const picks: StrengthPick[] = picked.map((date) => {
    const cand = candidates.find((c) => c.date === date)!;
    let intensity = cand.intensity;
    if (demoteHeavy && intensity === 'heavy') intensity = 'maintenance';
    if (phaseContext.mode === 'recovery') intensity = 'mobility';
    return {
      date,
      intensity,
      timing: cand.timing,
      pairedWithRun: cand.pairedWithRun,
    };
  });

  return {
    recommendedDays: picked,
    picks,
    reason: buildReason(picked, weekDays, raceContext, loadContext, readinessGate, phaseContext),
    habit, coachIntent,
    _readinessGate: readinessGate.capAtOne
      ? { suppressed: false, capped: true, reason: readinessGate.reason }
      : { suppressed: false, capped: false, reason: '' },
  };
}

// ─── Phase context · Rule 14 ────────────────────────────────────────────

interface PhaseContext {
  /** Plan mode from training_plans.mode · 'race-prep' / 'maintenance' / 'recovery'. */
  mode: 'race-prep' | 'maintenance' | 'recovery' | 'unknown';
  /** Phase label from plan_phases · 'BASE' / 'QUALITY' / 'RACE-SPECIFIC' /
   *  'TAPER' / 'MAINTENANCE' / 'RECOVERY'. */
  phaseLabel: string;
}

async function loadPhaseContext(userUuid: string, weekStartISO: string): Promise<PhaseContext> {
  const r = (await pool.query<{ mode: string | null; phase_label: string | null }>(
    `SELECT tp.mode,
            (SELECT ph.label FROM plan_phases ph
              JOIN plan_weeks w ON w.phase_id = ph.id
             WHERE w.plan_id = tp.id
               AND w.week_start_iso::date <= $2::date
               AND (w.week_start_iso::date + interval '6 days') >= $2::date
             LIMIT 1) AS phase_label
       FROM training_plans tp
      WHERE tp.user_uuid = $1 AND tp.archived_iso IS NULL
      ORDER BY tp.authored_iso DESC LIMIT 1`,
    [userUuid, weekStartISO],
  ).catch(() => ({ rows: [] }))).rows[0];
  const mode = (r?.mode ?? 'race-prep') as PhaseContext['mode'];
  return {
    mode: ['race-prep', 'maintenance', 'recovery'].includes(mode) ? mode : 'unknown',
    phaseLabel: r?.phase_label ?? '',
  };
}

/** Per-phase frequency cap per Rule 14 doctrine + Research/07 §2-Phase-by-Phase-Programming. */  // was §"Periodization" · heading: ## 2. Phase-by-phase programming
function phaseFrequencyCap(phaseCtx: PhaseContext, raceCtx: RaceContext): number {
  // Race week trumps everything · 0 (already handled upstream, defensive)
  if (raceCtx.kind === 'race_week') return 0;
  // Mode-driven first
  if (phaseCtx.mode === 'recovery') return 0;        // week 1 post-race · 0
  if (phaseCtx.mode === 'maintenance') return 3;     // off-season · can go higher
  // Race-prep phase-driven
  if (raceCtx.kind === 'taper_week') return 1;
  const phase = phaseCtx.phaseLabel.toUpperCase();
  if (phase === 'TAPER') return 1;
  if (phase === 'RACE-SPECIFIC') return 1; // peak · maintenance only, drop one
  if (phase === 'QUALITY' || phase === 'BUILD' || phase === 'BASE') return 2;
  return DEFAULT_STRENGTH_DAYS_PER_WEEK;
}

/** Heavy lifts get demoted to maintenance in peak/taper/maintenance/recovery. */
function shouldDemoteHeavy(phaseCtx: PhaseContext, raceCtx: RaceContext): boolean {
  if (raceCtx.kind === 'race_week') return true;
  if (raceCtx.kind === 'taper_week') return true;
  if (phaseCtx.mode === 'recovery') return true; // becomes mobility downstream
  if (phaseCtx.mode === 'maintenance') return false; // can still go heavy
  const phase = phaseCtx.phaseLabel.toUpperCase();
  if (phase === 'TAPER') return true;
  if (phase === 'RACE-SPECIFIC') return true; // peak · maintenance only
  return false;
}

// ─── Habit detection ────────────────────────────────────────────────────

async function loadHabit(userUuid: string): Promise<StrengthHabit> {
  // 2026-06-03 · runner TZ anchors the habit window.
  const today = await runnerToday(userUuid);
  const sessions = (await pool.query<{ date: Date }>(
    `SELECT date FROM strength_sessions
      WHERE user_uuid = $1
        AND date >= $3::date - $2::int
      ORDER BY date DESC`,
    [userUuid, HABIT_WINDOW_DAYS, today],
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
        reason: `Strength suppressed this week · Readiness low${streakDesc}. Heavy lifting when sleep and recovery are both down is injury risk.`,
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
  // 2026-06-03 · runner TZ anchors the ACWR windows.
  const today = await runnerToday(userUuid);
  // Quick ACWR derivation · acute (7d) / chronic (28d).
  // 2026-06-01 - MAX-per-day dedupe (see lib/plan/generate.ts).
  const r = (await pool.query<{ acute: string; chronic: string }>(
    `WITH per_day AS (
       SELECT COALESCE(data->>'date', LEFT(data->>'startLocal', 10))::date AS d,
              MAX((data->>'distanceMi')::numeric) AS mi
         FROM runs
        WHERE user_uuid = $1
          AND NOT (data ? 'mergedIntoId')
          AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10))::date
              >= $2::date - 28
        GROUP BY 1
     )
     SELECT
        COALESCE(SUM(mi) FILTER (WHERE d >= $2::date - 7), 0)::text AS acute,
        COALESCE(SUM(mi), 0)::text AS chronic
      FROM per_day`,
    [userUuid, today],
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
  /** 2026-06-03 · Rule 14 · doctrine-driven preference score.
   *   quality day      = 10  (preferred · "hard with hard" · PM after run)
   *   easy day         = 5   (acceptable · maintenance, not adjacent to hard)
   *   recovery day     = 3   (light/mobility only)
   *   rest day         = 1   (last resort · breaks the "1+ pure rest day" rule)
   *  Negative scores filter out (day-before-hard, long-run day, race day). */
  preferenceScore: number;
  intensity: StrengthIntensity;
  timing: StrengthTiming;
  pairedWithRun: boolean;
}

/**
 * 2026-06-03 REWRITE · pair hard with hard per Research/07 doctrine.
 *
 * Scoring (higher = better placement):
 *   · quality run day  · score 10 · heavy strength PM (≥4-6h after run)
 *   · easy run day     · score 5  · maintenance, only if not adjacent to hard
 *   · recovery run day · score 3  · maintenance/light only
 *   · rest day         · score 1  · last resort
 *
 * Hard exclusions (score = -100, filtered):
 *   · long-run day (CNS depletion · doctrine §3)
 *   · day immediately BEFORE a quality or long (legs not fresh · §3)
 *   · day immediately AFTER long (recovery sacred · §3)
 *   · race day / shakeout / race-week tune-up
 *
 * Cite: Research/07 §3 (day placement) + Pfitz Advanced Marathoning Appx A
 */
function pickCandidates(weekDays: WeekDay[]): Candidate[] {
  if (weekDays.length === 0) return [];

  const hardDayIndexes = new Set<number>();
  const longDayIndexes = new Set<number>();
  weekDays.forEach((d, i) => {
    if (d.isQuality || d.isLong) hardDayIndexes.add(i);
    if (d.isLong) longDayIndexes.add(i);
  });

  const candidates: Candidate[] = [];
  for (let i = 0; i < weekDays.length; i++) {
    const day = weekDays[i];
    // Hard exclusions
    if (day.type === 'race' || day.type === 'shakeout' || day.type === 'race_week_tuneup') continue;
    if (day.isLong) continue; // long-run day · CNS too cooked
    if (hardDayIndexes.has(i + 1)) continue; // day-before hard · legs not fresh
    if (longDayIndexes.has(i - 1)) continue; // day-after long · recovery sacred

    // Score by preference
    let score = 0;
    let intensity: StrengthIntensity = 'maintenance';
    let timing: StrengthTiming = 'anytime';
    let pairedWithRun = false;

    if (day.isQuality) {
      // PREFERRED · pair heavy strength PM with AM quality run
      score = 10;
      intensity = 'heavy';
      timing = 'pm';
      pairedWithRun = true;
    } else if (day.type === 'easy') {
      score = 5;
      intensity = 'maintenance';
      timing = 'anytime';
    } else if (day.type === 'recovery') {
      score = 3;
      intensity = 'maintenance';
      timing = 'anytime';
    } else if (day.type === 'rest') {
      score = 1;
      intensity = 'maintenance';
      timing = 'anytime';
    } else {
      // Unknown type · skip
      continue;
    }

    candidates.push({
      date: day.date,
      type: day.type,
      preferenceScore: score,
      intensity,
      timing,
      pairedWithRun,
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
  phaseCtx: PhaseContext,
): string {
  if (picked.length === 0) {
    return 'No strength surfaced this week.';
  }
  const dayLabels = picked.map(iso => {
    const dow = dowFromISO(iso);
    return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][dow];
  });
  const list = dayLabels.length === 1 ? dayLabels[0] : `${dayLabels.slice(0, -1).join(' + ')} + ${dayLabels.at(-1)}`;

  // 2026-06-03 · Rule 14 · doctrine-driven copy. The picks reflect
  // "hard with hard" pairing · quality-day picks are PM heavy, easy-day
  // picks are anytime maintenance.
  const pairedCount = picked.filter((iso) => weekDays.find((d) => d.date === iso)?.isQuality).length;
  const easyCount = picked.filter((iso) => {
    const d = weekDays.find((w) => w.date === iso);
    return d && !d.isQuality && (d.type === 'easy' || d.type === 'recovery');
  }).length;

  const reasons: string[] = [];
  if (pairedCount > 0 && easyCount > 0) {
    reasons.push(`${pairedCount} heavy PM after quality + ${easyCount} maintenance`);
  } else if (pairedCount > 0) {
    reasons.push(`${pairedCount === 1 ? 'PM after quality' : 'both PM after quality runs'} · pair hard with hard`);
  } else {
    reasons.push(picked.length === 1 ? 'maintenance' : 'both maintenance');
  }

  let suffix = '';
  // Readiness signal first · it's the multi-pillar composite.
  if (readinessGate.capAtOne && picked.length === 1) {
    const s = readinessGate.reason.split('·')[1]?.trim() ?? 'readiness signal';
    suffix = ` · dropped to 1 (${s})`;
  } else if (phaseCtx.mode === 'recovery') {
    suffix = ' · mobility only · post-race recovery';
  } else if (phaseCtx.mode === 'maintenance') {
    suffix = ' · off-season · heavier loads OK';
  } else if (raceCtx.kind === 'taper_week') {
    suffix = ' · maintenance only · last heavy 7-10 days before race';
  } else if (phaseCtx.phaseLabel.toUpperCase() === 'RACE-SPECIFIC') {
    suffix = ' · peak phase · maintenance, cut sets';
  } else if (loadCtx.acwr != null && loadCtx.acwr > ACWR_HIGH_SPIKE_THRESHOLD) {
    suffix = ` · dropped to 1 (ACWR ${loadCtx.acwr.toFixed(1)} · high)`;
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
  // Atomic INSERT...SELECT...WHERE NOT EXISTS — idempotent per 14-day window.
  await pool.query(
    `INSERT INTO coach_intents (user_id, user_uuid, ts, reason, field, value)
     SELECT $1::uuid, $1::uuid, NOW(), 'strength_recommend', $2, $3
     WHERE NOT EXISTS (
       SELECT 1 FROM coach_intents
       WHERE (user_uuid = $1::uuid OR user_id = $1::uuid)
         AND reason = 'strength_recommend'
         AND ts >= NOW() - interval '14 days'
     )`,
    [userUuid, rec.coachIntent.severity, rec.coachIntent.body],
  ).catch((e) => { console.warn('[strength-recommender] emitStrengthCoachIntent failed:', e?.message ?? e); });
}

/**
 * Emit a `strength_skip` audit intent when the recommender suppressed
 * or capped strength because of readiness signals. Mirrors the
 * run-adapter's coach_intents writes · gives the briefing surface a
 * clean trail to explain what happened.
 *
 * Two distinct signal kinds, both written under reason='strength_skip':
 *   · field='suppress' · band=pull-back → strength entirely off this week
 *   · field='cap_one'  · ≥1 active streak → dropped to 1 maintenance
 *
 * Idempotent per (user, kind, day) · re-running the recommender same
 * day doesn't double-write. Different kinds CAN coexist on the same
 * day if the picture shifts mid-day (e.g. recommender ran morning with
 * a streak, then evening readiness brief escalated to pull-back).
 *
 * Pre-condition · only fires when the recommender's returned
 * `recommendedDays.length` decision was DRIVEN by readiness · not
 * race-week or ACWR-only paths (those have their own surfacing).
 */
export async function emitStrengthSkipIntent(
  userUuid: string,
  rec: StrengthRecommendation,
): Promise<void> {
  // Only fire on readiness-driven suppression / cap. Race-week + ACWR-only
  // paths surface via the recommender's own `reason` field on the seed ·
  // they don't need a separate intent row.
  const gate = rec._readinessGate;
  if (!gate || (!gate.suppressed && !gate.capped)) return;
  const kind = gate.suppressed ? 'suppress' : 'cap_one';

  // 2026-06-03 · runner TZ for idempotency-per-day · was using server UTC.
  const today = await runnerToday(userUuid);
  // Atomic INSERT...SELECT...WHERE NOT EXISTS — idempotent per (user, kind, day).
  await pool.query(
    `INSERT INTO coach_intents (user_id, user_uuid, ts, reason, field, value)
     SELECT $1::uuid, $1::uuid, NOW(), 'strength_skip', $2, $3
     WHERE NOT EXISTS (
       SELECT 1 FROM coach_intents
       WHERE (user_uuid = $1::uuid OR user_id = $1::uuid)
         AND reason = 'strength_skip'
         AND field = $2
         AND ts::date = $4::date
     )`,
    [userUuid, kind, gate.reason, today],
  ).catch((e) => { console.warn('[strength-recommender] emitStrengthSkipIntent failed:', e?.message ?? e); });
}

/**
 * Emit a `strength_resume` intent when signals have NORMALIZED after
 * a recent strength_skip. Closes the loop · the runner sees "we
 * skipped Tuesday because sleep streak · today is back in band ·
 * strength resumes."
 *
 * Detection rules:
 *   1. A strength_skip intent was written in the last 7 days
 *   2. No strength_resume intent has been written since that skip
 *      (idempotency · don't re-emit per recovery cycle)
 *   3. Today the recommender returned a non-zero recommendation (i.e.
 *      readiness has cleared and at least one day is back in scope)
 *   4. The most recent skip was for a kind we can reverse: 'suppress'
 *      or 'cap_one'
 *
 * Pre-condition · `rec.recommendedDays.length > 0` (no point announcing
 * a resume if we STILL recommended nothing).
 */
export async function emitStrengthResumeIntent(
  userUuid: string,
  rec: StrengthRecommendation,
): Promise<void> {
  if (rec.recommendedDays.length === 0) return;

  // Find the most recent strength_skip in last 7 days.
  const lastSkip = (await pool.query<{ id: number; field: string; ts: Date }>(
    `SELECT id, field, ts FROM coach_intents
      WHERE (user_uuid = $1::uuid OR user_id = $1::uuid)
        AND reason = 'strength_skip'
        AND ts >= NOW() - interval '7 days'
      ORDER BY ts DESC LIMIT 1`,
    [userUuid],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!lastSkip) return;

  const skipDate = lastSkip.ts.toISOString().slice(0, 10);
  const wasSuppress = lastSkip.field === 'suppress';
  const body = wasSuppress
    ? `Strength was suppressed earlier this week (readiness pull-back). ` +
      `Signals are back in band · Strength resumes today.`
    : `Strength was capped to 1 session earlier this week (active streak). ` +
      `The streak has cleared · Full strength rotation resumes.`;

  // Atomic INSERT...SELECT...WHERE NOT EXISTS — idempotent per skip cycle ($4 = lastSkip.ts).
  await pool.query(
    `INSERT INTO coach_intents (user_id, user_uuid, ts, reason, field, value)
     SELECT $1::uuid, $1::uuid, NOW(), 'strength_resume', $2, $3
     WHERE NOT EXISTS (
       SELECT 1 FROM coach_intents
       WHERE (user_uuid = $1::uuid OR user_id = $1::uuid)
         AND reason = 'strength_resume'
         AND ts > $4
     )`,
    [userUuid, skipDate, body, lastSkip.ts],
  ).catch((e) => { console.warn('[strength-recommender] emitStrengthResumeIntent failed:', e?.message ?? e); });
}
