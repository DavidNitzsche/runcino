/**
 * lib/audit/swallow-scan.ts · find the places where a database FAILURE turns
 * into a plausible ANSWER.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * THE INCIDENT
 *
 * `plan_workouts.date_iso` is a TEXT day key. Four shipped queries compared it
 * against a `date` or a `timestamp`. Postgres refuses that — `operator does not
 * exist: text >= timestamp with time zone` — and all four wrapped the call in
 * `.catch(() => empty)`. A hard type error became an empty result, and an empty
 * result is a perfectly good answer:
 *
 *   · the drift monitor's whole pace axis had never fired for any runner, and
 *     reported that as "no drift";
 *   · two per-day-type baselines were permanently null;
 *   · `runner_calibration.data_quality` was pinned at `cold-start`, because the
 *     `>= 3 → building` gate counted a number that was an error.
 *
 * Nobody noticed for months, because A SWALLOWED FAILURE AND AN HONEST NOTHING
 * ARE THE SAME VALUE. Every test passed. Every gate was green.
 *
 * The 2026-08-24 sweep that produced this scanner found the same shape in
 * seventeen more places, including a password change that has never once ended
 * another session and reported `other_sessions_ended: 0` as a count.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHAT COUNTS AS A VIOLATION
 *
 * A site where all three hold:
 *
 *   1 · it is a DATABASE CALL — `pool.query(`, `client.query(`, `.query<…>(`;
 *   2 · a rejection is converted into a VALUE rather than propagated;
 *   3 · the handler is BLIND — it never binds the error, or binds it and never
 *       mentions it again. It cannot log, cannot re-throw, cannot distinguish.
 *
 * (3) is the sharp edge, and it is deliberately syntactic. A handler that takes
 * no parameter is not "probably" unable to tell what went wrong; it is provably
 * unable. That is a property a scanner can check without guessing intent, and
 * it is exactly the property the incident turned on.
 *
 * TWO SEVERITIES, because they are not the same crime:
 *
 *   · MINTED  — the fallback FABRICATES a value: `{ rows: [{ n: '0' }] }`,
 *               `0`, `false`, `'easy'`, `{ rowCount: 0 }`. An error becomes a
 *               number the app then reasons with. `data_quality = 'cold-start'`
 *               came from a fabricated `'0'`. These fail the build outright.
 *   · EMPTIED — the fallback is an empty container: `[]`, `{ rows: [] }`,
 *               `null`, `undefined`. Still indistinguishable from an honest
 *               nothing, but it does not invent an observation. These are held
 *               to a RATCHET: the count may never rise, and every one that gets
 *               fixed lowers the line permanently.
 *
 * The ratchet is the honest answer to a legacy of 250-odd of these. Pretending
 * to have individually argued 250 exemptions would be a worse lie than the bug.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * HOW IT PARSES, AND WHY IT PARSES THAT WAY
 *
 * Every one of these was learned the hard way, in this repo, on this bug:
 *
 *   · MULTI-LINE SQL. The queries are multi-line template literals and the
 *     `.catch` is routinely six lines below the `pool.query(` that owns it. A
 *     line-oriented grep sees neither end of that and reports clean. A false
 *     finding was filed exactly that way during this sweep. So the scanner
 *     brace-matches the call and reads the whole expression.
 *   · COMMENTS FIRST. Prose inside a doc comment reads exactly like SQL to a
 *     regex — `SELECT max_hr FROM profile` in a comment produced a false
 *     positive during this sweep, on a line that was describing a bug already
 *     fixed. Comments are stripped before anything else looks at the source.
 *   · NESTED TEMPLATES. `${…}` can contain backticks. The literal walker tracks
 *     interpolation depth rather than pairing quotes.
 *
 * The scanner is deliberately conservative in the direction of raising a
 * question rather than swallowing one — a false "this is fine" is the bug it
 * exists to catch.
 */
import fs from 'node:fs';
import path from 'node:path';

export type Severity = 'minted' | 'emptied';

export interface SwallowSite {
  /** Repo-relative, e.g. `lib/plan/seal.ts`. */
  file: string;
  /** 1-based line of the `.catch` / `catch` keyword. */
  line: number;
  /** Registry key: `file::enclosingSymbol`. Stable across edits above it. */
  id: string;
  /** The nearest enclosing function/const name, or `<module>`. */
  symbol: string;
  severity: Severity;
  /** The fallback expression, trimmed, for the report. */
  fallback: string;
  /** `.catch(…)` or `try/catch`. */
  form: 'catch-handler' | 'try-catch';
}

export interface SwallowScanResult {
  filesScanned: number;
  /** Every `pool.query(` / `client.query(` call seen. The floor guards this. */
  dbCallsSeen: number;
  sites: SwallowSite[];
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · SOURCE PREPARATION
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Blank out comments and string/template contents, preserving BYTE OFFSETS and
 * NEWLINES so every index and line number in the result still points at the
 * real file.
 *
 * Blanking rather than deleting is what lets the brace matcher run over the
 * masked text while the report quotes the original. A `}` inside a SQL string
 * or a `//` inside a URL would otherwise close a call early — which is how a
 * scanner ends up confidently reporting nothing.
 */
export function maskSource(src: string): string {
  const n = src.length;
  const out = new Array<string>(n);
  for (let i = 0; i < n; i++) out[i] = src[i];

  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== '\n') out[k] = ' ';
  };

  let i = 0;
  while (i < n) {
    const c = src[i];
    // line comment
    if (c === '/' && src[i + 1] === '/') {
      let j = i;
      while (j < n && src[j] !== '\n') j++;
      blank(i, j);
      i = j;
      continue;
    }
    // block comment
    if (c === '/' && src[i + 1] === '*') {
      let j = i + 2;
      while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++;
      blank(i, Math.min(j + 2, n));
      i = Math.min(j + 2, n);
      continue;
    }
    // template literal — track `${…}` depth, which may itself contain backticks
    if (c === '`') {
      let j = i + 1;
      const depths: number[] = [];
      while (j < n) {
        if (src[j] === '\\') { blank(j, j + 2); j += 2; continue; }
        if (src[j] === '$' && src[j + 1] === '{') { depths.push(1); j += 2; continue; }
        if (depths.length > 0) {
          // inside an interpolation: leave the code visible, track braces
          if (src[j] === '{') depths[depths.length - 1]++;
          else if (src[j] === '}') {
            depths[depths.length - 1]--;
            if (depths[depths.length - 1] === 0) depths.pop();
          }
          j++;
          continue;
        }
        if (src[j] === '`') break;
        out[j] = src[j] === '\n' ? '\n' : ' ';
        j++;
      }
      i = j + 1;
      continue;
    }
    // quoted strings — cannot span a newline
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        j++;
      }
      blank(i + 1, j);
      i = j + 1;
      continue;
    }
    i++;
  }
  return out.join('');
}

/** 1-based line number of a byte offset. */
export function lineAt(src: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) if (src[i] === '\n') line++;
  return line;
}

/**
 * Index just past the `)` matching the `(` at `open`, in MASKED source.
 * Returns -1 when unbalanced.
 */
export function matchParen(masked: string, open: number): number {
  if (masked[open] !== '(') return -1;
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    const c = masked[i];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * The index of a function's BODY `{`, searching forward from the end of its
 * parameter list. Skips `{ … }` that belong to a return-type annotation.
 * Returns -1 when no body brace is found within a reasonable span.
 */
export function bodyBrace(masked: string, from: number): number {
  let i = from;
  const limit = Math.min(masked.length, from + 2000);
  while (i < limit) {
    const at = masked.indexOf('{', i);
    if (at < 0 || at >= limit) return -1;
    // A `;` or `=>` at statement level before any brace means this declaration
    // has no body here (an overload signature, or an expression-bodied arrow).
    if (/;/.test(masked.slice(i, at))) return -1;
    const end = matchBrace(masked, at);
    if (end < 0) return -1;
    const next = masked.slice(end).match(/^\s*(\S)/)?.[1];
    if (next && '>|&[,'.includes(next)) { i = end; continue; } // a type literal
    return at;
  }
  return -1;
}

/** Index just past the `}` matching the `{` at `open`, in MASKED source. */
export function matchBrace(masked: string, open: number): number {
  if (masked[open] !== '{') return -1;
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    const c = masked[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · CLASSIFYING A HANDLER
 * ═══════════════════════════════════════════════════════════════════════ */

/** A call that reaches Postgres. `client.query` covers the transaction paths. */
const DB_CALL = /\b(?:pool|client|db|tx|conn)\s*\.\s*query\s*(?:<|\()/g;

/**
 * Does this handler body ever refer to the error it was handed?
 *
 * `(e) => { console.error(e); return []; }`  → yes, it can tell.
 * `() => []`                                 → no. Nothing to tell with.
 * `(e) => []`                                → no. Bound and dropped, which is
 *                                              the same blindness with a
 *                                              parameter name on it.
 *
 * A call to any of the project's own reporters counts even without naming the
 * binding, because those take the error as their second argument by contract.
 */
export function handlerObservesError(param: string | null, body: string): boolean {
  if (/\b(?:logReadFailure|raiseAlert|outage|LoadBearingReadFailed)\b/.test(body)) return true;
  if (!param) return false;
  const ident = param.trim().replace(/:.*$/, '').trim();
  if (!ident || !/^[A-Za-z_$][\w$]*$/.test(ident)) return false;
  // Mentioned anywhere after the arrow: logged, wrapped, rethrown, inspected.
  return new RegExp(`\\b${ident.replace(/[$]/g, '\\$')}\\b`).test(body);
}

/** Values that INVENT an observation rather than merely being absent. */
const MINTED = [
  /\brows\s*:\s*\[\s*\{/,          // { rows: [{ n: '0' }] } — a fabricated row
  /\browCount\s*:\s*\d/,           // { rowCount: 0 }
  /^\s*-?\d+(?:\.\d+)?\s*$/,       // 0, -1, 1
  /^\s*(?:true|false)\s*$/,        // false
  /^\s*['"][^'"]+['"]\s*$/,        // 'easy'
];

/** Values that are an empty container: absent, but not invented. */
const EMPTIED = [
  /^\s*\[\s*\]/,
  /^\s*null\s*$/,
  /^\s*undefined\s*$/,
  /^\s*\{\s*\}\s*$/,
  /\brows\s*:\s*\[\s*\]/,
  /\brows\s*:\s*\[\s*\]\s*as\b/,
  /^\s*new (?:Map|Set)\b/,
  /^\s*['"]['"]\s*$/,              // '' — absent text
];

/**
 * Which severity a fallback expression carries, or null when it is neither
 * (i.e. the handler produces something substantive and is not this bug).
 */
export function classifyFallback(expr: string): Severity | null {
  const e = expr.trim().replace(/^\(+|\)+$/g, '').trim();
  if (!e) return null;
  // Order matters: `{ rows: [] }` matches EMPTIED, `{ rows: [{…}] }` MINTED.
  for (const re of MINTED) if (re.test(e)) return 'minted';
  for (const re of EMPTIED) if (re.test(e)) return 'emptied';
  return null;
}

/**
 * The name of the function whose body CONTAINS `index`.
 *
 * Not "the nearest declaration above it" — that resolves to whatever `const`
 * the query result is being assigned to (`r`, `row`, `today`), which is both
 * meaningless in a report and unstable the moment someone renames a local. The
 * registry keys on this string, so it has to name the unit of behaviour.
 *
 * Innermost enclosing wins; a top-level statement is `<module>`.
 */
export function enclosingSymbol(masked: string, index: number): string {
  // `function NAME(`, or `const NAME = (…) =>` / `= async (…) =>` / `= function(`.
  // A bare `const NAME = (` is NOT a declaration — `const rows = (await …)` is
  // the single commonest line in this codebase and matching it named every site
  // after its own local variable.
  const decl = new RegExp(
    String.raw`(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*(?:<[^>(]*>)?\s*\(`
    + '|'
    + String.raw`(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]*)?=\s*(?:async\s+)?(?:function\b\s*\(|\([^)]*\)\s*(?::[^=]{0,120})?=>)`,
    'g',
  );
  let best: { name: string; start: number } | null = null;
  for (const m of masked.matchAll(decl)) {
    if (m.index! > index) break;
    // Find the body `{` that opens after this declaration's parameter list.
    const parenAt = masked.indexOf('(', m.index!);
    if (parenAt < 0) continue;
    const parenEnd = matchParen(masked, parenAt);
    if (parenEnd < 0) continue;
    // The body `{`, which is NOT simply the next `{`: a return-type annotation
    // routinely contains one — `): Promise<{ reason: X; site: string } | null> {`
    // — and taking that brace made the whole function resolve to `<module>`.
    // A type literal's closing `}` is always followed by `>`, `|`, `&`, `[` or
    // `,`; the body's is not.
    const braceAt = bodyBrace(masked, parenEnd);
    if (braceAt < 0) continue;
    const braceEnd = matchBrace(masked, braceAt);
    if (braceEnd < 0) continue;
    if (index > braceAt && index < braceEnd) {
      // Innermost = the one that starts latest while still containing `index`.
      if (!best || m.index! > best.start) best = { name: m[1] ?? m[2]!, start: m.index! };
    }
  }
  return best?.name ?? '<module>';
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · THE SCAN
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Scan one file's source. Exported so the tests can drive it on fixtures — the
 * positive controls in `_swallow_scan.test.ts` run through exactly this.
 */
export function scanSource(file: string, src: string): { sites: SwallowSite[]; dbCalls: number } {
  const masked = maskSource(src);
  const sites: SwallowSite[] = [];

  DB_CALL.lastIndex = 0;
  const dbCallOffsets: number[] = [];
  for (const m of masked.matchAll(DB_CALL)) dbCallOffsets.push(m.index!);

  /* ── 3a · `.catch(handler)` attached to a db call ───────────────────────
   * The `.catch` may be many lines below its `pool.query(`. Rather than try to
   * pair them by proximity, every `.catch` is resolved back to the START of the
   * expression it terminates, and that span is asked whether it contains a db
   * call. That is what makes a `.catch` on a different line from its query
   * resolve correctly, and it is a positive control in the test. */
  const catchRe = /\.catch\s*\(/g;
  for (const m of masked.matchAll(catchRe)) {
    const open = m.index! + m[0].length - 1;
    const close = matchParen(masked, open);
    if (close < 0) continue;
    const handler = masked.slice(open + 1, close - 1);

    // Walk back to the start of the statement this `.catch` belongs to, then
    // ask whether a db call happens inside it.
    const stmtStart = statementStart(masked, m.index!);
    const owns = dbCallOffsets.some((o) => o >= stmtStart && o < m.index!);
    if (!owns) continue;

    const arrow = handler.match(/^\s*(?:\(\s*([^)]*?)\s*\)|([A-Za-z_$][\w$]*))\s*=>/);
    if (!arrow) continue; // `.catch(fn)` — a named handler can see the error
    const param = (arrow[1] ?? arrow[2] ?? '').trim() || null;
    const body = handler.slice(arrow[0].length);
    if (handlerObservesError(param, body)) continue;

    const severity = classifyFallback(body.replace(/^\s*\{\s*return\s*/, '').replace(/;?\s*\}\s*$/, ''));
    if (!severity) continue;

    const line = lineAt(src, m.index!);
    sites.push({
      file,
      line,
      symbol: enclosingSymbol(masked, m.index!),
      id: `${file}::${enclosingSymbol(masked, m.index!)}`,
      severity,
      fallback: collapse(src.slice(open + 1, close - 1)),
      form: 'catch-handler',
    });
  }

  /* ── 3b · `try { …query… } catch { return <empty> }` ────────────────── */
  const tryRe = /\btry\s*\{/g;
  for (const m of masked.matchAll(tryRe)) {
    const open = m.index! + m[0].length - 1;
    const bodyEnd = matchBrace(masked, open);
    if (bodyEnd < 0) continue;
    const hasDbCall = dbCallOffsets.some((o) => o > open && o < bodyEnd);
    if (!hasDbCall) continue;

    const after = masked.slice(bodyEnd, bodyEnd + 200);
    const cm = after.match(/^\s*catch\s*(?:\(\s*([^)]*?)\s*\))?\s*\{/);
    if (!cm) continue;
    const catchBraceAt = bodyEnd + cm[0].length - 1;
    const catchEnd = matchBrace(masked, catchBraceAt);
    if (catchEnd < 0) continue;
    const catchBody = masked.slice(catchBraceAt + 1, catchEnd - 1);
    const param = (cm[1] ?? '').trim() || null;
    if (handlerObservesError(param, catchBody)) continue;

    const ret = catchBody.match(/\breturn\b([^;]*);?/);
    // A `catch {}` that returns nothing still swallows, but it is not turning a
    // failure into a VALUE — the caller sees undefined either way. Only a catch
    // that produces a value is this bug.
    if (!ret) continue;
    const severity = classifyFallback(ret[1]);
    if (!severity) continue;

    const line = lineAt(src, bodyEnd);
    sites.push({
      file,
      line,
      symbol: enclosingSymbol(masked, m.index!),
      id: `${file}::${enclosingSymbol(masked, m.index!)}`,
      severity,
      fallback: collapse(src.slice(bodyEnd, catchEnd)).slice(0, 120),
      form: 'try-catch',
    });
  }

  return { sites, dbCalls: dbCallOffsets.length };
}

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Walk back from a `.catch` to the start of the expression it terminates.
 *
 * Stops at the statement boundary — a `;`, a `{`/`}` at depth zero, or the
 * `await`/`const`/`return` that opened it. Bracket depth is tracked so a
 * `.catch` inside an argument list resolves to that argument, not the line.
 */
export function statementStart(masked: string, catchAt: number): number {
  let depth = 0;
  for (let i = catchAt - 1; i >= 0; i--) {
    const c = masked[i];
    if (c === ')' || c === ']' || c === '}') depth++;
    else if (c === '(' || c === '[' || c === '{') {
      if (depth === 0) return i + 1;
      depth--;
    } else if (depth === 0 && (c === ';' || c === ',')) return i + 1;
  }
  return 0;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · WALKING THE TREE
 * ═══════════════════════════════════════════════════════════════════════ */

const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build', '.git']);

export function walkTs(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try { entries = fs.readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e) || e.startsWith('.')) continue;
    const p = path.join(dir, e);
    let st: fs.Stats;
    try { st = fs.statSync(p); } catch { continue; }
    if (st.isDirectory()) walkTs(p, out);
    else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/** Scan `lib/` and `app/` under `root` (the `web-v2` directory). */
export function scanTree(root: string): SwallowScanResult {
  const files = [
    ...walkTs(path.join(root, 'lib')),
    ...walkTs(path.join(root, 'app')),
  ];
  const sites: SwallowSite[] = [];
  let dbCallsSeen = 0;
  for (const abs of files) {
    const rel = path.relative(root, abs);
    const src = fs.readFileSync(abs, 'utf8');
    const r = scanSource(rel, src);
    sites.push(...r.sites);
    dbCallsSeen += r.dbCalls;
  }
  sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { filesScanned: files.length, dbCallsSeen, sites };
}
