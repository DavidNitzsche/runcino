/**
 * lib/race/race-role-apply.ts · the ACCEPT side of the race-role card.
 *
 * The nightly cron writes a pending `race_role` proposal (the gate); this
 * module is what runs when the RUNNER taps accept on it. Two writes, in this
 * order:
 *
 *   1 · persist the answered role on the race row: `meta.plannedRole`,
 *       written with `jsonb_set` (Rule 6 · field-level, never a full-meta
 *       replace — the races jsonb has multiple writers with different field
 *       coverage). This is what makes the answer survive a rebuild:
 *       `embedMidBlockRaces` reads it and shapes the race week accordingly
 *       on every later authoring.
 *
 *   2 · patch the CURRENT plan's rows through `mutatePlan` so the answer
 *       takes effect immediately, without waiting for (or forcing) a
 *       rebuild. The patch per role:
 *
 *       b_effort / race · soften the race week's remaining midweek quality
 *       to a short sharpener (the authored mini-taper only covers the two
 *       running days before the race; a wave tempo four days out survives
 *       it), and keep the following window quality-free per Research/00b:
 *       role 'b_effort' takes the B scale ("expect 7–10 days of recovery
 *       rather than 14" → 7 for a half), role 'race' takes the A-effort
 *       table floor (10 for a half) — recovery follows EFFORT GIVEN, not
 *       the calendar letter. Windows: ROLE_POST_QUALITY_FREE_DAYS.
 *
 *       mp_workout · race day becomes the week's MP long: the row keeps its
 *       race marker (type stays 'race' — the runner is still at a race) but
 *       the prescription is MP-workout shaped (is_long, MP pace target from
 *       the plan's own goal pace, MP notes), the week's separate long run
 *       stands down, and the day after eases (hard-day spacing, not a race
 *       recovery window).
 *
 * NOT in the automatic-mutation registry: every write here is runner-
 * initiated (the accept tap), reached only from POST /api/plan/proposal —
 * which is on that gate's RUNNER_INITIATED list. The cron's own write is the
 * proposal row, already declared under `cron/plan-drift`.
 *
 * Sealed-day safety: every UPDATE is bounded `date_iso > $today` (the past is
 * history) and the race-day row itself at `>= $today`; `mutatePlan` snapshots
 * and differentially validates the whole plan around the batch.
 */

import { pool } from '@/lib/db/pool';
import { mutatePlan } from '@/lib/plan/mutate';
import { preserveProgressionSql } from '@/lib/plan/progression-spec';
import { runnerToday } from '@/lib/runtime/runner-tz';
import {
  ROLE_POST_QUALITY_FREE_DAYS,
  isRaceRole,
  type RaceRole,
  type TuneUpCategory,
} from './race-role';

function addDays(iso: string, n: number): string {
  return new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000)
    .toISOString()
    .slice(0, 10);
}

export interface ApplyRaceRoleResult {
  ok: boolean;
  outcome: string;
  /** plan_workouts rows the patch changed (0 when the week needed nothing). */
  changedRows: number;
  reason?: string;
}

export async function applyRaceRole(opts: {
  userId: string;
  raceSlug: string;
  role: RaceRole | string;
  /** Distance category recorded on the proposal · sizes the recovery window. */
  category: TuneUpCategory | string;
}): Promise<ApplyRaceRoleResult> {
  const { userId, raceSlug } = opts;
  if (!isRaceRole(opts.role)) {
    return { ok: false, outcome: 'invalid_role', changedRows: 0, reason: String(opts.role) };
  }
  const role: RaceRole = opts.role;

  // The race row · date + name drive the patch window and the notes.
  const race = (await pool.query<{ slug: string; date: string | null; name: string | null }>(
    `SELECT slug, meta->>'date' AS date, meta->>'name' AS name
       FROM races WHERE user_uuid = $1 AND slug = $2`,
    [userId, raceSlug],
  )).rows[0];
  if (!race?.date) {
    return { ok: false, outcome: 'race_missing', changedRows: 0 };
  }
  const raceDate = race.date.slice(0, 10);
  const raceName = race.name ?? raceSlug;

  // 1 · persist the answered role, field-level (Rule 6).
  await pool.query(
    `UPDATE races
        SET meta = jsonb_set(meta, '{plannedRole}', to_jsonb($3::text))
      WHERE user_uuid = $1 AND slug = $2`,
    [userId, raceSlug, role],
  );

  // 2 · patch the active plan through the mutation boundary.
  const plan = (await pool.query<{ id: string; authored_state: Record<string, unknown> | null }>(
    `SELECT id, authored_state FROM training_plans
      WHERE user_uuid = $1 AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [userId],
  )).rows[0];
  if (!plan) {
    // The role is persisted; the next authoring reads it. Nothing to patch.
    return { ok: true, outcome: 'role_persisted_no_active_plan', changedRows: 0 };
  }

  const todayISO = await runnerToday(userId).catch(() => new Date().toISOString().slice(0, 10));
  const cat: TuneUpCategory = opts.category === '10k' || opts.category === '5k' ? opts.category : 'hm';

  const boundary = await mutatePlan<number>({
    // AUTHORITY (2026-09-05) · stamps the role the runner already chose for a race
    authority: 'LIFECYCLE',
    userUuid: userId,
    source: 'api/plan/proposal · race_role accept',
    todayISO,
    planId: plan.id,
    touches: 'structural',
    detail: { race_slug: raceSlug, role },
    apply: async (tx) => {
      let changed = 0;
      const count = (r: { rowCount: number | null }) => { changed += r.rowCount ?? 0; };

      if (role === 'b_effort' || role === 'race') {
        // Remaining midweek quality inside the race week (3-6 days out ·
        // the authored mini-taper owns the last two running days) eases to a
        // sharpener. Coherent downgrade shape per adapt.ts: type is source of
        // truth, spec rewritten, trailing fields cleared.
        count(await tx.query(
          `UPDATE plan_workouts
              SET original_type = COALESCE(original_type, type),
                  original_sub_label = COALESCE(original_sub_label, sub_label),
                  type = 'easy',
                  distance_mi = LEAST(distance_mi, 5),
                  is_quality = false,
                  sub_label = 'SHARPENER · 4×20s strides',
                  notes = $4,
                  pace_target_s_per_mi = NULL,
                  workout_spec = ${preserveProgressionSql(`'{"kind":"easy"}'`)}
            WHERE plan_id = $1
              AND date_iso >= $2 AND date_iso < $3
              AND date_iso > $5
              AND is_quality = true AND COALESCE(is_long, false) = false
              AND type NOT IN ('race', 'rest', 'shakeout')`,
          [
            plan.id, addDays(raceDate, -6), raceDate,
            `Short with strides. ${raceName} is this week's work, nothing hard before it.`,
            todayISO,
          ],
        ));

        // The post-race window keeps quality-free per 00b's effort scale.
        const windowDays = ROLE_POST_QUALITY_FREE_DAYS[cat][role];
        count(await tx.query(
          `UPDATE plan_workouts
              SET original_type = COALESCE(original_type, type),
                  original_sub_label = COALESCE(original_sub_label, sub_label),
                  type = 'easy',
                  distance_mi = LEAST(distance_mi, CASE WHEN COALESCE(is_long, false) THEN 6 ELSE 5 END),
                  is_quality = false,
                  is_long = false,
                  sub_label = 'EASY',
                  notes = $4,
                  pace_target_s_per_mi = NULL,
                  workout_spec = ${preserveProgressionSql(`'{"kind":"easy"}'`)}
            WHERE plan_id = $1
              AND date_iso > $2 AND date_iso <= $3
              AND date_iso > $5
              AND (is_quality = true OR ($6 AND COALESCE(is_long, false) = true))
              AND type NOT IN ('race', 'rest')`,
          [
            plan.id, raceDate, addDays(raceDate, windowDays),
            role === 'race'
              ? `Post-race recovery after ${raceName}. You raced it honestly, so quality waits the full window.`
              : `Post-race recovery after ${raceName}. B effort still costs days. Easy only until quality resumes.`,
            todayISO,
            // A raced half stands the long down inside its window; a short
            // tune-up's window is too short to reach the long anyway.
            cat === 'hm',
          ],
        ));

        // The race day itself carries the answered framing.
        count(await tx.query(
          `UPDATE plan_workouts
              SET sub_label = $3, notes = $4
            WHERE plan_id = $1 AND date_iso = $2 AND date_iso >= $5
              AND type = 'race'`,
          [
            plan.id, raceDate,
            role === 'race' ? 'RACE' : 'RACE · B EFFORT',
            role === 'race'
              ? `${raceName}. Race it honestly. Full effort, full recovery after.`
              : `${raceName}. B effort. Hard, not all out. It feeds your goal pacing and leaves the build intact.`,
            todayISO,
          ],
        ));
      } else {
        // mp_workout · the race day becomes the week's MP long. The row
        // keeps the race marker; the prescription is MP-workout shaped.
        const authored = plan.authored_state ?? {};
        const goalPaceRaw = authored['goal_pace_s_per_mi'];
        const mpPace = typeof goalPaceRaw === 'number' && Number.isFinite(goalPaceRaw)
          ? Math.round(goalPaceRaw)
          : null;
        count(await tx.query(
          `UPDATE plan_workouts
              SET is_long = true,
                  is_quality = true,
                  sub_label = 'RACE · MP LONG',
                  notes = $3,
                  pace_target_s_per_mi = $4
            WHERE plan_id = $1 AND date_iso = $2 AND date_iso >= $5
              AND type = 'race'`,
          [
            plan.id, raceDate,
            `${raceName}. Run it as the marathon pace long, not a race. Warm up, then marathon pace to the line. Hard day, not a peak effort.`,
            mpPace,
            todayISO,
          ],
        ));
        // The week's separate long stands down · the race is the long now.
        count(await tx.query(
          `UPDATE plan_workouts
              SET original_type = COALESCE(original_type, type),
                  original_sub_label = COALESCE(original_sub_label, sub_label),
                  type = 'easy',
                  distance_mi = LEAST(distance_mi, 6),
                  is_quality = false,
                  is_long = false,
                  sub_label = 'EASY',
                  notes = $4,
                  pace_target_s_per_mi = NULL,
                  workout_spec = ${preserveProgressionSql(`'{"kind":"easy"}'`)}
            WHERE plan_id = $1
              AND date_iso >= $2 AND date_iso <= $3
              AND date_iso > $5
              AND COALESCE(is_long, false) = true
              AND type <> 'race'`,
          [plan.id, addDays(raceDate, -3), addDays(raceDate, 3),
           `Easy. ${raceName} is this week's long run.`, todayISO],
        ));
        // Hard-day spacing, not a race-recovery window: the day after eases.
        count(await tx.query(
          `UPDATE plan_workouts
              SET original_type = COALESCE(original_type, type),
                  original_sub_label = COALESCE(original_sub_label, sub_label),
                  type = 'easy',
                  distance_mi = LEAST(distance_mi, 5),
                  is_quality = false,
                  sub_label = 'EASY',
                  notes = $3,
                  pace_target_s_per_mi = NULL,
                  workout_spec = ${preserveProgressionSql(`'{"kind":"easy"}'`)}
            WHERE plan_id = $1 AND date_iso = $2 AND date_iso > $4
              AND is_quality = true AND COALESCE(is_long, false) = false
              AND type NOT IN ('race', 'rest')`,
          [plan.id, addDays(raceDate, 1),
           `Easy the day after the ${raceName} MP long.`, todayISO],
        ));
      }
      return changed;
    },
  });

  if (!boundary.ok) {
    // The role stays persisted (it is the runner's answer and the next
    // rebuild honors it); the immediate patch was refused by the boundary.
    return {
      ok: false,
      outcome: `patch_${boundary.outcome}`,
      changedRows: 0,
      reason: boundary.violations.join(' · ') || boundary.outcome,
    };
  }
  return { ok: true, outcome: 'applied', changedRows: boundary.value ?? 0 };
}
