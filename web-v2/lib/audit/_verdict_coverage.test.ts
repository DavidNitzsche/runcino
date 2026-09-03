/**
 * lib/audit/_verdict_coverage.test.ts · RULE 22 · COUNT THE CASES ON EACH SIDE.
 *
 * CLAUDE.md Rule 22:
 *
 *     "Check the DISTRIBUTION, not just the count. For any mechanism with
 *      opposing verdicts — hold vs accelerate, pull back vs push, refuse vs
 *      permit, exclude vs admit — count the cases on each side. A large
 *      imbalance is a finding in itself and should be justified or corrected."
 *
 * The rule was locked on a measurement nobody had automated: 29 test files knew
 * how to hold a runner back and 2 knew what accelerating one meant, while 7,294
 * passing tests coexisted with an upward adaptation path that had fired ZERO
 * times in 309 production intents. A census taken once, by hand, in the session
 * that noticed. This makes it a standing check.
 *
 * ── AND IT IMPLEMENTS THE WARNING IN THE SAME RULE ─────────────────────────
 *
 *     "beware the false zero. Counting coverage by grepping a literal action
 *      string reported `progression_gate: 0` on a mechanism with 43 tests
 *      across three files. Verify a coverage claim the way you would verify a
 *      defect — the number that says 'nothing tests this' is exactly the number
 *      worth doubting twice."
 *
 * So every verdict is counted by TWO detectors of different strictness, and a
 * disagreement between them is a FAILURE, not a number. A strict count of zero
 * beside a loose count above zero means the strict detector is wrong, and this
 * file says so rather than reporting the zero.
 *
 * The first draft of this census had exactly that bug, twice, and both are
 * worth recording because they are the two ways a grep lies:
 *
 *   · **False positive.** `grep HOLD` reported 74 test files, because `HOLD` is
 *     a substring of `THRESHOLD`. Every count here is word-bounded.
 *   · **False negative.** An assertion-shaped regex reported 0 assertions for
 *     `readiness_pullback` across 8 files carrying 13 occurrences, because the
 *     mechanism is asserted through object shapes rather than through
 *     `toBe('readiness_pullback')`. That is the exact `progression_gate: 0`
 *     shape the rule warns about.
 *
 * ── WHAT IT MEASURES TODAY  ·  512 test files under lib and app ────────────
 *
 *     ACCELERATE  8   ·  BACK_OFF  3      PROGRESS  17  ·  REGRESS  4
 *     TAKE        4   ·  HOLD     22      REFUSE   17
 *     mark_upgrade 6  ·  downgrade 20     reshape   3   ·  shave   17
 *     progression_gate 2               ·  readiness_pullback 8
 *
 *   canonical engine · PROGRESS against REGRESS      17 v  4  ratio 0.24
 *   canonical engine · moving against not moving     17 v 34  ratio 2.00
 *   progression ladder · ACCELERATE against BACK_OFF  8 v  3  ratio 0.38
 *   progression ladder · TAKE+ACCEL against HOLD+BACK 9 v 22  ratio 2.44
 *   legacy adapt · push against pull back             7 v 31  ratio 4.43
 *
 * Two things follow, and they point in opposite directions. The CANONICAL
 * engine's suite is no longer lopsided — its upward path is better covered than
 * its downward one, which is what the rewrite was for. The LEGACY path, the one
 * Rule 21 actually measured at five downgrades and zero upgrades, is still 4.4
 * to 1 against the push, and that number is pinned here as a defect rather than
 * blessed as a ceiling.
 *
 * ── FALSIFIED, PER RULE 18 ─────────────────────────────────────────────────
 *
 *   · three throwaway test files naming `downgrade` were added under
 *     `lib/plan/`; the ratio moved 4.43 → 4.86 and the ratchet failed, naming
 *     the pair and both counts.
 *   · a verdict present only UNQUOTED was registered, reproducing the false
 *     zero; the two-detector guard failed with "the strict detector reports 0
 *     files and the loose one reports 1. Do not publish the zero."
 *   · `SCAN_DIRS` pointed at a directory that does not exist; liveness failed
 *     with "no test files were scanned: expected 0 to be greater than 300",
 *     rather than reporting a clean, confident, empty census.
 *
 * All three were reverted and the suite returned green.
 *
 * ── RULE 22 · WHAT THIS CENSUS CANNOT FAIL ON ──────────────────────────────
 *
 * · **A test that mentions a verdict without exercising it.** This counts
 *   files, not behaviour. A file that names `ACCELERATE` in a comment and never
 *   produces one is counted as coverage, and there is no cheap way from a
 *   scanner to tell the difference. The count is an UPPER BOUND on coverage,
 *   and it should be read as one: it can prove a blind spot, never prove
 *   coverage.
 * · **The tests being right.** A verdict with twenty files asserting it wrongly
 *   scores twenty.
 * · **An opposing pair nobody registered.** `PAIRS` is hand-maintained. A
 *   mechanism that grows a new verdict is invisible until somebody adds it,
 *   which is the same limitation Rule 22 attributes to the corpus that cannot
 *   ask the question.
 * · **Whether an imbalance is JUSTIFIED.** Rule 22 says doctrine sometimes
 *   licenses one; only a person can say so. `ARGUED_IMBALANCES` is where that
 *   argument is recorded, and like every allowlist in this repo it is a ratchet.
 * · **The engine, as opposed to its tests.** A perfectly balanced test suite
 *   over an engine that only ever refuses still scores clean here. That is what
 *   `scripts/adaptation-real-replay/` is for.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const ROOT = path.resolve(__dirname, '..', '..');
const SCAN_DIRS = ['lib', 'app'];
/** This file names every verdict in the census, so counting it doubles them. */
const SELF = '_verdict_coverage.test.ts';

/* ══════════════════════════════════════════════════════════════════════════
 * THE OPPOSING PAIRS
 * ═══════════════════════════════════════════════════════════════════════ */

interface Pair {
  readonly mechanism: string;
  /** The verdict that makes the plan HARDER. */
  readonly up: readonly string[];
  /** Its opposite number: the verdict that makes it EASIER. */
  readonly down: readonly string[];
  /**
   * The ratio MEASURED when this entry was written or last tightened, as
   * down-files over up-files. Not a ceiling anybody chose — a pin.
   *
   * Both directions are checked. Growing past it by more than `PIN_TOLERANCE`
   * is a regression and fails; falling below it by more than `RATCHET_SLACK`
   * means the pin is stale and must be tightened, so it cannot quietly stop
   * meaning anything.
   */
  readonly measuredRatio: number;
}

const PAIRS: readonly Pair[] = [
  {
    mechanism: 'canonical adaptation engine · lever verdicts',
    up: ['PROGRESS'],
    down: ['REGRESS'],
    // MEASURED 0.24 · 17 push files against 4 pull-back. The canonical
    // engine's upward path is BETTER covered than its downward one, which is
    // the opposite of the legacy path and is the point of the rewrite.
    measuredRatio: 0.24,
  },
  {
    mechanism: 'canonical adaptation engine · moving against not moving',
    up: ['PROGRESS', 'REGRESS'],
    down: ['HOLD', 'REFUSE'],
    // MEASURED 2.00 · 17 moving against 34 not-moving. Not moving is
    // legitimately the commoner outcome; the pin exists to catch a suite that
    // drifts toward testing only refusal.
    measuredRatio: 2.0,
  },
  {
    mechanism: 'progression ladder · accelerate against back off',
    up: ['ACCELERATE'],
    down: ['BACK_OFF'],
    // MEASURED 0.38 · 8 ACCELERATE files against 3 BACK_OFF. This is the pair
    // Rule 22 was locked on, at 2 against 1 in the other direction ("29 files
    // know how to hold a runner back, 2 know what it means to accelerate one"
    // counted HOLD, not BACK_OFF). It has since inverted, and the pin records
    // that rather than blessing a range.
    measuredRatio: 0.38,
  },
  {
    mechanism: 'progression ladder · take against hold',
    up: ['TAKE', 'ACCELERATE'],
    down: ['HOLD', 'BACK_OFF'],
    // MEASURED 2.44 · 9 against 22. This is the pair CLAUDE.md's own census
    // reported as 29 HOLD files against 2 ACCELERATE.
    measuredRatio: 2.44,
  },
  {
    mechanism: 'legacy adapt actions · push against pull back',
    up: ['mark_upgrade', 'progression_gate', 'reshape'],
    down: ['downgrade', 'readiness_pullback', 'shave'],
    /**
     * MEASURED AT 4.43 · 31 pull-back files against 7 push files. This is not a
     * ceiling anybody chose; it is a RATCHET pinned at the defect, in the
     * pattern this repo already uses for `EMPTIED_BASELINE` and
     * `NORMAL_WINDOW_FILE_PINS`.
     *
     * It is the legacy `lib/plan/adapt.ts` path — the one Rule 21 actually
     * measured at five downgrades and zero upgrades across 309 production
     * intents — and its test suite has the same disposition as the engine,
     * which is precisely Rule 22's thesis: "you cannot correct an engine's bias
     * with a test suite that shares it."
     *
     * Recorded rather than blessed. The number may come DOWN; the ratchet
     * below also fails if it comes down and this pin is not tightened, so it
     * cannot quietly stop meaning anything.
     */
    measuredRatio: 4.43,
  },
];

/**
 * An imbalance somebody has argued for, with the doctrine that licenses it.
 *
 * Rule 18 guard 4 · a ratchet. An entry whose pair is now within its ceiling
 * fails until it is deleted. "We might need it" is not a reason.
 */
const ARGUED_IMBALANCES: ReadonlyArray<{
  readonly mechanism: string;
  readonly citation: string;
}> = [];

/* ══════════════════════════════════════════════════════════════════════════
 * THE TWO DETECTORS
 * ═══════════════════════════════════════════════════════════════════════ */

function testFilesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    let entries: string[];
    try { entries = readdirSync(d); } catch { return; }
    for (const e of entries) {
      if (e === 'node_modules' || e.startsWith('._')) continue;
      const p = path.join(d, e);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p);
      else if (e.endsWith('.test.ts') && e !== SELF) out.push(p);
    }
  };
  walk(dir);
  return out;
}

const FILES = SCAN_DIRS.flatMap((d) => testFilesUnder(path.join(ROOT, d)));
const SOURCES = new Map<string, string>(
  FILES.map((f) => [f, (() => { try { return readFileSync(f, 'utf8'); } catch { return ''; } })()]),
);

/**
 * STRICT · the verdict appears as a quoted string literal, which is what an
 * assertion or a fixture actually uses. Word boundaries are irrelevant inside
 * quotes, so this is the precise one.
 */
function strictFiles(verdict: string): string[] {
  const re = new RegExp(`['"\`]${verdict}['"\`]`);
  return [...SOURCES.entries()].filter(([, src]) => re.test(src)).map(([f]) => f);
}

/**
 * LOOSE · the verdict appears as a whole word anywhere, quoted or not. Catches
 * the shapes an assertion regex misses — a symbol import, an object literal
 * key, a table of expectations — at the cost of also catching prose.
 *
 * Word-bounded on purpose. Without it, `HOLD` matches `THRESHOLD` and the
 * census reports 74 files where the truth is a fraction of that.
 */
function looseFiles(verdict: string): string[] {
  const re = new RegExp(`(^|[^A-Za-z0-9_])${verdict}([^A-Za-z0-9_]|$)`);
  return [...SOURCES.entries()].filter(([, src]) => re.test(src)).map(([f]) => f);
}

const count = (verdicts: readonly string[], fn: (v: string) => string[]): number =>
  new Set(verdicts.flatMap(fn)).size;

const ALL_VERDICTS = [...new Set(PAIRS.flatMap((p) => [...p.up, ...p.down]))];

/**
 * How far a pair may improve before the pin has to be tightened.
 *
 * Not zero, because one file moving in or out of scope should not fail the
 * build; large enough that a real improvement is noticed and recorded rather
 * than quietly widening the gate's own slack.
 */
const RATCHET_SLACK = 0.5;

/**
 * How far a pair may drift the WRONG way before it is a finding.
 *
 * Not zero, because one test file arriving on the pull-back side should be a
 * nudge and not a broken build. Anything larger than this is a real change of
 * disposition and the whole point of the census.
 */
const PIN_TOLERANCE = 0.35;

describe('Rule 22 · the distribution on each side of every opposing verdict', () => {
  it('liveness · the census actually read a corpus', () => {
    // Rule 18 guard 2. A scanner that read nothing reports zero coverage
    // everywhere, which looks like a devastating finding and is a bug.
    expect(FILES.length, 'no test files were scanned').toBeGreaterThan(300);
    const nonEmpty = [...SOURCES.values()].filter((s) => s.length > 0).length;
    expect(nonEmpty).toBe(FILES.length);

    // And the detectors must be able to find something known to be there, or a
    // regex typo would report a clean, confident, empty census.
    expect(strictFiles('PROGRESS').length).toBeGreaterThan(0);
    expect(looseFiles('PROGRESS').length).toBeGreaterThan(0);
  });

  it('no false zero · a strict zero beside a loose non-zero is a broken detector', () => {
    // The rule's own warning, mechanised. `progression_gate: 0` was reported on
    // a mechanism with 43 tests; this is what would have caught it.
    const suspicious: string[] = [];
    for (const v of ALL_VERDICTS) {
      const strict = strictFiles(v).length;
      const loose = looseFiles(v).length;
      if (strict === 0 && loose > 0) {
        suspicious.push(
          `${v}: the strict detector reports 0 files and the loose one reports ${loose}. `
          + 'Do not publish the zero. Either the mechanism is asserted through a shape this '
          + 'census does not recognise, or the loose hits are prose — read them before '
          + 'believing either number.',
        );
      }
    }
    expect(suspicious).toEqual([]);
  });

  it('no verdict is entirely untested while its opposite is covered', () => {
    // The purest Rule 22 blind spot: a suite that can only ask "did you
    // correctly refuse?" will pass an engine that can only refuse.
    const blind: string[] = [];
    for (const p of PAIRS) {
      const up = count(p.up, looseFiles);
      const down = count(p.down, looseFiles);
      if (up === 0 && down > 0) {
        blind.push(
          `${p.mechanism}: ${down} file(s) exercise [${p.down.join(', ')}] and NOTHING exercises `
          + `[${p.up.join(', ')}]. A gate that only asks "did you correctly hold back?" will pass `
          + 'an engine that can only hold back.',
        );
      }
    }
    expect(blind).toEqual([]);
  });

  it('the imbalance on each pair is within its ceiling, or argued', () => {
    const findings: string[] = [];
    for (const p of PAIRS) {
      const up = count(p.up, looseFiles);
      const down = count(p.down, looseFiles);
      const ratio = up === 0 ? Infinity : down / up;
      const argued = ARGUED_IMBALANCES.find((a) => a.mechanism === p.mechanism);
      const over = ratio > p.measuredRatio + PIN_TOLERANCE;

      if (over && !argued) {
        findings.push(
          `${p.mechanism}: ${down} file(s) on the pull-back side against ${up} on the push side, `
          + `a ratio of ${ratio.toFixed(2)} against a pin of ${p.measuredRatio}. Rule 22: `
          + 'doctrine sometimes licenses an imbalance; habit never does. Justify it in '
          + 'ARGUED_IMBALANCES with a citation, or add the missing cases.',
        );
      }
      // Rule 18 guard 4 · the other half of the ratchet. A pin that the corpus
      // has grown past must be TIGHTENED, or it stops meaning anything the
      // moment somebody adds one pull-back test back.
      if (Number.isFinite(ratio) && ratio < p.measuredRatio - RATCHET_SLACK) {
        findings.push(
          `${p.mechanism} has improved to ${ratio.toFixed(2)} against a pin of `
          + `${p.measuredRatio}. Tighten the pin to the new number. A pin left above what the `
          + 'corpus actually does is a gate that has quietly stopped holding.',
        );
      }
      // Ratchet · an argument for an imbalance that no longer exists is stale.
      if (argued && !over) {
        findings.push(
          `${p.mechanism} is now within its ceiling, so the argued imbalance citing `
          + `"${argued.citation}" is stale and must be deleted.`,
        );
      }
    }
    expect(findings).toEqual([]);
  });

  it('reports the distribution, because the number is the point', () => {
    const lines: string[] = [`scanned ${FILES.length} test files under ${SCAN_DIRS.join(', ')}`];
    for (const v of ALL_VERDICTS.sort()) {
      lines.push(`  ${v.padEnd(20)} strict ${String(strictFiles(v).length).padStart(4)}`
        + ` · loose ${String(looseFiles(v).length).padStart(4)}`);
    }
    lines.push('');
    for (const p of PAIRS) {
      const up = count(p.up, looseFiles);
      const down = count(p.down, looseFiles);
      lines.push(`  ${p.mechanism}`);
      lines.push(`    push ${String(up).padStart(4)} · pull back ${String(down).padStart(4)}`
        + ` · ratio ${(up === 0 ? Infinity : down / up).toFixed(2)} (pin ${p.measuredRatio})`);
    }
    const out = process.env.VERDICT_COVERAGE_OUT;
    if (out) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
      require('node:fs').writeFileSync(out, `${lines.join('\n')}\n`);
    }
    expect(lines.length).toBeGreaterThan(5);
  });
});
