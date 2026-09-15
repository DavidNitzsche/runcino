/**
 * lib/ops/_safety_readiness_check.test.ts · F126 (2026-09-15)
 *
 * Split the same way `_cron_stale_alert.test.ts` is: this mocks the alert
 * dispatcher (`@/lib/ops/alerts`) so it can assert on the ALERT rather than
 * on the safety arithmetic `mayEmitRunnableWorkout` already owns and already
 * tests elsewhere (`lib/safety/_safety_verdict*.test.ts`).
 *
 * WHAT THIS PROVES
 *
 *   · Safety forbids a runnable session (STOP or UNKNOWN posture) AND the
 *     response actually names one -> `raiseAlert` fires with the new kind.
 *   · Safety allows one (PRESCRIBE/EASY_ONLY, the ordinary day) -> silent,
 *     even though a session shipped — that is the correct, expected case and
 *     firing on it would make this alert noise nobody reads.
 *   · Safety forbids one AND the response correctly carries none either (the
 *     common, CORRECT stop-day case, e.g. the injury/illness/unknown panels
 *     `v5/today` already returns before reaching the branch this check sits
 *     in) -> silent. This is the direction a suite written by somebody only
 *     worried about missed detections would forget to assert (Rule 22).
 *
 * WHAT THIS CANNOT FAIL ON: the `ops_alerts` INSERT itself — `raiseAlert` is
 * fully mocked here, the same boundary `_cron_stale_alert.test.ts` draws.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { InjurySignal, SafetyResolution } from '@/lib/safety/safety-verdict';

const raised: Array<Record<string, unknown>> = [];
vi.mock('@/lib/ops/alerts', () => ({
  raiseAlert: async (input: Record<string, unknown>) => { raised.push(input); },
}));

const { detectSafetyReadinessMismatch } = await import('./safety-readiness-check');

beforeEach(() => {
  raised.length = 0;
});

const stopVerdict: SafetyResolution = {
  known: true,
  state: 'STOP',
  posture: 'NO_TRAINING',
  reason: 'injury_major',
  driver: 'injury',
  injury: {
    id: 1,
    site: 'knee',
    severity: 'major',
    startDateISO: '2026-09-10',
    expectedReturnDateISO: null,
    returnProtocol: null,
    notes: null,
  } satisfies InjurySignal,
  illness: null,
  niggle: null,
  returnToRunning: null,
  disruption: null,
  degradedSignals: [],
  explain: 'safety STOP · reason=injury_major · driver=injury',
};

const unknownVerdict: SafetyResolution = {
  known: false,
  posture: 'WITHHOLD_PENDING_CHECK',
  unreadable: [{ signal: 'injury', failure: 'READ_FAILED' }],
  floor: 'NORMAL',
  explain: 'safety UNKNOWN · the resolver did not run for this caller',
};

const normalVerdict: SafetyResolution = {
  known: true,
  state: 'NORMAL',
  posture: 'PRESCRIBE',
  reason: 'clear',
  driver: null,
  injury: null,
  illness: null,
  niggle: null,
  returnToRunning: null,
  disruption: null,
  degradedSignals: [],
  explain: 'safety NORMAL · reason=clear · driver=none',
};

describe('detectSafetyReadinessMismatch', () => {
  it('FIRES when Safety says STOP (mayEmitRunnableWorkout false) but a session shipped anyway', async () => {
    const fired = await detectSafetyReadinessMismatch(
      stopVerdict,
      /* hasRunnableSession */ true,
      { planId: 'plan-1', dateISO: '2026-09-15', plannedType: 'easy' },
    );

    expect(fired).toBe(true);
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({ kind: 'safety_readiness_mismatch', severity: 'error' });
    expect(String(raised[0].message)).toMatch(/F126/);
    expect(String(raised[0].message)).toMatch(/mayEmitRunnableWorkout/);
    expect(raised[0].metadata).toMatchObject({
      safety: { known: true, state: 'STOP', driver: 'injury' },
      session: { planId: 'plan-1', dateISO: '2026-09-15', plannedType: 'easy' },
    });
  });

  it('FIRES when Safety is UNKNOWN (mayEmitRunnableWorkout false) but a session shipped anyway', async () => {
    const fired = await detectSafetyReadinessMismatch(
      unknownVerdict,
      true,
      { planId: 'plan-2', dateISO: '2026-09-15', plannedType: 'long' },
    );

    expect(fired).toBe(true);
    expect(raised).toHaveLength(1);
    expect(raised[0].metadata).toMatchObject({ safety: { known: false, posture: 'WITHHOLD_PENDING_CHECK' } });
  });

  it('STAYS QUIET on the ordinary day: Safety clears a session and one shipped', async () => {
    const fired = await detectSafetyReadinessMismatch(normalVerdict, true, { planId: 'plan-3' });

    expect(fired).toBe(false);
    expect(raised).toHaveLength(0);
  });

  it('STAYS QUIET on the correct stop day: Safety says STOP and no session shipped', async () => {
    // The common, CORRECT case — e.g. the injury/illness/unknown panels
    // `v5/today` already returns before ever reaching this check.
    const fired = await detectSafetyReadinessMismatch(stopVerdict, false, null);

    expect(fired).toBe(false);
    expect(raised).toHaveLength(0);
  });

  it('STAYS QUIET on UNKNOWN with no session shipped', async () => {
    const fired = await detectSafetyReadinessMismatch(unknownVerdict, false, null);

    expect(fired).toBe(false);
    expect(raised).toHaveLength(0);
  });
});
