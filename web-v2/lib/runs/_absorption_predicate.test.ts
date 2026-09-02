/**
 * lib/runs/_absorption_predicate.test.ts · ONE answer to "is this row a
 * dedup loser", and it is not the timestamp.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE FAILURE THIS EXISTS FOR
 *
 * `runs` carries two markers that both look like "this row lost a merge":
 *
 *     data->>'mergedIntoId'          a pointer to the row that won
 *     absorbed_into_canonical_at     a timestamp stamped at absorption
 *
 * They are not the same fact. `merge.ts` clears BOTH when a row is promoted
 * back to canonical, but promotion has not always cleared the stamp, so a row
 * can be canonical — the winner, with siblings pointing `mergedIntoId` at it —
 * and still carry the stamp. `volume.ts` worked this out and named
 * `CANONICAL_ROW_SQL` for it. Eleven other queries did not, and kept the stamp
 * in their WHERE clause as a second, redundant-looking guard.
 *
 * It is not redundant. Measured on production, 2026-08-24, over this runner's
 * 149 canonical rows:
 *
 *     NOT (data ? 'mergedIntoId')                      149 runs   1114.72 mi
 *     ... AND absorbed_into_canonical_at IS NULL       143 runs   1059.55 mi
 *
 * Six runs, 55.17 miles, 4.95% of everything he has run. And the loss is not
 * spread thin — each of those six is the ONLY canonical row for its day, so
 * the day does not shade down, it reads zero:
 *
 *     2026-06-14   13.13 mi -> 0.00        2026-07-07    7.56 mi -> 0.00
 *     2026-06-19    6.45 mi -> 0.00        2026-07-25   18.00 mi -> 0.00
 *     2026-07-06    6.01 mi -> 0.00        2026-08-10    4.02 mi -> 0.00
 *
 * `goal-projection.ts` used the stamp in five queries, three of which ask
 * "did he complete the key session scheduled that day". The answer for the
 * 18-mile long run of 2026-07-25 was no. He ran it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY A LINT AND NOT A RUNTIME GUARD
 *
 * The predicate is SQL text inside template literals. There is no value to
 * intercept and no function to funnel it through — the only thing that can
 * catch the next copy is a scan of the source. So this file is the guard,
 * and it carries its own planted corruption (below) so that a scan which has
 * stopped matching anything cannot report clean.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ALLOWLIST DIRECTION
 *
 * May shrink, may not grow quietly. A file that migrates and stays on the
 * list fails the staleness check.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { CANONICAL_ROW_SQL } from '@/lib/runs/volume';
import { runNotMergedSql } from '@/lib/runs/run-shape';

const WEB = path.resolve(__dirname, '..', '..');
const ROOTS = ['lib', 'app', 'components'];

/** The lowest number of source files a healthy scan sees. A scan that walked
 *  an empty tree would otherwise pass with an empty offender list — that has
 *  shipped in this repo, twice. */
const MIN_FILES_SCANNED = 400;

/**
 * Files allowed to name the stamp in a filter, each with an honest reason.
 *
 * Both entries are WRITE paths to a third party. Loosening them would make
 * six more runs eligible to POST to Strava, and every one of those six has an
 * absorbed Strava twin — the activity is already up there, so the looser
 * predicate would publish a duplicate. That is a real defect in the push
 * eligibility rule (it checks the HUB's own `source`, not its twins'), and it
 * is a separate fix with an external consequence. Until it lands, the
 * stricter predicate is the safer wrong answer.
 */
const ALLOW: Record<string, string> = {
  'lib/strava/push.ts':
    'External write. The date-fallback lookup resolves a legacy push id to a run; ' +
    'including a stale-stamped canonical here could re-POST an activity whose ' +
    'absorbed twin CAME from Strava. Fix the source check on the twins first.',
  'app/api/strava/push-recent/route.ts':
    'External write. Same duplicate-post exposure as push.ts — the eligibility ' +
    'rule reads the hub row\'s own `source`, which is `watch` even when an ' +
    'absorbed twin is the Strava original.',
};

/**
 * Files allowed to name the stamp because they WRITE or CLEAR it. Absorbing a
 * row is exactly when it should be set; promoting one is exactly when it
 * should be cleared. Neither is a reader filter.
 */
const WRITERS = new Set([
  'lib/runs/canonical.ts',
  'lib/runs/merge.ts',
  'lib/strava/pullSync.ts',
]);

function rel(abs: string): string {
  return path.relative(WEB, abs).split(path.sep).join('/');
}

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.next') continue;
        walk(p);
      } else if (/\.tsx?$/.test(e.name) && !e.name.startsWith('._') && !/\.test\.tsx?$/.test(e.name)) {
        out.push(p);
      }
    }
  };
  for (const r of ROOTS) walk(path.join(WEB, r));
  return out;
}

/**
 * Strip comments before scanning — JavaScript's AND SQL's.
 *
 * A comment that quotes the bad predicate in order to explain why it is bad
 * must not read as the bad predicate. Every file changed on 2026-08-24 does
 * exactly that, including `volume.ts`, whose whole header is an argument
 * against the stamp.
 *
 * The SQL form is not hypothetical and this check found it on itself: the
 * migrated queries carry a `--` note where the clause used to be, INSIDE the
 * template literal, so no JavaScript comment rule can see it. A scanner that
 * only knows one language's comments will read the other's as code.
 *
 * `--` is only treated as a comment at the start of a line. Mid-expression it
 * is JavaScript's decrement operator.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/^[ \t]*--[^\n]*/gm, ' ');
}

/**
 * Does this file filter on the stamp?
 *
 * Matches across newlines on purpose. The predicate is written inside
 * multi-line SQL template literals and a line-anchored pattern would miss
 * every real instance — a single-line grep has produced a false clean in this
 * repo before.
 */
export function filtersOnAbsorptionStamp(src: string): boolean {
  const code = stripComments(src);
  return /absorbed_into_canonical_at\s+IS\s+NULL/i.test(code)
      || /absorbed_into_canonical_at\s+IS\s+NOT\s+NULL/i.test(code);
}

describe('absorption predicate · the loser marker is mergedIntoId', () => {
  it('the two spellings of the canonical predicate say the same thing', () => {
    // `CANONICAL_ROW_SQL` (volume.ts) and `runNotMergedSql()` (run-shape.ts)
    // are the same predicate written twice. If they ever drift, the reader
    // layer has two opinions about what a canonical row is, which is the
    // whole failure one level up.
    const normalise = (s: string) => s.replace(/\s+/g, ' ').trim().toUpperCase();
    expect(normalise(CANONICAL_ROW_SQL)).toBe(normalise(runNotMergedSql()));
    expect(normalise(runNotMergedSql('r'))).toBe("NOT (R.DATA ? 'MERGEDINTOID')");
  });

  it('no reader filters on absorbed_into_canonical_at', () => {
    const files = sourceFiles();
    expect(files.length,
      'the scan walked almost nothing. An empty walk reports clean, which is worse ' +
      'than reporting a violation.',
    ).toBeGreaterThanOrEqual(MIN_FILES_SCANNED);

    const offenders: string[] = [];
    let inspected = 0;
    for (const file of files) {
      const r = rel(file);
      if (WRITERS.has(r) || ALLOW[r]) continue;
      inspected++;
      if (filtersOnAbsorptionStamp(fs.readFileSync(file, 'utf8'))) offenders.push(r);
    }

    console.log(`\n=== ABSORPTION STAMP · ${inspected} files inspected, ` +
                `${Object.keys(ALLOW).length} allowed, ${offenders.length} new ===`);
    for (const o of offenders) console.log(`  ${o}`);

    expect(inspected).toBeGreaterThanOrEqual(MIN_FILES_SCANNED - WRITERS.size - Object.keys(ALLOW).length);
    expect(offenders,
      'a query is filtering on absorbed_into_canonical_at. The stamp survives a ' +
      'promotion back to canonical: six of this runner\'s canonical rows carry a ' +
      'stale one, and filtering on it zeroes those days rather than shading them. ' +
      'Use CANONICAL_ROW_SQL / runNotMergedSql(). If the query genuinely needs the ' +
      'stamp, add an allowlist entry with an honest reason.',
    ).toEqual([]);
  });

  it('the scanner catches a planted corruption', () => {
    // The floor on what the scan can see. A scanner that has stopped matching
    // — a renamed column, a regex that lost its multi-line flag, a strip step
    // that ate the SQL — passes the check above with an empty list and no
    // sign anything is wrong. These four shapes are the ones that have really
    // appeared in this file's history.
    const PLANTED: Array<[string, string]> = [
      ['single line', "`SELECT 1 FROM runs WHERE absorbed_into_canonical_at IS NULL`"],
      ['multi-line SQL literal', '`SELECT id\n   FROM runs\n  WHERE user_uuid = $1\n    AND absorbed_into_canonical_at IS NULL`'],
      ['lower case with odd spacing', '`... and   absorbed_into_canonical_at   is   null ...`'],
      ['the NOT NULL direction', '`SELECT 1 FROM runs WHERE absorbed_into_canonical_at IS NOT NULL`'],
    ];
    for (const [label, src] of PLANTED) {
      expect(filtersOnAbsorptionStamp(src), `planted corruption not caught · ${label}`).toBe(true);
    }
  });

  it('the scanner does not fire on prose that argues against the stamp', () => {
    // The negative control. Every file this rule touched carries a comment
    // quoting the predicate in order to explain why it is wrong. A scanner
    // that flagged those would be un-silenceable and would be deleted, which
    // is how a guard dies.
    const PROSE = [
      '/* absorbed_into_canonical_at IS NULL would wrongly drop the canonical. */',
      '// Do not filter on absorbed_into_canonical_at IS NULL — see volume.ts.',
      '/**\n * SELECT ... WHERE absorbed_into_canonical_at IS NULL is the bug.\n */',
      // The SQL-comment form, inside a template literal, which this check
      // caught on its own migrated queries. No JavaScript comment rule sees it.
      'const q = `SELECT id FROM runs\n  WHERE user_uuid = $1\n    -- absorbed_into_canonical_at IS NULL was here and is wrong\n    AND NOT (data ? \'mergedIntoId\')`;',
    ];
    for (const p of PROSE) {
      expect(filtersOnAbsorptionStamp(p), `false positive on prose · ${p.slice(0, 40)}`).toBe(false);
    }
    // ... and prose does not disarm real code that follows it.
    expect(filtersOnAbsorptionStamp(
      '/* never do this */\nconst q = `SELECT 1 FROM runs WHERE absorbed_into_canonical_at IS NULL`;',
    )).toBe(true);
  });

  it('the allowlist has no stale entries', () => {
    const stale: string[] = [];
    for (const [file, reason] of Object.entries(ALLOW)) {
      const abs = path.join(WEB, file);
      if (!fs.existsSync(abs)) { stale.push(`${file} — file is gone (${reason})`); continue; }
      if (!filtersOnAbsorptionStamp(fs.readFileSync(abs, 'utf8'))) {
        stale.push(`${file} — migrated, delete this entry (${reason})`);
      }
    }
    expect(stale, 'the allowlist may shrink; a migrated file must be removed from it').toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * IDENTITY-1 · an identity lookup names the canonical population
 *
 * The sibling half of the rule above, and the half nothing watched.
 *
 * `runIdentityMatchSql` answers "WHICH run" and its own doc comment says so:
 * "callers add their own `user_uuid` and canonical-row predicates: this
 * fragment answers 'which run', never 'whose' (Rule 14 stays the caller's to
 * state)." A sentence in a doc comment is documentation, not enforcement
 * (Rule 20's corollary), and on 2026-09-02 one of its two callers had not
 * stated it.
 *
 * What that cost, measured on production the same day with `faff_readonly`:
 *
 *   274 rows for the reference runner · 156 canonical · 118 MERGED LOSERS
 *   0 of the 118 loser id strings also match a canonical row, so every one of
 *     them resolved to the LOSER in `loadRunDetail`, deterministically.
 *   Against the canonical survivor those losers differ on splits (44 of 118 —
 *     most carrying ZERO splits against 5-13 on the survivor), average heart
 *     rate (54), shoe (66) and elevation (58).
 *
 * `/api/runs/19966462921` — Strava's id for the 2026-08-30 13.49 mi long run —
 * drew 0 splits, no average HR, 124 ft of climb and no weather. The canonical
 * row for that same physical run carries 13 splits, 159 bpm, 230 ft and
 * weather. One run, two answers, and the screen drew the discarded half.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ────────────────────────────────────
 *
 *  1. A query that reaches `runs` by identity WITHOUT calling the shared
 *     fragment. It keys on the fragment's name, so a hand-typed
 *     `data->>'activityId' = $2` is invisible here. `_run_shape_lint.test.ts`
 *     is what pushes callers onto the fragment; this file assumes that worked.
 *  2. Whether following `mergedIntoId` returns the RIGHT canonical row. It
 *     checks that the population is named, not that the pointer is sound.
 *  3. Anything about the runner scope. `user_uuid` is Rule 14's other half
 *     and has its own scanners.
 *  4. Multi-hop pointer chains. None exist today (checked: 0 rows whose
 *     mergedIntoId target is itself absorbed) and nothing here would notice
 *     if one appeared.
 * ══════════════════════════════════════════════════════════════════════════ */

/** The shared fragment whose callers this rule watches. */
const IDENTITY_FRAGMENT = 'runIdentityMatchSql(';

/** Either spelling of the one canonical predicate. `CANONICAL_ROW_SQL` is
 *  re-exported by run-shape.ts, so both names reach the same string, and the
 *  first test in this file already proves the two agree. */
const CANONICAL_MARKERS = ['CANONICAL_ROW_SQL', 'runNotMergedSql'];

/**
 * Every backtick template literal in a source file, un-nested.
 *
 * Crude on purpose: it tracks backticks and `${`/`}` depth and nothing else,
 * because the only thing it has to get right is "which SQL string is this
 * `${runIdentityMatchSql('$2')}` sitting inside". Escaped backticks are
 * honoured; a backtick inside a `//` comment is not, which is why the caller
 * strips comments first.
 */
function templateLiterals(src: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    if (src[i] !== '`') { i++; continue; }
    let j = i + 1;
    let depth = 0;
    while (j < src.length) {
      const c = src[j];
      if (c === '\\') { j += 2; continue; }
      if (depth === 0 && c === '`') break;
      if (c === '$' && src[j + 1] === '{') { depth++; j += 2; continue; }
      if (depth > 0 && c === '}') { depth--; j++; continue; }
      j++;
    }
    out.push(src.slice(i + 1, j));
    i = j + 1;
  }
  return out;
}

/**
 * Statements allowed to call the identity fragment WITHOUT the canonical
 * predicate, keyed on a fingerprint of the statement itself rather than the
 * file — a file can legitimately hold both shapes, and `run-state.ts` does.
 *
 * RATCHET. May shrink, never grow, and a fingerprint that no longer matches
 * an unguarded statement fails as stale.
 */
const IDENTITY_ALLOW: Array<{ file: string; statement: string; reason: string }> = [
  {
    file: 'lib/runs/canonical-ref.ts',
    statement: 'AS merged_into_id',
    reason:
      'Rung 2 of resolveCanonicalRunRowId, the resolver this rule exists to point ' +
      'callers at. This statement exists PRECISELY to find a merged loser — it is how a ' +
      'stale Strava id keeps resolving instead of 404ing. It reads the POINTER and no run ' +
      'data; the row handed back is fetched by rung 3 below it, which does carry ' +
      'CANONICAL_ROW_SQL. Adding the predicate here would make the rung unreachable and ' +
      're-404 all 118 of the reference runner\'s absorbed ids.',
  },
];

describe('IDENTITY-1 · a lookup by run id names the canonical population', () => {
  const scanned = sourceFiles();

  function unguardedStatements(): Array<{ file: string; sql: string }> {
    const out: Array<{ file: string; sql: string }> = [];
    for (const abs of scanned) {
      const src = fs.readFileSync(abs, 'utf8');
      if (!src.includes(IDENTITY_FRAGMENT)) continue;
      for (const sql of templateLiterals(stripComments(src))) {
        if (!sql.includes(IDENTITY_FRAGMENT)) continue;
        if (CANONICAL_MARKERS.some((m) => sql.includes(m))) continue;
        out.push({ file: rel(abs), sql });
      }
    }
    return out;
  }

  /** Every statement that calls the fragment, guarded or not — the liveness
   *  denominator. A scan that stopped matching would read zero here. */
  function allIdentityStatements(): Array<{ file: string; sql: string }> {
    const out: Array<{ file: string; sql: string }> = [];
    for (const abs of scanned) {
      const src = fs.readFileSync(abs, 'utf8');
      if (!src.includes(IDENTITY_FRAGMENT)) continue;
      for (const sql of templateLiterals(stripComments(src))) {
        if (sql.includes(IDENTITY_FRAGMENT)) out.push({ file: rel(abs), sql });
      }
    }
    return out;
  }

  it('the scan reads real source and really finds the fragment', () => {
    expect(scanned.length,
      'the walk saw almost nothing. An empty walk reports clean, which is the worst ' +
      'outcome available because it also reports confidence.',
    ).toBeGreaterThanOrEqual(MIN_FILES_SCANNED);

    const all = allIdentityStatements();
    console.log(`\n=== IDENTITY-1 · ${scanned.length} files walked, ` +
                `${all.length} statements call ${IDENTITY_FRAGMENT} ===`);
    for (const s of all) console.log(`  ${s.file}`);
    // Three today: loadRunDetail's canonical rung, loadRunDetail's absorbed
    // rung, and lib/postrun/load.ts. Zero means the extractor or the fragment
    // name has moved and this whole block has quietly stopped meaning anything.
    expect(all.length,
      'no statement calls runIdentityMatchSql. Either the fragment was renamed or the ' +
      'template-literal extractor no longer sees SQL — either way this rule is dark.',
    ).toBeGreaterThanOrEqual(3);
  });

  it('every identity lookup carries the canonical predicate, or an argued exemption', () => {
    const findings = unguardedStatements()
      .filter((f) => !IDENTITY_ALLOW.some(
        (a) => a.file === f.file && f.sql.includes(a.statement),
      ));
    expect(findings.map((f) => `${f.file} :: ${f.sql.replace(/\s+/g, ' ').trim().slice(0, 120)}`),
      'a query resolves a run BY ID and never says which rows it will accept. ' +
      '43% of the reference runner\'s rows are merge losers and every loser id is ' +
      'unique to the loser, so this is not a rare edge — it is the common case. ' +
      'Add `AND ${CANONICAL_ROW_SQL}`; if the id must still resolve, follow ' +
      'data.mergedIntoId to the survivor the way loadRunDetail does.',
    ).toEqual([]);
  });

  it('the identity allowlist is a ratchet with no stale entries', () => {
    const unguarded = unguardedStatements();
    // Breadth is measured against EVERY identity statement in the file, not
    // only the unguarded ones. Measuring against the unguarded set alone
    // cannot see an over-broad fingerprint while a file holds exactly one
    // unguarded statement — which is the situation here, and which is how
    // falsifier F4 initially passed with the fingerprint widened to
    // 'FROM runs'. Rule 18 point 3: the exemption must excuse the violating
    // statement and nothing else.
    const all = allIdentityStatements();
    const stale: string[] = [];
    for (const a of IDENTITY_ALLOW) {
      expect(a.reason.length, `${a.file} exemption is too thin to be an argument`)
        .toBeGreaterThan(80);
      const breadth = all.filter((u) => u.file === a.file && u.sql.includes(a.statement));
      const hit = unguarded.filter((u) => u.file === a.file && u.sql.includes(a.statement));
      if (breadth.length > 1) {
        stale.push(`${a.file} :: fingerprint matches ${breadth.length} identity statements — narrow it`);
      } else if (hit.length === 0) {
        stale.push(`${a.file} :: the exempted statement is guarded or gone — delete this entry`);
      }
    }
    expect(stale, 'an exemption excuses exactly one live statement, or it goes').toEqual([]);
  });

  it('the extractor sees both shapes it has to see', () => {
    // Falsification floor, both directions, on the two literal shapes that
    // really occur. A guarded statement must NOT read as a finding and an
    // unguarded one MUST — an extractor that returned [] would pass the
    // second test above with an empty list and no sign anything was wrong.
    const GUARDED =
      "const q = `SELECT id FROM runs\n  WHERE user_uuid = $1\n    AND ${runIdentityMatchSql('$2')}"
      + '\n    AND ${CANONICAL_ROW_SQL}\n  LIMIT 1`;';
    const UNGUARDED =
      "const q = `SELECT id FROM runs\n  WHERE user_uuid = $1\n    AND ${runIdentityMatchSql('$2')}"
      + '\n  LIMIT 1`;';
    const litsG = templateLiterals(stripComments(GUARDED));
    const litsU = templateLiterals(stripComments(UNGUARDED));
    expect(litsG.length, 'the extractor found no template literal at all').toBe(1);
    expect(litsU.length, 'the extractor found no template literal at all').toBe(1);
    expect(litsG[0].includes(IDENTITY_FRAGMENT)).toBe(true);
    expect(CANONICAL_MARKERS.some((m) => litsG[0].includes(m)),
      'a guarded statement read as unguarded — the rule would cry wolf and be deleted',
    ).toBe(true);
    expect(litsU[0].includes(IDENTITY_FRAGMENT)).toBe(true);
    expect(CANONICAL_MARKERS.some((m) => litsU[0].includes(m)),
      'an unguarded statement read as guarded — the rule cannot fail',
    ).toBe(false);
  });
});
