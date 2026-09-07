/**
 * lib/brain/proposal/evidence/long-run-structure.ts · HAS THE LONG RUN EARNED
 * A RACE-PACE FINISH.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * THE GAP THIS CLOSES
 *
 * `facets.ts`'s ratchet named two adjacent holes for `LONG_RUN_STRUCTURE_CHANGE`:
 * no GENERATOR (nothing resolves the `long_run_duration` lever
 * `progression-pass.ts`'s `ProgressionLever` type carries but never sets, since
 * `resolveWeekProgression`'s `SessionFamily` is `threshold | interval |
 * repetition` and never walks a long run) and no EVIDENCE_SOURCE ("nothing
 * measures long-run EXECUTION as a shape question").
 *
 * This is that reader. It does NOT extend `resolveWeekProgression` — a long
 * run has no reps, no recovery interval and no work density, so bolting it
 * onto a gate built for those three axes would be the "one generic
 * progression score" `docs/ADAPTATION_PROGRESSION_DOCTRINE.md` forbids. It is
 * a parallel, narrowly-scoped reader for the one axis a long run actually has:
 * whether its STRUCTURE should carry a race-pace finish.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * WHY THIS DOES NOT IMPORT `lib/adaptation/canonical/**` (FOUND, NOT ASSUMED)
 *
 * The distance lever's own reader (`evaluateLongRun` in
 * `lib/adaptation/canonical/levers/long-run.ts`) answers a closely related
 * question on the same two long runs and would have been the Rule 16-correct
 * thing to import from. The first cut of this file did exactly that —
 * `assessDeterioration`, `qualifiesAsLongRunEvidence`, `LongRunObservation` —
 * and `lib/adaptation/canonical/_cannot_mutate.test.ts`,
 * `lib/adaptation/canonical-shadow/_never_mutates_plan.test.ts` and
 * `lib/brain/orchestration/_move_readjudication.test.ts`'s "the seal is still
 * a seal · lib/brain reaches the canonical engine through ONE file" all failed
 * on it: `lib/brain/**` may reach that engine through exactly one door
 * (`lib/brain/orchestration/canonical-phase.ts`, which re-exports one
 * function, `phaseFromAuthoredLabel`, and nothing else), and this file is not
 * that door. So the two checks below are INDEPENDENT of the distance lever's
 * — simpler ones, built from `lib/runs/run-shape.ts` primitives only, which
 * sit outside the quarantined engine. They read the SAME doctrine numbers
 * (cited below) but are not required to, and are not able to, produce
 * byte-identical verdicts to `evaluateLongRun`'s own bar — that engine is
 * still shadow-only (nothing mutates a plan from it), so there is no live
 * "distance axis" verdict this reader could disagree with in production
 * today. If the canonical engine is ever promoted past shadow and gains a
 * proper export surface, THAT is when this file's local checks should be
 * replaced by a call through the door, not before.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * THE DOCTRINE, READ ONCE AND CITED HERE
 *
 * `Research/04` §4.3 "Progression long run": "First 1/3 to 1/2 at E pace,
 * middle at strong E or M, final 1/4 to 1/3 at M to T" — the STRUCTURE.
 * §4.5 "Fast finish long run": "Bulk at E … final 2-6 mi at MP or slightly
 * faster" — the NUMERIC dose this reader actually prescribes, because it is
 * the one of the two doctrine gives an explicit mileage range for rather than
 * a fraction of a run whose own length this reader is not sizing (that
 * remains `evaluateLongRun`'s job, and this reader has no access to
 * `nextLongRunMi` beyond reading whether one exists at all — the exact mirror
 * of Q22's own rule that "faster threshold work must never independently
 * authorize a longer long run").
 *
 * `docs/ADAPTATION_PROGRESSION_DOCTRINE.md`: compare intended stimulus against
 * ACTUAL EXECUTION, never completion alone. The completion bar
 * (`LONG_RUN_COMPLETION_MIN_FRAC`) and lookback count (`LONG_RUN_LOOKBACK_COUNT`)
 * restate `docs/ADAPTATION_ENGINE_CONTRACT.md`'s Q22 numbers by VALUE — the
 * same 95%-of-two rule the distance lever uses — because that is the app's one
 * stated durability bar, and this file cannot import the module that owns it
 * (see above), not because a second number was chosen. `Research/03`'s Pa:HR
 * decoupling section ("A well-paced marathon shows <5% Pa:HR decoupling …
 * high early decoupling = inadequate base or too-aggressive start") is the
 * doctrine behind the late-fade check below, read directly rather than through
 * the canonical engine's own `assessDeterioration`, which this file may not
 * import.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * WHAT THIS CANNOT FAIL ON (Rule 22)
 *
 * · WHETHER A RACE-PACE FINISH IS THE RIGHT NEXT STEP FOR THIS RUNNER. It
 *   answers "has he shown he can hold an EASY long run together," never
 *   "is he specifically training for a marathon right now" — that is a plan-
 *   composition question this reader has no access to and does not ask.
 * · A LONG RUN THAT WAS COMPLETED BUT USELESS. Distance and pace/HR thirds are
 *   the criteria doctrine gives; a technically-clean run at the wrong effort
 *   passes.
 * · A SOPHISTICATED READ OF LATE-SESSION FADE. The canonical engine's
 *   `assessDeterioration` grades THREE signals and a continuous severity
 *   fraction; this reader checks the first and sharpest of those (final third
 *   slower at equal-or-higher heart rate) and nothing more, because the
 *   fuller model lives behind a door this file may not open. A run that fades
 *   in a subtler way than that one signal catches passes here.
 * · WHETHER THE NEXT LONG RUN'S OWN DISTANCE CAN CARRY THE FINISH SEGMENT
 *   PROPOSED. That is a plan-composition and dosing-cap question for whoever
 *   eventually builds the WRITER for this kind (withheld today by the
 *   2026-09-02 reshape ruling, unrelated to this reader) — `validateAction`
 *   and `dosingBreachIfWritten` are the existing gates for it.
 */

import { extractLongSegments } from '@/lib/plan/spec-builder';
import {
  runDistanceMi, runDaySql, runNotMergedSql, asRunData, splitsWithHrAndPace, type RunData,
} from '@/lib/runs/run-shape';
import { pool } from '@/lib/db/pool';
import { rowOrNull, rowsOrNull } from '@/lib/db/read';

export const RESEARCH_PROGRESSION_LONG_CITATION =
  'Research/04 §4.3 "Progression long run" · "final 1/4 to 1/3 at M to T"';
export const RESEARCH_FAST_FINISH_CITATION =
  'Research/04 §4.5 "Fast finish long run" · "final 2-6 mi at MP or slightly faster"';
export const RESEARCH_DECOUPLING_CITATION =
  'Research/03 §"Pa:HR" · "A well-paced marathon shows <5% Pa:HR decoupling … '
  + 'high early decoupling = inadequate base or too-aggressive start"';
export const CONTRACT_Q22_CITATION = 'docs/ADAPTATION_ENGINE_CONTRACT.md · Q22, long-run distance';

/** Doctrine's own numeric band for the finish segment (§4.5), named rather
 *  than inlined so a future citation change has one place to move. */
export const FAST_FINISH_MIN_MI = 2;
export const FAST_FINISH_MAX_MI = 6;
/** §4.3's fraction of the WHOLE run, used only to pick a point inside the
 *  §4.5 band rather than to override it — the band is the doctrine-cited
 *  ceiling and floor; the fraction only says where in it to start. */
export const FAST_FINISH_FRACTION_OF_TOTAL = 0.25;

/** Q22's own numbers, restated BY VALUE (see the file header for why this
 *  cannot import the module that owns them). Keep these equal to
 *  `LONG_RUN_LOOKBACK_COUNT` / `LONG_RUN_COMPLETION_MIN_FRAC` in
 *  `lib/adaptation/canonical/contract-constants.ts` if that file's numbers
 *  ever move — both cite the same Q22 sentence. */
export const STRUCTURE_LOOKBACK_COUNT = 2;
export const STRUCTURE_COMPLETION_MIN_FRAC = 0.95;

/** `Research/03`'s Pa:HR bar, restated the same way. A slower final third at
 *  an equal-or-higher heart rate is the sharpest of Q13's three signals and
 *  the only one this simplified, canonical-engine-independent check reads. */
export const STRUCTURE_FADE_SLOWDOWN_FRAC = 0.04;

export type LongRunStructureDecision = 'PROPOSE' | 'HOLD' | 'REFUSE';

export interface LongRunStructureEvidence {
  readonly decision: LongRunStructureDecision;
  /** Coach-voice, safe to surface as the card's reason. */
  readonly reason: string;
  /** Set only when `decision === 'PROPOSE'`. The literal `sub_label` value the
   *  executor writes, in the grammar `extractLongSegments` parses (Rule 16:
   *  one grammar, read by dosing.ts and intensity-distribution.ts, and this is
   *  the only place outside the composer that is allowed to write it). */
  readonly proposedSubLabel?: string;
  readonly proposedDescribe?: string;
}

/** One completed long run's readable facts, local to this file. Deliberately
 *  NOT `LongRunObservation` (that type lives behind the door this file may
 *  not open) — same questions, an independent shape. */
export interface LongRunSample {
  readonly dateISO: string;
  readonly prescribedMi: number;
  /** `null` when the distance could not be read at all. */
  readonly completedMi: number | null;
  /** `null` on either side when the run had fewer than 6 splits, matching the
   *  distance lever's own coarseness for what counts as "comparable". */
  readonly middlePaceSecPerMi: number | null;
  readonly finalPaceSecPerMi: number | null;
  readonly middleHrBpm: number | null;
  readonly finalHrBpm: number | null;
}

/**
 * The middle-third / final-third pace and heart rate, from mile splits.
 *
 * Independent re-derivation of the same coarse method
 * `lib/adaptation/canonical-shadow/live-input.ts`'s `buildThirds` uses
 * (>= 6 splits so each third has at least 2), because that function lives
 * behind the one-door boundary this file may not cross. `splitsWithHrAndPace`
 * itself does not: it is a general `lib/runs/run-shape.ts` primitive with no
 * dependency on the canonical engine.
 */
export function longRunThirds(run: RunData): {
  readonly comparable: boolean;
  readonly middlePaceSecPerMi: number | null;
  readonly finalPaceSecPerMi: number | null;
  readonly middleHrBpm: number | null;
  readonly finalHrBpm: number | null;
} {
  const splits = splitsWithHrAndPace((run as Record<string, unknown>).splits);
  if (splits.length < 6) {
    return {
      comparable: false,
      middlePaceSecPerMi: null, finalPaceSecPerMi: null, middleHrBpm: null, finalHrBpm: null,
    };
  }
  const n = splits.length;
  const thirdSize = Math.floor(n / 3);
  const middle = splits.slice(thirdSize, thirdSize * 2);
  const final = splits.slice(thirdSize * 2);
  const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    comparable: true,
    middlePaceSecPerMi: mean(middle.map((s) => s.paceSec)),
    finalPaceSecPerMi: mean(final.map((s) => s.paceSec)),
    middleHrBpm: mean(middle.map((s) => s.hr)),
    finalHrBpm: mean(final.map((s) => s.hr)),
  };
}

/** One completed long run, as this reader needs it. */
export function longRunSampleFrom(args: {
  readonly dateISO: string;
  readonly run: RunData;
  readonly prescribedMi: number;
}): LongRunSample {
  const t = longRunThirds(args.run);
  return {
    dateISO: args.dateISO,
    prescribedMi: args.prescribedMi,
    completedMi: runDistanceMi(args.run),
    middlePaceSecPerMi: t.comparable ? t.middlePaceSecPerMi : null,
    finalPaceSecPerMi: t.comparable ? t.finalPaceSecPerMi : null,
    middleHrBpm: t.comparable ? t.middleHrBpm : null,
    finalHrBpm: t.comparable ? t.finalHrBpm : null,
  };
}

/**
 * THE PURE VERDICT. No I/O — every input is a plain value, so this is
 * falsifiable and unit-testable without a database.
 *
 * `recent` must be the `STRUCTURE_LOOKBACK_COUNT` most recent COMPLETED long
 * runs, oldest first.
 */
export function resolveLongRunStructureEvidence(args: {
  /** The upcoming long run's CURRENT sub_label, or null/absent for a plain
   *  "LONG" day. */
  readonly nextLongRunSubLabel: string | null;
  /** The upcoming long run's prescribed distance, for sizing the proposed
   *  finish segment. */
  readonly nextLongRunMi: number;
  readonly recent: readonly LongRunSample[];
}): LongRunStructureEvidence {
  /* ── Nothing to add to ─────────────────────────────────────────────────── */
  if (!(args.nextLongRunMi > 0)) {
    return {
      decision: 'HOLD',
      reason: 'The upcoming week schedules no long run, so there is no session a finish segment could attach to.',
    };
  }

  /* ── Already progressed on this axis · not this reader's decision to redo ─
   *
   * `extractLongSegments` is the SAME parser `dosing.ts` and
   * `intensity-distribution.ts` already trust to read a long run's own
   * sub_label. A long run that already carries a race-pace segment has
   * already been given this stimulus, by the composer or by an earlier
   * accepted proposal, and re-proposing a second finish on top of it is a
   * dosing question this reader is not equipped to answer. */
  const existing = extractLongSegments(args.nextLongRunSubLabel);
  if (existing.length > 0) {
    return {
      decision: 'HOLD',
      reason: 'The upcoming long run already carries a race-pace segment; the structure axis has already moved.',
    };
  }

  /* ── Enough evidence to ask the question at all ──────────────────────────
   *
   * Same count `Q22` requires for the distance axis — one bar for "enough
   * long runs to judge," not two. */
  if (args.recent.length < STRUCTURE_LOOKBACK_COUNT) {
    return {
      decision: 'REFUSE',
      reason: `Only ${args.recent.length} recent long run${args.recent.length === 1 ? '' : 's'} `
        + `${args.recent.length === 1 ? 'is' : 'are'} on record; the structure axis reads the same `
        + `${STRUCTURE_LOOKBACK_COUNT} most recent long runs the distance axis does before either moves.`,
    };
  }
  const recent = args.recent.slice(-STRUCTURE_LOOKBACK_COUNT);

  /* ── Readability · an unreadable distance is fatal, not a zero ──────────── */
  for (const l of recent) {
    if (l.completedMi === null) {
      return {
        decision: 'REFUSE',
        reason: `The long run on ${l.dateISO} has no readable distance, so how it finished cannot be read.`,
      };
    }
  }

  /* ── Completion · the same bar the distance axis uses ────────────────────── */
  for (const l of recent) {
    const frac = l.completedMi !== null && l.prescribedMi > 0 ? l.completedMi / l.prescribedMi : 0;
    if (frac < STRUCTURE_COMPLETION_MIN_FRAC) {
      return {
        decision: 'HOLD',
        reason: `The long run on ${l.dateISO} came in below `
          + `${Math.round(STRUCTURE_COMPLETION_MIN_FRAC * 100)}% of its prescribed distance, `
          + 'which is the bar this axis reads before proposing a harder finish.',
      };
    }
  }

  /* ── Late-session fade · comparable pace/HR required, or a refusal ───────── */
  const unreadableThirds = recent.filter((l) => l.middlePaceSecPerMi === null
    || l.finalPaceSecPerMi === null || l.middleHrBpm === null || l.finalHrBpm === null);
  if (unreadableThirds.length > 0) {
    return {
      decision: 'REFUSE',
      reason: `How the middle and final thirds of the long run on ${unreadableThirds[0].dateISO} compared `
        + 'could not be read (too few recorded splits), so whether it held together is unknown rather than clean.',
    };
  }

  /* Q13's sharpest signal: final third slower at an equal-or-higher heart
   * rate. A slower finish at a LOWER heart rate is a runner easing down, not
   * fading — the same distinction the canonical engine's own version draws. */
  const faded = recent.find((l) => {
    const mid = l.middlePaceSecPerMi!;
    const fin = l.finalPaceSecPerMi!;
    const slowdown = (fin - mid) / mid;
    return slowdown > STRUCTURE_FADE_SLOWDOWN_FRAC && l.finalHrBpm! >= l.middleHrBpm!;
  });
  if (faded !== undefined) {
    return {
      decision: 'HOLD',
      reason: 'The distance was completed, but effort fell away in the final third of a recent long run, '
        + 'which is exactly what a race-pace finish would test hardest.',
    };
  }

  /* ── PROPOSE ──────────────────────────────────────────────────────────────
   *
   * §4.5's own numeric band (2-6 mi), positioned inside it by §4.3's fraction
   * of the upcoming run's own length rather than by a fixed number — a 12-mile
   * long run and a 20-mile long run earning the same stimulus should not get
   * the same absolute segment. */
  const raw = args.nextLongRunMi * FAST_FINISH_FRACTION_OF_TOTAL;
  const finishMi = Math.min(FAST_FINISH_MAX_MI, Math.max(FAST_FINISH_MIN_MI, Math.round(raw)));
  return {
    decision: 'PROPOSE',
    reason: `The last ${STRUCTURE_LOOKBACK_COUNT} long runs were completed at `
      + `${Math.round(STRUCTURE_COMPLETION_MIN_FRAC * 100)}% or better and held their effort to the finish, `
      + `which ${CONTRACT_Q22_CITATION} reads as durability evidence.`,
    proposedSubLabel: `LONG · ${finishMi}mi @ M`,
    proposedDescribe: `the final ${finishMi} miles at marathon pace`,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE LIVE LOADER · read-only, best-effort, feeds the pure resolver above
 * ═══════════════════════════════════════════════════════════════════════ */

export interface LongRunStructureCandidate {
  /** The upcoming long run this evidence would attach a proposal to. */
  readonly planWorkoutId: string;
  readonly evidence: LongRunStructureEvidence;
}

/**
 * Find the runner's next scheduled long run, read the completed long runs
 * before it, and resolve the structure verdict. Returns `null` when there is
 * no upcoming long run to evaluate at all — Rule 11's "nothing to ask" branch,
 * kept apart from a computed HOLD or REFUSE.
 *
 * Rule 14 · the population is stated: the ACTIVE plan only
 * (`archived_iso IS NULL`), same scope `nextSessionFor` in
 * `action-proposal-lane.ts` and `readLiveRows` in `staleness.ts` both use.
 *
 * RACEDAYSTRUCTURE-1 (2026-09-07) · `is_long` is not exclusive with
 * `type = 'race'`. A race that replaces the week's long run for volume-
 * counting purposes is composed with `is_long = true` AND `type = 'race'`
 * (confirmed live: David's 2026-09-13 Santa Monica 10K, `is_long=true,
 * type='race', sub_label='RACE'`) — a legitimate convention for sizing the
 * week, and the wrong row for THIS question. Asking "has the runner earned
 * a race-pace finish segment on this long run" about a session that already
 * IS a race is a category error: you do not bolt a race-pace finish test
 * onto a race. The reader still reached a harmless HOLD in this instance
 * (an actual race trivially reads as "not earned a finish segment," since
 * it carries no race-pace sub-label of the kind `extractLongSegments`
 * looks for), but the runner-facing card made no sense — "holding the plan
 * as it is" attached to a session that was never a candidate for the
 * change being held. Excluding `type = 'race'` from both queries below.
 */
export async function loadLongRunStructureEvidence(
  userUuid: string,
  todayISO: string,
): Promise<LongRunStructureCandidate | null> {
  const next = await rowOrNull<{
    id: string; sub_label: string | null; distance_mi: string | number | null;
  }>(
    'brain/proposal/evidence/long-run-structure · next long run',
    pool.query(
      `SELECT pw.id, pw.sub_label, pw.distance_mi
         FROM plan_workouts pw
         JOIN training_plans tp ON tp.id = pw.plan_id
        WHERE tp.user_uuid = $1::uuid
          AND tp.archived_iso IS NULL
          AND pw.is_long = true
          AND pw.type != 'race'
          AND pw.date_iso >= $2
        ORDER BY pw.date_iso ASC
        LIMIT 1`,
      [userUuid, todayISO],
    ),
  );
  if (next === null || next === undefined) return null;

  const nextLongRunMi = next.distance_mi === null ? 0 : Number(next.distance_mi);

  const priorRows = await rowsOrNull<{
    date_iso: string; distance_mi: string | number | null;
  }>(
    'brain/proposal/evidence/long-run-structure · recent completed long runs',
    pool.query(
      `SELECT pw.date_iso::text AS date_iso, pw.distance_mi
         FROM plan_workouts pw
         JOIN training_plans tp ON tp.id = pw.plan_id
        WHERE tp.user_uuid = $1::uuid
          AND tp.archived_iso IS NULL
          AND pw.is_long = true
          AND pw.type != 'race'
          AND pw.date_iso < $2
        ORDER BY pw.date_iso DESC
        LIMIT ${STRUCTURE_LOOKBACK_COUNT}`,
      [userUuid, todayISO],
    ),
  );
  if (priorRows === null) {
    return {
      planWorkoutId: next.id,
      evidence: {
        decision: 'REFUSE',
        reason: 'Recent long runs could not be read, so whether the last ones held together is unknown.',
      },
    };
  }

  const dates = priorRows.map((r) => r.date_iso);
  const runRows = dates.length === 0 ? [] : await rowsOrNull<{ id: string; date_iso: string; data: unknown }>(
    'brain/proposal/evidence/long-run-structure · matching runs',
    pool.query(
      `SELECT r.id::text AS id, ${runDaySql('r')} AS date_iso, r.data
         FROM runs r
        WHERE r.user_uuid = $1::uuid
          AND ${runDaySql('r')} = ANY($2::text[])
          AND ${runNotMergedSql('r')}`,
      [userUuid, dates],
    ),
  );
  if (runRows === null) {
    return {
      planWorkoutId: next.id,
      evidence: {
        decision: 'REFUSE',
        reason: 'The activities matching the recent long runs could not be read.',
      },
    };
  }

  const runByDate = new Map(runRows.map((r) => [r.date_iso, asRunData(r.data)] as const));
  // Oldest first, matching `resolveLongRunStructureEvidence`'s documented
  // "most recent LAST" convention.
  const recent: LongRunSample[] = [...priorRows].reverse()
    .map((pw) => {
      const run = runByDate.get(pw.date_iso);
      if (run === undefined) return null;
      return longRunSampleFrom({
        dateISO: pw.date_iso,
        run,
        prescribedMi: pw.distance_mi === null ? 0 : Number(pw.distance_mi),
      });
    })
    .filter((o): o is LongRunSample => o !== null);

  const evidence = resolveLongRunStructureEvidence({
    nextLongRunSubLabel: next.sub_label,
    nextLongRunMi,
    recent,
  });
  return { planWorkoutId: next.id, evidence };
}
