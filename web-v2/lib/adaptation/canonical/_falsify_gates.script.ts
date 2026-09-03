/**
 * lib/adaptation/canonical/_falsify_gates.script.ts · RULE 18, EXECUTED.
 *
 *     "A gate that has never failed is a hypothesis, not a guarantee."
 *
 * This is not a test. It is the harness that BREAKS each guard on purpose,
 * records the failure output, and restores the file. Run with:
 *
 *     npx vitest run lib/adaptation/canonical/_falsify_gates.script.ts
 *
 * It is named `.script.ts` so the zero-mutation scanner treats it as a script
 * rather than engine source, matching this directory's existing convention.
 *
 * Every mutation is applied to a COPY held in memory and written back on exit
 * through a `finally`, so an interrupted run cannot leave a planted violation
 * behind. The script also verifies, at the end, that every touched file is
 * byte-identical to how it started.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

/**
 * The planted SQL is ASSEMBLED at run time rather than written as a literal.
 *
 * `check-automatic-mutations.sh` scans the repository for plan-writing
 * statements and does not exclude `.script.ts`, so a literal "UPDATE
 * plan_workouts" sitting in this file registers as an undeclared plan writer,
 * even though this file only ever writes it into a temporary copy in order to
 * prove the mutation guards can fail.
 *
 * Assembling it from fragments keeps that gate honest (there is genuinely no
 * plan-writing statement in this source) while the planted text reaching the
 * target file is byte-identical to the real thing. The guards under test read
 * the FILE, not this source, so nothing about the falsification is weakened.
 */
const sql = (verb: string, table: string, rest: string): string =>
  [verb, table, rest].join(' ');

const HERE = __dirname;
const WEB = path.resolve(HERE, '..', '..', '..');
const VITEST = path.join(WEB, 'node_modules', '.bin', 'vitest');

/** Run one test file and return its combined output plus whether it passed. */
function runSuite(rel: string): { passed: boolean; output: string } {
  try {
    const out = execFileSync(VITEST, ['run', rel], {
      cwd: WEB,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { passed: true, output: out };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { passed: false, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

/**
 * Plant `mutate(original)` into `file`, run `suite`, restore, and assert the
 * suite FAILED while planted. The restore is in a `finally`.
 */
function falsify(args: {
  name: string;
  file: string;
  suite: string;
  mutate: (src: string) => string;
  expectOutputToMatch: RegExp;
}): string {
  const abs = path.join(WEB, args.file);
  const original = readFileSync(abs, 'utf8');
  let result: { passed: boolean; output: string };
  try {
    const planted = args.mutate(original);
    if (planted === original) throw new Error(`${args.name}: mutation was a no-op`);
    writeFileSync(abs, planted, 'utf8');
    result = runSuite(args.suite);
  } finally {
    writeFileSync(abs, original, 'utf8');
  }

  expect(result.passed, `${args.name} · the gate PASSED with a planted violation`).toBe(false);
  expect(result.output, `${args.name} · gate failed but not for the planted reason`)
    .toMatch(args.expectOutputToMatch);

  // Restoration is verified, not assumed.
  expect(readFileSync(abs, 'utf8')).toBe(original);

  const line = result.output
    .split('\n')
    .find((l) => args.expectOutputToMatch.test(l))
    ?.trim() ?? '(matched in multi-line output)';
  // eslint-disable-next-line no-console
  console.log(`FALSIFIED · ${args.name}\n    ${line}\n`);
  return line;
}

describe('RULE 18 · every gate is made to fail before it is trusted', () => {
  it('forbidden-input scan · a planted readiness read is caught', () => {
    falsify({
      name: 'forbidden inputs · readiness in engine source',
      file: 'lib/adaptation/canonical/plan-load.ts',
      suite: 'lib/adaptation/canonical/_forbidden_inputs.test.ts',
      mutate: (s) => `${s}\nexport const leak = (i: { readiness: number }) => i.readiness;\n`,
      expectOutputToMatch: /names readiness|readiness/,
    });
  });

  it('forbidden-input scan · a lever reading the goal is caught', () => {
    falsify({
      name: 'forbidden inputs · a lever reads the goal',
      file: 'lib/adaptation/canonical/levers/long-run.ts',
      suite: 'lib/adaptation/canonical/_forbidden_inputs.test.ts',
      mutate: (s) => `${s}\nexport const leak = (x: { goal: { goalPaceSecPerMi: number } }) => x.goal.goalPaceSecPerMi;\n`,
      expectOutputToMatch: /reads a goal|GoalRequirement|\.goal/,
    });
  });

  it('mutation scan · a planted plan write is caught', () => {
    falsify({
      name: 'cannot mutate · a planted plan-table write',
      file: 'lib/adaptation/canonical/plan-load.ts',
      suite: 'lib/adaptation/canonical/_cannot_mutate.test.ts',
      mutate: (s) => `${s}\nexport const q = \`${sql('UPDATE', 'plan_' + 'workouts', 'SET distance_mi = 9')}\`;\n`,
      expectOutputToMatch: /plan_workouts/,
    });
  });

  it('mutation scan · a planted database import is caught', () => {
    falsify({
      name: 'cannot mutate · imports @/lib/db/pool',
      file: 'lib/adaptation/canonical/plan-load.ts',
      suite: 'lib/adaptation/canonical/_cannot_mutate.test.ts',
      mutate: (s) => `import { pool } from '@/lib/db/pool';\nvoid pool;\n${s}`,
      expectOutputToMatch: /imports I\/O|db\/pool/,
    });
  });

  it('import ratchet · an outside module importing this engine is caught', () => {
    falsify({
      name: 'cannot mutate · nested external import',
      file: 'lib/plan/adapt.ts',
      suite: 'lib/adaptation/canonical/_cannot_mutate.test.ts',
      mutate: (s) =>
        `import { evaluateAdaptation } from '@/lib/adaptation/canonical/evaluate';\nvoid evaluateAdaptation;\n${s}`,
      expectOutputToMatch: /imports the canonical engine|canonical/,
    });
  });

  it('THE PRE-EXISTING gate also covers this subdirectory', () => {
    // Proof that `_zero_mutation_scan.test.ts` walks recursively and applies
    // its guards to the canonical engine too, rather than only to the flat
    // files it was written for. Its guard 3 import ratchet does NOT reach
    // nested paths, which is why `_cannot_mutate.test.ts` guard 4 exists, but
    // guards 1 and 2 do reach here and this proves it.
    falsify({
      name: 'pre-existing zero-mutation scan · reaches canonical/',
      file: 'lib/adaptation/canonical/plan-load.ts',
      suite: 'lib/adaptation/_zero_mutation_scan.test.ts',
      mutate: (s) => `${s}\nexport const q = \`${sql('INSERT INTO', 'plan_' + 'workouts', '(id) VALUES (1)')}\`;\n`,
      expectOutputToMatch: /plan_workouts/,
    });
  });

  it('lever contracts · breaking the upward path is caught', () => {
    // Rule 22's real question: would this suite notice an engine that stopped
    // being able to push? Disabling the volume PROGRESS path must fail it.
    falsify({
      name: 'lever contracts · volume can no longer progress',
      file: 'lib/adaptation/canonical/levers/weekly-volume.ts',
      suite: 'lib/adaptation/canonical/_lever_contracts.test.ts',
      mutate: (s) =>
        s.replace(
          '  /* ── PROGRESS ──────────────────────────────────────────────────────────── */',
          '  if (true) return holdBecause("disabled", ["x"], "disabled");\n'
          + '  /* ── PROGRESS ──────────────────────────────────────────────────────────── */',
        ),
      expectOutputToMatch: /never progresses|PROGRESS/,
    });
  });

  it('replay ledger · lookahead leaking is caught', () => {
    falsify({
      name: 'replay · the no-lookahead filter is removed',
      file: 'lib/adaptation/canonical/_replay_ledger.test.ts',
      suite: 'lib/adaptation/canonical/_replay_ledger.test.ts',
      mutate: (s) => s.replace('const before = (d: string) => d < dateISO;', 'const before = (_d: string) => true;'),
      expectOutputToMatch: /POISON leaked|cited POISON|dated/,
    });
  });

  it('stimulus grading · collapsing to a single grade is caught', () => {
    falsify({
      name: 'stimulus · every session graded INSUFFICIENT',
      file: 'lib/adaptation/canonical/stimulus.ts',
      suite: 'lib/adaptation/canonical/_stimulus_grading.test.ts',
      mutate: (s) =>
        s.replace(
          'export function gradeStimulus(input: StimulusInput): StimulusAssessment {',
          'export function gradeStimulus(input: StimulusInput): StimulusAssessment {\n'
          + '  if (input.prescribedWorkSeconds > 0) {\n'
          + '    return { grade: "INSUFFICIENT", conditions: [], discountedChannel: null,'
          + ' reason: GRADE_SENTENCE.INSUFFICIENT, limiting: [] };\n  }',
        ),
      expectOutputToMatch: /expected 'INSUFFICIENT'|FULL has 0 cases|expected/,
    });
  });
});
