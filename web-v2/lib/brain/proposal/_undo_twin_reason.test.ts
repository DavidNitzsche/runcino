/**
 * lib/brain/proposal/_undo_twin_reason.test.ts · UNDOTWIN-1 (2026-09-13)
 *
 * Round 8 of the archived-plan-mutation-guard review, and the last finding of
 * the accept/undo pair. Falsified against `9b1656ff1` (the round-7 tree) before
 * this file landed.
 *
 * ══ N9 · THE UNDO TWIN STILL FABRICATES ═════════════════════════════════════
 *
 * Round 6 (STATUSCARRY-1) gave `POST /api/plan/workout-proposals/[id]/undo` the
 * STATUS half of the carry. Round 7 (ACCEPTTWIN-1) then proved, on the sibling
 * accept route, that the status half ALONE does not close the hole, and added
 * `reason`. That second half never reached the undo twin.
 *
 * Why the status half cannot cover it. A DOCTRINE rejection is a genuine 409,
 * so carrying the status changes nothing for it — it was 409 before and it is
 * 409 after. The undo route answered that 409 with `{ ok, error, detail }` and
 * no `reason`, and `detail` is machine text carrying the boundary's violation
 * strings, which name plan row ids and are forbidden from reaching a runner.
 * So the phone had nothing readable, and `HostsV5.swift`'s `undo(_:)` printed
 * a sentence it wrote itself:
 *
 *     "Something else has moved this session since. Taking it back now would
 *      write over that change."
 *
 * Nothing had moved the session. `movedSinceAccept` runs BEFORE the boundary
 * and returns `error: 'stale'` when it finds movement — so by construction, a
 * `rejected` from this route is a refusal in which the session did NOT move.
 * The one sentence the phone prints for it is the one thing that is provably
 * false. And it is printed on the control the whole proposal lane rests on:
 * "approval is not the control mechanism; reversibility is".
 *
 * ══ RULE 22 · WHAT THIS SUITE CANNOT FAIL ON ════════════════════════════════
 *
 * · THE PHONE. No Swift is executed. The Swift half of this fix (teaching
 *   `APIV5.undoProposal` to return the reason and `HostsV5.undo(_:)` to print
 *   it instead of its own sentence) is pinned by SOURCE assertions below, not
 *   by a render. Rule 13 is not satisfied by this file and does not claim to
 *   be; the honest statement is in the handback.
 * · WHETHER THE BOUNDARY SHOULD HAVE REFUSED. `_mutation_read_honesty.db.test`
 *   owns that. This file only asserts the refusal is transported honestly.
 * · THE STALE AND NOT_UNDOABLE LIMBS. Those never pass through `refusalFor`,
 *   carry no `reason`, and are excluded on purpose: their `because` is already
 *   a true coach sentence and the phone's 409 text happens to match `stale`.
 *   Named as uncovered rather than implied to be covered.
 * · THE REAL SQL. `mutatePlan` is mocked entirely.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('@/lib/plan/mutate', () => ({ mutatePlan: vi.fn() }));
vi.mock('./staleness', async (orig) => ({
  ...(await orig<typeof import('./staleness')>()),
  // The undo's own staleness check runs first and must PASS, or the boundary
  // is never reached and this suite would be testing the wrong refusal.
  readLiveRows: vi.fn(),
}));
vi.mock('@/lib/brain/ledger/decision-ledger', () => ({
  findLiveAcceptedLedgerRow: vi.fn(async () => null),
}));

import { mutatePlan } from '@/lib/plan/mutate';
import { readLiveRows } from './staleness';
import { applyUndo } from './undo-apply';
import { refusalFor, httpStatusForRefusal } from '@/lib/plan/mutation-refusal';
import type { BrainAction } from './action';

const REPO = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(REPO, rel), 'utf8');
const NATIVE = join(REPO, '..', 'native-v2', 'Faff', 'Faff');
const readSwift = (rel: string) => readFileSync(join(NATIVE, rel), 'utf8');

const USER = 'abcdef12-3456-7890-abcd-ef1234567890';

/** A RESCHEDULE has a real, invertible `before`, so `undoWritesFor` produces a
 *  write plan and the boundary is actually reached. */
const ACTION = {
  schemaVersion: 1,
  direction: 'pull',
  kind: 'RESCHEDULE',
  toDateISO: '2026-09-20',
  before: [{ planWorkoutId: 'w1', dateISO: '2026-09-18', type: 'tempo' }],
} as unknown as BrainAction;

const CTX = {
  userUuid: USER,
  todayISO: '2026-09-13',
  proposalId: 42,
  reason: 'the runner reversed this decision',
};

/** The row as the accept left it, so `movedSinceAccept` passes cleanly. */
const UNMOVED = new Map([['w1', { planWorkoutId: 'w1', dateISO: '2026-09-20', type: 'tempo', distanceMi: 6 }]]);

/* ══════════════════════════════════════════════════════════════════════════
 * part 1 · applyUndo carries what refusalFor decided
 * ═══════════════════════════════════════════════════════════════════════ */

describe('UNDOTWIN-1 · applyUndo carries the reason, not only the status', () => {
  beforeEach(() => {
    vi.mocked(mutatePlan).mockReset();
    vi.mocked(readLiveRows).mockReset();
    vi.mocked(readLiveRows).mockResolvedValue(UNMOVED as never);
  });

  it('THE BUG · a DOCTRINE rejection is a 409, so the status carry alone changes nothing', async () => {
    vi.mocked(mutatePlan).mockResolvedValue({
      ok: false, outcome: 'rejected', violations: ['plan_workout wko_1cf8 exceeds the weekly cap'], value: null,
    } as never);

    const outcome = await applyUndo(ACTION, CTX);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;

    // Round 6 already got these right, and they are exactly why the hole
    // survived: nothing about the STATUS is wrong on this limb.
    expect(outcome.error).toBe('rejected');
    expect(outcome.status, 'a doctrine rejection is legitimately 409').toBe(409);
    expect(outcome.retryable).toBe(false);
    // 409 is squarely inside the window in which the phone writes its own text.
    expect(outcome.status).toBeGreaterThanOrEqual(400);
    expect(outcome.status).toBeLessThan(500);

    // THE FIX. Without this the phone has nothing readable and fabricates.
    expect(
      outcome.reason,
      'the coach sentence is missing, so the phone falls back to "Something else has '
      + 'moved this session since" over a refusal in which nothing moved',
    ).toBeTruthy();
    // Read out of the resolver rather than retyped, so this cannot pass by
    // agreeing with itself (Rule 18).
    expect(outcome.reason).toBe(
      refusalFor({ outcome: 'rejected', violations: [] }, { thing: 'Putting that back' }).reason,
    );
    // And the runner-facing half must not be carrying the machine half.
    expect(outcome.reason, 'the reason is carrying a plan row id').not.toContain('wko_1cf8');
    // While `because` still does, unchanged, for the log.
    expect(outcome.because).toContain('wko_1cf8');
  });

  it('a ledger_unwritten refusal carries 503, retryable AND the same reason key', async () => {
    vi.mocked(mutatePlan).mockResolvedValue({
      ok: false, outcome: 'ledger_unwritten',
      violations: ['plan_decision_ledger is not present in this database'], value: null,
    } as never);

    const outcome = await applyUndo(ACTION, CTX);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toBe('unverified');
    expect(outcome.status).toBe(503);
    expect(outcome.retryable).toBe(true);
    expect(outcome.reason).toBe(
      refusalFor({ outcome: 'ledger_unwritten', violations: [] }, { thing: 'Putting that back' }).reason,
    );
    expect(outcome.reason).not.toContain('plan_decision_ledger');
  });

  it('a plan_verification_failed refusal is not dressed up as a doctrine refusal', async () => {
    vi.mocked(mutatePlan).mockResolvedValue({
      ok: false, outcome: 'plan_verification_failed', violations: ['the plan read threw'], value: null,
    } as never);

    const outcome = await applyUndo(ACTION, CTX);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error, 'a failed read is NOT the coach refusing').toBe('unverified');
    expect(outcome.status).toBe(503);
    expect(outcome.retryable).toBe(true);
    expect(outcome.reason).toContain('Nothing has changed');
  });

  it('the reason is the SAME sentence the accept twin carries, modulo its subject', async () => {
    /* Rule 16 · one refusal, one wording. The only thing that may differ
     * between the two routes is the subject noun phrase. */
    const undo = refusalFor({ outcome: 'rejected', violations: [] }, { thing: 'Putting that back' });
    const accept = refusalFor({ outcome: 'rejected', violations: [] }, { thing: 'That change' });
    expect(undo.reason.replace('Putting that back', 'X'))
      .toBe(accept.reason.replace('That change', 'X'));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * part 2 · the route spends it
 * ═══════════════════════════════════════════════════════════════════════ */

describe('UNDOTWIN-1 · the undo route emits reason on the wire', () => {
  const ROUTE = 'app/api/plan/workout-proposals/[id]/undo/route.ts';

  it('LIVENESS · the route file was read and still answers a refusal', () => {
    const src = read(ROUTE);
    expect(src.length, 'the route file was not read').toBeGreaterThan(1000);
    expect(src).toContain('httpStatusForRefusal');
    expect(src).toContain('applyUndo');
  });

  it('SOURCE · the refusal body carries reason and retryable, and detail stays machine-only', () => {
    const code = read(ROUTE).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    expect(code, 'the response body dropped `reason` again, so the phone fabricates')
      .toContain('reason: outcome.reason');
    expect(code, 'the guarded retryable spread is gone')
      .toMatch(/\.\.\.\(outcome\.retryable === undefined \?/);
    expect(code, '`detail` must still carry the machine text, unchanged')
      .toContain('detail: outcome.because');
    expect(code, 'a hardcoded retryability the boundary did not state')
      .not.toMatch(/retryable:\s*(true|false)\b/);
  });

  it('the status resolver is still the shared one and still answers the local ladder', () => {
    const local = { not_undoable: 422, apply_failed: 500 };
    // Carried statuses win.
    expect(httpStatusForRefusal({ code: 'rejected', status: 409 }, local, 409)).toBe(409);
    expect(httpStatusForRefusal({ code: 'unverified', status: 503 }, local, 409)).toBe(503);
    // Locally-raised codes keep their own answers.
    expect(httpStatusForRefusal({ code: 'not_undoable' }, local, 409)).toBe(422);
    expect(httpStatusForRefusal({ code: 'apply_failed' }, local, 409)).toBe(500);
    expect(httpStatusForRefusal({ code: 'stale' }, local, 409)).toBe(409);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * part 3 · the phone stops writing the sentence
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A backend that carries `reason` while the client discards the body is the
 * "wired, tested and inert" failure CLAUDE.md names. `undoProposal` returned
 * `(ok, status)` and threw the body away, so the server-side half of this fix
 * would have been unreachable on its own. These are SOURCE assertions, which is
 * weaker than a render and is stated as such in the Rule 22 note above.
 */

describe('UNDOTWIN-1 · the phone reads the reason instead of inventing one', () => {
  it('LIVENESS · both Swift files were read', () => {
    expect(readSwift('DesignV5/APIV5.swift').length).toBeGreaterThan(10000);
    expect(readSwift('ViewsV5/HostsV5.swift').length).toBeGreaterThan(10000);
  });

  it('undoProposal decodes the refusal body rather than discarding it', () => {
    const src = readSwift('DesignV5/APIV5.swift');
    const fn = src.slice(src.indexOf('static func undoProposal'));
    const body = fn.slice(0, fn.indexOf('\n    /// '));
    expect(body, 'undoProposal still throws the response body away')
      .toContain('V5Refusal');
    expect(body, 'it must read the same key pair every other refusal site reads')
      .toContain('r.refusal ?? r.reason');
  });

  it('the fabricated stale-session sentence is gone from the undo handler', () => {
    const src = readSwift('ViewsV5/HostsV5.swift');
    expect(
      src,
      'HostsV5 still writes "Something else has moved this session since" on the '
      + 'phone\'s own authority. The route now carries the engine\'s sentence; '
      + 'printing an invented one over it is the defect this finding is about.',
    ).not.toContain('Something else has moved this session since');
  });
});
