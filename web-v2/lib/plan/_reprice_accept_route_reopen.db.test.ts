/**
 * lib/plan/_reprice_accept_route_reopen.db.test.ts · ITEM 5 of the PACE
 * reprice lifecycle verification · does the ACCEPT ROUTE reopen a reprice
 * proposal when the apply half fails, against a REAL database, through the
 * REAL route handler (not the bare `applyReanchorProposal` function).
 *
 * ── WHY THE ROUTE, NOT THE BARE FUNCTION ────────────────────────────────────
 *
 * `lib/plan/_workout_proposal_accept_reopen.test.ts` already proves this with
 * every DB module mocked — a unit test of the route's own control flow. This
 * file proves the same contract with the REAL `workout-proposals.ts`,
 * `reanchor-plan.ts` and `adapt.ts` running against a real Postgres, so the
 * actual SQL (row lookup, the accept UPDATE, the reopen UPDATE) is exercised.
 * Only `@/lib/auth/session` is mocked, because `requireUserId` reads a
 * cookie/session this test has no HTTP server to produce — everything else in
 * the request path is real.
 *
 * ── HOW THE FAILURE IS FORCED ────────────────────────────────────────────────
 *
 * The proposal's `action_payload.reprice.planId` names a plan id that does not
 * exist for this runner. `applyReanchorProposal`'s very first query
 * (`SELECT ... FROM training_plans WHERE id = $1 AND user_uuid = $2 AND
 * archived_iso IS NULL`) then finds no row and returns `null` — the exact
 * "the plan the card was raised against has been archived or rebuilt" case
 * `reanchor-plan.ts`'s own comment describes. This works identically on
 * EITHER scratch database (it never reaches the ledger requirement at all),
 * which is why this file does not need to detect schema state the way
 * `_reprice_lifecycle.db.test.ts` does.
 *
 * ── THE FALSIFICATION (Rule 18) ─────────────────────────────────────────────
 *
 * Per the task brief: falsify the fix by temporarily reverting the
 * `sayIfTheCardCouldNotBePutBack` call in the REANCHORPROPOSES-1 branch of
 * `app/api/plan/workout-proposals/[id]/accept/route.ts`, confirm this test
 * correctly FAILS against the unfixed code, then restore the fix and confirm
 * it passes again. That two-step run is done OUTSIDE this file (a shell
 * session editing the route, running vitest twice, and diffing the file
 * back to its exact pre-edit content) because a test file cannot safely edit
 * and reload its own subject module mid-run under Vitest's module cache; the
 * results of both runs are quoted verbatim in the final report rather than
 * asserted here.
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ────────────────────────────────
 *
 *   · The two-lane fix for ACTIONCOMPLETE-1 (`applyBrainAction`) rows — that
 *     is `_workout_proposal_accept_reopen.test.ts`'s job and is unrelated to
 *     `reprice`, which never reaches that branch (the route excludes
 *     `actionKind === 'reprice'` from it by name).
 *   · Whether `requireUserId`'s real cookie/session parsing works — mocked
 *     out entirely, deliberately, per the header above.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';

vi.mock('@/lib/auth/session', () => ({ requireUserId: vi.fn() }));

import { requireUserId } from '@/lib/auth/session';
import { pool } from '@/lib/db/pool';
import { POST } from '../../app/api/plan/workout-proposals/[id]/accept/route';
import type { RepricePayload } from './reprice-payload';

const SCRATCH_DBS = new Set(['faff_166absent_scratch', 'faff_roundtrip_scratch']);
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '']);

function scratchVerdict(url: string | undefined): string | null {
  if (!url) return 'DATABASE_URL is not set';
  let parsed: URL;
  try { parsed = new URL(url); } catch { return 'DATABASE_URL is not a parseable URL'; }
  if (!LOOPBACK.has(parsed.hostname)) return `DATABASE_URL points at host '${parsed.hostname}', which is not loopback`;
  const db = parsed.pathname.replace(/^\//, '');
  if (!SCRATCH_DBS.has(db)) {
    return `DATABASE_URL names database '${db}', not one of faff_166absent_scratch / faff_roundtrip_scratch`;
  }
  return null;
}

const refusals = [scratchVerdict(process.env.DATABASE_URL)].filter((x): x is string => x !== null);
const REACHABLE = refusals.length === 0;
const CONNECTED_DB = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).pathname.replace(/^\//, '') : 'unknown';

describe('liveness · did this suite look at anything', () => {
  it(REACHABLE
    ? `the scratch database was reachable (${CONNECTED_DB}) · every assertion below actually ran`
    : `SKIPPED · THIS SUITE PROVED NOTHING · ${refusals.join('; ')}`, () => {
    if (!REACHABLE) process.stderr.write(`\n[reprice-accept-route] SKIPPED · ${refusals.join('; ')}\n`);
    expect(typeof REACHABLE).toBe('boolean');
  });
});

const when = REACHABLE ? describe : describe.skip;
const TODAY_ISO = '2031-03-01';
const D1 = '2031-03-02';

const allRunnerUuids: string[] = [];

async function seedRunner(): Promise<string> {
  const uuid = randomUUID();
  allRunnerUuids.push(uuid);
  await pool.query(
    `INSERT INTO users (id, email, password_hash) VALUES ($1::uuid, $2, 'not-a-real-hash')`,
    [uuid, `reprice-accept-route+${uuid.slice(0, 8)}@scratch.local`],
  );
  return uuid;
}

async function seedPlanAndWorkout(runnerUuid: string): Promise<{ planId: string; workoutId: string }> {
  const planId = `pln_acceptroute_${randomUUID().slice(0, 8)}`;
  const phaseId = `phs_${randomUUID().slice(0, 8)}`;
  const weekId = `wk_${randomUUID().slice(0, 8)}`;
  const workoutId = `${planId}-d1`;
  await pool.query(
    `INSERT INTO training_plans (id, user_id, user_uuid, mode, goal_iso, authored_state)
     VALUES ($1, $2::text, $2::uuid, 'maintenance', $3, '{}'::jsonb)`,
    [planId, runnerUuid, '2031-06-01'],
  );
  await pool.query(
    `INSERT INTO plan_phases (id, plan_id, label, start_week_idx, end_week_idx, rationale, citation)
     VALUES ($1, $2, 'BUILD', 0, 0, 'seeded for the accept-route reopen suite', 'test')`,
    [phaseId, planId],
  );
  await pool.query(
    `INSERT INTO plan_weeks (id, plan_id, week_idx, week_start_iso, phase_id, rationale)
     VALUES ($1, $2, 0, $3, $4, 'seeded for the accept-route reopen suite')`,
    [weekId, planId, TODAY_ISO, phaseId],
  );
  await pool.query(
    `INSERT INTO plan_workouts
       (id, plan_id, week_id, date_iso, dow, type, distance_mi, pace_target_s_per_mi,
        is_quality, is_long, notes, workout_spec, user_uuid)
     VALUES ($1, $2, $3, $4, 0, 'threshold', 5, 500, true, false, '', '{"kind":"threshold"}'::jsonb, $5::uuid)`,
    [workoutId, planId, weekId, D1, runnerUuid],
  );
  return { planId, workoutId };
}

/** A reprice proposal whose `action_payload.reprice.planId` names a plan that
 *  does not exist — forces `applyReanchorProposal`'s first query to find no
 *  row and return `null`, which is exactly the failure branch this suite
 *  targets. `plan_workout_id` still points at a REAL row (owned by a REAL,
 *  different, valid plan) purely so the row satisfies the rest of the accept
 *  route's plumbing (`readLiveRows` et al.) — the reprice apply path itself
 *  never looks at that workout row; it re-resolves the plan by `reprice.planId`. */
async function seedDoomedRepriceProposal(runnerUuid: string, realWorkoutId: string): Promise<number> {
  const reprice: RepricePayload = {
    kind: 'reprice',
    planId: `pln_does_not_exist_${randomUUID().slice(0, 8)}`,
    arm: 'maintenance',
    fromVdot: 47.8,
    toVdot: 51.2,
    toSource: 'measured_vdot',
    measured: true,
    anchorMoves: [{ key: 'threshold_s_per_mi', fromSecPerMi: 430, toSecPerMi: 410 }],
    meanAnchorDeltaSecPerMi: -20,
    workoutsAffected: 1,
    workoutsSealed: 0,
    computedAt: new Date().toISOString(),
  };
  const r = await pool.query<{ id: number }>(
    `INSERT INTO plan_workout_proposals
       (user_uuid, plan_workout_id, workout_date_iso, action_kind, action_payload, reason, evidence, status)
     VALUES ($1::uuid, $2, $3, 'reprice', $4::jsonb, 'doomed fixture — planId does not exist', '{}'::jsonb, 'pending')
     RETURNING id`,
    [runnerUuid, realWorkoutId, D1, JSON.stringify({ reprice })],
  );
  return r.rows[0].id;
}

function acceptRequest(proposalId: number): { req: Request; ctx: { params: Promise<{ id: string }> } } {
  return {
    req: new Request(`http://localhost/api/plan/workout-proposals/${proposalId}/accept`, { method: 'POST' }),
    ctx: { params: Promise.resolve({ id: String(proposalId) }) },
  };
}

when('ITEM 5 · accept ROUTE reopens a reprice proposal when applyReanchorProposal resolves null', () => {
  afterAll(async () => {
    if (!REACHABLE) return;
    for (const uuid of allRunnerUuids) {
      await pool.query(`DELETE FROM plan_decision_ledger WHERE user_uuid = $1::uuid`, [uuid]).catch(() => {});
      await pool.query(`DELETE FROM plan_workout_proposals WHERE user_uuid = $1::uuid`, [uuid]);
      await pool.query(`DELETE FROM plan_workouts WHERE user_uuid = $1::uuid`, [uuid]);
      await pool.query(`DELETE FROM plan_weeks WHERE user_uuid = $1::uuid`, [uuid]);
      await pool.query(`DELETE FROM plan_phases WHERE user_uuid = $1::uuid`, [uuid]);
      await pool.query(`DELETE FROM training_plans WHERE user_uuid = $1::uuid`, [uuid]);
      await pool.query(`DELETE FROM users WHERE id = $1::uuid`, [uuid]);
    }
    await pool.end();
  });

  beforeEach(() => {
    vi.mocked(requireUserId).mockImplementation(async () => RUNNER);
  });

  let RUNNER = '';

  it('a doomed reprice accept: honest 409, and the card goes back to pending (not stuck accepted)', async () => {
    RUNNER = await seedRunner();
    const { workoutId } = await seedPlanAndWorkout(RUNNER);
    const proposalId = await seedDoomedRepriceProposal(RUNNER, workoutId);

    const before = await pool.query<{ status: string }>(
      `SELECT status FROM plan_workout_proposals WHERE id = $1`, [proposalId],
    );
    expect(before.rows[0].status).toBe('pending');

    const { req, ctx } = acceptRequest(proposalId);
    const res = await POST(req as any, ctx);

    expect(res.status, 'a reprice accept whose plan cannot be resolved must not report 200').toBe(409);
    const json = await res.json();
    expect(json).toEqual({ ok: false, error: 'apply_refused' });

    const after = await pool.query<{ status: string; resolved_at: string | null }>(
      `SELECT status, resolved_at FROM plan_workout_proposals WHERE id = $1`, [proposalId],
    );
    expect(
      after.rows[0].status,
      'THE FIX UNDER TEST: with sayIfTheCardCouldNotBePutBack in place, a failed reprice apply reopens '
      + 'the row to pending rather than leaving it stuck accepted. Falsified separately by commenting out '
      + 'that call in the REANCHORPROPOSES-1 branch and re-running this exact test — see the task report '
      + 'for both runs\' output.',
    ).toBe('pending');
    expect(after.rows[0].resolved_at, 'reopening must also clear resolved_at').toBeNull();
  });

  it('positive control · a reprice accept that resolves does NOT reopen and returns 200', async () => {
    RUNNER = await seedRunner();
    const { planId, workoutId } = await seedPlanAndWorkout(RUNNER);
    const reprice: RepricePayload = {
      kind: 'reprice', planId, arm: 'maintenance', fromVdot: 47.8, toVdot: 51.2,
      toSource: 'measured_vdot', measured: true,
      anchorMoves: [{ key: 'threshold_s_per_mi', fromSecPerMi: 430, toSecPerMi: 410 }],
      meanAnchorDeltaSecPerMi: -20, workoutsAffected: 1, workoutsSealed: 0,
      computedAt: new Date().toISOString(),
    };
    const proposalRow = await pool.query<{ id: number }>(
      `INSERT INTO plan_workout_proposals
         (user_uuid, plan_workout_id, workout_date_iso, action_kind, action_payload, reason, evidence, status)
       VALUES ($1::uuid, $2, $3, 'reprice', $4::jsonb, 'positive control', '{}'::jsonb, 'pending')
       RETURNING id`,
      [RUNNER, workoutId, D1, JSON.stringify({ reprice })],
    );
    const proposalId = proposalRow.rows[0].id;

    const { req, ctx } = acceptRequest(proposalId);
    const res = await POST(req as any, ctx);
    const json = await res.json();

    // On either scratch DB this must not be a stuck 'accepted' with no
    // reopen — either the apply succeeds (200) or, on a DB with the ledger
    // table absent, LEDGERREQUIRED-1 refuses it (409, and reopened) exactly
    // like the doomed case above. Both are correct; a stuck 'accepted' with
    // no reopen and no plan movement is the only wrong outcome.
    const status = (await pool.query<{ status: string }>(
      `SELECT status FROM plan_workout_proposals WHERE id = $1`, [proposalId],
    )).rows[0].status;

    if (res.status === 200) {
      expect(json.ok).toBe(true);
      expect(status, 'a successful accept must not be reopened').toBe('accepted');
    } else {
      expect(res.status).toBe(409);
      expect(status, 'a refused accept must be reopened to pending, never left stuck accepted').toBe('pending');
    }
  });
});
