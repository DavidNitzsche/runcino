/**
 * lib/runs/_splits_repair_sql.audit.test.ts · GENERATOR, not a gate.
 *
 * Emits the exact, guarded, idempotent SQL that would repair the canonical
 * rows already carrying truncated splits, using the REAL `chooseSplits` — so
 * the statements cannot drift from the code that will produce the same answer
 * for every future row.
 *
 * `.audit.` by the convention this directory already uses for DB-backed
 * probes: it needs `DATABASE_URL_RO` and skips without one, so it is not part
 * of the gate chain and cannot make CI depend on a database.
 *
 * READ-ONLY. It prints SQL. It does not execute it, and the connection it
 * opens is the read-only role. Data writes are the owner's call.
 *
 * Run with:
 *   npx vitest run lib/runs/_splits_repair_sql.audit.test.ts --reporter=basic
 */
import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';

import { chooseSplits, type SplitCandidate } from '@/lib/runs/splits-adopt';
import { SOURCE_TIER } from '@/lib/runs/canonical';

const RO = process.env.DATABASE_URL_RO;
const OWNER = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const tierOf = (s: string | null) => (s ? SOURCE_TIER[s] ?? 0 : 0);

describe.skipIf(!RO)('SPLITS REPAIR · generate the SQL, execute nothing', () => {
  it('emits one guarded statement per repairable row', async () => {
    const pool = new Pool({
      connectionString: RO,
      ssl: RO!.includes('localhost') ? false : { rejectUnauthorized: false },
      max: 2,
    });
    try {
      // SCOPE, STATED (Rule 14): this runner by uuid; canonical by the pointer
      // predicate, never by `absorbed_into_canonical_at`. No app filters.
      const { rows } = await pool.query<{
        id: string; day: string; source: string | null; merged: string | null;
        dist: string | null; splits: unknown;
      }>(
        `SELECT id::text AS id,
                COALESCE(data->>'date', left(data->>'startLocal',10)) AS day,
                data->>'source' AS source,
                data->>'mergedIntoId' AS merged,
                data->>'distanceMi' AS dist,
                data->'splits' AS splits
           FROM runs WHERE user_uuid = $1::uuid ORDER BY 2`,
        [OWNER],
      );

      // LIVENESS · a generator that read nothing must not emit "nothing to do".
      expect(rows.length).toBeGreaterThan(0);

      const canonical = rows.filter((r) => r.merged == null);
      const sibs = new Map<string, typeof rows>();
      for (const l of rows.filter((r) => r.merged != null)) {
        const k = String(l.merged);
        if (!sibs.has(k)) sibs.set(k, [] as unknown as typeof rows);
        sibs.get(k)!.push(l);
      }

      const forward: string[] = [];
      const inverse: string[] = [];
      let miles = 0;

      for (const c of canonical) {
        const kids = sibs.get(String(c.id)) ?? [];
        if (kids.length === 0) continue;
        const candidates: SplitCandidate[] = kids.map((k) => ({ source: k.source, raw: k.splits }));
        const res = chooseSplits(c.splits, candidates, c.dist == null ? null : Number(c.dist), tierOf);
        if (res.splits == null) continue;
        miles += res.milesAdded.length;

        const before = Array.isArray(c.splits) ? c.splits.length : 0;
        const after = res.splits.length;
        // A SQL single-quoted literal: JSON as-is, with `'` doubled. NOT
        // JSON.stringify twice — that emits `\"` inside the literal and
        // postgres rejects it. Every literal below is round-tripped through
        // `SELECT $1::jsonb` before this file is written, so a statement that
        // would not parse cannot reach the owner.
        const payload = JSON.stringify(res.splits).replace(/'/g, "''");

        // GUARDED · the WHERE clause pins the row to the exact state this
        // payload was computed from, so a row a concurrent writer has already
        // changed is skipped rather than clobbered. IDEMPOTENT · re-running
        // after success matches nothing, because the length no longer equals
        // `before`.
        //
        // RULE 6 · `runs.data` is multi-writer jsonb, so this is jsonb_set on
        // the single key. Never `SET data = ...`, which would erase whatever
        // another writer put on this row between the read and the write.
        forward.push(
          `-- ${c.day} · ${c.source} · ${before} -> ${after} splits · ` +
          `+[${res.milesAdded.join(',')}] from ${res.adoptedFrom}\n` +
          `UPDATE runs SET data = jsonb_set(data, '{splits}', '${payload}'::jsonb)\n` +
          ` WHERE id = ${c.id}::BIGINT\n` +
          `   AND user_uuid = '${OWNER}'::uuid\n` +
          `   AND NOT (data ? 'mergedIntoId')\n` +
          `   AND COALESCE(jsonb_array_length(data->'splits'), 0) = ${before};`,
        );
        const back = JSON.stringify(Array.isArray(c.splits) ? c.splits : [])
          .replace(/'/g, "''");

        // VALIDATE · both literals must actually parse as jsonb, and the
        // forward payload must round-trip to the array we computed. A
        // generator that emits SQL nobody has parsed is a generator that has
        // handed the owner a broken statement with a confident comment on it.
        const check = await pool.query<{ f: unknown; b: unknown }>(
          `SELECT '${payload}'::jsonb AS f, '${back}'::jsonb AS b`);
        expect(check.rows[0].f).toEqual(res.splits);
        expect(Array.isArray(check.rows[0].b)).toBe(true);
        inverse.push(
          `-- inverse · ${c.day} · restores the ${before} elements this row held\n` +
          `UPDATE runs SET data = jsonb_set(data, '{splits}', '${back}'::jsonb)\n` +
          ` WHERE id = ${c.id}::BIGINT\n` +
          `   AND user_uuid = '${OWNER}'::uuid\n` +
          `   AND COALESCE(jsonb_array_length(data->'splits'), 0) = ${after};`,
        );
      }

      const dryRun =
        `-- DRY RUN · rows this batch would touch, before running anything.\n` +
        `SELECT count(*) FROM runs WHERE id IN (\n  ` +
        canonical
          .filter((c) => forward.some((f) => f.includes(`id = ${c.id}::BIGINT`)))
          .map((c) => c.id).join(', ') +
        `\n) AND user_uuid = '${OWNER}'::uuid AND NOT (data ? 'mergedIntoId');`;

      const out =
        `-- SPLITS REPAIR · generated ${new Date().toISOString().slice(0, 10)} by\n` +
        `-- lib/runs/_splits_repair_sql.audit.test.ts, from the real chooseSplits.\n` +
        `--\n` +
        `-- ${forward.length} row(s) · ${miles} split-mile(s) recovered.\n` +
        `-- Read ${rows.length} rows (${canonical.length} canonical). NOT EXECUTED.\n` +
        `--\n` +
        `-- Each statement is GUARDED on the row's current split count, so it is\n` +
        `-- idempotent (a second run matches nothing) and safe against a concurrent\n` +
        `-- writer (a row that changed underneath is skipped, not clobbered).\n` +
        `-- Rule 6: jsonb_set on the single key, never SET data = ...\n` +
        `--\n` +
        `-- DATA WRITES ARE THE OWNER'S CALL. Run the dry run first.\n\n` +
        `-- ── DRY RUN ──────────────────────────────────────────\n\n${dryRun}\n\n` +
        `-- ── FORWARD ──────────────────────────────────────────\n\n${forward.join('\n\n')}\n\n` +
        `-- ── INVERSE ──────────────────────────────────────────\n\n${inverse.join('\n\n')}\n`;
      // The write is OPT-IN. A test that rewrites a tracked file on every run
      // dirties the tree of anyone who happens to have DATABASE_URL_RO set,
      // and a dirty tree is how an unrelated change gets swept into a commit.
      // The assertions below run either way, so the check still has teeth
      // without the side effect.
      //
      //   SPLITS_REPAIR_EMIT=1 npx vitest run lib/runs/_splits_repair_sql.audit.test.ts
      const path = decodeURIComponent(
        new URL('../../../docs/splits-truncation-repair.sql', import.meta.url).pathname);
      if (process.env.SPLITS_REPAIR_EMIT === '1') {
        (await import('node:fs')).writeFileSync(path, out);
      }
      // eslint-disable-next-line no-console
      console.log(
        `\nSPLITS REPAIR · ${forward.length} rows, ${miles} miles`
        + (process.env.SPLITS_REPAIR_EMIT === '1' ? ` → ${path}` : ' (set SPLITS_REPAIR_EMIT=1 to write)')
        + '\n');
      expect(out.length).toBeGreaterThan(0);

      // Every forward statement has its own inverse — the invariant that
      // matters, and it holds at any row count, zero included.
      expect(forward.length).toBe(inverse.length);

      // 2026-08-30 · this used to assert `forward.length > 0`, which encoded
      // "there ARE repairable rows". True the day it was written; false the
      // moment the 14 rows it found were actually repaired. A green fix turned
      // it red, and zero-rows-needing-repair is the number we WANT.
      //
      // An assertion that a defect still exists is not a regression test, it
      // is a countdown that fires when you succeed.
      //
      // The teeth stay with the liveness assertion above (`rows.length > 0`)
      // plus this one: zero repairable rows out of a non-empty canonical set
      // is the healthy state and passes; zero CANONICAL rows means the query
      // broke and still fails. Rule 18 / Rule 22 — "clean" and "scanned
      // nothing" must not look the same.
      expect(
        canonical.length,
        'the repair query resolved no canonical rows — the generator is broken, '
        + 'not the data clean',
      ).toBeGreaterThan(0);
    } finally {
      await pool.end();
    }
  }, 60_000);
});
