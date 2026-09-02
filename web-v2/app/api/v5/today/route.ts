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
import { withRequestMemo } from '@/lib/runtime/request-memo';
import { pool } from '@/lib/db/pool';
import { rowOrNull } from '@/lib/db/read';
import { zoneTargetForWorkout, zoneTargetsForWorkout } from '@/lib/coach/zone-target';
import { computeZones } from '@/lib/training/zones';
import { runAvgHr, runMaxHr, type RunData } from '@/lib/runs/run-shape';
import { canonicalSessionType } from '@/lib/training/workout-type';
import { workAveragesFromPhases, formatWorkPace } from '@/lib/runs/work-averages';
import { rowsOrNull } from '@/lib/db/read';
import { composeRecap } from '@/lib/faff/recap-voice';
import { loadRunTwins, resolveElevationGain, resolveSplits } from '@/lib/runs/twins';
import { resolveThresholdHr } from '@/lib/training/lthr';
import { requireUserId } from '@/lib/auth/session';
import { composeWhy } from '@/lib/faff/why-voice';
import {
  resolveCoachingThesis, thesisLeadClause, coachSafeSessionName, wireThesis,
} from '@/lib/training/coaching-thesis';
import { runnerToday, runnerTimezone, runnerTimezoneOrPacific } from '@/lib/runtime/runner-tz';
import { loadActivePlanStrict } from '@/lib/plan/lookup';
import { outage } from '@/lib/route/failure';
import { loadGlanceState } from '@/lib/coach/glance-state';
import { mapWatchPhases } from '@/lib/coach/run-state';
import { deriveReadingScopes } from '@/lib/coach/reading-scope';
import { loadPlanWeek } from '@/lib/plan/week-loader';
import { resolveViewedPlanDay, viewedDayIsUnresolved } from '@/lib/faff/viewed-day';
import { derivePurpose, type Phase as PurposePhase, type WorkoutType as PurposeWorkoutType } from '@/lib/coach/run-purpose';
import {
  prescriptionFor, derivePaces, hrTargets, narrowToPrescriptionType, strictPrescriptionType,
  type WorkoutType as PrescriptionWorkoutType,
} from '@/lib/training/prescriptions';
import { cardFromSpec, cardWithoutSpec, cardForUnprescribableType, type SpecCard } from '@/lib/training/spec-card';
import {
  classifySession,
  sessionToleranceSec,
  paceShapeFor,
  phaseVerdictLabel,
  gradePhase,
} from '@/lib/training/execution-semantics';
import { splitRuleRegisters } from '@/lib/watch/build-workout';
import { fmtPace as fmtPaceShared, fmtMinutesCasual } from '@/lib/format/run';
import { computeFueling, type WorkoutFuelingType } from '@/lib/training/fueling';
import { deriveRecap } from '@/lib/coach/run-recap';
import { deriveWin } from '@/lib/coach/run-win';
import { recommendShoe, shoeDisplayName, planTypeToShoeType, type GarageShoe } from '@/lib/shoe/recommend';
import { computeShoeMileage } from '@/lib/shoe/mileage';
// The five elevation / splits / merge SQL fragments that used to be imported
// here went with the inline twin query — `lib/runs/twins.ts` builds that
// statement now, in one place, for all four surfaces.
import { runDaySql, runNotMergedSql, runDistanceMiSql } from '@/lib/runs/run-shape';
import { runFacts } from '@/lib/runs/run-facts';
import { beltAverages } from '@/lib/runs/belt-averages';
import { loadPaceZoneEvent } from '@/lib/plan/pace-drop-event';
import { loadVdotInputs } from '@/lib/training/vdot-inputs';
import { bestRecentVdot } from '@/lib/training/vdot';
import { resolveFitness } from '@/lib/fitness/fitness-model';
import { buildFitnessRow } from '@/lib/faff/fitness-read';
import { reconcileHrZones, coherentPace, coherentDurationSec, runCadenceSpm } from '@/lib/runs/coherence';
import { resolveHrZoneShares } from '@/lib/coach/hr-zone-bucket';
// `runAvgHr` / `runMaxHr` bound a reading to something a heart can do. Reading
// `data.avgHr` raw passes a sensor sentinel straight into the recap's prose.
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
  // PACENOTE-1 (2026-08-25) · the sub-line names WHAT MOVED THEM.
  //
  // "See what changed and confirm it" was written for the race case, where
  // there genuinely is something to confirm: 18a asks the runner the
  // representativeness question about the result. A TRAINING-sourced event has
  // no such question — the card is dismiss-only (see `PaceZoneEvent
  // .acknowledgedAt`) — so the old sub was asking the runner to ratify
  // something the screen never puts in front of them.
  //
  // It is also the moment worth naming. A pace that moves with no stated cause
  // is a number the runner has to take on trust; "your training did this" is
  // the whole reason the upward path exists.
  const sub = event.evidenceSource === 'training'
    ? 'Your quality sessions moved them. See what changed.'
    : 'See what changed and confirm it';
  return {
    id: 'paces-moved',
    label: event.direction === 'slower' ? 'Paces moved slower' : 'Paces moved faster',
    sub,
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
/**
 * The run's encoded route, whichever key this ingest path spelled it under.
 *
 * A SET, not a `??` ladder over `unknown` — the same identity defect that hid
 * a logged effort today. Both spellings are live: the watch writes
 * `routePolyline`, older Strava rows write `summaryPolyline`.
 */
function firstPolyline(d: Record<string, unknown>): string | null {
  for (const k of ['routePolyline', 'summaryPolyline'] as const) {
    const v = d[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

function elevationFromSplits(splits: Array<Record<string, unknown>> | null | undefined): number[] | null {
  if (!Array.isArray(splits) || splits.length === 0) return null;
  const KEYS = ['elev_ft', 'elevation_difference', 'elev_change_ft', 'elevDeltaFt'] as const;

  // NOT ONE SPLIT CARRIES AN ELEVATION KEY → NO PROFILE.
  //
  // This used to `?? 0` each delta, so a split array with no elevation data at
  // all — which is what the watch writes — produced [0, 0, 0, 0]: a flat line
  // at sea level, indistinguishable on screen from a genuinely flat run. The
  // card then SUMMED that line to get its climb and printed "0 ft up" for a
  // run whose own row recorded 128. A fabricated measurement, drawn as one,
  // over the top of the real number.
  //
  // Rule 3: no profile is a correct answer. The card says so in a line rather
  // than drawing an empty chart, and the climb comes from the run's measured
  // elevGainFt regardless.
  const measured = splits.some((s) => KEYS.some((k) => {
    const v = s[k];
    return v != null && Number.isFinite(Number(v));
  }));
  if (!measured) return null;

  let cum = 0;
  const out: number[] = [];
  for (const s of splits) {
    const raw = KEYS.map((k) => s[k]).find((v) => v != null && Number.isFinite(Number(v)));
    cum += Number(raw ?? 0) || 0;
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

/**
 * The Today surface is 570 lines of composition over ~35 reads. It had no
 * `try` in it at all, so any one of those reads throwing — a statement
 * timeout on `plan_workouts`, a dropped connection mid-`runs`, `sorry, too
 * many clients already` — left the handler by throwing, and the runner got
 * whatever Next.js emits for an unhandled route error.
 *
 * Forced, and each of these was an uncaught throw before this wrapper:
 * a 57014 on `plan_workouts`, a 57014 on `runs`, a 53300 on `profile`, and
 * an 08006 on any read at all.
 *
 * The body is extracted rather than indented so the diff is this comment
 * and a wrapper, not a 570-line reflow of code other agents are editing.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  // 2026-08-21 perf · read-only surface · one memo scope for the request so
  // the opted-in leaf readers answer once instead of once per caller. Scope
  // dies with the response; nothing is cached between requests. If this route
  // ever WRITES, the writer must memoDrop what it invalidates.
  return withRequestMemo(async () => {
    try {
      return await composeToday(req);
    } catch (err) {
      return outage('v5/today', err);
    }
  });
}

async function composeToday(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const url = new URL(req.url);
  const runnerTodayISO = (await runnerToday(userId)).slice(0, 10);
  const requestedDate = url.searchParams.get('date')?.slice(0, 10) || null;
  const today = requestedDate || runnerTodayISO;
  // Watch-completion date matching (below) needs the runner's own timezone,
  // not the server's — a UTC insert timestamp for a run logged in the
  // evening reads as tomorrow's date in UTC.
  // runnerTimezoneOrPacific, not the plain UTC-fallback variant — this is
  // exactly the "coach_intents watch-completion day bucketing" use case its
  // own doc comment names. A runner with no stored timezone is legacy
  // single-user-era data stamped in Pacific wall time, never UTC.
  const completionTz = await runnerTimezoneOrPacific(userId).catch(() => 'America/Los_Angeles');
  // 22b. THE SCREEN IS NOT IN THE PRESENT TENSE, SO NEITHER IS ITS CONTEXT.
  //
  // `loadGlanceState` takes no date — it reads readiness, the seven-night
  // sleep average and week-to-date mileage as of NOW. Rendered under a
  // heading that says WED 19 AUG, "Readiness 62 / 100" reads as how ready
  // the runner was on the Wednesday. It is how ready they are on the Friday
  // they are reading it.
  //
  // This is rule one's sibling: not a modelled number wearing a measured
  // number's clothes, but a present-tense number wearing a past-tense one's.
  // The fix is the same shape as the rest of 22b — what belongs to today
  // stays on today.
  const isSteppedDay = today !== runnerTodayISO;

  // ── Race-mode gate ────────────────────────────────────────────────────
  //
  // RULE THREE. Everything below this gate is load-bearing in the strongest
  // sense the rule has: failing it does not omit a section, it tells the
  // runner the product is not for them. `not_on_phone_yet` reads "Not here
  // yet · This phone build only coaches toward a goal race", with no retry
  // and nothing to suggest anything went wrong.
  //
  // Both reads used to swallow their own failure into an empty result, so a
  // Postgres blip and "has never raced through this app" were the same
  // value, and a marathoner in week 9 of a block got the refusal. `Strict`
  // and the missing `.catch` are what make a failed read reach the wrapper
  // above and become the outage screen instead.
  const activePlan = await loadActivePlanStrict(userId);
  let raceMode = activePlan != null && (activePlan.mode === 'race-prep' || activePlan.race_id != null);
  if (!activePlan) {
    // No active plan right now — still race-mode if this runner has EVER
    // been on a race-prep block (the off-season gap between blocks, not a
    // runner who has never raced through this app).
    const everRacePrep = await pool.query(
      `SELECT 1 FROM training_plans WHERE user_uuid = $1 AND (mode = 'race-prep' OR race_id IS NOT NULL) LIMIT 1`,
      [userId],
    );
    raceMode = everRacePrep.rows.length > 0;
  }

  if (!raceMode) {
    const ctx: V5TodayContext = emptyContext(today, false, isSteppedDay);
    return NextResponse.json(composeV5Today(ctx));
  }

  const glance = await loadGlanceState(userId);

  // The coach's read of what the runner can race today. Model A of the
  // adaptive-progression split, which has been correct, tested and unreachable
  // since it was written — its only importer was /api/coach/read, and nothing
  // called that. David ruled the placement: under "Where you are", beside
  // readiness and week mileage.
  const fitnessRow = await loadFitnessRow(userId, today);

  // The last race behind the runner, and how long ago. Read once here rather
  // than only inside the off-season branch, because "why this run" needs it
  // on every screen — a recovery block's whole reason is the race it follows.
  const lastRaceRow = (await pool.query<{ name: string; date: string; distance_mi: string | null }>(
    // `distanceMi` rides along for the recap's per-finding race-recency
    // filter: the post-race window is distance-keyed (Research/00b via
    // `expectedDaysForAnchor`), and three weeks after a marathon is not the
    // same claim as three weeks after a 5K.
    `SELECT COALESCE(meta->>'name', slug) AS name, meta->>'date' AS date,
            meta->>'distanceMi' AS distance_mi
       FROM races
      WHERE user_uuid::text = $1 AND meta->>'priority' IN ('A', 'B')
        AND meta->>'date' IS NOT NULL AND (meta->>'date')::date < $2::date
      ORDER BY (meta->>'date')::date DESC LIMIT 1`,
    [userId, today],
  ).catch(() => ({ rows: [] as Array<{ name: string; date: string; distance_mi: string | null }> }))).rows[0] ?? null;
  const daysSinceLastRace = lastRaceRow
    ? Math.max(0, Math.round(
        (Date.parse(today + 'T12:00:00Z') - Date.parse(lastRaceRow.date + 'T12:00:00Z')) / 86400000))
    : null;
  // THE RUNNER'S REAL TODAY, NOT THE DATE BEING VIEWED.
  //
  // `loadPlanWeek(userId, today, dateParam?)` takes the two apart on purpose
  // — `today` marks `is_today` on the day it equals, `dateParam` only picks
  // which week to window on — but this call was passing ONE date for both.
  // Stepping to another day sets `today` (this file's own variable) to that
  // date, so every day in the returned week got `is_today` compared against
  // the VIEWED date instead of the real one: viewing Sunday marked SUNDAY as
  // today, not Tuesday.
  //
  // Invisible everywhere the client trusts its OWN idea of today over the
  // wire's — which is everywhere except one place: `TodayHostV5.backToToday()`
  // resolves "today" by reading `isToday` back OFF THIS PAYLOAD (the one
  // screen with no other source, since it is what "today" even means once
  // you have stepped away). With `is_today` lying, "back to today" compared
  // the viewed date to itself, matched, and silently no-opped — the button
  // that fired but did nothing, on David's phone, 2026-08-25.
  const planWeek = await loadPlanWeek(userId, runnerTodayISO, today);
  // VIEWED-DAY-1 (2026-08-30) · BY DATE, NOT BY `is_today`.
  //
  // The comment above is about `is_today` meaning the runner's REAL today, and
  // it is right. This line is about the fact that the prescription must follow
  // the SCREEN, and `is_today` stopped being able to answer both questions the
  // moment 230fbac1 split the two dates apart.
  //
  // Viewing Monday loads the Monday-to-Sunday week, which does not contain the
  // Sunday the runner is actually on, so this matched NO row and the day came
  // back null — hero REST, no distance, no pace, no HR cap, and an About card
  // reading "By feel." over a week with `4x1mi @ T pace` in it. See
  // lib/faff/viewed-day.ts for the full account.
  const todayWeekDay = resolveViewedPlanDay(planWeek.days, today);
  // RULE 11 · the plan is loaded and says NOTHING about this date, which is not
  // the same fact as the plan saying "rest" — and neither is the same as the
  // read having failed. `plan_id != null` is what separates the third from the
  // other two: no plan loaded means the surface must not assert an absence it
  // never established.
  const todayPlanUnresolved = viewedDayIsUnresolved({
    planLoaded: planWeek.plan_id != null,
    viewedDay: todayWeekDay,
  });
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
        // BLOCK-ENDED-1 (2026-08-24) · the week has to CONTAIN today, not merely
        // start before it. Without the upper bound a block whose last week
        // finished still answered with that week, so a runner whose plan ran
        // out kept reading "Week 1 of 1" every morning — the same
        // forever-stale shape `planElapsed` was written for, one surface up.
        // One production plan was in exactly this state on 2026-08-24 (last
        // prescribed day 2026-08-22, still the active plan). No row now means
        // no line, which is the honest answer and the one this block already
        // takes for a failed count.
        const w = (await pool.query<{ week_idx: number }>(
          `SELECT week_idx FROM plan_weeks
            WHERE plan_id = $1
              AND week_start_iso::date <= $2::date
              AND week_start_iso::date + 7 > $2::date
            ORDER BY week_start_iso DESC LIMIT 1`,
          [activePlan.id, today],
        ).catch(() => ({ rows: [] as any[] }))).rows[0];
        // 2026-08-24 · swallowed-failure sweep · the fallback was
        // `{ n: '0' }`, and this string goes straight onto the runner's Today
        // screen: a failed count rendered "Week 5 of 0". A line we cannot fill
        // is a line we do not draw.
        const total = await rowOrNull<{ n: string }>(
          'v5/today · plan week count',
          pool.query<{ n: string }>(
            // MAX(week_idx)+1, NOT COUNT(*). A block authored mid-recovery
            // emits only the weeks that remain, so counting its rows answered
            // "of 1" on day nine of a fourteen-day recovery — the block held
            // one week because one was left, not because recovery is one week
            // long. The highest index a week claims is how long the block is;
            // for every block that starts at its own week one the two agree.
            `SELECT (MAX(week_idx) + 1)::text AS n FROM plan_weeks WHERE plan_id = $1`,
            [activePlan.id],
          ),
        );
        if (!total || Number(total.n) <= 0) return null;
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
    const ctx: V5TodayContext = emptyContext(today, true, isSteppedDay);
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
    const ctx: V5TodayContext = emptyContext(today, true, isSteppedDay);
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
    const ctx: V5TodayContext = emptyContext(today, true, isSteppedDay);
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

    const ctx: V5TodayContext = emptyContext(today, true, isSteppedDay);
    ctx.weekStripDays = weekStripDays;
    ctx.offSeason = {
      sinceLastRace,
      silenceReason: 'No block is written. Running is optional, and nothing here is measured against a goal.',
      weeklyRange,
    };
    return NextResponse.json(composeV5Today(ctx));
  }

  // ── The plan is live. Resolve today's prescription context. ───────────
  // THE PLAN FOR THE DAY BEING ASKED ABOUT, NOT FOR THIS WEEK.
  //
  // `loadGlanceState` takes no date. Its `weekDays` is always the CURRENT
  // training week, so `glance.weekDays.find(d => d.date === today)` returns
  // undefined the moment `today` is a date outside it — and the day fell
  // through to null, which the composer renders as REST with "no specific
  // plan today · run by feel".
  //
  // So paging the week strip forward showed every future day as a rest day,
  // on a plan that has a seven-mile long run sitting right there. Backwards
  // worked, but only by accident: a stepped-to day inside the current week is
  // still in `weekDays`.
  //
  // `planWeek` IS date-aware — `loadPlanWeek(userId, runnerTodayISO, today)`
  // windows on the date it was given — so `todayWeekDay` already holds the
  // right row. Glance
  // stays first because it carries the adaptation provenance (what the day
  // WAS before the coach moved it), which the plan row alone cannot say.
  //
  // Same root cause as the readiness figures that were rendering under a past
  // date's heading. That was fixed by blanking the section; this is the same
  // date-blind source feeding the headline itself. The real repair is a
  // `loadGlanceState(userId, date)`, which is a wider change than this.
  const todayPlan = glanceToday && glanceToday.plannedType !== 'unplanned'
    ? {
        type: glanceToday.plannedType,
        subLabel: glanceToday.plannedLabel,
        distanceMi: glanceToday.plannedMi,
        originalType: glanceToday.adaptation?.originalType ?? null,
        originalSubLabel: glanceToday.adaptation?.originalSubLabel ?? null,
      }
    : todayWeekDay && todayWeekDay.type !== 'rest'
    ? {
        type: todayWeekDay.type,
        subLabel: todayWeekDay.sub_label,
        distanceMi: todayWeekDay.distance_mi,
        originalType: null,
        originalSubLabel: null,
      }
    : null;

  // BYFEEL-1 (2026-08-30) · "BY FEEL" IS A PRESCRIPTION, NOT A SHRUG.
  //
  // `derivePurpose`'s `unplanned` arm is `verdict: 'By feel.'`, and this line
  // routed three different situations into it:
  //
  //   1. The day was unresolved (VIEWED-DAY-1 above). Fixed at the source; the
  //      flag is what keeps this arm honest for the cases that remain.
  //   2. The day resolved to REST. `todayPlan` is deliberately null on a rest
  //      day, so reading the type off it turned every rest day into "By feel"
  //      rather than "Rest day" — and `composeWhy`'s own `/^rest day/i` guard
  //      could not fire, because the string never said rest.
  //   3. The type was REAL but not in the twelve-entry map. `interval`
  //      (singular) is 214 production rows by workout-type.ts's own count;
  //      `vo2max`, `track`, `repeats`, `lt`, `long-run` and nine more alias
  //      the same way. A hard interval session read "By feel."
  //
  // The owner hit (1) on 2026-08-30 on a week whose Tuesday is `4×1 mi @ T
  // pace` with `lthr_bpm: 168` stamped on it. Being told to run that by feel
  // contradicts the prescription two taps away — Rule 16: a sentence about a
  // measurement is gated on that measurement.
  //
  // `canonicalSessionType` is the app's own resolver and this file already
  // imports it and uses it twice below; the local map now only carries the
  // aliases that resolver deliberately does NOT make (`race_week_tuneup` →
  // `threshold` is a COPY choice, not a classification).
  const viewedPlannedType: string | null =
    glanceToday && glanceToday.plannedType !== 'unplanned'
      ? glanceToday.plannedType
      : todayWeekDay?.type ?? null;
  const purposeType: PurposeWorkoutType = todayPlanUnresolved
    ? 'unplanned'
    : (TYPE_NORMALIZE[(viewedPlannedType ?? '').toLowerCase()]
        ?? canonicalSessionType(viewedPlannedType ?? '')
        ?? 'unplanned');
  const purposePhase: PurposePhase | null = glance.phaseLabel ? (PHASE_FROM_LABEL[glance.phaseLabel] ?? null) : null;
  const purpose = derivePurpose({
    type: purposeType, phase: purposePhase,
    plannedMi: todayPlan?.distanceMi ?? 0,
    raceDistanceMi: glance.raceGoalDistanceMi, weeksToRace: null,
  });
  // "WHY THIS RUN" IS A TEXT FROM A COACH, NOT A RECORD.
  //
  // David, 2026-08-21: "I want this section to always feel like a quick text
  // from a coach. More conversational. Not just this, but for anything ever
  // in this section."
  //
  // It used to be three independently-authored fragments joined with full
  // stops, each starting cold, three interpuncts between them. Every claim
  // correct; the whole thing reading like a database row. `composeWhy` owns
  // the register now — see lib/faff/why-voice.ts for the rules it holds, and
  // note it invents no claim: the physiology still comes from the plan's own
  // rationale, the day's own note and `derivePurpose`.
  const phaseRationale = activePlan
    ? ((await pool.query<{ rationale: string | null }>(
        `SELECT pp.rationale
           FROM plan_weeks pw
           JOIN plan_phases pp ON pp.id = pw.phase_id
          WHERE pw.plan_id = $1 AND pw.week_start_iso <= $2
          ORDER BY pw.week_start_iso DESC LIMIT 1`,
        [activePlan.id, today],
      ).catch(() => ({ rows: [] }))).rows[0]?.rationale ?? null)
    : null;
  // ── THE COACHING THESIS · Constitution §F, wired (2026-09-01) ──────────
  //
  // On a QUALITY day the "why this run" opener is the strategy, not the
  // calendar. `resolveCoachingThesis` answers "what are we currently trying to
  // accomplish with this runner" off the Runner Model's own capacities, and
  // this route quotes it — it composes no sentence of its own about the same
  // facts (Constitution §P, Rule 16). The thesis also travels on the payload
  // as `thesis`, so Block can say the same thing without re-deriving it.
  //
  // QUALITY DAY, and only a quality day. `thesisLeadClause` replaces the phase
  // opener, and doing that on an easy or rest day would put a limiter sentence
  // over a run that is not about the limiter at all. Long runs are out too:
  // they carry their own rich note and the durability half of `addressedBy` is
  // a coarse `is_long` proxy the header already flags. So the three families
  // the thesis ranks and prescribes against, and nothing else.
  //
  // RULE THREE, AND NO `.catch`. The first draft of this block wrapped the
  // resolve in `.catch(() => null)` on the argument that an explanation should
  // never stop a screen drawing. `_coercion_scan` named it, correctly: a
  // thesis that FAILED and a day that has no thesis are different facts, and
  // collapsing them is Rule 11 whatever the consumer does with the result.
  //
  // The catch was also unnecessary. This resolver reads the same database this
  // route already reads uncaught a dozen times over, so a throw here means the
  // request was going to fail anyway — and the handler's own try/catch turns
  // that into the honest data-outage screen rather than a Today with a quietly
  // missing strategy. `null` below now means exactly one thing: the day is
  // unresolved, so there is no session for a thesis to be about.
  const THESIS_QUALITY_TYPES = new Set(['threshold', 'tempo', 'intervals']);
  const thesis = todayPlanUnresolved
    ? null
    : await resolveCoachingThesis(userId, today);
  const addressedToday = thesis?.addressedBy.find((s) => s.dateIso === today) ?? null;
  /* WHICH DAY THE THESIS IS ABOUT.
   *
   * The quality-type set alone was right while the limiter could only ever be
   * THRESHOLD or HIGH_INTENSITY, whose families are exactly those three types.
   * THESIS-V3 (2026-09-02) lets the runner's own race curve name DURABILITY as
   * the limiter, and durability's key session is the LONG RUN - which is not
   * in that set, so on the one day of the week that actually addresses the
   * limiter the runner would have read the phase opener instead of the
   * strategy. Measured on the owner's account: limiter DURABILITY, the week's
   * only addressing session the 2026-09-06 long run, and the thesis lead
   * suppressed on exactly that day.
   *
   * So the day the thesis speaks on is the day the thesis is ABOUT: a quality
   * day as before, or the day the resolver itself named as addressing the
   * limiter. `addressedBy` is the thesis's own list, so this adds no second
   * opinion about which session serves the limiter (Rule 16) - it stops
   * withholding the sentence on the day the thesis already picked. */
  const thesisIsForToday = thesis != null
    && (THESIS_QUALITY_TYPES.has((viewedPlannedType ?? '').toLowerCase())
      || addressedToday != null);

  const why = todayPlanUnresolved
    // RULE 11 · an unresolved day says so. It does NOT borrow the phase
    // opener, because "you're in the part of the block where the hard
    // sessions do the work" is a claim about a week whose prescription we
    // have just failed to find, and it is the half of the old sentence that
    // made the other half sound authoritative.
    ? 'This block does not prescribe this day. Nothing is scheduled to run.'
    : composeWhy({
        phase: glance.phaseLabel,
        lastRaceName: lastRaceRow?.name ?? null,
        daysSinceRace: daysSinceLastRace,
        dayNote: todayWeekDay?.notes?.trim() || null,
        phaseRationale,
        fallback: [purpose.verdict, ...purpose.facts].filter(Boolean).join(' '),
        thesisLead: thesisIsForToday && thesis
          ? thesisLeadClause(thesis, addressedToday != null)
          : null,
        // Only when this session actually addresses the limiter. Naming the
        // catalogue pick on a session that does not serve the limiter would
        // read as the thesis endorsing it, which is appendix E Finding 7's
        // mistake made in prose instead of in a family match.
        thesisSessionName: thesisIsForToday && addressedToday
          ? coachSafeSessionName(addressedToday.selectionRationale)
          : null,
      });

  // ── Already ran today? → after_run (5b/5c) ─────────────────────────────
  const ranToday = glanceToday && glanceToday.doneMi >= 0.5;
  if (ranToday) {
    const runRow = (await pool.query<{ id: string; data: Record<string, any> }>(
      `SELECT id::text AS id, data, shoe_id FROM runs
        WHERE user_uuid = $1 AND ${runNotMergedSql()}
          AND ${runDaySql()} = $2
        ORDER BY ${runDistanceMiSql()} DESC NULLS LAST
        LIMIT 1`,
      [userId, today],
    ).catch(() => ({ rows: [] as any[] }))).rows[0];

    if (runRow) {
      const data = runRow.data ?? {};
      const indoor = data.indoor === true || data.source === 'treadmill';
      // The poster prints the ELAPSED clock beside the distance, so its pace
      // is the elapsed pace. Read as a set rather than key by key: this block
      // used to take `data.paceSPerMi` on its own, and on 2026-08-23 that key
      // held a Strava moving pace of 3:37/mi stamped onto a row whose own
      // `durationSec` said 8:01. The poster printed `11.0 mi · 1:28:18 ·
      // 3:37/mi` — three numbers that cannot all be true — and the recap
      // below, which reads the same variables, repeated it in prose.
      const facts = runFacts(data, { basis: 'elapsed' });
      const distanceMi = facts.distanceMi ?? 0;
      const durationSec = facts.timeSec;
      const paceSPerMi = facts.paceSecPerMi;

      // The watch's own completion payload for this day.
      //
      // THIS QUERY USED TO RUN ONLY FOR A TREADMILL, which is why the win
      // line composed on this route never saw a rep. `deriveWin`'s interval
      // branch prefers real phases and falls back to a per-mile heuristic
      // when it has none — and on the one run type where per-rep detail is
      // the whole story, this route was always handing it the fallback. The
      // recap route has read the same row unconditionally all along; the two
      // now agree. Same SQL, same `#HHmm`-tolerant field match — see
      // `lib/coach/run-state.ts` loadPhaseBreakdown for that regex's history.
      const intent = (await pool.query<{ value: any }>(
        `SELECT value FROM coach_intents
          WHERE COALESCE(user_uuid, user_id) = $1 AND reason = 'watch_completion'
            AND (CASE WHEN field ~ '-[0-9]{4}-[0-9]{2}-[0-9]{2}(#[0-9]+)?$'
                      THEN field ~ ('-' || $2::text || '(#[0-9]+)?$')
                      -- 2026-08-27 · was ts::date = $2::date, comparing the
                      -- UTC insert timestamp's date against the runner's
                      -- LOCAL "today" with no timezone conversion. A run
                      -- logged after ~5pm Pacific (UTC already past
                      -- midnight) failed this match outright -- exactly what
                      -- silently emptied the belt-averages lookup below,
                      -- same runnerTimezone convention as goal-projection.ts.
                      ELSE (ts AT TIME ZONE $3::text)::date = $2::date END)
          ORDER BY ts DESC LIMIT 1`,
        [userId, today, completionTz],
      ).catch(() => ({ rows: [] as any[] }))).rows[0];
      let completion: any = intent?.value ?? null;
      if (typeof completion === 'string') { try { completion = JSON.parse(completion); } catch { completion = null; } }
      const completionPhases: any[] = Array.isArray(completion?.phases) ? completion.phases : [];

      // Treadmill telemetry — averaged across watch_completion phases
      // (Gap B12). Speed/incline live per-phase, not on the run row itself.
      let speedMph: number | null = null, inclinePct: number | null = null;
      if (indoor) {
        // 2026-08-21 · this was a PLAIN mean over every phase in the
        // payload — including phases the runner never reached (which carry
        // the plan's nominal target by design, and no duration), and
        // weighting a 2-minute recovery the same as a 20-minute work block.
        // See lib/runs/belt-averages.ts for the argument and the tests.
        const belt = beltAverages(completionPhases);
        speedMph = belt.speedMph;
        inclinePct = belt.inclinePct;
      }

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
      // THE PRESCRIBED WINDOW, for the recap's band-adherence sentence. See
      // `RecapInput.plannedPaceBandSPerMi`: the phone's mile table stopped
      // colouring by this on 2026-08-30 and the fact now travels in words.
      // Both ends or nothing — half a window grades nothing honestly.
      const askedPaceBand: { lo: number; hi: number } | null = (() => {
        const spec = planRow?.workout_spec;
        if (!spec) return null;
        const lo = Number(spec.pace_target_s_per_mi_lo);
        const hi = Number(spec.pace_target_s_per_mi_hi);
        return lo > 0 && hi >= lo ? { lo, hi } : null;
      })();

      // THE EFFORT THE RUNNER LOGGED, looked up under EVERY id it could have
      // been filed under rather than the first one that happens to exist.
      //
      // This was `activity_id = $2` with `data.activityId ?? data.id ??
      // runRow.id` — a precedence ladder over three identities, which is the
      // same shape as the clock ladders and fails the same way. The phone
      // posts to /api/runs/{id}/rpe using the `runId` this route handed it,
      // which is `runRow.id`; but `data.id` exists on watch rows, so the
      // ladder stopped one rung early and looked under a key nothing wrote.
      // Reported on 2026-08-24: an effort of 3 was saved correctly and the
      // row still offered to log one.
      //
      // Both spellings are live in production — a Strava row filed under
      // `18638945777`, a watch row under its primary key — so preferring
      // either one strands the other. The row is unique per (user, activity),
      // so matching the SET cannot pick up someone else's answer.
      //
      // `user_id::text` as well as `user_uuid`: the writer matches both (the
      // column is TEXT for legacy reasons and older rows carry 'me'), and a
      // reader narrower than its writer is how a saved value becomes an
      // unsaved one.
      const rpeIds = Array.from(new Set(
        [data.activityId, data.id, runRow.id].filter((v) => v != null).map(String),
      ));
      const rpe = (await pool.query<{ rpe: number | null }>(
        `SELECT rpe FROM post_run_rpe
          WHERE (user_uuid = $1 OR user_id::text = $1::text)
            AND activity_id = ANY($2::text[])
          -- THE RUNNER'S OWN ANSWER WINS. pullSync auto-imports Strava's
          -- perceived_exertion and stamps it 'auto-imported from strava',
          -- and its dedup check looks under ONE id spelling -- so a run the
          -- runner answered under its primary key can still collect a second,
          -- later row from the importer. Ordering by time alone would then
          -- replace what he said with what Strava guessed. His own entry is
          -- the measurement here; the import is a copy of one.
          ORDER BY (notes IS DISTINCT FROM 'auto-imported from strava') DESC,
                   logged_at DESC
          LIMIT 1`,
        [userId, rpeIds],
      ).catch(() => ({ rows: [] as any[] }))).rows[0];

      /* ── THE ABSORBED TWINS · through the shared seam, 2026-08-24 ──────────
       *
       * This query, and the two resolver calls under it, used to be written
       * out here. They were correct — and being written HERE, inside a route,
       * is why no other surface could reuse them. Run detail, the log and the
       * recap each ended up with a private answer for the same climb, and one
       * run printed 3195 / 57 / 57 / 3195 across four screens.
       *
       * `lib/runs/twins.ts` is the same logic with a door on it. Nothing about
       * the poster's behaviour changes; what changes is that the other three
       * surfaces can now ask the identical question, and a future change to
       * the ranking lands on all four at once instead of on whichever file
       * someone remembered.
       *
       * The failed-read distinction is preserved inside the seam: null means
       * the read FAILED and `resolveElevationGain` refuses, rather than
       * letting the canonical row's weaker instrument win by default. */
      const elevTwins = await loadRunTwins(runRow.id);
      const canonicalFigures = {
        elevGainFt: data.elevGainFt as number | null,
        elevGainSource: data.elevGainSource as string | null,
        source: data.source as string | null,
        splits: Array.isArray(data.splits) ? (data.splits as Array<Record<string, unknown>>) : null,
        distanceMi,
      };
      const elevationReading = resolveElevationGain(canonicalFigures, elevTwins);

      // THE SPLIT ARRAY THAT ACTUALLY DECOMPOSES THIS RUN.
      //
      // The canonical row for 2026-08-24 carries three splits covering 3.00 of
      // 4.02 miles; the absorbed apple_watch twin carries five covering 4.11,
      // with cadence and per-mile elevation the canonical lacks. The merge kept
      // the poorer one. True of 26 of the 71 merged runs here — and the mile it
      // dropped was the one that mattered, 158 bpm and squarely Z4.
      //
      // Coverage decides, then richness. Never a blend of two arrays: they are
      // separate instruments observing the same run, and interleaving them
      // would invent miles nothing recorded.
      const splitChoice = resolveSplits(canonicalFigures, elevTwins);

      // The runner's own zone bands, from their threshold heart rate. Null
      // at true cold start — never fabricated, and an absent band simply
      // falls the map back to the pace gradient.
      const thresholdHr = await resolveThresholdHr(userId).catch(() => null);
      const zoneTable = thresholdHr ? computeZones({ lthr: thresholdHr.bpm }) : null;
      const hrZoneRanges = zoneTable
        ? zoneTable.zones.map((z) => ({ label: z.shortLabel, lower: z.lower, upper: z.upper }))
        : [];

      /* ── ANCHOR-STALE-1 · THE ZONE BAR IS BUCKETED AT TODAY'S ANCHOR ───────
       *
       * This was `reconcileHrZones(data)` alone, up beside the treadmill
       * telemetry: the STORED distribution, reconciled for shape and then
       * rendered. Reconciliation asks whether five numbers are a distribution.
       * It cannot ask which THRESHOLD produced them, and nothing on the row
       * records that or invalidates it when the threshold moves — so a
       * distribution bucketed at an anchor the runner no longer has passed
       * every guard and won permanently.
       *
       * The owner's threshold was re-derived from race evidence on 2026-08-30
       * (162 → 168 · `lib/training/lthr-reanchor.ts`). His 2026-08-30 long run
       * — 13.49 mi, avg HR 159, an easy aerobic day — is stored as
       * `{z1:4,z2:15,z3:11,z4:10,z5:60}`. Sixty percent of an easy long run in
       * Zone 5, on the phone's own Today card. The same samples at 168 read
       * `{z1:11,z2:17,z3:9,z4:36,z5:27}`.
       *
       * `resolveHrZoneShares` owns the precedence (per-sample → per-mile →
       * stored) and `lib/coach/run-state.ts` already reads through it; this is
       * the same call, so web run detail and the phone cannot answer
       * differently for one run. Verified against all eight of the owner's
       * canonical rows carrying a real stored distribution: every one
       * reproduces its stored value EXACTLY when re-bucketed at 162, so this
       * changes nothing until the anchor actually moves.
       *
       * MOVED DOWN HERE, below the threshold resolution and `splitChoice`, for
       * two reasons the block above could not satisfy: the bar must be
       * bucketed against the SAME `zoneTable` the ranges panel beside it is
       * drawn from, and rung 2 must decompose the run with the same split
       * array the map draws — on 26 of 71 merged runs that is an absorbed
       * twin's array, not the canonical row's.
       */
      const zonePcts = resolveHrZoneShares({
        phases: data.phases,
        rawSplits: data.splits,
        // `SplitLike.hr` is `unknown` by design (the picker only asks whether
        // a key is present). `zoneSharesFromSplitHr` reads it through
        // `Number(...)` and bounds the result to 40-230, so an unreadable
        // value is discarded rather than trusted — the narrowing is safe.
        splits: (splitChoice?.splits ?? null) as
          ReadonlyArray<{ hr?: number | null; avgHr?: number | null }> | null,
        storedPcts: reconcileHrZones(data),
        table: zoneTable,
      });
      const zoneShares = zonePcts
        ? [zonePcts.z1 ?? 0, zonePcts.z2 ?? 0, zonePcts.z3 ?? 0, zonePcts.z4 ?? 0, zonePcts.z5 ?? 0]
        : null;

      /* ── THE SAME RUN MAY NOT TELL TWO STORIES (2026-08-24) ───────────────
       *
       * This block and `app/api/runs/[id]/recap/route.ts` both call
       * `deriveRecap` on the same row, and they were assembling its input four
       * different ways. One runner, one run, the phone and the web open side
       * by side, and each of these was a sentence that differed:
       *
       *  · SPLITS, UNRELIABLE. The recap route drops the array when the row
       *    carries `splits_unreliable` — the flag pause events set when the
       *    split TIMES no longer sum to the run's duration. This route fed
       *    them in regardless, and `detectPaceFade` reads exactly those times.
       *    Eleven canonical rows carry the flag with a splits array: on every
       *    one of them the phone could print "the last third was about Ns/mi
       *    slower" off timestamps the ingest already declared unusable.
       *
       *  · SPLITS, WHICH ARRAY. `splitChoice` above picks the array that
       *    decomposes the run, and on 26 of 71 merged runs that is an absorbed
       *    twin's rather than the canonical's. The map drew the twin's miles
       *    and the prose underneath read the canonical's — one screen, two
       *    arrays, and the recap's was the poorer of the two by construction.
       *
       *  · HEART RATE. `Number(data.avgHr)` passes a sentinel straight into
       *    prose. `runAvgHr` is the reader that bounds it to something a heart
       *    can do; the recap route has used it all along.
       *
       *  · WEATHER. Handing `null` here is not "no weather", it is "do not
       *    look" — and the branch it silences is the one that decides WHY the
       *    heart rate climbed. With weather the recap says a hot day explains
       *    the drift; without it, the same run on the same day tells the
       *    runner to eat earlier and drink more. The row carries `data.weather`
       *    and this route was already reading it two lines below for nothing.
       */
      const splitsForRecap = data.splits_unreliable !== true && splitChoice
        ? (splitChoice.splits as Parameters<typeof deriveRecap>[0]['splits'])
        : undefined;

      const recapWeather = data.weather ? {
        tempF: typeof data.weather.temp_f === 'number' ? data.weather.temp_f
          : (typeof data.tempF === 'number' ? data.tempF : null),
        tempF_start: typeof data.weather.temp_f_start === 'number' ? data.weather.temp_f_start : null,
        tempF_end: typeof data.weather.temp_f_end === 'number' ? data.weather.temp_f_end : null,
        tempF_peak: typeof data.weather.temp_f_peak === 'number' ? data.weather.temp_f_peak : null,
        humidityPct: typeof data.weather.humidity_pct === 'number' ? data.weather.humidity_pct : null,
        windMph: typeof data.weather.wind_mph === 'number' ? data.weather.wind_mph : null,
        conditions: typeof data.weather.conditions === 'string' ? data.weather.conditions : null,
        cloudCoverPct: typeof data.weather.cloud_cover_pct === 'number' ? data.weather.cloud_cover_pct : null,
        durationS: durationSec,
      } : null;

      /* C-3 · the THRESHOLD anchor, distinct from the row's HR cap.
       *
       * `askedHrCap` is a COALESCE ladder (`hr_cap_bpm` → `hr_target_bpm` →
       * `lthr_bpm`), so on a tempo row it is a hover target well under LT.
       * Feeding it to `threshold-band.ts` told a tempo run at 160 bpm — the
       * FLOOR of what this same app calls "Z4 Threshold" — that it had gone
       * "past threshold". The band's anchor is the LTHR or there is no band. */
      const recapLthrBpm: number | null =
        planRow?.workout_spec && Number(planRow.workout_spec.lthr_bpm) > 0
          ? Number(planRow.workout_spec.lthr_bpm)
          // `glance.lthr` is the same resolved threshold the card's own HR
          // bands are drawn from, three hundred lines below. Reading it rather
          // than issuing a second `resolveThresholdHr` keeps the recap's band
          // and the card's band on ONE number (Rule 16) and adds no swallowed
          // read. Null is a real answer: with no LTHR the recap declines to
          // say anything about the threshold band at all.
          : (glance.lthr ?? null);

      /* RULE 16 · WHAT THIS RUN MAY SAY ABOUT ITS OWN HEART RATE.
       *
       * `deriveReadingScopes` is the owner of that question and the recap
       * already accepts its answer — the route just never supplied one, so
       * every threshold-band sentence and every lead line here was gated on
       * the WHOLE-RUN average. On a session with a 2.1-mile warm-up at 140 bpm
       * and a 2.1-mile cool-down at 153 that is ten beats below the reps, and
       * ten beats is two Friel zone boundaries at this LTHR: the run averaged
       * 154 (91.7% of a 168 LTHR) and the four reps averaged 162 (96.4%),
       * which sit on opposite sides of the zone-4 floor and therefore produce
       * opposite verdicts.
       *
       * The resolver also refuses below `HR_REP_KINETICS_FLOOR_SEC`, so a
       * sub-two-minute rep set says nothing about heart rate rather than
       * reporting its own rise time. */
      const recapReadings = deriveReadingScopes({
        phases: mapWatchPhases(completionPhases),
        wholeHrBpm: runAvgHr(data),
      });
      const recapWorkHr: number | null =
        recapReadings.hr.scope === 'work' ? recapReadings.hr.value : null;

      const recap = deriveRecap({
        workAvgHrBpm: recapWorkHr,
        readings: recapReadings,
        type: purposeType, phase: purposePhase,
        plannedMi: todayPlan?.distanceMi ?? 0,
        plannedPaceSPerMi: askedPaceSPerMi,
        plannedPaceBandSPerMi: askedPaceBand,
        lthrBpm: recapLthrBpm,
        plannedHrCap: askedHrCap,
        actualMi: distanceMi,
        actualPaceSPerMi: paceSPerMi,
        actualDurationSec: durationSec,
        actualAvgHr: runAvgHr(data),
        actualMaxHr: runMaxHr(data),
        splits: splitsForRecap,
        weather: recapWeather,
        terrain: null,
        // Per-finding race-recency filter · see RecapInput.daysSinceRace.
        daysSinceRace: daysSinceLastRace,
        raceDistanceMi: lastRaceRow?.distance_mi != null ? Number(lastRaceRow.distance_mi) : null,
      });

      const shoes = await loadShoes(userId);
      const shoeType = planTypeToShoeType(todayPlan?.type ?? null);
      // THE SHOE HE ACTUALLY WORE, or nothing.
      //
      // This read `data.shoe_id` — the jsonb key — which is NULL on every row
      // in the database. The assignment lives in the `shoe_id` COLUMN, which
      // the query did not even select. So the expression fell through to
      // `recommendShoe` every single time, and the card printed a
      // RECOMMENDATION under a heading that says "Shoes you wore".
      //
      // He picked Asics Superblast 3 today; the column says 2, the pick
      // landed, and the card went on showing Novablast 5 — a suggestion the
      // engine made, rendered as a fact about his morning. That is rule one
      // with the labels swapped: not a modelled number looking measured, but
      // a modelled OBJECT looking observed.
      //
      // A recommendation belongs on the BEFORE-run screen, where it is a
      // suggestion about a run not yet taken. After the run there is only
      // what was worn, and "we don't know" is the honest answer when nothing
      // was assigned — the row then offers the picker instead of asserting.
      const assignedShoeId = runRow.shoe_id ?? data.shoe_id ?? null;
      const shoeRow = assignedShoeId != null
        ? shoes.find((sh) => String(sh.id) === String(assignedShoeId)) ?? null
        : null;

      const recentRun: V5RecentRunCtx = {
        runId: runRow.id,
        distanceMi, durationSec, paceSPerMi,
        // THE READING · four instrument values run detail has drawn since it
        // was written and this screen never had on the wire.
        //
        // `runAvgHr` / `runMaxHr` rather than a bare `Number(...)`: they bound
        // the value to a physiologically possible range, so a 0 or a 4 from a
        // sensor artefact reads as "no measurement" instead of as a heart
        // rate. Run detail's `hr_avg` is now resolved through the same pair —
        // two screens two taps apart may not answer one run differently, and
        // that is precisely the defect class this codebase has spent the day
        // removing.
        avgHr: runAvgHr(data as RunData),
        hrMax: runMaxHr(data as RunData),
        // BOTH FEET, resolved once. `avgCadence` holds Strava's PER-LEG count
        // on the 57 pre-May-2026 imports and the watch's step rate on the
        // rest, and nothing in the row says which — so the poster showed 78
        // spm for one run and 161 for the next with no unit change on screen.
        // Same reader as run detail and the recap. `cadence.units-split`.
        cadenceAvg: (() => {
          const c = runCadenceSpm(data);
          return c ? Math.round(c.spm) : null;
        })(),
        // WHICH TEMPERATURE, DELIBERATELY. Two live spellings disagree and
        // `run-shape.ts` exposes both: `runTempFSql` is the bare top-level
        // `tempF`, and `runWeatherTempFSql` is the enrichment block's PEAK,
        // which exists for heat-cost arithmetic ("a run is paced by the worst
        // of its conditions"). The Reading card states the run's ambient
        // temperature, not its worst minute, so this mirrors run detail's own
        // read exactly — top-level first, then the enrichment MEAN — because
        // the two screens must not print different temperatures for one run.
        tempF: (() => {
          const top = Number(data.tempF);
          if (Number.isFinite(top) && top !== 0) return top;
          const w = (data.weather ?? null) as Record<string, unknown> | null;
          const mean = Number(w?.temp_f);
          return Number.isFinite(mean) && mean !== 0 ? mean : null;
        })(),
        // The canonical session type, so the phone can compose the screen from
        // what the run WAS. `panel.dayState` is the coarse four-way bucket and
        // cannot tell a tempo from a rep set — and those two need different
        // screens, because an average across a rep session describes none of
        // its parts.
        // THE WORK-SCOPED AVERAGES · the same numbers run detail has drawn
        // since P44, off the same code, so the two screens cannot disagree.
        //
        // These are what a rep or tempo session shows INSTEAD of the whole-run
        // figures, not as well as. An average across a session made of pieces
        // blends the reps with their recovery and lands in a zone the session
        // never asked for; scoped to the work it is the number the runner
        // actually held.
        ...(() => {
          // FIELD-NAME MISMATCH, FOUND 2026-09-01 · the watch's own completion
          // payload writes `actualDurationSec` / `actualDistanceMi` (confirmed
          // against a real completed run, `coach_intents.id = 915`, and against
          // `runs.data.phases` written verbatim from it — every field is
          // `actual`-prefixed except `avgHr`/`avgCadence`, which never were).
          // This read `durationSec`/`distanceMi` — a plain name that plain
          // grep across the wire shows this account's phases have never
          // carried — so `sec`/`mi` were NaN-then-null on every phase, of
          // every watch-completed run, always. `hrAvgWork`/`cadenceAvgWork`/
          // `paceWork` below have therefore been silently null since this
          // shipped; `beltAverages()` two screens down already reads the
          // correct `actualDurationSec`/`actualSpeedMph` names, which is what
          // exposed the mismatch here as a real divergence rather than a
          // guess.
          const w = workAveragesFromPhases(completionPhases.map((ph: any) => ({
            type: ph.type ?? null,
            sec: Number(ph.actualDurationSec ?? ph.durationSec ?? ph.duration_sec) || null,
            mi: Number(ph.actualDistanceMi ?? ph.distanceMi ?? ph.distance_mi) || null,
            hr: Number(ph.avgHr ?? ph.avg_hr) || null,
            cadence: Number(ph.avgCadence ?? ph.avg_cadence) || null,
          })));
          return {
            hrAvgWork: w.hrAvg,
            cadenceAvgWork: w.cadenceAvg,
            paceWork: formatWorkPace(w.paceSPerMi),
          };
        })(),
        // `canonicalSessionType`, which returns NULL for anything it does not
        // recognise rather than falling back to a guess. That matters here more
        // than usual: this value now decides the whole shape of the screen, and
        // an unknown type quietly resolving to "easy" would give a rep session
        // an easy run's breakdown and an easy run's aggregates.
        workoutType: canonicalSessionType(
          (todayPlan?.type ?? data.workoutType ?? data.type ?? null) as string | null,
        ),
        indoor, speedMph, inclinePct,
        askedPaceSPerMi, askedHrCap, askedHrIsHardCap,
        // The same number this route already hands `deriveRecap` as
        // `plannedMi`, now also reaching the table named asked-vs-ran.
        askedMi: todayPlan?.distanceMi ?? null,
        effortAsked: null,
        effortLogged: rpe?.rpe ?? null,
        // SAID ONCE. `deriveRecap` returns four parts and `deriveWin` a
        // fifth, each composed without sight of the others, so they restated
        // each other: "Steady the whole way", "Easy done." and "the right way
        // to take an easy day" are one judgement three times; three sentences
        // running said it was hot; and the tip told him to run by effort on a
        // run he had already run. `composeRecap` keeps only the parts with
        // something left to add. It never rewrites a number and never merges
        // two facts — a part survives whole or not at all.
        ...(() => {
          const spoken = composeRecap({
            win: deriveWin({
          type: purposeType, phase: purposePhase,
          plannedMi: todayPlan?.distanceMi ?? 0,
          plannedPaceSPerMi: askedPaceSPerMi,
          plannedHrCap: askedHrCap,
          actualMi: distanceMi,
          actualPaceSPerMi: paceSPerMi,
          // Same four reads as the recap above, for the same reason: the win
          // line and the recap sit one under the other on the phone, and they
          // may not be judging different splits under different weather.
          actualAvgHr: runAvgHr(data),
          splits: splitsForRecap,
          verdict: recap.verdict,
          indoor,
          source: typeof data.source === 'string' ? data.source : undefined,
          phases: completionPhases.length > 0
            ? completionPhases.map((p: any) => ({
                type: p.type ?? null,
                verdict: p.verdict ?? null,
                actualPaceSPerMi: Number(p.actualPaceSPerMi) || null,
                targetPaceSPerMi: Number(p.targetPaceSPerMi) || null,
                actualDistanceMi: Number(p.actualDistanceMi) || null,
                isFinishSegment: p.isFinishSegment === true,
              }))
            : undefined,
        }),
            verdict: recap.verdict,
            facts: recap.facts,
            conditionsNote: recap.conditions_note,
            coachTip: recap.coach_tip,
          });
          return {
            verdict: spoken.body[0] ?? null,
            facts: spoken.body.slice(1),
            conditionsNote: null,
            coachTip: null,
            win: spoken.headline,
          };
        })(),

        zoneShares,
        // The race row's zone is its DISTANCE's row in Research/08 §6.1, so the
        // planned distance has to travel with the type. `zoneTarget` stays for
        // the phone's existing Int decode and is null when the ask is a set.
        zoneTarget: zoneTargetForWorkout(todayPlan?.type ?? null, todayPlan?.distanceMi ?? null),
        zoneTargets: zoneTargetsForWorkout(todayPlan?.type ?? null, todayPlan?.distanceMi ?? null),
        elevationSamples: indoor ? null : elevationFromSplits(data.splits),
        // THE BEST INSTRUMENT, not the row's own field.
        //
        // The canonical row for 2026-08-24 holds 128 ft from `gps_derived`
        // while the twin the merge absorbed holds 13 ft from the watch's
        // BAROMETER. The runner knew: "I can promise you it was not" 128.
        // Reading `data.elevGainFt` takes whichever instrument happened to
        // win the merge, and the merge did not rank instruments.
        //
        // Null when nothing trustworthy measured it — a refusal, not a zero.
        elevGainFt: elevationReading?.ft ?? null,
        elevGainMeasured: elevationReading?.measured ?? false,
        // THE ROUTE, which this surface never carried. Run detail has drawn a
        // real map from this exact key for months; the post-run card drew an
        // elevation sparkline, labelled it "Route", and left the runner's
        // 2054-character polyline on the row unread.
        routePolyline: indoor ? null : firstPolyline(data),
        // WHAT THE MAP IS ALLOWED TO SAY.
        //
        // The route drew a flat single-colour line because this surface sent
        // it a polyline and nothing else. `RouteMapView` has coloured by HR
        // zone on steady runs and by phase on structured ones since June —
        // it just needs the run's own splits, its phases, the runner's zone
        // bands and the window the session asked for. Without them a map
        // tells the runner only where they went, which they already knew.
        routeSplits: indoor || splitChoice == null
          ? []
          : (splitChoice.splits as Array<Record<string, unknown>>).map((sp, i) => ({
              mile: Number(sp.mile ?? sp.split ?? i + 1) || i + 1,
              pace: typeof sp.pace === 'string' ? sp.pace : null,
              hr: sp.hr != null && Number.isFinite(Number(sp.hr)) ? Math.round(Number(sp.hr)) : null,
              cadence: sp.cadence != null && Number.isFinite(Number(sp.cadence)) ? Math.round(Number(sp.cadence)) : null,
              elev_change_ft: (() => {
                // `elev_ft` on the watch's array, `elev_change_ft` on Strava's.
                // Two spellings of one measurement — read the set, never a
                // `??` ladder over whichever the winning source happened to use.
                const v = sp.elev_change_ft ?? sp.elev_ft;
                return v != null && Number.isFinite(Number(v)) ? Math.round(Number(v)) : null;
              })(),
              // THE MILE'S REAL LENGTH. A 4.02 mi run is four miles and a bit,
              // and the bit is a real 0.11 mi the runner ran. Null when the
              // source did not say, which a breakdown must render as a whole
              // mile only if it is willing to say so.
              distanceMi: (() => {
                const v = sp.distanceMi ?? sp.distance_mi;
                return v != null && Number.isFinite(Number(v)) ? Number(v) : null;
              })(),
            })),
        // Phases colour the reps at their TRUE pace instead of smearing them
        // into mile averages — the whole reason a rep session's map is worth
        // drawing at all.
        //
        // SAME FIELD-NAME MISMATCH AS `workAveragesFromPhases` ABOVE, FOUND
        // 2026-09-01. This read `ph.distanceMi ?? ph.distance_mi`; the real
        // wire is `actualDistanceMi` (see the comment on the block above).
        // `routePhases` was therefore always `[]` for every watch-completed
        // run, which is what fed `sectionPieces` on the phone's immediate
        // post-run sheet (`TodayAfterV5.sectionPieces`, requires
        // `usable.count > 1`) — always empty, so `RunShapeV5.decomposition`
        // always fell back from `.sections` to `.miles` for a threshold/
        // tempo/interval session, even though the watch's own per-rep verdict
        // data was sitting right there in `completionPhases`. The run-history
        // screen (`RunDetailV5`) never had this bug — it reads
        // `phase_breakdown` off a different, already-correct query
        // (`loadPhaseBreakdown` in `lib/coach/run-state.ts`) — so a rep
        // breakdown was always one tap away, just never on the sheet the
        // runner opens first.
        //
        // `type` ADDED 2026-09-01, same sweep that fixed the field-name
        // mismatch above. Once `mi`/`sec` started carrying real data this bug
        // became visible one level up: `sectionPieces` had nothing to name a
        // phase with, so it numbered rows "Section 1", "Section 2" — which
        // read, in the runner's own words, as "some random bullshit". `type`
        // is the SAME field `workAveragesFromPhases` above and the `phases`
        // block feeding `deriveWin` already read off `completionPhases` —
        // this is the one place that dropped it before handing the phase to
        // the phone. Passed through raw (not narrowed to the four known
        // values) because the narrowing already happens client-side, the same
        // posture `run-shape.ts`'s `runPhases()` takes for its own callers.
        routePhases: indoor
          ? []
          : completionPhases.flatMap((ph: any) => {
              const mi = Number(ph.actualDistanceMi ?? ph.distanceMi ?? ph.distance_mi);
              const sec = Number(ph.actualDurationSec ?? ph.durationSec ?? ph.duration_sec);
              return Number.isFinite(mi) && mi > 0 && Number.isFinite(sec) && sec > 0
                ? [{ mi, sec: Math.round(sec), type: typeof ph.type === 'string' ? ph.type : null }]
                : [];
            }),
        hrZones: hrZoneRanges,
        // The window the split chart already grades against, so the grey
        // stretch on the map and the grey bar in the chart are the same mile.
        paceBand: askedPaceSPerMi != null
          ? { lo: Math.round(askedPaceSPerMi - 15), hi: Math.round(askedPaceSPerMi + 15) }
          : null,
        weekDoneMi: glance.weekDone, weekPlannedMi: glance.weekPlanned,
        // The garage, so the card can offer a menu instead of sending the
        // runner to another screen to answer a question about this run.
        shoeOptions: shoes
          .filter((sh) => !sh.retired)
          // A shoe with no readable name cannot be offered — a menu row the
          // runner cannot identify is worse than one fewer choice.
          .flatMap((sh) => {
            // A shoe with no readable name cannot be offered — a menu row the
            // runner cannot identify is worse than one fewer choice.
            const name = shoeDisplayName(sh);
            if (typeof name !== 'string' || name.length === 0) return [];
            return [{ id: String(sh.id), name, mi: sh.mileage ?? null }];
          }),
        shoeWorn: shoeRow ? { id: String(shoeRow.id), name: shoeDisplayName(shoeRow) ?? 'Shoe', mi: shoeRow.mileage } : null,
        niggleFlagged: glance.activeNiggle?.body_part ?? null,
      };

      const ctx: V5TodayContext = emptyContext(today, true, isSteppedDay);
      ctx.todayPlan = todayPlan;
      ctx.todayPlanUnresolved = todayPlanUnresolved;
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
      ctx.thesis = thesis ? wireThesis(thesis) : null;
      ctx.whereYouAre = buildWhereYouAre(glance, fitnessRow);
      ctx.recentRun = recentRun;
      ctx.paceNote = await loadPaceNoteRow(activePlan?.id ?? null);
      ctx.blockNote = await loadBlockNote(userId);
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
  /* PRERUN-1 · the day is named, or it is refused.
   *
   * `toPrescriptionType` closes with `default: return 'easy'` — the move
   * `canonicalSessionType`'s own doc comment forbids in as many words two
   * files away. `strictPrescriptionType` is the same narrowing without the
   * guess. Null here means the plan has this day down as something that is
   * not a run (`strength` is the live case: 44 rows, 14 on active plans) and
   * the card says so instead of drawing an easy run over it. */
  const strictType = strictPrescriptionType(todayPlan?.type ?? null);
  const unprescribable = todayPlan != null && strictType == null;
  const prescriptionType = strictType ?? 'easy';
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
  /* ── SPECFIRST-1 (2026-08-24) · THE CARD AND THE WATCH DESCRIBED DIFFERENT
   *    WORKOUTS ON EVERY QUALITY DAY ────────────────────────────────────────
   *
   * This line used to be `prescriptionFor(...)`. That function's rep distance
   * is a literal — `const repMi = 1` for threshold, `0.5` for intervals — and
   * its rep COUNT is dosed off the runner's weekly mileage, not read off the
   * day. The watch has executed `plan_workouts.workout_spec` since 2026-06-02,
   * when the same bug was found and fixed one surface over
   * (`lib/training/expand-spec.ts`'s own header records it). Today was never
   * migrated, so the two surfaces have disagreed ever since.
   *
   * Verified against production 2026-08-24 over `faff_readonly`, every
   * non-archived plan: 41 quality days, 40 disagreeing with their own spec;
   * 34 of the 35 future-dated. "5×400 m @ T pace · 2 min jog" rendered as
   * "2 × 1 mile reps". "3×7 min @ I · 60s jog" rendered as "5 × 800m". The
   * widest pace gap was 87 s/mi, on a runner the card was sending out FASTER
   * than the plan.
   *
   * The spec is now the only structural source. `cardFromSpec` runs the SAME
   * `expandSpecToPhases` the watch runs, off the same easy-pace anchor, and
   * renders those phases as steps instead of re-deriving them.
   */
  const specRow = todayPlan && activePlan
    ? (await pool.query<{ workout_spec: any; sub_label: string | null; pace_target_s_per_mi: number | null }>(
        `SELECT workout_spec, sub_label, pace_target_s_per_mi
           FROM plan_workouts WHERE plan_id = $1 AND date_iso = $2 LIMIT 1`,
        [activePlan.id, today],
        // A failed read is UNKNOWN, not "no spec". Falling silently to the
        // no-spec card would turn a database blip into a permanently thinner
        // card with no way to tell the two apart, which is the swallowed-catch
        // shape this codebase has paid for before. It still degrades to the
        // honest card below, and it says so in the log.
      ).catch((e) => { console.error('[v5/today] plan spec read failed', e); return { rows: [] as any[] }; })).rows[0]
    : null;

  /* The runner's OWN easy-pace anchor, read exactly the way
   * `lib/watch/build-workout.ts` reads it: the nearest authored easy (then
   * long) band in THIS plan. Deriving it any other way here would put the two
   * surfaces back on separate numbers for every warm-up, cool-down and jog
   * recovery — the same class of split this change exists to close.
   * Null → by-feel edges, never a fabricated pace (P1-47). */
  const easyBandRow = activePlan
    ? (await pool.query<{ lo: number | null; hi: number | null }>(
        `SELECT (workout_spec->>'pace_target_s_per_mi_lo')::float AS lo,
                (workout_spec->>'pace_target_s_per_mi_hi')::float AS hi
           FROM plan_workouts
          WHERE plan_id = $1
            AND workout_spec->>'kind' IN ('easy', 'long')
            AND workout_spec->>'pace_target_s_per_mi_lo' IS NOT NULL
            AND workout_spec->>'pace_target_s_per_mi_hi' IS NOT NULL
          ORDER BY (workout_spec->>'kind' = 'easy') DESC,
                   ABS(date_iso::date - $2::date) ASC,
                   -- EASYBAND-TIE-1 (2026-09-01) · on an exact distance tie
                   -- (a workout sitting equidistant between two easy/long
                   -- rows — common, since most weeks alternate easy/quality
                   -- daily), prefer the FUTURE neighbor over the past one.
                   -- recomputePacesForPlan / reanchorActivePlan only ever
                   -- rewrite rows with date_iso >= "today" that aren't
                   -- sealed; a past-dated row freezes the moment it seals
                   -- (or simply passes) and never gets touched again, while
                   -- a future-dated row keeps receiving every later
                   -- recompute. So a future tie-candidate's band can never
                   -- be staler than a past one's — this is monotonic, not a
                   -- guess. Without it Postgres broke the tie by scan order,
                   -- which in practice favoured the stale past row (verified
                   -- 2026-09-01 on plan pln_9a57561debb776e5: a 2026-09-01
                   -- workout picked 2026-08-31's pre-recompute band over
                   -- 2026-09-02's current one, 21 s/mi apart).
                   (date_iso::date > $2::date) DESC
          LIMIT 1`,
        [activePlan.id, today],
      ).catch((e) => { console.error('[v5/today] easy band read failed', e); return { rows: [] as any[] }; })).rows[0]
    : null;
  const easyPaceAnchor = easyBandRow?.lo != null && easyBandRow?.hi != null
    ? Math.round((Number(easyBandRow.lo) + Number(easyBandRow.hi)) / 2)
    : null;
  /* WU/CD-CEIL-1 (2026-09-01) · `lo` IS the ceiling — `easyBandRow.lo` is the
   * FAST edge of the authored band (`vdot.ts`'s own comment: "lo is the FAST
   * edge — the ceiling an easy-pace prescription must not cross"), which is
   * the number `docs/PRODUCT_DECISIONS.md` 2026-08-31 says a warm-up or
   * cool-down should be judged against, not the midpoint `easyPaceAnchor`
   * above. Kept as a separate value rather than redefining `easyPaceAnchor`
   * itself, because that midpoint still does other jobs downstream (the
   * fuelling-duration estimate below) that have nothing to do with WU/CD and
   * should not silently move every time this ceiling does. */
  const easyCeilingSec = easyBandRow?.lo != null ? Math.round(Number(easyBandRow.lo)) : null;

  const hrBands = hrTargets({ lthr: glance.lthr, goal_seconds: glance.raceGoalSeconds, goal_distance_mi: glance.raceGoalDistanceMi });
  /* THE tolerance, from THE owner (`lib/training/execution-semantics.ts`).
   *
   * This used to be a local ternary over `strictPrescriptionType`, which maps
   * `tempo → 'tempo'` — matching neither the `'threshold'` nor the
   * `'intervals'` arm, so every tempo day fell to `: 20` while the wrist,
   * classifying on `workout_spec.kind`, graded the same row at 8. 21 live plan
   * rows. The comment that used to sit here claimed the two were the same
   * width, and nothing checked it (Rule 20).
   *
   * `classifySession` reads the SPEC first for exactly this reason, so the
   * phone and the wrist now answer from one function with one input. */
  const cardSessionClass = classifySession(
    todayPlan?.type ?? '',
    (specRow?.workout_spec ?? null) as Record<string, unknown> | null,
  );
  const cardTolerance = sessionToleranceSec(cardSessionClass);

  const prescription: SpecCard | null = !todayPlan
    ? null
    : unprescribable
    ? cardForUnprescribableType({ rawType: todayPlan.type, subLabel: todayPlan.subLabel })
    : (cardFromSpec({
        spec: specRow?.workout_spec ?? null,
        type: prescriptionType,
        subLabel: specRow?.sub_label ?? todayPlan.subLabel ?? null,
        distanceMi: todayPlan.distanceMi,
        easyPaceSec: easyPaceAnchor,
        easyCeilingSec,
        hr: hrBands,
        toleranceSec: cardTolerance,
      })
      // No spec on the row, or a spec kind the expander does not know. The
      // card then carries only what the row itself holds. RULE THREE — a
      // refusal is a correct answer, and a fabricated rep distance is worse
      // than a card that says less.
      ?? cardWithoutSpec({
        type: prescriptionType,
        subLabel: specRow?.sub_label ?? todayPlan.subLabel ?? null,
        distanceMi: todayPlan.distanceMi,
        paceTargetSPerMi: specRow?.pace_target_s_per_mi ?? null,
        hr: hrBands,
      }));

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
  //
  // SPECFIRST-1 · and it now asks the PLAN first. `paceForType` is derived
  // from the runner's LTHR and race goal; `plan_workouts.pace_target_s_per_mi`
  // and the plan's own authored easy band are what the generator actually
  // wrote for this day. Where a real stored number exists it wins, for the
  // same reason the card's structure now does: read before derive. The
  // derived figure stays as the last rung, and 0 (no gels) stays below that.
  const fuelPaceSPerMi =
    specRow?.pace_target_s_per_mi ?? (
      prescriptionType === 'easy' || prescriptionType === 'long' ? easyPaceAnchor : null
    ) ?? paceForType;
  //
  // PRERUN-1 · and it now prefers the PHASES over the pace ladder, because a
  // rep session's minutes are not `miles × one pace` — the warm-up, the
  // cool-down and every jog recovery run minutes per mile slower than the rep
  // whose pace this ladder returns. `sessionMinutes` sums the same phase
  // durations the watch sums, and falls back to the ladder only for a card
  // with no phases behind it. The panel's kicker reads the same function, so
  // "about 54 min" and the gel schedule under it can no longer disagree about
  // how long the run is.
  const fuelingDurationEstMin = sessionMinutes(prescription, fuelPaceSPerMi);
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
        selectionRationale: prescription.selectionRationale,
        steps: prescription.steps.map((s) => ({
          label: s.label, distance_mi: s.distance_mi, reps: s.reps,
          rep_distance_mi: s.rep_distance_mi, duration: s.duration,
          pace_target: s.pace_target, hr_target: s.hr_target, note: s.note,
          recovery: s.recovery, rep_noun: s.rep_noun, effort_target: s.effort_target,
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

  /* PRERUN-1 · the plan for going wrong, off the same key the wrist reads.
   *
   * `splitRuleRegisters` is `lib/watch/build-workout.ts`'s own decorator, so
   * the sentence on the phone is the sentence on the watch, character for
   * character. A rule whose shape neither recognises contributes its own
   * label rather than a guess, and a rule that yields no evidence line at all
   * is dropped rather than rendered empty. */
  const contingency = (() => {
    const raw = (specRow?.workout_spec as Record<string, unknown> | null)?.rules;
    if (!Array.isArray(raw) || raw.length === 0) return null;
    const out = raw
      .map((r) => splitRuleRegisters(r as Record<string, unknown>))
      .filter((r): r is { evidence: string; judgement: string | null } => r.evidence != null);
    return out.length > 0 ? out : null;
  })();

  const ctx: V5TodayContext = emptyContext(today, true, isSteppedDay);
  ctx.todayPlan = todayPlan;
  ctx.todayPlanUnresolved = todayPlanUnresolved;
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
  //
  // PRERUN-1 · and it now asks the PLAN first, the same ladder the fuelling
  // estimate has used since SPECFIRST-1 and the same one the pace stat above
  // now uses. `fuelPaceSPerMi` is already that ladder — stored plan pace, then
  // the plan's own easy band, then the derived figure, then nothing — so the
  // two estimates are built from one number instead of two. They sit on the
  // same screen: "about 54 min" in the panel and a gel schedule underneath
  // that was sized off a different pace was two answers to how long the run
  // takes.
  const totalMi = prescription ? (prescription.total_mi || 0) : 0;
  const kickerMin = sessionMinutes(prescription, fuelPaceSPerMi);
  ctx.weatherKicker = kickerMin > 0 ? `about ${fmtMinutesCasual(kickerMin)}` : null;
  /* ── PRERUN-1 · THE PANEL'S PACE AND THE STEPS' PACE WERE TWO ANSWERS ────
   *
   * This stat used to come from `derivePaces()` in every arm — a tree that
   * hangs off `tPaceFromGoal(goal_seconds, goal_distance_mi)`, i.e. the
   * runner's TYPED GOAL TIME. The steps three lines below it come off the
   * plan's own `workout_spec`. Those are different numbers, and on a warm day
   * with the easing applied above they are now different by more again.
   *
   * The panel's job is to state, large, the pace this session asks for. So it
   * states the pace this session asks for: `workPaceSPerMi`, read off the
   * work phase the card itself renders, ± the tolerance the watch grades
   * against. Same number, same source, one screen.
   *
   * The derived band survives only as the LAST rung, for a day whose spec
   * carries no pace at all (`by_effort` hills), and even then only for the
   * aerobic types where a band off the goal is a defensible statement of
   * intent rather than a target. A by-effort rep day gets no stat, which is
   * correct: the plan declined to name a pace and so does the panel.
   */
  ctx.paceBandStat = !todayPlan || prescriptionType === 'rest' || unprescribable
    ? null
    : prescription?.workPaceSPerMi != null
      ? (prescription.workToleranceSPerMi != null && prescription.workToleranceSPerMi > 0
          ? fmtBand(prescription.workPaceSPerMi - prescription.workToleranceSPerMi,
                    prescription.workPaceSPerMi + prescription.workToleranceSPerMi)
          : fmtSingle(prescription.workPaceSPerMi))
      : (prescriptionType === 'easy' ? fmtBand(dp.easySecLo, dp.easySecHi)
        : prescriptionType === 'long' ? fmtBand(dp.longSecLo, dp.longSecHi)
        : null);
  // A ceiling is a ceiling FOR SOMETHING. On a rest day there is no running
  // to hold under it, and the poster showed "HR ceiling 144 bpm" beside the
  // word REST. Same guard the pace band already has: no plan, no stat.
  //
  // PRERUN-1 · AND A CEILING IS A CEILING ON SOMETHING AEROBIC.
  //
  // `dp.aerobicCapBpm` is the top of Z2. `lib/watch/build-workout.ts` sends it
  // to the wrist for EASY AND LONG ONLY, in as many words — "HR ceiling only
  // for easy/long where staying aerobic is the discipline" — and suppresses it
  // even there when a long run carries an HM/M finish, because a workout-level
  // aerobic ceiling would red-alert through the whole finish and coach the
  // opposite of the prescription (Audit D/D1, 2026-06-07).
  //
  // The phone ignored all of that and printed it on every non-rest day. Live
  // consequence, rendered: "HR ceiling 146 bpm" beside the word RACE on a
  // marathon, and beside INTERVALS on a VO2 session. Both are numbers the
  // runner is supposed to spend the entire session above. Same gate as the
  // wrist now, for the same stated reason.
  ctx.hrCapStat =
    todayPlan
    && !unprescribable
    && (prescriptionType === 'easy' || prescriptionType === 'long' || prescriptionType === 'shakeout')
    && prescription?.hasRacePaceFinish !== true
    && dp.aerobicCapBpm != null
      ? `${dp.aerobicCapBpm} bpm`
      : null;
  // The design's 5a poster shows a third stat, "effort" (an RPE band). No
  // engine constant prescribes one per workout type — Rule 1 in reverse: an
  // invented number is worse than a missing stat. Left null (the panel
  // degrades to two stats) rather than making one up; see the report's
  // honesty note on this field.
  ctx.effortStat = null;
  ctx.why = why;
  ctx.thesis = thesis ? wireThesis(thesis) : null;
  ctx.whereYouAre = buildWhereYouAre(glance, fitnessRow);
  ctx.beforeYouGo = beforeYouGo;
  ctx.raceDay = raceDay;
  ctx.contingency = contingency;
  ctx.convergence = convergence;
  ctx.paceNote = await loadPaceNoteRow(activePlan?.id ?? null);
  ctx.blockNote = await loadBlockNote(userId);

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

function emptyContext(todayISO: string, raceMode: boolean, isSteppedDay = false): V5TodayContext {
  return {
    todayISO, raceMode, isSteppedDay,
    todayPlan: null, weekLine: null, phaseLine: null, weekStripDays: [],
    prescription: null, weatherKicker: null, paceBandStat: null, hrCapStat: null, effortStat: null, why: null,
    whereYouAre: [], beforeYouGo: [], raceDay: false, contingency: null, recentRun: null,
    weekOff: null, offSeason: null, injury: null, convergence: null,
    paceNote: null, blockNote: null, sick: null,
  };
}

/**
 * 2026-08-28 · the block-transition note for Today's own surface.
 *
 * The recovery→build handoff (and its lifecycle siblings) now auto-applies —
 * `fireAutoRebuild` writes an `auto_applied` plan_proposals row and
 * `notifyBlockStarted` sends the 07:15 push. This is the in-app half: on the
 * morning the block starts, Today says so in the coach's own words instead of
 * greeting the runner with a silently reset week counter.
 *
 * Reads the same `loadPlanProposals` surface read the web notice card uses
 * (24h auto_applied window built in), and the same `PLAN_TITLES` headline map
 * `CoachDecisionCard` renders — one source, so the note and the card can
 * never tell the story differently. Only the block-transition kinds surface
 * here; drift rebuilds keep their card and do not double as a Today banner.
 * Never throws — an absent note is a quiet Today, not a failed one.
 */
const BLOCK_NOTE_KINDS = new Set([
  'recovery_complete', 'plan_elapsed', 'race_graduate', 'maintenance_to_raceprep',
]);
async function loadBlockNote(
  userId: string,
): Promise<{ title: string; body: string } | null> {
  try {
    const { loadPlanProposals } = await import('@/lib/plan/proposals-state');
    const { PLAN_TITLES } = await import('@/lib/coach/decision-cards');
    const row = (await loadPlanProposals(userId)).find(
      (p) => p.status === 'auto_applied' && BLOCK_NOTE_KINDS.has(p.kind),
    );
    if (!row) return null;
    const body = (row.message ?? '').trim();
    if (!body) return null;
    return { title: PLAN_TITLES[row.kind] ?? 'Your training plan changed', body };
  } catch {
    return null;
  }
}

/**
 * The fitness read, as one row. Never throws.
 *
 * Its own failure must not cost the runner the rest of "Where you are" — a
 * null here drops one row, where a rejection would blank Today. Same posture
 * as `/api/coach/read`'s `quiet()` helper, which was written for this exact
 * reason: "a partial answer is useful and a 500 is not."
 *
 * FLOOR-1 · `inputs.runFloorMi` is threaded into `bestRecentVdot` rather than
 * letting it take its 4.0 default, so this route's candidate set is the same
 * one the projection cron, the drift monitor and the plan generator see. A
 * 5K-goal runner gets a different set on the same day otherwise, which is the
 * "cron computes a VDOT while drift sees none" hazard vdot-inputs.ts names.
 */
async function loadFitnessRow(userId: string, todayISO: string): Promise<V5Row | null> {
  try {
    const inputs = await loadVdotInputs(userId, todayISO);
    const { best, considered } = bestRecentVdot(
      inputs.raceCandidates,
      todayISO,
      undefined,
      inputs.runCandidates,
      inputs.runFloorMi,
    );
    const estimate = resolveFitness({ best, considered });
    // "Has this runner trained at all" decides refusal-vs-silence, not
    // whether we could produce an estimate. Someone with runs on the board
    // and no current race is owed the sentence; a brand new account is not.
    const hasAnyTraining =
      inputs.runCandidates.length > 0 || inputs.raceCandidates.length > 0;
    return buildFitnessRow(estimate, { hasAnyTraining });
  } catch (err) {
    console.warn('[v5/today] fitness read unreadable:',
      err instanceof Error ? err.message : err);
    return null;
  }
}

function buildWhereYouAre(
  glance: Awaited<ReturnType<typeof loadGlanceState>>,
  fitnessRow: V5Row | null,
): V5Row[] {
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
  // After readiness, before the week. Readiness is how the runner is TODAY,
  // fitness is what they are worth, the week is what they have done. The
  // section reads in that order. Null when the read failed or when there is
  // no runner to read yet; a refusal is a row, not a null.
  if (fitnessRow) rows.push(fitnessRow);
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

/* PRERUN-1 · both of these carried the `6:60/mi` bug.
 *
 * `Math.floor(s / 60)` with `Math.round(s % 60)` carries the SECONDS to 60
 * without the minute hearing about it: 419.6 s/mi printed "6:60/mi". This is
 * the bug `lib/format/run.ts` was extracted to end and that `spec-card.ts`'s
 * own `fmtPace` documents killing — and it was still live in the two
 * formatters that write the panel's largest stat, which is the one number on
 * the screen a runner reads at a glance. Now routed through the shared
 * formatter, which rounds the total before it splits it.
 *
 * `dp.easySecLo` and friends are averages of Daniels table entries and land on
 * fractional seconds routinely, so this was not theoretical.
 */
/**
 * PRERUN-1 · how many minutes today's session takes, one definition.
 *
 * Phases first — that is the expander's own arithmetic, already carrying the
 * heat easing, and the same sum `lib/watch/build-workout.ts` puts on the
 * wrist as `totalEstimatedMinutes`. The pace ladder is the fallback for a card
 * with no phases behind it (a plan row with no `workout_spec`).
 *
 * Returns 0 when neither is available, which is the caller's cue to say
 * nothing: `computeFueling` prescribes no gels off a zero and the panel omits
 * the kicker entirely. A missing estimate beats an invented one.
 */
function sessionMinutes(card: SpecCard | null, fallbackPaceSPerMi: number | null): number {
  if (!card) return 0;
  if (card.totalDurationSec != null && card.totalDurationSec > 0) {
    return Math.round(card.totalDurationSec / 60);
  }
  const mi = card.total_mi || 0;
  if (mi > 0 && fallbackPaceSPerMi != null && fallbackPaceSPerMi > 0) {
    return Math.round((mi * fallbackPaceSPerMi) / 60);
  }
  return 0;
}

function fmtBand(loS: number | null, hiS: number | null): string | null {
  const lo = fmtPaceShared(loS);
  const hi = fmtPaceShared(hiS);
  if (lo == null || hi == null) return null;
  return lo === hi ? `${lo}/mi` : `${lo}-${hi}/mi`;
}
function fmtSingle(s: number | null): string | null {
  const p = fmtPaceShared(s);
  return p == null ? null : `${p}/mi`;
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
// 2026-08-24 · lifted to lib/training/prescriptions.ts (byte-identical) so the
// watch, which casts instead of narrowing, has the same function to reach for.
const toPrescriptionType = narrowToPrescriptionType;


