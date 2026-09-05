/**
 * lib/brain/ledger/_decision_ledger.db.test.ts · A DECISION SURVIVES THE
 * PROCESS THAT MADE IT, AND A REBUILD, PROVEN AGAINST A REAL DATABASE.
 *
 * `_decision_ledger.test.ts` proves the ARITHMETIC — how direction is measured,
 * how scope is resolved — with no database at all. It cannot prove the two
 * things the ledger actually exists for:
 *
 *   1 · that a decision is still there after the process that made it is gone;
 *   2 · that a PLAN REBUILD does not end a runner's coaching history, which is
 *       the single failure `training_plans.adaptation_log` cannot avoid, since
 *       it lives on the row a rebuild archives.
 *
 * Only a real table can. So this suite writes, rebuilds, and reads back.
 *
 * ── IT NEVER TOUCHES PRODUCTION, AND IT SAYS SO WHEN IT SKIPS ──────────────
 *
 * `DATABASE_URL` must parse, name a LOOPBACK host, and name the database
 * `faff_ledger_scratch` — the same predicate `lib/adaptation-harness/fence.ts`
 * applies to its own scratch database, for the same reason. A URL that merely
 * "looks local" is not enough. The production write barrier installed by
 * `vitest.setup.ts` is NOT disabled here; it is the backstop, not the gate.
 *
 * When the check fails the suite SKIPS AND PRINTS WHY. Reporting clean because
 * it looked at nothing is the worst available outcome, since it also reports
 * confidence (Rule 18). Run it with:
 *
 *     createdb faff_ledger_scratch
 *     psql -d faff_ledger_scratch -f web-v2/db/migrations/166_plan_decision_ledger.sql
 *     DATABASE_URL=postgresql://localhost/faff_ledger_scratch \
 *       npx vitest run lib/brain/ledger/_decision_ledger.db.test.ts
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ────────────────────────────────
 *
 * · WHETHER `mutatePlan` CALLS ANY OF THIS. It exercises the store directly.
 *   `scripts/check-decision-ledger.sh` guard 1 is the half that walks the
 *   boundary's own exits and fails when one of them records nothing.
 * · WHETHER MIGRATION 166 IS APPLIED TO PRODUCTION. It is not, deliberately.
 *   A green run says the schema and the store agree on a LOCAL COPY of that
 *   schema, and nothing whatsoever about the live database (Rule 19).
 * · A CONCURRENT WRITER racing the upsert. Single process, single connection.
 * · WHETHER THE DECISION WAS RIGHT.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  recordDecision,
  resolvePlanLineage,
  loadRecentDecisions,
  directionCensus,
  markSuperseded,
  markUndone,
  recordRunnerResponse,
  _resetLedgerTableProbeForTests,
} from './decision-ledger';
import {
  PLAN_MUTATION_BOUNDARY_MODEL_VERSION,
  type LedgerEntry,
} from './ledger-entry';

const SCRATCH_DB = 'faff_ledger_scratch';
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

const RUNNER = randomUUID();

const entry = (over: Partial<LedgerEntry> = {}): LedgerEntry => ({
  userUuid: RUNNER,
  planId: 'pln_a',
  planLineageId: 'pln_a',
  replacedPlanId: null,
  planVersion: 'pln_a:2026-09-05',
  scope: 'WORKOUT',
  workoutIds: ['w1'],
  scopeFromISO: '2026-09-07',
  scopeToISO: '2026-09-07',
  lever: 'VOLUME',
  direction: 'UP',
  evidence: [{ activityId: 'run-1', what: 'a controlled threshold session' }],
  provenance: 'test/ledger',
  sourceMode: 'DIRECT',
  beforeState: { comparable: true, workouts: 3, prescribedMi: 20 },
  afterState: { comparable: true, workouts: 3, prescribedMi: 22 },
  authority: 'RUNNER_ACCEPTED',
  authorityVerdict: 'PERMITTED',
  hold: null,
  decision: 'APPLY',
  proposalId: null,
  proposal: null,
  runnerResponse: null,
  mutationOutcome: 'applied',
  mutationViolations: [],
  explanation: 'applied · it introduced no doctrine violation the plan did not already carry',
  modelVersion: PLAN_MUTATION_BOUNDARY_MODEL_VERSION,
  idempotencyKey: null,
  ...over,
});

describe('liveness · the scratch database was reachable, or the reason is printed', () => {
  it('says which it is, out loud', () => {
    if (!REACHABLE) {
      // eslint-disable-next-line no-console
      console.warn(
        '[decision-ledger.db] SKIPPED · this suite proved NOTHING about durability. '
        + refusals.join('; ')
        + ". See this file's header for how to run it against a local scratch database.",
      );
    }
    expect(REACHABLE || refusals.length > 0).toBe(true);
  });
});

describe.skipIf(!REACHABLE)('a decision survives the process that made it', () => {
  beforeAll(() => { _resetLedgerTableProbeForTests(); });

  it('the table is there and the history starts MEASURED EMPTY, not absent', async () => {
    // Rule 11's first distinction, asserted before anything is written: an
    // empty history and an unreachable table must not look the same.
    const h = await loadRecentDecisions(RUNNER);
    expect(h.state, h.state === 'read' ? '' : JSON.stringify(h)).toBe('read');
    if (h.state !== 'read') throw new Error('unreachable');
    expect(h.rows).toEqual([]);
  });

  it('a written decision reads back with its explanation, provenance and evidence', async () => {
    const w = await recordDecision(entry());
    expect(w.state, w.state === 'written' ? '' : JSON.stringify(w)).toBe('written');

    const h = await loadRecentDecisions(RUNNER);
    if (h.state !== 'read') throw new Error('unreachable');
    expect(h.rows).toHaveLength(1);
    const r = h.rows[0];
    expect(r.direction).toBe('UP');
    expect(r.provenance).toBe('test/ledger');
    expect(r.explanation).toContain('introduced no doctrine violation');
    expect(r.evidence).toEqual([{ activityId: 'run-1', what: 'a controlled threshold session' }]);
    expect(r.modelVersion).toBe(PLAN_MUTATION_BOUNDARY_MODEL_VERSION);
  });

  it("RULE 21's census answers in one query, and UP is countable", async () => {
    const c = await directionCensus(RUNNER);
    expect(c.state).toBe('measured');
    if (c.state !== 'measured') throw new Error('unreachable');
    expect(c.counts.UP).toBe(1);
    expect(c.counts.DOWN).toBe(0);
  });

  it('an idempotency key REFRESHES rather than doubling the census', async () => {
    const key = `pass-${randomUUID()}`;
    await recordDecision(entry({ idempotencyKey: key, direction: 'DOWN' }));
    await recordDecision(entry({ idempotencyKey: key, direction: 'DOWN' }));
    const h = await loadRecentDecisions(RUNNER, 100);
    if (h.state !== 'read') throw new Error('unreachable');
    expect(h.rows.filter((r) => r.direction === 'DOWN')).toHaveLength(1);
  });

  it('two rows with NO key are two distinct events', async () => {
    const before = await loadRecentDecisions(RUNNER, 200);
    if (before.state !== 'read') throw new Error('unreachable');
    await recordDecision(entry({ direction: 'NEUTRAL', provenance: 'test/ledger-b' }));
    await recordDecision(entry({ direction: 'NEUTRAL', provenance: 'test/ledger-b' }));
    const after = await loadRecentDecisions(RUNNER, 200);
    if (after.state !== 'read') throw new Error('unreachable');
    expect(after.rows.length - before.rows.length).toBe(2);
  });
});

describe.skipIf(!REACHABLE)('A REBUILD PRESERVES THE LEDGER AND LINKS THE REPLACED PLAN', () => {
  // The property `training_plans.adaptation_log` structurally cannot have:
  // it is a column on the row a rebuild archives, so every decision a runner
  // ever acknowledged is, from the new plan's point of view, gone.
  const chainRunner = randomUUID();

  it('rebuild 1 · a plan that replaces nothing opens its own lineage', async () => {
    const lineage = await resolvePlanLineage({
      userUuid: chainRunner, planId: 'pln_1', replacedPlanId: null,
    });
    expect(lineage).toBe('pln_1');
    const w = await recordDecision(entry({
      userUuid: chainRunner, planId: 'pln_1', planLineageId: lineage,
      replacedPlanId: null, authority: 'AUTHORSHIP', direction: 'UNKNOWN',
      explanation: 'a new plan was authored and replaced nothing. This row opens its lineage.',
    }));
    expect(w.state).toBe('written');
  });

  it('rebuild 2 · the replacement INHERITS the replaced plan lineage', async () => {
    const lineage = await resolvePlanLineage({
      userUuid: chainRunner, planId: 'pln_2', replacedPlanId: 'pln_1',
    });
    expect(lineage).toBe('pln_1');
    await recordDecision(entry({
      userUuid: chainRunner, planId: 'pln_2', planLineageId: lineage,
      replacedPlanId: 'pln_1', authority: 'AUTHORSHIP', direction: 'UNKNOWN',
      explanation: 'a new plan was authored, replacing pln_1, whose ledger lineage it inherits.',
    }));
  });

  it('rebuild 3 · the chain does not restart, however many rebuilds deep', async () => {
    const lineage = await resolvePlanLineage({
      userUuid: chainRunner, planId: 'pln_3', replacedPlanId: 'pln_2',
    });
    expect(lineage, 'the third rebuild lost the chain').toBe('pln_1');
    await recordDecision(entry({
      userUuid: chainRunner, planId: 'pln_3', planLineageId: lineage,
      replacedPlanId: 'pln_2', authority: 'AUTHORSHIP', direction: 'DOWN',
      explanation: 'a new plan was authored, replacing pln_2.',
    }));
  });

  it('the whole history is ONE predicate on plan_lineage_id, across three plans', async () => {
    const h = await loadRecentDecisions(chainRunner, 100);
    if (h.state !== 'read') throw new Error('unreachable');
    expect(h.rows).toHaveLength(3);
    expect(new Set(h.rows.map((r) => r.planLineageId))).toEqual(new Set(['pln_1']));
    expect(new Set(h.rows.map((r) => r.planId))).toEqual(new Set(['pln_1', 'pln_2', 'pln_3']));
  });

  it('a decision with no plan at all is owned by the runner, never invented onto one', async () => {
    const orphan = randomUUID();
    const lineage = await resolvePlanLineage({ userUuid: orphan, planId: null, replacedPlanId: null });
    expect(lineage).toBe(`orphan:${orphan}`);
  });
});

describe.skipIf(!REACHABLE)('the DATABASE ITSELF refuses a row that cannot explain itself', () => {
  // Rule 20 · a product rule with no gate is a hypothesis, and the strongest
  // available gate for "a decision states why" is the table's own CHECK.
  // Falsified here by trying to break each one.
  const raw = async (sql: string, params: unknown[]) => {
    const { pool } = await import('@/lib/db/pool');
    return pool.query(sql, params);
  };

  it('an EMPTY explanation is refused', async () => {
    await expect(recordDecision(entry({ explanation: '' })))
      .resolves.toMatchObject({ state: 'failed' });
  });

  it('an UNDO with no reason is refused by the constraint, not only by TypeScript', async () => {
    await expect(raw(
      `UPDATE plan_decision_ledger SET undone_at = now()
        WHERE user_uuid = $1::uuid AND undone_at IS NULL`,
      [RUNNER],
    )).rejects.toThrow(/plan_decision_ledger_undo_is_explained/);
  });

  it('a SUPERSESSION with no successor is refused', async () => {
    await expect(raw(
      `UPDATE plan_decision_ledger SET superseded_at = now()
        WHERE user_uuid = $1::uuid AND superseded_at IS NULL`,
      [RUNNER],
    )).rejects.toThrow(/plan_decision_ledger_supersession_is_explained/);
  });

  it('a SETTLED runner response with no timestamp is refused', async () => {
    await expect(raw(
      `UPDATE plan_decision_ledger SET runner_response = 'ACCEPTED'
        WHERE user_uuid = $1::uuid`,
      [RUNNER],
    )).rejects.toThrow(/plan_decision_ledger_response_is_timed/);
  });

  it('ORACLE · a well-formed row is NOT refused, so the constraints are not simply closed', async () => {
    // Falsification in the other direction: a table that refuses everything is
    // as useless as one that refuses nothing.
    const w = await recordDecision(entry({ provenance: 'test/oracle' }));
    expect(w.state).toBe('written');
  });
});

describe.skipIf(!REACHABLE)('a decision is never rewritten, only superseded or undone', () => {
  it('an answer to a proposal is recorded ONCE, and a second answer is refused', async () => {
    const w = await recordDecision(entry({
      provenance: 'test/proposal', decision: 'PROGRESS', runnerResponse: 'PENDING',
      explanation: 'a proposal awaiting the runner',
    }));
    if (w.state !== 'written') throw new Error('unreachable');

    const first = await recordRunnerResponse(w.id, 'DECLINED');
    expect(first.ok).toBe(true);

    // "declined on Tuesday" must not become "expired on Friday".
    const second = await recordRunnerResponse(w.id, 'ACCEPTED');
    expect(second.ok).toBe(false);
    expect(second.why).toContain('already answered');

    const h = await loadRecentDecisions(entry().userUuid, 200);
    if (h.state !== 'read') throw new Error('unreachable');
    expect(h.rows.find((r) => r.id === w.id)?.decision).toBe('PROGRESS');
  });

  it('a supersession points at its successor, and the FIRST one stands', async () => {
    const a = await recordDecision(entry({ provenance: 'test/supersede-a' }));
    const b = await recordDecision(entry({ provenance: 'test/supersede-b' }));
    const c = await recordDecision(entry({ provenance: 'test/supersede-c' }));
    if (a.state !== 'written' || b.state !== 'written' || c.state !== 'written') {
      throw new Error('unreachable');
    }
    expect((await markSuperseded(a.id, b.id)).ok).toBe(true);
    const again = await markSuperseded(a.id, c.id);
    expect(again.ok, 'a second supersession rewrote the first').toBe(false);
  });

  it('an undo states its reason, and an empty one never reaches the database', async () => {
    const d = await recordDecision(entry({ provenance: 'test/undo' }));
    if (d.state !== 'written') throw new Error('unreachable');
    const bad = await markUndone(d.id, '   ');
    expect(bad.ok).toBe(false);
    expect(bad.why).toContain('states a reason');

    const good = await markUndone(d.id, 'the runner reverted this in the app');
    expect(good.ok).toBe(true);

    const h = await loadRecentDecisions(entry().userUuid, 200);
    if (h.state !== 'read') throw new Error('unreachable');
    const row = h.rows.find((r) => r.id === d.id);
    expect(row?.undoneAt).toBeTruthy();
    expect(row?.undoReason).toBe('the runner reverted this in the app');
  });

  it('an UNDONE decision leaves Rule 21\'s census, but the ROW is still there', async () => {
    // "This was reversed" and "this never happened" are different facts and
    // only one of them is recoverable afterwards.
    const c = await directionCensus(entry().userUuid);
    if (c.state !== 'measured') throw new Error('unreachable');
    const h = await loadRecentDecisions(entry().userUuid, 200);
    if (h.state !== 'read') throw new Error('unreachable');
    const undone = h.rows.filter((r) => r.undoneAt != null);
    expect(undone.length).toBeGreaterThan(0);
    const totalRows = h.rows.length;
    const counted = c.counts.UP + c.counts.DOWN + c.counts.NEUTRAL + c.counts.UNKNOWN;
    expect(counted).toBe(totalRows - undone.length);
  });
});
