/**
 * HEAT-1 · heat handling must match Research/06-weather-adjustments.md.
 *
 * Four defects this locks out, all of them in the direction of telling a
 * runner heat is safer or better-tolerated than it is:
 *
 *   1. HEAT_THRESHOLD_F = 75 applied to AIR temperature. :172 is
 *      "Heat dose: Tair >=85°F or WBGT >=75°F" — the WBGT number was
 *      read into the Tair slot, so an ordinary 75°F morning counted as
 *      acclimation stimulus.
 *   2. The HealthView card mapped RISING resting HR to "Adapting".
 *      :158-163 says the signature is HR at a given WORKLOAD falling,
 *      -5 to -15 bpm. The card could call a runner heat-adapted before
 *      a hot race on the strength of a resting HR going the wrong way.
 *   3. MAX_PENALTY_BPM_AT_PEAK = 8, citing a research file that gives
 *      -5 to -15, decayed by an `exp(-N/7)` curve that is nowhere in it,
 *      credited to Friel with numbers (:9 "50% by day 5, 90%+ by day
 *      10") that belong to neither Friel nor the table. :156 attributes
 *      the timeline to Périard 2021; :161-163 give ~50% at days 4-7 and
 *      ~70-80% at days 8-10.
 *   4. No safety gate at all. :481-499 has a time-on-feet conversion
 *      table and a hard bail table; extreme conditions produced a
 *      sentence about hydration and nothing else.
 */
import { describe, it, expect } from 'vitest';
import {
  wbgtApproxF,
  flagForWbgt,
  evaluateHeatGate,
  isHeatDoseDay,
  HEAT_DOSE_TAIR_F,
  HEAT_DOSE_WBGT_F,
  WBGT_TIME_ON_FEET_F,
  TD_TIME_ON_FEET_F,
  WBGT_BAIL_F,
  TD_BAIL_F,
  AQI_BAIL,
} from './heat-gate';
import {
  ACCLIMATION_TIMELINE,
  FULL_ACCLIM_DAYS,
  MAX_PENALTY_BPM_AT_PEAK,
  acclimationStage,
  expectedHeatPenaltyBpm,
} from './heat-acclimatization';

describe('HEAT-1 · doctrine conformance · Research/06 §§3, 4, 11', () => {
  // ── 1 · the dose threshold ─────────────────────────────────────────
  describe('heat dose is Tair >=85°F or WBGT >=75°F (:172)', () => {
    it('the two constants are the two research numbers, in the right slots', () => {
      expect(HEAT_DOSE_TAIR_F, 'Research/06:172 · "Tair >=85°F"').toBe(85);
      expect(HEAT_DOSE_WBGT_F, 'Research/06:172 · "or WBGT >=75°F"').toBe(75);
      expect(HEAT_DOSE_TAIR_F).not.toBe(HEAT_DOSE_WBGT_F);
    });

    it('the shipped defect · a 75°F day is not acclimation stimulus', () => {
      // 75°F, 60% RH, clear. WBGT ~= 75 - 8 + 5 = 72. Neither trigger.
      expect(
        isHeatDoseDay(75, 60, 0),
        'Research/06:172 · the old HEAT_THRESHOLD_F=75 fired on Tair here and called it a heat block',
      ).toBe(false);
      expect(isHeatDoseDay(78, 45, 50)).toBe(false);
    });

    it('85°F air is stimulus regardless of humidity', () => {
      expect(isHeatDoseDay(85, 10, 100)).toBe(true);
      expect(isHeatDoseDay(92, null, null)).toBe(true);
    });

    it('a humid sub-85 day still qualifies through the WBGT arm', () => {
      // 78°F at 90% RH in full sun: 78 - 2 + 5 = 81 >= 75.
      expect(wbgtApproxF(78, 90, 0)).toBeCloseTo(81, 5);
      expect(isHeatDoseDay(78, 90, 0)).toBe(true);
    });

    it('no humidity → no WBGT, so only the Tair arm can fire', () => {
      expect(wbgtApproxF(80, null, 0)).toBeNull();
      expect(isHeatDoseDay(80, null, null)).toBe(false);
    });
  });

  // ── WBGT approximation ─────────────────────────────────────────────
  describe('WBGT approximation is the research formula (:135-137)', () => {
    it('Tair - ((100 - RH) / 5) + solar_correction', () => {
      // solar: full_sun +5, partial +2, overcast 0.
      expect(wbgtApproxF(80, 50, 0)).toBeCloseTo(80 - 10 + 5, 5);
      expect(wbgtApproxF(80, 50, 50)).toBeCloseTo(80 - 10 + 2, 5);
      expect(wbgtApproxF(80, 50, 100)).toBeCloseTo(80 - 10 + 0, 5);
    });

    it('unknown cloud cover takes full sun · the conservative direction', () => {
      expect(wbgtApproxF(80, 50, null)).toBe(wbgtApproxF(80, 50, 0));
    });
  });

  // ── 4 · the flag table and the gate ────────────────────────────────
  describe('WBGT flag table (:141-148)', () => {
    const bands: Array<[number, string, string]> = [
      [45, 'white',  'normal'],
      [60, 'green',  'normal'],
      [68, 'yellow', 'reduce_hard_volume'],
      [78, 'red',    'reduce_intensity'],
      [85, 'black',  'easy_time_on_feet'],
      [90, 'black',  'cancel'],
    ];
    for (const [wbgt, flag, action] of bands) {
      it(`WBGT ${wbgt}°F → ${flag} / ${action}`, () => {
        const got = flagForWbgt(wbgt);
        expect([got.flag, got.action], `Research/06:141-148 band for WBGT ${wbgt}°F`).toEqual([flag, action]);
      });
    }

    it('band edges land on the research boundaries', () => {
      expect(flagForWbgt(64).flag).toBe('green');
      expect(flagForWbgt(65).flag).toBe('yellow');
      expect(flagForWbgt(72).flag).toBe('yellow');
      expect(flagForWbgt(73).flag).toBe('red');
      expect(flagForWbgt(82).flag).toBe('red');
      expect(flagForWbgt(83).flag).toBe('black');
    });
  });

  describe('time-on-feet conversion (:481-487)', () => {
    it('WBGT >=80°F converts all hard sessions to easy time on feet (:484)', () => {
      expect(WBGT_TIME_ON_FEET_F).toBe(80);
      // 90°F, 60% RH, overcast → WBGT 82 (red band by the flag table),
      // but the :484 row is its own trigger and outranks it.
      const v = evaluateHeatGate({ tairF: 90, humidityPct: 60, cloudCoverPct: 100 });
      expect(v.wbgtF).toBeCloseTo(82, 1);
      expect(v.action, 'Research/06:484 · WBGT >=80°F · convert to easy time-on-feet').toBe('easy_time_on_feet');
      expect(v.citation).toContain('WBGT >=80°F');
    });

    it('dew point >=70°F makes quality time-based and RPE-driven (:483)', () => {
      expect(TD_TIME_ON_FEET_F).toBe(70);
      // WBGT 68 on its own is only yellow; the dewpoint row escalates it.
      const v = evaluateHeatGate({ tairF: 80, humidityPct: 40, cloudCoverPct: 100, dewpointF: 72 });
      expect(v.wbgtF).toBeCloseTo(68, 1);
      expect(v.action, 'Research/06:483 · Td >=70°F').toBe('reduce_intensity');
    });
  });

  describe('hard bail triggers (:489-499)', () => {
    it('WBGT >86°F is the ACSM black flag and cancels (:493)', () => {
      expect(WBGT_BAIL_F).toBe(86);
      const v = evaluateHeatGate({ tairF: 95, humidityPct: 70, cloudCoverPct: 0 });
      expect(v.wbgtF).toBeGreaterThan(86);
      expect(v.action, 'Research/06:493 · WBGT >86°F · ACSM black flag').toBe('cancel');
      expect(v.flag).toBe('black');
    });

    it('dew point >=80°F cancels on its own · evaporative cooling fails (:494)', () => {
      expect(TD_BAIL_F).toBe(80);
      // WBGT here is only 72, a yellow flag. The dewpoint row still bails.
      const v = evaluateHeatGate({ tairF: 82, humidityPct: 50, cloudCoverPct: 100, dewpointF: 80 });
      expect(v.wbgtF).toBeCloseTo(72, 1);
      expect(v.action, 'Research/06:494 · Td >=80°F · evaporative cooling fails').toBe('cancel');
      expect(v.citation).toContain('Td >=80°F');
    });

    it('AQI >200 cancels, 151-200 is easy time on feet (:487, :496)', () => {
      expect(AQI_BAIL).toBe(200);
      expect(evaluateHeatGate({ tairF: 55, humidityPct: 50, cloudCoverPct: 100, aqi: 220 }).action).toBe('cancel');
      expect(evaluateHeatGate({ tairF: 55, humidityPct: 50, cloudCoverPct: 100, aqi: 175 }).action).toBe('easy_time_on_feet');
      expect(evaluateHeatGate({ tairF: 55, humidityPct: 50, cloudCoverPct: 100, aqi: 40 }).action).toBe('normal');
    });

    it('a cool clear day changes nothing, and never proposes', () => {
      const v = evaluateHeatGate({ tairF: 52, humidityPct: 60, cloudCoverPct: 50 });
      expect(v.action).toBe('normal');
      expect(v.fires).toBe(false);
      expect(v.proposeFirst).toBe(false);
    });

    it('every firing verdict is propose-first · the runner gates the change', () => {
      // Locked no-reactive-coach rule · same contract as
      // readiness_pullback in lib/plan/adapt.ts PROPOSE_FIRST_TRIGGERS.
      for (const input of [
        { tairF: 88, humidityPct: 70, cloudCoverPct: 0 },
        { tairF: 80, humidityPct: 70, cloudCoverPct: 50 },
        { tairF: 96, humidityPct: 80, cloudCoverPct: 0 },
      ]) {
        const v = evaluateHeatGate(input);
        expect(v.fires).toBe(true);
        expect(v.proposeFirst).toBe(true);
        expect(v.citation).toMatch(/Research\/06 §/);
      }
    });

    it('missing temperature produces no verdict rather than a guess', () => {
      const v = evaluateHeatGate({ tairF: null });
      expect(v.action).toBe('normal');
      expect(v.fires).toBe(false);
      expect(v.flag).toBe('unknown');
    });
  });

  // ── 2 + 3 · the acclimation timeline ───────────────────────────────
  describe('acclimation timeline is the Périard table (:156-163)', () => {
    it('HR at workload falls -5 → -10 → -10/-15 → -15 across days 1-14', () => {
      const expected: Array<[number, [number, number]]> = [
        [3, [5, 5]], [7, [10, 10]], [10, [10, 15]], [14, [15, 15]],
      ];
      expected.forEach(([throughDay, band], i) => {
        expect(
          [ACCLIMATION_TIMELINE[i].throughDay, ACCLIMATION_TIMELINE[i].hrReductionBpm],
          `Research/06:158-163 row through day ${throughDay} · "HR @ workload" column`,
        ).toEqual([throughDay, band]);
      });
    });

    it('performance gains are ~50% at days 4-7 and ~70-80% at days 8-10 (:161-162)', () => {
      expect(acclimationStage(5).gainsPct, 'Research/06:161 · "~50% gains realized"').toEqual([50, 50]);
      expect(acclimationStage(9).gainsPct, 'Research/06:162 · "~70-80% gains"').toEqual([70, 80]);
      expect(acclimationStage(13).gainsPct, 'Research/06:163 · "Full acclimation"').toEqual([100, 100]);
      // The shipped header claimed "50% by day 5, 90%+ by day 10",
      // credited to Friel. Neither number is in the table.
      expect(acclimationStage(10).gainsPct[1]).toBeLessThan(90);
    });

    it('full acclimation is 14 days, not 10 (:163, :169)', () => {
      expect(FULL_ACCLIM_DAYS).toBe(14);
      expect(ACCLIMATION_TIMELINE[ACCLIMATION_TIMELINE.length - 1].throughDay).toBe(FULL_ACCLIM_DAYS);
    });

    it('the peak HR penalty is the research figure, not 8 bpm (:158-163)', () => {
      expect(MAX_PENALTY_BPM_AT_PEAK, 'Research/06:158-163 gives -5 to -15 bpm; the code carried 8').toBe(15);
    });

    it('the residual penalty walks the table down and reaches zero at full acclimation', () => {
      expect(expectedHeatPenaltyBpm(1)).toBe(10);   // 15 - 5
      expect(expectedHeatPenaltyBpm(5)).toBe(5);    // 15 - 10
      expect(expectedHeatPenaltyBpm(9)).toBe(2.5);  // 15 - 12.5
      expect(expectedHeatPenaltyBpm(14)).toBe(0);   // 15 - 15
      for (let d = 2; d <= FULL_ACCLIM_DAYS; d++) {
        expect(expectedHeatPenaltyBpm(d)).toBeLessThanOrEqual(expectedHeatPenaltyBpm(d - 1));
      }
    });

    it('pacing during acclimation matches :179-185', () => {
      expect(acclimationStage(2).pacingAdjustPct).toEqual([10, 15]);
      expect(acclimationStage(6).pacingAdjustPct).toEqual([5, 10]);
      expect(acclimationStage(9).pacingAdjustPct).toEqual([3, 5]);
      expect(acclimationStage(13).pacingAdjustPct).toEqual([0, 0]);
    });
  });
});
