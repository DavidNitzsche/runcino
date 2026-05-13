/**
 * Doctrine — Workout vocabulary and structures.
 *
 * Source: Research/04-workout-vocabulary.md
 *
 * The canonical workout reference library. For any prescribed session
 * name (recovery, MLR, T tempo, fartlek, ladder, MP long run, etc.)
 * the coach looks up purpose, physiological target, pace expressed in
 * zones (E/M/T/I/R), duration, frequency, training-cycle placement,
 * and contraindications.
 *
 * Engine consumers:
 *   - coach-workouts.ts    builds RunPrescription from these structures
 *   - coach-engine.ts      reads `cyclePhasePlacement` for phase logic
 *   - coach.prescribeWorkout consults WORKOUT_CATALOG when a name lookup
 *                          is needed
 *
 * The original (Stage-0) constants RECOVERY_RUN, GENERAL_AEROBIC,
 * MEDIUM_LONG, LONG_RUN, etc. remain — they're typed lookups the
 * engine already consumes by name. Their citations are migrated from
 * the legacy `coaching-research.md §5.x` to Research/04.
 */
import { cite, type Cited } from './cite';

// ── Typed lookups the engine reads by name ─────────────────────────

export type WorkoutType =
  | 'recovery'
  | 'general_aerobic'
  | 'medium_long'
  | 'long_steady'
  | 'long_progression'
  | 'long_mp_block'
  | 'long_fast_finish'
  | 'long_dress_rehearsal'
  | 'tempo_continuous'
  | 'threshold_intervals'
  | 'sub_threshold'
  | 'long_tempo'
  | 'vo2'
  | 'marathon_specific_combo'
  | 'marathon_specific_long'
  | 'strides'
  | 'hill_sprints';

/** Recovery run — circulation, not adaptation. */
export const RECOVERY_RUN: Cited<{
  durationMinLow: number;
  durationMinHigh: number;
  paceNote: string;
  weeklyMileagePctCap: number;
}> = {
  value: {
    durationMinLow: 20, durationMinHigh: 45,
    paceNote: 'Slower than E. ~MP + 90+ s/mi, or 60-70% HRmax, or "easier than easy"',
    weeklyMileagePctCap: 15,
  },
  citations: [
    cite('§1 Recovery runs', 'Slower than E. ~MP + 90+ s/mi, or 60-70% HRmax. Duration 20-45 min. Should not exceed ~10-15% of weekly mileage.', 'research', '04'),
  ],
};

/** General aerobic / easy run — bread and butter aerobic adaptation. */
export const GENERAL_AEROBIC: Cited<{
  durationMinLow: number;
  durationMinHigh: number;
  pctSlowerThanMpLow: number;
  pctSlowerThanMpHigh: number;
  weeklyMileagePctLow: number;
  weeklyMileagePctHigh: number;
}> = {
  value: {
    durationMinLow: 30, durationMinHigh: 75,
    pctSlowerThanMpLow: 15, pctSlowerThanMpHigh: 25,
    weeklyMileagePctLow: 70, weeklyMileagePctHigh: 85,
  },
  note: 'Easy but not slow. Bread and butter aerobic adaptation.',
  citations: [
    cite('§2 Easy / general aerobic runs', '30-75 min typical; 15-25% slower than MP; 70-81% HRmax. 70-85% of weekly mileage.', 'research', '04'),
  ],
};

/** Pfitzinger medium-long run — second weekly run, distinct from long. */
export const MEDIUM_LONG: Cited<{
  distanceMiLow: number;
  distanceMiHigh: number;
  paceAnchor: 'endurance';
  perWeekRecommended: number;
}> = {
  value: { distanceMiLow: 11, distanceMiHigh: 15, paceAnchor: 'endurance', perWeekRecommended: 1 },
  note: 'One per week is good. Two per week separates serious marathoners from the field.',
  citations: [
    cite('§3 Medium-long runs', 'A second weekly run of 11-15 miles, distinct from the long run. Same pace as long run: E to low M effort.', 'research', '04'),
  ],
};

/** Long run — distance + duration anchors and the variants. */
export const LONG_RUN: Cited<{
  distanceMiLow: number;
  distanceMiHigh: number;
  durationHrLow: number;
  durationHrHigh: number;
  /** Cap of long runs over 18 mi during build + peak. */
  longRunsOver18MiLow: number;
  longRunsOver18MiHigh: number;
  /** The 90-min threshold below which it isn't really a long run. */
  thresholdMinutes: number;
  weeklyMileagePctTypicalLow: number;
  weeklyMileagePctTypicalHigh: number;
}> = {
  value: {
    distanceMiLow: 16, distanceMiHigh: 22,
    durationHrLow: 2, durationHrHigh: 3,
    longRunsOver18MiLow: 4, longRunsOver18MiHigh: 7,
    thresholdMinutes: 90,
    weeklyMileagePctTypicalLow: 20, weeklyMileagePctTypicalHigh: 25,
  },
  note: '90 min is the threshold below which the work is largely aerobic; above it, fast-twitch recruitment into aerobic metabolism is the marathon adaptation.',
  citations: [
    cite('§4.1 Long-run family overview', 'Variants: base / progression / MP / fast finish / dress rehearsal long runs', 'research', '04'),
    cite('§4.2 Base long run', '90 min minimum for endurance benefit; cap at ~25-30% of weekly mileage. 10-22+ mi for marathoners.', 'research', '04'),
  ],
};

/** Long-run variant: progression. */
export const LONG_PROGRESSION: Cited<{
  finishMilesLow: number;
  finishMilesHigh: number;
  finishPaceOffsetSPerMi: number;
  exampleStructure: string;
}> = {
  value: {
    finishMilesLow: 4, finishMilesHigh: 8,
    finishPaceOffsetSPerMi: -30,
    exampleStructure: '6 mi E + 6 mi M + 4 mi T (16 mi total)',
  },
  citations: [
    cite('§4.3 Progression long run', 'First 1/3 to 1/2 at E pace, middle at strong E or M, final 1/4 to 1/3 at M to T. Continuous, no recovery.', 'research', '04'),
  ],
};

/** Marathon-pace long run — most race-specific workout. */
export const LONG_MP_BLOCK: Cited<{
  totalMiLow: number;
  totalMiHigh: number;
  mpBlockMiLow: number;
  mpBlockMiHigh: number;
  weeksOutLow: number;
  weeksOutHigh: number;
}> = {
  value: {
    totalMiLow: 14, totalMiHigh: 22,
    mpBlockMiLow: 8, mpBlockMiHigh: 16,
    weeksOutLow: 6, weeksOutHigh: 10,
  },
  note: 'The single most race-specific workout in marathon training. Schedule 6-10 weeks before race day, every 2-3 weeks.',
  citations: [
    cite('§4.4 Marathon-pace long run', '14-22 mi total with 8-16 mi at MP. Easy warmup (2-4 mi) + MP block + optional easy cooldown.', 'research', '04'),
  ],
};

/** Hanson "fast finish" long run. */
export const LONG_FAST_FINISH: Cited<{
  totalMiLow: number;
  totalMiHigh: number;
  finishMiLow: number;
  finishMiHigh: number;
  finishPaceAnchor: 'mp_or_faster';
}> = {
  value: {
    totalMiLow: 12, totalMiHigh: 18,
    finishMiLow: 2, finishMiHigh: 6,
    finishPaceAnchor: 'mp_or_faster',
  },
  note: 'High training stress, high specificity to closing strong on tired legs. Train ability to find pace late.',
  citations: [
    cite('§4.5 Fast finish long run', 'Bulk at E (1-2 min/mi slower than MP), final 2-6 mi at MP or slightly faster.', 'research', '04'),
  ],
};

/** Marathon dress rehearsal — final equipment + fueling check. */
export const LONG_DRESS_REHEARSAL: Cited<{
  totalMiLow: number;
  totalMiHigh: number;
  mpSegmentsTotalMiLow: number;
  mpSegmentsTotalMiHigh: number;
  weeksOutBeforeMarathon: number;
}> = {
  value: {
    totalMiLow: 18, totalMiHigh: 22,
    mpSegmentsTotalMiLow: 4, mpSegmentsTotalMiHigh: 8,
    weeksOutBeforeMarathon: 3,
  },
  note: 'Race-day breakfast, race-day kit, race-day fueling intervals. Not a fitness builder.',
  citations: [
    cite('§4.6 Dress rehearsal long run', '18-22 mi (marathon); 12-14 mi (HM). Easy bulk + 2-3 segments at MP (4-8 mi total at MP). 3 weeks pre-marathon.', 'research', '04'),
  ],
};

/** Continuous tempo — sustained T-pace block. */
export const TEMPO_CONTINUOUS: Cited<{
  miLow: number;
  miHigh: number;
  durationMinLow: number;
  durationMinHigh: number;
  paceAnchor: 'threshold';
  /** Warm-up before the quality block (easy jog). Not included in miLow/miHigh. */
  warmupMiLow: number;
  warmupMiHigh: number;
  /** Cool-down after the quality block. Not included in miLow/miHigh. */
  cooldownMiLow: number;
  cooldownMiHigh: number;
}> = {
  value: {
    miLow: 3, miHigh: 8, durationMinLow: 20, durationMinHigh: 40, paceAnchor: 'threshold',
    warmupMiLow: 1.5, warmupMiHigh: 2,
    cooldownMiLow: 1, cooldownMiHigh: 1.5,
  },
  note: '"Comfortably hard" — sustainable for ~1 hour in a race. 20 min minimum for stimulus. WU/CD miles are easy and counted in total session distance.',
  citations: [
    cite('§5.2 Continuous tempo', '3-8 mi at T pace. 20-40 min sweet spot. Include 1-2 mi WU + 1 mi CD.', 'research', '04'),
  ],
};

/** Daniels cruise intervals — broken-tempo at T. */
export const THRESHOLD_INTERVALS: Cited<{
  miReps: number;
  repsLow: number;
  repsHigh: number;
  recoveryJogSecLow: number;
  recoveryJogSecHigh: number;
  weeklyMileagePctCap: number;
  warmupMiLow: number;
  warmupMiHigh: number;
  cooldownMiLow: number;
  cooldownMiHigh: number;
  /** Per-level rep counts. Research/22 §3 sample weeks + Research/04 §5.3. */
  perLevel: {
    beginner:     { repsLow: number; repsHigh: number; miReps: number };
    intermediate: { repsLow: number; repsHigh: number; miReps: number };
    advanced:     { repsLow: number; repsHigh: number; miReps: number };
  };
  /** HM-specific variant: cruise intervals at HM pace, not T pace. */
  hmSpecific: {
    repsLow: number; repsHigh: number; miReps: number; recoveryJogSecLow: number; recoveryJogSecHigh: number;
  };
}> = {
  value: {
    miReps: 1,
    repsLow: 3, repsHigh: 6,
    recoveryJogSecLow: 60, recoveryJogSecHigh: 90,
    weeklyMileagePctCap: 10,
    warmupMiLow: 1.5, warmupMiHigh: 2,
    cooldownMiLow: 1, cooldownMiHigh: 1.5,
    perLevel: {
      beginner:     { repsLow: 2, repsHigh: 4, miReps: 1 },
      intermediate: { repsLow: 3, repsHigh: 5, miReps: 1 },
      advanced:     { repsLow: 3, repsHigh: 6, miReps: 1 },
    },
    hmSpecific: { repsLow: 2, repsHigh: 3, miReps: 2, recoveryJogSecLow: 60, recoveryJogSecHigh: 90 },
  },
  note: "Daniels' staple: 3-6 × 1 mile at T with 60-90 s jog, or 2-4 × 2 mi with 2 min jog. HM-specific variant: 3×2 mi or 2×3 mi at HM pace. Recovery: 1 min jog per mi of work.",
  citations: [
    cite('§5.3 Cruise intervals (Daniels)', '3-6 × 1 mi with 1 min jog, or 2-4 × 2 mi with 2 min jog. Total at-pace 4-8 mi (Daniels: cap T-pace at 10% of weekly mileage).', 'research', '04'),
    cite('§3 Half Marathon Plans', 'HM-specific threshold: 3×2 mi at HM effort, 90 sec jog. Or 2×3 mi at HM effort, 2 min jog.', 'research', '22'),
  ],
};

/** Sub-threshold (Norwegian) intervals — large weekly threshold volume. */
export const SUB_THRESHOLD: Cited<{
  /** 1K reps (most common). */
  reps1KLow: number;
  reps1KHigh: number;
  /** 2K reps option. */
  reps2KLow: number;
  reps2KHigh: number;
  recoverySLow: number;
  recoverySHigh: number;
  /** Pace offset slower than T. */
  slowerThanTSPerMiLow: number;
  slowerThanTSPerMiHigh: number;
  lactateMmolLLow: number;
  lactateMmolLHigh: number;
}> = {
  value: {
    reps1KLow: 5, reps1KHigh: 10,
    reps2KLow: 4, reps2KHigh: 6,
    recoverySLow: 60, recoverySHigh: 90,
    slowerThanTSPerMiLow: 10, slowerThanTSPerMiHigh: 15,
    lactateMmolLLow: 2.5, lactateMmolLHigh: 3.5,
  },
  note: 'The Norwegian-singles adaptation. Lactate target 2.5-3.5 mmol/L (below LT2). Requires honest pace discipline — going too hard collapses the model.',
  citations: [
    cite('§5.4 Sub-threshold (Norwegian) intervals', '5-10 × 1K, or 4-6 × 2K, or 4-6 × 6 min. ~10-15 s/mi slower than T. 60-90 s jog (short, by design).', 'research', '04'),
  ],
};

/** Phase-keyed threshold session progression for half-marathon training.
 *  Plan-builder uses this to pick the right session type per phase so
 *  the plan "runs itself" and the coach voice can explain the rationale.
 *
 *  Phases: BASE → cruise intervals; BUILD → continuous tempo / long blocks;
 *  PEAK → continuous near HMP. All derived from Research/04 §5 + Research/22 §3. */
export const THRESHOLD_SESSION_PROGRESSION: Cited<Record<
  'BASE' | 'BUILD_EARLY' | 'BUILD_LATE' | 'PEAK' | 'TAPER',
  {
    /** Short session label for the calendar tile. */
    label: string;
    /** Full session prescription shown in the workout card notes. */
    prescription: string;
    /** Key citation anchor. */
    citation: string;
  }
>> = {
  value: {
    BASE: {
      label: 'Cruise Intervals',
      prescription: 'Cruise intervals — warm up 1.5 mi easy, then 5 × 1K at threshold (comfortably hard, 1 min jog between). Finish with 1 mi easy. If 1K feels too short, swap to 4 × 1 mile at the same effort. This is where your body learns to clear lactate while moving fast — it won\'t feel dramatic, but it compounds. (Research/04 §5.3)',
      citation: 'Research/04 §5.3 Cruise intervals — 3-6 × 1 mi with 1 min jog, or 5 × 1K.',
    },
    BUILD_EARLY: {
      label: 'HM Cruise Intervals',
      prescription: '3 × 2 miles at goal half-marathon effort, 90 sec jog between. Warm up 1.5 mi, cool down 1 mi. This is the pace that needs to feel almost boring on race day — controlled, strong, sustainable. If it feels too hard right now, the pace target is right and your fitness will catch up. (Research/22 §3)',
      citation: 'Research/22 §3 — HM threshold: 3×2 mi at HM effort, 90 sec jog.',
    },
    BUILD_LATE: {
      label: 'HM Threshold Blocks',
      prescription: '2 × 3 miles at goal HM effort, 2 min jog between. Warm up 1.5 mi, cool down 1 mi. Controlled discomfort — short phrases, not sentences. Longer blocks teach your body to hold race-pace economy when you\'re actually tired. Nail this and the race-pace miles in the long run will feel familiar. (Research/22 §3)',
      citation: 'Research/22 §3 — HM threshold: 2×3 mi at HM effort, 2 min jog.',
    },
    PEAK: {
      label: 'HM Continuous Tempo',
      prescription: '4–5 miles continuous at goal HM effort — no rep structure, no breaks. Warm up 1.5 mi easy, cool down 1 mi. This is as close to racing as you get before taper. Your legs should be a little tired going in; that\'s what makes it specific. If you nail this one, race day gets a lot less mysterious. (Research/04 §5.2, Research/22 §3)',
      citation: 'Research/04 §5.2 + Research/22 §3 — PEAK: 4-5 mi continuous near HMP.',
    },
    TAPER: {
      label: 'Threshold Touch',
      prescription: 'Short threshold touch — 2 × 1.5 miles at T-pace, 90 sec jog between. The work is in the bank; this just keeps the engine warm. Don\'t add reps because you feel good. Feeling good is the taper doing its job — protect it. (Research/04 §5.3)',
      citation: 'Research/04 §5.3 — taper: cut volume, keep intensity.',
    },
  },
  note: 'Threshold session progression: BASE cruise intervals → BUILD HM-specific blocks → PEAK continuous near HMP → TAPER short touch. Every session at Research-cited pace targets.',
  citations: [
    cite('§5 Threshold training', 'T-pace = comfortably hard, 20-min race effort. Cruise intervals or continuous 20-40 min.', 'research', '04'),
    cite('§3 Half Marathon Plans', 'HM-specific threshold: 3×2 mi at HM effort, 90 sec jog. Or 2×3 mi, 2 min jog.', 'research', '22'),
  ],
};

/** Long tempo — HM-pace continuous. */
export const LONG_TEMPO: Cited<{
  miLow: number;
  miHigh: number;
  paceNote: string;
}> = {
  value: {
    miLow: 8, miHigh: 12,
    paceNote: 'Slightly slower than T — typically HM pace to T-minus-5 s/mi',
  },
  note: 'Marathon-specific aerobic stress; HM race rehearsal. High accumulated fatigue cost — schedule ≥2 easy days after.',
  citations: [
    cite('§5.5 Long tempo', '8-12 mi continuous, slightly slower than T pace.', 'research', '04'),
  ],
};

/** VO2max work — secondary importance for marathon training. */
export const VO2_INTERVALS: Cited<{
  totalWorkMiLow: number;
  totalWorkMiHigh: number;
  paceAnchor: '3K_to_5K';
  pctVO2maxLow: number;
  pctVO2maxHigh: number;
  recoveryFractionOfWorkLow: number;
  recoveryFractionOfWorkHigh: number;
  weeklyMileagePctCap: number;
  warmupMiLow: number;
  warmupMiHigh: number;
  cooldownMiLow: number;
  cooldownMiHigh: number;
  /** Rep distance variants with per-level defaults. Research/04 §6 + Research/22 §3. */
  repVariants: {
    m800:  { repsLow: number; repsHigh: number; recoveryEqualWork: true };
    m1000: { repsLow: number; repsHigh: number; recoveryEqualWork: true };
    m1200: { repsLow: number; repsHigh: number; recoverySec: number };
  };
  perLevel: {
    beginner:     { preferredVariant: 'm800';  repsLow: number; repsHigh: number };
    intermediate: { preferredVariant: 'm1000'; repsLow: number; repsHigh: number };
    advanced:     { preferredVariant: 'm1200'; repsLow: number; repsHigh: number };
  };
}> = {
  value: {
    totalWorkMiLow: 3, totalWorkMiHigh: 6,
    paceAnchor: '3K_to_5K',
    pctVO2maxLow: 95, pctVO2maxHigh: 100,
    recoveryFractionOfWorkLow: 0.5, recoveryFractionOfWorkHigh: 1.0,
    weeklyMileagePctCap: 8,
    warmupMiLow: 1.5, warmupMiHigh: 2,
    cooldownMiLow: 1, cooldownMiHigh: 1.5,
    repVariants: {
      m800:  { repsLow: 4, repsHigh: 8,  recoveryEqualWork: true },
      m1000: { repsLow: 4, repsHigh: 8,  recoveryEqualWork: true },
      m1200: { repsLow: 4, repsHigh: 6,  recoverySec: 180 },
    },
    perLevel: {
      beginner:     { preferredVariant: 'm800',  repsLow: 4, repsHigh: 6 },
      intermediate: { preferredVariant: 'm1000', repsLow: 5, repsHigh: 7 },
      advanced:     { preferredVariant: 'm1200', repsLow: 4, repsHigh: 6 },
    },
  },
  note: 'Daniels: each interval 3-5 min long; cap at 8% of weekly mileage; recovery roughly equals interval duration. Finish feeling like you could do one more rep.',
  citations: [
    cite('§6.1 VO2max family overview', 'Mile, 1200, 1000, 800, 600, 400 reps + Yasso 800s. Pace I (5K) to slightly faster.', 'research', '04'),
    cite('§6 VO2max workouts', 'Daniels rule: each interval 3-5 min; total at-pace ≤8% of weekly mileage; recovery roughly equals interval duration.', 'research', '04'),
    cite('§3 Half Marathon Plans', 'HM intermediate: 4×1200m @ I, 3 min jog. Advanced: 6×1200m @ I, 3 min jog.', 'research', '22'),
  ],
};

/** Strides — short bursts of fast running, neuromuscular maintenance. */
export const STRIDES: Cited<{
  distanceMLow: number;
  distanceMHigh: number;
  durationSLow: number;
  durationSHigh: number;
  repsLow: number;
  repsHigh: number;
  perWeekLow: number;
  perWeekHigh: number;
  /** Full walk-back or ~90 s jog — no accumulated fatigue. */
  recoveryNote: string;
  /** When to tag strides onto a run — end of easy, or standalone after warmup. */
  timingNote: string;
  /** Per-phase frequency. Research/22 §3 sample weeks show strides on Sat in every level. */
  perPhase: {
    base:         { perWeekLow: number; perWeekHigh: number };
    build:        { perWeekLow: number; perWeekHigh: number };
    peak:         { perWeekLow: number; perWeekHigh: number };
    taper:        { perWeekLow: number; perWeekHigh: number };
    maintenance:  { perWeekLow: number; perWeekHigh: number };
  };
}> = {
  value: {
    distanceMLow: 50, distanceMHigh: 100,
    durationSLow: 15, durationSHigh: 30,
    repsLow: 4, repsHigh: 8,
    perWeekLow: 2, perWeekHigh: 4,
    recoveryNote: 'Full walk-back (60-90 s) — no accumulated fatigue between reps.',
    timingNote: 'Append to end of easy run or Saturday run. Not before a hard workout.',
    perPhase: {
      base:        { perWeekLow: 2, perWeekHigh: 2 },
      build:       { perWeekLow: 2, perWeekHigh: 3 },
      peak:        { perWeekLow: 2, perWeekHigh: 3 },
      taper:       { perWeekLow: 2, perWeekHigh: 3 },
      maintenance: { perWeekLow: 2, perWeekHigh: 3 },
    },
  },
  note: 'Accelerate to mile-to-5K race pace; ~85-95% max effort, relaxed. Full walk-back recovery — no fatigue between strides. Tagged onto Saturday easy runs per Research/22 sample weeks.',
  citations: [
    cite('§7.2 Strides', '50-100m or 15-30 s each. 4-8 reps. Full walk-back or 60-90 s jog. 2-4×/week. End of an easy run, mid-warmup, or standalone.', 'research', '04'),
    cite('§3 Half Marathon Plans', 'HM intermediate peak: Sat 5 mi E + 6×ST. HM advanced peak: Sat 6 mi E + 8×ST.', 'research', '22'),
  ],
};

/** Hill sprints — same neuromuscular stimulus, lower injury risk. */
export const HILL_SPRINTS: Cited<{
  durationSLow: number;
  durationSHigh: number;
  gradePctLow: number;
  gradePctHigh: number;
  repsStart: number;
  repsBuildToHigh: number;
  recoveryMinLow: number;
  recoveryMinHigh: number;
}> = {
  value: {
    durationSLow: 8, durationSHigh: 15,
    gradePctLow: 8, gradePctHigh: 15,
    repsStart: 4, repsBuildToHigh: 12,
    recoveryMinLow: 2, recoveryMinHigh: 3,
  },
  note: 'Build leg power, tendon stiffness, neuromuscular drive; injury-resilient speed work. Steepest hill manageable with form.',
  citations: [
    cite('§7.3 Hill sprints', '8-15 s, all-out, on a steep (8-15%) hill. Walk down — full recovery. Start 4-6, build to 8-12.', 'research', '04'),
  ],
};

// ── Pace zone shorthand definitions ────────────────────────────────

/** Daniels' single-letter zones plus race-pace anchors. The cite()
 *  call points to the comprehensive pace-zone definitions. */
export const PACE_ZONE_SHORTHAND: Cited<Record<
  'E' | 'M' | 'T' | 'ST' | 'I' | 'R' | 'HM' | 'MP' | 'pace_10K' | 'pace_5K' | 'pace_3K',
  {
    name: string;
    physiologicalTarget: string;
    vo2maxPctLow: number | null;
    vo2maxPctHigh: number | null;
    hrMaxPctLow: number | null;
    hrMaxPctHigh: number | null;
    raceAnchor: string;
  }
>> = {
  value: {
    E:        { name: 'Easy',          physiologicalTarget: 'Aerobic base, capillary density, mitochondrial volume', vo2maxPctLow: 59,  vo2maxPctHigh: 74,   hrMaxPctLow: 65,   hrMaxPctHigh: 79,   raceAnchor: '~MP + 60-90 s/mi (1-2 min/mi slower than MP)' },
    M:        { name: 'Marathon',      physiologicalTarget: 'Marathon-specific aerobic',                              vo2maxPctLow: 75,  vo2maxPctHigh: 84,   hrMaxPctLow: 80,   hrMaxPctHigh: 89,   raceAnchor: 'Goal MP' },
    T:        { name: 'Threshold',     physiologicalTarget: 'Lactate threshold (LT2, ~4 mmol/L)',                     vo2maxPctLow: 86,  vo2maxPctHigh: 88,   hrMaxPctLow: 88,   hrMaxPctHigh: 90,   raceAnchor: '~1-hour race pace, ≈HM pace for sub-elite, ~10 mi pace for elites' },
    ST:       { name: 'Sub-threshold', physiologicalTarget: 'Below LT2, near LT1 (~2.5-3.5 mmol/L)',                   vo2maxPctLow: 80,  vo2maxPctHigh: 86,   hrMaxPctLow: 84,   hrMaxPctHigh: 88,   raceAnchor: '~10-15 s/mi slower than T' },
    I:        { name: 'Interval',      physiologicalTarget: 'VO2max',                                                 vo2maxPctLow: 95,  vo2maxPctHigh: 100,  hrMaxPctLow: 95,   hrMaxPctHigh: 100,  raceAnchor: '~3K-5K race pace' },
    R:        { name: 'Repetition',    physiologicalTarget: 'Speed/economy/anaerobic',                                vo2maxPctLow: null, vo2maxPctHigh: null, hrMaxPctLow: null, hrMaxPctHigh: null, raceAnchor: '~mile to 800m race pace' },
    HM:       { name: 'Half-marathon', physiologicalTarget: 'Slightly below T',                                       vo2maxPctLow: 84,  vo2maxPctHigh: 86,   hrMaxPctLow: 87,   hrMaxPctHigh: 90,   raceAnchor: 'Current HM race pace' },
    MP:       { name: 'Marathon pace', physiologicalTarget: 'High aerobic',                                           vo2maxPctLow: 75,  vo2maxPctHigh: 84,   hrMaxPctLow: 80,   hrMaxPctHigh: 89,   raceAnchor: 'Current MP' },
    pace_10K: { name: '10K race pace', physiologicalTarget: 'Just above T',                                           vo2maxPctLow: 88,  vo2maxPctHigh: 92,   hrMaxPctLow: 90,   hrMaxPctHigh: 93,   raceAnchor: 'Current 10K' },
    pace_5K:  { name: '5K race pace',  physiologicalTarget: 'At/near VO2max',                                         vo2maxPctLow: 95,  vo2maxPctHigh: 100,  hrMaxPctLow: 95,   hrMaxPctHigh: 98,   raceAnchor: 'Current 5K' },
    pace_3K:  { name: '3K race pace',  physiologicalTarget: 'Above VO2max',                                           vo2maxPctLow: 100, vo2maxPctHigh: 105,  hrMaxPctLow: null, hrMaxPctHigh: null, raceAnchor: 'Current 3K' },
  },
  citations: [
    cite('Pace zone shorthand', 'Daniels single-letter zones plus race-pace anchors. E/M/T/ST/I/R/HM/MP/10K/5K/3K with %VO2max, %HRmax, race anchor.', 'research', '04'),
  ],
};

// ── Workout catalog (the full taxonomy) ───────────────────────────

export type WorkoutFamily =
  | 'recovery' | 'easy' | 'medium_long' | 'long'
  | 'threshold' | 'vo2max' | 'speed' | 'hill'
  | 'fartlek' | 'combo' | 'marathon_specific'
  | 'cutdown' | 'ladder' | 'race_specific';

export type CyclePhase = 'base' | 'hill_strength' | 'specific_support' | 'race_specific' | 'sharpening_taper' | 'all_phases';

export interface CatalogEntry {
  id: string;
  family: WorkoutFamily;
  name: string;
  purpose: string;
  paceAnchor: string;
  /** Free-form structure description. */
  structure: string;
  recovery: string;
  frequency: string;
  cyclePlacement: CyclePhase[];
  contraindications?: string;
  variations?: string;
  /** Research §pointer for tracing a single workout. */
  researchSection: string;
}

/** Full workout catalog from Research/04. ~50 named workouts spanning
 *  every family. Engine looks up workouts here when a name comes from
 *  user input or external plan source. */
export const WORKOUT_CATALOG: Cited<CatalogEntry[]> = {
  value: [
    // §1 Recovery
    {
      id: 'recovery_run', family: 'recovery', name: 'Recovery run',
      purpose: 'Active recovery between hard sessions; promote circulation and waste clearance without adding training stress',
      paceAnchor: '~MP + 90+ s/mi, 60-70% HRmax',
      structure: '20-45 min continuous',
      recovery: 'n/a',
      frequency: 'Day after a hard session, or as a second daily run',
      cyclePlacement: ['all_phases'],
      contraindications: 'Replace with full rest if HRrest >7 bpm above baseline',
      variations: 'Recovery shakeout (15-20 min), double-day recovery, elliptical/cycle cross-train substitute',
      researchSection: '§1',
    },
    // §2 Easy / general aerobic
    {
      id: 'easy_aerobic', family: 'easy', name: 'Easy / general aerobic',
      purpose: 'Build aerobic base; develop capillary density, mitochondrial enzymes, slow-twitch fiber endurance',
      paceAnchor: 'E pace (Daniels) or 15-25% slower than MP (Pfitzinger)',
      structure: '30-75 min typical; up to 90 min for high-mileage runners',
      recovery: 'n/a',
      frequency: '3-5 days per week; bulk of weekly volume',
      cyclePlacement: ['all_phases'],
      contraindications: 'Drift toward M pace defeats the purpose — keep effort honest',
      variations: 'Pure easy, general aerobic (slightly faster end), with strides appended',
      researchSection: '§2',
    },
    // §3 Medium-long
    {
      id: 'medium_long', family: 'medium_long', name: 'Medium-long run',
      purpose: 'Extend aerobic stimulus mid-week without long-run recovery cost; bridge the gap between daily runs and the weekly long run',
      paceAnchor: 'Same as long-run pace: E to low M effort. ~15-20% slower than MP',
      structure: '11-15 mi (Pfitzinger)',
      recovery: 'n/a',
      frequency: '1×/week during marathon and HM specific phases',
      cyclePlacement: ['base', 'specific_support', 'race_specific'],
      contraindications: 'Don\'t run too hard — should not compete with the long run for recovery',
      variations: 'Plain MLR, MLR with strides, MLR with embedded T segment (advanced)',
      researchSection: '§3',
    },
    // §4 Long-run variants
    {
      id: 'base_long_run', family: 'long', name: 'Base long run',
      purpose: 'Build aerobic capacity, glycogen storage, and connective-tissue durability',
      paceAnchor: 'E pace. ~55-75% of 5K pace; 60-75% HRmax',
      structure: '90 min minimum for endurance benefit; 10-22+ mi (marathoners), 8-14 mi (5K/10K)',
      recovery: 'n/a',
      frequency: 'Weekly',
      cyclePlacement: ['base', 'specific_support', 'race_specific'],
      contraindications: 'Beginners cap at 20% of weekly mileage; avoid back-to-back hard days',
      researchSection: '§4.2',
    },
    {
      id: 'progression_long', family: 'long', name: 'Progression long run',
      purpose: 'Train the neuromuscular and metabolic skill of running faster while fatigued',
      paceAnchor: 'Start E, finish M to T',
      structure: 'First 1/3-1/2 at E, middle at strong E or M, final 1/4-1/3 at M to T. Example 16 mi: 6 mi E + 6 mi M + 4 mi T',
      recovery: 'None — continuous',
      frequency: 'Every 2-3 weeks in specific phase',
      cyclePlacement: ['specific_support', 'race_specific'],
      contraindications: 'Skip if accumulated fatigue is high; don\'t pair with other quality work in same week',
      researchSection: '§4.3',
    },
    {
      id: 'mp_long_run', family: 'long', name: 'Marathon-pace long run',
      purpose: 'Marathon-specific stimulus; rehearse race pace under fatigue',
      paceAnchor: 'MP exactly — not faster',
      structure: '14-22 mi total: easy warmup (2-4 mi) + 8-16 mi at MP + optional easy cooldown',
      recovery: 'n/a',
      frequency: 'Every 2-3 weeks during marathon specific phase',
      cyclePlacement: ['race_specific'],
      contraindications: 'Don\'t run if calf/Achilles/hip is flagging — MP is high-stress for soft tissue',
      variations: 'MP locked in second half (harder), MP from the start (hardest), MP with surges',
      researchSection: '§4.4',
    },
    {
      id: 'fast_finish_long', family: 'long', name: 'Fast finish long run',
      purpose: 'Train ability to find pace late; mental rehearsal of "the last 10K"',
      paceAnchor: 'Bulk at E (1-2 min/mi slower than MP), final 2-6 mi at MP or slightly faster',
      structure: '12-18 mi total. Example: 16 mi total with last 4 at MP; or 14 mi with last 3 at MP, last 1 sub-MP',
      recovery: 'None',
      frequency: 'Every 2-3 weeks',
      cyclePlacement: ['race_specific'],
      researchSection: '§4.5',
    },
    {
      id: 'dress_rehearsal_long', family: 'long', name: 'Dress rehearsal long run',
      purpose: 'Final equipment, fueling, and timing rehearsal',
      paceAnchor: 'Easy bulk + 2-3 segments at MP (4-8 mi total at MP)',
      structure: '18-22 mi (marathon); 12-14 mi (HM). Race-day breakfast, race-day kit, race-day fueling intervals',
      recovery: 'n/a',
      frequency: 'Once, 3 weeks pre-marathon',
      cyclePlacement: ['sharpening_taper'],
      contraindications: 'Not a fitness builder — keep effort controlled',
      researchSection: '§4.6',
    },
    // §5 Threshold
    {
      id: 'continuous_tempo', family: 'threshold', name: 'Continuous tempo',
      purpose: 'Raise lactate threshold; build mental tolerance to sustained discomfort',
      paceAnchor: 'T pace (86-88% VO2max, 88-90% HRmax)',
      structure: '3-8 mi continuous, 20-40 min sweet spot. WU 2-3 mi E + tempo + CD 2-3 mi E',
      recovery: 'None — single block',
      frequency: '1×/week or alternating with cruise intervals',
      cyclePlacement: ['base', 'specific_support', 'race_specific'],
      contraindications: 'Skip if HR/perceived effort elevated — pace will lie',
      variations: 'Cutdown tempo (start MP, finish T), wave tempo (alternate ±10 s/mi around T)',
      researchSection: '§5.2',
    },
    {
      id: 'cruise_intervals', family: 'threshold', name: 'Cruise intervals (Daniels)',
      purpose: 'Accumulate more time at T than a single tempo allows',
      paceAnchor: 'T pace',
      structure: '3-6 × 1 mi with 1 min jog, or 2-4 × 2 mi with 2 min jog',
      recovery: '1 min jog per mile of work segment',
      frequency: '1×/week',
      cyclePlacement: ['specific_support', 'race_specific', 'sharpening_taper'],
      contraindications: 'Lengthening rest changes the workout — keep recoveries short',
      variations: 'Cruise + threshold (4 × 1 mi + 2 mi continuous), cruise pyramid (1-2-1-2-1)',
      researchSection: '§5.3',
    },
    {
      id: 'sub_threshold_norwegian', family: 'threshold', name: 'Sub-threshold (Norwegian) intervals',
      purpose: 'Accumulate large weekly threshold volume without the systemic cost of tempo',
      paceAnchor: 'ST: ~10-15 s/mi slower than T; lactate target 2.5-3.5 mmol/L',
      structure: 'Single threshold: 5-10 × 1K, or 4-6 × 2K, or 4-6 × 6 min. Double threshold (advanced): AM 4-6 × 1K ST + PM 8-10 × 1K slightly faster ST',
      recovery: '60-90 s jog (short, by design)',
      frequency: '2×/week (singles) or 1 double-day every 4-7 days',
      cyclePlacement: ['base', 'specific_support', 'race_specific'],
      contraindications: 'Doubles require high training age and low life stress',
      variations: 'Hill ST intervals (Ingebrigtsen variant), 1000m at ST descending across the set',
      researchSection: '§5.4',
    },
    {
      id: 'long_tempo', family: 'threshold', name: 'Long tempo',
      purpose: 'Marathon-specific aerobic stress; HM race rehearsal',
      paceAnchor: 'Slightly slower than T — typically HM pace to T-minus-5 s/mi',
      structure: '8-12 mi continuous. WU/CD 1-2 mi E each side',
      recovery: 'None',
      frequency: 'Every 2-3 weeks in specific phase',
      cyclePlacement: ['race_specific'],
      contraindications: 'High accumulated fatigue cost — schedule ≥2 easy days after',
      variations: '2 × 5 mi at HM with 3 min jog (split version), 8 mi MP + 2 mi T (combo)',
      researchSection: '§5.5',
    },
    // §6 VO2max
    {
      id: 'mile_repeats_vo2', family: 'vo2max', name: 'Mile repeats (VO2max)',
      purpose: 'Develop VO2max and 5K/10K-specific endurance; build tolerance to sustained hard effort',
      paceAnchor: 'I pace (≈5K race pace). For HM training, slow to slightly faster than HM',
      structure: '3-6 × 1 mi. WU 2-3 mi E + drills + 2-4 strides; CD 1-2 mi E',
      recovery: 'Jog rest ≈ rep time. 3:00-5:00 typical',
      frequency: 'Every 7-10 days',
      cyclePlacement: ['specific_support', 'race_specific'],
      contraindications: 'Avoid in week of taper (last hard session ≥10 days out)',
      variations: 'Mile repeats descending, mile repeats at HM pace, broken miles (1200+400)',
      researchSection: '§6.2',
    },
    {
      id: '1000m_repeats', family: 'vo2max', name: '1000m repeats',
      purpose: 'Classic VO2max workout — ideal interval duration (3-4 min) for maxing out aerobic power',
      paceAnchor: 'I pace',
      structure: '5-8 × 1K',
      recovery: '2:00-3:00 jog (≈ rep time, 200-400m jog)',
      frequency: 'Weekly during VO2max block',
      cyclePlacement: ['race_specific'],
      variations: '5 × 1K cutdown, 4 × 1K + 4 × 400, 3 × (2 × 1K) with longer set rest',
      researchSection: '§6.3',
    },
    {
      id: '800m_repeats', family: 'vo2max', name: '800m repeats',
      purpose: 'VO2max with slightly more turnover than 1Ks; classic 5K specific',
      paceAnchor: 'I pace (≈3K-5K)',
      structure: '6-10 × 800m',
      recovery: '2:00-3:00 jog (≈ rep time)',
      frequency: 'Weekly during VO2 block',
      cyclePlacement: ['race_specific'],
      contraindications: 'Avoid running first reps too fast — first rep should not be the fastest',
      variations: '8 × 800 at 5K pace (classic), Yasso 800s, 800s descending',
      researchSection: '§6.4',
    },
    {
      id: '600m_repeats', family: 'vo2max', name: '600m repeats',
      purpose: 'Bridge between true VO2 and faster turnover; useful for milers and 5K runners',
      paceAnchor: 'I to slightly faster than I (≈3K pace)',
      structure: '8-12 × 600m',
      recovery: '2:00-3:00 jog or 400m jog',
      frequency: 'Every 7-10 days',
      cyclePlacement: ['specific_support', 'race_specific'],
      researchSection: '§6.5',
    },
    {
      id: '400m_repeats', family: 'vo2max', name: '400m repeats',
      purpose: 'Edge between VO2 and speed; develops anaerobic component and turnover',
      paceAnchor: '3K-5K race pace (faster than pure I)',
      structure: '8-16 × 400m',
      recovery: '90 s - 2 min jog (or 200-400m jog)',
      frequency: 'Weekly in 5K specific phase',
      cyclePlacement: ['race_specific'],
      contraindications: 'Pure 400s alone are inefficient for VO2max (takes ~2 min to elicit VO2max). Use as part of a longer set or for speed/economy',
      variations: '16 × 400 at 5K (classic), 12 × 400 alternating I/R, 4 × (4 × 400)',
      researchSection: '§6.6',
    },
    {
      id: 'yasso_800s', family: 'vo2max', name: 'Yasso 800s',
      purpose: 'Marathon prediction workout (Bart Yasso, 1994); VO2max stimulus',
      paceAnchor: 'Time per 800 in min:sec = goal marathon time in hr:min. ≈ 5K to 10K race pace',
      structure: 'Build from 4 → 10 reps across cycle. Final session: 10 × 800',
      recovery: 'Jog the same time it took to run the 800 (~400m)',
      frequency: '1×/week during build',
      cyclePlacement: ['race_specific'],
      contraindications: 'Don\'t substitute for marathon-specific work — VO2max session, not MP-specific. Last benchmark 10-14 days before goal marathon.',
      researchSection: '§6.7',
    },
    // §7 Speed
    {
      id: 'strides', family: 'speed', name: 'Strides',
      purpose: 'Neuromuscular activation; recruit fast-twitch fibers; refine form on easy days',
      paceAnchor: 'Mile to 5K race pace; ~85-95% max effort, relaxed',
      structure: '50-100m or 15-30s each. 4-8 reps',
      recovery: 'Full walk-back or 60-90 s jog — no fatigue between strides',
      frequency: '2-4×/week',
      cyclePlacement: ['all_phases'],
      contraindications: 'Not a workout — back off if form deteriorates',
      variations: 'Hill strides, in-and-out strides (accelerate-cruise-accelerate), strides on grass for impact-sensitive runners',
      researchSection: '§7.2',
    },
    {
      id: 'hill_sprints', family: 'speed', name: 'Hill sprints',
      purpose: 'Build leg power, tendon stiffness, neuromuscular drive; injury-resilient speed work',
      paceAnchor: 'Max effort, all-out',
      structure: '8-15 s on steep (8-15%) hill. Start 4-6 reps, build to 8-12',
      recovery: 'Walk down — full recovery (2-3 min)',
      frequency: '1-2×/week',
      cyclePlacement: ['all_phases'],
      contraindications: 'Not for first-month-back runners; require base of easy running',
      variations: 'Single-leg bounding hills, alternating sprint/stride hills',
      researchSection: '§7.3',
    },
    {
      id: '200m_repeats', family: 'speed', name: '200m repeats',
      purpose: 'Speed development; running economy; race-finish kick',
      paceAnchor: 'R pace (≈ mile race pace)',
      structure: '8-12 × 200m',
      recovery: '200m jog (full recovery, equal-distance jog)',
      frequency: 'Weekly during speed block; 1× every 2 weeks otherwise',
      cyclePlacement: ['base', 'race_specific', 'sharpening_taper'],
      contraindications: 'Cap at 5% weekly mileage; don\'t shorten the rest',
      variations: '200-200-400 cycles (Daniels), 200m descending, 200m at mile pace into 200m float',
      researchSection: '§7.4',
    },
    {
      id: '100m_repeats', family: 'speed', name: '100m repeats',
      purpose: 'Pure speed; turnover; mechanics',
      paceAnchor: 'R pace or faster',
      structure: '8-16 × 100m',
      recovery: '100m walk or jog — full recovery',
      frequency: '1×/week or as part of warmup for longer sessions',
      cyclePlacement: ['all_phases'],
      variations: '10 × 100 alternating fast/relaxed, 100m fly-ins',
      researchSection: '§7.5',
    },
    // §8 Hill
    {
      id: 'short_hill_repeats', family: 'hill', name: 'Short hill repeats',
      purpose: 'Power, tendon stiffness, form; gateway speed work',
      paceAnchor: '90-95% effort, controlled',
      structure: '8-16 × 10-30 s on 4-7% grade (100-150m)',
      recovery: 'Walk or jog back to start; full recovery',
      frequency: '1×/week base phase; 1× every 2 weeks specific',
      cyclePlacement: ['base', 'hill_strength'],
      variations: 'Progressive hills (build set length over weeks), hill ladder (10s-20s-30s)',
      researchSection: '§8.2',
    },
    {
      id: 'medium_hill_repeats', family: 'hill', name: 'Medium hill repeats',
      purpose: 'Aerobic + strength stimulus; bridges short hills and long hills',
      paceAnchor: '~5K-10K effort',
      structure: '6-10 × 60-90 s on 4-6% grade',
      recovery: '2-3 min jog down',
      frequency: 'Weekly',
      cyclePlacement: ['hill_strength', 'specific_support'],
      researchSection: '§8.3',
    },
    {
      id: 'long_hill_repeats', family: 'hill', name: 'Long hill repeats',
      purpose: 'VO2max with hill-strength stimulus; substitute for flat intervals when injury-prone',
      paceAnchor: 'T to 10K effort. First half slightly slower, build aggressively',
      structure: '4-8 × 3-5 min on 3-5% grade',
      recovery: 'Equal-time jog down',
      frequency: 'Weekly',
      cyclePlacement: ['specific_support', 'race_specific'],
      researchSection: '§8.4',
    },
    {
      id: 'lydiard_hill_circuit', family: 'hill', name: 'Lydiard hill circuit',
      purpose: 'Strength endurance bridge between base and speed phases',
      paceAnchor: 'Sequence of efforts: bound-up / jog-flat / stride-down / wind-sprints',
      structure: '~1.9 mi loop: 800m of springing/bounding uphill, 800m flat jog, 700m fast relaxed striding downhill, 800m wind sprints. 3-6 laps. Total 45-75 min',
      recovery: 'Built into loop',
      frequency: '2-3×/week during 4-week hill phase',
      cyclePlacement: ['hill_strength'],
      contraindications: 'High orthopedic stress; not for novice runners',
      variations: 'Modern abbreviated circuit (single hill with bound up, jog flat, stride down)',
      researchSection: '§8.5',
    },
    {
      id: 'hill_fartlek', family: 'hill', name: 'Hill fartlek',
      purpose: 'Continuous-run hill stimulus; rolling-terrain race prep',
      paceAnchor: 'Hard on uphills, easy on downhills/flats',
      structure: '30-60 min run on hilly course; surge each climb, recover on descent and flats. Total 5-10 min uphill surging',
      recovery: 'On descents and flats',
      frequency: 'Weekly or biweekly',
      cyclePlacement: ['base', 'hill_strength'],
      variations: 'Mona-style on hills, pyramid hill fartlek',
      researchSection: '§8.6',
    },
    // §9 Fartlek
    {
      id: 'mona_fartlek', family: 'fartlek', name: 'Mona fartlek',
      purpose: 'High-intensity total-package workout in 20 min; recovery-on-the-run skill',
      paceAnchor: '90 s reps at 5K effort; 15 s reps at mile effort; floats are recovery jogs',
      structure: '2 × 90s/90s float, 4 × 60s/60s float, 4 × 30s/30s float, 4 × 15s/15s float = 20 min, 14 reps. WU/CD 15 min E each side',
      recovery: 'Floats are recovery jogs (not stops)',
      frequency: 'Weekly or every 10 days',
      cyclePlacement: ['base', 'specific_support', 'race_specific'],
      contraindications: 'Can be sandbagged or overcooked easily — keep efforts honest',
      variations: 'Half Mona, Mona on hills, Mona with extended floats',
      researchSection: '§9.2',
    },
    {
      id: 'michigan_fartlek', family: 'fartlek', name: 'Michigan fartlek',
      purpose: 'Cross-country race simulation: pace changes on varied surfaces',
      paceAnchor: 'Track at mile/3K effort; road at threshold/MP',
      structure: 'Mile track / 3 min jog / Mile road / 3 min jog / 1200m track / 3 min jog / 1200m road / 3 min jog / 800m track / 3 min jog / 800m road / 3 min jog / 400m track all-out',
      recovery: '3 min jog between segments',
      frequency: '1× per training cycle (signature workout)',
      cyclePlacement: ['race_specific'],
      contraindications: 'Logistically demanding; substitute alternating surfaces if no road/track adjacent',
      variations: 'Shortened Michigan (drop 800/400), all-track Michigan',
      researchSection: '§9.3',
    },
    {
      id: 'lydiard_fartlek', family: 'fartlek', name: 'Classic Lydiard fartlek',
      purpose: 'Free-form pace play; reintroduce surges in base phase',
      paceAnchor: 'Easy bulk; surges from 30 s to 3 min at moderate-to-hard effort',
      structure: '45-60 min continuous run with 4-10 surges of varying length and intensity by feel',
      recovery: 'Easy running between surges',
      frequency: 'Weekly or biweekly during base',
      cyclePlacement: ['base'],
      variations: 'Telephone-pole fartlek (surge between landmarks), partner fartlek',
      researchSection: '§9.4',
    },
    {
      id: 'time_based_fartlek', family: 'fartlek', name: 'Time-based fartlek',
      purpose: 'Structured pace variation without track or measured course',
      paceAnchor: '"On" segments at 5K-10K effort; floats are easy jog',
      structure: 'Common: 6×3 min on / 2 min off; 8×2 min on / 1 min off; 1-2-3-4-3-2-1 min ladder',
      recovery: 'Floats',
      frequency: 'Weekly or biweekly',
      cyclePlacement: ['base'],
      researchSection: '§9.5',
    },
    // §10 Combo / alternation
    {
      id: 'mp_10k_alternations', family: 'combo', name: 'MP/10K alternations',
      purpose: 'Marathon-specific lactate-clearance training; teaches surging at race pace',
      paceAnchor: 'Faster segments at 10K to HM pace; recovery segments at MP (NOT easy)',
      structure: 'Long: 1 mi MP / 1 mi 10K, ×5-8. Entry: 1 mi MP / 400m 10K, ×6-10. Total 8-15 mi continuous',
      recovery: 'None — continuous',
      frequency: 'Every 2-3 weeks',
      cyclePlacement: ['race_specific'],
      contraindications: 'High accumulated stress — full easy day before and after',
      variations: 'Progressive (faster segments lengthen), Nate Jenkins MP/HM alternations',
      researchSection: '§10.1',
    },
    {
      id: 'threshold_vo2_combo', family: 'combo', name: 'Threshold + VO2 combo',
      purpose: 'Bridge stamina and aerobic-power systems in one session',
      paceAnchor: 'Each block at its own zone',
      structure: 'Common: 2 mi T + 4×800 I; 4 mi T + 6×400 R; 3×1 mi T + 4×1K I',
      recovery: '2-3 min between blocks; standard recoveries within each block',
      frequency: 'Every 2-3 weeks specific',
      cyclePlacement: ['race_specific'],
      contraindications: 'Don\'t combine zones if either system is undertrained — practice each in isolation first',
      researchSection: '§10.2',
    },
    {
      id: 'wave_tempo', family: 'combo', name: 'Wave tempo',
      purpose: 'Continuous threshold with rhythmic pace variation',
      paceAnchor: 'Average comes out near T',
      structure: '4-8 mi continuous, alternating ±5-15 s/mi around T pace, 30 s to 2 min per segment',
      recovery: 'None — continuous',
      frequency: 'Every 2-3 weeks',
      cyclePlacement: ['race_specific'],
      researchSection: '§10.3',
    },
    // §11 Marathon-specific
    {
      id: 'canova_special_block', family: 'marathon_specific', name: 'Canova special block',
      purpose: 'Massive marathon-specific stimulus over a single calendar day; depletes glycogen and trains under-fatigue running',
      paceAnchor: 'AM/PM both at ~90% effort',
      structure: 'Two sessions, same day, ~6-8 hours apart. 45-50 km total. AM: 25-30 km progressive long with last portion at MP. PM: 15-20 km with 10-12 km at MP, or 4-6 × 2K at MP',
      recovery: '6-8 hours between sessions, minimal carb intake',
      frequency: '2-3× per marathon cycle, 2-3 weeks between blocks',
      cyclePlacement: ['race_specific'],
      contraindications: 'Elite-level workout; sub-elite scale to ~30-40 km total. Requires high training age',
      variations: 'Modified block (single longer run with two segments separated by short rest)',
      researchSection: '§11.1',
    },
    {
      id: 'canova_2k_repeats', family: 'marathon_specific', name: 'Canova 2K repeats',
      purpose: 'Marathon-specific aerobic; threshold-zone work in race-relevant rep length',
      paceAnchor: 'Start slightly slower than MP; descend across reps to slightly faster than T. Each rep 2.5-5 s/km faster than the previous',
      structure: '4-8 × 2K. Total 8-16 K at quality',
      recovery: '2-3 min jog (60-90 s for advanced)',
      frequency: 'Every 10-14 days in specific phase',
      cyclePlacement: ['race_specific'],
      contraindications: 'Pacing requirement: even pace within each rep — Canova/Arcelli emphasize a tempo trainer',
      variations: '2 × 3K + 3 × 2K (Kipsang pre-WR), 5 × 2K all at MP, 6 × 2K cutdown',
      researchSection: '§11.2',
    },
    {
      id: 'pre_fatigue_mp', family: 'marathon_specific', name: 'Pre-fatigue MP work',
      purpose: 'Train MP execution under glycogen depletion',
      paceAnchor: 'MP exact',
      structure: '(a) 14-18 mi easy Saturday + 6-10 mi MP Sunday; (b) 8 mi easy + immediate 8 mi MP; (c) 2-day back-to-back doubles',
      recovery: 'n/a',
      frequency: 'Every 3-4 weeks specific',
      cyclePlacement: ['race_specific'],
      contraindications: 'Highest accumulated stress workout; must be followed by ≥2 easy/recovery days',
      researchSection: '§11.4',
    },
    // §12 Cutdown / progression
    {
      id: 'mile_cutdowns', family: 'cutdown', name: 'Mile cutdowns',
      purpose: 'Progressive load; final reps at I/R pace force composure under fatigue',
      paceAnchor: 'Start slower than MP; each rep 5-15 s/mi faster. Final at 5K pace or faster',
      structure: '3-6 × 1 mi. Example 6 reps: MP+10, MP, MP-10, HM, T, 10K',
      recovery: '60-90 s jog (Daniels-style cruise rest)',
      frequency: 'Every 2 weeks specific phase',
      cyclePlacement: ['specific_support', 'race_specific'],
      variations: '3-2-1 mile cutdown',
      researchSection: '§12.2',
    },
    {
      id: '1k_cutdowns', family: 'cutdown', name: '1K cutdowns',
      purpose: 'Smaller-dose cutdown; useful for taper sharpening',
      paceAnchor: 'Start at MP, finish at 5K. Each ~5 s/mi faster',
      structure: '5-8 × 1K',
      recovery: '60-90 s jog (or 200m jog)',
      frequency: 'Every 7-10 days specific',
      cyclePlacement: ['race_specific', 'sharpening_taper'],
      researchSection: '§12.3',
    },
    {
      id: '5k_progression', family: 'cutdown', name: '5K progression',
      purpose: 'Race-pace skill; teach negative split',
      paceAnchor: 'Start ~30 s/mi slower than 5K, finish at or below 5K pace',
      structure: '5K continuous: first third at HM, middle at T, final third at 10K-5K',
      recovery: 'None',
      frequency: 'Every 2 weeks',
      cyclePlacement: ['race_specific'],
      researchSection: '§12.4',
    },
    {
      id: 'continuous_mile_cutdown', family: 'cutdown', name: 'Continuous mile cutdown',
      purpose: 'Tempo-cutdown hybrid; sustained progression',
      paceAnchor: 'Start MP+15, drop to slightly faster than HM by final mile',
      structure: '5-7 mi continuous, each mile ~10-15 s/mi faster than prior',
      recovery: 'None',
      frequency: 'Every 2 weeks specific',
      cyclePlacement: ['race_specific'],
      researchSection: '§12.5',
    },
    // §13 Ladder
    {
      id: '400_800_1200_1600_ladder', family: 'ladder', name: '400-800-1200-1600 ladder',
      purpose: 'Build mental load; finishing on long rep tests stamina',
      paceAnchor: '400 at mile/3K; 800 at 3K/5K; 1200 at 5K/10K; 1600 at 10K/HM',
      structure: 'Ascending or descending rep sequence',
      recovery: 'Jog ≈ rep duration: 90 s after 400, 3 min after 800, 4 min after 1200, 4-5 min after 1600',
      frequency: 'Every 10-14 days specific',
      cyclePlacement: ['race_specific'],
      variations: 'Reps run all at 5K (constant-pace ladder), reps each at goal pace for that distance',
      researchSection: '§13.2',
    },
    {
      id: 'up_and_down_ladder', family: 'ladder', name: 'Up-and-down ladder (pyramid)',
      purpose: 'Hits multiple zones; tests both stamina and finish',
      paceAnchor: '5K to 10K range; sometimes ladder pace (faster on shorter reps)',
      structure: '400-800-1200-1600-1200-800-400 (or 200-400-800-1200-800-400-200). Total 8 K full version',
      recovery: 'Equal time jog after each rep',
      frequency: 'Every 2-3 weeks specific',
      cyclePlacement: ['race_specific'],
      researchSection: '§13.3',
    },
    // §14 Race-specific
    {
      id: '4x2mi_at_hm', family: 'race_specific', name: '4 × 2 mi at HM pace',
      purpose: 'HM readiness predictor; completing in control 2 weeks before race indicates readiness',
      paceAnchor: 'HM race pace',
      structure: '4 × 2 mi',
      recovery: '60-120 s jog',
      frequency: 'Once, 2 weeks before goal HM',
      cyclePlacement: ['race_specific', 'sharpening_taper'],
      researchSection: '§14.3',
    },
    {
      id: 'mile_repeats_at_5k', family: 'race_specific', name: 'Mile repeats at 5K pace',
      purpose: '5K race-pace simulation',
      paceAnchor: '5K race pace',
      structure: '4-5 × 1 mi',
      recovery: '2-3 min jog',
      frequency: 'Every 7-10 days in 5K specific phase',
      cyclePlacement: ['race_specific'],
      researchSection: '§14.1',
    },
    {
      id: 'mile_repeats_at_10k', family: 'race_specific', name: 'Mile repeats at 10K pace',
      purpose: '10K race-pace simulation',
      paceAnchor: '10K race pace',
      structure: '5-6 × 1 mi',
      recovery: '60 s jog',
      frequency: 'Every 7-10 days in 10K specific phase',
      cyclePlacement: ['race_specific'],
      researchSection: '§14.2',
    },
    {
      id: '12x400_at_5k', family: 'race_specific', name: '12 × 400 at 5K pace',
      purpose: 'Classic 5K simulator',
      paceAnchor: '5K race pace',
      structure: '12 × 400m',
      recovery: '60-90 s jog',
      frequency: 'Weekly in 5K specific phase',
      cyclePlacement: ['race_specific'],
      researchSection: '§14.1',
    },
    {
      id: '3k_reps', family: 'race_specific', name: '3K repeats',
      purpose: 'Long-rep stamina for 5K-HM range',
      paceAnchor: '10K to HM pace',
      structure: '2-3 × 3K',
      recovery: '3 min jog',
      frequency: 'Every 10-14 days',
      cyclePlacement: ['race_specific'],
      researchSection: '§14.1',
    },
    {
      id: '2k_reps', family: 'race_specific', name: '2K repeats',
      purpose: '10K race-pace volume',
      paceAnchor: '10K race pace',
      structure: '4-5 × 2K',
      recovery: '2-3 min jog',
      frequency: 'Every 10-14 days specific',
      cyclePlacement: ['race_specific'],
      researchSection: '§14.2',
    },
  ],
  citations: [
    cite('§1-§14 Workout taxonomy', 'Full library of named running workouts with purpose, pace anchor, structure, recovery, frequency, cycle placement, contraindications, variations.', 'research', '04'),
  ],
};

// ── Family overviews ───────────────────────────────────────────────

/** Long-run family — the cornerstone weekly session in distance training. */
export const LONG_RUN_FAMILY: Cited<Array<{
  variant: string;
  distanceOrDuration: string;
  paceStructure: string;
  primaryStimulus: string;
  typicalPlacement: string;
}>> = {
  value: [
    { variant: 'Base long run',                distanceOrDuration: '90 min - 2:30; up to 22 mi for marathoners', paceStructure: 'E throughout',                              primaryStimulus: 'Aerobic capacity, glycogen storage, fat oxidation', typicalPlacement: 'Base phase, all distances' },
    { variant: 'Progression long run',         distanceOrDuration: '12-22 mi',                                    paceStructure: 'Start E, finish M to T',                    primaryStimulus: 'Late-run pace tolerance',                          typicalPlacement: 'Specific phase' },
    { variant: 'Marathon-pace long run',       distanceOrDuration: '14-22 mi',                                    paceStructure: 'Easy warmup + 8-16 mi at MP',               primaryStimulus: 'Marathon-specific economy',                        typicalPlacement: 'Marathon specific phase' },
    { variant: 'Fast finish long run',         distanceOrDuration: '12-18 mi',                                    paceStructure: 'Easy bulk + last 2-6 mi at MP or faster',    primaryStimulus: 'Late-stage pace skill, mental toughness',          typicalPlacement: 'Marathon and HM specific' },
    { variant: 'Dress rehearsal long run',     distanceOrDuration: '18-22 mi',                                    paceStructure: 'Easy + MP segments; full race-day setup',   primaryStimulus: 'Fueling/gear/timing rehearsal',                   typicalPlacement: '3 weeks pre-marathon' },
  ],
  citations: [
    cite('§4.1 Long-run family overview', 'Variant / distance / pace structure / primary stimulus / typical placement', 'research', '04'),
  ],
};

/** Threshold workout family — LT2 and the band just below it. */
export const THRESHOLD_FAMILY: Cited<Array<{
  workout: string;
  volume: string;
  pace: string;
  recovery: string;
  totalAtPace: string;
}>> = {
  value: [
    { workout: 'Continuous tempo',                       volume: '3-8 mi continuous',           pace: 'T',                                            recovery: 'None',                                  totalAtPace: '20-40 min' },
    { workout: 'Cruise intervals (Daniels)',             volume: '3-6 × 1 mi or 2-4 × 2 mi',     pace: 'T',                                            recovery: '1 min per mi of work',                  totalAtPace: '4-8 mi' },
    { workout: 'Sub-threshold (Norwegian) intervals',    volume: '5-10 × 1K or 4-6 × 2K',        pace: 'ST (10-15 s/mi slower than T)',                recovery: '60-90 s',                               totalAtPace: '5-10 K' },
    { workout: 'Long tempo',                              volume: '8-12 mi continuous',           pace: 'Slightly slower than T (HM-ish)',              recovery: 'None',                                  totalAtPace: '8-12 mi' },
  ],
  citations: [
    cite('§5.1 Threshold family overview', 'Workout / volume / pace / recovery / total-at-pace for the four threshold workouts', 'research', '04'),
  ],
};

/** VO2max family — max aerobic power. */
export const VO2MAX_FAMILY: Cited<Array<{
  workout: string;
  repsXDistance: string;
  pace: string;
  recovery: string;
  totalAtPace: string;
}>> = {
  value: [
    { workout: 'Mile repeats (3K/5K)',  repsXDistance: '3-6 × 1 mi',     pace: 'I (5K) to slightly slower',         recovery: '2:30-4:00 jog (≈ rep time)',     totalAtPace: '3-6 mi' },
    { workout: '1200m repeats',         repsXDistance: '4-6 × 1200',     pace: 'I',                                  recovery: '2-3 min jog',                    totalAtPace: '4.8-7.2 K' },
    { workout: '1000m repeats',         repsXDistance: '5-8 × 1K',       pace: 'I',                                  recovery: '2-3 min jog (≈ rep time)',       totalAtPace: '5-8 K' },
    { workout: '800m repeats',          repsXDistance: '6-10 × 800',     pace: 'I',                                  recovery: '2-3 min jog (≈ rep time)',       totalAtPace: '4.8-8 K' },
    { workout: '600m repeats',          repsXDistance: '8-12 × 600',     pace: 'I to slightly faster',               recovery: '2-3 min jog',                    totalAtPace: '4.8-7.2 K' },
    { workout: '400m repeats',          repsXDistance: '8-16 × 400',     pace: '3K-5K',                               recovery: '90 s - 2 min jog',               totalAtPace: '3.2-6.4 K' },
    { workout: 'Yasso 800s',            repsXDistance: '4-10 × 800',     pace: 'Time-prediction-based',              recovery: 'Equal time jog',                 totalAtPace: '3.2-8 K' },
  ],
  citations: [
    cite('§6.1 VO2max family overview', 'Mile, 1200, 1000, 800, 600, 400 reps + Yasso 800s family table', 'research', '04'),
  ],
};

// ── Track session protocols ────────────────────────────────────────

/** Standard track warmup protocol. */
export const TRACK_WARMUP_PROTOCOL: Cited<Array<{ step: string; duration: string }>> = {
  value: [
    { step: 'Easy jog',                                                    duration: '10-20 min (1-2 mi)' },
    { step: 'Dynamic mobility (leg swings, hip circles, lunges)',          duration: '3-5 min' },
    { step: 'Drills (A skip, B skip, high knees, butt kicks, carioca)',    duration: '5-8 min, ~30m each, 2-3 passes' },
    { step: 'Strides',                                                      duration: '4 × 80-100m, building, full-recovery' },
    { step: 'Workout',                                                      duration: 'Per session' },
    { step: 'Cooldown jog',                                                duration: '10-20 min (1-2 mi)' },
    { step: 'Optional: light static stretching',                            duration: '5 min' },
  ],
  citations: [
    cite('§17.1 Standard warmup protocol', 'Easy jog → mobility → drills → strides → workout → cooldown', 'research', '04'),
  ],
};

/** Canonical drill sequence. */
export const DRILL_SEQUENCE: Cited<Array<{ drill: string; purpose: string; reps: string }>> = {
  value: [
    { drill: 'A march',                  purpose: 'Slow knee-drive pattern; foundation',          reps: '2 × 30m' },
    { drill: 'A skip',                   purpose: 'Higher-tempo knee drive; coordination',         reps: '2 × 30m' },
    { drill: 'B march',                  purpose: 'Add leg extension; hamstring activation',       reps: '2 × 30m' },
    { drill: 'B skip',                   purpose: 'High-tempo extension drill; hip mobility',      reps: '2 × 30m' },
    { drill: 'High knees',               purpose: 'Quick foot turnover, core activation',          reps: '2 × 30m' },
    { drill: 'Butt kicks',               purpose: 'Hamstring activation, heel recovery',           reps: '2 × 30m' },
    { drill: 'Carioca',                  purpose: 'Hip mobility, lateral movement',                reps: '2 × 30m' },
    { drill: 'Straight-leg bounding',    purpose: 'Glute/hamstring',                                reps: '1-2 × 30m' },
  ],
  citations: [
    cite('§17.2 Drill sequence (canonical)', 'A march, A skip, B march, B skip, high knees, butt kicks, carioca, straight-leg bounding', 'research', '04'),
  ],
};

/** Pre-race warmup volume by distance. */
export const PRE_RACE_WARMUP_BY_DISTANCE: Cited<Record<
  '5K' | '10K' | 'HM' | 'marathon' | 'mile_3K',
  { warmupVolume: string; strides: string; notes: string }
>> = {
  value: {
    '5K':       { warmupVolume: '2-3 mi jog + drills',      strides: '4-6 strides',       notes: 'Final stride 5-10 min before gun' },
    '10K':      { warmupVolume: '1.5-2.5 mi jog + drills',  strides: '4 strides',         notes: 'Slightly less than 5K' },
    'HM':       { warmupVolume: '1-1.5 mi jog + drills',    strides: '2-4 strides',       notes: 'Save energy' },
    marathon:   { warmupVolume: '5-15 min jog or none',     strides: '0-2 strides',       notes: 'Many runners walk only' },
    mile_3K:    { warmupVolume: '2-3 mi + drills + 4-6 strides + 1-2 race-pace 100s', strides: '4-6+', notes: 'Most extensive warmup' },
  },
  citations: [
    cite('§17.3 Pre-race warmup variations', 'Race distance → warmup volume + strides + notes', 'research', '04'),
  ],
};

// ── Training-cycle placement ──────────────────────────────────────

/** Per-phase workout slate. */
export const TRAINING_CYCLE_PLACEMENT: Cited<Record<CyclePhase, {
  duration: string;
  primaryWorkouts: string;
  qualityFrequencyPerWeek: { low: number; high: number };
}>> = {
  value: {
    base: {
      duration: '8-12+ wks',
      primaryWorkouts: 'E, GA, medium-long, long, strides, hill sprints, occasional fartlek/light hills',
      qualityFrequencyPerWeek: { low: 0, high: 2 },
    },
    hill_strength: {
      duration: '3-4 wks (optional)',
      primaryWorkouts: 'Hill circuit, long hill repeats, hill sprints',
      qualityFrequencyPerWeek: { low: 2, high: 3 },
    },
    specific_support: {
      duration: '4-6 wks',
      primaryWorkouts: 'T, cruise intervals, mile repeats at slower I, alternations',
      qualityFrequencyPerWeek: { low: 2, high: 2 },
    },
    race_specific: {
      duration: '4-8 wks',
      primaryWorkouts: 'Race-pace workouts, MP long runs, Canova structures, 4×2 mi for HM',
      qualityFrequencyPerWeek: { low: 2, high: 2 },
    },
    sharpening_taper: {
      duration: '2-3 wks',
      primaryWorkouts: 'Reduced-volume versions of recent workouts; strides; short race-pace work',
      qualityFrequencyPerWeek: { low: 2, high: 2 },
    },
    all_phases: {
      duration: 'n/a',
      primaryWorkouts: 'Recovery, easy/GA, strides, hill sprints',
      qualityFrequencyPerWeek: { low: 0, high: 0 },
    },
  },
  citations: [
    cite('§15 Training-cycle placement summary', 'Phase / primary workouts / frequency table', 'research', '04'),
  ],
};

// ── Combinations to avoid ─────────────────────────────────────────

/** Workout combinations that are research-flagged as harmful. */
export const COMBINATIONS_TO_AVOID: Cited<Array<{
  wrongCombo: string;
  why: string;
}>> = {
  value: [
    {
      wrongCombo: 'VO2max + long run within 48 hrs',
      why: 'Both deplete glycogen; doubles injury risk',
    },
    {
      wrongCombo: 'MP long run + hard tempo within 5 days',
      why: 'Same energy system, same impact pattern, no recovery between',
    },
    {
      wrongCombo: 'Two threshold sessions back-to-back',
      why: 'Only the Norwegian double-day model handles this, and only with sub-threshold pacing',
    },
    {
      wrongCombo: 'Fast finish long run before goal race',
      why: 'Adds depletion in taper window',
    },
    {
      wrongCombo: '400m R-pace day before threshold',
      why: 'Soft-tissue load incompatible with quality threshold next day',
    },
  ],
  citations: [
    cite('§16 Combinations to avoid', 'Five wrong combos with mechanism', 'research', '04'),
  ],
};

// ── Strength training scheduling ─────────────────────────────────

/** Strength training integration rules for runners.
 *
 * Key principle: strength supports running, never competes with it.
 * Fixed slots: Monday (lower/core) and Friday (upper/core, light lower),
 * always after the run, never adjacent to quality or long sessions.
 *
 * Duration and effort tiers per phase (Research/04 §Supplemental work):
 *   BASE/BUILD:  2 sessions/week, 30 min, effort 7/10.
 *   PEAK:        2 sessions/week, 30 min, effort 6/10.
 *   TAPER:       1 session/week, 20 min, effort 5/10 — maintenance only.
 *   RACE_WEEK:   Skip entirely. */
export const STRENGTH_SCHEDULE: Cited<{
  sessionsPerWeek: { BASE: number; BUILD: number; PEAK: number; TAPER: number; RACE_WEEK: number };
  durationMin: { BASE: number; BUILD: number; PEAK: number; TAPER: number; RACE_WEEK: number };
  effortOutOf10: { BASE: number; BUILD: number; PEAK: number; TAPER: number; RACE_WEEK: number };
  monFocus: string;
  friFocus: string;
  rules: string[];
}> = {
  value: {
    sessionsPerWeek: { BASE: 2, BUILD: 2, PEAK: 2, TAPER: 1, RACE_WEEK: 0 },
    durationMin:     { BASE: 30, BUILD: 30, PEAK: 30, TAPER: 20, RACE_WEEK: 0 },
    effortOutOf10:   { BASE: 7, BUILD: 7, PEAK: 6, TAPER: 5, RACE_WEEK: 0 },
    monFocus: 'Lower body + core — glutes, hips, single-leg work. This is runner strength: the stuff that keeps form together when you\'re tired.',
    friFocus: 'Upper body + core, light lower. Support strength — nothing that loads the legs hard going into the weekend.',
    rules: [
      'Always run first — strength after running, never before.',
      'Never the day before or after a quality session or long run.',
      'Monday = lower/core. Friday = upper/core (light lower). These slots are fixed.',
      'Default 30 min. On low-stress weeks (cutback, base) you can go 45 if legs feel good.',
      'Effort drops as race approaches: 7/10 build → 6/10 peak → 4–5/10 taper.',
      'Race week: skip entirely.',
    ],
  },
  note: 'Strength supports the running — it doesn\'t compete with it. Two sessions a week on Mon and Fri, after the run, targeting the movements that actually matter for half marathon performance.',
  citations: [
    cite('§Supplemental work', 'Strength 2-3x/week, easy days only, after runs. Reduce in taper.', 'research', '04'),
  ],
};

// ── Easy pace floor ───────────────────────────────────────────────

/** Easy-pace floor — the threshold below which an "easy" run drifted
 *  too fast. Used in pacing.ts. */
export const EASY_PACE_FLOOR: Cited<{
  minSlowerThanMpSPerMi: number;
}> = {
  value: { minSlowerThanMpSPerMi: 60 },
  note: 'Floor; closer to 90+ for high-volume runners.',
  citations: [
    cite('§2 Easy / general aerobic runs', '15-25% slower than MP. Floor: 60 s/mi slower than MP, drifting toward 90+ for higher-volume runners.', 'research', '04'),
  ],
};
