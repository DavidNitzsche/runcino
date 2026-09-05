/**
 * lib/brain/_hard_stop_is_real.test.ts · THE OBJECTIVE NEVER OVERRIDES A HARD
 * STOP, AND THIS IS THE CHECK THAT MAKES THAT A FACT.
 *
 * ── WHAT WAS THERE BEFORE ──────────────────────────────────────────────────
 *
 *     export const OBJECTIVE_NEVER_OVERRIDES_A_HARD_STOP = true as const;
 *
 * A boolean that was always true, imported by nothing, branched on by nothing,
 * and impossible to make fail. Rule 20 in a single line: a product rule with no
 * gate is a hypothesis. The owner's instruction was to "make it real, not a
 * constant", and real means there is a way to break it and something notices.
 *
 * ── RULE 22 · WHAT THIS GATE CANNOT FAIL ON ────────────────────────────────
 *
 *   · IT CANNOT SEE WHETHER SAFETY IS RIGHT. Every case here hands
 *     `hardStopObjection` a posture. If `resolveSafety` returns NORMAL for a
 *     runner with a broken foot, this suite is green and the runner gets
 *     pushed. `_safety_precedence.test.ts` covers the resolution;
 *     `_safety_wired_live.test.ts` covers the wiring; nothing covers the SQL
 *     against a real database.
 *   · IT CANNOT PROVE THE ENGINE EVER PUSHES. This is a gate about refusing,
 *     written by the reasoning that wired a refusal. Rule 22's warning applies
 *     to it directly, and it is stated rather than hidden: an engine that
 *     returned PULL_BACK for every runner in every state would pass every
 *     assertion in this file. `_propose_up.test.ts` and
 *     `_phase_arbitration.test.ts`'s monotonicity walks ask the other half.
 *   · IT CANNOT SEE WHETHER ANYTHING CALLS THE PREDICATE. This file proves
 *     `hardStopObjection` and `objectionToChoice` BEHAVE, and nothing more.
 *     That the canonical engine actually consults them is asserted in
 *     `lib/adaptation/canonical/_safety_stops_the_engine.test.ts`, which lives
 *     inside that directory because `_cannot_mutate.test.ts`'s guard 4 is a
 *     ratcheted allowlist on who may import the engine at all, and a test is
 *     not a good reason to widen it.
 *
 * ── FALSIFICATION (Rule 18 §1) ─────────────────────────────────────────────
 *
 * Run against a deliberately broken engine before this file was trusted; the
 * verbatim failures are in the commit message. The break used was removing
 * `'HARD_STOP'` from `OBJECTIVE_YIELDS_TO` and from `objectionToChoice`'s
 * branch, which makes the objective override a hard stop.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  OBJECTIVE_NEVER_OVERRIDES_A_HARD_STOP,
  OBJECTIVE_YIELDS_TO,
  hardStopObjection,
  objectionToChoice,
  objectiveYieldsTo,
  type DeclineBasis,
  type DeclineJustification,
} from './objective';
import type { Option } from '@/lib/plan/adjudication/contract';
import type { TrainingSafetyPosture } from '@/lib/safety/training-safety';

const POSTURES: readonly TrainingSafetyPosture[] =
  ['NORMAL', 'CONSTRAINED', 'HARD_STOP', 'UNREADABLE'];
const OPTIONS: readonly Option[] = ['PUSH', 'HOLD', 'PULL_BACK'];

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · THE CONSTANT IS NOW THE FLAG ON MACHINERY
 * ═══════════════════════════════════════════════════════════════════════ */

describe('the constant is backed by something that can fail', () => {
  it('it still exists, because phase-priority cites it by name', () => {
    expect(OBJECTIVE_NEVER_OVERRIDES_A_HARD_STOP).toBe(true);
    const src = readFileSync(
      join(__dirname, '..', 'adaptation', 'canonical', 'phase-priority.ts'), 'utf8');
    expect(src).toContain('OBJECTIVE_NEVER_OVERRIDES_A_HARD_STOP');
  });

  it('the yield set is DATA, and a hard stop is in it', () => {
    expect(OBJECTIVE_YIELDS_TO).toContain('HARD_STOP');
    expect(objectiveYieldsTo('HARD_STOP')).toBe(true);
  });

  it('`objectionToChoice` branches on exactly the declared yield set', () => {
    // Reads the array the code uses rather than a copy written here, so the
    // check cannot pass by agreeing with itself (Rule 18).
    const bases: DeclineBasis[] = [
      'ABSORPTION_EVIDENCE', 'DOCTRINE_LIMIT', 'PRESCRIBED_RECOVERY',
      'HARD_STOP', 'SAFETY_UNREADABLE', 'EVIDENCE_ABSENT',
    ];
    for (const basis of bases) {
      const j: DeclineJustification = {
        basis,
        because: 'a measured fact stated at sufficient length to pass the evidence check',
        wouldAdvanceIf: 'the fact changes',
      };
      const objection = objectionToChoice({
        chosen: 'HOLD', pushEvidence: 'SUPPORTED', declines: new Map([['HOLD', j]]),
      });
      if (OBJECTIVE_YIELDS_TO.includes(basis)) {
        expect(objection, `${basis} is declared as a yield and was objected to`).toBeNull();
      }
    }
    // and the one that must NOT be a yield: absent CAPACITY evidence cannot
    // outrank present capacity evidence. This is the pairing that makes
    // SAFETY_UNREADABLE a separate basis rather than a reuse.
    expect(OBJECTIVE_YIELDS_TO).not.toContain('EVIDENCE_ABSENT');
    expect(objectionToChoice({
      chosen: 'HOLD',
      pushEvidence: 'SUPPORTED',
      declines: new Map([['HOLD', {
        basis: 'EVIDENCE_ABSENT',
        because: 'a measured fact stated at sufficient length to pass the evidence check',
        wouldAdvanceIf: 'the fact changes',
      }]]),
    })).not.toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · THE PREDICATE · EXHAUSTIVE OVER POSTURE x OPTION x ADVANCES
 * ═══════════════════════════════════════════════════════════════════════ */

describe('hardStopObjection · every posture, every option, both directions', () => {
  for (const safety of POSTURES) {
    for (const chosen of OPTIONS) {
      for (const advances of [true, false]) {
        it(`${safety} / ${chosen} / advances=${advances}`, () => {
          const objection = hardStopObjection({ safety, chosen, advances });
          const shouldObject = safety !== 'NORMAL' && (advances || chosen === 'PUSH');
          if (shouldObject) {
            expect(objection, `${safety} permitted ${chosen}`).not.toBeNull();
            // and it NAMES the fact rather than gesturing at caution.
            expect(objection!.length).toBeGreaterThan(60);
          } else {
            expect(objection, `${safety} objected to a non-advancing ${chosen}`).toBeNull();
          }
        });
      }
    }
  }

  it('a PUSH is objected to under all three non-NORMAL postures', () => {
    // The three refusals say DIFFERENT things, which is Rule 11's whole point.
    const said = POSTURES
      .filter((p) => p !== 'NORMAL')
      .map((safety) => hardStopObjection({ safety, chosen: 'PUSH', advances: true })!);
    expect(said.every((s) => typeof s === 'string' && s.length > 0)).toBe(true);
    expect(new Set(said).size, 'three postures gave the same sentence').toBe(3);
  });

  it('the objective does not object when Safety says NORMAL', () => {
    // The half that is NOT a refusal. Without it this file would pass an
    // implementation that objected to everything, which is the bias Rule 22
    // warns a refusal-shaped gate inherits.
    for (const chosen of OPTIONS) {
      for (const advances of [true, false]) {
        expect(hardStopObjection({ safety: 'NORMAL', chosen, advances })).toBeNull();
      }
    }
  });
});
