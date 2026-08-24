/**
 * lib/audit/module-graph.ts — who imports what, resolved properly.
 *
 * The code half of the same defect the SQL scanner covers. `lib/plan/
 * block-preview.ts` is the worked example: a module with a doc comment, a test
 * file and an API route, written on 2026-08-18 to answer a question the runner
 * had actually asked — what shape is the next block — and imported by nothing
 * but itself. Its own upstream dependency carries the comment `// Exported for
 * lib/plan/block-preview.ts`, documenting a consumer that nothing consumes.
 *
 * WHY A REAL RESOLVER AND NOT A GREP
 *
 * Route paths and module names appear constantly inside doc comments. Three
 * separate files name `app/api/race/[slug]/block-preview/route.ts` in prose,
 * and a grep counts every one of them as a caller. Only a resolved import edge
 * counts here, and only string literals count as fetch call sites.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface ModuleGraph {
  /** Every module file found, repo-relative. */
  files: string[];
  /** importer -> resolved import targets (repo-relative). */
  imports: Map<string, Set<string>>;
  /** target -> importers (repo-relative). */
  importedBy: Map<string, Set<string>>;
}

const SOURCE_EXT = ['.ts', '.tsx', '.mts', '.mjs', '.js', '.jsx'];

function walk(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.next' || e.name === '.git') continue;
    if (e.name.startsWith('._')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (SOURCE_EXT.includes(path.extname(e.name))) out.push(p);
  }
  return out;
}

/** Resolve a specifier the way `tsconfig` `paths: {"@/*": ["./*"]}` and node do. */
function resolveSpecifier(spec: string, fromAbs: string, webRoot: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = path.join(webRoot, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromAbs), spec);
  else return null; // a package, not ours

  // Strip an explicit extension the TS source may carry (`./x.js` -> `./x.ts`).
  const candidates: string[] = [];
  const noExt = base.replace(/\.(js|mjs|ts|tsx|jsx|mts)$/, '');
  for (const ext of SOURCE_EXT) candidates.push(noExt + ext);
  for (const ext of SOURCE_EXT) candidates.push(path.join(noExt, 'index' + ext));
  candidates.push(base);
  for (const c of candidates) {
    try { if (fs.statSync(c).isFile()) return c; } catch { /* next */ }
  }
  return null;
}

const IMPORT_RE =
  /(?:^|[\s;}])(?:import|export)\s+(?:[^'"]*?\sfrom\s*)?['"]([^'"]+)['"]|(?:^|[^\w.])(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

export function buildModuleGraph(repoRoot: string, dirs: string[]): ModuleGraph {
  const webRoot = path.join(repoRoot, 'web-v2');
  const abs = dirs.flatMap((d) => walk(path.join(repoRoot, d)));
  const rel = (p: string) => path.relative(repoRoot, p);
  const graph: ModuleGraph = {
    files: abs.map(rel),
    imports: new Map(),
    importedBy: new Map(),
  };
  for (const f of abs) {
    let src: string;
    try { src = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const targets = new Set<string>();
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2];
      if (!spec) continue;
      const resolved = resolveSpecifier(spec, f, webRoot);
      if (!resolved) continue;
      targets.add(rel(resolved));
    }
    graph.imports.set(rel(f), targets);
    for (const t of targets) {
      let set = graph.importedBy.get(t);
      if (!set) { set = new Set(); graph.importedBy.set(t, set); }
      set.add(rel(f));
    }
  }
  return graph;
}

export function isTestFile(relPath: string): boolean {
  return /\.(test|spec)\.tsx?$/.test(relPath) || /\.audit\.test\.ts$/.test(relPath);
}

/**
 * A Next.js entry point — something the framework or an operator invokes
 * directly, so it needs no importer to be alive.
 */
export function isEntryPoint(relPath: string): boolean {
  return (
    /^web-v2\/app\/.*\/(page|layout|route|template|loading|error|not-found|default)\.tsx?$/.test(relPath)
    || /^web-v2\/app\/(page|layout)\.tsx?$/.test(relPath)
    || /^web-v2\/(middleware|instrumentation|next\.config)\.(ts|tsx|mjs|js)$/.test(relPath)
    || /^web-v2\/(vitest\.config|vitest\.setup)\.ts$/.test(relPath)
    // Operator- and CI-invoked one-offs. Their whole job is to be run by hand.
    || /^web-v2\/scripts\//.test(relPath)
  );
}

/**
 * `web-v2/app/api/race/[slug]/block-preview/route.ts` becomes
 * `/api/race/<wildcard>/block-preview`. Each `[dynamic]` segment collapses to
 * a `*`, which the caller match below treats as "any one segment".
 */
export function routePathOf(relRouteFile: string): string {
  return '/' + relRouteFile
    .replace(/^web-v2\/app\//, '')
    .replace(/\/route\.tsx?$/, '')
    .split('/')
    .map((seg) => (seg.startsWith('[') ? '*' : seg))
    .join('/');
}

/**
 * Every API route with no call site anywhere — web `fetch`, Swift client, or
 * a CI workflow.
 *
 * TWO TRAPS, both of which produce a wrong answer if ignored:
 *
 *   · The Swift client builds URLs as `appendingPathComponent("api/log")`,
 *     WITHOUT a leading slash. Anchoring the search on `"/api/"` reports about
 *     fifteen live routes as dead.
 *   · Route paths appear in doc comments constantly. Only quoted string
 *     literals count, never prose.
 *
 * A dynamic segment (`[slug]`) and any interpolation (`${…}` / `\(…)`) are
 * both treated as wildcards, so this errs toward calling a route LIVE.
 */
export function findUncalledRoutes(
  repoRoot: string,
  routeDir: string,
  callerDirs: string[],
): string[] {
  const routes = walk(path.join(repoRoot, routeDir))
    .map((p) => path.relative(repoRoot, p))
    .filter((p) => /\/route\.tsx?$/.test(p));

  // Collect quoted literals that look like an API path, from TS/TSX and Swift.
  const callSites: string[] = [];
  const SWIFT_OR_TS = /\.(ts|tsx|mts|mjs|js|jsx|swift|yml|yaml)$/;
  const collect = (dir: string) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.next' || e.name === '.git') continue;
      if (e.name.startsWith('._')) continue;
      // This directory TALKS about routes for a living. Its own prose naming
      // `/api/race/*/block-preview` must never register as a call site.
      if (e.name === 'audit' && dir.endsWith(path.join('web-v2', 'lib'))) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { collect(p); continue; }
      if (!SWIFT_OR_TS.test(e.name)) continue;
      let src: string;
      try { src = fs.readFileSync(p, 'utf8'); } catch { continue; }
      // Strip line comments so prose naming a route is not a call site.
      const code = src.replace(/^[ \t]*(\/\/|#|\*).*$/gm, '');
      for (const m of code.matchAll(/["'`]([^"'`\n]*\bapi\/[^"'`\n]*)["'`]/g)) callSites.push(m[1]);
      // Bare curl targets in CI workflows are not quoted. The character class
      // has to stop at `)` — `curl … https://www.faff.run/api/cron/x)` is how
      // every workflow in .github ends its line, and swallowing the paren
      // turns `silent-rebuild` into `silent-rebuild)` and the cron into a
      // route with no caller.
      for (const m of code.matchAll(/https?:\/\/[^\s"'`]*?(\/api\/[^\s"'`?#)(\\{}$]*)/g)) callSites.push(m[1]);
    }
  };
  for (const d of callerDirs) collect(path.join(repoRoot, d));

  // ── the matcher ───────────────────────────────────────────────────────────
  //
  // Segment arrays, compared position by position and length-checked. A regex
  // that allows a trailing tail reports `api/race/\(slug)` as a caller of
  // `/api/race/*/block-preview`, which is how a dead route looks alive.
  const segsOf = (raw: string): string[] | null => {
    const s = raw
      .replace(/\$\{[^}]*\}/g, '*')     // TS interpolation
      .replace(/\\\([^)]*\)/g, '*')     // Swift interpolation
      .replace(/\[[^\]]*\]/g, '*')      // a literal Next.js dynamic segment
      .split(/[?#]/)[0]
      .trim();
    const parts = s.split('/').filter(Boolean);
    const at = parts.indexOf('api');
    if (at === -1) return null;
    return parts.slice(at);
  };

  const callerSegs = callSites.map(segsOf).filter((x): x is string[] => x !== null);

  const uncalled: string[] = [];
  for (const r of routes) {
    const want = segsOf(routePathOf(r));
    if (!want) continue;
    const hit = callerSegs.some((got) =>
      got.length === want.length
      && got.every((seg, i) => seg === '*' || want[i] === '*' || seg === want[i]));
    if (!hit) uncalled.push(r);
  }
  return uncalled.sort();
}

export interface Orphan {
  file: string;
  /**
   * 'none'      — imported by nothing at all.
   * 'test-only' — imported only by test files.
   * 'dead-root' — reachable only through an entry point nothing calls.
   */
  kind: 'none' | 'test-only' | 'dead-root';
  importers: string[];
}

/**
 * Modules under `watchDirs` that no LIVE entry point reaches.
 *
 * `deadEntryPoints` is what makes this catch instance 3. `lib/plan/
 * block-preview.ts` is imported — by `app/api/race/[slug]/block-preview/
 * route.ts`, which is an entry point, so an importer-count check calls it
 * alive. Nothing calls that route. Reachability from the entry points that
 * something actually invokes is the only view in which block-preview, and the
 * `lib/plan/core.ts` it strands behind it, both show up.
 */
export function findOrphans(
  graph: ModuleGraph,
  watchDirs: string[],
  deadEntryPoints: Set<string> = new Set(),
): Orphan[] {
  // Reachability from live roots.
  const live = new Set<string>();
  const queue: string[] = [];
  for (const f of graph.files) {
    if (isTestFile(f)) continue;
    if (!isEntryPoint(f)) continue;
    if (deadEntryPoints.has(f)) continue;
    live.add(f);
    queue.push(f);
  }
  while (queue.length > 0) {
    const cur = queue.pop()!;
    for (const t of graph.imports.get(cur) ?? []) {
      if (live.has(t)) continue;
      live.add(t);
      queue.push(t);
    }
  }

  const out: Orphan[] = [];
  for (const f of graph.files) {
    if (!watchDirs.some((d) => f.startsWith(d))) continue;
    if (isTestFile(f)) continue;
    if (f.endsWith('.d.ts')) continue;
    if (isEntryPoint(f)) continue;
    if (live.has(f)) continue;
    const importers = [...(graph.importedBy.get(f) ?? [])];
    if (importers.length === 0) { out.push({ file: f, kind: 'none', importers: [] }); continue; }
    if (importers.every(isTestFile)) { out.push({ file: f, kind: 'test-only', importers }); continue; }
    out.push({ file: f, kind: 'dead-root', importers });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}
