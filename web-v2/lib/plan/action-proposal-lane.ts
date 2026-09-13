/**
 * lib/plan/action-proposal-lane.ts · THE TWO DECISIONS THAT COULD NOT BE SHOWN.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * WHAT THIS IS FOR
 *
 * The owner, 2026-09-05: "HOLD and SAFETY_STOP must be producible by real
 * evidence, not seeded screenshots."
 *
 * `lib/brain/proposal/write.ts` opened the door — a writer that takes a
 * `BrainAction` rather than an `AdaptationAction`, which is what the type-level
 * wall was. This is the thing that walks through it: the LIVE path that takes
 * real readings, from the owners that already produce them, and raises the two
 * decisions this engine could previously only fake.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * WHERE THE EVIDENCE COMES FROM, AND WHAT THIS FILE MAY NOT DO WITH IT
 *
 * SAFETY. `resolveSafety` in `lib/safety/load-safety.ts` is the app's one
 * canonical safety owner, per `docs/BRAIN_CONSTITUTION.md`. This file CONSUMES
 * its verdict and never re-derives one, never inspects `posture` to reach its
 * own conclusion, and never composes its own sentence about an injury —
 * `safetyStopFrom` takes the resolution whole and the sentence comes from
 * `safetyVerdictLine`, the owner's own renderer. `lib/watch/safety-stop.ts` had
 * to be corrected once for re-deriving a predicate this owner exports, and that
 * correction is the standing example: it was wrong to write even though it
 * happened to agree.
 *
 * HOLD. `progression-pass.ts` resolves, once a training week, what a quality
 * session's shape should be, against a verdict of TAKE / ACCELERATE / HOLD /
 * BACK_OFF. A HOLD is that gate looking at a session and deciding not to move
 * it — a real answer with real evidence behind it, which `from-seal.ts` states
 * plainly: "a hold is 'the evidence does not justify moving yet'". Those
 * resolutions already ride on the `reshape` actions `detectAdaptations`
 * produces; this file reads the actions it is HANDED and runs no detection of
 * its own.
 *
 * LONG RUN STRUCTURE. `lib/brain/proposal/evidence/long-run-structure.ts`
 * (LONGRUNSTRUCTURE-1, 2026-09-06) runs ITS OWN detection, unlike SAFETY and
 * HOLD above — the long run's progression axis has no reshape resolution to
 * ride on, since `resolveWeekProgression`'s `SessionFamily` never walks a
 * long run. This is the one section of this file that queries `plan_workouts`
 * for itself, and it produces a `LONG_RUN_STRUCTURE_CHANGE` on real evidence
 * or a `HOLD` naming why not — `write.ts` withholds the former under the
 * 2026-09-02 reshape ruling exactly as it does for the progression pass's own
 * four session-geometry kinds, which is a decision about SHOWING the card,
 * not about whether the evidence behind it is real.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * WHY A HOLD IS WORTH A CARD AT ALL (Rule 17 asked and answered)
 *
 * Because the alternative is what Rule 21 measured. "309 intents, zero upward"
 * had to be established by querying `coach_intents` sideways, and the reason it
 * was ambiguous is that an engine that never pushes and a runner who never
 * earned it produced the SAME silence. A hold said out loud is the only thing
 * that separates them, and it is the sentence a coach actually says: not
 * nothing, but "one hard week is not evidence; two more like that and the dose
 * moves."
 *
 * It is rationed accordingly. ONE hold card at a time, per runner, deduped by
 * `writeActionProposal` on (runner, kind) rather than on the anchor day —
 * because a hold re-raised each night against a different session would be
 * exactly the six-duplicate-coach-log-cards defect Rule 17 names.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * THE AUTHORITY BOUNDARY
 *
 * Nothing here mutates a plan. `AUTOMATIC_ADAPTATION_AUTHORITY` is not read,
 * not imported and not needed: the only write is one row in
 * `plan_workout_proposals`, which is an offer. Both kinds this lane raises are
 * RECORD_ONLY at the executor anyway — accepting one writes no plan row by
 * design, because the judgement IS the product.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * WHAT THIS CANNOT FAIL ON (Rule 22)
 *
 * · WHETHER THE SAFETY VERDICT IS RIGHT. It is handed one, and an UNKNOWN
 *   verdict raises NOTHING — `safetyStopFrom` returns null and this respects
 *   it. Turning a failed check into a stop would tell a healthy runner to stop
 *   because the database blinked. Note the direction: an unreadable safety
 *   signal still WITHHOLDS THE SESSION, which is `mayEmitRunnableWorkout`'s
 *   job on every surface. What it does not do is announce a halt, and this lane
 *   only announces.
 * · WHETHER THE HOLD WAS THE RIGHT COACHING CALL. `progression-gate.ts` decides
 *   that. A wrong HOLD is raised faithfully.
 * · WHETHER THE CARD IS EVER READ. It writes a row; `loadPendingProposals` and
 *   `toWire` carry it, and Rule 13's standing answer is that the only proof a
 *   card renders is rendering it.
 * · A RUNNER WITH NO UPCOMING SESSION. There is nothing to anchor a card to and
 *   this reports that it raised nothing, rather than inventing an anchor. That
 *   is the honest outcome and it is also the one case where a real stop would
 *   go unshown — named here rather than discovered later.
 */

import { pool } from '@/lib/db/pool';
import { rowOrNull } from '@/lib/db/read';
import { resolveSafety } from '@/lib/safety/load-safety';
import { safetyStopFrom } from '@/lib/brain/proposal/generate/from-safety';
import { actionFromAdaptation } from '@/lib/brain/proposal/generate/from-adaptation';
import { actionFromLongRunStructure } from '@/lib/brain/proposal/generate/from-long-run-structure';
import { loadLongRunStructureEvidence } from '@/lib/brain/proposal/evidence/long-run-structure';
import { writeActionProposal } from '@/lib/brain/proposal/write';
import { readLiveRows, beforeFromLive } from '@/lib/brain/proposal/staleness';
import type { AdaptationAction } from './adapt';
import type { BrainAction, RowBefore } from '@/lib/brain/proposal/action';

export interface ActionLaneReport {
  /** Cards written. */
  readonly raised: number;
  /**
   * Every decision considered and NOT raised, with the reason.
   *
   * Rule 11: a proposal that vanishes is indistinguishable from a decision the
   * engine never made. The cron logs these, so "no hold card tonight" can be
   * told apart from "the hold lane never ran".
   */
  readonly withheld: readonly string[];
}

/** The session a whole-runner decision hangs on. */
interface AnchorRow {
  readonly planWorkoutId: string;
  readonly dateISO: string;
  readonly type: string;
  readonly distanceMi: number | null;
}

/**
 * Raise the decisions no per-workout writer can carry.
 *
 * `actions` is the SAME array the cron already holds from `detectAdaptations`.
 * Nothing is re-detected here — Rule 16, and also the reason this cannot
 * disagree with what the seal recorded about the same pass.
 */
export async function runActionProposalLane(
  userUuid: string,
  todayISO: string,
  actions: readonly AdaptationAction[],
): Promise<ActionLaneReport> {
  const withheld: string[] = [];
  let raised = 0;

  const anchor = await nextSessionFor(userUuid, todayISO);
  if (anchor === null) {
    return { raised: 0, withheld: ['no upcoming session to anchor a card to'] };
  }
  const before: readonly RowBefore[] = [{
    planWorkoutId: anchor.planWorkoutId,
    dateISO: anchor.dateISO,
    type: anchor.type,
    distanceMi: anchor.distanceMi,
  }];

  /* ── 1 · SAFETY ────────────────────────────────────────────────────────
   *
   * The verdict is the input. `safetyStopFrom` answers null for anything that
   * is not a STOP — an UNKNOWN (the check did not run) and a MODIFY (easy-only
   * is a different prescription, not a halt) both produce nothing, and that is
   * its decision rather than this file's. */
  /* NOT WRAPPED IN A CATCH, and that is the Rule 11 posture rather than an
   * omission. `resolveSafety`'s contract is "never throws: a database that is
   * entirely unreachable resolves to the UNKNOWN branch", and UNKNOWN is a
   * THIRD state this lane already handles — `safetyStopFrom` answers null for
   * it, and the withheld line below says which verdict it saw.
   *
   * A `.catch(() => null)` here would have collapsed "the check ran and said
   * clear", "the check could not run" and "the connection is gone" into one
   * value, on the one lane where those are furthest apart. The coercion scan
   * caught exactly that in this file's first cut, correctly. If the owner ever
   * does throw, it reaches the cron's own catch, which reports that the lane
   * did not complete — a fourth fact, kept apart from the other three. */
  const resolution = await resolveSafety(userUuid, { todayISO });
  const stop = safetyStopFrom({ resolution, before });
  if (stop === null) {
    withheld.push(
      `the safety verdict is not a stop (${resolution.known ? resolution.state : 'UNKNOWN'})`,
    );
  } else {
    const out = await raise(userUuid, todayISO, anchor, stop,
      stop.kind === 'SAFETY_STOP' ? stop.because : '');
    if (out === null) raised += 1; else withheld.push(`SAFETY_STOP: ${out}`);
  }

  /* ── 2 · THE HOLD ──────────────────────────────────────────────────────
   *
   * One card, from the first held session in the pass. FIRST rather than
   * "the most interesting", because picking would be this file making a
   * coaching judgement about a judgement that already has an owner — and
   * because the resolutions arrive in the week's own order, so the first is the
   * next session the runner will meet. */
  const held = firstHold(actions);
  if (held === null) {
    withheld.push('the progression pass raised no hold this run');
  } else {
    const out = await raise(userUuid, todayISO, anchor, held.action, held.why);
    if (out === null) raised += 1; else withheld.push(`HOLD: ${out}`);
  }

  /* ── 2b · THE DURATION ACCELERATE OFFER · DURATIONOFFER-1 (2026-09-12) ────
   *
   * Propose-only exception to the 2026-09-02 reshape ruling, scoped to
   * exactly one axis (interval_duration) and exactly one verdict
   * (ACCELERATE) — the owner's ruling, recorded in full at
   * `docs/PRODUCT_DECISIONS.md` under "2026-09-12 · DURATIONOFFER-1" (see
   * `action.ts`'s doc comment on `DURATION_PROGRESS_OFFER` for the same
   * citation and the test that keeps it resolvable).
   *
   * Same shape as the HOLD raise immediately above: reads the SAME `actions`
   * array (no re-detection, Rule 16), translates via the SAME
   * `actionFromAdaptation` the per-workout writer and the HOLD raise both use,
   * and re-labels the result into the non-mutating offer kind.
   *
   * `firstDurationAccelerate` gates on `resolution.action === 'ACCELERATE'`
   * directly (DURATIONOFFER-2, corrected after independent review — see that
   * function's own doc comment for the discriminator bug this replaced).
   * That check is what actually guarantees `band === 'strong'`:
   * `resolveProgressionStep` (`progression-gate.ts`) returns `ACCELERATE`
   * from exactly one branch, `case 'strong':`, and no other — so reading the
   * verdict IS reading the band, not a separate claim about it. Every other
   * eligibility check (compromised-runner fail-closed, doctrine caps inside
   * `advanceShape`, sealed-day exclusion, race/taper/recovery-week exclusion
   * via `non-building-week.ts`) ran upstream inside
   * `resolveWeekProgression`/`detectAdaptations`, and nothing here re-derives
   * or loosens any of them. */
  const accelerated = firstDurationAccelerate(actions);
  if (accelerated === null) {
    withheld.push('the progression pass raised no interval-duration ACCELERATE this run');
  } else {
    /* DURATIONOFFER-3 (2026-09-12, second independent review): this card is an
     * offer about ONE specific session — the one the progression gate actually
     * accelerated — not a whole-runner judgement like SAFETY_STOP or HOLD
     * above, which is why `firstHold`'s "the card is anchored to
     * nextSessionFor's row, not to this one" reasoning does not transfer here.
     * `nextSessionFor` returns whatever is chronologically next in the whole
     * plan, which can be a DIFFERENT session than the one this resolution is
     * about (a different day, a different type, a different distance) —
     * exactly the LONG_RUN_STRUCTURE case below already recognises: "a card
     * about the long run that hangs on Tuesday's tempo would be the wrong fact
     * attached to the right sentence (Rule 16)". Same fix, same shape: re-read
     * the accelerated session LIVE (Rule 10 — the detection-time row can be
     * stale by the time this cron reaches it) and anchor to THAT row.
     */
    const live = await readLiveRows(userUuid, [accelerated.workoutId]);
    const row = live.get(accelerated.workoutId);
    if (row === undefined) {
      withheld.push('DURATION_PROGRESS_OFFER: the accelerated session is no longer live');
    } else {
      const durationAnchor: AnchorRow = {
        planWorkoutId: row.planWorkoutId, dateISO: row.dateISO,
        type: row.type, distanceMi: row.distanceMi,
      };
      const out = await raise(userUuid, todayISO, durationAnchor, accelerated.action, accelerated.why);
      if (out === null) raised += 1; else withheld.push(`DURATION_PROGRESS_OFFER: ${out}`);
    }
  }

  /* ── 3 · THE LONG RUN'S OWN AXIS · LONGRUNSTRUCTURE-1 (2026-09-06) ────────
   *
   * `lib/brain/proposal/evidence/long-run-structure.ts` is the reader
   * `facets.ts`'s ratchet named missing for `LONG_RUN_STRUCTURE_CHANGE`: has
   * the runner's recent long runs earned a race-pace finish. This is the
   * GENERATOR's live caller — the reader is real and the anchor is the long
   * run it is actually about, never the generic `anchor` above, because a
   * card about the long run that hangs on Tuesday's tempo would be the wrong
   * fact attached to the right sentence (Rule 16).
   *
   * `write.ts`'s `WRITER_REFUSES` withholds this kind under the 2026-09-02
   * reshape ruling, so `raise()` below reports it withheld rather than
   * raised — the same honest outcome the four RESHAPE_GAP kinds already get
   * from the progression pass. That is not a bug in this wiring; it is the
   * PROPOSAL_WRITER gap staying exactly as gapped as it was, while the
   * GENERATOR and EVIDENCE_SOURCE gaps beside it close for real. */
  const longRunCandidate = await loadLongRunStructureEvidence(userUuid, todayISO);
  if (longRunCandidate === null) {
    withheld.push('no upcoming long run to evaluate the structure axis on');
  } else {
    const live = await readLiveRows(userUuid, [longRunCandidate.planWorkoutId]);
    const row = live.get(longRunCandidate.planWorkoutId);
    if (row === undefined) {
      withheld.push('LONG_RUN_STRUCTURE: the candidate long run is no longer live');
    } else {
      const before = beforeFromLive(live);
      const longRunAction = actionFromLongRunStructure(longRunCandidate.evidence, before);
      if (longRunAction === null) {
        withheld.push(`LONG_RUN_STRUCTURE: ${longRunCandidate.evidence.reason}`);
      } else {
        const longRunAnchor: AnchorRow = {
          planWorkoutId: row.planWorkoutId, dateISO: row.dateISO,
          type: row.type, distanceMi: row.distanceMi,
        };
        const because = longRunAction.kind === 'HOLD' ? longRunAction.because
          : longRunCandidate.evidence.reason;
        const out = await raise(userUuid, todayISO, longRunAnchor, longRunAction, because);
        if (out === null) raised += 1; else withheld.push(`LONG_RUN_STRUCTURE: ${out}`);
      }
    }
  }

  return { raised, withheld };
}

/**
 * The first HOLD the progression pass produced, with the gate's own reason.
 *
 * Translated by `actionFromAdaptation`, which is the SAME function the
 * per-workout writer uses — so a hold raised here and a reshape recorded by the
 * seal describe one resolution through one translator (Rule 16). A `reshape`
 * whose resolution moved something translates to a geometry kind and is skipped
 * here, because that lever is withheld from this door by the 2026-09-02 ruling
 * and `write.ts` would refuse it anyway.
 */
function firstHold(
  actions: readonly AdaptationAction[],
): { readonly action: BrainAction; readonly why: string } | null {
  for (const a of actions) {
    if (a.kind !== 'reshape') continue;
    const wid = a.workoutIds?.[0];
    if (wid === undefined) continue;
    const translated = actionFromAdaptation(a, {
      planWorkoutId: wid,
      /* The row snapshot only supplies `before`, and a HOLD writes nothing, so
       * the date and type here are descriptive rather than load-bearing — the
       * card is anchored to `nextSessionFor`'s row, not to this one.
       * `ProgressionRowContext` carries no date at all, and inventing one here
       * would be a second answer to "when is this session" (Rule 16), so the
       * resolution's own date is used and the empty string means the pass did
       * not state one. */
      dateISO: a.reshape?.resolution.dateISO ?? '',
      type: a.reshape?.row.type ?? '',
      distanceMi: a.reshape?.row.distanceMi ?? null,
    });
    if (translated === null || translated.kind !== 'HOLD') continue;
    return { action: translated, why: translated.because };
  }
  return null;
}

/**
 * The first interval-duration ACCELERATE the progression pass produced, as an
 * OFFER — DURATIONOFFER-1 (2026-09-12).
 *
 * `actionFromAdaptation`/`actionFromProgression` translate the resolution into
 * `DURATION_CHANGE` with `direction: 'MORE'` — that translation is not
 * re-derived here, it is READ, exactly as `firstHold` above reads the same
 * translator's `HOLD` output.
 *
 * ── DURATIONOFFER-2 (2026-09-12) · `direction: 'MORE'` IS NOT A SAFE
 * DISCRIMINATOR ON ITS OWN, CORRECTED AFTER INDEPENDENT REVIEW ──────────────
 *
 * The original cut of this function filtered on `translated.kind ===
 * 'DURATION_CHANGE' && translated.direction === 'MORE'` alone, reasoning that
 * TAKE always carries `changed: false` and so resolves to HOLD one line
 * earlier — true of `resolveProgressionStep`'s OWN `changed` field
 * (progression-gate.ts), but `resolveWeekProgression` (progression-pass.ts)
 * does not use that field: it recomputes `changed = !sameShape(shape,
 * target.current)` independently (progression-pass.ts:298), specifically so a
 * TAKE that RESUMES a previously-held ladder reports `changed: true` — see
 * that file's own "resume the paused ladder" case (progression-pass.ts:26-45,
 * 309-316: "A TAKE that CHANGES the row is the resume case"). A resumed TAKE
 * therefore translates to the identical `{kind: 'DURATION_CHANGE', direction:
 * 'MORE'}` shape a genuine strong-evidence ACCELERATE does, and the original
 * filter could not tell them apart — confirmed by direct construction during
 * independent review, not merely by reading.
 *
 * The fix reads the actual verdict instead of inferring it: `resolution.action`
 * (`ProgressionResolution.action`, progression-pass.ts:296) is the real
 * TAKE/ACCELERATE/HOLD/BACK_OFF word the gate decided, untouched by any later
 * `changed`/`direction` derivation, and is checked directly.
 *
 * The kind is re-labelled to `DURATION_PROGRESS_OFFER` — never `DURATION_CHANGE`
 * itself — so the card can never reach `DURATION_CHANGE`'s mutating executor
 * regardless of what happens downstream (Rule 16: one quantity, two names on
 * purpose here, because the two carry different consent/write guarantees and
 * must never be confused for one another).
 */
export function firstDurationAccelerate(
  actions: readonly AdaptationAction[],
): { readonly action: BrainAction; readonly why: string; readonly workoutId: string } | null {
  for (const a of actions) {
    if (a.kind !== 'reshape') continue;
    // THE authoritative gate. Read the gate's own verdict, not an inference
    // from a downstream field two independent translators each recompute for
    // their own purposes.
    if (a.reshape?.resolution.action !== 'ACCELERATE') continue;
    const wid = a.workoutIds?.[0];
    if (wid === undefined) continue;
    const translated = actionFromAdaptation(a, {
      planWorkoutId: wid,
      dateISO: a.reshape?.resolution.dateISO ?? '',
      type: a.reshape?.row.type ?? '',
      distanceMi: a.reshape?.row.distanceMi ?? null,
    });
    if (translated === null || translated.kind !== 'DURATION_CHANGE' || translated.direction !== 'MORE') continue;
    const offer: BrainAction = { ...translated, kind: 'DURATION_PROGRESS_OFFER' };
    // `workoutId` is returned alongside the translated action so the caller can
    // anchor the card to the SESSION ACTUALLY BEING ACCELERATED — DURATIONOFFER-3
    // (2026-09-12, second independent review). See the caller's own comment for
    // the bug this closes: `wid` here is exactly `a.workoutIds[0]`, the plan
    // row this resolution is about, which is not necessarily the chronologically
    // next session the runner meets (that is `nextSessionFor`'s job, a different
    // question, used by SAFETY/HOLD immediately above for a reason stated at
    // `firstHold`).
    return { action: offer, why: a.why, workoutId: wid };
  }
  return null;
}

/** Write one card, returning null on success or the reason it was withheld. */
async function raise(
  userUuid: string,
  todayISO: string,
  anchor: AnchorRow,
  action: BrainAction,
  reason: string,
): Promise<string | null> {
  const out = await writeActionProposal({
    userUuid,
    action,
    anchorWorkoutId: anchor.planWorkoutId,
    anchorDateISO: anchor.dateISO,
    reason,
    evidence: { planned_type: anchor.type, planned_distance_mi: anchor.distanceMi },
    source: 'cron_evening',
    todayISO,
  });
  if (!out.ok) return `the write failed: ${out.error.message}`;
  return out.written ? null : out.because;
}

/**
 * The next prescribed session, from the ACTIVE plan only.
 *
 * Rule 14: the scope is stated. `archived_iso IS NULL` matters here as much as
 * anywhere — the owner has 47 plan versions and a join on `user_uuid` alone
 * would anchor a safety card to a session from a block that no longer exists.
 *
 * Rule 11: a failed read returns null and the caller says so, rather than
 * reading as "this runner has no upcoming sessions".
 */
async function nextSessionFor(
  userUuid: string,
  todayISO: string,
): Promise<AnchorRow | null> {
  const r = await rowOrNull<{
    id: string; date_iso: string; type: string; distance_mi: string | number | null;
  }>(
    'plan/action-proposal-lane · next session anchor',
    pool.query(
      `SELECT pw.id, pw.date_iso::text AS date_iso, pw.type, pw.distance_mi
         FROM plan_workouts pw
         JOIN training_plans tp ON tp.id = pw.plan_id
        WHERE tp.user_uuid = $1::uuid
          AND tp.archived_iso IS NULL
          AND pw.date_iso >= $2
          AND pw.type <> 'rest'
        ORDER BY pw.date_iso ASC
        LIMIT 1`,
      [userUuid, todayISO],
    ),
  );
  if (r === null || r === undefined) return null;
  return {
    planWorkoutId: r.id,
    dateISO: r.date_iso,
    type: r.type,
    distanceMi: r.distance_mi === null ? null : Number(r.distance_mi),
  };
}
