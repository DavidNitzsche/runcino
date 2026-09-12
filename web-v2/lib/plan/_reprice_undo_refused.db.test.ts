/**
 * lib/plan/_reprice_undo_refused.db.test.ts · ITEM 6 of the PACE reprice
 * lifecycle verification · does an undo path exist for an accepted `reprice`
 * decision?
 *
 * ── THE ANSWER, FOUND BY READING THE CODE FIRST ─────────────────────────────
 *
 * No. `app/api/plan/workout-proposals/[id]/undo/route.ts` (lines ~75-86)
 * explicitly refuses BY NAME before it ever calls `applyUndo`:
 *
 *     if (accepted.actionKind === 'reprice') {
 *       return NextResponse.json({
 *         ok: false, error: 'not_undoable',
 *         detail: 'a whole-block repricing is reversed by re-anchoring, not '
 *           + 'by putting one session back',
 *       }, { status: 422 });
 *     }
 *
 * `lib/brain/proposal/undo.ts`'s `undoWritesFor` DOES have a `PACE_CHANGE`
 * case (and `undo-apply.ts`'s `applyUndo` a matching one) — but that is the
 * per-workout `BrainAction` kind used by the COORDINATED/ACTIONCOMPLETE-1
 * lane for a single-session pace change, a DIFFERENT thing from the
 * whole-block `action_kind: 'reprice'` this task is about. `reprice` is not
 * an `AdaptationAction`/`BrainAction` at all (see `reprice-payload.ts`'s own
 * header) and never reaches `undoWritesFor`; the undo ROUTE is what actually
 * decides its fate, and it decides no, unconditionally, by checking the
 * literal string `'reprice'` before building an action at all.
 *
 * This file proves that verdict empirically against a real database and a
 * real accepted reprice row, through the real route handler — rather than
 * just trusting the code read above — because Rule 13 says a claim about
 * runner-facing behaviour is verified by exercising it, not by reading it.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';

vi.mock('@/lib/auth/session', () => ({ requireUserId: vi.fn() }));

import { requireUserId } from '@/lib/auth/session';
import { pool } from '@/lib/db/pool';
import { POST as undoPOST } from '../../app/api/plan/workout-proposals/[id]/undo/route';
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
    if (!REACHABLE) process.stderr.write(`\n[reprice-undo-refused] SKIPPED · ${refusals.join('; ')}\n`);
    expect(typeof REACHABLE).toBe('boolean');
  });
});

const when = REACHABLE ? describe : describe.skip;
const D1 = '2031-04-02';
let RUNNER = '';
let PLAN_ID = '';
let WORKOUT_ID = '';
let PROPOSAL_ID = 0;

when('ITEM 6 · undo route refuses a reprice by name — no undo path exists', () => {
  beforeAll(async () => {
    if (!REACHABLE) return;
    RUNNER = randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1::uuid, $2, 'not-a-real-hash')`,
      [RUNNER, `reprice-undo+${RUNNER.slice(0, 8)}@scratch.local`],
    );
    PLAN_ID = `pln_undo_${randomUUID().slice(0, 8)}`;
    const phaseId = `phs_${randomUUID().slice(0, 8)}`;
    const weekId = `wk_${randomUUID().slice(0, 8)}`;
    WORKOUT_ID = `${PLAN_ID}-d1`;
    await pool.query(
      `INSERT INTO training_plans (id, user_id, user_uuid, mode, goal_iso, authored_state)
       VALUES ($1, $2::text, $2::uuid, 'maintenance', '2031-06-01', '{}'::jsonb)`,
      [PLAN_ID, RUNNER],
    );
    await pool.query(
      `INSERT INTO plan_phases (id, plan_id, label, start_week_idx, end_week_idx, rationale, citation)
       VALUES ($1, $2, 'BUILD', 0, 0, 'seeded for the reprice-undo suite', 'test')`,
      [phaseId, PLAN_ID],
    );
    await pool.query(
      `INSERT INTO plan_weeks (id, plan_id, week_idx, week_start_iso, phase_id, rationale)
       VALUES ($1, $2, 0, $3, $4, 'seeded for the reprice-undo suite')`,
      [weekId, PLAN_ID, D1, phaseId],
    );
    await pool.query(
      `INSERT INTO plan_workouts
         (id, plan_id, week_id, date_iso, dow, type, distance_mi, pace_target_s_per_mi,
          is_quality, is_long, notes, workout_spec, user_uuid)
       VALUES ($1, $2, $3, $4, 0, 'threshold', 5, 410, true, false, '', '{"kind":"threshold"}'::jsonb, $5::uuid)`,
      [WORKOUT_ID, PLAN_ID, weekId, D1, RUNNER],
    );
    const reprice: RepricePayload = {
      kind: 'reprice', planId: PLAN_ID, arm: 'maintenance', fromVdot: 47.8, toVdot: 51.2,
      toSource: 'measured_vdot', measured: true,
      anchorMoves: [{ key: 'threshold_s_per_mi', fromSecPerMi: 430, toSecPerMi: 410 }],
      meanAnchorDeltaSecPerMi: -20, workoutsAffected: 1, workoutsSealed: 0,
      computedAt: new Date().toISOString(),
    };
    // Written directly as ALREADY ACCEPTED — this test is about the undo
    // route's own refusal, not about how the row got to 'accepted'; that
    // path is `_reprice_lifecycle.db.test.ts`'s job.
    const r = await pool.query<{ id: number }>(
      `INSERT INTO plan_workout_proposals
         (user_uuid, plan_workout_id, workout_date_iso, action_kind, action_payload, reason, evidence,
          status, resolved_at)
       VALUES ($1::uuid, $2, $3, 'reprice', $4::jsonb, 'accepted fixture for undo refusal', '{}'::jsonb,
               'accepted', NOW())
       RETURNING id`,
      [RUNNER, WORKOUT_ID, D1, JSON.stringify({ reprice })],
    );
    PROPOSAL_ID = r.rows[0].id;
    vi.mocked(requireUserId).mockImplementation(async () => RUNNER);
  });

  afterAll(async () => {
    if (!REACHABLE) return;
    await pool.query(`DELETE FROM plan_decision_ledger WHERE user_uuid = $1::uuid`, [RUNNER]).catch(() => {});
    await pool.query(`DELETE FROM plan_workout_proposals WHERE user_uuid = $1::uuid`, [RUNNER]);
    await pool.query(`DELETE FROM plan_workouts WHERE user_uuid = $1::uuid`, [RUNNER]);
    await pool.query(`DELETE FROM plan_weeks WHERE user_uuid = $1::uuid`, [RUNNER]);
    await pool.query(`DELETE FROM plan_phases WHERE user_uuid = $1::uuid`, [RUNNER]);
    await pool.query(`DELETE FROM training_plans WHERE user_uuid = $1::uuid`, [RUNNER]);
    await pool.query(`DELETE FROM users WHERE id = $1::uuid`, [RUNNER]);
    await pool.end();
  });

  it('POST /api/plan/workout-proposals/:id/undo refuses an accepted reprice with 422 not_undoable, and touches no row', async () => {
    const before = await pool.query<{ pace_target_s_per_mi: number | null; status: string }>(
      `SELECT pw.pace_target_s_per_mi, p.status
         FROM plan_workout_proposals p JOIN plan_workouts pw ON pw.id = p.plan_workout_id
        WHERE p.id = $1`,
      [PROPOSAL_ID],
    );
    expect(before.rows[0].pace_target_s_per_mi).toBe(410);
    expect(before.rows[0].status).toBe('accepted');

    const req = new Request(`http://localhost/api/plan/workout-proposals/${PROPOSAL_ID}/undo`, { method: 'POST' });
    const res = await undoPOST(req as any, { params: Promise.resolve({ id: String(PROPOSAL_ID) }) });

    expect(res.status, 'a reprice must be refused as not_undoable, not attempted and not silently accepted').toBe(422);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toBe('not_undoable');
    expect(json.detail).toContain('re-anchoring');

    const after = await pool.query<{ pace_target_s_per_mi: number | null; status: string }>(
      `SELECT pw.pace_target_s_per_mi, p.status
         FROM plan_workout_proposals p JOIN plan_workouts pw ON pw.id = p.plan_workout_id
        WHERE p.id = $1`,
      [PROPOSAL_ID],
    );
    expect(after.rows[0].pace_target_s_per_mi, 'the workout must be untouched').toBe(410);
    expect(after.rows[0].status, 'the proposal must remain accepted — a refused undo is not a reopen').toBe('accepted');
  });
});
