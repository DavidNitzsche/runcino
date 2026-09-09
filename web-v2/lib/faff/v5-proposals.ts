/**
 * lib/faff/v5-proposals.ts · pending adaptations, mapped for the phone.
 *
 * V5PROPOSAL-1 (2026-09-05). The engine writes `plan_workout_proposals` rows
 * and the V5 app never read them. This is the mapping, kept in one file so the
 * phone never learns an engine word and the wording never has to change in two
 * places (Rule 16).
 *
 * ── WHY DIRECTION IS COMPUTED HERE AND NOT ON THE PHONE ────────────────────
 *
 * `action_kind` is not the question the runner asks. `shave` and `downgrade`
 * are both a pull-back; `mark_upgrade` is a push; `reschedule` is "the same
 * work on a different day". Mapping on the phone would put a coaching
 * judgement in a view, and a second copy of it in the watch when that lands.
 *
 * ── AND WHY DIRECTION IS NOW THE OBJECTIVE'S OWN VOCABULARY ────────────────
 *
 * V5PROPOSALSURFACE-1 (2026-09-05). This file's first cut mapped to
 * `more | less | move | test`, which was a FOURTH name for an axis the engine
 * already had three: `lib/brain/objective.ts` ranks PUSH / HOLD / PULL_BACK,
 * `lib/plan/adjudication/contract.ts` types those exact three, and the card
 * drew "MORE" and "EASIER". Rule 16 says one quantity, one name, and the
 * surface is the half nobody greps — so the surface moved to the engine's
 * vocabulary rather than the other way round.
 *
 * ── THE TWO JUDGEMENT CALLS IN THE MAP, STATED RATHER THAN BURIED ──────────
 *
 * 1 · `field_test` is a PUSH. It never asks for less: it replaces a prescribed
 *     quality session with a maximal 30-minute effort, and its whole purpose is
 *     to earn a faster prescription. `PushKind` counts PACE and SPECIFICITY as
 *     advances, and this is both. It is not a load reduction under any reading,
 *     which is the property that decides the axis.
 *
 * 2 · `downgrade` splits on `newType`, which the engine already constrains to
 *     `easy | recovery | rest` (`adapt.ts`'s `clearsQuality`). Turning a tempo
 *     into an easy run is a PULL_BACK; turning it into a rest day or a recovery
 *     run is prescribed RECOVERY, which is a different thing to be told and a
 *     `DeclineBasis` of its own. Reading the payload is not a guess.
 */
import type {
  V5ProposalDetailWire,
  V5ProposalDirection,
  V5ProposalOptionWire,
  V5ProposalReadWire,
  V5ProposalStanding,
  V5ProposalWire,
  V5ProposalWorkoutWire,
} from '@/lib/faff/v5-today';
import { fmtMi } from '@/lib/format/run';
import type { PendingProposal } from '@/lib/plan/workout-proposals';
import {
  actionFromPending, actionShapeOfEngineKind, LEGACY_MUTATING_ACTION_KINDS,
} from '@/lib/brain/proposal/staleness';
import { isLedgerAvailable } from '@/lib/brain/ledger/decision-ledger';
import { deserializeAction } from '@/lib/brain/proposal/serialize';
import { phoneDirectionOf, actionHeadline } from '@/lib/faff/v5-action-render';
import { executorFor } from '@/lib/brain/proposal/executor-map';
import { evidenceProse, missingEvidenceLabel } from '@/lib/faff/v5-evidence-prose';

/**
 * Engine kind to the runner's question.
 *
 * V5PROPOSALRENDER-1 (2026-09-05) · this now DELEGATES. It used to hold its own
 * five-kind switch, which was correct for the five kinds the engine could raise
 * and would have gone quiet the moment it learnt a sixth: an unrecognised kind
 * returns null and `toWire` withholds the card, so a new lever would have
 * reached the phone as nothing at all. That is this codebase's signature
 * failure — wired, tested and inert — arriving on the one surface where the
 * runner would never know to look for it.
 *
 * The direction now comes from `phoneDirectionOf`, which is TOTAL over the
 * action union: a kind with no drawing fails to compile rather than fails to
 * appear. The two judgement calls the old switch documented are preserved
 * there (a field test is a push; a downgrade to rest or recovery is prescribed
 * RECOVERY, not a pull-back) and are gated by name.
 */
export function directionOf(
  kind: string,
  payload?: PendingProposal['actionPayload'],
): V5ProposalDirection | null {
  /* ── V5DIR-1 (2026-09-05) · READ THE DECISION, THEN THE ENGINE WORD ───────
   *
   * This used to ask `actionShapeOfEngineKind` FIRST and only ever — a switch
   * over the five words the legacy `action_kind` column can hold — while its
   * sibling `headlineFor` asked `actionFromPending`, which prefers the DECISION
   * the row states in `action_payload.action`. One card, two sources, for one
   * quantity (Rule 16).
   *
   * The cost was not theoretical and it was not visible: a row that states a
   * kind outside those five got its headline from the decision and its
   * direction from nothing, and `toWire` WITHHELD the card. Proven by seeding a
   * HOLD and a SAFETY_STOP against a scratch plan — both rows written, both
   * readable, both rendered by `actionHeadline`, and neither one reaching the
   * phone. Which is the exact failure `v5-action-render.ts`'s header says it
   * closed: "the brain raises a pace change, the phone shows nothing, and
   * everything reports success". The total renderer was real; nothing outside
   * five engine words could reach it.
   *
   * So the order is now the same one `actionFromPending` uses, for the same
   * reason: a row that STATES its action is answered from that action, and the
   * engine-word table is the fallback for the rows written before there was one
   * to state. It is not deleted — the seven production rows that predate
   * ACTIONCOMPLETE-1 carry no action at all, and treating their absence as a
   * failure would blank every card those runners can see (Rule 11).
   */
  const stored = deserializeAction(payload?.action);
  if (stored != null) return phoneDirectionOf(stored);

  const shape = actionShapeOfEngineKind(kind, payload ?? {});
  // Rule 11: a kind this bridge has not been taught is not a pull-back. It is
  // a kind nobody decided how to draw, and a guessed direction on a card the
  // runner may act on is worse than no card.
  return shape == null ? null : phoneDirectionOf(shape);
}

/**
 * Six to ten words, in the coach's voice.
 *
 * Also delegating, for the same reason as `directionOf`, and to the same total
 * renderer. Direction and headline are two facts on one card (Rule 17) —
 * direction is which way, headline is what changes — so they are two functions
 * over the same action rather than one derived from the other.
 *
 * The wording is unchanged: `actionHeadline` carries the exact sentences this
 * function used to build, which is why the pinned assertions in
 * `_v5_proposals.test.ts` still hold. Those tests now exercise the total
 * renderer through this adapter, which is the point — a renderer no corpus
 * reaches is untested however total it is (Rule 15).
 */
export function headlineFor(p: PendingProposal): string {
  const action = actionFromPending(p);
  if (action == null) {
    // Reached only by a row whose payload does not specify what to change —
    // an upgrade with no distance, a move with no date. It cannot be applied
    // either, and `toWire` withholds it, so this is the log-side wording only.
    return `Change to ${dayName(p.workoutDateISO)}`;
  }
  return actionHeadline(action, dayName(p.workoutDateISO));
}

/**
 * Is this a question, a condition, a deferral, or a done deal?
 *
 * Derived, never stored, because the row has no column for it and inventing
 * one would mean a migration to record something the evidence already says.
 *
 *   condition · the trace carries an `earningGate`. `EvidenceClass` calls this
 *               CONDITIONAL: it depends on evidence that does not exist YET,
 *               and the honest thing to show is what would earn it rather than
 *               two buttons.
 *   deferral  · the trace names a reassessment date still in the future and no
 *               gate. The engine has said it will re-take this decision, so it
 *               is not yet a question the runner owes an answer to.
 *   proposal  · everything else. Open, and waiting on him.
 *
 * `applied` never comes from here: a pending row is by definition not applied,
 * and the decision history is where that standing is resolved.
 */
export function standingOf(p: PendingProposal, todayISO: string): V5ProposalStanding {
  if (earningConditionsFrom(p.evidence) != null) return 'condition';
  const reassess = reassessOnFrom(p.evidence);
  if (reassess != null && reassess > todayISO) return 'deferral';

  /* ── ACTIONCOMPLETE-2 (2026-09-05) · A JUDGEMENT IS NOT A QUESTION ────────
   *
   * HOLD, REFUSAL and SAFETY_STOP became reachable in production this day, and
   * they all fell through to `proposal` — which draws Do it / Leave it. That
   * would have asked the runner to approve the engine LEAVING HIS PLAN ALONE,
   * and to decline a safety withhold, on the one screen he actually opens.
   *
   * The test is the EXECUTOR's, not a second list of kinds here: a kind routed
   * to RECORD_ONLY changes nothing when accepted, which is exactly the property
   * that makes an accept button meaningless (Rule 16 — one answer to "does
   * accepting this do anything", and `executor-map.ts` owns it).
   *
   * `CONDITIONAL` is also RECORD_ONLY and is deliberately caught by the gate
   * ABOVE this one when it carries an earning gate, because "here is what would
   * earn it" is a better thing to draw than "this is a notice". A conditional
   * with no gate recorded reads as a notice, which is honest: nothing was
   * written down for the runner to work toward. */
  const action = actionFromPending(p);
  if (action != null && executorFor(action).path === 'RECORD_ONLY') return 'notice';

  return 'proposal';
}

/**
 * Keys in a trigger's evidence blob that must never reach the runner.
 *
 * `citation` holds a raw `Research/03-heart-rate-zones.md §6` string. Every
 * other runner-facing path in this app runs `stripResearchCitations` over
 * exactly that shape, and the details sheet is not the exception: it is depth
 * for the RUNNER, not an engine console. `workout_id` is a uuid.
 */
const EVIDENCE_KEYS_NOT_FOR_THE_RUNNER = new Set([
  'citation', 'workout_id', 'why',
  // Rule 17, found by RENDERING the sheet. `planned_date` is the same day the
  // card's effective date names and the same day the SESSIONS AFFECTED row
  // names, so printing it under EVIDENCE USED put one date on the screen three
  // times. A date is not evidence anyway: it is where the evidence applies.
  'planned_date',
]);

/**
 * Engine key to a short English label. Anything unlisted is title-cased.
 *
 * EVIDENCEPROSE-1 (2026-09-08) · THIS IS NOW THE FALLBACK, NOT THE RENDERER.
 * `v5-evidence-prose.ts` writes sentences for the shapes it has been taught
 * and claims the keys it spoke for; this table dresses whatever is left, for a
 * blob nobody has taught it yet. A `label: value` line is a worse answer than
 * a sentence and a better one than nothing — but it is not the answer for a
 * shape that is live in production, so when a new trigger starts writing a
 * blob, teach the prose module rather than extending this list.
 */
const EVIDENCE_LABELS: Record<string, string> = {
  planned_type: 'Session type',
  planned_distance_mi: 'Session distance',
  lthr_stale: 'Threshold HR anchor stale',
  lthr_age_days: 'Threshold HR anchor age, days',
  days_since_test: 'Days since last test',
  weekly_mi: 'Week volume, miles',
  long_mi: 'Longest run, miles',
  // REANCHORPROPOSES-1 · what a repricing measured.
  anchor_vdot_now: 'Block is priced at',
  anchor_vdot_proposed: 'Your evidence reads',
  evidence_source: 'Evidence came from',
  anchor_confidence: 'Confidence in that read',
  anchor_source: 'How the anchor is known',
  ends_calibration_intro: 'Ends the calibration intro',
  priced_before_canonical_layer: 'Block predates the canonical pace layer',
};

/**
 * THE DEPTH BEHIND THE CARD.
 *
 * ── WHAT THIS CAN AND CANNOT SAY TODAY, HONESTLY ───────────────────────────
 *
 * `plan_workout_proposals.evidence` is whatever the trigger that produced the
 * action put there, and the SHAPE varies by trigger: `field_test_due` writes
 * `planned_date` / `planned_type` / `planned_distance_mi` / `lthr_stale` /
 * `lthr_age_days`, the three repricing arms write anchor readings,
 * `brain/proposal/write.ts` stamps `evidence_family` on everything it inserts.
 * `lib/faff/v5-evidence-prose.ts` owns the wording for the shapes it has been
 * taught (EVIDENCEPROSE-1) and this function dresses the remainder.
 *
 * For the options the engine weighed, the earning gate and
 * the policy assumptions there is NOTHING: `DecisionTrace` exists in
 * `lib/plan/adjudication/contract.ts` and nothing persists one onto a proposal
 * row yet.
 *
 * So those sections come back `null`, and null is NOT the empty list. The
 * sheet draws "not recorded" for a null and "none" for an empty array,
 * because "the coach considered no alternatives" and "nobody wrote down which
 * alternatives the coach considered" are different facts about this engine and
 * collapsing them would be Rule 11 on the one surface built to explain a
 * decision. When a trace does start landing on the row, this reads it with no
 * further change: the shapes below are `DecisionTrace`'s own.
 */
export function detailFor(p: PendingProposal): V5ProposalDetailWire {
  const ev = p.evidence ?? {};
  const used: string[] = [];
  const missing: string[] = [];

  /* ── EVIDENCEPROSE-1 (2026-09-08) · SENTENCES FIRST, KEYS SECOND ──────────
   *
   * `v5-evidence-prose.ts` reads the blob and returns prose plus the set of
   * keys it has answered for. The loop below is unchanged in EVERY respect
   * that matters to Rule 11 — a key present with a null value still becomes a
   * MISSING EVIDENCE row, before any reader is consulted, so the prose module
   * only ever claims facts the engine actually recorded.
   *
   * `sessionNamedElsewhere` is `affectedFrom`'s own branch condition, computed
   * here so there is exactly one answer to "will SESSIONS AFFECTED draw the
   * planned session from these keys" (Rule 16). It is false only for a
   * repricing carrying its own payload, which names a count of sessions
   * instead and never reads `planned_type` / `planned_distance_mi`. */
  const sessionNamedElsewhere = !(p.actionKind === 'reprice' && p.actionPayload?.reprice != null);
  const prose = evidenceProse(ev, { sessionNamedElsewhere });
  used.push(...prose.sentences);

  for (const [key, raw] of Object.entries(ev)) {
    if (EVIDENCE_KEYS_NOT_FOR_THE_RUNNER.has(key)) continue;
    if (key === 'options' || key === 'earningGate' || key === 'policyAssumptions'
      || key === 'reassessOn' || key === 'reassessOnISO' || key === 'missingEvidence') continue;
    const label = EVIDENCE_LABELS[key] ?? humanise(key);
    // Rule 11 at the row level: a key present with a null value is the engine
    // saying it looked and found nothing, which is a different line from the
    // key being absent entirely. Absent keys cannot appear here at all.
    //
    // The missing row gets its OWN wording where there is one: a runner reads
    // this list as "what nobody could measure", and a column header
    // ("Threshold HR anchor age, days") is not a thing that can be missing.
    if (raw === null || raw === undefined) {
      missing.push(missingEvidenceLabel(key) ?? label);
      continue;
    }
    // Said already, in a sentence. A claimed key is never re-printed, whether
    // the prose spoke it or deliberately withheld it.
    if (prose.spokenFor.has(key)) continue;
    // A distance carries its unit, from the one formatter that owns it. Found
    // by rendering: the sheet read "Session distance: 2.5", which is a number
    // the runner has to guess the unit of.
    if (key === 'planned_distance_mi' && typeof raw === 'number' && Number.isFinite(raw)) {
      used.push(`${label}: ${fmtMi(raw)}`);
      continue;
    }
    const rendered = renderValue(raw);
    /* A value with no runner-readable rendering is WITHHELD AND LOGGED, never
     * stringified. `renderValue` used to answer `JSON.stringify(v)` for an
     * object or an array, and the readiness blob's `streaks` is an array — so
     * the fallback path's worst case was a raw JSON literal on the phone,
     * which is not depth, it is the console. Rule 11: this is a third fact and
     * it is said out loud, at the level the operator reads, rather than
     * silently dropped. */
    if (rendered == null) {
      console.log(`[v5/proposal] evidence key '${key}' on proposal ${p.id} has no runner-readable `
        + 'rendering and was withheld from the details sheet · teach lib/faff/v5-evidence-prose.ts '
        + 'this shape · the runner sees the rest of the section, not an error');
      continue;
    }
    used.push(`${label}: ${rendered}`);
  }

  // An explicit list beats an inferred one where the trigger wrote one.
  const declaredMissing = stringArrayOrNull(ev.missingEvidence);
  if (declaredMissing != null) missing.push(...declaredMissing);

  return {
    // An empty evidence blob is a real fact: the row was written with nothing
    // recorded. `[]` says so; the sheet renders it as "none recorded".
    evidenceUsed: used,
    missingEvidence: missing,
    optionsConsidered: optionsFrom(ev),
    earningConditions: earningConditionsFrom(ev),
    reassessOnISO: reassessOnFrom(ev),
    affectedWorkouts: affectedFrom(p),
    policyAssumptions: stringArrayOrNull(ev.policyAssumptions),
  };
}

/**
 * P0PROPOSALFETCH-1 (2026-09-09) · WOULD "DO IT" ACTUALLY LAND RIGHT NOW.
 *
 * Only meaningful for a `standing === 'proposal'` card — a condition, a
 * deferral and a notice draw no accept button at all, so there is nothing
 * here to say cannot be applied. `mutatePlan`'s `LEDGERREQUIRED-1` refuses
 * every touch except plan authorship while `plan_decision_ledger` (migration
 * 166) is absent, and every real apply path a workout proposal can take runs
 * through it:
 *
 *   · a row with a stored `BrainAction` — `executorFor(action).path` is
 *     `ADAPTATION_PIPELINE`, `REPRICE_APPLY` (reprice/`COORDINATED`) or
 *     `DIRECT_PLAN_WRITE`, and all three call `mutatePlan` with
 *     `touches: 'structural'` or `'derivations'` (`lib/plan/adapt.ts`,
 *     `lib/plan/reanchor-plan.ts`, `lib/brain/proposal/accept.ts`) — blocked.
 *   · `RECORD_ONLY` (HOLD/REFUSAL/SAFETY_STOP/CONDITIONAL) writes no plan
 *     row and is never reached here anyway, because `standingOf` maps those
 *     to `notice`/`condition`, not `proposal` — not blocked, moot.
 *   · `UNIMPLEMENTED` (ADD_WORKOUT, FREQUENCY_CHANGE) has no apply path at
 *     all, which is a real, separate, pre-existing gap this task does not
 *     touch — not a ledger question, so not reported as one here.
 *   · a row with NO stored action (pre-2026-09-05) falls to the accept
 *     route's legacy lane for exactly `LEGACY_MUTATING_ACTION_KINDS`, which
 *     is `applyAdaptations` again — same `touches: 'structural'` door,
 *     blocked the same way.
 *
 * "Leave it" is never affected — `dismiss` never calls `mutatePlan` (its own
 * route header says so) — so this must gate the accept control only.
 */
function applyBlockedBecauseFor(
  p: PendingProposal,
  standing: V5ProposalStanding,
  ledgerAvailable: boolean,
): string | null {
  if (standing !== 'proposal' || ledgerAvailable) return null;
  const action = actionFromPending(p);
  if (action != null) {
    const path = executorFor(action).path;
    if (path === 'RECORD_ONLY' || path === 'UNIMPLEMENTED') return null;
    return LEDGER_BLOCKED_WHY;
  }
  return LEGACY_MUTATING_ACTION_KINDS.has(p.actionKind) ? LEDGER_BLOCKED_WHY : null;
}

// Coach voice: no em dashes (locked rule, gated everywhere except this
// proposal surface, which is exactly the gap that let 1,804 rows through
// elsewhere — not repeating it here).
const LEDGER_BLOCKED_WHY =
  'This decision can’t be applied yet. The record it would write to is not set up on '
  + 'this server. Leave it still works. Try Do it again later.';

export function toWire(
  p: PendingProposal,
  todayISO: string,
  // Defaults `true` (available) rather than being strictly required: the
  // existing test corpus calls this with no opinion about migration 166 at
  // all, and the safe default for an unstated ledger state is the one that
  // does not fabricate a block nothing asked about. The two real callers in
  // `loadV5PendingProposals` below always pass the measured value.
  ledgerAvailable: boolean = true,
): V5ProposalWire | null {
  const direction = directionOf(p.actionKind, p.actionPayload);
  if (direction == null) return null;
  const why = (p.reason ?? '').trim();
  // A card with no reason is the thing the objective forbids: a change the
  // runner is asked to accept with nothing said about why. Withheld, not
  // guessed at.
  if (why === '') return null;
  const standing = standingOf(p, todayISO);
  return {
    id: String(p.id),
    dateISO: p.workoutDateISO,
    direction,
    standing,
    applyBlockedBecause: applyBlockedBecauseFor(p, standing, ledgerAvailable),
    headline: headlineFor(p),
    why,
    detail: detailFor(p),
  };
}

/**
 * DECISIONPLACEMENT-1 (2026-09-07) · the one loader, so Today and Block never
 * answer "what's pending" two different ways.
 *
 * Extracted verbatim from `app/api/v5/today/route.ts`'s private
 * `loadV5Proposals` (V5PROPOSAL-1 / WITHHOLDLOG-1), which is why the log
 * lines below still say `[v5/today]` — they are Railway diagnostics, not
 * runner-facing text, and renaming them would only cost grep history for
 * nothing a runner will ever see.
 *
 * Returns every pending proposal, unfiltered by date. WHICH surface shows
 * WHICH proposal is not this function's question — David's ruling
 * (2026-09-07): "This decision card should go in the block section though I
 * think. It's weird to have it on TODAY" — a HOLD about a long run thirteen
 * days out has no business on the screen for right now. `dateISO` is the
 * caller's filter: `/api/v5/today` keeps `dateISO === todayISO`, `/api/v5/
 * block` keeps everything else. A pending proposal's anchor can never be
 * BEFORE today (`write.ts`'s "the anchor day is already past" guard refuses
 * that at write time), so the two filters partition the list completely —
 * neither surface can silently drop a card between them.
 */
export async function loadV5PendingProposals(
  userId: string,
): Promise<{ items: V5ProposalWire[]; read: V5ProposalReadWire; todayISO: string | null }> {
  try {
    const [{ loadPendingProposals }, { runnerToday }] = await Promise.all([
      import('@/lib/plan/workout-proposals'),
      import('@/lib/runtime/runner-tz'),
    ]);
    // Read `today` FIRST. `items` is always `[]` on any failure branch below,
    // so `todayISO` only matters to a caller's date filter when there is
    // something to filter — but it is computed here, once, rather than
    // re-derived per branch, so a throw from `runnerToday` itself reaches the
    // same catch as a throw from `loadPendingProposals` instead of needing a
    // second fallback.
    const todayISO = await runnerToday(userId);
    // One probe for the whole list, not one per row: it is a single global
    // fact about this database, not a per-proposal read, and the cached
    // probe behind it (`decision-ledger.ts`'s `ledgerTableExists`) already
    // shares a positive result across callers — this just avoids asking N
    // times in the same request for a fact that cannot change mid-request.
    const [read, ledgerAvailable] = await Promise.all([
      loadPendingProposals(userId),
      isLedgerAvailable(),
    ]);
    if (!read.ok) {
      console.log('[v5/today] proposal read FAILED, showing none · '
        + 'this is not the same fact as having none · ' + read.error.message.slice(0, 160));
      return { items: [], read: 'failed', todayISO };
    }
    const items = read.proposals
      .map((r) => toWire(r, todayISO, ledgerAvailable))
      .filter((w): w is V5ProposalWire => w !== null);
    /* ── WITHHOLDLOG-1 (2026-09-05) · A CARD WITHHELD IS SAID OUT LOUD ─────
     *
     * `toWire` answers null for a row it cannot draw — a kind nobody has
     * decided how to render, or a decision with no stated reason — and
     * withholding is the right call: a guessed direction on a card the
     * runner may act on is worse than no card.
     *
     * What was wrong is that it happened in SILENCE. Proven on a scratch
     * database by writing a proposal whose `action_kind` is a word nothing
     * has been taught: the row was written, the read succeeded, the card
     * never appeared, and every layer reported success. Rule 11 says a
     * withheld read is a third fact rather than an absence. It is a LOG and
     * not a wire field on purpose: the runner is owed a correct screen, not
     * an engine console. */
    const withheld = read.proposals.length - items.length;
    if (withheld > 0) {
      const kinds = read.proposals
        .filter((r) => toWire(r, todayISO, ledgerAvailable) === null)
        .map((r) => `${r.id}:${r.actionKind}`)
        .join(', ');
      console.log(
        `[v5/today] ${withheld} pending proposal(s) WITHHELD from the phone because nothing `
        + `here knows how to draw them · ${kinds} · the runner sees no card and the rows stay `
        + 'pending; this is not the same fact as having none',
      );
    }
    return { items, read: 'ok', todayISO };
  } catch (err) {
    console.log('[v5/today] proposal read THREW, showing none · '
      + 'this is not the same fact as having none · ' + String(err).slice(0, 160));
    // `todayISO: null` here is Rule 11, not a coerced guess: `items` is
    // always `[]` on this path, so a caller's date filter has nothing to
    // apply against — inventing a date (`new Date()`) would assert a fact
    // ("this is the runner's today") this function does not actually know,
    // for a value nothing downstream reads.
    return { items: [], read: 'failed', todayISO: null };
  }
}

// ── evidence readers ───────────────────────────────────────────────────────
//
// Each returns null for "no record" and a container for "recorded". None of
// them fabricates: a shape that is present but malformed reads as no record,
// which is the safe direction on a surface whose job is to explain.

function optionsFrom(ev: Record<string, unknown>): V5ProposalOptionWire[] | null {
  const raw = ev.options;
  if (!Array.isArray(raw)) return null;
  const out: V5ProposalOptionWire[] = [];
  for (const o of raw) {
    if (o == null || typeof o !== 'object') continue;
    const r = o as Record<string, unknown>;
    // `DecisionTrace.rejected` is `{ option, why }`; `OptionAppraisal` is
    // `{ option, describe, risk }`. Read either without preferring one.
    const what = firstString(r.what, r.describe, r.option);
    const why = firstString(r.why, r.risk);
    if (what == null || why == null) continue;
    out.push({ what, why });
  }
  return out;
}

function earningConditionsFrom(ev: Record<string, unknown>): string[] | null {
  const gate = ev.earningGate;
  if (gate == null || typeof gate !== 'object') return null;
  const requires = (gate as Record<string, unknown>).requires;
  if (!Array.isArray(requires)) return null;
  const out: string[] = [];
  for (const r of requires) {
    if (r == null || typeof r !== 'object') continue;
    // `EarningRequirement.what` is explicitly "in the runner's language"; the
    // sibling `measurable` is "in the engine's" and stays behind the wire.
    const what = firstString((r as Record<string, unknown>).what);
    if (what != null) out.push(what);
  }
  // NOT `out.length > 0 ? out : null`. COERCION-1 caught that shape here, and
  // it was right: a gate whose `requires` array is present but empty is a gate
  // that recorded no requirements, which is a different fact from there being
  // no gate at all. Collapsing them would have made this function say "no
  // record" about something the trace explicitly wrote down (Rule 11).
  return out;
}

function reassessOnFrom(ev: Record<string, unknown>): string | null {
  return firstString(ev.reassessOnISO, ev.reassessOn) ?? null;
}

/**
 * Which sessions this decision touches.
 *
 * Never null: the proposal's own workout is always one, so "we have no record"
 * is not a possible answer here. A move adds its destination, which is the one
 * place a second date belongs (see `V5ProposalWire.dateISO`).
 */
function affectedFrom(p: PendingProposal): V5ProposalWorkoutWire[] {
  // REANCHORPROPOSES-1 · a repricing touches the whole remaining block, and
  // listing 77 rows here would be the seventy-seven-cards defect wearing a
  // different hat. One row, naming the count, from the day it takes effect.
  const r = p.actionPayload?.reprice;
  if (p.actionKind === 'reprice' && r != null) {
    const n = numberOrNull(r.workoutsAffected);
    const rows: V5ProposalWorkoutWire[] = [{
      dateISO: p.workoutDateISO,
      what: n == null || n === 1
        ? 'Every prescribed session from this day on'
        : `${n} prescribed sessions, from this day to the end of the block`,
    }];
    const sealed = numberOrNull(r.workoutsSealed);
    if (sealed != null && sealed > 0) {
      rows.push({
        dateISO: p.workoutDateISO,
        what: `${sealed} day${sealed === 1 ? '' : 's'} left alone because you already ran ${sealed === 1 ? 'it' : 'them'}`,
      });
    }
    return rows;
  }

  const ev = p.evidence ?? {};
  const type = firstString(ev.planned_type);
  const mi = numberOrNull(ev.planned_distance_mi);
  const what = [type, mi == null ? null : fmtMi(mi)].filter(Boolean).join(' · ');
  const rows: V5ProposalWorkoutWire[] = [
    { dateISO: p.workoutDateISO, what: what === '' ? 'The prescribed session' : what },
  ];
  const to = typeof p.actionPayload?.newDate === 'string' ? p.actionPayload.newDate : null;
  if (to != null && to !== p.workoutDateISO) {
    rows.push({ dateISO: to, what: 'Where it would move to' });
  }
  return rows;
}

/**
 * An array of strings, or null when the key was not an array at all.
 *
 * An EMPTY array comes back empty. My first cut ended
 * `out.length > 0 ? out : null`, which COERCION-1 flagged and which was the
 * exact defect this file's own doc comments describe: "the engine recorded no
 * policy assumptions" and "nobody recorded whether there were any" arriving as
 * one value, on the surface built to tell them apart.
 */
function stringArrayOrNull(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return v.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
}

function firstString(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return null;
}

/**
 * A scalar, in the runner's characters. NULL when there is no such rendering.
 *
 * The null branch is the whole point: this used to end `JSON.stringify(v)`,
 * which meant an object or an array in a blob nobody had taught this file
 * reached the phone as a JSON literal. The caller withholds and logs instead.
 */
function renderValue(v: unknown): string | null {
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(1);
  if (typeof v === 'string') return v;
  return null;
}

/** `lthr_age_days` to `Lthr age days`. Only reached by keys nobody labelled. */
function humanise(key: string): string {
  const words = key.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function numberOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function dayName(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? 'that day' : DAYS[d.getUTCDay()];
}
