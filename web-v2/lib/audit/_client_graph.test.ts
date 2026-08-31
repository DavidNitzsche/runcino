/**
 * lib/audit/_client_graph.test.ts · the client-graph gate, and the proof it can fail.
 *
 * Rule 18: a gate is not trusted until it has been made to fail. Every guard
 * below that asserts the tree is clean is paired with a PLANTED DEFECT that the
 * same code path must report — because "no violations found" is worth exactly
 * nothing from a scanner that cannot find one.
 *
 * The controls are built as real files in a temp directory rather than as
 * strings handed to a parser, so they exercise the walk, the resolver and the
 * traversal, not just the regex. A gate tested only at its narrowest layer is
 * how `check-modelled-mark.sh` came to scan zero files and report clean.
 *
 *   GUARD 0 · liveness — the scan read a real number of real files
 *   GUARD 1 · the live tree has no client → server-only path
 *   GUARD 2 · POSITIVE CONTROL · the incident chain, rebuilt, must be named
 *   GUARD 3 · NEGATIVE CONTROLS · the four shapes that must NOT fire
 *   GUARD 4 · the exemption ratchet
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  analyseClientGraph,
  formatViolation,
  hasUseClientDirective,
  CLIENT_GRAPH_FLOORS,
  CLIENT_GRAPH_EXEMPTIONS,
  SERVER_ONLY_PACKAGES,
  type ClientGraphExemption,
} from './client-graph';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

/** Build a throwaway repo whose shape matches ours: `<root>/web-v2/<dirs>`. */
function fixture(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'client-graph-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, 'web-v2', rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, 'utf8');
  }
  return root;
}

const FIXTURE_DIRS = ['web-v2/components', 'web-v2/lib'];

// ── GUARD 0 · liveness ──────────────────────────────────────────────────────
//
// A scanner states how many files it read and fails on zero. This repo has
// shipped a gate that created the directory it audited and then reported
// clean; these floors are what stop the same outcome here.
describe('GUARD 0 · the scan is alive', () => {
  const report = analyseClientGraph(REPO_ROOT);

  it('read a real number of source files', () => {
    expect(report.filesScanned).toBeGreaterThanOrEqual(CLIENT_GRAPH_FLOORS.filesScanned);
  });

  it('found the client entry points', () => {
    expect(report.clientEntries.length).toBeGreaterThanOrEqual(CLIENT_GRAPH_FLOORS.clientEntries);
    // The entry the incident started from, by name. If this component is
    // renamed the gate should be updated deliberately, not silently lose it.
    expect(report.clientEntries).toContain('web-v2/components/faff-app/Shell.tsx');
  });

  it('found the server-only modules it is hunting for', () => {
    expect(report.serverSeeds.length).toBeGreaterThanOrEqual(CLIENT_GRAPH_FLOORS.serverSeeds);
    expect(report.serverSeeds).toContain('web-v2/lib/db/pool.ts');
  });

  it('resolved a real number of edges', () => {
    expect(report.edgesResolved).toBeGreaterThanOrEqual(CLIENT_GRAPH_FLOORS.edgesResolved);
  });

  it('a scan that reads nothing produces nothing — so the floors above are the guard', () => {
    const empty = analyseClientGraph(fixture({ 'components/.keep': '' }), FIXTURE_DIRS);
    expect(empty.filesScanned).toBe(0);
    expect(empty.clientEntries).toHaveLength(0);
    expect(empty.violations).toHaveLength(0);
    // …and that clean-looking result would not clear the live floors.
    expect(empty.filesScanned).toBeLessThan(CLIENT_GRAPH_FLOORS.filesScanned);
  });
});

// ── GUARD 1 · the live tree ─────────────────────────────────────────────────
describe('GUARD 1 · no client entry point reaches a server-only module', () => {
  const report = analyseClientGraph(REPO_ROOT);

  it('reports zero violations', () => {
    const printed = report.violations.map(formatViolation);
    expect(printed, `client bundle reaches the server:\n  ${printed.join('\n  ')}`).toEqual([]);
  });
});

// ── GUARD 2 · POSITIVE CONTROL ──────────────────────────────────────────────
//
// The incident, rebuilt from its own commit message. If this ever passes
// without a finding, the gate has stopped working and guard 1's silence means
// nothing.
describe('GUARD 2 · the planted defect is caught, with its path', () => {
  const INCIDENT = {
    'components/Shell.tsx': `'use client';\nimport { ProfileView } from './ProfileView';\nexport const Shell = () => ProfileView();\n`,
    'components/ProfileView.tsx': `import { LTHR_RETEST_CADENCE_DAYS } from '@/lib/training/lthr-reanchor';\nexport const ProfileView = () => LTHR_RETEST_CADENCE_DAYS;\n`,
    // Pure at the top, exactly as the real one was.
    'lib/training/lthr-reanchor.ts': `import { lthrFromRace } from './lthr';\nexport const LTHR_RETEST_CADENCE_DAYS = 84;\nexport const reanchor = () => lthrFromRace();\n`,
    // The database arrives through a DYNAMIC import, three hops in.
    'lib/training/lthr.ts': `export async function lthrFromRace() {\n  const { pool } = await import('@/lib/db/pool');\n  return pool;\n}\n`,
    'lib/db/pool.ts': `import { Pool } from 'pg';\nexport const pool = new Pool();\n`,
  };

  const report = analyseClientGraph(fixture(INCIDENT), FIXTURE_DIRS);

  it('fires', () => {
    expect(report.violations.length).toBeGreaterThan(0);
  });

  it('names the ENTRY, not the module that happens to hold the import', () => {
    expect(report.violations[0].entry).toBe('web-v2/components/Shell.tsx');
  });

  it('prints the full path, because "Shell imports the database" is not actionable', () => {
    const printed = formatViolation(report.violations[0]);
    expect(printed).toContain('components/Shell.tsx');
    expect(printed).toContain('components/ProfileView.tsx');
    expect(printed).toContain('lib/training/lthr-reanchor.ts');
    expect(printed).toContain('lib/training/lthr.ts');
    expect(printed).toContain('lib/db/pool.ts');
  });

  it('walks the TRANSITIVE closure — a one-hop check stops at lthr-reanchor and sees nothing', () => {
    // Four modules of chain before the terminal. One hop from the entry is
    // ProfileView; two is lthr-reanchor, whose own header claimed purity.
    expect(report.violations[0].chain.length).toBeGreaterThanOrEqual(4);
  });

  it('follows the DYNAMIC edge — the whole reason this was invisible', () => {
    const v = report.violations[0];
    expect(v.viaDynamicImport).toBe(true);
    expect(v.terminal).toBe('web-v2/lib/db/pool.ts');
  });

  it('catches a bare node builtin too, not only the database', () => {
    const r = analyseClientGraph(fixture({
      'components/Widget.tsx': `'use client';\nimport { readIt } from '@/lib/util/disk';\nexport const W = readIt;\n`,
      'lib/util/disk.ts': `import fs from 'node:fs';\nexport const readIt = () => fs.readFileSync('x');\n`,
    }), FIXTURE_DIRS);
    expect(r.violations.map((v) => v.terminal)).toContain('node:fs');
    expect(r.violations[0].kind).toBe('builtin');
  });

  it('catches every server-only package it declares', () => {
    for (const pkg of SERVER_ONLY_PACKAGES) {
      const r = analyseClientGraph(fixture({
        'components/W.tsx': `'use client';\nimport { x } from '@/lib/leaf';\nexport const W = x;\n`,
        'lib/leaf.ts': `import x from '${pkg}';\nexport { x };\n`,
      }), FIXTURE_DIRS);
      expect(r.violations.map((v) => v.terminal), `${pkg} not caught`).toContain(pkg);
    }
  });
});

// ── GUARD 3 · NEGATIVE CONTROLS ─────────────────────────────────────────────
//
// Each of these fired as a false positive at some point while building this
// gate, or would have. A gate that fails on correct code gets switched off.
describe('GUARD 3 · the shapes that must NOT fire', () => {
  it('a type-only import is erased by tsc and is not a bundled edge', () => {
    const r = analyseClientGraph(fixture({
      'components/W.tsx': `'use client';\nimport type { PoolClient } from 'pg';\nexport const W = (c: PoolClient) => c;\n`,
    }), FIXTURE_DIRS);
    expect(r.violations).toEqual([]);
  });

  it('an all-inline-type brace clause is erased on the same terms', () => {
    const r = analyseClientGraph(fixture({
      'components/W.tsx': `'use client';\nimport { type PoolClient, type Pool } from 'pg';\nexport type W = [PoolClient, Pool];\n`,
    }), FIXTURE_DIRS);
    expect(r.violations).toEqual([]);
  });

  it("TypeScript's import-TYPE syntax is not a dynamic import", () => {
    // This produced all ten findings on the first live run of the gate.
    // `components/faff-app/constants.ts` annotates one field this way and
    // every client view imports it.
    const r = analyseClientGraph(fixture({
      'components/W.tsx': `'use client';\nimport { SHAPE } from '@/lib/shape';\nexport const W = SHAPE;\n`,
      'lib/shape.ts': `export const SHAPE = { kind: null as import('@/lib/coach/info').Kind | null };\n`,
      'lib/coach/info.ts': `import { pool } from '@/lib/db/pool';\nexport type Kind = 'a';\nexport const q = () => pool;\n`,
      'lib/db/pool.ts': `import { Pool } from 'pg';\nexport const pool = new Pool();\n`,
    }), FIXTURE_DIRS);
    expect(r.violations.map(formatViolation)).toEqual([]);
  });

  it('a database import inside a COMMENT is prose, not an edge', () => {
    // Non-negotiable here: the header of `lthr-reanchor.ts`, the commit that
    // fixed the incident, and `client-graph.ts` itself all contain the literal
    // text below. Without comment-stripping the gate reports the files that
    // DOCUMENT the bug as committing it.
    const r = analyseClientGraph(fixture({
      'components/W.tsx': `'use client';\n/**\n * Do not do this:\n *   const { pool } = await import('@/lib/db/pool');\n */\nimport { c } from '@/lib/clean';\nexport const W = c;\n`,
      'lib/clean.ts': `// import fs from 'node:fs';\nexport const c = 1;\n`,
      'lib/db/pool.ts': `import { Pool } from 'pg';\nexport const pool = new Pool();\n`,
    }), FIXTURE_DIRS);
    expect(r.violations.map(formatViolation)).toEqual([]);
  });

  it('a SERVER component may reach the database — that is its job', () => {
    const r = analyseClientGraph(fixture({
      'components/Page.tsx': `import { pool } from '@/lib/db/pool';\nexport default async function Page() { return pool; }\n`,
      'lib/db/pool.ts': `import { Pool } from 'pg';\nexport const pool = new Pool();\n`,
    }), FIXTURE_DIRS);
    expect(r.violations).toEqual([]);
  });

  it("'use client' in prose is not a directive", () => {
    expect(hasUseClientDirective(`/** a 'use client' component */\nexport const x = 1;\n`)).toBe(false);
    expect(hasUseClientDirective(`// mentions 'use client'\nimport x from 'y';\n`)).toBe(false);
    expect(hasUseClientDirective(`'use client';\nimport x from 'y';\n`)).toBe(true);
    expect(hasUseClientDirective(`/* c */\n\n"use client"\nimport x from 'y';\n`)).toBe(true);
  });

  it('node builtins that survive a browser bundle are deliberately not flagged', () => {
    const r = analyseClientGraph(fixture({
      'components/W.tsx': `'use client';\nimport path from 'node:path';\nimport crypto from 'crypto';\nexport const W = [path, crypto];\n`,
    }), FIXTURE_DIRS);
    expect(r.violations).toEqual([]);
  });
});

// ── GUARD 4 · the ratchet ───────────────────────────────────────────────────
describe('GUARD 4 · the exemption list is a ratchet', () => {
  it('every exemption carries an argued reason', () => {
    for (const x of CLIENT_GRAPH_EXEMPTIONS) {
      expect(x.entry, 'exemption without an entry').toBeTruthy();
      expect(x.reaches, `${x.entry}: exemption without a target`).toBeTruthy();
      expect(x.reason.length, `${x.entry}: reason too thin to be a reason`).toBeGreaterThan(30);
      expect(/we might need it|for now|todo/i.test(x.reason), `${x.entry}: not a reason`).toBe(false);
    }
  });

  it('no exemption is stale against the live tree', () => {
    const report = analyseClientGraph(REPO_ROOT);
    const stale = report.staleExemptions.map((x) => `${x.entry} → ${x.reaches}`);
    expect(stale, `exempted violations that no longer exist — delete them:\n  ${stale.join('\n  ')}`)
      .toEqual([]);
  });

  it('a stale exemption is REPORTED stale — the ratchet is checked, not assumed', () => {
    const planted: ClientGraphExemption = {
      entry: 'web-v2/components/NoSuchThing.tsx',
      reaches: 'pg',
      reason: 'planted by the gate test to prove staleness is actually detected',
    };
    CLIENT_GRAPH_EXEMPTIONS.push(planted);
    try {
      const r = analyseClientGraph(fixture({ 'components/W.tsx': `'use client';\nexport const W = 1;\n` }), FIXTURE_DIRS);
      expect(r.staleExemptions).toHaveLength(1);
      expect(r.staleExemptions[0].entry).toBe(planted.entry);
    } finally {
      CLIENT_GRAPH_EXEMPTIONS.splice(CLIENT_GRAPH_EXEMPTIONS.indexOf(planted), 1);
    }
  });

  it('an exemption suppresses ONLY its own pair, never the whole entry', () => {
    const files = {
      'components/W.tsx': `'use client';\nimport { a } from '@/lib/a';\nimport { b } from '@/lib/b';\nexport const W = [a, b];\n`,
      'lib/a.ts': `import x from 'pg';\nexport const a = x;\n`,
      'lib/b.ts': `import fs from 'node:fs';\nexport const b = fs;\n`,
    };
    const before = analyseClientGraph(fixture(files), FIXTURE_DIRS);
    expect(before.violations.map((v) => v.terminal).sort()).toEqual(['node:fs', 'pg']);

    const planted: ClientGraphExemption = {
      entry: 'web-v2/components/W.tsx',
      reaches: 'pg',
      reason: 'planted to prove one exemption does not switch off the other finding',
    };
    CLIENT_GRAPH_EXEMPTIONS.push(planted);
    try {
      const after = analyseClientGraph(fixture(files), FIXTURE_DIRS);
      // The OTHER violation still fires. An exemption that excused the whole
      // entry would be the `PACE.interval-offset` defect all over again.
      expect(after.violations.map((v) => v.terminal)).toEqual(['node:fs']);
    } finally {
      CLIENT_GRAPH_EXEMPTIONS.splice(CLIENT_GRAPH_EXEMPTIONS.indexOf(planted), 1);
    }
  });
});
