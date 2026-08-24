/**
 * DOCTRINE-MIDBLOCK-1 · the quality-detection window skips the days doctrine
 * itself mandated be empty of quality.
 *
 * The defect, in the owner's own data: `detectMidBlock` counted prescribed and
 * executed quality over a flat 28 days and read the answer as evidence about
 * the RUNNER. `Research/00b-recovery-protocols.md` §"Recovery by Distance"
 * mandates 10-14 no-quality days after a half and 21-28 after a marathon, and
 * the engine spends that window authoring a phase whose rationale literally
 * reads "Easy running only · no quality". So the detector was reading its own
 * prescription back as detraining, and could not tell "has not been doing
 * quality" from "was told not to do quality".
 *
 * Every assertion below FAILS if `qualityLookbackDays` returns a flat 28.
 *
 * The second suite locks the OTHER half of this investigation: a marathon
 * TAPER's quality is real and is prescribed OUTSIDE `qualityFamilyFor`, which
 * is why that function returning null for TAPER is correct and must not be
 * "fixed" by a future reader who probes it in isolation.
 */
import { describe, it, expect } from 'vitest';
import {
  sizeBlocks,
  QUALITY_LOOKBACK_DAYS,
  qualityLookbackDays,
  qualityFamilyFor,
  taperMpDose,
  TAPER_MP_DOSE,
} from './generate';
import { postRaceRecoveryWeeks } from './goal-tiers';

const RACE = '2026-08-16';                 // Americas Finest City half · A race
const HALF_MI = 13.1;
const MARATHON_MI = 26.2;
const dayAfter = (n: number) =>
  new Date(Date.parse(RACE + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

describe('DOCTRINE-MIDBLOCK-1 · the window skips doctrine-mandated no-quality days', () => {
  it('the owner\'s CIM authoring · 2026-08-31, 15 days after an A-priority half', () => {
    // 2 weeks of mandated no-quality (Research/00b: half = 10-14 days), 14 of
    // which fall inside the base window.
    expect(postRaceRecoveryWeeks('hm', 'A')).toBe(2);
    expect(qualityLookbackDays('2026-08-31', { date: RACE, distanceMi: HALF_MI, priority: 'A' }))
      .toBe(QUALITY_LOOKBACK_DAYS + 14);
  });

  it('inside the mandated window the detector always sees training from BEFORE the race', () => {
    // THE property. On a flat 28-day window this fails for every marathon
    // authoring at 28 days out — the single worst case, because that is
    // exactly when a post-marathon block is authored.
    for (const [mi, cat] of [[HALF_MI, 'hm'], [MARATHON_MI, 'm']] as const) {
      const mandated = postRaceRecoveryWeeks(cat, 'A') * 7;
      for (let d = 1; d <= mandated; d++) {
        const look = qualityLookbackDays(dayAfter(d), { date: RACE, distanceMi: mi, priority: 'A' });
        expect(look, `${cat} · ${d}d after the race`).toBeGreaterThan(d);
      }
    }
  });

  it('a marathon at 28 days out · the case a flat window cannot see past at all', () => {
    const look = qualityLookbackDays(dayAfter(28), { date: RACE, distanceMi: MARATHON_MI, priority: 'A' });
    expect(postRaceRecoveryWeeks('m', 'A') * 7).toBe(28);
    expect(look).toBe(QUALITY_LOOKBACK_DAYS + 28);   // flat-28 would give 28
    expect(look).toBeGreaterThan(28);
  });

  it('the allowance is self-limiting · it buys a window, not a longer memory', () => {
    const far = qualityLookbackDays(
      dayAfter(28 + QUALITY_LOOKBACK_DAYS + 1),
      { date: RACE, distanceMi: MARATHON_MI, priority: 'A' },
    );
    expect(far).toBe(QUALITY_LOOKBACK_DAYS);
  });

  it('a lower-priority race earns a shorter allowance, per RECOVERY.effort-scale', () => {
    const a = qualityLookbackDays(dayAfter(10), { date: RACE, distanceMi: MARATHON_MI, priority: 'A' });
    const c = qualityLookbackDays(dayAfter(10), { date: RACE, distanceMi: MARATHON_MI, priority: 'C' });
    expect(a).toBeGreaterThanOrEqual(c);
  });

  it('no race, an unrun race, or an unresolvable distance changes nothing', () => {
    expect(qualityLookbackDays(dayAfter(10), null)).toBe(QUALITY_LOOKBACK_DAYS);
    expect(qualityLookbackDays(dayAfter(-3), { date: RACE, distanceMi: HALF_MI, priority: 'A' }))
      .toBe(QUALITY_LOOKBACK_DAYS);
    expect(qualityLookbackDays(dayAfter(10), { date: RACE, distanceMi: 0, priority: 'A' }))
      .toBe(QUALITY_LOOKBACK_DAYS);
    expect(qualityLookbackDays(dayAfter(10), { date: RACE, distanceMi: NaN, priority: 'A' }))
      .toBe(QUALITY_LOOKBACK_DAYS);
    // A very long race is NOT unresolvable — it is an ultra, and it earns the
    // ultra window. Recorded because the first cut of this test assumed
    // otherwise: `distanceCategoryOrNull` only refuses non-finite or ≤0.
    expect(qualityLookbackDays(dayAfter(10), { date: RACE, distanceMi: 999, priority: 'A' }))
      .toBe(QUALITY_LOOKBACK_DAYS + 10);
  });

  it('never shrinks the window · the allowance is one-directional', () => {
    for (const mi of [3.1, 6.2, HALF_MI, MARATHON_MI, 50]) {
      for (let d = 1; d <= 90; d++) {
        expect(qualityLookbackDays(dayAfter(d), { date: RACE, distanceMi: mi, priority: 'A' }))
          .toBeGreaterThanOrEqual(QUALITY_LOOKBACK_DAYS);
      }
    }
  });

  it('a 5K buys nothing · POST_RACE_RECOVERY_WEEKS has no whole week for it', () => {
    expect(postRaceRecoveryWeeks('5k', 'A')).toBe(0);
    expect(qualityLookbackDays(dayAfter(3), { date: RACE, distanceMi: 3.1, priority: 'A' }))
      .toBe(QUALITY_LOOKBACK_DAYS);
  });

  it('THE CONSEQUENCE · what the flag decides is whether the block opens in BASE', () => {
    // Why the window matters at all. `sizeBlocks` folds BASE into quality when
    // the runner reads as mid-block, so a detector blinded by its own recovery
    // prescription costs the runner the opening weeks of real work.
    const blind = sizeBlocks(14, 26.22, false);
    const seeing = sizeBlocks(14, 26.22, true);
    const baseOf = (b: ReturnType<typeof sizeBlocks>) =>
      b.phases.find((p) => p.label === 'BASE')?.weeks ?? 0;
    expect(baseOf(blind)).toBeGreaterThan(0);
    expect(baseOf(seeing)).toBe(0);
    // Same total length either way — this moves what the weeks CONTAIN.
    const total = (b: ReturnType<typeof sizeBlocks>) =>
      b.phases.reduce((n, p) => n + p.weeks, 0);
    expect(total(seeing)).toBe(total(blind));
  });
});

describe('the marathon TAPER does carry quality · qualityFamilyFor is not where it lives', () => {
  it('qualityFamilyFor returns null for every TAPER slot · and that is CORRECT', () => {
    // Probing this in isolation reads like a defect ("the taper prescribes no
    // quality"). It is not one: a marathon taper week never presents a
    // `threshold` or `intervals` slot at all, and its `tempo` slot is fed by
    // taperMpDose, which the call site reaches by deliberately passing a null
    // family. This test exists so the next reader finds the answer here.
    for (const slot of ['threshold', 'intervals', 'tempo'] as const) {
      expect(qualityFamilyFor('m', 'TAPER', 0, 1, slot)).toBeNull();
    }
  });

  it('the dose that actually lands · Research/08 §9.2 -3 and -2 rows', () => {
    // weeksToPhaseEnd 0 is the race week, which runs its own 5K-pace tune-up.
    expect(taperMpDose(0, 20)).toBeNull();
    // -2 week · "6-8 mi at MP" · midpoint 7.
    expect(taperMpDose(1, 20)).toMatchObject({ mpMi: TAPER_MP_DOSE.primer.mpMi });
    // -3 week · "14-16 mi w/ 10-12 mi at MP" · midpoints 15 / 11.
    expect(taperMpDose(2, 20)).toMatchObject({ mpMi: TAPER_MP_DOSE.final.mpMi });
    // A taper week is never fully easy while it can afford a recognisable dose.
    for (const wte of [1, 2, 3]) {
      const dose = taperMpDose(wte, 20);
      expect(dose, `weeksToPhaseEnd=${wte}`).not.toBeNull();
      expect(dose!.mpMi).toBeGreaterThanOrEqual(3);
    }
  });

  it('a week too small for a recognisable MP dose falls back rather than faking one', () => {
    // Below ~3mi at MP it stops being a marathon-pace rehearsal, and the
    // caller runs the 5K-pace tune-up instead — still quality, not easy.
    expect(taperMpDose(2, 3)).toBeNull();
  });
});
