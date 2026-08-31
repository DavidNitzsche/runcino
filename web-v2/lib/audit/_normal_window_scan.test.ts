/**
 * NORMALWINDOW-1 · RULE 8 · a habit reader excludes the taper, or argues why not.
 *
 * See `normal-window-registry.ts` for the bug class and the six defects it has
 * already produced. In short: the engine measures the runner during a period IT
 * told him to go easy, and reports the result as his training identity. The
 * plan then sizes his next block off his own taper.
 *
 * This is a SCANNER plus a curated registry, for the reason the rest of the
 * apparatus keeps proving: every existing gate samples the OUTPUT and asks
 * whether each point is legal, and a number measured over the wrong window is
 * perfectly legal. Nothing fails. The defect is only visible in the window.
 *
 * TWO LANES, because one is not enough:
 *
 *   · The SCANNER finds SQL that aggregates the runner's own `runs` over a
 *     rolling recent window. Such a file must import the shared filter or carry
 *     an argued exemption. This lane catches a reader nobody thought to
 *     register — including one added next year by someone who never read
 *     Rule 8.
 *   · The REGISTRY carries the habit readers the scanner CANNOT see, which is
 *     most of the important ones: they pull rows through `mileageByDay` and
 *     aggregate in TypeScript, so there is no SQL to key on. Four of Rule 8's
 *     six defects are that shape. The registry asserts each is still where it
 *     says it is and still on the side of the line it claims.
 *
 * Both allowlists are RATCHETS: they may shrink, never grow. An exemption whose
 * file no longer trips the scanner FAILS until it is deleted.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { extractStringLiterals } from './sql-scan';
import {
  NORMAL_WINDOW_EXEMPTIONS,
  NORMAL_WINDOW_HANDOFF,
  HABIT_READERS,
} from './normal-window-registry';

const ROOT = path.resolve(__dirname, '..', '..');
const DIRS = ['lib', 'app', 'scripts'];

/** The shared filter. A file that imports this has made the choice explicitly. */
const FILTER_MODULE = 'lib/training/normal-window';

/**
 * A rolling RECENT window — a date floor expressed relative to now, rather than
 * a fixed range a caller passed in. This is what makes a read a claim about the
 * runner's current normal rather than about one named stretch of history.
 */
const ROLLING_WINDOW = /NOW\(\)\s*-|CURRENT_DATE\s*-|::date\s*-\s*\$|::date\s*-\s*\d|interval\s*'/i;

/** A habit aggregate — one number standing for many days. */
const HABIT_AGGREGATE = /percentile_cont|\bAVG\s*\(|\bSUM\s*\(|\bMAX\s*\(/i;

interface Finding { file: string; sql: string }

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!/node_modules|\.next|\.git/.test(p)) walk(p);
        continue;
      }
      if (!/\.(ts|tsx|mjs|js)$/.test(p) || p.includes('.test.')) continue;
      out.push(p);
    }
  };
  for (const d of DIRS) walk(path.join(ROOT, d));
  return out;
}

function scan(): Finding[] {
  const out: Finding[] = [];
  for (const p of sourceFiles()) {
    let src: string;
    try { src = fs.readFileSync(p, 'utf8'); } catch { continue; }
    // A file that imports the shared filter has answered the question. It may
    // filter one leg and deliberately not another (adapt.ts does exactly that,
    // and says why); the gate's job is to make the choice explicit, not to
    // second-guess which leg.
    if (src.includes(FILTER_MODULE)) continue;
    for (const raw of extractStringLiterals(src)) {
      const sql = raw.replace(/\s+/g, ' ');
      if (!/FROM\s+runs\b/i.test(sql)) continue;
      if (!ROLLING_WINDOW.test(sql)) continue;
      if (!HABIT_AGGREGATE.test(sql)) continue;
      out.push({ file: path.relative(ROOT, p), sql: sql.slice(0, 160) });
    }
  }
  return out;
}

const readSource = (rel: string): string | null => {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return null; }
};

describe('NORMALWINDOW-1 · a habit reader excludes the taper', () => {
  const findings = scan();
  const exemptFiles = new Set(NORMAL_WINDOW_EXEMPTIONS.map((e) => e.file));

  it('the scanner still reads real source — a silent zero would prove nothing', () => {
    // Two gates in this repo have shipped reporting clean because they scanned
    // zero files (`check-modelled-mark.sh` created the tree it audited). If the
    // directory layout or `extractStringLiterals` changes underneath this test,
    // every assertion below passes vacuously. So: prove the walk reaches the
    // tree, prove literal extraction still works, and prove the predicate
    // still fires on a statement known to be exactly the shape it hunts.
    expect(sourceFiles().length, 'the file walk found nothing').toBeGreaterThan(500);

    const known = readSource('lib/coach/runner-calibration.ts');
    expect(known, 'lib/coach/runner-calibration.ts is gone — repoint this probe').not.toBeNull();
    const literals = extractStringLiterals(known as string);
    expect(literals.length, 'extractStringLiterals returned nothing').toBeGreaterThan(0);

    const positives = literals
      .map((s) => s.replace(/\s+/g, ' '))
      .filter((sql) =>
        /FROM\s+runs\b/i.test(sql) && ROLLING_WINDOW.test(sql) && HABIT_AGGREGATE.test(sql));
    expect(
      positives.length,
      'the scanner predicate no longer matches peakWeekMi, a statement chosen because it ' +
      'is exactly the shape this gate hunts. The predicate is broken, not the codebase.',
    ).toBeGreaterThan(0);
  });

  it('no unguarded, unexempted habit read over a rolling window', () => {
    const handoffFiles = new Set(NORMAL_WINDOW_HANDOFF.map((h) => h.file));
    const unexcused = findings.filter(
      (f) => !exemptFiles.has(f.file) && !handoffFiles.has(f.file));
    for (const f of unexcused) {
      // eslint-disable-next-line no-console
      console.log(`  NORMALWINDOW  ${f.file}\n     ${f.sql}`);
    }
    expect(
      unexcused.length,
      'A statement that aggregates this runner\'s own runs over a rolling recent window is ' +
      'answering "what does he normally do", and a taper or a post-race recovery block ' +
      'inside that window is the engine measuring a period it prescribed and calling the ' +
      'result his identity (CLAUDE.md Rule 8). Import the filter from ' +
      'lib/training/normal-window.ts — EXCLUDE the window, do not widen it, and refuse ' +
      'rather than answer if too little survives — or add an argued entry to ' +
      'NORMAL_WINDOW_EXEMPTIONS saying why this reader is right as it stands.',
    ).toBe(0);
  });

  it('the hand-off is count-pinned — it cannot grow, and a fix expires it', () => {
    // Not an allowlist. A hand-off names a file that is unguarded and KNOWN to
    // be, pinned to its exact finding count so it fails in both directions: a
    // fifth offender added to the file fails the build, and the repair landing
    // fails it too, which is what forces the entry to be deleted rather than
    // left to rot. See the note above NORMAL_WINDOW_HANDOFF.
    for (const h of NORMAL_WINDOW_HANDOFF) {
      const n = findings.filter((f) => f.file === h.file).length;
      expect(
        n,
        `${h.file} is pinned at ${h.findings} unguarded habit reads and the scanner now ` +
        `finds ${n}. If it went DOWN, the repair landed — delete this hand-off entry ` +
        '(and register the repaired readers in HABIT_READERS). If it went UP, a new ' +
        'unguarded habit reader was added to a file that was already known to be broken; ' +
        'the hand-off is not cover for new work.',
      ).toBe(h.findings);
      expect(h.reason.length, `${h.file} hand-off has no argued reason`).toBeGreaterThan(80);
      expect(readSource(h.file), `${h.file} does not exist`).not.toBeNull();
    }
  });

  it('the allowlist is a ratchet — an exemption whose file is now clean must be deleted', () => {
    const flagged = new Set(findings.map((f) => f.file));
    const stale = NORMAL_WINDOW_EXEMPTIONS.filter((e) => !flagged.has(e.file));
    expect(
      stale.map((e) => e.file),
      'These files no longer trip the scanner, so their exemptions are stale. Delete them ' +
      '— the list may shrink, never grow. A file that now imports the filter has stopped ' +
      'needing an exemption; keeping one lets a future edit hide behind it.',
    ).toEqual([]);
  });

  it('every exemption carries a real reason, not a shrug', () => {
    for (const e of NORMAL_WINDOW_EXEMPTIONS) {
      expect(e.reason.length, `${e.file} has no argued reason`).toBeGreaterThan(80);
      expect(e.reason, `${e.file}'s reason is a shrug`).not.toMatch(/^(ok|fine|safe|n\/a)\b/i);
      expect(readSource(e.file), `${e.file} does not exist — delete its exemption`).not.toBeNull();
    }
  });

  it('every registered habit reader still exists where it says it does', () => {
    // Liveness for the lane the scanner cannot see. A rename or a deletion must
    // force the registry to be re-read rather than quietly retiring the claim.
    for (const r of HABIT_READERS) {
      const src = readSource(r.file);
      expect(src, `${r.file} is gone — update HABIT_READERS`).not.toBeNull();
      expect(
        (src as string).includes(r.symbol),
        `${r.file} no longer contains \`${r.symbol}\`. If it was renamed, update the ` +
        'registry; if it was deleted, delete the entry. Do not leave a claim pointing at ' +
        'nothing — that is how a gate starts passing for the wrong reason.',
      ).toBe(true);
    }
  });

  it('every reader marked `filtered` actually reaches the shared filter', () => {
    for (const r of HABIT_READERS.filter((x) => x.verdict === 'filtered')) {
      const src = readSource(r.file) ?? '';
      expect(
        src.includes(FILTER_MODULE),
        `${r.file} claims verdict 'filtered' for \`${r.symbol}\` but no longer imports ` +
        `${FILTER_MODULE}. Either the fix was reverted — in which case restore it — or the ` +
        'reader genuinely stopped being a habit reader, in which case change the verdict ' +
        'and say why.',
      ).toBe(true);
    }
  });

  it('every reader marked `exempt` argues it, and none also claims to be filtered', () => {
    for (const r of HABIT_READERS.filter((x) => x.verdict === 'exempt')) {
      expect(r.reason.length, `${r.file}#${r.symbol} has no argued reason`).toBeGreaterThan(80);
      expect(r.window.length, `${r.file}#${r.symbol} does not state its window`).toBeGreaterThan(3);
    }
    // A file cannot be on both sides of the line for the same symbol.
    const seen = new Map<string, string>();
    for (const r of HABIT_READERS) {
      const key = `${r.file}#${r.symbol}`;
      const prior = seen.get(key);
      expect(prior === undefined || prior === r.verdict, `${key} is registered twice with ` +
        'different verdicts').toBe(true);
      seen.set(key, r.verdict);
    }
  });
});
