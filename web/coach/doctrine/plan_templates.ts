/**
 * Doctrine — Training plan templates by distance and level.
 *
 * Source: Research/22-plan-templates.md
 *
 * Generic plan scaffolding the coach can adapt to any user. Paces are
 * written as zones (E/M/T/I/R) — actual paces come from the user's
 * VDOT-derived pace_zones.ts.
 *
 * **Stage 4 behavior change unlock:** the engine instantiates a
 * template based on user goal race + experience tier + weeks-to-race,
 * then renders each day from current state. Templates are scaffolds,
 * not schedules — engine fills the slots based on phase, ACWR,
 * recovery state, missed days, etc. Always-alive planning.
 *
 * Engine consumers:
 *   - coach.prescribeWorkout         → consults active template's
 *                                      sample-peak-week shape per phase
 *   - coachDaily.weekShape simulation → uses template per-phase quality
 *                                      day patterns
 *   - /races/[slug]                  → display "block: Pfitzinger 18/55"
 *                                      structure */
import { cite, type Cited } from './cite';

// ── Zone shorthand ────────────────────────────────────────────────

export type DanielsZone = 'E' | 'M' | 'T' | 'I' | 'R' | 'LR' | 'ST';

export const ZONE_SHORTHAND: Cited<Record<DanielsZone, {
  name: string;
  effort: string;
  typicalUse: string;
}>> = {
  value: {
    E:  { name: 'Easy',         effort: '~59-74% VO2max, conversational',          typicalUse: 'Recovery, warm-up, cooldown, base mileage' },
    M:  { name: 'Marathon',     effort: '~75-84% VO2max',                            typicalUse: 'Marathon goal-pace work' },
    T:  { name: 'Threshold',    effort: '~83-88% VO2max, "comfortably hard"',        typicalUse: 'Tempo runs, cruise intervals' },
    I:  { name: 'Interval',     effort: '~95-100% VO2max',                           typicalUse: 'VO2max work, 3-5 min reps' },
    R:  { name: 'Repetition',   effort: 'Faster than VO2max',                        typicalUse: 'Speed/economy, 200-400m reps' },
    LR: { name: 'Long run',     effort: 'Mostly E, sometimes with M or T',           typicalUse: 'Endurance' },
    ST: { name: 'Strides',      effort: '~95% effort, 15-20 sec',                    typicalUse: 'Form/turnover, after easy runs' },
  },
  citations: [
    cite('§Zone shorthand (Daniels)', 'E/M/T/I/R/LR/ST zones used throughout plan templates', 'research', '22'),
  ],
};

// ── Plan template type ────────────────────────────────────────────

export type PlanDistance = '5K' | '10K' | 'half_marathon' | 'marathon' | '50K' | '50_mile' | '100K' | '100_mile' | 'base_building' | 'maintenance' | 'couch_to_5K';
export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced' | 'time_crunched' | 'high_volume';
export type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface SamplePeakWeekDay {
  day: DayOfWeek;
  workout: string;
}

export interface PlanTemplate {
  id: string;
  distance: PlanDistance;
  level: ExperienceLevel | null;
  prerequisitesNote: string;
  durationWeeksLow: number;
  durationWeeksHigh: number;
  daysPerWeekLow: number;
  daysPerWeekHigh: number;
  peakWeeklyMpwLow: number;
  peakWeeklyMpwHigh: number;
  peakLongRunMiLow: number;
  peakLongRunMiHigh: number;
  keyWorkoutTypes: string[];
  phases: string[];
  samplePeakWeek: SamplePeakWeekDay[];
  basedOn: string;
  researchSection: string;
  /** Whether a medium-long run (11-15 mi) is prescribed in this plan. Defaults false. */
  mlrIncluded?: boolean;
  /** MLRs per week during build/peak (omit or 0 when mlrIncluded=false). */
  mlrPerWeekLow?: number;
  mlrPerWeekHigh?: number;
}

// ── Catalog of plans ──────────────────────────────────────────────

export const PLAN_TEMPLATES: Cited<PlanTemplate[]> = {
  value: [
    // 5K plans
    {
      id: '5K_beginner',
      distance: '5K',
      level: 'beginner',
      prerequisitesNote: 'Can run 30 minutes continuously; 4-8 weeks of consistent running',
      durationWeeksLow: 8, durationWeeksHigh: 8,
      daysPerWeekLow: 3, daysPerWeekHigh: 5,
      peakWeeklyMpwLow: 12, peakWeeklyMpwHigh: 15,
      peakLongRunMiLow: 3.5, peakLongRunMiHigh: 4,
      keyWorkoutTypes: ['E runs', 'Strides', 'Light fartlek', '5K time-trial in week 6'],
      phases: ['Build (wk 1-5)', 'Sharpen (wk 6-7)', 'Taper (wk 8)'],
      samplePeakWeek: [
        { day: 'mon', workout: 'Rest' },
        { day: 'tue', workout: '2.5 mi E + 4 × ST' },
        { day: 'wed', workout: '30 min walk or XT' },
        { day: 'thu', workout: '2.5 mi E w/ 4 × 1 min @ T effort' },
        { day: 'fri', workout: 'Rest' },
        { day: 'sat', workout: '3.5 mi E (long)' },
        { day: 'sun', workout: '2 mi E or 30 min walk' },
      ],
      basedOn: 'Higdon Novice + Mayo Clinic 7-week structures',
      researchSection: '§1 5K Beginner',
    },
    {
      id: '5K_intermediate',
      distance: '5K',
      level: 'intermediate',
      prerequisitesNote: 'Year of running, 15-20 mpw base',
      durationWeeksLow: 8, durationWeeksHigh: 10,
      daysPerWeekLow: 4, daysPerWeekHigh: 5,
      peakWeeklyMpwLow: 25, peakWeeklyMpwHigh: 30,
      peakLongRunMiLow: 6, peakLongRunMiHigh: 7,
      keyWorkoutTypes: ['T tempo (15-25 min)', 'I reps (400-1200m)', 'R 200s', 'Hill repeats'],
      phases: ['Base extension', 'I/T phase', 'Race-specific 5K pace', 'Taper'],
      samplePeakWeek: [
        { day: 'mon', workout: '3 mi E' },
        { day: 'tue', workout: 'WU + 5 × 1000m @ I, 2 min jog rec + CD (5-6 mi)' },
        { day: 'wed', workout: '4 mi E + 6 × ST' },
        { day: 'thu', workout: 'WU + 20 min @ T + CD (5 mi)' },
        { day: 'fri', workout: 'Rest or 3 mi E' },
        { day: 'sat', workout: '6 mi E' },
        { day: 'sun', workout: '4 mi E' },
      ],
      basedOn: 'Higdon Intermediate 5K + Daniels shorter plans',
      researchSection: '§1 5K Intermediate',
    },
    {
      id: '5K_advanced',
      distance: '5K',
      level: 'advanced',
      prerequisitesNote: 'Experienced racer, 30+ mpw base, sub-20 5K territory',
      durationWeeksLow: 12, durationWeeksHigh: 18,
      daysPerWeekLow: 6, daysPerWeekHigh: 7,
      peakWeeklyMpwLow: 40, peakWeeklyMpwHigh: 70,
      peakLongRunMiLow: 8, peakLongRunMiHigh: 12,
      keyWorkoutTypes: ['R reps (200-400m)', 'I reps (1000-1200m at 5K pace)', 'Cruise intervals at T', 'Hill sprints'],
      phases: ['I (base + R, strides)', 'II (R focus + intro T)', 'III (I focus + T)', 'IV (race-specific I and 5K-pace work)'],
      samplePeakWeek: [
        { day: 'mon', workout: '6 mi E + 6 × ST' },
        { day: 'tue', workout: 'WU + 6 × 1000m @ I, 3 min E rec + CD (8-9 mi)' },
        { day: 'wed', workout: '6 mi E (or 5 AM + 4 PM double)' },
        { day: 'thu', workout: 'WU + 4 × 1 mi @ T, 1 min rest + CD (8 mi)' },
        { day: 'fri', workout: '5-6 mi E' },
        { day: 'sat', workout: 'WU + 8 × 400m @ R, 400 jog + CD (7 mi)' },
        { day: 'sun', workout: '10-12 mi E' },
      ],
      basedOn: 'Daniels Phases II-IV',
      researchSection: '§1 5K Advanced',
    },

    // 10K plans
    {
      id: '10K_beginner',
      distance: '10K',
      level: 'beginner',
      prerequisitesNote: 'Finished a 5K, 10-15 mpw existing base',
      durationWeeksLow: 10, durationWeeksHigh: 10,
      daysPerWeekLow: 3, daysPerWeekHigh: 4,
      peakWeeklyMpwLow: 18, peakWeeklyMpwHigh: 22,
      peakLongRunMiLow: 6, peakLongRunMiHigh: 7,
      keyWorkoutTypes: ['E runs', 'Strides', 'Fartlek (1 min on / 1 min off)', 'Light hills'],
      phases: ['Build base', 'Introduce short tempo', 'Taper'],
      samplePeakWeek: [
        { day: 'mon', workout: 'Rest' },
        { day: 'tue', workout: '3 mi E + 6 × ST' },
        { day: 'wed', workout: '4 mi w/ 6 × 2 min fartlek' },
        { day: 'thu', workout: 'XT 30 min' },
        { day: 'fri', workout: '3 mi E' },
        { day: 'sat', workout: '6-7 mi E (long)' },
        { day: 'sun', workout: 'Rest or 30 min walk' },
      ],
      basedOn: 'Beginner 10K conventions',
      researchSection: '§2 10K Beginner',
    },
    {
      id: '10K_intermediate',
      distance: '10K',
      level: 'intermediate',
      prerequisitesNote: '20-30 mpw base, has run several 10Ks',
      durationWeeksLow: 12, durationWeeksHigh: 12,
      daysPerWeekLow: 5, daysPerWeekHigh: 5,
      peakWeeklyMpwLow: 30, peakWeeklyMpwHigh: 40,
      peakLongRunMiLow: 9, peakLongRunMiHigh: 10,
      keyWorkoutTypes: ['T tempo (20-30 min or 2-3 × 10 min)', 'I reps at 10K-5K pace (1000-1600m)', 'Progression LR'],
      phases: ['Aerobic build (4 wk)', 'Strength/threshold (4 wk)', 'Race-specific 10K pace (3 wk)', 'Taper (1 wk)'],
      samplePeakWeek: [
        { day: 'mon', workout: '4 mi E' },
        { day: 'tue', workout: 'WU + 4 × 1 mi @ T, 1 min rest + CD (8 mi)' },
        { day: 'wed', workout: '5 mi E + 6 × ST' },
        { day: 'thu', workout: 'WU + 5 × 1000m @ I, 2:30 jog rec + CD (8 mi)' },
        { day: 'fri', workout: '4 mi E' },
        { day: 'sat', workout: '9-10 mi E w/ last 2 mi @ M' },
        { day: 'sun', workout: 'Rest or XT' },
      ],
      basedOn: 'RunnersConnect, Hudson hybrid principles',
      researchSection: '§2 10K Intermediate',
    },
    {
      id: '10K_advanced',
      distance: '10K',
      level: 'advanced',
      prerequisitesNote: '40+ mpw base, sub-40 10K territory',
      durationWeeksLow: 12, durationWeeksHigh: 18,
      daysPerWeekLow: 6, daysPerWeekHigh: 7,
      peakWeeklyMpwLow: 50, peakWeeklyMpwHigh: 75,
      peakLongRunMiLow: 13, peakLongRunMiHigh: 15,
      keyWorkoutTypes: ['I reps (1200-1600m at 5K-10K pace)', 'T cruise (3-5 × 1 mi)', 'Race-pace simulation (4-6 × 1 mi at goal 10K pace)', 'Strides', 'Hill sprints'],
      phases: ['Base + R', 'Threshold dominant', 'I dominant + 10K-pace work', 'Taper'],
      samplePeakWeek: [
        { day: 'mon', workout: '6 mi E + 6 × ST' },
        { day: 'tue', workout: 'WU + 5 × 1600m @ 10K pace, 3 min jog + CD (10 mi)' },
        { day: 'wed', workout: '8 mi GA' },
        { day: 'thu', workout: 'WU + 4 × 1 mi @ T, 1 min rest + CD (9 mi)' },
        { day: 'fri', workout: '5 mi E' },
        { day: 'sat', workout: 'WU + 10 × 400m @ R, 400 jog + CD (7 mi)' },
        { day: 'sun', workout: '13-14 mi LR' },
      ],
      basedOn: 'Daniels 5K-10K phase structure / Pfitzinger Faster Road Racing',
      researchSection: '§2 10K Advanced',
    },

    // Half Marathon plans
    {
      id: 'half_marathon_beginner',
      distance: 'half_marathon',
      level: 'beginner',
      prerequisitesNote: 'Has run a 5K, builds to 13.1',
      durationWeeksLow: 12, durationWeeksHigh: 12,
      daysPerWeekLow: 3, daysPerWeekHigh: 4,
      peakWeeklyMpwLow: 22, peakWeeklyMpwHigh: 28,
      peakLongRunMiLow: 10, peakLongRunMiHigh: 12,
      keyWorkoutTypes: ['E runs', 'Strides', 'Optional light tempo (10-15 min)'],
      phases: ['Build LR (10 wk)', 'Light sharpening', 'Taper'],
      samplePeakWeek: [
        { day: 'mon', workout: 'Rest or XT' },
        { day: 'tue', workout: '4 mi E + 6 × ST' },
        { day: 'wed', workout: '5 mi E' },
        { day: 'thu', workout: '3 mi w/ 15 min @ T effort' },
        { day: 'fri', workout: 'Rest' },
        { day: 'sat', workout: '11 mi LR (E)' },
        { day: 'sun', workout: '3 mi E or walk' },
      ],
      basedOn: 'Higdon Novice 1/2',
      researchSection: '§3 Half Marathon Beginner',
    },
    {
      id: 'half_marathon_intermediate',
      distance: 'half_marathon',
      level: 'intermediate',
      prerequisitesNote: '25-35 mpw base, sub-2:00 ambitions or first serious HM',
      durationWeeksLow: 12, durationWeeksHigh: 12,
      daysPerWeekLow: 5, daysPerWeekHigh: 5,
      peakWeeklyMpwLow: 35, peakWeeklyMpwHigh: 45,
      peakLongRunMiLow: 12, peakLongRunMiHigh: 14,
      keyWorkoutTypes: ['T tempo (4-7 mi continuous)', 'MLR with M segments', 'I 1000-1600m', 'Race-pace LR'],
      phases: ['Endurance build', 'LT focus + LR with HMP segments', 'Race-specific', 'Taper'],
      samplePeakWeek: [
        { day: 'mon', workout: '4 mi E' },
        { day: 'tue', workout: 'WU + 5 mi @ T + CD (8 mi)' },
        { day: 'wed', workout: '6 mi GA' },
        { day: 'thu', workout: 'WU + 4 × 1200m @ I, 3 min jog + CD (8 mi)' },
        { day: 'fri', workout: 'Rest' },
        { day: 'sat', workout: '5 mi E + 6 × ST' },
        { day: 'sun', workout: '13 mi LR w/ middle 5 mi @ HMP' },
      ],
      basedOn: 'Higdon Intermediate / Pfitzinger 12/47',
      researchSection: '§3 Half Marathon Intermediate',
      mlrIncluded: true, mlrPerWeekLow: 1, mlrPerWeekHigh: 1,
    },
    {
      id: 'half_marathon_advanced',
      distance: 'half_marathon',
      level: 'advanced',
      prerequisitesNote: '45+ mpw base, sub-1:30',
      durationWeeksLow: 12, durationWeeksHigh: 12,
      daysPerWeekLow: 6, daysPerWeekHigh: 7,
      peakWeeklyMpwLow: 55, peakWeeklyMpwHigh: 85,
      peakLongRunMiLow: 15, peakLongRunMiHigh: 17,
      keyWorkoutTypes: ['LT runs (5-8 mi continuous)', 'MLR with HMP-MP segments', 'I reps (1000-1600m at 5K-10K)', 'Tune-up race'],
      phases: ['Endurance build', 'LT-dominant', 'VO2max + race-specific HMP', 'Taper'],
      samplePeakWeek: [
        { day: 'mon', workout: 'Rest or 5 mi recovery' },
        { day: 'tue', workout: 'WU + 6 mi @ T + CD (10 mi)' },
        { day: 'wed', workout: '13 mi MLR (E w/ 6 × ST)' },
        { day: 'thu', workout: 'WU + 6 × 1200m @ I, 3 min jog + CD (9 mi)' },
        { day: 'fri', workout: '6 mi GA' },
        { day: 'sat', workout: '6 mi E + 8 × ST' },
        { day: 'sun', workout: '16 mi LR w/ last 8 mi @ HMP' },
      ],
      basedOn: 'Pfitzinger 12/63 or 12/84',
      researchSection: '§3 Half Marathon Advanced',
      mlrIncluded: true, mlrPerWeekLow: 1, mlrPerWeekHigh: 2,
    },

    // Marathon plans
    {
      id: 'marathon_beginner',
      distance: 'marathon',
      level: 'beginner',
      prerequisitesNote: 'First marathon, finish-focused',
      durationWeeksLow: 18, durationWeeksHigh: 18,
      daysPerWeekLow: 4, daysPerWeekHigh: 4,
      peakWeeklyMpwLow: 30, peakWeeklyMpwHigh: 35,
      peakLongRunMiLow: 20, peakLongRunMiHigh: 20,
      keyWorkoutTypes: ['E runs', 'Strides', 'Optional MP segments in some long runs'],
      phases: ['Base extension (6 wk)', 'LR build (8 wk)', 'Peak (3 wk)', 'Taper (3 wk)'],
      samplePeakWeek: [
        { day: 'mon', workout: 'XT or rest' },
        { day: 'tue', workout: '3 mi E' },
        { day: 'wed', workout: '6 mi E' },
        { day: 'thu', workout: '3 mi E' },
        { day: 'fri', workout: 'Rest' },
        { day: 'sat', workout: '5 mi E (with MP segment optional)' },
        { day: 'sun', workout: '20 mi LR (E)' },
      ],
      basedOn: 'Higdon Novice 1',
      researchSection: '§4 Marathon Beginner',
    },
    {
      id: 'marathon_intermediate',
      distance: 'marathon',
      level: 'intermediate',
      prerequisitesNote: 'Has finished a marathon, 30-40 mpw base',
      durationWeeksLow: 18, durationWeeksHigh: 18,
      daysPerWeekLow: 5, daysPerWeekHigh: 6,
      peakWeeklyMpwLow: 45, peakWeeklyMpwHigh: 55,
      peakLongRunMiLow: 20, peakLongRunMiHigh: 22,
      keyWorkoutTypes: ['LT runs (4-7 mi @ T)', 'MP runs (8-14 mi w/ 8-12 @ M)', 'MLR (11-15 mi)', 'VO2max (3-5 × 1000-1600m at 5K pace)'],
      phases: ['Endurance (5 wk)', 'LT + endurance (6 wk)', 'Race prep (4 wk, MP runs)', 'Taper (3 wk)'],
      samplePeakWeek: [
        { day: 'mon', workout: 'Rest' },
        { day: 'tue', workout: 'WU + 5 mi @ T + CD (9 mi)' },
        { day: 'wed', workout: '11 mi MLR (E)' },
        { day: 'thu', workout: '8 mi GA' },
        { day: 'fri', workout: '5 mi E' },
        { day: 'sat', workout: '5 mi E + 6 × ST' },
        { day: 'sun', workout: '20 mi LR w/ last 14 @ M' },
      ],
      basedOn: 'Higdon Intermediate 1/2 or Pfitzinger 18/55',
      researchSection: '§4 Marathon Intermediate',
      mlrIncluded: true, mlrPerWeekLow: 1, mlrPerWeekHigh: 1,
    },
    {
      id: 'marathon_advanced',
      distance: 'marathon',
      level: 'advanced',
      prerequisitesNote: 'Multiple marathons, 50+ mpw base, time-goal focused',
      durationWeeksLow: 18, durationWeeksHigh: 18,
      daysPerWeekLow: 6, daysPerWeekHigh: 7,
      peakWeeklyMpwLow: 65, peakWeeklyMpwHigh: 90,
      peakLongRunMiLow: 22, peakLongRunMiHigh: 24,
      keyWorkoutTypes: ['LT runs (6-8 mi @ T)', 'GMP-LR (18-22 mi w/ 12-16 @ M)', 'VO2max (5-6 × 1000-1600m at 5K pace)', 'MLR (13-17 mi)', 'Tune-up half'],
      phases: ['Endurance + LT (6 wk)', 'LT + endurance (6 wk)', 'Race prep (4 wk)', 'Taper (2-3 wk)'],
      samplePeakWeek: [
        { day: 'mon', workout: 'Rest or 6 mi recovery' },
        { day: 'tue', workout: 'WU + 7 mi @ T + CD (11 mi)' },
        { day: 'wed', workout: '15 mi MLR (E w/ 6 × ST)' },
        { day: 'thu', workout: '9 mi GA + 6 × ST' },
        { day: 'fri', workout: '5 mi recovery' },
        { day: 'sat', workout: '8 mi E (PM optional double)' },
        { day: 'sun', workout: '22 mi LR w/ last 14 @ M' },
      ],
      basedOn: 'Pfitzinger 18/70 or 18/85',
      researchSection: '§4 Marathon Advanced',
      mlrIncluded: true, mlrPerWeekLow: 1, mlrPerWeekHigh: 1,
    },

    // Special plans
    {
      id: 'base_building',
      distance: 'base_building',
      level: null,
      prerequisitesNote: 'Generic post-race or pre-cycle plan. Lydiard-influenced. Goal: aerobic capacity, durability, no peak.',
      durationWeeksLow: 8, durationWeeksHigh: 16,
      daysPerWeekLow: 5, daysPerWeekHigh: 6,
      peakWeeklyMpwLow: 0, peakWeeklyMpwHigh: 0, // 80-100% of last cycle's peak
      peakLongRunMiLow: 12, peakLongRunMiHigh: 16, // 90 min - 2 hr E
      keyWorkoutTypes: ['All E', 'Strides 2×/week', 'Fartlek 30 sec - 5 min once/week', 'Hill strides', 'Optional 1 weekly steady run just below T'],
      phases: ['Continuous E', 'Introduce strides', 'Introduce fartlek', 'Introduce LT'],
      samplePeakWeek: [
        { day: 'mon', workout: '6 mi E' },
        { day: 'tue', workout: '8 mi E + 8 × ST' },
        { day: 'wed', workout: '6 mi E + hill strides 6 × 15 sec' },
        { day: 'thu', workout: '8 mi E w/ 8 × 1 min fartlek' },
        { day: 'fri', workout: 'Rest or 4 mi E' },
        { day: 'sat', workout: '6 mi E + 8 × ST' },
        { day: 'sun', workout: '12-14 mi LR (all E)' },
      ],
      basedOn: 'Lydiard with modern moderation',
      researchSection: '§6 Base Building',
    },
    {
      id: 'maintenance',
      distance: 'maintenance',
      level: null,
      prerequisitesNote: 'Between cycles, holding fitness without progression. ~2/3 volume maintains VO2max for ~15 weeks if intensity preserved.',
      durationWeeksLow: 4, durationWeeksHigh: 15,
      daysPerWeekLow: 3, daysPerWeekHigh: 4,
      peakWeeklyMpwLow: 0, peakWeeklyMpwHigh: 0, // ~65% of last cycle's peak
      peakLongRunMiLow: 8, peakLongRunMiHigh: 12,
      keyWorkoutTypes: ['1 quality (T, fartlek, or hills)', '1 LR', '1-2 E per week'],
      phases: ['Open-ended steady state'],
      samplePeakWeek: [
        { day: 'mon', workout: 'Rest' },
        { day: 'tue', workout: '5 mi E + 6 × ST' },
        { day: 'wed', workout: 'Rest or XT' },
        { day: 'thu', workout: 'WU + 20 min @ T + CD (5 mi)' },
        { day: 'fri', workout: 'Rest' },
        { day: 'sat', workout: '5 mi E' },
        { day: 'sun', workout: '10 mi LR (E)' },
      ],
      basedOn: 'Minimum-effective-dose research',
      researchSection: '§7 Maintenance',
    },
    {
      id: 'couch_to_5K',
      distance: 'couch_to_5K',
      level: 'beginner',
      prerequisitesNote: 'Sedentary individuals who can walk 30 minutes. 9-week walk/run progression.',
      durationWeeksLow: 9, durationWeeksHigh: 9,
      daysPerWeekLow: 3, daysPerWeekHigh: 3,
      peakWeeklyMpwLow: 6, peakWeeklyMpwHigh: 9,  // ~90 min total run/walk
      peakLongRunMiLow: 3, peakLongRunMiHigh: 3,  // 30 min continuous
      keyWorkoutTypes: ['Walk-run intervals progressing toward 30 min continuous run'],
      phases: ['Wk 1-3: short run/long walk', 'Wk 4-6: building run intervals', 'Wk 7-9: continuous run 25-30 min'],
      samplePeakWeek: [
        { day: 'mon', workout: 'Rest' },
        { day: 'tue', workout: '5 min WU walk + 30 min continuous run' },
        { day: 'wed', workout: 'Rest' },
        { day: 'thu', workout: '5 min WU walk + 30 min continuous run' },
        { day: 'fri', workout: 'Rest' },
        { day: 'sat', workout: '5 min WU walk + 30 min continuous run' },
        { day: 'sun', workout: 'Rest' },
      ],
      basedOn: 'NHS / Cool Running C25K canonical structure',
      researchSection: '§8 Couch-to-5K',
    },
  ],
  citations: [
    cite('§§1-15 Plan templates', 'Generic plan scaffolding for 5K/10K/HM/Marathon × Beginner/Intermediate/Advanced + Base Building + Maintenance + Couch-to-5K. Each entry: duration, days/week, peak volume, peak long run, key workouts, phases, sample peak week.', 'research', '22'),
  ],
};

// ── Comeback plans ────────────────────────────────────────────────

export const COMEBACK_PROTOCOLS: Cited<{
  shortLayoff: Array<{ daysOffLow: number; daysOffHigh: number; restartApproach: string }>;
  moderateLayoffWeeks: Array<{ week: number; runFrequencyDaysPerWeek: string; pattern: string }>;
  longLayoffPhases: Array<{ phase: string; weeks: string; detail: string }>;
  volumeCap: string;
}> = {
  value: {
    shortLayoff: [
      { daysOffLow: 1, daysOffHigh: 7,   restartApproach: 'Resume full plan; one easy day instead of first quality' },
      { daysOffLow: 8, daysOffHigh: 14,  restartApproach: '70% of pre-layoff volume for 1 wk, 85% for wk 2, full for wk 3' },
    ],
    moderateLayoffWeeks: [
      { week: 1,    runFrequencyDaysPerWeek: 'Every other day',   pattern: '20-30 min run/walk (1 min run / 1 min walk × 10-15)' },
      { week: 2,    runFrequencyDaysPerWeek: '4 days',             pattern: '25-35 min mostly continuous E running, 1 day off between' },
      { week: 3,    runFrequencyDaysPerWeek: '4-5 days',           pattern: '30-40 min E, add 4 × ST on one day' },
      { week: 4,    runFrequencyDaysPerWeek: '5 days',             pattern: 'E runs, introduce 1 short fartlek (4 × 1 min)' },
      { week: 5,    runFrequencyDaysPerWeek: '5 days',             pattern: 'E + 1 fartlek + 1 LR (45 min)' },
      { week: 6,    runFrequencyDaysPerWeek: '5-6 days',           pattern: 'Approaching pre-layoff volume at ~70-80%; introduce light T effort' },
      { week: 7,    runFrequencyDaysPerWeek: 'Full',                pattern: 'Resume normal cycle; expect 4-6 wk to feel like prior self' },
    ],
    longLayoffPhases: [
      { phase: 'Walk/run reentry',   weeks: '2-3',                  detail: 'Galloway-style 1:1 or 2:1; no continuous running yet' },
      { phase: 'Continuous E',       weeks: '3-4',                  detail: 'Build to 30-40 min continuous E, 4-5 days/wk' },
      { phase: 'Aerobic base',       weeks: '4-6',                  detail: 'E only, build to ~70% prior volume; strides last week' },
      { phase: 'Re-introduction',    weeks: '4-6',                  detail: 'Add 1 quality (fartlek → T → I); LR returns to 90 min' },
      { phase: 'Full cycle',         weeks: '12-16 wk away from race', detail: 'Begin standard plan' },
    ],
    volumeCap: 'Weekly mileage ≤50% of lowest pre-layoff week initially; 10% rule strictly enforced.',
  },
  note: 'For long layoff (>2 months): plus ≥2 strength sessions/week throughout; cross-training as substitute for any pain or hesitation; criteria-based progression (no symptoms, hop test, single-leg metrics) before adding load.',
  citations: [
    cite('§14 Comeback Plans', 'Short (1-14d), moderate (3-8 wk), long (>2 mo) layoff protocols', 'research', '22'),
  ],
};

// ── Multi-race year planning ──────────────────────────────────────

export const MULTI_RACE_YEAR: Cited<{
  twoMarathons: Array<{ block: string; weeks: string; focus: string }>;
  threeHalves: Array<{ block: string; weeks: string }>;
  fiveK10kSeriesIntervals: Array<{ raceInterval: string; midweekStructure: string }>;
}> = {
  value: {
    twoMarathons: [
      { block: 'Marathon 1 cycle',     weeks: '16-18',  focus: 'Specific marathon prep' },
      { block: 'Recovery',              weeks: '2-3',    focus: 'Reverse taper, easy running' },
      { block: 'Bridge / base',         weeks: '4-8',    focus: 'Aerobic re-build, no quality required' },
      { block: 'Marathon 2 cycle',     weeks: '16-18',  focus: 'Specific marathon prep' },
      { block: 'Off-season',            weeks: '4-6',    focus: 'Active recovery, optional XT focus' },
    ],
    threeHalves: [
      { block: 'HM 1 cycle',                 weeks: '10-12' },
      { block: 'Recovery + bridge',          weeks: '4-6' },
      { block: 'HM 2 cycle (compressed)',    weeks: '8-10' },
      { block: 'Recovery + bridge',          weeks: '4-6' },
      { block: 'HM 3 cycle',                 weeks: '8-10' },
    ],
    fiveK10kSeriesIntervals: [
      { raceInterval: '7 days',   midweekStructure: '1 short quality (Tue) + race (Sat); rest of week is E' },
      { raceInterval: '14 days',  midweekStructure: '1 quality + 1 LR + 5 days E in week 1; light week 2 + race' },
    ],
  },
  note: 'Research suggests one primary peak and one secondary peak per year is optimal for recreationals.',
  citations: [
    cite('§11 Multi-Race Year Planning', 'Two marathons / three halves / 5K-10K series intervals', 'research', '22'),
  ],
};

// ── Phase definitions ─────────────────────────────────────────────

export type PhaseName = 'base' | 'build' | 'peak' | 'taper' | 'race_week' | 'maintenance';

export interface PhaseDefinition {
  /** Quality sessions (threshold + VO2) per week. */
  qualitySessionsPerWeek: { low: number; high: number };
  /** Strides sessions per week — appended to easy runs. */
  stridesPerWeek: { low: number; high: number };
  /** Primary workout families for the phase. */
  primaryWorkoutFamilies: string[];
  /** Families explicitly excluded this phase. */
  excludedWorkoutFamilies: string[];
  /** Volume relative to peak (1.0 = peak volume). */
  volumeRelativeToPeak: { low: number; high: number };
}

/**
 * Phase-specific session selection rules.
 * Source: Research/00a §Plan skeletons + Research/22 sample weeks.
 */
export const PHASE_DEFINITIONS: Cited<Record<PhaseName, PhaseDefinition>> = {
  value: {
    base: {
      qualitySessionsPerWeek: { low: 1, high: 1 },
      stridesPerWeek: { low: 2, high: 2 },
      primaryWorkoutFamilies: ['easy', 'long', 'strides', 'fartlek', 'hill'],
      excludedWorkoutFamilies: ['vo2max', 'marathon_specific'],
      volumeRelativeToPeak: { low: 0.60, high: 0.80 },
    },
    build: {
      qualitySessionsPerWeek: { low: 2, high: 2 },
      stridesPerWeek: { low: 2, high: 3 },
      primaryWorkoutFamilies: ['threshold', 'vo2max', 'long', 'easy', 'strides'],
      excludedWorkoutFamilies: [],
      volumeRelativeToPeak: { low: 0.80, high: 1.0 },
    },
    peak: {
      qualitySessionsPerWeek: { low: 2, high: 2 },
      stridesPerWeek: { low: 2, high: 3 },
      primaryWorkoutFamilies: ['threshold', 'vo2max', 'long_hm_specific', 'easy', 'strides'],
      excludedWorkoutFamilies: [],
      volumeRelativeToPeak: { low: 0.90, high: 1.0 },
    },
    taper: {
      qualitySessionsPerWeek: { low: 1, high: 1 },
      stridesPerWeek: { low: 2, high: 3 },
      primaryWorkoutFamilies: ['easy', 'threshold_short', 'strides'],
      excludedWorkoutFamilies: ['vo2max', 'long_mp_block', 'marathon_specific'],
      volumeRelativeToPeak: { low: 0.40, high: 0.55 },
    },
    race_week: {
      qualitySessionsPerWeek: { low: 0, high: 0 },
      stridesPerWeek: { low: 0, high: 4 },
      primaryWorkoutFamilies: ['easy', 'shakeout', 'strides', 'race'],
      excludedWorkoutFamilies: ['threshold', 'vo2max', 'long', 'marathon_specific'],
      volumeRelativeToPeak: { low: 0.25, high: 0.35 },
    },
    maintenance: {
      qualitySessionsPerWeek: { low: 1, high: 1 },
      stridesPerWeek: { low: 2, high: 3 },
      primaryWorkoutFamilies: ['easy', 'threshold', 'long', 'strides'],
      excludedWorkoutFamilies: ['vo2max', 'marathon_specific', 'race_specific'],
      volumeRelativeToPeak: { low: 0.50, high: 0.70 },
    },
  },
  note: 'Phase definitions drive session selection — base avoids VO2 work, build/peak introduce it, taper cuts volume while preserving intensity touches.',
  citations: [
    cite('§Plan skeletons + Volume progression rules', 'BASE: aerobic only. BUILD: threshold + VO2 introduced. PEAK: race-specific. TAPER: volume drops 50-70%, intensity preserved.', 'research', '00a'),
    cite('§3 Half Marathon Plans', 'HM intermediate phases: Endurance build → LT focus + LR with HMP segments → Race-specific → Taper.', 'research', '22'),
  ],
};
