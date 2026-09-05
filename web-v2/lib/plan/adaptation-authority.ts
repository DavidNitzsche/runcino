/**
 * lib/plan/adaptation-authority.ts
 *
 * ═════════════════════════════════════════════════════════════════════════
 *  THE ONE SEAM.
 *
 *  This is the ONLY place in the app where automatic authority over a
 *  runner's live training plan can be granted, and it is OFF.
 * ═════════════════════════════════════════════════════════════════════════
 *
 * ── WHAT THE OWNER RULED (2026-09-02) ────────────────────────────────────
 *
 *   "Too many independent levers can soften, reshape, re-phase, refuse, or
 *    automatically mutate the plan. That complexity is now working against
 *    the primary product requirement."
 *
 *   "Remove their decision authority, not merely their UI. Delete unused
 *    proposal paths, triggers, queues, and competing ownership where safe."
 *
 *   "There must be exactly one future adaptation boundary, disabled by
 *    default."
 *
 * He wants ONE stable, aggressive, coherent block. Not a block that four
 * independent nightly jobs each get a vote on.
 *
 * ── WHAT THIS SEAM WOULD ENABLE IF IT WERE TURNED ON ─────────────────────
 *
 * Flipping `AUTOMATIC_ADAPTATION_AUTHORITY` to `true` restores, in one
 * step, the ability of SCHEDULED, UNATTENDED code to change the runner's
 * live plan without him asking:
 *
 *   1. `run-adaptations` would once again APPLY the `applyNow` lane of
 *      `partitionActionsForCron` directly to `plan_workouts` — pace
 *      recomputes (`recompute_paces`), quality-session geometry rewrites
 *      (`reshape`, from `progression-pass.ts`), staleness marks
 *      (`mark_dirty`) and gap reschedules.
 *   2. `tryAdaptiveBump` (`lib/plan/adaptive-ramp.ts`) would once again
 *      raise weekly volume and the long run unattended — Rule 21's volume
 *      axis.
 *
 * That is the WHOLE grant. There is no second switch, no per-trigger flag,
 * no environment variable, and no database row that can widen it. If you
 * are looking for a way to let some other automatic path mutate the plan,
 * the answer is that it must come through here, and turning this on is a
 * product decision the owner makes, not an implementation detail.
 *
 * ── WHAT IT DOES *NOT* GATE, AND WHY ─────────────────────────────────────
 *
 * This seam is about ADAPTATION — the engine second-guessing a block it
 * already authored, off readings taken after the fact. It is deliberately
 * NOT a gate on:
 *
 *   · The runner asking. `POST /api/plan/replan`, `/api/plan/change`,
 *     `/api/plan/proposal` accept, `/api/plan/workout-proposals/[id]/accept`
 *     and `/api/v5/goal-answer` all still work. Those are the runner in the
 *     driver's seat, which is the posture the ruling asks for, not the one
 *     it removes.
 *   · AUTHORED lifecycle facts. A race date passing, a race entering its
 *     build window, a block running out of prescribed days, a race added or
 *     removed — those re-author a block because the CALENDAR says the old
 *     one has ended, not because a reading moved. The owner's KEEP list is
 *     explicit that the race date and the full block calendar are
 *     preserved, and a runner parked in a dead block forever is not "one
 *     stable plan", it is no plan. Those live in
 *     `app/api/cron/plan-drift/route.ts` and are unchanged.
 *   · `reanchorActivePlan` (`cron/snapshot-projections`). RULED ON AND CLOSED,
 *     2026-09-05 (REANCHORPROPOSES-1). This paragraph used to say the writer
 *     was "deliberately left for the owner to rule on rather than sealed by an
 *     agent". He ruled: "AUTOMATIC_ADAPTATION_AUTHORITY=false is meaningless if
 *     reanchorActivePlan can bypass it and rewrite 76 workouts", and "a hold
 *     that continues writing is an exemption with better paperwork."
 *
 *     It no longer writes. The cron calculates the repricing and raises ONE
 *     coordinated `plan_workout_proposals` card (`action_kind` = `reprice`);
 *     the plan moves when the runner accepts, through
 *     `applyReanchorProposal` under `RUNNER_ACCEPTED`. The coherence worry the
 *     old paragraph raised — a block authored without canonical anchors going
 *     permanently mis-priced — is answered by the card rather than by an
 *     unattended write: the `canonical-prior` arm still fires daily, it is
 *     still doctrine-bound, and what changed is who says yes.
 *
 *     This seam did NOT move to cover it. A proposal is not a mutation, and
 *     widening the seam to gate one would have made "may an unattended job
 *     change the plan" and "may the engine ask a question" the same switch —
 *     which is the conflation the seam's own doc warns about two paragraphs
 *     up. GUARD 3 in `_seal_single_seam.test.ts` holds the self-heal shut on
 *     its declared authority instead.
 *
 * ── RULE 20 ──────────────────────────────────────────────────────────────
 *
 * A rule with no gate is a hypothesis. The gate for this file is
 * `lib/plan/_seal_single_seam.test.ts`, which fails if a SECOND seam
 * appears, if this one is switched on without the switch being deliberate,
 * or if the cron routes reach the mutating entry points around it.
 */

import type { AdaptationAction } from './adapt';
import { partitionActionsForCron } from './adapt';

/**
 * THE SWITCH. Default OFF, and it must stay off until the owner says
 * otherwise.
 *
 * Typed `false` (not `boolean`) on purpose: TypeScript narrows every
 * consumer to the sealed branch, so a caller cannot accidentally be written
 * against the open branch and compile. Turning the seam on is therefore a
 * deliberate, visible, one-line type change that the gate below will notice
 * — not a value that could drift true through configuration.
 */
export const AUTOMATIC_ADAPTATION_AUTHORITY: false = false;

/** Human-readable name for the seam, used in log lines and the gate. */
export const ADAPTATION_SEAM_ID = 'plan/adaptation-authority';

/**
 * Action kinds `writeWorkoutProposals` can actually carry to the runner.
 * Anything outside this set has no `workoutIds` to hang a card on and is
 * SILENTLY DROPPED by that writer — which is how the readiness audit trail
 * went missing once already. Rule 11: a dropped action is not a refusal, it
 * is a lost fact, so everything outside this set is RECORDED instead.
 */
export const PROPOSABLE_KINDS: ReadonlySet<AdaptationAction['kind']> =
  new Set<AdaptationAction['kind']>([
    // Load-reducing. These were the ONLY four for the life of this set.
    'downgrade', 'shave',
    // Neutral.
    'reschedule', 'field_test',
    // ── PROPOSEUP-1 (2026-09-05) · THE UPWARD KINDS, AND WHY THEY WERE ABSENT
    //
    // Every kind above either takes work away or moves it. So the proposal
    // card, which is the ONE runner-visible, runner-consented channel this
    // engine has for changing a plan, could only ever offer to make training
    // easier. An upward adaptation had nowhere to go: it fell through to
    // `toObservationalNote` and became a `coach_intents` row nobody reads.
    //
    // That is the mechanical answer to "why does the brain never push me". It
    // is not only the seam. Opening `AUTOMATIC_ADAPTATION_AUTHORITY` would NOT
    // have fixed it, because an upgrade would then have been applied silently
    // rather than offered, and Rule 21's own measurement (309 intents, zero
    // upward) could not distinguish "never proposed" from "proposed and
    // declined" because there was no propose lane to decline from.
    //
    // Adding them here does NOT open the seam and does not authorise automatic
    // mutation. A proposal changes nothing; the runner accepting it does, and
    // that is the same consent path `downgrade` and `shave` have used since
    // 2026-06-04. `automaticPlanMutationIsAuthorised()` is untouched and still
    // returns false.
    //
    // `recompute_paces` is deliberately NOT here: it reprices a whole plan and
    // has no single workout to hang a card on, so it would be dropped by the
    // `workoutIds` test below and become a note anyway. Naming it here would
    // be a lie about what this set can carry. `mark_dirty` is a staleness
    // mark, not a load change.
    'mark_upgrade',
    //
    // `reshape` is NOT here, and the reason is a guard I ran into rather than
    // a judgement I made. `_seal_single_seam.test.ts` GUARD 5 asserts a
    // quality-session reshape is RECORDED, citing the owner's 2026-09-02
    // ruling by name: "Too many independent levers can soften, RESHAPE,
    // re-phase, refuse, or automatically mutate the plan. Remove their
    // decision authority."
    //
    // A proposal arguably has no decision authority, since the runner decides.
    // But the ruling names this lever specifically, and CLAUDE.md is explicit
    // that a doctrine-cited guard is not weakened to make room for new work.
    // So `mark_upgrade` goes through, `reshape` waits for the owner, and the
    // question is written down rather than resolved by whoever touched the
    // file last.
  ]);

/**
 * The `coach_intents.reason` written for an action the seam refused to
 * apply.
 *
 * DELIBERATELY NOT the reason the action would have written had it applied
 * (`plan_adapt_recompute_paces`, `plan_adapt_progression`, ...). This is the
 * Rule 11 trap the seal was warned about, and it is live in this codebase:
 * `lib/training/pace-anchor.ts` defers the 07:30 self-heal for 24h when it
 * sees a `plan_adapt_recompute_paces` row, on the reasoning that the 03:00
 * adapter already re-priced the block. If a sealed, non-applied recompute
 * wrote that same reason, the self-heal would stand down for a recompute
 * that never happened and the block's paces would freeze — a guard that
 * silently stops guarding, which is worse than no guard.
 *
 * One namespace, one meaning: "the engine judged this, and the seam refused
 * it." Observational. No reader treats it as work done.
 */
export const SEALED_ACTION_INTENT_REASON = 'plan_adapt_sealed';

export interface SealedActionLanes {
  /**
   * Actions the cron may hand to `applyAdaptations`. Under a closed seam
   * this is RECORD-ONLY: every member has `kind === 'note'`, writes a
   * `coach_intents` row, and touches no plan row.
   */
  apply: AdaptationAction[];
  /**
   * Actions that become a `plan_workout_proposals` card. The runner accepts
   * or dismisses; nothing lands until he does. This lane is not new — it is
   * the pre-existing propose-first lane, plus the plan-mutating actions the
   * seam pushed out of `apply`.
   */
  propose: AdaptationAction[];
  /**
   * Plan-mutating actions the seam refused AND that cannot be proposed
   * (no `workoutIds` for a card to point at). Converted to record-only
   * notes and included in `apply`, so the engine's judgment survives in
   * `coach_intents` and nothing is silently dropped. Exposed separately so
   * the cron can report the count.
   */
  recorded: AdaptationAction[];
}

/** Turn a refused plan-mutating action into a record-only note. */
function toObservationalNote(a: AdaptationAction): AdaptationAction {
  return {
    kind: 'note',
    sourceTrigger: a.sourceTrigger,
    noteReason: SEALED_ACTION_INTENT_REASON,
    // ── DELIBERATELY NOT THE WORKOUT ID ────────────────────────────────────
    //
    // `coach_intents.field` is what `lib/coach/adaptation-info.ts` joins on
    // (`ci.field = pw.id AND ci.reason LIKE 'plan_adapt%'`) to attach a
    // "how it changed" reason to a session on Today. Hanging a sealed note
    // off a workout id would put a coach sentence about a change on a row
    // that did not change — Rule 16's shape, and Rule 17's: the runner reads
    // an explanation for something that never happened.
    //
    // The ids are not lost; they are in `sealed_payload.workoutIds` below,
    // where an operator can read them and no runner-facing surface joins on
    // them.
    noteField: null,
    noteValue: {
      sealed_kind: a.kind,
      sealed_source_trigger: a.sourceTrigger ?? null,
      sealed_why: a.why,
      // Enough of the payload to reconstruct what the engine wanted, for a
      // human reading the ledger. Not enough for anything to replay it —
      // there is no replay path, and that is the point.
      sealed_payload: {
        newType: a.newType ?? null,
        newDate: a.newDate ?? null,
        shaveFraction: a.shaveFraction ?? null,
        newVdot: a.newVdot ?? null,
        fromVdot: a.fromVdot ?? null,
        bumps: a.bumps?.length ?? 0,
        workoutIds: a.workoutIds ?? [],
      },
      seam: ADAPTATION_SEAM_ID,
      // ── THE ONE FIELD THAT IS NOT JUST A RECORD ─────────────────────────
      //
      // A refused `reshape` still carries the progression pass's once-per-
      // week marker. `progression-pass.ts` reads the most recent
      // `week_start_iso` to answer "has this week's pass already been
      // decided", and before the seal only an APPLIED reshape wrote it. Left
      // alone, that guard would have read an always-empty table and the
      // weekly pass would have fired on all three catch-up mornings instead
      // of one — Rule 11's "a missing input silently disables a mechanism",
      // created by the very change meant to simplify things.
      //
      // A decision the seam refused is still a decision, so the marker
      // travels with the refusal. Spread last and only when present, so no
      // other sealed kind gains a key it cannot honour.
      ...(a.reshape?.weekStartISO ? { week_start_iso: a.reshape.weekStartISO } : {}),
    },
    why: a.why,
  };
}

/**
 * THE SEAM, applied.
 *
 * Given the actions a detection pass produced, decide what an UNATTENDED
 * scheduled job is allowed to do with them.
 *
 * Closed (today):
 *   · `note`                                   → apply (observational)
 *   · downgrade / shave / reschedule / field_test → propose (runner gates it)
 *   · everything else                           → recorded as a note
 *
 * Open (if the owner ever flips the switch): exactly the old behaviour,
 * `partitionActionsForCron`'s two lanes, unchanged.
 */
export function sealAutomaticActions(actions: AdaptationAction[]): SealedActionLanes {
  const { applyNow, proposeFirst } = partitionActionsForCron(actions);

  // The open branch. Unreachable while `AUTOMATIC_ADAPTATION_AUTHORITY` is
  // typed `false`; kept so the seam is a real switch and not a comment
  // describing one. Written as a runtime read of the constant so the gate
  // can see that the closed branch is the default and not the only branch.
  if (AUTOMATIC_ADAPTATION_AUTHORITY as boolean) {
    return { apply: applyNow, propose: proposeFirst, recorded: [] };
  }

  const apply: AdaptationAction[] = [];
  const propose: AdaptationAction[] = [];
  const recorded: AdaptationAction[] = [];

  // Both lanes run through the same three-way test, not just the apply lane.
  // `writeWorkoutProposals` silently SKIPS any action outside
  // `PROPOSABLE_KINDS` or carrying no `workoutIds`, so anything else routed
  // to it is not proposed and not applied — it evaporates, and the
  // `coach_intents` row goes with it. That is Rule 11's worst shape (a
  // judgment and a dropped read become the same nothing) and it has bitten
  // this exact lane before, which is why the propose-first list is filtered
  // here rather than trusted.
  for (const a of [...applyNow, ...proposeFirst]) {
    if (a.kind === 'note') {
      apply.push(a);
      continue;
    }
    if (PROPOSABLE_KINDS.has(a.kind) && (a.workoutIds?.length ?? 0) > 0) {
      propose.push(a);
      continue;
    }
    const note = toObservationalNote(a);
    recorded.push(note);
    apply.push(note);
  }

  return { apply, propose, recorded };
}

/**
 * The other consumer of the seam: an unattended path asking whether it may
 * mutate the plan at all.
 *
 * `tryAdaptiveBump` is the only caller. It is Rule 21's volume axis and the
 * one upward lever the engine had; under the owner's ruling that "upward
 * adaptation remains shadow-only and must remain incapable of changing the
 * live plan", it may detect and log, and it may not write.
 */
export function automaticPlanMutationIsAuthorised(): boolean {
  return AUTOMATIC_ADAPTATION_AUTHORITY as boolean;
}
