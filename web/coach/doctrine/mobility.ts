/**
 * Doctrine — Mobility, warmup, cooldown, drills.
 *
 * Source: Research/10-mobility-warmup.md
 *
 * Engine consumers:
 *   - coach.briefRaceMorning   → RACE_WARMUP_BY_DISTANCE (also in
 *                                race_week.ts)
 *   - coach.prescribeWorkout   → WORKOUT_WARMUP + COOLDOWN_PROTOCOL
 *   - profile / settings UI    → DAILY_MOBILITY_ROUTINE */
import { cite, type Cited } from './cite';

// ── Why dynamic pre / static post ─────────────────────────────────

export const WARMUP_RATIONALE: Cited<{
  preRunDynamic: string;
  postRunStatic: string;
  staticPreRunPenalty: string;
  rampFramework: string;
}> = {
  value: {
    preRunDynamic: 'Dynamic warmup raises core/muscle temperature, activates the neural pathways for running, primes the cardiovascular system, and progressively loads soft tissues.',
    postRunStatic: 'Static stretching post-run helps maintain joint range of motion when tissues are warm and pliable. Does not measurably reduce DOMS or speed recovery.',
    staticPreRunPenalty: 'Static stretching pre-exercise REDUCES strength + power output for 30-60 min after stretching. Avoid pre-run static holds.',
    rampFramework: 'RAMP framework: Raise (HR/temp), Activate (key muscles), Mobilize (joint range), Potentiate (sport-specific high-intensity). Used by Premier League + elite endurance programs.',
  },
  citations: [
    cite('§Why Dynamic Pre-Run, Static Post-Run + RAMP Framework', 'Static stretching pre-exercise reduces strength/power 30-60 min. RAMP framework: Raise/Activate/Mobilize/Potentiate.', 'research', '10'),
  ],
};

// ── Pre-run dynamic warmup ────────────────────────────────────────

export const DYNAMIC_WARMUP_PROTOCOL: Cited<Array<{
  step: string;
  duration: string;
  exercises?: string[];
}>> = {
  value: [
    { step: 'Easy jog',                duration: '5-10 min',           exercises: undefined },
    { step: 'Dynamic mobility',         duration: '3-5 min',            exercises: ['Leg swings (front/back, side)', 'Hip circles', 'Walking lunges with reach', 'Inchworms', 'World\'s greatest stretch'] },
    { step: 'Drills',                   duration: '5-8 min, 30m each',  exercises: ['A-march', 'A-skip', 'B-march', 'B-skip', 'High knees', 'Butt kicks', 'Carioca', 'Straight-leg bounding'] },
    { step: 'Strides',                  duration: '4-6 reps',           exercises: ['80-100m building, full-recovery walk-back'] },
    { step: 'Workout',                  duration: 'Per session',         exercises: undefined },
    { step: 'Cool-down jog',             duration: '5-15 min',           exercises: undefined },
  ],
  note: 'For easy runs (E pace, 30-60 min), warmup can be brief — just 5 min easy jog + a few leg swings. For workouts (T, I, R), full protocol is essential.',
  citations: [
    cite('§Pre-Run Dynamic Warmup + Drills + Strides', 'Standard 6-step warmup', 'research', '10'),
  ],
};

// ── Race warmup by distance (cross-ref with race_week.ts) ─────────

export const RACE_WARMUP_BY_DISTANCE_MOBILITY: Cited<Record<'5K' | '10K' | 'half' | 'marathon', {
  totalMin: { low: number; high: number };
  jogVolume: string;
  drills: 'full' | 'abbreviated' | 'minimal' | 'none';
  strides: { low: number; high: number };
  notes: string;
}>> = {
  value: {
    '5K':       { totalMin: { low: 15, high: 25 }, jogVolume: '2-3 mi easy',                drills: 'full',         strides: { low: 4, high: 6 }, notes: 'Most extensive warmup. End with 1 stride at 3K-mile pace (research: ~6 sec faster 5K).' },
    '10K':      { totalMin: { low: 15, high: 20 }, jogVolume: '1.5-2.5 mi easy',           drills: 'full',         strides: { low: 4, high: 6 }, notes: 'Last 1-2 strides at 10K pace.' },
    half:       { totalMin: { low: 10, high: 15 }, jogVolume: '0.5-1.5 mi easy',           drills: 'abbreviated',  strides: { low: 2, high: 4 }, notes: 'Save energy. If no space, walk 5 min + 4 strides.' },
    marathon:   { totalMin: { low: 5,  high: 10 }, jogVolume: '5-10 min jog OR walk only', drills: 'minimal',      strides: { low: 0, high: 2 }, notes: 'First 3 km of race is the warmup. Walking 5-10 min is often optimal. Cold weather: add 5 min.' },
  },
  citations: [
    cite('§Race Warmup', 'Inverse relationship: shorter race = longer warmup. 5K 15-25 min, marathon 5-10 min or walking.', 'research', '10'),
  ],
};

// ── Drill sequence ────────────────────────────────────────────────

export const DRILL_LIBRARY: Cited<Array<{
  drill: string;
  purpose: string;
  reps: string;
  cue: string;
}>> = {
  value: [
    { drill: 'A-march',                   purpose: 'Slow knee-drive pattern; foundation',          reps: '2 × 30m',  cue: 'Stand tall, drive knee to 90°, foot dorsiflexed' },
    { drill: 'A-skip',                    purpose: 'Higher-tempo knee drive; coordination',         reps: '2 × 30m',  cue: 'Spring off the ground; rhythmic skip' },
    { drill: 'B-march',                   purpose: 'Add leg extension; hamstring activation',       reps: '2 × 30m',  cue: 'Knee up + extend leg, paw down with foot' },
    { drill: 'B-skip',                    purpose: 'High-tempo extension drill; hip mobility',      reps: '2 × 30m',  cue: 'Same as B-march, with skip rhythm' },
    { drill: 'High knees',                purpose: 'Quick foot turnover, core activation',          reps: '2 × 30m',  cue: 'Quick feet, knees ≥90°' },
    { drill: 'Butt kicks',                purpose: 'Hamstring activation, heel recovery',           reps: '2 × 30m',  cue: 'Heel to butt, quick turnover' },
    { drill: 'Carioca',                   purpose: 'Hip mobility, lateral movement',                reps: '2 × 30m',  cue: 'Cross-step, quick rhythm' },
    { drill: 'Straight-leg bounding',     purpose: 'Glute/hamstring loading',                        reps: '1-2 × 30m', cue: 'Maintain straight leg; bound with hip extension' },
    { drill: 'Walking lunge with reach',  purpose: 'Hip flexor + thoracic mobility',                 reps: '10 each side', cue: 'Reach overhead opposite to forward leg' },
  ],
  note: 'Drills cycle through the running gait pattern at sub-running speeds, priming neural and muscular activation.',
  citations: [
    cite('§Drills', '9 canonical drills with purpose, reps, cue', 'research', '10'),
  ],
};

// ── Daily mobility ────────────────────────────────────────────────

export const DAILY_MOBILITY_ROUTINE: Cited<{
  totalMin: { low: number; high: number };
  components: Array<{ area: string; exercise: string; reps: string }>;
  whenToDoIt: string;
}> = {
  value: {
    totalMin: { low: 5, high: 10 },
    components: [
      { area: 'Hip flexors',       exercise: 'Couch stretch (hip flexor on bench)',                         reps: '60 s each side' },
      { area: 'Glutes / piriformis', exercise: 'Pigeon pose or seated figure-4',                              reps: '60 s each side' },
      { area: 'Thoracic spine',    exercise: 'Open book / cat-cow',                                          reps: '10 reps each' },
      { area: 'Ankles',             exercise: 'Knee-to-wall dorsiflexion',                                    reps: '10 reps each' },
      { area: 'Calf / Achilles',   exercise: 'Soleus stretch (knee bent) + gastrocnemius stretch (knee straight)', reps: '60 s each' },
      { area: 'Hamstrings',         exercise: 'Standing single-leg deadlift hold',                            reps: '60 s each side' },
    ],
    whenToDoIt: 'Post-run, evening, or pre-bed. Daily for ROM maintenance; ramp up if flexibility deficit identified.',
  },
  citations: [
    cite('§Daily Mobility Routine', '5-10 min routine + 6 components + when to do it', 'research', '10'),
  ],
};

// ── Foam rolling ──────────────────────────────────────────────────

export const FOAM_ROLLING_PROTOCOL: Cited<{
  evidenceTier: 'B_moderate' | 'C_weak';
  effects: string[];
  protocol: { secPerArea: { low: number; high: number }; areas: string[] };
  whenToUse: string;
  whenNotToUse: string;
}> = {
  value: {
    evidenceTier: 'B_moderate',
    effects: [
      'Short-term ROM improvement (~1-3°)',
      'Reduced perceived soreness',
      'Brief reduction in muscle stiffness',
    ],
    protocol: {
      secPerArea: { low: 30, high: 90 },
      areas: ['Quads', 'IT band', 'Glutes', 'Calves (gastroc + soleus)', 'Hamstrings', 'Adductors', 'Upper back/lats'],
    },
    whenToUse: 'Pre-run as part of warmup (60-90 sec/area), post-run cool-down (focus on tight areas), evening recovery.',
    whenNotToUse: 'Avoid rolling acutely injured tissue (strain ≤72h, BSI, tendon reactive phase). Direct rolling over IT band has weak evidence — focus on hip/glute drivers.',
  },
  citations: [
    cite('§Foam Rolling Protocols', 'B-moderate evidence; effects + protocol + when (not) to use', 'research', '10'),
  ],
};

// ── Static stretching ────────────────────────────────────────────

export const STATIC_STRETCHING_GUIDANCE: Cited<{
  preRunPenalty: string;
  postRunBenefit: string;
  protocol: { secPerHold: { low: number; high: number }; setsPerArea: { low: number; high: number } };
  recommendedAreas: string[];
}> = {
  value: {
    preRunPenalty: 'Reduces strength + power output 5-15% for 30-60 min. Avoid pre-run except for very brief (<10 sec) holds.',
    postRunBenefit: 'Maintains joint ROM when tissues are warm. Does NOT measurably reduce DOMS or speed recovery.',
    protocol: { secPerHold: { low: 30, high: 60 }, setsPerArea: { low: 1, high: 3 } },
    recommendedAreas: [
      'Hip flexors',
      'Hamstrings',
      'Calves (gastroc + soleus)',
      'Glutes / piriformis',
      'Quads',
      'IT band complex (via TFL stretch)',
    ],
  },
  citations: [
    cite('§Static Stretching Post-Run', 'Pre-run penalty 5-15% strength loss; post-run 30-60s holds for ROM', 'research', '10'),
  ],
};
