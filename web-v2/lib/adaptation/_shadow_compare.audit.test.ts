/**
 * lib/adaptation/_shadow_compare.audit.test.ts · PART 2 verification, real
 * account, per `docs/PRODUCT_DECISIONS.md` 2026-09-01 §2.
 *
 * Read-only, same convention as `_adaptation_engine.audit.test.ts`:
 * `DATABASE_URL` is overridden onto the read-only role BEFORE `lib/db/pool`'s
 * module-level `new Pool(...)` runs, so every app module is imported
 * DYNAMICALLY inside the test body. The RO role is also the FENCE this file
 * relies on for its zero-mutation claim: if a future edit to
 * `shadow-compare.ts` (or anything it calls) introduced a write, the role
 * refuses at the Postgres permission level rather than this file's own
 * say-so being the only guarantee (Rule 18).
 *
 *   npx vitest run lib/adaptation/_shadow_compare.audit.test.ts --disable-console-intercept
 *
 * What this file proves (Part 2 of the task):
 *   1. ZERO PLAN MUTATION — the RO-role fence, PLUS an independent
 *      before/after checksum of the account's `plan_workouts` rows.
 *   2. DETERMINISM — same inputs, same day, run 3x → identical proposal.
 *      NOT the same claim as multi-day stability (that needs real elapsed
 *      days the cron has not had yet — named honestly as a gap, not faked).
 *   3. A REAL NON-UPWARD CASE — walks earlier dates in the season to find a
 *      day the PACE lever returns HOLD or INSUFFICIENT_EVIDENCE, so this is
 *      not just the one lucky upward day already seen in
 *      `_adaptation_engine.audit.test.ts`.
 *   4. PERSISTENCE POSTURE — the table does not exist (migration 160 is
 *      proposed, not run), so `persistShadowCompareRecord` with the file
 *      fallback allowed writes a real, inspectable file, and
 *      `runAndPersistPaceShadowCompare` (what the cron actually calls, file
 *      fallback OFF) reports `skipped` rather than either crashing or
 *      pretending an ephemeral file write is production persistence.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const RO = process.env.DATABASE_URL_RO;
const OWNER = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const TODAY = '2026-08-31';

const checksumPlanWorkouts = async (pool: any, userUuid: string): Promise<string> => {
  const r = await pool.query(
    `SELECT md5(COALESCE(string_agg(
        pw.id || ':' || COALESCE(pw.pace_target_s_per_mi::text, '') || ':'
          || COALESCE(pw.distance_mi::text, '') || ':' || COALESCE(pw.type, ''),
        ',' ORDER BY pw.id
      ), '')) AS checksum, COUNT(*)::int AS n
       FROM plan_workouts pw
       JOIN training_plans tp ON tp.id = pw.plan_id
      WHERE tp.user_uuid = $1::uuid AND tp.archived_iso IS NULL`,
    [userUuid],
  );
  return `${r.rows[0].checksum}:${r.rows[0].n}`;
};

describe.skipIf(!RO)('SHADOW-COMPARE · Part 2, real account', () => {
  it('runs three times against the SAME day and never mutates plan_workouts (checksum + RO-role fence)', async () => {
    process.env.DATABASE_URL = RO;

    const { pool } = await import('@/lib/db/pool');
    const { runPaceShadowCompareCycle, persistShadowCompareRecord, _resetShadowTableProbeForTests } =
      await import('./shadow-compare');
    _resetShadowTableProbeForTests();

    const before = await checksumPlanWorkouts(pool, OWNER);

    const runs: Array<{
      record: Awaited<ReturnType<typeof runPaceShadowCompareCycle>>;
      persisted: Awaited<ReturnType<typeof persistShadowCompareRecord>>;
    }> = [];
    for (let i = 0; i < 3; i += 1) {
      const record = await runPaceShadowCompareCycle(OWNER, TODAY);
      const persisted = await persistShadowCompareRecord(record, { allowFileFallback: true });
      runs.push({ record, persisted });
    }

    const after = await checksumPlanWorkouts(pool, OWNER);

    console.log('\n══ SHADOW-COMPARE · ZERO-MUTATION + DETERMINISM ═══════════════════');
    console.log(`plan_workouts checksum before: ${before}`);
    console.log(`plan_workouts checksum after:  ${after}`);
    console.log(`match: ${before === after}`);

    // 1 · ZERO MUTATION — independent of the RO-role fence (which would have
    // thrown by now if any write had been attempted at all).
    expect(after).toBe(before);

    // 2 · DETERMINISM — same account, same day, three runs → identical
    // decision/previous/proposed/phaseBreakdown. Confidence and staleness
    // factors are deterministic functions of the same inputs too, so the
    // WHOLE engine record (minus the timestamp) should be byte-identical.
    const strip = (r: (typeof runs)[number]['record']) => {
      const { resolvedAt, ...rest } = r;
      return rest;
    };
    const [first, ...rest] = runs.map((r) => strip(r.record));
    for (const r of rest) {
      expect(r).toEqual(first);
    }
    console.log(`\nengine.decision across 3 runs: ${runs.map((r) => r.record.engine.decision).join(', ')}`);
    console.log(`3 runs identical (minus resolvedAt): ${rest.every((r) => JSON.stringify(r) === JSON.stringify(first))}`);

    // 3 · PERSISTENCE, file posture (table not created — migration 160 is
    // proposed, not run).
    for (const { persisted } of runs) {
      expect(persisted.posture).toBe('file');
    }
    const filePath = runs[0].persisted.detail;
    expect(existsSync(filePath)).toBe(true);
    const lines = readFileSync(filePath, 'utf8').trim().split('\n');
    console.log(`\npersisted file: ${filePath}`);
    console.log(`lines in file (this run appended 3): ${lines.length}`);
    const lastRecord = JSON.parse(lines[lines.length - 1]);
    expect(lastRecord.userUuid).toBe(OWNER);
    expect(lastRecord.engine.phaseBreakdown.length).toBeGreaterThan(0);

    console.log('\n═════════════════════════════════════════════════════════════════\n');
  }, 120_000);

  it('the CRON path (file fallback OFF) reports skipped rather than a placebo write, and never throws', async () => {
    process.env.DATABASE_URL = RO;
    const { runAndPersistPaceShadowCompare, _resetShadowTableProbeForTests } = await import('./shadow-compare');
    _resetShadowTableProbeForTests();

    const { record, persisted, error } = await runAndPersistPaceShadowCompare(OWNER, TODAY);

    console.log('\n══ SHADOW-COMPARE · CRON PATH (persistence blocked on DDL) ════════');
    console.log(`error: ${error ?? 'none'}`);
    console.log(`persisted: ${JSON.stringify(persisted)}`);
    console.log('═════════════════════════════════════════════════════════════════\n');

    expect(error).toBeUndefined();
    expect(record).not.toBeNull();
    expect(persisted?.posture).toBe('skipped');
    expect(persisted?.detail).toMatch(/migration 160/);
  }, 60_000);

  /**
   * 3 · A REAL NON-UPWARD CASE. Walks back through the season looking for a
   * day the PACE lever reads HOLD or INSUFFICIENT_EVIDENCE, so this handback
   * is not resting on the one successful upward day already logged in
   * `_adaptation_engine.audit.test.ts`.
   */
  it('finds a real HOLD or INSUFFICIENT_EVIDENCE day, not just the one upward day', async () => {
    process.env.DATABASE_URL = RO;
    const { runPaceShadowCompareCycle } = await import('./shadow-compare');

    // Early season, before three controlled corroborating sessions existed —
    // PACE should not yet be able to PROGRESS.
    const CANDIDATE_DATES = ['2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01'];

    console.log('\n══ SHADOW-COMPARE · WALKING FOR A NON-UPWARD CASE ═════════════════');
    let found: { date: string; decision: string } | null = null;
    for (const d of CANDIDATE_DATES) {
      const record = await runPaceShadowCompareCycle(OWNER, d);
      console.log(`  ${d} · decision ${record.engine.decision} · "${record.engine.explanation}"`);
      if (!found && record.engine.decision !== 'PROGRESS' && record.engine.decision !== 'NO_PACE_PROPOSAL') {
        found = { date: d, decision: record.engine.decision };
      }
    }
    console.log(`\nfound: ${found ? `${found.decision} on ${found.date}` : 'none in the sampled dates'}`);
    console.log('═════════════════════════════════════════════════════════════════\n');

    // LIVENESS (Rule 18 guard 2), same discipline as the sibling audit file:
    // this asserts the probe actually distinguished cases, not that every
    // sampled date lands on a specific verdict.
    expect(found).not.toBeNull();
    expect(['HOLD', 'INSUFFICIENT_EVIDENCE']).toContain(found?.decision);
  }, 120_000);
});
