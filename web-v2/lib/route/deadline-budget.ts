/**
 * lib/route/deadline-budget.ts — a cooperative time budget for a multi-phase
 * server-side computation.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS, AND WHY IT IS NOT `withDeadline`
 *
 * `plan-snapshot.ts`'s `withDeadline` races a promise against a timer. That
 * is the right shape for a single opaque call, and it stays correct for
 * that case — its own tests still pass. It is the WRONG shape for a
 * computation made of several sequential phases (a DB read, then another
 * DB read, then a pure compose step), because racing the WHOLE chain means
 * the client stops waiting while every phase already in flight keeps
 * running to completion anyway — per BA01-CODE-FORENSIC-2026-09-15.md's own
 * finding, and BACKEND-IMPLEMENTATION-SCOPE-AND-SETUP-2026-09-15.md item 9:
 * "Deadline checks must be cooperative between expensive phases. Do not add
 * another `Promise.race` that leaves all work running silently."
 *
 * A `DeadlineBudget` does not race anything and cannot abandon a promise
 * mid-flight — it cannot, by construction, since it never wraps one in a
 * timer. It is a clock a multi-phase function consults BETWEEN phases: if
 * the budget is already spent, the function declines to START the next
 * phase and returns a `{status:'timeout', lastStage}` result naming exactly
 * how far it got (item 8: "record the last completed stage"). A phase that
 * has already started is always allowed to finish naturally — the phases
 * this budget guards are backed by `lib/db/pool.ts`'s own 30s
 * `statement_timeout`, which is the layer responsible for bounding a single
 * runaway statement. This budget's job is narrower and different: stop a
 * slow-but-not-hung chain from silently compounding phase after phase past
 * the point where the answer is still useful to the caller.
 */

/**
 * The tagged result every cooperative deadline check returns. Moved here
 * from `lib/plan/plan-snapshot.ts` (where `withDeadline` first defined it)
 * so BOTH mechanisms — the older opaque race and the newer between-phase
 * check — share one shape and one set of consumers never has to narrow two
 * differently-named unions for the same three outcomes. `plan-snapshot.ts`
 * re-exports this name for its own existing importers.
 *
 * The `timeout` branch carries NO `value` field, same discipline
 * `NormalReading<T>` uses for Rule 8's refusal-versus-zero distinction: a
 * genuinely-resolved `null` can never be mistaken for "we didn't get an
 * answer in time."
 */
export type DeadlineResult<T> =
  | { status: 'ok'; value: T }
  /** `lastStage` is BA-01R item 8's "record the last completed stage" —
   *  optional so a `withDeadline` caller (which has no phase to name) still
   *  satisfies the type with a bare `{status:'timeout'}`. */
  | { status: 'timeout'; lastStage?: string }
  | { status: 'error'; error: unknown };

export class DeadlineBudget {
  private readonly deadlineAt: number;
  private stage: string;

  constructor(budgetMs: number, startStage = 'start') {
    this.deadlineAt = Date.now() + budgetMs;
    this.stage = startStage;
  }

  /** True once the budget is spent. Never goes back to false. */
  get expired(): boolean {
    return Date.now() >= this.deadlineAt;
  }

  get remainingMs(): number {
    return Math.max(0, this.deadlineAt - Date.now());
  }

  /** Called by the guarded function after each phase completes — never
   *  before, so `lastStage` always names a phase that actually finished. */
  markStage(name: string): void {
    this.stage = name;
  }

  get lastStage(): string {
    return this.stage;
  }
}
