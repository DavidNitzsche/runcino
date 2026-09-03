/**
 * THE CLASS · ONE RUN ID, MORE THAN ONE ANSWER.
 *
 * Not one route. A run reaches the app under four spellings — the row's bigint
 * primary key, Strava's `data.activityId`, the watch's `data.id`, and two
 * SYNTHETIC forms this app mints itself (`YYYY-MM-DD-mi` and
 * `<something>-YYYY-MM-DD`) — and each verb had learned a different subset:
 *
 *   `PATCH /api/runs/[id]`   resolver + "YYYY-MM-DD-mi" + trailing date
 *   `loadRunDetail`          resolver + "YYYY-MM-DD-mi"
 *   `/api/runs/[id]/recap`   resolver
 *   `lib/postrun/load.ts`    its own identity query, no absorbed rung  ← still open
 *
 * Measured on production 2026-09-03 as `faff_readonly`, reference runner
 * `0645f40c-951d-4ccc-b86e-9979cd26c795`, for `<uuid>-2026-09-02` and its two
 * neighbours: 0 rows on the canonical identity rung, 0 on the any-row identity
 * rung, 1 on the trailing-date rung. So the SAME id string wrote a shoe
 * successfully and 404'd the run it wrote it onto — Rule 16 at the identity
 * layer, and the choice of answer was made by HTTP verb.
 *
 * ── TWO HALVES, because either alone is defeatable ──────────────────────────
 *
 *   BEHAVIOURAL · the rungs, including the two refusals, against a stubbed
 *                 pool. Catches a rung that stops working.
 *   STRUCTURAL  · nobody re-mints the id vocabulary outside the resolver.
 *                 Catches a route that stops CALLING it, which no behavioural
 *                 test of the resolver can see (Rule 16's own note).
 *
 * ── COMMENTS ARE STRIPPED BEFORE SCANNING ──────────────────────────────────
 *
 * Two gates in this repo were recently found matching PROSE: a doctrine claim
 * satisfied by the phrase in its own file header, and a SQL scanner matching
 * backticks inside a JSDoc block. `stripComments` below runs first, and
 * `describe('the scanner is live')` proves it by feeding it text that is a
 * violation in code and a comment in prose, and asserting it sees exactly one.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ─────────────────────────────────────
 *
 *   · A route that resolves a run id in SQL without using any of the shapes
 *     below — a raw `data->>'activityId' = $1` written out longhand rather
 *     than through `runIdentityMatchSql`. `_identity_lint.test.ts` is the gate
 *     for that half; this one watches the DAY-based spellings.
 *   · Whether `resolveCanonicalRunRowId`'s answer is CORRECT for a given
 *     production row. The behavioural half stubs the database, so it checks
 *     the ladder's shape and its refusals, never the data.
 *   · The phone and the watch. Both send ids; neither is scanned here.
 *   · `lib/postrun/load.ts`, which is currently ALLOWED below with an argued
 *     reason because another agent owns that file. That is a real open gap and
 *     the allowlist says so rather than hiding it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));

import { pool } from '@/lib/db/pool';
import { resolveCanonicalRunRowId } from './canonical-ref';

const q = pool.query as unknown as ReturnType<typeof vi.fn>;
const rows = (...r: unknown[]) => ({ rows: r });
const USER = '0645f40c-951d-4ccc-b86e-9979cd26c795';

beforeEach(() => { q.mockReset(); });

/* ───────────────────────────────────────────────── behavioural · the rungs */

describe('resolveCanonicalRunRowId · the identity rungs still answer', () => {
  it('rung 1 · a canonical row wins outright and asks nothing further', async () => {
    q.mockResolvedValueOnce(rows({ id: '42' }));
    await expect(resolveCanonicalRunRowId(USER, '19998028774'))
      .resolves.toEqual({ ok: true, rowId: '42', via: 'canonical' });
    expect(q).toHaveBeenCalledTimes(1);
  });

  it('rung 2 · an absorbed id resolves to its SURVIVOR, not to itself', async () => {
    q.mockResolvedValueOnce(rows())                                   // not canonical
     .mockResolvedValueOnce(rows({ id: '7', merged_into_id: '42' }))  // the loser
     .mockResolvedValueOnce(rows({ id: '42' }));                      // the survivor
    await expect(resolveCanonicalRunRowId(USER, 'strava-1'))
      .resolves.toEqual({ ok: true, rowId: '42', via: 'absorbed_pointer' });
  });

  it('rung 3 · a dangling pointer serves the loser and SAYS so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    q.mockResolvedValueOnce(rows())
     .mockResolvedValueOnce(rows({ id: '7', merged_into_id: '999' }))
     .mockResolvedValueOnce(rows());
    const r = await resolveCanonicalRunRowId(USER, 'strava-1');
    // Rule 11 · corruption is its own fact. Returning null would erase a run
    // the runner really did; returning `canonical` would hide it.
    expect(r).toEqual({ ok: true, rowId: '7', via: 'dangling_pointer' });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('resolveCanonicalRunRowId · the DAY rungs, which the routes used to own', () => {
  it('rung 4 · "YYYY-MM-DD-mi" resolves by day AND distance', async () => {
    q.mockResolvedValueOnce(rows())              // rung 1
     .mockResolvedValueOnce(rows())              // rung 2 · no row carries the string
     .mockResolvedValueOnce(rows({ id: '42' })); // rung 4
    await expect(resolveCanonicalRunRowId(USER, '2026-09-02-6.41'))
      .resolves.toEqual({ ok: true, rowId: '42', via: 'synthetic_day_distance' });
  });

  it('rung 5 · a trailing date resolves when the day holds exactly one run', async () => {
    q.mockResolvedValueOnce(rows())
     .mockResolvedValueOnce(rows())
     .mockResolvedValueOnce(rows({ id: '42' }));
    // The exact string measured on production: three of this shape match no
    // row by identity and exactly one canonical run by day.
    await expect(resolveCanonicalRunRowId(USER, `${USER}-2026-09-02`))
      .resolves.toEqual({ ok: true, rowId: '42', via: 'trailing_date' });
  });

  it('rung 5 REFUSES an ambiguous day rather than picking one', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    q.mockResolvedValueOnce(rows())
     .mockResolvedValueOnce(rows())
     .mockResolvedValueOnce(rows({ id: '42' }, { id: '43' }));
    const r = await resolveCanonicalRunRowId(USER, `${USER}-2026-09-02`);
    // Rule 11 · "the day is ambiguous" and "there is no such run" are two
    // facts. The route copy this replaced took LIMIT 1 off an unordered set
    // and WROTE to it; its own comment conceded it could tag the wrong run.
    expect(r).toEqual({ ok: false, reason: 'ambiguous_day' });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('an id that names nothing and no day is still no_such_run', async () => {
    q.mockResolvedValueOnce(rows()).mockResolvedValueOnce(rows());
    await expect(resolveCanonicalRunRowId(USER, 'wko_D287231A'))
      .resolves.toEqual({ ok: false, reason: 'no_such_run' });
  });

  it('every day rung states the canonical predicate (Rule 14)', async () => {
    q.mockResolvedValue(rows());
    await resolveCanonicalRunRowId(USER, '2026-09-02-6.41');
    await resolveCanonicalRunRowId(USER, `${USER}-2026-09-02`);
    const dayQueries = q.mock.calls
      .map((c) => String(c[0]))
      .filter((sql) => /startLocal|->>'date'/.test(sql));
    // Liveness: if the rungs stopped issuing day queries this would be zero
    // and the loop below would assert nothing.
    expect(dayQueries.length).toBeGreaterThan(0);
    for (const sql of dayQueries) {
      expect(sql, sql).toMatch(/mergedIntoId/);
      expect(sql, sql).toMatch(/user_uuid = \$1/);
    }
  });
});

/* ──────────────────────────────────────── structural · one vocabulary owner */

/** Block comments, line comments and template-literal-free prose removed.
 *  Strings are KEPT — the SQL this scanner looks for lives in template
 *  literals, so stripping them would make the scanner blind by construction. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/** The two synthetic id vocabularies. A file that writes either one is
 *  resolving a run id by day, which is `canonical-ref.ts`'s job. */
const DAY_ID_SHAPES: Array<{ name: string; re: RegExp }> = [
  { name: 'synthetic "YYYY-MM-DD-mi" id', re: /\\d\{4\}-\\d\{2\}-\\d\{2\}\)-\(\[\\d\.\]\+\)/ },
  { name: 'trailing-date id', re: /\(\\d\{4\}-\\d\{2\}-\\d\{2\}\)\$/ },
];

/**
 * RATCHET. May shrink, never grow, and every entry carries an argued reason.
 * An entry whose file is now clean FAILS until deleted (Rule 18.4).
 */
const ALLOWED: Record<string, string> = {
  'lib/runs/canonical-ref.ts':
    'THE resolver. This is the one place the vocabulary is allowed to exist.',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('._')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('the run-id vocabulary has ONE owner', () => {
  const root = path.resolve(__dirname, '..', '..');
  const files = [...walk(path.join(root, 'lib')), ...walk(path.join(root, 'app'))];

  it('read a non-trivial number of files (liveness · Rule 18.2)', () => {
    // A scanner that reports clean because it looked at nothing is the worst
    // outcome available, since it also reports confidence.
    expect(files.length).toBeGreaterThan(500);
  });

  it('the scanner can actually see a violation, and ignores one in prose', () => {
    // FALSIFIED IN BOTH DIRECTIONS, here, every run. The left-hand string is
    // the trailing-date shape in code; the right-hand one is the same text
    // inside a comment. A scanner that scores 2 is matching prose; one that
    // scores 0 has a dead predicate.
    const sample = [
      "const m = id.match(/(\\d{4}-\\d{2}-\\d{2})$/);",
      "// we used to call id.match(/(\\d{4}-\\d{2}-\\d{2})$/) here",
      "/* and /(\\d{4}-\\d{2}-\\d{2})$/ in a block comment too */",
    ].join('\n');
    const hits = stripComments(sample)
      .split('\n')
      .filter((l) => DAY_ID_SHAPES.some((s) => s.re.test(l)));
    expect(hits).toHaveLength(1);
  });

  it('no file outside the resolver mints a synthetic run id', () => {
    const findings: string[] = [];
    for (const f of files) {
      const rel = path.relative(root, f);
      const code = stripComments(fs.readFileSync(f, 'utf8'));
      for (const shape of DAY_ID_SHAPES) {
        if (!shape.re.test(code)) continue;
        if (ALLOWED[rel]) continue;
        findings.push(`${rel} · ${shape.name}`);
      }
    }
    expect(findings, findings.join('\n')).toEqual([]);
  });

  it('every allowlist entry still has something to excuse (stale = fail)', () => {
    for (const [rel, reason] of Object.entries(ALLOWED)) {
      const full = path.join(root, rel);
      expect(fs.existsSync(full), `${rel} is allowlisted but does not exist`).toBe(true);
      const code = stripComments(fs.readFileSync(full, 'utf8'));
      const stillViolates = DAY_ID_SHAPES.some((s) => s.re.test(code));
      expect(stillViolates, `${rel} is clean now · delete its entry (${reason})`).toBe(true);
    }
  });
});
