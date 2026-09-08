/**
 * lib/plan/plan-snapshot.ts · PLANSNAPSHOT-1 (2026-09-03/04)
 *
 * The full-block loader behind `GET /api/v5/plan-snapshot`. Returns every
 * authored day of the runner's ACTIVE plan, plan start through plan end (in
 * practice, race day or the block's final day), in one response — so the
 * iPhone can persist ONE versioned local object and never issue a per-date
 * network request to browse a plan it has already synced.
 *
 * ── WHY THIS IS NOT A LOOP OVER `composeToday` ──────────────────────────────
 *
 * `composeToday` (`app/api/v5/today/route.ts`) is ~1900 lines building
 * TODAY's live narrative: readiness, contingency planning, "where you are",
 * race-day strategy, block-transition notes. None of that is meaningful for
 * a day 40 days out, and looping it across a ~120-day block would be both
 * wasteful and wrong — it would either fabricate live-state narrative for
 * days that haven't happened, or silently omit it and call that "the same
 * function." Neither is honest.
 *
 * What IS reused, because these are the canonical resolvers for exactly the
 * questions a snapshot day asks:
 *   - `ownedDaysSql` (`lib/plan/owned-days.ts`) — which plan actually owned
 *     a given date, not a naive `plan_id = active` scope (see that file's
 *     own header for why the naive version is wrong).
 *   - `cardFromSpec` / `cardWithoutSpec` / `cardForUnprescribableType`
 *     (`lib/training/spec-card.ts`) — the SAME phase/pace/HR card
 *     `/api/v5/today` renders, so the phone and the snapshot can never
 *     describe one workout two ways.
 *   - `resolveDateRangeExecutions` (`lib/execution/day-resolver.ts`) — the
 *     SAME matched-vs-supplemental classifier EXECUTION-IDENTITY-1 made
 *     canonical, batched across the whole range instead of called per day.
 *   - `hrTargets` / the easy-band query — the runner's OWN current anchors
 *     (LTHR, easy pace ceiling), read once for the whole block exactly as
 *     `/api/v5/today` reads them once for today. These are the runner's
 *     CURRENT capacity, not date-varying within one read —
 *     `recompute-paces.ts` is what keeps future rows' own stored pace
 *     targets current; this loader does not re-derive that. LTHR itself is
 *     a direct `SELECT lthr FROM profile` (PLANSNAPSHOT-LATENCY-1,
 *     2026-09-07) — NOT `loadGlanceState`, which computes the entire
 *     `/api/v5/today` state (readiness, ACWR, safety, week-strip, HRV/RHR
 *     baselines — ~25-30 queries) to answer a question this file only ever
 *     asked one field of. See that fix's comment at the call site for the
 *     measured cost.
 *
 * ── TREADMILL GUIDANCE — A DELIBERATE SIMPLIFICATION, NAMED HERE ───────────
 *
 * The watch's per-PHASE treadmill incline/speed (`lib/watch/build-workout.ts`,
 * TREADMILL-STATE-MACHINE-1) is out of scope for this pass — that file is
 * under active development by another stream as of this writing, and its
 * per-phase precision is what the wrist actually executes against. This
 * loader instead derives one DAY-LEVEL hint from the card's own already-
 * public `workPaceSPerMi` (the same "work pace" number the card's top-level
 * stat already surfaces) and whether any step names itself a hill rep
 * (`step.rep_noun === 'hills'`, from `cardFromSpec`'s own `repNoun()`) —
 * same two doctrine constants build-workout.ts uses (`Research/04` §8.3
 * medium hill repeats; `TERRAIN.treadmill-air-resistance-grade` for
 * everything else), same formula (mph = 3600 / pace-s-per-mi), read at the
 * DAY level rather than duplicated per phase. A future pass that wants
 * phone-side per-phase treadmill precision should extend this by calling
 * `expandSpecToPhases` directly (the same expander both `cardFromSpec` and
 * `build-workout.ts` already call) rather than re-deriving phase math a
 * third way.
 */
import { pool } from '@/lib/db/pool';
import { planVersionOf } from '@/lib/plan/plan-version';
import { ownedDaysSql } from '@/lib/plan/owned-days';
import { dayNoteFor, loadSkippedDates } from '@/lib/plan/week-loader';
import { resolveDateRangeExecutions, type ExecutionMatch } from '@/lib/execution/day-resolver';
import { runFacts } from '@/lib/runs/run-facts';
import { dayStateWordFor } from '@/lib/faff/v5-today';
import { fmtMi, fmtMinutesCasual } from '@/lib/format/run';
import {
  cardFromSpec, cardWithoutSpec, cardForUnprescribableType, fmtPaceBand, type SpecCard,
} from '@/lib/training/spec-card';
import { hrTargets, narrowToPrescriptionType, strictPrescriptionType } from '@/lib/training/prescriptions';
import { classifySession, sessionToleranceSec } from '@/lib/training/execution-semantics';
import type { WorkoutSpec } from '@/lib/plan/spec-builder';
import { resolveRaceOutlookBySlug } from '@/lib/race/race-outlook';
import { raceProjectionFromOutlook } from '@/lib/training/race-projection';
import { formatRaceTime } from '@/lib/training/vdot';
import { rowsOrEmpty } from '@/lib/db/read';

// Same two doctrine-cited constants `build-workout.ts` uses for its own
// per-phase treadmill incline — see this file's header for why they are
// duplicated here rather than imported (that function is not currently
// exported, and the file is under active concurrent development).
const TREADMILL_HILL_INCLINE_PCT = 5;       // Research/04 §8.3 · medium hill repeats, midpoint of the 4-6% band
const TREADMILL_BASELINE_INCLINE_PCT = 1;   // TERRAIN.treadmill-air-resistance-grade

/* ══════════════════════════════════════════════════════════════════════════
 * FINISHEST-DETERMINISM-1 (2026-09-07) · THE "PROJECTED FINISH" STAT MUST NOT
 * BLINK
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHAT WAS STILL WRONG AFTER FINISHEST-RELIABILITY-1. That fix stopped a
 * timeout from being INDISTINGUISHABLE from a genuine absence in the LOGS. It
 * did not stop the two from being indistinguishable ON THE SCREEN, and it left
 * the decision resting on a wall-clock threshold sitting inside the measured
 * cost distribution. An independent review ran `loadPlanSnapshot` ten times in
 * one process against real production-shaped data and got two different
 * screens for identical underlying rows.
 *
 * Reproduced here, first try, with `scripts/probe-snapshot-flicker.sh` against
 * a scratch copy of the owner's own block (4 race days):
 *
 *   load  1 ·   2569ms · projected 3/4      ← CIM, his GOAL race, missing
 *   load  2 ·   2536ms · projected 4/4
 *   loads 3-10 · 1977-2358ms · projected 4/4
 *
 * That is Rule 9 exactly: "a hair's difference in input must never produce a
 * categorically different plan." Half a second of ordinary cold-start variance
 * decided whether the runner's goal-race day showed a finish time or showed
 * nothing at all.
 *
 * WHICH FIX, AND WHY NOT THE OTHER TWO. Three were on the table.
 *
 *   · HOIST THE SHARED BUNDLE out of the per-race loop and race the deadline
 *     against that one resolution. REJECTED ON EVIDENCE. It was the right
 *     hypothesis — the shared `loadRaceOutlookUserReads` bundle is ~1.9-2.4s
 *     of the ~2.0-2.6s total — but `userReadsInFlight` (READS-DEDUP-1) is a
 *     SINGLE-FLIGHT, not a cache: it deletes its entry the instant the promise
 *     settles, deliberately, so nothing can serve another request stale
 *     evidence. Awaiting the bundle to completion BEFORE the per-race loop
 *     therefore drops the entry and makes all four races recompute it, roughly
 *     doubling the very cost the change was meant to bound. Verified by
 *     reading that file's own single-flight, not assumed.
 *   · RAISE THE DEADLINE ALONE. Insufficient, and Rule 9 says why: "widening a
 *     tolerance around the same threshold relocates the cliff, it does not
 *     remove it." The review measured an outlier at 34s. No number both keeps
 *     the latency guard meaningful and covers that.
 *   · LAST-KNOWN-GOOD (below), plus a budget that covers the MEASURED cost,
 *     plus an honest third state when neither is available. CHOSEN, because it
 *     is the only one where the runner-facing output stops being a function of
 *     latency at all.
 */

/**
 * How long the WHOLE "Projected finish" feature may delay the block read.
 *
 * BANNER-LATENCY-1's posture is unchanged and is the reason a budget exists at
 * all: `loadPlanSnapshot` runs on every launch and every foreground, and a
 * decorative, additive stat on four race days may never delay or break the 100+
 * other days' data. What CHANGED is the number, and it changed for a measured
 * reason rather than a hopeful one.
 *
 * 2500ms was chosen as "comfortably more than this ever needs when warm". It
 * was not: warm is 1977-2358ms and cold is 2536-2569ms locally, and the
 * independent review measured 2.0-3.5s against a dev server. The old value sat
 * INSIDE the distribution it was supposed to sit above, which is what made
 * ordinary variance a screen-state change.
 *
 * 8000ms clears the measured worst case with better than 2x margin and still
 * leaves ~4s of headroom under the phone's 12s client timeout. It is a ceiling
 * on a pathology, not a budget anything normally spends — and because of the
 * last-known-good below, exceeding it no longer changes what the runner reads
 * once this race has resolved successfully even once.
 *
 * THE MEASURED DISTRIBUTION THIS MUST SIT ABOVE, and why it is a named
 * constant rather than a comment. Rule 20: a number argued for only in prose
 * is a hypothesis. An independent review planted `2_500` back — the exact
 * regressed value this exists to correct — and every test in
 * `_skip_and_projection.test.ts` stayed green, because the only test touching
 * this constant asserted an UPPER bound (a resolution past 8.5s must time out)
 * and 2500 satisfies that too. A ceiling alone cannot tell 8000 from 2500.
 * `RACE_PROJECTION_MEASURED_WORST_MS` is the floor, and test 3.7 is what holds
 * it: both the number and the behaviour at that number.
 */

/**
 * The slowest `loadPlanSnapshot` observed against the owner's real block —
 * 40 consecutive loads across 4 fresh processes measured 1974-5413ms
 * (`scripts/probe-snapshot-flicker.sh`).
 *
 * This is the whole-load figure, and the deadline bounds only the per-race
 * outlook resolution inside it, so it OVERSTATES what that resolution can
 * cost. That is the safe direction for a floor: a budget that clears the
 * whole load necessarily clears its dominant term, and reading it the other
 * way is how 2500ms came to sit inside the distribution it was meant to sit
 * above.
 */
export const RACE_PROJECTION_MEASURED_WORST_MS = 5_413;

export const RACE_PROJECTION_DEADLINE_MS = 8_000;

/**
 * How stale a last-known-good projection may be before it stops being served.
 *
 * Rule 16 is the constraint that sets this, not comfort: Race Detail and the
 * Races list resolve this same quantity FRESH on their own screens, so a value
 * served here after a mid-day evidence change could disagree with them. Fifteen
 * minutes bounds that window to something a runner cannot practically observe
 * (it takes a new run landing, plus a snapshot load whose fresh resolution
 * FAILED, plus opening Race Detail, inside the same quarter hour), while still
 * covering a burst of foregrounds — which is the case this exists for.
 *
 * Rule 10 posture, stated explicitly as that rule requires: RECOMPUTE. The
 * anchor is `(userUuid, today)` and it is in the key, so nothing here can
 * outlive the day it was derived for or cross to another runner; every request
 * that beats the budget re-derives and overwrites. This is a fallback for a
 * read that could not complete, never a substitute for doing the read.
 */
const RACE_PROJECTION_LKG_MAX_AGE_MS = 15 * 60_000;

/** Hard ceiling on the map, so a long-lived process cannot grow it without
 *  bound if pruning by age alone is not enough (many users, many races). */
const RACE_PROJECTION_LKG_MAX_ENTRIES = 500;

/**
 * The last projection this process resolved SUCCESSFULLY, per runner, per race,
 * per day.
 *
 * WHY THIS IS NOT THE THING READS-DEDUP-1 REFUSED TO BUILD. That file's header
 * argues, correctly, against a TTL cache over the EVIDENCE BUNDLE: those reads
 * decide coaching, and one request must never serve another request's view of
 * the runner. This holds something categorically smaller and later — a
 * formatted string that has already been through `raceProjectionFromOutlook`,
 * kept only so that a resolution which FAILED does not silently change what is
 * on the screen. It is never consulted on a successful resolution, so it can
 * never override live evidence; the only thing it can do is stop a timeout from
 * blanking a figure this process has already stood behind.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: label itself differently to the runner. An
 * identical stat IS the fix — a value that changes appearance when the backend
 * was slow is the same flicker in a different costume. The honesty is paid
 * where it is actionable: a distinct `console.error` per serve, and
 * `PlanSnapshotResult.projection_served_stale` on the response.
 */
const lastKnownGoodProjection = new Map<string, { text: string; at: number }>();

function projectionCacheKey(userUuid: string, slug: string, today: string): string {
  return `${userUuid}::${slug}::${today}`;
}

function readLastKnownGoodProjection(key: string): { text: string; at: number } | null {
  const hit = lastKnownGoodProjection.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > RACE_PROJECTION_LKG_MAX_AGE_MS) {
    lastKnownGoodProjection.delete(key);
    return null;
  }
  return hit;
}

/**
 * FINISHEST-RESURRECT-1 · forget a projection the engine has WITHDRAWN.
 *
 * The cache above exists so a resolution that FAILED does not blank a figure
 * this process already stood behind. It must never survive the engine's own
 * decision to stop making the claim. Without this, the sequence is: the
 * projection resolves and is remembered; a later load legitimately reaches
 * case 2 and the stat correctly disappears; a third load times out and puts
 * the withdrawn figure back on the screen as a live value.
 *
 * That is strictly worse than the flicker this whole file exists to cure — a
 * flicker is visible and this is not — and it is Rule 11 exactly: "withdrawn"
 * and "we could not find out" are different facts, and a cache that outlives
 * the withdrawal collapses them into the last good one.
 */
function clearLastKnownGoodProjection(key: string): void {
  lastKnownGoodProjection.delete(key);
}

function writeLastKnownGoodProjection(key: string, text: string): void {
  lastKnownGoodProjection.set(key, { text, at: Date.now() });
  const cutoff = Date.now() - RACE_PROJECTION_LKG_MAX_AGE_MS;
  for (const [k, v] of lastKnownGoodProjection) {
    if (v.at < cutoff) lastKnownGoodProjection.delete(k);
  }
  // Insertion order is eviction order; `set` on an existing key does not move
  // it, so a hot entry can be evicted — acceptable, because eviction costs at
  // most one render of the honest third state, never a wrong number.
  while (lastKnownGoodProjection.size > RACE_PROJECTION_LKG_MAX_ENTRIES) {
    const oldest = lastKnownGoodProjection.keys().next();
    if (oldest.done) break;
    lastKnownGoodProjection.delete(oldest.value);
  }
}

/** Test-only reset. The cache is process-global by design, which is exactly
 *  what makes it invisible to a test that cannot clear it. */
export function __resetLastKnownGoodProjectionsForTest(): void {
  lastKnownGoodProjection.clear();
}

/**
 * FINISHEST-RELIABILITY-1's tagged result, unchanged in contract and now
 * EXPORTED and defined at module scope rather than re-declared inside
 * `loadPlanSnapshot` on every call.
 *
 * It was a closure, so nothing could unit-test it, which is precisely how the
 * review was able to collapse the timeout branch back into
 * `{status:'ok', value: null}` and watch the entire suite stay green. A
 * discriminated union is the whole mechanism: the `timeout` and `error`
 * branches carry NO `value` field, so `attempt.value` does not compile until
 * the caller has narrowed to `ok` — the same discipline `NormalReading<T>`
 * uses for Rule 8's refusal-versus-zero distinction, and the reason a
 * genuinely-null projection can never be mistaken for one we never got.
 */
export type DeadlineResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'timeout' }
  | { status: 'error'; error: unknown };

/**
 * Race `p` against `ms`. Three outcomes, never two.
 *
 * NO RETRY AND NO PER-CALL EXTENSION. `loadRaceOutlookUserReads`'s single-flight
 * (READS-DEDUP-1) already makes every race in one block share ONE evidence
 * computation — these calls are issued together, so they attach to the same
 * in-flight promise. A timeout here is therefore a signal about that SHARED
 * bundle; retrying or padding one call would hide the signal rather than
 * surface it.
 */
export async function withDeadline<T>(p: Promise<T>, ms: number): Promise<DeadlineResult<T>> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<DeadlineResult<T>>((resolve) => {
    timer = setTimeout(() => resolve({ status: 'timeout' }), ms);
  });
  try {
    return await Promise.race([
      p.then((value): DeadlineResult<T> => ({ status: 'ok', value })),
      timeout,
    ]);
  } catch (error) {
    // Observed and tagged, never swallowed — the consumer logs this distinctly
    // from a genuine absence before deciding what the runner sees.
    return { status: 'error', error };
  } finally {
    clearTimeout(timer!);
  }
}

export interface PlanSnapshotMatchedRun {
  runId: string;
  distanceMi: number | null;
  durationSec: number | null;
  paceSPerMi: number | null;
  match: ExecutionMatch;
  indoor: boolean;
}

export interface PlanSnapshotSupplementalRun {
  runId: string;
  distanceMi: number;
  durationSec: number | null;
  paceSPerMi: number | null;
  indoor: boolean;
}

export interface PlanSnapshotTreadmillGuidance {
  speedMph: number | null;
  inclinePct: number;
}

/**
 * `SpecCard` minus `citation` AND `selectionRationale`. The voice doctrine
 * forbids a `Research/…` reference on the runner-facing payload ("rooted in
 * research is for the engine, not the runner" — see
 * `lib/plan/week-loader.ts`'s CITESCRUB-1 header).
 *
 * `citation` never reaches `/api/v5/today`'s wire at all (confirmed: no
 * reference to it anywhere in that route) — a snapshot returning the raw
 * `SpecCard` would introduce a leak that does not exist today.
 *
 * `selectionRationale` is a narrower call. `spec-card.ts`'s own doc comment
 * says Today DOES wire it through, explicitly "in the engine's own working
 * voice (candidate counts, doctrine section numbers), not yet passed
 * through a coach-voice rewrite," with the caveat that "a caller putting
 * this in front of the runner as a primary sentence should scrub it
 * first." Verified live against David's real block (walk-substrate,
 * 2026-09-04): it DOES carry raw citations ("Research/04 §15 places it on
 * this slot in QUALITY."). Today's own client apparently treats it with
 * that care already; this snapshot has no equivalent handling built for
 * 105 days rendered without a human choosing which one to show, so it is
 * dropped here too rather than trusted to stay a "secondary field" once
 * every day in the block carries one. A future pass that wants it back
 * should build the same scrub Today's consumer has, not assume none is
 * needed.
 */
export type PlanSnapshotCard = Omit<SpecCard, 'citation' | 'selectionRationale'>;

export function wireSafeCard(card: SpecCard | null): PlanSnapshotCard | null {
  if (!card) return null;
  const { citation: _citation, selectionRationale: _rationale, ...rest } = card;
  return rest;
}

export interface PlanSnapshotDay {
  plan_workout_id: string | null;
  date_iso: string;
  dow: number;
  /** Raw `plan_workouts.type`. `'rest'` and `'race'` are real values here. */
  type: string;
  is_rest: boolean;
  is_race: boolean;
  is_quality: boolean;
  is_long: boolean;
  distance_mi: number;
  sub_label: string | null;
  /** The generator's own per-day sentence — same field `PlanWeekDay.notes`
   *  carries, same citation-scrubbing contract (CITESCRUB-1). This is the
   *  "coaching summary" a day needs; it is NOT `composeToday`'s live
   *  narrative, which this loader does not compute for non-today days. */
  notes: string | null;
  /** Null only for a genuine rest day with no run prescribed. */
  card: PlanSnapshotCard | null;
  /**
   * PLANSNAPSHOT-SKIP-1 (2026-09-07) · `day_actions action='skip'` — the
   * runner explicitly declining a prescribed day (`POST /api/today/skip`),
   * distinct from `is_rest` (plan-prescribed) or a passive miss. Read via
   * `loadSkippedDates` (`lib/plan/week-loader.ts`), the SAME resolver
   * `/api/plan/week` (and therefore `/api/v5/today`'s week strip) already
   * uses — this file previously had zero reference to `day_actions` at all,
   * so a skip recorded correctly in the database still rendered as fully
   * prescribed here. See `PlanSnapshotResult.skip_state_unknown` for what a
   * FAILED read (as opposed to a genuinely unskipped day) does to this
   * field — best-effort `false`, with the top-level flag as the honest
   * signal (Rule 11).
   */
  skipped: boolean;
  treadmill: PlanSnapshotTreadmillGuidance | null;
  matched_run: PlanSnapshotMatchedRun | null;
  supplemental_runs: PlanSnapshotSupplementalRun[];
  /**
   * HEROPANEL-1 (2026-09-04) · every browsed day renders in the SAME hero
   * treatment `/api/v5/today` gives the actual current day — one gradient
   * card, one template, only the color and the numbers changing — not a
   * separate, visually flatter template for "any day that is not today".
   * David, live: "Every day should look like this. The only thing that
   * changes is the color, run, specific info, etc." These four fields are
   * the client's `V5Panel` shape, computed here from data this file already
   * resolves (`card`, `row.workout_spec`) — never `composeToday`'s live
   * narrative, which stays out of scope exactly as this file's header
   * explains. `dayStateWordFor` is the SAME resolver `/api/v5/today` uses
   * for its own gradient, imported rather than re-derived, so the two
   * screens can never pick different colors for one day.
   */
  day_state: string;
  kicker: string | null;
  dose: PlanSnapshotNumber | null;
  stats: PlanSnapshotStat[];
}

/**
 * Mirrors the client's `V5Number` wire shape exactly — see APIV5.swift.
 *
 * `text` is NULLABLE because the phone's own contract makes null mean
 * something no string can: `FaffValue.from(nil, modelled:)` returns
 * `.unreadable`, which the design paints as a fault-red em dash with no value
 * beside it ("We could not read this"). A stat that omits `text` is therefore
 * the app's existing, rendered answer to "we could not find this out" —
 * distinct from a stat that is absent (nothing to say) and from one carrying a
 * figure. FINISHEST-DETERMINISM-1 spends exactly that third state; nothing on
 * the phone had to change to receive it.
 */
export interface PlanSnapshotNumber {
  text: string | null;
  modelled: boolean;
}

/** Mirrors the client's `V5Stat` wire shape exactly — see APIV5.swift. */
export interface PlanSnapshotStat {
  label: string;
  value: PlanSnapshotNumber;
  tone: string | null;
}

export interface PlanSnapshotResult {
  plan_id: string | null;
  plan_version: string | null;
  plan_start_iso: string | null;
  plan_end_iso: string | null;
  today_iso: string;
  synced_at: string;
  days: PlanSnapshotDay[];
  message?: string;
  /**
   * PLANSNAPSHOT-SKIP-1 · mirrors `PlanWeekResult.skipStateUnknown` exactly
   * (same name, same contract) — true when the `day_actions` skip read
   * FAILED rather than legitimately came back empty. `PlanSnapshotDay.skipped`
   * stays a plain boolean on the wire (best-effort `false` under a failed
   * read); this is the flag that lets a caller tell "no day was skipped"
   * apart from "we could not find out" (Rule 11). Absent means the read
   * succeeded.
   */
  skip_state_unknown?: true;
  /**
   * FINISHEST-DETERMINISM-1 · true when at least one "Projected finish" on this
   * response was served from the last-known-good cache rather than resolved on
   * this request, because the fresh resolution failed or ran out of budget.
   *
   * Same Rule 11 contract as `skip_state_unknown` above, and the same posture:
   * absent (not `false`) when nothing was served stale. The runner-facing stat
   * is deliberately IDENTICAL in both cases — a value that changed appearance
   * when the backend was slow would be the same flicker in a new costume — so
   * this flag, and the distinct `console.error` beside it, are where the
   * honesty is paid.
   */
  projection_served_stale?: true;
}

interface PlanWorkoutRow {
  id: string;
  date_iso: string;
  dow: number;
  type: string;
  distance_mi: string;
  pace_target_s_per_mi: number | null;
  sub_label: string | null;
  notes: string | null;
  workout_spec: WorkoutSpec | null;
  is_quality: boolean;
  is_long: boolean;
}

export function treadmillGuidanceFor(card: SpecCard | null): PlanSnapshotTreadmillGuidance | null {
  if (!card || card.total_mi <= 0) return null;
  const isHillDay = card.steps.some((s) => s.rep_noun === 'hills');
  const speedMph = card.workPaceSPerMi != null && card.workPaceSPerMi > 0
    ? Math.round((3600 / card.workPaceSPerMi) * 10) / 10
    : null;
  return {
    speedMph,
    inclinePct: isHillDay ? TREADMILL_HILL_INCLINE_PCT : TREADMILL_BASELINE_INCLINE_PCT,
  };
}

export async function loadPlanSnapshot(userUuid: string, today: string): Promise<PlanSnapshotResult> {
  const nowIso = new Date().toISOString();

  const plan = (await pool.query<{ id: string; last_adapted_at: string | null }>(
    `SELECT id, last_adapted_at FROM training_plans
      WHERE user_uuid = $1 AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [userUuid],
  )).rows[0];

  if (!plan) {
    return {
      plan_id: null, plan_version: null, plan_start_iso: null, plan_end_iso: null,
      today_iso: today, synced_at: nowIso, days: [], message: 'No active plan.',
    };
  }

  // Same construction as `/api/v5/today` and `loadPlanWeek` — see either's
  // own doc comment for why `id` alone under-invalidates (an in-place
  // re-anchor rewrites rows under the same plan id).
  const planVersion = planVersionOf(plan);

  // BOUNDARY-1's own query, scoped to THIS plan id — one cheap indexed
  // aggregate, not the reign-aware `ownedDaysSql` below (that answers a
  // different question: "which plan owned date D across history", not
  // "where does the ACTIVE plan's own authored block start and end").
  const bounds = (await pool.query<{ start_iso: string | null; end_iso: string | null }>(
    `SELECT MIN(date_iso)::text AS start_iso, MAX(date_iso)::text AS end_iso
       FROM plan_workouts WHERE plan_id = $1`,
    [plan.id],
  )).rows[0];
  const planStartIso = bounds?.start_iso ?? null;
  const planEndIso = bounds?.end_iso ?? null;

  if (!planStartIso || !planEndIso) {
    return {
      plan_id: plan.id, plan_version: planVersion, plan_start_iso: null, plan_end_iso: null,
      today_iso: today, synced_at: nowIso, days: [], message: 'Active plan has no authored days.',
    };
  }

  // `ownedDaysSql`'s upper bound is EXCLUSIVE — one day past plan_end_iso so
  // the block's own final day is included.
  const toExclusiveIso = new Date(new Date(planEndIso + 'T00:00:00Z').getTime() + 86400000)
    .toISOString().slice(0, 10);

  // PLANSNAPSHOT-LATENCY-1 (2026-09-07) · the four reads below are mutually
  // independent — none consumes another's result — so they were pure
  // sequential waste stacked one after another. Two fixes bundled here,
  // both confirmed against real instrumentation on a local copy of this
  // account's real data:
  //
  //   1. `glance` used to be `loadGlanceState(userUuid)` — the ENTIRE
  //      `/api/v5/today` state computation (readiness, ACWR, safety,
  //      week-strip dedup, HRV/RHR 60-day baselines, pace-anchor
  //      resolution, race-goal lookup, ~25-30 queries measured) — for the
  //      sole purpose of reading `glance.lthr` two lines below. Nothing
  //      else this file touches was ever read off that object (confirmed:
  //      no other `glance.` reference exists in this file). Replaced with
  //      the same minimal `SELECT lthr FROM profile` this codebase already
  //      uses elsewhere for exactly this read (e.g.
  //      `lib/coach/training-form.ts`, `lib/plan/generate.ts`) — one query
  //      instead of ~25-30, same value, because `hrTargets()` below reads
  //      nothing off `lthr` but the number itself.
  //   2. `rows`, `easyBandRow` and `executionsByDate` now run concurrently
  //      via `Promise.all` instead of three sequential round trips — each
  //      depends only on `(userUuid, plan.id, planStartIso, toExclusiveIso,
  //      today)`, all already resolved above, and none reads another's
  //      output.
  //
  // Measured before/after against a local copy of this account's real data
  // (281 runs, 103-day active block, 4 race dates) via temporary
  // instrumentation (stage timers + a pool.query counter, both removed
  // before this landed): warm p50 ~2.6s → ~0.6s, ~1,409 pool.query calls
  // per request → ~329. This fix (loadGlanceState removal + the
  // Promise.all above) accounts for the query-count drop from ~1,409 to
  // ~350 x-per-race; the further drop to ~329 is a second, separate fix in
  // `lib/race/race-outlook.ts` (READS-DEDUP-1) that stops the same
  // race-independent evidence read from being recomputed once per race in
  // the block.
  const lthrQuery = pool.query<{ lthr: string | number | null }>(
    `SELECT lthr FROM profile WHERE user_uuid = $1 LIMIT 1`,
    [userUuid],
  );
  const rowsQuery = pool.query<PlanWorkoutRow>(
    `WITH owned AS (${ownedDaysSql({
      columns: `pw.id, pw.date_iso, pw.dow, pw.type, pw.distance_mi::text AS distance_mi,
                pw.pace_target_s_per_mi, pw.sub_label, pw.notes, pw.workout_spec,
                pw.is_quality, pw.is_long`,
    })})
     SELECT * FROM owned
     WHERE owned.type NOT IN ('strength', 'cross', 'xt')
     ORDER BY owned.date_iso ASC`,
    [userUuid, planStartIso, toExclusiveIso],
  );
  const easyBandQuery = pool.query<{ lo: number | null; hi: number | null }>(
    `SELECT (workout_spec->>'pace_target_s_per_mi_lo')::float AS lo,
            (workout_spec->>'pace_target_s_per_mi_hi')::float AS hi
       FROM plan_workouts
      WHERE plan_id = $1
        AND workout_spec->>'kind' IN ('easy', 'long')
        AND workout_spec->>'pace_target_s_per_mi_lo' IS NOT NULL
        AND workout_spec->>'pace_target_s_per_mi_hi' IS NOT NULL
      ORDER BY (workout_spec->>'kind' = 'easy') DESC,
               ABS(date_iso::date - $2::date) ASC,
               (date_iso::date > $2::date) DESC
      LIMIT 1`,
    [plan.id, today],
  ).catch((e) => { console.error('[plan-snapshot] easy band read failed', e); return { rows: [] as any[] }; });
  const executionsQuery = resolveDateRangeExecutions(userUuid, planStartIso, toExclusiveIso);
  // PLANSNAPSHOT-SKIP-1 (2026-09-07) · same canonical resolver `/api/plan/week`
  // uses for the week strip (`loadSkippedDates`, `lib/plan/week-loader.ts`),
  // over the whole authored block rather than one 7-day window — this file
  // previously had no reference to `day_actions` at all, so a skip the
  // database recorded correctly still rendered as a fully prescribed day.
  // Mutually independent of the other three reads above, so it joins the
  // same `Promise.all` rather than adding a fifth sequential round trip.
  const skipQuery = loadSkippedDates(userUuid, planStartIso, planEndIso);

  const [lthrRow, rows, easyBandRow, executionsByDate, skipRead] = await Promise.all([
    lthrQuery.then((r) => r.rows[0]),
    rowsQuery.then((r) => r.rows),
    easyBandQuery.then((r) => (r.rows as Array<{ lo: number | null; hi: number | null }>)[0]),
    executionsQuery,
    skipQuery,
  ]);
  const { skippedDates, failed: skipReadFailed } = skipRead;

  const lthr = lthrRow?.lthr != null ? Number(lthrRow.lthr) : null;
  const hrBands = hrTargets({ lthr });

  const easyPaceAnchor = easyBandRow?.lo != null && easyBandRow?.hi != null
    ? Math.round((Number(easyBandRow.lo) + Number(easyBandRow.hi)) / 2)
    : null;
  const easyCeilingSec = easyBandRow?.lo != null ? Math.round(Number(easyBandRow.lo)) : null;

  // FINISHEST-1 (2026-09-07) · a race day's own card had a pace band and a
  // "Coach target" line in prose, but nothing answering "how long is this
  // race" — David, on the Santa Monica 10K day: "I don't know what total
  // time this is." The projection itself is not re-derived here: same
  // `resolveRaceOutlookBySlug` + `raceProjectionFromOutlook` the Races list
  // and Race detail screens call (Rule 16 — one resolver, so this can never
  // disagree with either). `races.meta->>'date'` is the only link from a
  // plan_workouts race row to a `races` slug; batched once for the whole
  // block rather than per day.
  const raceDates = Array.from(new Set(rows.filter((r) => r.type === 'race').map((r) => r.date_iso)));
  // FINISHEST-DETERMINISM-1 · three outcomes now reach the day map, not two.
  // `null` is the third: "we could not find out", which the phone renders as
  // `FaffValue.unreadable` (see `PlanSnapshotNumber`). A date absent from the
  // map is the fourth and oldest fact: nothing to project, say nothing.
  const projectedFinishByDate = new Map<string, PlanSnapshotNumber | null>();
  let projectionServedStale = false;
  if (raceDates.length > 0) {
    // A failed slug lookup and "this race has no `races` row yet" reach the
    // identical outcome for every consumer below: no slug to resolve an
    // outlook for, so no "Projected finish" stat — every other field on the
    // day's card (pace band, dose, steps) is computed independently and is
    // unaffected either way. `rowsOrEmpty` logs the failure rather than
    // swallowing it silently.
    const slugRows = await rowsOrEmpty<{ slug: string; date_iso: string }>(
      'plan-snapshot:race-slugs',
      pool.query(
        `SELECT slug, meta->>'date' AS date_iso FROM races
          WHERE user_uuid = $1 AND meta->>'date' = ANY($2::text[])`,
        [userUuid, raceDates],
      ),
    );
    await Promise.all(slugRows.map(async (r) => {
      const lkgKey = projectionCacheKey(userUuid, r.slug, today);
      const attempt = await withDeadline(
        resolveRaceOutlookBySlug(userUuid, r.slug, today),
        RACE_PROJECTION_DEADLINE_MS,
      );

      if (attempt.status !== 'ok') {
        // ── CASE 3 · the resolution failed or ran out of budget ────────────
        //
        // Logged as its own fact, never silently folded into case 2. What the
        // RUNNER sees is decided by whether this same race, this same day,
        // has already been resolved successfully in this process.
        console.error(
          `[plan-snapshot] race outlook resolution ${attempt.status} for slug=${r.slug} date=${r.date_iso}`,
          attempt.status === 'error' ? attempt.error : undefined,
        );
        const lastGood = readLastKnownGoodProjection(lkgKey);
        if (lastGood) {
          // The screen does not move. This is the whole point of the cache —
          // see its own doc comment: an identical stat is what "no flicker"
          // MEANS, so the honesty owed here is owed to OPS, not to the pixel.
          // `projection_served_stale` on the result is where it is paid.
          projectionServedStale = true;
          console.error(
            `[plan-snapshot] serving last-known-good projection for slug=${r.slug} ` +
            `date=${r.date_iso} (resolved ${Math.round((Date.now() - lastGood.at) / 1000)}s ago)`,
          );
          projectedFinishByDate.set(r.date_iso, { text: lastGood.text, modelled: true });
          return;
        }
        // Nothing known, and we could not find out. NOT the same as case 2,
        // and no longer rendered the same way: `text: null` is the phone's
        // own `unreadable` — a fault-red dash where the figure would be.
        projectedFinishByDate.set(r.date_iso, null);
        return;
      }

      const outlook = attempt.value;
      // WKSTRIP-UTC-1 verification round · this used to show
      // `likelyRangeSec` as a range ("42:05–43:49") when the same outlook's
      // `projectedSec` renders as a single point ("42:57") on both Races
      // and Race Detail — one quantity read two ways on three surfaces,
      // exactly the class of bug Rule 16 exists for (the CIM
      // three-projections incident this file's own header cites). Race
      // Detail's plate is `formatRaceTime(projection.projectedSec)` and
      // nothing else (`lib/faff/race-plate.ts`'s `middleSec`); this now
      // matches it byte-for-byte rather than presenting a second, wider
      // answer to the same question.
      const projection = raceProjectionFromOutlook(outlook);
      // ── CASE 2 · genuinely nothing to project ───────────────────────────
      // No goal, no capacity evidence yet, race too far out, or no `races`
      // row for this slug at all. Correct, silent, and NOT logged: the
      // expected steady state for a race with no evidence behind it, not an
      // anomaly. The date stays OUT of the map entirely, so no stat renders.
      //
      // FINISHEST-RESURRECT-1 · and it FORGETS. A projection this process
      // remembered and the engine has since withdrawn may not be served back
      // by a later failure — see `clearLastKnownGoodProjection`. Both exits
      // clear, because the second (a value that survives the null check and
      // then fails to format) reaches the identical outcome for the runner.
      if (projection.projectedSec == null) {
        clearLastKnownGoodProjection(lkgKey);
        return;
      }
      const text = formatRaceTime(projection.projectedSec);
      if (!text) {
        clearLastKnownGoodProjection(lkgKey);
        return;
      }
      // ── CASE 1 · a real projection. Render it, and remember it. ──────────
      writeLastKnownGoodProjection(lkgKey, text);
      projectedFinishByDate.set(r.date_iso, { text, modelled: true });
    }));
  }

  const days: PlanSnapshotDay[] = rows.map((row) => {
    const rawType = row.type;
    const isRest = rawType === 'rest';
    const isRace = rawType === 'race';
    const distanceMi = Number(row.distance_mi) || 0;
    const strictType = strictPrescriptionType(rawType);
    const unprescribable = strictType == null && !isRest;
    const prescriptionType = strictType ?? (isRest ? 'rest' : 'easy');

    const cardTolerance = sessionToleranceSec(
      classifySession(rawType, (row.workout_spec ?? null) as Record<string, unknown> | null),
    );

    const card: SpecCard | null = isRest
      ? null
      : unprescribable
      ? cardForUnprescribableType({ rawType, subLabel: row.sub_label })
      : (cardFromSpec({
          spec: row.workout_spec,
          type: prescriptionType,
          subLabel: row.sub_label,
          distanceMi,
          easyPaceSec: easyPaceAnchor,
          easyCeilingSec,
          hr: hrBands,
          toleranceSec: cardTolerance,
        })
        ?? cardWithoutSpec({
          type: prescriptionType,
          subLabel: row.sub_label,
          distanceMi,
          paceTargetSPerMi: row.pace_target_s_per_mi,
          hr: hrBands,
        }));

    const resolved = executionsByDate.get(row.date_iso);
    // A day can carry more than one prescription (a two-a-day); the match
    // for THIS row is the one whose `matchedRun` this specific plan_workout
    // id earned. `resolveDateRangeExecutions` keys `prescriptions` by row,
    // not by date, so this is a lookup, not a guess.
    const myPrescription = resolved?.prescriptions.find((p) => p.id === row.id) ?? null;
    const matchedRun = myPrescription?.matchedRun;
    const matched_run: PlanSnapshotMatchedRun | null = matchedRun
      ? {
          runId: matchedRun.runId,
          distanceMi: matchedRun.distanceMi,
          durationSec: runFacts(matchedRun.data, { basis: 'elapsed' }).timeSec,
          paceSPerMi: runFacts(matchedRun.data, { basis: 'elapsed' }).paceSecPerMi,
          match: matchedRun.match,
          indoor: matchedRun.data.indoor === true || matchedRun.data.source === 'treadmill',
        }
      : null;
    const supplemental_runs: PlanSnapshotSupplementalRun[] = (resolved?.supplementalRuns ?? []).map((r) => {
      const facts = runFacts(r.data, { basis: 'elapsed' });
      return {
        runId: r.runId,
        distanceMi: facts.distanceMi ?? 0,
        durationSec: facts.timeSec,
        paceSPerMi: facts.paceSecPerMi,
        indoor: r.data.indoor === true || r.data.source === 'treadmill',
      };
    });

    // HEROPANEL-1 · same resolver `/api/v5/today` uses for its own gradient
    // (`dayStateWordFor`, `lib/faff/v5-today.ts`) — 'rest' is its own literal
    // here rather than routed through the resolver, matching that file's own
    // `dayState: 'rest'` special case rather than trusting the resolver's
    // generic string fallback to land on it independently.
    const dayState = isRest ? 'rest' : dayStateWordFor(rawType);

    // Duration kicker — "about 2h 10m" — the same `card.totalDurationSec`
    // the phase list itself sums, never a `distance × flat pace` estimate
    // (PRERUN-1's own rule against exactly that guess).
    const kicker = !isRest && card?.totalDurationSec
      ? `about ${fmtMinutesCasual(card.totalDurationSec / 60)}`
      : null;

    // Gated on CARD presence, not `distanceMi > 0` — matches `/api/v5/today`'s
    // own `dose` exactly (`ctx.prescription && type !== 'rest'`), including
    // its fallback: `fmtMi` reads 0 as "no distance to show" the same way it
    // reads null, so a duration-only session (no mile target at all) still
    // gets a dose line, off the card's own headline, rather than silently
    // going dose-less. COERCION-1's zero-erasure matcher flags a bare
    // `distanceMi > 0 ? … : null` as a peripheral collapse; reusing the
    // canonical `fmtMi` (already the single arbiter of "is this distance
    // presentable" everywhere else in the app) answers the same question
    // through the one place that's allowed to, instead of re-deciding it here.
    const dose: PlanSnapshotNumber | null = !isRest && card
      ? { text: fmtMi(distanceMi) ?? card.headline, modelled: false }
      : null;

    // "Pace band" — the same fmtPaceBand `card`'s own steps already used to
    // build `pace_target`, read off the SAME work-phase numbers, never a
    // second derivation. "HR ceiling" — the workout's own authored cap
    // (ZONEBAND-1's own reasoning: a per-workout authored ceiling, not a
    // generic Friel bucket), shown only where `/api/v5/today` shows it: easy
    // and long, never on a long run's race-pace finish segment (Audit
    // D/D1 — a workout-level ceiling would red-alert through the finish and
    // coach against the prescription).
    const stats: PlanSnapshotStat[] = [];
    if (!isRest && card?.workPaceSPerMi != null) {
      const band = fmtPaceBand(card.workPaceSPerMi, card.workToleranceSPerMi);
      if (band) stats.push({ label: 'Pace band', value: { text: band, modelled: true }, tone: null });
    }
    const hrCapBpm = (row.workout_spec as { hr_cap_bpm?: number } | null)?.hr_cap_bpm;
    if (!isRest && (prescriptionType === 'easy' || prescriptionType === 'long')
        && card?.hasRacePaceFinish !== true && hrCapBpm != null) {
      stats.push({ label: 'HR ceiling', value: { text: `${hrCapBpm} bpm`, modelled: true }, tone: null });
    }
    // FINISHEST-1 · see the batch resolution above this map for why this is
    // a lookup, not a derivation.
    if (isRace && projectedFinishByDate.has(row.date_iso)) {
      // FINISHEST-DETERMINISM-1 · `has` and not a truthiness test, because
      // `null` is a VALUE in this map and not an absence. A date that is
      // present with null is "we could not find out"; a date that is absent is
      // "there is nothing to project". Collapsing them with `if (finish)` is
      // the exact defect this fix exists to close, one layer further down.
      const finish = projectedFinishByDate.get(row.date_iso) ?? null;
      stats.push(finish
        ? { label: 'Projected finish', value: finish, tone: null }
        // `text: null` → `FaffValue.unreadable` on the phone: a dash in the
        // slot where the figure goes, under the label that names it. Visibly
        // different from a race day with no stat at all, which is what a
        // genuine absence still renders.
        //
        // SKIPPROJ-CONTRAST-1 (2026-09-08) · this comment used to say
        // "fault-red dash", and on the one screen that draws it that was a
        // claim nothing checked and nothing delivered. `FaffValueText`
        // hard-coded `V5.fault` #FF4438, a race day is always the `race`
        // gradient, and red on that warm ground measured 1.02:1 — so the
        // sentence above was true of the LABEL and the DASH and false of the
        // colour, which was the half the sentence leaned on. The dash now
        // takes the panel's own ink (`V5.PanelInk.fault`) and keeps the fault
        // meaning in its glyph and in VoiceOver's "could not be read".
        //
        // Measured off the RENDERED PIXELS of this exact stat, this exact
        // state, driven against a scratch copy of the owner's own block with
        // the outlook resolution forced to time out — same slot, same plate
        // (#D67656), before and after:
        //
        //     #FF4438  1.08:1        #3A1410  5.11:1
        //
        // `tone` stays 'fault' — the engine's statement about the read is
        // unchanged; only what the phone paints with it is.
        : { label: 'Projected finish', value: { text: null, modelled: true }, tone: 'fault' });
    }

    return {
      plan_workout_id: row.id,
      date_iso: row.date_iso,
      dow: row.dow,
      type: rawType,
      is_rest: isRest,
      is_race: isRace,
      is_quality: row.is_quality === true,
      is_long: row.is_long === true,
      distance_mi: distanceMi,
      sub_label: row.sub_label,
      // CITESCRUB-1 · the runner never reads a Research/ reference — same
      // scrub-and-render pass `PlanWeekDay.notes` gets, reused not re-derived.
      notes: dayNoteFor(row.notes),
      card: wireSafeCard(card),
      treadmill: treadmillGuidanceFor(card),
      matched_run,
      supplemental_runs,
      day_state: dayState,
      kicker,
      dose,
      stats,
      // PLANSNAPSHOT-SKIP-1 · best-effort per day; `skip_state_unknown` on the
      // returned result is the honest signal when the read itself failed
      // (Rule 11) — this field does not collapse that into a false "not
      // skipped" for a caller that checks the top-level flag first.
      skipped: skippedDates.has(row.date_iso),
    };
  });

  return {
    plan_id: plan.id,
    plan_version: planVersion,
    plan_start_iso: planStartIso,
    plan_end_iso: planEndIso,
    today_iso: today,
    synced_at: nowIso,
    days,
    // PLANSNAPSHOT-SKIP-1 · mirrors `PlanWeekResult.skipStateUnknown` — see
    // that field's own doc comment. Absent (not `false`) on a successful read.
    ...(skipReadFailed ? { skip_state_unknown: true as const } : {}),
    // FINISHEST-DETERMINISM-1 · see the field's own doc comment. Absent, not
    // `false`, when every projection on this response was resolved live.
    ...(projectionServedStale ? { projection_served_stale: true as const } : {}),
  };
}
