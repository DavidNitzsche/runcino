/**
 * Tests for lib/coach/morning-brief.ts · the composed morning brief
 * (coach-experience pass, 2026-08-17).
 *
 * Locks:
 *   · sentence 1 skipped when no run + no check-in yesterday
 *   · sentence 1 prefers the acknowledge sentence over the neutral recap
 *   · sentence 2 always present · plan stands, score informs (no
 *     re-prescription in any band)
 *   · sentence 3 ONLY on season-context change (race ≤7d, phase
 *     boundary / milestone) · ordinary mornings get 2 sentences
 *   · race-week countdown beats milestone; race day suppresses the
 *     redundant countdown
 */
import { describe, it, expect } from 'vitest';
import { composeMorningBrief, type MorningBriefInput } from './morning-brief';

const base: MorningBriefInput = {
  todayISO: '2026-08-17',
  todayType: 'easy',
  todayMi: 6,
  todayLabel: null,
  readinessScore: 72,
  readinessBand: 'ready',
  acknowledgeSentence: null,
  yesterday: null,
  raceName: null,
  daysToRace: null,
  milestone: null,
};

describe('composeMorningBrief', () => {
  it('ordinary morning with no yesterday signal → today sentence only', () => {
    const b = composeMorningBrief(base);
    expect(b.sentences.recap).toBeNull();
    expect(b.sentences.season).toBeNull();
    expect(b.paragraph).toBe('Today is an easy run · 6 mi · readiness 72 · solid.');
  });

  it('acknowledge sentence wins sentence 1 when present', () => {
    const b = composeMorningBrief({
      ...base,
      acknowledgeSentence: "You called yesterday's tempo a grind · today stays truly easy.",
      yesterday: { ranMi: 8, type: 'tempo' },
    });
    expect(b.sentences.recap).toBe("You called yesterday's tempo a grind · today stays truly easy.");
    expect(b.paragraph.startsWith('You called')).toBe(true);
  });

  it('neutral recap when yesterday ran but gave no subjective read', () => {
    const b = composeMorningBrief({ ...base, yesterday: { ranMi: 8.1, type: 'tempo' } });
    expect(b.sentences.recap).toBe('8.1 mi tempo went in the book yesterday.');
  });

  it('pull-back band informs without re-prescribing · plan stands', () => {
    const b = composeMorningBrief({ ...base, readinessBand: 'pull-back', readinessScore: 34 });
    expect(b.sentences.today).toContain('the plan stands');
    // Never tells the runner to cut/skip/swap — the proposal banner owns that.
    expect(b.sentences.today).not.toMatch(/\b(skip|cut|swap|drop)\b/i);
  });

  it('no-data band omits the readiness clause', () => {
    const b = composeMorningBrief({ ...base, readinessBand: 'no-data', readinessScore: null });
    expect(b.sentences.today).toBe('Today is an easy run · 6 mi.');
  });

  it('rest day framing · stands alone, no readiness tail', () => {
    const b = composeMorningBrief({ ...base, todayType: 'rest', todayMi: 0 });
    expect(b.sentences.today).toBe('Rest day today · recovery is the work.');
  });

  it('nothing planned reads as nothing planned', () => {
    const b = composeMorningBrief({
      ...base, todayType: 'unplanned', todayMi: 0, readinessBand: null, readinessScore: null,
    });
    expect(b.sentences.today).toBe('Nothing on the plan today.');
  });

  it('race ≤7 days out earns sentence 3', () => {
    const b = composeMorningBrief({ ...base, raceName: 'AFC Half', daysToRace: 5 });
    expect(b.sentences.season).toBe('AFC Half is 5 days out · the work is done, the job now is arriving fresh.');
  });

  it('race tomorrow gets its own line', () => {
    const b = composeMorningBrief({ ...base, raceName: 'AFC Half', daysToRace: 1 });
    expect(b.sentences.season).toBe('AFC Half is tomorrow · nothing left to build, just arrive fresh.');
  });

  it('race day: sentence 2 owns the race, sentence 3 countdown suppressed', () => {
    const b = composeMorningBrief({
      ...base, todayType: 'race', raceName: 'AFC Half', daysToRace: 0, milestone: null,
    });
    expect(b.sentences.today).toBe('Race day · everything you need is already banked.');
    expect(b.sentences.season).toBeNull();
  });

  it('milestone earns sentence 3 when no race is near', () => {
    const b = composeMorningBrief({
      ...base,
      milestone: { kind: 'week_close', body: 'Biggest week of the block · 42.1 mi · both quality days landed.' },
    });
    expect(b.sentences.season).toBe('Biggest week of the block · 42.1 mi · both quality days landed.');
  });

  it('race countdown beats milestone', () => {
    const b = composeMorningBrief({
      ...base,
      raceName: 'AFC Half',
      daysToRace: 3,
      milestone: { kind: 'first_ever', body: 'Longest run you have ever logged · 18 mi.' },
    });
    expect(b.sentences.season).toContain('AFC Half is 3 days out');
  });

  it('sub_label becomes the session name when short', () => {
    const b = composeMorningBrief({
      ...base, todayType: 'threshold', todayMi: 8, todayLabel: 'Cruise Intervals',
    });
    expect(b.sentences.today).toBe('Today is cruise intervals · 8 mi · readiness 72 · solid.');
  });

  it('voice · full paragraph carries no em dash, no exclamation, no citation', () => {
    const b = composeMorningBrief({
      ...base,
      acknowledgeSentence: "Yesterday's easy stayed easy.",
      raceName: 'AFC Half',
      daysToRace: 6,
    });
    expect(b.paragraph).not.toMatch(/—|!|Research\//);
    expect(b.paragraph.split('. ').length).toBeLessThanOrEqual(4);
  });
});
