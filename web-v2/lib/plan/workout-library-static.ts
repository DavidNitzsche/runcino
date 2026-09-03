/**
 * workout-library-static · the L2 workout catalog, in code.
 *
 * Replaces the `workout_library` DB table (migration 125, retired by
 * migration 158). The table was a second workout vocabulary beside
 * `lib/workout-catalogue/` (the doctrine-cited primary), and its rows were
 * static doctrine that changed only when someone re-ran the seed script —
 * so the rows now live here, transcribed VERBATIM from
 * `scripts/_seed_workout_library.mjs` (deleted with the table) and verified
 * byte-identical against the live table before the cut-over (54 rows,
 * ids 1–54 in seed order, 2026-08-28).
 *
 * Three consumers:
 *   · `resolvePrescriptions` (lib/plan/generate.ts) — `pickWorkout()` per
 *     (family, distance, phase, level); the catalogue's fallback strings.
 *   · `buildLibrary` (lib/plan/v5-block.ts) — the iPhone v5 Block screen's
 *     library section (`GET /api/v5/block`).
 *   · `/workouts` (app/workouts/page.tsx) — the web library browser.
 *
 * Determinism contract (unchanged from the DB reader): `pickWorkout` returns
 * the LOWEST-ID match. The array below is in id order, so `find()` is that
 * selection. Plan regeneration stays byte-reproducible.
 *
 * The DB table's `structure` jsonb was read by nothing and is not carried
 * over; `typical_distance_mi` / `typical_duration_min` /
 * `frequency_max_per_week` likewise had no reader. Everything a consumer
 * reads is here.
 */

export type WorkoutFamily =
  | 'recovery' | 'easy' | 'medium_long' | 'long'
  | 'threshold' | 'vo2max' | 'speed' | 'hills'
  | 'fartlek' | 'combo' | 'marathon_specific'
  | 'cutdown' | 'ladder' | 'race_specific'
  | 'base_building' | 'maintenance' | 'walk_run'
  | 'race' | 'shakeout' | 'rest';

export type DistanceFocus = '5k' | '10k' | 'hm' | 'm' | 'ultra' | 'all';
export type PlanPhase    = 'base' | 'build' | 'quality' | 'race_specific' | 'taper' | 'race_week' | 'maintenance';
export type Level        = 'beginner' | 'intermediate' | 'advanced' | 'advanced_plus';

export interface WorkoutTemplate {
  /** Stable identity — the retired table's serial id, preserved so the
   *  lowest-id pick keeps selecting the same rows it always did. */
  id: number;
  slug: string;
  name: string;
  family: WorkoutFamily;
  distanceFocus: string[];
  phaseFit: string[];
  levelFit: string[];
  paceZones: string[];
  isQuality: boolean;
  isLong: boolean;
  /** Display string used on plan cards. */
  prescriptionText: string;
  notes: string | null;
  warmupCooldown: string | null;
  citation: string;
}

interface PickArgs {
  family: WorkoutFamily;
  distance?: DistanceFocus;
  phase?: PlanPhase;
  level?: Level | null;
  /** Optional preference for a specific slug. */
  slug?: string;
}

/** The catalog, in id order. Do not reorder — order IS the pick priority. */
export const WORKOUT_LIBRARY: readonly WorkoutTemplate[] = [
  // ───────────── 1. RECOVERY ─────────────
  {
    id: 1,
    slug: 'recovery-run-20-45',
    name: 'Recovery run',
    family: 'recovery',
    distanceFocus: ['all'], phaseFit: ['base','build','quality','race_specific','taper','race_week','maintenance'],
    levelFit: ['intermediate','advanced','advanced_plus'],
    paceZones: ['E'], isQuality: false, isLong: false,
    prescriptionText: '20–45 min recovery jog',
    notes: 'Easier than easy. Day after a hard session. Skip if RHR >7 bpm above baseline.',
    warmupCooldown: 'None. Keep the whole thing easy.',
    citation: 'Research/04-workout-vocabulary.md §1',
  },

  // ───────────── 2. EASY / GENERAL AEROBIC ─────────────
  {
    id: 2,
    slug: 'easy-30',
    name: 'Easy run (30 min)',
    family: 'easy',
    distanceFocus: ['all'], phaseFit: ['base','build','quality','race_specific','taper','race_week','maintenance'],
    levelFit: ['beginner','intermediate','advanced','advanced_plus'],
    paceZones: ['E'], isQuality: false, isLong: false,
    prescriptionText: '30 min easy',
    notes: 'Easy enough to talk in full sentences. This run is where the week\'s volume comes from.',
    warmupCooldown: null,
    citation: 'Research/04-workout-vocabulary.md §2',
  },
  {
    id: 3,
    slug: 'easy-45',
    name: 'Easy run (45 min)',
    family: 'easy',
    distanceFocus: ['all'], phaseFit: ['base','build','quality','race_specific','taper','maintenance'],
    levelFit: ['intermediate','advanced','advanced_plus'],
    paceZones: ['E'], isQuality: false, isLong: false,
    prescriptionText: '45 min easy',
    notes: 'Easy enough to talk in full sentences. The standard weekday mid-distance run.',
    warmupCooldown: null,
    citation: 'Research/04-workout-vocabulary.md §2',
  },
  {
    id: 4,
    slug: 'easy-60',
    name: 'Easy run (60 min)',
    family: 'easy',
    distanceFocus: ['all'], phaseFit: ['base','build','quality','race_specific','maintenance'],
    levelFit: ['intermediate','advanced','advanced_plus'],
    paceZones: ['E'], isQuality: false, isLong: false,
    prescriptionText: '60 min easy',
    notes: 'Easy enough to talk in full sentences. Usually the second-longest run of the week.',
    warmupCooldown: null,
    citation: 'Research/04-workout-vocabulary.md §2',
  },
  {
    id: 5,
    slug: 'easy-plus-strides',
    name: 'Easy + 6 strides',
    family: 'easy',
    distanceFocus: ['all'], phaseFit: ['base','build','quality','race_specific','taper','maintenance'],
    levelFit: ['beginner','intermediate','advanced','advanced_plus'],
    paceZones: ['E','R'], isQuality: false, isLong: false,
    prescriptionText: '45 min easy + 6×80m strides',
    notes: 'End of an easy run. Relaxed mile-to-5K pace. Full walk between. Never skip strides · they keep neuromuscular sharpness.',
    warmupCooldown: null,
    citation: 'Research/04-workout-vocabulary.md §7.2',
  },

  // ───────────── 3. MEDIUM-LONG RUN ─────────────
  {
    id: 6,
    slug: 'medium-long-12',
    name: 'Medium-long run (12 mi)',
    family: 'medium_long',
    distanceFocus: ['hm','m'], phaseFit: ['build','quality','race_specific'],
    levelFit: ['intermediate','advanced','advanced_plus'],
    paceZones: ['E','M'], isQuality: false, isLong: false,
    prescriptionText: '12 mi medium-long (E)',
    notes: 'Bridges weekday easy and the weekend long run. Pfitzinger MLR. Don\'t race it.',
    warmupCooldown: null,
    citation: 'Research/04-workout-vocabulary.md §3',
  },
  {
    id: 7,
    slug: 'medium-long-14',
    name: 'Medium-long run (14 mi)',
    family: 'medium_long',
    distanceFocus: ['hm','m'], phaseFit: ['quality','race_specific'],
    levelFit: ['advanced','advanced_plus'],
    paceZones: ['E','M'], isQuality: false, isLong: false,
    prescriptionText: '14 mi medium-long (E)',
    notes: 'Pfitz peak-volume MLR. Sometimes appended with 6×ST.',
    warmupCooldown: null,
    citation: 'Research/04-workout-vocabulary.md §3',
  },

  // ───────────── 4. LONG RUNS ─────────────
  {
    id: 8,
    slug: 'long-base-90min',
    name: 'Base long run (90 min)',
    family: 'long',
    distanceFocus: ['5k','10k','hm','m'], phaseFit: ['base','build'],
    levelFit: ['intermediate','advanced','advanced_plus'],
    paceZones: ['E'], isQuality: false, isLong: true,
    prescriptionText: '90 min long (all E)',
    notes: 'Pure aerobic stimulus. Build the engine. Cap at 25% of weekly mileage for marathoners.',
    warmupCooldown: null,
    citation: 'Research/04-workout-vocabulary.md §4.2',
  },
  {
    id: 9,
    slug: 'long-base-16mi',
    name: 'Base long run (16 mi)',
    family: 'long',
    distanceFocus: ['hm','m'], phaseFit: ['build','quality'],
    levelFit: ['intermediate','advanced','advanced_plus'],
    paceZones: ['E'], isQuality: false, isLong: true,
    prescriptionText: '16 mi long (E)',
    notes: 'Marathon-block staple. Easy the whole way, talking in full sentences.',
    warmupCooldown: null,
    citation: 'Research/04-workout-vocabulary.md §4.2',
  },
  {
    id: 10,
    slug: 'long-base-20mi',
    name: 'Base long run (20 mi)',
    family: 'long',
    distanceFocus: ['m'], phaseFit: ['quality','race_specific'],
    levelFit: ['intermediate','advanced','advanced_plus'],
    paceZones: ['E'], isQuality: false, isLong: true,
    prescriptionText: '20 mi long (E)',
    notes: 'Marathon peak long. 3–4 times in a cycle is sufficient.',
    warmupCooldown: null,
    citation: 'Research/04-workout-vocabulary.md §4.2',
  },
  {
    id: 11,
    slug: 'long-progression-16',
    name: 'Progression long run (16 mi: 6E + 6M + 4T)',
    family: 'long',
    distanceFocus: ['hm','m'], phaseFit: ['race_specific'],
    levelFit: ['intermediate','advanced','advanced_plus'],
    paceZones: ['E','M','T'], isQuality: true, isLong: true,
    prescriptionText: '16 mi progression: 6 mi E + 6 mi M + 4 mi T',
    notes: 'Train pace tolerance under fatigue. Continuous, no walk breaks. Skip if accumulated fatigue is high.',
    warmupCooldown: null,
    citation: 'Research/04-workout-vocabulary.md §4.3',
  },
  {
    id: 12,
    slug: 'long-mp-16',
    name: 'Marathon-pace long run (16 mi w/ 12 @ MP)',
    family: 'long',
    distanceFocus: ['m'], phaseFit: ['race_specific'],
    levelFit: ['intermediate','advanced','advanced_plus'],
    paceZones: ['E','MP'], isQuality: true, isLong: true,
    prescriptionText: '16 mi: 2E + 12 @ MP + 2E',
    notes: 'Marathon-specific stimulus. MP exact, not faster. Every 2–3 weeks 6–10 weeks out.',
    warmupCooldown: null,
    citation: 'Research/04-workout-vocabulary.md §4.4',
  },
  {
    id: 13,
    slug: 'long-mp-20',
    name: 'Marathon-pace long run (20 mi w/ 14 @ MP)',
    family: 'long',
    distanceFocus: ['m'], phaseFit: ['race_specific'],
    levelFit: ['advanced','advanced_plus'],
    paceZones: ['E','MP'], isQuality: true, isLong: true,
    prescriptionText: '20 mi: 3E + 14 @ MP + 3E',
    notes: 'Peak marathon-specific session. 2× in a cycle is typical.',
    warmupCooldown: null,
    citation: 'Research/04-workout-vocabulary.md §4.4',
  },
  {
    id: 14,
    slug: 'long-fast-finish-14',
    name: 'Fast-finish long run (14 mi w/ last 3 @ MP)',
    family: 'long',
    distanceFocus: ['hm','m'], phaseFit: ['quality','race_specific'],
    levelFit: ['intermediate','advanced','advanced_plus'],
    paceZones: ['E','MP'], isQuality: true, isLong: true,
    prescriptionText: '14 mi: 11 E, last 3 @ MP',
    notes: 'Train ability to find pace late. Mental rehearsal of "the last 10K."',
    warmupCooldown: null,
    citation: 'Research/04-workout-vocabulary.md §4.5',
  },
  {
    id: 15,
    slug: 'long-dress-rehearsal-20',
    name: 'Dress-rehearsal long run (20 mi w/ MP segments)',
    family: 'long',
    distanceFocus: ['m'], phaseFit: ['race_specific'],
    levelFit: ['intermediate','advanced','advanced_plus'],
    paceZones: ['E','MP'], isQuality: true, isLong: true,
    prescriptionText: '20 mi w/ 2×4 mi @ MP · full kit + fuel rehearsal',
    notes: '3 weeks pre-marathon. Race-day breakfast, kit, fueling. Skip MP if any niggle flagging.',
    warmupCooldown: null,
    citation: 'Research/04-workout-vocabulary.md §4.6',
  },

  // ───────────── 5. THRESHOLD ─────────────
  {
    id: 16,
    slug: 'tempo-continuous-4',
    name: 'Continuous tempo (4 mi @ T)',
    family: 'threshold',
    distanceFocus: ['5k','10k','hm','m'], phaseFit: ['build','quality','race_specific'],
    levelFit: ['intermediate','advanced','advanced_plus'],
    paceZones: ['E','T'], isQuality: true, isLong: false,
    prescriptionText: '2 mi WU · 4 mi @ T · 2 mi CD',
    notes: '"Comfortably hard" · sustainable for ~1 hr in a race. Skip if HR/perceived effort elevated.',
    warmupCooldown: '2 mi E each side',
    citation: 'Research/04-workout-vocabulary.md §5.2',
  },
  {
    id: 17,
    slug: 'tempo-continuous-6',
    name: 'Continuous tempo (6 mi @ T)',
    family: 'threshold',
    distanceFocus: ['hm','m'], phaseFit: ['quality','race_specific'],
    levelFit: ['advanced','advanced_plus'],
    paceZones: ['E','T'], isQuality: true, isLong: false,
    prescriptionText: '2 mi WU · 6 mi @ T · 2 mi CD',
    notes: '~36 min at T. Backbone of HM/M training.',
    warmupCooldown: '2 mi E each side',
    citation: 'Research/04-workout-vocabulary.md §5.2',
  },
  {
    id: 18,
    slug: 'cruise-3x1mi-T',
    name: 'Cruise intervals (3×1 mi @ T)',
    family: 'threshold',
    distanceFocus: ['5k','10k','hm','m'], phaseFit: ['build','quality','race_specific'],
    levelFit: ['intermediate','advanced','advanced_plus'],
    paceZones: ['E','T'], isQuality: true, isLong: false,
    prescriptionText: '3×1 mi @ T · 60s jog',
    notes: 'WU 2 mi E, reps, CD 1.5 mi E. Even splits.',
    warmupCooldown: '2 mi WU + 1.5 mi CD',
    citation: 'Research/04-workout-vocabulary.md §5.3',
  },
  {
    id: 19,
    slug: 'cruise-4x1mi-T',
    name: 'Cruise intervals (4×1 mi @ T)',
    family: 'threshold',
    distanceFocus: ['10k','hm','m'], phaseFit: ['quality','race_specific'],
    levelFit: ['intermediate','advanced','advanced_plus'],
    paceZones: ['E','T'], isQuality: true, isLong: false,
    prescriptionText: '4×1 mi @ T · 60s jog',
    notes: 'Daniels cap: T at 10% weekly mileage. Even splits.',
    warmupCooldown: null,
    citation: 'Research/04-workout-vocabulary.md §5.3',
  },
  {
    id: 20,
    slug: 'cruise-4x1km-T',
    name: 'Cruise intervals (4×1km @ T)',
    family: 'threshold',
    distanceFocus: ['5k','10k','hm'], phaseFit: ['build','quality','race_specific'],
    levelFit: ['intermediate','advanced','advanced_plus'],
    paceZones: ['E','T'], isQuality: true, isLong: false,
    prescriptionText: '4×1km @ T · 60s jog',
    notes: '10K-style cruise. Shorter reps, same T pace.',
    warmupCooldown: null,
    citation: 'Research/04-workout-vocabulary.md §5.3',
  },
  {
    id: 21,
    slug: 'sub-threshold-5x1km',
    name: 'Sub-threshold intervals (5×1km @ ST)',
    family: 'threshold',
    distanceFocus: ['10k','hm','m'], phaseFit: ['base','build','quality'],
    levelFit: ['advanced','advanced_plus'],
    paceZones: ['E','ST'], isQuality: true, isLong: false,
    prescriptionText: '5×1km @ ST (10-15 s/mi slower than T) · 75s jog',
    notes: 'Norwegian sub-threshold. Pace discipline is everything. Too hard collapses the model.',
    warmupCooldown: null,
    citation: 'Research/04-workout-vocabulary.md §5.4',
  },
  {
    id: 22,
    slug: 'long-tempo-8',
    name: 'Long tempo (8 mi @ HM-ish)',
    family: 'threshold',
    distanceFocus: ['hm','m'], phaseFit: ['race_specific'],
    levelFit: ['advanced','advanced_plus'],
    paceZones: ['E','HM','T'], isQuality: true, isLong: true,
    prescriptionText: '1.5 WU · 8 mi @ HM pace · 1.5 CD',
    notes: 'Marathon-specific aerobic stress. ≥2 easy days after.',
    warmupCooldown: null,
    citation: 'Research/04-workout-vocabulary.md §5.5',
  },

  // ───────────── 6. VO2MAX ─────────────
  {
    id: 23,
    slug: 'mile-repeats-4xI',
    name: 'Mile repeats (4×1 mi @ I)',
    family: 'vo2max',
    distanceFocus: ['5k','10k','hm'], phaseFit: ['quality','race_specific'],
    levelFit: ['intermediate','advanced','advanced_plus'],
    paceZones: ['E','I'], isQuality: true, isLong: false,
    prescriptionText: '4×1 mi @ I · 3 min jog',
    notes: 'WU 2 mi E + drills + 2 strides. Hold even splits. Cap: 8% wkly mileage at I.',
    warmupCooldown: '2 mi WU + 1 mi CD',
    citation: 'Research/04-workout-vocabulary.md §6.2',
  },
  {
    id: 24,
    slug: 'mile-repeats-5xI',
    name: 'Mile repeats (5×1 mi @ I)',
    family: 'vo2max',
    distanceFocus: ['10k','hm'], phaseFit: ['quality','race_specific'],
    levelFit: ['advanced','advanced_plus'],
    paceZones: ['E','I'], isQuality: true, isLong: false,
    prescriptionText: '5×1 mi @ I · 3 min jog',
    notes: 'Daniels classic. Daniels: ≤ 8% wkly mileage at I.',
    warmupCooldown: null,
    citation: 'Research/04-workout-vocabulary.md §6.2',
  },
  {
    id: 25,
    slug: '1k-repeats-5xI',
    name: '1000m repeats (5×1K @ I)',
    family: 'vo2max',
    distanceFocus: ['5k','10k','hm'], phaseFit: ['quality','race_specific'],
    levelFit: ['intermediate','advanced','advanced_plus'],
    paceZones: ['E','I'], isQuality: true, isLong: false,
    prescriptionText: '5×1km @ I · 2:30 jog',
    notes: 'Ideal interval duration (~3–4 min) for max-out aerobic power.',
    warmupCooldown: null,
    citation: 'Research/04-workout-vocabulary.md §6.3',
  },
  {
    id: 26,
    slug: '1k-repeats-6xI',
    name: '1000m repeats (6×1K @ I)',
    family: 'vo2max',
    distanceFocus: ['10k','hm'], phaseFit: ['quality','race_specific'],
    levelFit: ['advanced','advanced_plus'],
    paceZones: ['E','I'], isQuality: true, isLong: false,
    prescriptionText: '6×1km @ I · 2:30 jog',
    notes: 'Advanced dose. Hold pace.',
    warmupCooldown: null,
    citation: 'Research/04-workout-vocabulary.md §6.3',
  },
  {
    id: 27,
    slug: '800m-repeats-6xI',
    name: '800m repeats (6×800 @ I)',
    family: 'vo2max',
    distanceFocus: ['5k','10k'], phaseFit: ['quality','race_specific'],
    levelFit: ['intermediate','advanced','advanced_plus'],
    paceZones: ['E','I'], isQuality: true, isLong: false,
    prescriptionText: '6×800m @ I · 2:30 jog',
    notes: 'Classic 5K-specific. First rep should not be the fastest.',
    warmupCooldown: null,
    citation: 'Research/04-workout-vocabulary.md §6.4',
  },
  {
    id: 28,
    slug: '800m-repeats-8xI',
    name: '800m repeats (8×800 @ I)',
    family: 'vo2max',
    distanceFocus: ['5k','10k'], phaseFit: ['quality','race_specific'],
    levelFit: ['advanced','advanced_plus'],
    paceZones: ['E','I'], isQuality: true, isLong: false,
    prescriptionText: '8×800m @ I · 2:30 jog',
    notes: '5K specific peak. ~4 mi total at I.',
    warmupCooldown: null,
    citation: 'Research/04-workout-vocabulary.md §6.4',
  },
  {
    id: 29,
    slug: 'yasso-800s-10',
    name: 'Yasso 800s (10×800)',
    family: 'vo2max',
    distanceFocus: ['m'], phaseFit: ['quality','race_specific'],
    levelFit: ['intermediate','advanced','advanced_plus'],
    paceZones: ['E','I'], isQuality: true, isLong: false,
    prescriptionText: '10×800m · time matches goal marathon · equal jog rec',
    notes: 'Final benchmark 10–14 days before goal marathon. Modern: VDOT prediction is more accurate but Yasso 800s still build VO2 well.',
    warmupCooldown: null,
    citation: 'Research/04-workout-vocabulary.md §6.7',
  },
  {
    id: 30,
    slug: '400m-repeats-12',
    name: '400m repeats (12×400 @ 5K)',
    family: 'vo2max',
    distanceFocus: ['5k'], phaseFit: ['quality','race_specific','taper'],
    levelFit: ['intermediate','advanced','advanced_plus'],
    paceZones: ['E','5K','3K'], isQuality: true, isLong: false,
    prescriptionText: '12×400 @ 5K pace · 90s jog',
    notes: 'Edge between VO2 and speed. Use in 5K-specific phase.',
    warmupCooldown: null,
    citation: 'Research/04-workout-vocabulary.md §6.6',
  },

  // ───────────── 7. SPEED / ECONOMY ─────────────
  {
    id: 31,
    slug: 'strides-standalone',
    name: 'Strides (6×80m standalone)',
    family: 'speed',
    distanceFocus: ['all'], phaseFit: ['base','build','quality','race_specific','taper','race_week','maintenance'],
    levelFit: ['beginner','intermediate','advanced','advanced_plus'],
    paceZones: ['E','R'], isQuality: false, isLong: false,
    prescriptionText: '2 mi E + 6×80m strides',
    notes: 'Never stop doing strides. End of an easy run. Relaxed acceleration to mile-5K pace.',
    warmupCooldown: null,
    citation: 'Research/04-workout-vocabulary.md §7.2',
  },
  {
    id: 32,
    slug: 'hill-sprints-8x10s',
    name: 'Hill sprints (8×10s)',
    family: 'speed',
    distanceFocus: ['all'], phaseFit: ['base','build','maintenance'],
    levelFit: ['intermediate','advanced','advanced_plus'],
    paceZones: ['R'], isQuality: false, isLong: false,
    prescriptionText: '8×10s hill sprints (steep) · walk down full rec',
    notes: 'Year-round. Especially valuable in base. Power, tendon stiffness, neuromuscular drive.',
    warmupCooldown: null,
    citation: 'Research/04-workout-vocabulary.md §7.3',
  },
  {
    id: 33,
    slug: '200m-repeats-10R',
    name: '200m repeats (10×200 @ R)',
    family: 'speed',
    distanceFocus: ['5k','10k'], phaseFit: ['base','race_specific','taper'],
    levelFit: ['intermediate','advanced','advanced_plus'],
    paceZones: ['E','R'], isQuality: true, isLong: false,
    prescriptionText: '10×200m @ R · 200m jog',
    notes: 'Daniels: cap R at 5% weekly mileage. Mile pace.',
    warmupCooldown: null,
    citation: 'Research/04-workout-vocabulary.md §7.4',
  },

  // ───────────── 8. HILLS ─────────────
  {
    id: 34,
    slug: 'hill-repeats-short-10x30s',
    name: 'Short hill repeats (10×30s)',
    family: 'hills',
    distanceFocus: ['all'], phaseFit: ['base','build'],
    levelFit: ['intermediate','advanced','advanced_plus'],
    paceZones: ['I','R'], isQuality: true, isLong: false,
    prescriptionText: '10×30s hills (4–7% grade) · walk/jog back',
    notes: 'Power + form. Gateway speed work.',
    warmupCooldown: null,
    citation: 'Research/04-workout-vocabulary.md §8.2',
  },
  {
    id: 35,
    slug: 'hill-repeats-medium-6x90s',
    name: 'Medium hill repeats (6×90s)',
    family: 'hills',
    distanceFocus: ['all'], phaseFit: ['build','quality'],
    levelFit: ['intermediate','advanced','advanced_plus'],
    paceZones: ['10K','5K'], isQuality: true, isLong: false,
    prescriptionText: '6×90s hills @ 5K–10K effort · 2:30 jog down',
    notes: 'Bridge between short hills and long hills.',
    warmupCooldown: null,
    citation: 'Research/04-workout-vocabulary.md §8.3',
  },
  {
    id: 36,
    slug: 'hill-repeats-long-5x3min',
    name: 'Long hill repeats (5×3 min)',
    family: 'hills',
    distanceFocus: ['10k','hm','m'], phaseFit: ['quality','race_specific'],
    levelFit: ['advanced','advanced_plus'],
    paceZones: ['T','10K'], isQuality: true, isLong: false,
    prescriptionText: '5×3 min hills @ T–10K · equal jog down',
    notes: 'VO2max with hill-strength stimulus. Reduces orthopedic stress vs flat intervals.',
    warmupCooldown: null,
    citation: 'Research/04-workout-vocabulary.md §8.4',
  },
  {
    id: 37,
    slug: 'hill-fartlek-45',
    name: 'Hill fartlek (45 min rolling)',
    family: 'hills',
    distanceFocus: ['all'], phaseFit: ['base','build'],
    levelFit: ['intermediate','advanced','advanced_plus'],
    paceZones: ['E','T','10K'], isQuality: true, isLong: false,
    prescriptionText: '45 min hilly: surge every climb, recover descents',
    notes: 'Continuous-run hill stimulus. 5–10 min total uphill surging.',
    warmupCooldown: null,
    citation: 'Research/04-workout-vocabulary.md §8.6',
  },

  // ───────────── 9. FARTLEK ─────────────
  {
    id: 38,
    slug: 'mona-fartlek',
    name: 'Mona fartlek (20 min)',
    family: 'fartlek',
    distanceFocus: ['5k','10k','hm'], phaseFit: ['base','build','quality'],
    levelFit: ['intermediate','advanced','advanced_plus'],
    paceZones: ['E','5K','3K'], isQuality: true, isLong: false,
    prescriptionText: 'Mona: 2×90s/90s + 4×60s/60s + 4×30s/30s + 4×15s/15s',
    notes: 'Moneghetti / Wardlaw. Floats are recovery jogs, not stops. Keep effort honest.',
    warmupCooldown: '15 min E each side',
    citation: 'Research/04-workout-vocabulary.md §9.2',
  },
  {
    id: 39,
    slug: 'fartlek-6x3min',
    name: 'Time fartlek (6×3 min on / 2 min off)',
    family: 'fartlek',
    distanceFocus: ['5k','10k','hm','m'], phaseFit: ['base','build','quality'],
    levelFit: ['intermediate','advanced','advanced_plus'],
    paceZones: ['E','10K','5K'], isQuality: true, isLong: false,
    prescriptionText: '6×3 min @ 10K effort · 2 min easy jog',
    notes: 'Structured pace play without a track. Good base-phase introduction.',
    warmupCooldown: null,
    citation: 'Research/04-workout-vocabulary.md §9.5',
  },

  // ───────────── 10. COMBO / ALTERNATION ─────────────
  {
    id: 40,
    slug: 'mp-10k-alternations-6',
    name: 'MP / 10K alternations (6×1 mi)',
    family: 'combo',
    distanceFocus: ['m'], phaseFit: ['race_specific'],
    levelFit: ['advanced','advanced_plus'],
    paceZones: ['MP','10K'], isQuality: true, isLong: false,
    prescriptionText: '6× (1 mi MP + 1 mi @ 10K) · continuous',
    notes: 'Marathon-specific lactate clearance. Recoveries are MP, not easy.',
    warmupCooldown: null,
    citation: 'Research/04-workout-vocabulary.md §10.1',
  },
  {
    id: 41,
    slug: 'wave-tempo-6mi',
    name: 'Wave tempo (6 mi continuous, ±10 s around T)',
    family: 'combo',
    distanceFocus: ['hm','m'], phaseFit: ['race_specific'],
    levelFit: ['advanced','advanced_plus'],
    paceZones: ['E','T'], isQuality: true, isLong: false,
    prescriptionText: '6 mi continuous wave tempo · ±10 s/mi around T',
    notes: 'Average lands at T. Rhythmic, race-pace-skill.',
    warmupCooldown: null,
    citation: 'Research/04-workout-vocabulary.md §10.3',
  },

  // ───────────── 11. MARATHON-SPECIFIC ─────────────
  {
    id: 42,
    slug: 'canova-2k-repeats-5',
    name: 'Canova 2K repeats (5×2K)',
    family: 'marathon_specific',
    distanceFocus: ['m'], phaseFit: ['race_specific'],
    levelFit: ['advanced','advanced_plus'],
    paceZones: ['MP','T'], isQuality: true, isLong: false,
    prescriptionText: '5×2K · descend MP → T · 2 min jog',
    notes: 'Each rep ~2.5–5 s/km faster than the previous. Even pace within each rep.',
    warmupCooldown: null,
    citation: 'Research/04-workout-vocabulary.md §11.2',
  },

  // ───────────── 12. CUTDOWN ─────────────
  {
    id: 43,
    slug: 'mile-cutdowns-4',
    name: 'Mile cutdowns (4×1 mi, descending)',
    family: 'cutdown',
    distanceFocus: ['5k','10k','hm'], phaseFit: ['quality','race_specific'],
    levelFit: ['intermediate','advanced','advanced_plus'],
    paceZones: ['MP','T','HM','5K'], isQuality: true, isLong: false,
    prescriptionText: '4×1 mi · MP → HM → T → 5K · 75s jog',
    notes: 'Progressive load. Composure under fatigue. Final rep at 5K pace or faster.',
    warmupCooldown: null,
    citation: 'Research/04-workout-vocabulary.md §12.2',
  },

  // ───────────── 13. LADDERS ─────────────
  {
    id: 44,
    slug: 'ladder-400-800-1200-1600',
    name: 'Ladder (400-800-1200-1600)',
    family: 'ladder',
    distanceFocus: ['5k','10k'], phaseFit: ['quality','race_specific'],
    levelFit: ['intermediate','advanced','advanced_plus'],
    paceZones: ['I','5K','3K','mile'], isQuality: true, isLong: false,
    prescriptionText: '400 (mile) → 800 (3K) → 1200 (5K) → 1600 (10K)',
    notes: 'Ascending ladder. Pace by rep length. Builds mental load.',
    warmupCooldown: null,
    citation: 'Research/04-workout-vocabulary.md §13.2',
  },

  // ───────────── 14. RACE-SPECIFIC ─────────────
  {
    id: 45,
    slug: 'race-spec-5k-12x400',
    name: '5K-specific: 12×400 at 5K pace',
    family: 'race_specific',
    distanceFocus: ['5k'], phaseFit: ['race_specific'],
    levelFit: ['intermediate','advanced','advanced_plus'],
    paceZones: ['5K'], isQuality: true, isLong: false,
    prescriptionText: '12×400 @ 5K race pace · 60–90s jog',
    notes: 'Classic 5K simulator. Tests race readiness.',
    warmupCooldown: null,
    citation: 'Research/04-workout-vocabulary.md §14.1',
  },
  {
    id: 46,
    slug: 'race-spec-10k-4x2k',
    name: '10K-specific: 4×2K at 10K pace',
    family: 'race_specific',
    distanceFocus: ['10k'], phaseFit: ['race_specific'],
    levelFit: ['intermediate','advanced','advanced_plus'],
    paceZones: ['10K'], isQuality: true, isLong: false,
    prescriptionText: '4×2K @ 10K race pace · 2:30 jog',
    notes: '10K race-pace specificity. Even splits.',
    warmupCooldown: null,
    citation: 'Research/04-workout-vocabulary.md §14.2',
  },
  {
    id: 47,
    slug: 'race-spec-hm-4x2mi',
    name: 'HM predictor: 4×2 mi at HM pace',
    family: 'race_specific',
    distanceFocus: ['hm'], phaseFit: ['race_specific'],
    levelFit: ['intermediate','advanced','advanced_plus'],
    paceZones: ['HM'], isQuality: true, isLong: false,
    prescriptionText: '4×2 mi @ HM pace · 60–120s jog',
    notes: 'Classic HM readiness workout. Complete in control 2 wk before race = ready.',
    warmupCooldown: null,
    citation: 'Research/04-workout-vocabulary.md §14.3',
  },
  {
    id: 48,
    slug: 'race-spec-hm-6x1mi',
    name: 'HM volume: 6×1 mi at HM pace',
    family: 'race_specific',
    distanceFocus: ['hm'], phaseFit: ['race_specific'],
    levelFit: ['intermediate','advanced','advanced_plus'],
    paceZones: ['HM'], isQuality: true, isLong: false,
    prescriptionText: '6×1 mi @ HM pace · 60s jog',
    notes: 'Mid-rep volume at HM. Short rests = high specificity.',
    warmupCooldown: null,
    citation: 'Research/04-workout-vocabulary.md §14.3',
  },

  // ───────────── 15. BASE BUILDING ─────────────
  {
    id: 49,
    slug: 'base-building-easy-strides',
    name: 'Base block: 6 mi E + 6×ST',
    family: 'base_building',
    distanceFocus: ['all'], phaseFit: ['base'],
    levelFit: ['intermediate','advanced','advanced_plus'],
    paceZones: ['E','R'], isQuality: false, isLong: false,
    prescriptionText: '6 mi E + 6×ST',
    notes: 'Standard Lydiard-influenced base. Keep building aerobic capacity.',
    warmupCooldown: null,
    citation: 'Research/22-plan-templates.md §6',
  },

  // ───────────── 16. MAINTENANCE ─────────────
  {
    id: 50,
    slug: 'maintenance-tempo-20min',
    name: 'Maintenance tempo (20 min @ T)',
    family: 'maintenance',
    distanceFocus: ['all'], phaseFit: ['maintenance'],
    levelFit: ['intermediate','advanced','advanced_plus'],
    paceZones: ['E','T'], isQuality: true, isLong: false,
    prescriptionText: '20 min @ T (sandwiched in easy)',
    notes: 'Between-cycle quality. Minimum-effective-dose: holds VO2max ~15 wk at 2/3 of training volume.',
    warmupCooldown: null,
    citation: 'Research/22-plan-templates.md §7',
  },

  // ───────────── 17. RACE-WEEK SCAFFOLD ─────────────
  {
    id: 51,
    slug: 'race-week-shakeout',
    name: 'Race-week shakeout (2 mi + 4×ST)',
    family: 'shakeout',
    distanceFocus: ['all'], phaseFit: ['race_week'],
    levelFit: ['beginner','intermediate','advanced','advanced_plus'],
    paceZones: ['E','R'], isQuality: false, isLong: false,
    prescriptionText: '2 mi E + 4×ST',
    notes: 'Day before race. Loosen the legs. Final stride ~5–10 min before gun (race day).',
    warmupCooldown: null,
    citation: 'Research/04-workout-vocabulary.md §17.3',
  },
  {
    id: 52,
    slug: 'race-week-rest',
    name: 'Race-week rest',
    family: 'rest',
    distanceFocus: ['all'], phaseFit: ['race_week'],
    levelFit: ['beginner','intermediate','advanced','advanced_plus'],
    paceZones: [], isQuality: false, isLong: false,
    prescriptionText: 'Off · hydrate, fuel, sleep',
    notes: '2 days before race: full rest. Off feet.',
    warmupCooldown: null,
    citation: 'Research/08-pacing-and-race-week.md §taper',
  },

  // ───────────── 18. WALK-RUN / RETURN-TO-RUN ─────────────
  {
    id: 53,
    slug: 'walk-run-4-1',
    name: 'Walk-run 4:1 (5 reps)',
    family: 'walk_run',
    distanceFocus: ['all'], phaseFit: ['base'],
    levelFit: ['beginner'],
    paceZones: ['E'], isQuality: false, isLong: false,
    prescriptionText: '4 min walk / 1 min jog × 5',
    notes: 'Return-to-run injury scaffold (minor severity). Pain ≥ 4/10 stops the session.',
    warmupCooldown: null,
    citation: 'Research/05-injury-return-protocols.md §General-Principles',
  },
  {
    id: 54,
    slug: 'walk-run-2-3',
    name: 'Walk-run 2:3 (5 reps)',
    family: 'walk_run',
    distanceFocus: ['all'], phaseFit: ['base'],
    levelFit: ['beginner'],
    paceZones: ['E'], isQuality: false, isLong: false,
    prescriptionText: '2 min walk / 3 min jog × 5',
    notes: 'Return-to-run progression. If 0 pain at end → progress to continuous next week.',
    warmupCooldown: null,
    citation: 'Research/05-injury-return-protocols.md §General-Principles',
  },
];

/** All templates, in id order. Kept as a function for API continuity with the
 *  retired DB reader — synchronous now, no cache, no failure mode. */
export function loadAllWorkouts(): readonly WorkoutTemplate[] {
  return WORKOUT_LIBRARY;
}

/** Match a template against the supplied filters. Semantics identical to the
 *  retired DB reader's `matches()`. */
function matches(t: WorkoutTemplate, args: PickArgs): boolean {
  if (t.family !== args.family) return false;
  if (args.distance && args.distance !== 'all') {
    if (!t.distanceFocus.includes(args.distance) && !t.distanceFocus.includes('all')) return false;
  }
  if (args.phase) {
    if (t.phaseFit.length > 0 && !t.phaseFit.includes(args.phase)) return false;
  }
  if (args.level) {
    if (t.levelFit.length > 0 && !t.levelFit.includes(args.level)) return false;
  }
  if (args.slug && t.slug !== args.slug) return false;
  return true;
}

/**
 * Pick one matching template for (family, distance, phase, level).
 * Returns null if no match — caller falls back to its inline default.
 *
 * Deterministic: returns the lowest-id matching template so plan
 * regeneration is reproducible. The array is in id order, so first
 * match IS the lowest id — byte-identical to the DB reader's
 * `ORDER BY id ASC LIMIT 1` selection.
 */
export function pickWorkout(args: PickArgs): WorkoutTemplate | null {
  return WORKOUT_LIBRARY.find((t) => matches(t, args)) ?? null;
}
