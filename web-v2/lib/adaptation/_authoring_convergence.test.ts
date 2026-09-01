/**
 * lib/adaptation/_authoring_convergence.test.ts · CANNOT-CONVERGE-1.
 *
 * The 2026-09-01 independent audit's §5 finding, as assertions:
 *
 *   · `reanchorActivePlan`'s GUARD 2 returned null for any runner with no
 *     measured VDOT, and the only production caller passes an evidence-only
 *     read — so such a runner was never re-anchored, not late, NEVER. Six of
 *     seven live plans; one at 24 days.
 *   · `authoring-convergence.ts` had four states and none of them could say
 *     that. It reported `AUTHORED_TOO_RECENTLY` or `REANCHOR_STATUS_UNKNOWN`
 *     forever, both of which mean "check again tomorrow".
 *   · Nothing alerted. The state was found because a human ran a query.
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ────────────────────────────────
 *
 *   · It does not touch a database. It drives the pure predicate and the
 *     state machine's own arithmetic; whether the CRON actually calls
 *     `alertOnUnconvergedPlan` is asserted as a source fact, not exercised.
 *   · It cannot tell whether `reanchorOffCanonicalPrior` produces GOOD prices
 *     — only that the path exists and does not claim a measurement. The
 *     price question is the shadow compare's.
 *   · It says nothing about how many production plans are currently in the
 *     bad state. That is a query, and it belongs in the audit run.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CONVERGENCE_ALERT_AFTER_HOURS } from './authoring-convergence';

const REPO = path.resolve(__dirname, '..', '..');
const src = (rel: string) => readFileSync(path.join(REPO, rel), 'utf8');

const CONVERGENCE = src('lib/adaptation/authoring-convergence.ts');
const REANCHOR = src('lib/plan/reanchor-plan.ts');
const CRON = src('app/api/cron/snapshot-projections/route.ts');
const GENERATE = src('lib/plan/generate.ts');

describe('CANNOT-CONVERGE-1 · a plan nothing is pricing must be re-priced, and said out loud', () => {
  it('liveness · every file this reasons about is real and non-trivial', () => {
    // Rule 18 point 2. A scanner that reads nothing reports clean.
    expect(CONVERGENCE.length).toBeGreaterThan(4000);
    expect(REANCHOR.length).toBeGreaterThan(10000);
    expect(CRON.length).toBeGreaterThan(3000);
    expect(GENERATE.length).toBeGreaterThan(100000);
  });

  it('GUARD 2 no longer returns null for a runner with no measured VDOT', () => {
    // The exact shape of the defect: `if (measuredVdot == null …) return null;`
    expect(/measuredVdot == null[^\n]*\)\s*return null;/.test(REANCHOR)).toBe(false);
    // And what stands in its place.
    expect(REANCHOR).toContain('return reanchorOffCanonicalPrior(userId, today);');
  });

  it('the prior-priced arm never claims a measurement', () => {
    const arm = /async function reanchorOffCanonicalPrior[\s\S]*?\n}\n/.exec(REANCHOR)?.[0] ?? '';
    expect(arm.length).toBeGreaterThan(500);
    // It stamps the CANONICAL source mode, whatever that is — never the
    // literal 'measured_vdot' the evidenced arms write.
    expect(arm).toContain('season_anchor_source: sourceMode');
    expect(arm).not.toContain("season_anchor_source: 'measured_vdot'");
    // And it does not clear the provisional flag unconditionally.
    expect(arm).not.toContain('season_anchor_provisional: false');
    // The provisional flag is DERIVED from the mode, so a prior-priced plan
    // stays flagged and an inferred/race-derived one does not.
    expect(arm).toContain("sourceMode === 'user_prior' || sourceMode === 'population_prior'");
  });

  it('a plan already authored canonically is a no-op for the prior arm', () => {
    const arm = /async function reanchorOffCanonicalPrior[\s\S]*?\n}\n/.exec(REANCHOR)?.[0] ?? '';
    expect(arm).toContain("st.pace_authoring?.source === 'canonical'");
  });

  it('AUTHORED_CANONICALLY is reachable — authoring stamps the key the guard reads', () => {
    // The bet the guard's author took, settled. `persistComposedPlan` writes
    // `pace_authoring` and the predicate reads it.
    expect(GENERATE).toContain('pace_authoring:');
    expect(GENERATE).toContain("source: 'canonical' as const");
    expect(GENERATE).toContain('authored_directly: true');
    expect(CONVERGENCE).toContain('authoredState?.pace_authoring');
  });

  it('the fifth state exists and is raised as an ops_alerts row (Rule 23)', () => {
    expect(CONVERGENCE).toContain('CANNOT_CONVERGE_NO_CANONICAL_PRICING');
    expect(CONVERGENCE).toContain("kind: 'plan_convergence'");
    expect(src('lib/ops/alerts.ts')).toContain("'plan_convergence'");
    // And something actually calls it — a raiser nothing invokes is Rule 21's
    // "wired, tested and inert", which is this codebase's signature failure.
    expect(CRON).toContain('alertOnUnconvergedPlan');
  });

  it('the alert window outlives every benign scheduling explanation', () => {
    // The audit measured `snapshot-projections`' worst observed gap at 15.7h
    // against a daily schedule. A window shorter than a day would alert on
    // ordinary lateness (Rule 23: lateness must be harmless); much longer and
    // the alert stops being about a defect.
    expect(CONVERGENCE_ALERT_AFTER_HOURS).toBeGreaterThanOrEqual(16);
    expect(CONVERGENCE_ALERT_AFTER_HOURS).toBeLessThanOrEqual(48);
  });

  it('the new writer is registered in the automatic-mutation registry', () => {
    // Rule 20 for a writer: a plan writer nothing declares is a writer nobody
    // audits. `_automatic_mutations.test.ts` compares the registry against the
    // `reanchorActivePlan(` call sites; this asserts the ENTRY says what the
    // writer now does.
    const reg = src('lib/audit/automatic-mutation-registry.ts');
    expect(reg).toContain('CANNOT-CONVERGE-1');
    expect(reg).toContain('reanchorOffCanonicalPrior');
    expect(reg).toContain('plan_convergence');
  });
});
