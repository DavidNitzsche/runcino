/**
 * lib/plan/_replan_scenarios.test.ts · the "Change the plan" sheet's two
 * doctrine helpers, and the voice its copy is written in.
 *
 * The scenarios themselves need a live plan and a database, and are exercised
 * end to end against the QA accounts. What is checkable here is the part that
 * has to be right BEFORE a change is offered to a runner:
 *
 *   1. the two arithmetic guards agree with the validator that will judge them
 *   2. the sentences the runner reads obey the brief's tone rules
 *   3. the module is deterministic · no clock, no locale, no randomness
 *
 * (2) and (3) are source scans, the same posture `_no_strength_rows.test.ts`
 * and the mutation boundary's own writer scan take: a rule that can only be
 * checked by reading is a rule that stops being checked.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { repoRoot } from '@/lib/doctrine/resolve';
import {
  cutbackLongTarget,
  reentryCeilingMi,
  REQUESTED_CUTBACK_LONG_CUT_BAND,
  REENTRY_ACWR_CEILING,
  REENTRY_ACWR_CHRONIC_WEEKS,
  REENTRY_SMALL_STEP_MI,
  LONG_RUN_WOW_MAX_PCT,
} from './replan-scenarios';

const SRC = path.join(repoRoot(), 'web-v2', 'lib', 'plan', 'replan-scenarios.ts');
const source = () => fs.readFileSync(SRC, 'utf8');
/** Source with comments removed · prose about a rule must never trip the rule. */
const code = () => source().replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

// ── 1 · the cutback's long run ───────────────────────────────────────────────

describe('cutbackLongTarget · deep enough to be a cutback, shallow enough to come back from', () => {
  const [lo, hi] = REQUESTED_CUTBACK_LONG_CUT_BAND;

  it('lands inside the doctrine band when the week after is not a constraint', () => {
    for (const long of [4, 6, 8, 10, 12, 16, 20, 22]) {
      const t = cutbackLongTarget(long, 0);
      expect(t, `long ${long}`).not.toBeNull();
      const cut = (long - t!) / long;
      // Strictly inside the band · no slack. The half-mile grid is the engine's
      // problem to solve, not the claim's to soften.
      expect(cut, `long ${long} cut ${(cut * 100).toFixed(0)}%`).toBeGreaterThanOrEqual(lo - 1e-9);
      expect(cut, `long ${long} cut ${(cut * 100).toFixed(0)}%`).toBeLessThanOrEqual(hi + 1e-9);
    }
  });

  it('never cuts so deep that the following week becomes a week-over-week jump', () => {
    for (const long of [4, 6, 8, 10, 12, 16, 20]) {
      for (const next of [0, long * 0.8, long, long * 1.1]) {
        const t = cutbackLongTarget(long, next);
        if (t == null) continue;
        if (next <= 0) continue;
        const rise = ((next - t) / t) * 100;
        expect(rise, `long ${long} → ${t} → next ${next}`).toBeLessThanOrEqual(LONG_RUN_WOW_MAX_PCT + 1e-9);
      }
    }
  });

  it('refuses rather than half-doing it when the two constraints do not overlap', () => {
    // The week after is longer than this one · any legal cut here is a jump there.
    expect(cutbackLongTarget(10, 14)).toBeNull();
    expect(cutbackLongTarget(0, 12)).toBeNull();
  });
});

// ── 2 · the travel re-entry ──────────────────────────────────────────────────

describe('reentryCeilingMi · the climb back stays under the line the validator judges it by', () => {
  /** The validator's own test, verbatim in shape: curr / mean(window ∪ curr) ≤ ceiling. */
  const acwr = (prev3: number[], curr: number) => {
    const window = [...prev3, curr];
    return curr / (window.reduce((a, b) => a + b, 0) / window.length);
  };

  it('a week capped at the ceiling is inside the acute:chronic red line', () => {
    const cases: Array<[number[], number]> = [
      [[46, 0, 0], 0],
      [[34.5, 0, 0], 0],
      [[0, 0, 27.5], 27.5],
      [[31, 32, 34], 34],
      [[10, 0, 0], 0],
    ];
    for (const [prev3, prevMi] of cases) {
      const ceiling = reentryCeilingMi(prev3, prevMi);
      const ratio = acwr(prev3, ceiling);
      const exempt = ceiling - prevMi <= REENTRY_SMALL_STEP_MI;
      if (exempt) continue; // the validator never looks at a step this small
      expect(ratio, `prev ${prev3.join(',')} ceiling ${ceiling}`)
        .toBeLessThanOrEqual(REENTRY_ACWR_CEILING + 1e-9);
    }
  });

  it('never proposes a week smaller than the small-step exemption already allows', () => {
    // Two weeks of nothing must not force the return below "four more miles than
    // last week", which doctrine's own exemption says is never a spike.
    expect(reentryCeilingMi([0, 0, 0], 0)).toBe(REENTRY_SMALL_STEP_MI);
    expect(reentryCeilingMi([0, 0, 0], 12)).toBe(12 + REENTRY_SMALL_STEP_MI);
  });

  it('uses the chronic window the validator uses', () => {
    // 1.5 × s / (4 − 1.5) = 0.6 s. If either constant moved, this moves with it.
    const s = 100;
    const expected = (REENTRY_ACWR_CEILING * s) / (REENTRY_ACWR_CHRONIC_WEEKS - REENTRY_ACWR_CEILING);
    expect(reentryCeilingMi([50, 30, 20], 0)).toBeCloseTo(expected, 6);
  });
});

// ── 3 · coach voice ──────────────────────────────────────────────────────────

/**
 * Every sentence this module hands a runner lives in a single-quoted literal.
 * SQL and the fingerprint builder use backticks, so scanning single quotes
 * reaches the copy and nothing else.
 */
function copyLiterals(): string[] {
  return [...code().matchAll(/'(?:[^'\\\n]|\\.)*'/g)]
    .map((m) => m[0].slice(1, -1).replace(/\\'/g, "'"))
    // Identifiers, enum members and column names are not prose.
    .filter((s) => /\s/.test(s) && s.length > 12);
}

describe('coach voice · Design/running-app-design-brief-v2.md', () => {
  it('finds the copy at all (the scan is not silently matching nothing)', () => {
    expect(copyLiterals().length).toBeGreaterThan(20);
  });

  it('no em dashes', () => {
    expect(copyLiterals().filter((s) => s.includes('—'))).toEqual([]);
  });

  it('no exclamation marks', () => {
    expect(copyLiterals().filter((s) => s.includes('!'))).toEqual([]);
  });

  it('no emoji', () => {
    const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
    expect(copyLiterals().filter((s) => EMOJI.test(s))).toEqual([]);
  });

  it('never scolds · no "you should", "you need to", "make sure"', () => {
    const SCOLD = /\b(you should|you need to|make sure|don't forget|remember to)\b/i;
    expect(copyLiterals().filter((s) => SCOLD.test(s))).toEqual([]);
  });
});

// ── 4 · determinism ──────────────────────────────────────────────────────────

describe('determinism · same plan and same request, same rows', () => {
  it('no randomness', () => {
    expect(code()).not.toMatch(/Math\.random|randomBytes|randomUUID/);
  });

  it('no clock beyond the runner\'s own date', () => {
    // `todayISO` is passed in. A bare `new Date()` or `Date.now()` would make
    // the same request produce different rows on either side of midnight.
    expect(code()).not.toMatch(/new Date\(\s*\)/);
    expect(code()).not.toMatch(/Date\.now\(\)/);
  });

  it('no locale-dependent formatting', () => {
    expect(code()).not.toMatch(/toLocale\w*\(|Intl\./);
  });

  it('the confirm token is a plain hash of the plan and the request', () => {
    expect(code()).toMatch(/createHash\('sha256'\)/);
  });
});

// ── 5 · the boundary is the only door ────────────────────────────────────────

describe('every write goes through lib/plan/mutate.ts', () => {
  it('the module writes plan_workouts only inside a mutatePlan callback', () => {
    const src = code();
    expect(src).toMatch(/mutatePlan</);
    const writes = [...src.matchAll(/(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+plan_workouts\b/gi)];
    expect(writes.length).toBeGreaterThan(0);
    // The apply callback is the only place they can be · everything before it in
    // the file is a SELECT or pure arithmetic.
    const applyAt = src.indexOf('apply: async (tx: PoolClient)');
    expect(applyAt).toBeGreaterThan(0);
    for (const w of writes) expect(w.index!).toBeGreaterThan(applyAt);
  });

  it('does not reach for the escape hatch', () => {
    expect(code()).not.toMatch(/bypass\s*:/);
  });
});
