/**
 * The fitness row under "Where you are".
 *
 * Four rules govern this row and each has tests here:
 *
 *   ONE   · a modelled number must never look measured. Every value ships
 *           `modelled: true`, and every value is a RANGE.
 *   THREE · low confidence is a REFUSAL — a stated reason and no value —
 *           not an empty row and not the fault-red outage dash.
 *   FOUR  · coach voice. No interpuncts, two sentences at most, second
 *           person, no em dashes, no exclamation marks.
 *
 * Rule two is not this row's to break: it makes no recommendation. The test
 * at the bottom pins that, so a future edit cannot quietly turn a report into
 * an instruction.
 */
import { describe, expect, it } from 'vitest';
import { buildFitnessRow } from './fitness-read';
import type { FitnessEstimate } from '@/lib/fitness/fitness-model';

const HM_MI = 13.1094;

/** A stand-in estimate. Defaults are David's live shape on 2026-08-24: a
 *  chip-timed A half eight days back, no other race in the window. */
const est = (o: Partial<FitnessEstimate> = {}): FitnessEstimate => ({
  vdot: 44.1,
  vdotLo: 45.4,
  vdotHi: 42.9,
  confidence: 'medium',
  anchorDistanceMi: HM_MI,
  basis: 'Anchored on Americas Finest City, 8 days ago. No other race in the window to check it against, and training runs cannot confirm a race.',
  considered: [
    { vdot: 44.1, source: 'race:americas-finest-city', ageDays: 8, weight: 1 },
    { vdot: 39.9, source: 'run:-55341764239083', ageDays: 1, weight: 0.5 },
  ],
  races: {
    '5k': { loSec: 1290, hiSec: 1370 },
    '10k': { loSec: 2690, hiSec: 2830 },
    hm: { loSec: 5940, hiSec: 6270 },
    m: { loSec: 12390, hiSec: 13020 },
  },
  ...o,
});

const WITH_TRAINING = { hasAnyTraining: true };

describe('rule one · a modelled number must never look measured', () => {
  it('marks the value modelled, always', () => {
    const row = buildFitnessRow(est(), WITH_TRAINING)!;
    expect(row.value?.modelled).toBe(true);
  });

  it('is modelled on a high-confidence read too · certainty is not measurement', () => {
    // The tier says how well the model knows its own output. It never
    // promotes a projection into a reading.
    const row = buildFitnessRow(est({ confidence: 'high' }), WITH_TRAINING)!;
    expect(row.value?.modelled).toBe(true);
  });

  it('is always a range, never a single time', () => {
    const row = buildFitnessRow(est(), WITH_TRAINING)!;
    expect(row.value?.text).toBe('1:39:00 – 1:44:30');
    // The doctrine's actual complaint: `1:38:17` must be unreachable.
    expect(row.value!.text!).toMatch(/^\d:\d\d:\d\d – \d:\d\d:\d\d$/);
  });

  it('the label says what the number is', () => {
    // Rule one after the tilde retired: provenance travels in the words.
    // "Half" would be a distance; "Half fitness" is a reading of a runner.
    expect(buildFitnessRow(est(), WITH_TRAINING)!.label).toBe('Half fitness');
  });

  it('names the distance the evidence actually covers', () => {
    const at = (mi: number) => buildFitnessRow(est({ anchorDistanceMi: mi }), WITH_TRAINING)!.label;
    expect(at(3.10686)).toBe('5K fitness');
    expect(at(6.21371)).toBe('10K fitness');
    expect(at(26.2188)).toBe('Marathon fitness');
  });

  it('reports the range at the anchor distance, not at some other one', () => {
    // A marathon range off a half anchor would carry a half-sized error bar
    // onto a distance whose own prediction error is larger.
    const row = buildFitnessRow(est({ anchorDistanceMi: 26.2188 }), WITH_TRAINING)!;
    expect(row.value?.text).toBe('3:26:30 – 3:37:00');
  });

  it('falls back to the half when the anchor distance is unknown', () => {
    const row = buildFitnessRow(est({ anchorDistanceMi: null }), WITH_TRAINING)!;
    expect(row.label).toBe('Half fitness');
  });
});

describe('rule three · a refusal is a correct answer', () => {
  it('low confidence carries no value at all', () => {
    const row = buildFitnessRow(est({ confidence: 'low' }), WITH_TRAINING)!;
    expect(row.value).toBeNull();
    expect(row.sub).toBeTruthy();
  });

  it('a refusal is not the outage treatment', () => {
    // `FaffValue.unreadable` is the fault-red dash and means something that
    // should have been readable was not. Nothing is broken when a runner has
    // simply not raced lately, so the value is absent, not unreadable.
    const row = buildFitnessRow(est({ confidence: 'low' }), WITH_TRAINING)!;
    expect(row.value).toBeNull();
    expect(row.sub).not.toMatch(/—/);
  });

  it('a refusal keeps its label · a bare row would read as a failure', () => {
    const row = buildFitnessRow(est({ confidence: 'low' }), WITH_TRAINING)!;
    expect(row.label).toBe('Race fitness');
  });

  it('says WHICH thing is missing · stale race', () => {
    const row = buildFitnessRow(est({
      confidence: 'low',
      basis: 'Anchored on Disney Half, 70 days ago. Past eight weeks a result counts as a floor, not a current read.',
      considered: [{ vdot: 47.9, source: 'race:disney-half', ageDays: 70, weight: 0.3 }],
    }), WITH_TRAINING)!;
    expect(row.sub).toMatch(/ten weeks back/);
  });

  it('says WHICH thing is missing · training only', () => {
    const row = buildFitnessRow(est({
      confidence: 'low',
      basis: 'Anchored on a tempo run, 5 days ago. Training reads are an estimate until a race or time trial confirms them.',
      considered: [{ vdot: 45.1, source: 'run:-1', ageDays: 5, weight: 0.5 }],
    }), WITH_TRAINING)!;
    expect(row.sub).toMatch(/Only training to go on/);
  });

  it('says WHICH thing is missing · results disagree', () => {
    const row = buildFitnessRow(est({
      confidence: 'low',
      basis: 'Anchored on AFC Half, 8 days ago. Recent efforts disagree by about 9 percent, so the range is wider than the anchor alone would give.',
    }), WITH_TRAINING)!;
    expect(row.sub).toMatch(/disagree/);
  });

  it('no estimate at all still refuses in words, for a runner who trains', () => {
    const row = buildFitnessRow(null, WITH_TRAINING)!;
    expect(row).not.toBeNull();
    expect(row.value).toBeNull();
    expect(row.sub).toMatch(/Nothing recent enough/);
  });

  it('draws nothing at all for a runner with no training behind them', () => {
    // Not a refusal. Someone who has never logged a run does not need to be
    // told their race fitness is unknown.
    expect(buildFitnessRow(null, { hasAnyTraining: false })).toBeNull();
  });
});

describe('rule four · coach voice', () => {
  const SUBS = (): string[] => {
    const rows = [
      buildFitnessRow(est(), WITH_TRAINING),
      buildFitnessRow(est({ confidence: 'high' }), WITH_TRAINING),
      buildFitnessRow(est({ confidence: 'low' }), WITH_TRAINING),
      buildFitnessRow(est({
        confidence: 'low',
        basis: 'Anchored on a tempo run, 5 days ago. Training reads are an estimate until a race or time trial confirms them.',
        considered: [{ vdot: 45.1, source: 'run:-1', ageDays: 5, weight: 0.5 }],
      }), WITH_TRAINING),
      buildFitnessRow(est({
        basis: 'Anchored on a tempo run, 5 days ago. No race in the window, so the range holds the gap a training read can be out by.',
        considered: [{ vdot: 45.1, source: 'run:-1', ageDays: 5, weight: 0.5 }],
      }), WITH_TRAINING),
      buildFitnessRow(null, WITH_TRAINING),
    ];
    return rows.filter((r): r is NonNullable<typeof r> => r != null)
      .map((r) => r.sub!).filter(Boolean);
  };

  it('never uses an interpunct', () => {
    // why-voice rule 1. `·` is a field separator on a stats plate. Nobody
    // speaks it, and in prose it turns a sentence back into a record.
    for (const s of SUBS()) expect(s).not.toContain('·');
  });

  it('never uses an em dash, an exclamation mark or an emoji', () => {
    for (const s of SUBS()) expect(s).not.toMatch(/[—!\u{1F300}-\u{1FAFF}]/u);
  });

  it('says two sentences at most', () => {
    // why-voice rule 2. A text is short or it is an email.
    for (const s of SUBS()) {
      expect(s.split('.').filter((p) => p.trim().length > 0).length).toBeLessThanOrEqual(2);
    }
  });

  it('speaks to the runner', () => {
    // why-voice rule 3. Not every line can carry a "you" naturally, but the
    // ones about the runner's own evidence must.
    const row = buildFitnessRow(est(), WITH_TRAINING)!;
    expect(row.sub).toMatch(/\b(you|your)\b/i);
  });

  it('does not say the same thing twice', () => {
    // why-voice rule 5, and the defect that is live in renderShort() today:
    // "Stay on the planned progression. Training is landing about as
    // expected. Continuing on the planned progression."
    for (const s of SUBS()) {
      const clauses = s.toLowerCase().split(/[.,]/).map((c) => c.trim()).filter(Boolean);
      expect(new Set(clauses).size).toBe(clauses.length);
    }
  });

  it('names the anchor rather than a slug or an id', () => {
    const row = buildFitnessRow(est(), WITH_TRAINING)!;
    expect(row.sub).toContain('Americas Finest City');
    expect(row.sub).not.toMatch(/americas-finest-city|run:-?\d/);
  });

  it('spells a small span in words, the way a text would', () => {
    expect(buildFitnessRow(est(), WITH_TRAINING)!.sub).toContain('eight days ago');
  });

  it('does not print a race name the model only used as prose', () => {
    // buildBasis falls back to "a recent race" / "a training run" when the
    // record has no name. Those read mid-sentence; they are not a name.
    const row = buildFitnessRow(est({
      basis: 'Anchored on a recent race, 8 days ago. Nothing else recent to cross-check it against.',
    }), WITH_TRAINING)!;
    expect(row.sub).not.toContain('a recent race');
    expect(row.sub).toMatch(/your last race/);
  });

  it('a high-confidence read does not announce its own certainty', () => {
    // Hedging a certainty is how a coach stops sounding like one. Name what
    // agrees; do not say "high confidence".
    const row = buildFitnessRow(est({ confidence: 'high' }), WITH_TRAINING)!;
    expect(row.sub).not.toMatch(/confiden/i);
    expect(row.sub).toMatch(/agree/);
  });
});

describe('rule two is not this row\'s to break', () => {
  it('reports, and never instructs', () => {
    // A recommendation must name three converging domains. This row names
    // one measurement, so it must not read as a recommendation at all. The
    // refusals may say what WOULD produce a read; none of them tells the
    // runner to change a session.
    const rows = [
      buildFitnessRow(est(), WITH_TRAINING),
      buildFitnessRow(est({ confidence: 'high' }), WITH_TRAINING),
      buildFitnessRow(est({ confidence: 'low' }), WITH_TRAINING),
    ].filter((r): r is NonNullable<typeof r> => r != null);
    for (const r of rows) {
      expect(r.sub).not.toMatch(/\b(back off|ease|hold|skip|add|push|take the step)\b/i);
      // And it is never tappable — no action, so no screen behind it that
      // could grow one.
      expect(r.action).toBeNull();
    }
  });
});
