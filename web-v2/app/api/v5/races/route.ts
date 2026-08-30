/**
 * GET /api/v5/races · the v5 Races destination (design handoff screen 7a).
 *
 * TWO AXES, AND BOTH ARE REAL — see `docs/faff-iphone-design-contract.md`
 * §2 and `lib/training/race-card.ts`'s header. The VERDICT
 * (`assessGoal()`'s `feasibility`) is always present. The TRIGGER — why
 * we're asking NOW — may be absent, and four of the eight values the design
 * lists are not a decision about the goal at all (a fact, or a choice only
 * the runner can make). This route resolves whichever of those four facts/
 * choices is real (heat, course-elevation conflict, an unlocked chip time,
 * two A races) and hands the answer to `composeRaceCard`, which is the pure
 * half that turns (verdict, trigger) into the wire-shaped card and is
 * exercised directly by `lib/training/_race_card.test.ts`.
 *
 * Also closes three backend gaps named in `docs/design/iphone-v5/BUILD-
 * PLAN.md`:
 *   B6 · the projected-finish series was loaded elsewhere and never
 *        returned — here it's `trend` / `trendHeadline` / `trendDelta`.
 *        2026-08-30: the series was ALSO the wrong quantity (it read
 *        `projection_snapshots`, the frozen current-fitness equivalence,
 *        under a headline computed from the trajectory). It now reads
 *        `goal_projection_snapshots`. See the B6 block below.
 *   B7 · no evidence list of the races that count toward the fitness read —
 *        here it's `evidence`, built off the exact candidate pool
 *        `loadVdotInputs` hands `bestRecentVdot`, each row's authority
 *        graded by `lib/race/effort-authority.ts`'s SELECTION model and a
 *        provisional (chip-not-locked) race labelled with the CLAUDE.md
 *        canonical caption rather than presented as a result.
 *   (unlisted) the schedule's `authority` field, filled in for every past
 *        race with a result, null (not "unrepresentative") for anything
 *        still ahead — authority is "once known", not asserted early.
 */
import { NextRequest, NextResponse } from 'next/server';
import { dateWords } from '@/lib/format/date';
import { withRequestMemo } from '@/lib/runtime/request-memo';
import { pool } from '@/lib/db/pool';
import { rowOrNull, rowsOrNull } from '@/lib/db/read';
import { requireUserId } from '@/lib/auth/session';
import { runnerToday } from '@/lib/runtime/runner-tz';
import {
  loadRacesState, PROVISIONAL_FINISH_LABEL, WATCH_PROVISIONAL_FINISH_LABEL, type RaceRow,
} from '@/lib/coach/races-state';
import { loadLatestVdotWithAnchor } from '@/lib/training/projection-snapshots';
import { loadGoalProjectionSeries } from '@/lib/training/goal-projection-snapshots';
import { composeProjectionTrend } from '@/lib/training/projection-trend';
import { loadVdotInputs } from '@/lib/training/vdot-inputs';
import { parseRaceTime, formatRaceTime, predictRaceTime } from '@/lib/training/vdot';
import { assessGoal } from '@/lib/training/goal-assessment';
import { computeGoalProjection } from '@/lib/training/goal-projection';
import { taperWeeksForDistance } from '@/lib/training/fitness-trajectory';
import { recentWeeklyMileageMi } from '@/lib/runs/volume';
import { selectionAuthority, authorityTier, type AuthorityTier } from '@/lib/race/effort-authority';
import { resolveCourseElevation, type ResolveCourseElevationInput } from '@/lib/race/course-elevation';
import { computeRaceConditions } from '@/lib/training/race-conditions';
import { loadCoachLog } from '@/lib/coach/coach-log';
import {
  composeRaceCard, heatFactCard, courseChangedFactCard, chipLockFactCard, twoARacesChoiceCard,
  collidingARacePair,
  TRIGGER_SUPPRESS_DAYS,
  type FactChoiceSpec, type FactChoiceTriggerId, type V5DecisionCardOut,
} from '@/lib/training/race-card';
import { outage } from '@/lib/route/failure';

export const dynamic = 'force-dynamic';

interface V5NumberOut { text: string | null; modelled: boolean; }
interface V5StatOut { label: string; value: V5NumberOut; tone: string | null; }
/**
 * A list row. `tone` inks the VALUE — 'attention' is the design's word for
 * "a decision waiting", which is exactly what an unconfirmed finish is.
 *
 * 2026-08-21 · race-data re-audit · the field was absent, so the phone (whose
 * `V5Row` has always decoded `tone` and defaulted it to neutral) drew the
 * provisional caption in quiet grey. The `~` said "modelled" and the colour
 * said "settled".
 */
interface V5RowOut {
  id: string; label: string; sub: string | null;
  value: V5NumberOut | null; action: string | null;
  tone?: 'attention' | 'signal' | 'fault' | null;
}

const num = (text: string | null, modelled: boolean): V5NumberOut => ({ text, modelled });

// ─── trigger suppression (coach_intents, additive, text-JSON per the
//     existing convention — see lib/plan/adapt.ts's writeIntent) ───────────

const SUPPRESS_REASON = 'goal_card_dismissed';

/** The dismissed triggers, or `null` when the suppression read FAILED. */
async function loadSuppressedTriggers(userId: string, todayISO: string): Promise<Set<FactChoiceTriggerId> | null> {
  const cutoff = new Date(Date.parse(todayISO + 'T12:00:00Z') - TRIGGER_SUPPRESS_DAYS * 86400000)
    .toISOString().slice(0, 10);
  // 2026-08-24 · swallowed-failure sweep · `coach_intents.user_id` is `uuid`,
  // so `COALESCE(user_uuid::text, user_id)` was `COALESCE types text and uuid
  // cannot be matched` and this threw on every render. `.catch(() => [])` made
  // it "nothing is suppressed", which is why a fact/choice card the runner had
  // already dismissed came back on the next load, every time.
  const rows = await rowsOrNull<{ field: string | null }>(
    'v5/races · loadSuppressedTriggers',
    pool.query<{ field: string | null }>(
      `SELECT field FROM coach_intents
      WHERE COALESCE(user_uuid, user_id) = $1::uuid
        AND reason = $2
        AND ts >= $3::date`,
      [userId, SUPPRESS_REASON, cutoff],
    ),
  );
  // A failed read is not an empty suppression set. Returning null lets the
  // caller hold every trigger back rather than re-ask a question the runner
  // has already answered.
  if (rows === null) return null;
  return new Set(rows.map(r => r.field).filter((f): f is FactChoiceTriggerId =>
    f === 'heat' || f === 'course_changed' || f === 'chip_lock' || f === 'two_a_races'));
}

// ─── the four fact/choice detectors — each returns null when it genuinely
//     cannot resolve, never a fabricated trigger ──────────────────────────

/**
 * "Chip-time lock approaching" is about the runner's OWN just-run race, not
 * the next one ahead — `nextA` is always upcoming by construction. Looks at
 * the most recent PAST race (any priority: a demoted A that already
 * happened still needs its result locked) within a real recency window —
 * a provisional result from three months ago is a data-hygiene problem,
 * not "approaching".
 */
async function detectChipLock(past: RaceRow[]): Promise<FactChoiceSpec | null> {
  const recent = [...past].filter(r => r.days >= -21).sort((a, b) => b.days - a.days)[0] ?? null;
  if (!recent || !recent.finishTime || !recent.finishProvisional) return null;
  return chipLockFactCard(recent.name);
}

async function detectTwoARaces(aRaces: RaceRow[]): Promise<FactChoiceSpec | null> {
  // Two A races are only a conflict when one block cannot serve both — see
  // `collidingARacePair`, which owns the window and the reasoning.
  const pair = collidingARacePair(aRaces.filter(r => !r.is_past));
  if (!pair) return null;
  const [a, b] = pair;
  return twoARacesChoiceCard({ slug: a.slug, name: a.name }, { slug: b.slug, name: b.name });
}

async function detectCourseChanged(race: RaceRow | null, userId: string): Promise<FactChoiceSpec | null> {
  if (!race || race.is_past) return null;
  const row = await pool.query<{ course_geometry: unknown }>(
    `SELECT course_geometry FROM races WHERE slug = $1 AND user_uuid = $2`,
    [race.slug, userId],
  ).then(r => r.rows[0] ?? null).catch(() => null);
  if (!row?.course_geometry) return null;
  const libRow = await pool.query<{ elevation_gain_ft: number | string | null; net_elevation_ft: number | string | null }>(
    `SELECT elevation_gain_ft, net_elevation_ft FROM course_library WHERE slug = $1`,
    [race.slug],
  ).then(r => r.rows[0] ?? null).catch(() => null);
  if (!libRow) return null; // nothing curated to conflict with
  try {
    const input: ResolveCourseElevationInput = {
      lib: libRow,
      geometry: row.course_geometry as ResolveCourseElevationInput['geometry'],
      nominalDistanceMi: race.distance_mi,
    };
    const resolved = resolveCourseElevation(input);
    if (!resolved.conflict) return null;
    return courseChangedFactCard(race.name);
  } catch {
    return null; // never fake a conflict off a shape we couldn't parse
  }
}

async function detectHeat(race: RaceRow | null, userId: string, vdot: number | null): Promise<FactChoiceSpec | null> {
  if (!race || race.is_past || !race.date || !race.distance_mi || !race.goal) return null;
  const goalSec = parseRaceTime(race.goal);
  if (!goalSec) return null;
  const geo = await pool.query<{ course_geometry: unknown }>(
    `SELECT course_geometry FROM races WHERE slug = $1 AND user_uuid = $2`,
    [race.slug, userId],
  ).then(r => r.rows[0]?.course_geometry ?? null).catch(() => null);
  const g = geo as { trackPoints?: Array<{ lat?: number | null; lon?: number | null }> } | null;
  const tp = g?.trackPoints?.find(p => typeof p?.lat === 'number' && typeof p?.lon === 'number');
  if (!tp?.lat || !tp?.lon) return null; // no course GPS → no honest forecast location
  try {
    const cond = await computeRaceConditions({
      raceSlug: race.slug, raceDateISO: race.date, location: race.location,
      raceLat: tp.lat, raceLng: tp.lon, distanceMi: race.distance_mi,
      goalSec, vdot, startTimeLocal: null, todayISO: null,
    });
    // Only a REAL forecast (not a climate-normal guess) and a materially hot
    // read fire this — the same >85°F safety line and doctrine WBGT band
    // (Research/06:141-148) already used on the race-detail/targets surfaces.
    if (cond.source !== 'forecast') return null;
    if (cond.safetyMessage == null && cond.heatBand !== 'hot' && cond.heatBand !== 'extreme') return null;
    return heatFactCard(race.name, cond.tempF);
  } catch {
    return null;
  }
}

/**
 * 2026-08-24 · swallowed-failure sweep · this counted rows in `injuries`.
 * There is no such table. Every other consumer in the app — glance-state,
 * adapt.ts Q-08, injury-builder, build-workout, the whole /api/injuries
 * surface — reads `runner_injuries`; this one reader invented a name.
 * Postgres answered `relation "injuries" does not exist` on every call, and the
 * `.catch` handed back `'0'`, so the races surface has told every runner they
 * are not coming back from anything. Prod on 2026-08-24 holds an open,
 * unresolved left-calf injury logged 2026-08-21 — the corrected query returns
 * 1 for that runner and this one returned 0.
 *
 * Returns null when the read fails: "no injury" is a claim about the runner's
 * body and must not be minted out of an error.
 */
async function detectReturningFromInjury(userId: string): Promise<boolean | null> {
  const row = await rowOrNull<{ n: string }>(
    'v5/races · detectReturningFromInjury',
    pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM runner_injuries
      WHERE user_uuid = $1::uuid AND (resolved_date IS NULL OR resolved_date >= CURRENT_DATE - INTERVAL '30 days')`,
      [userId],
    ),
  );
  if (row == null) return null;
  return Number(row.n ?? 0) > 0;
}

// ─── evidence + schedule ────────────────────────────────────────────────────

/**
 * The tier to publish for a schedule row.
 *
 * 2026-08-21 · race-data re-audit · this used to grade from the declared A/B/C
 * priority ALONE, so a race the runner had explicitly reported as compromised
 * or unrepresentative still shipped `authority: 'representative'` to the phone
 * for as long as it was an A or B race. The runner's own answer
 * (`actual_result.authority_tier`) is the more specific fact and it wins.
 *
 * DOWNWARD ONLY, matching `bestRecentVdot`'s cap and `POST
 * /api/v5/race-authority`'s own stated doctrine: the runner can tell us their
 * A race did not count, not that their parkrun did.
 */
function raceRowAuthority(
  priority: string | null,
  hasResult: boolean,
  reported: AuthorityTier | null,
): AuthorityTier | null {
  if (!hasResult) return null; // "once known" — an upcoming race has nothing to grade yet
  const declared = authorityTier(selectionAuthority(priority));
  if (!reported || reported === 'representative') return declared;
  if (declared === 'unrepresentative') return declared; // already at the floor
  return reported;
}


/**
 * "Sun, Dec 6, 2026". A schedule row was printing the raw ISO date, which is
 * the database showing through — the same class of leak as "about 0 min" on a
 * rest day. The words themselves now come from `lib/format/date`, which is the
 * one place that decides how a date is written down; this file used to carry
 * its own copy, and so did the race-detail route.
 */
const raceDateWords = (iso: string | null | undefined): string => dateWords(iso);

// 2026-08-21 perf · read-only surface · one memo scope per request. Scope
// dies with the response; nothing is cached between requests. If this route
// ever WRITES, the writer must memoDrop what it invalidates.
export async function GET(req: NextRequest) {
  return withRequestMemo(() => handleGET(req));
}

async function handleGET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  try {
    const todayISO = await runnerToday(userId);
    const racesState = await loadRacesState(userId);
    const upcomingAs = racesState.aRaces.filter(r => !r.is_past).sort((a, b) => a.days - b.days);
    const nextA: RaceRow | null = upcomingAs[0] ?? racesState.aRace ?? null;

    const suppressed = await loadSuppressedTriggers(userId, todayISO);

    // ── the panel ──────────────────────────────────────────────────────────
    let panel: {
      dayState: string; quiet: boolean; place: string; dateLine: string;
      weekLine: string | null; kicker: string | null; type: string;
      dose: V5NumberOut | null; stats: V5StatOut[];
    };

    let card: V5DecisionCardOut | null = null;
    let evidence: V5RowOut[] = [];
    let trend: number[] = [];
    let trendHeadline: V5NumberOut | null = null;
    let trendDelta: V5NumberOut | null = null;
    let trendFootnotes: string[] = [];

    if (!nextA) {
      // RULE THREE. This used to fall all the way through to a 200 carrying a
      // "No goal set" panel over `card: null`, `schedule: []`, `evidence: []`,
      // `trend: []` — a full scaffold with every slot empty and no reason
      // anywhere in it, so the phone rendered a Races screen that answered
      // nothing and never said why. Same defect /api/v5/block was fixed for.
      //
      // 404 + a reason is what the phone reads as `absentReason`, which
      // renders `Silence`: a designed refusal, visually distinct from the
      // outage screen and carrying the engine's own sentence.
      // `error` is the code and `reason` is the sentence — the phone's
      // `V5Refusal` decoder needs `reason` non-empty or this lands on the
      // outage screen instead of `Silence` (see the note in block/route.ts).
      return NextResponse.json(
        {
          error: 'no_goal_race',
          reason: 'No goal race is set. The projection, the evidence and the schedule are all built around one, so there is nothing here to read yet.',
        },
        { status: 404 },
      );
    } else {
      const distanceMi = nextA.distance_mi;
      const goalSec = parseRaceTime(nextA.goal);
      const goalDateISO = nextA.date;

      const { vdot, anchorDateISO, anchorDistanceMi } = await loadLatestVdotWithAnchor(userId);
      const weeklyMi = await recentWeeklyMileageMi(userId).catch(() => null);
      const anchorAgeDays = anchorDateISO
        ? Math.floor((Date.parse(todayISO + 'T12:00:00Z') - Date.parse(anchorDateISO.slice(0, 10) + 'T12:00:00Z')) / 86400000)
        : null;
      const weeksAway = nextA.days / 7;
      const taperWeeks = distanceMi ? taperWeeksForDistance(distanceMi) : 0;

      const assessment = (distanceMi != null && distanceMi > 0 && goalSec != null && goalDateISO)
        ? assessGoal({
            distanceMi, goalSec, goalDateISO, todayISO,
            currentVdot: vdot, executionQuality: null, recentWeeklyMi: weeklyMi,
            context: {
              inTaperOrRaceWeek: nextA.days <= 7 || weeksAway <= taperWeeks,
              inPostRaceRecovery: null,
              anchorDistanceMi, anchorAgeDays,
              marathonSpecificBlockDone: null,
            },
          })
        : null;

      // ── the four fact/choice detectors, in the order the design's own
      //    table lists them. First real one wins; suppressed ones are
      //    skipped so an answered trigger doesn't re-fire for its window.
      let factOrChoice: FactChoiceSpec | null = null;
      //    `suppressed === null` means the dismissal read failed. Every
      //    trigger stays down: asking a question the runner has already
      //    answered is worse than not asking, and we cannot tell which.
      if (suppressed !== null) {
        if (!suppressed.has('heat')) factOrChoice = await detectHeat(nextA, userId, vdot);
        if (!factOrChoice && !suppressed.has('course_changed')) factOrChoice = await detectCourseChanged(nextA, userId);
        if (!factOrChoice && !suppressed.has('chip_lock')) factOrChoice = await detectChipLock(racesState.past);
        if (!factOrChoice && !suppressed.has('two_a_races')) factOrChoice = await detectTwoARaces(racesState.aRaces);
      }

      if (assessment) {
        const returningFromInjury = await detectReturningFromInjury(userId);
        // null = the injury read failed. The card keeps its non-injury framing
        // rather than asserting a body state it could not check; the failure is
        // in the log, not smuggled into the copy.
        card = composeRaceCard({
          assessment,
          factOrChoice,
          returningFromInjury: returningFromInjury === true,
        });
      }

      // "Projected" has to answer "where does this build land me on race day",
      // not "what could I run today" — a frozen current-VDOT lookup is why the
      // number sat still for months waiting on a race while the runner trained
      // (David, 2026-08-26: [[feedback_progress_is_the_guiding_light]],
      // [[feedback_execution_is_the_lever]]). computeGoalProjection's
      // trajectory is the SAME execution-scaled, doctrine-cited model already
      // live on Targets (goal-projection.ts) — current VDOT plus the planned
      // build, scaled by how the runner is actually executing it, projected to
      // race day. Reused, not reimplemented, so the two surfaces can't drift.
      // Falls back to the static equivalence at cold start or on failure.
      const goalProjection = (distanceMi != null && distanceMi > 0 && goalSec != null && goalDateISO)
        ? await computeGoalProjection({
            userUuid: userId,
            goalSec,
            raceDistanceMi: distanceMi,
            vdot,
            daysToRace: nextA.days,
            vdotAnchorDateISO: anchorDateISO,
            vdotAnchorDistanceMi: anchorDistanceMi,
          }).catch(() => null)
        : null;

      const projectedSec = goalProjection?.trajectory?.projectedSec
        ?? goalProjection?.vdotProjectionSec
        ?? assessment?.currentEquivalentSec
        ?? (vdot != null && distanceMi ? predictRaceTime(vdot, distanceMi) : null);
      const gapSec = (projectedSec != null && goalSec != null) ? projectedSec - goalSec : null;

      const stats: V5StatOut[] = [
        { label: 'Goal', value: num(goalSec != null ? formatRaceTime(goalSec) : null, false), tone: null },
        { label: 'Projected', value: num(projectedSec != null ? formatRaceTime(projectedSec) : null, true), tone: null },
        {
          label: 'Gap',
          value: num(gapSec != null ? `${gapSec > 0 ? '+' : gapSec < 0 ? '−' : ''}${formatRaceTime(Math.abs(gapSec))}` : null, true),
          tone: gapSec != null && gapSec > 0 ? 'attention' : null,
        },
      ];

      panel = {
        dayState: 'long', quiet: false, place: 'Races',
        dateLine: 'Next A race',
        weekLine: upcomingAs.length > 0 ? `${upcomingAs.length} A race${upcomingAs.length === 1 ? '' : 's'} this season` : null,
        kicker: nextA.days >= 0 ? `${nextA.days} days out` : null,
        type: nextA.name,
        // The panel's own dose line. This printed the raw column — the third
        // place in this codebase to leak an ISO date into copy, after the
        // schedule rows and race detail.
        dose: num(
          [raceDateWords(nextA.date), nextA.distance_label].filter(Boolean).join(' · ') || null,
          false,
        ),
        stats,
      };

      // ── B6 · the projected-finish trend ────────────────────────────────
      //
      // THE HEADLINE AND THE BARS ARE ONE QUANTITY. They were two.
      //
      // `trendHeadline` has always been `projectedSec` above — the
      // execution-scaled TRAJECTORY out of computeGoalProjection. The bars
      // were `loadProjectionSeries` off
      // `projection_snapshots`, which stores the raw current-fitness
      // equivalence `predictRaceTime(vdot, d)`. Different models of
      // different things, stacked one on top of the other in one card:
      // on the owner's phone, 3:22:17 over bars sitting at 3:31:48.
      //
      // Worse, the plotted quantity only moves when a race or time trial
      // re-anchors VDOT, so it had 13 rows and ONE distinct value for his
      // marathon distance. Thirteen identical rectangles, captioned as a
      // trend.
      //
      // The series is now `goal_projection_snapshots` — the daily read of
      // the SAME trajectory number, written by the snapshot cron and keyed
      // to this race's slug (a trajectory belongs to a goal race, not to a
      // distance: two A races at 26.2 with different goals and different
      // race days are different trajectories). Today's live value is
      // appended by composeProjectionTrend, so the highlighted bar IS the
      // headline by construction rather than by luck.
      //
      // Nothing is back-filled. The trajectory series starts the day the
      // cron starts writing it; before then the card says so in words.
      {
        const series = await loadGoalProjectionSeries(userId, nextA.slug);
        const composed = composeProjectionTrend({
          series,
          todayProjectedSec: projectedSec,
          todayISO,
          anchorAgeDays: anchorDateISO != null ? anchorAgeDays : null,
        });
        trend = composed.values;
        trendHeadline = projectedSec != null ? num(formatRaceTime(projectedSec), true) : null;
        // The delta David asked for. Modelled, like everything derived from
        // the trajectory, so it rides a V5Number and the phone never has to
        // re-decide the basis.
        trendDelta = composed.delta != null ? num(composed.delta.text, true) : null;
        trendFootnotes = composed.footnotes;
      }

      // ── B7 · the evidence list — the exact pool bestRecentVdot selects
      //    from, each row graded by SELECTION authority and a provisional
      //    (chip-not-locked) row labelled per CLAUDE.md, never presented
      //    as a result. ──────────────────────────────────────────────────
      try {
        const inputs = await loadVdotInputs(userId, todayISO);
        evidence = inputs.raceCandidates
          .slice()
          .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
          .slice(0, 8)
          .map((c) => {
            // Same downward-only cap the schedule list applies, so the two
            // lists in this one response cannot caption the same race
            // "Counts fully" and "compromised".
            const tier = raceRowAuthority(c.priority, true, c.runner_authority_tier)!;
            const subParts = [c.date, c.priority ? `${c.priority} race` : null].filter(Boolean) as string[];
            // The two provisional rungs have different captions, and the
            // schedule list in this same response already prints the right
            // one. Printing "Training effort · race to lock in" over an
            // auto-logged WATCH time said the wrong thing about where the
            // number came from — the race WAS run, the chip time just isn't
            // in yet.
            if (c.provisional) {
              subParts.push(c.provisionalSource === 'watch'
                ? WATCH_PROVISIONAL_FINISH_LABEL
                : PROVISIONAL_FINISH_LABEL);
            }
            else subParts.push(tier === 'representative' ? 'Counts fully' : tier === 'compromised' ? 'Counts, reduced weight' : 'Barely counts');
            return {
              id: c.slug, label: c.name, sub: subParts.join(' · '),
              tone: c.provisional ? 'attention' as const : null,
              // RULE ONE. `false` here contradicted the schedule list further
              // down this same response, which already passes
              // `r.finishProvisional` — so one payload showed the same race's
              // time as a hard chip result in the evidence list and as
              // modelled in the schedule. The branch knew: it stamps
              // PROVISIONAL_FINISH_LABEL into `sub` three lines above. A
              // provisional time is a training effort with a race still to
              // lock it in, and CLAUDE.md's race-data rule says it must never
              // render as authoritative race performance.
              value: num(c.finish_seconds != null ? formatRaceTime(c.finish_seconds) : null, !!c.provisional),
              action: 'open_race',
            };
          });
      } catch {
        evidence = [];
      }
    }

    // ── the schedule — every race, upcoming soonest-first, past dimmed ────
    // 2026-08-26 · David: tier (A/B/C) is not a sort key, only a badge —
    // concatenating aRaces-then-Bs-then-Cs put a March 2027 A race above a
    // September 2026 B race. Upcoming races are date-sorted individually in
    // races-state.ts (races-state.ts:277); this just has to merge those
    // three tiers back into one date order instead of stacking them.
    const schedule = [
      ...[...racesState.aRaces.filter(r => !r.is_past), ...racesState.upcomingBs, ...racesState.upcomingCs]
        .sort((a, b) => a.date.localeCompare(b.date)),
      ...racesState.past,
    ].map((r) => {
      const hasResult = !!r.finishTime;
      const detail: V5RowOut[] = [];
      if (r.location) detail.push({ id: 'location', label: 'Location', sub: null, value: num(r.location, false), action: null });
      if (r.gun_time) detail.push({ id: 'gun', label: 'Gun time', sub: null, value: num(r.gun_time, false), action: null });
      if (r.finishProvisionalLabel) {
        detail.push({
          id: 'provisional', label: 'Status', sub: null,
          value: num(r.finishProvisionalLabel, false), action: null,
          tone: 'attention',
        });
      }
      return {
        id: r.slug, slug: r.slug, name: r.name,
        dateLine: raceDateWords(r.date), distance: r.distance_label ?? '',
        priority: r.priority ?? 'C',
        isPast: r.is_past,
        result: hasResult ? num(r.finishTime, r.finishProvisional) : null,
        detail,
        authority: raceRowAuthority(r.priority, hasResult, r.runnerAuthorityTier),
      };
    });

    // ── the log ─────────────────────────────────────────────────────────
    const logPage = await loadCoachLog(userId, { limit: 6 }).catch(() => ({ entries: [], nextBefore: null }));
    const coachLog = logPage.entries.map(e => ({ id: e.id, kind: e.kind, date: e.dateISO, body: e.body }));

    return NextResponse.json({
      panel, card, schedule, trend, trendHeadline, trendDelta, trendFootnotes, evidence, coachLog,
    });
  } catch (err: unknown) {
    // Was `err?.message` in the body.
    return outage('v5/races', err);
  }
}
