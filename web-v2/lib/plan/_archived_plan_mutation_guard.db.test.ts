/**
 * lib/plan/_archived_plan_mutation_guard.db.test.ts · ARCHIVEDGUARD-1 (2026-09-12)
 * · Rule 14 — "a query names the population it reads."
 *
 * ── THE BUG THIS FALSIFIES ──────────────────────────────────────────────────
 *
 * `POST /api/plan/workout` (PATCH) resolves plan ownership with:
 *
 *     SELECT id FROM training_plans WHERE id = $1 AND user_uuid = $2
 *
 * — no `archived_iso IS NULL`. It then calls `mutatePlan({ planId: body.plan_id,
 * ... })`. Inside `mutatePlan`'s "1 · resolve the plan" step, when
 * `opts.planId` is supplied it used to be trusted AS-IS: the
 * `archived_iso IS NULL` fallback query only ran when NO planId was supplied
 * at all. So any `plan_id` the runner has ever owned — active or archived by a
 * later rebuild — reached every non-bypass write at this boundary, and the
 * before/after doctrine check validated the archived plan against ITSELF,
 * which it trivially passes.
 *
 * This file drives the shared boundary directly with the exact call shape
 * `api/plan/workout PATCH` makes (`planId` explicit, `touches: 'structural'`,
 * `authority: 'RUNNER_INITIATED'`, a bare `UPDATE plan_workouts ... WHERE
 * plan_id = $1 AND date_iso = $2`) against a plan this runner has already had
 * archived out from under by a rebuild — the real-world trigger the bug report
 * names ("migration 166 is expected to introduce more places old plan ids
 * surface").
 *
 * ── WHY THE ASSERTION IS "REFUSED", NOT "RETARGETED" ────────────────────────
 *
 * A caller-supplied `planId` that turns out to be archived must be REFUSED,
 * never silently substituted for whatever plan is CURRENTLY active — that
 * would be a different, and arguably worse, defect: the write lands, but on a
 * plan the caller never named. So this file also seeds a second, currently
 * active plan for the same runner and asserts it is untouched by an attempt to
 * mutate the archived one.
 *
 * ── IT NEVER TOUCHES PRODUCTION, AND IT SAYS SO WHEN IT SKIPS ───────────────
 *
 * Same fixture and the same reachability contract as
 * `_ledger_atomicity.db.test.ts`: `DATABASE_URL` must parse, name a LOOPBACK
 * host, and name `faff_roundtrip_scratch`. When the check fails the suite
 * SKIPS AND PRINTS WHY (Rule 18) rather than reporting clean having looked at
 * nothing.
 *
 *     bash web-v2/scripts/_build_roundtrip_scratch.sh
 *     DATABASE_URL=postgresql://localhost/faff_roundtrip_scratch \
 *       npx vitest run lib/plan/_archived_plan_mutation_guard.db.test.ts
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ─────────────────────────────────
 *
 * · Any caller that resolves `planId` via `opts.workoutId` rather than
 *   `opts.planId` directly — that lookup (`SELECT plan_id FROM plan_workouts
 *   WHERE id = $1`) has its own, separate lack of an archived/ownership check
 *   and is out of scope for this fix (every real caller of that path validates
 *   ownership + archived state in its OWN read query before calling
 *   `mutatePlan`, e.g. `api/plan/restore` and `api/plan/workout/[id]/accept-
 *   standing`; this file does not re-prove that).
 * · The route-level fix in `api/plan/workout/route.ts` (`AND archived_iso IS
 *   NULL` on its own ownership query). That is a Next.js route handler and is
 *   not exercised from a `.db.test.ts` file; this file proves the SHARED
 *   boundary independently protects every other caller.
 * · Whether the write would have been doctrine-VALID. It is refused before
 *   validation ever runs, on population grounds alone.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pool } from '@/lib/db/pool';
import { mutatePlan } from './mutate';

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

const TODAY = '2026-09-12';
const DATE_ISO = '2026-09-14';

let RUNNER = '';
let archivedPlanId = '';
let activePlanId = '';

async function seedRunner(): Promise<void> {
  RUNNER = randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash)
     VALUES ($1::uuid, $2, 'not-a-real-hash')
     ON CONFLICT (id) DO NOTHING`,
    [RUNNER, `archived-guard+${RUNNER.slice(0, 8)}@scratch.local`],
  );
}

/** One plan with one plan_workouts row on DATE_ISO, optionally pre-archived. */
async function seedPlan(opts: { archived: boolean; typeSeed: string }): Promise<string> {
  const planId = `pln_arcguard_${randomUUID().slice(0, 8)}`;
  const phaseId = `phs_${randomUUID().slice(0, 8)}`;
  const weekId = `wk_${randomUUID().slice(0, 8)}`;
  await pool.query(
    `INSERT INTO training_plans (id, user_id, user_uuid, mode, goal_iso, authored_state, archived_iso)
     VALUES ($1, $2::text, $3::uuid, 'race-prep', $4, '{}'::jsonb, ${opts.archived ? 'NOW()' : 'NULL'})`,
    [planId, RUNNER, RUNNER, TODAY],
  );
  await pool.query(
    `INSERT INTO plan_phases (id, plan_id, label, start_week_idx, end_week_idx, rationale, citation)
     VALUES ($1, $2, 'BUILD', 0, 0, 'seeded for the archived-plan-guard suite', 'test')`,
    [phaseId, planId],
  );
  await pool.query(
    `INSERT INTO plan_weeks (id, plan_id, week_idx, week_start_iso, phase_id, rationale)
     VALUES ($1, $2, 0, $3, $4, 'seeded for the archived-plan-guard suite')`,
    [weekId, planId, TODAY, phaseId],
  );
  await pool.query(
    `INSERT INTO plan_workouts
       (id, plan_id, week_id, date_iso, dow, type, distance_mi,
        is_quality, is_long, notes, pace_target_s_per_mi, workout_spec)
     VALUES ($1, $2, $3, $4, 1, $5, 6, false, false, '', 500, '{"kind":"easy"}'::jsonb)`,
    [`pw_${randomUUID().slice(0, 8)}`, planId, weekId, DATE_ISO, opts.typeSeed],
  );
  return planId;
}

async function workoutTypeOn(planId: string): Promise<string | undefined> {
  const r = await pool.query<{ type: string }>(
    `SELECT type FROM plan_workouts WHERE plan_id = $1 AND date_iso = $2::text`,
    [planId, DATE_ISO],
  );
  return r.rows[0]?.type;
}

/**
 * The EXACT vulnerable call shape `api/plan/workout/route.ts`'s PATCH handler
 * makes: an explicit `planId`, `touches: 'structural'`, `authority:
 * 'RUNNER_INITIATED'`, and a bare `UPDATE ... WHERE plan_id = $1 AND
 * date_iso = $2` inside `apply`.
 */
function patchWorkout(planId: string, newType: string, extra?: { bypass?: { reason: string } }) {
  return mutatePlan<{ rowCount: number; row: unknown }>({
    userUuid: RUNNER,
    authority: 'RUNNER_INITIATED',
    source: 'test/archived-plan-mutation-guard',
    todayISO: TODAY,
    planId,
    touches: 'structural',
    detail: { date_iso: DATE_ISO, updates: { type: newType } },
    ...(extra?.bypass ? { bypass: extra.bypass } : {}),
    apply: async (tx) => {
      const res = await tx.query(
        `UPDATE plan_workouts SET type = $3
           WHERE plan_id = $1 AND date_iso = $2::text
         RETURNING date_iso, dow, type, distance_mi, sub_label`,
        [planId, DATE_ISO, newType],
      );
      return { rowCount: res.rowCount ?? 0, row: res.rows[0] };
    },
  });
}

const LIVENESS_TITLE = REACHABLE
  ? 'the scratch database was reachable · every assertion below actually ran'
  : `SKIPPED · THIS SUITE PROVED NOTHING · ${refusals.join('; ')}`;

describe('liveness · did this suite look at anything', () => {
  it(LIVENESS_TITLE, () => {
    if (!REACHABLE) {
      process.stderr.write(
        `\n[archived-plan-mutation-guard] SKIPPED · THIS SUITE PROVED NOTHING.\n`
        + `  ${refusals.join('; ')}\n`
        + `  Build the fixture: bash web-v2/scripts/_build_roundtrip_scratch.sh\n`
        + `  Then run with: DATABASE_URL=postgresql://localhost/${SCRATCH_DB}\n\n`,
      );
    }
    expect(typeof REACHABLE).toBe('boolean');
  });
});

describe('ARCHIVEDGUARD-1 · an explicitly-supplied planId must be the ACTIVE plan', () => {
  beforeEach(async () => {
    if (!REACHABLE) return;
    await seedRunner();
    // A rebuild happened: the runner's OLD plan is archived, and a NEW one is
    // active — the exact shape migration 166 / a client holding a stale
    // plan_id would produce.
    archivedPlanId = await seedPlan({ archived: true, typeSeed: 'easy' });
    activePlanId = await seedPlan({ archived: false, typeSeed: 'easy' });
  });

  when(
    'a write against an archived plan_id is REFUSED, not silently applied',
    async () => {
      const res = await patchWorkout(archivedPlanId, 'recovery');

      expect(
        res.ok,
        'the mutation boundary applied a write to an ARCHIVED plan — this is '
        + 'exactly the Rule 14 defect: opts.planId was trusted as-is with no '
        + 'archived_iso check',
      ).toBe(false);

      expect(
        await workoutTypeOn(archivedPlanId),
        'the archived plan\'s row was rewritten',
      ).toBe('easy');
    },
  );

  when(
    'a refused archived-plan write does not silently retarget the runner\'s ACTIVE plan',
    async () => {
      await patchWorkout(archivedPlanId, 'recovery');

      // The fallback that resolves "no planId supplied" to the latest active
      // plan must never fire for a planId that WAS supplied but failed the
      // archived check — that would land the write on the wrong plan instead
      // of refusing it, which is worse than doing nothing.
      expect(
        await workoutTypeOn(activePlanId),
        'a write aimed at the archived plan landed on the currently ACTIVE '
        + 'plan instead — silently retargeted rather than refused',
      ).toBe('easy');
    },
  );

  when(
    'the SAME write against the ACTIVE plan still succeeds · no regression',
    async () => {
      const res = await patchWorkout(activePlanId, 'recovery');
      expect(res.ok, 'a legitimate write to the runner\'s own active plan must still work').toBe(true);
      expect(await workoutTypeOn(activePlanId)).toBe('recovery');
    },
  );

  when(
    'the marked bypass escape hatch is unaffected · it may still touch an archived plan',
    async () => {
      const res = await patchWorkout(archivedPlanId, 'recovery', {
        bypass: { reason: 'test/archived-plan-mutation-guard · proving the escape hatch survives' },
      });
      expect(res.ok, 'the bypass path must still be able to run (e.g. a backfill)').toBe(true);
      expect(await workoutTypeOn(archivedPlanId)).toBe('recovery');
    },
  );
});
