/**
 * lib/brain/proposal/_accept_twin_status.test.ts · ACCEPTTWIN-1 (2026-09-13)
 *
 * Round 7 of the archived-plan-mutation-guard review. Four findings, all
 * FALSIFIED against `473b61cdc` (the round-6 tree) before this file landed.
 *
 * ══ N1 · THE UNTOUCHED TWIN ═════════════════════════════════════════════════
 *
 * `STATUSCARRY-1` fixed six routes and left the seventh. `POST
 * /api/plan/workout-proposals/[id]/accept` — the LET IT HAPPEN button — still
 * hand-derived its status:
 *
 *     const status = outcome.error === 'unsupported' ? 422
 *       : outcome.error === 'apply_failed' ? 500 : 409;
 *     return NextResponse.json({ ok: false, error, detail }, { status });
 *
 * Under the condition this entire review chain has been about — migration 166
 * absent from production, so `landDecisionInTransaction` refuses every
 * structural mutation with `ledger_unwritten` — `applyBrainAction` answers
 * `error: 'unverified'`, which that `: 409` tail catches. `refusalFor` had
 * already resolved 503 / `retryable: true` and `applyBrainAction` was already
 * carrying both; the route dropped them on the last hop.
 *
 * WHAT THE RUNNER SAW, and why the status alone is not the whole bug.
 * `APIV5.answerProposal` (native-v2/Faff/Faff/DesignV5/APIV5.swift:2242) tries
 * a `V5Refusal` decode on any 4xx and reads `r.refusal ?? r.reason`. The route
 * emitted NEITHER key — the honest sentence was in `detail`, which the phone's
 * own doc comment forbids printing ("it names a row id and is machine text").
 * So the decode yielded nothing, control fell to `if http.statusCode == 409`,
 * and the phone printed a sentence it wrote itself:
 *
 *     "This session has changed since the coach proposed it, so the decision
 *      no longer fits. It will be raised again against the session as it
 *      stands."
 *
 * Nothing about the session had changed. A ledger row could not be written.
 * The runner is told his card is stale — so he will not retry, and retrying is
 * the only thing that would have worked.
 *
 * THREE THINGS MOVE, and the suite checks all three, because any one alone
 * leaves the fabrication reachable:
 *   · `status` 409 -> 503, which is outside the phone's 4xx fabrication window.
 *   · `reason`, the coach sentence, under the key the phone actually READS —
 *     so a refusal that legitimately IS 409 (a doctrine rejection) also stops
 *     borrowing the stale-session sentence.
 *   · `retryable`, Rule 11 on the wire.
 *
 * ══ N4 · rebuild_failed · AN UNDISCLOSED STATUS CHANGE, ADJUDICATED ═════════
 *
 * See the block comment above its own describe() below. Short version: the
 * change 409 -> 500 was real, undisclosed, and CORRECT. It is pinned here so
 * it is a decision rather than an accident.
 *
 * ══ N5 · retryable ON THE WIRE ══════════════════════════════════════════════
 *
 * Six response bodies across four route files dropped `retryable` while their
 * source outcome carried it. Scanned below, per site.
 *
 * ══ RULE 22 · WHAT THIS SUITE CANNOT FAIL ON ════════════════════════════════
 *
 * · THE PHONE. No Swift is executed here. That `answerProposal` stops
 *   fabricating is a DERIVATION from its source (its fabrication branch is
 *   guarded by `(400...499).contains` and `statusCode == 409`, and 503 is
 *   neither), not a rendered verification. Rule 13 is not satisfied by this
 *   file and does not claim to be; the honest statement is in the handback.
 * · WHETHER `ledger_unwritten` IS THE RIGHT OUTCOME for an absent migration
 *   166. That is `_mutation_read_honesty.db.test.ts`'s claim. This file only
 *   asserts that whatever outcome is chosen is transported honestly.
 * · A NEW route that invents its own mapping. The route lists below are fixed
 *   pins, not a discovery pass, exactly as `_mutation_status_carry.test.ts`'s
 *   are. Named as the gap rather than implied to be covered.
 * · The real `mutatePlan` SQL. It is mocked entirely.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('@/lib/plan/mutate', () => ({ mutatePlan: vi.fn() }));

import { mutatePlan } from '@/lib/plan/mutate';
import { applyBrainAction, type AcceptContext } from './accept';
import { refusalFor, httpStatusForRefusal } from '@/lib/plan/mutation-refusal';
import type { BrainAction } from './action';

const REPO = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(REPO, rel), 'utf8');

const USER = 'abcdef12-3456-7890-abcd-ef1234567890';

/** A PACE_CHANGE routes to DIRECT_PLAN_WRITE, which is the limb that calls
 *  `mutatePlan` and therefore the only one that can carry a boundary refusal. */
const ACTION = {
  schemaVersion: 1,
  direction: 'push',
  kind: 'PACE_CHANGE',
  to: { value: 400, unit: 'sec_per_mi' },
  lever: 'THRESHOLD',
  before: [{ planWorkoutId: 'w1', paceTargetSecPerMi: 420 }],
} as unknown as BrainAction;

const CTX: AcceptContext = {
  userUuid: USER,
  todayISO: '2026-09-13',
  proposalId: 42,
  why: 'the runner accepted this proposal',
};

/** Exactly what `mutatePlan` returns when `landDecisionInTransaction` cannot
 *  write the ledger row — the live production condition (migration 166). */
const LEDGER_UNWRITTEN = {
  ok: false as const,
  outcome: 'ledger_unwritten' as const,
  violations: ['plan_decision_ledger is not present in this database'],
  value: null,
};

/* ══════════════════════════════════════════════════════════════════════════
 * N1 · part 1 · the boundary refusal, carried to the route's doorstep
 * ═══════════════════════════════════════════════════════════════════════ */

describe('ACCEPTTWIN-1 · applyBrainAction carries what refusalFor decided', () => {
  beforeEach(() => {
    vi.mocked(mutatePlan).mockReset();
  });

  it('a ledger_unwritten boundary refusal arrives with status, retryable AND a reason', async () => {
    vi.mocked(mutatePlan).mockResolvedValue(LEDGER_UNWRITTEN as never);

    const outcome = await applyBrainAction(ACTION, CTX);

    expect(outcome.ok, 'the boundary refused, so this is not a success').toBe(false);
    if (outcome.ok) return;

    // `unverified`, NOT `rejected`. The coach did not refuse this.
    expect(outcome.error).toBe('unverified');
    // The three fields the route needs, none of them optional in practice here.
    expect(outcome.status, 'the 503 refusalFor resolved was dropped again').toBe(503);
    expect(outcome.retryable, 'a ledger failure is retryable and must say so').toBe(true);
    expect(
      outcome.reason,
      'the coach sentence is missing, so the phone has nothing readable to print '
      + 'and falls back to a sentence it invents',
    ).toBeTruthy();
    // Read out of the resolver rather than retyped, so this cannot pass by
    // agreeing with itself (Rule 18).
    expect(outcome.reason).toBe(
      refusalFor({ outcome: 'ledger_unwritten', violations: [] }, { thing: 'That change' }).reason,
    );
    // And the sentence must not be the machine half.
    expect(outcome.reason, 'the reason is carrying violation strings').not.toContain('plan_decision_ledger');
  });

  it('a doctrine rejection still carries 409 and retryable false · the fix is not "always 503"', async () => {
    vi.mocked(mutatePlan).mockResolvedValue({
      ok: false, outcome: 'rejected', violations: ['long run exceeds the weekly cap'], value: null,
    } as never);

    const outcome = await applyBrainAction(ACTION, CTX);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toBe('rejected');
    expect(outcome.status).toBe(409);
    expect(outcome.retryable).toBe(false);
    expect(outcome.reason).toContain("would break the plan's own rules");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * N1 · part 2 · THE BUG, REPRODUCED · the old route expression vs the new one
 * ═══════════════════════════════════════════════════════════════════════ */

describe('ACCEPTTWIN-1 · the accept route status, before and after', () => {
  /** The pre-fix expression, verbatim from `473b61cdc`. */
  const oldStatus = (error: string) =>
    error === 'unsupported' ? 422 : error === 'apply_failed' ? 500 : 409;

  /** The post-fix expression, verbatim from the route as it now stands. */
  const newStatus = (o: { code: string; status?: number; retryable?: boolean }) =>
    httpStatusForRefusal(o, { unsupported: 422, apply_failed: 500 }, 409);

  it('THE BUG · the old ladder answered a bare 409 for a retryable ledger failure', () => {
    const refusal = refusalFor({ outcome: 'ledger_unwritten', violations: [] }, { thing: 'That change' });
    // `applyBrainAction` maps every non-doctrine refusal to `unverified`.
    expect(oldStatus('unverified'), 'the pre-fix answer').toBe(409);
    expect(refusal.status, 'what the refusal had already decided').toBe(503);
    expect(refusal.retryable).toBe(true);
    // 409 is inside the window in which the phone fabricates a sentence.
    expect(oldStatus('unverified')).toBeGreaterThanOrEqual(400);
    expect(oldStatus('unverified')).toBeLessThan(500);
  });

  it('THE FIX · the carried status wins, and it leaves the fabrication window', () => {
    const refusal = refusalFor({ outcome: 'ledger_unwritten', violations: [] }, { thing: 'That change' });
    const now = newStatus({ code: 'unverified', status: refusal.status, retryable: refusal.retryable });
    expect(now, 'the post-fix answer').toBe(503);
    expect(now, 'still inside the 4xx window the phone fabricates in').toBeGreaterThanOrEqual(500);
  });

  it('the ladder still answers for the errors the applier raises itself', () => {
    // These carry no status of their own, so the route-local map is consulted
    // and must give the SAME answers it always did. A fix that changed these
    // would be a silent behaviour change of exactly the kind N4 is about.
    expect(newStatus({ code: 'unsupported' })).toBe(oldStatus('unsupported'));
    expect(newStatus({ code: 'apply_failed' })).toBe(oldStatus('apply_failed'));
    expect(newStatus({ code: 'invalid' })).toBe(oldStatus('invalid'));
    expect(newStatus({ code: 'missing_context' })).toBe(oldStatus('missing_context'));
  });

  it('SOURCE · the route spends the shared resolver and emits reason + retryable', () => {
    const src = read('app/api/plan/workout-proposals/[id]/accept/route.ts');
    expect(src.length, 'LIVENESS · the route file was not read').toBeGreaterThan(1000);
    expect(src, 'the route does not import the shared status resolver')
      .toContain('httpStatusForRefusal');
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    expect(code, 'the hand-derived ladder is back')
      .not.toContain("outcome.error === 'apply_failed' ? 500 : 409");
    expect(code, 'the response body dropped `retryable` again').toContain('retryable: outcome.retryable');
    expect(code, 'the response body dropped `reason` again, so the phone fabricates')
      .toContain('reason: outcome.reason');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * N4 · rebuild_failed · 500, ARGUED AND PINNED
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * THE FINDING. `/api/plan/replan` answered 409 for `rebuild_failed` at
 * `origin/main@a79c5c86`, via a catch-all `: 409` tail. The STATUSCARRY-1
 * commit replaced that tail with an explicit map and wrote `rebuild_failed:
 * 500`. The commit named the four mutation-refusal codes it was fixing and did
 * NOT name this one. So the change was real and undisclosed.
 *
 * THE CALL: 500 is correct and STAYS. The argument, not just the verdict:
 *
 *   1 · WHAT THE CODE MEANS. Both production sites are server-side faults.
 *       `replan-scenarios.ts:1777` fires when `deps.rebuild` was not wired in
 *       for this call — a programming error, and no request the runner could
 *       send would avoid it. `:1785` fires when `fireAutoRebuild` came back
 *       not-ok. Neither is "your request conflicts with the state of the
 *       resource", which is what 409 asserts. The runner's request was legal;
 *       the server could not produce the block. Answering 409 tells him to
 *       change a request that had nothing wrong with it.
 *
 *   2 · IT WAS ALREADY 500 ON THE SIBLING. `/api/plan/change` has carried
 *       `rebuild_failed: 500` since before this chain, and it reaches the code
 *       from the SAME function. So the pre-change state was two different
 *       statuses for one code from one source, which is a Rule 16 violation in
 *       its own right. The replan 409 was the accident, produced by a
 *       catch-all rather than by a decision.
 *
 *   3 · WHY NOT 503. `mutation-refusal.ts` reserves 503 for "we could not
 *       complete this and it is not your fault, ask again". Site 1 is
 *       permanently broken wiring and retrying never helps, so a blanket 503
 *       would promise a retry that cannot succeed. 500 is the honest answer
 *       for a fault whose retryability this code cannot establish. If
 *       `fireAutoRebuild` is ever taught to distinguish transient from
 *       permanent, THAT is the change that earns a 503 — and it is a separate
 *       decision, named here rather than pre-empted.
 *
 * The pin below is the enforcement, so this cannot drift back silently in
 * either direction (Rule 20).
 */

/** Reads a `const STATUS = { ... }` or inline map literal for one code. */
function statusForCodeIn(rel: string, code: string): number | undefined {
  const src = read(rel);
  const m = new RegExp(`\\b${code}\\s*:\\s*(\\d{3})`).exec(src);
  return m ? Number(m[1]) : undefined;
}

describe('ACCEPTTWIN-1 · N4 · rebuild_failed is 500, on BOTH routes that answer it', () => {
  const ROUTES = ['app/api/plan/replan/route.ts', 'app/api/plan/change/route.ts'] as const;

  it('LIVENESS · both routes were read and both name the code', () => {
    for (const f of ROUTES) {
      expect(read(f).length, f).toBeGreaterThan(500);
      expect(statusForCodeIn(f, 'rebuild_failed'), `${f} no longer maps rebuild_failed`)
        .toBeDefined();
    }
  });

  it('both answer 500, and they answer the SAME thing (Rule 16)', () => {
    const answers = ROUTES.map((f) => statusForCodeIn(f, 'rebuild_failed'));
    expect(answers[0], 'replan drifted off the adjudicated value').toBe(500);
    expect(new Set(answers).size, 'the two routes disagree about one code again').toBe(1);
  });

  it('the code is still produced only by server-side faults · the argument above still holds', () => {
    const src = read('lib/plan/replan-scenarios.ts');
    const sites = [...src.matchAll(/code:\s*'rebuild_failed'/g)].length;
    expect(sites, 'a new rebuild_failed site appeared; re-read the N4 argument before trusting 500')
      .toBe(2);
    expect(src, 'the wiring-fault site is gone').toContain('The rebuild path was not wired in for this call.');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * N5 · retryable reaches the wire from every body whose outcome carries it
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Every refusal RESPONSE SITE whose source outcome type declares `retryable`.
 * Per SITE, not per file: `move` and `reschedule` each have one limb that
 * carries it (apply, undo) and one that structurally cannot (`RecommendOutcome`
 * has no such field), and a file-level check passes as soon as one limb is
 * right. That is the exact half-fix shape round 6 had to correct once already.
 *
 * A RATCHET: it may grow; an entry leaves only when the site does.
 */
const RETRYABLE_SITES = [
  { file: 'app/api/plan/change/route.ts', occurrences: 1 },
  { file: 'app/api/plan/replan/route.ts', occurrences: 1 },
  { file: 'app/api/plan/move/route.ts', occurrences: 2 },
  { file: 'app/api/plan/reschedule/route.ts', occurrences: 2 },
  { file: 'app/api/plan/workout-proposals/[id]/undo/route.ts', occurrences: 1 },
  { file: 'app/api/plan/workout-proposals/[id]/accept/route.ts', occurrences: 1 },
] as const;

describe('ACCEPTTWIN-1 · N5 · retryable is not dropped on the last hop', () => {
  it('LIVENESS · every pinned route was read', () => {
    let n = 0;
    for (const s of RETRYABLE_SITES) { expect(read(s.file).length, s.file).toBeGreaterThan(500); n++; }
    expect(n, 'the scan looked at nothing, which is the worst outcome available').toBe(6);
  });

  for (const s of RETRYABLE_SITES) {
    it(`${s.file} · all ${s.occurrences} carrying limb(s) forward retryable`, () => {
      const src = read(s.file);
      const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      /* The guarded spread, which is the shape Rule 11 requires: present when
       * the boundary had an opinion, ABSENT when it did not — never a false
       * `false`, which would be a fourth wrong answer. */
      const forwards = [...code.matchAll(/\.\.\.\([\w.]*retryable === undefined \?/g)].length;
      expect(
        forwards,
        `${s.file} forwards retryable on ${forwards} limb(s); ${s.occurrences} carry it. `
        + 'A body that drops it leaves the client unable to tell "do not retry" from '
        + '"ask again", which is Rule 11 on the wire.',
      ).toBe(s.occurrences);
    });
  }

  it('and none of them hardcodes a bare `retryable: true/false`', () => {
    for (const s of RETRYABLE_SITES) {
      const code = read(s.file).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      expect(code, `${s.file} asserts a retryability the boundary did not state`)
        .not.toMatch(/retryable:\s*(true|false)\b/);
    }
  });
});
