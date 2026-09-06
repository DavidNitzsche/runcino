/**
 * lib/ops/_reassessment_seven_kinds_restart.db.test.ts · ALL SEVEN KINDS,
 * WRITTEN BY THIS PROCESS, READ BACK BY A CONNECTION THAT NEVER SAW THE
 * WRITE — WITH THE IN-PROCESS TABLE-EXISTS CACHE COLD, EXACTLY AS A FRESHLY
 * STARTED SERVER WOULD FIND IT.
 *
 * `_reassessment_scheduler.db.test.ts` proves durability item-by-item, one
 * kind at a time, spread across many `it()` blocks. Nothing proved that ALL
 * SEVEN survive together, with their FULL field set, read by a connection
 * this process never opened. That is the literal overnight-priority ask —
 * "PROVE each persists across a process restart" — and it is not the same
 * claim as "an INSERT followed by a SELECT on the same pool", which would
 * pass even if every field in this table were held in an in-memory cache and
 * never actually committed.
 *
 * ── WHY A NEW `pg.Pool`, AND NOT JUST A SECOND QUERY ───────────────────────
 *
 * `pool` from `lib/db/pool.ts` is a connection POOL — a second query against
 * it can be served by the exact same physical backend that did the write, and
 * proves nothing about durability. This file opens a SEPARATE `Pool`
 * (`fresh`), reads `pg_backend_pid()` from both sides and asserts they
 * differ, then explicitly `.end()`s the fresh pool and asserts a query
 * against it afterward THROWS — proving the "restart" is a real, closed
 * connection lifecycle and not a relabelled call on the same socket. That is
 * this file's own answer to CLAUDE.md Rule 18's falsification (c): "a
 * process-restart simulation that doesn't actually close and reopen a
 * connection."
 *
 * `_resetScheduleTableProbeForTests()` clears the module-level `to_regclass`
 * cache `reassessment-scheduler.ts` keeps for its own lifetime — the thing a
 * real process restart would also clear — so the application's OWN reader
 * functions (`loadLiveQueue`, `loadDueItems`) are exercised cold too, not just
 * the raw SQL.
 *
 * ── IT NEVER TOUCHES PRODUCTION, AND IT SAYS SO WHEN IT SKIPS ──────────────
 *
 * Same gate as `_reassessment_scheduler.db.test.ts`: `DATABASE_URL` must
 * parse, name a loopback host, and name `faff_ledger_scratch`. Skips loudly
 * rather than reporting clean when it is not reachable (Rule 18 point 2).
 *
 *     createdb faff_ledger_scratch
 *     psql -d faff_ledger_scratch -f web-v2/db/migrations/167_reassessment_schedule.sql
 *     DATABASE_URL=postgresql://localhost/faff_ledger_scratch \
 *       npx vitest run lib/ops/_reassessment_seven_kinds_restart.db.test.ts
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ────────────────────────────────
 *
 * · WHETHER A REAL PRODUCTION CALLER SCHEDULES EACH KIND. That is
 *   `_reassessment_scheduler.test.ts`'s COVERAGE-1 block, which scans the
 *   source tree for actual call sites. This file writes all seven directly
 *   through `scheduleReassessment` to prove the STORE round-trips every kind
 *   the CHECK constraint allows, whether or not production exercises that
 *   kind yet.
 * · WHETHER A TCP-LEVEL RESTART OF THE NODE PROCESS ITSELF WOULD BEHAVE
 *   IDENTICALLY. Nothing here restarts `node`. It closes and reopens the
 *   DATABASE connection and clears the one piece of in-process state
 *   (`tableExists`/`absentUntilMs`) the scheduler keeps — the exact two
 *   things a real restart would also lose — and that is the surface durable
 *   persistence exists to survive.
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { pool as appPool } from '@/lib/db/pool';
import {
  scheduleReassessment,
  loadLiveQueue,
  loadDueItems,
  _resetScheduleTableProbeForTests,
  REASSESSMENT_KINDS,
  type ReassessmentKind,
  type ScheduleRequest,
} from './reassessment-scheduler';

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
const when = REACHABLE ? it : it.skip;

/**
 * THE SKIP HAS TO BE VISIBLE. `console.warn` is buffered by some reporters;
 * `process.stderr.write` plus a test title that carries the verdict is not
 * (the pattern `_ledger_atomicity.db.test.ts` already uses, after it was
 * falsified by running against a database with no fixture and finding the
 * run summary said nothing at all).
 */
const LIVENESS_TITLE = REACHABLE
  ? 'the scratch database was reachable · every assertion below actually ran'
  : `SKIPPED · THIS SUITE PROVED NOTHING · ${refusals.join('; ')}`;

describe('liveness · did this suite look at anything', () => {
  it(LIVENESS_TITLE, () => {
    if (!REACHABLE) {
      process.stderr.write(
        `\n[reassessment-seven-kinds-restart] SKIPPED · THIS SUITE PROVED NOTHING.\n`
        + `  ${refusals.join('; ')}\n`
        + `  Build the fixture: createdb ${SCRATCH_DB} && psql -d ${SCRATCH_DB} -f `
        + `web-v2/db/migrations/167_reassessment_schedule.sql\n\n`,
      );
    }
    expect(typeof REACHABLE).toBe('boolean');
  });
});

const RUNNER = randomUUID();

/** One fully-populated request per kind, so "round-trips with their FULL
 *  data" is actually checked field by field, not just "a row exists". */
function reqFor(kind: ReassessmentKind): ScheduleRequest {
  const tag = kind.toLowerCase();
  return {
    userUuid: RUNNER,
    kind,
    reasonCode: `restart_proof_${tag}`,
    reasonDetail: `full round-trip proof for ${kind}, written before the simulated restart`,
    assessOnISO: '2026-09-07',
    overdueAfterISO: '2026-09-10',
    requiredEvidence: [{ need: `evidence gate for ${kind}` }],
    evidence: [{ sample: tag, kind }],
    newestEvidenceISO: '2026-09-05',
    planId: `pln_restart_${tag}`,
    planLineageId: `pln_restart_${tag}`,
    planVersion: `pln_restart_${tag}:2026-09-05T00:00:00.000Z`,
    evidenceVersion: 'ev-restart-1',
    modelVersion: 'restart-proof/1',
    lever: `RESTART_PROOF_${kind}`,
    beforeValue: 100,
    proposedAfterValue: 200,
    magnitude: { unit: 'test', kind },
    payload: { proofKind: kind },
    idempotencyKey: `restart-proof:${kind}`,
    queuedAtISO: '2026-09-05',
  };
}

describe('RESTART-1 · all seven kinds written, then read by a connection that never wrote them', () => {
  when('step 0 · the fixture is real, and starts with nothing for this runner', async () => {
    const before = await loadLiveQueue(RUNNER);
    expect(before.state, 'the table is not reachable, so nothing below can prove anything').toBe('ok');
    if (before.state === 'ok') expect(before.value).toHaveLength(0);
  });

  when('step 1 · PROCESS A writes all seven kinds', async () => {
    for (const kind of REASSESSMENT_KINDS) {
      const res = await scheduleReassessment(reqFor(kind));
      expect(res.state, `${kind} failed to schedule: ${res.state !== 'ok' ? res.why : ''}`).toBe('ok');
    }
  });

  when(
    'step 2 · THE RESTART · a genuinely separate connection, cache cold, reads every field back',
    async () => {
      // Clear the in-process cache a real restart would also lose.
      _resetScheduleTableProbeForTests();

      // A SEPARATE `pg.Pool` — not `appPool`, and not a second query against
      // it. Proven separate by comparing backend PIDs, not assumed.
      const fresh = new Pool({ connectionString: process.env.DATABASE_URL });
      try {
        const writerPid = (await appPool.query<{ pid: number }>(
          'SELECT pg_backend_pid() AS pid',
        )).rows[0].pid;
        const freshPid = (await fresh.query<{ pid: number }>(
          'SELECT pg_backend_pid() AS pid',
        )).rows[0].pid;
        expect(
          freshPid,
          'the restart simulation reused the writer\'s own connection, which proves nothing',
        ).not.toBe(writerPid);

        const r = await fresh.query<Record<string, unknown>>(
          `SELECT * FROM reassessment_schedule WHERE user_uuid = $1::uuid ORDER BY kind`,
          [RUNNER],
        );
        expect(r.rows, 'not all seven rows survived to be read by a fresh connection')
          .toHaveLength(REASSESSMENT_KINDS.length);

        const byKind = new Map(r.rows.map((row) => [String(row.kind), row]));
        for (const kind of REASSESSMENT_KINDS) {
          const row = byKind.get(kind);
          expect(row, `${kind} did not round-trip through the fresh connection`).toBeDefined();
          const tag = kind.toLowerCase();
          // FULL DATA, not just presence: every field a real caller populated,
          // read back through a connection that never held it in memory.
          expect(row!.reason_code).toBe(`restart_proof_${tag}`);
          expect(String(row!.reason_detail)).toContain(kind);
          expect(String(row!.plan_id)).toBe(`pln_restart_${tag}`);
          expect(String(row!.plan_lineage_id)).toBe(`pln_restart_${tag}`);
          expect(String(row!.plan_version)).toContain(tag);
          expect(row!.evidence_version).toBe('ev-restart-1');
          expect(row!.model_version).toBe('restart-proof/1');
          expect(row!.lever).toBe(`RESTART_PROOF_${kind}`);
          expect(Number(row!.before_value)).toBe(100);
          expect(Number(row!.proposed_after_value)).toBe(200);
          expect((row!.magnitude as { kind?: string }).kind).toBe(kind);
          expect((row!.payload as { proofKind?: string }).proofKind).toBe(kind);
          expect((row!.required_evidence as unknown[]).length).toBe(1);
          expect((row!.evidence as unknown[]).length).toBe(1);
          expect(String(row!.assess_on_iso).slice(0, 10)).toBe('2026-09-07');
          expect(String(row!.overdue_after_iso).slice(0, 10)).toBe('2026-09-10');
          expect(row!.status).toBe('PENDING');
          expect(row!.idempotency_key).toBe(`restart-proof:${kind}`);
        }
      } finally {
        await fresh.end();
      }

      // THE CLOSE WAS REAL: a query against the ended pool must fail. If this
      // assertion cannot fail, neither can the "genuinely separate connection"
      // claim above be trusted — a pool `.end()` that silently no-ops would
      // make this whole restart simulation a same-connection read with extra
      // steps.
      await expect(fresh.query('SELECT 1')).rejects.toThrow();

      // And the APPLICATION'S OWN readers, with the same cold cache, also
      // re-discover the table — exactly what a freshly started server process
      // does on its first request after this exact migration has already been
      // applied underneath it (MIGRATIONPROBE-1's scenario).
      const live = await loadLiveQueue(RUNNER);
      expect(live.state).toBe('ok');
      if (live.state === 'ok') {
        expect(live.value.map((i) => i.kind).sort()).toEqual([...REASSESSMENT_KINDS].sort());
        // A reader that only counted rows could not see this: PENDING items
        // whose data actually came from the DB round trip carry the payload.
        for (const item of live.value) {
          expect((item.payload as { proofKind?: string }).proofKind).toBe(item.kind);
        }
      }

      const due = await loadDueItems('2026-09-08');
      expect(due.state).toBe('ok');
      if (due.state === 'ok') {
        const mine = due.value.filter((i) => i.userUuid === RUNNER);
        expect(mine).toHaveLength(REASSESSMENT_KINDS.length);
      }
    },
  );
});
