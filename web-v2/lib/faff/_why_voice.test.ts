/**
 * lib/faff/_why_voice.test.ts — "Why this run" reads like a text, always.
 *
 * The rules are David's, 2026-08-21, and they apply to anything that ever
 * fills this section — not just the string that prompted them.
 */
import { describe, it, expect } from 'vitest';
import { composeWhy, deInterpunct, type WhyFacts } from './why-voice';

const base: WhyFacts = {
  phase: null, lastRaceName: null, daysSinceRace: null,
  dayNote: null, phaseRationale: null, fallback: null,
};

const AFC = { lastRaceName: 'Americas Finest City', daysSinceRace: 8 };

describe('composeWhy', () => {
  it('leads with the reason, not with what the run is', () => {
    const out = composeWhy({ ...base, ...AFC, phase: 'RECOVERY',
      dayNote: 'Recovery easy · conversational, no surges.' });
    expect(out.startsWith("You're eight days on from Americas Finest City")).toBe(true);
  });

  it('never prints an interpunct', () => {
    // `·` is UI punctuation — it separates fields on a stats plate, where
    // there is no grammar to carry the join. Nobody speaks it.
    const cases: WhyFacts[] = [
      { ...base, ...AFC, phase: 'RECOVERY', dayNote: 'Recovery easy · conversational, no surges.' },
      { ...base, phase: 'BASE', fallback: "Easy day. Just put the miles in. The week's volume is what matters · not how fast any one run goes." },
      { ...base, phase: 'QUALITY', fallback: 'Tempo. This is your comfortably-hard pace · about what you could hold for an hour all-out.' },
      { ...base, fallback: 'Long run. Time on feet · beats hitting any specific pace.' },
    ];
    for (const c of cases) expect(composeWhy(c)).not.toContain('·');
  });

  it('is never more than two sentences', () => {
    const cases: WhyFacts[] = [
      { ...base, ...AFC, phase: 'RECOVERY', dayNote: 'Recovery easy · conversational, no surges.' },
      { ...base, phase: 'QUALITY', fallback: 'Tempo. This is your comfortably-hard pace, about what you could hold for an hour. Lock in and stay there. And a fourth.' },
      { ...base, phase: 'BASE', fallback: "Easy day. Just put the miles in. The week's volume is what matters, not how fast any one run goes." },
    ];
    for (const c of cases) {
      const n = composeWhy(c).split('.').filter((x) => x.trim()).length;
      expect(n, composeWhy(c)).toBeLessThanOrEqual(2);
    }
  });

  it('drops the bare label the session type already carries', () => {
    // "Easy day." / "Tempo." are headings, not sentences, and the screen
    // prints the type in 56pt Archivo directly above this.
    for (const v of ['Easy day.', 'Tempo.', 'Long run.', 'Intervals.']) {
      const out = composeWhy({ ...base, phase: 'QUALITY', fallback: `${v} Something useful here.` });
      expect(out).not.toContain(v);
    }
  });

  it('says nothing extra on a rest day', () => {
    // The reason IS the message. "Off. Still recovering." repeats it in
    // fragments.
    const out = composeWhy({ ...base, ...AFC, phase: 'RECOVERY',
      dayNote: 'Off. Still recovering.', fallback: 'Rest day.' });
    expect(out).toBe("You're eight days on from Americas Finest City, so this week is still about absorbing it.");
  });

  it('never repeats the idea the opener already carried', () => {
    const out = composeWhy({ ...base, phase: 'BASE',
      fallback: "Easy day. Just put the miles in. The week's volume is what matters, not how fast any one run goes." });
    expect(out.toLowerCase().match(/week's (total|volume)/g)?.length ?? 0).toBeLessThanOrEqual(1);
  });

  it('degrades to the engine copy when it has no phase', () => {
    const out = composeWhy({ ...base, fallback: 'Long run. The long run is where the endurance lives.' });
    expect(out).toBe('The long run is where the endurance lives.');
  });

  it('returns empty rather than inventing when it has nothing', () => {
    expect(composeWhy(base)).toBe('');
  });

  it('spells a short span in words and a long one in weeks', () => {
    const d8 = composeWhy({ ...base, phase: 'RECOVERY', lastRaceName: 'AFC', daysSinceRace: 8 });
    expect(d8).toContain('eight days');
    const d21 = composeWhy({ ...base, phase: 'RECOVERY', lastRaceName: 'AFC', daysSinceRace: 21 });
    expect(d21).toContain('three weeks');
  });

  it('stops naming a race that is too far back to be the reason', () => {
    const out = composeWhy({ ...base, phase: 'RECOVERY', lastRaceName: 'AFC', daysSinceRace: 120 });
    expect(out).not.toContain('AFC');
  });

  it('carries no coach-voice violations', () => {
    const out = composeWhy({ ...base, ...AFC, phase: 'RECOVERY',
      dayNote: 'Recovery easy · conversational, no surges.' });
    expect(out).not.toMatch(/[!—]|:\)|😀/);
  });
});

describe('deInterpunct', () => {
  it('turns a field separator into prose punctuation', () => {
    expect(deInterpunct('Easy running only · no quality.')).toBe('Easy running only, no quality.');
  });
});
