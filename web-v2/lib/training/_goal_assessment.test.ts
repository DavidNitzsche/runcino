/**
 * GOAL ASSESSMENT INVARIANTS (2026-08-18 · gain-rate reconciliation).
 *
 * Locks four things the surface cannot be allowed to lose:
 *
 *   1. THE GAIN RATE IS THE DOCTRINE BAND, ONCE. Three modules used to hold
 *      three different answers and the most permissive was fabricated.
 *   2. THE ASSESSMENT IS HONEST IN BOTH DIRECTIONS. It will call a goal
 *      aggressive, name what the build is worth, and it will also say a goal
 *      is comfortable rather than manufacturing a gap.
 *   3. NOTHING MODELLED READS AS MEASURED, and nothing here writes a pace.
 *   4. EACH CAUTION APPLIES ITS OWN CONTEXT FILTER (CLAUDE.md §"Per-finding
 *      context filters") — the taper guard suppresses the volume caution and
 *      leaves every other finding alone.
 *
 * Scenario coverage is the one the brief named: reachable · aggressive ·
 * out-of-reach · no-race distance goal · almost no history · date passed.
 */
import { describe, it, expect } from 'vitest';
import {
  assessGoal,
  composeCautions,
  MIN_WEEKLY_MI_FOR_DISTANCE,
  type GoalAssessment,
} from './goal-assessment';
import {
  VDOT_GAIN_PER_WEEK_MAX,
  VDOT_GAIN_PER_WEEK_CONSERVATIVE,
  LATENT_VDOT_UPGRADE_MAX,
  MAX_BLOCK_GAIN_VDOT,
  closableSecPerWeek,
  noiseGraceSec,
} from './vdot-gain-rate';
import { BASE_BUILD_RATE, taperWeeksForDistance, TAPER_WEEKS_BY_DISTANCE } from './fitness-trajectory';
import { BUILD_RATE_VDOT_PER_WEEK } from './goal-projection';
import { predictRaceTime, formatRaceTime } from './vdot';

const MI_5K = 3.10686;
const MI_M = 26.2188;
const TODAY = '2026-08-18';

/** goalSec that maps to a target VDOT, so each scenario's gap is controlled. */
function secFor(vdot: number, distanceMi: number): number {
  const s = predictRaceTime(vdot, distanceMi);
  if (s == null) throw new Error(`predictRaceTime(${vdot}, ${distanceMi}) returned null`);
  return Math.round(s);
}

function isoIn(weeks: number, fromISO = TODAY): string {
  return new Date(Date.parse(fromISO + 'T12:00:00Z') + weeks * 7 * 86400000)
    .toISOString()
    .slice(0, 10);
}

// ── 1 · ONE gain rate, and it is the doctrine band ───────────────────────────
describe('the VDOT gain rate is reconciled to one doctrine-read model', () => {
  it('the band is 1 point per 4-6 weeks, both edges', () => {
    expect(VDOT_GAIN_PER_WEEK_MAX).toBeCloseTo(1 / 4, 10);
    expect(VDOT_GAIN_PER_WEEK_CONSERVATIVE).toBeCloseTo(1 / 6, 10);
  });

  it('both build-rate constants ARE the fast edge · not a second opinion', () => {
    expect(BASE_BUILD_RATE).toBe(VDOT_GAIN_PER_WEEK_MAX);
    expect(BUILD_RATE_VDOT_PER_WEEK).toBe(VDOT_GAIN_PER_WEEK_MAX);
  });

  it('the fabricated 0.5/week rate is gone · a marathon week closes far less', () => {
    // The old hardcoded ladder promised 90 sec/week at the marathon for every
    // runner. The honest read at a mid-pack VDOT is a little over half that,
    // which is the whole reason the engine kept saying "still closable".
    const perWeek = closableSecPerWeek(47.9, MI_M);
    expect(perWeek).not.toBeNull();
    expect(perWeek!).toBeLessThan(90);
    expect(perWeek!).toBeGreaterThan(20);
  });

  it('the closable rate scales with BOTH distance and the runner\'s own fitness', () => {
    const slow5k = closableSecPerWeek(40, MI_5K)!;
    const fast5k = closableSecPerWeek(60, MI_5K)!;
    const slowM = closableSecPerWeek(40, MI_M)!;
    expect(slowM).toBeGreaterThan(slow5k);   // longer race, more seconds per point
    expect(slow5k).toBeGreaterThan(fast5k);  // slower runner, more seconds per point
  });

  it('the noise grace is distance-derived, not a flat 30 seconds', () => {
    const at5k = noiseGraceSec(47, MI_5K)!;
    const atM = noiseGraceSec(47, MI_M)!;
    expect(at5k).toBeLessThan(10);      // 30s over 5K was a rout, not noise
    expect(atM).toBeGreaterThan(at5k * 3);
  });
});

// ── 2 · the taper the projection excludes is per-distance ────────────────────
describe('buildWeeks uses this distance\'s taper, not a flat two weeks', () => {
  it('matches the generator\'s block shape at both ends', () => {
    expect(TAPER_WEEKS_BY_DISTANCE['5k']).toBe(1);
    expect(TAPER_WEEKS_BY_DISTANCE.m).toBe(3);
    expect(taperWeeksForDistance(MI_5K)).toBe(1);
    expect(taperWeeksForDistance(MI_M)).toBe(3);
  });

  it('an unknown distance falls back to the shortest taper · never inflates a gain', () => {
    expect(taperWeeksForDistance(null)).toBe(1);
    expect(taperWeeksForDistance(0)).toBe(1);
  });

  it('the assessment reads buildWeeks off it', () => {
    const a = assessGoal({
      distanceMi: MI_M, goalSec: secFor(48, MI_M), goalDateISO: isoIn(16),
      todayISO: TODAY, currentVdot: 46,
    });
    expect(a.weeksAvailable).toBeCloseTo(16, 1);
    expect(a.buildWeeks).toBeCloseTo(13, 1); // 16 − 3-week marathon taper
  });
});

// ── 3 · the six scenarios ────────────────────────────────────────────────────
describe('assessGoal · the verdicts', () => {
  it('REACHABLE · a goal inside the slow edge of the band reads realistic', () => {
    // VDOT 46 runner, 16 weeks out (13 build weeks). The slow edge buys
    // 13 × 0.167 = 2.17 points; the goal needs 1.5.
    const a = assessGoal({
      distanceMi: MI_M, goalSec: secFor(47.5, MI_M), goalDateISO: isoIn(16),
      todayISO: TODAY, currentVdot: 46,
    });
    expect(a.feasibility).toBe('realistic');
    expect(a.reportingAgainstSafeTarget).toBe(false);
    expect(a.reportAgainstSec).toBe(a.goalSec);
    expect(a.statement).toContain('realistic ask');
  });

  it('COMFORTABLE · a goal slower than today reads comfortable, no invented gap', () => {
    const a = assessGoal({
      distanceMi: MI_M, goalSec: secFor(43, MI_M), goalDateISO: isoIn(12),
      todayISO: TODAY, currentVdot: 46,
    });
    expect(a.feasibility).toBe('comfortable');
    expect(a.statement).toContain('inside what you can already run');
  });

  it('AMBITIOUS · a goal needing the fast edge is still on the table', () => {
    // 13 build weeks: slow edge 2.17, fast edge 3.25. A 3.0-point goal sits
    // between them.
    const a = assessGoal({
      distanceMi: MI_M, goalSec: secFor(49, MI_M), goalDateISO: isoIn(16),
      todayISO: TODAY, currentVdot: 46,
    });
    expect(a.feasibility).toBe('ambitious');
    expect(a.statement).toContain('ambitious and still on the table');
    // Ambitious still reports against the stated goal — the app only shows a
    // second number once the goal is past what the build delivers.
    expect(a.reportingAgainstSafeTarget).toBe(false);
  });

  it('AGGRESSIVE · beyond the build but inside the latent headroom', () => {
    // 13 build weeks → stretch 3.25. Goal needs 5.0, which is inside
    // stretch + LATENT_VDOT_UPGRADE_MAX (6.25).
    const a = assessGoal({
      distanceMi: MI_M, goalSec: secFor(51, MI_M), goalDateISO: isoIn(16),
      todayISO: TODAY, currentVdot: 46,
    });
    expect(a.feasibility).toBe('aggressive');
    expect(a.statement).toContain('is aggressive');
    expect(a.statement).toContain('The goal stays on the board');
    // The honest second number appears, and progress is reported against it.
    expect(a.safeTargetSec).not.toBeNull();
    expect(a.reportingAgainstSafeTarget).toBe(true);
    expect(a.reportAgainstSec).toBe(a.safeTargetSec);
    expect(a.cautions.join(' ')).toContain('reported against the safe target');
  });

  it('OUT OF REACH · a big jump on a short runway, with what the build IS worth', () => {
    // The brief's own example shape: a large gap, five weeks out.
    const a = assessGoal({
      distanceMi: MI_M, goalSec: secFor(50, MI_M), goalDateISO: isoIn(5),
      todayISO: TODAY, currentVdot: 38,
    });
    expect(a.feasibility).toBe('out-of-reach');
    expect(a.statement).toContain('is out of reach from');
    expect(a.statement).toContain('what this build is genuinely worth');
    expect(a.statement).toContain('train for what is achievable');
    // safe < stretch < today's equivalent, all real times.
    expect(a.safeTargetSec!).toBeLessThan(a.currentEquivalentSec!);
    expect(a.stretchTargetSec!).toBeLessThan(a.safeTargetSec!);
    // And the goal is still faster than either — that is why it is out of reach.
    expect(a.goalSec).toBeLessThan(a.stretchTargetSec!);
  });

  it('NO-RACE DISTANCE GOAL · no date is not a short runway and not an error', () => {
    const a = assessGoal({
      distanceMi: MI_5K, goalSec: secFor(50, MI_5K), goalDateISO: null,
      todayISO: TODAY, currentVdot: 46, recentWeeklyMi: 30,
    });
    expect(a.weeksAvailable).toBeNull();
    expect(a.buildWeeks).toBeNull();
    // A goal with no date cannot be OUT OF REACH of a deadline that does not
    // exist. The honest answer is how long, not whether — so the verdict is
    // open-ended and it carries a weeks-to-reach band off the doctrine rate.
    expect(a.feasibility).toBe('open-ended');
    expect(a.weeksToReach).not.toBeNull();
    expect(a.weeksToReach!.min).toBeLessThan(a.weeksToReach!.max);
    expect(a.statement).toContain('No date is set');
    expect(a.statement).toContain(`${a.weeksToReach!.min} to ${a.weeksToReach!.max} weeks`);
    // It must NOT claim a time verdict it has no basis for.
    expect(a.statement).not.toContain('out of reach');
    expect(a.statement).not.toContain('in the time');
    // No invented "in N weeks" runway phrasing, and no fake safe/stretch pair.
    expect(a.statement).not.toContain('in 0 weeks');
    expect(a.safeTargetSec).toBeNull();
    expect(a.stretchTargetSec).toBeNull();
    expect(a.reportAgainstSec).toBe(a.goalSec);
    // No runway caution, because there is no runway to be short.
    expect(a.cautions.join(' ')).not.toContain('is short for');
  });

  it('ALMOST NO HISTORY · says so instead of producing a number', () => {
    const a = assessGoal({
      distanceMi: MI_M, goalSec: secFor(50, MI_M), goalDateISO: isoIn(20),
      todayISO: TODAY, currentVdot: null,
    });
    expect(a.feasibility).toBe('unreadable');
    expect(a.safeTargetSec).toBeNull();
    expect(a.stretchTargetSec).toBeNull();
    expect(a.reportAgainstSec).toBeNull();
    expect(a.statement).toContain('Not enough logged running yet');
    expect(a.statement).toContain('time trial');
  });

  it('DATE PASSED · reads as expired, not as a gap against a dead date', () => {
    const a = assessGoal({
      distanceMi: MI_M, goalSec: secFor(50, MI_M), goalDateISO: isoIn(-3),
      todayISO: TODAY, currentVdot: 46,
    });
    expect(a.feasibility).toBe('date-passed');
    expect(a.weeksAvailable).toBe(0);
    expect(a.reportAgainstSec).toBeNull();
    expect(a.statement).toContain('target date has passed');
  });
});

// ── 4 · the safe/stretch model ───────────────────────────────────────────────
describe('safe and stretch are the two edges of the doctrine band', () => {
  it('safe is the slow edge, stretch is the fast edge, and safe is never faster', () => {
    const a = assessGoal({
      distanceMi: MI_M, goalSec: secFor(52, MI_M), goalDateISO: isoIn(16),
      todayISO: TODAY, currentVdot: 46,
    });
    const bw = a.buildWeeks!;
    const expectSafe = predictRaceTime(46 + VDOT_GAIN_PER_WEEK_CONSERVATIVE * bw, MI_M)!;
    const expectStretch = predictRaceTime(46 + VDOT_GAIN_PER_WEEK_MAX * bw, MI_M)!;
    expect(a.safeTargetSec!).toBeCloseTo(expectSafe, 0);
    expect(a.stretchTargetSec!).toBeCloseTo(expectStretch, 0);
    expect(a.safeTargetSec!).toBeGreaterThan(a.stretchTargetSec!);
  });

  it('measured execution discounts the SAFE edge · absence of a signal does not', () => {
    const base = {
      distanceMi: MI_M, goalSec: secFor(52, MI_M), goalDateISO: isoIn(16),
      todayISO: TODAY, currentVdot: 46,
    };
    const noSignal = assessGoal(base);
    const clean = assessGoal({ ...base, executionQuality: 1.0 });
    const broken = assessGoal({ ...base, executionQuality: 0.4 });
    // No signal must score exactly like clean execution · an absent pillar
    // does not score against the runner.
    expect(noSignal.safeTargetSec).toBe(clean.safeTargetSec);
    // A real signal moves it, and only in the honest direction.
    expect(broken.safeTargetSec!).toBeGreaterThan(clean.safeTargetSec!);
    // The stretch edge is what a CLEAN block delivers, so it does not move.
    expect(broken.stretchTargetSec).toBe(clean.stretchTargetSec);
  });

  it('neither target ever promises more than one block\'s ceiling', () => {
    const a = assessGoal({
      distanceMi: MI_M, goalSec: secFor(60, MI_M), goalDateISO: isoIn(52),
      todayISO: TODAY, currentVdot: 40,
    });
    const ceiling = predictRaceTime(40 + MAX_BLOCK_GAIN_VDOT, MI_M)!;
    expect(a.stretchTargetSec!).toBeGreaterThanOrEqual(Math.round(ceiling) - 1);
  });

  it('the latent headroom is a feasibility bound, never added to a target', () => {
    const a = assessGoal({
      distanceMi: MI_M, goalSec: secFor(51, MI_M), goalDateISO: isoIn(16),
      todayISO: TODAY, currentVdot: 46,
    });
    // aggressive means the goal sits inside stretch + headroom …
    expect(a.feasibility).toBe('aggressive');
    // … but the stretch TARGET is still only the build, with no headroom in it.
    const stretchOnly = predictRaceTime(46 + VDOT_GAIN_PER_WEEK_MAX * a.buildWeeks!, MI_M)!;
    expect(a.stretchTargetSec!).toBeCloseTo(stretchOnly, 0);
    expect(LATENT_VDOT_UPGRADE_MAX).toBe(3);
  });
});

// ── 5 · honesty posture ──────────────────────────────────────────────────────
describe('the assessment never presents a model as a measurement', () => {
  it('every assessment is stamped projected', () => {
    const cases: GoalAssessment[] = [
      assessGoal({ distanceMi: MI_M, goalSec: secFor(48, MI_M), goalDateISO: isoIn(16), todayISO: TODAY, currentVdot: 46 }),
      assessGoal({ distanceMi: MI_5K, goalSec: secFor(52, MI_5K), goalDateISO: null, todayISO: TODAY, currentVdot: 46 }),
      assessGoal({ distanceMi: MI_M, goalSec: secFor(48, MI_M), goalDateISO: isoIn(16), todayISO: TODAY, currentVdot: null }),
    ];
    for (const c of cases) expect(c.basis).toBe('projected');
  });

  it('the goal never becomes the fitness read · currentEquivalentSec tracks VDOT only', () => {
    const slowGoal = assessGoal({
      distanceMi: MI_M, goalSec: secFor(40, MI_M), goalDateISO: isoIn(16), todayISO: TODAY, currentVdot: 46,
    });
    const fastGoal = assessGoal({
      distanceMi: MI_M, goalSec: secFor(52, MI_M), goalDateISO: isoIn(16), todayISO: TODAY, currentVdot: 46,
    });
    expect(slowGoal.currentEquivalentSec).toBe(fastGoal.currentEquivalentSec);
    expect(slowGoal.currentVdot).toBe(46);
    // And the safe/stretch targets are the same too — they are built off
    // measured fitness and the doctrine rate, never off the ambition.
    expect(slowGoal.stretchTargetSec).toBe(fastGoal.stretchTargetSec);
  });
});

// ── 6 · house voice ──────────────────────────────────────────────────────────
describe('coach voice · Design/running-app-design-brief-v2.md', () => {
  const every = [
    assessGoal({ distanceMi: MI_M, goalSec: secFor(43, MI_M), goalDateISO: isoIn(12), todayISO: TODAY, currentVdot: 46 }),
    assessGoal({ distanceMi: MI_M, goalSec: secFor(47.5, MI_M), goalDateISO: isoIn(16), todayISO: TODAY, currentVdot: 46 }),
    assessGoal({ distanceMi: MI_M, goalSec: secFor(49, MI_M), goalDateISO: isoIn(16), todayISO: TODAY, currentVdot: 46 }),
    assessGoal({ distanceMi: MI_M, goalSec: secFor(51, MI_M), goalDateISO: isoIn(16), todayISO: TODAY, currentVdot: 46 }),
    assessGoal({ distanceMi: MI_M, goalSec: secFor(50, MI_M), goalDateISO: isoIn(5), todayISO: TODAY, currentVdot: 38, recentWeeklyMi: 12 }),
    assessGoal({ distanceMi: MI_M, goalSec: secFor(50, MI_M), goalDateISO: isoIn(-3), todayISO: TODAY, currentVdot: 46 }),
    assessGoal({ distanceMi: MI_M, goalSec: secFor(50, MI_M), goalDateISO: isoIn(20), todayISO: TODAY, currentVdot: null }),
  ];

  it('no exclamation marks, no emoji, no em dashes', () => {
    for (const a of every) {
      const text = [a.statement, ...a.cautions].join(' ');
      expect(text, a.statement).not.toMatch(/!/);
      expect(text, a.statement).not.toMatch(/—/);
      expect(text, a.statement).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    }
  });

  it('never scolds the runner for an ambitious goal', () => {
    const scolds = /should not|shouldn't have|unrealistic of you|too greedy|be realistic|lower your/i;
    for (const a of every) {
      expect([a.statement, ...a.cautions].join(' '), a.statement).not.toMatch(scolds);
    }
  });

  it('never renders a placeholder dash where a time belongs', () => {
    for (const a of every) {
      if (a.feasibility === 'unreadable') continue; // says so in words instead
      expect(a.statement, a.feasibility).not.toContain('—');
    }
  });

  it('a real out-of-reach statement reads the way the brief asks', () => {
    const a = assessGoal({
      distanceMi: MI_M, goalSec: 12000, goalDateISO: isoIn(5), todayISO: TODAY, currentVdot: 34,
    });
    expect(a.feasibility).toBe('out-of-reach');
    // Sample of the real output, pinned so a rewrite has to be deliberate.
    expect(a.statement).toBe(
      `${formatRaceTime(a.goalSec)} in 5 weeks is out of reach from ${formatRaceTime(a.currentEquivalentSec)}. ` +
        'That is a bigger jump than training delivers in the time. ' +
        `${formatRaceTime(a.safeTargetSec)} is what this build is genuinely worth. ` +
        'The goal stays on the board; the plan will train for what is achievable.',
    );
  });
});

// ── 7 · per-finding context filters ──────────────────────────────────────────
describe('each caution applies its OWN context filter, not the surface\'s', () => {
  const ctxBase = { feasibility: 'realistic' as const, distanceMi: MI_M, weeksAvailable: 16 };

  it('the volume caution fires under doctrine\'s beginner floor', () => {
    const out = composeCautions({
      ...ctxBase, recentWeeklyMi: MIN_WEEKLY_MI_FOR_DISTANCE.m - 5, ctx: {},
    });
    expect(out.join(' ')).toContain('That gap, not speed, is the limiter');
  });

  it('a TAPER week suppresses the volume caution and NOTHING else', () => {
    // This is the V5-Z2 defect shape: low volume inside a taper is the plan
    // working, not a limiter. The evidence caution must survive the same call.
    const inTaper = composeCautions({
      ...ctxBase,
      weeksAvailable: 2,
      recentWeeklyMi: 8,
      ctx: { inTaperOrRaceWeek: true, anchorAgeDays: 200 },
    });
    expect(inTaper.join(' ')).not.toContain('not speed, is the limiter');
    expect(inTaper.join(' ')).toContain('fitness anchor that is getting old');
  });

  it('post-race recovery suppresses the volume caution independently', () => {
    const out = composeCautions({
      ...ctxBase, recentWeeklyMi: 8, ctx: { inPostRaceRecovery: true },
    });
    expect(out.join(' ')).not.toContain('not speed, is the limiter');
  });

  it('a fresh anchor silences the evidence caution regardless of everything else', () => {
    const out = composeCautions({
      ...ctxBase, recentWeeklyMi: 8, ctx: { anchorAgeDays: 14 },
    });
    expect(out.join(' ')).not.toContain('fitness anchor');
    expect(out.join(' ')).toContain('not speed, is the limiter'); // its own filter said fire
  });

  it('the marathon-lag caution needs all three of its own conditions', () => {
    const fires = composeCautions({
      ...ctxBase,
      recentWeeklyMi: 60,
      ctx: { anchorDistanceMi: 3.1, marathonSpecificBlockDone: false },
    });
    expect(fires.join(' ')).toContain('Marathon fitness lags it');

    // Unknown block status suppresses rather than guessing.
    const unknown = composeCautions({
      ...ctxBase, recentWeeklyMi: 60, ctx: { anchorDistanceMi: 3.1, marathonSpecificBlockDone: null },
    });
    expect(unknown.join(' ')).not.toContain('Marathon fitness lags it');

    // A marathon-distance anchor is not a short race.
    const longAnchor = composeCautions({
      ...ctxBase, recentWeeklyMi: 60, ctx: { anchorDistanceMi: 26.2, marathonSpecificBlockDone: false },
    });
    expect(longAnchor.join(' ')).not.toContain('Marathon fitness lags it');

    // And it never fires for a 5K goal, whatever the anchor.
    const fiveK = composeCautions({
      ...ctxBase, distanceMi: MI_5K, recentWeeklyMi: 60,
      ctx: { anchorDistanceMi: 3.1, marathonSpecificBlockDone: false },
    });
    expect(fiveK.join(' ')).not.toContain('Marathon fitness lags it');
  });

  it('no date means no runway caution', () => {
    const out = composeCautions({ ...ctxBase, weeksAvailable: null, recentWeeklyMi: 60, ctx: {} });
    expect(out.join(' ')).not.toContain('is short for');
  });
});
