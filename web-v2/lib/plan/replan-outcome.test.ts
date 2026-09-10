/**
 * lib/plan/replan-outcome.test.ts · REBUILDTRUTH-1 sibling fix
 * (`app/api/settings/route.ts` PATCH, item 8 of
 * `docs/audit-2026-09-08-full-status-master-report.md` §10a).
 *
 * `resolveReplanOutcome` is the ONE place that turns an `AutoRebuildResult`
 * into `{replanned, replanStatus, replanReason}`. Before the fix, both
 * `/api/profile` (already patched 2026-09-05) and `/api/settings` computed
 * `replanned = !!r.ok` inline, which reads TRUE for `deduped_within_Ns`
 * (nothing ran) and `unchanged` (ran, rolled back) exactly as much as for a
 * genuine replan — a real PATCH failure and "no replan needed" were the
 * SAME shape on the wire.
 *
 * FAIL-BEFORE/PASS-AFTER: `oldBuggyReplanned` below reproduces the old
 * `!!r.ok` formula and is asserted to disagree with the fixed resolver on
 * exactly the cases that motivated the fix.
 */
import { describe, it, expect } from 'vitest';
import { resolveReplanOutcome, REPLAN_NOT_ATTEMPTED } from '@/lib/plan/replan-outcome';
import type { AutoRebuildResult } from '@/lib/plan/auto-rebuild';

/** The pre-fix formula, reproduced so the test can prove it discriminates. */
function oldBuggyReplanned(r: AutoRebuildResult): boolean {
  return !!r.ok;
}

describe('resolveReplanOutcome · a PATCH failure is never "no replan needed"', () => {
  it('a genuine replan: ok, unchanged absent, newPlanId present', () => {
    const r: AutoRebuildResult = { ok: true, newPlanId: 'plan-2', oldPlanId: 'plan-1' };
    expect(resolveReplanOutcome(r)).toEqual({
      replanned: true,
      replanStatus: 'replanned',
      replanReason: null,
    });
  });

  it('FAIL-BEFORE/PASS-AFTER · unchanged (ran, rolled back) is NOT a replan', () => {
    const r: AutoRebuildResult = { ok: true, unchanged: true, oldPlanId: 'plan-1' };
    const fixed = resolveReplanOutcome(r);
    expect(fixed.replanned).toBe(false);
    expect(fixed.replanStatus).toBe('no_change');
    // The old formula got this case WRONG — that disagreement is the bug.
    expect(oldBuggyReplanned(r)).toBe(true);
    expect(fixed.replanned).not.toBe(oldBuggyReplanned(r));
  });

  it('FAIL-BEFORE/PASS-AFTER · deduped-within-window (nothing ran) is NOT a replan', () => {
    const r: AutoRebuildResult = { ok: true, reason: 'deduped_within_30s', oldPlanId: 'plan-1' };
    const fixed = resolveReplanOutcome(r);
    expect(fixed.replanned).toBe(false);
    expect(fixed.replanStatus).toBe('no_change');
    expect(oldBuggyReplanned(r)).toBe(true);
    expect(fixed.replanned).not.toBe(oldBuggyReplanned(r));
  });

  it('a genuinely failed rebuild is distinguishable and names why', () => {
    const r: AutoRebuildResult = { ok: false, reason: 'the rebuild threw: connection lost' };
    const fixed = resolveReplanOutcome(r);
    expect(fixed.replanned).toBe(false);
    expect(fixed.replanStatus).toBe('not_replanned');
    expect(fixed.replanReason).toBe('the rebuild threw: connection lost');
    // Both old and new formulas agree replanned is false here — the bug was
    // specifically in the "ok but nothing changed" cases above, not this one.
    expect(oldBuggyReplanned(r)).toBe(false);
  });

  it('a failed rebuild with no reason still gets a non-null replanReason', () => {
    const r: AutoRebuildResult = { ok: false };
    expect(resolveReplanOutcome(r).replanReason).toBe('the rebuild produced no new plan');
  });

  it('no plan-shaping field changed at all → REPLAN_NOT_ATTEMPTED, no rebuild call', () => {
    expect(REPLAN_NOT_ATTEMPTED).toEqual({
      replanned: false,
      replanStatus: 'not_attempted',
      replanReason: null,
    });
  });
});
