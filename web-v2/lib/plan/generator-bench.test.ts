/**
 * lib/plan/generator-bench.test.ts · GENERATOR bench.
 *
 * Companion to plan-engine.test.ts (simulator bench). This file tests
 * what the existing bench misses · the REAL generator output against
 * each persona's expectedPlan doctrine targets.
 *
 * The architectural hole David flagged 2026-06-02: the prior plan-engine
 * sprint shipped a simulator test that constructs a hand-built ideal
 * trajectory and feeds it to simulate(). That validates the simulator,
 * not the generator. Real generator bugs (volume ramp broken by
 * easyMileFloor, longShare goal-blind, race-pace label hardcoded) slipped
 * through CI because composePlan() was never called.
 *
 * Phase 2 of the rebuild: this file calls composePlan() for each persona
 * with persona-derived ComposePlanInput, then asserts the resulting
 * weeks[] match the persona's expectedPlan targets.
 *
 * Today this file produces FAILING assertions for the personas where
 * the generator policy is broken. Phase 3 fixes the policy until all
 * pass · then no plan-engine PR can merge without satisfying these
 * assertions.
 *
 * Cite: docs/PLAN_ENGINE_ARCHITECTURE.md
 * Cite: Research/22-plan-templates.md
 */

import { describe, it, expect } from 'vitest';
import { distanceCategoryOrThrow } from '@/lib/race/distance-category';
import { PERSONAS, type SyntheticRunner } from './synthetic-runners';
import {
  composePlan,
  inlinePrescriptions,
  parseGoalSeconds,
  type ComposePlanInput,
  type DOW,
} from './generate';
import { fixtureTPaceFromGoalPace } from './_fixture-goal-tpace';
import { TIER_TARGETS, distanceCategoryOf, type GoalTier } from './goal-tiers';
// BOUNDARY-OWNER-1 · the app's one split of a day into easy and at-pace miles.
import { splitDay } from './intensity-distribution';

describe('parseGoalSeconds · accepts multiple goal-time formats', () => {
  it.each([
    ['1:30:00', 5400],
    ['1:30',    5400],   // H:MM · David's race meta format (sub-1:30 HM)
    ['3:00:00', 10800],
    ['3:00',    10800],
    ['1:35',    5700],
    ['25:00',   1500],   // MM:SS · 25-minute 5K finish time
    ['18:30',   1110],   // MM:SS · 18:30 5K time
  ])('parseGoalSeconds(%s) = %s', (input, expected) => {
    expect(parseGoalSeconds(input)).toBe(expected);
  });

  it('rejects null + non-time strings', () => {
    expect(parseGoalSeconds(null)).toBe(null);
    expect(parseGoalSeconds(undefined)).toBe(null);
    expect(parseGoalSeconds('')).toBe(null);
    expect(parseGoalSeconds('xyz')).toBe(null);
  });
});

/**
 * Build a ComposePlanInput from a persona · all DB-sourced facts
 * synthesized from the persona profile. Deterministic · uses a fixed
 * startMondayISO so plan layouts are reproducible across test runs.
 */
function personaToComposeInput(p: SyntheticRunner): ComposePlanInput {
  const cat = distanceCategoryOrThrow(p.race.distanceMi);
  // Fixed start date · 2026-01-05 is a Monday.
  const startMondayISO = '2026-01-05';
  // Race day = startMonday + weeksOut × 7. Use Sunday as race day so the
  // last week's weekly count is reasonable.
  const raceDay = new Date('2026-01-05T12:00:00Z');
  raceDay.setUTCDate(raceDay.getUTCDate() + p.race.weeksOut * 7 - 1);
  const raceDateISO = raceDay.toISOString().slice(0, 10);

  return {
    raceDistanceMi: p.race.distanceMi,
    goalSec: p.race.goalSec,
    goalPaceSec: Math.round(p.race.goalSec / p.race.distanceMi),
    raceDateISO,
    startMondayISO,
    level: p.profile.experienceLevel,
    recentWeeklyMi: p.profile.weeklyBaseMi,
    // Easy median = weekly base / 4 days (mirrors what the median read
    // returns in practice for steady runners).
    easyDayMedianMi: Math.max(3, Math.round(p.profile.weeklyBaseMi / 5)),
    // 2026-06-03 · runner's recent peak long. Mid-block personas pass
    // their explicit recentLongMi; cold-start personas infer from
    // weeklyBaseMi × 0.25 (the canonical long-share for HM advanced)
    // so the long-run sizing starts from a believable baseline. Real
    // user reads come from runs in the last 28d (see recentPeakLongMi).
    recentLongMi: p.profile.midBlock?.recentLongMi
      ?? Math.round(p.profile.weeklyBaseMi * 0.25),
    // 2026-06-03 · mid-block carriers · only set on personas with a
    // midBlock block. Cold-start personas leave these undefined.
    recentQualityDistanceMi: p.profile.midBlock?.recentQualityDistanceMi,
    recentQualityPerWeek: p.profile.midBlock?.recentQualityPerWeek,
    // TIEREVIDENCE-2 (2026-09-02) · KNOWN GAP, NOT FIXED HERE, and worth the
    // sentence because it is Rule 15's shape: a cold-start persona declares a
    // `vdotAtStart` and the composer never sees it, so the only thing telling
    // the engine who these runners are was `p.profile.experienceLevel` — and
    // that is now inert. Threading `vdotAtStart` in here was tried and backed
    // out in the same pass: it fixes `david-sub-1-30-hm` (whose band was the
    // typed word's, see its own note in synthetic-runners.ts) and BREAKS
    // `sleep-debt-prone`, whose RACE-SPECIFIC long stops carrying its HM
    // insert at the higher peak the evidence licenses. That is a real
    // behaviour worth understanding rather than a fixture to bend, so the
    // gap is named and left for its own change.
    bestRecentVdot: p.profile.midBlock?.bestRecentVdot,
    isMidBlock: Boolean(p.profile.midBlock),
    longRunDow: 0 as DOW,    // Sun
    restDow: 6 as DOW,        // Sat
    qualityDows: [2, 4] as DOW[],   // Tue + Thu
    // null = legacy fill-all (synthetic personas predate weekly_frequency;
    // the matrix smoke harness covers the frequency-capped behavior).
    trainingDaysPerWeek: null,
    crossModes: [],
    rxQuality: inlinePrescriptions(cat),
    rxRaceSpecific: inlinePrescriptions(cat),
    tPaceSec: fixtureTPaceFromGoalPace(p.race.goalSec, p.race.distanceMi),
    lthr: null,
    // 2026-06-03 · Rule 16 · personas without maxHr fall back to
    // LTHR-only HR cap derivation. Null is the honest default for
    // a synthetic persona without a measured max.
    maxHr: null,
  };
}

/** Sum of a week's days, used to verify weekly target alignment. */
function weekTotal(week: { days: { distanceMi: number }[] }): number {
  return week.days.reduce((s, d) => s + (d.distanceMi || 0), 0);
}

/** Longest run in a week. */
function weekLong(week: { days: { distanceMi: number; type: string }[] }): number {
  const longs = week.days.filter((d) => d.type === 'long').map((d) => d.distanceMi);
  return longs.length > 0 ? Math.max(...longs) : 0;
}

/** Count of quality days in a week (non-rest, non-long, non-easy). */
function weekQualityCount(week: { days: { type: string; isQuality?: boolean }[] }): number {
  return week.days.filter((d) =>
    d.type === 'tempo' || d.type === 'threshold' || d.type === 'intervals'
  ).length;
}

describe('Generator bench · composePlan() output against persona doctrine', () => {
  for (const p of PERSONAS) {
    describe(`Persona: ${p.name}`, () => {
      const input = personaToComposeInput(p);
      const result = composePlan(input);
      const exp = p.expectedPlan;

      it('produces a multi-week plan', () => {
        expect(result.weeks.length).toBeGreaterThanOrEqual(p.race.weeksOut - 1);
      });

      it('peak weekly mileage within doctrine band', () => {
        // Look at BUILD weeks only · exclude TAPER + race week.
        const buildWeeks = result.weeks.filter((w) =>
          w.phase !== 'TAPER' && !w.isRaceWeek
        );
        const peak = Math.max(...buildWeeks.map(weekTotal));
        const [lo, hi] = exp.peakWeeklyMileageBand;
        // ±10% tolerance.
        const tolerance = 0.10;
        expect(peak).toBeGreaterThanOrEqual(lo * (1 - tolerance));
        expect(peak).toBeLessThanOrEqual(hi * (1 + tolerance));
      });

      it('peak long matches peak weekly × longRunShare ±1.5mi (build only)', () => {
        // Build-week peak only · TAPER has long=0 by design.
        let peakIdx = 0, peakMi = 0;
        for (let i = 0; i < result.weeks.length; i++) {
          const w = result.weeks[i];
          if (w.phase === 'TAPER' || w.isRaceWeek) continue;
          const t = weekTotal(w);
          if (t > peakMi) { peakMi = t; peakIdx = i; }
        }
        // Expected long · respects the tier peakLong band cap. Some
        // personas' longRunShare × peakWeekly would exceed the tier's
        // peakLong upper bound (e.g. ultra) · the generator correctly
        // caps and the assertion follows.
        // TIEREVIDENCE-1 (2026-09-02) · READ THE COMPOSED ROW, NOT THE
        // PUBLISHED BAND. `authored_state.tier_peak_long_band` used to be the
        // composer's own `tierTarget.peakLongMiBand` copied verbatim, so this
        // oracle could read it. It is now the EVIDENCE ceiling — the row the
        // runner's demonstrated performance earns, which `adaptive-ramp.ts`
        // binds the upward bump on — and the block is still composed against
        // `tierTarget`. Two different quantities, so this assertion has to name
        // which one it means (Rule 16). It means the composed row, which
        // `authored_state.goal_tier` records.
        const composedTier = result.authoredState.goal_tier as GoalTier | undefined;
        const composedRow = composedTier
          ? TIER_TARGETS[distanceCategoryOf(p.race.distanceMi)][composedTier]
          : undefined;
        const tierLongMax = composedRow ? composedRow.peakLongMiBand[1] : Infinity;
        const tierLongMin = composedRow ? composedRow.peakLongMiBand[0] : 0;
        const shareLong = Math.min(peakMi * exp.longRunShare, tierLongMax);
        // RC2-2 (2026-06-23): when the share would underreach band[0] (e.g. HM-advanced 14 < 15), the long
        // is distance-DRIVEN UP into the tier band instead of the share. So the peak long is the share OR
        // lifted into the band — accept anything from the share/band floor up to the band cap.
        const actualLong = weekLong(result.weeks[peakIdx]);
        const loBound = Math.min(shareLong, tierLongMin) - 1.5;
        const hiBound = Math.max(shareLong, tierLongMax) + 1.5;
        expect(actualLong).toBeGreaterThanOrEqual(loBound);
        expect(actualLong).toBeLessThanOrEqual(hiBound);
      });

      it('no build-week long is shorter than runner recent long (2026-06-03)', () => {
        // The fix that closed David's "why is Sun 9mi when I just did 12?"
        // bug · the generator must not author a long shorter than the
        // runner's recent peak long (modulo cutback margin). Non-cutback
        // build weeks must hold the floor.
        // CUTBACK-LONG-1 (2026-08-28) · cutback weeks now drop the long
        // 20-30% off the preceding load block (Research/00b §"Depth of
        // Cutback by Mileage Tier") — the old "~2mi" allowance here encoded
        // the shallow cutback this fix removed. The deepest doctrine-legal
        // cutback long is 70% of a reference that is itself floored at
        // recentLong - 1, so that is the answer-side floor now.
        // Mid-block personas pass explicit recentLongMi; cold-start
        // personas use the derived value (matches personaToComposeInput).
        const recentLong = p.profile.midBlock?.recentLongMi
          ?? Math.round(p.profile.weeklyBaseMi * 0.25);
        if (recentLong < 8) return; // floor only kicks in for true long-runners
        for (let i = 0; i < result.weeks.length; i++) {
          const w = result.weeks[i];
          if (w.phase === 'TAPER' || w.phase === 'BASE' || w.isRaceWeek) continue;
          const isCutback = i > 0 && (i + 1) % 4 === 0;
          const floor = isCutback ? Math.floor((recentLong - 1) * 0.70) - 1 : recentLong - 1;
          const long = weekLong(w);
          if (long === 0) continue; // no long that week (rare)
          expect(long).toBeGreaterThanOrEqual(floor);
        }
      });

      it('every non-base / non-taper week has at least one quality day', () => {
        const non = result.weeks.filter((w) =>
          w.phase !== 'BASE' && w.phase !== 'TAPER' && !w.isRaceWeek
        );
        if (non.length === 0) return;
        for (const w of non) {
          expect(weekQualityCount(w)).toBeGreaterThanOrEqual(1);
        }
      });

      it('quality density matches persona qualityPerWeek (±1)', () => {
        const non = result.weeks.filter((w) =>
          w.phase === 'QUALITY' || w.phase === 'RACE-SPECIFIC'
        );
        if (non.length === 0) return;
        const avg = non.reduce((s, w) => s + weekQualityCount(w), 0) / non.length;
        expect(avg).toBeGreaterThanOrEqual(exp.qualityPerWeek - 1);
        expect(avg).toBeLessThanOrEqual(exp.qualityPerWeek + 1);
      });

      it('long-run race-pace label matches race distance', () => {
        // HM races · expect "@ HM" not "@ MP" on RACE-SPECIFIC long runs
        // (if any race-pace insert at all). Marathon races expect "@ MP".
        // 5K / 10K / ULTRA shouldn't carry race-pace inserts.
        // #12 (audit 2026-06-16) · ultra (>30mi) is its own category now —
        // ultra race pace sits well below marathon pace, so a long-run finish
        // must NOT be tagged "MP" (was: the old `>=25 → MP` bucket conflated a
        // 50K with a marathon). Marathon is 20..30mi.
        const labels = result.weeks
          .filter((w) => w.phase === 'RACE-SPECIFIC')
          .flatMap((w) => w.days.filter((d) => d.type === 'long').map((d) => d.subLabel ?? ''));
        if (labels.length === 0) return;
        if (p.race.distanceMi > 30) {
          // Ultra · no race-pace insert (builds via the long run / time-on-feet)
          const hasMP = labels.some((l) => l.includes('@ MP'));
          const hasHM = labels.some((l) => l.includes('@ HM'));
          expect(hasMP || hasHM).toBe(false);
        } else if (p.race.distanceMi >= 20) {
          // Marathon · expect MP inserts
          const hasMP = labels.some((l) => l.includes('MP'));
          expect(hasMP).toBe(true);
        } else if (p.race.distanceMi >= 12) {
          // Half · expect HM inserts (not MP)
          const hasHM = labels.some((l) => l.includes('HM'));
          const hasMP = labels.some((l) => l.includes('@ MP'));
          expect(hasMP).toBe(false);
          // Soft: HM insert presence depends on whether RACE-SPECIFIC phase
          // exists for this persona's weeksOut · don't hard-require here.
          if (labels.some((l) => l.includes('@'))) {
            expect(hasHM).toBe(true);
          }
        } else {
          // 5K / 10K · no race-pace inserts on long runs
          const hasMP = labels.some((l) => l.includes('@ MP'));
          const hasHM = labels.some((l) => l.includes('@ HM'));
          expect(hasMP || hasHM).toBe(false);
        }
      });

      it('late-QUALITY HM long runs carry the race-pace warm-in, on cadence (Audit D + VARIETY-LONG-1)', () => {
        // 2026-06-07 · the generator must emit race-pace finish labels in the
        // last-three-QUALITY window for HM plans (Research/22 §3), so
        // buildWorkoutSpec encodes the finish and the watch executes it.
        // Before that fix QUALITY longs were plain "LONG" → flat easy spec
        // under a label that promised nothing → no specific-endurance stimulus.
        //
        // VARIETY-LONG-1 (2026-08-28) · the window is now CADENCE-GATED and
        // the variant ROTATES, so this no longer asserts three consecutive
        // finishes. Research/00a §"Long-run rules of thumb" — "intensity
        // inserts come 1 in every 2–3 long runs in marathon/half cycles" —
        // and §4.5's own Frequency row ("Every 2–3 weeks") both forbid the
        // three-in-a-row shape the original assertion demanded; the doctrine
        // gate's LONGRUN.intensity-cadence claim holds the rule. What survives
        // of Audit D's contract: the warm-in still EXISTS inside the window,
        // it is still race-pace work (an @ M warm-in, an @ HM step, or §4.3's
        // M→T progression whose tail is the same T band Research/01 puts HM
        // pace in), it never fires before the window, and off-cadence weeks
        // run plain — which is the half Audit D never had.
        if (!(p.race.distanceMi >= 12 && p.race.distanceMi < 25)) return; // HM only
        const qWeeks = result.weeks.filter((w) => w.phase === 'QUALITY');
        if (qWeeks.length < 3) return; // need the full last-3 window
        const longLabel = (w: { days: { type: string; subLabel?: string | null }[] }) =>
          w.days.find((d) => d.type === 'long')?.subLabel ?? '';
        const window = qWeeks.slice(-3).map(longLabel);
        const finishes = window.filter((l) => l !== 'LONG' && l !== '');
        // The warm-in exists: at least one intensity long inside the window.
        expect(finishes.length, `no race-pace long in the last-3 QUALITY window: ${window.join(' | ')}`).toBeGreaterThan(0);
        // And the cadence exists: never all three weeks hot.
        expect(finishes.length, `every warm-in week carries a finish — the cadence is gone: ${window.join(' | ')}`).toBeLessThan(3);
        // Every finish in the window is race-pace work at the HM's own paces:
        // an M warm-in, the HMP step, or the M→T progression.
        for (const l of finishes) {
          expect(l, `unexpected warm-in label: ${l}`).toMatch(/@ (M|HM|T)\b/);
          expect(l).toMatch(/@ M\b|@ HM\b/);
        }
        // earlier QUALITY weeks stay plain easy longs · no premature race pace
        for (const w of qWeeks.slice(0, -3)) {
          const label = longLabel(w);
          expect(label).not.toContain('@ HM');
          expect(label).not.toContain('@ M');
        }
      });

      it('volume ramps · peak weekly exceeds start-week weekly', () => {
        // Peak should be strictly greater than week-0 (otherwise the
        // ramp math is broken · the plan is flat).
        const startWk = weekTotal(result.weeks[0]);
        const peak = Math.max(...result.weeks.map(weekTotal));
        expect(peak).toBeGreaterThan(startWk);
      });

      it('every week has a long run unless taper or race week', () => {
        for (const w of result.weeks) {
          if (w.isRaceWeek || w.phase === 'TAPER') continue;
          const hasLong = w.days.some((d) => d.type === 'long' && d.distanceMi > 0);
          expect(hasLong).toBe(true);
        }
      });

      /* ──────────────────────────────────────────────────────────────────
       * Mid-block runner doctrine · 6 gap rules (2026-06-03).
       * Only fire on personas with profile.midBlock set. The "david-mid-
       * block" persona exercises each. EXPECTED TO FAIL until the
       * corresponding generator policy lands.
       *
       * Cite: docs/PLAN_ENGINE_MID_BLOCK_DOCTRINE.md
       * ──────────────────────────────────────────────────────────────── */

      // RULE 2 · quality distance floor.
      //
      // Generator must not author a quality day shorter than runner's
      // typical quality distance (e.g. if recent tempos are 8mi, don't
      // author a 5mi tempo on week 1). GAP · layoutWeek currently sizes
      // qualityMiEach = round(weeklyMi × 0.22 / qualityDows.length),
      // which is goal-blind to recent baseline.
      //
      // BOUNDARY-OWNER-1 (2026-09-02) · THE FLOOR MOVED FROM THE DAY'S TOTAL
      // TO THE DAY'S WORK, ONCE, AND THIS IS THE CITATION.
      //
      // The assertion above read the floor against `q.distanceMi` — the whole
      // day, warm-up and cool-down included. `layoutWeek` honoured it that way
      // too, and on the owner's live CIM block the result was a 4.3-mile
      // session inflated to 6.2 miles whose extra 1.9 became easy legs:
      // "2.1 mi WU · 2 mi @ T · 2.1 mi CD", 4.2 miles of jogging around 2.0
      // miles of threshold work (reproduced against production 2026-09-02 via
      // `_probe_cim_sessions`; the brief's §3.2.D finding).
      //
      // Rule 2's own words are "don't author a shorter version of the workout
      // this runner is already doing", and a workout is its WORK.
      // `Research/04` §5.2/§5.3 state the easy legs separately from the
      // at-pace band precisely because they are a different quantity, and
      // `lib/plan/quality-day.ts` is this app's one owner of the day's size
      // (Constitution §5). Reading a mileage floor against the day's total
      // made an arithmetic remainder outrank that owner — the Rule 7 shape, a
      // doctrine number spent on the quantity next to the one it was written
      // about.
      //
      // So the floor is now asserted on the session's AT-PACE mileage, which
      // is what Rule 2 is a claim about, and the day is whatever
      // `composeQualityDay` composes around it. The doctrinally-sized path in
      // `layoutWeek` no longer applies `qualityFloor`; the share-based
      // fallback still does, unchanged.
      it('[mid-block] quality WORK ≥ runner recent quality work', () => {
        if (!p.profile.midBlock) return; // cold-start exempt
        const floor = p.profile.midBlock.recentQualityDistanceMi;
        if (floor < 5) return; // only applies to non-trivial baselines
        // The runner's recent quality DAY carried its own easy legs, so the
        // comparable work figure is that day less doctrine's bottom-of-band
        // warm-up and cool-down for a threshold session (§5.3's "2-3 mi E each
        // side", spent at the bottom by `QUALITY_WARMUP_MI`/`QUALITY_COOLDOWN_MI`).
        const workFloor = Math.max(1, floor - 4);
        let checked = 0;
        for (const w of result.weeks) {
          if (w.phase !== 'QUALITY' && w.phase !== 'RACE-SPECIFIC') continue;
          if (w.isRaceWeek) continue;
          // THRESHOLD-FAMILY ONLY. Rule 2's own example is a tempo ("if recent
          // tempos are 8mi, don't author a 5mi tempo"), and it is a claim about
          // the same KIND of session. `generate.ts`'s DOCTRINE-BASE-2 block
          // already makes this argument in the engine: §6/§7/§8 work is a
          // different session with a different day around it, governed by
          // Daniels' 8%/5% I and R caps rather than by how long the runner's
          // last tempo was, and "flooring eight fifteen-second hill sprints at
          // a seven-mile day would wrap five easy miles around ninety seconds
          // of work and call it quality". So an intervals/hills day is out of
          // this floor's scope, not exempt from it.
          const qualityDays = w.days.filter((d) =>
            d.type === 'tempo' || d.type === 'threshold'
          );
          for (const q of qualityDays) {
            const work = splitDay(q as never).qualityMi;
            // A by-effort session prices no at-pace mileage; Rule 2 has nothing
            // to say about it and `splitDay` reports zero.
            if (!(work > 0)) continue;
            checked++;
            expect(
              work,
              `${w.startISO} ${q.type} "${q.subLabel}" work ${work}mi < floor ${workFloor}mi`,
            ).toBeGreaterThanOrEqual(workFloor - 1);
          }
        }
        // Rule 18 liveness: a floor asserted over zero sessions is not a floor.
        expect(checked, 'no priced quality session reached the Rule 2 floor').toBeGreaterThan(0);
      });

      // RULE 3 · pace anchor blend.
      // Early build weeks should anchor pace targets to bestRecentVdot,
      // not the goal-tier table. Pace tightens to goal-pace by mid-block.
      // GAP · pace is sourced from goal-tier from week 1.
      // Test asserts that for mid-block personas with recent VDOT below
      // goal-implied VDOT, week 1 quality has a "calibrated pace" note
      // OR sub_label includes a "current" tag. As a proxy until the
      // policy lands, this test just asserts the persona's `bestRecentVdot`
      // is wired through `composePlan` (i.e. the policy has a hook).
      it('[mid-block] bestRecentVdot read · pace anchor blend hook exists', () => {
        if (!p.profile.midBlock) return;
        // The bench can't reach into composePlan internals without an
        // export · so this test just verifies the carrier is non-null on
        // the input. The actual blend assertion lands when the policy
        // ships (see TODO at generate.ts § layoutWeek pace targets).
        expect(input.bestRecentVdot).toBe(p.profile.midBlock.bestRecentVdot);
      });

      // RULE 4 · monotonic volume floor.
      // Week 1 weekly volume must be ≥ runner's recent weekly (the
      // climbFactor can be 1.0 but never < 1.0). GAP · volumeCurve
      // starts at max(VOLUME_FLOOR, baseMi) so this should already pass
      // when baseMi ≥ floor · the test catches regressions.
      it('[mid-block] week 1 weekly volume ≥ runner recent weekly', () => {
        if (!p.profile.midBlock) return;
        const recentMi = p.profile.weeklyBaseMi;
        const wk1 = weekTotal(result.weeks[0]);
        // Allow 10% downside · easyMileFloor + quality + long math can
        // round below the strict target by ~3-4mi for a 35mpw base.
        expect(wk1).toBeGreaterThanOrEqual(Math.round(recentMi * 0.9));
      });

      // RULE 5 · quality density mirrors recent habit, ramps gradually.
      // If runner did 1 quality/wk recently, week 1 should be 1-2, not 3.
      // If they did 2, week 1 should be 2 (matches habit). GAP · currently
      // pulls qualityDows.length straight from the input regardless of
      // recent habit.
      it('[mid-block] week 1 quality count within ±1 of recent habit', () => {
        if (!p.profile.midBlock) return;
        const recentQ = p.profile.midBlock.recentQualityPerWeek;
        // Skip BASE · density there is always 0.
        const wk1 = result.weeks.find((w) =>
          w.phase === 'QUALITY' || w.phase === 'RACE-SPECIFIC'
        );
        if (!wk1) return;
        const actualQ = weekQualityCount(wk1);
        expect(actualQ).toBeLessThanOrEqual(recentQ + 1);
        expect(actualQ).toBeGreaterThanOrEqual(Math.max(1, recentQ - 1));
      });

      // RULE 6 · phase compression when weeks_to_race < 10.
      // Mid-block runner with limited runway should skip BASE entirely
      // and compress QUALITY:RACE-SPECIFIC. GAP · sizeBlocks already
      // honors isMidBlock=true to skip BASE, but doesn't auto-compress
      // based on weeks_to_race alone. This test ensures BASE = 0 for
      // mid-block personas regardless of runway.
      it('[mid-block] no BASE phase weeks', () => {
        if (!p.profile.midBlock) return;
        const baseWeeks = result.weeks.filter((w) => w.phase === 'BASE').length;
        expect(baseWeeks).toBe(0);
      });

      // RULE 8 · cutback frequency calibrated to cumulative load.
      // Mid-block runner with N weeks of prior load should have cutback
      // every 3rd week, not every 4th (proxy · until Banister TSB
      // signal is wired through). GAP · current cutback is week-idx mod 4
      // only. This is a NEGATIVE assertion for now · documents the gap
      // without enforcing a policy that doesn't exist.
      it('[mid-block] cutback frequency hook · documented gap', () => {
        if (!p.profile.midBlock) return;
        // No assertion · this test exists to document the gap rule
        // until the Banister-TSB-driven cutback policy lands.
        // (See generate.ts § volumeCurve deload mask comment.)
        expect(true).toBe(true);
      });
    });
  }
});
