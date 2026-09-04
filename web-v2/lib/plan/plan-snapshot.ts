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
 *   - `loadGlanceState` / `hrTargets` / the easy-band query — the runner's
 *     OWN current anchors (LTHR, easy pace ceiling), read once for the
 *     whole block exactly as `/api/v5/today` reads them once for today.
 *     These are the runner's CURRENT capacity, not date-varying within one
 *     read — `recompute-paces.ts` is what keeps future rows' own stored
 *     pace targets current; this loader does not re-derive that.
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
import { ownedDaysSql } from '@/lib/plan/owned-days';
import { dayNoteFor } from '@/lib/plan/week-loader';
import { loadGlanceState } from '@/lib/coach/glance-state';
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

// Same two doctrine-cited constants `build-workout.ts` uses for its own
// per-phase treadmill incline — see this file's header for why they are
// duplicated here rather than imported (that function is not currently
// exported, and the file is under active concurrent development).
const TREADMILL_HILL_INCLINE_PCT = 5;       // Research/04 §8.3 · medium hill repeats, midpoint of the 4-6% band
const TREADMILL_BASELINE_INCLINE_PCT = 1;   // TERRAIN.treadmill-air-resistance-grade

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

/** Mirrors the client's `V5Number` wire shape exactly — see APIV5.swift. */
export interface PlanSnapshotNumber {
  text: string;
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
  const planVersion = `${plan.id}:${plan.last_adapted_at ?? 'none'}`;

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

  const rows = (await pool.query<PlanWorkoutRow>(
    `WITH owned AS (${ownedDaysSql({
      columns: `pw.id, pw.date_iso, pw.dow, pw.type, pw.distance_mi::text AS distance_mi,
                pw.pace_target_s_per_mi, pw.sub_label, pw.notes, pw.workout_spec,
                pw.is_quality, pw.is_long`,
    })})
     SELECT * FROM owned
     WHERE owned.type NOT IN ('strength', 'cross', 'xt')
     ORDER BY owned.date_iso ASC`,
    [userUuid, planStartIso, toExclusiveIso],
  )).rows;

  // Runner-level context, read ONCE for the whole block — see this file's
  // header for why these are not re-read per day.
  const glance = await loadGlanceState(userUuid);
  const hrBands = hrTargets({ lthr: glance.lthr });

  const easyBandRow = (await pool.query<{ lo: number | null; hi: number | null }>(
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
  ).catch((e) => { console.error('[plan-snapshot] easy band read failed', e); return { rows: [] as any[] }; })).rows[0];
  const easyPaceAnchor = easyBandRow?.lo != null && easyBandRow?.hi != null
    ? Math.round((Number(easyBandRow.lo) + Number(easyBandRow.hi)) / 2)
    : null;
  const easyCeilingSec = easyBandRow?.lo != null ? Math.round(Number(easyBandRow.lo)) : null;

  // Batched completion/supplemental resolution for the WHOLE block in one
  // pass — EXECUTION-IDENTITY-1's own resolver, never re-derived here.
  const executionsByDate = await resolveDateRangeExecutions(userUuid, planStartIso, toExclusiveIso);

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
  };
}
