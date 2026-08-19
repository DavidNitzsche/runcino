/**
 * CI-CROSS-1 · `Research/02` §13.7's bands are keyed on the SPAN, not the
 * target.
 *
 * `vdotAnchorDistanceMi` was threaded into `computeConfidenceInterval` in
 * 2026-06, destructured, and never read — so a marathon-goal runner anchored on
 * a 5K PR got the same ±3% symmetric band as one anchored on a half.
 */
import { describe, it, expect } from 'vitest';
import { computeConfidenceInterval, CROSS_SPAN_CI_PCT } from './goal-projection';
import { vdotFromRace, predictRaceTime } from './vdot';

const MARATHON = 26.2188;
const HALF = 13.1;
const TEN_K = 6.21371;
const FIVE_K = 3.10686;

// A 3:20 marathon projection.
const PROJ = 12_000;

describe('CI-CROSS-1 · the anchor distance is the left-hand side of §13.7', () => {
  it('an unknown anchor changes nothing · not knowing the span is not evidence about it', () => {
    const before = computeConfidenceInterval({ centerSec: PROJ, raceDistanceMi: MARATHON, status: 'on-track' });
    const after = computeConfidenceInterval({
      centerSec: PROJ, raceDistanceMi: MARATHON, status: 'on-track', vdotAnchorDistanceMi: null,
    });
    expect(after).toEqual(before);
    expect(before!.pct).toBe(3.0);
    expect(before!.method).toBe('research-span');
  });

  it('marathon off a 5K anchor, no marathon block · ±10% ONE-SIDED', () => {
    const ci = computeConfidenceInterval({
      centerSec: PROJ,
      raceDistanceMi: MARATHON,
      status: 'on-track',
      vdotAnchorDistanceMi: FIVE_K,
      marathonSpecificTraining: false,
    })!;
    expect(ci.pct).toBe(CROSS_SPAN_CI_PCT.shortToMarathonNoBlock); // 10.0
    expect(ci.method).toBe('research-span-cross');
    expect(ci.oneSided).toBe(true);
    // The band opens toward SLOW only: doctrine states the error runs one way.
    expect(ci.lo).toBe(PROJ);
    expect(ci.hi).toBe(PROJ + 1200); // 3:20:00 → 3:40:00
  });

  it('an unknown block reads as no block · doctrine says which way to lean (§14.7)', () => {
    const unknown = computeConfidenceInterval({
      centerSec: PROJ, raceDistanceMi: MARATHON, status: 'on-track',
      vdotAnchorDistanceMi: FIVE_K, marathonSpecificTraining: null,
    })!;
    expect(unknown.pct).toBe(CROSS_SPAN_CI_PCT.shortToMarathonNoBlock);
    expect(unknown.oneSided).toBe(true);
  });

  it('marathon off a 5K anchor WITH a marathon block · ±5% symmetric', () => {
    const ci = computeConfidenceInterval({
      centerSec: PROJ, raceDistanceMi: MARATHON, status: 'on-track',
      vdotAnchorDistanceMi: FIVE_K, marathonSpecificTraining: true,
    })!;
    expect(ci.pct).toBe(CROSS_SPAN_CI_PCT.shortToMarathonTrained); // 5.0
    expect(ci.oneSided).toBeUndefined();
    expect(ci.lo).toBe(PROJ - 600);
    expect(ci.hi).toBe(PROJ + 600);
  });

  it('§13.1 reads a 10K anchor into the same row · "sub-half-marathon input"', () => {
    const ci = computeConfidenceInterval({
      centerSec: PROJ, raceDistanceMi: MARATHON, status: 'on-track',
      vdotAnchorDistanceMi: TEN_K, marathonSpecificTraining: false,
    })!;
    expect(ci.pct).toBe(CROSS_SPAN_CI_PCT.shortToMarathonNoBlock);
  });

  it('marathon off a HALF anchor stays at the ±3% same-distance band', () => {
    const ci = computeConfidenceInterval({
      centerSec: PROJ, raceDistanceMi: MARATHON, status: 'on-track', vdotAnchorDistanceMi: HALF,
    })!;
    expect(ci.pct).toBe(3.0);
  });

  it('a span whose doctrine row is TIGHTER than the target default never narrows the band', () => {
    // §13.7's "5K → 10K, recent input" is ±1.5%; the engine's same-distance
    // 10K default is ±2.0% (that row plus §11.1's input-noise margin). A
    // cross-distance prediction must not read tighter than a same-distance one.
    const ci = computeConfidenceInterval({
      centerSec: 2400, raceDistanceMi: TEN_K, status: 'on-track', vdotAnchorDistanceMi: FIVE_K,
    })!;
    expect(ci.pct).toBe(2.0);
    expect(ci.method).toBe('research-span');
  });

  it('the stale-input override still wins outright', () => {
    const ci = computeConfidenceInterval({
      centerSec: PROJ, raceDistanceMi: MARATHON, status: 'on-track',
      vdotAnchorDateISO: '2020-01-01', vdotAnchorDistanceMi: FIVE_K, marathonSpecificTraining: false,
    })!;
    expect(ci.method).toBe('research-span-stale');
    expect(ci.pct).toBe(CROSS_SPAN_CI_PCT.staleInput);
  });

  it('status scaling still applies on top of the cross-span row', () => {
    const ci = computeConfidenceInterval({
      centerSec: PROJ, raceDistanceMi: MARATHON, status: 'off-track',
      vdotAnchorDistanceMi: FIVE_K, marathonSpecificTraining: false,
    })!;
    expect(ci.pct).toBe(15.0); // 10.0 × 1.5
  });
});

/**
 * 2026-08-19 · `detectRecentRaceDrift` — the STRONG drift detector — admitted
 * only races within ±30% of the goal distance. On a 5K goal that window is
 * 2.17-4.04 miles, so a 10K raced three weeks ago, very often the runner's best
 * available evidence, never reached the detector and its silence read to the
 * runner as "on track".
 *
 * The band's stated reason (marathons must not count against half goals) was
 * already spent about twenty lines further down, where the detector
 * VDOT-normalises the race to the goal distance before comparing. What a
 * cross-distance anchor really carries is prediction error, and §13.7 publishes
 * that per span — so the span's CI became the margin on the trigger instead.
 *
 * These tests do the arithmetic the detector does, without its database, so the
 * numbers in the fix are checked rather than asserted. The SOURCE-level guards
 * (the ±30% window is gone, the triggers charge the margin, ranking is by VDOT)
 * live in `PREDICTION.drift-anchor-span-margin` in the doctrine registry.
 */
describe('DRIFT-ANCHOR · a cross-distance race is evidence that pays for its span', () => {
  /** What the detector computes: race → VDOT → equivalent time at the goal. */
  const slowdownPct = (raceSec: number, raceMi: number, goalSec: number, goalMi: number) => {
    const v = vdotFromRace(raceSec, raceMi)!;
    const equiv = predictRaceTime(v, goalMi)!;
    return ((equiv - goalSec) / goalSec) * 100;
  };
  const GOAL_5K = 1200; // 20:00

  it('the 10K a 5K runner actually ran is outside the old window entirely', () => {
    expect(TEN_K).toBeGreaterThan(FIVE_K * 1.3);
    expect(TEN_K).toBeGreaterThan(4.04);
  });

  it('a 46:00 10K against a 20:00 5K goal now speaks · it used to be discarded', () => {
    const pct = slowdownPct(2760, TEN_K, GOAL_5K, FIVE_K);
    const margin = CROSS_SPAN_CI_PCT.marathonToFiveK; // widest published shortening row
    expect(pct).toBeGreaterThan(5 + margin);   // clears the margined MEDIUM trigger
    expect(pct).toBeLessThan(10 + margin);     // and is honestly not yet STRONG
  });

  it('a 42:00 10K stays silent · the margin is not manufacturing a signal', () => {
    const pct = slowdownPct(2520, TEN_K, GOAL_5K, FIVE_K);
    expect(pct).toBeLessThan(5 + CROSS_SPAN_CI_PCT.marathonToFiveK);
  });

  it('a same-distance race is graded exactly as before · margin 0', () => {
    // 21:30 5K against a 20:00 5K goal · 7.5% slow, MEDIUM at the original 5/10.
    const pct = slowdownPct(1290, FIVE_K, GOAL_5K, FIVE_K);
    expect(pct).toBeGreaterThan(5);
    expect(pct).toBeLessThan(10);
  });

  it('the fallbacks really are the widest rows §13.7 publishes in each direction', () => {
    // Shortening: Marathon → 5K ±3% is the only shortening row, and every
    // unpublished shortening span (10K→5K, half→10K, marathon→half) is narrower.
    expect(CROSS_SPAN_CI_PCT.marathonToFiveK).toBeGreaterThanOrEqual(CROSS_SPAN_CI_PCT.tenKToHalf);
    expect(CROSS_SPAN_CI_PCT.marathonToFiveK).toBeGreaterThanOrEqual(CROSS_SPAN_CI_PCT.fiveKToTenK);
    // Lengthening: 5K → marathon (trained) ±5% brackets the one unpublished
    // lengthening span, 5K → half.
    expect(CROSS_SPAN_CI_PCT.shortToMarathonTrained).toBeGreaterThanOrEqual(CROSS_SPAN_CI_PCT.halfToMarathon);
    expect(CROSS_SPAN_CI_PCT.shortToMarathonTrained).toBeGreaterThanOrEqual(CROSS_SPAN_CI_PCT.tenKToHalf);
  });

  it('VDOT is the only ranking that compares across distances', () => {
    // Two races by one runner. The 5K is faster per mile by definition; the 10K
    // is the better performance. A raw-pace ranking picks the 5K every time.
    const fiveK = { sec: 1290, mi: FIVE_K };
    const tenK = { sec: 2580, mi: TEN_K };
    expect(fiveK.sec / fiveK.mi).toBeLessThan(tenK.sec / tenK.mi);           // pace says 5K
    expect(vdotFromRace(tenK.sec, tenK.mi)!).toBeGreaterThan(vdotFromRace(fiveK.sec, fiveK.mi)!); // fitness says 10K
  });
});
