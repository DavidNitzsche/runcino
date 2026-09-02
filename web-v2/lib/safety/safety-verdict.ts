/**
 * lib/safety/safety-verdict.ts · THE CANONICAL SAFETY OWNER.
 *
 * BRAIN_CONSTITUTION §2.E, §29 row "Is training safe?", §31's required test
 * ("Safety STOP -> no runnable workout emitted"), §18's override hierarchy
 * (SAFETY is 1 of 5). Doctrine brief 11.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *
 * The 2026-09-02 brain scorecard graded this row FAIL with the note "No module
 * owns the NORMAL/CAUTION/MODIFY/STOP verdict; four surfaces author it
 * independently". Those four were:
 *
 *   1. `app/api/v5/today/route.ts:483-487` — an inline `verdictBySeverity`
 *      object literal keyed on injury severity (iPhone).
 *   2. `app/api/v5/today/route.ts:527-530` — an inline illness ternary on
 *      `has_fever` (iPhone).
 *   3. `lib/watch/build-workout.ts:1141 loadNoSessionReason` — three LIMIT-1
 *      point reads and its own precedence, whose own comment concedes it is a
 *      copy ("Read here rather than through loadGlanceState").
 *   4. `lib/adaptation/adaptation-model.ts:695-716` — the `veto` branch, which
 *      turns `injuryActive` / `illnessActive` / `niggleSeverity` into a
 *      runner-facing "Running stays off the plan while this is active."
 *
 * Four authors of one verdict is the exact shape Constitution §4 forbids and
 * §17 refuses to paper over with a priority order. This module is the one
 * owner. Every surface consumes it; no surface re-derives it.
 *
 * ── THE RUNNER'S RULING, 2026-09-02, verbatim ───────────────────────────────
 *
 *   "A failed safety read must never silently become 'not injured.' Do not
 *    fabricate an injury. Return an explicit UNKNOWN safety state. Prevent the
 *    app from confidently presenting a quality session as cleared until the
 *    check succeeds. Show a clear retry state and a conservative
 *    non-prescriptive fallback. There must be one canonical safety verdict
 *    consumed by every surface."
 *
 * Every clause of that is encoded below, and the UNKNOWN clause is encoded as
 * a TYPE rather than as a discipline — see the next section.
 *
 * ── RULE 11 AS A TYPE, NOT A DISCIPLINE ─────────────────────────────────────
 *
 * `SafetyResolution` is a discriminated union whose UNKNOWN branch carries NO
 * `state` field at all. `resolution.state` does not compile until the caller
 * has branched on `known`. This is the `NormalReading<T>` pattern from
 * `lib/training/normal-window.ts`, chosen for the same reason: the failure
 * this codebase keeps repeating is a caller reading a value that was never
 * there, and the strongest available enforcement is making it a type error.
 *
 * `posture` IS readable on both branches, deliberately. It is the total,
 * always-safe question ("what may I prescribe?") and its UNKNOWN value is
 * `WITHHOLD_PENDING_CHECK`, which is not `PRESCRIBE` — so the one read that
 * needs no branch cannot fall through to prescribing. The read that CAN lie
 * (`state`) is the one that is gated.
 *
 * ── THREE FACTS, NEVER ONE (Rule 11) ────────────────────────────────────────
 *
 * Each input signal is a `SignalRead<T>` with three outcomes:
 *
 *   · `{ ok: true, value: T }`    a row exists
 *   · `{ ok: true, value: null }` we looked and there is nothing
 *   · `{ ok: false, failure }`    we could not look
 *
 * and the failure itself is split again, because "the query errored" and "this
 * deployment has no such table" are different facts a reader may want to act
 * on differently (`READ_FAILED` vs `NOT_DEPLOYED`).
 *
 * ── WHEN A FAILED READ FORCES UNKNOWN, AND WHEN IT DOES NOT ─────────────────
 *
 * Not every unreadable signal can change the answer, and treating them all as
 * UNKNOWN would withhold the runner's whole day over a signal whose worst case
 * is a footnote. Each signal therefore declares its WORST CASE state, and:
 *
 *     UNKNOWN fires iff some unreadable signal's worst case would have
 *     TIGHTENED THE POSTURE resolved from the signals that WERE readable.
 *
 * Posture, not state, because NORMAL and CAUTION license the same
 * prescription. A read that could not have changed what we are allowed to
 * prescribe does not get to withhold it.
 *
 * Consequences, all of them intended:
 *
 *   · Injury unreadable, nothing else firing  -> UNKNOWN. Its worst case is
 *     STOP and the readable answer is NORMAL, so the read mattered.
 *   · Injury unreadable, illness present      -> STOP, and `known: true`. We
 *     are already stopping; the missing read could not have made it worse, so
 *     refusing to answer would be false humility.
 *   · Niggle unreadable, nothing else firing  -> NORMAL, with `'niggle'` in
 *     `degradedSignals`. A niggle's worst case is CAUTION, which changes a
 *     sentence and not a prescription. Blanking the day for it would be the
 *     over-reaction Rule 8's corollary warns about, pointed the other way.
 *
 * `degradedSignals` is never empty silently: a caller that wants to surface
 * "we could not read everything" on a KNOWN verdict has the list.
 *
 * ── WHAT THIS MODULE DOES NOT DO ────────────────────────────────────────────
 *
 *   · It does not read a database. `load-safety.ts` is the reader. This half
 *     is pure so a `'use client'` graph can import the types and the copy
 *     without dragging `pg` into the browser bundle (Rule 19, and
 *     `scripts/check-client-graph.sh` enforces it).
 *   · It does not decide what training to substitute. Constitution §2.E owns
 *     "is ordinary training logic allowed to proceed?"; the Plan Generator
 *     owns what happens instead. `posture` is the seam between them.
 *   · It does not redefine fitness (§18's note). A STOP says nothing about
 *     what the runner can do, only about what they should do today.
 */

/* ═══════════════════════════════════════════════════════════════════════════
 * THE VOCABULARY
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Constitution §2.E's four outputs, verbatim. This union is declared HERE and
 * nowhere else; `_safety_ownership.test.ts` fails if a second file declares it.
 *
 * NORMAL  — ordinary training logic may proceed.
 * CAUTION — proceed, but the runner is carrying something worth naming.
 * MODIFY  — training continues in a reduced form. Easy running only.
 * STOP    — ordinary training logic does not proceed. Nothing is prescribed.
 */
export type SafetyState = 'NORMAL' | 'CAUTION' | 'MODIFY' | 'STOP';



/**
 * What a surface is permitted to put in front of the runner. TOTAL over both
 * branches of `SafetyResolution` — this is the field a caller may read without
 * branching, and the reason UNKNOWN gets its own value rather than borrowing
 * `NO_TRAINING`: "we could not check" and "you must not run" produce the same
 * screen content but are opposite facts, and only one of them retries.
 */
export type SafetyPosture =
  /** Prescribe the session as authored, quality included. */
  | 'PRESCRIBE'
  /** Prescribe easy running only. No quality, no target pace above easy. */
  | 'EASY_ONLY'
  /** Emit no runnable session. Safety has stopped ordinary training. */
  | 'NO_TRAINING'
  /** Emit no runnable session BECAUSE THE CHECK DID NOT RUN. Retryable. */
  | 'WITHHOLD_PENDING_CHECK';

/** Which input could not be read, or which one drove the verdict. */
export type SafetySignalName = 'injury' | 'illness' | 'niggle';

/** Why a read produced nothing. Two facts, not one. */
export type SignalFailure =
  /** The query errored: a connection blip, a timeout, a defect in the SQL. */
  | 'READ_FAILED'
  /** The relation does not exist in this deployment (SQLSTATE 42P01). */
  | 'NOT_DEPLOYED';

/**
 * One input signal. Three outcomes, and the caller must branch to reach the
 * value — `read.value` does not compile on the failure branch.
 */
export type SignalRead<T> =
  | { readonly ok: true; readonly value: T | null }
  | { readonly ok: false; readonly failure: SignalFailure };

/* ═══════════════════════════════════════════════════════════════════════════
 * THE INPUTS
 * ══════════════════════════════════════════════════════════════════════════ */

/** An OPEN row of `runner_injuries` (`resolved_date IS NULL`). */
export interface InjurySignal {
  readonly id: number;
  readonly site: string;
  readonly severity: 'minor' | 'moderate' | 'major';
  readonly startDateISO: string;
  readonly expectedReturnDateISO: string | null;
  readonly returnProtocol: string | null;
  readonly notes: string | null;
}

/** An UNCLEARED row of `sick_episodes` (`cleared_at IS NULL`). */
export interface IllnessSignal {
  readonly id: number;
  readonly symptoms: readonly string[];
  readonly hasFever: boolean;
  readonly started: string;
  readonly loggedAtISO: string;
  readonly daysActive: number;
}

/** An UNCLEARED row of `niggles` (`cleared_at IS NULL`). Severity is 1-10. */
export interface NiggleSignal {
  readonly id: number;
  readonly bodyPart: string;
  readonly severity: number;
  readonly side: 'left' | 'right' | 'both' | null;
  readonly status: string;
  readonly loggedAtISO: string;
  readonly daysActive: number;
}

export interface SafetyInputs {
  readonly injury: SignalRead<InjurySignal>;
  readonly illness: SignalRead<IllnessSignal>;
  readonly niggle: SignalRead<NiggleSignal>;
}

/**
 * The worst state each signal is capable of producing. This is what decides
 * whether an unreadable signal forces UNKNOWN, so it must be the ceiling of
 * what `classifySafety` below can actually emit for that signal — a value set
 * too low here would let a real STOP be missed on a failed read. The
 * behavioural suite asserts the two agree by construction.
 */
const WORST_CASE: Readonly<Record<SafetySignalName, SafetyState>> = {
  injury: 'STOP',   // moderate / major
  illness: 'STOP',  // any uncleared episode
  niggle: 'CAUTION',
};

/**
 * A niggle at or above this severity is CAUTION. Below it, the runner logged
 * something they are aware of and it does not change today.
 *
 * DOCTRINE POSTURE, stated rather than implied (Rule 20): this threshold is
 * NOT research-cited. `lib/adaptation/adaptation-model.ts` uses its own
 * `NIGGLE_VETO_SEVERITY` for a different question (may progression step up),
 * and no `Research/` table gives a runner-reported 1-10 pain scale a band.
 * It is set at the midpoint so that it can only ever ADD a sentence, never
 * remove a session — the lowest-consequence place to be wrong. If a doctrine
 * source is ever found, this constant is the one to bind with a Rule 7 claim.
 */
export const NIGGLE_CAUTION_SEVERITY = 5;

/* ═══════════════════════════════════════════════════════════════════════════
 * THE VERDICT
 * ══════════════════════════════════════════════════════════════════════════ */

/** Why the verdict is what it is. Machine-readable; never shown to a runner. */
export type SafetyReason =
  | 'clear'
  | 'injury_minor'
  | 'injury_moderate'
  | 'injury_major'
  | 'illness_fever'
  | 'illness'
  | 'niggle';

/**
 * THE CANONICAL SAFETY VERDICT.
 *
 * The UNKNOWN branch carries no `state`, no `reason` and no `driver`. That is
 * the whole point: `resolution.state` is a type error until the caller has
 * branched on `known`, so a surface physically cannot read UNKNOWN as safe.
 */
export type SafetyResolution =
  | {
      readonly known: true;
      readonly state: SafetyState;
      readonly posture: SafetyPosture;
      readonly reason: SafetyReason;
      /** The signal that set the state, or null when the state is NORMAL. */
      readonly driver: SafetySignalName | null;
      readonly injury: InjurySignal | null;
      readonly illness: IllnessSignal | null;
      readonly niggle: NiggleSignal | null;
      /**
       * Signals we could not read whose worst case could NOT have outranked
       * the state above. The verdict stands; this is the honest footnote.
       */
      readonly degradedSignals: readonly SafetySignalName[];
      /** One line of provenance for a log or an audit. Not runner-facing. */
      readonly explain: string;
    }
  | {
      readonly known: false;
      readonly posture: 'WITHHOLD_PENDING_CHECK';
      /** Every signal that could not be read. Non-empty by construction. */
      readonly unreadable: readonly { readonly signal: SafetySignalName; readonly failure: SignalFailure }[];
      /**
       * What the readable signals alone said. Present so a caller can log how
       * far off the answer might be, and DELIBERATELY not named `state`: it is
       * a floor, not a verdict, and reading it as one is the failure this
       * union exists to prevent.
       */
      readonly floor: SafetyState;
      readonly explain: string;
    };

/** The posture each known state licenses. One place, so no surface re-decides. */
/** The three postures a KNOWN state can license. `WITHHOLD_PENDING_CHECK` is
 *  deliberately not one of them: it is what UNKNOWN carries, and no state maps
 *  to it. Naming the narrower type here is what lets `POSTURE_RANK` below be
 *  total over exactly the values it can be asked about. */
type KnownPosture = Exclude<SafetyPosture, 'WITHHOLD_PENDING_CHECK'>;

const POSTURE_BY_STATE: Readonly<Record<SafetyState, KnownPosture>> = {
  NORMAL: 'PRESCRIBE',
  CAUTION: 'PRESCRIBE',
  MODIFY: 'EASY_ONLY',
  STOP: 'NO_TRAINING',
};

/** Ascending restriction. Used ONLY to ask whether an unreadable signal could
 *  have tightened what we may prescribe. `WITHHOLD_PENDING_CHECK` is not a
 *  state's posture and is deliberately absent: it is the OUTCOME of this
 *  comparison, never an input to it. */
const POSTURE_RANK: Readonly<Record<KnownPosture, number>> = {
  PRESCRIBE: 0,
  EASY_ONLY: 1,
  NO_TRAINING: 2,
};

function stateFromInjury(inj: InjurySignal): { state: SafetyState; reason: SafetyReason } {
  // Doctrine brief 11: "Not every complaint requires stopping. Not every
  // complaint should be trained through." A minor open injury keeps the runner
  // running and takes the quality away; moderate and major do not.
  if (inj.severity === 'minor') return { state: 'MODIFY', reason: 'injury_minor' };
  if (inj.severity === 'major') return { state: 'STOP', reason: 'injury_major' };
  return { state: 'STOP', reason: 'injury_moderate' };
}

/**
 * Resolve the one safety verdict for a runner on a day.
 *
 * PURE. Every input is already read; this function performs no I/O and cannot
 * fail. Precedence matches what the iPhone shipped before this module existed,
 * so consolidating the four authors changes WHO decides and not WHAT is
 * decided for any input that was previously handled:
 *
 *     open injury  >  uncleared illness  >  niggle  >  clear
 *
 * (An injury outranks a concurrent illness because its load restriction is the
 * more specific one. That ordering is `v5/today`'s own, kept verbatim.)
 */
export function classifySafety(inputs: SafetyInputs): SafetyResolution {
  const unreadable: { signal: SafetySignalName; failure: SignalFailure }[] = [];
  if (!inputs.injury.ok) unreadable.push({ signal: 'injury', failure: inputs.injury.failure });
  if (!inputs.illness.ok) unreadable.push({ signal: 'illness', failure: inputs.illness.failure });
  if (!inputs.niggle.ok) unreadable.push({ signal: 'niggle', failure: inputs.niggle.failure });

  const injury = inputs.injury.ok ? inputs.injury.value : null;
  const illness = inputs.illness.ok ? inputs.illness.value : null;
  const niggle = inputs.niggle.ok ? inputs.niggle.value : null;

  // ── the state the READABLE signals alone support ────────────────────────
  let state: SafetyState = 'NORMAL';
  let reason: SafetyReason = 'clear';
  let driver: SafetySignalName | null = null;

  if (injury) {
    const r = stateFromInjury(injury);
    state = r.state;
    reason = r.reason;
    driver = 'injury';
  } else if (illness) {
    state = 'STOP';
    reason = illness.hasFever ? 'illness_fever' : 'illness';
    driver = 'illness';
  } else if (niggle && niggle.severity >= NIGGLE_CAUTION_SEVERITY) {
    state = 'CAUTION';
    reason = 'niggle';
    driver = 'niggle';
  }

  /* ── could anything we failed to read have changed WHAT WE MAY PRESCRIBE?
   *
   * Compared on POSTURE, not on state rank. NORMAL and CAUTION both license
   * PRESCRIBE, so an unreadable niggle (worst case CAUTION) against a readable
   * NORMAL could only have added a sentence, and withholding the runner's
   * whole day over a sentence is the over-reaction. An unreadable injury
   * (worst case STOP -> NO_TRAINING) against a readable NORMAL could have
   * changed everything, so it refuses.
   *
   * Comparing state ranks instead was the first shape of this and it was
   * WRONG in exactly that case: it made every failed niggle read blank the
   * day. Caught by the behavioural suite before it left the branch. */
  const blocking = unreadable.filter(
    (u) => POSTURE_RANK[POSTURE_BY_STATE[WORST_CASE[u.signal]]] > POSTURE_RANK[POSTURE_BY_STATE[state]],
  );

  if (blocking.length > 0) {
    return {
      known: false,
      posture: 'WITHHOLD_PENDING_CHECK',
      unreadable: blocking,
      floor: state,
      explain:
        `safety UNKNOWN · unreadable=${blocking.map((b) => `${b.signal}:${b.failure}`).join(',')}`
        + ` · readable floor=${state}`,
    };
  }

  const degradedSignals = unreadable.map((u) => u.signal);
  return {
    known: true,
    state,
    posture: POSTURE_BY_STATE[state],
    reason,
    driver,
    injury,
    illness,
    niggle,
    degradedSignals,
    explain:
      `safety ${state} · reason=${reason} · driver=${driver ?? 'none'}`
      + (degradedSignals.length ? ` · degraded=${degradedSignals.join(',')}` : ''),
  };
}

/**
 * The verdict for "the owner never ran here".
 *
 * `GlanceState.safety` is optional so the persona fixtures that predate this
 * module stay structurally valid. A consumer that finds it absent has NOT
 * learned that the runner is clear — it has learned that nothing checked — so
 * the absent case resolves to UNKNOWN rather than to a manufactured NORMAL.
 * This is the same fact `NOT_DEPLOYED` names, one layer up.
 */
export const SAFETY_NOT_RESOLVED: SafetyResolution = {
  known: false,
  posture: 'WITHHOLD_PENDING_CHECK',
  unreadable: [
    { signal: 'injury', failure: 'READ_FAILED' },
    { signal: 'illness', failure: 'READ_FAILED' },
  ],
  floor: 'NORMAL',
  explain: 'safety UNKNOWN · the resolver did not run for this caller',
};

/* ═══════════════════════════════════════════════════════════════════════════
 * THE TWO QUESTIONS EVERY SURFACE ACTUALLY ASKS
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Constitution §31's required test, as a function:
 * "Safety STOP -> no runnable workout emitted."
 *
 * False on STOP and false on UNKNOWN. The watch's no-session fallback and the
 * phone's prescription block both gate on this, so neither can ship a session
 * Safety has refused, and neither can ship one the check never cleared.
 */
export function mayEmitRunnableWorkout(res: SafetyResolution): boolean {
  return res.posture === 'PRESCRIBE' || res.posture === 'EASY_ONLY';
}

/**
 * "Prevent the app from confidently presenting a quality session as cleared
 * until the check succeeds" — the runner's own sentence, as a predicate.
 *
 * True ONLY on `PRESCRIBE`. MODIFY licenses easy running and no more; UNKNOWN
 * licenses nothing until the read succeeds.
 */
export function mayEmitQualityWorkout(res: SafetyResolution): boolean {
  return res.posture === 'PRESCRIBE';
}

/**
 * True when the runner should be TOLD the check did not run. Distinct from
 * `!mayEmitRunnableWorkout` because a STOP is also non-runnable and the two
 * screens say opposite things: one names an injury, the other names a failure
 * and offers a retry.
 */
export function isSafetyUnknown(res: SafetyResolution): res is Extract<SafetyResolution, { known: false }> {
  return !res.known;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * RUNNER-FACING COPY · ONE PLACE (Rule 16, Rule 17)
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * The sentence the runner reads. One author, so the wrist and the phone cannot
 * word the same verdict differently.
 *
 * The four known-state sentences are the iPhone's own, moved here BYTE FOR
 * BYTE from `app/api/v5/today/route.ts`'s deleted `verdictBySeverity` literal
 * and its illness ternary. Consolidating ownership is not licence to reword
 * copy the runner has already been reading; a wording change is a separate
 * decision from an architecture change.
 */
export function safetyVerdictLine(res: SafetyResolution): string {
  if (!res.known) {
    // Rule 20: this sentence promises only what actually happens. The read is
    // performed per request, so reopening the screen genuinely retries it.
    // No gesture is named that a deployed client may not have.
    return 'The injury and illness check did not run, so nothing is prescribed yet. '
      + 'Reopen this screen to try again.';
  }
  const site = res.injury?.site ?? 'area';
  switch (res.reason) {
    case 'injury_minor':
      return `Easy running only. The ${site} gets a few easy days before anything harder comes back.`;
    case 'injury_moderate':
      return `Rest, not run. The ${site} gets time to settle before anything reintroduces load.`;
    case 'injury_major':
      return `Rest, not run. The ${site} needs a real break. This is not a session to run through.`;
    case 'illness_fever':
      return 'Rest, not run. A fever means the body is fighting something. Running adds load it does not have to spare.';
    case 'illness':
      return 'Rest, not run. Whatever this is gets a real day off before anything asks more of you.';
    case 'niggle':
      return res.niggle
        ? `The ${res.niggle.bodyPart} is logged and still there. Run it easy and stop if it changes how you move.`
        : 'Something is logged and still there. Run it easy and stop if it changes how you move.';
    case 'clear':
    default:
      // NORMAL has nothing to say. Rule 17: a coach does not announce the
      // absence of a problem, and this string exists only so the function is
      // total. No surface draws it.
      return '';
  }
}

/**
 * The short title a quiet panel uses. The watch's No-session board already
 * says "Not today" for both injury and illness; that string is kept.
 */
export function safetyTitle(res: SafetyResolution): string {
  if (!res.known) return 'Not cleared';
  switch (res.reason) {
    case 'injury_minor':
    case 'injury_moderate':
    case 'injury_major':
    case 'illness_fever':
    case 'illness':
      return 'Not today';
    case 'niggle':
      return 'Carrying something';
    default:
      return '';
  }
}
