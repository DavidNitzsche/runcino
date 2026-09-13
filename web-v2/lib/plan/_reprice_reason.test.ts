/**
 * lib/plan/_reprice_reason.test.ts · REPRICEREASON-1 (2026-09-13)
 *
 * Round 8 of the archived-plan-mutation-guard review. Falsified against
 * `9b1656ff1` (the round-7 tree) before this file landed.
 *
 * ══ N7 · THE REPRICE LIMB, AND THE MIS-DIAGNOSIS THAT DEFERRED IT ═══════════
 *
 * `POST /api/plan/workout-proposals/[id]/accept` has three limbs. Round 7 fixed
 * the ACTION limb (ACCEPTTWIN-1). The REPRICE limb kept:
 *
 *     const res = await applyReanchorProposal(...)
 *     if (res == null) {
 *       return NextResponse.json({ ok: false, error: 'apply_refused' }, { status: 409 });
 *     }
 *
 * A 4xx with no `reason` and no `refusal`, which is precisely the shape that
 * makes `APIV5.answerProposal` fall through to its own 409 sentence:
 *
 *     "This session has changed since the coach proposed it, so the decision
 *      no longer fits. It will be raised again against the session as it
 *      stands."
 *
 * A repricing is not about a session. It is one decision over the whole block,
 * and the four things that actually refuse it are a rebuilt plan, an unreadable
 * card, an adapter deferral and a write that touched nothing. The sentence names
 * none of them, and "it will be raised again" is a promise the route cannot keep
 * for a card whose plan no longer exists.
 *
 * WHY IT SURVIVED. A prior round examined this limb and deferred it, on the
 * ground that `applyReanchorProposal`'s `null` was an UNCHARACTERISED refusal
 * and surfacing it would mean inventing coach copy for something nobody
 * understood. That reasoning was false, and the tests below are written to
 * PROVE it false rather than to assert the fix: `applyReanchorProposal` had
 * four distinct `return null` sites, each reasoned about at its own site and
 * two of them already carrying a written `console.error` sentence. The stale
 * card in particular maps onto `refusalFor`'s existing `no_plan` copy exactly,
 * so the fix for that one invents nothing at all.
 *
 * ══ RULE 22 · WHAT THIS SUITE CANNOT FAIL ON ════════════════════════════════
 *
 * · WHETHER THE ARM SHOULD HAVE REFUSED. The re-anchor gates own that.
 * · THE `not_applied` COLLAPSE. `null` from an arm is still two facts — the
 *   gate found nothing to move, and `mutatePlan` refused. This suite pins that
 *   the surviving sentence claims neither, and does NOT pin them apart, because
 *   the fix does not separate them. See `repriceApplyOutcome`'s own header.
 * · THE PHONE. No Swift is executed; `answerProposal`'s fabrication branch is
 *   reasoned about from its source, not rendered.
 * · THE REAL SQL AND THE REAL ARMS. Both are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const query = vi.fn();
vi.mock('@/lib/db/pool', () => ({ pool: { query: (...a: unknown[]) => query(...a) } }));

import { applyReanchorProposal } from './reanchor-plan';
import { refusalFor } from './mutation-refusal';

const REPO = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(REPO, rel), 'utf8');

const USER = 'abcdef12-3456-7890-abcd-ef1234567890';
const TODAY = '2026-09-13';

const PLAN_ROW = {
  id: 'plan_1', mode: 'race-prep', race_id: 'r1', authored_state: { pace_blend: {} },
};

/* ══════════════════════════════════════════════════════════════════════════
 * part 1 · THE PREMISE THE PRIOR ROUND GOT WRONG
 * ═══════════════════════════════════════════════════════════════════════ */

describe('REPRICEREASON-1 · the refusal was characterised all along', () => {
  it('the applier has FOUR named refusal codes, not one bare null', () => {
    const src = read('lib/plan/reanchor-plan.ts');
    expect(src.length, 'LIVENESS · the applier was not read').toBeGreaterThan(1000);
    for (const code of ['stale_card', 'no_anchor', 'deferred', 'not_applied']) {
      expect(src, `the applier no longer distinguishes ${code}`).toContain(`'${code}'`);
    }
    // And the signature no longer collapses them.
    expect(src, 'applyReanchorProposal collapsed back to a bare null')
      .not.toMatch(/export async function applyReanchorProposal[\s\S]{0,400}Promise<ReanchorResult \| null>/);
  });

  it('the stale-card sentence is REUSED from refusalFor, not written a second time', () => {
    /* This is the concrete refutation of "surfacing it means inventing copy".
     * A card whose plan has been rebuilt is a `no_plan`, and `refusalFor` has
     * owned that sentence since CALLERHONESTY-1. Read out of the resolver so
     * this cannot pass by agreeing with itself (Rule 18). */
    const expected = refusalFor({ outcome: 'no_plan', violations: [] }, { thing: 'That repricing' }).reason;
    expect(expected).toContain('could not be matched to an active plan');
    const src = read('lib/plan/reanchor-plan.ts');
    expect(src, 'the stale-card limb stopped calling the shared resolver')
      .toMatch(/refusalFor\(\{\s*outcome:\s*'no_plan'/);
    expect(src, 'a second hand-written copy of the no_plan sentence appeared')
      .not.toContain('could not be matched to an active plan.');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * part 2 · the four refusals, forced through the real applier
 * ═══════════════════════════════════════════════════════════════════════ */

describe('REPRICEREASON-1 · applyReanchorProposal answers with the reason it had', () => {
  beforeEach(() => { query.mockReset(); });

  it('THE BUG · a rebuilt plan used to be a bare null · it now says so', async () => {
    // No active plan row for this id: the card names a plan that was archived.
    query.mockResolvedValue({ rows: [] });

    const out = await applyReanchorProposal(USER, { planId: 'plan_gone', arm: 'race-prep', toVdot: 47 }, TODAY);

    expect(out.ok, 'the applier reported success for a plan it could not find').toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('stale_card');
    expect(out.status, 'a stale card is a genuine state conflict').toBe(409);
    expect(out.retryable, 'the named plan is gone; retrying this card cannot work').toBe(false);
    expect(out.reason).toBe(
      refusalFor({ outcome: 'no_plan', violations: [] }, { thing: 'That repricing' }).reason,
    );
    // The machine half names the plan and the runner-facing half does not.
    expect(out.because).toContain('plan_gone');
    expect(out.reason).not.toContain('plan_gone');
  });

  it('an unreadable anchor VDOT is its own refusal, and it is NOT retryable', async () => {
    query.mockResolvedValue({ rows: [PLAN_ROW] });

    const out = await applyReanchorProposal(USER, { planId: 'plan_1', arm: 'race-prep', toVdot: null }, TODAY);

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('no_anchor');
    expect(out.retryable, 'the card itself is unreadable, so a retry is a false promise').toBe(false);
    expect(out.reason, 'the runner is owed a sentence, not a bare code').toBeTruthy();
    // Rule 16 · it must not borrow the stale-card sentence, which is a
    // different fact about a different thing.
    expect(out.reason).not.toContain('active plan');
  });

  it('a zero or negative anchor is caught by the same limb', async () => {
    query.mockResolvedValue({ rows: [PLAN_ROW] });
    for (const bad of [0, -1, Number.NaN]) {
      const out = await applyReanchorProposal(USER, { planId: 'plan_1', arm: 'race-prep', toVdot: bad }, TODAY);
      expect(out.ok, `toVdot ${bad} was accepted`).toBe(false);
      if (out.ok) continue;
      expect(out.code).toBe('no_anchor');
    }
  });

  it('none of the four sentences is the one the phone used to fabricate', async () => {
    /* The whole point. Every reason this limb can produce must be about the
     * PLAN or the CARD, never about a session having moved. */
    query.mockResolvedValue({ rows: [] });
    const stale = await applyReanchorProposal(USER, { planId: 'p', arm: 'race-prep', toVdot: 47 }, TODAY);
    query.mockResolvedValue({ rows: [PLAN_ROW] });
    const anchor = await applyReanchorProposal(USER, { planId: 'plan_1', arm: 'race-prep', toVdot: null }, TODAY);

    for (const out of [stale, anchor]) {
      expect(out.ok).toBe(false);
      if (out.ok) continue;
      expect(out.reason, 'a repricing refusal is claiming a session moved').not.toMatch(/session/i);
      expect(out.reason, 'coach voice · no em dashes').not.toContain('—');
      expect(out.reason, 'coach voice · no exclamation marks').not.toContain('!');
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * part 3 · the route spends it
 * ═══════════════════════════════════════════════════════════════════════ */

describe('REPRICEREASON-1 · the accept route reprice limb emits reason', () => {
  const ROUTE = 'app/api/plan/workout-proposals/[id]/accept/route.ts';

  it('LIVENESS · the route was read and still has a reprice limb', () => {
    const src = read(ROUTE);
    expect(src.length).toBeGreaterThan(1000);
    expect(src).toContain('applyReanchorProposal');
  });

  it('THE BUG IS GONE · the bare apply_refused 409 no longer exists', () => {
    const code = read(ROUTE).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    expect(
      code,
      "the reprice limb answers a bare `error: 'apply_refused'` again, which the phone "
      + 'renders as its own stale-session sentence',
    ).not.toContain("error: 'apply_refused'");
    expect(code, 'the reprice limb dropped `reason`').toContain('reason: outcome.reason');
    expect(code, 'the reprice limb dropped `retryable`').toContain('retryable: outcome.retryable');
    expect(code, 'the shared status resolver is not being used on this limb')
      .toMatch(/httpStatusForRefusal\(\s*\{ code: outcome\.code/);
  });

  it('and the lib caller (applyBrainAction COORDINATED) carries it too', () => {
    /* The SAME applier is reached twice: once from the route directly and once
     * through `applyBrainAction`. A fix on one path only would leave the lie
     * live on the other (Rule 16). */
    const src = read('lib/brain/proposal/accept.ts');
    expect(src, 'the COORDINATED limb still hardcodes its own refusal sentence')
      .not.toContain('the repricing was refused by its own apply path');
    expect(src, 'the COORDINATED limb drops the applier reason')
      .toContain('reason: outcome.reason');
  });
});
