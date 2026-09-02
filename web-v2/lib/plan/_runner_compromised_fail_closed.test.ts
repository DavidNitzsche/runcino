/**
 * lib/plan/_runner_compromised_fail_closed.test.ts · runnerIsCompromisedFailClosed
 * (2026-08-31), the one safe-fail wrapper for `runnerIsCompromised`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE BUG. `runnerIsCompromised`'s four call sites disagreed about what an
 * unreadable compromised-check means:
 *
 *   · lib/plan/adapt.ts (inside detectProgressionGate) — FAILED OPEN,
 *     no comment. This gate can emit ACCELERATE (resolveWeekProgression in
 *     progression-gate.ts), the one path in the whole adaptation engine that
 *     pushes a runner's week HARDER — so failing open here could propose
 *     more quality density on a runner whose training-gap state a DB blip
 *     just made unreadable.
 *   · app/api/cron/plan-drift/route.ts:527 and :758 — already FAILED CLOSED,
 *     with an explicit "an unreadable state must propose, not prescribe"
 *     comment (these stand in front of `fireAutoRebuild`).
 *   · app/api/cron/plan-drift/route.ts:1216 (goal-gap rebuild suppression)
 *     — FAILED OPEN, no comment, and could surface a "rebuild to close the
 *     gap?" card built on the exact evidence the guard's own comment says
 *     contaminates that projection.
 *
 * All four now go through `runnerIsCompromisedFailClosed`, which converts
 * ANY rejection of the underlying check into `{ compromised: true, reason:
 * 'gap_reentry' }`.
 *
 * 2026-09-02 · the placeholder reason was `'injury'`, and the check itself
 * read four states: injury, illness, an override niggle, and gap re-entry.
 * Illness, injury and niggle no longer influence any training decision, so
 * `runnerIsCompromised` now reads the training-gap detectors ONLY and
 * `'gap_reentry'` is its single reason. The placeholder moved with it. Note
 * what the placeholder still is NOT: it is not a claim that the runner is
 * re-entering after a gap, it is the refusal to rule that out — which is why
 * the header below insists it never reaches runner-facing copy.
 *
 * WHY THIS FILE INJECTS THE CHECK RATHER THAN MOCKING `runnerIsCompromised`.
 * `runnerIsCompromised` itself cannot currently be made to reject: both of
 * its remaining internal detector calls already end in their own
 * `.catch(() => null | false)` (a SEPARATE, already-documented finding —
 * `lib/audit/coercion-registry.ts`'s `HANDED_BACK` list, PERMISSIVE, still
 * open, explicitly deferred to its own owner). And a same-module function
 * call cannot be intercepted by mocking the module's export from outside —
 * JS/TS closures call the local declaration directly, not through the
 * module namespace object, so `vi.mock('@/lib/plan/adapt', ...)` here would
 * have no effect on what `runnerIsCompromisedFailClosed` actually invokes.
 * `runnerIsCompromisedFailClosed` therefore takes the check as an optional,
 * DI-style second parameter defaulting to the real `runnerIsCompromised` —
 * every real call site is unaffected — so this file can supply a rejecting
 * fake and prove the safe-fail conversion directly, with no DB involved.
 */
import { describe, it, expect } from 'vitest';
import { runnerIsCompromisedFailClosed } from './adapt';

describe('runnerIsCompromisedFailClosed · the underlying check rejects', () => {
  it('converts a rejection into compromised:true, never compromised:false', async () => {
    const rejecting = async (): Promise<never> => {
      throw new Error('connection terminated unexpectedly');
    };
    const result = await runnerIsCompromisedFailClosed('user-1', rejecting);

    expect(result.compromised).toBe(true);
    if (result.compromised) {
      // The placeholder reason: it does not claim to know the runner IS in
      // a gap re-entry, only that it could not rule it out.
      expect(result.reason).toBe('gap_reentry');
    }
  });

  it('never throws itself, even when the underlying check rejects', async () => {
    const rejecting = async (): Promise<never> => {
      throw new Error('timeout');
    };
    await expect(runnerIsCompromisedFailClosed('user-1', rejecting)).resolves.toBeDefined();
  });

  it('a rejected promise (not just a thrown error) also fails closed', async () => {
    const rejecting = () => Promise.reject(new Error('ECONNRESET'));
    const result = await runnerIsCompromisedFailClosed('user-1', rejecting);
    expect(result).toEqual({ compromised: true, reason: 'gap_reentry' });
  });
});

describe('runnerIsCompromisedFailClosed · success path unchanged', () => {
  it('passes through compromised:false exactly', async () => {
    const clean = async () => ({ compromised: false as const });
    const result = await runnerIsCompromisedFailClosed('user-1', clean);
    expect(result).toEqual({ compromised: false });
  });

  it('passes through a genuine compromised:true with its real reason, unchanged', async () => {
    // Retagged 2026-09-02 · the fake used to return `reason: 'niggle'`, one of
    // the four reasons the check could produce. Only `gap_reentry` survives,
    // so the pass-through is proved on that. It is a weaker fixture than it
    // was — with one reason in the union, "passes the reason through" and
    // "returns the placeholder" produce the same value — so the test above it
    // is the one that carries the fail-closed property, and this one only
    // pins that a genuine true is not rewritten into something else.
    const gapped = async () => ({ compromised: true as const, reason: 'gap_reentry' as const });
    const result = await runnerIsCompromisedFailClosed('user-1', gapped);
    expect(result).toEqual({ compromised: true, reason: 'gap_reentry' });
  });

  // Deliberately NOT tested here: calling `runnerIsCompromisedFailClosed`
  // with no second argument, to exercise the default-to-real-`runnerIsCompromised`
  // path. That path hits `@/lib/db/pool` with no mock in this file, and
  // `vitest.config.ts` loads `.env.local`, which on a developer machine holds
  // the PRODUCTION `DATABASE_URL` (see that file's own comment on why
  // `lib/adaptation-harness/**` is excluded from `npm test` for the same
  // reason). The default parameter's WIRING is covered instead by the
  // `_plan_drift_lifecycle.test.ts` route-level tests, which mock the module
  // boundary one level up and never touch a real connection.
});
