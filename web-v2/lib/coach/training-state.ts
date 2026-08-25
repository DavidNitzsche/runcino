/**
 * training-state.ts
 *
 * Extra state the TRAINING surface needs beyond the base CoachState:
 *   - All weeks of the active plan (volume arc)
 *   - Phase boundaries
 *   - Last-quality session for "since last check-in" delta
 *
 * Lives separately from state-loader so the TODAY load stays light.
 */
import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { getCanonicalRunIds, mileageByDay } from '@/lib/runs/volume';
import { loadActivePlan } from '@/lib/plan/lookup';
import { loadSettings } from '@/lib/coach/settings';
import { weekWindowFor } from '@/lib/coach/week-window';

export interface PlanWeek {
  /** plan_weeks.id — added 2026-08-19 for /api/v5/block so week rows carry a
   *  real server identity instead of a synthesised index. */
  id: string;
  idx: number;
  phase: string;
  startDate: string;
  plannedMi: number;
  /** plan_weeks.is_race_week / is_cutback — added 2026-08-19 alongside `id`,
   *  same reason: the Block screen's week-row flag ("Race week" / "Cutback")
   *  reads the real columns rather than re-deriving them from `days`. */
  isRaceWeek: boolean;
  isCutback: boolean;
  days: Array<{
    /** plan_workouts.id — used by TrainView to cross-reference coach_intents
     *  rows (action='plan_adapt_*') that targeted this specific workout. */
    id: string;
    date: string; dow: number; type: string;
    mi: number; label: string | null;
    /** plan_workouts.is_quality / is_long — added 2026-08-19 for /api/v5/block
     *  so a day's quality/long flag is the authoritative DB column, the same
     *  one lib/plan/replan-scenarios.ts reads, rather than a type-string
     *  heuristic re-derived per caller. */
    isQuality: boolean;
    isLong: boolean;
    // 2026-05-30: workout_spec jsonb (migration 120) so the train-view week
    // strip can render real Daniels-VDOT paces per day (P0 #4 backfill)
    // instead of the canonical PACE_DEFAULT placeholder.
    spec: import('@/lib/faff/types').WorkoutSpec | null;
    // Actual side (strava activity if logged):
    doneMi: number;
    activityId: string | null;
    // 2026-05-31: actual pace + avg HR for done days so the TrainView's
    // KEY WORKOUTS list can render hit-or-miss vs the planned target
    // ("→ 6:45 actual · Hit" or "→ 7:10 actual · Off pace").
    donePaceSec: number | null;
    doneAvgHr: number | null;
    /** Per-mile splits from the matched activity. Lets TrainView compute
     *  work-segment pace for quality workouts (intervals / tempo /
     *  threshold) instead of using the whole-run avg, which buries the
     *  rep pace under warmup + recovery + cooldown miles. */
    doneSplits?: Array<{ paceSec: number | null; hr: number | null }>;
    /** 2026-06-01 · adaptation envelope · web agent brief
     *  adaptation-visibility-backend-brief.md. wasAdapted=true means
     *  this row was mutated by the auto-adapter (downgrade/reschedule/
     *  shave). Frontend renders "was CRUISE INTERVALS" sublines + the
     *  "How it changed" modal section from these fields. Null when no
     *  matching adaptation entry was found. */
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
  }>;
  isCurrent: boolean;
  // STRENGTH-3 (2026-08-17) · recommendedStrengthDays / strengthPicks /
  // strengthSuppressed / pausedStrengthDays / completedStrengthDays all
  // removed. faff no longer recommends gym work; see the note where the
  // recommender used to be called, below.
}

export interface PlanPhase { label: string; startWeekIdx: number; endWeekIdx: number; }

export interface TrainingState {
  plan_id: string | null;
  today: string;
  race: { slug: string; name: string; date: string; goal: string | null; days_to_race: number } | null;
  phases: PlanPhase[];
  weeks: PlanWeek[];
  currentPhase: string | null;
  currentWeekIdx: number | null;
  nextQuality: { date: string; dow: number; type: string; label: string | null; mi: number } | null;
  weekDone: number;            // canonical mileage, week-start→today (long_run_day window)
  /**
   * Planned mileage for the SAME seven days `weekDone` is summed over, and the
   * same seven `/api/plan/week` puts on the strip — the runner's training week,
   * ending on their long-run day.
   *
   * WEEK-READ-1 (2026-08-24) · this used to be `current.plannedMi`, the total
   * of the plan_weeks row today happens to sit inside. On a block authored on
   * the same grid the runner reads, the two are the same number. On one that
   * is not, they are two different weeks: production on 2026-08-24 held two
   * plans authored on a Wednesday against a Sunday long run, and the phone
   * printed 29.5 mi planned above a strip that summed to 31.0 (and 3.0 above
   * 2.0 on the other). WEEK-ALIGN-1 stops NEW blocks being authored that way;
   * this makes the number right for the ones that already were, and for any
   * plan whose rows some other writer moved.
   *
   * The per-week figure on the Block screen's week list is still the authored
   * week (`weeks[].plannedMi`) — that is the block's own unit and it is the
   * honest one there. This field is the RUNNER's week.
   */
  weekPlanned: number | null;
  /** The window `weekDone` and `weekPlanned` are both measured over, so a
   *  surface can say which seven days it is talking about instead of implying
   *  it. */
  weekWindow: { startISO: string; endISO: string };
  /** The plan's own days inside that window, in date order. What the Block
   *  panel derives its quality share and long run from, so all three of its
   *  numbers describe one week. */
  weekWindowDays: PlanWeek['days'];
  /** ISO timestamp of the last run-adaptations cron pass. Drives the
   *  "Plan refreshed Xh ago" freshness line on the Train tab. Added
   *  2026-05-30 audit. Null when the cron hasn't run yet. */
  last_adapted_at: string | null;
  /** 2026-06-03 · Rule 11 (horizon-aware planning). Null when no future
   *  A/B race within 24 weeks raises the long-run cap above the current
   *  tier's. Surfaced as a chip on the Train tab. */
  horizonRaise: {
    fromLongCapMi: number;
    toLongCapMi: number;
    fromLongShare: number;
    toLongShare: number;
    race: { slug: string; name: string; date: string; distanceMi: number };
  } | null;
}

export async function loadTrainingState(userId: string): Promise<TrainingState> {
  const today = await runnerToday(userId);

  const plan = await loadActivePlan(userId);

  if (!plan) {
    return {
      plan_id: null, today, race: null, phases: [], weeks: [],
      currentPhase: null, currentWeekIdx: null, nextQuality: null,
      weekDone: 0, weekPlanned: null,
      // No plan · no window worth naming, but the field is not optional and a
      // caller must not have to guess. Today's own seven days, empty.
      weekWindow: weekWindowFor('sun', today),
      weekWindowDays: [],
      last_adapted_at: null,
      horizonRaise: null,
    };
  }

  // 2026-06-03 · Rule 11 · read horizon_raise from authored_state.
  const authRow = (await pool.query<{ horizon: any }>(
    `SELECT authored_state->'horizon_raise' AS horizon FROM training_plans WHERE id = $1`,
    [plan.id],
  ).catch(() => ({ rows: [] }))).rows[0];
  const horizonRaise = authRow?.horizon
    ? authRow.horizon as TrainingState['horizonRaise']
    : null;

  const phases: PlanPhase[] = (await pool.query(
    `SELECT label, start_week_idx, end_week_idx FROM plan_phases WHERE plan_id = $1 ORDER BY start_week_idx`,
    [plan.id]
  )).rows.map((r: any) => ({ label: r.label, startWeekIdx: r.start_week_idx, endWeekIdx: r.end_week_idx }));

  const weekRows = (await pool.query(
    `SELECT id::text AS id, week_idx, week_start_iso, is_race_week, is_cutback
       FROM plan_weeks WHERE plan_id = $1 ORDER BY week_idx`,
    [plan.id]
  )).rows;
  // STRENGTH-3-READ-1 (2026-08-24) · the removal was enforced on WRITERS only.
  // `_no_strength_rows.test.ts` scans every plan-row writer and is clean, but
  // rows written before 2026-08-17 are still in the table, and nothing stopped
  // them reaching a screen. One production plan on 2026-08-24 carries fourteen
  // of them, EIGHT of them in the future: the Block screen's week list emits
  // one day cell per row, so that runner's weeks render nine days for seven,
  // two of them a zero-mile "Strength" for a feature the app removed.
  //
  // The week strip happened to hide them — every legacy row shares its day
  // with an easy run and loses `shapePlanWeekDays`' priority pick — which is
  // luck, not a guard. This is the guard. Filtered at the READ so the rows
  // stay in the table: the removal is meant to be reversible and the data was
  // deliberately kept.
  const workouts = (await pool.query(
    `SELECT id::text AS id, week_id::text AS week_id, date_iso, dow, type, distance_mi, sub_label, workout_spec,
            is_quality, is_long
       FROM plan_workouts
      WHERE plan_id = $1
        AND type NOT IN ('strength', 'cross', 'xt')
      ORDER BY date_iso`,
    [plan.id]
  )).rows;

  const phaseFor = (idx: number) =>
    phases.find((p) => idx >= p.startWeekIdx && idx <= p.endWeekIdx)?.label ?? 'BASE';

  // Pull all strava activities in plan range, indexed by date for fast lookup
  const planRangeStart = weekRows[0]?.week_start_iso;
  const planRangeEnd = weekRows.length
    ? new Date(Date.parse(weekRows[weekRows.length - 1].week_start_iso + 'T00:00:00Z') + 7 * 86400000).toISOString().slice(0, 10)
    : today;
  // 2026-05-31: also pull avg pace + HR per activity so the TrainView's
  // milestones list can show hit-or-miss for past quality workouts. We
  // aggregate per (day, activity) and pick the richest payload per day.
  const stravaRows = planRangeStart
    ? (await pool.query(
        `SELECT COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) AS day,
                data->>'id' AS activity_id,
                (data->>'distanceMi')::numeric AS mi,
                NULLIF(data->>'paceSPerMi','')::numeric AS pace_sec,
                NULLIF(data->>'avgPaceMinPerMi','')             AS pace_str,
                -- #2 · COALESCE the moving-time key; webhook runs carry
                -- movingSec/durationSec, not movingTimeS.
                COALESCE(
                  NULLIF(data->>'movingTimeS','')::numeric,
                  NULLIF(data->>'movingSec','')::numeric,
                  NULLIF(data->>'durationSec','')::numeric
                ) AS moving_s,
                NULLIF(data->>'avgHr','')::numeric AS avg_hr,
                data->'splits' AS splits
           FROM runs
          WHERE user_uuid = $1 AND id = ANY($4::bigint[])
            AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) BETWEEN $2::text AND $3::text`,
        // Phase B · one canonical dedup. A dupe would double the day's actual mi
        // in actualByDate (cur.mi += r.mi), corrupting plan-vs-actual.
        [userId, planRangeStart, planRangeEnd, await getCanonicalRunIds(userId, planRangeStart, planRangeEnd)]
      )).rows
    : [];
  function parsePaceStr(s: string | null | undefined): number | null {
    if (!s) return null;
    const m = String(s).match(/^(\d+):(\d{2})$/);
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }
  type Split = { paceSec: number | null; hr: number | null };
  const actualByDate = new Map<string, { mi: number; id: string | null; paceSec: number | null; avgHr: number | null; splits: Split[] }>();
  for (const r of stravaRows) {
    const cur = actualByDate.get(r.day) ?? { mi: 0, id: null, paceSec: null, avgHr: null, splits: [] as Split[] };
    cur.mi += Number(r.mi) || 0;
    if (!cur.id) cur.id = r.activity_id ?? null;
    if (cur.paceSec == null) {
      const direct = r.pace_sec != null ? Number(r.pace_sec) : null;
      const fromStr = parsePaceStr(r.pace_str);
      const fromMoving = r.moving_s && r.mi ? Math.round(Number(r.moving_s) / Number(r.mi)) : null;
      cur.paceSec = direct ?? fromStr ?? fromMoving ?? null;
    }
    if (cur.avgHr == null && r.avg_hr != null) cur.avgHr = Math.round(Number(r.avg_hr));
    // Splits from the richer activity (longer one) — gives us per-mile pace
    // for quality workouts so the influence comparison can extract work-segment
    // pace instead of the whole-run average.
    if (cur.splits.length === 0 && Array.isArray(r.splits)) {
      for (const s of r.splits as Array<Record<string, unknown>>) {
        const sec = Number(s.paceSPerMi) || (s.pace_s_per_mi as number | undefined) || parsePaceStr((s.pace as string | undefined) ?? null) || null;
        const hr  = Number(s.hr ?? s.avgHr) || null;
        cur.splits.push({ paceSec: sec, hr });
      }
    }
    actualByDate.set(r.day, cur);
  }

  // 2026-06-01 · adaptation envelope · web agent brief
  // adaptation-visibility-backend-brief.md. Loaded once for ALL
  // workouts in this plan (single LATERAL join query) so each day's
  // map() lookup is O(1).
  const { loadAdaptationInfoByPlanIds } = await import('./adaptation-info');
  type AInfo = import('./adaptation-info').AdaptationInfo;
  const adaptationByWorkoutId = await loadAdaptationInfoByPlanIds([plan.id])
    .catch(() => new Map<string, AInfo>());

  const weeks: PlanWeek[] = weekRows.map((w: any) => {
    const days = workouts
      .filter((x: any) => x.week_id === w.id)
      .sort((a: any, b: any) => a.date_iso.localeCompare(b.date_iso))
      .map((d: any) => {
        const actual = actualByDate.get(d.date_iso);
        // 2026-06-01 · adaptation envelope · attached via the
        // adaptationByWorkoutId map loaded below this map. Each day
        // gets its own AdaptationInfo with wasAdapted boolean +
        // original_* fields + reason/kind/adaptedAt from the most
        // recent matching plan_adapt coach_intent. Null when no
        // plan_workouts.id (shouldn't happen given this map iterates
        // workouts) · keeps the field shape stable for the renderer.
        const adaptation = adaptationByWorkoutId.get(String(d.id)) ?? null;
        return {
          id: String(d.id),
          date: d.date_iso, dow: d.dow, type: d.type,
          mi: Number(d.distance_mi) || 0, label: d.sub_label,
          spec: d.workout_spec ?? null,
          isQuality: d.is_quality === true,
          isLong: d.is_long === true,
          doneMi: actual ? Math.round(actual.mi * 10) / 10 : 0,
          activityId: actual?.id ?? null,
          donePaceSec: actual?.paceSec ?? null,
          doneAvgHr: actual?.avgHr ?? null,
          doneSplits: actual?.splits ?? [],
          adaptation,
        };
      });
    const plannedMi = Math.round(days.reduce((s, d) => s + d.mi, 0) * 10) / 10;
    const isCurrent = days.some((d) => d.date === today) ||
      (w.week_start_iso <= today &&
       new Date(Date.parse(w.week_start_iso + 'T00:00:00Z') + 7 * 86400000)
         .toISOString().slice(0, 10) > today);
    return {
      id: String(w.id),
      idx: w.week_idx,
      phase: phaseFor(w.week_idx),
      startDate: w.week_start_iso,
      plannedMi,
      isRaceWeek: w.is_race_week === true,
      isCutback: w.is_cutback === true,
      days,
      isCurrent,
    };
  });

  // STRENGTH-3 (2026-08-17) · the per-week strength enrichment is gone.
  // It used to call recommendStrengthDays for the current week and every
  // future week, then reconcile against strength_sessions, so the native
  // calendar and week strip could paint strength markers. faff prescribes
  // running now, nothing else. The recommender module is intact and
  // uncalled; strength_sessions and its HealthKit ingest keep filling.

  const current = weeks.find((w) => w.isCurrent);
  const currentPhase = current?.phase ?? null;
  const currentWeekIdx = current?.idx ?? null;

  // Next quality day = first future non-rest, non-easy workout (or first quality session in plan).
  const QUALITY_TYPES = new Set(['threshold', 'tempo', 'intervals', 'long', 'race']);
  const upcoming = workouts
    .filter((w: any) => w.date_iso > today && Number(w.distance_mi) > 0 && QUALITY_TYPES.has(w.type))
    .sort((a: any, b: any) => a.date_iso.localeCompare(b.date_iso))[0];
  const nextQuality = upcoming ? {
    date: upcoming.date_iso, dow: upcoming.dow, type: upcoming.type,
    label: upcoming.sub_label, mi: Number(upcoming.distance_mi) || 0,
  } : null;

  // Week mileage done so far.
  // #9 (audit 2026-06-16) · the "this week" window now derives from
  // user_settings.long_run_day (week ENDS on the long-run day) via the shared
  // weekWindowFor helper — the same boundary /api/plan/week + plan_weeks use.
  // Was hardcoded Monday, which mislabeled the week for non-Sunday-long
  // runners. No-op for David (long=Sun → Mon–Sun, identical to the old Monday).
  // #52 (audit 2026-06-16) · sum the CANONICAL deduper (mileageByDay, the single
  // volume source-of-truth per CLAUDE.md) over that window instead of the
  // deprecated MAX-per-day heuristic, so weekDone matches Today's "WEEK MI"
  // (glance-state already sums canonicalMileageByDay).
  const settings = await loadSettings(userId);
  const weekWindow = weekWindowFor(settings.long_run_day, today);
  const { startISO: weekStartISO, endISO: weekEndISO } = weekWindow;
  const weekByDay = await mileageByDay(userId, weekStartISO, today).catch(() => new Map());
  let weekDoneSum = 0;
  for (const { mi } of weekByDay.values()) weekDoneSum += mi;
  const weekDone = Math.round(weekDoneSum * 10) / 10;

  // WEEK-READ-1 (2026-08-24) · planned is summed over the SAME seven days
  // `weekDone` is, and the same seven the strip draws — not over the
  // plan_weeks row today falls inside. See the note on `weekPlanned`.
  //
  // The days come out of `weeks`, which is already loaded, so this costs no
  // query: it is a re-slice of the block by date rather than by week id.
  const weekWindowDays = weeks
    .flatMap((w) => w.days)
    .filter((d) => d.date >= weekStartISO && d.date <= weekEndISO)
    .sort((a, b) => a.date.localeCompare(b.date));
  // Null, not zero, when the block does not cover this week at all — an
  // off-season gap or a block that has ended. Zero would read as "nothing is
  // planned this week", which is a claim; absent is the honest answer.
  const weekPlanned = weekWindowDays.length > 0
    ? Math.round(weekWindowDays.reduce((s, d) => s + d.mi, 0) * 10) / 10
    : null;

  // Race
  let race: TrainingState['race'] = null;
  if (plan.race_id) {
    // 2026-06-05 · backend audit P0-6 fix · scope race lookup by user.
    // Cite docs/2026-06-05-backend-audit.html § P0-6.
    const raceRow = (await pool.query(`SELECT slug, meta FROM races WHERE slug = $1 AND user_uuid = $2`, [plan.race_id, userId])).rows[0];
    if (raceRow) {
      const date = raceRow.meta?.date;
      const days_to_race = Math.round(
        (Date.parse(date + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 86400000
      );
      race = {
        slug: raceRow.slug, name: raceRow.meta?.name, date,
        goal: raceRow.meta?.goalDisplay ?? null, days_to_race,
      };
    }
  }

  return {
    plan_id: plan.id, today, race, phases, weeks,
    currentPhase, currentWeekIdx, nextQuality, weekDone, weekPlanned,
    weekWindow, weekWindowDays,
    last_adapted_at: plan.last_adapted_at,
    horizonRaise,
  };
}
