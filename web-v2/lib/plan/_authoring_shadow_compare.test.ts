/**
 * lib/plan/_authoring_shadow_compare.test.ts · PURE, NO DATABASE.
 *
 * `canonicalSpecForComposedDay` (`authoring-shadow-compare.ts`) is the new
 * shadow-only wiring this pass added — it is not `capacity-resolver.ts` or
 * `prescription-resolver.ts` themselves, both of which already carry their
 * own falsified guarantees (goal isolation at compile time, the coherence
 * gate, the monotonicity walks in `_capacity_resolver.test.ts` and
 * `_prescription_resolver.test.ts`). What THIS file has to prove is
 * narrower and specific to the new code: does threading a `PrescribedPaceAnchors`
 * object through `buildWorkoutSpec` (exactly as `recompute-paces.ts` already
 * does in production) preserve continuity, monotonicity and goal isolation
 * ONE LAYER FURTHER DOWN, inside the day-composition/spec-building branches
 * this migration has not touched yet (warm-up/cool-down sizing, distance
 * clamping, the rep-pattern parser) — properties `buildWorkoutSpec` itself
 * was never walked for, because until PRESCRIPTION-WIRE-1 no authoring
 * caller passed it a non-null `anchors` argument at all.
 *
 * No database, no `composeForUser`, no `resolvePrescribedPaceAnchors` — every
 * anchor set here is a synthetic, hand-built `PrescribedPaceAnchors`, exactly
 * as `_capacity_resolver.test.ts` drives `composeThresholdCapacity` with a
 * hand-built `ThresholdCapacityInputs`. Rule 18: falsified against the
 * pre-fix code first (see each `it`'s own note) before being trusted.
 */
import { describe, it, expect } from 'vitest';
import { specForComposedDay } from './generate';
import type { DayPlan } from './generate';
import type { PrescribedPaceAnchors } from '@/lib/training/prescription-resolver';
import type { SourceMode } from '@/lib/training/capacity-resolver';
import { achievableRaceTarget } from '@/lib/training/achievable-target';

/** A coherent six-anchor set at a given threshold pace, s/mi. Mirrors the
 *  ordering `composePaceAnchors`'s coherence gate requires (interval <
 *  threshold < marathon < easy < shakeout) without depending on that gate —
 *  this file tests what happens AFTER a coherent set is handed to
 *  `buildWorkoutSpec`, not whether the set itself is coherent. */
function fakeAnchors(thresholdSecPerMi: number, opts?: { sourceMode?: SourceMode; vdot?: number | null }): PrescribedPaceAnchors {
  const sourceMode = opts?.sourceMode ?? 'direct';
  const basisEntry = { sourceMode, confidence: 0.7 };
  return {
    thresholdSecPerMi,
    intervalSecPerMi: thresholdSecPerMi - 18,
    repetitionSecPerMi: thresholdSecPerMi - 35,
    easyCeilingSecPerMi: thresholdSecPerMi + 80,
    shakeoutCeilingSecPerMi: thresholdSecPerMi + 120,
    marathonSecPerMi: thresholdSecPerMi + 20,
    basis: {
      threshold: { ...basisEntry, vdot: opts?.vdot ?? null },
      highIntensity: basisEntry,
      easyCeiling: basisEntry,
      marathon: { ...basisEntry, enduranceExponent: 1.06, personallyEvidenced: true },
    },
  };
}

const baseLegacy = {
  lthr: 162,
  maxHr: 180,
  goalPaceSec: null as number | null,
  easyAnchorTSec: 470,
  belowTableAnchor: null,
  prescribedRacePaceSec: null as number | null,
};

/**
 * AUTHORING-CANONICAL-1 (2026-09-01) · these tests now drive the REAL
 * authoring builder.
 *
 * They were written against `canonicalSpecForComposedDay`, a shadow twin that
 * existed because `specForComposedDay` could not yet take anchors. It can, and
 * every authoring caller now passes them, so the twin is deleted and this
 * shim keeps the tests' shape while pointing them at the function that ships.
 * A test of a twin proves things about the twin.
 */
function canonicalSpecForComposedDay(
  d: DayPlan,
  anchors: PrescribedPaceAnchors,
  legacy: typeof baseLegacy,
  totalWeeks: number,
  goalSec: number | null,
  raceDistanceMi: number,
) {
  const prescribedRacePaceSec = achievableRaceTarget({
    goalSec, currentVdot: anchors.basis.threshold.vdot, raceDistanceMi, totalWeeks,
  })?.paceSPerMi ?? null;
  return specForComposedDay(d, anchors.thresholdSecPerMi, {
    lthr: legacy.lthr,
    maxHr: legacy.maxHr,
    goalPaceSec: legacy.goalPaceSec,
    easyAnchorTSec: anchors.easyCeilingSecPerMi,
    belowTableAnchor: legacy.belowTableAnchor,
    prescribedRacePaceSec,
    anchors,
  });
}

function day(overrides: Partial<DayPlan>): DayPlan {
  return {
    dow: 2,
    type: 'threshold',
    distanceMi: 6,
    isQuality: true,
    isLong: false,
    subLabel: '2×1mi @ T pace · 60s jog',
    notes: '',
    ...overrides,
  } as DayPlan;
}

describe('canonicalSpecForComposedDay · continuity (Rule 9)', () => {
  it('a 1s/mi step in the threshold anchor never produces a >1s/mi jump in the day\'s headline pace for a tempo/threshold day', () => {
    // FALSIFIED: with `anchors` stripped out of the call (reverting to the
    // pre-wiring null-anchors call `buildWorkoutSpec` used everywhere before
    // PRESCRIPTION-WIRE-1), the headline pace is driven by `tPaceSec` alone
    // and this same walk still holds — the point of this test is that the
    // ANCHOR-DRIVEN branch inherits the same property, not that it is the
    // first branch to have it. Genuinely falsifiable failure mode: a step
    // function inside `buildWorkoutSpec`'s parsed-prescription clamp that
    // only fires when `anchors` is non-null (untested before this pass,
    // since no authoring caller ever passed one).
    const d = day({ type: 'threshold' });
    let prevPace: number | null = null;
    for (let t = 380; t <= 480; t += 1) {
      const anchors = fakeAnchors(t);
      const built = canonicalSpecForComposedDay(d, anchors, baseLegacy, 14, null, 26.2);
      if (built.paceTargetSPerMi != null && prevPace != null) {
        expect(Math.abs(built.paceTargetSPerMi - prevPace)).toBeLessThanOrEqual(1);
      }
      prevPace = built.paceTargetSPerMi;
    }
  });

  it('a 1s/mi step in the threshold anchor never produces a >1mi jump in warm-up or cool-down distance for a long run', () => {
    const d = day({ type: 'long', distanceMi: 16, subLabel: 'LONG', isQuality: false, isLong: true });
    let prevWu: number | null = null;
    let prevCd: number | null = null;
    for (let t = 380; t <= 480; t += 1) {
      const anchors = fakeAnchors(t);
      const built = canonicalSpecForComposedDay(d, anchors, baseLegacy, 14, null, 26.2);
      const spec = built.spec as Record<string, unknown> | null;
      const wu = typeof spec?.warmup_mi === 'number' ? spec.warmup_mi : null;
      const cd = typeof spec?.cooldown_mi === 'number' ? spec.cooldown_mi : null;
      if (wu != null && prevWu != null) expect(Math.abs(wu - prevWu)).toBeLessThanOrEqual(1);
      if (cd != null && prevCd != null) expect(Math.abs(cd - prevCd)).toBeLessThanOrEqual(1);
      prevWu = wu; prevCd = cd;
    }
  });

  it('an intervals day\'s rep_count never flips more than once across a smooth pace walk (no oscillation)', () => {
    const d = day({ type: 'intervals', distanceMi: 7, subLabel: '5×1000m @ I pace · 2 min jog' });
    const repCounts: number[] = [];
    for (let t = 380; t <= 480; t += 2) {
      const anchors = fakeAnchors(t);
      const built = canonicalSpecForComposedDay(d, anchors, baseLegacy, 14, null, 26.2);
      const spec = built.spec as Record<string, unknown> | null;
      if (typeof spec?.rep_count === 'number') repCounts.push(spec.rep_count);
    }
    // Count sign changes in the first difference — a coherent clamp against a
    // monotonically increasing pace should change rep_count at most a
    // handful of times, never oscillate back and forth.
    let flips = 0;
    for (let i = 2; i < repCounts.length; i++) {
      const d1 = repCounts[i - 1] - repCounts[i - 2];
      const d2 = repCounts[i] - repCounts[i - 1];
      if (d1 !== 0 && d2 !== 0 && Math.sign(d1) !== Math.sign(d2)) flips++;
    }
    expect(flips).toBe(0);
  });
});

describe('canonicalSpecForComposedDay · monotonicity', () => {
  it('a slower (larger) threshold anchor never produces a FASTER (smaller) headline pace on a threshold/tempo day', () => {
    const d = day({ type: 'tempo', distanceMi: 8, subLabel: '4mi continuous tempo' });
    let prevPace = -Infinity;
    for (let t = 360; t <= 520; t += 4) {
      const anchors = fakeAnchors(t);
      const built = canonicalSpecForComposedDay(d, anchors, baseLegacy, 14, null, 26.2);
      if (built.paceTargetSPerMi != null) {
        expect(built.paceTargetSPerMi).toBeGreaterThanOrEqual(prevPace);
        prevPace = built.paceTargetSPerMi;
      }
    }
  });

  it('a slower easy ceiling never produces a faster easy-day pace band', () => {
    const d = day({ type: 'easy', distanceMi: 6, subLabel: 'EASY', isQuality: false });
    let prevLo = -Infinity;
    for (let t = 360; t <= 520; t += 4) {
      const anchors = fakeAnchors(t);
      const built = canonicalSpecForComposedDay(d, anchors, baseLegacy, 14, null, 26.2);
      const spec = built.spec as Record<string, unknown> | null;
      const lo = typeof spec?.pace_target_s_per_mi_lo === 'number' ? spec.pace_target_s_per_mi_lo : null;
      if (lo != null) {
        expect(lo).toBeGreaterThanOrEqual(prevLo);
        prevLo = lo;
      }
    }
  });
});

describe('canonicalSpecForComposedDay · goal isolation', () => {
  // capacity-resolver.ts / prescription-resolver.ts already enforce goal
  // isolation at compile time (section 0 of capacity-resolver.ts). What THIS
  // test proves is narrower: that the NEW WIRING in this file does not
  // reintroduce a goal-dependency between the anchors and the
  // capacity-derived fields once they reach `buildWorkoutSpec` — i.e. that
  // handing the same anchors to two callers with wildly different goals
  // produces identical threshold/interval/easy pacing, and the goal only
  // ever touches the race-specific fields it is legitimately allowed to
  // (`raceGoalPaceSec` / `prescribedRacePaceSPerMi`), never a quality day's
  // headline pace.
  const anchors = fakeAnchors(430, { vdot: 47.9 });

  it('a threshold day prices identically for a 3:00 marathon goal, a 5:00 marathon goal, and no goal at all', () => {
    const d = day({ type: 'threshold' });
    const noGoal = canonicalSpecForComposedDay(d, anchors, baseLegacy, 14, null, 26.2);
    const ambitious = canonicalSpecForComposedDay(d, anchors, baseLegacy, 14, 3 * 3600, 26.2);
    const modest = canonicalSpecForComposedDay(d, anchors, baseLegacy, 14, 5 * 3600, 26.2);
    expect(ambitious.paceTargetSPerMi).toBe(noGoal.paceTargetSPerMi);
    expect(modest.paceTargetSPerMi).toBe(noGoal.paceTargetSPerMi);
  });

  it('an easy day\'s pace band prices identically regardless of goal', () => {
    const d = day({ type: 'easy', distanceMi: 6, isQuality: false, subLabel: 'EASY' });
    const noGoal = canonicalSpecForComposedDay(d, anchors, baseLegacy, 14, null, 26.2);
    const ambitious = canonicalSpecForComposedDay(d, anchors, baseLegacy, 14, 3 * 3600, 26.2);
    const s1 = noGoal.spec as Record<string, unknown> | null;
    const s2 = ambitious.spec as Record<string, unknown> | null;
    expect(s2?.pace_target_s_per_mi_lo).toBe(s1?.pace_target_s_per_mi_lo);
    expect(s2?.pace_target_s_per_mi_hi).toBe(s1?.pace_target_s_per_mi_hi);
  });

  it('a race day IS allowed to move with the goal — proving the isolation above is real and not just "nothing ever changes"', () => {
    const d = day({ type: 'race', distanceMi: 26.2, subLabel: 'RACE' });
    const noGoal = canonicalSpecForComposedDay(d, anchors, { ...baseLegacy, goalPaceSec: null }, 14, null, 26.2);
    const withGoal = canonicalSpecForComposedDay(d, anchors, { ...baseLegacy, goalPaceSec: 420 }, 14, 420 * 26.2, 26.2);
    expect(withGoal.paceTargetSPerMi).not.toBe(noGoal.paceTargetSPerMi);
  });
});

describe('canonicalSpecForComposedDay · extreme inputs', () => {
  it('an elite-fast threshold anchor (sub-5:00/mi) does not crash and keeps warm-up/cool-down within a sane band', () => {
    const anchors = fakeAnchors(280); // 4:40/mi T-pace — sub-elite/elite territory
    const d = day({ type: 'long', distanceMi: 20, subLabel: 'LONG', isQuality: false, isLong: true });
    const built = canonicalSpecForComposedDay(d, anchors, baseLegacy, 14, null, 26.2);
    const spec = built.spec as Record<string, unknown> | null;
    expect(spec).not.toBeNull();
    const wu = spec?.warmup_mi;
    if (typeof wu === 'number') { expect(wu).toBeGreaterThanOrEqual(0); expect(wu).toBeLessThan(10); }
  });

  it('a below-table-slow threshold anchor (>13:00/mi) does not crash and does not produce a negative or non-finite pace anywhere', () => {
    const anchors = fakeAnchors(800, { sourceMode: 'inferred', vdot: null }); // 13:20/mi — below the Daniels table
    for (const type of ['easy', 'long', 'threshold', 'tempo', 'intervals'] as const) {
      const d = day({ type, distanceMi: 6 });
      const built = canonicalSpecForComposedDay(d, anchors, baseLegacy, 14, null, 26.2);
      if (built.paceTargetSPerMi != null) {
        expect(Number.isFinite(built.paceTargetSPerMi)).toBe(true);
        expect(built.paceTargetSPerMi).toBeGreaterThan(0);
      }
      const spec = built.spec as Record<string, unknown> | null;
      for (const key of ['pace_target_s_per_mi_lo', 'pace_target_s_per_mi_hi', 'rep_pace_s_per_mi'] as const) {
        const v = spec?.[key];
        if (typeof v === 'number') expect(v).toBeGreaterThan(0);
      }
    }
  });

  it('a null repetitionSecPerMi (Rule 11\'s below-table branch) does not crash a rep-pace day', () => {
    const anchors = fakeAnchors(800, { sourceMode: 'inferred', vdot: null });
    anchors.repetitionSecPerMi = null;
    const d = day({ type: 'intervals', distanceMi: 5, subLabel: '6×400m @ R pace · 3 min jog' });
    expect(() => canonicalSpecForComposedDay(d, anchors, baseLegacy, 14, null, 26.2)).not.toThrow();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE ARCHETYPE CORPUS · canonical vs legacy, with no database
 *
 * RULE 15, as the audit applied it to this migration: the DB-backed compare
 * reads four accounts, three of them cold-start QA seeds, and
 * `_sweep_allusers`' 11,598 archetypes could not reach the canonical pricing
 * layer at all because `resolvePrescribedPaceAnchors` needs a `users` row. A
 * corpus that cannot reach the mechanism is not evidence about it.
 *
 * `syntheticPaceAnchors` runs the IDENTICAL pure capacity cores on an
 * archetype's own evidence fields, so the corpus reaches the layer now. This
 * block walks a deterministic slice of the real matrix and reports, per
 * archetype, every dimension the audit's §8 asked for: pace zones, phases,
 * day types (long runs included), band edges, WU/CD, HR guidance, the race
 * row, week volumes and structure, total priced miles, and both the MAX and
 * the volume-weighted mean |Δ|.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ──────────────────────────────────────
 *
 *   · A synthetic runner has no pace corpus and no durability evidence, so
 *     every archetype is priced off a FALLBACK rung and off the POPULATION
 *     endurance exponent. The runner's own fitted exponent is the single
 *     largest divergence on a real account, so this corpus UNDERSTATES the
 *     marathon axis by construction and cannot exercise the direct rungs.
 *   · It walks a SLICE, not all 11,598, because each archetype composes a
 *     full block twice. The slice is deterministic (every Nth arc) so a
 *     regression cannot hide behind a reshuffle.
 *   · It reports. The only assertions are the ones that would be defects on
 *     EITHER side: HR guidance must not move, and no day may be priced on one
 *     leg and not the other.
 * ═══════════════════════════════════════════════════════════════════════ */
describe('ARCHETYPE CORPUS · canonical authoring vs the legacy cascade', () => {
  it('reports the full canonical-vs-legacy diff across a deterministic slice of the sweep matrix', async () => {
    const { matrix, simInputsForArc, arcStr } = await import('./sim-matrix');
    const { buildSimPlan } = await import('./sim-inputs');
    const { compareArchetype, aggregate } = await import('./authoring-shadow-compare');

    const all = [...matrix()];
    // Every 97th arc — coprime with every dimension size in the matrix, so the
    // slice spans distances, levels, volumes and block lengths rather than
    // sampling one corner of the cross-product.
    const STRIDE = 97;
    const arcs = all.filter((_, i) => i % STRIDE === 0);

    const mmss = (s: number | null | undefined) => (s == null || !Number.isFinite(s) ? '  -  '
      : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
    const d3 = (s: number | null | undefined) => (s == null || !Number.isFinite(s) ? '   - '
      : `${s > 0 ? '+' : (s < 0 ? '-' : ' ')}${String(Math.abs(Math.round(s))).padStart(3)}`);

    let compared = 0;
    let skipped = 0;
    let structuralTotal = 0;
    let hrDivergentArcs = 0;
    let asymmetric = 0;
    const rows: string[] = [];
    const typeRoll = new Map<string, { days: number; mi: number; sumAbs: number }>();
    let worstArc = { label: '', maxAbs: 0, cause: '' };

    for (const a of arcs) {
      const sim = buildSimPlan(simInputsForArc(a));
      if (!sim.ok || !sim.composeInput) { skipped++; continue; }
      const cmp = compareArchetype(sim.composeInput, sim.derived.distanceCategory);
      if (!cmp.ok || !cmp.anchorRead.ok) { skipped++; continue; }
      compared++;
      const agg = aggregate(cmp.days);
      structuralTotal += cmp.structural.length;
      if (agg.hrDivergences > 0) hrDivergentArcs++;
      asymmetric += cmp.days.filter((d) =>
        (d.legacy.paceTargetSPerMi != null) !== (d.canonical.paceTargetSPerMi != null)).length;

      for (const t of agg.byType) {
        const cur = typeRoll.get(t.type) ?? { days: 0, mi: 0, sumAbs: 0 };
        cur.days += t.days;
        cur.mi += t.mi;
        cur.sumAbs += t.sumAbsSMi;
        typeRoll.set(t.type, cur);
      }
      if (agg.maxAbsDeltaSPerMi > worstArc.maxAbs) {
        worstArc = {
          label: arcStr(a),
          maxAbs: agg.maxAbsDeltaSPerMi,
          cause: agg.maxAbsDeltaDays.map((d) => `${d.type} "${d.subLabel ?? ''}"`).slice(0, 2).join(' · '),
        };
      }

      const anc = cmp.anchorRead.anchors;
      const totalLegacyMi = cmp.legacyWeeks.reduce((s, w) => s + w.weeklyMi, 0);
      const totalCanonMi = cmp.canonicalWeeks.reduce((s, w) => s + w.weeklyMi, 0);
      rows.push(
        `${arcStr(a).padEnd(46)} T ${mmss(cmp.legacy.thresholdSecPerMi)}→${mmss(anc.thresholdSecPerMi)} `
        + `I ${mmss(cmp.legacy.intervalSecPerMi)}→${mmss(anc.intervalSecPerMi)} `
        + `MP ${mmss(cmp.legacy.marathonSecPerMi)}→${mmss(anc.marathonSecPerMi)}${cmp.legacy.marathonAtGoalPace ? '(goal)' : ''} `
        + `| ${String(agg.pricedDays).padStart(3)}d ${agg.pricedMi.toFixed(0).padStart(4)}mi `
        + `mean|Δ|${d3(agg.meanAbsDeltaSPerMi)} volWt${d3(agg.volumeWeightedMeanAbsSPerMi)} MAX${d3(agg.maxAbsDeltaSPerMi)} `
        + `| vol ${totalLegacyMi.toFixed(0)}→${totalCanonMi.toFixed(0)}mi struct ${cmp.structural.length} hr ${agg.hrDivergences} dist ${agg.totalMiDivergences}`,
      );
    }

    console.log(`\n══ ARCHETYPE CORPUS · ${compared} archetypes compared (${skipped} skipped, stride ${STRIDE} of ${all.length}) ══`);
    for (const r of rows) console.log('  ' + r);

    console.log('\nROLLED UP BY DAY TYPE (the long runs carried 93% of the divergence on the owner\'s block — they cannot be omitted here):');
    const rolled = [...typeRoll.entries()].sort((a, b) => b[1].sumAbs - a[1].sumAbs);
    for (const [type, v] of rolled) {
      console.log(
        `  ${type.padEnd(18)} ${String(v.days).padStart(5)} days ${v.mi.toFixed(0).padStart(7)} mi `
        + `· Σ|Δ|×mi ${v.sumAbs.toFixed(0).padStart(8)} s·mi · vol-weighted mean |Δ| ${v.mi > 0 ? (v.sumAbs / v.mi).toFixed(1) : '-'} s/mi`,
      );
    }
    console.log(`\nWORST SINGLE ARCHETYPE: ${worstArc.label || '(none)'} · MAX |Δ| ${worstArc.maxAbs.toFixed(0)} s/mi · ${worstArc.cause}`);
    console.log(`STRUCTURAL DIFFS across the slice: ${structuralTotal}`);
    console.log(`ARCHETYPES WITH ANY hr_cap_bpm DIVERGENCE: ${hrDivergentArcs}`);
    console.log(`ASYMMETRIC-NULL DAYS (priced on one leg only): ${asymmetric}`);

    // ── LIVENESS · a sweep that compared nothing must not report clean ───────
    expect(compared, 'the archetype slice compared nothing — the corpus is not reaching the pricing layer').toBeGreaterThan(20);
    // ── DEFECTS ON EITHER SIDE ──────────────────────────────────────────────
    expect(hrDivergentArcs, 'hr_cap_bpm moved on some archetype · it is a function of lthr/maxHr only').toBe(0);
    expect(asymmetric, 'some day is priced on one leg and not the other (Rule 11)').toBe(0);
  }, 180_000);
});
