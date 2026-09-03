/**
 * lib/plan/dose-guard.ts · DOCTRINE-DOSING-2 (2026-08-18) · Daniels' dosing
 * caps on the WRITE path, not just the authoring path.
 *
 * ── Why this file exists ───────────────────────────────────────────────────
 *
 * `validateComposedPlan` gates plan AUTHORING: every path that composes a plan
 * — `generatePlan`, the auto-rebuild, the simulator — runs it, and a week over
 * a cap cannot be written. That covers everything the generator makes.
 *
 * It does not cover `lib/plan/adapt.ts`. The adaptation layer edits rows that
 * are already in the database, with raw SQL and no composer in sight, and two
 * of its actions change how much of a week is run at quality pace:
 *
 *   · `field_test` — `UPDATE plan_workouts SET type='tempo', is_quality=true,
 *     distance_mi=…` on an existing quality day, converting it into a
 *     thirty-minute threshold time trial (Research/01 §Field-Test protocol 2).
 *     Thirty minutes at T is four to five miles. On a 30 mi/wk runner that is
 *     15% of the week at threshold, in a week that already has a T session.
 *   · `reshape` — the progression gate's dose rewrite. `advanceShape` bounds it
 *     by `atPaceSessionCapMi`, which is one SESSION's share; nothing looked at
 *     what the rest of the week was already spending.
 *
 * A cap enforced only where plans are born, that any later adaptation may
 * breach, is not a gate. This is the same doctrine, applied where the write
 * actually happens.
 *
 * ── How it measures ────────────────────────────────────────────────────────
 *
 * It reads the whole TRAINING WEEK the row sits in — which ends on the runner's
 * `long_run_day` and starts the day after, the boundary locked 2026-06-16 and
 * shared with `/api/plan/week` — substitutes the proposed row, and runs
 * `weekDosingFindings` over the result. Same function the composer's gate runs,
 * over the same `IntensityDay` shape, so a row that would be legal if the
 * generator had authored it is legal here too, and the two can never drift.
 *
 * ── What it does on a breach ───────────────────────────────────────────────
 *
 * Returns the findings. It does NOT write, and it does not throw: the caller is
 * inside a transaction applying a batch of adaptations, and one refused dose
 * change must not roll back a reschedule or an injury downgrade that has
 * nothing to do with it. Skipping the write leaves the runner on the session
 * the plan already validated, which is by construction inside doctrine.
 */
import { pool } from '@/lib/db/pool';
import { logReadFailure } from '@/lib/db/read';
import { trainingWeekWindow } from '@/lib/notifications/week-window';
import { weekDosingFindings, type DosingFinding, type DosingWeek } from './dosing';
import type { IntensityDay } from './intensity-distribution';
import { weekContainsRace } from './race-week';

/** `user_settings.long_run_day` shortcodes → 0=Sun..6=Sat. */
const DOW_OF: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

/** The proposed post-write shape of one row. Only what dosing reads. */
export interface ProposedRow {
  workoutId: string;
  type: string;
  distanceMi: number;
  subLabel: string | null;
  /**
   * The at-pace mileage the caller KNOWS this row will carry, when the label it
   * is about to write does not state it.
   *
   * `splitDay` re-derives a day's hard miles from (type, distance,
   * prescription), which is right for every row the composer authors because
   * the composer's labels state their own dose. The field test does not: it
   * writes `sub_label = 'FIELD TEST'` and puts the thirty minutes in the SPEC,
   * so re-deriving from the label would measure the generic tempo default
   * instead of the workout. The caller passes the number it just computed.
   */
  atPaceMi?: number;
}

interface WeekRow {
  id: string;
  type: string;
  distance_mi: string | null;
  sub_label: string | null;
  is_long: boolean | null;
}

/**
 * Would writing `proposed` push its training week outside Daniels' dosing caps?
 *
 * Returns the ENFORCED findings only — the absolute ceilings in any week, the
 * percentage caps on training weeks. A taper or race week is deliberately not
 * held to the percentages (Research/08 §9.1 and §9.2; see `capEnforced`), which
 * matters here more than anywhere: the field test and the race-week tune-up
 * both live in exactly those weeks.
 *
 * An empty array means the write is inside doctrine. A DB failure also returns
 * empty — this guard may refuse a write it can prove is wrong, and must never
 * refuse one it merely failed to read. The plan it is guarding was validated at
 * authoring time, so the pre-existing state is known-good; the risk of a false
 * refusal (a repair the runner needs silently not applied) is worse than the
 * risk of a missed check that `validateComposedPlan` catches on the next
 * rebuild.
 */
export async function dosingBreachIfWritten(
  client: { query: typeof pool.query },
  userId: string,
  proposed: ProposedRow,
): Promise<DosingFinding[]> {
  try {
    // The phase lives on `plan_phases`, reached through the row's week — it is
    // what decides whether the PERCENTAGE caps govern this week at all, so it
    // is read rather than guessed. `is_race_week` comes from the same join for
    // the same reason.
    const meta = (await client.query<{
      date_iso: string; plan_id: string; long_run_day: string | null;
      phase: string | null; is_race_week: boolean | null;
    }>(
      // 2026-08-24 · swallowed-failure sweep · this joined `user_settings`,
      // which does not exist in production — the long-run day lives on
      // `users.long_run_day` (the settings table was folded in). Postgres
      // answered `relation "user_settings" does not exist` on EVERY call, the
      // `catch` at the bottom of this function returned `[]`, and so the
      // dosing detector has reported zero breaches for every write it has ever
      // guarded. Nothing about "no findings" looked wrong.
      `SELECT pw.date_iso::text AS date_iso,
              pw.plan_id,
              u.long_run_day,
              ph.label AS phase,
              w.is_race_week
         FROM plan_workouts pw
         JOIN training_plans tp ON tp.id = pw.plan_id
         LEFT JOIN plan_weeks  w  ON w.id = pw.week_id
         LEFT JOIN plan_phases ph ON ph.id = w.phase_id
         LEFT JOIN users u ON u.id = tp.user_uuid
        WHERE pw.id = $1 AND tp.user_uuid = $2::uuid AND tp.archived_iso IS NULL
        LIMIT 1`,
      [proposed.workoutId, userId],
    )).rows[0];
    if (!meta) return [];

    const longRunDow = DOW_OF[String(meta.long_run_day ?? 'sun')] ?? 0;
    const dow = new Date(meta.date_iso + 'T12:00:00Z').getUTCDay();
    const { week_start_iso, week_end_iso } = trainingWeekWindow(meta.date_iso, dow, longRunDow);

    const rows = (await client.query<WeekRow>(
      `SELECT id, type, distance_mi::text, sub_label, is_long
         FROM plan_workouts
        WHERE plan_id = $1
          AND date_iso::date BETWEEN $2::date AND $3::date`,
      [meta.plan_id, week_start_iso, week_end_iso],
    )).rows;
    if (rows.length === 0) return [];

    // When the caller states the dose, hand `splitDay` a label that measures to
    // exactly it. A continuous-tempo prescription is the one shape whose whole
    // hard segment is stated by its leading number, so "4.3mi continuous tempo"
    // measures 4.3 miles at T whatever else the day carries. This is a
    // MEASUREMENT stand-in and is never written anywhere — the row keeps the
    // label its own writer chose.
    const proposedLabel = proposed.atPaceMi != null && proposed.atPaceMi > 0
      ? `${Number(proposed.atPaceMi.toFixed(1))}mi continuous tempo`
      : proposed.subLabel;

    const days: IntensityDay[] = rows.map((r) => (
      r.id === proposed.workoutId
        ? {
            type: proposed.type,
            distanceMi: proposed.distanceMi,
            subLabel: proposedLabel,
            // A field test and a reshape both target a NON-long quality day;
            // neither can turn a row into the week's long run. Carrying the
            // stored flag rather than inventing one keeps a long run that the
            // proposal happens to touch classified as it already is.
            isLong: Boolean(r.is_long),
          }
        : {
            type: r.type,
            distanceMi: r.distance_mi != null ? Number(r.distance_mi) : 0,
            subLabel: r.sub_label,
            isLong: Boolean(r.is_long),
          }
    ));

    const week: DosingWeek = {
      startISO: week_start_iso,
      phase: meta.phase ?? undefined,
      days,
      // RACEWEEK-2 (2026-09-03) · `weekContainsRace` (race-week.ts), not a
      // second inline copy of the same predicate (Rule 16) — the stored
      // `is_race_week` column alone would miss a B/C tune-up, which
      // `weekDose` needs to know about for the same reason it takes the race
      // out of both sides of the ratio: its own header states the argument
      // applies to any week whose largest number is a race, goal or not.
      isRaceWeek: weekContainsRace({ isRaceWeek: meta.is_race_week, days: rows }),
    };

    return weekDosingFindings(week).filter((f) => f.enforced);
  } catch (e) {
    // "No breach" and "could not check for a breach" are the same value to
    // every caller of this function, and that is exactly how a dead join hid
    // here for the detector's whole life. It stays `[]` — a dosing guard must
    // not block a write it failed to evaluate — but it is never silent again.
    logReadFailure('plan/dose-guard · dosingBreachIfWritten', e);
    return [];
  }
}
