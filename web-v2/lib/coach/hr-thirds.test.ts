import { describe, it, expect } from 'vitest';
import {
  computeHrThirds,
  HEAT_SUPPRESSES_DRIFT_WARN_PCT,
  hrThirdsHeading,
  hrThirdsCaption,
  MIN_MEASURED_SPLITS,
  LATE_DRIFT_WARN_BPM,
  type HrThirdsSplit,
} from './hr-thirds';

/** Work split carrying HR. */
const w = (hr: number | null): HrThirdsSplit => ({ hr, phase: 'work' });

describe('computeHrThirds · measured path', () => {
  it('averages phase-tagged work splits by thirds', () => {
    // 9 work splits · thirds are [140,142,144] [150,152,154] [160,162,164]
    const splits = [140, 142, 144, 150, 152, 154, 160, 162, 164].map(w);
    const r = computeHrThirds(splits, { avgHr: 152, maxHr: 175 })!;

    expect(r.source).toBe('measured');
    expect(r.measuredSplits).toBe(9);
    expect(r.thirds.map((t) => t.bpm)).toEqual([142, 152, 162]);
    expect(r.driftBpm).toBe(20);
  });

  it('ignores warmup / recovery / cooldown splits', () => {
    const splits: HrThirdsSplit[] = [
      { hr: 110, phase: 'warmup' },
      { hr: 111, phase: 'warmup' },
      w(150), w(150), w(150),
      { hr: 105, phase: 'cooldown' },
      { hr: 130, phase: 'recovery' },
      { hr: 100, phase: null },
      { hr: 100, phase: 'unknown' },
    ];
    const r = computeHrThirds(splits, { avgHr: 140, maxHr: 170 })!;

    expect(r.source).toBe('measured');
    expect(r.measuredSplits).toBe(3);
    // Nothing but the three work splits reaches the numbers · a 110 bpm
    // warmup mile must not drag the EARLY card down.
    expect(r.thirds.map((t) => t.bpm)).toEqual([150, 150, 150]);
    expect(r.driftBpm).toBe(0);
  });

  it('drops work splits with no HR reading', () => {
    const splits = [w(null), w(150), w(null), w(152), w(154), w(null)];
    const r = computeHrThirds(splits, { avgHr: 152, maxHr: 160 })!;
    expect(r.source).toBe('measured');
    expect(r.measuredSplits).toBe(3);
    expect(r.thirds.map((t) => t.bpm)).toEqual([150, 152, 154]);
  });

  it('gives every third a sample at the 3-split floor', () => {
    const r = computeHrThirds([w(148), w(151), w(155)], { avgHr: 151 })!;
    expect(r.thirds.map((t) => t.bpm)).toEqual([148, 151, 155]);
  });

  it('warns on LATE only when the measured rise clears the threshold', () => {
    const flat = computeHrThirds([w(150), w(151), w(150)], { avgHr: 150 })!;
    expect(flat.driftBpm).toBe(0);
    expect(flat.thirds[2].warn).toBe(false);

    const drifted = computeHrThirds(
      [w(148), w(150), w(148 + LATE_DRIFT_WARN_BPM + 1)],
      { avgHr: 150 },
    )!;
    expect(drifted.driftBpm).toBe(LATE_DRIFT_WARN_BPM + 1);
    expect(drifted.thirds[2].warn).toBe(true);

    // At the threshold exactly · not over it, no amber.
    const atLine = computeHrThirds(
      [w(148), w(150), w(148 + LATE_DRIFT_WARN_BPM)],
      { avgHr: 150 },
    )!;
    expect(atLine.thirds[2].warn).toBe(false);
  });

  it('THE BUG · a lone sensor spike no longer paints the LATE card', () => {
    // The run held ~150 bpm the whole way. One mile records a 200 bpm
    // artefact (strap slip / cadence lock), so the phase summary reports
    // max_hr 200 against avg_hr 150.
    //
    // Old behaviour: climb = 50 → late = avg + 25 = 175, early = avg − 12
    // = 138, spread 37 bpm → amber LATE warning on a run that never
    // drifted. The spike is in mile 2 and the arithmetic could not know
    // that, because position never entered it.
    const splits = [w(150), w(200), w(149), w(150), w(151), w(150)];
    const r = computeHrThirds(splits, { avgHr: 150, maxHr: 200 })!;

    expect(r.source).toBe('measured');
    // EARLY carries the spike (it happened early); LATE reads the truth.
    expect(r.thirds[2].bpm).toBe(151);
    expect(r.thirds[2].warn).toBe(false);
    expect(r.driftBpm).toBeLessThan(0);
  });

  it('measured framing is what the heading claims', () => {
    expect(hrThirdsHeading('measured')).toBe('HR ACROSS THE BLOCK');
    expect(hrThirdsCaption('measured')).toBeNull();
  });
});

describe('computeHrThirds · fallback path', () => {
  it('falls back below the measured-split floor', () => {
    const splits = [w(150), w(152)]; // 2 · one short
    expect(splits.length).toBeLessThan(MIN_MEASURED_SPLITS);
    const r = computeHrThirds(splits, { avgHr: 152, maxHr: 168 })!;
    expect(r.source).toBe('estimated');
    expect(r.measuredSplits).toBe(0);
  });

  it('falls back when the splits carry no HR at all', () => {
    const r = computeHrThirds([w(null), w(null), w(null), w(null)], {
      avgHr: 160,
      maxHr: 180,
    })!;
    expect(r.source).toBe('estimated');
  });

  it('falls back when nothing is phase-tagged as work', () => {
    const untagged: HrThirdsSplit[] = [
      { hr: 150, phase: null },
      { hr: 152, phase: null },
      { hr: 154, phase: null },
      { hr: 156, phase: null },
    ];
    const r = computeHrThirds(untagged, { avgHr: 153, maxHr: 165 })!;
    expect(r.source).toBe('estimated');
  });

  it('keeps the avg/peak shape it always had', () => {
    // avg 150, peak 170 → climb 20 → 145 / 150 / 160.
    const r = computeHrThirds([], { avgHr: 150, maxHr: 170 })!;
    expect(r.thirds.map((t) => t.bpm)).toEqual([145, 150, 160]);
  });

  it('THE FIX · the fallback drops the measured framing', () => {
    const r = computeHrThirds([], { avgHr: 150, maxHr: 170 })!;

    // 1. The heading stops claiming the numbers were measured across the
    //    block, and a caption says where they came from.
    expect(hrThirdsHeading(r.source)).toBe('HR SHAPE · ESTIMATED');
    expect(hrThirdsHeading(r.source)).not.toContain('ACROSS THE BLOCK');
    const caption = hrThirdsCaption(r.source);
    expect(caption).toBeTruthy();
    expect(caption).toMatch(/estimated/i);

    // 2. No card is allowed to raise an alarm from synthesized numbers.
    expect(r.thirds.every((t) => t.warn === false)).toBe(true);

    // 3. No drift figure, so no caller can derive one downstream. The
    //    numbers have no time axis; their difference is not a drift.
    expect(r.driftBpm).toBeNull();
  });

  it('a big avg/peak spread cannot produce a warning on the fallback', () => {
    // The exact shape that used to fire amber: max − avg of 50 bpm.
    const r = computeHrThirds([], { avgHr: 150, maxHr: 200 })!;
    expect(r.source).toBe('estimated');
    expect(r.thirds[2].warn).toBe(false);
    expect(r.driftBpm).toBeNull();
  });

  it('shows the average flat when no peak is on record', () => {
    const r = computeHrThirds([], { avgHr: 148 })!;
    expect(r.thirds.map((t) => t.bpm)).toEqual([148, 148, 148]);
  });
});

describe('computeHrThirds · nothing to show', () => {
  it('returns null with no work splits and no summary average', () => {
    expect(computeHrThirds([], { avgHr: null, maxHr: 180 })).toBeNull();
    expect(computeHrThirds(null, {})).toBeNull();
    expect(computeHrThirds(undefined, { avgHr: 0 })).toBeNull();
  });
});

describe('heat withholds the warning, never the measurement', () => {
  // Research/03 §2: heat at 25°C+ moves HR by +5-20 bpm, against an 8 bpm
  // warn edge. On a hot run the amber card can be entirely weather — and
  // heatSlowdownPct was already in scope at the call site, unused.
  const drifting = [w(148), w(150), w(153), w(158), w(160), w(162)];

  it('warns on a drifting block in neutral conditions', () => {
    const r = computeHrThirds(drifting, { avgHr: 155, maxHr: 168 })!;
    expect(r.driftBpm).toBeGreaterThan(LATE_DRIFT_WARN_BPM);
    expect(r.thirds[2].warn).toBe(true);
    expect(r.heatSuppressedWarn).toBe(false);
  });

  it('withholds the same warning when the run was hot', () => {
    const r = computeHrThirds(drifting, { avgHr: 155, maxHr: 168 }, HEAT_SUPPRESSES_DRIFT_WARN_PCT)!;
    expect(r.thirds[2].warn).toBe(false);
    expect(r.heatSuppressedWarn).toBe(true);
  });

  it('still reports the three measured thirds on a hot run', () => {
    const neutral = computeHrThirds(drifting, { avgHr: 155, maxHr: 168 })!;
    const hot = computeHrThirds(drifting, { avgHr: 155, maxHr: 168 }, 12)!;
    expect(hot.thirds.map((t) => t.bpm)).toEqual(neutral.thirds.map((t) => t.bpm));
    expect(hot.driftBpm).toBe(neutral.driftBpm);
    expect(hot.source).toBe('measured');
  });

  it('a mildly warm run below the hot gate still warns', () => {
    const r = computeHrThirds(drifting, { avgHr: 155, maxHr: 168 }, HEAT_SUPPRESSES_DRIFT_WARN_PCT - 1)!;
    expect(r.thirds[2].warn).toBe(true);
  });

  it('omitting the heat argument behaves exactly as before', () => {
    const a = computeHrThirds(drifting, { avgHr: 155, maxHr: 168 })!;
    const b = computeHrThirds(drifting, { avgHr: 155, maxHr: 168 }, null)!;
    expect(a.thirds[2].warn).toBe(b.thirds[2].warn);
  });
});
