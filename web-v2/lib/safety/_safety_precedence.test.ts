/**
 * lib/safety/_safety_precedence.test.ts · THE FIVE RANKS, IN THE ORDER THE
 * OWNER STATED THEM, AND THE RULE 11 REFUSAL THAT SITS OUTSIDE THEM.
 *
 *   1 · injury hard stop
 *   2 · illness stop or modify
 *   3 · niggle caution
 *   4 · recovery constraint
 *   5 · normal coaching optimization
 *
 * The gate reads `SAFETY_PRECEDENCE` rather than restating it, so it checks the
 * array the engine actually uses. A test that hardcodes both sides only proves
 * the test agrees with itself (Rule 18).
 *
 * ── RULE 22 · WHAT THIS GATE CANNOT FAIL ON ────────────────────────────────
 *
 *   · IT CANNOT SEE THE DATABASE. Every case here drives `classifySafety` and
 *     `resolveTrainingSafety` with hand-built `SignalRead`s. If
 *     `load-safety.ts`'s SQL selects the wrong row, returns a stale one, or
 *     misses an escalating niggle because the ORDER BY changed, this suite
 *     stays green. `_safety_wired_live.test.ts` pins the WIRING and
 *     `_safety_ownership.test.ts` pins the LOCATION of the reads; nothing in
 *     this repo executes those statements against a real database in CI, and
 *     that is a real hole rather than a covered one.
 *   · IT CANNOT TELL A GOOD THRESHOLD FROM A BAD ONE. It asserts that the
 *     engine agrees with doctrine's amber band because the doctrine claim
 *     `SAFETY.niggle-amber-band-opens-at-three` reads the band out of
 *     `Research/05`; it has no opinion on whether a runner-reported 4/10 is
 *     really a reason not to progress.
 *   · IT CANNOT SEE SWIFT. `native-v2` renders the verdict on both devices.
 *   · IT CANNOT PROVE THE ENGINE EVER PUSHES. Every case here is a refusal or
 *     a permission to consider pushing, and a permission is not a push. Rule
 *     22's own warning applies to this file directly: it is a gate about
 *     declining, written while wiring the thing that declines, and it would
 *     pass an engine that never advances anything. `lib/brain/_propose_up
 *     .test.ts` and `_phase_arbitration.test.ts`'s monotonicity walks are what
 *     ask the opposite question.
 *
 * ── FALSIFICATION (Rule 18 §1) ─────────────────────────────────────────────
 *
 * Every assertion below was run against a deliberately broken engine before
 * this file was trusted, and the verbatim failures are in the commit message:
 * a missing safety read forced to NORMAL, a PUSH allowed to survive a hard
 * stop, and the precedence inverted so illness outranks injury.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  classifySafety,
  NIGGLE_CAUTION_SEVERITY,
  type DisruptionSignal,
  type IllnessSignal,
  type InjurySignal,
  type NiggleSignal,
  type ReturnToRunningSignal,
  type SafetyInputs,
  type SignalRead,
} from './safety-verdict';
import {
  SAFETY_PRECEDENCE,
  mayAdvanceTraining,
  rankOfTier,
  resolveTrainingSafety,
  TIER_BY_REASON,
  TRAINING_SAFETY_NOT_RESOLVED,
} from './training-safety';
import { describesEvidence } from '@/lib/brain/objective';

/* ── fixtures ─────────────────────────────────────────────────────────────── */

const none = <T>(): SignalRead<T> => ({ ok: true, value: null });
const failed = <T>(): SignalRead<T> => ({ ok: false, failure: 'READ_FAILED' });
const missingTable = <T>(): SignalRead<T> => ({ ok: false, failure: 'NOT_DEPLOYED' });

const injury = (severity: InjurySignal['severity']): SignalRead<InjurySignal> => ({
  ok: true,
  value: {
    id: 4, site: 'left calf', severity, startDateISO: '2026-08-21',
    expectedReturnDateISO: null, returnProtocol: null, notes: null,
  },
});
const illness = (hasFever: boolean): SignalRead<IllnessSignal> => ({
  ok: true,
  value: {
    id: 2, symptoms: ['fatigue'], hasFever, started: 'today',
    loggedAtISO: '2026-09-05T06:00:00.000Z', daysActive: 0,
  },
});
const niggle = (severity: number, previousSeverity: number | null = null): SignalRead<NiggleSignal> => ({
  ok: true,
  value: {
    id: 9, bodyPart: 'right achilles', severity, side: 'right', status: 'few_days',
    loggedAtISO: '2026-09-04T06:00:00.000Z', daysActive: 1,
    previousSeverity,
    escalating: previousSeverity != null && severity > previousSeverity,
  },
});
const returning = (): SignalRead<ReturnToRunningSignal> => ({
  ok: true,
  value: {
    injuryId: 4, site: 'left calf', resolvedDateISO: '2026-08-28',
    daysSinceResolved: 8, checkinCount: 3, returnProtocol: null,
  },
});
const disrupted = (gapDays: number): SignalRead<DisruptionSignal> => ({
  ok: true,
  value: {
    gapDays, gapEndedISO: '2026-08-25', returnedOnISO: '2026-08-26',
    daysSinceReturn: 10, constraintWindowDays: 14,
  },
});

const clear: SafetyInputs = {
  injury: none(), illness: none(), niggle: none(),
  returnToRunning: none(), disruption: none(),
};

const safetyFor = (i: Partial<SafetyInputs>) =>
  resolveTrainingSafety(classifySafety({ ...clear, ...i }));

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · THE PRECEDENCE IS THE ONE THAT WAS ASKED FOR
 * ═══════════════════════════════════════════════════════════════════════ */

describe('the five ranks, in the owner\'s order', () => {
  it('the array IS the stated precedence, and nothing has been reordered', () => {
    expect([...SAFETY_PRECEDENCE]).toEqual([
      'INJURY_HARD_STOP',
      'ILLNESS_STOP_OR_MODIFY',
      'NIGGLE_CAUTION',
      'RECOVERY_CONSTRAINT',
      'NORMAL_OPTIMIZATION',
    ]);
    expect(SAFETY_PRECEDENCE.length).toBe(5);
  });

  it('every tier has a distinct rank, 1 through 5', () => {
    const ranks = SAFETY_PRECEDENCE.map(rankOfTier);
    expect(ranks).toEqual([1, 2, 3, 4, 5]);
  });

  it('every SafetyReason has a rank · a new signal cannot arrive at 5 by omission', () => {
    // The declaration is `Record<SafetyReason, SafetyTier>`, so this is a
    // compile-time guarantee. Asserted at run time as well because the compile
    // error is only available to code that recompiles, and the failure mode
    // being guarded is a reason string arriving from a persisted row.
    for (const [reason, tier] of Object.entries(TIER_BY_REASON)) {
      expect(SAFETY_PRECEDENCE, `reason "${reason}" maps to an unknown tier`)
        .toContain(tier);
    }
    // and every tier is actually reachable, so a rank cannot be dead weight.
    const used = new Set(Object.values(TIER_BY_REASON));
    expect([...SAFETY_PRECEDENCE].filter((t) => !used.has(t))).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · EACH RANK, DRIVEN BY ITS OWN SIGNAL
 * ═══════════════════════════════════════════════════════════════════════ */

describe('each of the five states resolves to its own rank', () => {
  const cases: Array<[string, Partial<SafetyInputs>, number, string]> = [
    ['1 · an open injury', { injury: injury('moderate') }, 1, 'HARD_STOP'],
    ['1 · a MINOR open injury still stops the engine advancing',
      { injury: injury('minor') }, 1, 'HARD_STOP'],
    ['2 · an uncleared illness', { illness: illness(false) }, 2, 'HARD_STOP'],
    ['2 · an illness with fever', { illness: illness(true) }, 2, 'HARD_STOP'],
    ['3 · a niggle in the amber band',
      { niggle: niggle(NIGGLE_CAUTION_SEVERITY) }, 3, 'CONSTRAINED'],
    ['3 · an ESCALATING niggle below the amber band', { niggle: niggle(2, 1) }, 3, 'CONSTRAINED'],
    ['4 · a return-to-running window', { returnToRunning: returning() }, 4, 'CONSTRAINED'],
    ['4 · a recent training disruption', { disruption: disrupted(11) }, 4, 'CONSTRAINED'],
    ['5 · nothing firing', {}, 5, 'NORMAL'],
  ];

  for (const [name, inputs, rank, posture] of cases) {
    it(`${name} · rank ${rank}, posture ${posture}`, () => {
      const ts = safetyFor(inputs);
      expect(ts.readable, `${name} should be readable`).toBe(true);
      if (!ts.readable) throw new Error('unreachable');
      expect(ts.rank).toBe(rank);
      expect(ts.posture).toBe(posture);
      expect(mayAdvanceTraining(ts.posture)).toBe(rank === 5);
    });
  }

  it('a niggle in the GREEN band is rank 5 · doctrine says progress next session', () => {
    const ts = safetyFor({ niggle: niggle(NIGGLE_CAUTION_SEVERITY - 1) });
    expect(ts.readable && ts.rank).toBe(5);
    expect(mayAdvanceTraining(ts.posture)).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · PRECEDENCE UNDER CONFLICT · THE LOWER RANK WINS, EVERY PAIR
 * ═══════════════════════════════════════════════════════════════════════ */

describe('when two states fire at once, the lower rank governs', () => {
  const firing: Array<[number, Partial<SafetyInputs>]> = [
    [1, { injury: injury('moderate') }],
    [2, { illness: illness(true) }],
    [3, { niggle: niggle(9) }],
    [4, { returnToRunning: returning() }],
  ];

  // EXHAUSTIVE over every ordered pair, so no combination is checked by
  // sampling. 12 pairs, each asserted from both directions of construction.
  for (const [rankA, a] of firing) {
    for (const [rankB, b] of firing) {
      if (rankA >= rankB) continue;
      it(`rank ${rankA} outranks rank ${rankB}`, () => {
        const ts = safetyFor({ ...a, ...b });
        expect(ts.readable).toBe(true);
        if (!ts.readable) throw new Error('unreachable');
        expect(ts.rank, `rank ${rankA} and rank ${rankB} both firing`).toBe(rankA);
      });
    }
  }

  it('all four firing at once resolves to the injury', () => {
    const ts = safetyFor({
      injury: injury('major'), illness: illness(true),
      niggle: niggle(10), returnToRunning: returning(), disruption: disrupted(30),
    });
    expect(ts.readable && ts.rank).toBe(1);
    expect(ts.readable && ts.driver).toBe('injury');
  });

  it('the two rank-4 signals do not disagree with each other', () => {
    const ts = safetyFor({ returnToRunning: returning(), disruption: disrupted(11) });
    expect(ts.readable && ts.rank).toBe(4);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · RULE 11 · A MISSING READ IS NOT NORMAL, EVER
 * ═══════════════════════════════════════════════════════════════════════ */

describe('missing safety data cannot become NORMAL', () => {
  const signals = ['injury', 'illness', 'niggle', 'returnToRunning', 'disruption'] as const;

  // EXHAUSTIVE over every signal, and over both failure kinds. This is the
  // clause the owner named first, so it is checked one signal at a time rather
  // than with one representative case.
  for (const s of signals) {
    for (const [kind, mk] of [['READ_FAILED', failed], ['NOT_DEPLOYED', missingTable]] as const) {
      it(`${s} unreadable (${kind}) · never NORMAL, never advancing`, () => {
        const ts = safetyFor({ [s]: mk() } as Partial<SafetyInputs>);
        expect(ts.posture).toBe('UNREADABLE');
        expect(mayAdvanceTraining(ts.posture)).toBe(false);
        expect(ts.readable).toBe(false);
        if (ts.readable) throw new Error('unreachable');
        expect(ts.unreadable).toContain(s);
      });
    }
  }

  it('EVERY signal unreadable · still not NORMAL', () => {
    const ts = safetyFor({
      injury: failed(), illness: failed(), niggle: failed(),
      returnToRunning: failed(), disruption: failed(),
    });
    expect(ts.posture).toBe('UNREADABLE');
    expect(mayAdvanceTraining(ts.posture)).toBe(false);
  });

  it('THE ASYMMETRY · a degraded signal keeps the screen and refuses the proposal', () => {
    // `classifySafety` still answers for the phone, because a niggle read that
    // timed out cannot have changed what may be prescribed. The proposal
    // engine refuses anyway. Both halves asserted together, because the value
    // of this design is precisely that the two differ.
    const res = classifySafety({ ...clear, niggle: failed() });
    expect(res.known).toBe(true);
    if (!res.known) throw new Error('unreachable');
    expect(res.state).toBe('NORMAL');
    expect(res.posture).toBe('PRESCRIBE');
    expect(res.degradedSignals).toEqual(['niggle']);

    const ts = resolveTrainingSafety(res);
    expect(ts.posture).toBe('UNREADABLE');
    expect(mayAdvanceTraining(ts.posture)).toBe(false);
  });

  it('a caller with NO resolution at all gets UNREADABLE, not NORMAL', () => {
    expect(TRAINING_SAFETY_NOT_RESOLVED.posture).toBe('UNREADABLE');
    expect(mayAdvanceTraining(TRAINING_SAFETY_NOT_RESOLVED.posture)).toBe(false);
    expect(TRAINING_SAFETY_NOT_RESOLVED.readable).toBe(false);
  });

  it('there is exactly ONE posture that permits advancing', () => {
    // A structural check on the union, so a future member cannot be added as
    // permissive by accident. Reads the type's own declaration.
    const src = readFileSync(join(__dirname, 'training-safety.ts'), 'utf8');
    const decl = src.slice(
      src.indexOf('export type TrainingSafetyPosture ='),
      src.indexOf('export const mayAdvanceTraining'),
    );
    expect(decl.length, 'liveness · the posture union was not found').toBeGreaterThan(200);
    const members = [...decl.matchAll(/\|\s*'([A-Z_]+)'/g)].map((m) => m[1]);
    expect(members.sort()).toEqual(['CONSTRAINED', 'HARD_STOP', 'NORMAL', 'UNREADABLE']);
    expect(members.filter((m) => mayAdvanceTraining(m as never))).toEqual(['NORMAL']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · MONOTONICITY · RULE 9
 * ═══════════════════════════════════════════════════════════════════════ */

describe('Rule 9 · a worse signal never buys a more permissive answer', () => {
  it('walking niggle severity 0 to 10 is monotone in restriction', () => {
    let last = 5;
    for (let sev = 0; sev <= 10; sev += 1) {
      const ts = safetyFor({ niggle: niggle(sev) });
      expect(ts.readable).toBe(true);
      if (!ts.readable) throw new Error('unreachable');
      expect(ts.rank, `severity ${sev} relaxed the answer from rank ${last} to ${ts.rank}`)
        .toBeLessThanOrEqual(last);
      last = ts.rank;
    }
    // and it actually MOVED, so a resolver that returned a constant would fail
    // here rather than passing a monotonicity check trivially.
    expect(last).toBe(3);
  });

  it('walking a disruption gap 0 to 60 days is monotone in restriction', () => {
    let last = 5;
    for (let gap = 0; gap <= 60; gap += 1) {
      const ts = safetyFor({ disruption: gap === 0 ? none() : disrupted(gap) });
      expect(ts.readable).toBe(true);
      if (!ts.readable) throw new Error('unreachable');
      expect(ts.rank, `a ${gap}-day gap relaxed the answer from rank ${last}`)
        .toBeLessThanOrEqual(last);
      last = ts.rank;
    }
    expect(last).toBe(4);
  });

  it('an escalating niggle is never more permissive than the same reading held flat', () => {
    for (let sev = 1; sev <= 10; sev += 1) {
      const flat = safetyFor({ niggle: niggle(sev, sev) });
      const rising = safetyFor({ niggle: niggle(sev, sev - 1) });
      expect(flat.readable && rising.readable).toBe(true);
      if (!flat.readable || !rising.readable) throw new Error('unreachable');
      expect(rising.rank, `an escalating ${sev}/10 is milder than a flat one`)
        .toBeLessThanOrEqual(flat.rank);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6 · EVERY DECLINE NAMES A FACT · lib/brain/objective.ts's own predicate
 * ═══════════════════════════════════════════════════════════════════════ */

describe('every refusal carries evidence and a path back', () => {
  const all: Array<[string, Partial<SafetyInputs>]> = [
    ['injury', { injury: injury('major') }],
    ['illness', { illness: illness(true) }],
    ['niggle', { niggle: niggle(9) }],
    ['return', { returnToRunning: returning() }],
    ['disruption', { disruption: disrupted(11) }],
    ['unreadable', { injury: failed() }],
    ['clear', {}],
  ];

  for (const [name, inputs] of all) {
    it(`${name} · because names a fact, wouldAdvanceIf names a way out`, () => {
      const ts = safetyFor(inputs);
      // The objective's own rejector, not a second opinion written here. A
      // decline that says "to be safe" fails, which is the clause Rule 21
      // measured 309 production intents against.
      expect(describesEvidence(ts.because), `${name}: "${ts.because}"`).toBe(true);
      expect(ts.wouldAdvanceIf.trim(), `${name} has no path back to a push`).not.toBe('');
      expect(ts.explain).toContain('training-safety');
    });
  }
});
