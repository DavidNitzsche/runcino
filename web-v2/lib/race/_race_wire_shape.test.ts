/**
 * _race_wire_shape.test.ts · RP-2/RP-3/RP-4 · THE WIRE, GATED.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *
 * `conditionalUpside` and `blockSeam` were resolved by `race-outlook.ts` from
 * the day EXECTARGET-1 landed and serialised by nothing, so Q7's fourth layer
 * existed only in server memory. Nothing could tell: the resolver's own tests
 * asserted the values, the route's tests asserted the route answered 200, and
 * the field simply was not in between. That is Rule 20 exactly — a product
 * rule with no gate is a hypothesis.
 *
 * So the SEAM between resolver and client is gated here, in both directions:
 * the payload must carry the quantity, and the route must send the block.
 *
 * ── WHAT THIS GATE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
 *
 *   · A client that stops READING a field it is sent. Swift is not visible
 *     from here; `V5WireCorpusTests` owns that half.
 *   · Whether the values are correct. It asserts presence and shape.
 *   · A route other than `v5/race/[slug]`. Named files only, and the liveness
 *     assertion below fails loudly rather than reporting clean if one moves.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { raceOutlookPayload } from './race-outlook-payload';
import type { RaceOutlook } from './race-outlook';

const ROUTE = path.join(process.cwd(), 'app/api/v5/race/[slug]/route.ts');
const PAYLOAD = path.join(process.cwd(), 'lib/race/race-outlook-payload.ts');

function outlookWithUpsideAndSeam(): RaceOutlook {
  return {
    modelVersion: 'v3', resolvedAt: '2026-09-02T00:00:00Z', todayISO: '2026-09-02',
    race: { distanceMi: 26.22, priority: 'A' },
    statedGoal: { sec: 10800, paceSecPerMi: 412 },
    capacity: { thresholdSecPerMi: 430, thresholdVdot: 47.8, sourceMode: 'direct', confidence: 0.83, newestEvidenceISO: '2026-09-01', durabilityExponent: 1.08, durabilityRaces: 5 },
    currentProjection: { expectedSec: 12230, likelyRangeSec: [11863, 12597], confidence: 0.51, basis: 'durability_blend', primaryLimiter: 'endurance' },
    trainingPrescription: { kind: 'marathon_specific', paceSecPerMi: 472, rangeSecPerMi: [460, 488], evidence: 'exponent', demonstratedPaceSecPerMi: null, restsOnOneLongRace: false, source: 'canonical_anchors', enduranceExponent: 1.08, personallyEvidenced: true, thresholdSecPerMi: 430, whyThisPace: 'x' },
    expectedImprovement: { gainVdot: 2.56, gainRangeVdot: [1.9, 2.64], buildWeeks: 10.6, executionQuality: 0.97, basis: 'plan_stimulus_and_execution', confidence: 0.585 },
    expectedRaceDay: { expectedSec: 11982, likelyRangeSec: [11608, 12411], confidence: 0.3, projectedVdot: 50.4, basis: 'trajectory', reasons: [] },
    execution: { targetSec: 12230, paceSecPerMi: 466, paceBandSecPerMi: [461, 471], source: 'current_evidence', effortCharacter: 'race', strategyLabel: 's', reasonVsExpected: 'r', hr: null },
    conditionalUpside: { targetSec: 11610, paceSecPerMi: 443, criteria: ['a', 'b', 'c', 'd', 'e'], confidence: 0.3 },
    blockSeam: { lastRehearsalSecPerMi: null, executionSecPerMi: 466, gapSecPerMi: null, credible: false, reason: 'The block authored no marathon-effort session, so nothing rehearses race day.' },
    goalFeasibility: { status: 'unlikely_currently', gapSec: 1182, gapToRangeEdgeSec: 808, reasons: [] },
    staleness: { newestEvidenceISO: '2026-09-01', evidenceAgeDays: 1, stale: false },
    bridge: [], changeTriggers: [], flags: [],
  } as unknown as RaceOutlook;
}

describe('the outlook payload carries every quantity the resolver produced', () => {
  const p = raceOutlookPayload(outlookWithUpsideAndSeam())!;

  it('LIVENESS · the payload was actually produced', () => {
    expect(p, 'raceOutlookPayload returned null on a populated outlook').not.toBeNull();
    expect(Object.keys(p).length).toBeGreaterThan(10);
  });

  it('RP-2 · Q7’s FOURTH LAYER reaches the wire, with its criteria', () => {
    expect(p.conditional_upside, 'the conditional upside was resolved and dropped on the way out').not.toBeNull();
    expect(p.conditional_upside!.display).toBe('3:13:30');
    expect(p.conditional_upside!.pace).toBe('7:23');
    expect(p.conditional_upside!.criteria.length).toBeGreaterThanOrEqual(4);
  });

  it('RP-3 · the block seam reaches the wire, and says WHICH kind of not-credible', () => {
    expect(p.block_seam).not.toBeNull();
    expect(p.block_seam!.credible).toBe(false);
    // Rule 11 · "the block rehearses nothing" is a different fact from "the
    // gap is too wide", and a null gap beside a reason is how they are told
    // apart downstream.
    expect(p.block_seam!.gap_s_per_mi).toBeNull();
    expect(p.block_seam!.reason.length).toBeGreaterThan(0);
  });

  it('a resolver that produced neither sends null, not an empty object', () => {
    const bare = raceOutlookPayload({ ...outlookWithUpsideAndSeam(), conditionalUpside: null, blockSeam: null } as RaceOutlook)!;
    expect(bare.conditional_upside).toBeNull();
    expect(bare.block_seam).toBeNull();
  });

  it('FALSIFICATION · the serialiser source still names both keys', () => {
    const src = fs.readFileSync(PAYLOAD, 'utf8');
    expect(src.length, 'the payload module is empty or has moved').toBeGreaterThan(500);
    expect(src, 'conditional_upside deleted from the wire').toContain('conditional_upside');
    expect(src, 'block_seam deleted from the wire').toContain('block_seam');
  });
});

describe('the v5 race route sends the presentation blocks', () => {
  const src = fs.readFileSync(ROUTE, 'utf8');

  it('LIVENESS · the route file was read and is the real one', () => {
    expect(src.length, 'app/api/v5/race/[slug]/route.ts is empty or has moved').toBeGreaterThan(2000);
    expect(src, 'this is not the v5 race detail route').toContain('resolveRaceOutlookBySlug');
  });

  it('RP-2/RP-3 · it sends the layer set, resolved by the one owner', () => {
    expect(src).toContain('raceLayers');
    expect(src).toContain('raceLayersPayload');
  });

  it('RP-4/RP-5 · it sends the course context', () => {
    expect(src).toContain('raceCourseContextPayload');
  });

  it('Q26 · it MEASURES the split plan against its target rather than trusting it', () => {
    expect(src, 'the pacing drift check was removed').toContain('pacingPlanDriftSec');
    expect(src, 'the drift is computed and never acted on').toContain('pacingDriftToleranceSec');
  });

  it('THE GOAL NEVER REACHES THE PACE PLAN · it is built from the target', () => {
    // The defect this replaced: `buildRacePacing({ goalSec })` handed the
    // runner a mile-by-mile plan for a 3:00:00 aspiration on a screen whose
    // own prose said 3:23. Measured 2026-09-02: 30 s/mi, 13 minutes.
    expect(src).toContain('outlook?.execution.targetSec');
    expect(src).toContain('goalSec: pacePlanTargetSec');
  });
});
