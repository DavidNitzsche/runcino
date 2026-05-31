/**
 * Tests for lib/coach/run-purpose.ts
 *
 * Contract: derivePurpose(input) returns { verdict, facts, citations }
 * for every WorkoutType. Each branch must:
 *   · produce a non-empty verdict
 *   · produce ≥1 fact
 *   · cite at least one Research/* slug
 *
 * Doctrine focus:
 *   · Marathon block (raceDistanceMi >= 20) and HM block (11 ≤ x < 20)
 *     yield different long-run framing.
 *   · Phase context (BASE/BUILD/PEAK/TAPER) varies easy + threshold facts.
 *
 * Citation slugs MUST resolve to actual Research/ markdown — these tests
 * pin the exact slug strings the UI links to.
 */

import { describe, it, expect } from 'vitest';
import {
  derivePurpose,
  type WorkoutType,
  type Phase,
  type PurposePayload,
} from './run-purpose';

const allTypes: WorkoutType[] = [
  'easy', 'long', 'tempo', 'threshold', 'intervals', 'fartlek',
  'progression', 'recovery', 'shakeout', 'race', 'rest', 'unplanned',
];

function assertPayloadShape(p: PurposePayload): void {
  expect(typeof p.verdict).toBe('string');
  expect(p.verdict.length).toBeGreaterThan(0);
  expect(Array.isArray(p.facts)).toBe(true);
  expect(p.facts.length).toBeGreaterThanOrEqual(1);
  for (const f of p.facts) {
    expect(typeof f).toBe('string');
    expect(f.length).toBeGreaterThan(0);
  }
  expect(Array.isArray(p.citations)).toBe(true);
  expect(p.citations.length).toBeGreaterThanOrEqual(1);
  for (const c of p.citations) {
    expect(c.slug).toMatch(/^research-/);
    expect(typeof c.label).toBe('string');
    expect(c.label.length).toBeGreaterThan(0);
  }
}

describe('derivePurpose · every WorkoutType returns a valid payload', () => {
  for (const type of allTypes) {
    it(`type='${type}' returns non-empty verdict + facts + citations`, () => {
      const p = derivePurpose({
        type,
        phase: 'BUILD',
        raceDistanceMi: 26.2,
        plannedMi: 10,
      });
      assertPayloadShape(p);
    });
  }
});

describe('derivePurpose · type=long · marathon vs half framing', () => {
  it('marathon block (26.2 mi) gets mitochondrial / fat-oxidation language', () => {
    const p = derivePurpose({
      type: 'long',
      phase: 'BUILD',
      raceDistanceMi: 26.2,
      plannedMi: 18,
    });
    // Marathon-specific stimulus mentions mitochondrial biogenesis + fat
    // oxidation + 10K dependency. These are the marathon-block tells.
    expect(p.facts.join(' ')).toMatch(/Marathon-specific aerobic stimulus/);
    expect(p.facts.join(' ')).toMatch(/mitochondrial biogenesis|fat-oxidation/);
  });

  it('half-marathon block (13.1 mi) gets aerobic-ceiling framing', () => {
    const p = derivePurpose({
      type: 'long',
      phase: 'BUILD',
      raceDistanceMi: 13.1,
      plannedMi: 12,
    });
    expect(p.facts.join(' ')).toMatch(/Aerobic ceiling work|half-marathon block/);
    // Should NOT carry marathon-specific framing.
    expect(p.facts.join(' ')).not.toMatch(/Marathon-specific aerobic stimulus/);
  });

  it('marathon and HM produce different first-fact text', () => {
    const m = derivePurpose({
      type: 'long', phase: 'BUILD', raceDistanceMi: 26.2, plannedMi: 16,
    });
    const h = derivePurpose({
      type: 'long', phase: 'BUILD', raceDistanceMi: 13.1, plannedMi: 12,
    });
    expect(m.facts[0]).not.toBe(h.facts[0]);
  });

  it('short-distance block (5K=3.1) gets VO2-ceiling framing', () => {
    const p = derivePurpose({
      type: 'long', phase: 'BUILD', raceDistanceMi: 3.1, plannedMi: 8,
    });
    expect(p.facts.join(' ')).toMatch(/short-distance|VO2 ceiling/);
  });

  it('unknown distance (null) gets generic long-aerobic framing', () => {
    const p = derivePurpose({
      type: 'long', phase: 'BUILD', raceDistanceMi: null, plannedMi: 10,
    });
    expect(p.facts.join(' ')).toMatch(/Long aerobic stimulus/);
  });

  it('PEAK phase adds race-rehearsal fact', () => {
    const p = derivePurpose({
      type: 'long', phase: 'PEAK', raceDistanceMi: 26.2, plannedMi: 20,
    });
    expect(p.facts.join(' ')).toMatch(/peak phase|rehearse race effort/i);
  });
});

describe('derivePurpose · type=easy · phase context', () => {
  it('BASE phase emphasizes volume compounding', () => {
    const p = derivePurpose({
      type: 'easy', phase: 'BASE', raceDistanceMi: 26.2, plannedMi: 6,
    });
    expect(p.verdict).toBe('Build aerobic capacity.');
    expect(p.facts.join(' ')).toMatch(/base phase.*compound|conversational/);
  });

  it('PEAK phase emphasizes adaptation between hard sessions', () => {
    const p = derivePurpose({
      type: 'easy', phase: 'PEAK', raceDistanceMi: 26.2, plannedMi: 6,
    });
    expect(p.facts.join(' ')).toMatch(/let adaptation land|blunt the next hard session/);
  });
});

describe('derivePurpose · type=tempo/threshold · phase context', () => {
  it('tempo and threshold produce same payload (aliased)', () => {
    const t = derivePurpose({
      type: 'tempo', phase: 'BUILD', raceDistanceMi: 13.1, plannedMi: 6,
    });
    const th = derivePurpose({
      type: 'threshold', phase: 'BUILD', raceDistanceMi: 13.1, plannedMi: 6,
    });
    expect(t.verdict).toBe(th.verdict);
    expect(t.facts).toEqual(th.facts);
  });

  it('BUILD/PEAK emphasizes threshold compounding', () => {
    const p = derivePurpose({
      type: 'threshold', phase: 'BUILD', raceDistanceMi: 13.1, plannedMi: 6,
    });
    expect(p.facts.join(' ')).toMatch(/Threshold compounds|lifts every other pace/);
  });

  it('BASE phase reminds about pace creep', () => {
    const p = derivePurpose({
      type: 'tempo', phase: 'BASE', raceDistanceMi: 13.1, plannedMi: 6,
    });
    expect(p.facts.join(' ')).toMatch(/Pace creeping = HR creeping|bury the next session/);
  });
});

describe('derivePurpose · type=intervals · phase context', () => {
  it('PEAK phase adds neuromuscular framing', () => {
    const p = derivePurpose({
      type: 'intervals', phase: 'PEAK', raceDistanceMi: 5, plannedMi: 7,
    });
    expect(p.verdict).toBe('Empty the engine.');
    expect(p.facts.join(' ')).toMatch(/race-specific economy|neuromuscular firing|sharpness/);
  });

  it('non-PEAK reminds about form-driven cutoff', () => {
    const p = derivePurpose({
      type: 'intervals', phase: 'BUILD', raceDistanceMi: 5, plannedMi: 7,
    });
    expect(p.facts.join(' ')).toMatch(/stimulus, not the splits|form falls apart/);
  });
});

describe('derivePurpose · simple-branch verdicts', () => {
  it('recovery and shakeout share verdict + facts', () => {
    const r = derivePurpose({
      type: 'recovery', phase: 'BUILD', raceDistanceMi: 26.2, plannedMi: 3,
    });
    const s = derivePurpose({
      type: 'shakeout', phase: 'BUILD', raceDistanceMi: 26.2, plannedMi: 2,
    });
    expect(r.verdict).toBe('Shake the legs.');
    expect(s.verdict).toBe('Shake the legs.');
    expect(r.facts).toEqual(s.facts);
    expect(r.facts.join(' ')).toMatch(/Active recovery|70% of max/);
  });

  it('race verdict + pacing-doctrine fact', () => {
    const p = derivePurpose({
      type: 'race', phase: 'PEAK', raceDistanceMi: 26.2, plannedMi: 26.2,
    });
    expect(p.verdict).toBe('Race the gap.');
    expect(p.facts.join(' ')).toMatch(/Pacing is the prescription/);
    // Race carries pacing+race-week citation.
    expect(p.citations.some((c) => c.slug.includes('pacing-and-race-week'))).toBe(true);
  });

  it('rest verdict + adaptation-doctrine fact', () => {
    const p = derivePurpose({
      type: 'rest', phase: 'BUILD', raceDistanceMi: 26.2, plannedMi: 0,
    });
    expect(p.verdict).toBe('Take the rest.');
    expect(p.facts.join(' ')).toMatch(/Adaptation happens between sessions/);
    expect(p.citations.some((c) => c.slug.includes('recovery-protocols'))).toBe(true);
  });

  it('unplanned falls back to by-feel', () => {
    const p = derivePurpose({
      type: 'unplanned', phase: null, raceDistanceMi: null, plannedMi: 5,
    });
    expect(p.verdict).toBe('By feel.');
    expect(p.facts.length).toBeGreaterThanOrEqual(1);
  });

  it('fartlek and progression share verdict (Vary the engine.)', () => {
    const f = derivePurpose({
      type: 'fartlek', phase: 'BUILD', raceDistanceMi: 13.1, plannedMi: 6,
    });
    const pr = derivePurpose({
      type: 'progression', phase: 'BUILD', raceDistanceMi: 13.1, plannedMi: 8,
    });
    expect(f.verdict).toBe('Vary the engine.');
    expect(pr.verdict).toBe('Vary the engine.');
  });
});

describe('derivePurpose · citation slugs match Research/ markdown filenames', () => {
  // These slugs are what the UI links to. They MUST stay stable.
  it('easy cites vocab + zones + HR', () => {
    const p = derivePurpose({
      type: 'easy', phase: 'BASE', raceDistanceMi: 26.2, plannedMi: 6,
    });
    const slugs = p.citations.map((c) => c.slug);
    expect(slugs).toContain('research-04-workout-vocabulary');
    expect(slugs).toContain('research-01-pace-zones-vdot');
    expect(slugs).toContain('research-03-heart-rate-zones');
  });

  it('long cites vocab + distance running + zones', () => {
    const p = derivePurpose({
      type: 'long', phase: 'BUILD', raceDistanceMi: 26.2, plannedMi: 18,
    });
    const slugs = p.citations.map((c) => c.slug);
    expect(slugs).toContain('research-04-workout-vocabulary');
    expect(slugs).toContain('research-00a-distance-running-training');
    expect(slugs).toContain('research-01-pace-zones-vdot');
  });

  it('threshold cites vocab + zones + HR', () => {
    const p = derivePurpose({
      type: 'threshold', phase: 'BUILD', raceDistanceMi: 13.1, plannedMi: 6,
    });
    const slugs = p.citations.map((c) => c.slug);
    expect(slugs).toContain('research-04-workout-vocabulary');
    expect(slugs).toContain('research-01-pace-zones-vdot');
    expect(slugs).toContain('research-03-heart-rate-zones');
  });
});
