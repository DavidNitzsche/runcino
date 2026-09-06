/**
 * lib/adaptation/volume-evidence/_falsify_deterioration_severity.script.ts
 *
 * RULE 18, EXECUTED, ON THE DETERIORATION AXIS. "A gate is not trusted until
 * it has been made to fail."
 *
 *     npm --prefix web-v2 run falsify:deterioration
 *
 * Same shape and the same exemption as `_falsify_continuity.script.ts`: a
 * `.script.ts` rather than a `.test.ts` BECAUSE IT MUTATES SOURCE FILES on
 * purpose, and a normal `npm test` run must never rewrite files underneath
 * itself. Each case plants one defect, runs the real suite against the mutated
 * tree, asserts it FAILED and that the failure names the right thing, restores
 * the file in a `finally`, and verifies the restoration BYTE FOR BYTE.
 *
 * ── THE PLANTS ────────────────────────────────────────────────────────────
 *
 * Every plant is either the defect this change removed or one of the ways the
 * new rule could be quietly loosened:
 *
 *  1 · RESTORE THE OLD WALL. `admit.ts` refuses on any deteriorated session
 *      again. This is the exact code that made the owner's only surplus week
 *      worth nothing, and the credited cases must name it.
 *  2 · STEP THE SEVERITY CURVE. The ramp becomes all-or-nothing at 8 per cent.
 *      Both walks must name a cliff.
 *  3 · INVERT THE CURVE. A worse fade buys MORE. Rule 9's own signature, "the
 *      fitter runner gets the worse plan", pointed the other way.
 *  4 · SPEND "DON'T KNOW" AS "MILD". `admit.ts` stops distinguishing a fade
 *      whose severity could not be measured. Rule 11's collapse, on the axis
 *      where guessing mild GRANTS a raise.
 *  5 · MOVE THE CITED EDGE AWAY FROM THE DOCUMENT. Rule 7 point 2: the number
 *      is read out of `Research/03` at gate time, so a constant that drifts
 *      from its own citation must fail rather than agree with itself.
 *  6 · TAKE THE MILDEST SESSION INSTEAD OF THE WORST. A roll-up that averages
 *      away a collapse is the subtlest of the eight: every curve stays smooth,
 *      every citation still resolves, and a week with one wrecked session
 *      reads as clean.
 *  7 · DROP THE REPEATED BLOCK. Q13's own count, removed.
 *  9 · PAHR-QUANTITY-1 (2026-09-05) · READABILITY DISABLED. Every session
 *      reads fully readable regardless of duration, terrain or heat — a hot,
 *      hilly or too-short session is judged at full confidence again, which
 *      is the CLEAN/DETERIORATED-not-UNREADABLE collapse CLAUDE.md asked this
 *      round to falsify by name.
 * 10 · PAHR-QUANTITY-1 · THE EXTREME GATE IGNORES READABILITY. Even with
 *      case 9's check intact, a gate that never CONSULTS it reproduces the
 *      old cliff for a contaminated extreme session specifically.
 *
 * ── PART C · THE OTHER DIRECTION ──────────────────────────────────────────
 *
 * Rule 18 point 1 asks for BOTH directions where a gate has two. The
 * coefficient ledger's completeness check is a ratchet, so case 8 removes a
 * constant from `weight.ts`'s exports while leaving its ledger entry standing,
 * and asserts the STALE entry fails until deleted.
 *
 * ── RULE 22 · WHAT THIS FALSIFIER CANNOT TELL YOU ─────────────────────────
 *
 * It proves the gates notice ten specific breakages. It says nothing about
 * the breakages nobody thought to plant, and in particular it cannot plant the
 * one failure that would matter most: `Research/03` §12's band table being the
 * WRONG TABLE for a thirds-based comparison. That is a judgement, no gate in
 * this repo could catch it, and pretending otherwise would be the false
 * confidence Rule 18 exists to prevent. Nor can it plant the STEADY-EFFORT
 * precondition's absence, because nothing here implements it to falsify —
 * `deterioration.ts`'s own PAHR-QUANTITY-1 section names that gap directly.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const HERE = __dirname;
const WEB = path.resolve(HERE, '..', '..', '..');
const SEVERITY_SUITE = 'lib/adaptation/volume-evidence/_deterioration_severity.test.ts';
const SEAM_SUITE = 'lib/plan/_volume_seam.test.ts';
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

/**
 * The verbatim failing lines, so a report quotes rather than paraphrases.
 *
 * `want` is put FIRST when it appears, because a plant that cascades through
 * an imported suite can push the line that actually names the defect below the
 * noise. The first cut sliced the first four lines blind and quoted two
 * unrelated liveness failures for plant 3 while the assertion it cared about
 * was six lines down.
 */
function firstFailure(output: string, want?: string): string {
  const lines = output.split('\n')
    .filter((l) => /(FAIL|AssertionError|Error: CONTINUITY|Error: DOCTRINE|DOCTRINE ·)/.test(l))
    .map((l) => l.trim());
  const hit = want == null ? [] : lines.filter((l) => l.includes(want));
  const rest = lines.filter((l) => !hit.includes(l));
  return [...hit, ...rest].slice(0, 4).join('\n    ');
}

interface Plant {
  readonly name: string;
  /** Repo-relative from `web-v2`. */
  readonly file: string;
  readonly suite: string;
  readonly find: string;
  readonly replace: string;
  /** A fragment the red run must contain, so it fails for the RIGHT reason. */
  readonly expectNames: string;
}

const PLANTS: readonly Plant[] = [
  {
    name: '1 · the old wall is restored · any deteriorated session refuses the week',
    file: 'lib/adaptation/volume-evidence/admit.ts',
    suite: SEVERITY_SUITE,
    // PAHR-QUANTITY-1 (2026-09-05) re-expressed this line to sit where the
    // TWO-FACTOR weight is already zero (severity AND readability), rather
    // than comparing `worst` to the edge directly. The plant is unchanged in
    // intent — restore the categorical "any fade refuses" wall — only the
    // anchor moved with the line it was quoting.
    find: '  const extreme = worst != null && deteriorationConfidenceWeight(worst, worstReadability) <= WEIGHT_FLOOR_EPSILON;',
    replace: '  const extreme = det != null && det.deterioratedCount > 0;',
    // Named by the CASE rather than by the word FAIL, so the plant has to
    // break the thing it is aimed at (Rule 18 point 3).
    expectNames: 'ONE fade inside the TRANSITION band is admitted at less than face value',
  },
  {
    name: '2 · the severity ramp becomes a step at the endurance-gap edge',
    file: 'lib/adaptation/volume-evidence/weight.ts',
    suite: SEVERITY_SUITE,
    // PAHR-QUANTITY-1 split the old one-shot `return 1 - rampAcross(...)`
    // into a `penalty` (the severity curve) composed with `readability`. The
    // plant now steps the PENALTY, which is the same axis the original plant
    // stepped — `readability` defaults to 1 in every case this suite's part 3
    // walks, so the composed weight steps exactly where the penalty does.
    find: `  const penalty = rampAcross(
    DETERIORATION_DECOUPLING_FRAC,
    DETERIORATION_SEVERITY_EXTREME_FRAC,
    severityFrac,
  );`,
    replace: '  const penalty = severityFrac >= DETERIORATION_SEVERITY_EXTREME_FRAC ? 1 : 0;',
    expectNames: 'HAS A CLIFF',
  },
  {
    name: '3 · the curve is inverted · a worse fade buys MORE (Rule 9\'s signature)',
    file: 'lib/adaptation/volume-evidence/weight.ts',
    suite: SEVERITY_SUITE,
    // Inverting the PENALTY (rather than the whole return, as before the
    // split) is the equivalent defect in the new shape: penalty now FALLS as
    // severity rises, so `weight = 1 - readability * penalty` RISES — a
    // worse fade buys back confidence instead of losing it.
    find: `  const penalty = rampAcross(
    DETERIORATION_DECOUPLING_FRAC,
    DETERIORATION_SEVERITY_EXTREME_FRAC,
    severityFrac,
  );`,
    replace: `  const penalty = 1 - rampAcross(
    DETERIORATION_DECOUPLING_FRAC,
    DETERIORATION_SEVERITY_EXTREME_FRAC,
    severityFrac,
  );`,
    expectNames: 'NOT MONOTONE',
  },
  {
    name: '4 · "don\'t know" is spent as "mild" · Rule 11\'s collapse',
    file: 'lib/adaptation/volume-evidence/admit.ts',
    suite: SEVERITY_SUITE,
    find: '  const severityUnreadable = det != null && det.deterioratedCount > 0 && worst == null;',
    replace: '  const severityUnreadable = false;',
    expectNames: 'a fade whose size could not be measured is not a mild fade',
  },
  {
    name: '5 · the cited edge drifts away from what Research/03 §12 says',
    file: 'lib/adaptation/canonical/contract-constants.ts',
    suite: SEVERITY_SUITE,
    find: 'export const DETERIORATION_SEVERITY_EXTREME_FRAC = 0.08;',
    replace: 'export const DETERIORATION_SEVERITY_EXTREME_FRAC = 0.12;',
    expectNames: 'the floor of the ENDURANCE GAP row',
  },
  {
    name: '6 · the roll-up takes the MILDEST session instead of the worst',
    file: 'lib/adaptation/canonical/deterioration.ts',
    suite: SEVERITY_SUITE,
    // PAHR-QUANTITY-1 changed the roll-up from a bare `Math.max` over numbers
    // to a `reduce` over (severity, readability) PAIRS, because the readability
    // paired with the worst session has to travel with it (see
    // `DeteriorationPattern.worstSeverityReadabilityFrac`'s own doc). Flipping
    // the reduce's comparator is the equivalent plant: it now keeps the pair
    // with the SMALLEST severity instead of the largest.
    find: '    : readable.reduce((a, b) => (b.severityFrac > a.severityFrac ? b : a));',
    replace: '    : readable.reduce((a, b) => (b.severityFrac < a.severityFrac ? b : a));',
    expectNames: 'the roll-up takes the WORST readable session',
  },
  {
    name: '7 · Q13\'s repeated-session block is removed',
    file: 'lib/adaptation/volume-evidence/admit.ts',
    suite: SEAM_SUITE,
    find: '  } else if (input.deterioration.value.repeated) {',
    replace: '  } else if (false) {',
    expectNames: 'REPEATED fading refuses however mild each one was',
  },
  /* ── PART C · the ratchet, in the other direction ─────────────────────── */
  {
    name: '8 · RATCHET · a ledger entry naming a constant weight.ts no longer exports',
    file: 'lib/adaptation/volume-evidence/weight.ts',
    suite: LEDGER_SUITE,
    find: 'export { DETERIORATION_DECOUPLING_FRAC, DETERIORATION_SEVERITY_EXTREME_FRAC };',
    replace: 'export { DETERIORATION_DECOUPLING_FRAC };',
    expectNames: 'no longer exports',
  },
  /* ── PART D · PAHR-QUANTITY-1 (2026-09-05) ───────────────────────────── */
  {
    name: '9 · READABILITY IS DISABLED · every session reads fully readable regardless of duration, terrain or heat',
    file: 'lib/adaptation/canonical/deterioration.ts',
    suite: SEVERITY_SUITE,
    // Silently CLEAN or silently DETERIORATED is exactly what a contaminated
    // reading must not become — CLAUDE.md's own instruction for this round.
    // Disabling the check entirely is the most direct way to plant that: a
    // hot, hilly or too-short session goes back to being judged at FULL
    // confidence against Research/03 §12's bands, which is the defect
    // PAHR-QUANTITY-1 exists to close.
    find: `export function decouplingReadabilityFrac(env: SessionEnvironmentalContext): DecouplingReadability {
  let value = 1;`,
    replace: `export function decouplingReadabilityFrac(env: SessionEnvironmentalContext): DecouplingReadability {
  return { value: 1, detail: '' };
  let value = 1;`,
    expectNames: 'duration ramps from the confounder-table floor',
  },
  {
    name: '10 · THE EXTREME GATE IGNORES READABILITY · a contaminated extreme session is refused like a clean one',
    file: 'lib/adaptation/volume-evidence/admit.ts',
    suite: SEVERITY_SUITE,
    // The other half of the same defect class: even with `decouplingReadabilityFrac`
    // intact, a gate that does not CONSULT it reproduces the old cliff for
    // exactly the case this round exists to fix — a raw severity past 8%
    // whose own preconditions (duration, terrain, heat) were not met.
    find: '  const extreme = worst != null && deteriorationConfidenceWeight(worst, worstReadability) <= WEIGHT_FLOOR_EPSILON;',
    replace: '  const extreme = worst != null && worst + 1e-9 >= DETERIORATION_SEVERITY_EXTREME_FRAC;',
    expectNames: 'the IDENTICAL raw severity, marked UNREADABLE by environment, is ADMITTED at a discount instead',
  },
];

describe('RULE 18 · the deterioration-severity gates, made to fail', () => {
  it('the suites are GREEN before anything is planted', () => {
    const r = runSuite(SEVERITY_SUITE);
    expect(r.ok, `the severity suite is already red:\n${firstFailure(r.output)}`).toBe(true);
  }, 300_000);

  for (const p of PLANTS) {
    it(`PLANT ${p.name}`, () => {
      const abs = path.join(WEB, p.file);
      const original = readFileSync(abs, 'utf8');
      expect(
        original.includes(p.find),
        `PLANT ANCHOR IS STALE. ${p.file} no longer contains:\n${p.find}\n`
        + 'A falsifier that cannot find its own anchor plants nothing and passes, which is '
        + 'the dead-gate failure Rule 18 is about.',
      ).toBe(true);

      let result: { ok: boolean; output: string };
      try {
        writeFileSync(abs, original.replace(p.find, p.replace), 'utf8');
        result = runSuite(p.suite);
      } finally {
        writeFileSync(abs, original, 'utf8');
      }
      // BYTE FOR BYTE, before anything else is asserted.
      expect(readFileSync(abs, 'utf8')).toBe(original);

      expect(
        result.ok,
        `THE GATE DID NOT NOTICE: ${p.name}\nThe suite passed with the defect planted.`,
      ).toBe(false);
      expect(
        result.output.includes(p.expectNames),
        `The suite failed, but not for the right reason. Expected the output to name `
        + `"${p.expectNames}". It said:\n${firstFailure(result.output)}`,
      ).toBe(true);

      // eslint-disable-next-line no-console
      console.log(`\n[falsify ${p.name}]\n    ${firstFailure(result.output, p.expectNames)}\n`);
    }, 300_000);
  }

  it('and the suites are GREEN again once every plant is restored', () => {
    for (const suite of [SEVERITY_SUITE, SEAM_SUITE, LEDGER_SUITE]) {
      const r = runSuite(suite);
      expect(r.ok, `${suite} did not come back green:\n${firstFailure(r.output)}`).toBe(true);
    }
  }, 600_000);
});
