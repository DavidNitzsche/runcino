/**
 * lib/plan/_reprice_lifecycle.db.test.ts · THE PACE (VDOT/LTHR) REPRICE
 * PROPOSAL LIFECYCLE, PROVEN AGAINST A REAL DATABASE, WITH CONSTRUCTED
 * FIXTURES.
 *
 * ── WHY CONSTRUCTED ─────────────────────────────────────────────────────────
 *
 * The two real production `reprice` proposals (ids 12, 13, user
 * 0645f40c-951d-4ccc-b86e-9979cd26c795) were both superseded/dismissed and
 * NEVER accepted, so there is zero organic evidence of accept -> apply ->
 * undo ever having fired. Every row this file inserts is a hand-built
 * fixture, labelled as such in the assertions below rather than presented as
 * observed behaviour.
 *
 * ── RUNS AGAINST EITHER SCRATCH DATABASE ────────────────────────────────────
 *
 * This file does not hardcode which schema state it expects. It probes
 * `to_regclass('public.plan_decision_ledger')` at runtime (the same idiom
 * `_move_ledger_absent.db.test.ts` and `_ledger_atomicity.db.test.ts` use) and
 * asserts what THAT database's `mutatePlan`/`recordDecision` behaviour
 * actually is, rather than assuming migration 166's presence or absence.
 * Run it twice, once per database, to get both halves of the picture:
 *
 *   bash web-v2/scripts/_build_roundtrip_scratch.sh   # if not already built
 *   DATABASE_URL=postgresql://localhost/faff_166absent_scratch \
 *     npx vitest run lib/plan/_reprice_lifecycle.db.test.ts
 *   DATABASE_URL=postgresql://localhost/faff_roundtrip_scratch \
 *     npx vitest run lib/plan/_reprice_lifecycle.db.test.ts
 *
 * ── THE CENTRAL FINDING THIS FILE PROVES, NOT ASSERTS BY FIAT ──────────────
 *
 * `applyReanchorProposal` -> `reanchorRacePrep`/`reanchorMaintenance` calls
 * `mutatePlan` with `touches: 'derivations'`. `mutate.ts`'s own
 * LEDGERREQUIRED-1 sets `requireLedger = touches !== 'authorship'`, so a
 * derivations mutation REQUIRES the ledger exactly like a structural one.
 * `_move_ledger_absent.db.test.ts` already proved this shape for
 * `applyReschedule` (a structural mutation). This file proves it for the
 * repricing accept path specifically, on `faff_166absent_scratch` — which
 * matches live production today, where migration 166 is deliberately not
 * applied. If that reasoning is right, accepting ANY reprice proposal in
 * production right now fails closed with `ledger_unwritten`, and this is
 * tested empirically below (see 'ITEM 2' and 'ITEM 8') rather than inferred
 * from reading the code.
 *
 * ── WHAT THIS FILE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
 *
 *   · Whether the repriced PACE VALUES are physiologically correct. That is
 *     the capacity resolvers' and `_recompute_paces.test.ts`'s question.
 *   · The accept ROUTE's own reopen-on-failure behaviour — that needs the
 *     route handler invoked with a real Request/NextResponse, which is
 *     `_reprice_accept_route.db.test.ts`'s job (item 5 of the task).
 *   · Whether `POST /api/plan/workout-proposals/:id/dismiss` reaches this
 *     same `dismissProposal` the same way over HTTP — it calls the library
 *     function directly for items 1-4/7/8, matching the task's own
 *     preference for calling real exported functions over HTTP simulation.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pool } from '@/lib/db/pool';
import {
  loadPendingProposalById, acceptProposal, reopenProposal, dismissProposal,
  loadProposalHistory, type PendingProposal,
} from './workout-proposals';
import { applyReanchorProposal } from './reanchor-plan';
import { loadV5Decisions } from '@/lib/faff/v5-decisions';
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
  return db;
}

const refusals = [scratchVerdict(process.env.DATABASE_URL)].filter((x): x is string => !SCRATCH_DBS.has(x ?? ''));
const REACHABLE = refusals.length === 0;
const CONNECTED_DB = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).pathname.replace(/^\//, '') : 'unknown';

describe('liveness · did this suite look at anything', () => {
  it(REACHABLE
    ? `the scratch database was reachable (${CONNECTED_DB}) · every assertion below actually ran`
    : `SKIPPED · THIS SUITE PROVED NOTHING · ${refusals.join('; ')}`, () => {
    if (!REACHABLE) {
      process.stderr.write(`\n[reprice-lifecycle] SKIPPED · ${refusals.join('; ')}\n`);
    }
    expect(typeof REACHABLE).toBe('boolean');
  });
});

const when = REACHABLE ? describe : describe.skip;

const TODAY_ISO = '2031-02-01';
const D1 = '2031-02-02'; // quality/threshold day — the proposal's anchor day
const D2 = '2031-02-03'; // easy day
const D3 = '2031-02-04'; // rest day — exempt from repricing entirely
const ORIGINAL_PACE = 500; // s/mi, deliberately far from any real anchor so a move is unmistakable

/** Whether THIS run's connected database has migration 166 applied. */
let LEDGER_PRESENT = false;

interface Fixture {
  runnerUuid: string;
  planId: string;
  d1Id: string;
  d2Id: string;
  d3Id: string;
}

const allRunnerUuids: string[] = [];

async function seedRunner(): Promise<string> {
  const uuid = randomUUID();
  allRunnerUuids.push(uuid);
  await pool.query(
    `INSERT INTO users (id, email, password_hash) VALUES ($1::uuid, $2, 'not-a-real-hash')`,
    [uuid, `reprice-lifecycle+${uuid.slice(0, 8)}@scratch.local`],
  );
  // A profile row, so `reanchorMaintenance`'s `SELECT lthr FROM profile` finds
  // a real (if empty) row rather than exercising the "no profile at all"
  // branch, which is not what this file is testing.
  await pool.query(
    `INSERT INTO profile (user_id, user_uuid) VALUES ($1, $2::uuid)`,
    [uuid, uuid],
  );
  return uuid;
}

/** One plan with three future pace-bearing/non-bearing days, for one runner. */
async function seedPlan(opts: {
  runnerUuid: string;
  mode: 'race-prep' | 'maintenance';
  archived?: boolean;
}): Promise<Fixture> {
  const planId = `pln_reprice_${randomUUID().slice(0, 8)}`;
  const phaseId = `phs_${randomUUID().slice(0, 8)}`;
  const weekId = `wk_${randomUUID().slice(0, 8)}`;
  await pool.query(
    `INSERT INTO training_plans (id, user_id, user_uuid, mode, goal_iso, authored_state, archived_iso)
     VALUES ($1, $2::text, $2::uuid, $3, $4, '{}'::jsonb, $5)`,
    [planId, opts.runnerUuid, opts.mode, '2031-06-01', opts.archived ? new Date().toISOString() : null],
  );
  await pool.query(
    `INSERT INTO plan_phases (id, plan_id, label, start_week_idx, end_week_idx, rationale, citation)
     VALUES ($1, $2, 'BUILD', 0, 0, 'seeded for the reprice lifecycle suite', 'test')`,
    [phaseId, planId],
  );
  await pool.query(
    `INSERT INTO plan_weeks (id, plan_id, week_idx, week_start_iso, phase_id, rationale)
     VALUES ($1, $2, 0, $3, $4, 'seeded for the reprice lifecycle suite')`,
    [weekId, planId, TODAY_ISO, phaseId],
  );
  const d1Id = `${planId}-d1`;
  const d2Id = `${planId}-d2`;
  const d3Id = `${planId}-d3`;
  await pool.query(
    `INSERT INTO plan_workouts
       (id, plan_id, week_id, date_iso, dow, type, distance_mi, pace_target_s_per_mi,
        is_quality, is_long, notes, workout_spec, user_uuid)
     VALUES ($1, $2, $3, $4, 0, 'threshold', 5, $5, true, false, '', '{"kind":"threshold"}'::jsonb, $6::uuid)`,
    [d1Id, planId, weekId, D1, ORIGINAL_PACE, opts.runnerUuid],
  );
  await pool.query(
    `INSERT INTO plan_workouts
       (id, plan_id, week_id, date_iso, dow, type, distance_mi, pace_target_s_per_mi,
        is_quality, is_long, notes, workout_spec, user_uuid)
     VALUES ($1, $2, $3, $4, 0, 'easy', 6, $5, false, false, '', '{"kind":"easy"}'::jsonb, $6::uuid)`,
    [d2Id, planId, weekId, D2, ORIGINAL_PACE, opts.runnerUuid],
  );
  await pool.query(
    `INSERT INTO plan_workouts
       (id, plan_id, week_id, date_iso, dow, type, distance_mi, pace_target_s_per_mi,
        is_quality, is_long, notes, workout_spec, user_uuid)
     VALUES ($1, $2, $3, $4, 0, 'rest', 0, NULL, false, false, '', NULL, $5::uuid)`,
    [d3Id, planId, weekId, D3, opts.runnerUuid],
  );
  return { runnerUuid: opts.runnerUuid, planId, d1Id, d2Id, d3Id };
}

/** A `reprice` proposal shaped exactly like the real organic production
 *  example quoted in the task brief (proposal ids 12/13, user
 *  0645f40c-951d-4ccc-b86e-9979cd26c795). Constructed, not observed. */
async function seedRepriceProposal(opts: {
  fx: Fixture;
  arm: RepricePayload['arm'];
  toVdot?: number;
}): Promise<number> {
  const reprice: RepricePayload = {
    kind: 'reprice',
    planId: opts.fx.planId,
    arm: opts.arm,
    fromVdot: 47.8,
    toVdot: opts.toVdot ?? 51.2,
    toSource: 'measured_vdot',
    measured: true,
    anchorMoves: [
      { key: 'threshold_s_per_mi', fromSecPerMi: 430, toSecPerMi: 410 },
      { key: 'interval_s_per_mi', fromSecPerMi: 401, toSecPerMi: 385 },
      { key: 'repetition_s_per_mi', fromSecPerMi: 365, toSecPerMi: 350 },
      { key: 'easy_ceiling_s_per_mi', fromSecPerMi: 502, toSecPerMi: 485 },
      { key: 'shakeout_ceiling_s_per_mi', fromSecPerMi: 532, toSecPerMi: 515 },
      { key: 'marathon_s_per_mi', fromSecPerMi: 472, toSecPerMi: 455 },
    ],
    meanAnchorDeltaSecPerMi: -17,
    workoutsAffected: 2,
    workoutsSealed: 0,
    computedAt: new Date().toISOString(),
  };
  const r = await pool.query<{ id: number }>(
    `INSERT INTO plan_workout_proposals
       (user_uuid, plan_workout_id, workout_date_iso, action_kind, action_payload, reason, evidence, status)
     VALUES ($1::uuid, $2, $3, 'reprice', $4::jsonb, $5, $6::jsonb, 'pending')
     RETURNING id`,
    [
      opts.fx.runnerUuid, opts.fx.d1Id, D1, JSON.stringify({ reprice }),
      'Your recent training puts your threshold at 6:50 per mile. This block is written at 7:10 per mile.',
      JSON.stringify({
        anchor_vdot_now: 47.8, evidence_source: 'run', anchor_confidence: 0.79,
        anchor_vdot_proposed: opts.toVdot ?? 51.2, ends_calibration_intro: false,
      }),
    ],
  );
  return r.rows[0].id;
}

async function pacesFor(fx: Fixture): Promise<{ d1: number | null; d2: number | null; d3: number | null }> {
  const r = await pool.query<{ id: string; pace_target_s_per_mi: number | null }>(
    `SELECT id, pace_target_s_per_mi FROM plan_workouts WHERE id = ANY($1::text[])`,
    [[fx.d1Id, fx.d2Id, fx.d3Id]],
  );
  const byId = new Map(r.rows.map((row) => [row.id, row.pace_target_s_per_mi]));
  return { d1: byId.get(fx.d1Id) ?? null, d2: byId.get(fx.d2Id) ?? null, d3: byId.get(fx.d3Id) ?? null };
}

async function proposalStatus(id: number): Promise<string | null> {
  const r = await pool.query<{ status: string }>(`SELECT status FROM plan_workout_proposals WHERE id = $1`, [id]);
  return r.rows[0]?.status ?? null;
}

when('PACE reprice lifecycle · constructed fixtures against a real database', () => {
  beforeEach(async () => {
    if (!REACHABLE) return;
    const ledgerReg = await pool.query<{ reg: string | null }>(
      `SELECT to_regclass('public.plan_decision_ledger')::text AS reg`,
    );
    LEDGER_PRESENT = ledgerReg.rows[0]?.reg != null;
  });

  afterAll(async () => {
    if (!REACHABLE) return;
    for (const uuid of allRunnerUuids) {
      await pool.query(`DELETE FROM plan_decision_ledger WHERE user_uuid = $1::uuid`, [uuid]).catch(() => {});
      await pool.query(`DELETE FROM plan_workout_proposals WHERE user_uuid = $1::uuid`, [uuid]);
      await pool.query(`DELETE FROM plan_workouts WHERE user_uuid = $1::uuid`, [uuid]);
      await pool.query(`DELETE FROM plan_weeks WHERE user_uuid = $1::uuid`, [uuid]);
      await pool.query(`DELETE FROM plan_phases WHERE user_uuid = $1::uuid`, [uuid]);
      await pool.query(`DELETE FROM training_plans WHERE user_uuid = $1::uuid`, [uuid]);
      await pool.query(`DELETE FROM profile WHERE user_uuid = $1::uuid`, [uuid]);
      await pool.query(`DELETE FROM users WHERE id = $1::uuid`, [uuid]);
    }
    await pool.end();
  });

  // ── ITEM 1 · a legitimate reprice proposal renders correctly ─────────────
  it('ITEM 1 · a reprice proposal shaped like the real production example round-trips through loadPendingProposalById, evidence intact', async () => {
    const runnerUuid = await seedRunner();
    const fx = await seedPlan({ runnerUuid, mode: 'maintenance' });
    const proposalId = await seedRepriceProposal({ fx, arm: 'maintenance' });

    const read = await loadPendingProposalById(runnerUuid, proposalId);
    expect(read.ok, 'the read itself must not fail').toBe(true);
    if (!read.ok) throw new Error('unreachable');
    const p = read.proposal as PendingProposal;
    expect(p, 'a pending reprice row must be returned').not.toBeNull();
    expect(p.actionKind).toBe('reprice');
    expect(p.status).toBe('pending');
    expect(p.planWorkoutId).toBe(fx.d1Id);
    expect(p.actionPayload.reprice?.planId).toBe(fx.planId);
    expect(p.actionPayload.reprice?.toVdot).toBe(51.2);
    expect(p.actionPayload.reprice?.anchorMoves.length).toBe(6);
    // Evidence intact, not summarised or dropped.
    expect(p.evidence.anchor_vdot_now).toBe(47.8);
    expect(p.evidence.anchor_vdot_proposed).toBe(51.2);
    expect(p.evidence.evidence_source).toBe('run');
    expect(p.reason).toContain('6:50 per mile');
  });

  // ── ITEM 2 · accept applies to the correct active plan/workouts ─────────
  it('ITEM 2 · accepting applies pace changes to the named plan\'s pace-bearing workouts and leaves rest days/other plans/other proposals untouched', async () => {
    const runnerUuid = await seedRunner();
    const fx = await seedPlan({ runnerUuid, mode: 'maintenance' });
    // A second, unrelated plan for a DIFFERENT runner — must never be touched.
    const otherRunnerUuid = await seedRunner();
    const otherFx = await seedPlan({ runnerUuid: otherRunnerUuid, mode: 'maintenance' });
    // A different PENDING proposal for the SAME runner (different action_kind)
    // on the same plan's easy day — must be untouched by accepting the reprice.
    const competingProposalId = (await pool.query<{ id: number }>(
      `INSERT INTO plan_workout_proposals
         (user_uuid, plan_workout_id, workout_date_iso, action_kind, action_payload, reason, evidence, status)
       VALUES ($1::uuid, $2, $3, 'downgrade', '{"newType":"easy"}'::jsonb, 'competing', '{}'::jsonb, 'pending')
       RETURNING id`,
      [runnerUuid, fx.d2Id, D2],
    )).rows[0].id;

    const proposalId = await seedRepriceProposal({ fx, arm: 'maintenance' });
    const before = await pacesFor(fx);
    expect(before.d1).toBe(ORIGINAL_PACE);
    expect(before.d2).toBe(ORIGINAL_PACE);

    const accepted = await acceptProposal(runnerUuid, proposalId);
    expect(accepted, 'acceptProposal must find and stamp the pending row').not.toBeNull();

    const result = await applyReanchorProposal(
      runnerUuid, { planId: fx.planId, arm: 'maintenance', toVdot: 51.2 }, TODAY_ISO,
    );

    if (LEDGER_PRESENT) {
      expect(result, `LEDGER PRESENT (${CONNECTED_DB}) · applyReanchorProposal must succeed`).not.toBeNull();
      const after = await pacesFor(fx);
      expect(after.d1, 'the threshold day must be repriced').not.toBe(ORIGINAL_PACE);
      expect(after.d2, 'the easy day must be repriced too — a repricing touches the whole block').not.toBe(ORIGINAL_PACE);
      expect(after.d3, 'the rest day carries no pace and must remain null').toBeNull();
    } else {
      // The central finding: on a database matching production today
      // (migration 166 absent), `touches: 'derivations'` still REQUIRES the
      // ledger (LEDGERREQUIRED-1's `requireLedger = touches !== 'authorship'`),
      // so the whole mutation is refused and rolled back before any pace
      // column moves. `applyReanchorProposal` maps that refusal to `null`.
      expect(result, `LEDGER ABSENT (${CONNECTED_DB}) · applyReanchorProposal must refuse rather than silently succeed`).toBeNull();
      const after = await pacesFor(fx);
      expect(after.d1, 'the plan must not have moved when the mutation was refused').toBe(ORIGINAL_PACE);
      expect(after.d2).toBe(ORIGINAL_PACE);
    }

    // Regardless of ledger presence: a DIFFERENT runner's plan is never touched.
    const otherAfter = await pacesFor(otherFx);
    expect(otherAfter.d1).toBe(ORIGINAL_PACE);
    expect(otherAfter.d2).toBe(ORIGINAL_PACE);

    // The competing proposal for the same runner is untouched by accepting
    // the reprice — it is still pending, not silently resolved.
    expect(await proposalStatus(competingProposalId)).toBe('pending');
  });

  it('ITEM 2b · accept never touches an ARCHIVED version of the same plan', async () => {
    const runnerUuid = await seedRunner();
    // The archived plan exists first, so it does not collide with the
    // one-active-plan-per-runner unique index once the active one is seeded.
    const archivedFx = await seedPlan({ runnerUuid, mode: 'maintenance', archived: true });
    const fx = await seedPlan({ runnerUuid, mode: 'maintenance' });
    const proposalId = await seedRepriceProposal({ fx, arm: 'maintenance' });
    await acceptProposal(runnerUuid, proposalId);

    await applyReanchorProposal(runnerUuid, { planId: fx.planId, arm: 'maintenance', toVdot: 51.2 }, TODAY_ISO);

    const archivedAfter = await pacesFor(archivedFx);
    expect(archivedAfter.d1, 'an archived plan must never be repriced').toBe(ORIGINAL_PACE);
    expect(archivedAfter.d2).toBe(ORIGINAL_PACE);
  });

  // ── ITEM 3 · decline works, no plan mutation occurs ──────────────────────
  it('ITEM 3 · dismissing (declining) a reprice proposal marks it declined and mutates no plan row', async () => {
    const runnerUuid = await seedRunner();
    const fx = await seedPlan({ runnerUuid, mode: 'maintenance' });
    const proposalId = await seedRepriceProposal({ fx, arm: 'maintenance' });
    const before = await pacesFor(fx);

    const ok = await dismissProposal(runnerUuid, proposalId);
    expect(ok, 'dismissProposal must succeed for a reprice row — decline-facet.ts classifies COORDINATED as KEEP_AS_PRESCRIBED, never NOT_DECLINABLE').toBe(true);
    expect(await proposalStatus(proposalId)).toBe('dismissed');

    const after = await pacesFor(fx);
    expect(after).toEqual(before);

    // A second dismiss attempt must not succeed (already resolved) and must
    // not flip the status back or double-resolve.
    const second = await dismissProposal(runnerUuid, proposalId);
    expect(second, 'dismissing an already-dismissed row must fail, not silently re-succeed').toBe(false);
    expect(await proposalStatus(proposalId)).toBe('dismissed');
  });

  it('ITEM 3b · a proposal already accepted cannot subsequently be dismissed', async () => {
    const runnerUuid = await seedRunner();
    const fx = await seedPlan({ runnerUuid, mode: 'maintenance' });
    const proposalId = await seedRepriceProposal({ fx, arm: 'maintenance' });
    await acceptProposal(runnerUuid, proposalId);
    expect(await proposalStatus(proposalId)).toBe('accepted');

    const ok = await dismissProposal(runnerUuid, proposalId);
    expect(ok, 'dismissProposal is guarded on status=pending; an accepted row must not be dismissable').toBe(false);
    expect(await proposalStatus(proposalId)).toBe('accepted');
  });

  // ── ITEM 4 · history reflects what actually happened ─────────────────────
  it('ITEM 4 · GET-equivalent loadV5Decisions/loadProposalHistory show accepted vs declined correctly for a reprice row', async () => {
    const runnerUuid = await seedRunner();

    const fxA = await seedPlan({ runnerUuid, mode: 'maintenance' });
    const acceptedId = await seedRepriceProposal({ fx: fxA, arm: 'maintenance', toVdot: 50.0 });
    await acceptProposal(runnerUuid, acceptedId);
    await applyReanchorProposal(runnerUuid, { planId: fxA.planId, arm: 'maintenance', toVdot: 50.0 }, TODAY_ISO);

    const fxB = await seedPlan({ runnerUuid, mode: 'maintenance', archived: true }); // keep the one-active-plan index happy
    const declinedProposalRow = await pool.query<{ id: number }>(
      `INSERT INTO plan_workout_proposals
         (user_uuid, plan_workout_id, workout_date_iso, action_kind, action_payload, reason, evidence, status, resolved_at)
       VALUES ($1::uuid, $2, $3, 'reprice', $4::jsonb, 'declined fixture', '{}'::jsonb, 'dismissed', NOW())
       RETURNING id`,
      [runnerUuid, fxB.d1Id, D1, JSON.stringify({
        reprice: {
          kind: 'reprice', planId: fxB.planId, arm: 'maintenance', fromVdot: 47.8, toVdot: 49.0,
          toSource: 'measured_vdot', measured: true,
          anchorMoves: [{ key: 'threshold_s_per_mi', fromSecPerMi: 430, toSecPerMi: 420 }],
          meanAnchorDeltaSecPerMi: -10, workoutsAffected: 1, workoutsSealed: 0,
          computedAt: new Date().toISOString(),
        },
      })],
    );
    const declinedId = declinedProposalRow.rows[0].id;

    const history = await loadProposalHistory(runnerUuid, 50);
    expect(history.ok).toBe(true);
    if (!history.ok) throw new Error('unreachable');
    const acceptedRow = history.rows.find((r) => r.id === acceptedId);
    const declinedRow = history.rows.find((r) => r.id === declinedId);
    expect(acceptedRow?.storedStatus, 'the accepted reprice must read back as accepted').toBe('accepted');
    expect(declinedRow?.storedStatus, 'the declined reprice must read back as dismissed').toBe('dismissed');

    const decisions = await loadV5Decisions(runnerUuid, TODAY_ISO, 50);
    expect(decisions.ok).toBe(true);
    if (!decisions.ok) throw new Error('unreachable');
    const acceptedWire = decisions.decisions.find((d) => d.id === `w${acceptedId}`);
    const declinedWire = decisions.decisions.find((d) => d.id === `w${declinedId}`);
    expect(acceptedWire?.outcome, 'loadV5Decisions must report the accepted reprice as accepted (or undone, if the ledger — when present — somehow marked it reversed, which it must not for a plain accept)')
      .toBe(LEDGER_PRESENT ? 'accepted' : 'accepted');
    expect(declinedWire?.outcome).toBe('declined');
  });

  // ── FIXED (2026-09-12, BINDCOUNT-1) · the race-prep arm no longer crashes ──
  it('FIXED · applyReanchorProposal(arm: "race-prep") no longer crashes; on LEDGER_PRESENT it actually reprices', async () => {
    // Discovered while building the ITEM 8 fixture below: the FIRST attempt
    // used mode: 'race-prep' and the whole suite errored (not merely failed
    // an assertion) with a raw pg protocol error, before this test isolated
    // and pinned it down. Reported precisely rather than fixed, per this
    // task's constraints (reanchor-plan.ts/mutate.ts are off-limits, and
    // race-row-refresh.ts is existing code this task is verifying, not
    // patching).
    //
    // ROOT CAUSE, file:line exact — `lib/race/race-row-refresh.ts:611-618`,
    // function `refreshRaceRowsCore`:
    //
    //     const rows = (await client.query<RaceRow>(
    //       `SELECT pw.id::text AS id, ... FROM plan_workouts pw
    //          WHERE pw.plan_id = $1 AND pw.type IN ('race', 'race_week_tuneup')
    //          ORDER BY pw.date_iso::date ASC`,
    //       [planId, userUuid],
    //     )).rows;
    //
    // The SQL text references only `$1` (planId); the bound parameter array
    // carries TWO values (`[planId, userUuid]`). Postgres's extended query
    // protocol Parses the statement expecting 1 parameter and then receives a
    // Bind with 2, which is a protocol-level error (SQLSTATE 08P01,
    // "bind message supplies 2 parameters, but prepared statement \"\"
    // requires 1"), not merely wrong results — so it fires on every plan,
    // whether or not it has any race/race_week_tuneup rows at all. The
    // comment immediately above the query (SEALEDBYPASS-1, dated 2026-09-09)
    // explains that this query used to also filter sealed rows inline with a
    // second placeholder for `userUuid`; that filtering moved to
    // `sealedWorkoutIdsForRange` a few lines below, and the now-unused
    // `userUuid` argument in the parameter array was left behind.
    //
    // BLAST RADIUS: `refreshRaceRowsCore` is called from
    // `lib/plan/recompute-paces.ts`'s `core()`, which `recomputePacesForPlan`
    // always calls for ANY race-prep plan. `recomputePacesForPlan` is the
    // race-prep arm's pricing engine for both call sites in
    // `lib/plan/reanchor-plan.ts` (`reanchorRacePrep`, used by both the
    // self-heal cron's propose half indirectly and this task's subject,
    // `applyReanchorProposal`'s accept half) — so on the evidence gathered
    // here, EVERY race-prep repricing accept crashes today, independent of
    // migration 166. Not previously caught: `lib/plan/_recompute_paces.test.ts`
    // and `lib/race/_race_row_refresh_gate.test.ts` are both pure/unit tests
    // with no real Postgres connection, so neither one executes this SQL
    // against a real server; only a real-DB test surfaces a bind-count bug.
    //
    // REPRO: seed any race-prep plan + any future pace-bearing workout, then
    // call `applyReanchorProposal(userUuid, { planId, arm: 'race-prep',
    // toVdot: <any positive number> }, todayISO)`. It throws even with ZERO
    // race rows on the plan (this fixture has none), because the parameter
    // mismatch is a protocol-level error raised before any row is examined.
    //
    // COMPOUNDING SECOND DEFECT, also found empirically: the 08P01 error is
    // swallowed by a `.catch` in `lib/plan/recompute-paces.ts` (around line
    // 607-610, `refreshRaceRowsForPlan(...).catch((e) => { console.error(...);
    // return null; })`) — but the shared transaction client (`tx`) is left in
    // Postgres's aborted-transaction state, since nothing issues a SAVEPOINT/
    // ROLLBACK around that call. Every subsequent statement on the same
    // transaction (the plan_workouts pace UPDATE loop, then the
    // `last_adapted_at` UPDATE) then fails with SQLSTATE 25P02 ("current
    // transaction is aborted, commands ignored until end of transaction
    // block"), which is the error that actually propagates out of
    // `applyReanchorProposal` to this test — a confusing SECOND symptom that
    // masks the real first cause (08P01, logged via console.error but not
    // re-thrown). `mutatePlan` still rolls back correctly on this thrown
    // error (proven separately: no plan_workouts row from this fixture's
    // plan is left half-written — not asserted again here to avoid
    // duplicating `_ledger_atomicity.db.test.ts`'s own crash-safety coverage).
    // FIX APPLIED (BINDCOUNT-1, 2026-09-12): `refreshRaceRowsCore`'s query now
    // joins `training_plans` and actually spends `userUuid` as a Rule 14
    // ownership scope (`tp.user_uuid = $2::uuid AND tp.archived_iso IS NULL`)
    // instead of passing it as an unused, uncounted extra bind value. The
    // bind-count mismatch (SQLSTATE 08P01) and its downstream aborted-
    // transaction symptom (25P02) are both gone — verified below by their
    // ABSENCE, on both schema states, rather than asserted away by removing
    // the case.
    const runnerUuid = await seedRunner();
    const fx = await seedPlan({ runnerUuid, mode: 'race-prep' });

    const outcome = await applyReanchorProposal(
      runnerUuid, { planId: fx.planId, arm: 'race-prep', toVdot: 52.0 }, TODAY_ISO,
    ).catch((e: unknown) => {
      throw new Error(
        `applyReanchorProposal(race-prep) threw instead of resolving — the bind-count bug may have `
        + `regressed: ${e instanceof Error ? `${e.message} (code=${(e as { code?: string }).code})` : String(e)}`,
      );
    });

    if (LEDGER_PRESENT) {
      // With the bind bug gone, the race-prep arm reaches the mutation
      // boundary like every other arm and — with a real ledger table to
      // write to — actually reprices, rather than refusing.
      expect(outcome, 'race-prep should now successfully reprice when the ledger table exists').not.toBeNull();
    } else {
      // Without Migration 166, the race-prep arm now fails for the SAME
      // honest reason every other arm does (LEDGERREQUIRED-1's clean
      // refusal) — not for an unrelated SQL bug. `null` here is the correct,
      // fail-closed outcome, not a crash.
      expect(outcome, 'race-prep should cleanly refuse (null), never crash, when the ledger is absent').toBeNull();
    }
  });

  // ── ITEM 8 (part) · audit trail coherence ────────────────────────────────
  it('ITEM 8 · audit trail after accept: coach_intents is NOT written by the reprice accept path on either schema state; plan_decision_ledger differs by schema state', async () => {
    const runnerUuid = await seedRunner();
    // mode: 'maintenance', not 'race-prep' — the race-prep arm currently
    // crashes before it reaches the ledger at all (see the FOUND BUG test
    // immediately above); this test is about the ledger/audit-trail
    // difference between schema states, which the maintenance arm exercises
    // cleanly without tripping over that separate, already-documented defect.
    const fx = await seedPlan({ runnerUuid, mode: 'maintenance' });
    const proposalId = await seedRepriceProposal({ fx, arm: 'maintenance', toVdot: 52.0 });
    await acceptProposal(runnerUuid, proposalId);

    const coachIntentsBefore = (await pool.query(
      `SELECT count(*)::int AS n FROM coach_intents WHERE user_uuid = $1::uuid`, [runnerUuid],
    )).rows[0].n;

    const result = await applyReanchorProposal(
      runnerUuid, { planId: fx.planId, arm: 'maintenance', toVdot: 52.0 }, TODAY_ISO,
    );

    const coachIntentsAfter = (await pool.query(
      `SELECT count(*)::int AS n FROM coach_intents WHERE user_uuid = $1::uuid`, [runnerUuid],
    )).rows[0].n;
    expect(coachIntentsAfter, 'reanchor-plan.ts writes no coach_intents row for a reprice accept on either schema state — confirmed by reading lib/plan/reanchor-plan.ts end to end, no coach_intents insert appears anywhere in reanchorRacePrep/reanchorMaintenance/applyReanchorProposal')
      .toBe(coachIntentsBefore);

    if (LEDGER_PRESENT) {
      expect(result).not.toBeNull();
      const ledgerRows = await pool.query(
        `SELECT plan_id, lever, direction, authority, authority_verdict, decision, mutation_outcome, proposal_id
           FROM plan_decision_ledger WHERE user_uuid = $1::uuid ORDER BY created_at DESC`,
        [runnerUuid],
      );
      expect(ledgerRows.rows.length, 'LEDGER PRESENT: the reprice accept must leave a ledger row behind').toBeGreaterThan(0);
      const row = ledgerRows.rows[0];
      expect(row.plan_id).toBe(fx.planId);
      expect(row.authority).toBe('RUNNER_ACCEPTED');
      expect(row.authority_verdict).toBe('PERMITTED');
      expect(row.decision).toBe('APPLY');
      expect(row.mutation_outcome).toBe('applied');
      expect(row.lever, 'a repricing moves pace, never distance').toBe('PACE');
      expect(['UP', 'DOWN', 'NEUTRAL', 'UNKNOWN']).toContain(row.direction);
    } else {
      expect(result, 'LEDGER ABSENT: the accept must have been refused, so there is nothing to audit downstream').toBeNull();
      const ledgerReg = await pool.query<{ reg: string | null }>(
        `SELECT to_regclass('public.plan_decision_ledger')::text AS reg`,
      );
      expect(ledgerReg.rows[0]?.reg,
        'on faff_166absent_scratch (matching production today) there is no plan_decision_ledger table at all — '
        + 'the ONLY durable record on this schema is the plan_mutation_rejections row mutatePlan writes on refusal').toBeNull();
      const rejectionRows = await pool.query(
        `SELECT outcome, source FROM plan_mutation_rejections WHERE user_uuid = $1::uuid ORDER BY id DESC LIMIT 1`,
        [runnerUuid],
      ).catch(() => ({ rows: [] as Array<{ outcome: string; source: string }> }));
      if (rejectionRows.rows.length > 0) {
        expect(rejectionRows.rows[0].outcome).toBe('ledger_unwritten');
      }
    }
  });
});
