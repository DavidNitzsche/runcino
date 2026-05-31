/**
 * Seed workout_library from Research/04-workout-vocabulary.md +
 * Research/22-plan-templates.md.
 *
 * Every row carries a citation. The structure jsonb is the machine-readable
 * recipe; prescription_text is the short display string used on plan cards.
 *
 * Idempotent via ON CONFLICT (slug) DO UPDATE — re-running this script
 * promotes any doctrine edits without duplicating rows.
 *
 * Run: node web-v2/scripts/_seed_workout_library.mjs
 */
import { Pool } from 'pg';
import fs from 'fs';

// Match the env-loading pattern used by apply-*.mjs scripts in this repo.
const env = fs.existsSync('.env.local')
  ? fs.readFileSync('.env.local','utf8').split('\n').reduce((a,l)=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)a[m[1]]=m[2].replace(/^["']|["']$/g,'');return a;},{})
  : {};

const pool = new Pool({
  connectionString: env.DATABASE_URL ?? process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Helper to make int4range / numrange literals safely.
const r = (lo, hi) => (lo == null && hi == null) ? null : `[${lo ?? ''},${hi ?? ''}]`;

/**
 * One row per canonical workout.
 *
 *   family enum:
 *     recovery, easy, medium_long, long, threshold, vo2max, speed,
 *     hills, fartlek, combo, marathon_specific, cutdown, ladder,
 *     race_specific, base_building, maintenance, walk_run, race,
 *     shakeout, rest
 *
 *   distance_focus: ['5k','10k','hm','m','ultra','all']
 *   phase_fit:      ['base','build','quality','race_specific','taper','race_week','maintenance']
 *   level_fit:      ['beginner','intermediate','advanced','advanced_plus']
 *   pace_zones:     ['E','M','T','I','R','ST','HM','MP','10K','5K','3K']
 */
const ROWS = [
  // ───────────── 1. RECOVERY ─────────────
  {
    slug: 'recovery-run-20-45',
    name: 'Recovery run',
    family: 'recovery',
    distance_focus: ['all'], phase_fit: ['base','build','quality','race_specific','taper','race_week','maintenance'],
    level_fit: ['intermediate','advanced','advanced_plus'],
    pace_zones: ['E'], is_quality: false, is_long: false,
    duration: r(20, 45), distance: r(2, 5), freq: 3,
    structure: { type: 'recovery', pace_below_easy: true, hr_cap_pct_max: 70 },
    prescription_text: '20–45 min recovery jog',
    notes: 'Easier than easy. Day after a hard session. Skip if RHR >7 bpm above baseline.',
    warmup_cooldown: 'None — keep the whole thing easy.',
    citation: 'Research/04-workout-vocabulary.md §1',
  },

  // ───────────── 2. EASY / GENERAL AEROBIC ─────────────
  {
    slug: 'easy-30',
    name: 'Easy run (30 min)',
    family: 'easy',
    distance_focus: ['all'], phase_fit: ['base','build','quality','race_specific','taper','race_week','maintenance'],
    level_fit: ['beginner','intermediate','advanced','advanced_plus'],
    pace_zones: ['E'], is_quality: false, is_long: false,
    duration: r(25, 35), distance: r(3, 5), freq: 5,
    structure: { type: 'easy', conversational: true, hr_zone: 'Z2' },
    prescription_text: '30 min easy',
    notes: 'Conversational. Z2 HR cap. Bulk-volume building block.',
    warmup_cooldown: null,
    citation: 'Research/04-workout-vocabulary.md §2',
  },
  {
    slug: 'easy-45',
    name: 'Easy run (45 min)',
    family: 'easy',
    distance_focus: ['all'], phase_fit: ['base','build','quality','race_specific','taper','maintenance'],
    level_fit: ['intermediate','advanced','advanced_plus'],
    pace_zones: ['E'], is_quality: false, is_long: false,
    duration: r(40, 50), distance: r(4, 6), freq: 5,
    structure: { type: 'easy', conversational: true },
    prescription_text: '45 min easy',
    notes: 'Conversational. Standard weekday mid-distance easy.',
    citation: 'Research/04-workout-vocabulary.md §2',
  },
  {
    slug: 'easy-60',
    name: 'Easy run (60 min)',
    family: 'easy',
    distance_focus: ['all'], phase_fit: ['base','build','quality','race_specific','maintenance'],
    level_fit: ['intermediate','advanced','advanced_plus'],
    pace_zones: ['E'], is_quality: false, is_long: false,
    duration: r(55, 70), distance: r(6, 8), freq: 3,
    structure: { type: 'easy', conversational: true },
    prescription_text: '60 min easy',
    notes: 'Conversational. Common second-longest weekday run.',
    citation: 'Research/04-workout-vocabulary.md §2',
  },
  {
    slug: 'easy-plus-strides',
    name: 'Easy + 6 strides',
    family: 'easy',
    distance_focus: ['all'], phase_fit: ['base','build','quality','race_specific','taper','maintenance'],
    level_fit: ['beginner','intermediate','advanced','advanced_plus'],
    pace_zones: ['E','R'], is_quality: false, is_long: false,
    duration: r(35, 55), distance: r(4, 6), freq: 2,
    structure: { type: 'easy_plus_strides', strides: { count: 6, distance_m: 80, pace_zone: 'R', recovery: 'full_walk' } },
    prescription_text: '45 min easy + 6×80m strides',
    notes: 'End of an easy run. Relaxed mile-to-5K pace. Full walk between. Never skip strides — keep neuromuscular sharpness.',
    citation: 'Research/04-workout-vocabulary.md §7.2',
  },

  // ───────────── 3. MEDIUM-LONG RUN ─────────────
  {
    slug: 'medium-long-12',
    name: 'Medium-long run (12 mi)',
    family: 'medium_long',
    distance_focus: ['hm','m'], phase_fit: ['build','quality','race_specific'],
    level_fit: ['intermediate','advanced','advanced_plus'],
    pace_zones: ['E','M'], is_quality: false, is_long: false,
    duration: r(90, 120), distance: r(11, 13), freq: 1,
    structure: { type: 'medium_long', bulk_pace: 'E', optional_M_segment_mi: 0 },
    prescription_text: '12 mi medium-long (E)',
    notes: 'Bridges weekday easy and the weekend long run. Pfitzinger MLR. Don\'t race it.',
    citation: 'Research/04-workout-vocabulary.md §3',
  },
  {
    slug: 'medium-long-14',
    name: 'Medium-long run (14 mi)',
    family: 'medium_long',
    distance_focus: ['hm','m'], phase_fit: ['quality','race_specific'],
    level_fit: ['advanced','advanced_plus'],
    pace_zones: ['E','M'], is_quality: false, is_long: false,
    duration: r(105, 135), distance: r(13, 15), freq: 1,
    structure: { type: 'medium_long', bulk_pace: 'E' },
    prescription_text: '14 mi medium-long (E)',
    notes: 'Pfitz peak-volume MLR. Sometimes appended with 6×ST.',
    citation: 'Research/04-workout-vocabulary.md §3',
  },

  // ───────────── 4. LONG RUNS ─────────────
  {
    slug: 'long-base-90min',
    name: 'Base long run (90 min)',
    family: 'long',
    distance_focus: ['5k','10k','hm','m'], phase_fit: ['base','build'],
    level_fit: ['intermediate','advanced','advanced_plus'],
    pace_zones: ['E'], is_quality: false, is_long: true,
    duration: r(85, 100), distance: r(8, 12), freq: 1,
    structure: { type: 'base_long', pace: 'E', conversational: true },
    prescription_text: '90 min long (all E)',
    notes: 'Pure aerobic stimulus. Build the engine. Cap at 25% of weekly mileage for marathoners.',
    citation: 'Research/04-workout-vocabulary.md §4.2',
  },
  {
    slug: 'long-base-16mi',
    name: 'Base long run (16 mi)',
    family: 'long',
    distance_focus: ['hm','m'], phase_fit: ['build','quality'],
    level_fit: ['intermediate','advanced','advanced_plus'],
    pace_zones: ['E'], is_quality: false, is_long: true,
    duration: r(135, 165), distance: r(15, 17), freq: 1,
    structure: { type: 'base_long', pace: 'E' },
    prescription_text: '16 mi long (E)',
    notes: 'Marathon-block staple. Conversational throughout.',
    citation: 'Research/04-workout-vocabulary.md §4.2',
  },
  {
    slug: 'long-base-20mi',
    name: 'Base long run (20 mi)',
    family: 'long',
    distance_focus: ['m'], phase_fit: ['quality','race_specific'],
    level_fit: ['intermediate','advanced','advanced_plus'],
    pace_zones: ['E'], is_quality: false, is_long: true,
    duration: r(165, 210), distance: r(19, 21), freq: 1,
    structure: { type: 'base_long', pace: 'E' },
    prescription_text: '20 mi long (E)',
    notes: 'Marathon peak long. 3–4 times in a cycle is sufficient.',
    citation: 'Research/04-workout-vocabulary.md §4.2',
  },
  {
    slug: 'long-progression-16',
    name: 'Progression long run (16 mi: 6E + 6M + 4T)',
    family: 'long',
    distance_focus: ['hm','m'], phase_fit: ['race_specific'],
    level_fit: ['intermediate','advanced','advanced_plus'],
    pace_zones: ['E','M','T'], is_quality: true, is_long: true,
    duration: r(120, 140), distance: r(15, 17), freq: 1,
    structure: {
      type: 'progression_long',
      blocks: [
        { miles: 6, pace_zone: 'E' },
        { miles: 6, pace_zone: 'M' },
        { miles: 4, pace_zone: 'T' },
      ],
    },
    prescription_text: '16 mi progression: 6 mi E + 6 mi M + 4 mi T',
    notes: 'Train pace tolerance under fatigue. Continuous — no walk breaks. Skip if accumulated fatigue is high.',
    citation: 'Research/04-workout-vocabulary.md §4.3',
  },
  {
    slug: 'long-mp-16',
    name: 'Marathon-pace long run (16 mi w/ 12 @ MP)',
    family: 'long',
    distance_focus: ['m'], phase_fit: ['race_specific'],
    level_fit: ['intermediate','advanced','advanced_plus'],
    pace_zones: ['E','MP'], is_quality: true, is_long: true,
    duration: r(120, 140), distance: r(15, 17), freq: 1,
    structure: {
      type: 'mp_long',
      blocks: [
        { miles: 2, pace_zone: 'E', label: 'warmup' },
        { miles: 12, pace_zone: 'MP' },
        { miles: 2, pace_zone: 'E', label: 'cooldown' },
      ],
    },
    prescription_text: '16 mi: 2E + 12 @ MP + 2E',
    notes: 'Marathon-specific stimulus. MP exact — not faster. Every 2–3 weeks 6–10 weeks out.',
    citation: 'Research/04-workout-vocabulary.md §4.4',
  },
  {
    slug: 'long-mp-20',
    name: 'Marathon-pace long run (20 mi w/ 14 @ MP)',
    family: 'long',
    distance_focus: ['m'], phase_fit: ['race_specific'],
    level_fit: ['advanced','advanced_plus'],
    pace_zones: ['E','MP'], is_quality: true, is_long: true,
    duration: r(165, 195), distance: r(19, 21), freq: 1,
    structure: {
      type: 'mp_long',
      blocks: [
        { miles: 3, pace_zone: 'E', label: 'warmup' },
        { miles: 14, pace_zone: 'MP' },
        { miles: 3, pace_zone: 'E', label: 'cooldown' },
      ],
    },
    prescription_text: '20 mi: 3E + 14 @ MP + 3E',
    notes: 'Peak marathon-specific session. 2× in a cycle is typical.',
    citation: 'Research/04-workout-vocabulary.md §4.4',
  },
  {
    slug: 'long-fast-finish-14',
    name: 'Fast-finish long run (14 mi w/ last 3 @ MP)',
    family: 'long',
    distance_focus: ['hm','m'], phase_fit: ['quality','race_specific'],
    level_fit: ['intermediate','advanced','advanced_plus'],
    pace_zones: ['E','MP'], is_quality: true, is_long: true,
    duration: r(105, 125), distance: r(13, 15), freq: 1,
    structure: {
      type: 'fast_finish_long',
      blocks: [
        { miles: 11, pace_zone: 'E' },
        { miles: 3, pace_zone: 'MP', label: 'fast finish' },
      ],
    },
    prescription_text: '14 mi: 11 E, last 3 @ MP',
    notes: 'Train ability to find pace late. Mental rehearsal of "the last 10K."',
    citation: 'Research/04-workout-vocabulary.md §4.5',
  },
  {
    slug: 'long-dress-rehearsal-20',
    name: 'Dress-rehearsal long run (20 mi w/ MP segments)',
    family: 'long',
    distance_focus: ['m'], phase_fit: ['race_specific'],
    level_fit: ['intermediate','advanced','advanced_plus'],
    pace_zones: ['E','MP'], is_quality: true, is_long: true,
    duration: r(150, 175), distance: r(19, 21), freq: 1,
    structure: {
      type: 'dress_rehearsal',
      blocks: [
        { miles: 6, pace_zone: 'E', label: 'warmup' },
        { miles: 4, pace_zone: 'MP', label: 'segment 1' },
        { miles: 3, pace_zone: 'E', label: 'recovery' },
        { miles: 4, pace_zone: 'MP', label: 'segment 2' },
        { miles: 3, pace_zone: 'E', label: 'cooldown' },
      ],
      race_day_simulation: { kit: true, fueling: true, breakfast: true },
    },
    prescription_text: '20 mi w/ 2×4 mi @ MP — full kit + fuel rehearsal',
    notes: '3 weeks pre-marathon. Race-day breakfast, kit, fueling. Skip MP if any niggle flagging.',
    citation: 'Research/04-workout-vocabulary.md §4.6',
  },

  // ───────────── 5. THRESHOLD ─────────────
  {
    slug: 'tempo-continuous-4',
    name: 'Continuous tempo (4 mi @ T)',
    family: 'threshold',
    distance_focus: ['5k','10k','hm','m'], phase_fit: ['build','quality','race_specific'],
    level_fit: ['intermediate','advanced','advanced_plus'],
    pace_zones: ['E','T'], is_quality: true, is_long: false,
    duration: r(50, 65), distance: r(7, 9), freq: 1,
    structure: {
      type: 'continuous_tempo',
      blocks: [
        { miles: 2, pace_zone: 'E', label: 'WU' },
        { miles: 4, pace_zone: 'T' },
        { miles: 2, pace_zone: 'E', label: 'CD' },
      ],
    },
    prescription_text: '2 mi WU · 4 mi @ T · 2 mi CD',
    notes: '"Comfortably hard" — sustainable for ~1 hr in a race. Skip if HR/perceived effort elevated.',
    warmup_cooldown: '2 mi E each side',
    citation: 'Research/04-workout-vocabulary.md §5.2',
  },
  {
    slug: 'tempo-continuous-6',
    name: 'Continuous tempo (6 mi @ T)',
    family: 'threshold',
    distance_focus: ['hm','m'], phase_fit: ['quality','race_specific'],
    level_fit: ['advanced','advanced_plus'],
    pace_zones: ['E','T'], is_quality: true, is_long: false,
    duration: r(70, 85), distance: r(10, 12), freq: 1,
    structure: {
      type: 'continuous_tempo',
      blocks: [
        { miles: 2, pace_zone: 'E', label: 'WU' },
        { miles: 6, pace_zone: 'T' },
        { miles: 2, pace_zone: 'E', label: 'CD' },
      ],
    },
    prescription_text: '2 mi WU · 6 mi @ T · 2 mi CD',
    notes: '~36 min at T. Backbone of HM/M training.',
    warmup_cooldown: '2 mi E each side',
    citation: 'Research/04-workout-vocabulary.md §5.2',
  },
  {
    slug: 'cruise-3x1mi-T',
    name: 'Cruise intervals (3×1 mi @ T)',
    family: 'threshold',
    distance_focus: ['5k','10k','hm','m'], phase_fit: ['build','quality','race_specific'],
    level_fit: ['intermediate','advanced','advanced_plus'],
    pace_zones: ['E','T'], is_quality: true, is_long: false,
    duration: r(55, 70), distance: r(8, 10), freq: 1,
    structure: {
      type: 'cruise_intervals',
      reps: 3, rep_distance_m: 1609, rep_pace_zone: 'T', recovery_sec: 60,
      total_at_pace_mi: 3,
    },
    prescription_text: '3×1 mi @ T · 60s jog',
    notes: 'WU 2 mi E, reps, CD 1.5 mi E. Even splits.',
    warmup_cooldown: '2 mi WU + 1.5 mi CD',
    citation: 'Research/04-workout-vocabulary.md §5.3',
  },
  {
    slug: 'cruise-4x1mi-T',
    name: 'Cruise intervals (4×1 mi @ T)',
    family: 'threshold',
    distance_focus: ['10k','hm','m'], phase_fit: ['quality','race_specific'],
    level_fit: ['intermediate','advanced','advanced_plus'],
    pace_zones: ['E','T'], is_quality: true, is_long: false,
    duration: r(60, 75), distance: r(9, 11), freq: 1,
    structure: {
      type: 'cruise_intervals',
      reps: 4, rep_distance_m: 1609, rep_pace_zone: 'T', recovery_sec: 60,
      total_at_pace_mi: 4,
    },
    prescription_text: '4×1 mi @ T · 60s jog',
    notes: 'Daniels cap: T at 10% weekly mileage. Even splits.',
    citation: 'Research/04-workout-vocabulary.md §5.3',
  },
  {
    slug: 'cruise-4x1km-T',
    name: 'Cruise intervals (4×1km @ T)',
    family: 'threshold',
    distance_focus: ['5k','10k','hm'], phase_fit: ['build','quality','race_specific'],
    level_fit: ['intermediate','advanced','advanced_plus'],
    pace_zones: ['E','T'], is_quality: true, is_long: false,
    duration: r(45, 60), distance: r(7, 9), freq: 1,
    structure: {
      type: 'cruise_intervals',
      reps: 4, rep_distance_m: 1000, rep_pace_zone: 'T', recovery_sec: 60,
      total_at_pace_mi: 2.5,
    },
    prescription_text: '4×1km @ T · 60s jog',
    notes: '10K-style cruise. Shorter reps, same T pace.',
    citation: 'Research/04-workout-vocabulary.md §5.3',
  },
  {
    slug: 'sub-threshold-5x1km',
    name: 'Sub-threshold intervals (5×1km @ ST)',
    family: 'threshold',
    distance_focus: ['10k','hm','m'], phase_fit: ['base','build','quality'],
    level_fit: ['advanced','advanced_plus'],
    pace_zones: ['E','ST'], is_quality: true, is_long: false,
    duration: r(50, 65), distance: r(7, 9), freq: 2,
    structure: {
      type: 'sub_threshold',
      reps: 5, rep_distance_m: 1000, rep_pace_zone: 'ST', recovery_sec: 75,
      target_lactate_mmol: [2.5, 3.5],
    },
    prescription_text: '5×1km @ ST (10-15 s/mi slower than T) · 75s jog',
    notes: 'Norwegian sub-threshold. Pace discipline is everything — too hard collapses the model.',
    citation: 'Research/04-workout-vocabulary.md §5.4',
  },
  {
    slug: 'long-tempo-8',
    name: 'Long tempo (8 mi @ HM-ish)',
    family: 'threshold',
    distance_focus: ['hm','m'], phase_fit: ['race_specific'],
    level_fit: ['advanced','advanced_plus'],
    pace_zones: ['E','HM','T'], is_quality: true, is_long: true,
    duration: r(75, 90), distance: r(10, 12), freq: 1,
    structure: {
      type: 'long_tempo',
      blocks: [
        { miles: 1.5, pace_zone: 'E', label: 'WU' },
        { miles: 8, pace_zone: 'HM' },
        { miles: 1.5, pace_zone: 'E', label: 'CD' },
      ],
    },
    prescription_text: '1.5 WU · 8 mi @ HM pace · 1.5 CD',
    notes: 'Marathon-specific aerobic stress. ≥2 easy days after.',
    citation: 'Research/04-workout-vocabulary.md §5.5',
  },

  // ───────────── 6. VO2MAX ─────────────
  {
    slug: 'mile-repeats-4xI',
    name: 'Mile repeats (4×1 mi @ I)',
    family: 'vo2max',
    distance_focus: ['5k','10k','hm'], phase_fit: ['quality','race_specific'],
    level_fit: ['intermediate','advanced','advanced_plus'],
    pace_zones: ['E','I'], is_quality: true, is_long: false,
    duration: r(60, 80), distance: r(8, 10), freq: 1,
    structure: {
      type: 'vo2max_intervals',
      reps: 4, rep_distance_m: 1609, rep_pace_zone: 'I', recovery_min: 3,
      total_at_pace_mi: 4,
    },
    prescription_text: '4×1 mi @ I · 3 min jog',
    notes: 'WU 2 mi E + drills + 2 strides. Hold even splits. Cap: 8% wkly mileage at I.',
    warmup_cooldown: '2 mi WU + 1 mi CD',
    citation: 'Research/04-workout-vocabulary.md §6.2',
  },
  {
    slug: 'mile-repeats-5xI',
    name: 'Mile repeats (5×1 mi @ I)',
    family: 'vo2max',
    distance_focus: ['10k','hm'], phase_fit: ['quality','race_specific'],
    level_fit: ['advanced','advanced_plus'],
    pace_zones: ['E','I'], is_quality: true, is_long: false,
    duration: r(70, 90), distance: r(9, 11), freq: 1,
    structure: {
      type: 'vo2max_intervals',
      reps: 5, rep_distance_m: 1609, rep_pace_zone: 'I', recovery_min: 3,
      total_at_pace_mi: 5,
    },
    prescription_text: '5×1 mi @ I · 3 min jog',
    notes: 'Daniels classic. Daniels: ≤ 8% wkly mileage at I.',
    citation: 'Research/04-workout-vocabulary.md §6.2',
  },
  {
    slug: '1k-repeats-5xI',
    name: '1000m repeats (5×1K @ I)',
    family: 'vo2max',
    distance_focus: ['5k','10k','hm'], phase_fit: ['quality','race_specific'],
    level_fit: ['intermediate','advanced','advanced_plus'],
    pace_zones: ['E','I'], is_quality: true, is_long: false,
    duration: r(55, 70), distance: r(7, 9), freq: 1,
    structure: {
      type: 'vo2max_intervals',
      reps: 5, rep_distance_m: 1000, rep_pace_zone: 'I', recovery_sec: 150,
      total_at_pace_mi: 3.1,
    },
    prescription_text: '5×1km @ I · 2:30 jog',
    notes: 'Ideal interval duration (~3–4 min) for max-out aerobic power.',
    citation: 'Research/04-workout-vocabulary.md §6.3',
  },
  {
    slug: '1k-repeats-6xI',
    name: '1000m repeats (6×1K @ I)',
    family: 'vo2max',
    distance_focus: ['10k','hm'], phase_fit: ['quality','race_specific'],
    level_fit: ['advanced','advanced_plus'],
    pace_zones: ['E','I'], is_quality: true, is_long: false,
    duration: r(65, 80), distance: r(8, 10), freq: 1,
    structure: {
      type: 'vo2max_intervals',
      reps: 6, rep_distance_m: 1000, rep_pace_zone: 'I', recovery_sec: 150,
      total_at_pace_mi: 3.7,
    },
    prescription_text: '6×1km @ I · 2:30 jog',
    notes: 'Advanced dose. Hold pace.',
    citation: 'Research/04-workout-vocabulary.md §6.3',
  },
  {
    slug: '800m-repeats-6xI',
    name: '800m repeats (6×800 @ I)',
    family: 'vo2max',
    distance_focus: ['5k','10k'], phase_fit: ['quality','race_specific'],
    level_fit: ['intermediate','advanced','advanced_plus'],
    pace_zones: ['E','I'], is_quality: true, is_long: false,
    duration: r(55, 70), distance: r(7, 9), freq: 1,
    structure: {
      type: 'vo2max_intervals',
      reps: 6, rep_distance_m: 800, rep_pace_zone: 'I', recovery_sec: 150,
      total_at_pace_mi: 3.0,
    },
    prescription_text: '6×800m @ I · 2:30 jog',
    notes: 'Classic 5K-specific. First rep should not be the fastest.',
    citation: 'Research/04-workout-vocabulary.md §6.4',
  },
  {
    slug: '800m-repeats-8xI',
    name: '800m repeats (8×800 @ I)',
    family: 'vo2max',
    distance_focus: ['5k','10k'], phase_fit: ['quality','race_specific'],
    level_fit: ['advanced','advanced_plus'],
    pace_zones: ['E','I'], is_quality: true, is_long: false,
    duration: r(65, 80), distance: r(8, 10), freq: 1,
    structure: {
      type: 'vo2max_intervals',
      reps: 8, rep_distance_m: 800, rep_pace_zone: 'I', recovery_sec: 150,
      total_at_pace_mi: 4.0,
    },
    prescription_text: '8×800m @ I · 2:30 jog',
    notes: '5K specific peak. ~4 mi total at I.',
    citation: 'Research/04-workout-vocabulary.md §6.4',
  },
  {
    slug: 'yasso-800s-10',
    name: 'Yasso 800s (10×800)',
    family: 'vo2max',
    distance_focus: ['m'], phase_fit: ['quality','race_specific'],
    level_fit: ['intermediate','advanced','advanced_plus'],
    pace_zones: ['E','I'], is_quality: true, is_long: false,
    duration: r(70, 90), distance: r(9, 11), freq: 1,
    structure: {
      type: 'yasso_800s',
      reps: 10, rep_distance_m: 800, recovery_match_time: true,
      pace_formula: 'time per 800 (min:sec) = goal marathon (hr:min)',
    },
    prescription_text: '10×800m · time matches goal marathon · equal jog rec',
    notes: 'Final benchmark 10–14 days before goal marathon. Modern: VDOT prediction is more accurate but Yasso 800s still build VO2 well.',
    citation: 'Research/04-workout-vocabulary.md §6.7',
  },
  {
    slug: '400m-repeats-12',
    name: '400m repeats (12×400 @ 5K)',
    family: 'vo2max',
    distance_focus: ['5k'], phase_fit: ['quality','race_specific','taper'],
    level_fit: ['intermediate','advanced','advanced_plus'],
    pace_zones: ['E','5K','3K'], is_quality: true, is_long: false,
    duration: r(50, 65), distance: r(6, 8), freq: 1,
    structure: {
      type: 'vo2max_intervals',
      reps: 12, rep_distance_m: 400, rep_pace_zone: '5K', recovery_sec: 90,
      total_at_pace_mi: 3.0,
    },
    prescription_text: '12×400 @ 5K pace · 90s jog',
    notes: 'Edge between VO2 and speed. Use in 5K-specific phase.',
    citation: 'Research/04-workout-vocabulary.md §6.6',
  },

  // ───────────── 7. SPEED / ECONOMY ─────────────
  {
    slug: 'strides-standalone',
    name: 'Strides (6×80m standalone)',
    family: 'speed',
    distance_focus: ['all'], phase_fit: ['base','build','quality','race_specific','taper','race_week','maintenance'],
    level_fit: ['beginner','intermediate','advanced','advanced_plus'],
    pace_zones: ['E','R'], is_quality: false, is_long: false,
    duration: r(20, 30), distance: r(2, 4), freq: 3,
    structure: {
      type: 'strides',
      count: 6, distance_m: 80, recovery: 'full_walk',
    },
    prescription_text: '2 mi E + 6×80m strides',
    notes: 'Never stop doing strides. End of an easy run. Relaxed acceleration to mile-5K pace.',
    citation: 'Research/04-workout-vocabulary.md §7.2',
  },
  {
    slug: 'hill-sprints-8x10s',
    name: 'Hill sprints (8×10s)',
    family: 'speed',
    distance_focus: ['all'], phase_fit: ['base','build','maintenance'],
    level_fit: ['intermediate','advanced','advanced_plus'],
    pace_zones: ['R'], is_quality: false, is_long: false,
    duration: r(25, 40), distance: r(3, 5), freq: 1,
    structure: {
      type: 'hill_sprints',
      reps: 8, duration_sec: 10, grade_pct: [8, 15], recovery: 'walk_down_full',
    },
    prescription_text: '8×10s hill sprints (steep) · walk down full rec',
    notes: 'Year-round. Especially valuable in base. Power, tendon stiffness, neuromuscular drive.',
    citation: 'Research/04-workout-vocabulary.md §7.3',
  },
  {
    slug: '200m-repeats-10R',
    name: '200m repeats (10×200 @ R)',
    family: 'speed',
    distance_focus: ['5k','10k'], phase_fit: ['base','race_specific','taper'],
    level_fit: ['intermediate','advanced','advanced_plus'],
    pace_zones: ['E','R'], is_quality: true, is_long: false,
    duration: r(40, 55), distance: r(5, 7), freq: 1,
    structure: {
      type: 'speed_repeats',
      reps: 10, rep_distance_m: 200, rep_pace_zone: 'R', recovery_distance_m: 200,
      total_at_pace_mi: 1.25,
    },
    prescription_text: '10×200m @ R · 200m jog',
    notes: 'Daniels: cap R at 5% weekly mileage. Mile pace.',
    citation: 'Research/04-workout-vocabulary.md §7.4',
  },

  // ───────────── 8. HILLS ─────────────
  {
    slug: 'hill-repeats-short-10x30s',
    name: 'Short hill repeats (10×30s)',
    family: 'hills',
    distance_focus: ['all'], phase_fit: ['base','build'],
    level_fit: ['intermediate','advanced','advanced_plus'],
    pace_zones: ['I','R'], is_quality: true, is_long: false,
    duration: r(40, 55), distance: r(5, 7), freq: 1,
    structure: {
      type: 'hill_repeats',
      reps: 10, duration_sec: 30, grade_pct: [4, 7], effort_pct: 92, recovery: 'walk_jog_back',
    },
    prescription_text: '10×30s hills (4–7% grade) · walk/jog back',
    notes: 'Power + form. Gateway speed work.',
    citation: 'Research/04-workout-vocabulary.md §8.2',
  },
  {
    slug: 'hill-repeats-medium-6x90s',
    name: 'Medium hill repeats (6×90s)',
    family: 'hills',
    distance_focus: ['all'], phase_fit: ['build','quality'],
    level_fit: ['intermediate','advanced','advanced_plus'],
    pace_zones: ['10K','5K'], is_quality: true, is_long: false,
    duration: r(50, 65), distance: r(6, 8), freq: 1,
    structure: {
      type: 'hill_repeats',
      reps: 6, duration_sec: 90, grade_pct: [4, 6], pace_zones: ['5K','10K'],
      recovery_min: 2.5,
    },
    prescription_text: '6×90s hills @ 5K–10K effort · 2:30 jog down',
    notes: 'Bridge between short hills and long hills.',
    citation: 'Research/04-workout-vocabulary.md §8.3',
  },
  {
    slug: 'hill-repeats-long-5x3min',
    name: 'Long hill repeats (5×3 min)',
    family: 'hills',
    distance_focus: ['10k','hm','m'], phase_fit: ['quality','race_specific'],
    level_fit: ['advanced','advanced_plus'],
    pace_zones: ['T','10K'], is_quality: true, is_long: false,
    duration: r(60, 80), distance: r(7, 9), freq: 1,
    structure: {
      type: 'hill_repeats',
      reps: 5, duration_sec: 180, grade_pct: [3, 5], pace_zones: ['T','10K'],
      recovery: 'equal_time_jog',
    },
    prescription_text: '5×3 min hills @ T–10K · equal jog down',
    notes: 'VO2max with hill-strength stimulus. Reduces orthopedic stress vs flat intervals.',
    citation: 'Research/04-workout-vocabulary.md §8.4',
  },
  {
    slug: 'hill-fartlek-45',
    name: 'Hill fartlek (45 min rolling)',
    family: 'hills',
    distance_focus: ['all'], phase_fit: ['base','build'],
    level_fit: ['intermediate','advanced','advanced_plus'],
    pace_zones: ['E','T','10K'], is_quality: true, is_long: false,
    duration: r(40, 55), distance: r(5, 7), freq: 1,
    structure: {
      type: 'hill_fartlek',
      duration_min: 45, surge_on: 'climbs', recovery_on: 'descents_flats',
    },
    prescription_text: '45 min hilly: surge every climb, recover descents',
    notes: 'Continuous-run hill stimulus. 5–10 min total uphill surging.',
    citation: 'Research/04-workout-vocabulary.md §8.6',
  },

  // ───────────── 9. FARTLEK ─────────────
  {
    slug: 'mona-fartlek',
    name: 'Mona fartlek (20 min)',
    family: 'fartlek',
    distance_focus: ['5k','10k','hm'], phase_fit: ['base','build','quality'],
    level_fit: ['intermediate','advanced','advanced_plus'],
    pace_zones: ['E','5K','3K'], is_quality: true, is_long: false,
    duration: r(50, 65), distance: r(6, 8), freq: 1,
    structure: {
      type: 'mona_fartlek',
      pattern: [
        { reps: 2, on_sec: 90,  off_sec: 90,  on_pace: '5K' },
        { reps: 4, on_sec: 60,  off_sec: 60,  on_pace: '5K' },
        { reps: 4, on_sec: 30,  off_sec: 30,  on_pace: '3K' },
        { reps: 4, on_sec: 15,  off_sec: 15,  on_pace: 'mile' },
      ],
      total_at_pace_min: 14, total_session_min: 20,
    },
    prescription_text: 'Mona: 2×90s/90s + 4×60s/60s + 4×30s/30s + 4×15s/15s',
    notes: 'Moneghetti / Wardlaw. Floats are recovery jogs, not stops. Keep effort honest.',
    warmup_cooldown: '15 min E each side',
    citation: 'Research/04-workout-vocabulary.md §9.2',
  },
  {
    slug: 'fartlek-6x3min',
    name: 'Time fartlek (6×3 min on / 2 min off)',
    family: 'fartlek',
    distance_focus: ['5k','10k','hm','m'], phase_fit: ['base','build','quality'],
    level_fit: ['intermediate','advanced','advanced_plus'],
    pace_zones: ['E','10K','5K'], is_quality: true, is_long: false,
    duration: r(50, 65), distance: r(6, 8), freq: 1,
    structure: {
      type: 'time_fartlek',
      reps: 6, on_sec: 180, off_sec: 120, on_pace_zone: '10K',
    },
    prescription_text: '6×3 min @ 10K effort · 2 min easy jog',
    notes: 'Structured pace play without a track. Good base-phase introduction.',
    citation: 'Research/04-workout-vocabulary.md §9.5',
  },

  // ───────────── 10. COMBO / ALTERNATION ─────────────
  {
    slug: 'mp-10k-alternations-6',
    name: 'MP / 10K alternations (6×1 mi)',
    family: 'combo',
    distance_focus: ['m'], phase_fit: ['race_specific'],
    level_fit: ['advanced','advanced_plus'],
    pace_zones: ['MP','10K'], is_quality: true, is_long: false,
    duration: r(80, 100), distance: r(12, 14), freq: 1,
    structure: {
      type: 'alternations',
      reps: 6, segment_a_mi: 1, segment_a_pace: 'MP', segment_b_mi: 1, segment_b_pace: '10K',
      total_mi: 12,
    },
    prescription_text: '6× (1 mi MP + 1 mi @ 10K) · continuous',
    notes: 'Marathon-specific lactate clearance. Recoveries are MP — not easy.',
    citation: 'Research/04-workout-vocabulary.md §10.1',
  },
  {
    slug: 'wave-tempo-6mi',
    name: 'Wave tempo (6 mi continuous, ±10 s around T)',
    family: 'combo',
    distance_focus: ['hm','m'], phase_fit: ['race_specific'],
    level_fit: ['advanced','advanced_plus'],
    pace_zones: ['E','T'], is_quality: true, is_long: false,
    duration: r(60, 75), distance: r(9, 11), freq: 1,
    structure: {
      type: 'wave_tempo',
      total_mi: 6, oscillation_sec_per_mi: 10, base_pace_zone: 'T',
    },
    prescription_text: '6 mi continuous wave tempo · ±10 s/mi around T',
    notes: 'Average lands at T. Rhythmic, race-pace-skill.',
    citation: 'Research/04-workout-vocabulary.md §10.3',
  },

  // ───────────── 11. MARATHON-SPECIFIC ─────────────
  {
    slug: 'canova-2k-repeats-5',
    name: 'Canova 2K repeats (5×2K)',
    family: 'marathon_specific',
    distance_focus: ['m'], phase_fit: ['race_specific'],
    level_fit: ['advanced','advanced_plus'],
    pace_zones: ['MP','T'], is_quality: true, is_long: false,
    duration: r(80, 100), distance: r(11, 13), freq: 1,
    structure: {
      type: 'canova_2k',
      reps: 5, rep_distance_m: 2000, recovery_min: 2,
      pace_progression: 'start slower than MP, descend to slightly faster than T',
    },
    prescription_text: '5×2K · descend MP → T · 2 min jog',
    notes: 'Each rep ~2.5–5 s/km faster than the previous. Even pace within each rep.',
    citation: 'Research/04-workout-vocabulary.md §11.2',
  },

  // ───────────── 12. CUTDOWN ─────────────
  {
    slug: 'mile-cutdowns-4',
    name: 'Mile cutdowns (4×1 mi, descending)',
    family: 'cutdown',
    distance_focus: ['5k','10k','hm'], phase_fit: ['quality','race_specific'],
    level_fit: ['intermediate','advanced','advanced_plus'],
    pace_zones: ['MP','T','HM','5K'], is_quality: true, is_long: false,
    duration: r(60, 75), distance: r(8, 10), freq: 1,
    structure: {
      type: 'cutdowns',
      reps: 4, rep_distance_m: 1609, recovery_sec: 75,
      pace_progression: ['MP', 'HM', 'T', '5K'],
    },
    prescription_text: '4×1 mi · MP → HM → T → 5K · 75s jog',
    notes: 'Progressive load. Composure under fatigue. Final rep at 5K pace or faster.',
    citation: 'Research/04-workout-vocabulary.md §12.2',
  },

  // ───────────── 13. LADDERS ─────────────
  {
    slug: 'ladder-400-800-1200-1600',
    name: 'Ladder (400-800-1200-1600)',
    family: 'ladder',
    distance_focus: ['5k','10k'], phase_fit: ['quality','race_specific'],
    level_fit: ['intermediate','advanced','advanced_plus'],
    pace_zones: ['I','5K','3K','mile'], is_quality: true, is_long: false,
    duration: r(55, 70), distance: r(7, 9), freq: 1,
    structure: {
      type: 'ladder_ascending',
      reps: [
        { distance_m: 400,  pace_zone: 'mile', recovery_sec: 90 },
        { distance_m: 800,  pace_zone: '3K',   recovery_sec: 180 },
        { distance_m: 1200, pace_zone: '5K',   recovery_sec: 240 },
        { distance_m: 1600, pace_zone: '10K',  recovery_sec: 300 },
      ],
    },
    prescription_text: '400 (mile) → 800 (3K) → 1200 (5K) → 1600 (10K)',
    notes: 'Ascending ladder. Pace by rep length. Builds mental load.',
    citation: 'Research/04-workout-vocabulary.md §13.2',
  },

  // ───────────── 14. RACE-SPECIFIC ─────────────
  {
    slug: 'race-spec-5k-12x400',
    name: '5K-specific: 12×400 at 5K pace',
    family: 'race_specific',
    distance_focus: ['5k'], phase_fit: ['race_specific'],
    level_fit: ['intermediate','advanced','advanced_plus'],
    pace_zones: ['5K'], is_quality: true, is_long: false,
    duration: r(50, 65), distance: r(6, 8), freq: 1,
    structure: {
      type: 'race_simulator',
      reps: 12, rep_distance_m: 400, rep_pace_zone: '5K', recovery_sec: 75,
    },
    prescription_text: '12×400 @ 5K race pace · 60–90s jog',
    notes: 'Classic 5K simulator. Tests race readiness.',
    citation: 'Research/04-workout-vocabulary.md §14.1',
  },
  {
    slug: 'race-spec-10k-4x2k',
    name: '10K-specific: 4×2K at 10K pace',
    family: 'race_specific',
    distance_focus: ['10k'], phase_fit: ['race_specific'],
    level_fit: ['intermediate','advanced','advanced_plus'],
    pace_zones: ['10K'], is_quality: true, is_long: false,
    duration: r(65, 80), distance: r(8, 10), freq: 1,
    structure: {
      type: 'race_simulator',
      reps: 4, rep_distance_m: 2000, rep_pace_zone: '10K', recovery_min: 2.5,
    },
    prescription_text: '4×2K @ 10K race pace · 2:30 jog',
    notes: '10K race-pace specificity. Even splits.',
    citation: 'Research/04-workout-vocabulary.md §14.2',
  },
  {
    slug: 'race-spec-hm-4x2mi',
    name: 'HM predictor: 4×2 mi at HM pace',
    family: 'race_specific',
    distance_focus: ['hm'], phase_fit: ['race_specific'],
    level_fit: ['intermediate','advanced','advanced_plus'],
    pace_zones: ['HM'], is_quality: true, is_long: false,
    duration: r(85, 105), distance: r(11, 13), freq: 1,
    structure: {
      type: 'race_simulator',
      reps: 4, rep_distance_m: 3218, rep_pace_zone: 'HM', recovery_sec: 90,
    },
    prescription_text: '4×2 mi @ HM pace · 60–120s jog',
    notes: 'Classic HM readiness workout. Complete in control 2 wk before race = ready.',
    citation: 'Research/04-workout-vocabulary.md §14.3',
  },
  {
    slug: 'race-spec-hm-6x1mi',
    name: 'HM volume: 6×1 mi at HM pace',
    family: 'race_specific',
    distance_focus: ['hm'], phase_fit: ['race_specific'],
    level_fit: ['intermediate','advanced','advanced_plus'],
    pace_zones: ['HM'], is_quality: true, is_long: false,
    duration: r(70, 90), distance: r(10, 12), freq: 1,
    structure: {
      type: 'race_simulator',
      reps: 6, rep_distance_m: 1609, rep_pace_zone: 'HM', recovery_sec: 60,
    },
    prescription_text: '6×1 mi @ HM pace · 60s jog',
    notes: 'Mid-rep volume at HM. Short rests = high specificity.',
    citation: 'Research/04-workout-vocabulary.md §14.3',
  },

  // ───────────── 15. BASE BUILDING ─────────────
  {
    slug: 'base-building-easy-strides',
    name: 'Base block: 6 mi E + 6×ST',
    family: 'base_building',
    distance_focus: ['all'], phase_fit: ['base'],
    level_fit: ['intermediate','advanced','advanced_plus'],
    pace_zones: ['E','R'], is_quality: false, is_long: false,
    duration: r(50, 65), distance: r(5, 7), freq: 2,
    structure: { type: 'easy_plus_strides', miles: 6, strides: { count: 6, distance_m: 80 } },
    prescription_text: '6 mi E + 6×ST',
    notes: 'Standard Lydiard-influenced base. Keep building aerobic capacity.',
    citation: 'Research/22-plan-templates.md §6',
  },

  // ───────────── 16. MAINTENANCE ─────────────
  {
    slug: 'maintenance-tempo-20min',
    name: 'Maintenance tempo (20 min @ T)',
    family: 'maintenance',
    distance_focus: ['all'], phase_fit: ['maintenance'],
    level_fit: ['intermediate','advanced','advanced_plus'],
    pace_zones: ['E','T'], is_quality: true, is_long: false,
    duration: r(45, 60), distance: r(5, 7), freq: 1,
    structure: { type: 'continuous_tempo', tempo_min: 20, tempo_pace_zone: 'T' },
    prescription_text: '20 min @ T (sandwiched in easy)',
    notes: 'Between-cycle quality. Minimum-effective-dose: holds VO2max ~15 wk at 2/3 of training volume.',
    citation: 'Research/22-plan-templates.md §7',
  },

  // ───────────── 17. RACE-WEEK SCAFFOLD ─────────────
  {
    slug: 'race-week-shakeout',
    name: 'Race-week shakeout (2 mi + 4×ST)',
    family: 'shakeout',
    distance_focus: ['all'], phase_fit: ['race_week'],
    level_fit: ['beginner','intermediate','advanced','advanced_plus'],
    pace_zones: ['E','R'], is_quality: false, is_long: false,
    duration: r(15, 25), distance: r(2, 3), freq: 1,
    structure: { type: 'shakeout', miles: 2, strides: { count: 4, distance_m: 80 } },
    prescription_text: '2 mi E + 4×ST',
    notes: 'Day before race. Loosen the legs. Final stride ~5–10 min before gun (race day).',
    citation: 'Research/04-workout-vocabulary.md §17.3',
  },
  {
    slug: 'race-week-rest',
    name: 'Race-week rest',
    family: 'rest',
    distance_focus: ['all'], phase_fit: ['race_week'],
    level_fit: ['beginner','intermediate','advanced','advanced_plus'],
    pace_zones: [], is_quality: false, is_long: false,
    duration: null, distance: r(0, 0), freq: 2,
    structure: { type: 'rest' },
    prescription_text: 'Off — hydrate, fuel, sleep',
    notes: '2 days before race: full rest. Off feet.',
    citation: 'Research/08-pacing-and-race-week.md §taper',
  },

  // ───────────── 18. WALK-RUN / RETURN-TO-RUN ─────────────
  {
    slug: 'walk-run-4-1',
    name: 'Walk-run 4:1 (5 reps)',
    family: 'walk_run',
    distance_focus: ['all'], phase_fit: ['base'],
    level_fit: ['beginner'],
    pace_zones: ['E'], is_quality: false, is_long: false,
    duration: r(20, 30), distance: r(1, 3), freq: 3,
    structure: { type: 'walk_run', pattern: '4 min walk / 1 min run', reps: 5 },
    prescription_text: '4 min walk / 1 min jog × 5',
    notes: 'Return-to-run injury scaffold (minor severity). Pain ≥ 4/10 stops the session.',
    citation: 'Research/05-injury-return-protocols.md §General-Principles',
  },
  {
    slug: 'walk-run-2-3',
    name: 'Walk-run 2:3 (5 reps)',
    family: 'walk_run',
    distance_focus: ['all'], phase_fit: ['base'],
    level_fit: ['beginner'],
    pace_zones: ['E'], is_quality: false, is_long: false,
    duration: r(20, 30), distance: r(2, 4), freq: 3,
    structure: { type: 'walk_run', pattern: '2 min walk / 3 min run', reps: 5 },
    prescription_text: '2 min walk / 3 min jog × 5',
    notes: 'Return-to-run progression. If 0 pain at end → progress to continuous next week.',
    citation: 'Research/05-injury-return-protocols.md §General-Principles',
  },
];

// ───────────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Seeding workout_library — ${ROWS.length} canonical rows`);
  let inserted = 0;
  let updated = 0;
  for (const w of ROWS) {
    const res = await pool.query(
      `INSERT INTO workout_library
         (slug, name, family, distance_focus, phase_fit, level_fit,
          pace_zones, is_quality, is_long,
          typical_duration_min, typical_distance_mi, frequency_max_per_week,
          structure, prescription_text, notes, warmup_cooldown, citation,
          active, updated_ts)
       VALUES ($1, $2, $3, $4, $5, $6,
               $7, $8, $9,
               $10::int4range, $11::numrange, $12,
               $13::jsonb, $14, $15, $16, $17,
               TRUE, NOW())
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name,
         family = EXCLUDED.family,
         distance_focus = EXCLUDED.distance_focus,
         phase_fit = EXCLUDED.phase_fit,
         level_fit = EXCLUDED.level_fit,
         pace_zones = EXCLUDED.pace_zones,
         is_quality = EXCLUDED.is_quality,
         is_long = EXCLUDED.is_long,
         typical_duration_min = EXCLUDED.typical_duration_min,
         typical_distance_mi = EXCLUDED.typical_distance_mi,
         frequency_max_per_week = EXCLUDED.frequency_max_per_week,
         structure = EXCLUDED.structure,
         prescription_text = EXCLUDED.prescription_text,
         notes = EXCLUDED.notes,
         warmup_cooldown = EXCLUDED.warmup_cooldown,
         citation = EXCLUDED.citation,
         active = TRUE,
         updated_ts = NOW()
       RETURNING (xmax = 0) AS inserted`,
      [
        w.slug, w.name, w.family,
        w.distance_focus, w.phase_fit, w.level_fit,
        w.pace_zones, w.is_quality, w.is_long,
        w.duration, w.distance, w.freq,
        JSON.stringify(w.structure), w.prescription_text, w.notes ?? null, w.warmup_cooldown ?? null, w.citation,
      ],
    );
    if (res.rows[0]?.inserted) inserted++;
    else updated++;
  }
  console.log(`✓ workout_library: ${inserted} inserted · ${updated} updated · ${ROWS.length} total`);

  const counts = await pool.query(`
    SELECT family, COUNT(*) AS n
      FROM workout_library
     WHERE active
     GROUP BY family
     ORDER BY family
  `);
  console.log('\nBy family:');
  for (const r of counts.rows) {
    console.log(`  ${r.family.padEnd(20)} ${r.n}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => pool.end());
