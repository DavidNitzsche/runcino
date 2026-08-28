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
 *   1. Heavy strength on THRESHOLD/TEMPO days (PM, ≥4h after the AM
 *      session · :553). VO2 and interval days are MAINTENANCE ONLY
 *      (:554) — see STRENGTH-1 below.
 *   2. Maintenance/light only on recovery days
 *   3. NEVER day-BEFORE a quality or long run (legs not fresh)
 *   4. NEVER on long-run day or day after long (CNS depletion)
 *   5. Keep ≥1 pure rest day per week
 *   6. Race week → 0 · last heavy 7-10 days before race (:113, :166)
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
 * STRENGTH-1 (2026-08-17) · three doctrine faults fixed:
 *   · pickCandidates prescribed HEAVY on any `isQuality` day. :554 is
 *     "VO2 / interval | Maintenance only | 24 h" — the one pairing the
 *     research rules out was the one the picker preferred. Threshold and
 *     tempo keep the heavy PM pick; intervals get maintenance.
 *   · The intensity doc claimed "3-5 reps @ 85%+ 1RM" (:190) while the
 *     emitted session was 6-8 / 8-10 / 12-15. The doc now names the row
 *     the session sits on, and the hip thrust's 8-10 — a rep range in no
 *     Research/07 table — is :130's 5-8.
 *   · Heavy was demoted from 14 days out while the copy asserted the
 *     research's 7-10 day rule. See LAST_HEAVY_DAYS_BEFORE_RACE.
 *
 * Doctrine NOT enforced here (intentional follow-ups):
 *   · Per-phase set/rep prescriptions (Research/07 §4) · runner picks
 *     the exercises; recommender picks DAY + INTENSITY tag.
 *   · Plyometric contact-count progression (Research/07 §6) · same.
 *
 * Brief: docs/PLAN_ENGINE_MID_BLOCK_DOCTRINE.md §Rule 14
 */

import { pool } from '@/lib/db/pool';
import { runnerToday, runnerTimezone } from '@/lib/runtime/runner-tz';
import { computeAcwr } from './acwr';

export type StrengthHabit = 'on_track' | 'building' | 'lapsed' | 'dormant' | 'unknown';

export interface StrengthCoachIntent {
  severity: 'soft' | 'firm' | 'urgent';
  body: string;
}

/** 2026-06-03 · Rule 14 · per-pick intensity tag.
 *   heavy       · the heaviest session this 20-minute format supports ·
 *                 heavy slow resistance, 6-8 reps at up to ~85% 1RM
 *                 (Research/07:196 "Tendon HSR"; hip thrust 5-8 at
 *                 75-85%, :130). Placed on threshold days PM, or on an
 *                 easy day · "hard with hard".
 *   maintenance · same exercises, reduced sets · peak phase, recovery
 *                 days, and every VO2/interval day (Research/07:554).
 *   mobility    · bodyweight + foam roll only · race week, post-race.
 *
 *  STRENGTH-1 (2026-08-17) · this doc used to read "max-strength lifts
 *  (3-5 reps @ 85%+ 1RM)", which is Research/07:190's max-strength row,
 *  while sessionFor() emitted 6-8 / 8-10 / 12-15. The emitted session is
 *  the honest one: :674 states plainly that a no-barbell setup "cannot
 *  replicate a heavy barbell squat", so a 20-minute goblet-squat session
 *  is not a 3-5 @ 85-90% max-strength block and should not claim to be.
 *  The doc now names the row the session actually sits on.
 *
 *  Cite: Research/07:189-197 (set/rep table), :129-130 (exercise rows),
 *        :674 (equipment ceiling) + Hudson Run Faster Ch.8. */
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
  /** 2026-06-09 Phase 2 (3.7) · the actual 20-minute session. The
   *  recommender used to pick DAY + INTENSITY and stop — "what do I
   *  actually do" was the missing half (audit Part 5 #5 · 17 skips in
   *  28 days while the chip stayed advisory wallpaper). Content per
   *  Research/07 §runner maintenance dose: 2 movements × 3 sets +
   *  one optional finisher, 20 minutes, no gym required. */
  session: {
    title: string;
    durationMin: number;
    exercises: Array<{ name: string; sets: number; reps: string }>;
  };
}

export interface StrengthRecommendation {
  /** ISO YYYY-MM-DD dates for the target training week (the long_run_day
   *  window: weekStartISO .. +6, where the week ENDS on the long-run day · #24,
   *  audit 2026-06-16). 0-2 entries. Empty when: race week within 7d, runner
   *  has active injury we know about, plan loaded but week is all rest with no
   *  good slot. Kept for back-compat · prefer `picks` for new consumers
   *  (carries intensity + timing tags). */
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
  /** 2026-06-01 · readiness note attached to this recommendation. Used by
   *  emitStrengthSkipIntent to write the audit row. NOT rendered by the
   *  frontend · internal audit signal.
   *
   *  2026-08-17 · `suppressed` and `capped` are gone with the gate they
   *  described. Readiness no longer removes or caps a session; it attaches
   *  a sentence, and that sentence is what gets logged. */
  _readinessGate?: {
    note: string;
  };
}

// ─── Tuning constants · doctrine-derived ────────────────────────────────

const DEFAULT_STRENGTH_DAYS_PER_WEEK = 2;
const HABIT_WINDOW_DAYS = 28;
const ACWR_HIGH_SPIKE_THRESHOLD = 1.5;
const RACE_WEEK_WINDOW_DAYS = 7;
const TAPER_WINDOW_DAYS = 14;
/**
 * STRENGTH-1 (2026-08-17) · Research/07:113 and :166 · "Last heavy
 * session 7-10 d before race." The recommender demoted every heavy pick
 * from 14 days out (TAPER_WINDOW_DAYS) while the copy at buildReason
 * told the runner the rule was 7-10 days. The taper is 2-3 weeks (:99)
 * and its own row still permits 70-85% loads (:82), so the first taper
 * week keeps its heavy session; 10 is the conservative end of the
 * research's own 7-10 band.
 */
const LAST_HEAVY_DAYS_BEFORE_RACE = 10;
const DORMANT_THRESHOLD_DAYS = 21;

// ─── Session content (Phase 2 · 3.7) ───────────────────────────────────
//
// Research/07 §2x/week maintenance dose + §concurrent placement. Three
// fixed templates keyed on the intensity the picker already derives ·
// deliberately boring: the dose that gets DONE beats the program that
// gets skipped. Bodyweight/band variants so travel weeks don't zero it.
//
// STRENGTH-1 (2026-08-17) · every rep range below now sits on a row of
// the Research/07:189-197 table or the :129-130 exercise table. The hip
// thrust was 8-10, which is in neither; :130 gives "Hip thrust | 3-4 ×
// 5-8 | 75-85%".
function sessionFor(intensity: StrengthIntensity): StrengthPick['session'] {
  if (intensity === 'heavy') {
    return {
      title: 'Session A · hips + posterior',
      durationMin: 20,
      exercises: [
        // :196 · Tendon HSR · 6-8 reps at up to ~85% 1RM, 3-4 sets.
        { name: 'Goblet squat (or rear-foot split squat)', sets: 3, reps: '6-8 heavy' },
        // :130 · Hip thrust · 3-4 × 5-8 at 75-85%.
        { name: 'Hip thrust (or single-leg bridge)', sets: 3, reps: '5-8' },
        // :197 · endurance/conditioning · 12-20 at 40-60%.
        { name: 'Calf raise, straight knee', sets: 2, reps: '12-15' },
      ],
    };
  }
  if (intensity === 'maintenance') {
    return {
      title: 'Session B · single-leg + core',
      durationMin: 20,
      exercises: [
        { name: 'Walking lunge (or step-up)', sets: 3, reps: '8/leg' },
        { name: 'Side plank + leg lift', sets: 3, reps: '30s/side' },
        { name: 'Soleus raise, bent knee', sets: 2, reps: '12-15' },
      ],
    };
  }
  return {
    title: 'Mobility · 15 quiet minutes',
    durationMin: 15,
    exercises: [
      { name: 'Hip flexor + couch stretch', sets: 2, reps: '60s/side' },
      { name: 'Band walks, lateral', sets: 2, reps: '15/side' },
      { name: 'Ankle rocks + toe yoga', sets: 1, reps: '2 min' },
    ],
  };
}

// ─── Top-level entry ────────────────────────────────────────────────────

/**
 * Recommend strength days for the runner's training week starting on
 * `weekStartISO`. Reads plan + race + history; returns the decision.
 *
 * #24 (audit 2026-06-16) · `weekStartISO` is the long_run_day window start —
 * the recommender inherits whatever start it's handed and windows
 * weekStartISO..+6. Callers MUST pass the long_run_day-anchored week start so
 * the strength week agrees with the /api/plan/week strip: glance-state hands
 * weekDays[0].date (now weekWindowFor-derived), training-state hands
 * plan_weeks.week_start_iso (long_run_day-anchored by #10). For David (long=Sun)
 * the start is Monday, so nothing changes.
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
  opts?: {
    /** When true, skip the real-time readiness gate (suppressAll / capAtOne).
     *  Use for planning-ahead weeks (2+ weeks out) where today's fatigue
     *  streak is speculative noise — the recommendation re-rates live when
     *  the runner reaches that week. */
    skipReadinessGate?: boolean;
  },
): Promise<StrengthRecommendation> {
  // 1. Load the week's plan workouts
  const weekDays = await loadWeekWorkouts(userUuid, weekStartISO);

  // 2. Load runner habit + preferences + readiness gate
  const noGate: ReadinessGate = { note: '' };
  const [habit, prefs, raceContext, loadContext, readinessGate] = await Promise.all([
    loadHabit(userUuid),
    loadPreferences(userUuid),
    loadRaceContext(userUuid, weekStartISO),
    loadLoadContext(userUuid),
    opts?.skipReadinessGate ? Promise.resolve(noGate) : loadReadinessGate(userUuid),
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

  // 3.5 · Readiness used to suppress the whole week here (2026-06-01).
  // Removed 2026-08-17 per the owner ruling: readiness informs, it never
  // mutates a prescription. The note it produces rides along on the copy
  // below instead of deleting the runner's strength week.

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
  // ACWR is a training-load FACT (Research/07 shares the doctrine with the
  // ACWR-spike rule) and keeps its cap. Readiness does not: the recovery
  // score no longer caps the week — owner ruling, 2026-08-17.
  const maxFromLoad = (loadContext.acwr != null && loadContext.acwr > ACWR_HIGH_SPIKE_THRESHOLD) ? 1 : DEFAULT_STRENGTH_DAYS_PER_WEEK;
  const target = Math.min(maxFromRunner, maxFromPhase, maxFromLoad, candidates.length);
  // 2026-06-10 · this cap is recomputed LIVE every read (loadGlanceState is
  // not cached · readiness + load are re-read each call), so the weekly
  // target adapts BOTH directions within a week. It drops under fatigue
  // (readiness streak / ACWR spike) and returns to DEFAULT the moment the
  // gate clears · the pick + roll-forward below then fill the remaining
  // viable days, keeping two whenever it makes sense (David 2026-06-10 #2/#3).
  // Do NOT memoize this per-week to "stop the chip jitter" · that jitter is
  // the up/down adaptation, and the existing guards (readiness, ACWR,
  // adjacency, ≥1 rest day, phase frequency) are the "if it makes sense" gate.

  // 5b. Mode-aware intensity demotion · per-phase frequency cap doesn't
  //     touch intensity tags. Demote heavy → maintenance when phase
  //     calls for it (peak / taper / maintenance mode / recovery mode).
  const demoteHeavy = shouldDemoteHeavy(phaseContext, raceContext);

  // 5c. 2026-06-11 · count this week's ALREADY-LOGGED sessions toward the
  //     weekly target. The target is a COUNT, not a per-day schedule · a
  //     session the runner already did (HK or manual) satisfies one slot
  //     and must NOT be superseded by recommending ANOTHER day. David
  //     2026-06-11: he did strength today, but with two quality days this
  //     week the picker chose Tuesday, saw it missed, and rolled the chip
  //     to Friday — telling him to repeat a session he'd already done. A
  //     logged day renders green on its own (strengthDone); here we just
  //     stop recommending more once the count is met.
  const [loggedSet, todayISO] = await Promise.all([
    loadLoggedStrengthDates(userUuid, weekStartISO),
    runnerToday(userUuid),
  ]);
  const remainingTarget = Math.max(0, target - loggedSet.size);

  // 6. Pick the best `remainingTarget` candidates that aren't already
  //    logged. Sort by preference score (quality days first · "hard with
  //    hard"). When the weekly count is already met this is [].
  candidates.sort((a, b) => b.preferenceScore - a.preferenceScore);
  const unlogged = candidates.filter((c) => !loggedSet.has(c.date));

  // Ensure we don't strand the runner with zero pure rest days. If the
  // only viable picks are rest days AND removing them would leave 0 rest
  // days, drop one rest-day pick to preserve a pure rest day.
  const restDaysInWeek = weekDays.filter(d => d.type === 'rest').length;
  let picked = unlogged.slice(0, remainingTarget).map(c => c.date);
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

  // 6b. 2026-06-10 · Rule 14b · missed-strength roll-forward.
  //     A recommended day that has PASSED unlogged is a miss · advance it
  //     to the next viable slot this week instead of leaving it to surface
  //     as "1 day missed". Only moves WHICH day, never HOW MANY (the
  //     logged-aware count above fixed that). David 2026-06-10.
  picked = rollForwardMissedPicks(picked, candidates, loggedSet, todayISO);

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
      session: sessionFor(intensity),
    };
  });

  return {
    recommendedDays: picked,
    picks,
    reason: buildReason(picked, weekDays, raceContext, loadContext, readinessGate, phaseContext),
    habit, coachIntent,
    _readinessGate: { note: readinessGate.note },
  };
}

// ─── Phase context · Rule 14 ────────────────────────────────────────────

export interface PhaseContext {
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
  // #27 (audit 2026-06-16) · off-season allows 2-3/wk (Research/07 §2.1). This
  // returns the doctrine ceiling of 3, but `target` (recommendStrengthDays)
  // takes Math.min(this, prefs.daysPerWeek, …), and loadPreferences currently
  // returns a fixed 2 because profile.strength_days_per_week doesn't exist yet
  // (see loadPreferences). So the 3 here is INTENTIONALLY INERT until that
  // column is wired — 2 is a valid off-season cap meanwhile. Wire the column in
  // loadPreferences (the single binding lever) to let off-season reach 3.
  if (phaseCtx.mode === 'maintenance') return 3;     // off-season · doctrine ceiling (gated by prefs · #27)
  // Race-prep phase-driven
  if (raceCtx.kind === 'taper_week') return 1;
  const phase = phaseCtx.phaseLabel.toUpperCase();
  if (phase === 'TAPER') return 1;
  if (phase === 'RACE-SPECIFIC') return 1; // peak · maintenance only, drop one
  if (phase === 'QUALITY' || phase === 'BUILD' || phase === 'BASE') return 2;
  return DEFAULT_STRENGTH_DAYS_PER_WEEK;
}

/** Heavy lifts get demoted to maintenance in peak/taper/maintenance/recovery. */
export function shouldDemoteHeavy(phaseCtx: PhaseContext, raceCtx: RaceContext): boolean {
  if (raceCtx.kind === 'race_week') return true;
  // STRENGTH-1 · :113, :166 · the heavy cut-off is 7-10 days out, not the
  // whole 14-day taper window. Day 11-14 keeps its heavy session.
  if (raceCtx.kind === 'taper_week') {
    return raceCtx.daysToRace != null && raceCtx.daysToRace <= LAST_HEAVY_DAYS_BEFORE_RACE;
  }
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

  // #25 (audit 2026-06-16) · anchor the day math to runner-local today
  // (calendar-day basis), matching the SQL window above and this file's TZ
  // discipline. Was using server Date.now() against UTC-midnight DATE values,
  // so the habit bucket + the 14d/21d dormant trigger could flip by ~1 day
  // when the server TZ differs from the runner's. todayMs is runner-local
  // today at UTC-noon (DST-safe); each session date is normalised the same way.
  const todayMs = Date.parse(today + 'T12:00:00Z');
  const dayMsOf = (d: Date) => Date.parse(d.toISOString().slice(0, 10) + 'T12:00:00Z');
  const calDaysSince = (d: Date) => Math.floor((todayMs - dayMsOf(d)) / 86400000);

  // Days since most recent session (calendar days, runner-local).
  const daysSince = calDaysSince(sessions[0].date);

  if (daysSince >= DORMANT_THRESHOLD_DAYS) return 'dormant';
  if (daysSince >= 14) return 'lapsed';

  // Count distinct days (multiple sessions same day = 1 for habit).
  const distinct7 = new Set(sessions.filter(s => calDaysSince(s.date) <= 7)
                                   .map(s => s.date.toISOString().slice(0, 10))).size;
  const distinct14 = new Set(sessions.filter(s => calDaysSince(s.date) <= 14)
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

export interface WeekDay {
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
  // #27 (audit 2026-06-16) · this is the SINGLE binding lever on the weekly
  // strength cap: target = Math.min(daysPerWeek, phaseFrequencyCap, …). The
  // profile.strength_days_per_week column doesn't exist yet, so we return a
  // fixed 2 — which clamps phaseFrequencyCap's off-season 3-branch down to 2
  // (still a valid off-season cap per Research/07 §2.1's 2-3 range). When the
  // column lands, switch to `r?.strength_days_per_week ?? DEFAULT` here and
  // off-season can reach 3. Do NOT raise DEFAULT to 3 globally — that would
  // also bump build/quality weeks (capped at 2 by doctrine).
  return {
    daysPerWeek: DEFAULT_STRENGTH_DAYS_PER_WEEK,
    crossTrainModes: Array.isArray(r?.cross_training_modes) ? r.cross_training_modes : [],
  };
}

export interface RaceContext {
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

/**
 * ── 2026-08-17 · owner ruling · readiness INFORMS, it never mutates ───────
 *
 * This used to be a real gate: a pull-back band deleted every strength
 * session for the week, and a single 3-day pillar streak cut the week from
 * two sessions to one. That is readiness rewriting a prescription, which the
 * owner has ruled out — and on the live evidence it fired constantly, because
 * the band was banding a personally-baselined score on an absolute scale (18
 * pull-back days in 78).
 *
 * What is left is a sentence. `note` is appended to the recommendation copy
 * so the runner still learns that his recovery signals are soft; the number
 * of sessions is decided by the plan, the phase, the runner's own preference
 * and the load rules, exactly as it would be on a day he never opened the
 * Health page.
 *
 * The separate systems keep their own gates: illness, niggles and injury are
 * NOT readiness and are unaffected by this. ACWR (a training-load fact, not a
 * recovery score) keeps its Research/07 cap.
 */
interface ReadinessGate {
  /** Plain-language note for the recommendation copy. Empty when quiet. */
  note: string;
}

/**
 * Read the readiness brief for a note to attach. Best-effort · returns no
 * note on failure, which is also the right answer when we cannot tell.
 */
async function loadReadinessGate(userUuid: string): Promise<ReadinessGate> {
  try {
    const { loadCoachState } = await import('@/lib/coach/state-loader');
    const { loadReadinessBrief } = await import('@/lib/coach/readiness-brief');
    const state = await loadCoachState(userUuid);
    if (!state) return { note: '' };
    const brief = await loadReadinessBrief(userUuid, state);
    if (!brief) return { note: '' };

    const streaks = brief.streaks ?? [];
    if (brief.band === 'pull-back') {
      const streakDesc = streaks.length > 0
        ? ` (${streaks[0].pillar.toUpperCase()} ${streaks[0].direction} ${streaks[0].days}d)`
        : '';
      return {
        note: `Recovery signals are low${streakDesc} · keep the lifting light if it still feels that way on the day.`,
      };
    }
    if (streaks.length >= 1) {
      const s = streaks[0];
      return {
        note: `${s.pillar.toUpperCase()} ${s.direction} for ${s.days} days · worth knowing before the second heavy day.`,
      };
    }
    return { note: '' };
  } catch {
    return { note: '' };
  }
}

async function loadLoadContext(userUuid: string): Promise<LoadContext> {
  // 2026-06-03 · runner TZ anchors the ACWR windows.
  //
  // 2026-08-17 COLD-3 · this was the fourth of five ACWR implementations and
  // the loosest of the three guards: `chronic === 0` alone, so ANY runner with
  // a single logged mile got a ratio. A week-one runner's two legs sum the
  // same runs, so the number it handed the strength cap was the constant 4.00
  // — three times ACWR_HIGH_SPIKE_THRESHOLD — and every new runner's second
  // weekly session was cut on week one, captioned "ACWR 4.0 · high".
  //
  // The cap itself is unchanged and still correct: ACWR is a training-load
  // fact, not a recovery score, so it survives the "readiness informs, never
  // acts" ruling. It just has to be a real measurement first.
  const today = await runnerToday(userUuid);
  const { acwr } = await computeAcwr(userUuid, today);
  return { acwr };
}

/**
 * 2026-06-10 · Rule 14b · dates with a logged strength session this week.
 * Drives the missed-strength roll-forward (a logged day is neither a miss
 * to advance nor a free slot to land on). Same date range loadStrengthWeekStatus
 * reconciles against · one source for "did they lift on this day".
 */
async function loadLoggedStrengthDates(userUuid: string, weekStartISO: string): Promise<Set<string>> {
  const weekEndISO = isoAddDays(weekStartISO, 6);
  const rows = (await pool.query<{ d: string }>(
    `SELECT DISTINCT date::text AS d FROM strength_sessions
      WHERE user_uuid = $1::uuid AND date >= $2::date AND date <= $3::date`,
    [userUuid, weekStartISO, weekEndISO],
  ).catch(() => ({ rows: [] as Array<{ d: string }> }))).rows;
  return new Set(rows.map((r) => r.d));
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
 * Research/07:553-554 · the recovery table splits the two kinds of
 * quality day and the recommender did not:
 *
 *   | Threshold workout | Heavy lifting     | 24 h, or same day with ≥4 h gap |
 *   | VO2 / interval    | Maintenance only  | 24 h                            |
 *
 * STRENGTH-1 (2026-08-17) · `isQuality` was one flag, so an interval
 * session got a heavy lift prescribed on top of it, which is the exact
 * pairing :554 rules out. Threshold and tempo days keep the heavy PM
 * pick; VO2, intervals, fartlek and hill repeats get maintenance only,
 * and score below a threshold day so the picker prefers the threshold
 * slot when the week offers both. :539 is the row that permits the
 * same-day maintenance session at all ("Hard workout day | Light
 * maintenance only on the same day, or none"); the 24 h in :554 is why
 * we never put HEAVY there and why the interval day is not the
 * preferred slot.
 */
export const HEAVY_PAIRABLE_QUALITY_TYPES: ReadonlySet<string> =
  new Set(['threshold', 'tempo']);
export const MAINTENANCE_ONLY_QUALITY_TYPES: ReadonlySet<string> =
  new Set(['intervals', 'vo2max', 'fartlek', 'hills']);

/**
 * 2026-06-03 REWRITE · pair hard with hard per Research/07 doctrine.
 *
 * Scoring (higher = better placement):
 *   · threshold/tempo day · score 10 · heavy strength PM (≥4h · :553)
 *   · easy run day        · score 5  · maintenance, only if not adjacent to hard
 *   · VO2/interval day    · score 4  · MAINTENANCE ONLY (:554)
 *   · recovery run day    · score 3  · maintenance/light only
 *   · rest day            · score 1  · last resort
 *
 * Hard exclusions (score = -100, filtered):
 *   · long-run day (CNS depletion · doctrine §3)
 *   · day immediately BEFORE a quality or long (legs not fresh · §3)
 *   · day immediately AFTER long (recovery sacred · §3)
 *   · race day / shakeout / race-week tune-up
 *
 * Cite: Research/07 §3 (day placement) + Pfitz Advanced Marathoning Appx A
 */
export function pickCandidates(weekDays: WeekDay[]): Candidate[] {
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

    if (day.isQuality && MAINTENANCE_ONLY_QUALITY_TYPES.has(day.type)) {
      // Research/07:554 · "VO2 / interval | Maintenance only | 24 h".
      // Never heavy here, and ranked below a threshold day so the
      // picker takes the threshold slot when the week has one.
      score = 4;
      intensity = 'maintenance';
      timing = 'pm';
      pairedWithRun = true;
    } else if (day.isQuality && HEAVY_PAIRABLE_QUALITY_TYPES.has(day.type)) {
      // PREFERRED · Research/07:553 · threshold + heavy lifting, same
      // day with a ≥4 h gap. Pair heavy strength PM with the AM session.
      score = 10;
      intensity = 'heavy';
      timing = 'pm';
      pairedWithRun = true;
    } else if (day.isQuality) {
      // Quality flagged with a type we don't have a Research/07:553-554
      // row for. Conservative degrade: treat it as the interval row.
      score = 4;
      intensity = 'maintenance';
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

// ─── Missed-strength roll-forward · Rule 14b (2026-06-10) ───────────────

/**
 * Advance a missed recommended day to the next viable slot this week.
 *
 * A picked date that is BEFORE runner-local today with no logged session
 * is a miss. Rather than leave it to surface as "N days missed", move it
 * to the best-scoring candidate that is today-or-later, not already
 * picked, and not already logged. Ties break to the sooner day.
 *
 * Doctrine carries through the destination: the replacement is a regular
 * Candidate, so a heavy quality-day session that slips lands heavy-PM on
 * the next quality day (David's case · Tue tempo → Thu tempo), or drops to
 * maintenance if the only slot left is an easy day. The weekly cap already
 * fixed HOW MANY sessions · this only changes WHICH day, never the count.
 *
 * When no future slot exists (miss on the last viable day of the week),
 * the date is kept so it still surfaces honestly as skipped. Deterministic
 * given (picked, logged, today) · the chip only moves in response to a
 * real miss, so it doesn't jitter day to day.
 *
 * David 2026-06-10: "if a strength session is missed the plan/strength
 * session needs to auto adapt and find the next day · tomorrow after
 * intervals."
 */
function rollForwardMissedPicks(
  picked: string[],
  candidates: Candidate[],
  loggedSet: Set<string>,
  todayISO: string,
): string[] {
  const used = new Set(picked);
  const out: string[] = [];
  // Chronological so an earlier miss claims the earlier replacement slot.
  for (const date of [...picked].sort()) {
    const missed = date < todayISO && !loggedSet.has(date);
    if (!missed) { out.push(date); continue; }
    const replacement = candidates
      .filter((c) => c.date >= todayISO && !used.has(c.date) && !loggedSet.has(c.date))
      .sort((a, b) => b.preferenceScore - a.preferenceScore || (a.date < b.date ? -1 : 1))[0];
    if (replacement) {
      used.delete(date);
      used.add(replacement.date);
      out.push(replacement.date);
    } else {
      out.push(date); // no future slot · keep the miss visible
    }
  }
  return out;
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
  // STRENGTH-1 · only a threshold/tempo day earns the "heavy PM after
  // quality" line. An interval day is a maintenance pick (:554), so
  // describing it as heavy pairing was copy the prescription no longer
  // matched.
  const pairedCount = picked.filter((iso) => {
    const d = weekDays.find((w) => w.date === iso);
    return d != null && d.isQuality && HEAVY_PAIRABLE_QUALITY_TYPES.has(d.type);
  }).length;
  const intervalCount = picked.filter((iso) => {
    const d = weekDays.find((w) => w.date === iso);
    return d != null && d.isQuality && !HEAVY_PAIRABLE_QUALITY_TYPES.has(d.type);
  }).length;
  const easyCount = picked.filter((iso) => {
    const d = weekDays.find((w) => w.date === iso);
    return d && !d.isQuality && (d.type === 'easy' || d.type === 'recovery');
  }).length;

  const reasons: string[] = [];
  if (pairedCount > 0 && easyCount + intervalCount > 0) {
    reasons.push(`${pairedCount} heavy PM after threshold + ${easyCount + intervalCount} maintenance`);
  } else if (pairedCount > 0) {
    reasons.push(`${pairedCount === 1 ? 'PM after threshold' : 'both PM after threshold runs'} · pair hard with hard`);
  } else if (intervalCount > 0) {
    reasons.push(`maintenance only · interval days take no heavy lifting`);
  } else {
    reasons.push(picked.length === 1 ? 'maintenance' : 'both maintenance');
  }

  let suffix = '';
  // Readiness rides along as a note · it no longer changes the count.
  if (readinessGate.note) {
    suffix = ` · ${readinessGate.note}`;
  } else if (phaseCtx.mode === 'recovery') {
    suffix = ' · mobility only · post-race recovery';
  } else if (phaseCtx.mode === 'maintenance') {
    suffix = ' · off-season · heavier loads OK';
  } else if (raceCtx.kind === 'taper_week') {
    // STRENGTH-1 · say which side of the 7-10 day line we are actually
    // on (Research/07:113, :166), instead of asserting the rule while
    // demoting from 14 days out.
    suffix = shouldDemoteHeavy(phaseCtx, raceCtx)
      ? ` · maintenance only · inside the last heavy session, ${LAST_HEAVY_DAYS_BEFORE_RACE} days out`
      : ' · last heavy session · 7-10 days before race';
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
 * Emit a `strength_skip` audit intent when readiness had something to say
 * about this week's strength. Gives the briefing surface a clean trail.
 *
 * 2026-08-17 · owner ruling · this used to record a DECISION the engine had
 * made for the runner: field='suppress' (band=pull-back → strength entirely
 * off) or field='cap_one' (a streak → dropped to one session). Readiness no
 * longer suppresses or caps anything, so the single remaining kind is
 * field='note' and the row records a sentence he was shown. The reason string
 * is unchanged so the existing `strength_resume` loop keeps closing.
 *
 * Idempotent per (user, kind, day) · re-running the recommender same day
 * doesn't double-write.
 */
export async function emitStrengthSkipIntent(
  userUuid: string,
  rec: StrengthRecommendation,
): Promise<void> {
  // 2026-08-17 · readiness no longer suppresses or caps anything, so the
  // row this writes is a NOTE the runner was shown, not a change that was
  // made to his week. Kept because the loop-closing `strength_resume` intent
  // reads it; the `kind` is now always the advisory one.
  const gate = rec._readinessGate;
  if (!gate?.note) return;
  const kind = 'note';

  // 2026-06-03 · runner TZ for idempotency-per-day · was using server UTC.
  const today = await runnerToday(userUuid);
  const skipTz = await runnerTimezone(userUuid).catch(() => 'UTC');
  // Atomic INSERT...SELECT...WHERE NOT EXISTS — idempotent per (user, kind, day).
  await pool.query(
    `INSERT INTO coach_intents (user_id, user_uuid, ts, reason, field, value)
     SELECT $1::uuid, $1::uuid, NOW(), 'strength_skip', $2, $3
     WHERE NOT EXISTS (
       SELECT 1 FROM coach_intents
       WHERE (user_uuid = $1::uuid OR user_id = $1::uuid)
         AND reason = 'strength_skip'
         AND field = $2
         AND (ts AT TIME ZONE $5::text)::date = $4::date
     )`,
    [userUuid, kind, gate.note, today, skipTz],
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
