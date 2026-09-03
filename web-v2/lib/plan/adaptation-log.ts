/**
 * lib/plan/adaptation-log.ts · A LOG THAT RECORDS WHAT ADAPTED, NOT THAT
 * SOMETHING DID.
 *
 * CLAUDE.md Rule 21, verbatim:
 *
 *     "`training_plans.adaptation_log` stores `{"n": 1, "ts": "..."}` — a
 *      counter and a timestamp, and no record of WHAT adapted. So the engine's
 *      own log cannot answer 'has this ever pushed up', and establishing the
 *      zero above required querying `coach_intents` sideways. A log that records
 *      that something happened but not what is not a log. Every adaptation
 *      writes what it did, in which direction, and on what evidence — otherwise
 *      the next person cannot tell an engine that never pushes from a runner who
 *      never earned it, which is exactly the ambiguity that let this survive."
 *
 * That ambiguity is the whole point. `{"n": 3}` is produced identically by an
 * engine that raised three weeks and by one that cut three sessions, and the
 * difference between those two facts is the difference between a coach and a
 * safety system wearing a coach's clothes.
 *
 * ── WHAT CHANGES, AND WHAT DELIBERATELY DOES NOT ───────────────────────────
 *
 * The column, the writer and the array shape are untouched. `ts` and `n` stay
 * exactly where they were and mean exactly what they meant, because
 * `docs/OVERNIGHT-REPORT.md` records consumers deriving "last changed" as
 * `max(adaptation_log.ts)` and a rename would silently break a reader nobody
 * has grepped for. This is PURELY ADDITIVE: three new keys on the same object.
 *
 * Rule 6 applies and is satisfied by construction — `adaptation_log` has one
 * writer (`applyAdaptations`) and the write is an append, `COALESCE(col,'[]')
 * || jsonb_build_object(...)`, never a full-column replace. There is no second
 * writer whose fields an append could erase. If a second one ever appears, that
 * is the moment Rule 6's guard becomes necessary.
 *
 * ── THE ONE QUESTION IT HAS TO ANSWER IN ONE QUERY ─────────────────────────
 *
 *     SELECT count(*) FROM training_plans, jsonb_array_elements(adaptation_log) e,
 *            jsonb_array_elements(e->'did') d
 *      WHERE d->>'direction' = 'UP';
 *
 * If that returns zero across a runner's whole history, the engine has never
 * pushed him. Rule 21's measurement, as one query against the engine's own log,
 * instead of a sideways reconstruction from `coach_intents`.
 *
 * ── DIRECTION IS DERIVED FROM THE ACTION, NEVER PASSED IN ──────────────────
 *
 * A caller that could label its own change would eventually label a downgrade
 * "adjustment", and the log would stop being evidence. `directionOfAction` is a
 * pure total function over the action union, so every kind has an answer and a
 * new kind fails to compile until it is given one.
 *
 * NEUTRAL is a real third answer, not a shrug. Rule 11: a reschedule genuinely
 * moves no load, and recording it as UP or DOWN would put noise into the exact
 * count this exists to make trustworthy. Two kinds resolve their direction from
 * their own payload rather than from their name — `reshape` reads the
 * progression gate's verdict, and `recompute_paces` compares the VDOT it is
 * moving from against the one it is moving to — because for those the name says
 * nothing about which way the plan moved.
 *
 * ── RULE 22 · WHAT A GATE OVER THIS FILE CANNOT FAIL ON ────────────────────
 *
 * · **An action whose kind is honest and whose effect is not.** A `shave` with
 *   a negative fraction would be logged DOWN and would raise load. Direction is
 *   read from the action's declared intent, not from the rows afterwards.
 * · **An adaptation that never reaches this file.** Three other paths can move
 *   a workout — `/api/today/reschedule`, `move_day` and `PATCH
 *   /api/plan/workout` — and none of them writes here. The log is complete for
 *   the CRON, and the program document already lists that consolidation as
 *   open. A count of zero UP from this log is evidence about the nightly pass,
 *   not about the app.
 * · **Whether the adaptation was RIGHT.** It records direction and evidence. It
 *   has no opinion on whether the direction was the correct coaching answer.
 * · **A write that does not happen.** `applyAdaptations` appends only when
 *   `touched > 0`. A pass that decided to change nothing writes nothing here,
 *   by design — `last_adapted_at` is the "cron evaluated" stamp and this is the
 *   "something changed" record. So this log cannot distinguish a night the
 *   engine considered pushing and declined from a night it never looked.
 *   That is a real gap, it is the Rule 11 shape, and closing it means logging
 *   refusals too — which the canonical engine's `CanonicalDecisionRecord`
 *   already does and this legacy path does not.
 */
import type { AdaptationAction } from './adapt';

/** Which way the plan moved. Three states, because a reschedule moves neither. */
export type AdaptationDirection = 'UP' | 'DOWN' | 'NEUTRAL';

/** One thing that actually changed, in one nightly pass. */
export interface AdaptationLogItem {
  /** The action kind, unchanged, so a reader can join back to the code. */
  readonly kind: AdaptationAction['kind'];
  readonly direction: AdaptationDirection;
  /** Which axis moved: pace, volume, the long run, the calendar, or nothing. */
  readonly lever: 'PACE' | 'VOLUME' | 'SESSION_SHAPE' | 'SCHEDULE' | 'RECORD_ONLY';
  /** Plain language, one clause. What a person reading the log needs. */
  readonly what: string;
  /** The rows it touched, so a change can be traced to a day. */
  readonly workoutIds?: readonly string[];
  /**
   * What the decision rested on. Rule 21 asks for "on what evidence", and the
   * trigger kind is the honest answer available at this layer: the detector
   * that produced the action already names the evidence class.
   */
  readonly evidence: string;
}

/** One nightly pass. `ts` and `n` are unchanged; `did` is the new half. */
export interface AdaptationLogEntry {
  readonly ts: string;
  readonly n: number;
  readonly did: readonly AdaptationLogItem[];
}

/**
 * Which way one action moves the plan.
 *
 * Total over the action union by construction: the switch has no `default`, so
 * a new kind is a compile error rather than a silent NEUTRAL. A new kind
 * defaulting to NEUTRAL is exactly how a log stops counting the thing it exists
 * to count.
 */
export function directionOfAction(a: AdaptationAction): AdaptationDirection {
  switch (a.kind) {
    // More work than the plan asked for. The upward path, such as it is.
    case 'mark_upgrade':
      return 'UP';

    // Less work, or an easier session in place of a harder one.
    case 'downgrade':
    case 'shave':
      return 'DOWN';

    // Reads its own verdict rather than its name. The progression gate returns
    // ACCELERATE / TAKE / HOLD / BACK_OFF, and only two of those move anything.
    case 'reshape': {
      const action = a.reshape?.resolution.action;
      if (action === 'ACCELERATE') return 'UP';
      if (action === 'BACK_OFF') return 'DOWN';
      return 'NEUTRAL';
    }

    // Same: a re-pace can go either way, and the action carries both anchors.
    // Rule 11 · when either anchor is missing the direction is UNKNOWN, and
    // NEUTRAL is the honest place to put it rather than guessing a sign.
    case 'recompute_paces': {
      const from = a.fromVdot;
      const to = a.newVdot;
      if (typeof from !== 'number' || typeof to !== 'number') return 'NEUTRAL';
      // A higher VDOT is a faster prescription: the plan got harder.
      if (to > from) return 'UP';
      if (to < from) return 'DOWN';
      return 'NEUTRAL';
    }

    // A field test replaces a session with a 30-minute threshold effort. It
    // changes what is measured, not how much is asked for.
    case 'field_test':
    // Moving a day changes when, not how much.
    case 'reschedule':
    // A marker for a later recompute. Nothing has moved yet.
    case 'mark_dirty':
    // Record-only. Mutates nothing in plan_workouts, by its own contract.
    case 'note':
      return 'NEUTRAL';
  }
}

/** Which axis the action moves, for a reader asking "pace or volume?". */
export function leverOfAction(a: AdaptationAction): AdaptationLogItem['lever'] {
  switch (a.kind) {
    case 'recompute_paces':
    case 'mark_dirty':
      return 'PACE';
    case 'mark_upgrade':
    case 'shave':
      return 'VOLUME';
    case 'downgrade':
    case 'reshape':
    case 'field_test':
      return 'SESSION_SHAPE';
    case 'reschedule':
      return 'SCHEDULE';
    case 'note':
      return 'RECORD_ONLY';
  }
}

/** A one-clause description a person can read without opening the code. */
function whatOf(a: AdaptationAction): string {
  switch (a.kind) {
    case 'mark_upgrade': {
      const n = a.bumps?.length ?? 0;
      const added = (a.bumps ?? []).length;
      return `raised ${n} day${n === 1 ? '' : 's'}${added ? '' : ''} of prescribed distance`;
    }
    case 'shave':
      return `cut ${Math.round((a.shaveFraction ?? 0) * 100)}% off the prescribed volume`;
    case 'downgrade':
      return `made a quality session easier${a.newType ? ` (to ${a.newType})` : ''}`;
    case 'reshape':
      return `${a.reshape?.resolution.action ?? 'adjusted'} the shape of one quality session`;
    case 'recompute_paces':
      return `re-priced every future session from VDOT ${a.fromVdot ?? '?'} to ${a.newVdot ?? '?'}`;
    case 'mark_dirty':
      return 'marked the plan for a pace recompute';
    case 'field_test':
      return 'converted a quality day into a threshold field test';
    case 'reschedule':
      return `moved a session${a.newDate ? ` to ${a.newDate}` : ''}`;
    case 'note':
      return `recorded ${a.noteReason ?? 'a note'}, changing nothing`;
  }
}

/**
 * Build the entry for one nightly pass.
 *
 * `touched` stays authoritative for `n`, because that is what the existing
 * value means and a reader comparing old rows to new must not find the
 * definition changed underneath them. `did` describes the ACTIONS the pass
 * applied, which is a different count — an action can touch several rows, and a
 * coupled action can be skipped — so the two are not expected to agree and
 * neither is derived from the other.
 */
export function buildAdaptationLogEntry(
  actions: readonly AdaptationAction[],
  touched: number,
  nowISO: string,
): AdaptationLogEntry {
  return {
    ts: nowISO,
    n: touched,
    did: actions.map((a) => ({
      kind: a.kind,
      direction: directionOfAction(a),
      lever: leverOfAction(a),
      what: whatOf(a),
      workoutIds: a.workoutIds,
      evidence: a.sourceTrigger ?? 'unattributed',
    })),
  };
}

/**
 * The Rule 21 question, answered from a log.
 *
 * Exported so the answer has ONE definition (Rule 16) rather than being
 * re-typed as a SQL expression at each call site, and so a test can assert on
 * it without a database.
 */
export function countByDirection(
  entries: readonly AdaptationLogEntry[],
): Record<AdaptationDirection, number> {
  const out: Record<AdaptationDirection, number> = { UP: 0, DOWN: 0, NEUTRAL: 0 };
  for (const e of entries) for (const d of e.did ?? []) out[d.direction] += 1;
  return out;
}
