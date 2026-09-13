/**
 * lib/plan/_mutation_read_honesty.db.test.ts · CLAUDE.md Rule 11, the three
 * reads the round-4 fix left behind.
 *
 * `_archived_plan_guard_swallowed_failure.db.test.ts` closed ONE swallowed read
 * in `mutatePlan` and said so honestly in its own Rule 22 section: "any OTHER
 * swallowed-failure site in mutate.ts" was out of scope. The round-5 review
 * disagreed with the scoping and was right. This file covers the rest.
 *
 * ── 1 · CALLERHONESTY-1 · THE "NO planId SUPPLIED" FALLBACK ─────────────────
 *
 *     planId = (await client.query(`SELECT id FROM training_plans
 *                WHERE user_uuid = $1::uuid AND archived_iso IS NULL ...`)
 *              .catch(() => ({ rows: [] }))).rows[0]?.id ?? null;
 *
 * The IDENTICAL shape the round-4 fix removed one branch over, reached when the
 * caller names no plan at all. A thrown read became zero rows, `planId` stayed
 * null, and step 3 refused with `no_plan` — the sentence "this runner has no
 * active plan", asserted as fact and written to `plan_mutation_rejections`,
 * about a runner who may have one. `no_plan` is a real outcome (a runner
 * genuinely between blocks) and that is exactly why "we could not tell" may not
 * borrow its name.
 *
 * ── 2 · CONTEXTREAD-1 · THE VALIDATOR'S OWN INPUTS ──────────────────────────
 *
 * `loadMutationContext`'s two queries each carried a bare
 * `.catch(() => ({ rows: [] }))` and NEITHER LOGGED, which `lib/db/read.ts`'s
 * header names as the floor no read may fall below. Worse than silent: the
 * fallbacks are not neutral. `raceDistanceMi` falls back to 26.2, the most
 * permissive long-run cap row in CONSTRAINTS; `trainingDaysPerWeek` falls back
 * to null, which `validateComposedPlan` reads as NO FREQUENCY CAP AT ALL. So a
 * transient failure quietly WEAKENED the only gate standing in front of a
 * structural plan write, in the runner's favour and against his legs — Rule
 * 11's named failure verbatim ("a missing input must never silently disable a
 * safety mechanism").
 *
 * ── 3 · LINEAGEREAD-1 · THE REPLACED-PLAN LOOKUP ────────────────────────────
 *
 * `rowOrNull(...)?.id ?? null`. Defended in round 4 as an argued exemption
 * ("audit-only, a lineage lookup must never fail a rebuild"). Half right. It
 * must not fail a rebuild, and it still does not. But the value is not
 * consumed and discarded, it is WRITTEN DOWN, permanently:
 *
 *   · `resolvePlanLineage` reads a null `replacedPlanId` as "replaced nothing"
 *     and returns the NEW plan's own id, opening a FRESH `plan_lineage_id`.
 *     Every decision recorded against the previous block becomes unreachable
 *     by lineage, forever, which is the one thing that column exists to stop.
 *   · the ledger explanation literally read "a new plan was authored and
 *     replaced nothing. This row opens its lineage."
 *
 * A false claim about the runner's plan history, in a durable record, produced
 * by a read that never completed.
 *
 * ── HOW THE FAILURES ARE FORCED · REAL, NOT MOCKED (Rule 13/18) ─────────────
 *
 * The same lever the round-4 file established: `$n::uuid`. Binding a string
 * that is not a UUID makes Postgres itself raise `invalid input syntax for type
 * uuid` when that statement executes. Which statement fails is chosen by which
 * ENTRY POINT is used, and that is the whole trick here:
 *
 *   · no `planId`, no `workoutId`   → the archived-plan guard is skipped and
 *                                     the ACTIVE-PLAN FALLBACK is the first
 *                                     statement to bind the bad uuid.  → case 1
 *   · `workoutId` only              → the workout lookup binds `$1` as TEXT and
 *                                     succeeds, resolving the plan; the first
 *                                     `::uuid` bind is then the PROFILE query
 *                                     inside `loadMutationContext`. → case 2
 *
 * No table is renamed and no schema is touched, deliberately: the one suite in
 * this repo that does rename a shared table (`_move_ledger_absent.db.test.ts`)
 * is why `npx vitest run lib/plan` reports 13 failures in parallel and 6 with
 * `--no-file-parallelism`. Adding a second one would deepen that.
 *
 * ── REACHABILITY ────────────────────────────────────────────────────────────
 *
 * Same fixture contract as the sibling `_archived_plan_*.db.test.ts` files.
 * Skips and prints why otherwise, rather than reporting clean having looked at
 * nothing.
 *
 *     bash web-v2/scripts/_build_roundtrip_scratch.sh
 *     DATABASE_URL=postgresql://localhost/faff_roundtrip_scratch \
 *       npx vitest run lib/plan/_mutation_read_honesty.db.test.ts
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ─────────────────────────────────
 *
 * · CASE 3 END-TO-END. The lineage read is issued on the MUTATION'S OWN
 *   transaction, and a Postgres-side rejection aborts that transaction, so the
 *   commit this defect needs in order to persist its false claim cannot be
 *   reached by forcing a server-side error. The failure class that produces it
 *   is a driver-local or connection-level rejection of that one statement
 *   (`attempt`'s whole reason for existing). So case 3 is falsified in three
 *   separable pieces — the READ site's collapse, the RESOLVER's consequence,
 *   and the PERSISTED column — rather than in one end-to-end run. Said plainly
 *   here rather than papered over with a mock that would prove nothing.
 * · The `workoutId` owner lookup (`mutate.ts`, between the two fixed reads) has
 *   no `.catch` at all and never had one. A throw there PROPAGATES, which is
 *   loud and distinguishable and therefore not a Rule 11 collapse; it is left
 *   alone on purpose and is not asserted here.
 * · Whether the refusals READ well. That is `_mutation_refusal.test.ts`.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pool } from '@/lib/db/pool';
import { mutatePlan, loadMutationContext } from './mutate';
import { resolvePlanLineage, recordDecision, LINEAGE_UNKNOWN_PREFIX } from '@/lib/brain/ledger/decision-ledger';
import { PLAN_MUTATION_BOUNDARY_MODEL_VERSION } from '@/lib/brain/ledger/ledger-entry';
import type { PoolClient } from 'pg';

const SCRATCH_DB = 'faff_roundtrip_scratch';
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '']);

function scratchVerdict(url: string | undefined, label: string): string | null {
  if (!url) return `${label} is not set`;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return `${label} is not a parseable URL`; }
  if (!LOOPBACK.has(parsed.hostname)) {
    return `${label} points at host '${parsed.hostname}', which is not loopback`;
  }
  const db = parsed.pathname.replace(/^\//, '');
  if (db !== SCRATCH_DB) return `${label} names database '${db}', not '${SCRATCH_DB}'`;
  return null;
}

const refusals = [scratchVerdict(process.env.DATABASE_URL, 'DATABASE_URL')]
  .filter((x): x is string => x !== null);
const REACHABLE = refusals.length === 0;
const when = REACHABLE ? it : it.skip;

const TODAY = '2026-09-13';
const DATE_ISO = '2026-09-15';

/** Not a valid UUID. Bound to a `$n::uuid` parameter it makes Postgres raise
 *  `invalid input syntax for type uuid` — a real, deterministic failure. */
const MALFORMED_USER_UUID = 'not-a-real-uuid-at-all';

let RUNNER = '';

async function seedRunner(): Promise<void> {
  RUNNER = randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash)
     VALUES ($1::uuid, $2, 'not-a-real-hash')
     ON CONFLICT (id) DO NOTHING`,
    [RUNNER, `read-honesty+${RUNNER.slice(0, 8)}@scratch.local`],
  );
}

/** One ACTIVE plan with one plan_workouts row on DATE_ISO. Returns both ids. */
async function seedPlan(): Promise<{ planId: string; workoutId: string }> {
  const planId = `pln_rdhon_${randomUUID().slice(0, 8)}`;
  const phaseId = `phs_${randomUUID().slice(0, 8)}`;
  const weekId = `wk_${randomUUID().slice(0, 8)}`;
  const workoutId = `pw_${randomUUID().slice(0, 8)}`;
  await pool.query(
    `INSERT INTO training_plans (id, user_id, user_uuid, mode, goal_iso, authored_state, archived_iso)
     VALUES ($1, $2::text, $3::uuid, 'race-prep', $4, '{}'::jsonb, NULL)`,
    [planId, RUNNER, RUNNER, TODAY],
  );
  await pool.query(
    `INSERT INTO plan_phases (id, plan_id, label, start_week_idx, end_week_idx, rationale, citation)
     VALUES ($1, $2, 'BUILD', 0, 0, 'seeded for the read-honesty suite', 'test')`,
    [phaseId, planId],
  );
  await pool.query(
    `INSERT INTO plan_weeks (id, plan_id, week_idx, week_start_iso, phase_id, rationale)
     VALUES ($1, $2, 0, $3, $4, 'seeded for the read-honesty suite')`,
    [weekId, planId, TODAY, phaseId],
  );
  await pool.query(
    `INSERT INTO plan_workouts
       (id, plan_id, week_id, date_iso, dow, type, distance_mi,
        is_quality, is_long, notes, pace_target_s_per_mi, workout_spec)
     VALUES ($1, $2, $3, $4, 1, 'easy', 6, false, false, '', 500, '{"kind":"easy"}'::jsonb)`,
    [workoutId, planId, weekId, DATE_ISO],
  );
  return { planId, workoutId };
}

async function workoutTypeOn(planId: string): Promise<string | undefined> {
  const r = await pool.query<{ type: string }>(
    `SELECT type FROM plan_workouts WHERE plan_id = $1 AND date_iso = $2::text`,
    [planId, DATE_ISO],
  );
  return r.rows[0]?.type;
}

const LIVENESS_TITLE = REACHABLE
  ? 'the scratch database was reachable · every assertion below actually ran'
  : `SKIPPED · THIS SUITE PROVED NOTHING · ${refusals.join('; ')}`;

describe('liveness · did this suite look at anything', () => {
  it(LIVENESS_TITLE, () => {
    if (!REACHABLE) {
      process.stderr.write(
        `\n[mutation-read-honesty] SKIPPED · THIS SUITE PROVED NOTHING.\n`
        + `  ${refusals.join('; ')}\n`
        + `  Build the fixture: bash web-v2/scripts/_build_roundtrip_scratch.sh\n`
        + `  Then run with: DATABASE_URL=postgresql://localhost/${SCRATCH_DB}\n\n`,
      );
    }
    expect(typeof REACHABLE).toBe('boolean');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * CASE 1 · the "no planId supplied" active-plan fallback
 * ═══════════════════════════════════════════════════════════════════════ */

/** A literal copy of the PRE-FIX fallback, kept here for the same reason the
 *  sibling suites keep theirs: `mutatePlan` has no seam to intercept. */
async function oldSwallowingFallback(client: PoolClient, userUuidMaybeInvalid: string): Promise<string | null> {
  return (await client.query<{ id: string }>(
    `SELECT id::text AS id FROM training_plans
      WHERE user_uuid = $1::uuid AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [userUuidMaybeInvalid],
  ).catch(() => ({ rows: [] as Array<{ id: string }> }))).rows[0]?.id ?? null;
}

describe('CALLERHONESTY-1 · the active-plan fallback no longer answers a failed read with `no_plan`', () => {
  let seeded: { planId: string; workoutId: string };

  beforeEach(async () => {
    if (!REACHABLE) return;
    await seedRunner();
    seeded = await seedPlan();
  });

  when(
    'BEFORE · the pre-fix `.catch(() => ({ rows: [] }))` returns null on a THROWN read — '
    + 'the exact value it returns for a runner with genuinely no active plan',
    async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const onFailure = await oldSwallowingFallback(client, MALFORMED_USER_UUID);
        await client.query('ROLLBACK');
        expect(
          onFailure,
          'the pre-fix fallback returned null on a real query rejection, which step 3 '
          + 'then reported as `no_plan` — an affirmative claim the read never established',
        ).toBeNull();
      } finally { client.release(); }

      // Control: the same statement with a VALID uuid finds the seeded plan,
      // proving the null above came from the forced failure and not the seed.
      const c2 = await pool.connect();
      try {
        await c2.query('BEGIN');
        const onSuccess = await oldSwallowingFallback(c2, RUNNER);
        await c2.query('ROLLBACK');
        expect(onSuccess, 'control failed: the seeded active plan should resolve').toBe(seeded.planId);
      } finally { c2.release(); }
    },
  );

  when(
    'AFTER · through the real mutatePlan() boundary, the same forced failure refuses as '
    + '`plan_verification_failed`, NEVER `no_plan`',
    async () => {
      const res = await mutatePlan<number>({
        userUuid: MALFORMED_USER_UUID,
        authority: 'RUNNER_INITIATED',
        source: 'test/mutation-read-honesty/active-plan-fallback',
        todayISO: TODAY,
        // No planId and no workoutId · this is the branch under test.
        touches: 'structural',
        apply: async (tx, planId) => {
          const r = await tx.query(
            `UPDATE plan_workouts SET type = 'recovery' WHERE plan_id = $1 AND date_iso = $2::text`,
            [planId, DATE_ISO],
          );
          return r.rowCount ?? 0;
        },
      });

      expect(res.ok).toBe(false);
      expect(
        res.outcome,
        'a failed active-plan read must not be reported as "this runner has no active plan"',
      ).toBe('plan_verification_failed');
      expect(res.outcome).not.toBe('no_plan');
      expect(
        res.violations.join(' '),
        'the recorded reason must name the read failure, and must say plainly that it is '
        + 'not the same fact as having no plan',
      ).toContain('NOT the same fact');
      expect(await workoutTypeOn(seeded.planId), 'the plan moved despite an unverified resolve').toBe('easy');
    },
  );

  when(
    'REGRESSION · a runner who GENUINELY has no active plan still refuses as `no_plan`',
    async () => {
      const orphan = randomUUID();
      await pool.query(
        `INSERT INTO users (id, email, password_hash) VALUES ($1::uuid, $2, 'x')
         ON CONFLICT (id) DO NOTHING`,
        [orphan, `orphan+${orphan.slice(0, 8)}@scratch.local`],
      );
      const res = await mutatePlan<number>({
        userUuid: orphan,
        authority: 'RUNNER_INITIATED',
        source: 'test/mutation-read-honesty/genuinely-no-plan',
        todayISO: TODAY,
        touches: 'structural',
        apply: async () => 0,
      });
      expect(res.ok).toBe(false);
      expect(
        res.outcome,
        'the measured absence of a plan must keep its own outcome, distinct from the new one',
      ).toBe('no_plan');
    },
  );
});

/* ══════════════════════════════════════════════════════════════════════════
 * CASE 2 · the validator context
 * ═══════════════════════════════════════════════════════════════════════ */

describe('CONTEXTREAD-1 · a failed validator-context read no longer weakens the gate silently', () => {
  let seeded: { planId: string; workoutId: string };

  beforeEach(async () => {
    if (!REACHABLE) return;
    await seedRunner();
    seeded = await seedPlan();
  });

  when(
    'BEFORE · a forced failure on the profile read produced a context that is BOTH maximally '
    + 'permissive AND indistinguishable from a successful read of a runner with no profile row',
    async () => {
      // The reader itself, with a malformed uuid: the plan query (a text bind)
      // succeeds and the profile query (`$1::uuid`) throws.
      const failed = await loadMutationContext(pool, MALFORMED_USER_UUID, seeded.planId, TODAY);
      const clean = await loadMutationContext(pool, RUNNER, seeded.planId, TODAY);

      // This is what the old code handed the validator, and what the new code
      // still computes — the fix is that it no longer hands it over silently.
      expect(failed.level, 'a failed profile read leaves the experience level unknown').toBeNull();
      /* LEDGERHONESTY-1 (2026-09-13) · the message here used to say a null
       * `trainingDaysPerWeek` is read as "NO frequency cap at all". False —
       * `validate.ts` has no frequency cap, and the field's only consumer
       * there SKIPS §5's quality-coverage check at `<= 1`, so a null makes
       * that check fire. What matters for THIS assertion is unchanged and is
       * the honest half: a failed read is indistinguishable from a runner with
       * no profile row. */
      expect(
        failed.trainingDaysPerWeek,
        'a failed profile read leaves trainingDaysPerWeek null, which the validator cannot '
        + 'tell apart from a runner whose frequency was genuinely never recorded',
      ).toBeNull();

      // And the pre-fix shape offered NOTHING to tell the two apart. Every
      // field that the validator reads is identical between "the read threw"
      // and "the runner has no profile row", which is the whole defect.
      expect(failed.raceDistanceMi).toBe(clean.raceDistanceMi);
      expect(failed.level).toBe(clean.level);
      expect(failed.trainingDaysPerWeek).toBe(clean.trainingDaysPerWeek);
      expect(failed.mode).toBe(clean.mode);
    },
  );

  when(
    'AFTER · the same forced failure is now reported on the context itself, and only on the '
    + 'read that actually failed',
    async () => {
      const failed = await loadMutationContext(pool, MALFORMED_USER_UUID, seeded.planId, TODAY);
      expect(failed.readFailed, 'the failed read left no mark on the context at all').toBeTruthy();
      expect(failed.readFailed?.profile, 'the profile read is the one that threw').toBe(true);
      expect(
        failed.readFailed?.plan,
        'the plan read binds its id as TEXT and did NOT throw; reporting it as failed '
        + 'would be its own false claim',
      ).toBe(false);

      const clean = await loadMutationContext(pool, RUNNER, seeded.planId, TODAY);
      expect(
        clean.readFailed,
        'a successful read must leave the marker ABSENT, not present-and-false',
      ).toBeUndefined();
    },
  );

  when(
    'AFTER · through the real mutatePlan() boundary, a structural write whose validator '
    + 'context could not be read is REFUSED, not graded by the weakened gate',
    async () => {
      const res = await mutatePlan<number>({
        userUuid: MALFORMED_USER_UUID,
        authority: 'RUNNER_INITIATED',
        source: 'test/mutation-read-honesty/context-read',
        todayISO: TODAY,
        // `workoutId` resolves the plan through a TEXT bind, so the first
        // statement to reject is the profile query inside loadMutationContext.
        workoutId: seeded.workoutId,
        touches: 'structural',
        apply: async (tx, planId) => {
          const r = await tx.query(
            `UPDATE plan_workouts SET type = 'recovery' WHERE plan_id = $1 AND date_iso = $2::text`,
            [planId, DATE_ISO],
          );
          return r.rowCount ?? 0;
        },
      });

      expect(res.ok, 'a write graded against a context that failed to load must not commit').toBe(false);
      expect(res.outcome).toBe('plan_verification_failed');
      expect(
        res.violations.join(' '),
        'the recorded reason must name the validator context, not the archived-plan guard',
      ).toContain('validator context');
      expect(await workoutTypeOn(seeded.planId), 'the row was rewritten anyway').toBe('easy');
    },
  );

  when(
    'REGRESSION · the same write with a VALID runner still applies · the refusal is caused by '
    + 'the failed read and by nothing else',
    async () => {
      const res = await mutatePlan<number>({
        userUuid: RUNNER,
        authority: 'RUNNER_INITIATED',
        source: 'test/mutation-read-honesty/context-read-control',
        todayISO: TODAY,
        workoutId: seeded.workoutId,
        touches: 'structural',
        apply: async (tx, planId) => {
          const r = await tx.query(
            `UPDATE plan_workouts SET type = 'recovery' WHERE plan_id = $1 AND date_iso = $2::text`,
            [planId, DATE_ISO],
          );
          return r.rowCount ?? 0;
        },
      });
      expect(res.ok, `the control write must succeed: ${JSON.stringify(res)}`).toBe(true);
      expect(await workoutTypeOn(seeded.planId)).toBe('recovery');
    },
  );
});

/* ══════════════════════════════════════════════════════════════════════════
 * CASE 3 · the replaced-plan lineage lookup
 * ═══════════════════════════════════════════════════════════════════════ */

/** A literal copy of the PRE-FIX lineage read: `rowOrNull(...)?.id ?? null`. */
async function oldCollapsingLineageRead(client: PoolClient, userUuidMaybeInvalid: string): Promise<string | null> {
  const { rowOrNull } = await import('@/lib/db/read');
  return (await rowOrNull<{ id: string }>(
    'test/old-lineage-read',
    client.query<{ id: string }>(
      `SELECT id::text AS id FROM training_plans
        WHERE user_uuid = $1::uuid AND archived_iso IS NULL
        ORDER BY authored_iso DESC LIMIT 1`,
      [userUuidMaybeInvalid],
    ),
  ))?.id ?? null;
}

describe('LINEAGEREAD-1 · a failed lineage lookup no longer claims the plan replaced nothing', () => {
  let seeded: { planId: string; workoutId: string };

  beforeEach(async () => {
    if (!REACHABLE) return;
    await seedRunner();
    seeded = await seedPlan();
  });

  when(
    'BEFORE · `rowOrNull(...)?.id ?? null` returns null on a THROWN read — the same value it '
    + 'returns for a runner who genuinely has no plan to replace',
    async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const onFailure = await oldCollapsingLineageRead(client, MALFORMED_USER_UUID);
        await client.query('ROLLBACK');
        expect(
          onFailure,
          'rowOrNull DOES distinguish undefined from null internally, and the `?? null` at '
          + 'the call site throws that distinction straight back away — which is what the '
          + 'round-4 review defended as an acceptable exemption',
        ).toBeNull();
      } finally { client.release(); }

      const c2 = await pool.connect();
      try {
        await c2.query('BEGIN');
        expect(await oldCollapsingLineageRead(c2, RUNNER)).toBe(seeded.planId);
        await c2.query('ROLLBACK');
      } finally { c2.release(); }
    },
  );

  when(
    'BEFORE · and that null makes resolvePlanLineage OPEN A NEW LINEAGE, which is a permanent, '
    + 'false statement about the runner\'s plan history',
    async () => {
      const asIfNothingReplaced = await resolvePlanLineage({
        userUuid: RUNNER,
        planId: seeded.planId,
        replacedPlanId: null,
        // the pre-fix world had no third state to pass
      });
      expect(
        asIfNothingReplaced,
        'the collapsed null resolves to the new plan\'s OWN id, i.e. a fresh lineage — every '
        + 'decision recorded against the block it actually replaced is now unreachable',
      ).toBe(seeded.planId);
      expect(asIfNothingReplaced.startsWith(LINEAGE_UNKNOWN_PREFIX)).toBe(false);
    },
  );

  when(
    'AFTER · the third state resolves to a distinct lineage-unknown marker instead',
    async () => {
      const unknown = await resolvePlanLineage({
        userUuid: RUNNER,
        planId: seeded.planId,
        replacedPlanId: null,
        replacedPlanUnknown: true,
      });
      expect(unknown).toBe(`${LINEAGE_UNKNOWN_PREFIX}${seeded.planId}`);
      expect(
        unknown,
        'it must not be a bare plan id, because a bare plan id is exactly the false claim',
      ).not.toBe(seeded.planId);
      // And it must still be distinguishable from the orphan marker, which
      // answers a different question ("no plan at all").
      expect(unknown.startsWith('orphan:')).toBe(false);
    },
  );

  when(
    'AFTER · a genuinely-nothing-to-replace authorship is UNAFFECTED · the two must stay apart',
    async () => {
      const opens = await resolvePlanLineage({
        userUuid: RUNNER,
        planId: seeded.planId,
        replacedPlanId: null,
        replacedPlanUnknown: false,
      });
      expect(opens).toBe(seeded.planId);
    },
  );

  when(
    'AFTER · the marker SURVIVES to the durable column · this is the half that matters, because '
    + 'the defect is a permanent record and not a transient response',
    async () => {
      const lineage = await resolvePlanLineage({
        userUuid: RUNNER,
        planId: seeded.planId,
        replacedPlanId: null,
        replacedPlanUnknown: true,
      });
      const written = await recordDecision({
        userUuid: RUNNER,
        planId: seeded.planId,
        planLineageId: lineage,
        replacedPlanId: null,
        planVersion: null,
        scope: 'PLAN',
        workoutIds: [],
        scopeFromISO: null,
        scopeToISO: null,
        lever: 'RECORD_ONLY',
        direction: 'UNKNOWN',
        evidence: [],
        provenance: 'test/mutation-read-honesty/lineage-unknown',
        sourceMode: null,
        beforeState: { comparable: false, workouts: 0, prescribedMi: 0 },
        afterState: { workouts: 0, prescribedMi: 0 },
        // AUTHORSHIP · the only authority under which the lineage read runs.
        authority: 'AUTHORSHIP',
        authorityVerdict: 'PERMITTED',
        hold: null,
        decision: 'APPLY',
        proposalId: null,
        proposal: null,
        runnerResponse: null,
        mutationOutcome: 'applied',
        mutationViolations: [],
        explanation: 'seeded by the round-5 lineage falsifier',
        modelVersion: PLAN_MUTATION_BOUNDARY_MODEL_VERSION,
        idempotencyKey: null,
      });
      if (written.state !== 'written') {
        // Rule 18: say what was not proved rather than passing quietly.
        throw new Error(
          `the ledger row did not land (${written.state}: ${written.why}), so the persisted `
          + 'half of this claim was NOT verified. Rebuild the scratch fixture.',
        );
      }
      const row = await pool.query<{ plan_lineage_id: string }>(
        `SELECT plan_lineage_id FROM plan_decision_ledger WHERE id = $1`,
        [written.id],
      );
      expect(
        row.rows[0]?.plan_lineage_id,
        'the durable column carries the bare plan id again, so a reader still cannot tell '
        + 'a rebuild that opened a lineage from one whose lineage was never read',
      ).toBe(`${LINEAGE_UNKNOWN_PREFIX}${seeded.planId}`);
    },
  );

  when(
    'AFTER · the read site in mutate.ts branches on attempt().ok and feeds the third state '
    + 'through · guards this file against drifting from the fix',
    () => {
      const src = readFileSync(join(__dirname, 'mutate.ts'), 'utf8');

      expect(
        src,
        'LINEAGEREAD-1 regressed: the collapsing `rowOrNull(...)?.id ?? null` lineage read is back',
      ).not.toContain("))?.id ?? null;");
      expect(
        src,
        'mutate.ts imports rowOrNull again · every read in this file must branch on attempt().ok',
      ).not.toContain("import { attempt, rowOrNull }");

      const idx = src.indexOf("'mutate/lineage-replaced-plan'");
      expect(idx, 'the lineage read no longer exists at all').toBeGreaterThan(-1);
      expect(
        src.slice(Math.max(0, idx - 200), idx),
        'the lineage read is no longer wrapped in attempt()',
      ).toContain('attempt(');
      expect(
        src.slice(idx, idx + 700),
        'the failure branch no longer sets replacedPlanUnknown',
      ).toContain('replacedPlanUnknown = true');
      expect(
        src,
        'the third state is no longer handed to resolvePlanLineage, so the ledger column '
        + 'is back to claiming a fresh lineage',
      ).toContain('replacedPlanUnknown: l.replacedPlanUnknown');
      expect(
        src,
        'the authorship account can still print "replaced nothing" for an unread lookup',
      ).toContain('WHETHER IT REPLACED AN EARLIER PLAN IS UNKNOWN');
    },
  );

  when(
    'AFTER · the two remaining swallow shapes in mutate.ts are gone · the whole round-5 scope, '
    + 'asserted on the source so a partial revert cannot pass',
    () => {
      const src = readFileSync(join(__dirname, 'mutate.ts'), 'utf8');
      const code = src
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');
      expect(
        code,
        'the active-plan fallback swallow is back',
      ).not.toContain(".catch(() => ({ rows: [] as Array<{ id: string }> }))");
      expect(
        code,
        'the loadMutationContext plan-row swallow is back',
      ).not.toContain(".catch(() => ({ rows: [] as PlanContextRow[] }))");
      expect(
        code,
        'a bare `.catch(() => ({ rows:` swallow exists anywhere in this file again',
      ).not.toMatch(/\.catch\(\(\)\s*=>\s*\(\{\s*rows:/);
    },
  );
});

/* ══════════════════════════════════════════════════════════════════════════
 * CASE 4 · the ledger could not STORE the outcome round 4 invented
 * ═══════════════════════════════════════════════════════════════════════ */

describe('LEDGEROUTCOME-1 · `plan_verification_failed` can reach the decision ledger', () => {
  beforeEach(async () => {
    if (!REACHABLE) return;
    await seedRunner();
  });

  when(
    'the durable record ACCEPTS the outcome · migration 166 predates it and its CHECK '
    + 'constraint rejected every row carrying it, so the one refusal class the round-4 fix '
    + 'exists to make visible was the one class the audit table could not hold',
    async () => {
      const { planId } = await seedPlan();
      const written = await recordDecision({
        userUuid: RUNNER,
        planId,
        planLineageId: planId,
        replacedPlanId: null,
        planVersion: null,
        scope: 'PLAN',
        workoutIds: [],
        scopeFromISO: null,
        scopeToISO: null,
        lever: 'RECORD_ONLY',
        direction: 'UNKNOWN',
        evidence: [],
        provenance: 'test/mutation-read-honesty/verification-outcome',
        sourceMode: null,
        beforeState: { comparable: false, workouts: 0, prescribedMi: 0 },
        afterState: { workouts: 0, prescribedMi: 0 },
        authority: 'RUNNER_INITIATED',
        authorityVerdict: 'PERMITTED',
        hold: null,
        decision: 'REFUSE',
        proposalId: null,
        proposal: null,
        runnerResponse: null,
        mutationOutcome: 'plan_verification_failed',
        mutationViolations: ['the read itself failed'],
        explanation: 'round-5 falsifier for the ledger outcome constraint',
        modelVersion: PLAN_MUTATION_BOUNDARY_MODEL_VERSION,
        idempotencyKey: null,
      });
      expect(
        written.state,
        'the ledger still refuses `plan_verification_failed`. Before migration 171 this '
        + 'failed with plan_decision_ledger_mutation_outcome_check. Detail: '
        + ('why' in written ? written.why : ''),
      ).toBe('written');
      if (written.state !== 'written') throw new Error('unreachable');

      const row = await pool.query<{ mutation_outcome: string }>(
        `SELECT mutation_outcome FROM plan_decision_ledger WHERE id = $1`,
        [written.id],
      );
      expect(row.rows[0]?.mutation_outcome).toBe('plan_verification_failed');
    },
  );

  when(
    'the migration that widens it is on disk and names the member · so a fresh scratch '
    + 'fixture or a future production apply cannot silently go back to rejecting it',
    () => {
      const sql = readFileSync(
        join(__dirname, '..', '..', 'db', 'migrations', '171_ledger_outcome_plan_verification_failed.sql'),
        'utf8',
      );
      expect(sql).toContain("'plan_verification_failed'");
      expect(sql).toContain('plan_decision_ledger_mutation_outcome_check');
      const build = readFileSync(
        join(__dirname, '..', '..', 'scripts', '_build_roundtrip_scratch.sh'),
        'utf8',
      );
      expect(
        build,
        'the scratch fixture builder does not apply 171, so a rebuilt fixture would fail '
        + 'the assertion above for a reason that looks like a code regression',
      ).toContain('171_ledger_outcome_plan_verification_failed.sql');
    },
  );
});

afterAll(async () => {
  // The suite seeds a fresh runner per test and never renames a shared object,
  // so there is nothing to restore. The pool is closed so vitest can exit.
  if (REACHABLE) await pool.end().catch(() => {});
});
