/**
 * injury-builder · INJURY-mode plan generator.
 *
 * When `runner_injuries.resolved_date IS NULL`, the regular race-prep
 * plan is the wrong scaffold. This generator produces a return-to-run
 * progression: walk-only week → walk-run scaffolds → easy continuous
 * running, per Research/05-injury-return-protocols.md §General-
 * Principles.
 *
 * Invocation: triggered by coach_proposals.proposal_type='injury_adjust'
 * accept (Q-08 path). Caller already authoritatively decided the
 * runner is moving from race-prep into INJURY mode.
 *
 * Plan shape (severity-scaled):
 *   minor    · 2 weeks · walk-run 4:1 → 2:3 → easy 15-20min
 *   moderate · 3 weeks · walk 25min → walk-run 4:1 → 2:3
 *   major    · 4 weeks · walk 20min → walk 30min → walk-run 5:1 → 4:2
 *
 * After the INJURY plan ends, the runner re-enters the regular
 * race-prep flow via /api/plan/generate against their next A race.
 *
 * Cite: Research/05-injury-return-protocols.md §General-Principles
 *       (walk-run scaffold + pain-monitoring rules: in-session,
 *       24-hour, location).
 */
import { pool } from '@/lib/db/pool';
import { randomBytes } from 'crypto';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { loadSettings } from '@/lib/coach/settings';

// 0=Sun..6=Sat · same convention as plan_workouts.dow and generate.ts.
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const dowOf = (k: string): number => {
  const i = DAY_KEYS.indexOf(k as (typeof DAY_KEYS)[number]);
  return i >= 0 ? i : 6; // default Saturday rest (matches DEFAULT_SETTINGS.rest_day)
};

export interface InjuryBuildInput {
  userId: string;
  injuryId: number;
}

export interface InjuryBuildResult {
  ok: boolean;
  plan_id?: string;
  weeks_generated?: number;
  reason?: string;
}

function id(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}

/**
 * #11 · the most-recent training-week start on-or-before `iso`, where the week
 * starts on `weekStartDow` (0=Sun..6=Sat). Mirrors generate.ts and the
 * /api/plan/week convention (weekStartDow = (longRunDow + 1) % 7). For David
 * (long=Sun → start=Mon) this is the most-recent Monday — identical to the old
 * mondayOf, a no-op.
 */
function weekStartBoundaryOf(iso: string, weekStartDow: number): string {
  const dow = new Date(iso + 'T12:00:00Z').getUTCDay(); // 0=Sun..6=Sat
  const shift = -(((dow - weekStartDow) % 7 + 7) % 7);
  return addDays(iso, shift);
}

interface DayShape {
  dow: number; // 0=Sun..6=Sat
  type: string;
  subLabel: string;
  notes: string;
  distance_mi: number;
}

/**
 * 7-day shape for one week of INJURY mode, severity-scaled.
 *
 * #11 (audit 2026-06-16) · honors the runner's preferences instead of a
 * hardcoded Mon-rest / Fri-rest / Wed-cross-train week with a fixed ~5 active
 * days. The walk-run CONTENT (severity-scaled phase prescription) stays
 * protocol-driven per Research/05 §General-Principles; only day PLACEMENT and
 * the active-day COUNT follow prefs:
 *   · restDow            — the runner's chosen rest day (was Mon+Fri hardcoded)
 *   · maxSessions        — cap on walk-run days (profile.weekly_frequency);
 *                          null preserves the legacy ~4-session shape.
 * An injured 3-day runner was being prescribed 5 walk-run sessions, and a
 * Sunday-rest runner was forced onto a Mon/Fri-rest week — both fixed here.
 */
function injuryWeekShape(
  weekIdx: number,
  severity: 'minor' | 'moderate' | 'major',
  restDow: number,
  maxSessions: number | null,
): DayShape[] {
  // Pick this week's prescription based on severity + weekIdx.
  const phase = severity === 'minor'
    ? (weekIdx === 0 ? 'walk-run-4-1' : 'walk-run-2-3')
    : severity === 'moderate'
      ? (weekIdx === 0 ? 'walk-only-25' : weekIdx === 1 ? 'walk-run-4-1' : 'walk-run-2-3')
      : /* major */
        (weekIdx === 0 ? 'walk-only-20' : weekIdx === 1 ? 'walk-only-30'
         : weekIdx === 2 ? 'walk-run-5-1' : 'walk-run-4-2');

  const phaseDetails: Record<string, { subLabel: string; notes: string; durationMin: number }> = {
    'walk-only-20':   { subLabel: 'WALK 20 MIN', durationMin: 20, notes: 'Walk only. Goal: 20 minutes pain-free. Monitor symptoms in-session, 24h post, and site.' },
    'walk-only-25':   { subLabel: 'WALK 25 MIN', durationMin: 25, notes: 'Walk only. Goal: 25 minutes pain-free. Monitor symptoms in-session, 24h post, and site.' },
    'walk-only-30':   { subLabel: 'WALK 30 MIN', durationMin: 30, notes: 'Walk only. Goal: 30 minutes pain-free. Pain check daily before each session.' },
    'walk-run-5-1':   { subLabel: 'WALK-RUN 5:1', durationMin: 25, notes: '5 min walk / 1 min jog × 4-5 reps. Easy jog effort. Pain ≥ 4/10 = stop.' },
    'walk-run-4-2':   { subLabel: 'WALK-RUN 4:2', durationMin: 30, notes: '4 min walk / 2 min jog × 4-5 reps. Pain ≥ 4/10 = stop.' },
    'walk-run-4-1':   { subLabel: 'WALK-RUN 4:1', durationMin: 25, notes: '4 min walk / 1 min jog × 5 reps. Pain ≥ 4/10 = stop.' },
    'walk-run-2-3':   { subLabel: 'WALK-RUN 2:3', durationMin: 25, notes: '2 min walk / 3 min jog × 5 reps. Pain ≥ 4/10 = stop. If 0 pain at end, progress to continuous next week.' },
  };
  const detail = phaseDetails[phase];

  // Walk-run protocol shape: 1 primary rest day (restDow), 1 cross-train day
  // (non-impact aerobic, Research/05), and the rest are active walk-run days
  // capped at the runner's frequency. We always keep ≥1 rest + 1 cross-train
  // (recovery is the work in a return-to-run block); the cap then trims active
  // days down to (frequency) by converting the lowest-priority active days back
  // to rest, never below 1 active day.
  const crossTrainDow = ((restDow + 3) % 7);  // space the non-impact day from rest
  // Candidate active days · everything that's not the rest or cross-train day.
  const activeCandidates: number[] = [];
  for (let dow = 0; dow < 7; dow++) {
    if (dow === restDow || dow === crossTrainDow) continue;
    activeCandidates.push(dow);
  }
  // Cap active walk-run days at the stated frequency (when set). Keep the
  // EARLIEST-in-week candidates so the week front-loads sessions; trailing
  // candidates beyond the cap become rest. Always keep at least 1 active day.
  // NULL frequency → preserve the legacy shape: ~2 rest days total (the chosen
  // rest + one trimmed) + 1 cross-train + the remaining ~4 as walk-run, so a
  // pre-frequency / Strava-only runner's active-day COUNT is unchanged; only
  // the rest day moves to their chosen day (was hardcoded Mon/Fri).
  const activeCount = maxSessions != null
    ? Math.max(1, Math.min(activeCandidates.length, maxSessions))
    : Math.max(1, activeCandidates.length - 1);
  const activeSet = new Set(activeCandidates.slice(0, activeCount));

  const days: DayShape[] = [];
  for (let dow = 0; dow < 7; dow++) {
    if (dow === restDow) {
      days.push({ dow, type: 'rest', subLabel: 'REST', notes: 'Off. Mobility + ice if symptoms warrant.', distance_mi: 0 });
    } else if (dow === crossTrainDow) {
      days.push({ dow, type: 'rest', subLabel: 'CROSS-TRAIN', notes: 'Bike, swim, or pool-run 30-45 min easy. Non-impact aerobic.', distance_mi: 0 });
    } else if (activeSet.has(dow)) {
      days.push({
        dow,
        type: 'easy',
        subLabel: detail.subLabel,
        notes: detail.notes,
        // Approximate the mileage from duration at ~12 min/mi walk-jog pace
        distance_mi: Math.round((detail.durationMin / 12) * 10) / 10,
      });
    } else {
      // Trimmed by the frequency cap → extra rest (rest is the work here).
      days.push({ dow, type: 'rest', subLabel: 'REST', notes: 'Off. Extra recovery — building back carefully.', distance_mi: 0 });
    }
  }
  return days;
}

/**
 * Build an INJURY-mode plan for the runner. Archives any active plan
 * then writes a new training_plans row with mode='injury-return'.
 */
export async function buildInjuryPlan(input: InjuryBuildInput): Promise<InjuryBuildResult> {
  const { userId, injuryId } = input;

  // Load the injury row to determine severity + duration.
  const injury = (await pool.query(
    `SELECT id, site, severity, start_date::text AS start_date, return_protocol
       FROM runner_injuries
      WHERE id = $1 AND user_uuid = $2 AND resolved_date IS NULL`,
    [injuryId, userId],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!injury) return { ok: false, reason: 'injury row not found or already resolved' };

  const severity = (injury.severity ?? 'moderate') as 'minor' | 'moderate' | 'major';
  const totalWeeks = severity === 'minor' ? 2 : severity === 'moderate' ? 3 : 4;

  // #11 (audit 2026-06-16) · honor the runner's layout prefs, same as the race
  // generator (generate.ts) and seed-from-onboarding. Was hardcoded Mon/Fri
  // rest + a fixed ~5-session week.
  //   · rest_day      → which day is REST (loadSettings defaults Saturday).
  //   · long_run_day  → the training-week boundary (week ENDS on it, starts the
  //                     day after), matching /api/plan/week so the injury week
  //                     lands in the WeekStrip window like every other plan.
  //   · weekly_frequency (profile) → caps the walk-run session count so an
  //                     injured 3-day runner isn't handed 5 sessions. NULL
  //                     (David, Strava-only signups, pre-frequency profiles)
  //                     preserves the legacy active-day shape.
  const prefs = await loadSettings(userId).catch(() => null);
  const restDow = dowOf(prefs?.rest_day ?? 'sat');
  const longRunDow = dowOf(prefs?.long_run_day ?? 'sun');
  const weekStartDow = (longRunDow + 1) % 7;  // day after the long run, per /api/plan/week
  const freqRow = (await pool.query<{ f: number | null }>(
    `SELECT weekly_frequency AS f FROM profile WHERE user_uuid = $1 LIMIT 1`,
    [userId],
  ).catch(() => ({ rows: [] as Array<{ f: number | null }> }))).rows[0];
  const maxSessions = freqRow?.f != null && Number(freqRow.f) >= 3 && Number(freqRow.f) <= 7
    ? Number(freqRow.f) : null;

  // Archive any active plan for this user first.
  await pool.query(
    `UPDATE training_plans SET archived_iso = NOW()
      WHERE user_uuid = $1 AND archived_iso IS NULL`,
    [userId],
  ).catch(() => {});

  // Create the new INJURY plan.
  const planId = id('pln');
  const today = await runnerToday(userId);
  // Anchor week 0 at the runner's training-week boundary (day after long-run
  // day), not a hardcoded Monday — same convention as /api/plan/week + #10.
  const startMonday = weekStartBoundaryOf(today, weekStartDow);
  const goalISO = addDays(startMonday, totalWeeks * 7 - 1); // end-of-plan date

  await pool.query(
    `INSERT INTO training_plans (id, user_id, user_uuid, mode, race_id, goal_iso, authored_state)
     VALUES ($1, 'me', $2, 'maintenance', NULL, $3, $4)`,
    [
      planId, userId, goalISO,
      JSON.stringify({
        mode_label: 'injury-return',
        injury_id: injuryId,
        injury_site: injury.site,
        severity,
        protocol: injury.return_protocol ?? null,
        total_weeks: totalWeeks,
        generated_at: new Date().toISOString(),
        citations: ['Research/05-injury-return-protocols.md §General-Principles'],
      }),
    ],
  );

  // Single phase: INJURY_RETURN.
  const phaseId = id('phs');
  await pool.query(
    `INSERT INTO plan_phases (id, plan_id, label, start_week_idx, end_week_idx, rationale, citation)
     VALUES ($1, $2, 'INJURY-RETURN', 0, $3, $4, 'Research/05-injury-return-protocols.md §General-Principles')`,
    [
      phaseId, planId, totalWeeks - 1,
      `Walk-run progression for ${injury.site} (${severity}). Pain ≥ 4/10 stops the session.`,
    ],
  );

  // Generate weeks + workouts.
  for (let wi = 0; wi < totalWeeks; wi++) {
    const weekId = id('wk');
    const weekStart = addDays(startMonday, wi * 7);
    await pool.query(
      `INSERT INTO plan_weeks (id, plan_id, week_idx, week_start_iso, phase_id, is_race_week, rationale)
       VALUES ($1, $2, $3, $4, $5, FALSE, $6)`,
      [weekId, planId, wi, weekStart, phaseId, `INJURY-RETURN · week ${wi + 1} of ${totalWeeks}`],
    );

    const days = injuryWeekShape(wi, severity, restDow, maxSessions);
    for (const d of days) {
      if (d.distance_mi === 0 && d.type !== 'rest') continue;
      const wkoId = id('wko');
      // #11 · date offset is relative to the week's actual start weekday
      // (weekStartDow), not a hardcoded Monday, so each day lands on its true
      // calendar date in the boundary-anchored week (same as generate.ts persist).
      const dateISO = addDays(weekStart, ((d.dow - weekStartDow + 7) % 7));
      await pool.query(
        `INSERT INTO plan_workouts (id, plan_id, week_id, date_iso, dow, type, distance_mi,
                                    is_quality, is_long, notes, sub_label,
                                    original_date_iso, original_type, original_distance_mi)
         VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, FALSE, $8, $9, $4, $6, $7)`,
        [wkoId, planId, weekId, dateISO, d.dow, d.type, d.distance_mi, d.notes, d.subLabel],
      );
    }
  }

  // Plan mutation → invalidate memoized lookup so /today sees the new
  // INJURY plan immediately.
  (await import('./lookup')).bustPlanLookupCache(userId);

  return { ok: true, plan_id: planId, weeks_generated: totalWeeks };
}
