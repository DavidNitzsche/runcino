/**
 * lib/adaptation-harness/pace-canary.harness.test.ts · the owner-only PACE
 * canary's WRITE-PATH tests.
 *
 * `db/migrations/161_pace_canary_applications.sql` is DRAFTED, NOT APPLIED
 * to production (see that file's header and CLAUDE.md's DDL rule — a table
 * this significant needs David's own explicit per-statement go, separate
 * from tonight's build). Per the task's own instruction ("test the write
 * path against a disposable/rollback-safe mechanism... instead"), this suite
 * applies that SAME drafted migration to the local, disposable
 * `faff_adapt_harness` scratch database ONLY — never production — and tests
 * against it there. `assertHarnessDatabase()` (`lib/adaptation-harness/
 * fence.ts`) is called before anything else in this file, on top of the
 * three independent fences that file already documents, specifically
 * because this suite is the one file in this repo that both APPLIES DDL and
 * exercises a real write path in the same run.
 *
 * Run with: bash scripts/adapt-harness.sh
 * (this file matches vitest.harness.config.ts's include glob:
 * lib/adaptation-harness/**\/*.harness.test.ts)
 *
 * What each test proves, mapped to the spec's "Verification, required" list:
 *
 *   · 'flag off ⇒ zero writes for a real, otherwise-qualifying account' —
 *     the exact claim item under test in the task.
 *   · 'atomic application — mid-write failure rolls back completely' — drives
 *     the REAL `mutatePlan` boundary (pace-canary.ts's own atomicity
 *     mechanism, not a re-implementation of it) with the identical write
 *     shape pace-canary.ts uses, and injects a failure after real partial
 *     writes.
 *   · 'rate limit blocks a second application within 7 days' — against a
 *     real persisted `pace_canary_applications` row.
 *   · 'nightly reanchor recognizes a canary-applied change and defers,
 *     rather than silently clobbering it' — drives the real
 *     `adapterMovedAnchorWithin` / `selfHealShouldDefer` pair.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { assertHarnessDatabase, OWNER_UUID } from './fence';

assertHarnessDatabase();

import { pool } from '@/lib/db/pool';
import { mutatePlan } from '@/lib/plan/mutate';
import {
  _resetPaceCanaryTableProbeForTests,
  runPaceCanaryCycle,
  rollbackPaceCanaryApplication,
} from '@/lib/adaptation/pace-canary';
import { checksumActivePlanWorkouts } from '@/lib/adaptation/shadow-compare';
import { adapterMovedAnchorWithin, selfHealShouldDefer } from '@/lib/training/pace-anchor';
import { resetToBase } from './substrate';

const OWNER = OWNER_UUID;
const TODAY = '2026-09-01';

beforeAll(async () => {
  // Apply the DRAFTED migration to the local scratch database ONLY. This is
  // the "disposable/rollback-safe mechanism" the task names as the
  // alternative to flipping the flag on for real — this table has never
  // been, and is not being, created in production by this test run.
  const sql = await fs.readFile(
    path.join(process.cwd(), 'db/migrations/161_pace_canary_applications.sql'), 'utf8',
  );
  await pool.query(sql);
  // `adapt-harness-substrate.sh` snapshots schema `base` from every table
  // that existed in `public` at substrate-build time, which predates this
  // table. `resetToBase()` (substrate.ts) TRUNCATEs and restores EVERY
  // public table from its `base` twin, so it needs one to exist for this
  // table too, or it errors on the very first `beforeEach`. Snapshotting an
  // EMPTY twin here (rather than teaching substrate.ts about a table it does
  // not otherwise need to know exists) keeps this migration's local-only
  // footprint contained to this file.
  await pool.query(
    `CREATE TABLE IF NOT EXISTS base.pace_canary_applications AS
       TABLE public.pace_canary_applications WITH NO DATA`,
  );
  _resetPaceCanaryTableProbeForTests();
});

beforeEach(async () => {
  await resetToBase();
  _resetPaceCanaryTableProbeForTests();
  delete process.env.PACE_CANARY_ENABLED;
  delete process.env.PACE_CANARY_ALLOWLIST;
  delete process.env.PACE_CANARY_KILL;
});

describe('flag off ⇒ zero database writes, for a real account with real, otherwise-qualifying evidence', () => {
  it('produces a byte-identical plan_workouts checksum before and after, with the flag at its default (unset)', async () => {
    // No PACE_CANARY_ENABLED set — the committed default. The owner's real,
    // harness-copied account/evidence is used deliberately: this is the
    // account most likely to have a PROGRESS-eligible PACE proposal tonight
    // (per docs/reports/handback-round3-2026-09-01.md §4, this account's
    // plan classifies REANCHORED_CANONICALLY — i.e. NOT auto-excluded by the
    // convergence guard), so a false-negative "of course nothing wrote, there
    // was nothing to write" cannot hide behind this test.
    const before = await checksumActivePlanWorkouts(OWNER);
    const beforeAppCount = (await pool.query(`SELECT COUNT(*)::int AS n FROM pace_canary_applications`)).rows[0].n;
    const beforeIntentCount = (await pool.query(
      `SELECT COUNT(*)::int AS n FROM coach_intents WHERE reason = 'plan_adapt_pace_canary_applied'`,
    )).rows[0].n;

    const result = await runPaceCanaryCycle(OWNER, TODAY);

    expect(result.status).toBe('skipped_gate_closed');
    const after = await checksumActivePlanWorkouts(OWNER);
    expect(after).toBe(before);
    const afterAppCount = (await pool.query(`SELECT COUNT(*)::int AS n FROM pace_canary_applications`)).rows[0].n;
    const afterIntentCount = (await pool.query(
      `SELECT COUNT(*)::int AS n FROM coach_intents WHERE reason = 'plan_adapt_pace_canary_applied'`,
    )).rows[0].n;
    // Not just plan_workouts — NOTHING was written, not even a refusal audit
    // row (a "gate closed" cycle persists literally nothing; see
    // pace-canary.ts's own comment on why).
    expect(afterAppCount).toBe(beforeAppCount);
    expect(afterIntentCount).toBe(beforeIntentCount);
  });

  it('stays a no-op with PACE_CANARY_ENABLED=1 but the owner NOT on the allowlist (the second gate)', async () => {
    process.env.PACE_CANARY_ENABLED = '1';
    // Allowlist deliberately left empty / not containing OWNER.
    const before = await checksumActivePlanWorkouts(OWNER);
    const result = await runPaceCanaryCycle(OWNER, TODAY);
    expect(result.status).toBe('skipped_gate_closed');
    expect(await checksumActivePlanWorkouts(OWNER)).toBe(before);
  });

  it('the kill switch overrides an otherwise-fully-enabled config', async () => {
    process.env.PACE_CANARY_ENABLED = '1';
    process.env.PACE_CANARY_ALLOWLIST = OWNER;
    process.env.PACE_CANARY_KILL = '1';
    const before = await checksumActivePlanWorkouts(OWNER);
    const result = await runPaceCanaryCycle(OWNER, TODAY);
    expect(result.status).toBe('skipped_gate_closed');
    expect(await checksumActivePlanWorkouts(OWNER)).toBe(before);
  });
});

describe('atomic application — mutatePlan (pace-canary.ts\'s own write mechanism) rolls back completely on a mid-write failure', () => {
  it('leaves plan_workouts byte-identical when the apply callback throws after real partial writes', async () => {
    // NOT filtered on `pace_target_s_per_mi IS NOT NULL` — this test drives
    // mutatePlan directly with fabricated write values (`?? 440` below), so
    // it only needs real row ids belonging to the owner's real active plan,
    // not rows that happen to already carry a priced pace. That keeps this
    // test's row count independent of how many quality-family rows this
    // particular harness snapshot's active plan happens to have priced —
    // a real, current fact about the copied substrate, not a defect in it.
    const rows = (await pool.query<{ id: string; pace_target_s_per_mi: number | null }>(
      `SELECT pw.id::text AS id, pw.pace_target_s_per_mi::float AS pace_target_s_per_mi
         FROM plan_workouts pw JOIN training_plans tp ON tp.id = pw.plan_id
        WHERE tp.user_uuid = $1::uuid AND tp.archived_iso IS NULL
        ORDER BY pw.date_iso ASC LIMIT 3`,
      [OWNER],
    )).rows;
    expect(rows.length).toBe(3); // liveness — the harness substrate must have real plan_workouts rows

    const before = await checksumActivePlanWorkouts(OWNER);
    const planId = (await pool.query<{ id: string }>(
      `SELECT id FROM training_plans WHERE user_uuid = $1::uuid AND archived_iso IS NULL LIMIT 1`,
      [OWNER],
    )).rows[0].id;

    // Identical write shape to pace-canary.ts's applyEligiblePaceCanary: N
    // sequential plan_workouts UPDATEs, then a coach_intents INSERT — except
    // the third UPDATE is replaced with a deliberate thrown error, injected
    // AFTER two real UPDATEs already executed inside the same transaction.
    const boundary = await mutatePlan<void>({
      userUuid: OWNER, planId, todayISO: TODAY, source: 'adaptation/pace-canary-atomicity-test',
      touches: 'derivations',
      detail: { test: 'injected-mid-write-failure' },
      apply: async (tx) => {
        await tx.query(`UPDATE plan_workouts SET pace_target_s_per_mi = $1 WHERE id = $2`,
          [Math.round((rows[0].pace_target_s_per_mi ?? 440) - 3), rows[0].id]);
        await tx.query(`UPDATE plan_workouts SET pace_target_s_per_mi = $1 WHERE id = $2`,
          [Math.round((rows[1].pace_target_s_per_mi ?? 440) - 3), rows[1].id]);
        throw new Error('INJECTED FAILURE · simulating a mid-write fault before the third row');
      },
    }).catch((e: Error) => e);

    // mutatePlan does not swallow an error thrown by `apply` (see its own
    // header: "Errors thrown by apply itself DO propagate (after
    // rollback)") — assert it actually propagated, not that it silently
    // returned ok:false.
    expect(boundary).toBeInstanceOf(Error);
    expect((boundary as Error).message).toContain('INJECTED FAILURE');

    const after = await checksumActivePlanWorkouts(OWNER);
    expect(after).toBe(before);
    for (const r of rows) {
      const live = (await pool.query<{ pace_target_s_per_mi: number | null }>(
        `SELECT pace_target_s_per_mi::float AS pace_target_s_per_mi FROM plan_workouts WHERE id = $1`,
        [r.id],
      )).rows[0];
      expect(live.pace_target_s_per_mi).toBe(r.pace_target_s_per_mi);
    }
  });
});

describe('rate limit — blocks a second APPLIED cycle within 7 days, against real persisted state', () => {
  async function forceFullyEligibleGate() {
    process.env.PACE_CANARY_ENABLED = '1';
    process.env.PACE_CANARY_ALLOWLIST = OWNER;
  }

  it('the first eligible cycle either applies or refuses for a content reason — never for the rate limit', async () => {
    await forceFullyEligibleGate();
    const result = await runPaceCanaryCycle(OWNER, TODAY);
    // Whatever the owner's real harness-copied evidence resolves to today
    // (applied, or refused for a REAL content reason), it must never be
    // RATE_LIMITED on a completely empty applications table.
    expect(result.refusalCode).not.toBe('RATE_LIMITED');
  });

  it('refuses a second cycle 2 days after a real recorded APPLIED row, and allows one 8 days after', async () => {
    await forceFullyEligibleGate();
    const planId = (await pool.query<{ id: string }>(
      `SELECT id FROM training_plans WHERE user_uuid = $1::uuid AND archived_iso IS NULL LIMIT 1`,
      [OWNER],
    )).rows[0].id;

    // Seed a real 'applied' row directly — the same shape runPaceCanaryCycle
    // itself would insert, dated 2 days before TODAY.
    await pool.query(
      `INSERT INTO pace_canary_applications
         (user_uuid, plan_id, today_iso, requested_at, status, refusal_code, refusal_detail,
          shadow_compare_record, target_phase_labels, rows_before, rows_after,
          post_write_verified, coach_intent_written)
       VALUES ($1,$2,'2026-08-30','2026-08-30T03:00:00Z','applied',NULL,'ELIGIBLE','{}'::jsonb,'{}','[]'::jsonb,'[]'::jsonb,true,true)`,
      [OWNER, planId],
    );

    const tooSoon = await runPaceCanaryCycle(OWNER, '2026-09-01'); // 2 days later
    expect(tooSoon.status).toBe('refused');
    expect(tooSoon.refusalCode).toBe('RATE_LIMITED');

    const laterEnough = await runPaceCanaryCycle(OWNER, '2026-09-07'); // 8 days later
    expect(laterEnough.refusalCode).not.toBe('RATE_LIMITED');
  });
});

describe('nightly reanchor recognizes a canary-applied change and defers rather than silently overwriting it', () => {
  it('adapterMovedAnchorWithin sees a plan_adapt_pace_canary_applied coach_intents row', async () => {
    const planId = (await pool.query<{ id: string }>(
      `SELECT id FROM training_plans WHERE user_uuid = $1::uuid AND archived_iso IS NULL LIMIT 1`,
      [OWNER],
    )).rows[0].id;

    // Before the write, the self-heal has nothing to defer to.
    const beforeMove = await adapterMovedAnchorWithin(pool, OWNER, 24);
    expect(beforeMove).toBe(false);

    // Write the exact row applyEligiblePaceCanary writes on a real application.
    await pool.query(
      `INSERT INTO coach_intents (user_id, user_uuid, reason, field, value)
       VALUES ($1, $1, 'plan_adapt_pace_canary_applied', $2, $3)`,
      [OWNER, planId, JSON.stringify({ why: 'test canary application', phases: [], rowIds: [] })],
    );

    const afterMove = await adapterMovedAnchorWithin(pool, OWNER, 24);
    expect(afterMove).toBe(true);

    // And the actual policy function the self-heal calls agrees: it defers.
    expect(selfHealShouldDefer({ upgradesProvisionalAnchor: false, adapterMoveRecent: afterMove })).toBe(true);

    // An upgrade (provisional → measured) still never defers — the canary's
    // presence does not disable the one case that must always fire.
    expect(selfHealShouldDefer({ upgradesProvisionalAnchor: true, adapterMoveRecent: afterMove })).toBe(false);
  });

  it('after the 24h defer window, the canary\'s own row no longer counts — a later reanchor is free to run (and would visibly supersede, via its own stamp+intent, never silently)', async () => {
    const planId = (await pool.query<{ id: string }>(
      `SELECT id FROM training_plans WHERE user_uuid = $1::uuid AND archived_iso IS NULL LIMIT 1`,
      [OWNER],
    )).rows[0].id;
    await pool.query(
      `INSERT INTO coach_intents (user_id, user_uuid, reason, field, value, ts)
       VALUES ($1, $1, 'plan_adapt_pace_canary_applied', $2, '{}'::jsonb, NOW() - INTERVAL '30 hours')`,
      [OWNER, planId],
    );
    const stillDeferring = await adapterMovedAnchorWithin(pool, OWNER, 24);
    expect(stillDeferring).toBe(false);
  });
});

describe('rollback — one call restores the captured prior-state snapshot', () => {
  it('restores the exact pre-application pace_target_s_per_mi values and marks the application rolled_back', async () => {
    // Same reasoning as the atomicity test above — not filtered on a
    // pre-existing non-null pace, since this test overwrites the value
    // itself and only needs real row ids on the owner's real active plan.
    // DOES filter out sealed days (a completed run already exists) — the
    // rollback function correctly refuses to restore those (Rule 15), so a
    // row this test picks that happens to be sealed would make
    // `rowsRestored` legitimately less than `rows.length`, which is a
    // property of the rollback safety guard, not something this test (about
    // the restore mechanism itself) should have to account for.
    const rows = (await pool.query<{ id: string; pace_target_s_per_mi: number | null }>(
      `SELECT pw.id::text AS id, pw.pace_target_s_per_mi::float AS pace_target_s_per_mi
         FROM plan_workouts pw JOIN training_plans tp ON tp.id = pw.plan_id
        WHERE tp.user_uuid = $1::uuid AND tp.archived_iso IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM runs r
             WHERE r.user_uuid = $1::uuid
               AND COALESCE(r.data->>'date', LEFT(r.data->>'startLocal', 10))::date = pw.date_iso::date
               AND NOT (r.data ? 'mergedIntoId')
          )
        ORDER BY pw.date_iso ASC LIMIT 2`,
      [OWNER],
    )).rows;
    expect(rows.length).toBe(2); // liveness — the harness substrate must have real, unsealed plan_workouts rows
    const planId = (await pool.query<{ id: string }>(
      `SELECT id FROM training_plans WHERE user_uuid = $1::uuid AND archived_iso IS NULL LIMIT 1`,
      [OWNER],
    )).rows[0].id;

    const rowsBefore = rows.map((r) => ({
      id: r.id, dateIso: '2026-09-08', type: 'threshold', phaseLabel: 'QUALITY',
      paceTargetSPerMi: r.pace_target_s_per_mi,
    }));

    // Simulate a landed application directly (bypassing the eligibility
    // pipeline — this test is about the rollback mechanism specifically).
    for (const r of rows) {
      await pool.query(`UPDATE plan_workouts SET pace_target_s_per_mi = $1 WHERE id = $2`,
        [Math.round((r.pace_target_s_per_mi ?? 440) - 3), r.id]);
    }
    const appId = (await pool.query<{ id: string }>(
      `INSERT INTO pace_canary_applications
         (user_uuid, plan_id, today_iso, status, refusal_code, refusal_detail,
          shadow_compare_record, target_phase_labels, rows_before, rows_after,
          post_write_verified, coach_intent_written)
       VALUES ($1,$2,$3,'applied',NULL,'ELIGIBLE','{}'::jsonb,'{QUALITY}',$4,'[]'::jsonb,true,true)
       RETURNING id::text`,
      [OWNER, planId, TODAY, JSON.stringify(rowsBefore)],
    )).rows[0].id;

    const result = await rollbackPaceCanaryApplication(Number(appId), 'harness test rollback');
    expect(result.ok).toBe(true);
    expect(result.rowsRestored).toBe(rows.length);

    for (const r of rows) {
      const live = (await pool.query<{ pace_target_s_per_mi: number | null }>(
        `SELECT pace_target_s_per_mi::float AS pace_target_s_per_mi FROM plan_workouts WHERE id = $1`,
        [r.id],
      )).rows[0];
      expect(live.pace_target_s_per_mi).toBe(r.pace_target_s_per_mi);
    }

    const statusRow = (await pool.query<{ status: string }>(
      `SELECT status FROM pace_canary_applications WHERE id = $1`, [appId],
    )).rows[0];
    expect(statusRow.status).toBe('rolled_back');

    // Idempotency: rolling back the same application again refuses.
    const second = await rollbackPaceCanaryApplication(Number(appId), 'second attempt');
    expect(second.ok).toBe(false);
  });
});
