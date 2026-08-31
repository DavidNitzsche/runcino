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
import type { NormalWindowExemption } from './normal-window-registry';
import {
  NORMAL_WINDOW_EXEMPTIONS,
  NORMAL_WINDOW_FILE_PINS,
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
      // The FULL normalised statement is kept — a statement-level exemption
      // matches a fingerprint against it, and truncating here would make a
      // fingerprint's validity depend on where the cut fell. Display truncates.
      out.push({ file: path.relative(ROOT, p), sql });
    }
  }
  return out;
}

/**
 * Is this finding excused, and by what?
 *
 * Two shapes, because a file can hold both kinds of reader. `lib/plan/
 * generate.ts` is the case that forced this: its habit readers are filtered
 * and its two injury guards are deliberately not, so excusing the FILE would
 * blind the scanner to the next defect in the file that has produced four.
 *
 *   · a file-level entry (no `statement`) excuses everything in that file;
 *   · a statement-level entry excuses only statements containing its
 *     fingerprint. `NORMAL_WINDOW_FILE_PINS` is the backstop for a fingerprint
 *     written too broadly.
 */
function excuseFor(f: Finding): NormalWindowExemption | undefined {
  return NORMAL_WINDOW_EXEMPTIONS.find(
    (e) => e.file === f.file && (e.statement === undefined || f.sql.includes(e.statement)),
  );
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
    const unexcused = findings.filter((f) => excuseFor(f) === undefined);
    for (const f of unexcused) {
      // eslint-disable-next-line no-console
      console.log(`  NORMALWINDOW  ${f.file}\n     ${f.sql.slice(0, 160)}`);
    }
    expect(
      unexcused.length,
      'A statement that aggregates this runner\'s own runs over a rolling recent window is ' +
      'answering "what does he normally do", and a taper or a post-race recovery block ' +
      'inside that window is the engine measuring a period it prescribed and calling the ' +
      'result his identity (CLAUDE.md Rule 8). Import the filter from ' +
      'lib/training/normal-window.ts — EXCLUDE the window, do not widen it, and refuse ' +
      'rather than answer if too little survives.\n\n' +
      'If the reader is on the OTHER side of Rule 8\'s corollary — if it asks what the ' +
      'runner HAS RECENTLY ABSORBED rather than what he CAN DO — say so in an entry in ' +
      'NORMAL_WINDOW_EXEMPTIONS, and prefer a `statement` fingerprint over a file-level ' +
      'excuse when the file also holds habit readers. If it is answering BOTH questions ' +
      'under one name, SPLIT it, as recentPeakLongMi was split.',
    ).toBe(0);
  });

  it('the file pin holds the total — it cannot grow, and a repair expires it', () => {
    // The backstop behind the statement-level exemptions. A `statement`
    // fingerprint is a substring match, so one written a shade too broadly
    // would silently excuse a future sibling that happens to contain it. The
    // pin asserts the file's TOTAL finding count, excused or not, which is what
    // catches that: the total rises while the unexcused count stays at zero.
    for (const h of NORMAL_WINDOW_FILE_PINS) {
      const n = findings.filter((f) => f.file === h.file).length;
      expect(
        n,
        `${h.file} is pinned at ${h.findings} rolling-window habit reads and the scanner ` +
        `now finds ${n}. If it went DOWN, a repair landed — update or delete this pin, and ` +
        'delete any statement exemption that no longer matches. If it went UP, a new ' +
        'statement appeared in the file with the worst record under this rule; it is NOT ' +
        'covered by the existing exemptions just because it sits beside them.',
      ).toBe(h.findings);
      expect(h.reason.length, `${h.file} pin has no argued reason`).toBeGreaterThan(80);
      expect(readSource(h.file), `${h.file} does not exist`).not.toBeNull();
    }
  });

  it('the allowlist is a ratchet — an exemption nothing trips must be deleted', () => {
    // Per ENTRY, not per file. A statement-level exemption whose fingerprint no
    // longer matches anything is stale even while its file still trips on some
    // OTHER statement — which is exactly what happens when the guard it excuses
    // is repaired or renamed, and is the case a file-level check would miss.
    const stale = NORMAL_WINDOW_EXEMPTIONS.filter(
      (e) => !findings.some(
        (f) => f.file === e.file && (e.statement === undefined || f.sql.includes(e.statement)),
      ),
    );
    expect(
      stale.map((e) => (e.statement ? `${e.file} :: ${e.statement}` : e.file)),
      'Nothing trips these exemptions any more, so they are stale. Delete them — the list ' +
      'may shrink, never grow. A file that now imports the filter has stopped needing an ' +
      'exemption, and a statement fingerprint that matches nothing is a claim about code ' +
      'that no longer exists; keeping either lets a future edit hide behind it.',
    ).toEqual([]);
  });

  it('a statement exemption excuses ONE statement, not its neighbours', () => {
    // The property that makes per-statement excusing safe on a file that also
    // holds habit readers. Each fingerprint must be distinctive enough to pick
    // out a single statement; one that matched several would be a file-level
    // exemption wearing a narrower word.
    for (const e of NORMAL_WINDOW_EXEMPTIONS.filter((x) => x.statement !== undefined)) {
      const matched = findings.filter(
        (f) => f.file === e.file && f.sql.includes(e.statement as string));
      expect(
        matched.length,
        `${e.file} :: ${e.statement} matches ${matched.length} statements. A fingerprint ` +
        'must pick out exactly one; a broader one silently excuses whatever lands beside ' +
        'it. Narrow it, or split it into one entry per statement with its own reason.',
      ).toBe(1);
    }
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
