/**
 * lib/audit/_generated_content_gate.test.ts — the gate that fails when the app
 * authors something no surface reads.
 *
 * Sibling of `_doctrine_gate.test.ts`. That one stops a bad NUMBER reaching a
 * runner's legs; this one stops a good SENTENCE never reaching their eyes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * GUARD 0 IS THE MOST IMPORTANT ONE.
 *
 * "Make it refuse to pass if it scanned nothing — a scanner that opens no files
 * and reports clean is worse than no scanner." A path typo, a rename of
 * `web-v2/`, a `walk()` that throws and returns `[]`: every one of those makes
 * a content gate go green while checking zero bytes, and green is exactly the
 * state that let three unread columns ship. So guard 0 asserts floors on files
 * and statements AND runs positive controls — a column known to be both written
 * and read must resolve as such. If the controls fail, the extractor is broken
 * and every other guard's silence is meaningless.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  scanSql, readersOf, writersOf, ambiguousReadersOf, type ScanResult,
} from './sql-scan';
import { buildModuleGraph, findOrphans, findUncalledRoutes } from './module-graph';
import {
  GENERATED_CONTENT_REGISTRY,
  GENERATED_CONTENT_VOCAB,
  INFRASTRUCTURE_TABLES,
  MODULE_ORPHANS,
  ROUTE_CALLERS,
} from './generated-content-registry';

/** `web-v2/lib/audit` -> the checkout root. */
const REPO = path.resolve(__dirname, '../../..');

const SQL_DIRS = ['web-v2/app', 'web-v2/lib', 'web-v2/components', 'web-v2/scripts'];

/**
 * A "reader" for the purposes of this gate is code a runner's request can
 * reach. A diagnostic script and a test are not readers — a column read only
 * by `scripts/_david_dump.mjs` is exactly as unread as one read by nothing.
 */
function isSurfaceReader(file: string): boolean {
  if (file.includes('/scripts/')) return false;
  if (/\.(test|spec)\.tsx?$/.test(file)) return false;
  if (file.startsWith('web-v2/lib/audit/')) return false;   // this gate talks about columns for a living
  return true;
}

function surfaceReaders(scan: ScanResult, id: string): string[] {
  const [table, column] = id.split('.');
  return [...readersOf(scan, table, column)].filter(isSurfaceReader);
}

const scan = scanSql(REPO, SQL_DIRS);

describe('GUARD 0 · the scanner actually scanned something', () => {
  it('opened a plausible number of files', () => {
    // 996 at the time of writing. The floor is deliberately far below that and
    // far above zero: it catches "the tree moved" without breaking on a normal
    // week's churn.
    expect(scan.filesScanned).toBeGreaterThan(400);
  });

  it('found a plausible number of SQL statements', () => {
    // 1762 at the time of writing.
    expect(scan.literalsFound).toBeGreaterThan(300);
  });

  it('POSITIVE CONTROL · a column known to be written AND read resolves as both', () => {
    // plan_workouts.type is written by the generator and read by half the
    // coach layer. If this comes back empty the extractor is broken, and every
    // "no violations" below is a lie.
    expect(writersOf(scan, 'plan_workouts', 'type').size).toBeGreaterThan(0);
    expect(surfaceReaders(scan, 'plan_workouts.type').length).toBeGreaterThan(0);
  });

  it('POSITIVE CONTROL · multi-line SQL is parsed, not missed', () => {
    // The false positive this whole exercise nearly filed: SQL here spans
    // lines, so a line-oriented grep finds nothing and calls it a finding.
    // `plan_phases.rationale` is selected across four lines in
    // app/api/v5/today/route.ts.
    expect(surfaceReaders(scan, 'plan_phases.rationale'))
      .toContain('web-v2/app/api/v5/today/route.ts');
  });

  it('POSITIVE CONTROL · a qualified projection is attributed to its OWN table', () => {
    // The query that proves it: `SELECT pp.rationale FROM plan_weeks pw JOIN
    // plan_phases pp ON …`. An alias-blind scanner credits plan_weeks with a
    // reader it does not have — which is how plan_weeks.rationale hid.
    expect(surfaceReaders(scan, 'plan_weeks.rationale')).toEqual([]);
  });

  it('POSITIVE CONTROL · `SELECT *` is not counted as proof of a reader', () => {
    // Fetching a column into a row object nobody destructures is the failure
    // mode, not the fix. Several files SELECT * from plan_weeks.
    expect(scan.wildcardReads.get('plan_weeks')?.size ?? 0).toBeGreaterThan(0);
  });

  it('POSITIVE CONTROL · the registry is not empty', () => {
    expect(GENERATED_CONTENT_REGISTRY.length).toBeGreaterThan(20);
  });
});

describe('GUARD 1 · discovery · no prose column may be added silently', () => {
  it('every generated-vocabulary column that some INSERT/UPDATE writes is registered', () => {
    const registered = new Set(GENERATED_CONTENT_REGISTRY.map((e) => e.id));
    const missing: string[] = [];
    for (const [table, cols] of scan.writes) {
      if (INFRASTRUCTURE_TABLES.has(table)) continue;
      for (const [column] of cols) {
        if (!GENERATED_CONTENT_VOCAB.test(column)) continue;
        const id = `${table}.${column}`;
        if (!registered.has(id)) missing.push(id);
      }
    }
    expect(
      missing,
      missing.length === 0 ? '' :
        `\nUNREGISTERED GENERATED CONTENT:\n  ${missing.join('\n  ')}\n\n` +
        'Something now writes a column whose name says it holds authored content, and\n' +
        'nothing in lib/audit/generated-content-registry.ts says who reads it. Add an\n' +
        'entry with a verdict:\n' +
        "  'surfaced' — a runner sees it. Name the file that renders it and a token in it.\n" +
        "  'internal' — the engine or an operator reads it, never a runner. Say why.\n" +
        "  'exempt'   — genuinely unread. Say so honestly, and say what the open decision is.\n" +
        'Do not pick a verdict to make this pass. Unread content is a bug in one of two\n' +
        'directions: either the surface is missing or the writer is waste. Say which.',
    ).toEqual([]);
  });

  it('every registered column is still written by something', () => {
    // A stale entry is its own kind of lie — it says a reader exists for a
    // column nothing produces any more.
    const stale = GENERATED_CONTENT_REGISTRY.filter((e) => {
      const [table, column] = e.id.split('.');
      return writersOf(scan, table, column).size === 0
        && ambiguousReadersOf(scan, table, column).size === 0
        && readersOf(scan, table, column).size === 0;
    }).map((e) => e.id);
    expect(
      stale,
      stale.length === 0 ? '' :
        `\nREGISTRY ENTRIES FOR COLUMNS NOTHING TOUCHES:\n  ${stale.join('\n  ')}\n` +
        'The column was dropped or renamed. Delete the entry.',
    ).toEqual([]);
  });

  it('no duplicate ids', () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const e of GENERATED_CONTENT_REGISTRY) {
      if (seen.has(e.id)) dupes.push(e.id);
      seen.add(e.id);
    }
    expect(dupes).toEqual([]);
  });
});

describe('GUARD 2 · a `surfaced` column has a real SELECT reader', () => {
  for (const entry of GENERATED_CONTENT_REGISTRY.filter((e) => e.verdict === 'surfaced')) {
    it(`${entry.id}`, () => {
      const readers = surfaceReaders(scan, entry.id);
      expect(
        readers.length,
        readers.length > 0 ? '' :
          `\n${entry.id} is marked 'surfaced' and NO SELECT outside scripts and tests asks for it.\n` +
          `  holds: ${entry.holds}\n` +
          'Either wire it to the surface that should have it, or change the verdict and say\n' +
          'honestly why it is unread. A `SELECT *` does not count — fetching a column into a\n' +
          'row object nobody destructures is the bug, not the fix.',
      ).toBeGreaterThan(0);
    });
  }
});

describe('GUARD 3 · a `surfaced` column names a file that renders it', () => {
  for (const entry of GENERATED_CONTENT_REGISTRY.filter((e) => e.verdict === 'surfaced')) {
    it(`${entry.id}`, () => {
      expect(entry.surface, `${entry.id} is 'surfaced' but names no surface file`).toBeTruthy();
      const abs = path.join(REPO, entry.surface!.file);
      expect(fs.existsSync(abs), `${entry.id} names a surface that does not exist: ${entry.surface!.file}`).toBe(true);
      const src = fs.readFileSync(abs, 'utf8');
      expect(
        src.includes(entry.surface!.token),
        `\n${entry.id} · the token '${entry.surface!.token}' is no longer in ${entry.surface!.file}.\n` +
        'The surface stopped reading it, or the code moved. Re-point the entry at the file\n' +
        'that renders it now — do NOT drop the token to make this pass.',
      ).toBe(true);
    });
  }
});

describe('GUARD 4 · `internal` and `exempt` carry an honest reason', () => {
  for (const entry of GENERATED_CONTENT_REGISTRY.filter((e) => e.verdict !== 'surfaced')) {
    it(`${entry.id} · has a reason`, () => {
      expect((entry.reason ?? '').trim().length, `${entry.id} needs a reason`).toBeGreaterThan(40);
    });
  }

  it('an `internal` column really is read by the engine', () => {
    const unread = GENERATED_CONTENT_REGISTRY
      .filter((e) => e.verdict === 'internal')
      .filter((e) => surfaceReaders(scan, e.id).length === 0)
      .map((e) => e.id);
    expect(
      unread,
      unread.length === 0 ? '' :
        `\nMARKED 'internal' BUT NOTHING READS IT:\n  ${unread.join('\n  ')}\n` +
        "'internal' means the engine or an operator reads it. If nothing does, the verdict\n" +
        "is 'exempt' and the reason has to say the column is unread.",
    ).toEqual([]);
  });

  it('STALENESS · an `exempt` column that gained a reader must lose its exemption', () => {
    const fixed = GENERATED_CONTENT_REGISTRY
      .filter((e) => e.verdict === 'exempt')
      .filter((e) => surfaceReaders(scan, e.id).length > 0)
      .map((e) => `${e.id} (now read by ${surfaceReaders(scan, e.id).join(', ')})`);
    expect(
      fixed,
      fixed.length === 0 ? '' :
        `\nEXEMPTIONS THAT ARE NO LONGER TRUE:\n  ${fixed.join('\n  ')}\n` +
        "Someone wired it. Change the verdict to 'surfaced', name the file that renders it,\n" +
        'and delete the exemption reason.',
    ).toEqual([]);
  });
});

// Callers are SURFACES: the web app, the phone, the watch, and CI. A
// diagnostic script that pokes a route is not a caller.
const UNCALLED_ROUTES = findUncalledRoutes(REPO, 'web-v2/app/api', [
  'web-v2/app', 'web-v2/lib', 'web-v2/components',
  'native-v2/Faff', 'legacy/native', '.github',
]);

describe('GUARD 5 · a module with no caller is named and reasoned', () => {
  const graph = buildModuleGraph(REPO, SQL_DIRS);
  // A route nothing calls is not a live root. Without this, block-preview.ts
  // reads as "imported by its route" and the module it strands reads as
  // "imported by block-preview", and instance 3 stays invisible.
  const deadRoots = new Set(UNCALLED_ROUTES);
  const orphansOf = () => findOrphans(graph, ['web-v2/lib/', 'web-v2/components/'], deadRoots);

  it('POSITIVE CONTROL · the import graph resolved something', () => {
    expect(graph.files.length).toBeGreaterThan(400);
    const edges = [...graph.imports.values()].reduce((a, s) => a + s.size, 0);
    expect(edges).toBeGreaterThan(500);
  });

  it('every orphan is in MODULE_ORPHANS with a reason', () => {
    const unexplained = orphansOf()
      .filter((o) => !(o.file in MODULE_ORPHANS))
      .map((o) => `${o.file}  [${o.kind}]`);
    expect(
      unexplained,
      unexplained.length === 0 ? '' :
        `\nMODULES NOTHING IMPORTS:\n  ${unexplained.join('\n  ')}\n\n` +
        'This is the lib/plan/block-preview.ts shape: a module built to answer something,\n' +
        'with a test proving it answers it, and no caller. Either wire it, delete it, or add\n' +
        'it to MODULE_ORPHANS with an honest reason. A gate or a fixture set is a fine\n' +
        'reason. "We might need it" is not.',
    ).toEqual([]);
  });

  it('STALENESS · a listed orphan that gained an importer must leave the list', () => {
    const orphans = new Set(orphansOf().map((o) => o.file));
    const stale = Object.keys(MODULE_ORPHANS).filter((f) => {
      if (!fs.existsSync(path.join(REPO, f))) return false;  // deleted · handled below
      return !orphans.has(f);
    });
    expect(
      stale,
      stale.length === 0 ? '' :
        `\nNO LONGER ORPHANED:\n  ${stale.join('\n  ')}\nDelete these entries from MODULE_ORPHANS.`,
    ).toEqual([]);
  });

  it('a listed orphan that was deleted must leave the list', () => {
    const gone = Object.keys(MODULE_ORPHANS).filter((f) => !fs.existsSync(path.join(REPO, f)));
    expect(gone, gone.length === 0 ? '' : `\nDELETED FILES STILL LISTED:\n  ${gone.join('\n  ')}`).toEqual([]);
  });
});

describe('GUARD 6 · an API route with no caller is named and reasoned', () => {
  const uncalled = UNCALLED_ROUTES;

  it('POSITIVE CONTROL · route discovery found routes and did not call them all dead', () => {
    const all = fs.existsSync(path.join(REPO, 'web-v2/app/api'));
    expect(all).toBe(true);
    // If EVERY route came back uncalled the caller scan is broken.
    expect(uncalled.length).toBeLessThan(60);
  });

  it('POSITIVE CONTROL · a route the Swift client fetches is not reported dead', () => {
    // API.swift builds paths WITHOUT a leading slash — appendingPathComponent
    // ("api/targets/projection"). A '/api/'-anchored scan calls about fifteen
    // live routes dead, so this control is load-bearing.
    expect(uncalled).not.toContain('web-v2/app/api/targets/projection/route.ts');
    expect(uncalled).not.toContain('web-v2/app/api/readiness/brief/route.ts');
  });

  it('POSITIVE CONTROL · every cron route is invoked by a workflow', () => {
    // A cron with no schedule is a job that never runs. Bare curl targets in
    // .github are unquoted and end in `)`, which the scanner has to survive.
    const crons = uncalled.filter((r) => r.startsWith('web-v2/app/api/cron/'));
    expect(
      crons,
      crons.length === 0 ? '' :
        `\nCRON ROUTES WITH NO WORKFLOW:\n  ${crons.join('\n  ')}\n` +
        'Either .github/workflows lost the schedule, or the route is dead.',
    ).toEqual([]);
  });

  it('every uncalled route is in ROUTE_CALLERS with a reason', () => {
    const unexplained = uncalled
      // Admin routes are operator-invoked by hand and always have been.
      .filter((r) => !r.startsWith('web-v2/app/api/admin/'))
      .filter((r) => !(r in ROUTE_CALLERS));
    expect(
      unexplained,
      unexplained.length === 0 ? '' :
        `\nAPI ROUTES NO SURFACE CALLS:\n  ${unexplained.join('\n  ')}\n\n` +
        'Nothing in the web app, the phone, the watch or CI fetches these. Wire the caller,\n' +
        'delete the route, or add it to ROUTE_CALLERS with an honest reason.',
    ).toEqual([]);
  });

  it('STALENESS · a listed route that gained a caller must leave the list', () => {
    const set = new Set(uncalled);
    const stale = Object.keys(ROUTE_CALLERS)
      .filter((r) => fs.existsSync(path.join(REPO, r)))
      .filter((r) => !set.has(r));
    expect(
      stale,
      stale.length === 0 ? '' :
        `\nNO LONGER UNCALLED:\n  ${stale.join('\n  ')}\nDelete these entries from ROUTE_CALLERS.`,
    ).toEqual([]);
  });
});
