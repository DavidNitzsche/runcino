/**
 * lib/plan/_boundary_run.test.ts · BOUNDARY-OWNER-1 (2026-09-02).
 *
 * THE WARM-UP AND COOL-DOWN A RUNNER IS HANDED ARE THE OWNER'S ANSWER, NEVER
 * A REMAINDER.
 *
 * ── The defect this gate exists for ─────────────────────────────────────────
 *
 * Reproduced against production on 2026-09-02 (`_probe_cim_sessions`, the
 * owner's live CIM block, week of 2026-09-07):
 *
 *     sub_label  "2.1 mi WU · 2 mi @ T · 2.1 mi CD"
 *     spec       warmup_mi 2.1 · tempo_distance_mi 2 · cooldown_mi 2.1
 *
 * 4.2 miles of easy running around 2.0 miles of threshold work. Nothing chose
 * it. Two arithmetic mechanisms produced it and the session lost to both:
 *
 *   1. `applyDosingCaps` cut a 4.5-mile continuous tempo to Daniels' 2.94-mile
 *      share of a 29.4-mile week, and `trimSessionDose`'s three-segment branch
 *      wrote `${cd + block - want} mi CD` — the cool-down absorbed the cut,
 *      because "the day's own distance never changes".
 *   2. `layoutWeek`'s recent-quality-distance floor (mid-block Rule 2) raised
 *      the day's TOTAL toward the runner's habitual quality-day mileage, on a
 *      day `composeQualityDay` had already sized from its session.
 *
 * `docs/0901/plan-generation-review-and-implementation-brief-2026-09-02.md`
 * §3.2.D names it: "a weekly-mileage balancing result, not a persuasive workout
 * design", and §5.3 rules that "residual mileage cannot increase them beyond
 * coaching-sensible bounds".
 *
 * ── What is asserted ────────────────────────────────────────────────────────
 *
 * Two HARD invariants, one per mechanism above, each falsifiable on its own;
 * and a corpus-wide CENSUS held as a ratchet.
 *
 * The census is a ratchet rather than a zero because the engine does not yet
 * satisfy the general invariant and saying otherwise would be the "gate that
 * cannot fail" this repo has shipped before (Rule 18). It measured 19,430
 * sessions whose legs exceed what `quality-day.ts` composes for them, mostly by
 * one to three tenths of a mile — `spec-builder`'s own warm-up floors are taken
 * against the DAY's budget while the owner's are taken against the SESSION, so
 * the two round apart by a tenth on small days. That is a real second answer to
 * one question (Rule 16) and it is written down here as an open number rather
 * than hidden. It may shrink; it may never grow.
 *
 * ── WHAT THIS GATE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
 *
 * Structurally incapable of catching any of these:
 *
 *   · A TIME-BASED or BY-EFFORT rep set (every hill session, the sprints).
 *     `totalDistanceMiFromSpec` returns the day's headline distance for those
 *     rather than the sum of its parts, so their legs do not have to account
 *     for the day at all. They are COUNTED below as out-of-scope, never as
 *     compliant, and they are the majority of authored quality sessions.
 *   · The long run, the race day and the race-week tune-up. None is composed by
 *     `composeQualityDay`.
 *   · Whether the warm-up is the RIGHT length in the first place. This asks
 *     only whether the engine agrees with its own owner. If `quality-day.ts` is
 *     wrong about doctrine, this gate agrees with it and says nothing.
 *   · Where the freed mileage went. A trimmed session now leaves its week
 *     slightly under target; that gap is the bounded tolerance the brief §5.3
 *     prefers to a distorted session, and it is reported here but not gated.
 *   · Any runner the archetype corpus cannot express (Rule 15). Only 89 of the
 *     11,687 arcs carry a history at all, so mechanism 2 above — which needs
 *     `recentQualityDistanceMi` — is reached by the corpus census on those arcs
 *     only. That is why invariant 2 below drives `composePlan` directly with a
 *     history rather than relying on the sweep.
 */
import { describe, it, expect } from 'vitest';
import { buildSimPlan } from './sim-inputs';
import { matrix, arcStr, simInputsForArc, type Arc } from './sim-matrix';
import { buildWorkoutSpec, capSpecToDistance, conservativeVdotFromMileage } from './spec-builder';
import { fixtureTPaceFromGoalPace } from './_fixture-goal-tpace';
import { composeQualityDay, JOG_PACE_S_PER_MI, type QualityFamily } from './quality-day';
import { tPaceFromVdot, iPaceFromVdot, vdotFromTpace } from '@/lib/training/vdot';
import { distanceCategoryOf } from './goal-tiers';
import { distanceCategoryOrThrow } from '@/lib/race/distance-category';
import { composePlan, inlinePrescriptions, type ComposePlanInput, type DOW } from './generate';
import { splitDay } from './intensity-distribution';

/** Rounding slack. Distances are stored to the tenth and the owner composes to
 *  the hundredth, so two tenths absorbs the grain without admitting a mile. */
const TOLERANCE_MI = 0.2;

/**
 * THE RATCHET · measured 2026-09-02 on the fixed engine, over the whole
 * archetype matrix. It may shrink; it may never grow. When it reaches zero,
 * delete the ratchet and assert zero — and delete this paragraph with it.
 *
 * Both numbers are ceilings on a COUNT of sessions, not on a magnitude, so a
 * regression that makes one session much worse without adding a session would
 * pass here. `WORST_RATIO_CEILING` is the magnitude half.
 */
const CENSUS_BASELINE = {
  /** Sessions whose warm-up + cool-down exceeds the owner's answer for them. */
  overOwner: 7871,
  /** Sessions whose warm-up + cool-down exceeds their own work + jog floats. */
  legsOutweighWork: 8114,
} as const;

/* MPLADDER-1 (2026-09-03) · RAISED, 7735 -> 7871 and 8100 -> 8114, and the
 * ratchet demands an argued reason before it moves the wrong way. This is it,
 * and the cause was ISOLATED rather than assumed.
 *
 * `docs/PROGRESSIVE_BASELINE_DOCTRINE.md` Q14: "When a long run carries ≥~6
 * meaningful marathon-effort miles, it IS a quality session — schedule only one
 * additional midweek quality workout." The engine used to collapse a marathon
 * week to ONE midweek session whenever its long carried ANY marathon pace, so a
 * four-mile fast-finish cost a midweek workout. It no longer does, and those
 * restored sessions are what this census counts.
 *
 * MEASURED, not argued: setting `MP_LONG_COUNTS_AS_QUALITY_MI` to 0 — which
 * restores the old "any MP collapses the week" behaviour and nothing else —
 * brings both numbers back under the old baseline and this file green. The
 * delta is therefore entirely the restored midweek sessions, not a change in
 * how any session is SIZED: the worst offenders printed by the census are the
 * same 5K and half archetypes as before, none of which the ladder touches, and
 * the two other assertions in this file (label arithmetic, habitual-floor
 * inflation) both pass.
 *
 * A session that would not exist at all cannot have a better warm-up-to-work
 * ratio than one that does, so a corpus with more sessions in it counts more of
 * them. The RATE is what this census is really about and it is unchanged: 7871
 * of 19983 in scope, against 7735 of the smaller corpus before.
 *
 * BOUNDARY-OWNER-2 in the same change moved this number the other way, by
 * taking the habitual quality-day floor off the race-week tune-up, which
 * doctrine sizes itself. The net is +136. */

/* TIEREVIDENCE-2 (2026-09-02) · LOWERED, 18394 -> 7735 and 19249 -> 8100, by
 * the ratchet's own staleness guard rather than by choice: it fails until the
 * numbers come down. The corpus shrank because the self-declared experience
 * level stopped selecting the load row, so the archetypes that used to compose
 * against `advanced` and `advanced_plus` rows off a typed word now compose
 * against the row their evidence earns, and a smaller week cannot carry the
 * oversized warm-up/cool-down pairs this census counts. That is the ratchet
 * moving in the direction it is allowed to move, and it may not go back up. */

/**
 * RAISED BY ONE 2026-09-02 by LADDER-LENGTH-1, and this is the argued reason a
 * ratchet demands before it is allowed to move the wrong way.
 *
 * LADDER-LENGTH-1 removed a Rule 9 cliff in `restoreSteps`: the ladder no
 * longer emits a rung worth a tenth of a mile, so a returning runner's block
 * spends one fewer week restoring and one more week climbing. That changes the
 * COMPOSITION of the 89 archetypes in this corpus that carry a history at all
 * — the only ones `restoreSteps` can reach — and one quality session in one of
 * them lands in a different week, at a different size, on the far side of the
 * owner's answer.
 *
 * WHAT DID NOT MOVE, which is why this is a corpus shift rather than a
 * boundary-run regression: `worstRatio` is unchanged at 35.48, on the same
 * archetype (`5k/intermediate/f3/m35/L0-3/goal`, `1x200m @ mile`), and every
 * entry in the worst-over list is unchanged. The magnitude half of this gate
 * did not budge; one session crossed a count.
 *
 * Both numbers moved by exactly one, together, which is the signature of a
 * single session changing week — not of the reader changing its mind.
 */

/**
 * LOWERED 2026-09-02 by LADDER-TARGET-2, which did not set out to move it:
 * 19,430 -> 18,393 and 20,304 -> 19,248. A cutdown now renders as an explicit
 * per-rung sequence rather than as `N x size`, so `segmentSpec` sizes its
 * warm-up and cool-down from the SESSION's own work rather than the uniform
 * rep path's day budget — which is the same correction BOUNDARY-OWNER-1 exists
 * to measure, arriving from a different direction. Re-measured, not argued.
 */

/**
 * The worst boundary:work ratio the corpus produces, and an OPEN FINDING.
 *
 * 35.5 is `1×200m @ mile` — a repetition session whose 0.12 mi of work sits
 * inside a day of jogging. `Research/04` §7.4 pairs R work with §17.1's "1-2 mi"
 * jog each side and §7's own contraindication row caps R at 5% of the week, so
 * a single 200 m rep is doctrine's own smallest legal dose; the day around it
 * is not. Recorded as a ceiling so it cannot get worse while the right fix —
 * refusing a session the week cannot seat, the way DOCTRINE-BASE-2 already does
 * for the base week — is decided by whoever owns the R slot.
 */
const WORST_RATIO_CEILING = 35.5;

interface Read {
  family: QualityFamily;
  workMi: number;
  floatMi: number;
  warmupMi: number;
  cooldownMi: number;
}

/** The session a spec describes, or null when the day's headline distance is
 *  not the sum of its parts (see the Rule 22 note). */
function readSession(spec: unknown): Read | null {
  if (!spec || typeof spec !== 'object') return null;
  const s = spec as Record<string, unknown>;
  const kind = String(s.kind ?? '');
  const wu = Number(s.warmup_mi ?? 0) || 0;
  const cd = Number(s.cooldown_mi ?? 0) || 0;
  if (kind === 'tempo') {
    const work = Number(s.tempo_distance_mi ?? 0) || 0;
    if (!(work > 0)) return null;
    return { family: 'threshold', workMi: work, floatMi: 0, warmupMi: wu, cooldownMi: cd };
  }
  if (kind !== 'threshold' && kind !== 'intervals') return null;
  const family: QualityFamily = kind === 'intervals' ? 'interval' : 'threshold';
  const steps = Array.isArray(s.steps) ? (s.steps as Record<string, unknown>[]) : null;
  if (steps && steps.length > 0) {
    let work = 0;
    let restS = 0;
    for (const st of steps) {
      const mi = Number(st?.distance_mi ?? 0) || 0;
      if (!(mi > 0)) return null; // a by-effort rung · out of scope
      work += mi;
      restS += Number(st?.rest_s ?? 0) || 0;
    }
    return { family, workMi: work, floatMi: restS / JOG_PACE_S_PER_MI, warmupMi: wu, cooldownMi: cd };
  }
  const repMi = Number(s.rep_distance_mi ?? 0) || 0;
  const reps = Number(s.rep_count ?? 0) || 0;
  // A time-based rep set (`rep_duration_s` with no rep distance) keeps the
  // day's headline distance. Out of scope, and counted as such.
  if (!(repMi > 0) || !(reps > 0)) return null;
  const restS = Number(s.rep_rest_s ?? 0) || 0;
  return {
    family,
    workMi: repMi * reps,
    floatMi: Math.max(0, reps - 1) * restS / JOG_PACE_S_PER_MI,
    warmupMi: wu,
    cooldownMi: cd,
  };
}

/** A mid-block marathoner whose habitual quality DAY is far longer than the
 *  session doctrine will size for him — mechanism 2's exact shape, and the
 *  owner's own shape (his `recentQualityDistanceMi` read 7.5 on 2026-09-02). */
function midBlockInput(recentQualityDistanceMi: number): ComposePlanInput {
  const raceDistanceMi = 26.2;
  const cat = distanceCategoryOrThrow(raceDistanceMi);
  return {
    raceDistanceMi,
    goalSec: 10800,
    goalPaceSec: Math.round(10800 / raceDistanceMi),
    raceDateISO: '2026-04-26',
    startMondayISO: '2026-01-05',
    level: 'advanced',
    recentWeeklyMi: 30,
    easyDayMedianMi: 6,
    recentLongMi: 14,
    recentQualityDistanceMi,
    recentQualityPerWeek: 2,
    bestRecentVdot: 52,
    isMidBlock: true,
    longRunDow: 0 as DOW,
    restDow: 6 as DOW,
    qualityDows: [2, 4] as DOW[],
    trainingDaysPerWeek: 6,
    crossModes: [],
    rxQuality: inlinePrescriptions(cat),
    rxRaceSpecific: inlinePrescriptions(cat),
    tPaceSec: fixtureTPaceFromGoalPace(10800, raceDistanceMi),
    lthr: 168,
    maxHr: 185,
  };
}

describe('BOUNDARY-OWNER-1 · the warm-up and cool-down are the owner\'s answer', () => {
  /**
   * INVARIANT 1 · a dosing trim comes out of the DAY, not into the cool-down.
   *
   * HONEST STATUS (Rule 18, Rule 20): this is a REGRESSION guard, not the check
   * that caught the live defect. Falsified against `origin/main`'s unfixed
   * `trimSessionDose` — which wrote `${cd + block - want} mi CD`, growing the
   * cool-down by exactly what the block gave up — and it still PASSED, over 100+
   * three-segment labels across the whole matrix. Two facts follow and both are
   * stated rather than papered over:
   *
   *   · The corpus does not reach that branch with a trim large enough to make
   *     the cool-down lopsided. The branch's own inflation is therefore
   *     unproven-in-the-wild, and the change to it is defensive.
   *   · The owner's live defect came in through the OTHER path — the day's total
   *     was inflated before `spec-builder` ever split it — which is what
   *     invariant 2 and the census below actually catch.
   *
   * What this does gate is the shape: the three segments still sum to the day
   * (no sub_label/spec drift), and neither leg runs away from the other.
   */
  it('a session trimmed to the dosing cap keeps its authored cool-down', () => {
    // Swept over the WHOLE archetype matrix rather than one persona: the
    // three-segment trim fires on a narrow combination (a week whose Daniels T
    // share is well under the block the composer wants, on a slot the catalogue
    // rendered in the "N mi WU · M mi @ T · P mi CD" grammar), and a
    // single-persona probe was green against the unfixed engine — Rule 18's
    // "falsify it" is what found that, not review.
    let checked = 0;
    let lopsided = 0;
    let unsummed = 0;
    const detail: string[] = [];
    for (const a of matrix()) {
      const built = buildSimPlan(simInputsForArc(a) as never);
      if (!built.ok) continue;
      for (const w of built.composed.weeks as unknown as {
        startISO: string;
        days: { distanceMi: number; subLabel: string | null }[];
      }[]) {
        for (const d of w.days) {
          const m = String(d.subLabel ?? '')
            .match(/^([\d.]+) mi WU · ([\d.]+) mi @ [A-Za-z]+ · ([\d.]+) mi CD$/i);
          if (!m) continue;
          checked++;
          const wu = Number(m[1]);
          const block = Number(m[2]);
          const cd = Number(m[3]);
          // The three segments still describe the whole day. A label and a
          // headline distance that disagree is the sub_label/spec drift this
          // codebase has already paid for twice.
          if (Math.abs(wu + block + cd - d.distanceMi) > 0.15) {
            unsummed++;
            if (detail.length < 8) {
              detail.push(`${arcStr(a as Arc)} ${w.startISO} "${d.subLabel}" sums `
                + `${(wu + block + cd).toFixed(1)} vs day ${d.distanceMi}`);
            }
          }
          // And the cool-down is a cool-down, not a parking space for mileage
          // the block gave up. `Research/04` §5.2's own row states one figure
          // for BOTH legs of a tempo ("2-3 mi E each side"), so a cool-down a
          // mile longer than its warm-up is not a coaching choice.
          if (cd - wu > 1.0) {
            lopsided++;
            if (detail.length < 8) {
              detail.push(`${arcStr(a as Arc)} ${w.startISO} "${d.subLabel}" `
                + `cool-down exceeds warm-up by ${(cd - wu).toFixed(1)}mi`);
            }
          }
        }
      }
    }
    if (detail.length > 0) console.log('\n=== BOUNDARY-OWNER-1 · trimmed segments ===\n  ' + detail.join('\n  '));
    // Rule 18 liveness: a check over zero three-segment labels proves nothing.
    expect(checked, 'no three-segment session was authored — the matcher stopped matching')
      .toBeGreaterThan(100);
    expect(unsummed, `${unsummed} three-segment labels do not sum to their day`).toBe(0);
    expect(lopsided, `${lopsided} sessions carry a cool-down more than a mile longer than their warm-up`).toBe(0);
  }, 180_000);

  /**
   * INVARIANT 2 · the recent-quality-distance floor moves the WORK, not the day.
   *
   * Two runners identical except for the habitual quality-day mileage the floor
   * reads. Rule 2 is a claim about the session; if raising that number changes
   * the DAY without changing the WORK, the extra mileage is boundary running
   * nobody chose — which is exactly what the owner's block shipped.
   *
   * Falsify by restoring `qualityFloor` inside `layoutWeek`'s `slotMi`.
   */
  it('a longer habitual quality day does not inflate a doctrinally-sized session', () => {
    const lean = composePlan(midBlockInput(0));
    const habit = composePlan(midBlockInput(12));
    let compared = 0;
    let inflated = 0;
    const detail: string[] = [];
    for (let i = 0; i < Math.min(lean.weeks.length, habit.weeks.length); i++) {
      const a = lean.weeks[i];
      const b = habit.weeks[i];
      if (a.isRaceWeek || b.isRaceWeek) continue;
      for (let dow = 0; dow < 7; dow++) {
        const da = a.days.find((d) => d.dow === dow);
        const db = b.days.find((d) => d.dow === dow);
        if (!da || !db) continue;
        if (!da.isQuality || !db.isQuality || da.isLong || db.isLong) continue;
        if (da.type !== db.type) continue;
        const workA = splitDay(da as never).qualityMi;
        const workB = splitDay(db as never).qualityMi;
        if (!(workA > 0) || !(workB > 0)) continue;
        compared++;
        // The day grew but the session did not: pure boundary mileage.
        if (db.distanceMi > da.distanceMi + 0.25 && workB <= workA + 0.05) {
          inflated++;
          if (detail.length < 8) {
            detail.push(`${a.startISO} ${da.type}: day ${da.distanceMi} → ${db.distanceMi} `
              + `while work stayed ${workA.toFixed(2)} → ${workB.toFixed(2)} `
              + `("${da.subLabel}" → "${db.subLabel}")`);
          }
        }
      }
    }
    if (detail.length > 0) console.log('\n=== BOUNDARY-OWNER-1 · inflated days ===\n  ' + detail.join('\n  '));
    // Rule 18 liveness.
    expect(compared, 'no comparable quality session across the two plans').toBeGreaterThan(5);
    expect(
      inflated,
      `${inflated} quality days grew with the habitual-quality-distance floor while their `
        + `session did not — that mileage is warm-up and cool-down nobody chose`,
    ).toBe(0);
  });

  /**
   * CENSUS · the whole corpus, held as a ratchet (see the header).
   */
  it('the corpus census of boundary-vs-owner does not grow', () => {
    let arcs = 0;
    let composed = 0;
    let inScope = 0;
    let outOfScope = 0;
    let withHistory = 0;
    let overOwner = 0;
    let legsOutweighWork = 0;
    let worstRatio = 0;
    let worstLabel = '';
    const worstOver: { label: string; over: number }[] = [];

    for (const a of matrix()) {
      arcs++;
      const sim = simInputsForArc(a) as unknown as Record<string, unknown>;
      if (sim.dailyMiMostRecentFirst || sim.recentQualityDistanceMi) withHistory++;
      const built = buildSimPlan(sim as never);
      if (!built.ok) continue;
      composed++;
      const cat = distanceCategoryOf(built.raceDistanceMi);
      const easyAnchorT = tPaceFromVdot(
        built.derived.bestRecentVdot ?? conservativeVdotFromMileage(built.derived.recentWeeklyMi),
      ) ?? 480;
      for (const w of built.composed.weeks as unknown as {
        startISO: string; tPaceSec: number | null;
        days: { type: string; distanceMi: number; subLabel: string | null; isQuality?: boolean; isLong?: boolean }[];
      }[]) {
        const weekT = w.tPaceSec ?? built.derived.tPaceSec;
        if (weekT == null) continue;
        for (const d of w.days) {
          if (!d.isQuality || d.isLong) continue;
          if (d.type === 'race' || d.type === 'shakeout' || d.type === 'race_week_tuneup') continue;
          const iPaceSec = ['5k', '10k', 'hm'].includes(cat)
            ? iPaceFromVdot(vdotFromTpace(weekT)) : null;
          const spec = capSpecToDistance(
            buildWorkoutSpec(d.type, d.distanceMi, weekT, null, d.subLabel ?? '', null,
              built.derived.goalPaceSec, iPaceSec, easyAnchorT).spec,
            d.distanceMi,
          );
          const read = readSession(spec);
          if (!read) { outOfScope++; continue; }
          inScope++;
          const owner = composeQualityDay({
            family: read.family, atPaceMi: read.workMi, floatMi: read.floatMi,
          });
          const boundary = read.warmupMi + read.cooldownMi;
          const work = read.workMi + read.floatMi;
          if (work > 0) {
            const ratio = boundary / work;
            if (ratio > worstRatio) {
              worstRatio = ratio;
              worstLabel = `${arcStr(a as Arc)} ${w.startISO} "${d.subLabel}"`;
            }
            if (boundary > work + TOLERANCE_MI) legsOutweighWork++;
          }
          const over = boundary - (owner.warmupMi + owner.cooldownMi);
          if (over > TOLERANCE_MI) {
            overOwner++;
            worstOver.push({ label: `${arcStr(a as Arc)} ${w.startISO} "${d.subLabel}" `
              + `wu ${read.warmupMi} + cd ${read.cooldownMi} around ${read.workMi.toFixed(2)}mi`, over });
          }
        }
      }
    }

    worstOver.sort((x, y) => y.over - x.over);
    console.log(`\n=== BOUNDARY-OWNER-1 CENSUS · ${arcs} archetypes, ${composed} composed ===`);
    console.log(`  in scope (parts sum to the day):                 ${inScope}`);
    console.log(`  out of scope (time-based / by-effort · Rule 22): ${outOfScope}`);
    console.log(`  archetypes carrying a history at all:            ${withHistory}`);
    console.log(`  over the owner's answer:  ${overOwner} (ratchet ${CENSUS_BASELINE.overOwner})`);
    console.log(`  legs outweigh the work:   ${legsOutweighWork} (ratchet ${CENSUS_BASELINE.legsOutweighWork})`);
    console.log(`  worst boundary:work ratio ${worstRatio.toFixed(2)} · ${worstLabel}`);
    for (const b of worstOver.slice(0, 8)) console.log(`    +${b.over.toFixed(2)}mi  ${b.label}`);

    // Rule 18 liveness. A gate that inspected nothing reports clean, and that
    // is the worst outcome available because it also reports confidence.
    expect(composed, 'the corpus composed no plans at all').toBeGreaterThan(1000);
    expect(inScope, 'no quality session was measurable — the reader stopped matching').toBeGreaterThan(500);

    // THE RATCHET, both directions. It may shrink; it may never grow — and a
    // baseline left stale after the engine improves fails until it is lowered.
    expect(overOwner, 'more sessions exceed the owner\'s warm-up/cool-down than the ratchet allows')
      .toBeLessThanOrEqual(CENSUS_BASELINE.overOwner);
    expect(legsOutweighWork, 'more sessions have legs outweighing their work than the ratchet allows')
      .toBeLessThanOrEqual(CENSUS_BASELINE.legsOutweighWork);
    expect(worstRatio, 'the worst boundary:work ratio got worse').toBeLessThanOrEqual(WORST_RATIO_CEILING);
    expect(
      CENSUS_BASELINE.overOwner - overOwner,
      `the ratchet is stale by ${CENSUS_BASELINE.overOwner - overOwner} sessions — lower it`,
    ).toBeLessThan(500);
  }, 180_000);
});
