/**
 * glance-state.ts — fast read for page shell.
 *
 * Returns ONLY the fields needed to render the surface without the LLM:
 *   - today's date / phase / week stats
 *   - sleep / RHR / HRV / cadence baselines
 *   - readiness (computed from those inputs; no LLM)
 *   - next workout (for UP NEXT card placeholder while briefing loads)
 *
 * Cheap pg queries only — no Anthropic call. Page renders in ~200ms.
 */
import { distanceMiOfMeta } from '@/lib/race/distance';
import { pool } from '@/lib/db/pool';
import { loadSafetyInputs } from '@/lib/safety/load-safety';
import { classifySafety, type SafetyResolution } from '@/lib/safety/safety-verdict';
import { computeReadiness, type ReadinessBreakdown } from './readiness';
import { loadReadinessBandBaseline } from './readiness-history';
import { loadNextARace } from './race-lookup';
import { canonicalMileageByDay } from '@/lib/runs/merge';
import { computeAcwr } from './acwr';
import { runCadenceSpmSql } from '@/lib/runs/run-shape';
import { loadActivePlan } from '@/lib/plan/lookup';
import { runnerToday, runnerTimezone, runnerTimezoneOrPacific } from '@/lib/runtime/runner-tz';
import { loadSettings } from '@/lib/coach/settings';
import { weekWindowFor } from '@/lib/coach/week-window';
import type { WorkoutSpec } from '@/lib/faff/types';
import { fellShortShare, resolveWorkoutVerdict } from '@/lib/execution/verdict';
import { resolvePrescribedPaceAnchors } from '@/lib/training/load-prescription-anchors';
import type { PaceAnchorRead } from '@/lib/training/prescription-resolver';
import { roundTo } from '@/lib/format/run';

export interface GlanceWeekDay {
  date: string;            // ISO YYYY-MM-DD
  dow: number;             // 0 Sun … 6 Sat
  // Plan side
  /** 2026-06-01 · plan_workouts.id for this row · null on off-plan days.
   *  Required for POST /api/plan/restore (commit d8a4082d) so the
   *  frontend's "Restore original" button can identify the row.
   *  Optional on the type so legacy fixtures (personas, WeekAhead
   *  tests) compile without backfill. */
  plannedId?: string | null;
  plannedMi: number;
  plannedType: string;     // 'easy' | 'rest' | 'long' | 'threshold' | etc.
  plannedLabel: string | null;
  /** Structured per-workout spec (migration 120). null when the plan-builder
   *  authored this row without a VDOT, OR when the workout type has no
   *  structured spec (rest/race/shakeout). Downstream renderers fall back
   *  to the existing label-only render in that case. */
  plannedSpec: WorkoutSpec | null;
  // Actual (strava)
  doneMi: number;
  activityId: string | null;   // → click navigates to /runs/[id]
  // Flags
  isToday: boolean;
  isPast: boolean;
  /** 2026-06-01 · adaptation envelope · web agent brief
   *  adaptation-visibility-backend-brief.md. wasAdapted=true means
   *  THIS specific row was mutated by the auto-adapter (downgrade /
   *  reschedule / shave). Frontend renders "was CRUISE INTERVALS"
   *  sublines + "How it changed" modal section from these fields.
   *  Null on off-plan days (no plan_workouts row). */
  adaptation: {
    wasAdapted: boolean;
    originalType: string | null;
    originalSubLabel: string | null;
    originalDistanceMi: number | null;
    originalDateIso: string | null;
    reason: string | null;
    adaptedAt: string | null;
    kind: import('@/lib/coach/adaptation-info').AdaptationKind | null;
  } | null;
}

export interface GlanceState {
  today: string;
  /** First name for the greeting · null when profile.full_name is unset.
   *  P2-75 fix 2026-07-06 · consumers render a generic greeting on null
   *  (seed.ts falls back to 'You'); never a literal placeholder name. */
  greetingName: string | null;
  weekDone: number;
  weekPlanned: number | null;
  weekDays: GlanceWeekDay[];   // 7 entries, week-start → long-run day (long_run_day window)
  phaseLabel: string | null;
  sleep7Avg: number | null;
  sleep7Deficit: number;
  rhrCurrent: number | null;
  rhrBaseline: number | null;
  // 2026-05-27 P-AT-A-GLANCE: HRV + ACWR were computed inside this
  // function but not exposed on the interface. The new AtAGlanceCard
  // needs them as tile data, so surface them.
  hrvCurrent: number | null;
  hrvBaseline: number | null;
  loadAcwr: number | null;
  cadenceBaseline: number | null;
  daysToARace: number | null;
  nextARaceName: string | null;
  // Pace-derivation input (Phase 47). LTHR → the Friel zone table, for the HR
  // half of the Poster fallback. A measurement, not a goal. null when the
  // runner has no LTHR.
  lthr: number | null;
  /**
   * SECOND-OWNER-1 (2026-09-02) · THE canonical six pace anchors for this
   * runner today, from `resolvePrescribedPaceAnchors`.
   *
   * This replaces `raceGoalSeconds` / `raceGoalDistanceMi`, which existed on
   * this interface for exactly one purpose: feeding
   * `prescriptions.derivePaces()` in `glance-adapter`, which priced the
   * runner's whole training ladder off his TYPED GOAL. That function is
   * deleted; see `lib/training/prescriptions.ts`'s header for the 36-to-60
   * s/mi it was wrong by on the owner's own account.
   *
   * Carried as the full `PaceAnchorRead` rather than as unwrapped numbers so
   * the refusal survives the trip: the `ok: false` branch has no `anchors`
   * field at all, so a consumer cannot read one without branching, and a
   * REFUSED anchor set can never be mistaken for a resolved one (Rule 11).
   */
  paceAnchors: PaceAnchorRead;
  /**
   * The closest upcoming A-race's DISTANCE in miles. A distance, not a goal
   * time: it sizes the fuelling ramp (`computeFueling`) and the run's purpose
   * (`derivePurpose`), and it cannot price a pace on its own —
   * `tPaceFromGoal` needed the goal TIME, and that field
   * (`raceGoalSeconds`) is deleted from this interface. Null when the runner
   * has no upcoming A-race with a stated goal.
   */
  raceGoalDistanceMi: number | null;
  readiness: ReadinessBreakdown;
  /**
   * E5 · how TODAY's completed run actually went vs what was prescribed.
   * Drives the done-state copy in glance-adapter (resolveDayState +
   * poster/sibling) so a missed or abandoned session no longer reads
   * "ON TARGET". Derived from the frozen watch-completion phases (same
   * source as loadPhaseBreakdown), not doneMi alone — Jun 2 ran the planned
   * mileage but missed 2 of 4 reps, invisible to a distance check.
   *   · 'nailed' — ran today, hit the work (or no negative signal / non-watch)
   *   · 'short'  — the WORK (quality) block was cut short (a work phase didn't
   *               complete) or missed pace vs the HEAT-ADJUSTED target. Cutting
   *               only a warmup/cooldown short does NOT count, and a run done
   *               correctly for the heat is not "short" (weather-adjusted like
   *               the phase panel) — the quality is what defines the session
   *   · 'over'   — ran ≥1.25× the planned distance (the deferred ease-off case)
   *   · null     — no run logged today (the done-state isn't active)
   * Optional: loadGlanceState always sets it for real data; minimal fixtures
   * (personas) omit it and consumers treat absent as "no signal" (→ nailed).
   */
  todayExecution?: 'nailed' | 'short' | 'over' | null;
  // Skip Today (P-SKIP, 2026-05-28): runner explicitly tapped SKIP on the
  // poster. Row lives in `day_actions` (migration 114). Distinct from rest
  // (planned), missed (passive), sick/niggle (health). Drives the `skipped`
  // DayState in lib/faff/glance-adapter.ts → resolveDayState().
  todaySkipped: boolean;
  // Niggle + Sick logging (P-NIGGLE-SICK, 2026-05-28). Rows live in
  // `niggles` (mig 116) + `sick_episodes` (mig 117). The active row (most
  // recent WHERE cleared_at IS NULL) drives the `niggle` / `sick` DayState
  // in resolveDayState. days_active is computed from logged_at.
  activeNiggle: {
    id: number;
    body_part: string;
    severity: number;
    side: 'left' | 'right' | 'both' | null;
    status: 'just_started' | 'few_days' | 'weeks';
    logged_at: string;
    days_active: number;
  } | null;
  activeSick: {
    id: number;
    symptoms: string[];
    has_fever: boolean;
    started: 'today' | 'yesterday' | 'few_days' | 'week_plus';
    logged_at: string;
    days_active: number;
  } | null;
  // Gap B13 (2026-08-19) · the v5 Today surface's injury_flare state. An
  // OPEN row in `runner_injuries` (resolved_date IS NULL) — the escalation
  // surface above a niggle (see app/api/injuries/route.ts header). Distinct
  // from `activeNiggle` above: a niggle modifies the day, an injury replaces
  // it — the panel goes quiet (no gradient, nothing to prescribe). Most
  // recent open row wins when more than one is logged.
  // Optional (not just nullable) so existing GlanceState fixtures/personas
  // built before this field existed still satisfy the interface structurally.
  activeInjury?: {
    id: number;
    site: string;
    severity: 'minor' | 'moderate' | 'major';
    start_date: string;
    expected_return_date: string | null;
    return_protocol: string | null;
    notes: string | null;
  } | null;
  /**
   * RULE 11 · true when the open-injury read FAILED, as distinct from finding
   * no open injury. `activeInjury` is null in both cases and they are opposite
   * facts: one says the runner is clear, the other says we could not tell.
   * A consumer that gates anything on injury must branch on this rather than
   * reading `activeInjury == null` as "safe".
   */
  injuryReadFailed?: boolean;
  /**
   * THE CANONICAL SAFETY VERDICT for this runner today
   * (`lib/safety/safety-verdict.ts`). NORMAL / CAUTION / MODIFY / STOP, or an
   * explicit UNKNOWN branch that carries no `state` field at all, so a
   * consumer cannot read "we could not check" as "cleared" without first
   * branching on `known`.
   *
   * `activeInjury`, `activeSick`, `activeNiggle` and `injuryReadFailed` above
   * are all DERIVED from this and kept only for the call sites that predate
   * it. New code reads `safety` and nothing else. Optional so pre-existing
   * GlanceState fixtures and personas stay structurally valid.
   */
  safety?: SafetyResolution;
  // STRENGTH-3 (2026-08-17) · recommendedStrengthDays / strengthRecommendation
  // / strengthWeekStatus removed. See the note at the recommender call site.
}

/**
 * E5 · classify how TODAY's completed run went vs the prescription.
 * Reads the frozen watch-completion phases (same field-date query as
 * loadPhaseBreakdown / the recap route) so a missed-rep session is caught
 * even when total mileage matched the plan. Cold-start / non-watch / no-phase
 * runs default to 'nailed' (a logged run with no negative signal). Returns
 * null when there's no run today, so the done-state simply isn't active.
 *
 * Targets are HEAT-ADJUSTED before judging (mirrors loadPhaseBreakdown), so a
 * run executed correctly for the conditions isn't called short — the watch's
 * on-device verdict is weather-unaware and is NOT trusted here.
 *
 * Only WORK phases count — cutting a warmup/cooldown short (status='abandoned'
 * during the CD) is not "coming up short" on the session. Threshold (tunable
 * coach judgment): 'short' when a work phase didn't complete, or ≥ ~1/3 of the
 * ran work phases missed the heat-honest target — leaving a single off-rep in a
 * long set as still "nailed".
 */
async function computeTodayExecution(
  userId: string,
  today: string,
  todayRow: GlanceWeekDay | undefined,
): Promise<'nailed' | 'short' | 'over' | null> {
  if (!todayRow || todayRow.doneMi < 0.5) return null; // no run today
  // 2026-08-27 · the #HHmm-suffix branch below was itself the fix for the
  // fallback's flaw (P1-34), but a treadmill completion's field (`trd_<uuid>`)
  // carries no date suffix at all and always falls through to it — so every
  // treadmill run still hit the UTC-shifted date compare this comment warned
  // about. Convert to the runner's own timezone before taking the date.
  // runnerTimezoneOrPacific — this is the exact "coach_intents
  // watch-completion day bucketing" case that helper is named for. A
  // runner with no stored timezone is legacy single-user-era data
  // stamped in Pacific wall time, never UTC.
  const tz = await runnerTimezoneOrPacific(userId).catch(() => 'America/Los_Angeles');
  const row = (await pool.query(
    `SELECT value FROM coach_intents
      WHERE COALESCE(user_uuid, user_id) = $1
        AND reason = 'watch_completion'
        AND (CASE WHEN field ~ '-[0-9]{4}-[0-9]{2}-[0-9]{2}(#[0-9]+)?$'
                  THEN field ~ ('-' || $2::text || '(#[0-9]+)?$')
                  ELSE (ts AT TIME ZONE $3::text)::date = $2::date END)
      ORDER BY ts DESC LIMIT 1`,
    [userId, today, tz],
  ).catch(() => ({ rows: [] }))).rows[0];

  const overreach = todayRow.plannedMi > 0 && todayRow.doneMi >= todayRow.plannedMi * 1.25;

  if (row?.value) {
    /* VERDICT-1 (2026-09-01) · THE canonical grade, not a local comparator.
     *
     * This walked the work phases itself through `heatAdjustedStatus` at its
     * default width of ten, after a weather query whose only purpose was to
     * feed a heat allowance that comparator had stopped reading on
     * 2026-08-27. The phase panel graded the same reps at eight. One session,
     * two done-states. The grade is resolved once, as the session the plan
     * row says it was, and this reads it.
     *
     * Only the WORK (quality) phases count — cutting a warm-up or cool-down
     * short is NOT "coming up short" (David's call), and the resolver's
     * ceiling phases do not vote. 'short' when a work phase did not complete,
     * or at least about a third of the graded reps fell short — a single
     * off-rep in a long set is still "nailed". */
    const grade = resolveWorkoutVerdict({
      type: todayRow.plannedType,
      spec: (todayRow.plannedSpec ?? null) as Record<string, unknown> | null,
      phases: row.value,
    });
    const shortShare = fellShortShare(grade);
    if (grade.work.incomplete || (shortShare != null && shortShare >= 0.34)) return 'short';
  }
  // No negative signal from the phases → overreach (volume) or a clean hit.
  return overreach ? 'over' : 'nailed';
}

export async function loadGlanceState(userId: string): Promise<GlanceState> {
  // 2026-06-03 · runner TZ instead of the old UTC-minus-7-hour Pacific
  // hack. Now uses profile.timezone which handles DST + non-Pacific
  // runners + travel automatically.
  const today = await runnerToday(userId);

  // Profile (just for name)
  const prof = (await pool.query(
    `SELECT full_name, height_cm, lthr FROM profile WHERE user_uuid = $1
      ORDER BY (user_uuid = $1) DESC LIMIT 1`,
    [userId]
  )).rows[0];

  // Active plan summary (memoized — shared across state-loaders)
  const plan = await loadActivePlan(userId);

  let weekPlanned: number | null = null;
  let phaseLabel: string | null = null;
  let daysToARace: number | null = null;
  let nextARaceName: string | null = null;
  let weekDays: GlanceWeekDay[] = [];

  // #9 (audit 2026-06-16) · the 7-day "this week" window now derives from
  // user_settings.long_run_day (week ENDS on the long-run day) via the shared
  // weekWindowFor helper — the same boundary /api/plan/week + plan_weeks use.
  // Was hardcoded Monday, which mislabeled the strip for non-Sunday-long
  // runners (and made the strip disagree with the calendar). No-op for David
  // (long=Sun → Mon–Sun, byte-identical to the old Monday boundary).
  // weekDates[0].date is the week start, consumed below as the strength
  // recommender's week-start arg (#24), so strength derives the same window.
  const settings = await loadSettings(userId);
  const { startISO: weekStartISO } = weekWindowFor(settings.long_run_day, today);
  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.parse(weekStartISO + 'T12:00:00Z') + i * 86400000);
    return { date: d.toISOString().slice(0, 10), dow: d.getUTCDay() };
  });

  // Plan-aware fields (only populated when plan exists)
  let planByDate = new Map<string, any>();
  if (plan) {
    const weeks = (await pool.query(
      `SELECT id::text AS id, week_idx, week_start_iso FROM plan_weeks WHERE plan_id = $1 ORDER BY week_idx`,
      [plan.id]
    )).rows;
    const cw = weeks.find((w: any) => w.week_start_iso <= today &&
      new Date(Date.parse(w.week_start_iso + 'T00:00:00Z') + 7 * 86400000).toISOString().slice(0, 10) > today);
    // WEEK-READ-1 (2026-08-24) · planned is summed over the RUNNER'S seven days
    // — `weekDates` above, the long-run-day window this same function already
    // builds `weekDays` from — not over the plan_weeks row today falls inside.
    //
    // The two were different objects on the same screen. `weekPlanned` is the
    // headline figure ("X of Y mi") and `weekDays` is the strip printed under
    // it; on a block authored on a different grid from the one it is read on,
    // the headline described one week and the strip another. Live on
    // 2026-08-24: 29.5 above a strip summing to 31.0 for one runner, 3.0 above
    // 2.0 for a second. WEEK-ALIGN-1 stops new blocks being authored that way;
    // this makes the pair agree for the ones that already were.
    //
    // Still one query, now bounded by date instead of by week id.
    {
      const wkmi = await pool.query(
        `SELECT SUM(distance_mi)::numeric AS mi, COUNT(*)::int AS n
           FROM plan_workouts
          WHERE plan_id = $1 AND date_iso::date BETWEEN $2::date AND $3::date`,
        [plan.id, weekDates[0].date, weekDates[6].date]
      );
      // Null, not zero, when the block does not reach this week at all. Zero
      // is a claim that nothing is planned; absent is what we actually know.
      weekPlanned = Number(wkmi.rows[0]?.n ?? 0) > 0 ? Number(wkmi.rows[0]?.mi ?? 0) : null;
    }
    if (cw) {
      const phases = (await pool.query(
        `SELECT label, start_week_idx, end_week_idx FROM plan_phases WHERE plan_id = $1`,
        [plan.id]
      )).rows;
      phaseLabel = phases.find((p: any) => cw.week_idx >= p.start_week_idx && cw.week_idx <= p.end_week_idx)?.label ?? null;
    }
    if (plan.race_id) {
      // Shared, memoized lookup — same query state-loader runs on /today
      // and /health Promise.all'd loads, deduped to 1 round-trip per 60s.
      const race = await loadNextARace(userId, today, plan.race_id);
      if (race) {
        daysToARace = race.days_to_race;
        nextARaceName = race.name;
      }
    }
    // Migration 120 · workout_spec is the per-workout JSONB anchor for
    // /runs/[id] WorkoutBreakdown + /today Poster A3 breakdown rows. We
    // pull it here (small per-day payload) so glance-adapter can prefer
    // real Daniels-VDOT numbers over its placeholder strings.
    const allPlanRows = (await pool.query(
      `SELECT id::text AS id, date_iso, dow, type, distance_mi, sub_label, workout_spec FROM plan_workouts
        WHERE plan_id = $1 AND date_iso BETWEEN $2::text AND $3::text`,
      [plan.id, weekDates[0].date, weekDates[6].date]
    )).rows;
    // STRENGTH-3 (2026-08-17) · strength rows are DROPPED, not surfaced.
    // The generator no longer writes them, but plans authored before this
    // change still carry them and must not shadow the run row for the same
    // date (planByDate is last-row-wins).
    planByDate = new Map<string, any>(
      allPlanRows.filter((r: any) => r.type !== 'strength').map((r: any) => [r.date_iso, r])
    );
  }

  // 2026-06-01 · adaptation envelope per workout · web agent brief
  // adaptation-visibility-backend-brief.md. Loaded once per request
  // (single LATERAL join query) · attached to each GlanceWeekDay below.
  const adaptationByWorkoutId = plan
    ? await (async () => {
        try {
          const { loadAdaptationInfoByPlanIds } = await import('./adaptation-info');
          return await loadAdaptationInfoByPlanIds([plan.id]);
        } catch { return new Map(); }
      })()
    : new Map();

  // Strava actuals — ALWAYS loaded, with or without an active plan, so the
  // week strip + TodayPlannedCard always show real runs.
  //
  // 2026-05-27 P-DOUBLECOUNT: query-time dedupe via canonicalMileageByDay
  // so un-flagged duplicate rows don't inflate. David hit "31.6 done"
  // in the strip vs /log's correct "19.6" because Mon/Tue/Wed each had
  // one extra un-merged row and this loop was summing them all. Now
  // each day's mi is the sum of CANONICAL runs (one per physical
  // workout cluster) so the strip agrees with /log.
  const canonicalByDay = await canonicalMileageByDay(
    userId, weekDates[0].date, weekDates[6].date,
  );
  // Still need a per-day activity_id for click-through to the run modal.
  // Fetch the canonical IDs from canonicalByDay and resolve the first
  // one's data->>'id' (the public Strava id) from strava_activities.
  const allCanonicalIds = Array.from(canonicalByDay.values()).flatMap((v) => v.canonicalIds);
  const idLookup = allCanonicalIds.length > 0
    ? (await pool.query(
        `SELECT id::text AS row_id, data->>'id' AS strava_id,
                COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) AS day
           FROM runs
          WHERE id::text = ANY($1::text[])`,
        [allCanonicalIds],
      )).rows
    : [];
  const idByRow = new Map<string, { strava_id: string | null; day: string }>(
    idLookup.map((r: any) => [String(r.row_id), { strava_id: r.strava_id ?? null, day: r.day }]),
  );
  const actualByDate = new Map<string, { mi: number; id: string | null }>();
  for (const [day, info] of canonicalByDay) {
    // Pick first canonical's public id (any will do — they're all canonical
    // representatives of separate workouts; for a single-workout day there's
    // only one).
    const firstRow = info.canonicalIds[0];
    const stravaId = firstRow ? (idByRow.get(firstRow)?.strava_id ?? firstRow) : null;
    actualByDate.set(day, { mi: info.mi, id: stravaId });
  }

  weekDays = weekDates.map(({ date, dow }) => {
    const planRow = planByDate.get(date);
    const actual = actualByDate.get(date);
    // workout_spec lands as a parsed object via node-postgres JSON typecast;
    // narrow to WorkoutSpec | null. The adapter validates spec.kind matches
    // the day-state before using it (guards against a stale spec left by
    // an updateWorkout that didn't refresh the column).
    const plannedSpec: WorkoutSpec | null = planRow?.workout_spec ?? null;
    // 2026-06-01 · attach the adaptation envelope. Lookup by the
    // plan_workouts.id stamped onto each row · null when no plan
    // row exists for this date (off-plan days).
    const adaptation = planRow?.id
      ? (adaptationByWorkoutId.get(planRow.id) ?? null)
      : null;
    return {
      date, dow,
      plannedId: planRow?.id ?? null,
      plannedMi: planRow ? Number(planRow.distance_mi) || 0 : 0,
      // When no plan, default to a neutral "—" type (NOT "rest") so the
      // TodayPlannedCard doesn't mislabel a run-day as a rest day.
      plannedType: planRow?.type ?? (plan ? 'rest' : 'unplanned'),
      plannedLabel: planRow?.sub_label ?? null,
      plannedSpec,
      doneMi: actual ? roundTo(actual.mi, 1) : 0,
      activityId: actual?.id ?? null,
      isToday: date === today,
      isPast: date < today,
      adaptation,
    };
  });

  // Week done — sum from weekDays we already loaded
  const weekDone = roundTo(weekDays.reduce((s, d) => s + d.doneMi, 0), 1);

  // Sleep
  const sleep = (await pool.query(
    `SELECT value FROM health_samples
      WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'sleep_hours' AND sample_date <= $2::date
      ORDER BY sample_date DESC LIMIT 7`,
    [userId, today]
  )).rows.map((r: any) => Number(r.value)).filter((v: number) => v > 0);
  const sleep7Avg = sleep.length ? +(sleep.reduce((s, x) => s + x, 0) / sleep.length).toFixed(1) : null;
  const sleep7Deficit = +sleep.reduce((s, x) => s + Math.max(0, 7.5 - x), 0).toFixed(1);

  // RHR + HRV — STABLE BASELINE per the 2026-06-03 unification.
  //
  // current = today's daily-avg value · baseline = mean of last 30
  // days EXCLUDING the recent 7. The 7-day exclusion stops the
  // comparator from drifting with the runner · a 5-day RHR streak
  // pulls the rolling-14 baseline up so the pillar always reads
  // "at baseline" even when the runner is genuinely elevated above
  // their settled state. Same definition as state-loader.ts
  // (loadStableBaseline) and the forecasts engine · keeps the
  // driver row, BODY tile, and WATCHING TOMORROW forecast on the
  // same number. Previously: driver row used LIMIT 14 here (got 51),
  // BODY tile + forecast used the stable form (got 45) · same metric,
  // two numbers, one page.
  // 2026-06-09 · race-killer F4 — current = MEDIAN of a short window,
  // not the last raw reading. This fast-path copy fed computeReadiness
  // a SINGLE-DAY value while state-loader fed a 7-day window — the
  // split-brain behind 2026-06-08's score-38 PULL-BACK from one 29 ms
  // partial-night HRV sample (corrected to 46 ms on re-sync). Windows
  // now match state-loader.ts exactly: hrv 7 · resting_hr 3, median.
  const median = (xs: number[]): number | null => {
    if (xs.length === 0) return null;
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 === 1 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
  };
  const loadStableBaseline = async (sampleType: string, currentWindow = 1): Promise<{ current: number | null; baseline: number | null }> => {
    // 2026-08-27 · same UTC-shift bug as the watch-completion date match
    // above — a sample recorded late evening bucketed into tomorrow's
    // (UTC) day, skewing which entries land in the last-30/baseline split.
    const glanceTz = await runnerTimezone(userId).catch(() => 'UTC');
    const rows = (await pool.query<{ d: string; v: number | string }>(
      `SELECT (recorded_at AT TIME ZONE $3::text)::date::text AS d, AVG(value)::numeric AS v
         FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1
          AND sample_type = $2
          AND recorded_at >= NOW() - interval '60 days'
        GROUP BY (recorded_at AT TIME ZONE $3::text)::date
        ORDER BY d ASC`,
      [userId, sampleType, glanceTz]
    ).catch(() => ({ rows: [] as Array<{ d: string; v: number | string }> }))).rows;
    const vals = rows.slice(-30).map((r) => Math.round(Number(r.v))).filter((v) => v > 0);
    if (vals.length === 0) return { current: null, baseline: null };
    const w = Math.min(currentWindow, vals.length);
    const current = w > 0 ? median(vals.slice(-w)) : null;
    const baseline = vals.length >= 14
      ? Math.round(vals.slice(0, -7).reduce((s, x) => s + x, 0) / Math.max(1, vals.length - 7))
      : Math.round(vals.reduce((s, x) => s + x, 0) / vals.length);
    return { current, baseline };
  };
  const rhrSt = await loadStableBaseline('resting_hr', 3);
  const rhrCurrent = rhrSt.current;
  const rhrBaseline = rhrSt.baseline;
  const hrvSt = await loadStableBaseline('hrv', 7);
  const hrvCurrent = hrvSt.current;
  const hrvBaseline = hrvSt.baseline;

  // Cadence 60d baseline. Cluster 3: prefer runs.data.avgCadence over
  // health_samples.cadence (writing stopped 2026-05-25; falls null ~49d
  // from now). Same COALESCE pattern as health-state.ts.
  const cad = (await pool.query(
    // BOTH FEET · `runCadenceSpmSql` replaces the 130-220 band, which hid the
    // 57 per-leg rows instead of converting them and dropped a real 114 spm
    // row as out of range. See lib/runs/coherence.ts section 8.
    `WITH run_cadence AS (
       SELECT AVG(${runCadenceSpmSql()})::numeric AS avg
         FROM runs
        WHERE user_uuid = $1::uuid
          AND NOT (data ? 'mergedIntoId')
          AND ${runCadenceSpmSql()} IS NOT NULL
          AND (data->>'date')::date >= ($2::date - interval '60 days')
     ),
     hk_cadence AS (
       SELECT AVG(value)::numeric AS avg FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1
          AND sample_type = 'cadence'
          AND sample_date >= ($2::date - interval '60 days')
     )
     SELECT COALESCE(rc.avg, hc.avg) AS avg
       FROM run_cadence rc, hk_cadence hc`,
    [userId, today]
  )).rows[0];
  const cadenceBaseline = cad?.avg ? Math.round(Number(cad.avg)) : null;

  // 2026-06-01 · HR recovery now wired here too. Previously hardcoded
  // to null (the "fast path" excuse) which made the Health page show
  // "no data" while the slide-out brief (which uses loadCoachState)
  // showed the real value. Two surfaces, same metric, different
  // numbers · the kind of split-brain inconsistency the dedup
  // doctrine bans. Same query shape as state-loader.ts:237.
  const hrRecRows = (await pool.query(
    `SELECT value FROM health_samples
      WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'hr_recovery'
        AND recorded_at >= NOW() - interval '30 days'
      ORDER BY recorded_at DESC LIMIT 30`,
    [userId]
  )).rows.map((r: { value: number | string }) => Number(r.value)).filter((v: number) => v > 0);
  const hrRecoveryCurrent = hrRecRows[0] ?? null;
  const hrRecoveryBaseline = hrRecRows.length
    ? Math.round(hrRecRows.reduce((s: number, x: number) => s + x, 0) / hrRecRows.length)
    : null;

  // Recent check-ins
  const checkIns = await pool.query(
    `SELECT ts, rating FROM check_ins WHERE COALESCE(user_uuid, user_id) = $1 AND ts >= NOW() - interval '7 days'
      ORDER BY ts DESC LIMIT 10`,
    [userId]
  ).catch(() => ({ rows: [] }));

  // ACWR for LOAD pillar — Gabbett's Acute:Chronic Workload Ratio.
  //
  // 2026-08-17 COLD-3 · this was the second of five copies of the ratio,
  // byte-identical to state-loader.ts's and carrying the same `runs28 >= 3`
  // guard, which counts RUNS rather than window coverage and so never fired
  // for a cold-start runner (whose two legs sum the same runs, making the
  // ratio the constant 28/7 = 4.00). Both now call lib/coach/acwr.ts, so the
  // "three Health-page surfaces, three different ACWR numbers" failure this
  // block was written to fix cannot come back through a fourth copy.
  //
  // STRENGTH-2 (2026-08-17) · the strength fold stays removed. It converted
  // strength minutes to running miles at a fabricated 0.07 mi/min, which
  // Research/09:350 prohibits outright ("Quantify session load via sRPE;
  // do not equate to run minutes"), and that number was moving the ratio
  // the readiness pull-back and the strength cap both read. ACWR is
  // running-only until both sides can move to sRPE together — the exact
  // follow-up is written out in lib/coach/strength-load.ts.
  const load = await computeAcwr(userId, today);
  const loadAcute7 = load.acute7;
  const loadChronic28 = load.chronic28;
  const loadAcwr = load.acwr;

  // Skip Today (P-SKIP, 2026-05-28). One-row point read against day_actions
  // (migration 114). Index on (user_id, date_iso, action) makes this ~O(1).
  // If the table doesn't exist yet (migration not applied) we default to
  // false so the loader doesn't hard-fail.
  const skipRow = await pool.query(
    `SELECT 1 FROM day_actions
      WHERE COALESCE(user_uuid, user_id) = $1 AND date_iso = $2 AND action = 'skip' LIMIT 1`,
    [userId, today],
  ).catch(() => ({ rows: [] as any[] }));
  const todaySkipped = skipRow.rows.length > 0;
  // ── SAFETY · DELEGATED TO THE CANONICAL OWNER, 2026-09-02 ──────────────
  //
  // THREE SEPARATE READS of `niggles`, `sick_episodes` and `runner_injuries`
  // used to live here, and `lib/watch/build-workout.ts` kept its own copy of
  // the same three with its own precedence. That duplication is how the wrist
  // and the phone came to disagree about what an open injury means: the phone
  // refused to prescribe, the watch drew a "Not today" board and shipped the
  // runnable workout beside it.
  //
  // The queries are now `lib/safety/load-safety.ts` and the verdict is
  // `lib/safety/safety-verdict.ts#classifySafety`. This loader is a CONSUMER.
  // It keeps its three legacy fields below because a dozen call sites read
  // them, but it decides nothing about them, and it no longer decides what a
  // failed read means.
  //
  // Read count is unchanged (three LIMIT-1 point reads), now issued in
  // parallel rather than in series.
  //
  // THE HALF DELIBERATELY LEFT OPEN when `injuryReadFailed` was added on
  // 2026-09-02 ("what Today should DO when the injury check could not run")
  // is answered by `safety`: an explicit UNKNOWN carrying a
  // WITHHOLD_PENDING_CHECK posture. `injuryReadFailed` survives as a DERIVED
  // alias so no existing consumer breaks; new code branches on
  // `safety.known`, which does not compile until it has.
  const safety = classifySafety(await loadSafetyInputs(userId));
  const safeInjury = safety.known ? safety.injury : null;
  const safeIllness = safety.known ? safety.illness : null;
  const safeNiggle = safety.known ? safety.niggle : null;

  const activeNiggle = safeNiggle
    ? {
        id: safeNiggle.id,
        body_part: safeNiggle.bodyPart,
        severity: safeNiggle.severity,
        side: safeNiggle.side,
        status: safeNiggle.status as 'just_started' | 'few_days' | 'weeks',
        logged_at: safeNiggle.loggedAtISO,
        days_active: safeNiggle.daysActive,
      }
    : null;

  const activeSick = safeIllness
    ? {
        id: safeIllness.id,
        symptoms: [...safeIllness.symptoms],
        has_fever: safeIllness.hasFever,
        started: safeIllness.started as 'today' | 'yesterday' | 'few_days' | 'week_plus',
        logged_at: safeIllness.loggedAtISO,
        days_active: safeIllness.daysActive,
      }
    : null;

  const activeInjury = safeInjury
    ? {
        id: safeInjury.id,
        site: safeInjury.site,
        severity: safeInjury.severity,
        start_date: safeInjury.startDateISO,
        expected_return_date: safeInjury.expectedReturnDateISO,
        return_protocol: safeInjury.returnProtocol,
        notes: safeInjury.notes,
      }
    : null;

  // DERIVED, never independently decided. True exactly when the canonical
  // resolver could not read the injury signal.
  const injuryReadFailed =
    !safety.known && safety.unreadable.some((u) => u.signal === 'injury');

  const bandBaseline = await loadReadinessBandBaseline(userId, today);
  const readiness = computeReadiness({
    today, user_id: userId,
    profile: prof ?? null,
    latest_activity: null,
    recentRuns: [],
    weekDone, weekPlanned, phaseLabel, currentWeekDays: [],
    todayWorkout: null,
    nextWorkout: null,
    nextARace: nextARaceName && daysToARace != null
      ? {
          slug: '', name: nextARaceName, date: '', goal: null,
          days_to_race: daysToARace,
          // 2026-06-03 · glance fast-path skips the distance lookup ·
          // the brief envelope (state-loader) carries the real value.
          distanceMi: null,
          distanceLabel: null,
        }
      : null,
    // Glance fast-path skips the goal lookup · the full brief (state-loader)
    // carries fitnessGoal for the no-race voice anchor.
    fitnessGoal: null,
    sleep7Avg, sleep7Deficit, hrvCurrent, hrvBaseline,
    rhrCurrent, rhrBaseline, cadenceBaseline,
    // 2026-06-01 · was hardcoded null (fast-path excuse) · split-brain
    // with state-loader (loadReadinessBrief) which loaded the real
    // values. Now wired the same query as state-loader.ts so both
    // surfaces show the same number for the same metric.
    hrRecoveryCurrent, hrRecoveryBaseline,
    loadAcute7, loadChronic28, loadAcwr,
    // 2026-06-01 · glance state is the fast-path · skip the cycle DB
    // query (state-loader does it for the brief). Luteal adjustment
    // only matters for the morning brief score · glance shows the raw
    // pillars, not the score, so this default is honest.
    biologicalSex: 'not_specified' as const,
    cyclePhase: null,
    recentCheckIns: checkIns.rows.map((r: any) => ({ ts: r.ts, rating: r.rating })),
    activeNiggle: null,  // glance state doesn't pull niggle extras
    pendingIntents: [], shoes: [],
    // 2026-06-03 · Today screen post-run pivot · glance-state is a
    // FAST-PATH variant of state-loader (skips heavy reads). Default
    // false here · the dedicated /api/coach/recovery-brief endpoint
    // re-queries via the full state-loader, which DOES compute these.
    todayRunDone: false,
    todayRunLong: false,
    // 2026-06-03 · voice band null on the fast path · morning brief
    // composer falls back to 'guided' (safe default) when null.
    voiceBand: null,
    // 2026-06-03 · phase focus null on the fast path · iPhone reads
    // from the full state-loader path (e.g. /api/coach/today) when
    // it needs the authored copy.
    phase: null,
  },
    undefined,
    // 2026-08-17 · owner ruling · Today bands the score against the runner's
    // own rolling normal, same loader the brief and the nightly snapshot use.
    // Without it this fast path would band on the absolute cuts and disagree
    // with the Health page about the same number.
    bandBaseline,
  );

  // Pace inputs for the /today card and the Poster fallback.
  //
  // ── SECOND-OWNER-1 (2026-09-02) · THE GOAL READ IS GONE ────────────────────
  //
  // This block used to load the closest upcoming A-race's `goalDisplay` and
  // distance and put them on `GlanceState`, for one consumer:
  // `prescriptions.derivePaces()` in `glance-adapter`, which built the runner's
  // entire training-pace ladder as offsets from his TYPED GOAL TIME. For the
  // owner on 2026-09-02 that priced his marathon pace at 412 s/mi against the
  // canonical 472, and his threshold at 394 against 430.
  //
  // The goal read is deleted along with the function it fed. What ships now is
  // the canonical anchor set — `resolvePrescribedPaceAnchors`, whose inputs are
  // `(userId, today)` and NOTHING ELSE, so a goal physically cannot reach it.
  //
  // Cost: four capacity resolvers on a path whose header calls itself a "fast
  // read". Accepted deliberately — the alternative is a fast wrong number, and
  // this replaces a `races` query that was itself a round trip.
  const lthr = prof?.lthr != null ? Number(prof.lthr) : null;
  const paceAnchors = await resolvePrescribedPaceAnchors(userId, today);
  // The race DISTANCE survives — it sizes the fuelling ramp and the run's
  // purpose, neither of which is a pace. The goal TIME does not: without it
  // `tPaceFromGoal` cannot be called at all, which is the physical exclusion
  // rather than a convention.
  let raceGoalDistanceMi: number | null = null;
  {
    const goalRow = (await pool.query(
      `SELECT meta FROM races
        WHERE user_uuid = $1
          AND meta->>'priority' = 'A'
          AND meta->>'goalDisplay' IS NOT NULL
          AND (meta->>'date')::date >= $2::date
        ORDER BY (meta->>'date') ASC LIMIT 1`,
      [userId, today]
    ).catch(() => ({ rows: [] as any[] }))).rows[0];
    // ONE PARSER. `distanceMiOfMeta` prefers the numeric field and falls back
    // to the label, covering 15K, every ultra the Add Race sheet offers, the
    // "10 mile" / "20 mile" labels and the bare "26.2" / "13.1" literals that
    // a hand-rolled four-branch reader used to drop silently.
    raceGoalDistanceMi = distanceMiOfMeta(goalRow?.meta ?? {});
  }

  // STRENGTH-3 (2026-08-17) · the strength-day recommender is UNWIRED.
  // David: "remove anything about strength training. Right now it adds a
  // level of complication and I am handling that elsewhere." faff is a
  // running coach; it no longer prescribes, recommends, or reconciles
  // gym work. lib/coach/strength-recommender.ts and strength-status.ts
  // still exist and still compile — nothing calls them — so the decision
  // is reversible by restoring this block. The `strength_sessions` table
  // and the HealthKit ingest that fills it are untouched: history keeps
  // accruing silently.

  // E5 · classify how today's run went (frozen phases) → done-state copy.
  const todayExecution = await computeTodayExecution(userId, today, weekDays.find((d) => d.isToday));

  return {
    today,
    // P2-75 fix 2026-07-06 · null full_name → null, NOT the literal 'David'.
    // Every no-name signup was greeted as David. Consumers fall back to a
    // generic greeting (seed.ts → 'You').
    greetingName: prof?.full_name?.split(/\s+/)[0] ?? null,
    weekDone, weekPlanned, weekDays, phaseLabel,
    sleep7Avg, sleep7Deficit,
    rhrCurrent, rhrBaseline,
    hrvCurrent, hrvBaseline,
    loadAcwr,
    cadenceBaseline,
    daysToARace, nextARaceName,
    lthr, paceAnchors, raceGoalDistanceMi,
    readiness,
    todayExecution,
    todaySkipped,
    activeNiggle,
    activeSick,
    activeInjury,
    injuryReadFailed,
    safety,
  };
}
