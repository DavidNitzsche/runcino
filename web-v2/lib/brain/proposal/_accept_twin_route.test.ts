/**
 * lib/brain/proposal/_accept_twin_route.test.ts · ACCEPTTWIN-1 (2026-09-13)
 *
 * THE REAL ROUTE HANDLER, THE REAL RESPONSE OBJECT.
 *
 * `_accept_twin_status.test.ts` proves the lib carries the refusal and scans
 * the route's source. Source scans are how this chain has verified the last
 * hop so far, and a source scan is exactly the instrument that CANNOT see a
 * route which computes the right values and then builds the wrong body. So
 * this file invokes `POST` itself and reads `res.status` and `await
 * res.json()` — what actually goes on the wire.
 *
 * ── WHY THIS FILE EXISTS SEPARATELY ────────────────────────────────────────
 *
 * The round-6 reviewer's standing requirement for N1 was: "whoever fixes N1
 * owes Rule 13 a real render." This file does NOT discharge that. It is a
 * strictly weaker instrument and says so:
 *
 *   · It proves what the SERVER emits, with the real handler.
 *   · It does NOT prove what the PHONE draws. No Swift runs here.
 *
 * The phone half is a DERIVATION from `APIV5.answerProposal`'s source
 * (native-v2/Faff/Faff/DesignV5/APIV5.swift:2276-2318), quoted in the assertion
 * comments below so the next reader can check the derivation rather than trust
 * it. The device render is named as NOT DONE in the round-7 handback, which is
 * Rule 13's own instruction for a fix that cannot be verified that way.
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ────────────────────────────────
 *
 * · The phone. See above. The `answerProposal` logic below is a hand port; if
 *   the Swift changes, nothing here notices.
 * · Whether `mutatePlan` really refuses when migration 166 is absent. Mocked.
 * · Auth, staleness and the legacy lane. All stubbed past, deliberately — this
 *   file is about ONE branch, the `applyBrainAction` refusal.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/* The route's collaborators. Everything up to the branch under test is stubbed
 * to the shortest path that reaches it. */
vi.mock('@/lib/auth/session', () => ({
  requireUserId: vi.fn(async () => 'abcdef12-3456-7890-abcd-ef1234567890'),
}));
vi.mock('@/lib/plan/workout-proposals', () => ({
  loadPendingProposalById: vi.fn(),
  acceptProposal: vi.fn(),
  reopenProposal: vi.fn(async () => ({ ok: true, reopened: true })),
  resolveProposalExpirationPromise: vi.fn(async () => undefined),
}));
vi.mock('@/lib/brain/proposal/staleness', () => ({
  readLiveRows: vi.fn(async () => []),
  actionFromPending: vi.fn(),
  LEGACY_MUTATING_ACTION_KINDS: new Set<string>(),
}));
vi.mock('@/lib/brain/proposal/execute', () => ({
  prepareAction: vi.fn(() => ({ ok: true, plan: { nonMutating: false, because: '' } })),
}));
vi.mock('@/lib/brain/proposal/accept', () => ({ applyBrainAction: vi.fn() }));
vi.mock('@/lib/runtime/runner-tz', () => ({ runnerToday: vi.fn(async () => '2026-09-13') }));
vi.mock('@/lib/coach/cache', () => ({ bustBriefingCacheForEvent: vi.fn(async () => undefined) }));
vi.mock('@/lib/plan/adapt', () => ({ applyAdaptations: vi.fn() }));

import { POST } from '@/app/api/plan/workout-proposals/[id]/accept/route';
import { loadPendingProposalById, acceptProposal } from '@/lib/plan/workout-proposals';
import { actionFromPending } from '@/lib/brain/proposal/staleness';
import { applyBrainAction } from '@/lib/brain/proposal/accept';
import { refusalFor } from '@/lib/plan/mutation-refusal';

const ACTION = { kind: 'PACE_CHANGE', before: [{ planWorkoutId: 'w1' }] };

/** A pending row that carries a stored action, so the route takes the
 *  `applyBrainAction` lane rather than reprice or legacy. */
const PROPOSAL = {
  id: 7,
  planWorkoutId: 'w1',
  actionKind: 'PACE_CHANGE',
  actionPayload: { action: ACTION, why: 'the coach proposed this' },
  reason: 'the coach proposed this',
};

function request() {
  return new Request('http://localhost/api/plan/workout-proposals/7/accept', {
    method: 'POST', body: '{}',
  }) as never;
}
const ctx = { params: Promise.resolve({ id: '7' }) };

/**
 * `APIV5.answerProposal`'s non-2xx handling, ported by hand from
 * native-v2/Faff/Faff/DesignV5/APIV5.swift:2276-2318. Verbatim structure:
 *
 *     if (200...299).contains(http.statusCode) { return .ok }
 *     if (400...499).contains(http.statusCode),
 *        let r = try? JSONDecoder().decode(V5Refusal.self, from: data),
 *        let text = r.refusal ?? r.reason, !text.isEmpty {
 *         return .refused(text)
 *     }
 *     if http.statusCode == 409 { return .refused(FABRICATED) }
 *     return .failed
 *
 * `V5Refusal` is `{ error: String?, reason: String?, refusal: String? }` —
 * every field optional, so the decode itself never fails on a JSON object; the
 * emptiness guard is the `let text = ...` binding.
 */
const FABRICATED = 'This session has changed since the coach proposed it, '
  + 'so the decision no longer fits. It will be raised again '
  + 'against the session as it stands.';

function phoneWouldShow(status: number, body: Record<string, unknown>): string {
  if (status >= 200 && status <= 299) return '<ok>';
  if (status >= 400 && status <= 499) {
    const text = (body.refusal ?? body.reason) as string | undefined;
    if (typeof text === 'string' && text.length > 0) return text;
  }
  if (status === 409) return FABRICATED;
  return '<generic failure>';
}

describe('ACCEPTTWIN-1 · the accept route, invoked, on a ledger_unwritten refusal', () => {
  beforeEach(() => {
    vi.mocked(loadPendingProposalById).mockResolvedValue({ ok: true, proposal: PROPOSAL } as never);
    vi.mocked(acceptProposal).mockResolvedValue(PROPOSAL as never);
    vi.mocked(actionFromPending).mockReturnValue(ACTION as never);
  });

  it('answers 503, carries retryable, and carries the coach sentence under `reason`', async () => {
    const refusal = refusalFor({ outcome: 'ledger_unwritten', violations: [] }, { thing: 'That change' });
    vi.mocked(applyBrainAction).mockResolvedValue({
      ok: false,
      error: 'unverified',
      detail: `${refusal.reason} (plan_decision_ledger is not present)`,
      reason: refusal.reason,
      status: refusal.status,
      retryable: refusal.retryable,
    } as never);

    const res = await POST(request(), ctx);
    const body = await res.json();

    // THE WIRE, not a source scan.
    expect(res.status, 'the route still answers a bare 409 for a ledger failure').toBe(503);
    expect(body.retryable, 'retryable did not reach the wire').toBe(true);
    expect(body.reason, 'the coach sentence did not reach the wire').toBe(refusal.reason);
    expect(body.error).toBe('unverified');
    // `detail` still carries the machine half, unchanged, for logs and web.
    expect(body.detail).toContain('plan_decision_ledger');
    // And the sentence the phone reads is NOT polluted with it.
    expect(body.reason).not.toContain('plan_decision_ledger');
  });

  it('THE FABRICATION IS UNREACHABLE · the phone no longer prints a stale-session lie', async () => {
    const refusal = refusalFor({ outcome: 'ledger_unwritten', violations: [] }, { thing: 'That change' });
    vi.mocked(applyBrainAction).mockResolvedValue({
      ok: false, error: 'unverified', detail: 'x',
      reason: refusal.reason, status: refusal.status, retryable: refusal.retryable,
    } as never);

    const res = await POST(request(), ctx);
    const shown = phoneWouldShow(res.status, await res.json());

    expect(shown, 'the phone is still printing the fabricated stale-session sentence')
      .not.toBe(FABRICATED);
    // 503 is outside the decode window, so the runner gets the generic failure
    // state rather than a false CAUSE. That is the fix: the lie is gone. Making
    // the coach sentence itself reach the phone on a 5xx is a NATIVE change
    // (`answerProposal` would have to widen its window), named in the handback
    // and deliberately not attempted from a web-only branch.
    expect(shown).toBe('<generic failure>');
  });

  it('THE BUG, REPRODUCED · the round-6 body on the round-6 status DID print the lie', () => {
    // Exactly what `473b61cdc` emitted: status 409 from the hand ladder, and a
    // body with neither `refusal` nor `reason`.
    const shown = phoneWouldShow(409, { ok: false, error: 'unverified', detail: 'a row id' });
    expect(shown, 'the reproduction no longer reproduces; re-check the port above')
      .toBe(FABRICATED);
  });

  it('a doctrine rejection IS a 409, and now carries its own sentence rather than borrowing one', async () => {
    const refusal = refusalFor({ outcome: 'rejected', violations: ['cap'] }, { thing: 'That change' });
    vi.mocked(applyBrainAction).mockResolvedValue({
      ok: false, error: 'rejected', detail: 'x',
      reason: refusal.reason, status: refusal.status, retryable: refusal.retryable,
    } as never);

    const res = await POST(request(), ctx);
    const body = await res.json();
    expect(res.status, 'a doctrine rejection is a genuine conflict and stays 409').toBe(409);
    expect(body.retryable).toBe(false);

    const shown = phoneWouldShow(res.status, body);
    // Still a 409 — inside the fabrication window — but `reason` is present now,
    // so the decode branch wins and the runner reads the TRUE sentence.
    expect(shown).toBe(refusal.reason);
    expect(shown).not.toBe(FABRICATED);
  });

  it('an error the applier raises itself keeps its old status · the fix changes nothing else', async () => {
    vi.mocked(applyBrainAction).mockResolvedValue({
      ok: false, error: 'unsupported', detail: 'no executor for this kind',
    } as never);
    const res = await POST(request(), ctx);
    expect(res.status, 'the route-local fallback ladder stopped answering').toBe(422);
    const body = await res.json();
    // Rule 11 · no opinion was carried, so none is invented on the wire.
    expect('retryable' in body, 'a retryability nobody stated was fabricated').toBe(false);
  });
});
