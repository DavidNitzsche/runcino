import { describe, it, expect } from 'vitest';
import { composeRecap } from './recap-voice';

/**
 * The fixture is the real payload from his 2026-08-24 easy four miles, the
 * one he read and called "the same shit over and over". Every assertion here
 * is about that screen.
 */
const REAL = {
  win: 'Steady the whole way',
  verdict: 'Easy done.',
  facts: ['Easy 4 mi at 8:34/mi. Run by feel · the right way to take an easy day.'],
  conditionsNote:
    '88°F · hot for running. Warm enough to cost a little pace. Heat does that · your fitness is fine.',
  coachTip:
    "Forget the pace in this · run by effort and cut it short if your HR won't settle. Move the run earlier next time.",
};

describe('recap voice · said once', () => {
  it('drops the verdict when a win already carries the judgement', () => {
    const r = composeRecap(REAL);
    expect(r.headline).toBe('Steady the whole way');
    expect(r.body.join(' ')).not.toContain('Easy done');
  });

  it('keeps the fact and drops the sentence defending it', () => {
    const r = composeRecap(REAL);
    expect(r.body).toContain('Easy 4 mi at 8:34/mi.');
    expect(r.body.join(' ')).not.toContain('the right way to take an easy day');
  });

  it('says the condition once', () => {
    const body = composeRecap(REAL).body.join(' ');
    expect(body).toContain('88°F');
    expect(body).not.toContain('cost a little pace');
    expect(body).not.toContain('your fitness is fine');
  });

  it('keeps only the part of the tip that is about next time', () => {
    const body = composeRecap(REAL).body.join(' ');
    expect(body).toContain('Move the run earlier next time');
    expect(body).not.toContain("cut it short");
  });

  it('emits no interpunct anywhere', () => {
    const r = composeRecap(REAL);
    expect([r.headline ?? '', ...r.body].join(' ')).not.toContain('·');
  });

  it('NEVER rewrites a number · every emitted string is one the engine wrote', () => {
    const r = composeRecap(REAL);
    const source = [REAL.win, REAL.verdict, ...REAL.facts, REAL.conditionsNote, REAL.coachTip]
      .filter(Boolean).join(' ').replace(/\s*·\s*/g, ', ');
    for (const line of r.body) {
      for (const sentence of line.split(/(?<=[.?])\s+/)) {
        expect(source).toContain(sentence.trim());
      }
    }
  });

  it('a run with only a verdict still says it · a refusal is not an empty screen', () => {
    const r = composeRecap({ win: null, verdict: 'Tempo held.', facts: [], conditionsNote: null, coachTip: null });
    expect(r.body).toEqual(['Tempo held.']);
  });

  it('drops a tip that is entirely about the run already finished', () => {
    const r = composeRecap({
      win: null, verdict: null, facts: [], conditionsNote: null,
      coachTip: 'Ease off the pace and let the heart rate settle.',
    });
    expect(r.body).toEqual([]);
  });

  it('CONTROL · the pre-fix payload really did repeat itself', () => {
    // Guards the fixture rather than the code: if the engine stops emitting
    // these, this test should be deleted, not quietly passing over nothing.
    const all = [REAL.win, REAL.verdict, ...REAL.facts, REAL.conditionsNote].join(' ').toLowerCase();
    expect(all.match(/easy/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(all.match(/heat|hot/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
