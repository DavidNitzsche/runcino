/**
 * lib/adaptation/canonical-shadow/_f038_reign_scoping.audit.test.ts · RENDER
 * IT (Rule 13), against the real account and the real rebuild the F038
 * report was built on.
 *
 * `programme-internal-working/00-master-programme/
 * F038-EVIDENCE-CLOCK-SCOPING-2026-09-14.md` §2 replayed David's actual
 * 2026-09-14 04:04 UTC plan rebuild (`pln_7636bcc0a201bf2d` →
 * `pln_7da73e1da5ea7f6f`) and found the pre-fix loader's `WEEKLY_VOLUME`/
 * `LONG_RUN` levers losing a real, measurable week of evidence at the exact
 * instant of the rebuild — weeks of 2026-08-17 (17 mi, authored under a
 * `recovery`-mode plan) and 2026-08-24 (38 mi, spanning three archived plans)
 * read as fully ABSENT under `readPlanWorkouts(plan.id)`'s active-plan-only
 * scoping, despite 28-35 real training miles each.
 *
 * This runs `buildLiveCanonicalInput` itself — not a reimplementation of its
 * SQL — against `DATABASE_URL_RO`, replaying BOTH sides of that exact
 * boundary with `planSelection: 'AS_AUTHORED_AT'` (the historical-replay
 * selector `readPlan`'s own header documents as the one for exactly this
 * purpose). Same convention as `_owned_days_reign.audit.test.ts`: `.audit.`
 * so CI never depends on a database, real production ids and dates
 * hardcoded rather than re-derived, and a FALSIFIER that reproduces the
 * pre-fix query inline to prove the bug was real before proving it is fixed
 * (Rule 18 — "a gate is not trusted until it has been made to fail").
 *
 * Dates are fixed rather than computed off "today" so this test keeps
 * meaning regardless of when it runs: 2026-08-17/2026-08-24 sit inside
 * ARCHIVED plans' `plan_workouts`, which Rule 14 confirms are never deleted
 * or rewritten, so their reign-stitched prescription is permanent history —
 * exactly like the reverted-plan dates `_owned_days_reign.audit.test.ts`
 * hardcodes from 2026-07/08.
 *
 * `read-only-db.ts` reads `DATABASE_URL_RO` directly — unlike
 * `@/lib/db/pool`, there is no `DATABASE_URL` override dance needed here, so
 * `buildLiveCanonicalInput` can be imported statically.
 */
import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';
import { buildLiveCanonicalInput } from './live-input';

const RO = process.env.DATABASE_URL_RO;
const OWNER = '0645f40c-951d-4ccc-b86e-9979cd26c795';

// The exact rebuild the F038 report replayed.
const PRE_REBUILD_PLAN = 'pln_7636bcc0a201bf2d'; // authored 2026-09-03
const POST_REBUILD_PLAN = 'pln_7da73e1da5ea7f6f'; // authored 2026-09-14 04:04 UTC

// `asOf` values that resolve `AS_AUTHORED_AT` to each side of the rebuild —
// verified directly against `training_plans` before writing this test.
const PRE_ASOF_ISO = '2026-09-13T12:00:00Z';
const POST_ASOF_ISO = '2026-09-14T12:00:00Z';

// The report's §2 table, reign-stitched — both weeks sit in ARCHIVED plans
// entirely before either boundary, so both replays must see the SAME values.
const EXPECTED_WEEKS: Array<{ weekStartISO: string; prescribedMi: number; authoredPlanMode: string; isCutback: boolean }> = [
  { weekStartISO: '2026-08-17', prescribedMi: 17, authoredPlanMode: 'RECOVERY', isCutback: false },
  { weekStartISO: '2026-08-24', prescribedMi: 38, authoredPlanMode: 'RECOVERY', isCutback: false },
];

/**
 * RULE 18 · LIVENESS. A `describe.skipIf` that silently reports green with no
 * database is a gate that passed by looking at nothing. This block always
 * runs and fails loudly if `DATABASE_URL_RO` is unset, matching
 * `_authoring_shadow_compare.audit.test.ts`'s own convention.
 */
describe('F038 REIGN SCOPING · liveness', () => {
  it('states whether the DB-backed replay ran at all', () => {
    if (RO) {
      console.log('AUDIT LIVENESS · DATABASE_URL_RO present — the DB-backed replay RAN.');
      expect(RO.length).toBeGreaterThan(10);
      return;
    }
    console.log(
      'AUDIT LIVENESS · DATABASE_URL_RO ABSENT — the DB-backed replay DID NOT RUN.\n'
      + '  Nothing below this line is evidence about production. Set DATABASE_URL_RO, or set\n'
      + '  ALLOW_AUDIT_SKIP=1 to acknowledge the gap deliberately.',
    );
    expect(
      process.env.ALLOW_AUDIT_SKIP === '1',
      'the F038 reign-scoping replay cannot run without DATABASE_URL_RO, and skipping it silently '
      + 'would report green for a check that looked at nothing (Rule 18)',
    ).toBe(true);
  });
});

const d = RO ? describe : describe.skip;

d('F038 REIGN SCOPING · real rebuild boundary, real account', () => {
  it('FALSIFIER: the pre-fix active-plan-only scoping really does lose these weeks — and inconsistently, which is the deeper defect', async () => {
    // Reproduces `readPlanWorkouts(plan.id)`'s literal scoping — `WHERE
    // plan_id = $1`, nothing else — the exact query the loader used before
    // this fix. A throwaway pool over DATABASE_URL_RO only; this never
    // touches `@/lib/db/pool`.
    //
    // Verified directly against production before writing this assertion:
    // the PRE-rebuild plan happens to carry week 08-24's own rows (it was
    // authored close enough to still cover it) but not 08-17's; the
    // POST-rebuild plan carries NEITHER. That inconsistency — which week
    // survives depends on incidental plan-authoring history, not on whether
    // the runner actually trained that week — is exactly the instability
    // this fix removes: the reign-stitched query gives the SAME correct
    // answer for both weeks regardless of which plan happens to be active.
    const pool = new Pool({ connectionString: RO, max: 1 });
    try {
      const rowsFor = async (planId: string): Promise<Map<string, number>> => {
        const r = await pool.query<{ wk: string; mi: string | null }>(
          `SELECT date_trunc('week', date_iso::date)::date::text AS wk, SUM(distance_mi)::text AS mi
             FROM plan_workouts
            WHERE plan_id = $1 AND date_iso >= '2026-08-17' AND date_iso < '2026-08-31'
            GROUP BY 1`,
          [planId],
        );
        return new Map(r.rows.map((row) => [row.wk, Number(row.mi)]));
      };
      const pre = await rowsFor(PRE_REBUILD_PLAN);
      const post = await rowsFor(POST_REBUILD_PLAN);
      expect(pre.has('2026-08-17'), 'pre-rebuild plan, week 08-17 (pre-fix scoping)').toBe(false);
      expect(pre.get('2026-08-24'), 'pre-rebuild plan, week 08-24 (pre-fix scoping)').toBe(38);
      expect(post.has('2026-08-17'), 'post-rebuild plan, week 08-17 (pre-fix scoping)').toBe(false);
      expect(post.has('2026-08-24'), 'post-rebuild plan, week 08-24 (pre-fix scoping)').toBe(false);
    } finally {
      await pool.end();
    }
  });

  it('resolves AS_AUTHORED_AT to the exact two plans the F038 report replayed', async () => {
    const pre = await buildLiveCanonicalInput(OWNER, PRE_ASOF_ISO, 'AS_AUTHORED_AT');
    const post = await buildLiveCanonicalInput(OWNER, POST_ASOF_ISO, 'AS_AUTHORED_AT');
    expect(pre.input?.planVersion, 'pre-rebuild plan').toBe(PRE_REBUILD_PLAN);
    expect(post.input?.planVersion, 'post-rebuild plan').toBe(POST_REBUILD_PLAN);
  });

  it('THE FIX: weeks 08-17 and 08-24 are present with their real reign-stitched mileage, on BOTH sides of the rebuild', async () => {
    for (const asOfISO of [PRE_ASOF_ISO, POST_ASOF_ISO]) {
      const result = await buildLiveCanonicalInput(OWNER, asOfISO, 'AS_AUTHORED_AT');
      expect(result.input, `input for asOf ${asOfISO}`).toBeTruthy();
      const byWeek = new Map(result.input!.weeks.map((w) => [w.weekStartISO, w]));
      for (const exp of EXPECTED_WEEKS) {
        const got = byWeek.get(exp.weekStartISO);
        expect(got, `week ${exp.weekStartISO} present (asOf ${asOfISO})`).toBeTruthy();
        expect(got!.prescribedMi, `week ${exp.weekStartISO} prescribedMi (asOf ${asOfISO})`).toBe(exp.prescribedMi);
        expect(got!.authoredPlanMode, `week ${exp.weekStartISO} authoredPlanMode (asOf ${asOfISO})`).toBe(exp.authoredPlanMode);
        expect(got!.isCutback, `week ${exp.weekStartISO} isCutback (asOf ${asOfISO})`).toBe(exp.isCutback);
      }
    }
  });

  it('the two replays see IDENTICAL backward evidence for those weeks — the rebuild does not move the clock', async () => {
    const pre = await buildLiveCanonicalInput(OWNER, PRE_ASOF_ISO, 'AS_AUTHORED_AT');
    const post = await buildLiveCanonicalInput(OWNER, POST_ASOF_ISO, 'AS_AUTHORED_AT');
    const preByWeek = new Map(pre.input!.weeks.map((w) => [w.weekStartISO, w]));
    const postByWeek = new Map(post.input!.weeks.map((w) => [w.weekStartISO, w]));
    for (const { weekStartISO } of EXPECTED_WEEKS) {
      expect(postByWeek.get(weekStartISO)?.prescribedMi, weekStartISO)
        .toBe(preByWeek.get(weekStartISO)?.prescribedMi);
      expect(postByWeek.get(weekStartISO)?.authoredPlanMode, weekStartISO)
        .toBe(preByWeek.get(weekStartISO)?.authoredPlanMode);
    }
  });

  it('FALSIFIER GUARD DID NOT WEAKEN: forward-looking nextWeekPrescribedMi is STILL current-plan-scoped and correctly DIFFERS across the rebuild', async () => {
    // The point of F038 is that BACKWARD evidence must not reset. It is
    // explicitly NOT the point that forward-looking fields should also
    // become reign-stitched — see F038 report §4. This proves this fix did
    // not accidentally cross that line: the forward value legitimately
    // changes across the rebuild, exactly like it did before this fix,
    // because it always reads the CURRENT plan's own next week.
    const pool = new Pool({ connectionString: RO, max: 1 });
    try {
      const rawNextWeek = async (planId: string, fromISO: string, toISO: string): Promise<number> => {
        const r = await pool.query<{ mi: string | null }>(
          `SELECT SUM(distance_mi)::text AS mi FROM plan_workouts
            WHERE plan_id = $1 AND date_iso >= $2 AND date_iso < $3`,
          [planId, fromISO, toISO],
        );
        return Number(r.rows[0]?.mi ?? 0);
      };
      const preExpected = await rawNextWeek(PRE_REBUILD_PLAN, '2026-09-14', '2026-09-21');
      const postExpected = await rawNextWeek(POST_REBUILD_PLAN, '2026-09-21', '2026-09-28');
      expect(preExpected, 'sanity: the two raw forward reads are not both zero').toBeGreaterThan(0);
      expect(postExpected, 'sanity: the two raw forward reads are not both zero').toBeGreaterThan(0);
      expect(preExpected, 'pre/post forward reads must differ — the rebuild changed the plan on purpose')
        .not.toBe(postExpected);

      const pre = await buildLiveCanonicalInput(OWNER, PRE_ASOF_ISO, 'AS_AUTHORED_AT');
      const post = await buildLiveCanonicalInput(OWNER, POST_ASOF_ISO, 'AS_AUTHORED_AT');
      expect(pre.input!.plan.nextWeekPrescribedMi, 'pre-rebuild nextWeekPrescribedMi').toBe(preExpected);
      expect(post.input!.plan.nextWeekPrescribedMi, 'post-rebuild nextWeekPrescribedMi').toBe(postExpected);
    } finally {
      await pool.end();
    }
  });
});
