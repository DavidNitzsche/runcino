/**
 * lib/audit/client-graph.ts · nothing a browser downloads may reach the database.
 *
 * ── THE INCIDENT ───────────────────────────────────────────────────────────
 *
 * `main` did not deploy for a full day. Five merged commits — a marathon
 * block's worth of engine fixes and the LTHR re-anchor the runner's HR caps
 * are computed from — sat unshipped while every check reported green, because
 * the break was not in any of them:
 *
 *     components/faff-app/Shell.tsx           'use client'
 *       → views/ProfileView.tsx:18            imports one CONSTANT
 *         → lib/training/lthr-reanchor.ts:90  imports lthrFromRace
 *           → lib/training/lthr.ts:180        await import('@/lib/db/pool')
 *             → pg → fs · dns · net · tls
 *
 * `tsc --noEmit` passed. All twelve prebuild gates passed. `next build` runs
 * AFTER them, and it was the only thing that could see it — so the failure
 * surfaced hours later on Railway, in a place nobody was watching.
 *
 * Two properties of that chain are the whole design of this file:
 *
 *   · THE EDGE WAS DYNAMIC. `await import('@/lib/db/pool')` is invisible to a
 *     human reading `lthr.ts`'s import block, and it is invisible to any graph
 *     walk that follows only static imports. It is still a bundled edge —
 *     webpack must resolve it to split the chunk. A gate that skipped it would
 *     have reported this exact file clean.
 *
 *   · THE EDGE WAS THREE HOPS DEEP. `ProfileView` imports `lthr-reanchor`,
 *     which is where a one-hop check stops and reports nothing. The database
 *     is two modules further on.
 *
 * ── THE COMMENT THAT LIED ──────────────────────────────────────────────────
 *
 * `lthr-reanchor.ts` asserted in its own header that it "is PURE and imports
 * no database at any depth, so a client bundle can read
 * LTHR_RETEST_CADENCE_DAYS from it". That was the author's intent, it was
 * false, and nothing in the repo could tell. Rule 18 exists for precisely this
 * shape: a claim in a comment that no check verifies is a hypothesis wearing a
 * guarantee's clothes. This module is that claim, made executable, for every
 * client entry point at once.
 *
 * ── WHAT COUNTS AS SERVER-ONLY ─────────────────────────────────────────────
 *
 * A module is a SEED if it is under `lib/db/`, or carries a non-type-only
 * import of a database driver, a server-only Next primitive, or a node builtin
 * that has no browser meaning. A module VIOLATES if any seed sits in its
 * transitive closure. The report names the path, never just the file, because
 * "ProfileView imports the database" sends you looking in the wrong file.
 *
 * ── WHY TYPE-ONLY EDGES ARE NOT EDGES ──────────────────────────────────────
 *
 * TypeScript erases `import type { PoolClient } from 'pg'` before webpack ever
 * sees it. Fourteen modules here carry that import, `lib/plan/generate.ts`
 * among them. Counting erased imports as bundled edges would paint most of the
 * engine as a database and make this gate noise, which is how a gate stops
 * being read. Inline `import { type A, type B }` is erased on the same terms.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseImportEdges, stripComments, walkSourceFiles } from './module-graph';

/**
 * Packages that cannot exist in a browser bundle.
 *
 * `server-only` is the package whose entire purpose is to throw at build time
 * if a client imports it; if it is in the client graph, that is the answer.
 * `next/headers` reads the request — a client component importing it is a hard
 * Next.js error. `next/server` belongs to route handlers and middleware.
 */
export const SERVER_ONLY_PACKAGES = [
  'pg',
  'pg-native',
  'server-only',
  'next/headers',
  'next/server',
] as const;

/**
 * Node builtins with no browser meaning. `fs`, `net`, `dns` and `tls` are the
 * four the incident's build actually died on.
 *
 * DELIBERATELY ABSENT: `path`, `crypto`, `buffer`, `util`, `events`, `stream`,
 * `url`, `assert`, `process`. Those are either polyfilled or isomorphic in a
 * webpack browser build, so flagging them would fail builds that work. This
 * list is the set where a hit is a certainty, not a suspicion — a gate that
 * cries wolf gets switched off, and a switched-off gate is what let the
 * incident happen.
 */
export const SERVER_ONLY_BUILTINS = [
  'fs', 'fs/promises', 'net', 'dns', 'dns/promises', 'tls',
  'child_process', 'cluster', 'dgram', 'http', 'https', 'http2',
  'worker_threads', 'module', 'v8', 'vm', 'inspector', 'readline',
  'os', 'tty', 'repl', 'zlib', 'async_hooks', 'perf_hooks',
] as const;

/** Directories whose every module is server-only by location. */
export const SERVER_ONLY_DIRS = ['web-v2/lib/db/'] as const;

/**
 * LIVENESS FLOORS · a scanner that read nothing must never report clean.
 *
 * This repo has shipped a gate that ran `mkdir -p` on the tree it audited and
 * then passed, and another whose tamper-check any comment satisfied. These are
 * the numbers that make "I found no violations" mean something. They are floors
 * well under the live counts, not equalities — they fail a gutted scan, not a
 * deleted component.
 */
export const CLIENT_GRAPH_FLOORS = {
  /** 81 `'use client'` files at the time of writing. */
  clientEntries: 50,
  /** 1009 source files under app/ components/ lib/. */
  filesScanned: 700,
  /** Modules that ARE server-only. If this hits zero the classifier broke. */
  serverSeeds: 20,
  /** Resolved non-type-only edges. A walk that resolved nothing sees nothing. */
  edgesResolved: 1500,
} as const;

export interface ClientGraphExemption {
  /** Repo-relative `'use client'` entry point. */
  entry: string;
  /** The terminal server-only specifier this entry is permitted to reach. */
  reaches: string;
  /** Why this is tolerable. "We might need it" is not a reason. */
  reason: string;
}

/**
 * THE RATCHET. It may shrink and never grow, every entry carries an argued
 * reason, and an entry whose violation no longer exists FAILS until it is
 * deleted — so fixing the code forces the exemption out rather than leaving a
 * hole nobody remembers opening.
 *
 * Empty at introduction: the tree was clean when this gate was built, which is
 * the only honest starting point for a ratchet.
 */
export const CLIENT_GRAPH_EXEMPTIONS: ClientGraphExemption[] = [];

export interface ClientGraphViolation {
  /** The `'use client'` file that starts the chain. */
  entry: string;
  /** entry → … → the module holding the offending import, repo-relative. */
  chain: string[];
  /** The specifier that ends it: `pg`, `node:fs`, `@/lib/db/pool`. */
  terminal: string;
  /** Why the terminal is server-only. */
  kind: 'package' | 'builtin' | 'dir';
  /** True when the last edge was `await import(…)` / `require(…)`. */
  viaDynamicImport: boolean;
}

export interface ClientGraphReport {
  violations: ClientGraphViolation[];
  /** Exemptions that matched nothing this run. Each one is a failure. */
  staleExemptions: ClientGraphExemption[];
  clientEntries: string[];
  serverSeeds: string[];
  filesScanned: number;
  edgesResolved: number;
}

/** `'use client'`, as a directive: before any statement, comments allowed. */
export function hasUseClientDirective(src: string): boolean {
  const head = stripComments(src).replace(/^﻿/, '').trimStart();
  return /^['"]use client['"]\s*;?/.test(head);
}

function normaliseBuiltin(spec: string): string {
  return spec.startsWith('node:') ? spec.slice(5) : spec;
}

/** Is this specifier a server-only PACKAGE or BUILTIN (not one of ours)? */
function classifySpecifier(spec: string): 'package' | 'builtin' | null {
  if ((SERVER_ONLY_PACKAGES as readonly string[]).includes(spec)) return 'package';
  const bare = normaliseBuiltin(spec);
  if ((SERVER_ONLY_BUILTINS as readonly string[]).includes(bare)) return 'builtin';
  // `node:`-prefixed anything is a node builtin by construction; the prefix
  // cannot be a package name. Only flag it if the bare name is on the list,
  // which the line above already did — this keeps `node:path` unflagged.
  return null;
}

function isServerOnlyDir(rel: string): boolean {
  return SERVER_ONLY_DIRS.some((d) => rel.startsWith(d));
}

/**
 * Walk every `'use client'` entry point's transitive closure and report every
 * one that reaches a server-only module.
 *
 * Breadth-first, so a reported chain is the SHORTEST route from the entry to
 * the database — the one whose links a reader can actually follow. One
 * violation per (entry, terminal) pair: repeating the same `pg` for forty
 * modules under one entry buries the finding rather than making it.
 */
export function analyseClientGraph(
  repoRoot: string,
  dirs: string[] = ['web-v2/app', 'web-v2/components', 'web-v2/lib'],
): ClientGraphReport {
  const webRoot = path.join(repoRoot, 'web-v2');
  const absFiles = dirs.flatMap((d) => walkSourceFiles(path.join(repoRoot, d)));
  const rel = (p: string) => path.relative(repoRoot, p);

  interface Node {
    /** Resolved, in-repo, non-type-only edges. */
    deps: { to: string; dynamic: boolean }[];
    /** Server-only specifiers this module imports directly. */
    seeds: { spec: string; kind: 'package' | 'builtin'; dynamic: boolean }[];
    isClientEntry: boolean;
  }

  const nodes = new Map<string, Node>();
  let edgesResolved = 0;

  for (const abs of absFiles) {
    const relPath = rel(abs);
    if (relPath.endsWith('.d.ts')) continue;
    let src: string;
    try { src = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    const node: Node = { deps: [], seeds: [], isClientEntry: hasUseClientDirective(src) };
    for (const e of parseImportEdges(src, abs, webRoot)) {
      if (e.typeOnly) continue;
      if (e.resolvedAbs) {
        node.deps.push({ to: rel(e.resolvedAbs), dynamic: e.dynamic });
        edgesResolved++;
        continue;
      }
      const kind = classifySpecifier(e.spec);
      if (kind) node.seeds.push({ spec: e.spec, kind, dynamic: e.dynamic });
    }
    nodes.set(relPath, node);
  }

  const clientEntries = [...nodes].filter(([, n]) => n.isClientEntry).map(([f]) => f).sort();
  const serverSeeds = [...nodes]
    .filter(([f, n]) => n.seeds.length > 0 || isServerOnlyDir(f))
    .map(([f]) => f)
    .sort();

  const violations: ClientGraphViolation[] = [];

  for (const entry of clientEntries) {
    // (entry, terminal) pairs already reported, so one `pg` is one finding.
    const reported = new Set<string>();
    const prev = new Map<string, string>();
    const seen = new Set<string>([entry]);
    const queue: string[] = [entry];

    const chainTo = (file: string): string[] => {
      const out = [file];
      let cur = file;
      while (prev.has(cur)) { cur = prev.get(cur)!; out.push(cur); }
      return out.reverse();
    };

    while (queue.length > 0) {
      const cur = queue.shift()!;
      const node = nodes.get(cur);
      if (!node) continue;

      for (const s of node.seeds) {
        if (reported.has(s.spec)) continue;
        reported.add(s.spec);
        violations.push({
          entry,
          chain: chainTo(cur),
          terminal: s.spec,
          kind: s.kind,
          viaDynamicImport: s.dynamic,
        });
      }

      for (const dep of node.deps) {
        if (isServerOnlyDir(dep.to)) {
          if (!reported.has(dep.to)) {
            reported.add(dep.to);
            violations.push({
              entry,
              chain: chainTo(cur),
              terminal: dep.to,
              kind: 'dir',
              viaDynamicImport: dep.dynamic,
            });
          }
          // Do not traverse INTO lib/db. The finding is the edge; walking on
          // would re-report `pg` under a second name for the same defect.
          continue;
        }
        if (seen.has(dep.to)) continue;
        seen.add(dep.to);
        prev.set(dep.to, cur);
        queue.push(dep.to);
      }
    }
  }

  violations.sort((a, b) =>
    a.entry.localeCompare(b.entry) || a.terminal.localeCompare(b.terminal));

  const isExempt = (v: ClientGraphViolation) =>
    CLIENT_GRAPH_EXEMPTIONS.some((x) => x.entry === v.entry && x.reaches === v.terminal);
  const staleExemptions = CLIENT_GRAPH_EXEMPTIONS.filter(
    (x) => !violations.some((v) => v.entry === x.entry && v.terminal === x.reaches));

  return {
    violations: violations.filter((v) => !isExempt(v)),
    staleExemptions,
    clientEntries,
    serverSeeds,
    filesScanned: nodes.size,
    edgesResolved,
  };
}

/** `entry → hop → hop → pg`, the form the incident's own commit message used. */
export function formatViolation(v: ClientGraphViolation): string {
  const arrow = v.viaDynamicImport ? ' ⇢(dynamic) ' : ' → ';
  return [...v.chain].join(' → ') + arrow + v.terminal;
}
