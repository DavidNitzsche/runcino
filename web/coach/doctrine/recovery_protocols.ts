/**
 * Doctrine — Recovery and rest protocols (in-week, cutback, post-race).
 *
 * Source: Research/00b-recovery-protocols.md
 *
 * The unified reference on recovery across the three timescales:
 *   - In-week recovery (hours to days)
 *   - Cutback weeks (every 3-4 weeks)
 *   - Post-race recovery (weeks)
 *
 * Existing recovery.ts (Research/coaching-research §8) and post_race.ts
 * (synthesis-doc derived) cover overlapping ground at narrower scope.
 * This file is the canonical /Research/ extraction; both legacy files
 * stay for backward compat until callers migrate.
 *
 * Engine consumers:
 *   - coach.assessReadiness          → INCOMPLETE_RECOVERY_SIGNALS
 *                                      decision matrix
 *   - coach.prescribeWorkout         → HARD_EASY_ALTERNATION_RULES
 *                                      gap-before-next-hard-day
 *   - coach.adjustForReality (R)     → CUTBACK_DEPTH_BY_MILEAGE +
 *                                      MULTI_RACE_CADENCE
 *   - coach.briefRaceMorning          → RACE_PRIORITY_RECOVERY
 *   - coach.taperDepth                → POST_RACE_BY_DISTANCE */
import { cite, type Cited } from './cite';

// ── Three categories of recovery ──────────────────────────────────

export const RECOVERY_TIMESCALES: Cited<Array<{
  category: 'in_week' | 'cutback' | 'post_race';
  scale: string;
  trigger: string;
  goal: string;
  primaryTools: string[];
}>> = {
  value: [
    {
      category: 'in_week',
      scale: 'Hours to days',
      trigger: 'Each hard session',
      goal: 'Restore for the next hard session',
      primaryTools: ['Sleep', 'Nutrition', 'Easy runs', 'Rest days'],
    },
    {
      category: 'cutback',
      scale: 'Every 3-4 weeks',
      trigger: 'Cumulative training stress',
      goal: 'Consolidate adaptation, reduce injury/illness risk',
      primaryTools: ['20-40% volume reduction', 'Intensity preserved or reduced'],
    },
    {
      category: 'post_race',
      scale: 'Weeks',
      trigger: 'Race-day damage',
      goal: 'Repair tissue, restore CNS, reverse-taper to next block',
      primaryTools: ['Rest days', 'Reverse periodization', 'No structured workouts'],
    },
  ],
  note: 'A complete training program nests all three. Skipping any tier compounds debt.',
  citations: [
    cite('§The Three Categories of Recovery', 'In-week (hours-days) / cutback (3-4 wks) / post-race (weeks). Each requires different tactics.', 'research', '00b'),
  ],
};

// ── In-week recovery: hard/easy alternation ───────────────────────

export const HARD_EASY_ALTERNATION_RULES: Cited<{
  defaultRule: string;
  gapByStimulus: Array<{
    stimulus: string;
    minDaysEasyBeforeNextHard: number;
  }>;
}> = {
  value: {
    defaultRule: 'hard day → 1-2 easy/recovery/rest days → next hard day. Never stack two hard days back-to-back unless the plan calls for a stress block followed by extended recovery.',
    gapByStimulus: [
      { stimulus: 'Threshold/tempo (≤30 min at LT)',                     minDaysEasyBeforeNextHard: 1 },
      { stimulus: 'VO2max intervals',                                     minDaysEasyBeforeNextHard: 2 },
      { stimulus: 'Long run with marathon-pace work',                     minDaysEasyBeforeNextHard: 2 },
      { stimulus: 'Long run, easy pace (≥150% normal long run)',          minDaysEasyBeforeNextHard: 2 },
    ],
  },
  citations: [
    cite('§In-Week Recovery › Hard/Easy Alternation', 'Default: hard → 1-2 easy → next hard. Stimulus → minimum gap table.', 'research', '00b'),
  ],
};

/** Recovery run vs. easy run distinction. Mislabeling produces fatigue
 *  accumulation. */
export const RECOVERY_VS_EASY_RUN: Cited<{
  recoveryRun: { rpeLow: number; rpeHigh: number; hrMaxPctMax: number; durationMinLow: number; durationMinHigh: number; paceVsMpSPerMiSlowerLow: number; paceVsMpSPerMiSlowerHigh: number; stimulus: string };
  easyRun:     { rpeLow: number; rpeHigh: number; hrMaxPctLow: number; hrMaxPctHigh: number; durationMinLow: number; durationMinHigh: number; pctSlowerThanMpLow: number; pctSlowerThanMpHigh: number; stimulus: string };
}> = {
  value: {
    recoveryRun: {
      rpeLow: 2, rpeHigh: 3,
      hrMaxPctMax: 60,
      durationMinLow: 20, durationMinHigh: 45,
      paceVsMpSPerMiSlowerLow: 60, paceVsMpSPerMiSlowerHigh: 90,
      stimulus: 'Minimal — purpose is circulation, not adaptation',
    },
    easyRun: {
      rpeLow: 3, rpeHigh: 4,
      hrMaxPctLow: 60, hrMaxPctHigh: 70,
      durationMinLow: 45, durationMinHigh: 90,
      pctSlowerThanMpLow: 5, pctSlowerThanMpHigh: 10,
      stimulus: 'Aerobic base, capillarization, mitochondrial density',
    },
  },
  note: 'A recovery run does not make recovery faster than rest; it maintains coordination, blood flow, and routine without adding stress. If true recovery is in doubt, choose rest.',
  citations: [
    cite('§In-Week Recovery › Recovery Run vs. Easy Run', 'Distinct sessions. Recovery: RPE 2-3, ≤60% HRmax, 20-45 min. Easy: RPE 3-4, 60-70% HRmax, 45-90 min.', 'research', '00b'),
  ],
};

// ── Sleep ─────────────────────────────────────────────────────────

export const SLEEP_TIERS: Cited<Array<{
  hoursPerNightLow: number;
  hoursPerNightHigh: number | null;
  effect: 'significant_decrement' | 'below_optimum_cumulative_deficit' | 'general_minimum' | 'recommended_baseline' | 'optimal_for_high_load';
  description: string;
}>> = {
  value: [
    { hoursPerNightLow: 0,  hoursPerNightHigh: 6,    effect: 'significant_decrement',                description: 'Increased perceived exertion, reduced time to exhaustion, elevated cortisol, suppressed glycogen synthesis, increased injury risk' },
    { hoursPerNightLow: 6,  hoursPerNightHigh: 7,    effect: 'below_optimum_cumulative_deficit',     description: 'Below athlete optimum; cumulative deficit over weeks' },
    { hoursPerNightLow: 7,  hoursPerNightHigh: 8,    effect: 'general_minimum',                       description: 'General-population minimum; adequate for low-load training' },
    { hoursPerNightLow: 8,  hoursPerNightHigh: 9,    effect: 'recommended_baseline',                  description: 'Recommended baseline for training athletes' },
    { hoursPerNightLow: 9,  hoursPerNightHigh: 10,   effect: 'optimal_for_high_load',                 description: 'Optimal for high-load or competitive training; supported by sleep-extension trials' },
  ],
  note: 'Insufficient sleep elevates cortisol, suppresses testosterone and growth hormone, blunts muscle protein synthesis, impairs glycogen storage, and reduces immune function. Reaction time and decision-making degrade before subjective fatigue appears.',
  citations: [
    cite('§In-Week Recovery › Sleep', 'Sleep is the single most evidence-supported recovery modality. Effects are larger than any supplement or device.', 'research', '00b'),
  ],
};

export const SLEEP_EXTENSION_PROTOCOL: Cited<{
  extension: { addMinutesPerNightLow: number; addMinutesPerNightHigh: number; nightsLow: number; expectedEffects: string[] };
  banking: { addMinutesPerNightLow: number; addMinutesPerNightHigh: number; nightsLow: number; nightsHigh: number; useCase: string };
  napsMinutes: { low: number; high: number; idealTiming: string };
}> = {
  value: {
    extension: {
      addMinutesPerNightLow: 60, addMinutesPerNightHigh: 120,
      nightsLow: 5,
      expectedEffects: [
        'Stanford basketball cohort: +9% free-throw accuracy, faster sprint times after extending to 10h',
        'Tennis: improved serve accuracy after +2h',
        'Reaction time consistently improves',
      ],
    },
    banking: {
      addMinutesPerNightLow: 60, addMinutesPerNightHigh: 90,
      nightsLow: 5, nightsHigh: 7,
      useCase: 'Before anticipated short-sleep period (race travel, redeye flights, race morning). Reduces performance decrement after one night of restricted sleep.',
    },
    napsMinutes: {
      low: 20, high: 90,
      idealTiming: 'After lunch, completed ≥6h before bedtime. Short naps (≤30 min) avoid grogginess; longer naps include slow-wave sleep and aid muscle repair.',
    },
  },
  citations: [
    cite('§Sleep Extension and Sleep Banking', 'Extension: +60-120 min/night × 5-7+ nights. Banking: +60-90 min × 5-7 nights pre-event. Naps 20-90 min.', 'research', '00b'),
  ],
};

// ── Post-session nutrition ────────────────────────────────────────

export const POST_SESSION_NUTRITION_WINDOWS: Cited<Array<{
  window: string;
  carbsGPerKgLow: number | null;
  carbsGPerKgHigh: number | null;
  proteinG: number | null;
  notes: string;
}>> = {
  value: [
    { window: '0-30 min post-session',  carbsGPerKgLow: 1.0, carbsGPerKgHigh: 1.2, proteinG: 25, notes: 'Highest glycogen synthesis rate; most relevant if next hard session is <24h away' },
    { window: '0-4 h post-session',     carbsGPerKgLow: 0.8, carbsGPerKgHigh: 1.2, proteinG: null, notes: 'g/kg/h continued. Drops in priority if next session is >24h' },
    { window: '24-h post-session',      carbsGPerKgLow: 5.0, carbsGPerKgHigh: 10.0, proteinG: null, notes: '5-10 g/kg/day carbs (training load-scaled); 1.4-2.0 g/kg/day protein' },
  ],
  note: 'Hydration: replace 1.25-1.5× sweat losses with sodium-containing fluids. When next session is >24h away and total daily intake is adequate, exact post-run timing matters less.',
  citations: [
    cite('§In-Week Recovery › Nutrition for In-Week Recovery', '0-30 min: 1.0-1.2 g/kg carb + 20-30g protein. 0-4h: 0.8-1.2 g/kg/h. 24h: 5-10 g/kg/day carb, 1.4-2.0 g/kg/day protein.', 'research', '00b'),
  ],
};

// ── Recovery modality evidence tiers ──────────────────────────────

export const RECOVERY_MODALITY_TIERS: Cited<Array<{
  tier: 'A_strong' | 'B_moderate' | 'C_weak_mixed' | 'D_insufficient_or_negative';
  modality: string;
  evidenceSummary: string;
}>> = {
  value: [
    { tier: 'A_strong',                  modality: 'Sleep ≥8 h/night',                  evidenceSummary: 'Largest effect on recovery and performance of any modality' },
    { tier: 'A_strong',                  modality: 'Adequate carbohydrate + protein',   evidenceSummary: 'Causal for glycogen and muscle protein synthesis' },
    { tier: 'A_strong',                  modality: 'Easy/rest days between hard sessions', evidenceSummary: 'Foundational; supported by all training literature' },
    { tier: 'B_moderate',                modality: 'Massage (manual or percussive)',    evidenceSummary: 'Most effective single modality for DOMS in meta-analysis; effect peaks ~48h. Limited effect on performance metrics.' },
    { tier: 'B_moderate',                modality: 'Compression garments',              evidenceSummary: 'Small-to-moderate effect on perceived soreness and strength recovery 2-96h post-exercise. No performance benefit during running.' },
    { tier: 'B_moderate',                modality: 'Cold water immersion (10-15°C, 11-15 min)', evidenceSummary: 'Reduces soreness and inflammation post-endurance. Caveat: blunts strength/hypertrophy adaptation if used after strength work.' },
    { tier: 'B_moderate',                modality: 'Sauna post-session (15-30 min, 3-4×/wk)', evidenceSummary: 'Builds plasma volume, improves heat tolerance, ~2% endurance performance gain over 3 weeks. Recovery effect modest; performance adaptation main benefit.' },
    { tier: 'C_weak_mixed',              modality: 'Contrast water therapy',            evidenceSummary: 'Small benefit for soreness/strength; not clearly superior to single-modality approaches' },
    { tier: 'C_weak_mixed',              modality: 'Pneumatic compression boots',        evidenceSummary: 'Subjective improvement; small or null on objective biomarkers' },
    { tier: 'C_weak_mixed',              modality: 'Foam rolling',                       evidenceSummary: 'Short-term ROM and perceived soreness benefits; small effect size' },
    { tier: 'D_insufficient_or_negative', modality: 'IV vitamin/saline therapy',          evidenceSummary: 'No clear evidence of benefit over oral hydration. WADA prohibits IV >100 mL/12h in-competition. Bypasses GI filtration — risk without proven benefit.' },
    { tier: 'D_insufficient_or_negative', modality: 'Cryotherapy chambers',                evidenceSummary: 'Limited evidence beyond what cold-water immersion provides' },
    { tier: 'D_insufficient_or_negative', modality: 'NSAIDs as routine recovery aid',     evidenceSummary: 'Blunt adaptation; impair tendon and bone healing; renal risk during dehydration. Use only for acute medical indications.' },
  ],
  citations: [
    cite('§Recovery Modalities — Ranked by Evidence', '4-tier evidence ordering from systematic reviews and meta-analyses', 'research', '00b'),
  ],
};

// ── Cutback weeks ─────────────────────────────────────────────────

export const CUTBACK_FREQUENCY: Cited<Array<{
  profile: string;
  cycleLoadWeeks: number;
  cycleCutbackWeeks: number;
}>> = {
  value: [
    { profile: 'Default for most runners',                            cycleLoadWeeks: 3, cycleCutbackWeeks: 1 },
    { profile: 'Higher-mileage / experienced',                         cycleLoadWeeks: 4, cycleCutbackWeeks: 1 },
    { profile: 'Injury-prone / older / returning from injury',         cycleLoadWeeks: 2, cycleCutbackWeeks: 1 },
    { profile: 'Late-block (peak weeks of marathon prep)',             cycleLoadWeeks: 2, cycleCutbackWeeks: 1 },
  ],
  citations: [
    cite('§Cutback Weeks › Frequency', 'Default 3+1 / Experienced 4+1 / Injury-prone 2+1 / Late-block 2+1', 'research', '00b'),
  ],
};

export const CUTBACK_DEPTH_BY_MILEAGE: Cited<Array<{
  peakLoadMpwLow: number;
  peakLoadMpwHigh: number;
  cutbackMpwLow: number;
  cutbackMpwHigh: number;
  reductionPctLow: number;
  reductionPctHigh: number;
  notes: string;
}>> = {
  value: [
    { peakLoadMpwLow: 20, peakLoadMpwHigh: 40,   cutbackMpwLow: 16, cutbackMpwHigh: 28, reductionPctLow: 20, reductionPctHigh: 30, notes: 'Drop long run 20-30%; remove or shorten 1 of 2 quality sessions' },
    { peakLoadMpwLow: 40, peakLoadMpwHigh: 60,   cutbackMpwLow: 30, cutbackMpwHigh: 48, reductionPctLow: 20, reductionPctHigh: 30, notes: 'Long run -25%; keep one quality session, simplify second' },
    { peakLoadMpwLow: 60, peakLoadMpwHigh: 80,   cutbackMpwLow: 42, cutbackMpwHigh: 60, reductionPctLow: 25, reductionPctHigh: 30, notes: 'Long run -25-30%; one true quality session only' },
    { peakLoadMpwLow: 80, peakLoadMpwHigh: 999,  cutbackMpwLow: 56, cutbackMpwHigh: 68, reductionPctLow: 25, reductionPctHigh: 35, notes: 'Long run -30%; quality reduced or replaced with strides + tempo segments' },
  ],
  note: 'Percentage cut is from the highest week in the preceding load block, not the average. Intensity sessions kept but typically reduced by 1 rep or 1 set; volume is the primary lever.',
  citations: [
    cite('§Cutback Weeks › Depth of Cutback by Mileage Tier', '20-40 mpw → -20-30%; 40-60 → -20-30%; 60-80 → -25-30%; 80+ → -25-35%', 'research', '00b'),
  ],
};

export const CUTBACK_PRIORITY_ORDER: Cited<{
  cutOrder: string[];
  whatItIsNot: string[];
}> = {
  value: {
    cutOrder: [
      '1. Total volume (drop a weekday run, shorten others)',
      '2. Long run length (-20-30%)',
      '3. Second quality session (replace with easy + strides)',
      '4. Supplemental drills/strides',
      '5. Strength volume (rarely cut intensity; reduce sets)',
      '6. Last to be cut: the one remaining quality session that defines the block',
    ],
    whatItIsNot: [
      'Cutback weeks are not rest weeks. Mileage is reduced, not zeroed.',
      'They are not taper weeks. The goal is fatigue dissipation, not peak performance freshness.',
      'They are not optional during high-load blocks. The first cutback week skipped is when injury risk climbs.',
    ],
  },
  citations: [
    cite('§Cutback Weeks › What to Cut First + What Cutback Weeks Are Not', '6-step priority order + 3 clarifications', 'research', '00b'),
  ],
};

// ── Post-race recovery by distance ────────────────────────────────

export type PostRaceDistance = '5K' | '10K' | 'half_marathon' | 'marathon' | '50K' | '50_mile' | '100K' | '100_mile';

export const POST_RACE_BY_DISTANCE: Cited<Record<PostRaceDistance, {
  totalRecoveryDaysNoQualityLow: number;
  totalRecoveryDaysNoQualityHigh: number;
  zeroOrVeryLightDaysLow: number;
  zeroOrVeryLightDaysHigh: number;
  returnToLongRunsDay: string;
  returnToQualityDay: string;
  earliestNextRaceEffortDays: string;
}>> = {
  value: {
    '5K':            { totalRecoveryDaysNoQualityLow: 3,  totalRecoveryDaysNoQualityHigh: 5,  zeroOrVeryLightDaysLow: 1,  zeroOrVeryLightDaysHigh: 2,  returnToLongRunsDay: 'Day 4-5',   returnToQualityDay: 'Day 6-8',   earliestNextRaceEffortDays: '7-10 days' },
    '10K':           { totalRecoveryDaysNoQualityLow: 5,  totalRecoveryDaysNoQualityHigh: 7,  zeroOrVeryLightDaysLow: 2,  zeroOrVeryLightDaysHigh: 3,  returnToLongRunsDay: 'Day 5-7',   returnToQualityDay: 'Day 7-10',  earliestNextRaceEffortDays: '10-14 days' },
    half_marathon:   { totalRecoveryDaysNoQualityLow: 10, totalRecoveryDaysNoQualityHigh: 14, zeroOrVeryLightDaysLow: 3,  zeroOrVeryLightDaysHigh: 5,  returnToLongRunsDay: 'Day 7-10',  returnToQualityDay: 'Day 10-14', earliestNextRaceEffortDays: '21-28 days' },
    marathon:        { totalRecoveryDaysNoQualityLow: 21, totalRecoveryDaysNoQualityHigh: 28, zeroOrVeryLightDaysLow: 5,  zeroOrVeryLightDaysHigh: 10, returnToLongRunsDay: 'Week 2-3',  returnToQualityDay: 'Week 3-4',   earliestNextRaceEffortDays: '8-12 weeks' },
    '50K':           { totalRecoveryDaysNoQualityLow: 14, totalRecoveryDaysNoQualityHigh: 21, zeroOrVeryLightDaysLow: 3,  zeroOrVeryLightDaysHigh: 7,  returnToLongRunsDay: 'Week 2',    returnToQualityDay: 'Week 3',     earliestNextRaceEffortDays: '6-10 weeks' },
    '50_mile':       { totalRecoveryDaysNoQualityLow: 21, totalRecoveryDaysNoQualityHigh: 28, zeroOrVeryLightDaysLow: 7,  zeroOrVeryLightDaysHigh: 10, returnToLongRunsDay: 'Week 3',    returnToQualityDay: 'Week 4',     earliestNextRaceEffortDays: '8-12 weeks' },
    '100K':          { totalRecoveryDaysNoQualityLow: 28, totalRecoveryDaysNoQualityHigh: 35, zeroOrVeryLightDaysLow: 10, zeroOrVeryLightDaysHigh: 14, returnToLongRunsDay: 'Week 4',    returnToQualityDay: 'Week 5',     earliestNextRaceEffortDays: '10-16 weeks' },
    '100_mile':      { totalRecoveryDaysNoQualityLow: 28, totalRecoveryDaysNoQualityHigh: 42, zeroOrVeryLightDaysLow: 14, zeroOrVeryLightDaysHigh: 21, returnToLongRunsDay: 'Week 4-5',  returnToQualityDay: 'Week 6+',    earliestNextRaceEffortDays: '12-24 weeks' },
  },
  note: 'Daniels rule: 1 easy day per 3 km raced before next quality. Galloway/coaching consensus: 1 easy day per mile raced before resuming hard training. Use the larger for marathon and beyond. CNS recovery in ultras lags musculoskeletal; tendons and ligaments take longer than muscles.',
  citations: [
    cite('§Post-Race Recovery › Recovery by Distance', '5K 3-5d / 10K 5-7d / HM 10-14d / Marathon 21-28d / 50K 14-21d / 50mi 21-28d / 100K 28-35d / 100mi 28-42d', 'research', '00b'),
  ],
};

export const RACE_PRIORITY_RECOVERY: Cited<Record<'A' | 'B' | 'C', {
  effortGiven: string;
  taperBeforeDays: string;
  recoveryScale: string;
}>> = {
  value: {
    A: { effortGiven: 'Maximum, full taper, peak day', taperBeforeDays: '2-3 weeks', recoveryScale: 'Full POST_RACE_BY_DISTANCE table' },
    B: { effortGiven: 'Hard but not depleted; 1-week taper', taperBeforeDays: '7-10 days', recoveryScale: '60-70% of A-race recovery duration' },
    C: { effortGiven: 'Strong effort, no taper', taperBeforeDays: '0-3 days easy', recoveryScale: '25-50% of A-race recovery duration; treat like a hard workout' },
  },
  note: 'For a B-race half marathon, expect 7-10 days of recovery rather than 14. For a C-effort 5K, expect 2-3 easy days instead of 5.',
  citations: [
    cite('§Post-Race Recovery › Recovery by Effort (A vs. B vs. C Race)', 'A: full taper + full recovery. B: 7-10 day taper, 60-70% of A. C: 0-3d easy, 25-50% of A.', 'research', '00b'),
  ],
};

// ── Muscle-damage biomarker timeline ──────────────────────────────

export const MARATHON_BIOMARKER_TIMELINE: Cited<Array<{
  marker: string;
  peakHours: { low: number; high: number };
  baselineReturnHours: number;
}>> = {
  value: [
    { marker: 'Creatine kinase (CK)',                  peakHours: { low: 24, high: 24 },     baselineReturnHours: 144 },
    { marker: 'Lactate dehydrogenase (LDH)',           peakHours: { low: 24, high: 48 },     baselineReturnHours: 192 },
    { marker: 'Cardiac troponin (hs-TNT)',             peakHours: { low: 24, high: 48 },     baselineReturnHours: 96 },
    { marker: 'Hamstring T2 MRI signal',               peakHours: { low: 24, high: 72 },     baselineReturnHours: 192 },
    { marker: 'Subjective DOMS',                        peakHours: { low: 24, high: 72 },     baselineReturnHours: 168 },
  ],
  note: 'Returning to easy running at 48h post-marathon does not impair muscle damage recovery (studies up to 8 days post); may speed neuromuscular recovery. Returning to hard running before day 7 demonstrably impairs recovery. Cardiac troponin elevation is transient, not pathological in healthy runners.',
  citations: [
    cite('§Post-Race Recovery › Muscle-Damage Biomarker Timeline (Marathon)', 'CK peaks 24h, normalizes 144h. Subjective DOMS peaks 24-72h, resolves 5-7 days.', 'research', '00b'),
  ],
};

// ── Reverse periodization tissue timelines ────────────────────────

export const TISSUE_RECOVERY_TIMELINES: Cited<Array<{
  tissue: string;
  recoveryWindow: string;
}>> = {
  value: [
    { tissue: 'Glycogen',                                  recoveryWindow: '24-72h with adequate carbohydrate' },
    { tissue: 'Muscle fibers (microdamage)',               recoveryWindow: '5-10 days' },
    { tissue: 'Connective tissue (tendon, fascia)',        recoveryWindow: '2-4 weeks' },
    { tissue: 'Bone remodeling (post-stress)',              recoveryWindow: '3-6 weeks' },
    { tissue: 'CNS / hormonal balance',                    recoveryWindow: '2-4 weeks' },
    { tissue: 'Immune',                                     recoveryWindow: '1-3 weeks' },
  ],
  note: 'Reverse-taper ordering matches tissue-repair timelines: rebuild volume first (week 1-2), then frequency, then duration, then strides, then short tempo, then full quality. Loading high-intensity work before connective tissue and CNS recover risks tendon injury and stress fractures — the most common post-marathon injury pattern.',
  citations: [
    cite('§Reverse Periodization for Marathon Recovery', 'Glycogen 24-72h / muscle 5-10d / connective 2-4 wks / bone 3-6 wks / CNS+hormonal 2-4 wks / immune 1-3 wks', 'research', '00b'),
  ],
};

export const REVERSE_TAPER_PROTOCOL: Cited<Array<{
  weekPostRace: number;
  focus: string;
}>> = {
  value: [
    { weekPostRace: 1, focus: 'Rest / walk / minimal jog' },
    { weekPostRace: 2, focus: 'Rebuild frequency (most days = short easy)' },
    { weekPostRace: 3, focus: 'Rebuild duration (longer easy runs, no quality)' },
    { weekPostRace: 4, focus: 'Reintroduce strides, then short tempo' },
    { weekPostRace: 5, focus: 'Reintroduce one quality session (threshold or fartlek)' },
    { weekPostRace: 6, focus: 'Return to full structure' },
  ],
  citations: [
    cite('§Reverse Periodization for Marathon Recovery', 'Week 1 rest/walk, Week 2 frequency, Week 3 duration, Week 4 strides+tempo, Week 5 one quality, Week 6+ full structure', 'research', '00b'),
  ],
};

// ── Marathon recovery week-by-week ────────────────────────────────

export const MARATHON_RECOVERY_4WK_REVERSE_TAPER: Cited<Array<{
  weekPostRace: number;
  volumePctOfPeakLow: number;
  volumePctOfPeakHigh: number;
  longRun: string;
  quality: string;
  notes: string;
}>> = {
  value: [
    { weekPostRace: 1, volumePctOfPeakLow: 10, volumePctOfPeakHigh: 20, longRun: 'None',                                                          quality: 'None',                                                            notes: 'Days 0-3: walks only or rest. Days 4-7: 20-30 min very easy jogs every other day. No strides.' },
    { weekPostRace: 2, volumePctOfPeakLow: 30, volumePctOfPeakHigh: 40, longRun: '45-60 min easy',                                                quality: 'None',                                                            notes: 'All easy, RPE 3-4. Strides only if legs are clean by day 11-13.' },
    { weekPostRace: 3, volumePctOfPeakLow: 50, volumePctOfPeakHigh: 60, longRun: '60-75 min easy',                                                quality: 'Strides + light fartlek (4-6 × 1 min @ 10K effort)',               notes: 'First structured surges. No threshold or VO2max.' },
    { weekPostRace: 4, volumePctOfPeakLow: 70, volumePctOfPeakHigh: 80, longRun: '75-90 min easy with optional last 15-20 min @ MP',              quality: 'One light tempo (15-20 min @ HMP)',                               notes: 'First true workout. Re-evaluate before adding a second quality session in week 5.' },
  ],
  note: 'Full return to peak training load typically week 5-6.',
  citations: [
    cite('§Week-by-Week Protocols › Marathon Recovery (4-week reverse taper)', '4-week volume/long-run/quality grid', 'research', '00b'),
  ],
};

// ── Multi-races-per-year cadence ──────────────────────────────────

export const MULTI_RACE_CADENCE: Cited<{
  marathonsPerYearByProfile: Array<{ profile: string; perYear: string }>;
  marathonSpacingRisk: Array<{ spacing: string; risk: string }>;
  halfPerYear: Array<{ profile: string; perYear: string }>;
  halfMinSpacingWeeks: { low: number; high: number };
  raceEffort5kPerYear: Array<{ profile: string; perYear: string; minSpacing: string }>;
  ultraMaxPerYear: Array<{ distance: string; max: string }>;
  totalRaceEffortDaysCap: number;
  aRaceMaxPerYear: number;
  bRacePerYear: { low: number; high: number };
  offSeasonBreakWeeks: { low: number; high: number };
}> = {
  value: {
    marathonsPerYearByProfile: [
      { profile: 'New marathoner (first 1-3 marathons)',        perYear: '1' },
      { profile: 'Recreational, well-established',              perYear: '2 (spring + fall)' },
      { profile: 'Experienced sub-elite',                       perYear: '2 + 1 supported B-race marathon' },
      { profile: 'Elite professional',                          perYear: '2 (3 in Olympic/championship years)' },
      { profile: 'Marathoners >50 yr',                          perYear: '1-2' },
    ],
    marathonSpacingRisk: [
      { spacing: '<8 weeks',     risk: 'Very high — second marathon will be 5-10% slower, injury risk elevated, recovery prolonged' },
      { spacing: '8-12 weeks',   risk: 'High — possible for experienced runners; the second is rarely a PR' },
      { spacing: '12-16 weeks',  risk: 'Standard for spring + fall double-up' },
      { spacing: '16-24 weeks',  risk: 'Conservative; allows full block + taper' },
    ],
    halfPerYear: [
      { profile: 'Recreational',  perYear: '2-4' },
      { profile: 'Experienced',   perYear: '4-6' },
      { profile: 'Elite',         perYear: '6-10 (often as workouts in marathon prep)' },
    ],
    halfMinSpacingWeeks: { low: 4, high: 6 },
    raceEffort5kPerYear: [
      { profile: 'Recreational',                       perYear: '6-12',   minSpacing: '2-3 weeks' },
      { profile: 'Competitive club / sub-elite',       perYear: '10-20',  minSpacing: '1-2 weeks' },
      { profile: 'Track / road racing season',         perYear: '15-25',  minSpacing: '1 week (with reduced load between)' },
    ],
    ultraMaxPerYear: [
      { distance: '50K',       max: '4-6' },
      { distance: '50 mile',   max: '2-4' },
      { distance: '100K',      max: '2-3' },
      { distance: '100 mile',  max: '1-2 (rarely 3 for elites; cumulative connective-tissue load is the limiter)' },
    ],
    totalRaceEffortDaysCap: 25,
    aRaceMaxPerYear: 2,
    bRacePerYear: { low: 4, high: 6 },
    offSeasonBreakWeeks: { low: 2, high: 4 },
  },
  citations: [
    cite('§Multiple Races Per Year — Cadence Guidelines', 'Marathon, half, 5K/10K, ultra cadence + spacing + annual planning heuristic', 'research', '00b'),
  ],
};

// ── Carbon-plated shoe recovery effects ───────────────────────────

export const CARBON_PLATE_RECOVERY_EFFECTS: Cited<Array<{
  effect: string;
  direction: 'decreased' | 'increased' | 'shorter' | 'same_or_longer';
  notes: string;
}>> = {
  value: [
    { effect: 'Calf and Achilles muscle activation during running',     direction: 'decreased',         notes: 'More energy stored in foam, less in tendons' },
    { effect: 'Post-race CK and DOMS in lower-leg muscles',             direction: 'decreased',         notes: 'Anecdotally; limited peer-reviewed data; matches biomechanical predictions' },
    { effect: 'Bone stress on metatarsals and navicular',                direction: 'increased',         notes: 'Force transfer pattern shifts loading into foot bones. Multiple case series report BSI of foot in super-shoe users.' },
    { effect: 'Recovery time at the level of muscle',                   direction: 'shorter',           notes: 'Likely 1-3 days for marathon. Most relevant for races; less for daily training.' },
    { effect: 'Recovery time at the level of bone/connective tissue',    direction: 'same_or_longer',    notes: 'The bones still absorbed marathon-distance load; super shoes do not reduce skeletal recovery.' },
  ],
  note: 'Super shoes shift, but do not eliminate, recovery cost. The window saved on muscle damage may be paid back by skeletal load if mileage in super shoes is unbounded. Adjustment: Marathon raced in super shoes with no foot symptoms → standard 4-6 week return; marathon with foot soreness → add 1 week, treat as suspected early BSI until cleared. Limit super-shoe use to 1-2 sessions/week in training; rotate with non-plated shoes.',
  citations: [
    cite('§Carbon-Plated Shoe Effect on Recovery', '5-effect summary + practical adjustments', 'research', '00b'),
  ],
};

// ── Warning signs of incomplete recovery ──────────────────────────

export const INCOMPLETE_RECOVERY_QUANTITATIVE_SIGNALS: Cited<Array<{
  signal: string;
  threshold: string;
  notes: string;
}>> = {
  value: [
    { signal: 'HRV (RMSSD)',         threshold: 'Drop >1 SD below 7-day rolling baseline for 3+ consecutive days',  notes: 'Most useful as a personal trend, not absolute number. Confounded by alcohol, illness, menstrual cycle, travel.' },
    { signal: 'RHR (morning)',       threshold: '+5 bpm above 14-day baseline, sustained 3+ days',                  notes: 'Sleep-tracker overnight RHR more reliable than single-point morning measurement' },
    { signal: 'Sleep efficiency',    threshold: '<85% on tracker, or subjective non-restorative sleep',              notes: 'Cumulative deficit over a week is the warning' },
    { signal: 'Body weight',         threshold: '>2% drop over 1 week without intent',                                notes: 'Often indicates underfueling + inadequate recovery' },
    { signal: 'Performance',         threshold: 'Can\'t hit prescribed paces at usual HR/RPE for 2+ workouts',        notes: 'Strongest single performance indicator' },
    { signal: 'Submaximal HR',       threshold: 'HR ≥5 bpm higher than usual at fixed easy pace',                     notes: 'Aerobic decoupling without training stimulus = fatigue' },
  ],
  citations: [
    cite('§Warning Signs of Incomplete Recovery › Quantitative Signals', '6 quantitative signals + threshold + confounders', 'research', '00b'),
  ],
};

export const INCOMPLETE_RECOVERY_QUALITATIVE_SIGNALS: Cited<Array<{
  signal: string;
  description: string;
}>> = {
  value: [
    { signal: 'Mood',         description: 'Persistent low mood, irritability, loss of enthusiasm for running' },
    { signal: 'Motivation',   description: 'Skipping or dreading workouts that previously felt routine' },
    { signal: 'Soreness',     description: 'Persistent muscle soreness >5 days without obvious cause' },
    { signal: 'Heaviness',    description: '"Heavy legs" sensation that does not clear after 2 easy days' },
    { signal: 'Sleep',        description: 'Difficulty falling asleep despite fatigue, or early-morning waking' },
    { signal: 'Appetite',     description: 'Suppressed appetite or carbohydrate cravings disproportionate to training' },
    { signal: 'Illness',      description: 'Recurrent URTI; minor injuries that don\'t resolve' },
    { signal: 'Libido',       description: 'Suppressed libido; in females, menstrual cycle disruption' },
  ],
  citations: [
    cite('§Warning Signs of Incomplete Recovery › Qualitative Signals', '8 qualitative signals + description', 'research', '00b'),
  ],
};

export const INCOMPLETE_RECOVERY_DECISION_MATRIX: Cited<Array<{
  signalCount: string;
  action: string;
}>> = {
  value: [
    { signalCount: '0-1 quantitative + 0-1 qualitative',             action: 'Continue training' },
    { signalCount: '2 quantitative + 0-1 qualitative',                action: 'Insert easy days; defer next quality session 24-48h' },
    { signalCount: '1-2 quantitative + 2+ qualitative',              action: '3-5 day cutback (50% volume, no quality)' },
    { signalCount: '3+ quantitative or 3+ qualitative',               action: 'Full cutback week (40-50% volume); consider medical review' },
    { signalCount: 'Persistent for >2 weeks',                         action: 'Stop structured training; medical/coach review for non-functional overreaching or overtraining syndrome' },
  ],
  note: 'No single metric is reliable; multiple converging signals carry far more weight than any one in isolation. Functional overreaching (fitness builds after recovery) → non-functional overreaching (weeks to recover) → overtraining syndrome (months) is a continuum. Catching it at functional overreaching is the goal.',
  citations: [
    cite('§Warning Signs of Incomplete Recovery › Decision Matrix', 'Signal count → action mapping (continue / defer 24-48h / 3-5d cutback / full cutback / stop)', 'research', '00b'),
  ],
};

// ── Recovery hierarchy (single-page summary) ──────────────────────

export const RECOVERY_HIERARCHY: Cited<string[]> = {
  value: [
    '1. Sleep 8-9+ h consistently',
    '2. Adequate carbohydrate and protein',
    '3. Hard/easy alternation in the week',
    '4. Rest days as scheduled',
    '5. Cutback weeks every 3-4 weeks',
    '6. Reverse-taper post-race per distance table',
    '7. Compression / massage / sauna / cold for marginal gains',
    '8. Tech (boots, cryo, contrast) as convenience',
    '9. Avoid: routine NSAIDs, IV therapy, ice baths after strength work, training through 3+ warning signs',
  ],
  note: 'When in doubt, work down this list. Higher items dominate lower ones. If items 1-6 are not in place, no amount of items 7-9 will compensate.',
  citations: [
    cite('§Recovery Hierarchy — Single-Page Summary', '9-step priority list', 'research', '00b'),
  ],
};
