/**
 * THE ORGANIC PUSH WALK · one decision, one lineage, ten proofs.
 *
 * Every value below is COMPUTED by production code from data that was already
 * in the scratch database. This file seeds no verdict, no belief, no option and
 * no proposal: it fires the real `POST /api/cron/run-adaptations` route and
 * then the real `POST /api/plan/workout-proposals/[id]/accept` route, with a
 * real session token, and asserts on what the database holds afterwards.
 *
 * Only `Date` is faked, so the nightly cron can be run "on" a date the
 * scratch data actually reaches. Timers stay real so the pg driver behaves.
 *
 *   DATABASE_URL=postgresql://david@127.0.0.1:5432/faff_push_walk \
 *   DATABASE_URL_RO=... \
 *     npx vitest run --config vitest.organic-push.config.ts --disable-console-intercept
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { pool } from '@/lib/db/pool';

const UID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const WEEK = '2026-09-21';
const AS_OF = new Date('2026-09-20T19:00:00Z');

let sessionToken = '';

/** Wipe only THIS lane's own output, so the engine must re-earn it. */
async function resetLaneOutput(): Promise<void> {
  await pool.query(`DELETE FROM reassessment_schedule WHERE payload->>'weekStartISO' = $1`, [WEEK]);
  await pool.query(`DELETE FROM plan_decision_ledger WHERE idempotency_key LIKE '%OPTION_LANE%'`);
  await pool.query(`DELETE FROM plan_workout_proposals WHERE evidence ? 'decision_id'`);
}

async function fireCron(): Promise<Record<string, unknown>> {
  const { POST } = await import('@/app/api/cron/run-adaptations/route');
  const { NextRequest } = await import('next/server');
  const req = new NextRequest('http://localhost/api/cron/run-adaptations', {
    method: 'POST', headers: { authorization: 'Bearer probe-secret' },
  });
  return await (await POST(req)).json() as Record<string, unknown>;
}

/** Two nightly passes: one schedules the boundary, one resolves it and decides. */
async function raiseOrganically(): Promise<{
  decisionId: string | null; proposalId: string | null; chosen: string | null; withheld: string[];
}> {
  await fireCron();
  const body = await fireCron();
  const lane = body.option_lane as { reports: Array<Record<string, unknown>> };
  const r = lane.reports[0] ?? {};
  const trace = r.trace as { chosen?: string } | null;
  return {
    decisionId: (r.decisionId as string | null) ?? null,
    proposalId: r.proposalId == null ? null : String(r.proposalId),
    chosen: trace?.chosen ?? null,
    withheld: (r.withheld as string[]) ?? [],
  };
}

async function distanceOf(workoutId: string): Promise<number | null> {
  const r = await pool.query<{ d: string | null }>(
    'SELECT distance_mi::text AS d FROM plan_workouts WHERE id = $1', [workoutId]);
  const d = r.rows[0]?.d ?? null;
  return d === null ? null : Number(d);
}

async function acceptViaRoute(proposalId: string): Promise<{ status: number; body: unknown }> {
  const { POST } = await import('@/app/api/plan/workout-proposals/[id]/accept/route');
  const { NextRequest } = await import('next/server');
  const req = new NextRequest(
    `http://localhost/api/plan/workout-proposals/${proposalId}/accept`,
    { method: 'POST', headers: { authorization: `Bearer ${sessionToken}` } },
  );
  const res = await POST(req, { params: Promise.resolve({ id: proposalId }) });
  return { status: res.status, body: await res.json() };
}

describe('organic push walk', () => {
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AS_OF);
    process.env.CRON_SECRET = 'probe-secret';
    const { createSession } = await import('@/lib/auth/session');
    sessionToken = (await createSession(UID, { kind: 'walk' })).token;
  });
  afterAll(() => { vi.useRealTimers(); });

  /* ═══ PROOF 1 · ACCEPT LANDS THE EXACT MUTATION THE PROPOSAL NAMED ═══ */
  it('PROOF 1 · accept applies exactly the change the proposal described', async () => {
    await resetLaneOutput();
    const raised = await raiseOrganically();
    console.log('P1 raised:', JSON.stringify(raised));
    expect(raised.chosen).toBe('PUSH');
    expect(raised.decisionId).not.toBeNull();
    expect(raised.proposalId).not.toBeNull();

    const card = await pool.query<{ wid: string; payload: Record<string, unknown> }>(
      `SELECT plan_workout_id AS wid, action_payload AS payload
         FROM plan_workout_proposals WHERE id = $1`, [raised.proposalId]);
    const wid = card.rows[0]!.wid;
    const action = (card.rows[0]!.payload as { action: { action: { to: { value: number } } } })
      .action.action;
    const target = action.to.value;
    const before = await distanceOf(wid);
    console.log(`P1 workout ${wid}: before=${before} proposal names ${target}`);

    const res = await acceptViaRoute(raised.proposalId!);
    console.log('P1 accept:', res.status, JSON.stringify(res.body));
    const after = await distanceOf(wid);
    console.log(`P1 after=${after}`);

    expect(res.status).toBe(200);
    expect(after).toBe(target);

    const led = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM plan_decision_ledger
        WHERE user_uuid = $1::uuid AND runner_response = 'ACCEPTED'`, [UID]);
    console.log('P1 accepted ledger rows:', led.rows[0]!.n);
    await restore(wid, before);
  }, 900_000);

  /* ═══ PROOF 6 · A RE-PROCESSED DECISION DOES NOT DOUBLE-APPLY ═══════ */
  it('PROOF 6 · accepting the same decision twice applies it once', async () => {
    await resetLaneOutput();
    const raised = await raiseOrganically();
    expect(raised.chosen).toBe('PUSH');
    const wid = await widOf(raised.proposalId!);
    const before = await distanceOf(wid);

    const first = await acceptViaRoute(raised.proposalId!);
    const afterFirst = await distanceOf(wid);
    /* A SIMULATED RESTART: every module-level cache this process holds is
     * dropped, so the second attempt re-reads the row's status from the
     * database exactly as a fresh worker would. */
    vi.resetModules();
    const second = await acceptViaRoute(raised.proposalId!);
    const afterSecond = await distanceOf(wid);
    console.log(`P6 first=${first.status} ${afterFirst} · second=${second.status} ${afterSecond}`,
      JSON.stringify(second.body));

    expect(afterFirst).toBe(before! + 1);
    expect(afterSecond).toBe(afterFirst);
    expect(second.status).not.toBe(200);
    await restore(wid, before);
  }, 900_000);

  /* ═══ PROOF 2 · DECLINE CHANGES NOTHING ════════════════════════════ */
  it('PROOF 2 · declining the card leaves the plan untouched', async () => {
    await resetLaneOutput();
    const raised = await raiseOrganically();
    expect(raised.chosen).toBe('PUSH');
    const wid = await widOf(raised.proposalId!);
    const before = await distanceOf(wid);

    const { POST } = await import('@/app/api/plan/workout-proposals/[id]/dismiss/route');
    const { NextRequest } = await import('next/server');
    const req = new NextRequest(
      `http://localhost/api/plan/workout-proposals/${raised.proposalId}/dismiss`,
      { method: 'POST', headers: { authorization: `Bearer ${sessionToken}` } },
    );
    const res = await POST(req, { params: Promise.resolve({ id: raised.proposalId! }) });
    const after = await distanceOf(wid);
    const status = await statusOf(raised.proposalId!);
    console.log(`P2 dismiss=${res.status} before=${before} after=${after} card=${status}`);

    expect(after).toBe(before);
    /* The app's own vocabulary for a declined card is `dismissed` — asserted
     * against what the route actually writes rather than against what this
     * file assumed it wrote. */
    expect(status).toBe('dismissed');
    await restore(wid, before);
  }, 900_000);

  /* ═══ PROOF 3 · A PLAN THAT MOVED UNDER THE CARD REFUSES ═══════════ */
  it('PROOF 3 · the card refuses once the session it reasoned about has moved', async () => {
    await resetLaneOutput();
    const raised = await raiseOrganically();
    expect(raised.chosen).toBe('PUSH');
    const wid = await widOf(raised.proposalId!);
    const before = await distanceOf(wid);

    /* The session is MOVED — a real plan edit of the kind the runner makes
     * from Today, changing the very field `RowBefore` recorded. */
    await pool.query(`UPDATE plan_workouts SET date_iso = (date_iso::date + 1)::text WHERE id = $1`, [wid]);
    const res = await acceptViaRoute(raised.proposalId!);
    const after = await distanceOf(wid);
    console.log(`P3 accept=${res.status} ${JSON.stringify(res.body)} before=${before} after=${after}`);

    expect(res.status).toBe(409);
    expect(after).toBe(before);
    await pool.query(`UPDATE plan_workouts SET date_iso = (date_iso::date - 1)::text WHERE id = $1`, [wid]);
    await restore(wid, before);
  }, 900_000);

  /* ═══ PROOF 10 · UNDO PUTS IT BACK ════════════════════════════════ */
  it('PROOF 10 · the accepted change can be undone', async () => {
    await resetLaneOutput();
    const raised = await raiseOrganically();
    expect(raised.chosen).toBe('PUSH');
    const wid = await widOf(raised.proposalId!);
    const before = await distanceOf(wid);

    const acc = await acceptViaRoute(raised.proposalId!);
    const afterAccept = await distanceOf(wid);
    expect((acc.body as { undoable?: boolean }).undoable).toBe(true);

    const { POST } = await import('@/app/api/plan/workout-proposals/[id]/undo/route');
    const { NextRequest } = await import('next/server');
    const req = new NextRequest(
      `http://localhost/api/plan/workout-proposals/${raised.proposalId}/undo`,
      { method: 'POST', headers: { authorization: `Bearer ${sessionToken}` } },
    );
    const res = await POST(req, { params: Promise.resolve({ id: raised.proposalId! }) });
    const afterUndo = await distanceOf(wid);
    console.log(`P10 undo=${res.status} ${JSON.stringify(await res.clone().json())} `
      + `before=${before} accepted=${afterAccept} undone=${afterUndo}`);

    expect(afterAccept).toBe(before! + 1);
    expect(afterUndo).toBe(before);
    await restore(wid, before);
  }, 900_000);

  /* ═══ PROOF 4 · NO LEDGER TABLE, NO MUTATION ══════════════════════ */
  it('PROOF 4 · with the ledger absent the mutation refuses rather than running unaudited',
    async () => {
      await resetLaneOutput();
      const raised = await raiseOrganically();
      expect(raised.chosen).toBe('PUSH');
      const wid = await widOf(raised.proposalId!);
      const before = await distanceOf(wid);

      const { _resetLedgerTableProbeForTests } = await import('@/lib/brain/ledger/decision-ledger');
      await pool.query('ALTER TABLE plan_decision_ledger RENAME TO plan_decision_ledger__hidden');
      _resetLedgerTableProbeForTests();
      let status = 0; let body: unknown = null;
      try {
        const r = await acceptViaRoute(raised.proposalId!);
        status = r.status; body = r.body;
      } finally {
        await pool.query('ALTER TABLE plan_decision_ledger__hidden RENAME TO plan_decision_ledger');
        _resetLedgerTableProbeForTests();
      }
      const after = await distanceOf(wid);
      console.log(`P4 accept=${status} ${JSON.stringify(body)} before=${before} after=${after}`);

      expect(after).toBe(before);
      expect(status).not.toBe(200);
      await restore(wid, before);
    }, 900_000);

  /* ═══ PROOF 5 · A FAILING LEDGER INSERT ROLLS THE WHOLE THING BACK ══ */
  it('PROOF 5 · a ledger INSERT that fails leaves nothing partial behind', async () => {
    await resetLaneOutput();
    const raised = await raiseOrganically();
    expect(raised.chosen).toBe('PUSH');
    const wid = await widOf(raised.proposalId!);
    const before = await distanceOf(wid);

    /* NOT the table-absent path (proof 4). The table is PRESENT and the probe
     * says so; the INSERT itself fails. A trigger is the honest way to make
     * exactly that happen without touching a line of application code. */
    await pool.query(`
      CREATE OR REPLACE FUNCTION _walk_break_ledger() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'walk: simulated ledger insert failure'; END;
      $$ LANGUAGE plpgsql`);
    await pool.query(`
      CREATE TRIGGER _walk_break_ledger_trg BEFORE INSERT ON plan_decision_ledger
      FOR EACH ROW EXECUTE FUNCTION _walk_break_ledger()`);
    let status = 0; let body: unknown = null;
    try {
      const r = await acceptViaRoute(raised.proposalId!);
      status = r.status; body = r.body;
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS _walk_break_ledger_trg ON plan_decision_ledger');
      await pool.query('DROP FUNCTION IF EXISTS _walk_break_ledger()');
    }
    const after = await distanceOf(wid);
    console.log(`P5 accept=${status} ${JSON.stringify(body)} before=${before} after=${after}`);

    expect(after).toBe(before);
    expect(status).not.toBe(200);
    await restore(wid, before);
  }, 900_000);

  /* ═══ PROOF 7 · A REAL SAFETY STOP DEFEATS A SUPPORTED PUSH ════════ */
  it('PROOF 7 · a real injury in the data turns the same PUSH into a HOLD', async () => {
    await resetLaneOutput();
    const control = await raiseOrganically();
    expect(control.chosen).toBe('PUSH');

    /* A REAL ROW IN THE SAFETY OWNER'S OWN TABLE — not an asserted posture.
     * `resolveSafety` reads it, `resolveTrainingSafety` grades it, and
     * `resolveArbitrationPriority` is what acts on it. Nothing here tells the
     * lane what to conclude. */
    await pool.query(
      `INSERT INTO runner_injuries (user_id, user_uuid, site, severity, start_date, notes)
       VALUES ('me', $1::uuid, 'achilles', 'major', $2, 'walk: proof 7')`,
      [UID, '2026-09-18'],
    );
    let chosen: string | null = null; let withheld: string[] = [];
    try {
      await resetLaneOutput();
      const r = await raiseOrganically();
      chosen = r.chosen; withheld = r.withheld;
    } finally {
      await pool.query(`DELETE FROM runner_injuries WHERE notes = 'walk: proof 7'`);
    }
    console.log(`P7 control=${control.chosen} withInjury=${chosen} withheld=${JSON.stringify(withheld)}`);
    expect(chosen).not.toBe('PUSH');
  }, 900_000);

  /* ═══ PROOF 9 · THE OUTCOME OF THIS DECISION, JUDGED ON LATER DATA ══ */
  it('PROOF 9 · step 16 judges this decision against what actually happened', async () => {
    await resetLaneOutput();
    const raised = await raiseOrganically();
    expect(raised.chosen).toBe('PUSH');
    const wid = await widOf(raised.proposalId!);
    const before = await distanceOf(wid);
    const acc = await acceptViaRoute(raised.proposalId!);
    expect(acc.status).toBe(200);

    /* The decision's scope ends 2026-09-27. Judging it needs a date PAST that,
     * so the week it was about has actually happened. Nothing is written here
     * — only the clock moves. */
    vi.setSystemTime(new Date('2026-10-05T19:00:00Z'));
    const { observeAftermath } = await import('@/lib/brain/ledger/observe-aftermath');
    const { sweepDecisionOutcomes } = await import('@/lib/brain/ledger/outcome-sweep');

    const row = await pool.query(
      `SELECT * FROM plan_decision_ledger WHERE id = $1`, [raised.decisionId]);
    const observed = await observeAftermath(
      row.rows[0] as never, '2026-09-21', '2026-09-28');
    console.log('P9 observed:', JSON.stringify(observed));

    const swept = await sweepDecisionOutcomes('2026-10-05', observeAftermath);
    console.log('P9 swept:', JSON.stringify(swept));
    const verdicts = await pool.query<{ v: string; n: string }>(
      `SELECT verdict AS v, count(*)::text AS n FROM plan_decision_outcome GROUP BY verdict`);
    console.log('P9 verdicts:', JSON.stringify(verdicts.rows));

    /* The proof is that the aftermath is READ, not that it reached a
     * particular verdict — a verdict is the engine's call and asserting one
     * here would be this file grading the grader. What must be true is that
     * it is no longer UNREAD, which is what the 42883 bug made it. */
    expect(observed.prescribedMi).not.toBeNull();
    vi.setSystemTime(AS_OF);
    await restore(wid, before);
  }, 900_000);

  /* ═══ PROOF 8 · COMPETING OPTIONS PRODUCE AN EXPLICIT RESULT ═══════ */
  it('PROOF 8 · the losing option is durable, reasoned and dated, not silently dropped',
    async () => {
      await resetLaneOutput();
      await pool.query(
        `DELETE FROM reassessment_schedule WHERE reason_code = 'option_lane_runner_up'`);
      const raised = await raiseOrganically();
      expect(raised.chosen).toBe('PUSH');

      const winner = await pool.query<{
        id: string; decision: string; direction: string; proposal: Record<string, unknown>;
      }>(`SELECT id, decision, direction, proposal FROM plan_decision_ledger WHERE id = $1`,
        [raised.decisionId]);
      const loser = await pool.query<{
        reason_detail: string; assess_on_iso: string; origin_ledger_id: string | null;
        payload: Record<string, unknown>; status: string;
      }>(`SELECT reason_detail, assess_on_iso::text AS assess_on_iso, origin_ledger_id,
                 payload, status
            FROM reassessment_schedule WHERE reason_code = 'option_lane_runner_up'`);

      console.log('P8 winner:', JSON.stringify({
        id: winner.rows[0]?.id, decision: winner.rows[0]?.decision,
        direction: winner.rows[0]?.direction,
        ranked: (winner.rows[0]?.proposal as { options?: Array<{ option: string }> })
          ?.options?.map((o) => o.option),
      }));
      console.log('P8 loser:', JSON.stringify(loser.rows[0]));

      /* Every clause of the requirement, asserted separately. */
      expect(winner.rows).toHaveLength(1);                       // durable winner
      expect(loser.rows).toHaveLength(1);                        // durable loser
      expect(loser.rows[0]!.reason_detail.length).toBeGreaterThan(20);   // a reason
      expect(loser.rows[0]!.assess_on_iso).toBe(WEEK);           // a reassessment date
      expect(loser.rows[0]!.origin_ledger_id).toBe(raised.decisionId);   // ONE arbitration
    }, 900_000);
});

async function widOf(proposalId: string): Promise<string> {
  const r = await pool.query<{ wid: string }>(
    'SELECT plan_workout_id AS wid FROM plan_workout_proposals WHERE id = $1', [proposalId]);
  return r.rows[0]!.wid;
}

async function statusOf(proposalId: string): Promise<string> {
  const r = await pool.query<{ s: string }>(
    'SELECT status AS s FROM plan_workout_proposals WHERE id = $1', [proposalId]);
  return r.rows[0]!.s;
}

/** Put the session back exactly as it was, so each proof starts from one state. */
async function restore(workoutId: string, distanceMi: number | null): Promise<void> {
  await pool.query('UPDATE plan_workouts SET distance_mi = $2 WHERE id = $1',
    [workoutId, distanceMi]);
}
