/**
 * lib/adaptation/volume-evidence/_falsify_continuity.script.ts
 *
 * RULE 18, EXECUTED, ON THE CURVE. "A gate is not trusted until it has been
 * made to fail."
 *
 *     npm --prefix web-v2 run falsify:continuity
 *
 * Same shape and the same exemption as `_falsify_mileage_responsive.script.ts`:
 * a `.script.ts` rather than a `.test.ts` BECAUSE IT MUTATES SOURCE FILES on
 * purpose, and a normal `npm test` run must never rewrite files underneath
 * itself. Each case plants one defect, runs the real suite against the mutated
 * tree, asserts it FAILED and that the failure names the right thing, restores
 * the file in a `finally`, and verifies the restoration BYTE FOR BYTE.
 *
 * ── PART A · THE STEPPED CURVE, IN PROCESS ────────────────────────────────
 *
 * The first case does not mutate anything. It runs the walk suite's OWN
 * exported `walk` and `assertContinuousAndMonotone` over a deliberately
 * STEPPED implementation of `creditedSurplusFrac` — the binary bar this change
 * removed, reconstructed exactly — and asserts the real assertion throws and
 * names a cliff.
 *
 * That matters because of the specific way this repo has shipped dead gates
 * before: `PACE.interval-offset` carried an exemption on the line ABOVE its
 * only assertion, so granting it switched the claim off entirely. A falsifier
 * that re-implements the check proves the re-implementation fails, not the
 * check. So `assertContinuousAndMonotone` is imported and called, not copied.
 *
 * ── PART B · THE PLANTS, EACH A REAL DEFECT ───────────────────────────────
 *
 * Every plant below is either the defect this change removed, or one of the
 * two failure modes the coefficient ledger exists to stop:
 *
 *  1 · RESTORE THE BINARY BAR. The owner's own finding, put back into
 *      `weight.ts`. The walk must name it.
 *  2 · STEP THE ABSORPTION RAMP. The second cliff, at 95 per cent.
 *  3 · FLATTEN THE EVIDENCE WINDOW. The cliff in the TIME axis, which is the
 *      one nobody looks for.
 *  4 · DROP THE PROGRESSION SCALE from the step cap in `respond.ts`. This is
 *      the unlock cliff, and it is the subtlest of the four: every curve stays
 *      smooth and the PROPOSAL steps.
 *  5 · MAKE THE CURVE NON-MONOTONE. Rule 9's own signature: "the fitter runner
 *      gets the worse plan."
 *  6 · RELABEL A CHOSEN NUMBER AS PHYSIOLOGY. The provenance ledger's whole
 *      reason to exist. `PROVISIONAL_ABSORPTION_WEIGHT` is a choice and must
 *      not be able to claim a citation.
 *  7 · MOVE A CITED COEFFICIENT AWAY FROM WHAT THE DOC SAYS. Rule 7 point 2:
 *      the number is read out of `Research/` at gate time, so a constant that
 *      drifts from its own citation must fail rather than agree with itself.
 *  8 · BREAK THE CALIBRATION IDENTITY. If 0.15 / 0.05 stops equalling the
 *      contract's three weeks, somebody must re-argue it rather than discover
 *      it later.
 *
 * ── PART C · THE OTHER DIRECTION ──────────────────────────────────────────
 *
 * Rule 18 point 1 asks for BOTH directions where a gate has two. The ledger's
 * completeness check is a ratchet, so case 9 plants a STALE entry — one naming
 * a constant that no longer exists — and asserts it fails until deleted.
 *
 * ── RULE 22 · WHAT THIS FALSIFIER CANNOT TELL YOU ─────────────────────────
 *
 * It proves the gates NOTICE nine specific breakages. It says nothing about
 * the breakages nobody thought to plant. In particular it cannot plant a
 * SUBTLY WRONG COEFFICIENT — one that is smooth, cited, and the wrong number
 * for the question — because no gate in this directory could catch that and
 * pretending otherwise would be the false confidence Rule 18 warns about.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { assertContinuousAndMonotone, walk } from './_continuity_walk.test';
import {
  creditedSurplusFrac,
  GPS_DISTANCE_ERROR_LO_FRAC,
  PER_WEEK_CREDIT_CEILING_FRAC,
} from './weight';

const HERE = __dirname;
const WEB = path.resolve(HERE, '..', '..', '..');
const WALK_SUITE = 'lib/adaptation/volume-evidence/_continuity_walk.test.ts';
const LEDGER_SUITE = 'lib/adaptation/volume-evidence/_continuous_evidence.test.ts';

function runSuite(suite: string): { ok: boolean; output: string } {
  try {
    const out = execFileSync('npx', ['vitest', 'run', suite], {
      cwd: WEB, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300_000,
    });
    return { ok: true, output: out };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, output: `${err.stdout ?? ''}\n${err.stderr ?? ''}` };
  }
}

/** The verbatim first failing lines, so a report quotes rather than paraphrases. */
function firstFailure(output: string): string {
  return output.split('\n')
    .filter((l) => /(FAIL|AssertionError|Error: CONTINUITY|Error: DOCTRINE)/.test(l))
    .slice(0, 3).map((l) => l.trim()).join('\n    ');
}

describe('RULE 18 · the continuity walk and the coefficient ledger, made to fail', () => {
  /* ── PART A ───────────────────────────────────────────────────────────── */

  it('A · THE STEPPED CURVE · the real assertion rejects the binary bar it replaced', () => {
    /* The old behaviour, reconstructed exactly: zero below
     * `VOLUME_ADDITION_THRESHOLD` of prescription, the whole credit above it.
     * This is the function the owner's 47.3 mi week met. */
    const stepped = (surplusFrac: number): number =>
      (surplusFrac > PER_WEEK_CREDIT_CEILING_FRAC ? PER_WEEK_CREDIT_CEILING_FRAC : 0);

    const r = walk(stepped, 0, 0.06, 0.00005);
    let message = '';
    try {
      // The IDENTICAL assertion the green suite runs, at the identical bound.
      assertContinuousAndMonotone('creditedSurplusFrac across the GPS noise floor', r, 3);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message, 'THE WALK DID NOT NOTICE A PURE STEP FUNCTION. The gate is dead.')
      .not.toBe('');
    expect(message).toContain('HAS A CLIFF');
    expect(message).toContain('Rule 9');
    // eslint-disable-next-line no-console
    console.log(`\n[falsify A] the walk rejected the stepped curve. It said:\n    ${message}\n`);

    // NEGATIVE CONTROL · the same assertion over the same range accepts the
    // real curve. Without this, case A would pass against an assertion that
    // rejects everything.
    expect(() => assertContinuousAndMonotone(
      'real curve', walk(creditedSurplusFrac, 0, 0.06, 0.00005), 3,
    )).not.toThrow();

    // And the specific week: the stepped curve gives it nothing, the real one
    // gives it a quarter of a step. 47.3 against 45.5 is a 3.96 per cent
    // surplus once `roundTo` has had it.
    const his = 1.8 / 45.5;
    expect(stepped(his)).toBe(0);
    expect(creditedSurplusFrac(his)).toBeGreaterThan(0);
    expect(his).toBeGreaterThan(GPS_DISTANCE_ERROR_LO_FRAC);
  });

  /* ── PART B ───────────────────────────────────────────────────────────── */

  interface Plant {
    readonly name: string;
    readonly file: string;
    readonly suite: string;
    readonly find: string;
    readonly replace: string;
    /** A fragment the red run must contain, so it fails for the RIGHT reason. */
    readonly expectNames: string;
  }

  const PLANTS: readonly Plant[] = [
    {
      name: '1 · the binary admission bar is restored (the owner\'s own cliff)',
      file: 'weight.ts',
      suite: WALK_SUITE,
      find: '  return gpsNoiseGate(surplusFrac) * Math.min(surplusFrac, PER_WEEK_CREDIT_CEILING_FRAC);',
      replace: '  return surplusFrac > PER_WEEK_CREDIT_CEILING_FRAC ? PER_WEEK_CREDIT_CEILING_FRAC : 0;',
      expectNames: 'HAS A CLIFF',
    },
    {
      name: '2 · the absorption ramp becomes a step at 95 per cent',
      file: 'weight.ts',
      suite: WALK_SUITE,
      find: '  return rampAcross(ABSORPTION_FLOOR_FRAC, ABSORPTION_CONFIRMED_FRAC, followingWeekCompletionFrac);',
      replace: '  return followingWeekCompletionFrac >= ABSORPTION_CONFIRMED_FRAC ? 1 : 0;',
      expectNames: 'HAS A CLIFF',
    },
    {
      name: '3 · the evidence window becomes flat, so a week vanishes overnight',
      file: 'weight.ts',
      suite: WALK_SUITE,
      find: '  return 1 - rampAcross(EVIDENCE_FULL_CREDIT_DAYS, EVIDENCE_WINDOW_DAYS, ageDays);',
      replace: '  return ageDays < EVIDENCE_WINDOW_DAYS ? 1 : 0;',
      expectNames: 'HAS A CLIFF',
    },
    {
      name: '4 · the proposal stops scaling with accumulated evidence (the unlock cliff)',
      file: 'respond.ts',
      suite: WALK_SUITE,
      /* The threshold is 0.25 rather than 1 deliberately. A plant gated at 1
       * makes every proposal in the walk zero, so the range collapses and it
       * is the walk's LIVENESS assertion that fires rather than its cliff
       * assertion. That is a correct failure and a weaker proof: it shows the
       * suite noticed something, not that the cliff detector works. Gated at
       * 0.25 the walk sees real proposals on both sides of a step, which is
       * the thing the detector has to catch. */
      find: '    const stepCap = w.prescribedMi * VOLUME_MAX_STEP_FRAC * clamp01(input.progressionFraction);',
      replace: '    const stepCap = w.prescribedMi * VOLUME_MAX_STEP_FRAC\n'
        + '      * (input.progressionFraction >= 0.25 ? 1 : 0);',
      expectNames: 'HAS A CLIFF',
    },
    {
      name: '5 · the curve turns back down, so the fitter runner is credited less',
      file: 'weight.ts',
      suite: WALK_SUITE,
      find: '  return gpsNoiseGate(surplusFrac) * Math.min(surplusFrac, PER_WEEK_CREDIT_CEILING_FRAC);',
      replace: '  return gpsNoiseGate(surplusFrac) * Math.min(surplusFrac, PER_WEEK_CREDIT_CEILING_FRAC)\n'
        + '    * (surplusFrac > 0.12 ? 0.5 : 1);',
      expectNames: 'NOT MONOTONE',
    },
    {
      name: '6 · a CHOSEN number relabels itself as physiology',
      file: 'weight.ts',
      suite: LEDGER_SUITE,
      find: "    name: 'PROVISIONAL_ABSORPTION_WEIGHT',\n    value: PROVISIONAL_ABSORPTION_WEIGHT,\n    provenance: 'POLICY_ASSUMPTION',",
      replace: "    name: 'PROVISIONAL_ABSORPTION_WEIGHT',\n    value: PROVISIONAL_ABSORPTION_WEIGHT,\n    provenance: 'CALCULATED_PHYSIOLOGY',",
      expectNames: 'CALCULATED_PHYSIOLOGY with no doc',
    },
    {
      name: '7 · a cited coefficient drifts away from what the doc says',
      file: 'weight.ts',
      suite: LEDGER_SUITE,
      find: 'export const GPS_DISTANCE_ERROR_LO_FRAC = 0.01;',
      replace: 'export const GPS_DISTANCE_ERROR_LO_FRAC = 0.02;',
      expectNames: 'AssertionError',
    },
    {
      name: '8 · the calibration identity is broken (0.15 / 0.05 stops being 3)',
      file: 'weight.ts',
      suite: LEDGER_SUITE,
      find: 'export const PROGRESSION_UNLOCK_FRAC = 0.15;',
      replace: 'export const PROGRESSION_UNLOCK_FRAC = 0.20;',
      expectNames: 'AssertionError',
    },
    {
      name: '9 · a STALE ledger entry names a constant that no longer exists (ratchet)',
      file: 'weight.ts',
      suite: LEDGER_SUITE,
      find: 'export const COEFFICIENTS: readonly Coefficient[] = [',
      replace: 'export const COEFFICIENTS: readonly Coefficient[] = [\n'
        + '  {\n'
        + "    name: 'A_CONSTANT_THAT_WAS_DELETED',\n"
        + '    value: 1,\n'
        + "    provenance: 'POLICY_ASSUMPTION',\n"
        + '    doc: null,\n'
        + '    anchor: null,\n'
        + "    says: 'A stale entry. It was chosen once and the constant is gone.',\n"
        + '  },',
      expectNames: 'stale ledger entry fails until it is deleted',
    },
  ];

  it('POSITIVE CONTROL · both suites are GREEN before anything is planted', () => {
    for (const suite of [WALK_SUITE, LEDGER_SUITE]) {
      const before = runSuite(suite);
      expect(before.ok, `${suite} must be green before falsification:\n${before.output}`)
        .toBe(true);
    }
  }, 300_000);

  for (const plant of PLANTS) {
    it(plant.name, () => {
      const abs = path.join(HERE, plant.file);
      const original = readFileSync(abs, 'utf8');
      expect(
        original.includes(plant.find),
        `PLANT ANCHOR ROTTED · the text is no longer in ${plant.file}. A falsifier whose `
        + 'anchor has moved silently stops falsifying, which is the exact failure Rule 18 '
        + `point 2 is about.\n  looked for: ${plant.find}`,
      ).toBe(true);
      try {
        writeFileSync(abs, original.replace(plant.find, plant.replace), 'utf8');
        const red = runSuite(plant.suite);
        expect(red.ok, `THE GATE DID NOT NOTICE:\n${plant.name}\n${red.output.slice(-2500)}`)
          .toBe(false);
        expect(
          red.output.includes(plant.expectNames),
          `the gate failed, but not for the stated reason. Expected the output to name `
          + `"${plant.expectNames}".\n${red.output.slice(-3000)}`,
        ).toBe(true);
        // eslint-disable-next-line no-console
        console.log(`\n[falsify] ${plant.name}\n  GATE FAILED, as required. It said:\n    `
          + `${firstFailure(red.output)}`);
      } finally {
        writeFileSync(abs, original, 'utf8');
        // Rule 18 · verify the restoration byte for byte. A falsifier that
        // leaves a mutated tree behind is worse than no falsifier.
        expect(readFileSync(abs, 'utf8')).toBe(original);
      }
    }, 300_000);
  }

  it('NEGATIVE CONTROL · the tree is restored and both suites are GREEN again', () => {
    for (const suite of [WALK_SUITE, LEDGER_SUITE]) {
      const after = runSuite(suite);
      expect(after.ok, `the tree was not restored:\n${after.output}`).toBe(true);
    }
  }, 300_000);
});
