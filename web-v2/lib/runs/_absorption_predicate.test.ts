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
