/**
 * FITNESS MODEL (A) · the range, the confidence, and the promise that the
 * point estimate did not move.
 *
 * Design/adaptive-progression-engine.md §A. The load-bearing test in this file
 * is the first one: `resolveFitness` is a WIDENING of `bestRecentVdot`, not a
 * re-anchor. Every prescribed pace in the app hangs off `best.vdot`; if this
 * module can shift it by so much as a tenth, it is a pace change disguised as
 * a reporting change. That is asserted end-to-end through the real selector,
 * not against a hand-built expectation.
 *
 * The rest lock the four things the band is allowed to be made of - anchor
 * distance, anchor age, anchor source, and whether independent evidence agrees
 * - plus the doctrine's actual complaint: `1:38:17` must be unreachable.
 */
import { describe, expect, it } from 'vitest';
import {
  bestRecentVdot,
  predictRaceTime,
  VDOT_FULL_VALUE_DAYS,
  FRESH_RACE_PRECEDENCE_DAYS,
  type RaceVdotCandidate,
  type RunVdotCandidate,
  type VdotCandidate,
} from '../training/vdot';
import { resolveFitness, type FitnessEstimate } from './fitness-model';

const HM_MI = 13.1094;
const TODAY = '2026-08-17';
const addDays = (iso: string, n: number): string =>
  new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

/** Candidate factories. Only distance/vdot/age/source/label are read by the
 *  model, but the full shape is built so these stay assignable to the union. */
const raceC = (o: {
  vdot: number; age: number; distanceMi?: number; name?: string; slug?: string;
}): RaceVdotCandidate => ({
  source: 'race',
  slug: o.slug ?? 'test-race',
  name: o.name ?? 'Test Half',
  date: addDays(TODAY, -o.age),
  priority: 'A',
  distance_mi: o.distanceMi ?? HM_MI,
  finish_seconds: predictRaceTime(o.vdot, o.distanceMi ?? HM_MI) ?? 5900,
  vdot: o.vdot,
  vdot_raw: o.vdot,
  age_days: o.age,
});

const runC = (o: {
  vdot: number; age: number; distanceMi?: number; workoutType?: string; id?: string;
}): RunVdotCandidate => ({
  source: 'run',
  id: o.id ?? 'run-1',
  date: addDays(TODAY, -o.age),
  workout_type: o.workoutType ?? 'threshold',
  distance_mi: o.distanceMi ?? 6.0,
  finish_seconds: predictRaceTime(o.vdot, o.distanceMi ?? 6.0) ?? 2700,
  vdot: o.vdot,
  vdot_raw: o.vdot,
  age_days: o.age,
});

/** Run the model over a hand-built distribution, anchor = considered[0]. */
const resolve = (considered: VdotCandidate[]): FitnessEstimate => {
  const out = resolveFitness({ best: considered[0] ?? null, considered });
  if (!out) throw new Error('expected an estimate');
  return out;
};

/** Band width in VDOT points. vdotLo is the FASTER (higher) edge. */
const width = (e: FitnessEstimate): number =>
  Math.round((e.vdotLo - e.vdotHi) * 100) / 100;

// ---------------------------------------------------------------------------
// 1 · THE POINT ESTIMATE DOES NOT MOVE
// ---------------------------------------------------------------------------

describe('the point estimate is unchanged vs bestRecentVdot', () => {
  // A real distribution: an A-race inside the fresh window, an older race in
  // the floor-only band, and a threshold run. Exactly the shape that makes
  // bestRecentVdot's ordering doctrine (fresh-race precedence, floor-only
  // demotion, the training soft cap) actually fire.
  const RACES = [
    { slug: 'afc-half-2026', name: 'AFC Half', date: addDays(TODAY, -5), priority: 'A' as const, distance_mi: HM_MI, finish_seconds: 6113 },
    { slug: 'disney-half-2026', name: 'Disney Half', date: addDays(TODAY, -70), priority: 'A' as const, distance_mi: HM_MI, finish_seconds: 5694 },
  ];
  const RUNS = [
    { id: 'r1', date: addDays(TODAY, -12), workout_type: 'threshold', distance_mi: 6.0, finish_seconds: 2520, zone: 'threshold' as const },
  ];

  it('republishes best.vdot byte-identically', () => {
    const sel = bestRecentVdot(RACES, TODAY, VDOT_FULL_VALUE_DAYS, RUNS);
    expect(sel.best).not.toBeNull();
    const est = resolveFitness(sel);
    expect(est).not.toBeNull();
    expect(est!.vdot).toBe(sel.best!.vdot);
  });

  it('holds across every anchor age the selector will produce', () => {
    // Walk the fresh / slightly-stale / floor-only bands. The selected anchor
    // changes underneath as candidates age out; the identity must not care.
    for (const offset of [0, 10, 30, 55, 60, 80]) {
      const asOf = addDays(TODAY, offset);
      const sel = bestRecentVdot(RACES, asOf, VDOT_FULL_VALUE_DAYS, RUNS);
      const est = resolveFitness(sel);
      if (sel.best == null) {
        expect(est).toBeNull();
        continue;
      }
      expect(est!.vdot).toBe(sel.best!.vdot);
    }
  });

  it('returns null when there is no candidate at all', () => {
    const sel = bestRecentVdot([], TODAY, VDOT_FULL_VALUE_DAYS, []);
    expect(sel.best).toBeNull();
    expect(resolveFitness(sel)).toBeNull();
  });

  it('always brackets the point estimate · vdotLo >= vdot >= vdotHi', () => {
    const cases: VdotCandidate[][] = [
      [raceC({ vdot: 48, age: 3 })],
      [raceC({ vdot: 48, age: 70 })],
      [runC({ vdot: 45, age: 10 })],
      [raceC({ vdot: 48, age: 5 }), raceC({ vdot: 41, age: 20, slug: 'other' })],
      [raceC({ vdot: 84.8, age: 5 })], // near the top of the Daniels table
      [raceC({ vdot: 30.2, age: 5 })], // near the floor
    ];
    for (const c of cases) {
      const e = resolve(c);
      expect(e.vdotLo).toBeGreaterThanOrEqual(e.vdot);
      expect(e.vdotHi).toBeLessThanOrEqual(e.vdot);
    }
  });
});

// ---------------------------------------------------------------------------
// 2 · WHAT WIDENS THE BAND
// ---------------------------------------------------------------------------

describe('anchor recency sizes the band', () => {
  it('a fresh race gives a narrower band than a slightly-stale one', () => {
    const fresh = resolve([raceC({ vdot: 48, age: 5 })]);
    const midAge = resolve([raceC({ vdot: 48, age: 40 })]);
    expect(width(fresh)).toBeLessThan(width(midAge));
  });

  it('a stale anchor widens further still', () => {
    const midAge = resolve([raceC({ vdot: 48, age: 40 })]);
    const stale = resolve([raceC({ vdot: 48, age: 70 })]);
    expect(width(stale)).toBeGreaterThan(width(midAge));
  });

  it('the ladder is monotone across the doctrine freshness bands', () => {
    const widths = [5, 40, 70, 200].map((age) => width(resolve([raceC({ vdot: 48, age })])));
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeGreaterThan(widths[i - 1]);
    }
  });
});

describe('anchor distance sizes the band', () => {
  it('a marathon anchor reads wider than a 10K anchor at the same VDOT', () => {
    const tenK = resolve([raceC({ vdot: 48, age: 5, distanceMi: 6.21371 })]);
    const mar = resolve([raceC({ vdot: 48, age: 5, distanceMi: 26.2188 })]);
    expect(width(mar)).toBeGreaterThan(width(tenK));
  });
});

describe('disagreeing evidence widens the band', () => {
  const anchor = raceC({ vdot: 48, age: 5 });

  it('a corroborating read that agrees leaves the band at the table width', () => {
    const alone = resolve([anchor]);
    const agreeing = resolve([anchor, raceC({ vdot: 47.6, age: 20, slug: 'agree' })]);
    expect(width(agreeing)).toBeCloseTo(width(alone), 1);
  });

  it('a read that disagrees materially widens it', () => {
    const alone = resolve([anchor]);
    const disagreeing = resolve([anchor, raceC({ vdot: 41, age: 20, slug: 'disagree' })]);
    expect(width(disagreeing)).toBeGreaterThan(width(alone));
  });

  it('widens monotonically with the size of the disagreement', () => {
    const w = [47, 45, 42, 39].map((v) =>
      width(resolve([anchor, raceC({ vdot: v, age: 20, slug: 'd' })])));
    for (let i = 1; i < w.length; i++) expect(w[i]).toBeGreaterThanOrEqual(w[i - 1]);
    expect(w[3]).toBeGreaterThan(w[0]);
  });

  it('ignores candidates outside the full-value window as cross-checks', () => {
    // A 70-day-old read is a floor, not a cross-check (Research/01). It must
    // not drag the band of a fresh anchor.
    const alone = resolve([anchor]);
    const withStale = resolve([anchor, raceC({ vdot: 39, age: 70, slug: 'stale' })]);
    expect(width(withStale)).toBeCloseTo(width(alone), 1);
  });
});

describe('a training anchor cannot claim a tight band', () => {
  it('holds at least the +1 VDOT soft-lead quantum on each edge', () => {
    const e = resolve([runC({ vdot: 45, age: 5 })]);
    expect(e.vdotLo - e.vdot).toBeGreaterThanOrEqual(1.0);
    expect(e.vdot - e.vdotHi).toBeGreaterThanOrEqual(1.0);
  });

  it('reads wider than a race anchor of the same VDOT, age and distance', () => {
    const race = resolve([raceC({ vdot: 45, age: 5, distanceMi: 6.0 })]);
    const run = resolve([runC({ vdot: 45, age: 5, distanceMi: 6.0 })]);
    expect(width(run)).toBeGreaterThan(width(race));
  });
});

// ---------------------------------------------------------------------------
// 3 · CONFIDENCE TIERS AT THEIR BOUNDARIES
// ---------------------------------------------------------------------------

describe('confidence tiers fire at the right boundaries', () => {
  const corroborator = raceC({ vdot: 47.6, age: 20, slug: 'corrob' });

  it('fresh race + corroborating evidence that agrees = high', () => {
    const e = resolve([raceC({ vdot: 48, age: 5 }), corroborator]);
    expect(e.confidence).toBe('high');
  });

  it('high survives exactly at the fresh-window boundary, and drops the day after', () => {
    const at = resolve([raceC({ vdot: 48, age: FRESH_RACE_PRECEDENCE_DAYS }), corroborator]);
    const past = resolve([raceC({ vdot: 48, age: FRESH_RACE_PRECEDENCE_DAYS + 1 }), corroborator]);
    expect(at.confidence).toBe('high');
    expect(past.confidence).toBe('medium');
  });

  it('a fresh race with nothing to cross-check it is medium, not high', () => {
    expect(resolve([raceC({ vdot: 48, age: 5 })]).confidence).toBe('medium');
  });

  it('a single stale training estimate = low', () => {
    expect(resolve([runC({ vdot: 45, age: 70 })]).confidence).toBe('low');
  });

  it('an uncorroborated training estimate is low even when fresh', () => {
    expect(resolve([runC({ vdot: 45, age: 2 })]).confidence).toBe('low');
  });

  it('a corroborated training estimate lifts to medium', () => {
    const e = resolve([runC({ vdot: 45, age: 5 }), raceC({ vdot: 44.8, age: 20, slug: 'c' })]);
    expect(e.confidence).toBe('medium');
  });

  it('the stale boundary is the full-value window, to the day', () => {
    const at = resolve([raceC({ vdot: 48, age: VDOT_FULL_VALUE_DAYS }), corroborator]);
    const past = resolve([raceC({ vdot: 48, age: VDOT_FULL_VALUE_DAYS + 1 }), corroborator]);
    expect(at.confidence).toBe('medium');
    expect(past.confidence).toBe('low');
  });

  it('big disagreement drops a fresh race to low however fresh it is', () => {
    const e = resolve([raceC({ vdot: 48, age: 1 }), raceC({ vdot: 37, age: 10, slug: 'bad' })]);
    expect(e.confidence).toBe('low');
  });
});

// ---------------------------------------------------------------------------
// 4 · NO FAKE PRECISION
// ---------------------------------------------------------------------------

describe('no output contains fake precision', () => {
  const GRAIN: Record<string, number> = { '5k': 10, '10k': 10, hm: 30, m: 30 };
  const SAMPLES: VdotCandidate[][] = [
    [raceC({ vdot: 48, age: 5 })],
    [raceC({ vdot: 48, age: 70 })],
    [runC({ vdot: 45, age: 10 })],
    [raceC({ vdot: 62.4, age: 3, distanceMi: 6.21371 })],
    [raceC({ vdot: 33.7, age: 30, distanceMi: 26.2188 })],
    [raceC({ vdot: 48, age: 5 }), raceC({ vdot: 40, age: 15, slug: 'd' })],
  ];

  it('every race-equivalent bound lands on its rounding grain', () => {
    for (const sample of SAMPLES) {
      const e = resolve(sample);
      for (const [key, grain] of Object.entries(GRAIN)) {
        const r = e.races[key as keyof typeof e.races];
        expect(r.loSec % grain, `${key} loSec ${r.loSec}`).toBe(0);
        expect(r.hiSec % grain, `${key} hiSec ${r.hiSec}`).toBe(0);
      }
    }
  });

  it('never emits a bound at second-level resolution', () => {
    // The doctrine's actual complaint: `1:38:17`. Nothing may end in a digit
    // that implies we know the finish to the second.
    for (const sample of SAMPLES) {
      const e = resolve(sample);
      for (const r of Object.values(e.races)) {
        expect(r.loSec % 10).toBe(0);
        expect(r.hiSec % 10).toBe(0);
      }
    }
  });

  it('ranges are ordered and non-inverted', () => {
    for (const sample of SAMPLES) {
      const e = resolve(sample);
      for (const r of Object.values(e.races)) {
        expect(r.hiSec).toBeGreaterThanOrEqual(r.loSec);
      }
      expect(e.races['10k'].loSec).toBeGreaterThan(e.races['5k'].loSec);
      expect(e.races.hm.loSec).toBeGreaterThan(e.races['10k'].loSec);
      expect(e.races.m.loSec).toBeGreaterThan(e.races.hm.loSec);
    }
  });

  it('rounding widens the reported range, never narrows it', () => {
    // Outward rounding: the reported bound must sit at or beyond the computed
    // one. Checked against the raw predictions at the band edges.
    for (const sample of SAMPLES) {
      const e = resolve(sample);
      const fastHm = predictRaceTime(e.vdotLo, 13.1094)!;
      const slowHm = predictRaceTime(e.vdotHi, 13.1094)!;
      expect(e.races.hm.loSec).toBeLessThanOrEqual(fastHm);
      expect(e.races.hm.hiSec).toBeGreaterThanOrEqual(slowHm);
    }
  });

  it('a wide band is visibly wide at the marathon', () => {
    // Sanity that the range is not cosmetic: a low-confidence read must span
    // minutes at the marathon, not seconds.
    const e = resolve([raceC({ vdot: 48, age: 70 })]);
    expect(e.races.m.hiSec - e.races.m.loSec).toBeGreaterThan(300);
  });
});

// ---------------------------------------------------------------------------
// 5 · PROVENANCE AND BASIS
// ---------------------------------------------------------------------------

describe('provenance and basis', () => {
  it('reports every candidate with its source, age and weight', () => {
    const e = resolve([
      raceC({ vdot: 48, age: 5, slug: 'afc-half' }),
      runC({ vdot: 46, age: 12, id: 'run-7' }),
      raceC({ vdot: 44, age: 70, slug: 'old-half' }),
    ]);
    expect(e.considered).toHaveLength(3);
    expect(e.considered[0].source).toBe('race:afc-half');
    expect(e.considered[1].source).toBe('run:run-7');
    expect(e.considered[2].source).toBe('race:old-half');
    expect(e.considered.map((c) => c.ageDays)).toEqual([5, 12, 70]);
    // A fresh race outweighs a fresh run, which outweighs a stale race.
    expect(e.considered[0].weight).toBeGreaterThan(e.considered[1].weight);
    expect(e.considered[1].weight).toBeGreaterThan(e.considered[2].weight);
  });

  it('weights never contradict the selector · floor-only ranks below in-window', () => {
    // vdot.ts demotes a past-full-value candidate below EVERY in-window one,
    // however strong. The weight column has to agree, or the app shows a
    // provenance ordering that argues with its own anchor. Heaviest floor-only
    // candidate is a race at 57-84 days; lightest in-window is a run at 29-56.
    const e = resolve([
      raceC({ vdot: 48, age: 5, slug: 'fresh-race' }),
      runC({ vdot: 46, age: 40, id: 'in-window-run' }),
      raceC({ vdot: 47, age: 70, slug: 'floor-only-race' }),
      raceC({ vdot: 47, age: 200, slug: 'expired-race' }),
    ]);
    const [freshRace, inWindowRun, floorOnlyRace, expiredRace] = e.considered;
    expect(floorOnlyRace.weight).toBeLessThan(inWindowRun.weight);
    expect(expiredRace.weight).toBeLessThan(floorOnlyRace.weight);
    expect(freshRace.weight).toBeGreaterThan(inWindowRun.weight);
  });

  it('names the anchor and gives one verifiable reason', () => {
    const e = resolve([raceC({ vdot: 48, age: 5, name: 'AFC Half' })]);
    expect(e.basis).toContain('AFC Half');
    expect(e.basis).toContain('5 days ago');
  });

  it('says the range is wider when disagreement is what widened it', () => {
    const e = resolve([raceC({ vdot: 48, age: 5 }), raceC({ vdot: 39, age: 15, slug: 'd' })]);
    expect(e.basis).toMatch(/disagree/i);
  });

  it('never rounds a disagreement down in the basis line', () => {
    // Caught on the first smoke run: an anchor and a cross-check disagreeing by
    // ~3.2% printed "agrees within 3 percent" while confidence came back
    // medium, because 3.2 rounded to nearest. The stated agreement must never
    // be tighter than the AGREEMENT_MAX_PCT bound the tier actually applied.
    const e = resolve([
      raceC({ vdot: 45.9, age: 23, distanceMi: 6.21371, slug: 'tune-up' }),
      raceC({ vdot: 44.2, age: 6, slug: 'afc' }),
    ]);
    const stated = Number(/within (\d+) percent/.exec(e.basis)?.[1] ?? NaN);
    expect(Number.isFinite(stated)).toBe(true);
    if (e.confidence !== 'high') {
      // Tier says the reads did NOT agree inside 3%, so the line must not claim
      // they did.
      expect(stated).toBeGreaterThan(3);
    }
  });

  it('keeps coach voice · no em dash, no exclamation, no emoji', () => {
    const samples = [
      resolve([raceC({ vdot: 48, age: 5 })]),
      resolve([raceC({ vdot: 48, age: 70 })]),
      resolve([raceC({ vdot: 48, age: 200 })]),
      resolve([runC({ vdot: 45, age: 5 })]),
      resolve([runC({ vdot: 45, age: 5 }), raceC({ vdot: 44.8, age: 20, slug: 'c' })]),
      resolve([raceC({ vdot: 48, age: 5 }), raceC({ vdot: 47.6, age: 20, slug: 'c' })]),
      resolve([raceC({ vdot: 48, age: 5 }), raceC({ vdot: 39, age: 15, slug: 'd' })]),
    ];
    for (const e of samples) {
      expect(e.basis).not.toMatch(/[—–!]/);
      expect(e.basis).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
      expect(e.basis.split('\n')).toHaveLength(1);
      expect(e.basis.length).toBeLessThan(200);
    }
  });

  it('uses singular day phrasing at one day', () => {
    expect(resolve([raceC({ vdot: 48, age: 1 })]).basis).toContain('1 day ago');
  });
});

// ---------------------------------------------------------------------------
// 6 · THE DOCTRINE'S OWN EXAMPLE
// ---------------------------------------------------------------------------

describe('the doctrine example shape', () => {
  it('produces an HM range in minutes with a confidence, not a to-the-second time', () => {
    // Design/adaptive-progression-engine.md §A:
    //   HM fitness estimate: 1:38-1:40 / confidence: high
    const e = resolve([
      raceC({ vdot: 48.5, age: 6, name: 'AFC Half' }),
      raceC({ vdot: 48.1, age: 25, slug: 'tune-up' }),
    ]);
    expect(e.confidence).toBe('high');
    const { loSec, hiSec } = e.races.hm;
    expect(hiSec).toBeGreaterThan(loSec);       // a real range
    expect(loSec % 30).toBe(0);                  // not 1:38:17
    expect(hiSec % 30).toBe(0);
    expect(hiSec - loSec).toBeGreaterThan(60);   // wide enough to mean something
  });
});
