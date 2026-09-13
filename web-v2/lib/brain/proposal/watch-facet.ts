/**
 * lib/brain/proposal/watch-facet.ts · WHAT THE WRIST HAS TO DO ABOUT IT.
 *
 * ── THE FAILURE THIS CLOSES ────────────────────────────────────────────────
 *
 * The watch pulls today's session from `/api/watch/today` and holds it. When a
 * plan row changes under it, nothing tells it. The accept route busts the
 * BRIEFING cache on every applied proposal — `bustBriefingCacheForEvent(userId,
 * 'plan_swap')` — which is the phone's cache and says nothing about the wrist,
 * and it does so uniformly: a rescheduled Thursday and a re-priced Tuesday get
 * the same treatment as a HOLD that changed nothing.
 *
 * That uniformity is the defect. Rule 16: a surface about an entity resolves
 * THAT entity. The watch carries ONE session — today's — so the only question
 * that matters to it is whether TODAY'S session changed, and an action that
 * moves a row three weeks out has no business invalidating a workout the runner
 * may be standing on the start line of.
 *
 * So this answers per kind, and the accept path asks.
 *
 * ── SAFETY IS NOT A CACHE QUESTION ─────────────────────────────────────────
 *
 * `SAFETY_STOP` maps to `WITHHOLD_WORKOUT`, and that is not a stronger refresh.
 * `lib/watch/safety-stop.ts` already owns the sentence the wrist reads when
 * safety withholds, and the canonical owner of the VERDICT is
 * `lib/safety/safety-verdict.ts`. This file names the EFFECT and re-decides
 * neither: a caller acting on `WITHHOLD_WORKOUT` must still ask the safety
 * owner, because a stop lifts when the signal clears and not when a proposal
 * ages out.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ─────────────────────────────────────
 *
 * · WHETHER THE WATCH ACTUALLY RELOADS. Nothing here reaches watchOS. It
 *   classifies; the caller busts the cache. A watch that ignores an invalidated
 *   cache is invisible from this process, and `check-watch.sh` is where that
 *   question lives.
 * · WHETHER THE CHANGE LANDS ON TODAY. It cannot: it holds no clock and no
 *   dates beyond the action's own. `RELOAD_IF_TODAY` says the caller must
 *   compare, and a caller that forgets simply over-invalidates, which is the
 *   safe direction.
 * · A KIND THE WATCH RENDERS DIFFERENTLY. Three effects is the whole
 *   vocabulary, deliberately: `WatchTodayResponse` has exactly two branches
 *   (a workout, or a message) and inventing a third effect here would imply a
 *   wire shape the watch does not have.
 */

import type { ActionKind, BrainAction } from './action';

export type WatchEffect =
  /** Today's session may have changed. Invalidate the wrist's copy if the
   *  action touches today; a caller with no date comparison to hand should
   *  invalidate rather than skip, because a stale workout is worse than a
   *  redundant fetch. */
  | { readonly kind: 'RELOAD_IF_TODAY'; readonly because: string }
  /** Nothing the wrist carries moved. Leave it alone. */
  | { readonly kind: 'NO_WATCH_EFFECT'; readonly because: string }
  /** Training is withheld. The wrist must not ship a runnable session, and the
   *  authority for that is `lib/safety/**`, never this file. */
  | { readonly kind: 'WITHHOLD_WORKOUT'; readonly because: string };

export type WatchEffectKind = WatchEffect['kind'];

/**
 * What the wrist has to do when this action is accepted.
 *
 * TOTAL over the union, so a new lever cannot reach the plan while the watch
 * silently keeps yesterday's prescription — which is exactly the shape of
 * "wired, tested and inert" applied to the one surface the runner is holding
 * while he runs.
 */
export function watchBehaviorOf(action: BrainAction): WatchEffect {
  switch (action.kind) {
    /* Everything the wrist actually executes: the pace it holds you to, how
     * far, how long, how many reps, how much jog between them, and what type
     * of session it announces. */
    case 'PACE_CHANGE':
      return reload('the wrist holds the pace target it was handed');
    case 'DISTANCE_CHANGE':
      return reload('the wrist counts down the prescribed distance');
    case 'DURATION_CHANGE':
      return reload('the wrist counts down the prescribed duration');
    /* DURATIONOFFER-1 · never written, so the wrist is never stale — same
     * posture as HOLD, and for the same reason. */
    case 'DURATION_PROGRESS_OFFER':
      return none('nothing was written, so the wrist is already correct');
    case 'REPETITION_CHANGE':
      return reload('the rep count is the session structure the wrist steps through');
    case 'RECOVERY_INTERVAL_CHANGE':
      return reload('the recovery length is a phase the wrist times');
    case 'QUALITY_DOSE_CHANGE':
      return reload('the dose is the work phase the wrist times');
    case 'LONG_RUN_STRUCTURE_CHANGE':
      return reload('a structured long run is a phase sequence the wrist steps through');
    case 'WORKOUT_TYPE_CHANGE':
      return reload("the session type decides the whole board the wrist draws, and whether there is one");
    case 'FIELD_TEST':
      return reload('a field test replaces the session the wrist was given');
    case 'RACE_TARGET_CHANGE':
      return reload('a race target reprices the session the wrist holds');

    /* A move changes which day carries the session, so today either gains one
     * or loses one. Both need the wrist to look again. */
    case 'RESCHEDULE':
      return reload('the session either arrives on today or leaves it');
    case 'ADD_WORKOUT':
      return reload('a day that had no session may now have one');
    case 'REMOVE_WORKOUT':
      return reload('a day that had a session may now have none');
    case 'FREQUENCY_CHANGE':
      return reload('the week gains or loses running days, and today may be one of them');

    /* A coordinated change is exactly as loud as its loudest part, and a
     * repricing with no enumerated parts still moves every future pace — so an
     * empty part list reloads rather than reading as "nothing changed". */
    case 'COORDINATED': {
      const anyReload = action.parts.length === 0
        || action.parts.some((p) => watchBehaviorOf(p).kind === 'RELOAD_IF_TODAY');
      return anyReload
        ? reload('a coordinated change moves the sessions the wrist reads')
        : none('no part of this change touches anything the wrist carries');
    }

    /* Both write a sentence onto the plan and change no prescribed quantity.
     * The wrist does not render plan notes; the phone does. */
    case 'TAPER_CHANGE':
    case 'RECOVERY_CHANGE':
      return none('this writes the reason onto the plan and moves no prescribed quantity');

    case 'CONDITIONAL':
      return none('nothing is prescribed until the assessment date, so the wrist has nothing new');

    case 'HOLD':
    case 'REFUSAL':
      return none('the plan did not change, so the wrist is already correct');

    case 'SAFETY_STOP':
      return {
        kind: 'WITHHOLD_WORKOUT',
        because: 'training is withheld; the wrist must take the message branch rather than a session',
      };

    default: {
      const never: never = action;
      throw new Error(`no watch behaviour for ${JSON.stringify(never)}`);
    }
  }
}

/** Does the wrist care about this kind at all? Used by the completeness gate. */
export function watchIsApplicable(kind: ActionKind): boolean {
  return kind !== 'HOLD' && kind !== 'REFUSAL' && kind !== 'CONDITIONAL'
    && kind !== 'TAPER_CHANGE' && kind !== 'RECOVERY_CHANGE'
    && kind !== 'DURATION_PROGRESS_OFFER';
}

const reload = (because: string): WatchEffect => ({ kind: 'RELOAD_IF_TODAY', because });
const none = (because: string): WatchEffect => ({ kind: 'NO_WATCH_EFFECT', because });
