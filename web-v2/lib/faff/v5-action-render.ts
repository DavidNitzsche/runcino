/**
 * lib/faff/v5-action-render.ts · EVERY ACTION KIND, RENDERABLE.
 *
 * ── THE FAILURE THIS CLOSES ────────────────────────────────────────────────
 *
 * `v5-proposals.ts:directionOf` returns null for a kind it has not been taught,
 * and `toWire` then withholds the card. That is the RIGHT behaviour for a
 * malformed row and the WRONG behaviour for a lever the engine has just learnt
 * to pull: the brain raises a pace change, the phone shows nothing, and
 * everything reports success. This repo's signature failure is a mechanism that
 * is wired, tested and inert, and a silent withhold is how a new lever would
 * join that list.
 *
 * So the map from `BrainAction` to the runner's card is TOTAL. Not "returns
 * null when unknown" — there is no unknown. A new kind added to the union
 * fails to compile here until someone decides what the runner reads.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ─────────────────────────────────────
 *
 * That the headline is GOOD. It checks that every kind has one, that it is not
 * empty, and that it says which way the change points. Whether the sentence is
 * in the coach's voice is `check-coach-voice.sh`'s question, and whether it is
 * true is the adjudicator's.
 */

import type { ActionShape, BrainAction } from '@/lib/brain/proposal/action';
import type { V5ProposalDirection } from '@/lib/faff/v5-today';
import { fmtMi } from '@/lib/format/run';

/**
 * Which way the runner is being asked to move.
 *
 * Derived from the action's OWN `direction` field wherever the kind does not
 * fix the answer, because that field is the thing Rule 21's asymmetry audit
 * counts. A renderer that re-decided direction from the kind would be a second
 * opinion about the one quantity the engine is measured on (Rule 16).
 */
export function phoneDirectionOf(action: ActionShape): V5ProposalDirection {
  switch (action.kind) {
    case 'SAFETY_STOP': return 'stop';
    /* A field test never asks for less. It replaces a prescribed quality
     * session with a maximal effort whose entire purpose is to earn a faster
     * prescription — an advance in both PACE and SPECIFICITY. It is not a load
     * reduction under any reading, and that is the property that decides the
     * axis, not the fact that the session's own direction field is neutral. */
    case 'FIELD_TEST': return 'push';
    case 'RESCHEDULE': return 'move';
    case 'HOLD':
    case 'REFUSAL': return 'hold';
    /* Prescribed easing is not a pull-back. Being told to taper and being told
     * you have overreached are different things to read on a Tuesday, and the
     * card's colour is the whole difference. */
    case 'TAPER_CHANGE':
    case 'RECOVERY_CHANGE': return 'recovery';
    case 'WORKOUT_TYPE_CHANGE':
      return action.to === 'rest' || action.to === 'recovery' ? 'recovery' : 'pull_back';
    default:
      switch (action.direction) {
        case 'MORE': return 'push';
        case 'LESS': return 'pull_back';
        case 'STOP': return 'stop';
        case 'NEUTRAL': return 'hold';
      }
  }
}

/** Six to ten words. One per kind, total over the union. */
export function actionHeadline(action: BrainAction, dayName: string): string {
  switch (action.kind) {
    case 'PACE_CHANGE':
      return `${leverWord(action.lever)} pace moves to ${paceStr(action.to.value)}`;
    case 'DISTANCE_CHANGE': {
      /* A cut reads as a proportion and a build reads as a destination, which
       * is how a runner actually thinks about the two: "take 17% off Thursday"
       * against "Thursday goes to 9 mi". The denominator is the session's own
       * prescribed distance, so a row with no recorded distance degrades to the
       * plain form rather than inventing one. */
      if (typeof action.ofBefore === 'number' && action.ofBefore > 0) {
        return `Take ${Math.round(action.ofBefore * 100)}% off ${dayName}`;
      }
      if (action.to === null) {
        // Decided, not yet sized. "Add to Thursday" is the honest sentence;
        // naming a distance nobody chose would be worse than naming none.
        return action.direction === 'LESS' ? `Ease ${dayName}` : `Add to ${dayName}`;
      }
      return `${dayName} goes to ${fmtMi(action.to.value)}`;
    }
    case 'DURATION_CHANGE':
      return `${dayName} goes to ${Math.round(action.to.value)} minutes`;
    case 'REPETITION_CHANGE':
      return `${dayName} goes to ${Math.round(action.to.value)} reps`;
    case 'RECOVERY_INTERVAL_CHANGE':
      return `Recovery between reps goes to ${Math.round(action.to.value)} minutes`;
    case 'QUALITY_DOSE_CHANGE':
      return `${leverWord(action.lever)} work goes to ${fmtMi(action.to.value)}`;
    case 'LONG_RUN_STRUCTURE_CHANGE':
      return `${dayName}'s long run changes shape`;
    case 'WORKOUT_TYPE_CHANGE':
      return `${dayName} becomes ${article(action.to)} ${typeWord(action.to)}`;
    case 'ADD_WORKOUT':
      return `Add ${fmtMi(action.distanceMi)} on ${dayName}`;
    case 'REMOVE_WORKOUT':
      return `Drop ${dayName}`;
    case 'FREQUENCY_CHANGE':
      return `Training days go to ${Math.round(action.to.value)} a week`;
    case 'RESCHEDULE':
      return `Move ${dayName} to ${dayNameOf(action.toDateISO)}`;
    case 'COORDINATED':
      return action.describe;
    case 'RACE_TARGET_CHANGE':
      return `Race target moves to ${paceStr(action.toSecPerMi)}`;
    case 'TAPER_CHANGE':
    case 'RECOVERY_CHANGE':
      return action.describe;
    case 'CONDITIONAL':
      return `${dayName} depends on how this week goes`;
    case 'FIELD_TEST':
      return `Make ${dayName} a field test`;
    case 'HOLD':
      return 'Holding the plan as it is';
    case 'REFUSAL':
      return 'Not changing this yet';
    case 'SAFETY_STOP':
      return 'Stop running and let this settle';
    default: {
      const never: never = action;
      throw new Error(`no headline for ${JSON.stringify(never)}`);
    }
  }
}

function leverWord(l: 'THRESHOLD' | 'MARATHON' | 'INTERVAL' | 'EASY'): string {
  return l === 'THRESHOLD' ? 'Threshold'
    : l === 'MARATHON' ? 'Marathon'
      : l === 'INTERVAL' ? 'Interval' : 'Easy';
}

function typeWord(t: string): string {
  return t === 'rest' ? 'rest day' : t === 'recovery' ? 'recovery run'
    : t === 'easy' ? 'easy run' : t;
}

function article(t: string): string {
  return /^[aeiou]/i.test(typeWord(t)) ? 'an' : 'a';
}

/** Seconds per mile as m:ss. The card never prints a raw second count. */
function paceStr(secPerMi: number): string {
  const s = Math.max(0, Math.round(secPerMi));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** A weekday name, or a neutral phrase when the date will not parse. */
export function dayNameOf(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? 'that day' : DAYS[d.getUTCDay()];
}
