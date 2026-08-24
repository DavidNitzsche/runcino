/**
 * lib/audit/sql-scan.ts — a static reader/writer map for every SQL column the
 * app touches.
 *
 * WHY THIS EXISTS
 *
 * Three pieces of authored content turned up unread on the same afternoon
 * (2026-08-24):
 *
 *   · `plan_phases.rationale` — a cited reason per phase, written on all 210
 *     rows, and every SELECT against the table asked for `label`,
 *     `start_week_idx`, `end_week_idx` and nothing else.
 *   · `plan_workouts.notes` — a sentence per day, written on all 4431 rows,
 *     while the Today screen composed its own generic copy from the type.
 *   · `lib/plan/block-preview.ts` — a whole module with tests and an API route,
 *     imported by nothing but itself.
 *
 * None of that is laziness. The authoring side and the reading side get built
 * at different times, and NOTHING FAILS WHEN THEY DO NOT MEET. A green build, a
 * passing suite and every existing gate all agree that unread content is fine.
 * This module is the thing that stops agreeing.
 *
 * WHAT IT DOES
 *
 * Extracts SQL string literals out of the source, then resolves, per statement:
 *   · WRITES — `INSERT INTO t (cols…)`, `UPDATE t SET col =`, `DO UPDATE SET`.
 *   · READS  — identifiers in a SELECT projection or a RETURNING clause,
 *              attributed to a table through the FROM/JOIN alias map.
 *
 * PRECISION RULES — these matter, because a false "it has a reader" is exactly
 * the bug this file is meant to catch:
 *
 *   · A QUALIFIED projection item (`pp.rationale`) is attributed only to the
 *     table bound to that alias. The prototype of this scanner attributed it to
 *     every table in the FROM clause, and that single shortcut hid
 *     `plan_weeks.rationale` behind a query that joins `plan_weeks` but selects
 *     `pp.rationale` off `plan_phases`.
 *   · An UNQUALIFIED item counts as a definite read only when exactly one table
 *     is in scope. With a join in play it is recorded as AMBIGUOUS and does not
 *     count as proof.
 *   · `SELECT *` is recorded as a wildcard and NEVER counts as proof. Fetching
 *     a column into a row object nobody destructures is the failure mode, not
 *     the fix.
 *
 * The result is deliberately conservative in the direction of raising a
 * question rather than swallowing one.
 */
import fs from 'node:fs';
import path from 'node:path';

/** One SQL string literal found in the source, with its origin. */
export interface SqlLiteral {
  /** Repo-relative path, e.g. `web-v2/lib/plan/generate.ts`. */
  file: string;
  sql: string;
}

export interface ColumnRef {
  table: string;
  column: string;
  file: string;
}

export interface ScanResult {
  filesScanned: number;
  literalsFound: number;
  /** table -> column -> files that SELECT it unambiguously. */
  reads: Map<string, Map<string, Set<string>>>;
  /** table -> column -> files that INSERT/UPDATE it. */
  writes: Map<string, Map<string, Set<string>>>;
  /** table -> column -> files where the reference could not be pinned to one table. */
  ambiguousReads: Map<string, Map<string, Set<string>>>;
  /** table -> files doing `SELECT *` against it. */
  wildcardReads: Map<string, Set<string>>;
}

const IDENT_SRC = '[A-Za-z_][A-Za-z0-9_]*';

/** SQL words that can appear where a table name would, and are not tables. */
const NOT_A_TABLE = new Set([
  'join', 'left', 'right', 'inner', 'outer', 'full', 'cross', 'lateral',
  'on', 'as', 'natural', 'using', 'only', 'select', 'from', 'where',
]);

/** SQL keywords and functions that appear in a projection list but are not columns. */
const NOT_A_COLUMN = new Set([
  'select', 'distinct', 'all', 'as', 'case', 'when', 'then', 'else', 'end',
  'and', 'or', 'not', 'null', 'true', 'false', 'is', 'in', 'like', 'ilike',
  'between', 'cast', 'coalesce', 'nullif', 'greatest', 'least', 'count',
  'sum', 'avg', 'min', 'max', 'array', 'agg', 'array_agg', 'json_agg',
  'jsonb_agg', 'to_jsonb', 'jsonb_build_object', 'json_build_object',
  'row_to_json', 'extract', 'date', 'interval', 'now', 'text', 'int',
  'integer', 'bigint', 'numeric', 'float8', 'float4', 'boolean', 'bool',
  'jsonb', 'json', 'uuid', 'timestamptz', 'timestamp', 'varchar', 'real',
  'over', 'partition', 'by', 'order', 'desc', 'asc', 'filter', 'within',
  'group', 'string_agg', 'concat', 'concat_ws', 'substring', 'trim',
  'lower', 'upper', 'round', 'abs', 'ceil', 'floor', 'length', 'replace',
  'to_char', 'to_date', 'to_timestamp', 'age', 'exists', 'any', 'some',
  'first_value', 'last_value', 'row_number', 'rank', 'dense_rank', 'lag',
  'lead', 'percentile_cont', 'nulls', 'first', 'last', 'x', '__x__',
  'left', 'right', 'position', 'split_part', 'regexp_replace', 'md5',
  'generate_series', 'unnest', 'array_length', 'cardinality', 'mod',
  'nullstr', 'distinct_on', 'current_date', 'current_timestamp',
]);

/**
 * Strip comments and pull out every string literal in a TS/JS source.
 *
 * Hand-rolled rather than regex'd because the SQL here is multi-line template
 * literals with `${…}` interpolation, and a line-oriented regex is precisely
 * the tool that reports "no SELECT touches this column" when the SELECT is
 * simply on the next line. The audit prompt that produced this file filed that
 * exact false positive.
 */
export function extractStringLiterals(src: string): string[] {
  const out: string[] = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '`' || c === "'" || c === '"') {
      const quote = c;
      let j = i + 1;
      let buf = '';
      let closed = false;
      while (j < n) {
        if (src[j] === '\\') { buf += src[j] + (src[j + 1] ?? ''); j += 2; continue; }
        if (src[j] === quote) { closed = true; break; }
        // A single/double-quoted string cannot span a newline; if we hit one
        // we mis-identified an apostrophe in a comment or a JSX attribute.
        if (quote !== '`' && src[j] === '\n') break;
        buf += src[j];
        j++;
      }
      if (closed) { out.push(buf); i = j + 1; continue; }
      i++;
      continue;
    }
    i++;
  }
  return out;
}

/** Collapse `${…}` interpolations and whitespace so one statement is one line. */
function normalize(sql: string): string {
  return sql.replace(/\$\{[^}]*\}/g, ' __X__ ').replace(/\s+/g, ' ').trim();
}

/**
 * Parse a FROM/JOIN clause into an alias map.
 * Returns `{ aliasToTable, tables }`. A table with no alias maps to itself.
 */
export function parseFromClause(fromClause: string): {
  aliasToTable: Map<string, string>;
  tables: Set<string>;
} {
  const aliasToTable = new Map<string, string>();
  const tables = new Set<string>();
  // Split on join keywords and commas, keeping each table reference intact.
  const parts = fromClause.split(/\s*,\s*|\s+(?:natural\s+)?(?:left|right|inner|outer|full|cross)?\s*(?:outer\s+)?join\s+/i);
  for (const raw of parts) {
    const part = raw.trim();
    if (!part) continue;
    // Drop any ON / USING predicate that trails the table reference.
    const head = part.split(/\s+(?:on|using)\s+/i)[0].trim();
    // A sub-select or a function call in the FROM clause has no table name we
    // can pin columns to. Skip it rather than guessing.
    if (head.startsWith('(')) continue;
    const m = head.match(new RegExp(`^"?(${IDENT_SRC})"?(?:\\s+(?:as\\s+)?"?(${IDENT_SRC})"?)?$`, 'i'));
    if (!m) continue;
    const table = m[1].toLowerCase();
    if (NOT_A_TABLE.has(table)) continue;
    tables.add(table);
    aliasToTable.set(table, table);
    if (m[2]) {
      const alias = m[2].toLowerCase();
      if (!NOT_A_TABLE.has(alias)) aliasToTable.set(alias, table);
    }
  }
  return { aliasToTable, tables };
}

/**
 * Pull the column identifiers out of a SELECT projection list.
 *
 * Aliases introduced by `AS x` are dropped — `data->>'id' AS strava_id` reads
 * `data`, not a column called `strava_id`. Without this the scanner invents
 * readers for columns that do not exist.
 */
export function parseProjection(proj: string): {
  qualified: Array<{ alias: string; column: string }>;
  unqualified: string[];
  star: boolean;
} {
  const qualified: Array<{ alias: string; column: string }> = [];
  const unqualified: string[] = [];
  // `SELECT *` or `SELECT t.*`
  const star = /(^|[\s,(])\*/.test(proj) || /\.\*/.test(proj);

  // Remove output aliases so they are not mistaken for source columns.
  const withoutAliases = proj.replace(new RegExp(`\\s+as\\s+"?${IDENT_SRC}"?`, 'gi'), ' ');
  // Remove single-quoted SQL string constants.
  const cleaned = withoutAliases.replace(/'[^']*'/g, ' ');

  const seenQualified = new Set<string>();
  for (const m of cleaned.matchAll(new RegExp(`\\b(${IDENT_SRC})\\s*\\.\\s*(${IDENT_SRC})\\b`, 'g'))) {
    const key = `${m[1].toLowerCase()}.${m[2].toLowerCase()}`;
    if (seenQualified.has(key)) continue;
    seenQualified.add(key);
    qualified.push({ alias: m[1].toLowerCase(), column: m[2].toLowerCase() });
  }
  // Strip qualified references so their alias halves are not counted as bare
  // columns, then take what is left.
  const bare = cleaned.replace(new RegExp(`\\b${IDENT_SRC}\\s*\\.\\s*${IDENT_SRC}\\b`, 'g'), ' ');
  for (const m of bare.matchAll(new RegExp(`\\b(${IDENT_SRC})\\b`, 'g'))) {
    const id = m[1].toLowerCase();
    if (NOT_A_COLUMN.has(id)) continue;
    // `::text` casts leave the type name behind; already covered above.
    if (!unqualified.includes(id)) unqualified.push(id);
  }
  return { qualified, unqualified, star };
}

function put(
  map: Map<string, Map<string, Set<string>>>,
  table: string,
  column: string,
  file: string,
): void {
  let cols = map.get(table);
  if (!cols) { cols = new Map(); map.set(table, cols); }
  let files = cols.get(column);
  if (!files) { files = new Set(); cols.set(column, files); }
  files.add(file);
}

/** Analyse one SQL literal and fold its refs into the running result. */
export function analyseStatement(sql: string, file: string, out: ScanResult): void {
  const s = normalize(sql);
  if (!/\b(select|insert\s+into|update)\b/i.test(s)) return;

  // ── WRITES ────────────────────────────────────────────────────────────────
  for (const m of s.matchAll(new RegExp(`insert\\s+into\\s+"?(${IDENT_SRC})"?\\s*\\(([^)]*)\\)`, 'gi'))) {
    const table = m[1].toLowerCase();
    for (const raw of m[2].split(',')) {
      const col = raw.trim().replace(/"/g, '').toLowerCase();
      if (new RegExp(`^${IDENT_SRC}$`).test(col)) put(out.writes, table, col, file);
    }
  }
  for (const m of s.matchAll(new RegExp(`update\\s+"?(${IDENT_SRC})"?\\s+set\\s+(.*?)(?:\\s+where\\s+|\\s+returning\\s+|$)`, 'gi'))) {
    const table = m[1].toLowerCase();
    if (NOT_A_TABLE.has(table)) continue;
    for (const seg of m[2].split(',')) {
      const cm = seg.trim().match(new RegExp(`^"?(${IDENT_SRC})"?\\s*=`, 'i'));
      if (cm) put(out.writes, table, cm[1].toLowerCase(), file);
    }
  }
  const ins = s.match(new RegExp(`insert\\s+into\\s+"?(${IDENT_SRC})"?`, 'i'));
  if (ins) {
    const table = ins[1].toLowerCase();
    const doUpd = s.match(/do\s+update\s+set\s+(.*?)(?:\s+where\s+|\s+returning\s+|$)/i);
    if (doUpd) {
      for (const seg of doUpd[1].split(',')) {
        const cm = seg.trim().match(new RegExp(`^"?(${IDENT_SRC})"?\\s*=`, 'i'));
        if (cm) put(out.writes, table, cm[1].toLowerCase(), file);
      }
    }
  }

  // ── READS ─────────────────────────────────────────────────────────────────
  const selectRe = /\bselect\s+(.*?)\s+from\s+(.*?)(?:\s+(?:where|group\s+by|order\s+by|limit|having|window|union|intersect|except|returning|for\s+update)\b|$)/gi;
  for (const m of s.matchAll(selectRe)) {
    const { qualified, unqualified, star } = parseProjection(m[1]);
    const { aliasToTable, tables } = parseFromClause(m[2]);
    if (tables.size === 0) continue;

    if (star) for (const t of tables) {
      let set = out.wildcardReads.get(t);
      if (!set) { set = new Set(); out.wildcardReads.set(t, set); }
      set.add(file);
    }

    for (const q of qualified) {
      const table = aliasToTable.get(q.alias);
      // An alias we cannot resolve (a CTE, a sub-select) is not evidence about
      // any real table. Recording it against every table in scope is how the
      // prototype hid plan_weeks.rationale.
      if (!table) continue;
      put(out.reads, table, q.column, file);
    }

    if (unqualified.length > 0) {
      if (tables.size === 1) {
        const [only] = [...tables];
        for (const c of unqualified) put(out.reads, only, c, file);
      } else {
        for (const t of tables) for (const c of unqualified) put(out.ambiguousReads, t, c, file);
      }
    }
  }

  // RETURNING is a read of the row the write produced.
  for (const m of s.matchAll(/\breturning\s+(.*?)(?:;|$)/gi)) {
    const tm = s.match(new RegExp(`(?:insert\\s+into|update|delete\\s+from)\\s+"?(${IDENT_SRC})"?`, 'i'));
    if (!tm) continue;
    const table = tm[1].toLowerCase();
    const { unqualified, star } = parseProjection(m[1]);
    if (star) {
      let set = out.wildcardReads.get(table);
      if (!set) { set = new Set(); out.wildcardReads.set(table, set); }
      set.add(file);
    }
    for (const c of unqualified) put(out.reads, table, c, file);
  }
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.next' || e.name === '.git') continue;
    if (e.name.startsWith('._')) continue; // macOS AppleDouble sidecars
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts|mjs|js)$/.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * Scan the given repo-relative directories for SQL.
 *
 * `repoRoot` is the checkout root (the directory holding `web-v2/`).
 */
export function scanSql(repoRoot: string, dirs: string[]): ScanResult {
  const out: ScanResult = {
    filesScanned: 0,
    literalsFound: 0,
    reads: new Map(),
    writes: new Map(),
    ambiguousReads: new Map(),
    wildcardReads: new Map(),
  };
  for (const d of dirs) {
    for (const abs of walk(path.join(repoRoot, d))) {
      out.filesScanned++;
      let src: string;
      try { src = fs.readFileSync(abs, 'utf8'); } catch { continue; }
      if (!/\b(select|insert|update)\b/i.test(src)) continue;
      const rel = path.relative(repoRoot, abs);
      for (const lit of extractStringLiterals(src)) {
        if (lit.length < 15) continue;
        if (!/\b(select|insert\s+into|update)\b/i.test(lit)) continue;
        out.literalsFound++;
        analyseStatement(lit, rel, out);
      }
    }
  }
  return out;
}

/** Files that read a column unambiguously. Empty set when nothing does. */
export function readersOf(scan: ScanResult, table: string, column: string): Set<string> {
  return scan.reads.get(table)?.get(column) ?? new Set();
}

export function writersOf(scan: ScanResult, table: string, column: string): Set<string> {
  return scan.writes.get(table)?.get(column) ?? new Set();
}

export function ambiguousReadersOf(scan: ScanResult, table: string, column: string): Set<string> {
  return scan.ambiguousReads.get(table)?.get(column) ?? new Set();
}
