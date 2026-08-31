/**
 * lib/training/runner-state.ts · THE READINESS/STATE OWNERSHIP LAYER.
 *
 * ONE owning service answers "is the planned demand appropriate today", and it
 * answers with a COACHING DECISION rather than a score. That is
 * `docs/DOCTRINE_ENFORCEMENT_AND_CLEAN_IMPLEMENTATION.md` §1-2 and BRIEF 08,
 * whose output line is quoted here because it is the whole specification:
 *
 *     "The system should primarily answer: proceed / proceed with caution /
 *      reduce / replace / recover / stop. This is a coaching decision. It does
 *      not need a score of 73."   — BRIEF 08, Training Load, Recovery & Readiness
 *
 * ── WHAT THIS IS, AND WHAT IT IS NOT ────────────────────────────────────────
 *
 * IT IS A CONSOLIDATOR, NOT A NEW DETECTOR. Every signal below is read from
 * machinery this app already owns and already gates in CI. Nothing here invents
 * a readiness rule, re-derives a threshold, or reads a biometric directly:
 *
 *   · `gradeConvergence` (lib/coach/convergence.ts) — five independent domains,
 *     per-domain context filters, green / amber / red. Every constant in it is
 *     bound by a `CONVERGENCE.*` registry claim.
 *   · `runnerIsCompromised` (lib/plan/adapt.ts) — illness, active injury,
 *     override-severity niggle, training-gap re-entry.
 *   · `computeAcwr` (lib/coach/acwr.ts) — reported, never a driver. See below.
 *   · `loadConvergenceContext` — the race calendar, for the post-race window.
 *
 * §2's rule is the reason this file is a consolidator: a second implementation
 * of "is this runner ready" is doctrine already compromised. What did not exist
 * was ONE TYPED ANSWER a prescription can consume without re-deriving anything,
 * and that is the only thing added here.
 *
 * IT HAS NO AUTHORITY. Nothing in this module writes, mutates a plan, or is
 * called by any live path. `readiness_pullback` in lib/plan/adapt.ts still owns
 * the mutation, unchanged. This is the shadow-mode step §21 requires before a
 * new resolver is given authority.
 *
 * IT NEVER TOUCHES CAPACITY (§7). State answers "what is appropriate today".
 * Capacity answers "what can this runner do". `lib/training/capacity-resolver.ts`
 * owns the second question and this file cannot see, call or modify it — there
 * is no import of it here, which is the structural half of the separation.
 *
 * ── GOAL ISOLATION (§6) ─────────────────────────────────────────────────────
 *
 * Same discipline as the capacity resolver, and asserted the same way at the
 * bottom of this file: `resolveRunnerState(userId, todayISO?)` and nothing else.
 * Audited transitively when this landed — `loadConvergenceSeries`,
 * `loadConvergenceContext`, `computeAcwr` and `runnerIsCompromised` read
 * biometrics, runs, sick/injury episodes, coach intents and race DATES. A race
 * date is a schedule fact, not an aspiration; none of them reads
 * `goal_race_time`, `goal_iso`, `tt_goal_*` or a goal pace. If a future edit
 * makes one of them do so, the leak is into READINESS, which would let an
 * ambitious goal make a runner read as ready — the exact shape §6 exists for.
 *
 * ── RULE 11 · THREE FACTS, NOT ONE ──────────────────────────────────────────
 *
 * "Don't know", "measured fine" and "the read failed" are three different
 * states and this file keeps them apart:
 *
 *   · `readable: true`  + `decision: 'proceed'`   — we looked, it is fine.
 *   · `readable: false` + an `unreadable` signal  — we could not look.
 *
 * The deliberate NON-USE of `runnerIsCompromisedFailClosed` is the reason.
 * That wrapper is correct for its four call sites and its own header says so,
 * but it converts a failed read into `{compromised: true, reason: 'injury'}` —
 * a placeholder it explicitly names as not a diagnosis. A consumer of THIS
 * type would read that as an injury and prescribe a return protocol for a
 * database timeout. So the raw predicate is called and the rejection is
 * handled here, where the distinction can be preserved in the type.
 *
 * WHERE AN UNREADABLE STATE LANDS, and why it is not `reduce`. An unreadable
 * state produces `proceed_with_caution`, which in `prescription-resolver.ts`
 * means the prescription REFUSES TO TIGHTEN and says why. That satisfies Rule
 * 11's actual requirement — a guard that cannot run is a refusal worth
 * surfacing — without inventing a reduction no evidence supports. It is
 * deliberately weaker than the four `runnerIsCompromisedFailClosed` sites,
 * which gate autonomous MUTATIONS and correctly fail all the way closed; this
 * resolver has no authority at all, so the same posture would only make a
 * shadow report lie. NAMED AS A CALL FOR THE WIRING PHASE rather than settled
 * here: if this ever gates a live prescription, revisit whether
 * `proceed_with_caution` is closed enough.
 *
 * ── RULE 22 · WHAT THIS CANNOT FAIL ON ──────────────────────────────────────
 *
 * Stated rather than hidden, per Rule 22's requirement that a gate declare what
 * it is structurally incapable of catching:
 *
 *   · IT INHERITS CONVERGENCE'S BIAS. Every domain in `gradeConvergence` reads
 *     one direction: dragging. There is no "unusually recovered" domain, so
 *     this file can never return a decision meaning "today is a good day to
 *     push". `proceed` is its ceiling. That asymmetry is the CLAUDE.md hero
 *     statement's named defect, and the upward path lives in the adaptation
 *     engine, not here — but a reader of this type should not mistake
 *     `proceed` for "no evidence, carry on"; it means "nothing is dragging".
 *   · IT CANNOT SEE WHAT IS NOT INSTRUMENTED. `alcoholLastNight` is hardcoded
 *     false in the loader and heat is best-effort. Both fail toward NOT
 *     suppressing, which means a dragging domain can count when a confounder
 *     would have excused it.
 *   · IT IS NOT CALIBRATED. Nothing has measured whether `reduce` is right when
 *     it fires. It is an ORDERING over doctrine-cited triggers.
 */

import { runnerToday } from '@/lib/runtime/runner-tz';

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · THE DOMAIN TYPES (§5)
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * BRIEF 08's own six-way output, verbatim and in its own order.
 *
 * NOT A SCORE, on purpose. The brief's line is "it does not need a score of
 * 73", and doctrine §29 gives the reason: the intelligence should make the
 * product simpler, and a number the runner has to interpret is the opposite of
 * a decision they can act on.
 *
 *   proceed              — nothing is dragging. Give the session as written.
 *   proceed_with_caution — something is dragging, or we could not look. Do not
 *                          TIGHTEN the prescription; say what was seen.
 *   reduce               — enough converging evidence to change today's demand.
 *   replace              — normal running is not the right thing; a protocol
 *                          owns the substitute (injury return, walk-run).
 *   recover              — the body is doing something other than training.
 *   stop                 — do not run.
 */
export type StateDecision =
  | 'proceed'
  | 'proceed_with_caution'
  | 'reduce'
  | 'replace'
  | 'recover'
  | 'stop';

/**
 * Precedence, so "which of two decisions governs" is answered in ONE place.
 * Higher wins. Same shape and the same reason as `SOURCE_MODE_STRENGTH` in
 * `capacity-resolver.ts` — a second opinion about which state is more serious
 * is how two callers start disagreeing.
 */
export const STATE_DECISION_SEVERITY: Readonly<Record<StateDecision, number>> = Object.freeze({
  proceed: 0,
  proceed_with_caution: 1,
  reduce: 2,
  replace: 3,
  recover: 4,
  stop: 5,
});

/** Where a signal came from. One per underlying reader, plus the honest
 *  `unreadable` case Rule 11 requires. */
export type StateSignalKind =
  | 'convergence'
  | 'illness'
  | 'injury'
  | 'niggle'
  | 'training_gap'
  | 'acwr'
  | 'post_race_window'
  | 'unreadable';

export interface RunnerStateSignal {
  kind: StateSignalKind;
  /**
   * The decision this signal argues for ON ITS OWN. `'proceed'` means the
   * signal was observed and argues for nothing — an ACWR reading, or a
   * post-race window the plan already handles. Reported anyway, because §27's
   * explainability wants the working, not just the verdict.
   */
  argues: StateDecision;
  /**
   * Whether this signal is allowed to SET the decision.
   *
   * `false` is not "weak" — it is "another owner already answers this". See
   * `ACWR_IS_REPORTED_NEVER_DRIVING` and `POST_RACE_IS_REPORTED_NEVER_DRIVING`
   * for the two cases and the argument for each.
   */
  driving: boolean;
  /** Short, structured-enough to read in a log. Never runner-facing copy —
   *  BRIEF 12 and the coach-voice gate own that, one layer up. */
  detail: string;
  /** The underlying reader's own output, unchanged, for the record. */
  evidence: Record<string, unknown>;
}

/**
 * §31 · version the model. Bump the MINOR when a mapping from a signal to a
 * decision changes; the PATCH when a reported field or a detail string changes
 * without moving a decision.
 */
export const RUNNER_STATE_MODEL_VERSION = '1.0.0';

export interface RunnerState {
  /** The answer. The strongest DRIVING signal's `argues`, or `'proceed'`. */
  decision: StateDecision;
  /** The signal that set `decision`. Null only when `decision === 'proceed'`. */
  driver: RunnerStateSignal | null;
  /** Everything observed, driving or not, in the order it was read. */
  signals: RunnerStateSignal[];
  /**
   * Rule 11. False when a read FAILED — distinguishable from a read that
   * succeeded and found nothing. When false there is always a matching
   * `unreadable` signal in `signals` naming what could not be read.
   */
  readable: boolean;
  /** The runner's own day this state describes. */
  todayISO: string;
  /** ISO instant. Compute-at-read-time (Rule 10); stamped so a state that
   *  travels into a log or a response carries its own age. */
  resolvedAt: string;
  modelVersion: string;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · THE TWO NON-DRIVING SIGNALS, AND WHY THEY ARE NON-DRIVING
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * ACWR IS REPORTED, NEVER DRIVING · Rule 16, one quantity one name.
 *
 * `gradeConvergence`'s `load` domain ALREADY reads the acute:chronic ratio and
 * already applies `Research/15`'s own instruction about it — quoted in
 * `CONVERGENCE.acwrDanger`'s header: "treat ACWR as a directional sanity check,
 * not a stop-light ... a ratio of 1.4 in itself is not a verdict ... Couple
 * with HRV trend, RHR, sleep, and subjective state."
 *
 * Letting the ratio ALSO drive a decision at this layer would give one number
 * two votes and would defy the sentence doctrine wrote about that exact number.
 * So it is read, reported for explainability, and structurally barred from
 * setting the decision.
 */
const ACWR_IS_REPORTED_NEVER_DRIVING = true;

/**
 * THE POST-RACE WINDOW IS REPORTED, NEVER DRIVING · Rule 17.
 *
 * A runner inside `postRaceRecoveryWeeks` is already being prescribed recovery
 * BY THE PLAN — that window is where the plan's own recovery block lives. A
 * state layer that returned `recover` there would be the second component
 * saying the same thing about the same days, which is exactly the repetition
 * Rule 17 forbids ("if two components can both draw a value, one of them
 * yields").
 *
 * It is still REPORTED, because a consumer needs it: Rule 8's corollary is that
 * a low number measured inside a prescribed recovery block and a low number off
 * a detrained runner are opposite facts, and a prescription that can see the
 * window can say which it is looking at.
 */
const POST_RACE_IS_REPORTED_NEVER_DRIVING = true;

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · THE PURE CORE
 * ═══════════════════════════════════════════════════════════════════════ */

/** Everything `composeRunnerState` needs. Pure input, so the mapping is
 *  falsifiable without a database (Rule 18). */
export interface RunnerStateInputs {
  signals: RunnerStateSignal[];
  readable: boolean;
  todayISO: string;
}

/**
 * Pure · the strongest DRIVING signal wins.
 *
 * ONE ordering (`STATE_DECISION_SEVERITY`), applied once. A signal barred from
 * driving cannot raise the decision however serious it looks, which is what
 * makes the two constants above structural rather than advisory.
 */
export function composeRunnerState(inputs: RunnerStateInputs): RunnerState {
  const driving = inputs.signals.filter((s) => s.driving && s.argues !== 'proceed');
  let driver: RunnerStateSignal | null = null;
  for (const s of driving) {
    if (driver == null || STATE_DECISION_SEVERITY[s.argues] > STATE_DECISION_SEVERITY[driver.argues]) {
      driver = s;
    }
  }
  return {
    decision: driver == null ? 'proceed' : driver.argues,
    driver,
    signals: inputs.signals,
    readable: inputs.readable,
    todayISO: inputs.todayISO,
    resolvedAt: new Date().toISOString(),
    modelVersion: RUNNER_STATE_MODEL_VERSION,
  };
}

/**
 * What each compromised reason argues for.
 *
 * NOT INVENTED — each row is the response this app's own doctrine already
 * prescribes for that state, so the state layer and the engine cannot disagree
 * about what illness means:
 *
 *   illness      → `recover`. `Research/00b` treats an illness episode as
 *                  recovery time, not reduced training.
 *   injury       → `replace`. `lib/plan/injury-builder.ts` and
 *                  `Research/05`'s walk-run ladders own the substitute; the
 *                  right answer is "a protocol owns today", not "run less".
 *   niggle       → `reduce`. Only override-severity niggles reach here
 *                  (`runnerIsCompromised` filters the rest), and the engine's
 *                  own response to one is a softened day, not a stop.
 *   gap_reentry  → `reduce`. The return-to-volume ladder
 *                  (`resolveRampBase`) is a graded re-entry, and BRIEF 11 is
 *                  explicit: "Never compress missed training into the return
 *                  period."
 */
export const COMPROMISED_DECISION: Readonly<Record<'illness' | 'injury' | 'niggle' | 'gap_reentry', StateDecision>> =
  Object.freeze({
    illness: 'recover',
    injury: 'replace',
    niggle: 'reduce',
    gap_reentry: 'reduce',
  });

/**
 * What a convergence grade argues for.
 *
 * MIRRORS `detectReadinessPullback`'s existing severities exactly — red is the
 * grade that may change the plan, amber is the grade that may only say
 * something — so the state layer agrees with the mutation path that already
 * ships. Changing one without the other is how two answers to one question
 * appear (§2).
 */
export const CONVERGENCE_DECISION: Readonly<Record<'green' | 'amber' | 'red', StateDecision>> =
  Object.freeze({
    green: 'proceed',
    amber: 'proceed_with_caution',
    red: 'reduce',
  });

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · THE DB SHELL
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Is the planned demand appropriate for this runner today? THE canonical
 * answer (§2).
 *
 * Every underlying read is DYNAMICALLY imported, for two reasons that both
 * matter. `lib/plan/adapt.ts` is the plan engine's mutation module and a static
 * edge from a training-layer file into it would invite a cycle the moment
 * adaptation wants a state read. And Rule 19's `check-client-graph.sh` walks
 * dynamic edges too, so this buys no exemption from that gate — it buys module
 * ordering, which is the only thing it is for.
 *
 * FAILURE IS PER-READER, not per-call. One reader failing does not blank the
 * others: convergence can still grade when the compromised predicate times out,
 * and the compromised predicate can still answer when the biometric series
 * cannot be assembled. Each failure adds its own `unreadable` signal naming
 * what was lost, so `readable === false` always says WHICH read failed rather
 * than only that one did.
 */
export async function resolveRunnerState(
  userId: string,
  todayISO?: string,
): Promise<RunnerState> {
  const today = todayISO ?? await runnerToday(userId);
  const signals: RunnerStateSignal[] = [];
  let readable = true;

  const [compromised, convergence, acwr] = await Promise.all([
    readCompromised(userId),
    readConvergence(userId, today),
    readAcwr(userId, today),
  ]);

  for (const group of [compromised, convergence, acwr]) {
    for (const s of group) {
      signals.push(s);
      if (s.kind === 'unreadable') readable = false;
    }
  }

  return composeRunnerState({ signals, readable, todayISO: today });
}

/** Illness / injury / niggle / gap re-entry, with a FAILED read kept distinct
 *  from a clean one (Rule 11 — see the file header for why the fail-closed
 *  wrapper is deliberately not used). */
async function readCompromised(userId: string): Promise<RunnerStateSignal[]> {
  try {
    const { runnerIsCompromised } = await import('@/lib/plan/adapt');
    const r = await runnerIsCompromised(userId);
    if (!r.compromised) return [];
    return [{
      kind: r.reason === 'gap_reentry' ? 'training_gap' : r.reason,
      argues: COMPROMISED_DECISION[r.reason],
      driving: true,
      detail: `runnerIsCompromised · ${r.reason}`,
      evidence: { reason: r.reason },
    }];
  } catch (err) {
    return [{
      kind: 'unreadable',
      argues: 'proceed_with_caution',
      driving: true,
      detail: 'runnerIsCompromised could not be read',
      evidence: { reader: 'runnerIsCompromised', error: String(err) },
    }];
  }
}

/**
 * The five-domain convergence verdict, plus the post-race window the same
 * loader already resolves.
 *
 * `gradeConvergence` is called, never re-implemented. The verdict's own
 * `domains[]` working travels into `evidence` unchanged so a consumer can see
 * which domains dragged and which were suppressed by a context filter — the
 * per-finding context discipline is inside that function and this layer must
 * not second-guess it.
 */
async function readConvergence(userId: string, todayISO: string): Promise<RunnerStateSignal[]> {
  try {
    const { gradeConvergence } = await import('@/lib/coach/convergence');
    const { loadConvergenceSeries, loadConvergenceContext } =
      await import('@/lib/coach/convergence-loader');

    // The runner's own report on a PLANNED-EASY day. Best-effort exactly as
    // `detectReadinessPullback` treats it: the objective domains still decide
    // without it, so a failure here is not an unreadable STATE.
    let subjectiveWreckedOnEasy = false;
    try {
      const { loadYesterdaySignals, subjectivePullbackSignal } =
        await import('@/lib/coach/acknowledge');
      subjectiveWreckedOnEasy = subjectivePullbackSignal(await loadYesterdaySignals(userId)).fired;
    } catch { /* objective domains still decide */ }

    const [series, context] = await Promise.all([
      loadConvergenceSeries(userId, todayISO, { subjectiveWreckedOnEasy }),
      loadConvergenceContext(userId, todayISO),
    ]);
    const verdict = gradeConvergence(series, context);

    const out: RunnerStateSignal[] = [{
      kind: 'convergence',
      argues: CONVERGENCE_DECISION[verdict.grade],
      driving: true,
      detail: `convergence ${verdict.grade} · ${verdict.rationale}`,
      evidence: {
        grade: verdict.grade,
        converging: verdict.converging,
        domains: verdict.domains,
        baselineDays: series.baselineDays,
      },
    }];

    const since = context.daysSinceLastRace;
    if (since != null && since <= context.postRaceWindowDays) {
      out.push({
        kind: 'post_race_window',
        argues: 'recover',
        driving: !POST_RACE_IS_REPORTED_NEVER_DRIVING,
        detail: `inside the post-race recovery window · ${since} of ${context.postRaceWindowDays} days`,
        evidence: {
          daysSinceLastRace: since,
          postRaceWindowDays: context.postRaceWindowDays,
          inPlannedCutback: context.inPlannedCutback,
        },
      });
    }
    return out;
  } catch (err) {
    return [{
      kind: 'unreadable',
      argues: 'proceed_with_caution',
      driving: true,
      detail: 'the convergence verdict could not be read',
      evidence: { reader: 'gradeConvergence', error: String(err) },
    }];
  }
}

/**
 * The acute:chronic ratio. Reported, structurally non-driving — see
 * `ACWR_IS_REPORTED_NEVER_DRIVING`.
 *
 * A null ratio is NOT a failure and does not make the state unreadable:
 * `AcwrResult` already distinguishes "no ratio, and here is why"
 * (`insufficient_coverage` / `insufficient_runs` / `no_chronic_load`) from a
 * thrown read, which is Rule 11 already satisfied one layer down. The reason is
 * carried through so a consumer can tell a cold-start account from a rested one.
 */
async function readAcwr(userId: string, todayISO: string): Promise<RunnerStateSignal[]> {
  try {
    const { computeAcwr } = await import('@/lib/coach/acwr');
    // The threshold is `CONVERGENCE.acwrDanger` — Gabbett's ">1.5 · Danger
    // zone", bound by a `CONVERGENCE.*` registry claim — reused rather than
    // restated, so this signal's wording and the load domain's vote cannot
    // disagree about what a dangerous ratio is. It changes no decision (the
    // signal is non-driving); it decides how the line READS in a log.
    const { CONVERGENCE } = await import('@/lib/coach/convergence');
    const r = await computeAcwr(userId, todayISO);
    return [{
      kind: 'acwr',
      argues: r.acwr != null && r.acwr >= CONVERGENCE.acwrDanger ? 'proceed_with_caution' : 'proceed',
      driving: !ACWR_IS_REPORTED_NEVER_DRIVING,
      detail: r.acwr == null
        ? `acute:chronic unavailable · ${r.reason ?? 'unknown'}`
        : `acute:chronic ${r.acwr.toFixed(2)}`,
      evidence: { ...r },
    }];
  } catch (err) {
    return [{
      kind: 'unreadable',
      argues: 'proceed_with_caution',
      driving: true,
      detail: 'the acute:chronic ratio could not be read',
      evidence: { reader: 'computeAcwr', error: String(err) },
    }];
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · THE COMPILE-TIME GOAL-ISOLATION ASSERTION (§6, §10)
 *
 * The same trick, and the same falsification, as `capacity-resolver.ts` section
 * 0: comparing the whole `Parameters<>` tuple closes the optional-argument door
 * that a plain annotation leaves open. Adding `goalSec?: number` to
 * `resolveRunnerState` makes the line below fail `tsc --noEmit`.
 *
 * A goal has no business in a readiness read for a sharper reason than it has
 * none in a capacity read: a goal that could reach here would let AMBITION make
 * a tired runner read as ready, which is the one direction a safety-shaped
 * signal must never be movable in.
 * ═══════════════════════════════════════════════════════════════════════ */

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type AssertTrue<T extends true> = T;

/** A runner, and a day. Nothing else. */
type StateResolverParams = [userId: string, todayISO?: string];

type _GoalFreeState = AssertTrue<
  Equals<Parameters<typeof resolveRunnerState>, StateResolverParams>
>;

/** Exported so the assertion above is not dead code an unused-locals lint could
 *  delete along with the guarantee it carries. */
export type RunnerStateResolverIsGoalFree = _GoalFreeState;
