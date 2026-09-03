/**
 * lib/adaptation/canonical/_forbidden_inputs.test.ts · THE FORBIDDEN INPUTS
 * CANNOT REACH THIS ENGINE.
 *
 * `docs/PLAN_SIMPLIFICATION_DOCTRINE.md` removed decision authority from a
 * named list of inputs. The brief for this engine repeats it:
 *
 *   readiness · sleep · HRV · resting HR · TSB · self-declared experience ·
 *   goal pace as proof of capacity · a single exceptional workout ·
 *   missing data interpreted as successful training · injury/illness automation
 *
 * "Not hidden, not defaulted off, removed." So this gate does not check that a
 * flag is false. It checks that the vocabulary does not appear in the engine's
 * source at all, and that the lever functions cannot receive the goal.
 *
 * ── RULE 18 · LIVENESS AND FALSIFICATION ───────────────────────────────────
 *
 * The scanner states how many files it read and fails on too few. An ORACLE
 * test plants each forbidden token into a synthetic source and asserts the
 * detector flags it, so the detector cannot silently stop matching. Both were
 * falsified by hand before this landed; the report records the output.
 *
 * ── RULE 22 · WHAT THIS GATE CANNOT FAIL ON ────────────────────────────────
 *
 * · A forbidden input smuggled in under a neutral name. A field called
 *   `dailyScore` carrying TSB reads as clean here. The vocabulary check is a
 *   tripwire against the obvious case, not a proof of intent, and the only real
 *   defence is that the input type is small enough to read in one sitting.
 * · A forbidden input reaching the engine through a value already folded into
 *   `CapacityBelief`. If an upstream resolver let sleep move the threshold
 *   belief, this engine receives a poisoned number and cannot tell.
 * · Goal leakage through arithmetic done BEFORE the call. The gate proves no
 *   lever takes a `GoalRequirement`; it cannot prove the caller did not price
 *   `belief.thresholdPaceSecPerMi` off the goal upstream.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const HERE = __dirname;

/**
 * The forbidden vocabulary. Owned by the TEST, never by the engine, so the
 * engine source containing any of these words is unambiguously a violation.
 * Word-boundary matched, case-insensitive.
 */
const FORBIDDEN = [
  'readiness',
  'hrv',
  'restingHr',
  'resting_heart',
  'sleepScore',
  'sleepHours',
  'tsb',
  'trainingStressBalance',
  'experienceLevel',
  'experience_level',
  'selfDeclared',
  'injuryStatus',
  'illness',
  'wearableReadiness',
  'acwr',
] as const;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('._')) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** Comments are prose and may legitimately NAME what is excluded. Strip them. */
export function stripComments(src: string): string {
  const BLOCK = new RegExp('/\\*[\\s\\S]*?\\*/', 'g');
  const LINE = new RegExp('(^|[^:\'"\\x60])//[^\\n]*', 'g');
  return src
    .replace(BLOCK, (m) => m.replace(/[^\n]/g, ' '))
    .replace(LINE, (_m, p1: string) => p1);
}

export function forbiddenTokensIn(src: string): string[] {
  const code = stripComments(src);
  return FORBIDDEN.filter((t) => new RegExp(`\\b${t}\\b`, 'i').test(code));
}

const ALL = walk(HERE);
// Engine source only. The test files themselves must name the vocabulary.
/**
 * Engine source only.
 *
 * `.test.ts` and `.script.ts` are excluded, matching the predicate the
 * pre-existing `_zero_mutation_scan.test.ts` already uses. Both kinds of file
 * legitimately contain the very strings these guards hunt for: the tests plant
 * violations as oracles, and `_falsify_gates.script.ts` plants them on purpose
 * to prove these guards can fail. Scanning them would make the guards fire on
 * their own falsification harness, which is how this exclusion was discovered.
 *
 * The exclusion is safe because neither kind of file is reachable from the
 * application: nothing in `lib/` or `app/` imports a test or a script, and
 * guard 4 asserts nothing outside imports this directory at all.
 */
const isTestOrScript = (p: string) => /\.(test|script)\.ts$/.test(p);
const ENGINE = ALL.filter((p) => !isTestOrScript(p));

describe('liveness · the scanner read the engine', () => {
  it('found the engine files it claims to guard', () => {
    // Fails loudly rather than reporting clean if the directory moves.
    expect(ENGINE.length).toBeGreaterThanOrEqual(10);
    expect(ENGINE.some((p) => p.endsWith('evaluate.ts'))).toBe(true);
    expect(ENGINE.some((p) => p.endsWith('input.ts'))).toBe(true);
    expect(ENGINE.some((p) => p.endsWith(path.join('levers', 'threshold-pace.ts')))).toBe(true);
  });

  it('ORACLE · every forbidden token is detected when planted in code', () => {
    for (const token of FORBIDDEN) {
      const planted = `const x = input.${token};`;
      expect(forbiddenTokensIn(planted), `planted ${token} was not detected`)
        .toContain(token);
    }
  });

  it('ORACLE · the same tokens in PROSE are not flagged', () => {
    const prose = '/* this engine never reads readiness, HRV, TSB or sleepHours */\nconst x = 1;';
    expect(forbiddenTokensIn(prose)).toEqual([]);
  });
});

describe('guard 1 · no forbidden input vocabulary in engine source', () => {
  for (const file of ENGINE) {
    it(path.relative(HERE, file), () => {
      const found = forbiddenTokensIn(readFileSync(file, 'utf8'));
      expect(found, `${path.relative(HERE, file)} names ${found.join(', ')}`).toEqual([]);
    });
  }
});

describe('guard 2 · no lever function can receive the goal', () => {
  const LEVER_DIR = path.join(HERE, 'levers');
  const leverFiles = readdirSync(LEVER_DIR)
    .filter((f) => f.endsWith('.ts') && !f.startsWith('._'))
    .map((f) => path.join(LEVER_DIR, f));

  it('liveness · the lever files were found', () => {
    expect(leverFiles.length).toBeGreaterThanOrEqual(4);
  });

  it('no file under levers/ mentions GoalRequirement or a goal field', () => {
    for (const f of leverFiles) {
      const code = stripComments(readFileSync(f, 'utf8'));
      expect(code, `${path.basename(f)} names GoalRequirement`).not.toMatch(/\bGoalRequirement\b/);
      expect(code, `${path.basename(f)} reads a goal`).not.toMatch(/\bgoal[A-Z.]/);
      expect(code, `${path.basename(f)} reads input.goal`).not.toMatch(/\.goal\b/);
    }
  });

  it('the goal is read in exactly ONE place, and it produces a sentence', () => {
    // `evaluate.ts` states this in its own header: describeGap is the only
    // reader. If a second reader appears, this fails and the claim gets
    // re-argued rather than quietly becoming false (Rule 20).
    const src = stripComments(readFileSync(path.join(HERE, 'evaluate.ts'), 'utf8'));
    const readers = [...src.matchAll(/input\.goal\./g)].length;
    expect(readers).toBeGreaterThan(0); // liveness
    // Every read sits inside describeGap, which returns a string.
    const gapFn = src.slice(src.indexOf('function describeGap'));
    const readsInGap = [...gapFn.matchAll(/input\.goal\./g)].length;
    expect(readsInGap).toBe(readers);
  });
});

describe('guard 3 · the input type has nowhere to put a forbidden value', () => {
  it('input.ts declares no field carrying the forbidden vocabulary', () => {
    const code = stripComments(readFileSync(path.join(HERE, 'input.ts'), 'utf8'));
    expect(forbiddenTokensIn(code)).toEqual([]);
  });

  it('the input surface is small enough to audit by reading', () => {
    // Rule 22 names "a forbidden input under a neutral name" as this gate's
    // blind spot, and the only real mitigation is that a human can read the
    // whole type. That mitigation is worth an assertion: if the input grows
    // past this, the blind spot stops being mitigated and the number should be
    // raised deliberately rather than drifting.
    const src = readFileSync(path.join(HERE, 'input.ts'), 'utf8');
    const interfaces = [...src.matchAll(/^export interface /gm)].length;
    expect(interfaces).toBeLessThanOrEqual(12);
  });
});
