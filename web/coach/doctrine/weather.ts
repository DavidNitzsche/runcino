/**
 * Doctrine — Weather adjustments (heat, cold, humidity, wind, altitude,
 * air quality, race-day recalibration).
 *
 * Source: Research/06-weather-adjustments.md
 *
 * The canonical weather-impact reference. Replaces the old `heat.ts`
 * doctrine, which only covered heat acclimation. Engine consumers:
 *
 *   - coach.briefRaceMorning   reads MAUGHAN_HEAT_SLOWDOWN +
 *                              TD_PACE_ADJUSTMENT for race-morning
 *                              brief slowdown estimate
 *   - coach.paceStrategy       applies WIND_PER_MILE,
 *                              ALTITUDE_RACE_LOSS, AQI_THRESHOLDS
 *   - coach-engine.ts          BAIL_TRIGGERS for whether quality
 *                              session can proceed
 *   - heat-acclim flag         HEAT_ACCLIMATION_TIMELINE for the
 *                              "hot day, easy first" guidance */
import { cite, type Cited } from '.';

// ── Optimal conditions reference ───────────────────────────────────

export const OPTIMAL_CONDITIONS: Cited<{
  optimalTairF: { men: { low: number; high: number }; women: { low: number; high: number } };
  acceptableTairF: { low: number; high: number };
  optimalDewpointMaxF: number;
  optimalSolar: 'overcast_no_direct_sun';
  optimalWindMphMax: number;
  optimalAltitudeFtMax: number;
}> = {
  value: {
    optimalTairF: { men: { low: 42, high: 46 }, women: { low: 46, high: 50 } },
    acceptableTairF: { low: 35, high: 55 },
    optimalDewpointMaxF: 50,
    optimalSolar: 'overcast_no_direct_sun',
    optimalWindMphMax: 5,
    optimalAltitudeFtMax: 1000,
  },
  note: 'Above these ranges, performance degrades non-linearly. Cold deviations are less costly than equivalent-magnitude warm deviations.',
  citations: [
    cite('§Optimal Conditions Reference', 'Optimal Tair: 42-46°F (men), 46-50°F (women). Optimal Td <50°F. Optimal solar: overcast. Optimal wind <5 mph. Optimal altitude <1000 ft.', 'research', '06'),
  ],
};

// ── Heat: Maughan / Ely / Vihma ────────────────────────────────────

/** Marathon slowdown by air temperature, by runner ability tier.
 *  Aggregated across Boston, Berlin, Chicago, NYC, Stockholm, Twin
 *  Cities datasets. Slowdown relative to 50°F baseline. */
export const MAUGHAN_HEAT_SLOWDOWN: Cited<Array<{
  tairF: number;
  tairC: number;
  elitePct: number;
  midPaceMarathonerPct: number;
  slowMarathonerPct: number;
}>> = {
  value: [
    { tairF: 40, tairC: 4,  elitePct: 0,    midPaceMarathonerPct: 0,    slowMarathonerPct: 0    },
    { tairF: 50, tairC: 10, elitePct: 0,    midPaceMarathonerPct: 0,    slowMarathonerPct: 0    },
    { tairF: 60, tairC: 16, elitePct: 0.5,  midPaceMarathonerPct: 1.5,  slowMarathonerPct: 2.5  },
    { tairF: 65, tairC: 18, elitePct: 1.0,  midPaceMarathonerPct: 2.5,  slowMarathonerPct: 4.0  },
    { tairF: 70, tairC: 21, elitePct: 1.5,  midPaceMarathonerPct: 4.0,  slowMarathonerPct: 6.0  },
    { tairF: 75, tairC: 24, elitePct: 2.5,  midPaceMarathonerPct: 5.5,  slowMarathonerPct: 8.5  },
    { tairF: 80, tairC: 27, elitePct: 3.5,  midPaceMarathonerPct: 7.5,  slowMarathonerPct: 11.5 },
    { tairF: 85, tairC: 29, elitePct: 4.5,  midPaceMarathonerPct: 10.0, slowMarathonerPct: 15.0 },
    { tairF: 90, tairC: 32, elitePct: 6.0,  midPaceMarathonerPct: 13.0, slowMarathonerPct: 19.0 },
  ],
  note: 'Faster runners accumulate less heat over the race; slower runners accumulate more total heat load and slow disproportionately. Slow:elite ratio ~4-5×.',
  citations: [
    cite('§1 Heat Adjustment by Air Temperature › Maughan / Ely / Vihma synthesis', 'Marathon slowdown by Tair, by runner ability tier. Elite: 0% at 50°F to 6% at 90°F. Mid-pack 3:30: 0% to 13%. Slow 4:30+: 0% to 19%.', 'research', '06'),
  ],
};

// ── Dewpoint impact ────────────────────────────────────────────────

/** Dewpoint-based pace adjustment. Td is a stable indicator of how
 *  well sweat evaporates; better predictor than RH. */
export const DEWPOINT_PACE_ADJUSTMENT: Cited<Array<{
  dewpointFLow: number;
  dewpointFHigh: number;
  dewpointCLow: number;
  dewpointCHigh: number;
  easyRunRating: 'normal' | 'slightly_harder' | 'hard' | 'very_hard' | 'survival' | 'skip_or_early';
  qualityRating: 'normal' | 'slightly_harder' | 'harder' | 'very_hard' | 'time_on_feet' | 'postpone' | 'skip';
  pacePctLow: number;
  pacePctHigh: number;
}>> = {
  value: [
    { dewpointFLow: 0,  dewpointFHigh: 49, dewpointCLow: -18, dewpointCHigh: 9,  easyRunRating: 'normal',         qualityRating: 'normal',           pacePctLow: 0,    pacePctHigh: 0    },
    { dewpointFLow: 50, dewpointFHigh: 54, dewpointCLow: 10,  dewpointCHigh: 12, easyRunRating: 'normal',         qualityRating: 'normal',           pacePctLow: 0,    pacePctHigh: 0.5  },
    { dewpointFLow: 55, dewpointFHigh: 59, dewpointCLow: 13,  dewpointCHigh: 15, easyRunRating: 'normal',         qualityRating: 'slightly_harder',  pacePctLow: 0.5,  pacePctHigh: 1    },
    { dewpointFLow: 60, dewpointFHigh: 64, dewpointCLow: 16,  dewpointCHigh: 18, easyRunRating: 'slightly_harder', qualityRating: 'harder',           pacePctLow: 1,    pacePctHigh: 3    },
    { dewpointFLow: 65, dewpointFHigh: 69, dewpointCLow: 18,  dewpointCHigh: 21, easyRunRating: 'hard',           qualityRating: 'very_hard',         pacePctLow: 3,    pacePctHigh: 5    },
    { dewpointFLow: 70, dewpointFHigh: 74, dewpointCLow: 21,  dewpointCHigh: 23, easyRunRating: 'very_hard',      qualityRating: 'time_on_feet',      pacePctLow: 5,    pacePctHigh: 8    },
    { dewpointFLow: 75, dewpointFHigh: 79, dewpointCLow: 24,  dewpointCHigh: 26, easyRunRating: 'survival',       qualityRating: 'postpone',          pacePctLow: 12,   pacePctHigh: 15   },
    { dewpointFLow: 80, dewpointFHigh: 999, dewpointCLow: 27, dewpointCHigh: 999, easyRunRating: 'skip_or_early', qualityRating: 'skip',              pacePctLow: 15,   pacePctHigh: 30   },
  ],
  note: 'Sweat evaporation provides ~80% of cooling at moderate intensity; when Td approaches skin temperature (~91°F), evaporation stalls.',
  citations: [
    cite('§2 Humidity and Dewpoint › Dewpoint impact table', 'RunnersConnect framework, validated against Maughan/Otani lab data. Td <50°F normal; 60-64°F 1-3%; 70-74°F 5-8%; ≥80°F skip.', 'research', '06'),
  ],
};

/** Combined Tair + Td index. Sum drives a single percentage
 *  adjustment. Validated against Maughan-style heat-stress data. */
export const TEMP_DEWPOINT_SUM_ADJUSTMENT: Cited<Array<{
  sumLowF: number;
  sumHighF: number | null;
  pctLow: number | null;
  pctHigh: number | null;
  notes: string;
}>> = {
  value: [
    { sumLowF: 0,   sumHighF: 100,  pctLow: 0,    pctHigh: 0,    notes: 'Neutral conditions' },
    { sumLowF: 101, sumHighF: 110,  pctLow: 0,    pctHigh: 0.5,  notes: 'Imperceptible' },
    { sumLowF: 111, sumHighF: 120,  pctLow: 0.5,  pctHigh: 1.0,  notes: 'Easy runs unaffected' },
    { sumLowF: 121, sumHighF: 130,  pctLow: 1,    pctHigh: 2,    notes: 'Workouts feel slightly harder' },
    { sumLowF: 131, sumHighF: 140,  pctLow: 2,    pctHigh: 3,    notes: 'Adjust quality paces' },
    { sumLowF: 141, sumHighF: 150,  pctLow: 3,    pctHigh: 4.5,  notes: 'Adjust all paces' },
    { sumLowF: 151, sumHighF: 160,  pctLow: 4.5,  pctHigh: 6,    notes: 'Workouts compromised' },
    { sumLowF: 161, sumHighF: 170,  pctLow: 6,    pctHigh: 8,    notes: 'Run by effort' },
    { sumLowF: 171, sumHighF: 180,  pctLow: 8,    pctHigh: 10,   notes: 'Easy only or postpone' },
    { sumLowF: 181, sumHighF: null, pctLow: null, pctHigh: null, notes: 'Stop. Hard running not recommended.' },
  ],
  note: 'Interval-vs-continuous rule: for repeats with ≥1:1 work:rest, apply HALF the continuous-run adjustment — recovery periods allow partial cooling.',
  citations: [
    cite('§2 Humidity and Dewpoint › Combined Tair + Td index', 'Add Tair (°F) + Td (°F). Sum drives single adjustment. ≤100 = 0%; 121-130 = 1-2%; 161-170 = 6-8%; 181+ stop.', 'research', '06'),
  ],
};

// ── WBGT ───────────────────────────────────────────────────────────

/** Wet Bulb Globe Temperature flag thresholds. ACSM + Korey Stringer
 *  Institute, temperate-acclimatized runners. */
export const WBGT_FLAGS: Cited<Array<{
  wbgtFLow: number;
  wbgtFHigh: number | null;
  wbgtCLow: number;
  wbgtCHigh: number | null;
  flag: 'white' | 'green' | 'yellow' | 'red' | 'black';
  action: string;
}>> = {
  value: [
    { wbgtFLow: 0,  wbgtFHigh: 49,   wbgtCLow: -10, wbgtCHigh: 9,    flag: 'white',  action: 'Optimal. Normal training and racing.' },
    { wbgtFLow: 50, wbgtFHigh: 64,   wbgtCLow: 10,  wbgtCHigh: 18,   flag: 'green',  action: 'Low risk. Normal sessions.' },
    { wbgtFLow: 65, wbgtFHigh: 72,   wbgtCLow: 18,  wbgtCHigh: 22,   flag: 'yellow', action: 'Moderate risk. Reduce hard-session volume 5-10%.' },
    { wbgtFLow: 73, wbgtFHigh: 82,   wbgtCLow: 23,  wbgtCHigh: 28,   flag: 'red',    action: 'High risk. Reduce intensity 10-20%, shorten quality. Consider rescheduling races.' },
    { wbgtFLow: 83, wbgtFHigh: 86,   wbgtCLow: 28,  wbgtCHigh: 30,   flag: 'black',  action: 'Extreme risk. Cancel competitive racing. Easy only, early/late only.' },
    { wbgtFLow: 87, wbgtFHigh: null, wbgtCLow: 30,  wbgtCHigh: null, flag: 'black',  action: 'Cease outdoor sessions.' },
  ],
  note: 'Hot-climate acclimatized runners can shift each threshold +2-4°F (Korey Stringer Institute / UGA regional categories).',
  citations: [
    cite('§3 WBGT › Race / training thresholds', 'White <50°F optimal; green 50-64°F normal; yellow 65-72°F reduce volume 5-10%; red 73-82°F reduce intensity 10-20%; black 83+°F cancel racing.', 'research', '06'),
  ],
};

/** WBGT formulas. Tg = black-globe temperature. */
export const WBGT_COMPUTATION: Cited<{
  outdoorFormula: string;
  indoorFormula: string;
  approximationFromTairRh: string;
  solarCorrection: { full_sun: number; partial: number; overcast: number };
}> = {
  value: {
    outdoorFormula: 'WBGT = 0.7 × Tw + 0.2 × Tg + 0.1 × Tair',
    indoorFormula: 'WBGT = 0.7 × Tw + 0.3 × Tair',
    approximationFromTairRh: 'WBGT_approx (°F) ≈ Tair − ((100 − RH) / 5) + solar_correction',
    solarCorrection: { full_sun: 5, partial: 2, overcast: 0 },
  },
  citations: [
    cite('§3 WBGT › Computation', 'Outdoor: 0.7·Tw + 0.2·Tg + 0.1·Tair. Indoor: 0.7·Tw + 0.3·Tair. Approximation from Tair+RH+solar.', 'research', '06'),
  ],
};

// ── Heat acclimation ───────────────────────────────────────────────

/** Heat acclimation timeline. Périard 2021 + ACSM consensus. */
export const HEAT_ACCLIMATION_TIMELINE: Cited<Array<{
  daysLow: number;
  daysHigh: number;
  plasmaVolumePctLow: number | null;
  plasmaVolumePctHigh: number | null;
  hrReductionBpm: number;
  coreTempReductionC: number;
  performanceGainsPct: number | null;
}>> = {
  value: [
    { daysLow: 1,  daysHigh: 3,  plasmaVolumePctLow: 5,  plasmaVolumePctHigh: 8,  hrReductionBpm: -5,  coreTempReductionC: -0.2, performanceGainsPct: 5  },
    { daysLow: 4,  daysHigh: 7,  plasmaVolumePctLow: 10, plasmaVolumePctHigh: 12, hrReductionBpm: -10, coreTempReductionC: -0.4, performanceGainsPct: 50 },
    { daysLow: 8,  daysHigh: 10, plasmaVolumePctLow: 12, plasmaVolumePctHigh: 12, hrReductionBpm: -13, coreTempReductionC: -0.5, performanceGainsPct: 75 },
    { daysLow: 11, daysHigh: 14, plasmaVolumePctLow: 12, plasmaVolumePctHigh: 12, hrReductionBpm: -15, coreTempReductionC: -0.6, performanceGainsPct: 100 },
  ],
  citations: [
    cite('§4 Heat Acclimation › Adaptation timeline', 'Day 1-3: PV +5-8%, HR -5 bpm. Day 4-7: PV +10-12%, HR -10, ~50% gains. Day 14: full acclimation.', 'research', '06'),
  ],
};

/** Heat acclimation protocol. */
export const HEAT_ACCLIMATION_PROTOCOL: Cited<{
  durationDaysLow: number;
  durationDaysHigh: number;
  durationDaysPreferredLow: number;
  durationDaysPreferredHigh: number;
  sessionsPerWeekLow: number;
  sessionsPerWeekHigh: number;
  maintenanceSessionsPerWeek: number;
  sessionDurationMinLow: number;
  sessionDurationMinHigh: number;
  doseTairFMin: number;
  doseWbgtFMin: number;
  goalCoreTempC: number;
  goalCoreTempDurationMin: number;
  decayPctPerDayLow: number;
  decayPctPerDayHigh: number;
  decayHalfDays: number;
  saunaAlternative: { durationMinLow: number; durationMinHigh: number; tempFLow: number; tempFHigh: number; sessionsPerWeekLow: number; sessionsPerWeekHigh: number; weeks: number; expectedEffectPctLow: number; expectedEffectPctHigh: number };
}> = {
  value: {
    durationDaysLow: 10, durationDaysHigh: 14,
    durationDaysPreferredLow: 14, durationDaysPreferredHigh: 21,
    sessionsPerWeekLow: 5, sessionsPerWeekHigh: 6,
    maintenanceSessionsPerWeek: 3,
    sessionDurationMinLow: 60, sessionDurationMinHigh: 90,
    doseTairFMin: 85, doseWbgtFMin: 75,
    goalCoreTempC: 38.5,
    goalCoreTempDurationMin: 30,
    decayPctPerDayLow: 2, decayPctPerDayHigh: 3,
    decayHalfDays: 7,
    saunaAlternative: {
      durationMinLow: 25, durationMinHigh: 35,
      tempFLow: 175, tempFHigh: 195,
      sessionsPerWeekLow: 4, sessionsPerWeekHigh: 5,
      weeks: 3,
      expectedEffectPctLow: 70, expectedEffectPctHigh: 80,
    },
  },
  citations: [
    cite('§4 Heat Acclimation › Protocol', '10-14 days minimum, 14-21 preferred. 5-6 sessions/week. 60-90 min moderate intensity. Tair ≥85°F or WBGT ≥75°F. Core ≥38.5°C for ≥30 min. Decay 2-3%/day after stopping.', 'research', '06'),
    cite('§4 Heat Acclimation › Sauna alternative', 'Post-run sauna 25-35 min @ 175-195°F. 4-5 sessions/week × 3 weeks. 70-80% of full heat-acclimation effect.', 'research', '06'),
  ],
};

/** Pacing during the acclimation block. */
export const HEAT_ACCLIMATION_PACING: Cited<Array<{
  daysLow: number;
  daysHigh: number;
  paceAdjustmentPctLow: number;
  paceAdjustmentPctHigh: number;
}>> = {
  value: [
    { daysLow: 1,  daysHigh: 3,  paceAdjustmentPctLow: -15, paceAdjustmentPctHigh: -10 },
    { daysLow: 4,  daysHigh: 7,  paceAdjustmentPctLow: -10, paceAdjustmentPctHigh: -5  },
    { daysLow: 8,  daysHigh: 10, paceAdjustmentPctLow: -5,  paceAdjustmentPctHigh: -3  },
    { daysLow: 11, daysHigh: 14, paceAdjustmentPctLow: 0,   paceAdjustmentPctHigh: 0   },
  ],
  citations: [
    cite('§4 Heat Acclimation › Pacing during acclimation', 'Day 1-3: -10 to -15% (very easy, time-on-feet). Day 4-7: -5 to -10%. Day 8-10: -3 to -5%. Day 11-14: hit normal heat-adjusted paces.', 'research', '06'),
  ],
};

// ── Cold ───────────────────────────────────────────────────────────

export const COLD_PERFORMANCE_IMPACT: Cited<Array<{
  tairFLow: number;
  tairFHigh: number;
  tairCLow: number;
  tairCHigh: number;
  slowdownPctLow: number;
  slowdownPctHigh: number;
  notes: string;
}>> = {
  value: [
    { tairFLow: 35, tairFHigh: 45,  tairCLow: 2,    tairCHigh: 7,    slowdownPctLow: 0,    slowdownPctHigh: 0.5, notes: 'Often optimal range' },
    { tairFLow: 25, tairFHigh: 34,  tairCLow: -4,   tairCHigh: 1,    slowdownPctLow: 0.5,  slowdownPctHigh: 1,   notes: 'Slight slowdown from warmup cost' },
    { tairFLow: 15, tairFHigh: 24,  tairCLow: -9,   tairCHigh: -4,   slowdownPctLow: 1,    slowdownPctHigh: 2,   notes: 'Heavier clothing, footing issues' },
    { tairFLow: 5,  tairFHigh: 14,  tairCLow: -15,  tairCHigh: -10,  slowdownPctLow: 2,    slowdownPctHigh: 4,   notes: 'Bronchospasm risk in some' },
    { tairFLow: -5, tairFHigh: 4,   tairCLow: -20,  tairCHigh: -15,  slowdownPctLow: 4,    slowdownPctHigh: 7,   notes: 'Restrict outdoor quality' },
    { tairFLow: -50, tairFHigh: -6, tairCLow: -50,  tairCHigh: -21,  slowdownPctLow: 7,    slowdownPctHigh: 15,  notes: 'Indoor or skip; frostbite risk' },
  ],
  note: 'Cold deviations are less costly than equivalent-magnitude warm deviations. Carbohydrate oxidation rises, fat oxidation drops; lactate accumulates earlier. Muscle force drops ~5% per 10°C tissue cooling. Respiratory water loss 1-2 L/hr at very cold temps.',
  citations: [
    cite('§5 Cold Weather Adjustments › Performance impact', '35-45°F often optimal (0-0.5%). 25-34°F 0.5-1%. 15-24°F 1-2%. 5-14°F 2-4%. -5 to 4°F 4-7%. <-5°F 7-15% indoor or skip.', 'research', '06'),
  ],
};

export const WIND_CHILL_THRESHOLDS: Cited<Array<{
  windChillFLow: number;
  windChillFHigh: number | null;
  action: string;
}>> = {
  value: [
    { windChillFLow: 1,    windChillFHigh: null, action: 'Normal session with appropriate layers' },
    { windChillFLow: -18,  windChillFHigh: 0,    action: 'Cover all skin; limit hard outdoor efforts to ≤30 min' },
    { windChillFLow: -31,  windChillFHigh: -19,  action: 'Frostbite ≤30 min on exposed skin; restrict to easy continuous' },
    { windChillFLow: -150, windChillFHigh: -32,  action: 'Frostbite <10 min; move indoors' },
  ],
  citations: [
    cite('§5 Cold Weather Adjustments › Wind chill thresholds', '>0°F normal; 0 to -18°F cover all skin, ≤30 min hard; -19 to -31°F restrict to easy continuous; <-31°F move indoors', 'research', '06'),
  ],
};

// ── Wind ───────────────────────────────────────────────────────────

/** Wind cost per mile by speed and pace. Drag scales with the SQUARE
 *  of relative airspeed. Headwind costs ~2× what an equal tailwind
 *  gives back. */
export const WIND_PER_MILE_COST: Cited<Array<{
  windMph: number;
  headwindCostS6Min: number;
  headwindCostS8Min: number;
  tailwindBenefitS6Min: number;
  tailwindBenefitS8Min: number;
}>> = {
  value: [
    { windMph: 5,  headwindCostS6Min: 3,  headwindCostS8Min: 5,   tailwindBenefitS6Min: -1.5, tailwindBenefitS8Min: -2  },
    { windMph: 10, headwindCostS6Min: 12, headwindCostS8Min: 18,  tailwindBenefitS6Min: -6,   tailwindBenefitS8Min: -9  },
    { windMph: 15, headwindCostS6Min: 24, headwindCostS8Min: 35,  tailwindBenefitS6Min: -12,  tailwindBenefitS8Min: -17 },
    { windMph: 20, headwindCostS6Min: 40, headwindCostS8Min: 58,  tailwindBenefitS6Min: -20,  tailwindBenefitS8Min: -28 },
    { windMph: 25, headwindCostS6Min: 60, headwindCostS8Min: 85,  tailwindBenefitS6Min: -30,  tailwindBenefitS8Min: -42 },
    { windMph: 30, headwindCostS6Min: 85, headwindCostS8Min: 120, tailwindBenefitS6Min: -42,  tailwindBenefitS8Min: -58 },
  ],
  note: 'Pure crosswind costs ~25-30% of equivalent headwind. Out-and-back ≈ flat-wind course minus 30-40% of headwind cost (asymmetry → net loss). Drafting savings ~80% of wind-resistance cost; ~6% VO2 reduction at race pace in close pack.',
  citations: [
    cite('§6 Wind › Headwind / tailwind seconds-per-mile', 'Wind 10 mph: +12 s at 6:00 pace, +18 at 8:00. Tailwind benefit ~half headwind cost.', 'research', '06'),
  ],
};

// ── Altitude ───────────────────────────────────────────────────────

/** Race performance loss by elevation (sea-level acclimatized
 *  runners). */
export const ALTITUDE_RACE_LOSS: Cited<Array<{
  elevationFt: number;
  elevationM: number;
  acutePctLow: number;
  acutePctHigh: number;
  acclimatizedPctLow: number;
  acclimatizedPctHigh: number;
  endurancePctLow: number;
  endurancePctHigh: number;
}>> = {
  value: [
    { elevationFt: 1000,  elevationM: 305,  acutePctLow: 0,   acutePctHigh: 1,   acclimatizedPctLow: 0,   acclimatizedPctHigh: 0.5, endurancePctLow: 0,    endurancePctHigh: 0.5 },
    { elevationFt: 2500,  elevationM: 760,  acutePctLow: 1,   acutePctHigh: 2,   acclimatizedPctLow: 0.5, acclimatizedPctHigh: 1,   endurancePctLow: 1,    endurancePctHigh: 1   },
    { elevationFt: 4000,  elevationM: 1220, acutePctLow: 3,   acutePctHigh: 5,   acclimatizedPctLow: 1.5, acclimatizedPctHigh: 2.5, endurancePctLow: 2.5,  endurancePctHigh: 2.5 },
    { elevationFt: 5000,  elevationM: 1525, acutePctLow: 5,   acutePctHigh: 8,   acclimatizedPctLow: 2,   acclimatizedPctHigh: 4,   endurancePctLow: 4,    endurancePctHigh: 4   },
    { elevationFt: 6000,  elevationM: 1830, acutePctLow: 7,   acutePctHigh: 10,  acclimatizedPctLow: 3,   acclimatizedPctHigh: 5,   endurancePctLow: 5,    endurancePctHigh: 6   },
    { elevationFt: 7000,  elevationM: 2135, acutePctLow: 10,  acutePctHigh: 14,  acclimatizedPctLow: 4.5, acclimatizedPctHigh: 7,   endurancePctLow: 7,    endurancePctHigh: 8   },
    { elevationFt: 8000,  elevationM: 2440, acutePctLow: 13,  acutePctHigh: 18,  acclimatizedPctLow: 6,   acclimatizedPctHigh: 9,   endurancePctLow: 10,   endurancePctHigh: 10  },
    { elevationFt: 9000,  elevationM: 2745, acutePctLow: 16,  acutePctHigh: 22,  acclimatizedPctLow: 8,   acclimatizedPctHigh: 12,  endurancePctLow: 12,   endurancePctHigh: 14  },
    { elevationFt: 10000, elevationM: 3050, acutePctLow: 20,  acutePctHigh: 28,  acclimatizedPctLow: 10,  acclimatizedPctHigh: 15,  endurancePctLow: 15,   endurancePctHigh: 18  },
  ],
  note: 'Easy paces minimally affected; VO2max-paced work most affected (5K > threshold > marathon > easy).',
  citations: [
    cite('§7 Altitude › Race performance loss by elevation', 'Acute (day 1-3) vs after 3 wk acclimatization. 5000 ft: 5-8% acute, 2-4% acclimatized. 10000 ft: 20-28% acute, 10-15% acclimatized.', 'research', '06'),
  ],
};

/** Altitude arrival timing — Stellingwerff/Chapman strategies. */
export const ALTITUDE_ARRIVAL_STRATEGIES: Cited<Array<{
  strategy: 'A_arrive_late' | 'B_arrive_early' | 'AVOID_2_to_7_days';
  description: string;
  rationale: string;
}>> = {
  value: [
    {
      strategy: 'A_arrive_late',
      description: 'Arrive ≤24h before race',
      rationale: 'Avoid acute-phase decline (hyperventilation, hemoconcentration)',
    },
    {
      strategy: 'B_arrive_early',
      description: 'Arrive ≥14 days before race',
      rationale: 'Capture acclimatization gains (Hbmass +1-3% by day 14, full asymptote 4-6 weeks)',
    },
    {
      strategy: 'AVOID_2_to_7_days',
      description: 'Avoid arrival 2-7 days before race',
      rationale: 'Worst window: hyperventilation + bicarbonate loss without RBC gain',
    },
  ],
  citations: [
    cite('§7 Altitude › Arrival timing rule (Stellingwerff, Chapman)', 'Two viable strategies: arrive ≤24h (A) or arrive ≥14 days (B). Avoid 2-7 days.', 'research', '06'),
  ],
};

/** Live-High-Train-Low protocol. */
export const LHTL_PROTOCOL: Cited<{
  liveAltitudeMLow: number;
  liveAltitudeMHigh: number;
  trainAltitudeMMax: number;
  hypoxicHoursPerDay: number;
  hypoxicAltitudeMMin: number;
  totalExposureHoursMin: number;
  expectedHbmassPctLow: number;
  expectedHbmassPctHigh: number;
  expectedVo2maxPctLow: number;
  expectedVo2maxPctHigh: number;
  expectedTtPctLow: number;
  expectedTtPctHigh: number;
  detrainingWeeksLow: number;
  detrainingWeeksHigh: number;
  nonResponderRatePct: number;
}> = {
  value: {
    liveAltitudeMLow: 2000, liveAltitudeMHigh: 2500,
    trainAltitudeMMax: 1200,
    hypoxicHoursPerDay: 12, hypoxicAltitudeMMin: 2100,
    totalExposureHoursMin: 250,
    expectedHbmassPctLow: 3, expectedHbmassPctHigh: 6,
    expectedVo2maxPctLow: 1, expectedVo2maxPctHigh: 4,
    expectedTtPctLow: 1, expectedTtPctHigh: 3,
    detrainingWeeksLow: 2, detrainingWeeksHigh: 4,
    nonResponderRatePct: 30,
  },
  note: 'LHTL outperforms LHTH for sea-level events because training velocity is preserved. ~30% are non-responders by Hbmass criterion.',
  citations: [
    cite('§7 Altitude › Live-High-Train-Low (LHTL)', 'Live 2000-2500m, train <1200m. ≥12 h/day at ≥2100m for ≥3 weeks (250+ total hrs). Hbmass +3-6%, VO2max +1-4%, TT +1-3%. Decay 2-4 wks.', 'research', '06'),
  ],
};

// ── Air quality ────────────────────────────────────────────────────

export const AQI_THRESHOLDS: Cited<Array<{
  aqiLow: number;
  aqiHigh: number | null;
  category: 'good' | 'moderate' | 'usg' | 'unhealthy' | 'very_unhealthy' | 'hazardous';
  pm25Low: number;
  pm25High: number | null;
  easyRunGuidance: string;
  qualitySessionGuidance: string;
  longRunGuidance: string;
}>> = {
  value: [
    { aqiLow: 0,   aqiHigh: 50,   category: 'good',           pm25Low: 0,   pm25High: 12,   easyRunGuidance: 'Normal',                    qualitySessionGuidance: 'Normal',                                  longRunGuidance: 'Normal' },
    { aqiLow: 51,  aqiHigh: 100,  category: 'moderate',       pm25Low: 12,  pm25High: 35,   easyRunGuidance: 'Normal',                    qualitySessionGuidance: 'Normal (sensitive: monitor)',             longRunGuidance: 'Normal' },
    { aqiLow: 101, aqiHigh: 150,  category: 'usg',            pm25Low: 35,  pm25High: 55,   easyRunGuidance: 'Normal (≤60 min)',          qualitySessionGuidance: 'Reduce intensity 10%',                    longRunGuidance: 'Caution; avoid if respiratory hx' },
    { aqiLow: 151, aqiHigh: 200,  category: 'unhealthy',      pm25Low: 55,  pm25High: 150,  easyRunGuidance: '≤30 min, easy only',        qualitySessionGuidance: 'Move indoors',                            longRunGuidance: 'Move indoors' },
    { aqiLow: 201, aqiHigh: 300,  category: 'very_unhealthy', pm25Low: 150, pm25High: 250,  easyRunGuidance: 'Indoors only',              qualitySessionGuidance: 'Indoors only',                            longRunGuidance: 'Indoors only' },
    { aqiLow: 301, aqiHigh: null, category: 'hazardous',      pm25Low: 250, pm25High: null, easyRunGuidance: 'Skip / indoors with HEPA',  qualitySessionGuidance: 'Skip',                                    longRunGuidance: 'Skip' },
  ],
  note: 'Race-week rule: AQI ≤100 throughout last 21 days = race target unchanged. AQI 100-150 multiple days = ~5-10 s slower per race-mile (Marr et al. 12.8 s slower per +5 µg/m³ over 21d). AQI >150 with smoke (wildfire) = consider rescheduling.',
  citations: [
    cite('§9 Air Quality › AQI thresholds for runners', 'AQI 0-50 normal. 101-150 USG: easy ≤60 min, quality reduce 10%, long caution. 151+ move indoors.', 'research', '06'),
  ],
};

// ── Race-day decision flow ─────────────────────────────────────────

export const RACE_DAY_DECISION_FLOW: Cited<{
  steps: string[];
  combinedSlowdownFormula: string;
  compoundingNote: string;
  neutralEquivalentFormula: string;
}> = {
  value: {
    steps: [
      'Look up Tair, RH, Td, wind, sun, AQI, elevation for race start time and +2h.',
      'Compute Td-based pace adjustment (DEWPOINT_PACE_ADJUSTMENT) or WBGT (WBGT_FLAGS).',
      'Apply altitude adjustment (ALTITUDE_RACE_LOSS) if elevation >3000 ft.',
      'Apply wind adjustment (WIND_PER_MILE_COST) for net wind on course.',
      'Apply AQI gate (AQI_THRESHOLDS): cancel race if AQI >200.',
      'Sum percentages; convert to per-mile target.',
      'Pace early miles 5-10 s/mi slower than total adjusted pace; reassess at 5K and 10K.',
    ],
    combinedSlowdownFormula: 'total_slowdown_pct ≈ heat_pct + altitude_pct + wind_pct + aqi_pct',
    compoundingNote: 'Heat and altitude slightly compound (not strictly additive); when both >5%, reduce expected gains by ~10% — i.e., a 6% heat + 6% altitude condition ≈ 11% (not 12%).',
    neutralEquivalentFormula: 'T_neutral ≈ T_observed / (1 + total_slowdown_pct/100)',
  },
  citations: [
    cite('§10 Race-Day Recalibration', 'Decision flow + combined slowdown formula + neutral-equivalent conversion', 'research', '06'),
  ],
};

// ── Bail triggers (engine reads for whether to allow quality session) ──

export const QUALITY_SESSION_BAIL_TRIGGERS: Cited<Array<{
  trigger: string;
  action: 'time_based_rpe_only' | 'easy_time_on_feet' | 'time_based_or_track_loops' | 'time_on_feet_only' | 'easy_only_or_indoors';
  reason: string;
}>> = {
  value: [
    { trigger: 'Td ≥70°F',                         action: 'time_based_rpe_only',         reason: 'Quality sessions: time-based, RPE-driven' },
    { trigger: 'WBGT ≥80°F',                       action: 'easy_time_on_feet',           reason: 'All hard sessions: convert to easy time-on-feet' },
    { trigger: 'Wind ≥20 mph sustained',           action: 'time_based_or_track_loops',   reason: 'Intervals: time-based or move to track loops' },
    { trigger: 'Altitude >7000 ft + first 7 days', action: 'time_on_feet_only',           reason: 'Time-on-feet only; no quality' },
    { trigger: 'AQI 151-200',                      action: 'easy_only_or_indoors',        reason: 'Easy time-on-feet ≤30 min or indoors' },
  ],
  citations: [
    cite('§11 Training Pace Adjustments and Bail Triggers › When to convert to time-on-feet', 'Td ≥70°F, WBGT ≥80°F, wind ≥20 mph, altitude >7k ft first 7d, AQI 151-200', 'research', '06'),
  ],
};

/** Hard cancel triggers — postpone or cancel the session. */
export const HARD_CANCEL_TRIGGERS: Cited<Array<{
  trigger: string;
  reason: string;
}>> = {
  value: [
    { trigger: 'WBGT >86°F (>30°C)',                  reason: 'ACSM black flag' },
    { trigger: 'Td ≥80°F',                            reason: 'Evaporative cooling fails' },
    { trigger: 'Wind chill <-18°F (<-28°C)',          reason: 'Frostbite within 30 min' },
    { trigger: 'AQI >200',                            reason: 'Acute health risk' },
    { trigger: 'Wildfire smoke visible / smell',      reason: 'PM2.5 spikes uncorrelated with reported AQI' },
    { trigger: 'Lightning within 10 mi',              reason: 'Defer 30 min from last strike' },
    { trigger: 'Ice / black ice on route',            reason: 'Footing > pace concern' },
  ],
  citations: [
    cite('§11 › Hard bail triggers (cancel/postpone)', 'WBGT >86, Td ≥80, wind chill <-18, AQI >200, wildfire smoke, lightning <10mi, ice', 'research', '06'),
  ],
};

/** Heat-illness early-warning signs. Stop the session immediately. */
export const HEAT_ILLNESS_WARNING_SIGNS: Cited<string[]> = {
  value: [
    'Cessation of sweating with continued heat exposure',
    'Pace drift >10% with stable RPE',
    'HR drift >15 bpm at constant pace beyond drift baseline',
    'Goosebumps, chills, headache, confusion',
    'Nausea or cramping at >20 min in heat',
  ],
  citations: [
    cite('§11 › Heat-illness early-warning signs', 'Stop immediately on any of these', 'research', '06'),
  ],
};

// ── Hydration by condition ─────────────────────────────────────────

export const HYDRATION_BY_CONDITION: Cited<Array<{
  condition: string;
  fluidMlPerHrLow: number;
  fluidMlPerHrHigh: number;
  notes?: string;
}>> = {
  value: [
    { condition: 'Cool (Tair <60°F)',             fluidMlPerHrLow: 400, fluidMlPerHrHigh: 600 },
    { condition: 'Warm (60-75°F)',                fluidMlPerHrLow: 500, fluidMlPerHrHigh: 800 },
    { condition: 'Hot (>75°F or Td >65°F)',       fluidMlPerHrLow: 600, fluidMlPerHrHigh: 1000, notes: 'Cap ~1200 mL/hr to avoid hyponatremia' },
    { condition: 'Cold (<35°F)',                  fluidMlPerHrLow: 300, fluidMlPerHrHigh: 500,  notes: 'Overcome low thirst drive' },
  ],
  note: 'Sodium target in heat: 300-700 mg Na+/hr; up to 1000 mg/hr for salty sweaters.',
  citations: [
    cite('§11 › Hydration adjustment by condition', 'Cool 400-600 mL/hr; warm 500-800; hot 600-1000 (cap 1200 to avoid EAH); cold 300-500.', 'research', '06'),
  ],
};

// ── Single-number fallback ─────────────────────────────────────────

/** Fallback table when only Tair is known (mid-pack marathoner, full
 *  sun, sea level, calm wind). */
export const SINGLE_NUMBER_HEAT_FALLBACK: Cited<Array<{
  tairFLow: number;
  tairFHigh: number;
  slowdownPctLow: number;
  slowdownPctHigh: number;
}>> = {
  value: [
    { tairFLow: 35, tairFHigh: 55, slowdownPctLow: 0,  slowdownPctHigh: 0  },
    { tairFLow: 56, tairFHigh: 60, slowdownPctLow: 0,  slowdownPctHigh: 1  },
    { tairFLow: 61, tairFHigh: 65, slowdownPctLow: 1,  slowdownPctHigh: 2  },
    { tairFLow: 66, tairFHigh: 70, slowdownPctLow: 2,  slowdownPctHigh: 4  },
    { tairFLow: 71, tairFHigh: 75, slowdownPctLow: 4,  slowdownPctHigh: 6  },
    { tairFLow: 76, tairFHigh: 80, slowdownPctLow: 6,  slowdownPctHigh: 8  },
    { tairFLow: 81, tairFHigh: 85, slowdownPctLow: 8,  slowdownPctHigh: 11 },
    { tairFLow: 86, tairFHigh: 90, slowdownPctLow: 11, slowdownPctHigh: 14 },
    { tairFLow: 91, tairFHigh: 95, slowdownPctLow: 14, slowdownPctHigh: 18 },
  ],
  note: 'Add: +0.5% per 1000 ft above 3000 ft (acclimatized) or +1% per 1000 ft (acute), and +1% per 10 mph net headwind, and +1% per 10°F dewpoint above 60°F.',
  citations: [
    cite('§12 Quick Reference: Single-Number Slowdown', 'Tair-only fallback, mid-pack marathoner, full sun, sea level, calm wind', 'research', '06'),
  ],
};
