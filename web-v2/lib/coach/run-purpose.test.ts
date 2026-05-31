/**
 * Tests for lib/coach/run-purpose.ts
 *
 * Contract: derivePurpose(input) returns { verdict, facts } for every
 * WorkoutType. Each branch must:
 *   · produce a non-empty verdict
 *   · produce ≥1 fact
 *
 * Voice doctrine (David, 2026-05-31): plain English. No PhD jargon, no
 * citations on the payload. The science still drives the rules; it
 * doesn't drive the output text.
 *
 * Doctrine focus:
 *   · Marathon block (raceDistanceMi >= 20) and HM block (11 ≤ x < 20)
 *     yield different long-run framing.
 *   · Phase context (BASE/BUILD/PEAK/TAPER) varies easy + threshold facts.
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
}

describe('derivePurpose · every WorkoutType returns a valid payload', () => {
  for (const type of allTypes) {
    it(`type='${type}' returns non-empty verdict + facts`, () => {
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
  it('marathon block (26.2 mi) gets back-half-endurance framing', () => {
    const p = derivePurpose({
      type: 'long',
      phase: 'BUILD',
      raceDistanceMi: 26.2,
      plannedMi: 18,
    });
    // Marathon-specific framing: "single most important run" + "back half".
    expect(p.facts.join(' ')).toMatch(/single most important run|back half/);
  });

  it('half-marathon block (13.1 mi) gets pace-you-can-hold framing', () => {
    const p = derivePurpose({
      type: 'long',
      phase: 'BUILD',
      raceDistanceMi: 13.1,
      plannedMi: 12,
    });
    expect(p.facts.join(' ')).toMatch(/lifts the pace you can hold for a half|race pace feels/);
    // Should NOT carry marathon-specific framing.
    expect(p.facts.join(' ')).not.toMatch(/single most important run|back half/);
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

  it('short-distance block (5K=3.1) gets generic-endurance framing', () => {
    const p = derivePurpose({
      type: 'long', phase: 'BUILD', raceDistanceMi: 3.1, plannedMi: 8,
    });
    // Short blocks share the generic "endurance lives" framing.
    expect(p.facts.join(' ')).toMatch(/endurance lives|Time on feet beats hitting any specific pace/);
  });

  it('unknown distance (null) gets generic long-aerobic framing', () => {
    const p = derivePurpose({
      type: 'long', phase: 'BUILD', raceDistanceMi: null, plannedMi: 10,
    });
    expect(p.facts.join(' ')).toMatch(/endurance lives|Time on feet beats hitting any specific pace/);
  });

  it('PEAK phase adds dress-rehearsal fact', () => {
    const p = derivePurpose({
      type: 'long', phase: 'PEAK', raceDistanceMi: 26.2, plannedMi: 20,
    });
    expect(p.facts.join(' ')).toMatch(/dress rehearsal|Practice race effort/);
  });
});

describe('derivePurpose · type=easy · phase context', () => {
  it('BASE phase emphasizes the weekly volume bank', () => {
    const p = derivePurpose({
      type: 'easy', phase: 'BASE', raceDistanceMi: 26.2, plannedMi: 6,
    });
    expect(p.verdict).toBe('Easy day.');
    expect(p.facts.join(' ')).toMatch(/just put the miles in|week's volume|how fast any one run goes/i);
  });

  it('PEAK phase emphasizes recovery before hard stuff coming up', () => {
    const p = derivePurpose({
      type: 'easy', phase: 'PEAK', raceDistanceMi: 26.2, plannedMi: 6,
    });
    expect(p.facts.join(' ')).toMatch(/recovering for the hard stuff|don't get fancy/);
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

  it('BUILD/PEAK emphasizes weeks-of-compounding payoff', () => {
    const p = derivePurpose({
      type: 'threshold', phase: 'BUILD', raceDistanceMi: 13.1, plannedMi: 6,
    });
    expect(p.facts.join(' ')).toMatch(/pay off over weeks|ten of them changes your race time/);
  });

  it('BASE phase reminds about back off if pace/HR climbs', () => {
    const p = derivePurpose({
      type: 'tempo', phase: 'BASE', raceDistanceMi: 13.1, plannedMi: 6,
    });
    expect(p.facts.join(' ')).toMatch(/pace starts creeping|HR starts climbing|back off|bury yourself/);
  });
});

describe('derivePurpose · type=intervals · phase context', () => {
  it('PEAK phase adds sharpness framing', () => {
    const p = derivePurpose({
      type: 'intervals', phase: 'PEAK', raceDistanceMi: 5, plannedMi: 7,
    });
    expect(p.verdict).toBe('Intervals.');
    expect(p.facts.join(' ')).toMatch(/sharpness|Run the splits clean|don't grind out an extra rep/);
  });

  it('non-PEAK reminds about form-driven cutoff', () => {
    const p = derivePurpose({
      type: 'intervals', phase: 'BUILD', raceDistanceMi: 5, plannedMi: 7,
    });
    expect(p.facts.join(' ')).toMatch(/form falls apart|the rep is over|effort, not the clock/);
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
    expect(r.facts.join(' ')).toMatch(/blood flow|70% of max|Easier than your easy day/);
  });

  it('race verdict + pacing-doctrine fact', () => {
    const p = derivePurpose({
      type: 'race', phase: 'PEAK', raceDistanceMi: 26.2, plannedMi: 26.2,
    });
    expect(p.verdict).toBe('Race day.');
    expect(p.facts.join(' ')).toMatch(/Pace it|don't burn it all|Trust the training/);
  });

  it('rest verdict + adaptation-doctrine fact', () => {
    const p = derivePurpose({
      type: 'rest', phase: 'BUILD', raceDistanceMi: 26.2, plannedMi: 0,
    });
    expect(p.verdict).toBe('Rest day.');
    expect(p.facts.join(' ')).toMatch(/Real rest|Resting IS the work|no running/);
  });

  it('unplanned falls back to by-feel', () => {
    const p = derivePurpose({
      type: 'unplanned', phase: null, raceDistanceMi: null, plannedMi: 5,
    });
    expect(p.verdict).toBe('By feel.');
    expect(p.facts.length).toBeGreaterThanOrEqual(1);
  });

  it('fartlek and progression share verdict (Mixed effort.)', () => {
    const f = derivePurpose({
      type: 'fartlek', phase: 'BUILD', raceDistanceMi: 13.1, plannedMi: 6,
    });
    const pr = derivePurpose({
      type: 'progression', phase: 'BUILD', raceDistanceMi: 13.1, plannedMi: 8,
    });
    expect(f.verdict).toBe('Mixed effort.');
    expect(pr.verdict).toBe('Mixed effort.');
  });
});

describe('derivePurpose · plain-English voice doctrine', () => {
  // Voice doctrine (David, 2026-05-31): no PhD jargon on payloads.
  // The engine can read research-grounded rules, but the words shown to
  // the runner are everyday talk. Spot-check key types stay clean.
  const jargonWords = [
    'mitochondrial',
    'lactate threshold',
    'VO2max',
    'cardiovascular drift',
    'thermoregulation',
    'lactate-clearance',
    'mitochondrial biogenesis',
  ];

  for (const type of ['easy', 'long', 'tempo', 'threshold', 'intervals'] as WorkoutType[]) {
    it(`type='${type}' payload has no PhD jargon`, () => {
      const p = derivePurpose({
        type, phase: 'BUILD', raceDistanceMi: 26.2, plannedMi: 10,
      });
      const text = (p.verdict + ' ' + p.facts.join(' ')).toLowerCase();
      for (const word of jargonWords) {
        expect(text).not.toContain(word.toLowerCase());
      }
    });
  }

  it('payloads do NOT carry a citations field', () => {
    const p = derivePurpose({
      type: 'easy', phase: 'BASE', raceDistanceMi: 26.2, plannedMi: 6,
    });
    // Voice doctrine: citations are not surfaced on payloads.
    expect((p as unknown as { citations?: unknown }).citations).toBeUndefined();
  });
});
