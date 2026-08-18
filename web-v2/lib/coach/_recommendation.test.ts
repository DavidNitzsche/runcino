/**
 * Recommendation schema · tests.
 *
 * These hold two things at once: the structure (five parts, always present on
 * the object) and the voice rule that stops the structure becoming a form
 * (only the parts carrying information get spoken).
 */

import { describe, it, expect } from 'vitest';
import {
  combineConfidence,
  proceedAsPlanned,
  recommendFromAdaptation,
  renderDetail,
  renderShort,
  type Recommendation,
} from './recommendation';
import { classifyAdaptation, type AdaptationInput } from '@/lib/adaptation/adaptation-model';

function rec(over: Partial<Recommendation> = {}): Recommendation {
  return {
    action: 'Run 30 minutes easy',
    change: 'Reduced from 50',
    reason: 'Yesterday cost more than it should have',
    consequence: 'This keeps Friday’s long run intact',
    confidence: 'high',
    evidence: [],
    ...over,
  };
}

describe('the structure is data, not a script', () => {
  it('speaks nothing about a change when nothing changed', () => {
    const line = renderShort(rec({ change: null }));
    expect(line).not.toMatch(/reduced|instead of/i);
    expect(line).toMatch(/Run 30 minutes easy/);
  });

  it('does not announce confidence when it is high', () => {
    // Hedging a certainty is how a coach stops sounding like one.
    expect(renderShort(rec({ confidence: 'high' }))).not.toMatch(/confiden|provisional/i);
  });

  it('does say so when the read is provisional', () => {
    expect(renderShort(rec({ confidence: 'low' }))).toMatch(/provisional/i);
    expect(renderShort(rec({ confidence: 'medium' }))).toMatch(/not certain/i);
  });

  it('omits consequence rather than inventing one', () => {
    const line = renderShort(rec({ consequence: null }));
    expect(line).not.toMatch(/keeps Friday/);
    expect(line.length).toBeGreaterThan(0);
  });
});

describe('the detail view is honest about what was NOT known', () => {
  it('separates what we knew from what we could not see', () => {
    const d = renderDetail(
      rec({
        evidence: [
          { fact: 'ran 9 of 11 key sessions', provenance: 'inferred', confidence: 'high' },
          { fact: 'heart rate could not be read', provenance: 'missing' },
        ],
      }),
    );
    expect(d.knew).toHaveLength(1);
    expect(d.didNotKnow).toHaveLength(1);
    expect(d.didNotKnow[0].fact).toMatch(/could not be read/);
  });

  it('keeps the full five parts on the object even when the short line drops them', () => {
    const r = rec({ change: null, consequence: null });
    expect(r).toHaveProperty('action');
    expect(r).toHaveProperty('change');
    expect(r).toHaveProperty('reason');
    expect(r).toHaveProperty('consequence');
    expect(r).toHaveProperty('confidence');
  });
});

describe('confidence is the weakest link, never an average', () => {
  it('one low input makes the whole recommendation low', () => {
    expect(combineConfidence(['high', 'high', 'low'])).toBe('low');
  });

  it('one medium input caps at medium', () => {
    expect(combineConfidence(['high', 'medium'])).toBe('medium');
  });

  it('all high stays high', () => {
    expect(combineConfidence(['high', 'high'])).toBe('high');
  });

  it('knowing nothing is low, not high', () => {
    expect(combineConfidence([])).toBe('low');
    expect(combineConfidence([null, undefined])).toBe('low');
  });
});

describe('proceeding as planned is a decision, not silence', () => {
  it('carries the same structure as an intervention', () => {
    const r = proceedAsPlanned({
      action: 'Run the session as written',
      reason: 'Recent load is stable',
      confidence: 'high',
      evidence: [],
    });
    expect(r.change).toBeNull();
    expect(renderShort(r)).toMatch(/Run the session as written/);
  });
});

describe('adaptation verdicts become readable coaching', () => {
  function input(over: Partial<AdaptationInput> = {}): AdaptationInput {
    return {
      keySessionsPlanned: 8,
      keySessionsCompleted: 8,
      targetVerdicts: ['on', 'on', 'on', 'on'],
      repConsistency: ['even', 'even'],
      rpeReported: 4,
      rpeHarderThanExpected: 0,
      decouplingVerdicts: ['race-ready', 'race-ready'],
      lateDriftBpm: [4, 5],
      easyDiscipline: { established: false, read: null },
      recoveryPctOfExpected: 1,
      readinessBelowNormalDays: 4,
      readinessWindowDays: 28,
      weeklyPlannedMi: [40, 42, 44],
      weeklyActualMi: [40, 42, 44],
      trainingForm: 'PRODUCTIVE',
      distinctEvidenceWeeks: 4,
      adapterDowngrades: 0,
      niggleSeverity: 0,
      illnessActive: false,
      injuryActive: false,
      ...over,
    };
  }

  it('strong adaptation reads as earning more, and says what it buys', () => {
    const r = recommendFromAdaptation(classifyAdaptation(input()));
    expect(r.change).toBeTruthy();
    expect(r.consequence).toMatch(/earned|capacity/i);
  });

  it('holding names the tradeoff instead of sounding like a demotion', () => {
    const r = recommendFromAdaptation(
      classifyAdaptation(
        input({
          keySessionsCompleted: 5,
          targetVerdicts: ['slow', 'slow', 'on', 'slow'],
          repConsistency: ['fading', 'fading'],
        }),
      ),
    );
    expect(r.action).toMatch(/hold/i);
    expect(r.change).toMatch(/deferred, not cancelled/i);
    expect(r.consequence).toMatch(/adapting|lands better/i);
  });

  it('a veto is simple, not clever — the voice brief s final rule', () => {
    const r = recommendFromAdaptation(classifyAdaptation(input({ injuryActive: true })));
    expect(r.confidence).toBe('high');
    expect(r.consequence).toMatch(/short interruption/i);
    expect(renderShort(r)).not.toMatch(/[!🔥]/);
  });

  it('illness is framed as recovery, never as toughness', () => {
    const r = recommendFromAdaptation(classifyAdaptation(input({ illnessActive: true })));
    expect(r.action).toMatch(/recovery is the work/i);
  });

  it('unreadable dimensions surface as missing evidence, not as findings', () => {
    const r = recommendFromAdaptation(
      classifyAdaptation(input({ decouplingVerdicts: null, lateDriftBpm: null, rpeReported: null, rpeHarderThanExpected: null, easyDiscipline: null })),
    );
    const d = renderDetail(r);
    expect(d.didNotKnow.some((e) => /internal cost/.test(e.fact))).toBe(true);
  });

  it('never uses hype punctuation in any band', () => {
    for (const over of [
      {},
      { keySessionsCompleted: 4 },
      { keySessionsCompleted: 0, targetVerdicts: ['slow', 'slow', 'slow'] as Array<'slow'> },
      { illnessActive: true },
      { niggleSeverity: 9 },
    ]) {
      const line = renderShort(recommendFromAdaptation(classifyAdaptation(input(over))));
      expect(line).not.toMatch(/[!🔥💪]/);
    }
  });
});
