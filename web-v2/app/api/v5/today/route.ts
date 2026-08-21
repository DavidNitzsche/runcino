/**
 * GET /api/v5/today
 *
 * One call for the v5 iPhone Today surface (screens 5a/5b/5c/13a/14a/15a/17a).
 * Decides WHICH Today this is — the client never infers it from a pile of
 * nulls (`V5Today.state`). Composes from the existing engine libs; the
 * translation to the wire shape lives in `lib/faff/v5-today.ts`, which is
 * the pure, unit-tested half of this feature. This file is the DB-I/O half:
 * load everything the composer needs, then hand it off.
 *
 * Race-mode only (design contract §"Scope"). A runner without a goal race —
 * coached / just-run / distance-goal-without-a-race — gets `notOnPhoneYet`,
 * a refusal, not three blank screens.
 *
 * Read `docs/design/iphone-v5/BUILD-PLAN.md` "Backend gaps found by audit"
 * for B1-B14; this route closes B3, B4, B10, B12, B13 (the Today-facing
 * ones) together with the fixes in lib/plan/adapt.ts and
 * lib/coach/glance-state.ts it depends on.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { zoneTargetForWorkout } from '@/lib/coach/zone-target';
import { requireUserId } from '@/lib/auth/session';
import { runnerToday, runnerTimezone } from '@/lib/runtime/runner-tz';
import { loadActivePlan } from '@/lib/plan/lookup';
import { loadGlanceState } from '@/lib/coach/glance-state';
import { loadPlanWeek } from '@/lib/plan/week-loader';
import { derivePurpose, type Phase as PurposePhase, type WorkoutType as PurposeWorkoutType } from '@/lib/coach/run-purpose';
import { prescriptionFor, derivePaces, type WorkoutType as PrescriptionWorkoutType } from '@/lib/training/prescriptions';
import { computeFueling, type WorkoutFuelingType } from '@/lib/training/fueling';
import { deriveRecap } from '@/lib/coach/run-recap';
import { recommendShoe, shoeDisplayName, planTypeToShoeType, type GarageShoe } from '@/lib/shoe/recommend';
import { computeShoeMileage } from '@/lib/shoe/mileage';
import { runDaySql, runNotMergedSql, runDistanceMiSql } from '@/lib/runs/run-shape';
import { beltAverages } from '@/lib/runs/belt-averages';
import { loadPaceZoneEvent } from '@/lib/plan/pace-drop-event';
import {
  composeV5Today,
  type V5TodayContext,
  type V5PrescriptionLike,
  type V5RecentRunCtx,
  type V5Row,
} from '@/lib/faff/v5-today';

export const dynamic = 'force-dynamic';

/** `sick_episodes.symptoms` codes → display copy (18a-style human labels).
 *  Unknown codes pass through verbatim rather than vanishing — a symptom the
 *  runner picked should never silently disappear from their own report. */
const SYMPTOM_LABELS: Record<string, string> = {
  head_cold: 'Head cold',
  chest: 'Chest',
  fever: 'Fever',
  gi: 'Upset stomach',
  aches: 'Body aches',
  fatigue: 'Fatigue',
  voice: 'Lost voice',
  other: 'Something else',
};
function symptomLabel(code: string): string {
  return SYMPTOM_LABELS[code] ?? code;
}

/** Today's own entry point onto 18a (design contract: "reached from a coach
 *  line, not from the bar"). Present only when the active plan carries an
 *  UNACKNOWLEDGED pace-drop event — `GET /api/v5/paces` itself now 404s once
 *  the event is acknowledged (see that route's own comment), so this reads
 *  the same event and applies the same filter, rather than trusting presence
 *  alone and showing a stale nudge forever. */
async function loadPaceNoteRow(planId: string | null): Promise<V5Row | null> {
  if (!planId) return null;
  const event = await loadPaceZoneEvent(planId).catch(() => null);
  if (!event || event.acknowledgedAt) return null;
  return {
    id: 'paces-moved',
    label: event.direction === 'slower' ? 'Paces moved slower' : 'Paces moved faster',
    sub: 'See what changed and confirm it',
    value: null,
    action: 'paces_moved',
  };
}

const PHASE_FROM_LABEL: Record<string, PurposePhase> = {
  BASE: 'BASE', base: 'BASE',
  BUILD: 'BUILD', build: 'BUILD',
  PEAK: 'PEAK', peak: 'PEAK',
  TAPER: 'TAPER', taper: 'TAPER',
  RECOVERY: 'RECOVERY', recovery: 'RECOVERY',
};
const TYPE_NORMALIZE: Record<string, PurposeWorkoutType> = {
  easy: 'easy', long: 'long', tempo: 'tempo', threshold: 'threshold',
  intervals: 'intervals', fartlek: 'fartlek', progression: 'progression',
  recovery: 'recovery', shakeout: 'shakeout', race: 'race', rest: 'rest',
  race_week_tuneup: 'threshold',
};

/** "THRESHOLD" / "threshold" → "Threshold". Null-safe. Applied to whatever
 *  the row happens to store (sub_label is upper, the raw type column is
 *  lower) so the kicker's "was X" reads as coach voice either way. */
function titleCase(s: string | null | undefined): string | null {
  if (!s || !s.trim()) return null;
  const t = s.trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** "3:12 AM" in the runner's own timezone, or "overnight" when we cannot read
 *  one.
 *
 *  RULE ONE. The fallback used to be a literal `'America/Los_Angeles'`, which
 *  is a fabricated reading dressed as a precise one: a runner in London whose
 *  timezone read failed was told their session changed at 3:12 AM when it was
 *  11:12 AM where they were standing, and nothing on the panel hinted the
 *  clock was a guess. `V5Convergence.updatedAt` is a bare string with no
 *  provenance field, so there is no mark available to soften it with — which
 *  leaves saying less. "Updated overnight" is true in every timezone. */
async function formatLocalClock(userId: string, ts: string): Promise<string> {
  const tz = await runnerTimezone(userId).catch(() => null);
  if (!tz) return 'overnight';
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz,
  }).format(new Date(ts));
}

/** Cumulative elevation profile from per-mile split deltas. Splits carry the
 *  delta under any of four field-name conventions (run-terrain.ts's own
 *  audit note); reads whichever is present, defaults an absent one to 0, and
 *  cumulative-sums from a start of 0. Null (not zero) when there are no
 *  splits to derive it from — an absent profile, not a fabricated flat one. */
function elevationFromSplits(splits: Array<Record<string, unknown>> | null | undefined): number[] | null {
  if (!Array.isArray(splits) || splits.length === 0) return null;
  let cum = 0;
  const out: number[] = [];
  for (const s of splits) {
    const delta = Number(
      s.elev_ft ?? s.elevation_difference ?? s.elev_change_ft ?? s.elevDeltaFt ?? 0,
    ) || 0;
    cum += delta;
    out.push(Math.round(cum));
  }
  return out;
}

async function loadShoes(userId: string): Promise<GarageShoe[]> {
  const [rows, mileageMap] = await Promise.all([
    pool.query<{ id: number; brand: string; model: string; run_types: string[] | null; retired: boolean; preferred: boolean | null }>(
      `SELECT id, brand, model, run_types, retired, preferred FROM shoes WHERE user_uuid = $1`,
      [userId],
    ).then((r) => r.rows).catch(() => []),
    computeShoeMileage(userId).catch(() => new Map<number, number>()),
  ]);
  return rows.map((r) => ({
    id: r.id,
    brand: r.brand,
    model: r.model,
    runTypes: Array.isArray(r.run_types) ? r.run_types : [],
    mileage: mileageMap.get(r.id) ?? 0,
    preferred: r.preferred,
    retired: r.retired,
  }));
}


/** Midpoint of a pace band, seconds per mile. Null unless both edges read. */
function midSec(lo: number | null | undefined, hi: number | null | undefined): number | null {
  if (lo == null && hi == null) return null;
  if (lo == null) return hi ?? null;
  if (hi == null) return lo;
  return (lo + hi) / 2;
}

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const url = new URL(req.url);
  const today = (url.searchParams.get('date') || await runnerToday(userId)).slice(0, 10);

  // ── Race-mode gate ────────────────────────────────────────────────────
  const activePlan = await loadActivePlan(userId);
  let raceMode = activePlan != null && (activePlan.mode === 'race-prep' || activePlan.race_id != null);
  if (!activePlan) {
    // No active plan right now — still race-mode if this runner has EVER
    // been on a race-prep block (the off-season gap between blocks, not a
    // runner who has never raced through this app).
    const everRacePrep = await pool.query(
      `SELECT 1 FROM training_plans WHERE user_uuid = $1 AND (mode = 'race-prep' OR race_id IS NOT NULL) LIMIT 1`,
      [userId],
    ).catch(() => ({ rows: [] as any[] }));
    raceMode = everRacePrep.rows.length > 0;
  }

  if (!raceMode) {
    const ctx: V5TodayContext = emptyContext(today, false);
    return NextResponse.json(composeV5Today(ctx));
  }

  const glance = await loadGlanceState(userId);
  const planWeek = await loadPlanWeek(userId, today);
  const todayWeekDay = planWeek.days.find((d) => d.is_today) ?? null;
  const glanceToday = glance.weekDays.find((d) => d.date === today) ?? null;

  const weekStripDays = planWeek.days.map((d) => ({
    id: d.plan_workout_id ?? `date:${d.date_iso}`,
    dateISO: d.date_iso,
    plannedType: d.type,
    subLabel: d.sub_label,
    isToday: d.is_today,
    isRest: d.type === 'rest',
    isDone: d.completedRunId != null || (d.done_mi != null && d.done_mi >= 0.5),
  }));

  const weekLine = activePlan
    ? await (async () => {
        const w = (await pool.query<{ week_idx: number }>(
          `SELECT week_idx FROM plan_weeks WHERE plan_id = $1 AND week_start_iso <= $2
            ORDER BY week_start_iso DESC LIMIT 1`,
          [activePlan.id, today],
        ).catch(() => ({ rows: [] as any[] }))).rows[0];
        const total = (await pool.query<{ n: string }>(
          `SELECT COUNT(*)::text AS n FROM plan_weeks WHERE plan_id = $1`,
          [activePlan.id],
        ).catch(() => ({ rows: [{ n: '0' }] }))).rows[0];
        return w ? `Week ${w.week_idx + 1} of ${total.n}` : null;
      })()
    : null;

  // ── Injury flare (Gap B13) — checked first; a flare owns the screen ────
  if (glance.activeInjury) {
    const inj = glance.activeInjury;
    const daysSince = Math.max(0, Math.round(
      (Date.parse(today + 'T12:00:00Z') - Date.parse(inj.start_date + 'T12:00:00Z')) / 86400000,
    ));
    const since = daysSince === 0 ? 'Flagged today' : daysSince === 1 ? 'Flagged yesterday' : `Flagged ${daysSince} days ago`;
    const verdictBySeverity: Record<string, string> = {
      minor: `Easy running only. The ${inj.site} gets a few easy days before anything harder comes back.`,
      moderate: `Rest, not run. The ${inj.site} gets time to settle before anything reintroduces load.`,
      major: `Rest, not run. The ${inj.site} needs a real break. This is not a session to run through.`,
    };
    const returnAvailable = inj.expected_return_date != null && today >= inj.expected_return_date;
    const ctx: V5TodayContext = emptyContext(today, true);
    ctx.weekStripDays = weekStripDays;
    ctx.injury = {
      area: inj.site.charAt(0).toUpperCase() + inj.site.slice(1),
      since,
      verdict: verdictBySeverity[inj.severity] ?? verdictBySeverity.moderate,
      whatChanged: [{
        id: 'this-week', label: 'This week',
        sub: glance.weekPlanned != null
          ? `${glance.weekDone.toFixed(1)} of ${glance.weekPlanned.toFixed(1)} mi, easy and walking only`
          : `${glance.weekDone.toFixed(1)} mi, easy and walking only`,
        value: null, action: null,
      }],
      checkIn: [
        { id: 'better', label: 'Better today', sub: 'Loosen back in gradually tomorrow', value: null, action: 'checkin_better' },
        { id: 'same', label: 'About the same', sub: 'One more day off, then reassess', value: null, action: 'checkin_same' },
        { id: 'worse', label: 'Worse', sub: 'Worth a call with someone who can look at it', value: null, action: 'checkin_worse' },
      ],
      returnAvailable,
    };
    return NextResponse.json(composeV5Today(ctx));
  }

  // ── Sick — checked second, a quiet panel too but NOT the injury screen ──
  //
  // A sick day is systemic illness (`sick_episodes`: symptoms + fever,
  // self-reported), not a diagnosed musculoskeletal issue (`runner_injuries`,
  // the block above). It still pauses today — same quiet, no-gradient
  // treatment as injury — but the check-in is a daily TREND
  // (better/same/worse/recovered → `POST /api/sick/recovery`), not a
  // one-shot note, and 'recovered' clears the episode server-side rather
  // than gating a return-to-running ladder the way injury's does. An active
  // injury takes precedence over a concurrent sick day (rarer overlap, and
  // the injury's load restriction is the more specific one).
  if (glance.activeSick) {
    const sick = glance.activeSick;
    const daysSince = Math.max(0, Math.floor(sick.days_active));
    const since = daysSince === 0 ? 'Flagged today' : daysSince === 1 ? 'Flagged yesterday' : `Flagged ${daysSince} days ago`;
    const verdict = sick.has_fever
      ? 'Rest, not run. A fever means the body is fighting something. Running adds load it does not have to spare.'
      : 'Rest, not run. Whatever this is gets a real day off before anything asks more of you.';
    const ctx: V5TodayContext = emptyContext(today, true);
    ctx.weekStripDays = weekStripDays;
    ctx.sick = {
      symptoms: sick.symptoms.map(symptomLabel),
      hasFever: sick.has_fever,
      since,
      verdict,
      checkIn: [
        { id: 'better', label: 'Better today', sub: 'Still resting, trending the right way', value: null, action: 'trend_better' },
        { id: 'same', label: 'About the same', sub: 'Another day off, then reassess', value: null, action: 'trend_same' },
        { id: 'worse', label: 'Worse', sub: 'Worth a call with someone who can look at it', value: null, action: 'trend_worse' },
        { id: 'recovered', label: "I'm better, let's run", sub: 'Clears this and hands today back to the plan', value: null, action: 'trend_recovered' },
      ],
    };
    return NextResponse.json(composeV5Today(ctx));
  }

  // ── Week off (Gap B10a) — a deliberate break, detected structurally ────
  // `replan-scenarios.ts`'s travel scenario zeroes the window's rows and
  // labels them sub_label='AWAY' (AWAY_LABEL). That is the only "deliberate
  // break" this engine can currently name — see the report's honesty note
  // on the "planned zero week" half of this gap, which has no distinct
  // signal from an ordinary cutback week and is NOT guessed at here.
  if (todayWeekDay?.sub_label === 'AWAY' && activePlan) {
    const awayRows = (await pool.query<{ date_iso: string }>(
      `SELECT date_iso::text AS date_iso FROM plan_workouts
        WHERE plan_id = $1 AND sub_label = 'AWAY'
        ORDER BY date_iso ASC`,
      [activePlan.id],
    ).catch(() => ({ rows: [] as any[] }))).rows.map((r) => r.date_iso);
    // The contiguous block of AWAY dates containing `today`.
    let fromISO = today, toISO = today;
    if (awayRows.length > 0) {
      const set = new Set(awayRows);
      let cursor = today;
      while (set.has(cursor)) { fromISO = cursor; cursor = plusDaysISO(cursor, -1); }
      cursor = today;
      while (set.has(cursor)) { toISO = cursor; cursor = plusDaysISO(cursor, 1); }
    }
    const nextRow = (await pool.query<{ type: string; distance_mi: string; sub_label: string | null }>(
      `SELECT type, distance_mi, sub_label FROM plan_workouts
        WHERE plan_id = $1 AND date_iso > $2 AND sub_label IS DISTINCT FROM 'AWAY'
        ORDER BY date_iso ASC LIMIT 1`,
      [activePlan.id, toISO],
    ).catch(() => ({ rows: [] as any[] }))).rows[0];
    const nextUp = nextRow
      ? {
          label: `${dowName(plusDaysISO(toISO, 1))} · ${nextRow.type === 'rest' ? 'Rest' : (Number(nextRow.distance_mi) > 0 ? `${nextRow.type} ${Number(nextRow.distance_mi)} mi` : nextRow.type)}`,
          sub: '',
        }
      : null;
    const ctx: V5TodayContext = emptyContext(today, true);
    ctx.weekStripDays = weekStripDays;
    ctx.weekOff = {
      reason: 'Away from the plan',
      fromISO, toISO,
      nextUp,
    };
    return NextResponse.json(composeV5Today(ctx));
  }

  // ── Off-season (Gap B10b) — no active plan, race-mode history exists ───
  if (!activePlan) {
    const lastRace = (await pool.query<{ name: string; date: string }>(
      `SELECT COALESCE(meta->>'name', slug) AS name, meta->>'date' AS date
         FROM races
        WHERE user_uuid::text = $1 AND meta->>'priority' IN ('A', 'B')
          AND meta->>'date' IS NOT NULL AND (meta->>'date')::date < $2::date
        ORDER BY (meta->>'date')::date DESC LIMIT 1`,
      [userId, today],
    ).catch(() => ({ rows: [] as any[] }))).rows[0];
    let sinceLastRace: string | null = null;
    if (lastRace) {
      const days = Math.max(0, Math.round(
        (Date.parse(today + 'T12:00:00Z') - Date.parse(lastRace.date + 'T12:00:00Z')) / 86400000,
      ));
      const weeks = Math.round(days / 7);
      sinceLastRace = weeks <= 0
        ? `Since ${lastRace.name}`
        : `${weeks} week${weeks === 1 ? '' : 's'} since ${lastRace.name}`;
    }
    // Loose weekly range · the runner's own trailing 8-week average, banded
    // ±5 mi and rounded to the nearest 5. Data-derived, not a doctrine
    // constant — deliberately loose per the design contract.
    let weeklyRange: string | null = null;
    try {
      const { canonicalMileageByDay } = await import('@/lib/runs/merge');
      const from = plusDaysISO(today, -56);
      const byDay = await canonicalMileageByDay(userId, from, today);
      const totalMi = Array.from(byDay.values()).reduce((s, v) => s + v.mi, 0);
      const avgWeekly = totalMi / 8;
      const lo = Math.max(0, Math.round((avgWeekly - 5) / 5) * 5);
      const hi = Math.round((avgWeekly + 5) / 5) * 5;
      if (hi > 0) weeklyRange = `${lo} to ${hi} miles a week`;
    } catch { /* leave null · no fabricated range */ }

    const ctx: V5TodayContext = emptyContext(today, true);
    ctx.weekStripDays = weekStripDays;
    ctx.offSeason = {
      sinceLastRace,
      silenceReason: 'No block is written. Running is optional, and nothing here is measured against a goal.',
      weeklyRange,
    };
    return NextResponse.json(composeV5Today(ctx));
  }

  // ── The plan is live. Resolve today's prescription context. ───────────
  const todayPlan = glanceToday && glanceToday.plannedType !== 'unplanned'
    ? {
        type: glanceToday.plannedType,
        subLabel: glanceToday.plannedLabel,
        distanceMi: glanceToday.plannedMi,
        originalType: glanceToday.adaptation?.originalType ?? null,
        originalSubLabel: glanceToday.adaptation?.originalSubLabel ?? null,
      }
    : null;

  const purposeType = TYPE_NORMALIZE[(todayPlan?.type ?? '').toLowerCase()] ?? 'unplanned';
  const purposePhase: PurposePhase | null = glance.phaseLabel ? (PHASE_FROM_LABEL[glance.phaseLabel] ?? null) : null;
  const purpose = derivePurpose({
    type: purposeType, phase: purposePhase,
    plannedMi: todayPlan?.distanceMi ?? 0,
    raceDistanceMi: glance.raceGoalDistanceMi, weeksToRace: null,
  });
  const why = [purpose.verdict, ...purpose.facts].filter(Boolean).join(' ');

  // ── Already ran today? → after_run (5b/5c) ─────────────────────────────
  const ranToday = glanceToday && glanceToday.doneMi >= 0.5;
  if (ranToday) {
    const runRow = (await pool.query<{ id: string; data: Record<string, any> }>(
      `SELECT id::text AS id, data FROM runs
        WHERE user_uuid = $1 AND ${runNotMergedSql()}
          AND ${runDaySql()} = $2
        ORDER BY ${runDistanceMiSql()} DESC NULLS LAST
        LIMIT 1`,
      [userId, today],
    ).catch(() => ({ rows: [] as any[] }))).rows[0];

    if (runRow) {
      const data = runRow.data ?? {};
      const indoor = data.indoor === true || data.source === 'treadmill';
      const distanceMi = Number(data.distanceMi) || 0;
      const durationSec = Number(data.durationSec) || Number(data.movingTimeS) || Number(data.elapsedTimeS) || null;
      const paceSPerMi = Number(data.paceSPerMi) || (durationSec && distanceMi ? durationSec / distanceMi : null);

      // Treadmill telemetry — averaged across watch_completion phases
      // (Gap B12). Speed/incline live per-phase, not on the run row itself.
      let speedMph: number | null = null, inclinePct: number | null = null;
      if (indoor) {
        const intent = (await pool.query<{ value: any }>(
          `SELECT value FROM coach_intents
            WHERE COALESCE(user_uuid, user_id) = $1 AND reason = 'watch_completion'
              AND (CASE WHEN field ~ '-[0-9]{4}-[0-9]{2}-[0-9]{2}(#[0-9]+)?$'
                        THEN field ~ ('-' || $2::text || '(#[0-9]+)?$')
                        ELSE ts::date = $2::date END)
            ORDER BY ts DESC LIMIT 1`,
          [userId, today],
        ).catch(() => ({ rows: [] as any[] }))).rows[0];
        let payload: any = intent?.value ?? null;
        if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch { payload = null; } }
        // 2026-08-21 · this was a PLAIN mean over every phase in the
        // payload — including phases the runner never reached (which carry
        // the plan's nominal target by design, and no duration), and
        // weighting a 2-minute recovery the same as a 20-minute work block.
        // See lib/runs/belt-averages.ts for the argument and the tests.
        const belt = beltAverages(payload?.phases);
        speedMph = belt.speedMph;
        inclinePct = belt.inclinePct;
      }

      const zonePcts = data.hrZonePcts as Record<string, number> | undefined;
      const zoneShares = zonePcts
        ? [zonePcts.z1 ?? 0, zonePcts.z2 ?? 0, zonePcts.z3 ?? 0, zonePcts.z4 ?? 0, zonePcts.z5 ?? 0]
        : null;

      // Asked pace/HR: today's plan target where present, else null (by feel).
      const planRow = (await pool.query<{ pace_target_s_per_mi: number | null; workout_spec: any }>(
        `SELECT pace_target_s_per_mi, workout_spec FROM plan_workouts
          WHERE plan_id = $1 AND date_iso = $2 LIMIT 1`,
        [activePlan.id, today],
      ).catch(() => ({ rows: [] as any[] }))).rows[0];
      const askedPaceSPerMi = planRow?.pace_target_s_per_mi ?? null;
      const askedHrCap: number | null = planRow?.workout_spec
        ? Number(planRow.workout_spec.hr_cap_bpm ?? planRow.workout_spec.hr_target_bpm ?? planRow.workout_spec.lthr_bpm) || null
        : null;
      // Only `hr_cap_bpm` is a genuine "stay under this" ceiling — the other
      // two links in the fallback above are a target to hover near and a
      // bare LTHR reference, both fine to fall back to for DISPLAY but wrong
      // to grade a tone against. See V5RecentRunCtx.askedHrIsHardCap's own
      // doc comment in lib/faff/v5-today.ts.
      const askedHrIsHardCap = Boolean(planRow?.workout_spec && Number(planRow.workout_spec.hr_cap_bpm) > 0);

      const rpe = (await pool.query<{ rpe: number | null }>(
        `SELECT rpe FROM post_run_rpe WHERE user_uuid = $1 AND activity_id = $2 LIMIT 1`,
        [userId, data.activityId ?? data.id ?? runRow.id],
      ).catch(() => ({ rows: [] as any[] }))).rows[0];

      const recap = deriveRecap({
        type: purposeType, phase: purposePhase,
        plannedMi: todayPlan?.distanceMi ?? 0,
        plannedPaceSPerMi: askedPaceSPerMi,
        plannedHrCap: askedHrCap,
        actualMi: distanceMi,
        actualPaceSPerMi: paceSPerMi,
        actualDurationSec: durationSec,
        actualAvgHr: data.avgHr != null ? Number(data.avgHr) : null,
        actualMaxHr: data.maxHr != null ? Number(data.maxHr) : null,
        splits: Array.isArray(data.splits) ? data.splits : undefined,
        weather: null,
        terrain: null,
      });

      const shoes = await loadShoes(userId);
      const shoeType = planTypeToShoeType(todayPlan?.type ?? null);
      const shoeRow = data.shoe_id != null
        ? shoes.find((s) => String(s.id) === String(data.shoe_id)) ?? recommendShoe(shoes, shoeType)
        : recommendShoe(shoes, shoeType);

      const recentRun: V5RecentRunCtx = {
        runId: runRow.id,
        distanceMi, durationSec, paceSPerMi,
        avgHr: data.avgHr != null ? Number(data.avgHr) : null,
        indoor, speedMph, inclinePct,
        askedPaceSPerMi, askedHrCap, askedHrIsHardCap,
        effortAsked: null,
        effortLogged: rpe?.rpe ?? null,
        verdict: recap.verdict,
        zoneShares, zoneTarget: zoneTargetForWorkout(todayPlan?.type ?? null),
        elevationSamples: indoor ? null : elevationFromSplits(data.splits),
        elevGainFt: data.elevGainFt != null ? Number(data.elevGainFt) : null,
        weekDoneMi: glance.weekDone, weekPlannedMi: glance.weekPlanned,
        shoeWorn: shoeRow ? { id: String(shoeRow.id), name: shoeDisplayName(shoeRow) ?? 'Shoe', mi: shoeRow.mileage } : null,
        niggleFlagged: glance.activeNiggle?.body_part ?? null,
      };

      const ctx: V5TodayContext = emptyContext(today, true);
      ctx.todayPlan = todayPlan;
      ctx.weekLine = weekLine;
  // The panel's line, beside the week line. Where the runner is in the block
  // beats what today's date is: the strip already highlights the day and the
  // place label already says TODAY.
  //
  // `phaseLabel` arrives SHOUTED ("MAINTENANCE", "RACE-SPECIFIC") because it
  // is an enum, not copy. The display register uppercases what it needs to;
  // copy should not arrive pre-shouted.
  ctx.phaseLine = phaseWords(glance.phaseLabel);
      ctx.weekStripDays = weekStripDays;
      ctx.why = why;
      ctx.whereYouAre = buildWhereYouAre(glance);
      ctx.recentRun = recentRun;
      ctx.paceNote = await loadPaceNoteRow(activePlan?.id ?? null);
      return NextResponse.json(composeV5Today(ctx));
    }
  }

  // ── Convergence check (Gap B3/B4) — did last night's 03:00 pass
  // downgrade today's session? ─────────────────────────────────────────
  let convergence: V5TodayContext['convergence'] = null;
  if (todayPlan?.originalType && glanceToday?.plannedId) {
    const intentRow = (await pool.query<{ value: any; ts: string }>(
      `SELECT value, ts::text AS ts FROM coach_intents
        WHERE COALESCE(user_uuid, user_id) = $1 AND reason = 'plan_adapt_downgrade'
          AND field = $2
        ORDER BY ts DESC LIMIT 1`,
      [userId, glanceToday.plannedId],
    ).catch(() => ({ rows: [] as any[] }))).rows[0];
    let payload: any = intentRow?.value ?? null;
    if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch { payload = null; } }
    if (payload?.convergence) {
      const updatedAt = intentRow ? await formatLocalClock(userId, intentRow.ts) : '';
      const readings: Record<string, { value: string; baseline: string }> = {};
      const evidence = payload.convergence;
      if (glance.sleep7Avg != null) {
        readings.sleep = { value: `${glance.sleep7Avg.toFixed(1)}h`, baseline: 'Your 7-day median' };
      }
      if (glance.hrvCurrent != null && glance.hrvBaseline != null) {
        readings.autonomic = { value: `${glance.hrvCurrent} ms`, baseline: `Your baseline is ${glance.hrvBaseline} ms` };
      }
      if (glance.rhrCurrent != null && glance.rhrBaseline != null) {
        readings.cardiac = { value: `${glance.rhrCurrent}`, baseline: `Your baseline is ${glance.rhrBaseline}, 3-day average` };
      }
      if (glance.loadAcwr != null) {
        readings.load = { value: glance.loadAcwr.toFixed(2), baseline: 'Your usual acute:chronic ratio' };
      }
      readings.subjective = { value: 'Reported', baseline: 'Yesterday, planned easy' };
      convergence = {
        updatedAt,
        // "was Threshold", coach-voice title case — never the raw, shouty
        // sub_label ("THRESHOLD") the row happens to store.
        wasType: titleCase(todayPlan.originalSubLabel ?? todayPlan.originalType),
        wasSubLabel: todayPlan.originalSubLabel,
        verdict: evidence,
        readings,
        coachLine: String(payload.why ?? ''),
      };
    }
  }

  // ── Before-run panel: prescription, groups, dose, stats ────────────────
  const dp = derivePaces({ lthr: glance.lthr, goal_seconds: glance.raceGoalSeconds, goal_distance_mi: glance.raceGoalDistanceMi });
  const prescriptionType = toPrescriptionType(todayPlan?.type ?? null);
  // The runner's OWN prescribed pace for this session type, in s/mi. Hoisted
  // above the fuelling call because two things downstream need it and both
  // used to invent their own number instead: the kicker (fixed) and the
  // fuelling duration estimate (fixed here). Null when we cannot read a pace —
  // callers must degrade, never substitute a constant.
  const paceForType =
    prescriptionType === 'easy' ? midSec(dp.easySecLo, dp.easySecHi)
    : prescriptionType === 'long' ? midSec(dp.longSecLo, dp.longSecHi)
    : prescriptionType === 'tempo' ? midSec(dp.tempoSecLo, dp.tempoSecHi)
    : prescriptionType === 'threshold' ? dp.thresholdSec
    : prescriptionType === 'intervals' ? dp.intervalSec
    : midSec(dp.easySecLo, dp.easySecHi);
  const prescription = todayPlan
    // `?? 30` handed a 30 mi/wk assumption to a runner whose planned week we
    // could not read, and prescriptionFor sizes fallback distances and the
    // marathon-pace gate off exactly that figure. LOWVOL-4 hardened that
    // function so an unknown week yields no number rather than an invented
    // one; this caller was quietly reintroducing the constant it removed.
    // 0 means unknown, which is what the function already knows how to do —
    // and the day's real distance still comes from `todayPlan.distanceMi`.
    ? prescriptionFor(prescriptionType, glance.weekPlanned ?? 0, { lthr: glance.lthr, goal_seconds: glance.raceGoalSeconds, goal_distance_mi: glance.raceGoalDistanceMi }, todayPlan.distanceMi)
    : null;

  const fuelingType: WorkoutFuelingType =
    prescriptionType === 'long' || prescriptionType === 'race' ? prescriptionType
    : prescriptionType === 'threshold' || prescriptionType === 'tempo' || prescriptionType === 'intervals' ? 'quality'
    : prescriptionType === 'rest' ? 'rest' : 'easy';
  // RULE ONE. This used to be `total_mi * 9` — the same hardcoded 9 min/mi
  // the kicker was caught inventing, in the statement right above it, and it
  // was never migrated when the kicker was. A fuelling plan sized off a
  // made-up pace decides whether the runner is told to carry gels, so the
  // fabricated minute count reaches the screen as a real instruction.
  // `paceForType` is the runner's own prescribed pace and is nil when we
  // cannot read one — in which case the estimate is 0, computeFueling
  // prescribes nothing, and the fuel row simply does not appear. A missing
  // row beats an invented gel.
  const fuelingDurationEstMin =
    prescription && paceForType != null && paceForType > 0
      ? Math.round(((prescription.total_mi || 0) * paceForType) / 60)
      : 0;
  const fueling = prescription
    ? computeFueling({
        durationEstMin: fuelingDurationEstMin,
        distanceMi: prescription.total_mi,
        raceDistanceMi: glance.raceGoalDistanceMi,
        workoutType: fuelingType,
        tempF: null, daysToARace: glance.daysToARace,
      })
    : null;

  const prescriptionLike: V5PrescriptionLike | null = prescription
    ? {
        type: prescription.type, headline: prescription.headline, why: prescription.why,
        steps: prescription.steps.map((s) => ({
          label: s.label, distance_mi: s.distance_mi, reps: s.reps,
          rep_distance_mi: s.rep_distance_mi, duration: s.duration,
          pace_target: s.pace_target, hr_target: s.hr_target, note: s.note,
          recovery: s.recovery,
        })),
        total_mi: prescription.total_mi,
        fueling: fueling ? { needed: fueling.needed, shortLine: fueling.shortLine } : null,
      }
    : null;

  const shoes = await loadShoes(userId);
  const shoeType = planTypeToShoeType(todayPlan?.type ?? null);
  // 2026-08-20 · iPhone v5 Today audit. The runner's own quick-swap pick for
  // `today` (`day_actions` action='shoe', note=shoe_id — POST
  // /api/today/shoe) beats the recommendation. Without this read the pick
  // vanished on the very next load: the write landed (and — per that
  // route's own comment — reconciled onto any run ALREADY logged that day),
  // but this row kept showing `recommendShoe`'s guess forever, because
  // nothing here ever asked `day_actions` what the runner actually chose.
  const shoePickRow = (await pool.query<{ note: string | null }>(
    `SELECT note FROM day_actions
      WHERE COALESCE(user_uuid, user_id) = $1 AND date_iso = $2 AND action = 'shoe'
      LIMIT 1`,
    [userId, today],
  ).catch(() => ({ rows: [] as any[] }))).rows[0];
  const pickedShoeId = shoePickRow?.note ?? null;
  const shoePick = (pickedShoeId ? shoes.find((s) => String(s.id) === pickedShoeId) : undefined)
    ?? recommendShoe(shoes, shoeType);

  const beforeYouGo: V5Row[] = [];
  if (shoePick) {
    beforeYouGo.push({
      id: 'shoe', label: shoeDisplayName(shoePick) ?? 'Shoe',
      sub: `${Math.round(shoePick.mileage)} mi on them`, value: null, action: 'change_shoe',
    });
  }
  if (fueling?.needed) {
    beforeYouGo.push({ id: 'fuel', label: 'Fuel', sub: fueling.shortLine, value: null, action: null });
  }
  if (todayPlan && todayPlan.type !== 'rest') {
    beforeYouGo.push({ id: 'move', label: 'Move or skip', sub: 'Move to another day, or skip it', value: null, action: 'move_skip' });
  }

  const raceDay = todayPlan?.type === 'race';

  const ctx: V5TodayContext = emptyContext(today, true);
  ctx.todayPlan = todayPlan;
  ctx.weekLine = weekLine;
  // The phase belongs on every branch that composes a real panel, not just
  // the after-run one — a before-run day was falling back to the date and
  // printing it twice, once in the place label and once underneath.
  ctx.phaseLine = phaseWords(glance.phaseLabel);
  ctx.weekStripDays = weekStripDays;
  ctx.prescription = prescriptionLike;
  // ── the kicker ────────────────────────────────────────────────────────
  //
  // Duration on a day there is something to do. On a rest day there is
  // neither, and "about 0 min" is not a duration — it is the arithmetic
  // showing through — so the panel omits the line entirely.
  //
  // It used to multiply the distance by a HARDCODED 9 min/mi. That is a
  // made-up number reaching a runner's screen, and the honest one was already
  // in scope: `derivePaces` ran a few lines above and `paceBandStat` reads its
  // output on the very next statement. So the estimate is now built from the
  // runner's OWN prescribed pace for the session type, and falls back to
  // nothing rather than to a constant. `paceForType` is now hoisted above the
  // fuelling call, which had the identical `* 9` bug and was missed the first
  // time round — one definition, so a third caller cannot fork it again.
  const totalMi = prescription ? (prescription.total_mi || 0) : 0;
  const kickerMin =
    totalMi > 0 && paceForType != null && paceForType > 0
      ? Math.round((totalMi * paceForType) / 60)
      : 0;
  ctx.weatherKicker = kickerMin > 0 ? `about ${kickerMin} min` : null;
  ctx.paceBandStat = todayPlan
    ? (prescriptionType === 'easy' ? fmtBand(dp.easySecLo, dp.easySecHi)
      : prescriptionType === 'long' ? fmtBand(dp.longSecLo, dp.longSecHi)
      : prescriptionType === 'threshold' ? fmtSingle(dp.thresholdSec)
      : prescriptionType === 'tempo' ? fmtBand(dp.tempoSecLo, dp.tempoSecHi)
      : prescriptionType === 'intervals' ? fmtSingle(dp.intervalSec)
      : null)
    : null;
  // A ceiling is a ceiling FOR SOMETHING. On a rest day there is no running
  // to hold under it, and the poster showed "HR ceiling 144 bpm" beside the
  // word REST. Same guard the pace band already has: no plan, no stat.
  ctx.hrCapStat = (todayPlan && prescriptionType !== 'rest' && dp.aerobicCapBpm != null)
    ? `${dp.aerobicCapBpm} bpm`
    : null;
  // The design's 5a poster shows a third stat, "effort" (an RPE band). No
  // engine constant prescribes one per workout type — Rule 1 in reverse: an
  // invented number is worse than a missing stat. Left null (the panel
  // degrades to two stats) rather than making one up; see the report's
  // honesty note on this field.
  ctx.effortStat = null;
  ctx.why = why;
  ctx.whereYouAre = buildWhereYouAre(glance);
  ctx.beforeYouGo = beforeYouGo;
  ctx.raceDay = raceDay;
  ctx.convergence = convergence;
  ctx.paceNote = await loadPaceNoteRow(activePlan?.id ?? null);

  return NextResponse.json(composeV5Today(ctx));
}

// ── Small local helpers ───────────────────────────────────────────────────


/**
 * "MAINTENANCE" -> "Maintenance", "RACE-SPECIFIC" -> "Race specific".
 * An enum is not copy; title-case it before it reaches a panel.
 */
function phaseWords(label: string | null | undefined): string | null {
  if (!label) return null;
  const words = String(label).toLowerCase().replace(/[_-]+/g, ' ').trim();
  if (!words) return null;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function emptyContext(todayISO: string, raceMode: boolean): V5TodayContext {
  return {
    todayISO, raceMode,
    todayPlan: null, weekLine: null, phaseLine: null, weekStripDays: [],
    prescription: null, weatherKicker: null, paceBandStat: null, hrCapStat: null, effortStat: null, why: null,
    whereYouAre: [], beforeYouGo: [], raceDay: false, recentRun: null,
    weekOff: null, offSeason: null, injury: null, convergence: null,
    paceNote: null, sick: null,
  };
}

function buildWhereYouAre(glance: Awaited<ReturnType<typeof loadGlanceState>>): V5Row[] {
  const rows: V5Row[] = [];
  if (glance.readiness?.score != null) {
    rows.push({
      id: 'readiness', label: 'Readiness',
      sub: glance.readiness.label ?? null,
      // RULE ONE. Readiness is a composite score — weighted HRV, RHR, sleep
      // and load, each banded against a rolling baseline. Nothing measured
      // it; a model produced it out of things that were. "82 / 100" printed
      // like a heart rate is the app asserting a precision it does not have.
      value: { text: `${glance.readiness.score} / 100`, modelled: true },
      action: null,
    });
  }
  rows.push({
    id: 'week', label: 'This week',
    sub: glance.weekPlanned != null ? `${glance.weekPlanned.toFixed(1)} mi planned` : null,
    value: { text: `${glance.weekDone.toFixed(1)} mi`, modelled: false },
    action: null,
  });
  if (glance.sleep7Avg != null) {
    rows.push({
      id: 'sleep', label: 'Sleep, 7-night average', sub: null,
      value: { text: `${glance.sleep7Avg.toFixed(1)}h`, modelled: false }, action: null,
    });
  }
  return rows;
}

function fmtBand(loS: number | null, hiS: number | null): string | null {
  if (loS == null || hiS == null) return null;
  const f = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  return `${f(loS)}-${f(hiS)}/mi`;
}
function fmtSingle(s: number | null): string | null {
  if (s == null) return null;
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}/mi`;
}

function plusDaysISO(iso: string, days: number): string {
  const d = new Date(Date.parse(iso + 'T12:00:00Z') + days * 86400000);
  return d.toISOString().slice(0, 10);
}

const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function dowName(iso: string): string {
  return DOW_FULL[new Date(iso + 'T12:00:00Z').getUTCDay()];
}

/**
 * Narrow the plan's raw `type` column to the set `prescriptionFor` actually
 * builds a real card for (its `default` arm otherwise returns an empty "No
 * workout scheduled" card even on a day that DOES have one). Mirrors
 * TYPE_NORMALIZE's race_week_tuneup → threshold alias (the /today/purpose
 * route's own precedent) and extends it to the handful of plan-generator
 * types the /api/prescription route's narrower VALID list also excludes —
 * each mapped to the nearest case prescriptionFor implements, not dropped
 * to a blank card.
 */
function toPrescriptionType(plannedType: string | null): PrescriptionWorkoutType {
  const t = (plannedType ?? '').toLowerCase();
  switch (t) {
    case 'easy': case 'long': case 'tempo': case 'threshold': case 'intervals':
    case 'race': case 'shakeout': case 'rest': case 'unplanned':
      return t as PrescriptionWorkoutType;
    case 'race_week_tuneup': return 'threshold';
    case 'recovery': return 'easy';
    case 'fartlek': case 'progression': return 'tempo';
    case 'vo2max': return 'intervals';
    default: return 'easy';
  }
}


