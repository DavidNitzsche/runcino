/**
 * lib/brain/proposal/validate.ts · IS THIS ACTION WELL FORMED?
 *
 * ── WHAT THIS IS FOR ───────────────────────────────────────────────────────
 *
 * `action.ts` says what a coaching decision MAY ask for. `execute.ts` says what
 * each ask DOES. Neither asks whether the ask is coherent, and the gap is not
 * theoretical: `plannedWrites` will happily turn a `PACE_CHANGE` carrying
 * `NaN` into `SET pace_target_s_per_mi = NaN`, and a `RESCHEDULE` to the string
 * `"soon"` into `SET date_iso = 'soon'`. Both are well-typed. Both reach the
 * database.
 *
 * So this runs BEFORE anything is planned or written, and it refuses in the
 * shape Rule 11 asks for: a list of stated refusals, never a silent clamp. A
 * validator that quietly repairs a bad number is a second author of that
 * number, and the runner never learns his engine produced one.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ─────────────────────────────────────
 *
 * · WHETHER THE NUMBER IS GOOD COACHING. The envelopes below are CORRUPTION
 *   bands, not doctrine bands. 4:00/mi passes here and would be absurd for this
 *   runner; sizing belongs to the adjudicator and to `validateComposedPlan`,
 *   which runs inside the mutation boundary and sees the whole week. If you
 *   find yourself tightening a bound here to stop a bad prescription, the
 *   prescription is being fixed in the wrong place.
 * · WHETHER THE ACTION IS STALE. `staleAgainst` owns that and needs the live
 *   plan; this is pure and holds no clock and no database.
 * · WHETHER THE RUNNER SHOULD SEE IT. A perfectly valid action can still be a
 *   card nobody should be shown.
 * · A CALLER THAT NEVER ASKS. It is called from `prepareAction`, so every path
 *   through the accept route runs it — but a future writer that skips
 *   `prepareAction` skips this too, and only `_action_completeness.test.ts`'s
 *   executor scan would notice.
 */

import type { BrainAction, Quantity } from './action';
import { ACTION_SCHEMA_VERSION, NON_MUTATING_KINDS } from './action';

export type ActionValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly refusals: readonly string[] };

/* ══════════════════════════════════════════════════════════════════════════
 * THE CORRUPTION ENVELOPES
 *
 * Every bound here answers "is this a number at all", never "is this the right
 * number". They are wide on purpose: a validator whose bands are tight enough
 * to be interesting is a validator that has started prescribing.
 * ═══════════════════════════════════════════════════════════════════════ */

/** 4:00/mi to 20:00/mi. Outside this a pace is a unit error, not a decision. */
export const PACE_ENVELOPE_SEC_PER_MI = { min: 240, max: 1200 } as const;
/** A quarter mile to an ultra leg. */
export const DISTANCE_ENVELOPE_MI = { min: 0.25, max: 30 } as const;
/** Five minutes to five hours. */
export const DURATION_ENVELOPE_MIN = { min: 5, max: 300 } as const;
/** One continuous effort to thirty reps. */
export const REPS_ENVELOPE = { min: 1, max: 30 } as const;
/** Zero (continuous) to a quarter hour of jog between reps. */
export const RECOVERY_ENVELOPE_MIN = { min: 0, max: 15 } as const;
/** One running day a week to two a day. */
export const FREQUENCY_ENVELOPE_PER_WEEK = { min: 1, max: 14 } as const;
/**
 * The longest sentence a card may carry.
 *
 * Rule 17: the runner reads a sentence once, and a card is six to ten words
 * plus one line of why. A `describe` that runs to a paragraph is an engine
 * dumping its reasoning onto a surface that has no room for it.
 */
export const PROSE_MAX_CHARS = 200;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Is this action coherent enough to plan writes from?
 *
 * TOTAL over the union — the `never` check at the bottom means a new kind fails
 * the build here rather than passing validation by falling through, which is
 * the exact shape that let the old three-field payload accept kinds it could
 * not apply.
 */
export function validateAction(action: BrainAction): ActionValidation {
  const bad: string[] = [];

  /* ── what every action owes, whatever its kind ────────────────────────── */
  if (action.schemaVersion !== ACTION_SCHEMA_VERSION) {
    bad.push(
      `schema version ${String(action.schemaVersion)} is not ${ACTION_SCHEMA_VERSION}; `
      + 'a payload written under a different shape must be upgraded, not read as if it were current',
    );
  }
  if (!Array.isArray(action.before)) {
    bad.push('before is not a list, so there is nothing to compare the live plan against');
  } else {
    for (const b of action.before) {
      if (typeof b.planWorkoutId !== 'string' || b.planWorkoutId.length === 0) {
        bad.push('a before row names no workout, so staleness cannot be checked against it');
      }
      if (b.dateISO !== undefined && !ISO_DATE.test(b.dateISO)) {
        bad.push(`a before row carries "${b.dateISO}", which is not a date`);
      }
    }
  }

  /* Direction is what Rule 21's asymmetry audit counts, so a kind whose
   * direction is fixed by its meaning may not carry a different one. A
   * SAFETY_STOP labelled MORE would be counted as a push. */
  if (action.kind === 'SAFETY_STOP' && action.direction !== 'STOP') {
    bad.push('a safety stop must carry direction STOP, or the asymmetry census counts it as training');
  }
  if ((action.kind === 'HOLD' || action.kind === 'REFUSAL') && action.direction !== 'NEUTRAL') {
    bad.push(`a ${action.kind} changes nothing and must carry direction NEUTRAL`);
  }
  if (action.direction === 'STOP' && action.kind !== 'SAFETY_STOP') {
    bad.push('direction STOP belongs to SAFETY_STOP alone; every other kind is a change, not a halt');
  }

  /* A mutating kind that names no row cannot be applied. FREQUENCY_CHANGE is
   * the deliberate exception: `plannedWrites` refuses it out loud rather than
   * writing nothing quietly, and that refusal is the correct outcome. */
  const mutating = !NON_MUTATING_KINDS.has(action.kind) && action.kind !== 'CONDITIONAL';
  if (mutating && action.kind !== 'ADD_WORKOUT' && action.kind !== 'FREQUENCY_CHANGE'
    && Array.isArray(action.before) && action.before.length === 0) {
    bad.push(`a ${action.kind} names no rows, so accepting it would change nothing while reporting success`);
  }

  /* ── per kind ─────────────────────────────────────────────────────────── */
  switch (action.kind) {
    case 'PACE_CHANGE':
      bad.push(...quantity(action.to, 'sec_per_mi', PACE_ENVELOPE_SEC_PER_MI, 'the new pace'));
      break;

    case 'DISTANCE_CHANGE':
      if (action.to !== null) {
        bad.push(...quantity(action.to, 'mi', DISTANCE_ENVELOPE_MI, 'the new distance'));
      }
      if (action.ofBefore !== undefined) {
        if (!Number.isFinite(action.ofBefore) || action.ofBefore <= 0 || action.ofBefore >= 1) {
          bad.push(
            `ofBefore is ${String(action.ofBefore)}; a proportion of the session must sit strictly `
            + 'between 0 and 1, and a card that renders it as a percentage would print nonsense',
          );
        }
        /* Rule 16 on one card: a proportion that says LESS beside a direction
         * that says MORE gives the runner two answers to "which way". */
        if (action.direction === 'MORE') {
          bad.push('ofBefore states a share taken OFF the session, which cannot be a push');
        }
      }
      break;

    case 'DURATION_CHANGE':
    case 'DURATION_PROGRESS_OFFER':
      bad.push(...quantity(action.to, 'min', DURATION_ENVELOPE_MIN, 'the new duration'));
      break;

    case 'REPETITION_CHANGE':
      bad.push(...quantity(action.to, 'reps', REPS_ENVELOPE, 'the new rep count'));
      break;

    case 'RECOVERY_INTERVAL_CHANGE':
      bad.push(...quantity(action.to, 'min', RECOVERY_ENVELOPE_MIN, 'the new recovery'));
      break;

    case 'QUALITY_DOSE_CHANGE':
      /* A dose is expressed in MILES at pace or in MINUTES at pace, and both
       * are real — `Research/04` states cruise intervals in miles and interval
       * sessions in minutes. So the unit is read, not assumed, which is the
       * whole reason `Quantity` carries one. */
      if (action.to.unit === 'mi') {
        bad.push(...quantity(action.to, 'mi', DISTANCE_ENVELOPE_MI, 'the new dose'));
      } else if (action.to.unit === 'min') {
        bad.push(...quantity(action.to, 'min', DURATION_ENVELOPE_MIN, 'the new dose'));
      } else {
        bad.push(`a quality dose is stated in mi or min, not ${action.to.unit}`);
      }
      break;

    case 'LONG_RUN_STRUCTURE_CHANGE':
      bad.push(...prose(action.to, 'the new long-run shape'));
      bad.push(...prose(action.describe, 'the description of the new shape'));
      break;

    case 'WORKOUT_TYPE_CHANGE':
      bad.push(...prose(action.to, 'the new session type'));
      break;

    case 'ADD_WORKOUT':
      if (!ISO_DATE.test(action.dateISO)) bad.push(`"${action.dateISO}" is not a date to add a session on`);
      bad.push(...prose(action.type, 'the type of the added session'));
      bad.push(...quantity({ unit: 'mi', value: action.distanceMi }, 'mi', DISTANCE_ENVELOPE_MI, 'the added distance'));
      if (action.direction !== 'MORE') {
        bad.push('adding a session is more work; a direction that says otherwise miscounts the census');
      }
      break;

    case 'REMOVE_WORKOUT':
      if (action.direction === 'MORE') bad.push('removing a session cannot be a push');
      break;

    case 'FREQUENCY_CHANGE':
      bad.push(...quantity(action.to, 'count', FREQUENCY_ENVELOPE_PER_WEEK, 'the new weekly frequency'));
      break;

    case 'RESCHEDULE':
      if (!ISO_DATE.test(action.toDateISO)) {
        bad.push(`"${action.toDateISO}" is not a date to move the session to`);
      }
      if (action.swapWithId !== null
        && (typeof action.swapWithId !== 'string' || action.swapWithId.length === 0)) {
        bad.push('the session to swap with is named as an empty id, which is neither a swap nor a move');
      }
      /* A move to the day it already sits on is not a move. It would consume
       * the card, write the same date back and report success. */
      if (Array.isArray(action.before)
        && action.before.some((b) => b.dateISO !== undefined && b.dateISO === action.toDateISO)) {
        bad.push('the session is already on that day, so accepting this would change nothing');
      }
      break;

    case 'COORDINATED': {
      bad.push(...prose(action.describe, 'the description of the coordinated change'));
      for (const part of action.parts) {
        /* One level. A tree of coordinated actions is a decision nobody can
         * read on a card, and `plannedWrites` would flatten it into a write set
         * whose shape no one authored. */
        if (part.kind === 'COORDINATED') {
          bad.push('a coordinated action may not contain another; one decision, one level');
          continue;
        }
        const inner = validateAction(part);
        if (!inner.ok) bad.push(...inner.refusals.map((r) => `part ${part.kind}: ${r}`));
      }
      break;
    }

    case 'RACE_TARGET_CHANGE':
      bad.push(...prose(action.raceSlug, 'the race this target belongs to'));
      bad.push(...quantity(
        { unit: 'sec_per_mi', value: action.toSecPerMi },
        'sec_per_mi', PACE_ENVELOPE_SEC_PER_MI, 'the new race target',
      ));
      break;

    case 'TAPER_CHANGE':
    case 'RECOVERY_CHANGE':
      bad.push(...prose(action.describe, 'the description of the change'));
      break;

    case 'CONDITIONAL':
      if (!ISO_DATE.test(action.assessOnISO)) {
        bad.push(`"${action.assessOnISO}" is not a date to reassess on`);
      }
      if (action.defaultTo.unit !== action.earnedTo.unit) {
        bad.push(
          `the default is in ${action.defaultTo.unit} and the earned value in ${action.earnedTo.unit}; `
          + 'a runner cannot be shown two branches measured in different things',
        );
      } else if (action.defaultTo.value === action.earnedTo.value) {
        /* Rule 11 in miniature: a conditional whose branches agree is not a
         * condition, it is a prescription wearing one, and the card would show
         * the runner something to earn that he already has. */
        bad.push('the default and the earned value are the same, so nothing is conditional');
      }
      break;

    case 'FIELD_TEST':
      bad.push(...prose(action.describe, 'the description of the field test'));
      break;

    case 'HOLD':
    case 'REFUSAL':
      bad.push(...prose(action.because, `the reason for the ${action.kind.toLowerCase()}`));
      break;

    case 'SAFETY_STOP':
      bad.push(...prose(action.because, 'the reason for the stop'));
      if (action.until !== null && !ISO_DATE.test(action.until)) {
        bad.push(`"${action.until}" is not a date to stop until`);
      }
      break;

    default: {
      const never: never = action;
      throw new Error(`no validation for ${JSON.stringify(never)}`);
    }
  }

  return bad.length === 0 ? { ok: true } : { ok: false, refusals: bad };
}

/* ── the two shared checks ─────────────────────────────────────────────── */

function quantity(
  q: Quantity,
  unit: Quantity['unit'],
  band: { readonly min: number; readonly max: number },
  what: string,
): string[] {
  if (q == null || typeof q !== 'object') return [`${what} is missing`];
  if (q.unit !== unit) return [`${what} is stated in ${String(q.unit)}, and this kind is measured in ${unit}`];
  if (typeof q.value !== 'number' || !Number.isFinite(q.value)) {
    return [`${what} is ${String(q.value)}, which is not a number`];
  }
  if (q.value < band.min || q.value > band.max) {
    return [`${what} is ${q.value} ${unit}, outside the ${band.min}-${band.max} ${unit} band a real value sits in`];
  }
  return [];
}

/**
 * A sentence the runner may read.
 *
 * The em-dash check is here rather than only in `check-coach-voice.sh` because
 * that gate scans FILES, and these strings are composed at run time from
 * evidence — exactly the shape that put 1,804 em dashes into `plan_workouts`
 * while the gate stayed green (Rule 20's corollary).
 */
function prose(s: string, what: string): string[] {
  if (typeof s !== 'string' || s.trim().length === 0) return [`${what} is empty`];
  if (s.length > PROSE_MAX_CHARS) {
    return [`${what} runs to ${s.length} characters; a card carries ${PROSE_MAX_CHARS} at most`];
  }
  const out: string[] = [];
  if (s.includes('—') || s.includes('–')) out.push(`${what} contains a dash the coach voice does not use`);
  if (s.includes('!')) out.push(`${what} contains an exclamation mark`);
  if (/Research\/\d/.test(s)) out.push(`${what} leaks a research citation at the runner`);
  return out;
}
