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
  V5ProposalStanding,
  V5ProposalWire,
  V5ProposalWorkoutWire,
} from '@/lib/faff/v5-today';
import { fmtMi } from '@/lib/format/run';
import type { PendingProposal } from '@/lib/plan/workout-proposals';
import { actionFromPending, actionShapeOfEngineKind } from '@/lib/brain/proposal/staleness';
import { phoneDirectionOf, actionHeadline } from '@/lib/faff/v5-action-render';

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

/** Engine key to a short English label. Anything unlisted is title-cased. */
const EVIDENCE_LABELS: Record<string, string> = {
  planned_type: 'Session type',
  planned_distance_mi: 'Session distance',
  lthr_stale: 'Threshold HR anchor stale',
  lthr_age_days: 'Threshold HR anchor age, days',
  days_since_test: 'Days since last test',
  weekly_mi: 'Week volume, miles',
  long_mi: 'Longest run, miles',
};

/**
 * THE DEPTH BEHIND THE CARD.
 *
 * ── WHAT THIS CAN AND CANNOT SAY TODAY, HONESTLY ───────────────────────────
 *
 * `plan_workout_proposals.evidence` is whatever the trigger that produced the
 * action put there. For `field_test_due` that is a genuinely useful record
 * (`planned_date`, `planned_type`, `planned_distance_mi`, `lthr_stale`,
 * `lthr_age_days`). For the options the engine weighed, the earning gate and
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

  for (const [key, raw] of Object.entries(ev)) {
    if (EVIDENCE_KEYS_NOT_FOR_THE_RUNNER.has(key)) continue;
    if (key === 'options' || key === 'earningGate' || key === 'policyAssumptions'
      || key === 'reassessOn' || key === 'reassessOnISO' || key === 'missingEvidence') continue;
    const label = EVIDENCE_LABELS[key] ?? humanise(key);
    // Rule 11 at the row level: a key present with a null value is the engine
    // saying it looked and found nothing, which is a different line from the
    // key being absent entirely. Absent keys cannot appear here at all.
    if (raw === null || raw === undefined) { missing.push(label); continue; }
    // A distance carries its unit, from the one formatter that owns it. Found
    // by rendering: the sheet read "Session distance: 2.5", which is a number
    // the runner has to guess the unit of.
    if (key === 'planned_distance_mi' && typeof raw === 'number' && Number.isFinite(raw)) {
      used.push(`${label}: ${fmtMi(raw)}`);
      continue;
    }
    used.push(`${label}: ${renderValue(raw)}`);
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

export function toWire(p: PendingProposal, todayISO: string): V5ProposalWire | null {
  const direction = directionOf(p.actionKind, p.actionPayload);
  if (direction == null) return null;
  const why = (p.reason ?? '').trim();
  // A card with no reason is the thing the objective forbids: a change the
  // runner is asked to accept with nothing said about why. Withheld, not
  // guessed at.
  if (why === '') return null;
  return {
    id: String(p.id),
    dateISO: p.workoutDateISO,
    direction,
    standing: standingOf(p, todayISO),
    headline: headlineFor(p),
    why,
    detail: detailFor(p),
  };
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

function renderValue(v: unknown): string {
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(1);
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
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
