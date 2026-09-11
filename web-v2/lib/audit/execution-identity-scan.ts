/**
 * lib/audit/execution-identity-scan.ts · EXECID-SCAN-1's scanning logic,
 * extracted from `_execution_identity_scan.test.ts` so it can be unit-tested
 * on its own fixtures (Rule 18 · falsify a gate before trusting it) as well
 * as run against the real tree.
 *
 * ── NESTED-SUBQUERY-1 (2026-09-09) · THE BLIND SPOT ──────────────────────────
 *
 * The scanner's `projectsOnlyDates` check ran on the WHOLE SQL literal — the
 * entire multi-line template string, outer projection and every nested
 * subquery folded together. That is exactly right for a FLAT date-only
 * bypass (SEALDATE-1's own shape: `SELECT DISTINCT d::date FROM runs WHERE
 * user_uuid = $1`), and exactly wrong for a bypass NESTED inside a larger
 * query that also happens to select real quantity columns.
 *
 * Three real sites proved this (SEALEDBYPASS-1, same date): `recompute-
 * paces.ts`, `reanchor-plan.ts`'s maintenance arm, and `race-row-refresh.ts`
 * each ran
 *
 *   SELECT pw.id, pw.distance_mi, ...,
 *          EXISTS (SELECT 1 FROM runs r WHERE r.user_uuid = $2
 *                   AND <day-key>::date = pw.date_iso::date
 *                   AND NOT (r.data ? 'mergedIntoId')) AS sealed
 *     FROM plan_workouts pw WHERE ...
 *
 * The nested `EXISTS (...)` is a pure date-coincidence completion check —
 * `SELECT 1`, no quantity, exactly SEALDATE-1's shape — but the OUTER query
 * also selects `pw.distance_mi` (and, at one site, `pw.pace_target_s_per_mi`),
 * so `QUANTITY_COLUMNS` matched SOMEWHERE in the whole string and
 * `projectsOnlyDates` returned `true` — "this reads a quantity, therefore not
 * a bypass" — even though the runs-subquery itself reads nothing but `1`.
 * The bypass evaded the scanner three separate times.
 *
 * THE FIX: in addition to the whole-string check (kept, unchanged, for the
 * flat case), extract every parenthesized subquery and independently ask
 * whether ITS OWN projection (`SELECT <this> FROM ...`, not its WHERE clause)
 * carries a quantity column. `isRunCompletionBypass` is the combined check;
 * `scan()` now calls it instead of the three raw predicates directly.
 *
 * WHAT THIS STILL CANNOT FAIL ON (Rule 22, carried forward): a file that
 * asks the wrong question through a HELPER rather than inline SQL, or a
 * bypass split across two separate queries joined in application code. And
 * new to this fix: a bypass subquery whose OWN projection also happens to
 * mention a quantity-shaped identifier (e.g. reads `r.distance_mi` in its
 * SELECT list only to discard it) would still slip through — narrowing to
 * "the subquery's own projection" trades that unlikely shape for catching
 * the three real ones, which all project a bare `1`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { extractStringLiterals } from './sql-scan';

export interface Finding { file: string; sql: string }

/**
 * A day key selected out of `runs` — the shape every one of the four
 * original defects had. `runDaySql()` renders to an `AT TIME ZONE ...
 * ::date` expression, so both the helper call and its expansion are matched.
 */
export function selectsRunDayKey(sql: string): boolean {
  if (!/\bFROM\s+runs\b/i.test(sql)) return false;
  return /::date/i.test(sql) || /\bAT TIME ZONE\b/i.test(sql);
}

export function scopesToOneRunner(sql: string): boolean {
  return /user_uuid\s*=|user_id\s*=/i.test(sql);
}

/**
 * THE FINGERPRINT, and why it is this and not a keyword search.
 *
 * The first draft of this scanner flagged any runner-scoped day-key read of
 * `runs` in a file whose text mentioned completion. That matched 20 files —
 * `vdot-inputs.ts`, `durability-anchor.ts`, `adaptive-ramp.ts`, every load and
 * volume reader in the engine — because they all legitimately ask "what did
 * this runner run", and almost every file in `lib/coach` says "complete"
 * somewhere. A 20-entry allowlist is a rubber stamp, and Rule 18 is explicit
 * that an exemption list which excuses the normal case has stopped meaning
 * anything.
 *
 * What separates the four real defects from all twenty of those readers is not
 * vocabulary, it is the SHAPE OF THE ANSWER. A load reader asks for
 * quantities — distance, duration, pace, HR, the `data` payload — keyed BY
 * date. A date-coincidence completion check asks for the DATES THEMSELVES and
 * nothing else: "give me the days this runner ran", and then treats membership
 * in that set as proof a prescription was executed. That is precisely the
 * query `app/api/plan/undo/route.ts` was running.
 *
 * So: flag a runner-scoped day-key read of `runs` whose projection carries no
 * quantity at all. A reader that wants a number is asking a load question and
 * is not this bug; a reader that wants only a set of dates is asserting
 * identity from the calendar, which is the thing that may not be done.
 */
// No leading \b: the engine reaches these columns through helper names like
// `runDistanceMiSql('r')`, where "Distance" is mid-identifier and a word
// boundary would miss it. That gap let `decoupling-trend.ts` and
// `durability-anchor.ts` — three plainly load-shaped reads — through as
// findings on the first run of this predicate.
export const QUANTITY_COLUMNS =
  /(distance|duration|elapsed|moving|pace|avg_?hr|max_?hr|hr_|cadence|elevation|calor|\.data\b|data\s*->|shoe_id|SUM\s*\(|AVG\s*\(|MAX\s*\(|MIN\s*\()/i;

/** Whole-string check, UNCHANGED from the original scanner — the flat-query
 *  case (SEALDATE-1's own shape) where there is no outer query to dilute the
 *  quantity test. */
export function projectsOnlyDates(sql: string): boolean {
  return !QUANTITY_COLUMNS.test(sql);
}

/**
 * NESTED-SUBQUERY-1 · every top-level parenthesized `SELECT ...` inside
 * `sql`, balanced-paren matched (handles `COALESCE(...)`, `LEFT(...)`, a
 * helper call's own `(...)`, etc. nested inside, per the real sites' SQL).
 *
 * Deliberately naive relative to a real SQL parser — this codebase's whole
 * SQL-scanning apparatus (`sql-scan.ts`) is regex/string-walk based by
 * design, precisely because the alternative (a real parser) is a much bigger
 * thing to keep correct for a codebase with no compile-time SQL checking.
 */
export function extractParenSubqueries(sql: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] !== '(') continue;
    let j = i + 1;
    while (j < sql.length && /\s/.test(sql[j])) j++;
    if (!/^select\b/i.test(sql.slice(j))) continue;
    let depth = 1;
    let k = i + 1;
    while (k < sql.length && depth > 0) {
      if (sql[k] === '(') depth++;
      else if (sql[k] === ')') depth--;
      k++;
    }
    if (depth === 0) out.push(sql.slice(i + 1, k - 1));
  }
  return out;
}

/**
 * `QUANTITY_COLUMNS` catches a QUALIFIED payload read (`r.data`, `t.data`) or
 * an arrow extraction (`data->>'x'`) but not a BARE `data` projection —
 * `SELECT data FROM runs WHERE ...`, which selects the runner's whole JSON
 * payload and is exactly as load-shaped a read as `SELECT r.data`. That gap
 * only matters once quantity-checking is scoped to a subquery's own
 * projection (below): the whole-string check never needed it, because a CTE
 * that selects bare `data` to hand to an outer SELECT invariably has THAT
 * outer SELECT read a field off it with `->>`, which the whole string already
 * catches. Scoped to one subquery's own projection, that outer usage is out
 * of view, so the bare form needs its own pattern here.
 */
const SUBQUERY_PROJECTION_QUANTITY = new RegExp(`${QUANTITY_COLUMNS.source}|\\bdata\\b`, 'i');

/**
 * The subquery-scoped quantity check. Unlike `projectsOnlyDates` (whole
 * string, kept for backward compatibility with the flat case), this looks
 * ONLY at the subquery's own `SELECT <projection> FROM` clause — not its
 * WHERE clause, which is where a bypass's date-derivation expression (e.g.
 * `r.data->>'date'`) lives and would otherwise false-trip the `.data\b`
 * quantity pattern on a query that projects nothing but `1`.
 *
 * `sql` is expected to already be an isolated subquery (from
 * `extractParenSubqueries`), so it starts with `SELECT`.
 */
function subqueryProjectsOnlyDates(sql: string): boolean {
  const m = sql.match(/^\s*select\s+(.*?)\s+from\b/is);
  const projection = m ? m[1] : sql;
  return !SUBQUERY_PROJECTION_QUANTITY.test(projection);
}

/**
 * THE combined check `scan()` uses. True when EITHER the whole literal is a
 * flat date-only completion check, OR any subquery nested inside it — most
 * commonly an `EXISTS (SELECT 1 FROM runs ...)` — is one on its own terms,
 * regardless of what the enclosing query additionally projects.
 */
export function isRunCompletionBypass(sql: string): boolean {
  if (selectsRunDayKey(sql) && scopesToOneRunner(sql) && projectsOnlyDates(sql)) return true;
  for (const sub of extractParenSubqueries(sql)) {
    if (!/\bfrom\s+runs\b/i.test(sub)) continue;
    if (selectsRunDayKey(sub) && scopesToOneRunner(sub) && subqueryProjectsOnlyDates(sub)) return true;
  }
  return false;
}

export interface ScanCounts { files: number; literals: number; runSql: number }

/**
 * Walk `dirs` under `root`, extract every SQL string literal, and return the
 * bypass findings plus how much the walk actually read (Rule 18 · a scanner
 * that reads nothing must not report clean).
 */
export function scanExecutionIdentity(
  root: string,
  dirs: string[],
): { findings: Finding[]; counts: ScanCounts } {
  const counts: ScanCounts = { files: 0, literals: 0, runSql: 0 };
  const out: Finding[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try { entries = fs.readdirSync(dir); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e);
      let st: fs.Stats;
      try { st = fs.statSync(p); } catch { continue; }
      if (st.isDirectory()) {
        if (e === 'node_modules' || e === '.next') continue;
        walk(p);
        continue;
      }
      if (!p.endsWith('.ts') && !p.endsWith('.tsx')) continue;
      if (p.includes('.test.')) continue;
      // The resolver IS the owner; it is allowed to write this SQL.
      const rel = path.relative(root, p);
      if (rel === 'lib/execution/day-resolver.ts') continue;
      let src: string;
      try { src = fs.readFileSync(p, 'utf8'); } catch { continue; }
      counts.files += 1;
      for (const raw of extractStringLiterals(src)) {
        counts.literals += 1;
        const sql = raw.replace(/\s+/g, ' ');
        if (/\bFROM\s+runs\b/i.test(sql)) counts.runSql += 1;
        if (!isRunCompletionBypass(sql)) continue;
        out.push({ file: rel, sql: sql.slice(0, 180) });
      }
    }
  };
  for (const d of dirs) walk(path.join(root, d));
  return { findings: out, counts };
}
