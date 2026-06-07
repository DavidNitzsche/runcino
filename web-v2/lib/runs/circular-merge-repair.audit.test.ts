/**
 * lib/runs/circular-merge-repair.audit.test.ts · READ-ONLY data-repair audit (P1b).
 *
 * Gated: runs ONLY when DATABASE_URL_RO is set, so the normal `npm test` skips it
 * entirely (no DB needed for the suite). Opens its OWN read-only pool from
 * DATABASE_URL_RO — it never touches the shared superuser pool and never writes.
 *
 * It imports the REAL planMergeOps/clusterRuns/pickCanonical (zero logic drift),
 * loads every run in the window UNFILTERED, and reports, per day:
 *   - readerMi   — what volume.ts counts today (rows with NO mergedIntoId, re-clustered)
 *   - trueMi     — what SHOULD be counted (every cluster's canonical, flags ignored)
 *   - the exact repair SQL (clears + sets) to bring the flags to the invariant
 *
 * A zeroed/under-counted day (readerMi < trueMi) is the 06-07 circular-merge
 * symptom. The emitted SQL is what David reviews before any write; it is byte-for-
 * byte the statements merge.ts:autoMergeForDate would run.
 *
 * Run it:  DATABASE_URL_RO=... npm test -- circular-merge-repair.audit
 * After the write, re-run with EXPECT_REPAIRED=1 to assert the clean end state
 * (no under-counted days, recentWeeklyMi ≈ true).
 */
import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';
import { clusterRuns, pickCanonical, planMergeOps, type RunRow } from './identity';

const RO = process.env.DATABASE_URL_RO;
const DAVID = process.env.AUDIT_USER_UUID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';
// 28-day recent window drives recentWeeklyMi; the 06-07 corruption sits in 05-31..06-04.
const FROM = process.env.AUDIT_FROM ?? '2026-05-10';
const TO = process.env.AUDIT_TO ?? '2026-06-07';

const distMi = (r: RunRow): number => Number(r.data?.distanceMi ?? 0);
const dayOf = (r: RunRow): string =>
  String(r.data?.date ?? String(r.data?.startLocal ?? '').slice(0, 10));
const src = (r: RunRow): string => String(r.data?.source ?? '?');

describe.skipIf(!RO)('circular-merge repair audit (READ-ONLY · DATABASE_URL_RO)', () => {
  const pool = new Pool({ connectionString: RO, ssl: { rejectUnauthorized: false }, max: 2 });

  it('confirms the RO role is faff_readonly (not a superuser)', async () => {
    const who = (await pool.query('SELECT current_user')).rows[0].current_user;
    // eslint-disable-next-line no-console
    console.log(`\n[audit] connected as: ${who}`);
    expect(who).toBe('faff_readonly');
  });

  it('reports under-counted days and emits the exact repair SQL', async () => {
    const rows = (await pool.query(
      `SELECT id::text AS id, user_uuid::text AS user_uuid, data
         FROM runs
        WHERE user_uuid = $1
          AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) BETWEEN $2 AND $3`,
      [DAVID, FROM, TO],
    )).rows as RunRow[];

    const byDay = new Map<string, RunRow[]>();
    for (const r of rows) {
      const d = dayOf(r);
      if (!d) continue;
      (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(r);
    }

    const clearSql: string[] = [];
    const setSql: string[] = [];
    let readerTotal = 0;
    let trueTotal = 0;
    const lines: string[] = [];

    for (const day of [...byDay.keys()].sort()) {
      const dayRows = byDay.get(day)!;

      // What volume.ts counts NOW: only rows lacking mergedIntoId, re-clustered.
      const visible = dayRows.filter((r) => r.data?.mergedIntoId == null);
      let readerMi = 0;
      for (const c of clusterRuns(visible)) readerMi += distMi(pickCanonical(c).canonical);

      // What SHOULD be counted: every cluster's canonical, flags ignored.
      let trueMi = 0;
      for (const c of clusterRuns(dayRows)) trueMi += distMi(pickCanonical(c).canonical);

      readerTotal += readerMi;
      trueTotal += trueMi;

      const ops = planMergeOps(dayRows);
      const needsRepair = ops.clears.length > 0 || ops.sets.length > 0;
      if (Math.abs(readerMi - trueMi) > 0.05 || needsRepair) {
        lines.push(
          `  ${day}  reader=${readerMi.toFixed(2)}mi  true=${trueMi.toFixed(2)}mi  ` +
          `rows=[${dayRows.map((r) => `${src(r)}:${distMi(r).toFixed(2)}${r.data?.mergedIntoId != null ? `→${r.data.mergedIntoId}` : ''}`).join(', ')}]`,
        );
      }
      for (const id of ops.clears) {
        const r = dayRows.find((x) => x.id === id);
        clearSql.push(
          `UPDATE runs SET data = data - 'mergedIntoId' WHERE id = ${id}::bigint;` +
          `  -- ${day}: clear canonical ${src(r!)} ${distMi(r!).toFixed(2)}mi`,
        );
      }
      for (const { id, canonicalId } of ops.sets) {
        const l = dayRows.find((x) => x.id === id);
        const c = dayRows.find((x) => x.id === canonicalId);
        setSql.push(
          `UPDATE runs SET data = jsonb_set(data, '{mergedIntoId}', to_jsonb(${canonicalId}::bigint)) WHERE id = ${id}::bigint;` +
          `  -- ${day}: ${src(l!)} → ${c ? src(c) : canonicalId}`,
        );
      }
    }

    /* eslint-disable no-console */
    console.log(`\n=== circular-merge repair audit · ${DAVID.slice(0, 8)} · ${FROM}..${TO} ===`);
    console.log(`days needing attention:\n${lines.join('\n') || '  (none)'}`);
    console.log(`\n--- PROPOSED REPAIR SQL (review before any write) ---`);
    console.log([...clearSql, ...setSql].join('\n') || '  (no statements — already clean)');
    console.log(
      `\nwindow canonical mileage · reader=${readerTotal.toFixed(1)}mi  true=${trueTotal.toFixed(1)}mi` +
      `  · gap=${(trueTotal - readerTotal).toFixed(1)}mi`,
    );
    const days28 = (Date.parse(TO) - Date.parse(FROM)) / 86400000 + 1;
    console.log(`recentWeeklyMi (reader/true, ${days28}d→/4wk basis is approximate here)\n`);
    /* eslint-enable no-console */

    // Pre-write: the gap is the bug; post-write (EXPECT_REPAIRED=1) it's gone.
    if (process.env.EXPECT_REPAIRED) {
      expect(clearSql.length + setSql.length).toBe(0);
      expect(Math.abs(trueTotal - readerTotal)).toBeLessThan(0.05);
    } else {
      expect(readerTotal).toBeLessThanOrEqual(trueTotal + 0.05);
    }
  });

  it('lists circular pairs explicitly (A→B AND B→A)', async () => {
    const rows = (await pool.query(
      `SELECT id::text AS id, data->>'mergedIntoId' AS merged_into
         FROM runs
        WHERE user_uuid = $1
          AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) BETWEEN $2 AND $3
          AND data ? 'mergedIntoId'`,
      [DAVID, FROM, TO],
    )).rows as Array<{ id: string; merged_into: string }>;
    const target = new Map(rows.map((r) => [r.id, r.merged_into]));
    const cycles: Array<[string, string]> = [];
    for (const [id, into] of target) {
      if (into && target.get(into) === id && id < into) cycles.push([id, into]);
    }
    // eslint-disable-next-line no-console
    console.log(`\ncircular pairs: ${cycles.length ? cycles.map((c) => c.join('↔')).join(', ') : '(none)'}`);
    if (process.env.EXPECT_REPAIRED) expect(cycles.length).toBe(0);
  });
});
