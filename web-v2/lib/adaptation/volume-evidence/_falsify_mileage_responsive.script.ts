/**
 * lib/adaptation/volume-evidence/_falsify_mileage_responsive.script.ts
 *
 * RULE 18, EXECUTED. "A gate is not trusted until it has been made to fail."
 *
 * Same shape and same exemption as `lib/adaptation/canonical/_falsify_gates.script.ts`:
 * it is a `.script.ts` rather than a `.test.ts` BECAUSE IT MUTATES SOURCE FILES
 * on purpose, and a normal `npm test` run must never rewrite files underneath
 * itself. Each case plants one violation into one source file, runs
 * `_mileage_responsive.test.ts` against the mutated tree, asserts the suite
 * FAILED and that the failure names the right thing, restores the file in a
 * `finally`, and verifies the restoration BYTE FOR BYTE.
 *
 *     npm --prefix web-v2 run falsify:mileage
 *
 * ── WHY EACH PLANT IS THE ONE IT IS ───────────────────────────────────────
 *
 * Every plant below is a REAL defect this codebase has already shipped once,
 * pointed at this directory:
 *
 *  1 · DROP THE CANONICAL PREDICATE. Rule 14's own incident: a merged row read
 *      as training. Here it would manufacture surplus out of a duplicate.
 *  2 · SPEND A TAPER AS NORMAL. Rule 8's own incident, six times over. Here it
 *      would train the next block off a post-race recovery week the runner
 *      overran, which the real-history replay shows is his two LARGEST
 *      surpluses of 2026.
 *  3 · LET A LOW WEEK LOWER THE PEAK. The asymmetry `RULE_21_THRESHOLD_LEDGER`
 *      row 7 argues for. If the ledger's claim is real, breaking it must fail.
 *  4 · COLLAPSE "UNREADABLE" INTO "NOT SUPPORTED". Rule 11, the single most
 *      productive bug shape in this repo.
 *  5 · RAISE A CUTBACK WEEK. The owner's step 6, verbatim: "More mileage this
 *      week must not make every later week larger."
 *  6 · SKIP THE ONE-STRESSOR CHECK. Doctrine's own row, and the check the
 *      adjudication layer already owns.
 *  7 · PUT AN EM DASH IN A RUNNER-FACING SENTENCE. Rule 20's own instance:
 *      the coach-voice gate's scope excluded `lib/plan` and 1,804 rows carried
 *      them. `lib/adaptation` is outside that gate's scope too, so this
 *      directory's voice guard is the only thing standing there and it had
 *      better be able to fail.
 *
 * ── RULE 22 · WHAT THIS FALSIFIER CANNOT TELL YOU ─────────────────────────
 *
 * It proves the gate NOTICES seven specific breakages. It says nothing about
 * the breakages nobody thought to plant, and it cannot tell a gate that fails
 * for the right reason from one that fails for an adjacent one, beyond the
 * message match each case asserts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const HERE = __dirname;
const WEB = path.resolve(HERE, '..', '..', '..');
const SUITE = 'lib/adaptation/volume-evidence/_mileage_responsive.test.ts';

/** Run the suite. Returns `{ ok, output }` and never throws on a red run. */
function runSuite(): { ok: boolean; output: string } {
  try {
    const out = execFileSync('npx', ['vitest', 'run', SUITE], {
      cwd: WEB, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300_000,
    });
    return { ok: true, output: out };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, output: `${err.stdout ?? ''}\n${err.stderr ?? ''}` };
  }
}

interface Plant {
  readonly name: string;
  readonly file: string;
  readonly find: string;
  readonly replace: string;
  /** A fragment the red run must contain, so the gate fails for the RIGHT reason. */
  readonly expectNames: string;
}

const PLANTS: readonly Plant[] = [
  {
    name: '1 · a merged row is counted as volume (Rule 14)',
    file: 'classify.ts',
    find: '  if (run.mergedIntoAnother) {',
    replace: '  if (false && run.mergedIntoAnother) {',
    expectNames: 'duplicate',
  },
  {
    name: '2 · a taper week is spent as the runner\'s normal (Rule 8)',
    file: 'classify.ts',
    find: "  if (w.authoredPlanMode === 'TAPER') return 'AUTHORED_TAPER';",
    replace: "  if (false) return 'AUTHORED_TAPER';",
    expectNames: 'RULE 8',
  },
  {
    name: '3 · a low week lowers the demonstrated peak (Rule 21 row 7)',
    file: 'belief.ts',
    find: "    // peakWeeklyMi is deliberately absent from this list.",
    replace: "    peakWeeklyMi: lower('peakWeeklyMi', belief.peakWeeklyMi),",
    expectNames: 'asymmetry',
  },
  {
    name: '4 · UNREADABLE is collapsed into NOT_SUPPORTED (Rule 11)',
    file: 'admit.ts',
    find: "      outcome: 'UNREADABLE',",
    replace: "      outcome: 'NOT_SUPPORTED',",
    expectNames: 'Rule 11',
  },
  {
    name: '5 · a cutback week is raised with the weeks around it (step 6)',
    file: 'respond.ts',
    find: '    if (w.isCutback) {',
    replace: '    if (false && w.isCutback) {',
    expectNames: 'cutback',
  },
  {
    name: '6 · the one-stressor-at-a-time check is skipped (Research/00a)',
    file: 'respond.ts',
    find: '    if (finding != null) {',
    replace: '    if (false && finding != null) {',
    expectNames: 'simultaneous',
  },
  {
    name: '7 · an em dash reaches a runner-facing sentence (Rule 20)',
    file: 'explain.ts',
    find: "    return 'The extra mileage counts as evidence, but next week remains a cutback.';",
    replace: "    return 'The extra mileage counts as evidence \\u2014 next week remains a cutback.';",
    expectNames: 'COACH VOICE',
  },
];

describe('RULE 18 · every guard in this directory, made to fail on purpose', () => {
  it('POSITIVE CONTROL · the suite is GREEN before anything is planted', () => {
    const before = runSuite();
    expect(before.ok, `the suite must be green before falsification:\n${before.output}`).toBe(true);
  }, 300_000);

  for (const plant of PLANTS) {
    it(plant.name, () => {
      const abs = path.join(HERE, plant.file);
      const original = readFileSync(abs, 'utf8');
      expect(
        original.includes(plant.find),
        `PLANT ANCHOR ROTTED · "${plant.find}" is no longer in ${plant.file}. `
        + 'A falsifier whose anchor has moved silently stops falsifying, which is '
        + 'the exact failure Rule 18 point 2 is about.',
      ).toBe(true);
      try {
        writeFileSync(abs, original.replace(plant.find, plant.replace), 'utf8');
        const red = runSuite();
        expect(red.ok, `THE GATE DID NOT NOTICE:\n${plant.name}\n${red.output.slice(-2000)}`)
          .toBe(false);
        expect(
          red.output.toLowerCase().includes(plant.expectNames.toLowerCase()),
          `the gate failed, but not for the stated reason. Expected the output to name `
          + `"${plant.expectNames}".\n${red.output.slice(-3000)}`,
        ).toBe(true);
        // The verbatim first failing assertion, so a report can quote what the
        // gate actually said rather than paraphrasing it.
        const named = red.output.split('\n')
          .filter((l) => /^\s*(FAIL|AssertionError|×)/.test(l))
          .slice(0, 4).map((l) => l.trim());
        // eslint-disable-next-line no-console
        console.log(`\n[falsify] ${plant.name}\n  GATE FAILED, as required. It said:\n`
          + named.map((l) => `    ${l}`).join('\n'));
      } finally {
        writeFileSync(abs, original, 'utf8');
        // Rule 18 · verify the restoration byte for byte. A falsifier that
        // leaves a mutated tree behind is worse than no falsifier.
        expect(readFileSync(abs, 'utf8')).toBe(original);
      }
    }, 300_000);
  }

  it('NEGATIVE CONTROL · the tree is restored and the suite is GREEN again', () => {
    const after = runSuite();
    expect(after.ok, `the tree was not restored:\n${after.output}`).toBe(true);
  }, 300_000);
});
