/**
 * THE GOAL→TRAINING-PACE BLEND IS GONE · AUTHORING-CANONICAL-1 (2026-09-01).
 *
 * This file used to hold the blend's invariants: no-calendar, hold-on-no-
 * evidence, monotone-in-measured-progress, taper-sharpens-on-evidence. Every
 * one of them was a correct guard on a mechanism Constitution §7/§G should
 * never have had — a STATED GOAL walking a PRESCRIBED TRAINING PACE. The
 * 2026-09-01 independent audit measured it firing on the owner's own live
 * plan at zero demonstrated progress, and `generate.ts` was its last caller.
 *
 * The blend, and all five of its exports, are deleted. What remains here:
 *
 *   1. THE DELETION IS GUARDED, not merely done (Rule 20). The five symbols
 *      must stay absent, and the thing that replaced them must stay wired —
 *      a deletion with nothing in its place passes every absence check and
 *      leaves the engine unable to price a block.
 *   2. THE SEASONAL CEILING has ONE owner again
 *      (`achievable-target.ts#seasonalVdotCeiling`), and the assertions that
 *      used to run against the `maxSeasonalVdotGain` alias now run against it.
 *   3. ANCHOR-STALE-2's live-HR-anchor tests, untouched — they were never
 *      about the blend.
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ────────────────────────────────
 *
 * It is a TEXT-AND-UNIT check. It cannot tell whether the canonical anchors
 * are physiologically better than the blend was — that is what
 * `_authoring_shadow_compare.audit.test.ts` measures against production, and
 * what the migration report argues. It also cannot see a goal reaching a pace
 * through some path that does not mention these five names;
 * `scripts/check-goal-pace-leak.sh` is the check for that.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildWorkoutSpec, hrCapEasy } from './spec-builder';
import { seasonalVdotCeiling } from '@/lib/training/achievable-target';
import { VDOT_GAIN_PER_WEEK_MAX, MAX_BLOCK_GAIN_VDOT } from '@/lib/training/vdot-gain-rate';

/** What `maxSeasonalVdotGain` was: a one-line alias for the ceiling Race
 *  Prediction owns. The alias is deleted (Rule 16 · one quantity, one name);
 *  the assertions it carried are kept, pointed at the owner. */
const seasonalGain = (weeks: number, distanceMi: number | null = null): number =>
  seasonalVdotCeiling(0, weeks, distanceMi).gainVdot;

const REPO = path.resolve(__dirname, '..', '..');
const RECOMPUTE_SRC = readFileSync(path.join(REPO, 'lib', 'plan', 'recompute-paces.ts'), 'utf8');
const GENERATE_SRC = readFileSync(path.join(REPO, 'lib', 'plan', 'generate.ts'), 'utf8');

describe('the goal-to-training-pace blend stays DELETED (Rule 20 · guarded as removed)', () => {
  const DELETED = [
    'BLEND_GRACE_FRACTION',
    'maxSeasonalVdotGain',
    'measuredProgressFraction',
    'gatedBlendFraction',
    'blendedTPaceForWeek',
  ];

  it('liveness · the sources it scans are real and non-trivial', () => {
    // Rule 18 · a scanner that reads nothing reports clean. Say what was read.
    expect(RECOMPUTE_SRC.length).toBeGreaterThan(5000);
    expect(GENERATE_SRC.length).toBeGreaterThan(100000);
  });

  it.each(DELETED)('recompute-paces.ts no longer exports %s', (sym) => {
    expect(new RegExp(`export (?:const|function) ${sym}\\b`).test(RECOMPUTE_SRC)).toBe(false);
  });

  it('generate.ts imports none of them', () => {
    for (const sym of DELETED) {
      expect(new RegExp(`import[^;]*\\b${sym}\\b[^;]*from '\\./recompute-paces'`).test(GENERATE_SRC))
        .toBe(false);
    }
  });

  it('and the replacement is WIRED — a deletion with nothing in its place is worse', () => {
    // The two lines that make authoring canonical. Without them every absence
    // assertion above passes and no plan can be priced at all.
    expect(GENERATE_SRC).toContain('const currentT = anchors.thresholdSecPerMi;');
    expect(GENERATE_SRC).toContain('resolvePrescribedPaceAnchors(userId, todayISO)');
  });

  it('no calendar term came back with anything else', () => {
    expect(/weekIdx\s*\/\s*denom|args\.weekIdx\s*\//.test(RECOMPUTE_SRC)).toBe(false);
    expect(/buildWeeks\s*\*\s*0\.6/.test(RECOMPUTE_SRC)).toBe(false);
  });
});

describe('seasonalVdotCeiling · the ONE seasonal ceiling (was aliased as maxSeasonalVdotGain)', () => {
  /**
   * GAINRATE-2 (2026-08-25) · this suite used to assert the fourth gain model:
   * `min(6, 2 + weeks × 0.22)`, under a title citing "Research/01:314-321" —
   * a line-number citation, which Rule 7 forbids, to a passage that says
   * something else. It asserted a zero-week block was worth +2 VDOT.
   *
   * The assertions below are derived from the bound band rather than restated,
   * so this test cannot go on agreeing with itself if the band moves.
   */
  it('spends only the BUILD weeks, at the doctrine band fast edge', () => {
    // A marathon's taper is 3 weeks and builds no fitness, so a 3-week
    // marathon block has no build weeks at all and is worth nothing. The old
    // formula paid it +2.66.
    expect(seasonalGain(3, 26.22)).toBe(0);
    expect(seasonalGain(0, 26.22)).toBe(0);
    // 14 weeks to a marathon = 11 build weeks at the fast edge.
    expect(seasonalGain(14, 26.22)).toBeCloseTo(11 * VDOT_GAIN_PER_WEEK_MAX, 6);
    // A 5K taper is one week, so the same runway buys more build.
    expect(seasonalGain(14, 3.1)).toBeCloseTo(13 * VDOT_GAIN_PER_WEEK_MAX, 6);
  });

  it('never exceeds the block ceiling every other consumer honours', () => {
    // The old cap was 6, ABOVE the bound MAX_BLOCK_GAIN_VDOT of 5 — it could
    // authorise a gain the rest of the engine calls impossible.
    for (const weeks of [20, 30, 52, 104]) {
      expect(seasonalGain(weeks, 26.22)).toBeLessThanOrEqual(MAX_BLOCK_GAIN_VDOT);
    }
    expect(seasonalGain(104, 26.22)).toBe(MAX_BLOCK_GAIN_VDOT);
  });

  it('is monotonic in runway', () => {
    let prev = -1;
    for (let w = 0; w <= 40; w++) {
      const g = seasonalGain(w, 26.22);
      expect(g).toBeGreaterThanOrEqual(prev);
      prev = g;
    }
  });

  it('is the SAME ceiling the race target is bounded by', () => {
    // The whole point of RACEPACE-1: threshold and race pace stopped being
    // floored by two different numbers.
    for (const weeks of [6, 14, 24]) {
      expect(seasonalVdotCeiling(44.1, weeks, 26.22).gainVdot)
        .toBe(seasonalGain(weeks, 26.22));
    }
  });
});

/**
 * ANCHOR-STALE-2 (2026-08-30) · THE HR ANCHORS THE RECOMPUTE FEEDS
 * `buildWorkoutSpec`.
 *
 * `recomputePacesForPlan` used to read the threshold off
 * `authored_state.lthr_bpm` — frozen at authoring — and pass `maxHr` as a
 * literal null. So the one mechanism whose job is to bring a plan up to date
 * re-cemented the anchor the plan was born with, and demoted `hrCapEasy` to
 * its LTHR-only branch, every time evidence moved the VDOT.
 *
 * It reads `profile.lthr` and `loadEffectiveMaxHr` live now. Those need a
 * database, so what is locked here is the CONTRACT the change rests on, at the
 * seam it actually crosses — what `buildWorkoutSpec` does with each pair of
 * anchors:
 *
 *   1. PARITY   — at the owner's stored 162, adding his real HRmax (180)
 *                 changes nothing. `hrCapEasy(162, 180)` is `max(145, 140)`,
 *                 and 145 is what the LTHR-only branch already returned. This
 *                 is the guarantee that nothing regresses before the anchor
 *                 moves.
 *   2. MOVEMENT — at the re-derived 168 every HR number moves with it. A fix
 *                 that reads the live anchor and produces the same output
 *                 either way would not be a fix.
 *   3. REFUSAL  — a null threshold with no HRmax carries no HR at all. This is
 *                 what the old call actually produced on the owner's live
 *                 plan, whose `authored_state.lthr_bpm` is null: not a stale
 *                 cap, no cap.
 *
 * Cite: Research/03-heart-rate-zones.md §6 (Friel Z2 ceiling · 89% LTHR) and
 * the Daniels E ceiling at 78% HRmax — see `hrCapEasy`'s own doc comment.
 */
describe('ANCHOR-STALE-2 · live HR anchors through buildWorkoutSpec', () => {
  const HR_TYPES = ['easy', 'long', 'recovery', 'tempo', 'threshold', 'intervals'] as const;
  const build = (type: string, lthr: number | null, maxHr: number | null) =>
    buildWorkoutSpec(
      type, type === 'long' ? 13 : 6, 400, lthr, null, maxHr, null, null, 520, false, null,
    ).spec;

  it('PARITY · at the stored 162 the real HRmax is a no-op', () => {
    for (const type of HR_TYPES) {
      expect(JSON.stringify(build(type, 162, 180)))
        .toBe(JSON.stringify(build(type, 162, null)));
    }
    expect(hrCapEasy(162, 180)).toBe(hrCapEasy(162, null));
    expect(hrCapEasy(162, 180)).toBe(145);
  });

  it('MOVEMENT · at the re-derived 168 every HR number moves', () => {
    for (const type of HR_TYPES) {
      expect(JSON.stringify(build(type, 168, 180)))
        .not.toBe(JSON.stringify(build(type, 162, 180)));
    }
    // The easy/long/recovery ceiling, and the quality anchor the watch reads.
    expect(hrCapEasy(168, 180)).toBe(151);
    expect((build('easy', 168, 180) as { hr_cap_bpm: number }).hr_cap_bpm).toBe(151);
    expect((build('threshold', 162, 180) as { lthr_bpm: number }).lthr_bpm).toBe(162);
    expect((build('threshold', 168, 180) as { lthr_bpm: number }).lthr_bpm).toBe(168);
  });

  it('REFUSAL · no threshold and no HRmax carries no HR, never a fabricated one', () => {
    expect(hrCapEasy(null, null)).toBeNull();
    expect((build('easy', null, null) as { hr_cap_bpm: number | null }).hr_cap_bpm).toBeNull();
    expect((build('threshold', null, null) as { lthr_bpm: number | null }).lthr_bpm).toBeNull();
    // HRmax alone still yields the Daniels E ceiling — 78% of 180.
    expect(hrCapEasy(null, 180)).toBe(140);
  });
});
