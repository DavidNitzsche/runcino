/**
 * Curated faff.run Amp workout catalog.
 *
 * Real 30 / 45-minute full-body sessions, weighted toward running-
 * specific carry-over (single-leg, glute drive, eccentric posterior
 * chain, calf-Achilles, hip stability) but covering upper body so
 * the runner doesn't lose total-body strength chasing miles.
 *
 * The engine rotates through these per session type using ISO week
 * number, so heavy weeks alternate between Posterior, Single-Leg,
 * and Total Force, and power weeks alternate between Run-Drive and
 * Total Power. No session repeats two weeks in a row.
 *
 * Movement names match the Amp library exactly (docs/amp-research.md
 * §7) so the runner can search and load each in the Amp app. The
 * runner can also override with an Amp AI-generated workout, Coach
 * suggests, Coach doesn't lock.
 */

import type { Phase, StrengthSessionType } from './coach-principles';

export type AmpResistanceMode = 'Fixed' | 'Band' | 'Eccentric' | 'Mobility';

export interface AmpWorkout {
  id: string;
  name: string;
  fits: StrengthSessionType[];
  phases?: Phase[];
  durationMin: 30 | 45;
  ampMode: AmpResistanceMode;
  intent: string;
  /** Movement list, ordered. Each line: name + sets/reps + notes. */
  blocks: Array<{ section: string; items: Array<{ name: string; sets: string; notes?: string }> }>;
  benefit: string;
}

export const AMP_WORKOUTS: AmpWorkout[] = [
  /* ─────────────────────────────────────────────────────────────
     HEAVY · 45 MIN, three rotations
     Each is full-body but weighted to running. Each runs ~45 min:
     5 min warm-up, ~35 min main work, ~5 min finisher.
     ─────────────────────────────────────────────────────────── */

  {
    id: 'heavy-posterior-45',
    name: 'Heavy · Posterior + Total',
    fits: ['heavy'],
    phases: ['BASE', 'BUILD', 'BASE_MAINTENANCE', 'REBUILD'],
    durationMin: 45,
    ampMode: 'Eccentric',
    intent: 'Posterior chain emphasis with full-body coverage. Eccentric mode loads the lowering phase, the doc-validated stimulus for tendon health (Achilles, patellar, hamstring).',
    blocks: [
      { section: 'Warm-up · 5 min', items: [
        { name: 'Glute bridges',                sets: '2 × 10', notes: 'Activation, no load' },
        { name: 'World\'s Greatest to Hamstring Stretch', sets: '2 × 6 each side' },
        { name: 'A-skips with cable (light)',   sets: '2 × 10 each' },
      ]},
      { section: 'Main · lower force', items: [
        { name: 'Hip Thrust',                   sets: '4 × 6 heavy', notes: 'Glute max · 3-second eccentric' },
        { name: 'Stiff Deadlift',               sets: '4 × 5 heavy', notes: 'Hamstring tendon load · slow lower' },
        { name: 'Reverse Nordic Curl',          sets: '3 × 6',       notes: 'Quad eccentric, descent tolerance' },
      ]},
      { section: 'Main · upper', items: [
        { name: 'Hinge & Row',                  sets: '4 × 8',       notes: 'Lat + mid-back · postural support for late-race form' },
        { name: 'Chest Press',                  sets: '3 × 8',       notes: 'Bilateral push' },
        { name: 'Single Arm Stretching Lat Pulldown', sets: '3 × 8 each', notes: 'Unilateral pull · core anti-rotation' },
      ]},
      { section: 'Finisher · single-leg + core · 5-7 min', items: [
        { name: 'Single-leg Calf Raise',        sets: '3 × 8 each',  notes: 'Slow eccentric, Achilles direct' },
        { name: 'Half Kneeling Core Twist',     sets: '3 × 10 each', notes: 'Anti-rotation core' },
      ]},
    ],
    benefit: 'Achilles + patellar + hamstring tendon resilience, peak glute force for hill climbs and finish-line sprints, upper-body postural strength for late-race form preservation.',
  },

  {
    id: 'heavy-single-leg-45',
    name: 'Heavy · Single-Leg + Asymmetry',
    fits: ['heavy'],
    phases: ['BASE', 'BUILD', 'BASE_MAINTENANCE'],
    durationMin: 45,
    ampMode: 'Eccentric',
    intent: 'Running is a single-leg sport. This session corrects asymmetry, loads each side independently, and stresses hip stability under fatigue.',
    blocks: [
      { section: 'Warm-up · 5 min', items: [
        { name: 'Pigeon (Hip Stretch)',         sets: '2 × 30s each' },
        { name: 'Glute bridges',                sets: '2 × 10' },
        { name: 'Side-Lying Front Leg Pulse',   sets: '2 × 10 each', notes: 'Glute med activation' },
      ]},
      { section: 'Main · single-leg force', items: [
        { name: 'Bulgarian split squat (Elevated Front Squat)', sets: '4 × 6 each', notes: 'Quad + glute · slow eccentric' },
        { name: 'Single-leg Romanian Deadlift', sets: '4 × 6 each',  notes: 'Hamstring + balance under load' },
        { name: 'Single Leg Hip Thrust',        sets: '3 × 8 each',  notes: 'Glute max · unilateral' },
      ]},
      { section: 'Main · upper unilateral', items: [
        { name: 'Single arm row (Hinge & Row, single-arm)', sets: '4 × 8 each', notes: 'Lat + anti-rotation' },
        { name: 'Single arm chest press',       sets: '3 × 8 each',  notes: 'Push + core stabilization' },
      ]},
      { section: 'Finisher · stability + core · 5-7 min', items: [
        { name: 'Single Leg Abduction (ankle strap)', sets: '3 × 10 each', notes: 'Glute med, hip stability' },
        { name: 'Side Plank Reach Through',     sets: '3 × 8 each',  notes: 'Anti-rotation under fatigue' },
      ]},
    ],
    benefit: 'Asymmetry correction (most runners are stronger one side), hip stability under fatigue, single-leg force for race-day pushoff, anti-rotation core for late-race form.',
  },

  {
    id: 'heavy-total-force-45',
    name: 'Heavy · Total Body Force',
    fits: ['heavy'],
    phases: ['BASE', 'BUILD', 'BASE_MAINTENANCE'],
    durationMin: 45,
    ampMode: 'Fixed',
    intent: 'Bilateral compound day, total-body strength baseline that prevents the runner from becoming a pure-aerobic noodle. Fixed mode for reproducible loads + comparison across sessions.',
    blocks: [
      { section: 'Warm-up · 5 min', items: [
        { name: 'Glute bridges',                sets: '2 × 10' },
        { name: 'Shoulder Mobility Reach',      sets: '2 × 8 each' },
        { name: 'Lateral Raise (light)',        sets: '2 × 12',     notes: 'Shoulder activation' },
      ]},
      { section: 'Main · lower force', items: [
        { name: 'Goblet Squat (T-bar)',         sets: '5 × 5 heavy', notes: 'Bilateral baseline force' },
        { name: 'Stiff Deadlift',               sets: '4 × 5 heavy' },
        { name: 'Hip Thrust',                   sets: '3 × 8' },
      ]},
      { section: 'Main · upper push/pull', items: [
        { name: 'Chest Press',                  sets: '4 × 6 heavy' },
        { name: 'Hinge & Row',                  sets: '4 × 6 heavy' },
        { name: 'Lateral Raise',                sets: '3 × 10',      notes: 'Shoulder integrity' },
      ]},
      { section: 'Finisher · core + calves · 5-7 min', items: [
        { name: 'Calf raise (slow eccentric)',  sets: '4 × 8' },
        { name: 'Resisted V-Up',                sets: '3 × 8',       notes: 'Core flexion strength' },
        { name: 'Half Kneeling Core Twist',     sets: '3 × 10 each' },
      ]},
    ],
    benefit: 'Total-body force capacity, bone density support, shoulder + back postural strength. Establishes load comparisons across cycles when used in Fixed mode.',
  },

  /* ─────────────────────────────────────────────────────────────
     POWER · 45 MIN, two rotations
     ─────────────────────────────────────────────────────────── */

  {
    id: 'power-run-drive-45',
    name: 'Power · Run-Drive',
    fits: ['power'],
    phases: ['BUILD', 'PEAK'],
    durationMin: 45,
    ampMode: 'Band',
    intent: 'Plyometric + power work targeted at running mechanics, explosive triple-extension, hip drive, calf-Achilles reactivity. Band mode loads the top of every jump.',
    blocks: [
      { section: 'Warm-up · 5 min', items: [
        { name: 'A-skips with cable (light)',   sets: '2 × 10 each' },
        { name: 'B-skips with cable',           sets: '2 × 8 each' },
        { name: 'Glute bridges',                sets: '2 × 10' },
      ]},
      { section: 'Main · explosive lower', items: [
        { name: 'Resisted Jump Squat',          sets: '5 × 5',       notes: 'Triple-extension · full recovery (90s) between sets' },
        { name: 'Pogo hops',                    sets: '4 × 15',      notes: 'Calf-Achilles reactive spring' },
        { name: 'Donkey Kick',                  sets: '4 × 8 each',  notes: 'Glute drive · hip extension' },
      ]},
      { section: 'Main · running mechanics', items: [
        { name: 'Split Squat with explosive concentric', sets: '3 × 6 each', notes: 'Stride pattern under load' },
        { name: 'Resisted Mountain Climber',    sets: '3 × 30s',     notes: 'Cardio kicker · running-specific core' },
      ]},
      { section: 'Upper · 5 min', items: [
        { name: 'Tricep Pushdown Rope',         sets: '3 × 10',      notes: 'Arm drive · running-relevant push' },
        { name: 'Bicep Curl',                   sets: '3 × 10',      notes: 'Arm drive support' },
      ]},
    ],
    benefit: 'Top-end speed, descent reactivity, hip extension power, neuromuscular sharpness preserved across BUILD/PEAK.',
  },

  {
    id: 'power-total-45',
    name: 'Power · Total Body',
    fits: ['power'],
    phases: ['BUILD', 'PEAK', 'TAPER'],
    durationMin: 45,
    ampMode: 'Band',
    intent: 'Full-body explosive work, running-weighted but covers upper body too. Band mode at the top of every rep.',
    blocks: [
      { section: 'Warm-up · 5 min', items: [
        { name: 'Glute bridges',                sets: '2 × 10' },
        { name: 'Lateral Raise (light)',        sets: '2 × 12' },
        { name: 'Resisted Jump Squat (light)',  sets: '2 × 5' },
      ]},
      { section: 'Main · lower power', items: [
        { name: 'Resisted Jump Squat',          sets: '4 × 5',       notes: 'Heavy · explosive intent' },
        { name: 'Single Leg Abduction',         sets: '3 × 10 each', notes: 'Glute med power' },
        { name: 'Pogo hops',                    sets: '3 × 15' },
      ]},
      { section: 'Main · upper power', items: [
        { name: 'Chest Press (explosive)',      sets: '4 × 6',       notes: 'Push · explosive concentric' },
        { name: 'Hinge & Row (explosive)',      sets: '4 × 6',       notes: 'Pull · explosive concentric' },
        { name: 'Lateral Raise',                sets: '3 × 10' },
      ]},
      { section: 'Finisher · 5 min', items: [
        { name: 'Skull Crusher Rope',           sets: '3 × 10' },
        { name: 'Resisted Mountain Climber',    sets: '3 × 30s' },
      ]},
    ],
    benefit: 'Total-body power, running-weighted but with upper-body coverage. Holds neuromuscular tone through peak/taper without aerobic cost.',
  },

  /* ─────────────────────────────────────────────────────────────
     MAINTAIN · 30 MIN, short and effective
     ─────────────────────────────────────────────────────────── */

  {
    id: 'maintain-30',
    name: 'Maintain · 30 Quick Hit',
    fits: ['maintenance'],
    phases: ['PEAK', 'TAPER', 'BASE_MAINTENANCE'],
    durationMin: 30,
    ampMode: 'Fixed',
    intent: 'Lower volume, intensity preserved. Fast in-and-out, fits late-cycle when run intensity is the priority. The goal is preservation, not gain.',
    blocks: [
      { section: 'Warm-up · 3 min', items: [
        { name: 'Glute bridges',                sets: '2 × 10' },
        { name: 'Shoulder Mobility Reach',      sets: '2 × 8 each' },
      ]},
      { section: 'Main · lower', items: [
        { name: 'Goblet Squat (T-bar)',         sets: '3 × 5 @ 75%', notes: 'Force preservation · not failure' },
        { name: 'Single Leg Hip Thrust',        sets: '3 × 8 each',  notes: 'Glute · low fatigue' },
        { name: 'Calf raise',                   sets: '3 × 8',       notes: 'Achilles preservation' },
      ]},
      { section: 'Main · upper', items: [
        { name: 'Chest Press',                  sets: '3 × 6 @ 75%' },
        { name: 'Hinge & Row',                  sets: '3 × 6 @ 75%' },
      ]},
      { section: 'Core · 3 min', items: [
        { name: 'Half Kneeling Core Twist',     sets: '2 × 10 each' },
      ]},
    ],
    benefit: 'Force preservation in the final weeks before a race without recovery cost. Drops entirely in final 7-10 days.',
  },

  /* ─────────────────────────────────────────────────────────────
     MOBILITY · 30 MIN, recovery / rebuild day
     ─────────────────────────────────────────────────────────── */

  {
    id: 'mobility-hips-achilles-30',
    name: 'Mobility · Hips & Achilles',
    fits: ['mobility'],
    phases: ['POST_RACE', 'REBUILD', 'BASE_MAINTENANCE', 'TAPER'],
    durationMin: 30,
    ampMode: 'Mobility',
    intent: 'Hip range + Achilles tendon range + posterior chain assisted stretching. Light cable feedback through stretches, Amp\'s underused mobility category, treated as legitimate work.',
    blocks: [
      { section: 'Hip openers', items: [
        { name: 'Rocking Couch Stretch',        sets: '2 × 60s each', notes: 'Hip flexor · desk-runner staple' },
        { name: 'Pigeon (Hip Stretch)',         sets: '2 × 60s each', notes: 'Glute med + piriformis' },
        { name: 'Hip Stretch',                  sets: '2 × 60s each' },
      ]},
      { section: 'Posterior chain', items: [
        { name: 'World\'s Greatest to Hamstring Stretch', sets: '2 × 8 each' },
        { name: 'Hamstring Stretch',            sets: '2 × 60s each' },
      ]},
      { section: 'Calf · Achilles', items: [
        { name: 'Ankle dorsiflexion (calf wall)', sets: '2 × 60s each' },
        { name: 'Calf raise (slow, light)',     sets: '2 × 12',       notes: 'Active range, not load' },
      ]},
      { section: 'Upper · core', items: [
        { name: 'T-spine Rotation',             sets: '2 × 8 each',   notes: 'Stride rotation efficiency' },
        { name: 'Chest Opener',                 sets: '2 × 60s' },
        { name: 'Glute bridges (no load)',      sets: '2 × 12' },
      ]},
    ],
    benefit: 'Maintained joint range = better stride economy. Post-race recovery without the load. Tendon health through controlled range-of-motion work.',
  },
];

/** Pick the best Amp workout for the given session type + phase + a
 *  rotation key (typically the ISO week number) so heavy weeks
 *  alternate between Posterior, Single-Leg, and Total Force across
 *  the cycle without ever picking the same one twice in a row. */
export function pickAmpWorkout(type: StrengthSessionType, phase: Phase, rotationKey: number): AmpWorkout | null {
  const exact = AMP_WORKOUTS.filter(w => w.fits.includes(type) && (!w.phases || w.phases.includes(phase)));
  if (exact.length > 0) return exact[Math.abs(rotationKey) % exact.length];
  const fallback = AMP_WORKOUTS.find(w => w.fits.includes(type));
  return fallback ?? null;
}

/** ISO week number, used as the rotation key so a given week always
 *  returns the same workout per session type, but consecutive weeks
 *  cycle through the catalog. */
export function isoWeekNumber(d: Date = new Date()): number {
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7;  // Mon=0...Sun=6
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const diff = (target.getTime() - firstThursday.getTime()) / 86_400_000;
  return 1 + Math.round((diff - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}
