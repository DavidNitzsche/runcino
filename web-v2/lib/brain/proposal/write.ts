/**
 * lib/brain/proposal/write.ts · A WRITER THAT CAN CARRY ANY DECISION.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * THE FINDING THIS ANSWERS, IN THE OWNER'S OWN TERMS
 *
 * "HOLD and SAFETY_STOP must be producible by real evidence, not seeded
 *  screenshots."
 *
 * They were seeded. `scripts/v5-roundtrip-seed.ts` writes both by hand and its
 * own header says why, honestly and at length: they "do NOT go through
 * `writeWorkoutProposals`, because they CANNOT: `PROPOSABLE_KINDS` is a set of
 * `AdaptationAction['kind']`, and HOLD, REFUSAL and SAFETY_STOP are not members
 * of that type at all."
 *
 * That is a TYPE-LEVEL wall, not a missing feature, and it is worth naming
 * precisely because widening `PROPOSABLE_KINDS` would not have moved it.
 * `AdaptationAction` is the per-workout mutation vocabulary — downgrade, shave,
 * reschedule, reshape, field_test. There is no member of it that means "the
 * engine looked and decided to leave this alone" or "training is withheld",
 * because neither of those is a mutation. `writeWorkoutProposals` takes
 * `AdaptationAction[]`, so a decision that is not a mutation had no door.
 *
 * The consequence was exact: the three kinds this engine has for making a
 * JUDGEMENT VISIBLE were the three kinds no production path could show anyone.
 * A hold and a stop are the two decisions the runner most needs to see and
 * least needs to answer, and they were reachable only from a scratch database.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * THE FIX, AND WHY IT IS NOT A SECOND WRITER (Rule 16)
 *
 * This takes a `BrainAction`, which is the union every other facet in this lane
 * is already total over. It is not a parallel road beside
 * `writeWorkoutProposals`: that function's job is TRANSLATION — it walks
 * `AdaptationAction`s, filters them through `PROPOSABLE_KINDS`, reads the row,
 * derives a `before`, and calls `actionFromAdaptation` to produce exactly the
 * thing this function takes as its argument. The two are the two halves of one
 * path, and the translation half stays where it is.
 *
 * What changes is that the half after the translation is no longer reachable
 * ONLY through the half before it.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * THE AUTHORITY BOUNDARY IS NOT TOUCHED, AND THIS FILE PROVES IT BY OMISSION
 *
 * `AUTOMATIC_ADAPTATION_AUTHORITY` stays the literal `false`. This module does
 * not import it, does not read it, and could not open it: the only table it
 * writes is `plan_workout_proposals`, and a row there is an OFFER. The plan
 * moves when the runner taps accept and the accept route calls
 * `applyBrainAction` under `RUNNER_ACCEPTED`, which is the same consent path
 * `downgrade` and `shave` have used since 2026-06-04.
 *
 * The seam's own header makes the distinction the load-bearing one: "A proposal
 * is not a mutation, and widening the seam to gate one would have made 'may an
 * unattended job change the plan' and 'may the engine ask a question' the same
 * switch."
 *
 * AND ONE LEVER IS DELIBERATELY WITHHELD FROM THIS DOOR. `reshape` — the
 * session-geometry rewrite — is not in `PROPOSABLE_KINDS`, and the reason is
 * recorded there: the owner's 2026-09-02 ruling names that lever by name
 * ("Too many independent levers can soften, RESHAPE, re-phase, refuse, or
 * automatically mutate the plan"), and CLAUDE.md is explicit that a
 * doctrine-cited guard is not weakened to make room for new work. So
 * `writeActionProposal` REFUSES the four session-geometry kinds and
 * LONG_RUN_STRUCTURE_CHANGE by name, out loud, rather than becoming the side
 * door that lands a ruled-on lever on the runner's phone. That refusal is
 * ratcheted as a PROPOSAL_WRITER gap in `facets.ts`, so it cannot be quietly
 * deleted; closing it is the owner's call, not a writer's.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * WHAT THIS CANNOT FAIL ON (Rule 22)
 *
 * · WHETHER THE DECISION SHOULD HAVE BEEN RAISED. It is handed one. A card for
 *   a hold nobody needed to see is written faithfully and nothing here objects.
 * · WHETHER THE RUNNER EVER SEES IT. It writes a row. `loadPendingProposals`
 *   reads it, `toWire` maps it, and a phone build that predates the standing
 *   draws it as a deferral. Rule 13 is the standing reminder that the only
 *   proof a card renders is rendering it.
 * · A DUPLICATE ACROSS KINDS. The dedup is per (runner, kind, anchor row) and
 *   per (runner, kind) for the non-mutating kinds. Two DIFFERENT kinds about
 *   one session are two cards on purpose, and whether that is one card too many
 *   is Rule 17's question for the surface, not this writer's.
 * · A WRITE THAT LANDS AND IS THEN LOST. There is no transaction here and there
 *   does not need to be: it is one INSERT into one table. The ledger's
 *   atomicity seam is `mutate.ts`'s and is not touched.
 */

import { pool } from '@/lib/db/pool';
import { attempt, rowOrNull } from '@/lib/db/read';
import { describesEvidence } from '@/lib/brain/objective';
import { stripResearchCitations } from '@/lib/plan/strip-citations';
import type { ActionKind, BrainAction } from './action';
import { validateAction } from './validate';
import { serializeAction } from './serialize';
import { evidenceFamilyOf } from './evidence-facet';

/**
 * The `action_kind` column value for a stated decision.
 *
 * Lower snake case, matching the engine words already in the column
 * (`downgrade`, `mark_upgrade`, `reprice`). Derived with `Lowercase<>` rather
 * than written out, so the row vocabulary cannot drift from the union: a kind
 * added to `BrainAction` is a member of this type the same day.
 */
export type ActionRowKind = Lowercase<ActionKind>;

/** The column value for one action. One translation, one direction. */
export function rowKindOf(action: BrainAction): ActionRowKind {
  return action.kind.toLowerCase() as ActionRowKind;
}

/**
 * The 2026-09-02 ruling, written once and referenced five times (Rule 17).
 *
 * Not a paraphrase. `lib/plan/adaptation-authority.ts` holds the same reasoning
 * beside `PROPOSABLE_KINDS`, and this points at it rather than restating it,
 * so a future change to that decision has one place to be made.
 */
const RESHAPE_RULING =
  'the 2026-09-02 ruling names the reshape lever by name (too many independent levers can soften, '
  + 'RESHAPE, re-phase, refuse, or automatically mutate the plan; remove their decision authority), '
  + 'and PROPOSABLE_KINDS withholds it for that reason. A writer that carried it anyway would be '
  + 'the side door around a doctrine-cited guard. Closing this is the owner call.';

/**
 * THE KINDS THIS DOOR WILL NOT CARRY, AND WHY.
 *
 * Not a taste judgement and not a to-do. Each entry is a standing ruling that
 * this writer may not route around, and the completeness gate cross-checks the
 * set against the ratchet in both directions — an entry here with no
 * PROPOSAL_WRITER gap fails, and a gap for a kind this writer now carries fails
 * until deleted.
 */
export const WRITER_REFUSES: Readonly<Partial<Record<ActionKind, string>>> = {
  DURATION_CHANGE: RESHAPE_RULING,
  REPETITION_CHANGE: RESHAPE_RULING,
  RECOVERY_INTERVAL_CHANGE: RESHAPE_RULING,
  QUALITY_DOSE_CHANGE: RESHAPE_RULING,
  LONG_RUN_STRUCTURE_CHANGE: RESHAPE_RULING,
  RACE_TARGET_CHANGE:
    'the coach projects and never renegotiates a stated goal. CLAUDE.md Rule 20 records the card '
    + 'that broke this once, in the owner\'s production account, with an accept action that PATCHed '
    + 'his 3:00:00 goal down to 3:31:48. A target moves when he says so and by no other path.',
};

export type ActionProposalOutcome =
  /** The row was written. */
  | { readonly ok: true; readonly written: true; readonly proposalId: number }
  /**
   * Nothing was written and that is the correct outcome — a duplicate, a past
   * date, a refused kind, an unevidenced decline. Rule 11: this is a THIRD
   * state, never folded into either of the others, because "already on his
   * phone" and "the insert failed" are opposite facts.
   */
  | { readonly ok: true; readonly written: false; readonly because: string }
  | { readonly ok: false; readonly error: Error };

export interface ActionProposalRequest {
  readonly userUuid: string;
  readonly action: BrainAction;
  /**
   * The plan row the card hangs on.
   *
   * `plan_workout_proposals.plan_workout_id` is `TEXT NOT NULL`, so every card
   * names a session even when the DECISION is not about one — a stop withholds
   * training rather than one Tuesday. The anchor is where the card appears, and
   * the honest anchor for a whole-runner decision is the next session it
   * affects. `V5ProposalWire.dateISO` is documented as the effective date for
   * exactly this reason.
   */
  readonly anchorWorkoutId: string;
  readonly anchorDateISO: string;
  /** The runner-facing sentence. Scrubbed of citations here, once. */
  readonly reason: string;
  /** The trigger's own blob, if it had one. The evidence family is added. */
  readonly evidence?: Readonly<Record<string, unknown>>;
  /** Who wrote it. Goes in `source` beside `cron_evening`. */
  readonly source: string;
  /** Runner-local today. A card for a day already gone is not written. */
  readonly todayISO: string;
}

/**
 * Raise one decision as a card the runner can see.
 *
 * Every refusal below is stated rather than silent, because a proposal that
 * vanishes is indistinguishable from a decision the engine never made — which
 * is the ambiguity that let "309 intents, zero upward" survive unexamined.
 */
export async function writeActionProposal(
  req: ActionProposalRequest,
): Promise<ActionProposalOutcome> {
  const { action } = req;

  /* 1 · A CARD THAT CANNOT BE ACCEPTED IS NOT WRITTEN. `validateAction` is the
   * same check the accept path runs; running it here means a malformed action
   * is a log line tonight rather than a button that does nothing tomorrow. */
  const valid = validateAction(action);
  if (!valid.ok) {
    return notWritten(`the ${action.kind} is malformed: ${valid.refusals.join('; ')}`);
  }

  /* 2 · THE STANDING RULINGS. Named, out loud, with the ruling attached. */
  const refused = WRITER_REFUSES[action.kind];
  if (refused !== undefined) {
    return notWritten(`${action.kind} is withheld from this writer: ${refused}`);
  }

  /* 3 · A DAY ALREADY GONE. The runner either ran it or did not, and either
   * way a card about it is a decision with nothing left to decide. */
  if (req.anchorDateISO < req.todayISO) {
    return notWritten(`the anchor day ${req.anchorDateISO} is already past`);
  }

  /* 4 · THE OBJECTIVE'S CLAUSE, ON THE LIVE PATH.
   *
   * `lib/brain/objective.ts` requires a decline to state a FACT, and
   * `writeWorkoutProposals` already enforces it for `downgrade` and `shave`.
   * The same clause has to bite here or this writer is the way around it. It
   * is asked of DIRECTION rather than of kind, which is the more honest test
   * and covers kinds the older writer has no word for.
   *
   * A STOP is exempt and that is deliberate: the sentence on a safety card
   * comes from `safetyVerdictLine`, the safety owner's own renderer, and
   * second-guessing its prose here would be a second opinion on a question
   * that has one owner. */
  const reason = stripResearchCitations(req.reason ?? '').trim();
  if (reason === '') {
    return notWritten(`the ${action.kind} names no reason, and a card with no why is a change `
      + 'the runner is asked to accept with nothing said about it');
  }
  if (action.direction === 'LESS' && !describesEvidence(reason)) {
    return notWritten(
      `the ${action.kind} asks for less and its reason names a disposition rather than a fact: `
      + `"${reason}"`,
    );
  }

  /* 5 · DEDUP.
   *
   * Two questions, because there are two. A change to ONE session dedups on
   * that session, exactly as `writeWorkoutProposals` does — the table has no
   * unique key and the evening cron re-runs, which is how the runner once
   * opened Today to the same decision card three times over.
   *
   * A NON-MUTATING decision dedups on the RUNNER and the KIND, ignoring the
   * anchor, because its anchor moves as the week does: a stop raised on
   * Monday's session and re-raised on Tuesday's is ONE withhold and two cards
   * would be Rule 17 with the volume turned up.
   *
   * Rule 11 and the swallow ratchet: a failed dedup read is NOT "no pending
   * row on record", because that is the answer that inserts. */
  const anchored = !nonMutatingKind(action.kind);
  const dup = await rowOrNull<{ id: number }>(
    'brain/write · pending-proposal dedup',
    anchored
      ? pool.query<{ id: number }>(
        `SELECT id FROM plan_workout_proposals
          WHERE user_uuid = $1::uuid AND plan_workout_id = $2
            AND action_kind = $3 AND status = 'pending'
          LIMIT 1`,
        [req.userUuid, req.anchorWorkoutId, rowKindOf(action)],
      )
      : pool.query<{ id: number }>(
        `SELECT id FROM plan_workout_proposals
          WHERE user_uuid = $1::uuid AND action_kind = $2 AND status = 'pending'
          LIMIT 1`,
        [req.userUuid, rowKindOf(action)],
      ),
  );
  if (dup === null) {
    return notWritten('the dedup read failed, so this pass assumes the card is already raised');
  }
  if (dup !== undefined) {
    return notWritten(`a pending ${rowKindOf(action)} is already on record (#${dup.id})`);
  }

  /* 6 · THE ROW.
   *
   * The action rides in `action_payload.action` under the serializer's own
   * envelope, which is the shape `actionFromPending` prefers and
   * `deserializeAction` type-checks on the way back. The four legacy summary
   * fields are NOT written: they exist so rows from before 2026-09-05 can be
   * reconstructed, and writing a lossy summary beside a complete statement
   * would be two answers to one question (Rule 16).
   *
   * `evidence_family` is stamped from `evidence-facet.ts` so the detail sheet
   * can say where the decision came from even for a kind with no
   * `AdaptationTrigger` behind it — which is every kind this writer exists
   * for. */
  const family = evidenceFamilyOf(action);
  const evidence: Record<string, unknown> = {
    ...(req.evidence ?? {}),
    ...(family === null ? {} : { evidence_family: family }),
  };

  const insert = await attempt(
    'brain/write · insert action proposal',
    pool.query<{ id: number }>(
      `INSERT INTO plan_workout_proposals
         (user_uuid, plan_workout_id, workout_date_iso, action_kind,
          action_payload, reason, evidence, source)
       VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8)
       RETURNING id`,
      [
        req.userUuid, req.anchorWorkoutId, req.anchorDateISO, rowKindOf(action),
        JSON.stringify({ why: reason, action: serializeAction(action) }),
        reason, JSON.stringify(evidence), req.source,
      ],
    ),
  );
  if (!insert.ok) return { ok: false, error: insert.error };

  const id = insert.value.rows[0]?.id;
  if (id === undefined) {
    /* Rule 11 on the write side, and the mirror of `accept.ts`'s
     * `zeroIsNotSuccess`: an INSERT that returned no row did not insert, and
     * reporting a written card would leave a caller believing the runner has a
     * decision waiting that nobody can see. */
    return { ok: false, error: new Error('the insert returned no id; no card was raised') };
  }
  return { ok: true, written: true, proposalId: id };
}

/**
 * Does this kind describe a whole-runner judgement rather than one session?
 *
 * Deliberately NOT `NON_MUTATING_KINDS` imported from `action.ts`, even though
 * the membership is identical today. That set answers "does accepting this
 * write a plan row"; this answers "is the anchor incidental to the decision".
 * They agree by coincidence rather than by definition, and giving one name to
 * two quantities is the Rule 16 collision this lane has already paid for once.
 */
function nonMutatingKind(kind: ActionKind): boolean {
  return kind === 'HOLD' || kind === 'REFUSAL' || kind === 'SAFETY_STOP';
}

function notWritten(because: string): ActionProposalOutcome {
  return { ok: true, written: false, because };
}

