/**
 * lib/brain/_objective.test.ts · the objective, enforced.
 *
 * ── RULE 22 · WHAT THIS GATE CANNOT FAIL ON ────────────────────────────────
 *
 * It cannot fail on `NON_REASONS` being an incomplete list. A decline that
 * invents a fresh way to say "it felt like a lot" passes `describesEvidence`
 * and this suite. The check catches a SHAPE, not a lie, and a reviewer is still
 * the only thing that catches a plausible-sounding false reason.
 *
 * It cannot fail on the ranking weights being wrong. `objectionToChoice` asks
 * whether a chosen option is defensible, never which option should have won,
 * and `rankOptions` is tested separately. Moving a weight would pass this whole
 * file while changing what a runner is prescribed.
 */
import { describe, it, expect } from 'vitest';
import {
  THE_OBJECTIVE, describesEvidence, objectionToChoice, optionsMissingEvidence,
  type DeclineJustification,
} from '@/lib/brain/objective';
import { heuristicRankScore, rankOptions } from '@/lib/plan/adjudication/adjudicate';
import type { EvidenceClass, Option, OptionAppraisal } from '@/lib/plan/adjudication/contract';

const opt = (o: Option, cls: EvidenceClass): OptionAppraisal => ({
  option: o, describe: o, evidenceClass: cls, heuristicRankScore: heuristicRankScore(cls), risk: '',
});

const good = (basis: DeclineJustification['basis']): DeclineJustification => ({
  basis,
  because: 'his last two long runs both deteriorated in the final third, measured against pace',
  wouldAdvanceIf: 'one long run completes without late fade',
});

describe('THE OBJECTIVE · a supported push beats an equally coherent hold', () => {
  it('ranks a SUPPORTED push above a SUPPORTED hold', () => {
    const ranked = rankOptions([
      opt('HOLD', 'SUPPORTED'), opt('PUSH', 'SUPPORTED'), opt('PULL_BACK', 'SUPPORTED'),
    ]);
    expect(ranked[0].option).toBe('PUSH');
  });

  it('objects when a SUPPORTED push is declined with no justification', () => {
    const o = objectionToChoice({
      chosen: 'HOLD', pushEvidence: 'SUPPORTED', declines: new Map(),
    });
    expect(o).toMatch(/disposition the objective forbids/);
  });

  it('objects when a SUPPORTED push is declined for ABSENT evidence', () => {
    // Rule 11 pointed the wrong way: absent evidence cannot outrank present
    // evidence. This is the shape that produced zero upward adaptations.
    const o = objectionToChoice({
      chosen: 'HOLD',
      pushEvidence: 'SUPPORTED',
      declines: new Map([['HOLD', good('EVIDENCE_ABSENT')]]),
    });
    expect(o).toMatch(/cannot outrank present evidence/);
  });

  it('accepts a supported push declined for a HARD STOP, a doctrine limit or prescribed recovery', () => {
    for (const basis of ['HARD_STOP', 'DOCTRINE_LIMIT', 'PRESCRIBED_RECOVERY'] as const) {
      expect(objectionToChoice({
        chosen: 'HOLD', pushEvidence: 'SUPPORTED', declines: new Map([['HOLD', good(basis)]]),
      })).toBeNull();
    }
  });
});

describe('THE OBJECTIVE · an unsupported push does not win for being harder', () => {
  it('ranks a SUPPORTED hold above a CONDITIONAL push', () => {
    const ranked = rankOptions([opt('PUSH', 'CONDITIONAL'), opt('HOLD', 'SUPPORTED')]);
    expect(ranked[0].option).toBe('HOLD');
  });

  it('objects when a push is chosen on CONDITIONAL, UNKNOWN or CONTRAINDICATED evidence', () => {
    for (const cls of ['CONDITIONAL', 'UNKNOWN', 'CONTRAINDICATED'] as const) {
      const o = objectionToChoice({ chosen: 'PUSH', pushEvidence: cls, declines: new Map() });
      expect(o, cls).toMatch(/Harder is not better on its own/);
    }
  });
});

describe('THE OBJECTIVE · declining costs evidence too', () => {
  it('a HOLD with no justification is a finding', () => {
    const bad = optionsMissingEvidence([opt('HOLD', 'SUPPORTED')], new Map());
    expect(bad.join(' ')).toMatch(/requires evidence to decline/);
  });

  it('a HOLD justified by a disposition rather than a fact is a finding', () => {
    const bad = optionsMissingEvidence([opt('HOLD', 'SUPPORTED')], new Map([['HOLD', {
      basis: 'ABSORPTION_EVIDENCE', because: 'this looks aggressive to me',
      wouldAdvanceIf: 'a clean week',
    }]]));
    expect(bad.join(' ')).toMatch(/asserts a\s+disposition rather than a fact/);
  });

  it('a decline with no path back to a push is a wall, not a bar', () => {
    const bad = optionsMissingEvidence([opt('PULL_BACK', 'SUPPORTED')], new Map([['PULL_BACK', {
      basis: 'ABSORPTION_EVIDENCE',
      because: 'his last two long runs both deteriorated in the final third',
      wouldAdvanceIf: '',
    }]]));
    expect(bad.join(' ')).toMatch(/does not say what would change its mind/);
  });

  it('a PUSH needs no decline justification, because it is not declining', () => {
    expect(optionsMissingEvidence([opt('PUSH', 'SUPPORTED')], new Map())).toEqual([]);
  });

  it('every stock non-reason is rejected, and a measurement is accepted', () => {
    for (const p of ['to be safe', 'safer', 'out of caution', 'this looks aggressive']) {
      expect(describesEvidence(`We held it because it is ${p}.`), p).toBe(false);
    }
    expect(describesEvidence('weekly volume rose 23% while the long run fell 12%')).toBe(true);
  });

  it('the objective is stated once and names absorption, not safety', () => {
    expect(THE_OBJECTIVE).toMatch(/maximum productive training load/);
    expect(THE_OBJECTIVE).toMatch(/can\s+absorb/);
  });
});
