/**
 * lib/coach/acknowledge.ts · close the ask-then-ignore loop.
 *
 * 2026-08-17 · coach-experience pass. The app asks how runs felt
 * (post_run_rpe, check_ins execution/body chips, subjective_checkins)
 * and then never speaks of it again — post_run_rpe was write-only for
 * coaching, check_ins fed only the unrendered voice band, and the
 * canned check-in reply promised "tomorrow's prescription will reflect
 * this" while adapt.ts never read check_ins. Prod data shows the cost:
 * the runner answered check-ins for two weeks, then stopped.
 *
 * This module is the read side of that loop:
 *
 *   · loadYesterdaySignals(userId) — one DB pass gathering everything
 *     the runner told us about yesterday's run: planned type, canonical
 *     miles, post_run_rpe, check-in chips, morning subjective rating.
 *   · classifyEffortRead(signals) — deterministic band: wrecked / hard /
 *     solid / null (no signal).
 *   · composeAcknowledgeSentence(...) — ONE deterministic sentence that
 *     proves the coach heard the answer, keyed on (yesterday category,
 *     effort band, today category). Consumed by the composed morning
 *     brief (lib/coach/morning-brief.ts).
 *   · subjectivePullbackSignal(signals) — the adapter input: a
 *     WRECKED-equivalent read on a PLANNED-EASY day yesterday. Joins
 *     detectReadinessPullback's evidence in lib/plan/adapt.ts
 *     (propose-first, same banner as the objective pillars).
 *
 * Doctrine: Saw et al. 2016 — subjective wellness beats objective
 * markers when they disagree. Same citation chain readiness-brief.ts
 * already uses for its subjective override (composePrescription); this
 * extends that pillar to the day-after adapter read instead of
 * duplicating it.
 *
 * Voice: coach voice per the locked brief — short, direct, no hype,
 * no exclamation marks, no emoji, no em dashes ( · is the joiner).
 * Citations stay in comments, never in payloads.
 */

import { pool } from '@/lib/db/pool';
import { runnerToday, runnerTimezone } from '@/lib/runtime/runner-tz';
import { canonicalMileageByDay } from '@/lib/runs/merge';

/* ────────────────────────── Types ────────────────────────── */

export interface YesterdaySignals {
  yesterdayISO: string;
  /** Canonical miles run yesterday. 0 = no run logged. */
  ranMi: number;
  /** plan_workouts.type for yesterday (run rows only) · null off-plan. */
  plannedType: string | null;
  plannedLabel: string | null;
  /** post_run_rpe.rpe for yesterday's activity (1-10) · null unanswered. */
  rpe: number | null;
  /** check_ins.rating for yesterday's post-run check-in. */
  checkinRating: 'solid' | 'tired' | 'wrecked' | null;
  /** check_ins.extras.execution chip (chatty/pushed/nailed/grinded/...). */
  checkinExecution: string | null;
  /** check_ins.extras.body_state chip. */
  checkinBody: 'fresh' | 'worked' | 'cooked' | null;
  /** subjective_checkins.rating (0-10) captured FOR yesterday. */
  subjectiveRating: number | null;
}

export type EffortReadBand = 'wrecked' | 'hard' | 'solid';

export type WorkoutCategory = 'quality' | 'long' | 'easy' | 'rest' | 'other';

const QUALITY_TYPES = new Set(['threshold', 'tempo', 'intervals', 'vo2max']);
const EASY_TYPES = new Set(['easy', 'recovery', 'shakeout']);

export function categorizeWorkoutType(type: string | null | undefined): WorkoutCategory {
  const t = (type ?? '').toLowerCase();
  if (QUALITY_TYPES.has(t)) return 'quality';
  if (t === 'long') return 'long';
  if (EASY_TYPES.has(t)) return 'easy';
  if (t === 'rest' || t === '' || t === 'unplanned') return 'rest';
  return 'other';
}

/** True when the runner gave ANY subjective read on yesterday. */
export function hasSubjectiveSignal(s: Pick<YesterdaySignals,
  'rpe' | 'checkinRating' | 'checkinBody' | 'checkinExecution' | 'subjectiveRating'>): boolean {
  return s.rpe != null || s.checkinRating != null || s.checkinBody != null
    || s.checkinExecution != null || s.subjectiveRating != null;
}

/**
 * Deterministic effort read from whatever the runner reported.
 * Returns null when there is no subjective signal at all.
 *
 * WRECKED-equivalent (any of): RPE ≥ 8 · rating 'wrecked' · body chip
 * 'cooked' · morning-after subjective ≤ 2/10.
 * HARD (any of): RPE 6-7 · rating 'tired' · a struggling execution chip.
 * SOLID: everything else with a signal present.
 */
export function classifyEffortRead(s: Pick<YesterdaySignals,
  'rpe' | 'checkinRating' | 'checkinBody' | 'checkinExecution' | 'subjectiveRating'>): EffortReadBand | null {
  if (!hasSubjectiveSignal(s)) return null;
  const exec = (s.checkinExecution ?? '').toLowerCase();
  if ((s.rpe != null && s.rpe >= 8)
    || s.checkinRating === 'wrecked'
    || s.checkinBody === 'cooked'
    || (s.subjectiveRating != null && s.subjectiveRating <= 2)) {
    return 'wrecked';
  }
  const STRUGGLE_CHIPS = new Set(['pushed', 'grinded', 'faded', 'missed', 'walled', 'missed_goal']);
  if ((s.rpe != null && s.rpe >= 6)
    || s.checkinRating === 'tired'
    || STRUGGLE_CHIPS.has(exec)) {
    return 'hard';
  }
  return 'solid';
}

/* ──────────────── Acknowledge sentence matrix ──────────────── */

/** Short runner-facing name for yesterday's session. */
function sessionName(cat: WorkoutCategory, plannedLabel: string | null, plannedType: string | null): string {
  if (plannedLabel && plannedLabel.trim() && plannedLabel.length <= 24) {
    return plannedLabel.trim().toLowerCase();
  }
  if (cat === 'quality') return (plannedType ?? 'session').toLowerCase();
  if (cat === 'long') return 'long run';
  if (cat === 'easy') return 'easy day';
  return 'run';
}

export interface AcknowledgeInput {
  yesterdayCategory: WorkoutCategory;
  yesterdayName: string;
  band: EffortReadBand;
  todayCategory: WorkoutCategory;
}

/**
 * ONE sentence acknowledging what the runner told us, woven into
 * today's framing. Pure + deterministic — the full matrix is locked by
 * acknowledge.test.ts. Never re-prescribes: the plan stands, the score
 * informs (no-reactive-coach rule).
 */
export function composeAcknowledgeSentence(a: AcknowledgeInput): string {
  const n = a.yesterdayName;
  if (a.band === 'wrecked') {
    if (a.yesterdayCategory === 'quality') {
      if (a.todayCategory === 'easy') return `You called yesterday's ${n} a grind · today stays truly easy.`;
      if (a.todayCategory === 'quality') return `Yesterday's ${n} took more than it should · be honest with the first reps today.`;
      if (a.todayCategory === 'long') return `Yesterday's ${n} left a mark · keep the long run's early miles quiet.`;
      return `Yesterday's ${n} emptied the tank · today gives it back.`;
    }
    if (a.yesterdayCategory === 'long') {
      if (a.todayCategory === 'easy' || a.todayCategory === 'rest') {
        return `The long run took real work · today is about absorbing it, nothing more.`;
      }
      return `The long run emptied the tank · respect that in today's session.`;
    }
    if (a.yesterdayCategory === 'easy') {
      // WAS: "· an easy day should not do that, and it feeds this morning's
      // call." The middle clause corrects the runner for how the day went,
      // which is not something they chose. State it and move.
      return `You called yesterday's easy day a beatdown. That feeds this morning's call.`;
    }
    return `Yesterday read harder than it should have · noted for today's call.`;
  }
  if (a.band === 'hard') {
    if (a.yesterdayCategory === 'quality') {
      if (a.todayCategory === 'easy' || a.todayCategory === 'rest') {
        return `Yesterday's ${n} cost something · today's easy miles pay it back.`;
      }
      return `Yesterday's ${n} was work · hold today's targets, not more.`;
    }
    if (a.yesterdayCategory === 'long') return `The long run is still in the legs today.`;
    if (a.yesterdayCategory === 'easy') return `Yesterday's easy ran a touch heavy · worth keeping today honest.`;
    return `Yesterday was work · today runs off that.`;
  }
  // solid
  if (a.yesterdayCategory === 'quality') return `Yesterday's ${n} landed and you came out clean.`;
  if (a.yesterdayCategory === 'long') return `Long run banked and the body took it well.`;
  if (a.yesterdayCategory === 'easy') return `Yesterday's easy stayed easy.`;
  return `Yesterday went in the book clean.`;
}

/**
 * Convenience wrapper · signals + today's planned type → sentence or
 * null (no run and no subjective signal = nothing to acknowledge).
 */
export function acknowledgeSentenceFor(
  s: YesterdaySignals,
  todayPlannedType: string | null,
): string | null {
  const band = classifyEffortRead(s);
  if (band == null) return null;
  if (s.ranMi <= 0.3 && s.checkinRating == null && s.rpe == null) return null;
  const yCat = categorizeWorkoutType(s.plannedType);
  return composeAcknowledgeSentence({
    yesterdayCategory: yCat,
    yesterdayName: sessionName(yCat, s.plannedLabel, s.plannedType),
    band,
    todayCategory: categorizeWorkoutType(todayPlannedType),
  });
}

/* ──────────────── Adapter input (Saw et al. pillar) ──────────────── */

export interface SubjectivePullback {
  fired: boolean;
  /** Plain-English fragment for the trigger reason · null when not fired. */
  reason: string | null;
  detail: { rpe: number | null; checkinRating: string | null; checkinBody: string | null } | null;
}

/**
 * The subjective pillar for detectReadinessPullback: a WRECKED-
 * equivalent POST-RUN read (RPE ≥ 8, rating 'wrecked', or body chip
 * 'cooked') on a day that was PLANNED EASY and actually run. An easy
 * day that wrecks the runner is exactly the "subjective beats
 * objective" disagreement Saw et al. describe — the objective pillars
 * may lag a day behind what the runner already knows.
 *
 * Deliberately narrow: quality and long days are ALLOWED to read hard
 * (that is the training), and a skipped day has no execution to read.
 * Morning subjective_checkins ratings stay with the readiness brief's
 * own override — this pillar is post-run evidence only.
 */
export function subjectivePullbackSignal(s: YesterdaySignals): SubjectivePullback {
  const plannedEasy = categorizeWorkoutType(s.plannedType) === 'easy';
  const ran = s.ranMi > 0.3;
  const wreckedPostRun = (s.rpe != null && s.rpe >= 8)
    || s.checkinRating === 'wrecked'
    || s.checkinBody === 'cooked';
  if (!plannedEasy || !ran || !wreckedPostRun) {
    return { fired: false, reason: null, detail: null };
  }
  const what = s.rpe != null && s.rpe >= 8
    ? `RPE ${s.rpe}`
    : s.checkinBody === 'cooked' ? 'body cooked' : 'WRECKED';
  return {
    fired: true,
    reason: `you called yesterday's easy day ${what} · easy days should not cost that`,
    detail: { rpe: s.rpe, checkinRating: s.checkinRating, checkinBody: s.checkinBody },
  };
}

/* ────────────────────────── DB loader ────────────────────────── */

/**
 * One pass over everything the runner told us about yesterday.
 * Best-effort per source — a missing table degrades that field to null
 * rather than failing the load (same posture as state-loader).
 */
export async function loadYesterdaySignals(
  userId: string,
  todayISO?: string,
): Promise<YesterdaySignals> {
  const today = todayISO ?? await runnerToday(userId);
  const yesterdayISO = new Date(Date.parse(today + 'T12:00:00Z') - 86400000)
    .toISOString().slice(0, 10);

  // Planned row for yesterday (run rows only · strength never shadows).
  const planRow = (await pool.query<{ type: string; sub_label: string | null }>(
    `SELECT pw.type, pw.sub_label
       FROM plan_workouts pw
       JOIN training_plans tp ON tp.id = pw.plan_id
      WHERE tp.user_uuid = $1 AND tp.archived_iso IS NULL
        AND pw.date_iso = $2 AND pw.type <> 'strength'
      LIMIT 1`,
    [userId, yesterdayISO],
  ).catch(() => ({ rows: [] as Array<{ type: string; sub_label: string | null }> }))).rows[0];

  // Canonical miles + run ids for yesterday.
  let ranMi = 0;
  let runIds: string[] = [];
  try {
    const byDay = await canonicalMileageByDay(userId, yesterdayISO, yesterdayISO);
    const info = byDay.get(yesterdayISO);
    if (info) {
      ranMi = Math.round(info.mi * 10) / 10;
      runIds = info.canonicalIds;
    }
  } catch { /* no runs table signal · ranMi stays 0 */ }

  // post_run_rpe keys on the activity id the client saw — which can be
  // the runs row id OR the source activity id (runs.data->>'id').
  let rpe: number | null = null;
  if (runIds.length > 0) {
    try {
      const idRows = (await pool.query<{ row_id: string; src_id: string | null }>(
        `SELECT id::text AS row_id, data->>'id' AS src_id
           FROM runs WHERE id::text = ANY($1::text[])`,
        [runIds],
      )).rows;
      const allIds = [
        ...idRows.map((r) => r.row_id),
        ...idRows.map((r) => r.src_id).filter((x): x is string => !!x),
      ];
      if (allIds.length > 0) {
        const r = (await pool.query<{ rpe: number | null }>(
          `SELECT rpe FROM post_run_rpe
            WHERE (user_uuid = $1 OR user_id::text = $1::text)
              AND activity_id = ANY($2::text[])
              AND rpe IS NOT NULL
            ORDER BY logged_at DESC LIMIT 1`,
          [userId, allIds],
        )).rows[0];
        rpe = r?.rpe != null ? Number(r.rpe) : null;
      }
    } catch { /* table absent · rpe stays null */ }
  }

  // Post-run check-in filed on yesterday, RUNNER-timezone day bucketing
  // (a 6pm Pacific check-in is 01:00 UTC next day · ts::date would
  // mis-shift it; same trap as reference_pg_timestamp_tz_parsing).
  let checkinRating: YesterdaySignals['checkinRating'] = null;
  let checkinExecution: string | null = null;
  let checkinBody: YesterdaySignals['checkinBody'] = null;
  try {
    const tz = await runnerTimezone(userId);
    const c = (await pool.query<{ rating: string; extras: Record<string, unknown> | null }>(
      `SELECT rating, extras FROM check_ins
        WHERE COALESCE(user_uuid, user_id) = $1
          AND ts >= NOW() - interval '3 days'
          AND to_char(ts AT TIME ZONE $3, 'YYYY-MM-DD') = $2
          AND COALESCE(extras->>'kind', 'post_run') = 'post_run'
        ORDER BY ts DESC LIMIT 1`,
      [userId, yesterdayISO, tz],
    )).rows[0];
    if (c) {
      const rating = String(c.rating);
      checkinRating = (rating === 'solid' || rating === 'tired' || rating === 'wrecked') ? rating : null;
      const ex = (c.extras ?? {}) as Record<string, unknown>;
      checkinExecution = typeof ex.execution === 'string' ? ex.execution : null;
      const bodyState = typeof ex.body_state === 'string' ? ex.body_state : null;
      checkinBody = (bodyState === 'fresh' || bodyState === 'worked' || bodyState === 'cooked') ? bodyState : null;
    }
  } catch { /* table absent · check-in fields stay null */ }

  // Morning subjective capture keyed on yesterday's DATE.
  let subjectiveRating: number | null = null;
  try {
    const s = (await pool.query<{ rating: number }>(
      `SELECT rating FROM subjective_checkins
        WHERE user_uuid = $1::uuid AND date = $2::date LIMIT 1`,
      [userId, yesterdayISO],
    )).rows[0];
    subjectiveRating = s?.rating != null ? Number(s.rating) : null;
  } catch { /* table absent */ }

  return {
    yesterdayISO,
    ranMi,
    plannedType: planRow?.type ?? null,
    plannedLabel: planRow?.sub_label ?? null,
    rpe,
    checkinRating,
    checkinExecution,
    checkinBody,
    subjectiveRating,
  };
}
