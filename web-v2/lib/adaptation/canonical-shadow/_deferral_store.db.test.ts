/**
 * lib/adaptation/canonical-shadow/_deferral_store.db.test.ts · A DEFERRAL
 * SURVIVES A PROCESS, PROVEN AGAINST A REAL DATABASE.
 *
 * `canonical/_defer_persist.test.ts` proves the queue's ARITHMETIC — what is
 * carried, what expires, and why — with no database at all. It cannot prove
 * the thing the owner actually asked for, which is that a deferred progression
 * is still there after the process that queued it is gone. Only a real table
 * can, and `deferral-queue.ts`'s own Rule 22 note says so in as many words:
 * "a gate over this file proves the ledger's arithmetic and proves nothing
 * whatsoever about durability across a deploy."
 *
 * ── IT NEVER TOUCHES PRODUCTION, AND IT SAYS SO WHEN IT SKIPS ──────────────
 *
 * Three independent conditions must all hold before a single statement runs:
 *
 *   1 · `DATABASE_URL` must parse, name a LOOPBACK host, and name the database
 *       `faff_deferral_scratch`. A URL that merely "looks local" is not
 *       enough — the same predicate `lib/adaptation-harness/fence.ts` applies
 *       to its own scratch database, for the same reason.
 *   2 · `DATABASE_URL_RO` must satisfy the same test, because the READ half of
 *       the store goes through `read-only-db.ts` and pointing that at
 *       production while writing locally would read one database and write
 *       another.
 *   3 · The production write barrier installed by `vitest.setup.ts` refuses
 *       every mutating statement whose target is not provably loopback, and it
 *       is NOT disabled here. It is the backstop, not the gate.
 *
 * When any of those fails the suite SKIPS AND PRINTS WHY. That is Rule 18's
 * liveness requirement pointed at a conditional test: reporting clean because
 * it looked at nothing is the worst available outcome, since it also reports
 * confidence. Run it with:
 *
 *     createdb faff_deferral_scratch
 *     psql -d faff_deferral_scratch -f web-v2/db/migrations/165_canonical_adaptation_deferrals.sql
 *     DATABASE_URL=postgresql://localhost/faff_deferral_scratch \
 *     DATABASE_URL_RO=postgresql://localhost/faff_deferral_scratch \
 *       npx vitest run lib/adaptation/canonical-shadow/_deferral_store.db.test.ts
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ────────────────────────────────
 *
 * · WHETHER THE MIGRATION IS APPLIED TO PRODUCTION. It is not, deliberately.
 *   A green run here says the schema and the store agree on a local copy of
 *   that schema, and nothing about the live database (Rule 19).
 * · WHETHER THE CRON ACTUALLY CALLS ANY OF THIS. It exercises the store
 *   directly. `run-live-shadow-evaluation.ts` is the caller and its own
 *   wiring is not exercised here.
 * · A ROW WRITTEN BY SOMETHING ELSE, or a concurrent writer racing the upsert.
 *   Single-process, single-connection.
 * · WHETHER THE SCRATCH SCHEMA MATCHES PRODUCTION'S. It is applied from the
 *   same migration file, which is the strongest available link and still not
 *   a proof about the live database.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { QueuedDeferral } from '@/lib/adaptation/canonical/deferral-queue';
import { _resetReadOnlyPoolForTests } from './read-only-db';
import {
  loadLiveQueue, upsertDeferral, expireDeferral, persistQueueAtBoundary,
  _resetDeferralTableProbeForTests,
} from './deferral-store';
import { writeDeferral, DeferralWriteRefused } from './deferral-writer';

const SCRATCH_DB = 'faff_deferral_scratch';
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '']);

/** The same predicate `lib/adaptation-harness/fence.ts` applies, asked here
 *  about this test's own scratch database. Pure, so the reason is printable. */
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

const refusals = [
  scratchVerdict(process.env.DATABASE_URL, 'DATABASE_URL'),
  scratchVerdict(process.env.DATABASE_URL_RO, 'DATABASE_URL_RO'),
].filter((x): x is string => x !== null);

const REACHABLE = refusals.length === 0;
const ATHLETE = randomUUID();

const item = (over: Partial<QueuedDeferral> = {}): QueuedDeferral => ({
  queueId: `${ATHLETE} · THRESHOLD_PACE · key-1`,
  athleteId: ATHLETE,
  planVersion: 'plan-v1',
  evidenceVersion: 'ev-1',
  lever: 'THRESHOLD_PACE',
  beforeValue: 442,
  proposedAfterValue: 439,
  magnitude: {
    unit: 'sec_per_mi', value: -3, limit: 3,
    limitConstant: 'THRESHOLD_ORDINARY_STEP_SEC_PER_MI',
    limitCitation: 'test fixture',
  },
  evidence: [],
  newestEvidenceISO: '2026-09-01',
  reason: 'WEEK_AT_DEMAND_CEILING',
  reasonDetail:
    'The threshold evidence supports this change, but this week already contains enough '
    + 'total demand, so the change is deferred until the next appropriate boundary.',
  queuedAtISO: '2026-09-06',
  nextBoundaryISO: '2026-09-07',
  idempotencyKey: 'key-1',
  ...over,
});

describe('liveness · the scratch database was reachable, or the reason is printed', () => {
  it('says which it is, out loud', () => {
    if (!REACHABLE) {
      // eslint-disable-next-line no-console
      console.warn(
        '[deferral-store.db] SKIPPED · this suite proved NOTHING about durability. '
        + refusals.join('; ')
        + '. See this file\'s header for how to run it against a local scratch database.',
      );
    }
    expect(REACHABLE || refusals.length > 0).toBe(true);
  });
});

describe.skipIf(!REACHABLE)('the deferral survives the process that queued it', () => {
  beforeAll(async () => {
    _resetReadOnlyPoolForTests();
    _resetDeferralTableProbeForTests();
  });

  afterAll(async () => {
    // Only this test's own synthetic athlete. Rule 14: the population is
    // named, and it is a uuid nothing else has ever used.
    await writeDeferral(
      `UPDATE canonical_adaptation_deferrals
          SET expired_at = now(), expiry_reason = $2, expiry_detail = $3
        WHERE user_uuid = $1::uuid AND expired_at IS NULL`,
      [ATHLETE, 'BLOCK_ENDED', 'test teardown · this synthetic athlete has no block'],
    );
  });

  it('the table is there and the queue starts MEASURED EMPTY, not absent', () => {
    // Rule 11's first distinction, asserted before anything is written: an
    // empty queue and an unreachable one must not look the same.
    return loadLiveQueue(ATHLETE).then((q) => {
      expect(q.ok, q.ok ? '' : JSON.stringify(q.why)).toBe(true);
      if (!q.ok) throw new Error('unreachable');
      expect(q.value).toEqual([]);
    });
  });

  it('a queued deferral is READ BACK with its reason, its boundary and its evidence intact', async () => {
    await upsertDeferral(ATHLETE, item());
    const q = await loadLiveQueue(ATHLETE);
    expect(q.ok).toBe(true);
    if (!q.ok) throw new Error('unreachable');
    expect(q.value).toHaveLength(1);
    const back = q.value[0];
    // The whole point: this object was reconstructed from the DATABASE, not
    // from the object above. Every field the next boundary needs survived.
    expect(back.lever).toBe('THRESHOLD_PACE');
    expect(back.beforeValue).toBe(442);
    expect(back.proposedAfterValue).toBe(439);
    expect(back.reason).toBe('WEEK_AT_DEMAND_CEILING');
    expect(back.nextBoundaryISO).toBe('2026-09-07');
    expect(back.newestEvidenceISO).toBe('2026-09-01');
    expect(back.idempotencyKey).toBe('key-1');
    expect(back.reasonDetail).toMatch(/this week already contains enough total demand/);
  });

  it('re-queueing the same evidence REFRESHES the row and does not grow the queue', async () => {
    await upsertDeferral(ATHLETE, item({ proposedAfterValue: 438 }));
    const q = await loadLiveQueue(ATHLETE);
    if (!q.ok) throw new Error('unreachable');
    expect(q.value).toHaveLength(1);
    expect(q.value[0].proposedAfterValue).toBe(438);
  });

  it('retiring it removes it from the LIVE queue and keeps the row, with its reason', async () => {
    await expireDeferral(ATHLETE, {
      item: item(),
      expiredAtISO: '2026-09-07',
      expiry: 'SUPERSEDED_BY_LARGER_PROPOSAL',
      detail: 'Re-asked at 2026-09-07, the threshold pace lever proposed further on current evidence.',
    });
    const q = await loadLiveQueue(ATHLETE);
    if (!q.ok) throw new Error('unreachable');
    expect(q.value).toEqual([]);

    // And the history is still there. This is the assertion that separates
    // "retired for a stated reason" from "silently vanished" — a DELETE would
    // satisfy the line above and fail this one.
    const rows = await countRows(ATHLETE);
    expect(rows.total).toBe(1);
    expect(rows.expired).toBe(1);
  });

  it('after a retirement the SAME identity may be queued again, and the expiry survives', async () => {
    // The partial unique index is what makes this possible. With a total
    // index the insert below would collide with the expired row and the only
    // way through would be to resurrect it, erasing the expiry.
    await upsertDeferral(ATHLETE, item({ proposedAfterValue: 437 }));
    const q = await loadLiveQueue(ATHLETE);
    if (!q.ok) throw new Error('unreachable');
    expect(q.value).toHaveLength(1);
    expect(q.value[0].proposedAfterValue).toBe(437);
    const rows = await countRows(ATHLETE);
    expect(rows.total).toBe(2);
    expect(rows.expired).toBe(1);
  });

  it('one boundary retires and re-queues in ONE call, and reports what it did', async () => {
    const other = item({ lever: 'WEEKLY_VOLUME', idempotencyKey: 'key-2', beforeValue: 48, proposedAfterValue: 50, magnitude: { unit: 'weekly_mi', value: 2, limit: 5, limitConstant: 'VOLUME_MAX_STEP_FRAC', limitCitation: 'test fixture' } });
    const result = await persistQueueAtBoundary(ATHLETE, {
      carried: [other],
      expired: [{
        item: item({ proposedAfterValue: 437 }),
        expiredAtISO: '2026-09-14',
        expiry: 'EVIDENCE_WENT_STALE',
        detail: 'The newest session supporting this change is past the 28-day evidence window.',
      }],
    });
    expect(result.refusal).toBeNull();
    expect(result.retired).toBe(1);
    expect(result.written).toBe(1);

    const q = await loadLiveQueue(ATHLETE);
    if (!q.ok) throw new Error('unreachable');
    expect(q.value.map((x) => x.lever)).toEqual(['WEEKLY_VOLUME']);
  });

  it('the database itself REFUSES an expiry with no reason — the rule is not only in TypeScript', async () => {
    // Rule 20 · a product rule with no gate is a hypothesis, and the strongest
    // available gate for "an item never leaves without a stated reason" is the
    // table's own CHECK constraint. Falsified here by trying to break it.
    await expect(writeDeferral(
      `UPDATE canonical_adaptation_deferrals
          SET expired_at = now()
        WHERE user_uuid = $1::uuid AND expired_at IS NULL`,
      [ATHLETE],
    )).rejects.toThrow(/canonical_adaptation_deferrals_expiry_is_explained/);
  });
});

describe('the write fence refuses everything but its two shapes', () => {
  // No database needed: the refusal happens before the wire, which is the
  // whole design. These run whether or not the scratch database exists.
  it('a plan write routed through this client is REFUSED', async () => {
    await expect(writeDeferral('UPDATE plan_workouts SET distance_mi = 9 WHERE id = $1', ['x']))
      .rejects.toBeInstanceOf(DeferralWriteRefused);
  });

  it('a DELETE against its OWN table is refused — rows are never deleted', async () => {
    await expect(writeDeferral('DELETE FROM canonical_adaptation_deferrals WHERE user_uuid = $1', ['x']))
      .rejects.toBeInstanceOf(DeferralWriteRefused);
  });

  it('a second statement smuggled after a legal one is refused', async () => {
    await expect(writeDeferral(
      'UPDATE canonical_adaptation_deferrals SET expired_at = now(); UPDATE plan_workouts SET distance_mi = 9',
      [],
    )).rejects.toBeInstanceOf(DeferralWriteRefused);
  });

  it('ORACLE · the two legal shapes PASS the fence, and so does a real upsert', async () => {
    // Falsification in the other direction: a fence that refuses everything is
    // as useless as one that refuses nothing. Whatever happens past the fence
    // — success against a scratch database, a constraint error, or a
    // connection error with no database at all — the ONE outcome that must not
    // occur is a `DeferralWriteRefused`.
    const shapes = [
      'INSERT INTO canonical_adaptation_deferrals (user_uuid) VALUES ($1)',
      'UPDATE canonical_adaptation_deferrals SET expired_at = now() WHERE user_uuid = $1',
      // The real upsert, whose `ON CONFLICT ... DO UPDATE SET` contains a
      // SECOND `UPDATE` keyword. The "no second verb anywhere" scan would
      // refuse the store's own only insert if it did not know that clause.
      'INSERT INTO canonical_adaptation_deferrals (user_uuid) VALUES ($1) '
      + 'ON CONFLICT (user_uuid, lever, idempotency_key) WHERE expired_at IS NULL '
      + 'DO UPDATE SET updated_at = now()',
    ];
    for (const sql of shapes) {
      let thrown: unknown = null;
      try {
        await writeDeferral(sql, ['00000000-0000-0000-0000-000000000000']);
      } catch (e) { thrown = e; }
      expect(thrown, `the fence must not refuse: ${sql.slice(0, 60)}`)
        .not.toBeInstanceOf(DeferralWriteRefused);
    }
  });
});

/** Raw counts, deliberately NOT through the store's own filter (Rule 14: a
 *  verification query that reuses the reader's filter reproduces the bug
 *  instead of revealing it). */
async function countRows(userUuid: string): Promise<{ total: number; expired: number }> {
  const { roQuery } = await import('./read-only-db');
  const r = await roQuery<{ total: string; expired: string }>(
    `SELECT COUNT(*)::text AS total,
            COUNT(*) FILTER (WHERE expired_at IS NOT NULL)::text AS expired
       FROM canonical_adaptation_deferrals
      WHERE user_uuid = $1::uuid`,
    [userUuid],
  );
  return { total: Number(r.rows[0].total), expired: Number(r.rows[0].expired) };
}
