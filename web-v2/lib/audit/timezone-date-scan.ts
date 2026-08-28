/**
 * lib/audit/timezone-date-scan.ts · finds a bare `<timestamptz column>::date`
 * cast — the exact shape behind the 2026-08-27 incident.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * THE INCIDENT
 *
 * A treadmill run completed 4:43pm-5:12pm Pacific on 2026-08-27 was stored as
 * `ts = 2026-08-28 00:12:28 UTC` in `coach_intents` (`ts` is `timestamp with
 * time zone`). A backend query compared `ts::date = $2::date` where `$2` was
 * the runner's LOCAL "today" (2026-08-27). `ts::date` reads the UTC calendar
 * date — 2026-08-28 — so the comparison silently never matched, and a whole
 * card on the phone ("On the belt: speed/incline") rendered blank. No error,
 * no log line — an honest-looking `null` where a real reading belonged.
 *
 * The same shape had already fired on this column, and on `recorded_at`,
 * `logged_at`, and `cleared_at`, in a dozen other places before this file
 * existed — see the fix sweep that added this gate on 2026-08-27.
 *
 * David's directive, verbatim: "we've been dealing with time zone issues this
 * whole build. Time zone issues should NEVER ever EVER happen. Ever. No
 * excuses." That is why this gate is a hard zero, not a ratchet — contrast
 * `swallow-scan.ts`'s EMPTIED tier, which inherited too large a legacy to
 * zero out at once. This bug class has no such legacy to forgive.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHAT COUNTS AS A VIOLATION
 *
 * One of the six confirmed-`timestamp with time zone` columns — `ts`,
 * `recorded_at`, `logged_at`, `cleared_at`, `created_at`, `fetched_at` — cast
 * directly to `::date` with no `AT TIME ZONE` conversion first. The column is
 * server-UTC at that point; casting straight to `::date` reads the UTC
 * calendar day, which is silently the wrong day for any runner not on UTC and
 * any moment within their evening window each side of UTC midnight.
 *
 * The fix, established throughout this codebase before this gate existed
 * (`lib/training/goal-projection.ts`, `lib/training/vdot-inputs.ts`,
 * `lib/coach/acknowledge.ts`): resolve the runner's IANA timezone via
 * `runnerTimezone(userId)` and convert the column first —
 * `(col AT TIME ZONE $N::text)::date`. That rewrite never produces the literal
 * substring `col::date` (the column is followed by ` AT TIME ZONE …`, not
 * `::date`), so a plain "does this substring exist" scan is already sufficient
 * — the `AT TIME ZONE` lookback below is a second, redundant check kept for
 * the case where a future refactor puts distance between the column and the
 * cast.
 *
 * WHAT DOES NOT COUNT — these columns are plain `date` already, with no
 * time-of-day component to mis-shift: `sample_date`, `snapshot_date`,
 * `date_iso`, `week_start_iso`, and any `(meta->>'date')::date` /
 * `(data->>'date')::date` pulled out of a jsonb text field. None of those
 * names appear in `DANGEROUS_COLUMNS`, so they never match.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHY THIS DOESN'T REUSE `swallow-scan.ts`'s `maskSource`
 *
 * `maskSource` blanks comments AND the contents of every string/template
 * literal — correct for swallow-scan, which only cares about the surrounding
 * JS control flow (is this a `.catch`, is the handler blind), never about what
 * the SQL inside the template literal says. This scanner is the opposite: the
 * pattern it hunts for lives INSIDE the SQL, which lives inside backtick
 * template literals. Blanking those would blank the only place a real
 * violation can appear. `maskCommentsOnly` below strips `//` and `/* *‍/`
 * comments (where the false positives actually are — this file's own sibling
 * fixes left plenty of prose like "was a bare ts::date, same UTC-shift bug")
 * and leaves every string and template literal untouched.
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * Confirmed via `information_schema.columns` against the live database as
 * `timestamp with time zone`. Any bare `<col>::date` on one of these is the
 * bug. See the module doc for the columns that are safe and excluded on
 * purpose (`sample_date`, `date_iso`, jsonb-extracted date strings, …).
 */
export const DANGEROUS_COLUMNS = [
  'ts',
  'recorded_at',
  'logged_at',
  'cleared_at',
  'created_at',
  'fetched_at',
] as const;

const PATTERN = new RegExp(`\\b(${DANGEROUS_COLUMNS.join('|')})::date\\b`, 'g');

/** How far back to look for a redeeming `AT TIME ZONE` before flagging a hit.
 *  Belt-and-suspenders — see the module doc for why the substring match alone
 *  already can't fire on correctly-converted SQL. */
const AT_TIME_ZONE_LOOKBACK = 80;

export interface TimezoneDateSite {
  /** Repo-relative path. */
  file: string;
  /** 1-based line number in the ORIGINAL (unmasked) source. */
  line: number;
  /** Which dangerous column matched. */
  column: string;
  /** The offending source line, trimmed, for the failure message. */
  snippet: string;
  /** `<file>::<line>` — an exemption key. Not a function name: every hit here
   *  is a bare SQL fragment, not a resolvable JS symbol, and unlike a line
   *  number this at least survives a `git mv`. Still expected to be re-argued
   *  on every edit to the line — see the registry file. */
  id: string;
}

/**
 * Blank `//` and `/* *‍/` comments, PLUS `-- ` SQL line comments while inside
 * the literal-text portion of a template literal (never inside its `${…}`
 * interpolations, which are real JS). SQL prose is the other place this
 * pattern's own bug-history documentation lives — every query fixed by the
 * 2026-08-27 sweep carries a `-- was ts::date, same UTC-shift bug` note right
 * next to the fix, and those notes are exactly the false positives a scan
 * that only understood `//` and `/* *‍/` would trip on. Strings and the
 * non-comment portions of template literals are left byte-for-byte intact —
 * see the module doc for why.
 */
export function maskCommentsOnly(src: string): string {
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
    // template literal — skip over WITHOUT blanking (except SQL `--`
    // comments in the literal-text zone), tracking `${…}` depth only so a
    // nested backtick inside an interpolation can't end it early.
    if (c === '`') {
      let j = i + 1;
      const depths: number[] = [];
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (depths.length === 0 && src[j] === '`') break;
        if (src[j] === '$' && src[j + 1] === '{') { depths.push(1); j += 2; continue; }
        if (depths.length > 0) {
          if (src[j] === '{') depths[depths.length - 1]++;
          else if (src[j] === '}') {
            depths[depths.length - 1]--;
            if (depths[depths.length - 1] === 0) depths.pop();
          }
          j++;
          continue;
        }
        // literal-text zone (not inside `${…}`) — a `--` here is a SQL line
        // comment, not JS decrement (which cannot appear in template text).
        if (src[j] === '-' && src[j + 1] === '-') {
          let k = j;
          while (k < n && src[k] !== '\n' && src[k] !== '`') k++;
          blank(j, k);
          j = k;
          continue;
        }
        j++;
      }
      i = j + 1;
      continue;
    }
    // quoted strings — left intact, cannot span a newline
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        j++;
      }
      i = j + 1;
      continue;
    }
    i++;
  }
  return out.join('');
}

/** 1-based line number of a byte offset. */
function lineAt(src: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) if (src[i] === '\n') line++;
  return line;
}

const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build', '.git']);

export function walkTs(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walkTs(full, out); continue; }
    if (e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/** Scans one file's already-read source. Exported so fixtures can drive it
 *  directly without touching disk. `file` is only used to label the sites. */
export function scanSourceForTimezoneDateBug(file: string, src: string): TimezoneDateSite[] {
  const masked = maskCommentsOnly(src);
  const sites: TimezoneDateSite[] = [];
  PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PATTERN.exec(masked))) {
    const before = masked.slice(Math.max(0, m.index - AT_TIME_ZONE_LOOKBACK), m.index);
    if (/AT\s+TIME\s+ZONE/i.test(before)) continue;
    const line = lineAt(masked, m.index);
    sites.push({
      file,
      line,
      column: m[1],
      snippet: (src.split('\n')[line - 1] ?? m[0]).trim(),
      id: `${file}::${line}`,
    });
  }
  return sites;
}

export interface TimezoneDateScanResult {
  filesScanned: number;
  sites: TimezoneDateSite[];
}

/** Files this scanner does not scan itself — the module doc's own prose
 *  quotes the dangerous pattern several times over, and a self-referential
 *  gate that flags its own documentation is a false alarm every time either
 *  file is edited. `.test.ts` files are excluded by extension, universally —
 *  the same posture `_swallow_scan.test.ts` takes toward fixtures. */
const SELF_EXCLUDED = new Set(['lib/audit/timezone-date-scan.ts']);

export function scanTreeForTimezoneDateBug(root: string): TimezoneDateScanResult {
  const files = walkTs(root)
    .map((f) => path.relative(root, f))
    .filter((rel) => !rel.endsWith('.test.ts') && !SELF_EXCLUDED.has(rel));

  const sites: TimezoneDateSite[] = [];
  for (const rel of files) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    sites.push(...scanSourceForTimezoneDateBug(rel, src));
  }
  return { filesScanned: files.length, sites };
}
