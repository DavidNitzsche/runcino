/**
 * _lifecycle_open_block.test.ts · the runners the lifecycle could not see.
 *
 * Four states, all of which produced no adaptation at all before 2026-08-19,
 * because every path into the plan engine keyed off a race row:
 *
 *   1. finished a race with nothing booked   · zero active plans, forever
 *   2. a goal-mode plan that elapsed         · rendered stale, forever
 *   3. a coached runner who adds a race      · Faff authored over their coach
 *   4. a runner who adds a second A-race     · block never learns it is a
 *                                              stepping stone
 *
 * The predicates are pure (no pg, no clock), so they are asserted directly.
 * The wiring — that the cron and the result chain actually CALL them, with a
 * LEFT JOIN that does not drop a NULL race_id, and that the authoring routes
 * consult the coached gate — is asserted as a source scan, the same shape
 * `_mutation_boundary.test.ts` uses for the plan_workouts writers. A source
 * scan is the honest tool here: these are route handlers whose behaviour is
 * one `if` around a DB call, and a mock deep enough to exercise them would be
 * testing the mock.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  graduateDue,
  recoveryCompleteDue,
  planElapsed,
  openBlockDue,
  openBlockMode,
} from './race-lifecycle';
import { pickPlanMode, postRaceRecoveryWeeks } from './goal-tiers';

const ROOT = join(__dirname, '..', '..');
/** Source with comments stripped, so prose about a rule never satisfies it. */
function code(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

// ── 1 · a runner who finishes a race with nothing booked ─────────────────────

describe('1 · finished a race, nothing booked', () => {
  it('openBlockDue fires only when there is no plan AND no target', () => {
    expect(openBlockDue({ hasActivePlan: false, hasFutureTarget: false })).toBe(true);
    // Has a plan → the drift / graduate machinery owns them.
    expect(openBlockDue({ hasActivePlan: true, hasFutureTarget: false })).toBe(false);
    // Has a race to build to → the graduate path owns them.
    expect(openBlockDue({ hasActivePlan: false, hasFutureTarget: true })).toBe(false);
    expect(openBlockDue({ hasActivePlan: true, hasFutureTarget: true })).toBe(false);
  });

  it('the morning after a marathon is RECOVERY, not maintenance', () => {
    const mode = openBlockMode({
      lastRaceDateISO: '2026-03-01',
      lastRaceDistanceMi: 26.2,
      lastRacePriority: 'A',
      todayISO: '2026-03-02',
    });
    expect(mode).toBe('recovery');
  });

  it('recovery gives way to maintenance exactly when doctrine says', () => {
    const weeks = postRaceRecoveryWeeks('m', 'A');
    const day = (n: number) =>
      new Date(Date.parse('2026-03-01T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
    const at = (n: number) => openBlockMode({
      lastRaceDateISO: '2026-03-01',
      lastRaceDistanceMi: 26.2,
      lastRacePriority: 'A',
      todayISO: day(n),
    });
    expect(at(weeks * 7 - 1)).toBe('recovery');
    expect(at(weeks * 7)).toBe('maintenance');
  });

  it('a C-race parkrun does not park the runner in an A-race recovery hole', () => {
    const day20 = '2026-03-21';
    expect(openBlockMode({
      lastRaceDateISO: '2026-03-01', lastRaceDistanceMi: 26.2,
      lastRacePriority: 'A', todayISO: day20,
    })).toBe('recovery');
    expect(openBlockMode({
      lastRaceDateISO: '2026-03-01', lastRaceDistanceMi: 26.2,
      lastRacePriority: 'C', todayISO: day20,
    })).toBe('maintenance');
  });

  it('an unresolvable race distance yields maintenance, never a guessed window', () => {
    // The 2026-08-18 categorizer unification: Number(null) === 0 must not
    // bucket as 5K, and a null distance must not default to the half.
    expect(openBlockMode({
      lastRaceDateISO: '2026-03-01', lastRaceDistanceMi: null,
      lastRacePriority: 'A', todayISO: '2026-03-02',
    })).toBe('maintenance');
    expect(openBlockMode({
      lastRaceDateISO: '2026-03-01', lastRaceDistanceMi: 0,
      lastRacePriority: 'A', todayISO: '2026-03-02',
    })).toBe('maintenance');
  });

  it('agrees with pickPlanMode on every distance and priority', () => {
    const cats = [
      ['5k', 3.1], ['10k', 6.2], ['hm', 13.1], ['m', 26.2], ['ultra', 50],
    ] as const;
    for (const [cat, mi] of cats) {
      for (const priority of ['A', 'B', 'C'] as const) {
        const w = postRaceRecoveryWeeks(cat, priority);
        for (const d of [0, Math.max(0, w * 7 - 1), w * 7, w * 7 + 5]) {
          const todayISO = new Date(Date.parse('2026-03-01T12:00:00Z') + d * 86400000)
            .toISOString().slice(0, 10);
          const open = openBlockMode({
            lastRaceDateISO: '2026-03-01', lastRaceDistanceMi: mi,
            lastRacePriority: priority, todayISO,
          });
          const picked = pickPlanMode(todayISO, null, null, '2026-03-01', mi, priority);
          expect(`${cat}/${priority}/${d}:${open}`).toBe(
            `${cat}/${priority}/${d}:${picked === 'recovery' ? 'recovery' : 'maintenance'}`,
          );
        }
      }
    }
  });

  it('the result chain has a third branch, and it authors an open block', () => {
    const src = code('lib/race/result-chain.ts');
    expect(src).toMatch(/authorOpenBlock/);
    // The old shape: nextRaceRow found nothing and the function simply ended.
    expect(src).toMatch(/if \(nextRaceRow\)[\s\S]{0,4000}\} else \{/);
    // And the outcome is reported, not swallowed.
    expect(src).toMatch(/openBlock,/);
  });

  it('the nightly cron retries the handoff for anyone already in the hole', () => {
    const src = code('app/api/cron/plan-drift/route.ts');
    expect(src).toMatch(/authorOpenBlock/);
    expect(src).toMatch(/open_block_cron/);
  });

  it('the open block never authors for a coached runner', () => {
    const src = code('lib/plan/open-block.ts');
    expect(src).toMatch(/isCoachedExternally/);
    // The gate is the FIRST question, before any decision or DB write.
    const gate = src.indexOf('isCoachedExternally');
    const decide = src.indexOf('openBlockMode(');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(decide);
  });

  it('the open block is idempotent on a standing pending row', () => {
    const src = code('lib/plan/open-block.ts');
    expect(src).toMatch(/proposal_kind = 'open_block'/);
    expect(src).toMatch(/status = 'pending'/);
    expect(src).toMatch(/already_pending/);
  });
});

// ── 2 · a goal-mode plan that elapses ────────────────────────────────────────

describe('2 · a goal-mode plan that elapses', () => {
  it('the cron iterates runners who have NO active plan', () => {
    const src = code('app/api/cron/plan-drift/route.ts');
    // The population used to be "every user with an active plan", which by
    // construction excluded the runner whose plan was just archived — so the
    // nightly retry could not have reached them.
    expect(src).toMatch(/UNION[\s\S]{0,400}NOT EXISTS[\s\S]{0,200}archived_iso IS NULL/);
  });

  it('planElapsed answers the end-of-plan question without a race', () => {
    expect(planElapsed('2026-03-01', '2026-03-02')).toBe(true);
    expect(planElapsed('2026-03-02', '2026-03-02')).toBe(false); // today is still prescribed
    expect(planElapsed('2026-03-05', '2026-03-02')).toBe(false);
  });

  it('a plan with no workout rows is broken, not finished', () => {
    expect(planElapsed(null, '2026-03-02')).toBe(false);
    expect(planElapsed(undefined, '2026-03-02')).toBe(false);
    expect(planElapsed('', '2026-03-02')).toBe(false);
  });

  it('graduateDue still owns the race-anchored end, unchanged', () => {
    expect(graduateDue('2026-03-01', '2026-03-02')).toBe(true);
    expect(graduateDue('2026-03-02', '2026-03-02')).toBe(false);
    expect(graduateDue(null, '2026-03-02')).toBe(false);
    expect(recoveryCompleteDue('2026-03-01', '2026-05-01', '2026-03-02')).toBe(true);
  });

  it('the cron LEFT JOINs races so a NULL race_id survives the lookup', () => {
    const src = code('app/api/cron/plan-drift/route.ts');
    // Both plan lookups. An INNER JOIN on a NULL race_id drops the row, which
    // is how every goal-mode runner became invisible to the whole cron.
    expect(src).not.toMatch(/\n\s+JOIN races rc ON rc\.slug = tp\.race_id/);
    const leftJoins = src.match(/LEFT JOIN races rc ON rc\.slug = tp\.race_id/g) ?? [];
    expect(leftJoins.length).toBeGreaterThanOrEqual(3);
  });

  it('the cron reads the plan\'s own last prescribed day', () => {
    const src = code('app/api/cron/plan-drift/route.ts');
    expect(src).toMatch(/MAX\(pw\.date_iso\)[\s\S]{0,120}AS last_workout_iso/);
    expect(src).toMatch(/planElapsed\(activePlanRow\.last_workout_iso, userToday\)/);
  });

  it('an elapsed goal-mode plan rebuilds through the goal target', () => {
    const src = code('app/api/cron/plan-drift/route.ts');
    expect(src).toMatch(/kind: 'plan_elapsed'/);
    expect(src).toMatch(/resolveGoalTarget/);
    // And when there is no goal either, the dead plan is archived rather than
    // left active to render its last day forever.
    expect(src).toMatch(/archive_reason = 'plan_elapsed'/);
  });

  it('RATCHET · soft drift is OBSERVED and reaches no writer at all', () => {
    /* INVERTED 2026-09-02, and the inversion is the point.
     *
     * This test was "drift signals on a goal-mode plan now reach a rebuild".
     * Its history is the whole argument for turning it round rather than
     * deleting it:
     *
     *   · 2026-08-19 — the bug it was written for. `} else if (plan?.race_id)`
     *     was the ONLY drift rebuild call site, so a goal-mode runner produced
     *     signals_found > 0 and proposals_written === 0 every night, forever.
     *   · 2026-08-26 — the direct rebuild became a pending card, after two of
     *     the six kinds re-authored the owner's plan on back-to-back mornings
     *     (long_drift moved his easy-day target, easy_drift reacted to the
     *     number long_drift had just written). The test kept its name and
     *     started asserting `'drift_cron_pending'`.
     *   · 2026-09-02 — the card goes too. Soft drift is a TRANSIENT READING
     *     (a 28-day rolling average, an inferred VDOT, a plan's age) and the
     *     owner's ruling is that a transient reading may not re-phase a block.
     *
     * So the subject the old assertions named — the rebuild, then the card —
     * is deleted at every rung, and there is nothing to retag it onto. What
     * IS worth locking is the state the ruling put the code in, which no test
     * covered: soft drift is detected, counted, logged, and writes nothing.
     * Deleting this test would have left that behaviour unguarded on the day
     * it became the behaviour.
     */
    const src = code('app/api/cron/plan-drift/route.ts');

    // LIVENESS (Rule 18 §2) · every assertion below is scoped to a slice, and
    // a slice that failed to resolve would make all of them vacuously true.
    const from = src.indexOf('const report = await detectDrift(u);');
    const to = src.indexOf("recordCronSuccess('plan-drift'");
    expect(from, 'the drift block anchor is gone · this scan found nothing to read')
      .toBeGreaterThan(-1);
    expect(to, 'the cron-ledger anchor is gone · the slice has no end')
      .toBeGreaterThan(from);
    const driftBlock = src.slice(from, to);
    expect(driftBlock.length).toBeGreaterThan(200);

    // OBSERVATION SURVIVES · stated positively, so "nothing happens here" can
    // never be satisfied by the block having been deleted outright.
    expect(driftBlock).toMatch(/r\.signals_found = report\.signals\.length/);
    expect(driftBlock).toMatch(/r\.signals_skipped = report\.signals\.length/);

    // AUTHORITY DOES NOT. Nothing in the soft-drift block may write a plan
    // row or raise a card. Scoped to the block rather than the file, because
    // the lifecycle transitions ABOVE it legitimately do both — a file-wide
    // absence assertion here would be false, and a file-wide one that passed
    // would mean the KEEP list had been deleted too.
    expect(driftBlock, 'soft drift raised a proposal again')
      .not.toMatch(/INSERT INTO plan_proposals/);
    expect(driftBlock, 'soft drift reached a rebuild again')
      .not.toMatch(/fireAutoRebuild/);
    expect(driftBlock, 'soft drift resolved a rebuild target again')
      .not.toMatch(/resolveGoalTarget/);

    // The 2026-08-19 bug ratchet, unchanged and still meaningful: that branch
    // must not reappear as a way back to a drift-driven rebuild.
    expect(src).not.toMatch(/\}\s*else if \(plan\?\.race_id\) \{/);
  });

  it('fireAutoRebuild accepts a goal target as well as a race slug', () => {
    const src = code('lib/plan/auto-rebuild.ts');
    expect(src).toMatch(/goalTarget\?: RebuildGoalTarget/);
    // 2026-08-25 · matched on SUBSTANCE, not on line breaks. This was pinned to
    // the exact single-line spelling `generatePlan({ userId: input.userUuid,
    // goalTarget: input.goalTarget! })`, so adding a third argument — the
    // archiveReason that records WHICH trigger replaced the plan — reflowed the
    // call across lines and failed a test that was asking whether a goal target
    // reaches the generator. It still does. A source-text assertion should
    // assert the thing it cares about; whitespace is not that thing.
    expect(src).toMatch(/generatePlan\(\{[\s\S]{0,160}goalTarget:\s*input\.goalTarget!/);
    // A goal-anchored rebuild must not be rejected by the race-match check.
    expect(src).toMatch(/input\.raceSlug && plan && plan\.race_id !== input\.raceSlug/);
  });
});

// ── 3 · a coached runner who adds a race ─────────────────────────────────────

describe('3 · a coached runner', () => {
  it('every authoring entry point the lifecycle owns consults the gate', () => {
    for (const rel of [
      'app/api/race/route.ts',
      'app/api/profile/goal/route.ts',
      'lib/plan/auto-rebuild.ts',
      'lib/plan/open-block.ts',
    ]) {
      expect(code(rel), rel).toMatch(/isCoachedExternally/);
    }
  });

  it('adding an A-race does not author a plan over the coach\'s', () => {
    const src = code('app/api/race/route.ts');
    expect(src).toMatch(/const coached = await isCoachedExternally\(userId\)/);
    // The whole authoring block is inside the gate.
    expect(src).toMatch(/if \(!coached\) \{/);
    // And the race itself still saves — the gate is around authorship only.
    const gateAt = src.indexOf('isCoachedExternally(userId)');
    const insertAt = src.indexOf('INSERT INTO races');
    expect(insertAt).toBeGreaterThan(-1);
    expect(insertAt).toBeLessThan(gateAt);
  });

  it('setting a goal does not author a plan over the coach\'s', () => {
    const src = code('app/api/profile/goal/route.ts');
    expect(src).toMatch(/if \(distMi && !coached\)/);
    // tt_goal_* still persists — the measurement layer is the product here.
    const saveAt = src.indexOf('tt_goal_distance');
    const gateAt = src.indexOf('isCoachedExternally(userId)');
    expect(saveAt).toBeLessThan(gateAt);
  });

  it('no automatic rebuild fires for a coached runner either', () => {
    const src = code('lib/plan/auto-rebuild.ts');
    // fireAutoRebuild is the door every cron transition goes through.
    expect(src).toMatch(/export async function fireAutoRebuild[\s\S]{0,600}isCoachedExternally/);
    expect(src).toMatch(/export async function rebuildActivePlanForPrefs[\s\S]{0,600}isCoachedExternally/);
  });

  it('onboarding\'s coached branch still authors nothing', () => {
    const src = code('app/api/onboarding/complete/route.ts');
    expect(src).toMatch(/seedPlan = \{ ok: true, mode: 'coached' \}/);
  });

  it('the gate fails OPEN, not closed', () => {
    // A read failure must author the plan, not silently stop coaching someone.
    const src = readFileSync(join(ROOT, 'lib/plan/coached-gate.ts'), 'utf8');
    expect(src).toMatch(/catch \{\s*return false;\s*\}/);
  });
});

// ── 4 · a runner who adds a second A-race ────────────────────────────────────

describe('4 · a second A-race', () => {
  it('POST /api/race rebuilds the active block instead of ignoring the race', () => {
    const src = code('app/api/race/route.ts');
    expect(src).toMatch(/fireAutoRebuild/);
    expect(src).toMatch(/source: 'race_post_hook'/);
    expect(src).toMatch(/kind: 'a_race_added'/);
  });

  it('the rebuild keeps the CURRENT target, it does not re-point the plan', () => {
    const src = code('app/api/race/route.ts');
    // raceSlug is the ACTIVE plan's race, not the newly added one — the new
    // race enters through Rule 11's horizonRaces / MIDRACE-1's midBlockRaces,
    // which is what the rebuild exists to re-read.
    expect(src).toMatch(/raceSlug: active\.race_id/);
    expect(src).toMatch(/active\.race_id !== slug/);
  });

  it('the rebuild is suppressed inside 14 days of the target race', () => {
    const src = code('app/api/race/route.ts');
    // Firing there could only mint a stuck pending row: the generator refuses
    // with 'target < 2 weeks away'. Same rule the drift cron learned in
    // 2026-08-17.
    expect(src).toMatch(/suppressDriftNearRace\(active\.race_date, todayISO\)/);
  });

  it('a race outside the horizon window does not churn a rebuild', () => {
    const src = code('app/api/race/route.ts');
    expect(src).toMatch(/const HORIZON_DAYS = 168/);
    expect(src).toMatch(/relevant/);
  });

  it('a B or C tune-up also triggers the re-read, not just an A race', () => {
    const src = code('app/api/race/route.ts');
    // The rebuild branch must NOT sit under a priority === 'A' guard; only
    // FIRST-plan generation does.
    expect(src).toMatch(/\} else if \(meta\.priority === 'A'\) \{/);
    const gate = src.indexOf("if (!coached) {");
    const rebuild = src.indexOf("source: 'race_post_hook'");
    const firstPlan = src.indexOf("} else if (meta.priority === 'A') {");
    expect(gate).toBeLessThan(rebuild);
    expect(rebuild).toBeLessThan(firstPlan);
  });
});
