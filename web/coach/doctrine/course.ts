/**
 * Doctrine — Course-specific training adjustments.
 *
 * Source: Research/11-course-specific-training.md
 *
 * Engine consumers:
 *   - coach.paceStrategy           → HILL_PACE_GRADE_ADJUSTMENT
 *                                    + DOWNHILL_RACE_PROTOCOLS
 *   - /races/[slug]/page           → HILL_TRAINING_BY_RACE_PROFILE
 *                                    suggestions
 *   - coach.briefRaceMorning       → ALTITUDE_RACE_TIMING */
import { cite, type Cited } from './cite';

// ── Hill training principles ──────────────────────────────────────

export const HILL_TRAINING_ADAPTATIONS: Cited<{
  uphillAdaptations: string[];
  downhillAdaptations: string[];
  cardiovascularBenefits: string[];
  recommendedProtocols: Array<{ workout: string; structure: string; phase: string }>;
}> = {
  value: {
    uphillAdaptations: [
      'Hip extensor + glute strengthening (key for distance running form)',
      'Calf-Achilles complex loading (concentric)',
      'Stride length training under load',
      'VO2max stimulus at high effort',
      'Reduced impact load (vs flat at same HR/effort) — joint-protective',
    ],
    downhillAdaptations: [
      'Eccentric quad loading — quad fatigue resistance',
      'Stride control + cadence under speed',
      'Tendon stiffness adaptation (Achilles, patellar)',
      'BUT: connective-tissue damage that takes 5-10 days to recover',
    ],
    cardiovascularBenefits: [
      'Hill repeats 3-5 min @ T effort = high-quality VO2max stimulus',
      'Lower orthopedic stress per unit cardiovascular load',
      'Useful substitute for flat intervals when injury-prone',
    ],
    recommendedProtocols: [
      { workout: 'Hill sprints',          structure: '8-12 × 8-15 sec on 8-15% grade, full walk-down recovery',          phase: 'Year-round, 1-2×/wk' },
      { workout: 'Short hill repeats',    structure: '8-16 × 10-30 sec on 4-7% grade, full walk-jog recovery',           phase: 'Base + early specific' },
      { workout: 'Long hill repeats',     structure: '4-8 × 3-5 min on 3-5% grade @ T-10K effort, equal-time jog down',  phase: 'Specific phase, hilly-race prep' },
      { workout: 'Lydiard hill circuit',  structure: '~1.9 mi loop with springing/bounding uphill, jog flat, stride down', phase: '4-week dedicated hill block' },
    ],
  },
  citations: [
    cite('§Hill Training: Principles and Adaptations', 'Uphill / downhill / cardiovascular adaptations + 4 protocols', 'research', '11'),
  ],
};

// ── Hilly road races ──────────────────────────────────────────────

export const HILLY_ROAD_RACE_PREP: Cited<{
  trainingTimeOnHillsPctMin: number;
  weeksOutToBeginHillBlockLow: number;
  weeksOutToBeginHillBlockHigh: number;
  taperWeeklyHillsRule: string;
  longRunHillSelection: string;
  workoutSubstitutions: Array<{ flatWorkout: string; hillSubstitute: string }>;
}> = {
  value: {
    trainingTimeOnHillsPctMin: 40,
    weeksOutToBeginHillBlockLow: 8,
    weeksOutToBeginHillBlockHigh: 12,
    taperWeeklyHillsRule: 'Last 2 weeks: 1 short hill workout, no max-effort hills. Race-week: 1 easy hill exposure mid-week, none in final 5 days.',
    longRunHillSelection: 'Hilly course races require ≥40% of training mileage on hills (Hudson). Not all on race-course profile, but representative grades.',
    workoutSubstitutions: [
      { flatWorkout: '6 × 1 mi @ T (flat)',           hillSubstitute: '6 × 3-5 min @ T effort on rolling hills, equal jog down' },
      { flatWorkout: '5 × 1000m @ I (flat)',          hillSubstitute: '5 × 600-800m on 3-5% grade @ I effort' },
      { flatWorkout: '20 mi MP long run',             hillSubstitute: 'Course-profile-mimicking long run with MP segments on uphills + downhills' },
      { flatWorkout: 'Tempo flat 5 mi',                hillSubstitute: 'Tempo on rolling course — hold T effort up + down regardless of pace' },
    ],
  },
  citations: [
    cite('§Training for Hilly Road Races', 'Hudson 40% rule, 8-12 wk hill block, taper, long-run selection, workout substitutions', 'research', '11'),
  ],
};

// ── Eccentric quad / downhill prep ────────────────────────────────

export const DOWNHILL_QUAD_PROTECTION: Cited<{
  problem: string;
  damageTimeline: string;
  trainingProtocol: string[];
  weeksOutToBeginEccentricLoadingLow: number;
  weeksOutToBeginEccentricLoadingHigh: number;
  raceDayPacing: string;
}> = {
  value: {
    problem: 'Net-downhill courses (Boston, Big Sur, CIM, Revel series) damage quads via eccentric contraction. Damage surfaces 60-90 min into the race regardless of how easy the early miles felt.',
    damageTimeline: 'CK/DOMS peaks 24-48h post; full recovery 5-10 days. Insufficient quad-protective training = mile 18-24 collapse.',
    trainingProtocol: [
      'Downhill long runs: 1× every 2 weeks, building from 6 mi total downhill exposure to 12-14 mi over 8-12 weeks',
      'Eccentric strength: split squats, single-leg step-downs, Spanish squats — 2-3×/wk',
      'Long runs that mimic race profile (start downhill, finish flat or uphill)',
      'Pace controlled on downhills: target HR/effort, not pace. Let pace be a result.',
      'Race-week: dial back eccentric load; preserve freshness',
    ],
    weeksOutToBeginEccentricLoadingLow: 8,
    weeksOutToBeginEccentricLoadingHigh: 12,
    raceDayPacing: 'Run early downhills 30-45 sec/mi SLOWER than flat goal pace. Quad damage at mile 4-8 can break the race at mile 22-24. Boston rule: miles 1-4 controlled, miles 22-26 closing descent will reveal early discipline.',
  },
  citations: [
    cite('§Eccentric Quad Loading and Late-Race Quad Failure', 'Damage mechanism + 8-12 wk eccentric protocol + race-day pacing', 'research', '11'),
  ],
};

// ── Trail-specific ───────────────────────────────────────────────

export const TRAIL_SPECIFICS: Cited<{
  paceVsRoadAdjustments: Array<{ surface: string; paceAdjSPerMiLow: number; paceAdjSPerMiHigh: number }>;
  trainingAdjustments: string[];
  technicalSkills: string[];
}> = {
  value: {
    paceVsRoadAdjustments: [
      { surface: 'Hard-pack trail (smooth)',                paceAdjSPerMiLow: 10, paceAdjSPerMiHigh: 20 },
      { surface: 'Technical singletrack or wet leaves',     paceAdjSPerMiLow: 30, paceAdjSPerMiHigh: 60 },
      { surface: 'Sand or deep mud',                         paceAdjSPerMiLow: 60, paceAdjSPerMiHigh: 120 },
      { surface: 'Snow / soft snow on trail',                paceAdjSPerMiLow: 60, paceAdjSPerMiHigh: 120 },
    ],
    trainingAdjustments: [
      'Default to HR or RPE rather than pace on trails',
      'Build ankle stability via balance + single-leg work',
      'Trail-specific shoes (lugged, rock-plate) for technical races',
      'Long runs on race-specific terrain at least 6-8 weeks pre-race',
      'Practice fueling while moving (less aid station support than roads)',
    ],
    technicalSkills: [
      'Downhill technique: shorter strides, higher cadence, eyes 5-10 ft ahead',
      'Uphill power-hiking when grade exceeds running efficiency (~12-15%)',
      'Stream/water crossings: don\'t avoid wet feet pre-race',
      'Footing on rocks/roots: midfoot strike, light feet',
    ],
  },
  citations: [
    cite('§Trail Running Specifics', 'Surface adjustments, training, technical skills', 'research', '11'),
  ],
};

// ── Altitude races ────────────────────────────────────────────────

export const ALTITUDE_RACE_TIMING: Cited<{
  arrivalStrategies: Array<{ strategy: string; arrivalDays: string; rationale: string }>;
  acclimatizationTimeline: Array<{ daysAtAltitude: string; effect: string }>;
  fastTraining: string;
}> = {
  value: {
    arrivalStrategies: [
      { strategy: 'A — Arrive late',                  arrivalDays: '≤24 h before race', rationale: 'Avoid acute-phase decline (hyperventilation, hemoconcentration)' },
      { strategy: 'B — Arrive early',                  arrivalDays: '≥14 days before',    rationale: 'Capture acclimatization gains (Hbmass +1-3% by day 14)' },
      { strategy: 'AVOID — 2-7 days before',           arrivalDays: '2-7 days',           rationale: 'Worst window: hyperventilation + bicarbonate loss without RBC gain' },
    ],
    acclimatizationTimeline: [
      { daysAtAltitude: 'Days 1-3',    effect: 'Hyperventilation, ↑HR, hemoconcentration. Worst performance.' },
      { daysAtAltitude: 'Days 2-5',    effect: 'Bicarbonate buffer drop, sleep disruption, VO2max nadir' },
      { daysAtAltitude: 'Days 6-14',   effect: 'EPO release, early RBC formation, ventilatory acclimation. ~70% recovery.' },
      { daysAtAltitude: 'Days 14-21',  effect: 'Hbmass +3-6%, capillary density adapting. Near full performance.' },
      { daysAtAltitude: '4-6 weeks',   effect: 'Asymptote (rule: ~11.4 days × altitude_km)' },
    ],
    fastTraining: 'Sea-level race after altitude block: expect supercompensation lasting ~10-14 days.',
  },
  citations: [
    cite('§Altitude Races: Sea-Level Athletes Racing High', 'Stellingwerff/Chapman 2 strategies + acclimatization timeline + supercompensation', 'research', '11'),
  ],
};

// ── Combined demands decision matrix ──────────────────────────────

export const COMBINED_COURSE_DEMANDS: Cited<Array<{
  combination: string;
  priority: 'highest' | 'high' | 'medium' | 'low';
  prepFocus: string;
}>> = {
  value: [
    { combination: 'Hilly + heat',                                    priority: 'highest', prepFocus: 'Heat acclimation 2-3 wk + hilly long runs at race-mimic profile + hydration + pacing by HR' },
    { combination: 'Net downhill + heat (e.g., Boston in warm year)', priority: 'highest', prepFocus: 'Eccentric quad protocol 8-12 wk + heat-acclim 2 wk + early mile discipline' },
    { combination: 'Altitude + cold',                                  priority: 'high',    prepFocus: 'Arrival timing decision + cold-weather kit + iron status + sleep' },
    { combination: 'Trail + altitude',                                 priority: 'high',    prepFocus: 'Trail-specific running + arrival ≥14 days + power hiking + ankle stability' },
    { combination: 'Hilly + trail + heat',                             priority: 'highest', prepFocus: 'All three demand specific prep; choose A-race carefully + course-mimic long runs' },
  ],
  citations: [
    cite('§Combining Course Demands: Decision Matrix', '5 combined-demand scenarios + prep focus', 'research', '11'),
  ],
};
