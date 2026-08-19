/**
 * lib/workout-catalogue/catalogue.ts · the app's workout vocabulary, as data.
 *
 * `Research/04-workout-vocabulary.md` names 59 workouts across 18 sections and
 * states each one as a field table — purpose, zone, structure, recovery, volume
 * bounds, frequency, phase, contraindications. The engine produced roughly a
 * dozen shapes, because session geometry was hardcoded strings at a handful of
 * sites rather than selected from a catalogue.
 *
 * This file is that catalogue. Every entry is transcribed from the doc's own
 * rows, and every number it asserts is quoted in `cites` so a reader can check
 * it against the passage without leaving the file. Where the doc is silent on
 * something the selector needs, the entry says so in `conventions` — labelled
 * as ours, never dressed as research. Two fabricated citations have already
 * been found in this codebase; there is no third one here.
 *
 * ── Coverage ───────────────────────────────────────────────────────────────
 *
 * 59 entries. §18 "Workout-name lookup index" is the doc's own list and lists
 * 42 of them; the other 17 are named only in their section's family-overview
 * table (the 1200m repeats in §6.1, the four §13.1 ladder shapes, the §14
 * race-specific rows, the 100m and 600m repeats). `_catalogue.test.ts` walks
 * §18 and fails if any indexed name has no entry, so the count is checked
 * against the doc rather than asserted here.
 *
 * Three of the doc's named entries are CROSS-REFERENCES rather than workouts —
 * §11.3 points at §4.4, §14.3's "Long tempo" row points at §5.5, and §14.4
 * points at §11. They are recorded in `CROSS_REFERENCES` below so the arithmetic
 * from "named entries" to "distinct workouts" is visible instead of assumed.
 *
 * ── What is NOT here ───────────────────────────────────────────────────────
 *
 * §15 (placement) and §16 (combinations to avoid) are selection logic and live
 * in `select.ts`. §17 (warm-up, drills, cool-down) is session scaffolding, not
 * a workout; `quality-day.ts` already owns the warm-up and cool-down bands.
 *
 * ── Wired, 2026-08-18 ──────────────────────────────────────────────────────
 *
 * `select.ts` reads this, `lib/plan/catalogue-rx.ts` renders what it chooses
 * into the engine's prescription grammar, and `lib/plan/generate.ts` calls that
 * once per quality slot. See `select.ts`'s header for what the wiring replaced
 * and for the shapes here the engine's grammar cannot yet express.
 */
import {
  CONTINUOUS_TEMPO_MINUTES,
  INTERVAL_REP_MINUTES,
} from '@/lib/prescription/levers';
import {
  ALL_DISTANCES,
  TIERS,
  type Band,
  type CatalogueEntry,
  type DistCategory,
  type DoctrinePhase,
  type MeasureUnit,
  type RepBand,
  type Tier,
} from './types';

// ── shorthand ───────────────────────────────────────────────────────────────

const b = (min: number, max: number, unit: MeasureUnit): Band => ({ min, max, unit });
const r = (min: number, max: number): RepBand => ({ min, max });

const ALL: DistCategory[] = [...ALL_DISTANCES];
const EVERYONE: Tier[] = [...TIERS];
/** §8.5 "not for novice runners"; §10.2 "practice each in isolation first". */
const NOT_BEGINNER: Tier[] = ['intermediate', 'advanced', 'advanced_plus'];

const ALL_PHASES: DoctrinePhase[] = [
  'base',
  'hill_strength',
  'specific_support',
  'race_specific',
  'taper',
];
/** "Specific phase" in a workout's own "When in cycle" row. */
const SPECIFIC: DoctrinePhase[] = ['specific_support', 'race_specific'];
/** "Base into specific phase" / "Base through specific". */
const BASE_THROUGH_SPECIFIC: DoctrinePhase[] = ['base', 'specific_support', 'race_specific'];

/**
 * The doc's own name-index entries that point at another section rather than
 * specifying a workout. Subtracting these is how 62 named entries become 59
 * distinct workouts.
 */
export const CROSS_REFERENCES: Array<{ name: string; at: string; resolvesTo: string }> = [
  { name: 'Long marathon-pace runs', at: '§11.3', resolvesTo: 'marathon-pace-long-run' },
  { name: 'Long tempo', at: '§14.3', resolvesTo: 'long-tempo' },
  { name: 'Marathon-specific', at: '§14.4', resolvesTo: 'canova-2k-repeats' },
];

// ── the catalogue ───────────────────────────────────────────────────────────

export const WORKOUT_CATALOGUE: CatalogueEntry[] = [
  // ══ §1-§3 · the aerobic base ══════════════════════════════════════════════
  {
    slug: 'recovery-run',
    name: 'Recovery run',
    section: '§1',
    family: 'recovery',
    zones: ['E'],
    effortOnly: false,
    structures: [{ kind: 'continuous', block: b(20, 45, 'min'), shape: 'Slower than E' }],
    atPace: null,
    session: b(20, 45, 'min'),
    warmupCooldownMi: null,
    cadence: null,
    distances: ALL,
    phases: ALL_PHASES,
    tiers: EVERYONE,
    cites: [
      'Pace | Slower than E. ~MP + 90+ s/mi, or 60–70% HRmax, or "easier than easy"',
      'Duration | 20–45 min; capped to keep total stress low',
      'Volume role | Should not exceed ~10–15% of weekly mileage',
      'When in cycle | All phases.',
    ],
  },
  {
    slug: 'easy-run',
    name: 'Easy run / general aerobic',
    section: '§2',
    family: 'easy',
    zones: ['E'],
    effortOnly: false,
    structures: [{ kind: 'continuous', block: b(30, 75, 'min'), shape: 'Conversational' }],
    atPace: null,
    session: b(30, 75, 'min'),
    warmupCooldownMi: null,
    cadence: null,
    distances: ALL,
    phases: ALL_PHASES,
    tiers: EVERYONE,
    cites: [
      'Duration | 30–75 min typical; up to 90 min for high-mileage runners',
      'Volume role | 70–85% of weekly mileage',
      'When in cycle | All phases. Volume rises in base, holds steady through specific',
    ],
  },
  {
    slug: 'medium-long-run',
    name: 'Medium-long run',
    section: '§3',
    family: 'medium_long',
    zones: ['E', 'M'],
    effortOnly: false,
    structures: [{ kind: 'continuous', block: b(11, 15, 'mi'), shape: 'E to low M effort' }],
    atPace: null,
    session: b(11, 15, 'mi'),
    warmupCooldownMi: null,
    cadence: { minDays: 7, maxDays: 7, source: 'Frequency | 1×/week during marathon and HM specific phases' },
    distances: ['hm', 'm'],
    phases: BASE_THROUGH_SPECIFIC,
    tiers: EVERYONE,
    cites: [
      'Distance (Pfitzinger) | 11–15 miles',
      'Frequency | 1×/week during marathon and HM specific phases',
      'When in cycle | Pfitzinger marathon and HM plans use it through base and specific phases',
    ],
    conventions: [
      'The doc names only the marathon and the half. The ultra is NOT included, so the ' +
        'selector will decline a medium-long for an ultra rather than extend a placement ' +
        'the doc does not make.',
    ],
  },

  // ══ §4 · long runs ════════════════════════════════════════════════════════
  {
    slug: 'base-long-run',
    name: 'Base long run',
    section: '§4.2',
    family: 'long',
    zones: ['E'],
    effortOnly: false,
    structures: [{ kind: 'continuous', block: b(90, 150, 'min'), shape: 'E throughout' }],
    atPace: null,
    session: b(8, 22, 'mi'),
    warmupCooldownMi: null,
    cadence: { minDays: 7, maxDays: 7, source: 'Frequency | Weekly' },
    distances: ALL,
    phases: ALL_PHASES,
    tiers: EVERYONE,
    cites: [
      'Base long run | 90 min – 2:30; up to 22 mi for marathoners | E throughout',
      'Duration | 90 min minimum for endurance benefit; cap at ~25–30% of weekly mileage',
      'Distance | 10–22+ mi for marathoners; 8–14 mi for 5K/10K',
      'Contraindications | Beginners should cap at 20% of weekly mileage',
    ],
  },
  {
    slug: 'progression-long-run',
    name: 'Progression long run',
    section: '§4.3',
    family: 'long',
    zones: ['E', 'M', 'T'],
    effortOnly: false,
    structures: [
      {
        kind: 'sequence',
        steps: [
          { value: 6, unit: 'mi', zone: 'E', recoverySec: 0 },
          { value: 6, unit: 'mi', zone: 'M', recoverySec: 0 },
          { value: 4, unit: 'mi', zone: 'T', recoverySec: 0 },
        ],
        recoveryRule: 'Recovery | None — continuous',
      },
    ],
    atPace: null,
    session: b(12, 22, 'mi'),
    warmupCooldownMi: null,
    cadence: { minDays: 14, maxDays: 21, source: 'Frequency | Every 2–3 weeks in specific phase' },
    distances: ALL,
    phases: SPECIFIC,
    tiers: EVERYONE,
    cites: [
      'Progression long run | 12–22 mi | Start E, finish M to T',
      'Structure | First 1/3 to 1/2 at E pace, middle at strong E or M, final 1/4 to 1/3 at M to T',
      'Example (16 mi) | 6 mi E + 6 mi M + 4 mi T',
      'Skip if accumulated fatigue is high; don\'t pair with other quality work in same week',
    ],
    conventions: [
      'The sequence steps carry the doc\'s own 16-mile EXAMPLE. The rule is the fractional ' +
        'one in the Structure row; the selector scales the thirds to the runner\'s long run ' +
        'rather than emitting 6+6+4 at every distance.',
    ],
  },
  {
    slug: 'marathon-pace-long-run',
    name: 'Marathon-pace long run',
    section: '§4.4',
    family: 'long',
    zones: ['E', 'MP'],
    effortOnly: false,
    structures: [
      {
        kind: 'sequence',
        steps: [
          { value: 3, unit: 'mi', zone: 'E', recoverySec: 0 },
          { value: 12, unit: 'mi', zone: 'MP', recoverySec: 0 },
        ],
        recoveryRule: null,
      },
    ],
    atPace: b(8, 16, 'mi'),
    session: b(14, 22, 'mi'),
    warmupCooldownMi: b(2, 4, 'mi'),
    cadence: { minDays: 14, maxDays: 21, source: 'Frequency | Every 2–3 weeks during marathon specific phase' },
    distances: ['m'],
    phases: ['race_specific'],
    tiers: EVERYONE,
    cites: [
      'Structure | Easy warmup (2–4 mi) + 8–16 mi at MP + optional easy cooldown',
      'Common dose | 14–18 mi total with 10–14 mi at MP',
      'Pace | MP exactly — not faster',
      'When in cycle | 6–10 weeks out from goal marathon',
    ],
    conventions: [
      'The sequence carries the midpoint of the Common dose row (3 mi E + 12 mi MP). The ' +
        'bands in `atPace` and `session` are the doctrine; the selector sizes inside them.',
    ],
  },
  {
    slug: 'fast-finish-long-run',
    name: 'Fast finish long run',
    section: '§4.5',
    family: 'long',
    zones: ['E', 'MP'],
    effortOnly: false,
    structures: [
      {
        kind: 'sequence',
        steps: [
          { value: 12, unit: 'mi', zone: 'E', recoverySec: 0 },
          { value: 4, unit: 'mi', zone: 'MP', recoverySec: 0 },
        ],
        recoveryRule: 'Recovery | None',
      },
    ],
    atPace: b(2, 6, 'mi'),
    session: b(12, 18, 'mi'),
    warmupCooldownMi: null,
    cadence: { minDays: 14, maxDays: 21, source: 'Frequency | Every 2–3 weeks' },
    distances: ['hm', 'm'],
    phases: SPECIFIC,
    tiers: EVERYONE,
    cites: [
      'Fast finish long run | 12–18 mi | Easy bulk + last 2–6 mi at MP or faster',
      'Structure | Bulk at E (1–2 min/mi slower than MP), final 2–6 mi at MP or slightly faster',
      'Example | 16 mi total: 12 mi E, last 4 mi at MP',
      'When in cycle | Specific phase, marathon and HM',
      '§16 | Fast finish long run before goal race | Adds depletion in taper window',
    ],
  },
  {
    slug: 'dress-rehearsal-long-run',
    name: 'Dress rehearsal long run',
    section: '§4.6',
    family: 'long',
    zones: ['E', 'MP'],
    effortOnly: false,
    structures: [
      {
        kind: 'sequence',
        steps: [
          { value: 14, unit: 'mi', zone: 'E', recoverySec: 0 },
          { value: 6, unit: 'mi', zone: 'MP', recoverySec: 0 },
        ],
        recoveryRule: null,
      },
    ],
    atPace: b(4, 8, 'mi'),
    session: b(12, 22, 'mi'),
    warmupCooldownMi: null,
    cadence: null,
    perCycleMax: 1,
    distances: ['hm', 'm'],
    phases: ['race_specific'],
    tiers: EVERYONE,
    cites: [
      'Distance | 18–22 mi (marathon); 12–14 mi (HM)',
      'Pace | Easy bulk + 2–3 segments at MP (4–8 mi total at MP)',
      'When in cycle | 3 weeks pre-marathon; before taper begins',
      'Contraindications | Not a fitness builder — keep effort controlled.',
    ],
    conventions: [
      'perCycleMax 1 · the doc places it at a single point in the cycle ("3 weeks ' +
        'pre-marathon") and states no frequency, so it is a once-per-block session.',
    ],
  },

  // ══ §5 · threshold ════════════════════════════════════════════════════════
  {
    slug: 'continuous-tempo',
    name: 'Continuous tempo',
    section: '§5.2',
    family: 'threshold',
    zones: ['T'],
    effortOnly: false,
    structures: [
      {
        kind: 'continuous',
        // The band is the ENGINE's constant, and the constant is read out of
        // §5.1's own row by CONTINUOUS_TEMPO_MINUTES' registry claim. Restating
        // 20 and 40 here would give the catalogue a second copy that could
        // drift; importing gives `.min` — which had no reader anywhere in the
        // codebase — the consumer it has always been owed.
        block: b(CONTINUOUS_TEMPO_MINUTES.min, CONTINUOUS_TEMPO_MINUTES.max, 'min'),
        shape: 'Single block, no recovery',
      },
    ],
    atPace: b(3, 8, 'mi'),
    session: null,
    warmupCooldownMi: b(2, 3, 'mi'),
    cadence: { minDays: 7, maxDays: 7, source: 'Frequency | 1×/week or alternating with cruise intervals' },
    distances: ALL,
    phases: BASE_THROUGH_SPECIFIC,
    tiers: EVERYONE,
    cites: [
      '| Continuous tempo | 3–8 mi continuous | T | None | 20–40 min |',
      'Duration | 20 min minimum for stimulus; 20–40 min sweet spot',
      'Distance | 3–8 mi',
      'Warmup/cooldown | 2–3 mi E each side',
      'When in cycle | Base into specific phase; backbone of HM and marathon training',
    ],
  },
  {
    slug: 'cruise-intervals',
    name: 'Cruise intervals',
    section: '§5.3',
    family: 'threshold',
    zones: ['T'],
    effortOnly: false,
    structures: [
      { kind: 'reps', reps: r(3, 6), rep: b(1, 1, 'mi'), recoverySec: r(60, 60), recoveryRule: '1 min jog per mile of work segment' },
      { kind: 'reps', reps: r(2, 4), rep: b(2, 2, 'mi'), recoverySec: r(120, 120), recoveryRule: '1 min jog per mile of work segment' },
    ],
    atPace: b(4, 8, 'mi'),
    session: null,
    warmupCooldownMi: b(2, 3, 'mi'),
    cadence: { minDays: 7, maxDays: 7, source: 'Frequency | 1×/week' },
    distances: ALL,
    phases: ['hill_strength', 'specific_support', 'race_specific', 'taper'],
    tiers: EVERYONE,
    cites: [
      'Structure | 3–6 × 1 mi with 1 min jog, or 2–4 × 2 mi with 2 min jog',
      'Recovery | 1 min jog per mile of work segment',
      'Total volume at pace | 4–8 mi (Daniels: cap T-pace at 10% of weekly mileage)',
      'When in cycle | All phases except deepest base',
      'Contraindications | Lengthening rest changes the workout — keep recoveries short',
    ],
  },
  {
    slug: 'sub-threshold-intervals',
    name: 'Sub-threshold / Norwegian intervals',
    section: '§5.4',
    family: 'threshold',
    zones: ['ST'],
    effortOnly: false,
    structures: [
      { kind: 'reps', reps: r(5, 10), rep: b(1, 1, 'km'), recoverySec: r(60, 90), recoveryRule: '60–90 s jog (short, by design)' },
      { kind: 'reps', reps: r(4, 6), rep: b(2, 2, 'km'), recoverySec: r(60, 90), recoveryRule: '60–90 s jog (short, by design)' },
      { kind: 'reps', reps: r(4, 6), rep: b(6, 6, 'min'), recoverySec: r(60, 90), recoveryRule: '60–90 s jog (short, by design)' },
      {
        kind: 'double',
        am: '4–6 × 1K or 5 × 6 min ST',
        pm: '8–10 × 1K or 6 × 2K slightly faster ST',
        gapHours: null,
      },
    ],
    atPace: b(5, 10, 'km'),
    session: null,
    warmupCooldownMi: null,
    cadence: { minDays: 3, maxDays: 4, source: 'Frequency | 2×/week (singles) or 1 double-day every 4–7 days' },
    distances: ALL,
    phases: BASE_THROUGH_SPECIFIC,
    tiers: EVERYONE,
    cites: [
      'Pace | ST: ~10–15 s/mi slower than T; lactate target 2.5–3.5 mmol/L',
      'Structure (single threshold) | 5–10 × 1K, or 4–6 × 2K, or 4–6 × 6 min',
      'Structure (double threshold) | AM: 4–6 × 1K or 5 × 6 min ST; PM: 8–10 × 1K or 6 × 2K slightly faster ST',
      'Recovery | 60–90 s jog (short, by design)',
      'Total volume | 5–10 K at ST per session; 12–20 K total threshold across a double day',
      'Doubles require high training age and low life stress',
    ],
    conventions: [
      'The double-threshold structure carries no tier of its own in the doc, only ' +
        '"high training age". The selector gates it to advanced_plus; that mapping is ours.',
    ],
  },
  {
    slug: 'long-tempo',
    name: 'Long tempo',
    section: '§5.5',
    family: 'threshold',
    zones: ['HM', 'T'],
    effortOnly: false,
    structures: [
      { kind: 'continuous', block: b(8, 12, 'mi'), shape: 'Slightly slower than T — HM pace to T-minus-5 s/mi' },
      { kind: 'reps', reps: r(2, 2), rep: b(5, 5, 'mi'), recoverySec: r(180, 180), recoveryRule: '2 × 5 mi at HM with 3 min jog (split version)' },
    ],
    atPace: b(8, 12, 'mi'),
    session: null,
    warmupCooldownMi: b(1, 2, 'mi'),
    cadence: { minDays: 14, maxDays: 21, source: 'Frequency | Every 2–3 weeks in specific phase' },
    distances: ['hm', 'm'],
    phases: SPECIFIC,
    tiers: EVERYONE,
    cites: [
      '| Long tempo | 8–12 mi continuous | Slightly slower than T (HM-ish) | None | 8–12 mi |',
      'Warmup/cooldown | 1–2 mi E each side',
      'When in cycle | HM and marathon specific; not a base-phase staple',
      'Contraindications | High accumulated fatigue cost — schedule at least 2 easy days after',
    ],
  },

  // ══ §6 · VO2max ═══════════════════════════════════════════════════════════
  {
    slug: 'mile-repeats',
    name: 'Mile repeats',
    section: '§6.2',
    family: 'vo2max',
    zones: ['I'],
    effortOnly: false,
    structures: [
      { kind: 'reps', reps: r(3, 6), rep: b(1, 1, 'mi'), recoverySec: r(150, 300), recoveryRule: 'Jog rest ≈ rep time. Daniels: ≤ rep time' },
    ],
    atPace: b(3, 6, 'mi'),
    session: null,
    warmupCooldownMi: b(2, 3, 'mi'),
    cadence: { minDays: 7, maxDays: 10, source: 'Frequency | Every 7–10 days' },
    distances: ['5k', '10k', 'hm'],
    phases: SPECIFIC,
    tiers: EVERYONE,
    cites: [
      '| Mile repeats (3K/5K) | 3–6 × 1 mi | I (5K) to slightly slower | 2:30–4:00 jog (≈ rep time) | 3–6 mi |',
      'Reps | 3 (entry), 4–5 (typical), 6 (advanced)',
      'Recovery | Jog rest ≈ rep time. 3:00–5:00 typical. Daniels: ≤ rep time',
      'Total volume | Cap at 8% weekly mileage',
      'When in cycle | Mid-cycle through specific phase for 5K/10K; base/specific for HM',
      'Contraindications | Avoid in week of taper (last hard session ≥10 days out)',
    ],
  },
  {
    slug: '1200m-repeats',
    name: '1200m repeats',
    section: '§6.1',
    family: 'vo2max',
    zones: ['I'],
    effortOnly: false,
    structures: [
      { kind: 'reps', reps: r(4, 6), rep: b(1200, 1200, 'm'), recoverySec: r(120, 180), recoveryRule: '2–3 min jog' },
    ],
    atPace: b(4.8, 7.2, 'km'),
    session: null,
    warmupCooldownMi: b(2, 3, 'mi'),
    cadence: null,
    distances: ['5k', '10k', 'hm', 'm'],
    phases: SPECIFIC,
    tiers: EVERYONE,
    cites: [
      '| 1200m repeats | 4–6 × 1200 | I | 2–3 min jog | 4.8–7.2 K |',
      '§6 | each interval should be 3–5 min long; total at-pace volume ≤ 8% of weekly mileage',
      'Research/00a-distance-running-training.md treats I-pace reps as rarely appropriate for the ultra',
    ],
    conventions: [
      'Named only in §6.1\'s family-overview row — it has no field table of its own, so it ' +
        'carries no Frequency, no "When in cycle" and no distance list. Phases are §6\'s ' +
        'own VO2max framing; the ultra is excluded on Research/00a, not on §6.',
    ],
  },
  {
    slug: '1000m-repeats',
    name: '1K repeats',
    section: '§6.3',
    family: 'vo2max',
    zones: ['I'],
    effortOnly: false,
    structures: [
      { kind: 'reps', reps: r(5, 8), rep: b(1, 1, 'km'), recoverySec: r(120, 180), recoveryRule: '2:00–3:00 jog (≈ rep time, 200–400 m jog)' },
    ],
    atPace: b(5, 8, 'km'),
    session: null,
    warmupCooldownMi: b(2, 3, 'mi'),
    cadence: { minDays: 7, maxDays: 7, source: 'Frequency | Weekly during VO2max block' },
    distances: ['5k', '10k', 'hm'],
    phases: SPECIFIC,
    tiers: EVERYONE,
    cites: [
      '| 1000m repeats | 5–8 × 1K | I | 2–3 min jog (≈ rep time) | 5–8 K |',
      'Purpose | Classic VO2max workout — ideal interval duration (3–4 min) for maxing out aerobic power',
      'When in cycle | Specific phase for 5K/10K; mid-cycle for HM',
    ],
  },
  {
    slug: '800m-repeats',
    name: '800m repeats',
    section: '§6.4',
    family: 'vo2max',
    zones: ['I'],
    effortOnly: false,
    structures: [
      { kind: 'reps', reps: r(6, 10), rep: b(800, 800, 'm'), recoverySec: r(120, 180), recoveryRule: '2:00–3:00 jog (≈ rep time)' },
    ],
    atPace: b(4.8, 8, 'km'),
    session: null,
    warmupCooldownMi: b(2, 3, 'mi'),
    cadence: { minDays: 7, maxDays: 7, source: 'Frequency | Weekly during VO2 block' },
    distances: ['5k', '10k', 'hm', 'm'],
    phases: SPECIFIC,
    tiers: EVERYONE,
    cites: [
      '| 800m repeats | 6–10 × 800 | I | 2–3 min jog (≈ rep time) | 4.8–8 K |',
      'Purpose | VO2max with slightly more turnover than 1Ks; classic 5K specific',
      'Contraindications | Avoid running first reps too fast — first rep should not be the fastest',
    ],
    conventions: [
      '§6.4 has no "When in cycle" row. Phases are §6\'s VO2max framing; the ultra is ' +
        'excluded on Research/00a rather than on §6.4.',
    ],
  },
  {
    slug: '600m-repeats',
    name: '600m repeats',
    section: '§6.5',
    family: 'vo2max',
    zones: ['I', '3K'],
    effortOnly: false,
    structures: [
      { kind: 'reps', reps: r(8, 12), rep: b(600, 600, 'm'), recoverySec: r(120, 180), recoveryRule: '2:00–3:00 jog or 400m jog' },
    ],
    atPace: b(4.8, 7.2, 'km'),
    session: null,
    warmupCooldownMi: b(2, 3, 'mi'),
    cadence: { minDays: 7, maxDays: 10, source: 'Frequency | Every 7–10 days' },
    distances: ['5k', '10k'],
    phases: ['base', 'specific_support', 'race_specific'],
    tiers: EVERYONE,
    cites: [
      '| 600m repeats | 8–12 × 600 | I to slightly faster | 2–3 min jog | 4.8–7.2 K |',
      'Purpose | Bridge between true VO2 and faster turnover; useful for milers and 5K runners',
      'When in cycle | Late base / specific',
    ],
  },
  {
    slug: '400m-repeats',
    name: '400m repeats',
    section: '§6.6',
    family: 'vo2max',
    zones: ['3K', '5K'],
    effortOnly: false,
    structures: [
      { kind: 'reps', reps: r(8, 16), rep: b(400, 400, 'm'), recoverySec: r(90, 120), recoveryRule: '90 s – 2 min jog (or 200–400 m jog)' },
    ],
    atPace: b(3.2, 6.4, 'km'),
    session: null,
    warmupCooldownMi: b(2, 3, 'mi'),
    cadence: { minDays: 7, maxDays: 7, source: 'Frequency | Weekly in 5K specific phase' },
    distances: ['5k'],
    phases: ['race_specific'],
    tiers: EVERYONE,
    cites: [
      '| 400m repeats | 8–16 × 400 | 3K–5K | 90 s – 2 min jog | 3.2–6.4 K |',
      'Note | Daniels: pure 400s alone are inefficient for VO2max because it takes ~2 min to elicit VO2max',
      'Frequency | Weekly in 5K specific phase',
      '§16 | 400m R-pace day before threshold | Soft-tissue load incompatible with quality threshold next day',
    ],
  },
  {
    slug: 'yasso-800s',
    name: 'Yasso 800s',
    section: '§6.7',
    family: 'vo2max',
    zones: ['5K', '10K'],
    effortOnly: false,
    structures: [
      { kind: 'reps', reps: r(4, 10), rep: b(800, 800, 'm'), recoverySec: null, recoveryRule: 'Jog the same time it took to run the 800 (equal-time jog, ~400m)' },
    ],
    atPace: b(3.2, 8, 'km'),
    session: null,
    warmupCooldownMi: b(2, 3, 'mi'),
    cadence: { minDays: 7, maxDays: 7, source: 'Frequency | 1×/week during build' },
    distances: ['m'],
    phases: ['race_specific'],
    tiers: EVERYONE,
    cites: [
      '| Yasso 800s | 4–10 × 800 | Time-prediction-based | Equal time jog | 3.2–8 K |',
      'Pace formula | Time per 800 in min:sec = goal marathon time in hr:min',
      'Reps progression | Build from 4 → 10 across cycle. Final session: 10 × 800',
      'When in cycle | Last benchmark 10–14 days before goal marathon',
      'Prediction caveat | Modern data: Yasso 800s overpredict for slower marathoners and underpredict for faster ones',
      'Contraindications | Don\'t substitute for marathon-specific work — VO2max session, not MP-specific',
    ],
  },

  // ══ §7 · speed / economy ══════════════════════════════════════════════════
  {
    slug: 'strides',
    name: 'Strides',
    section: '§7.2',
    family: 'speed',
    zones: ['mile', '5K'],
    effortOnly: false,
    structures: [
      { kind: 'reps', reps: r(4, 8), rep: b(50, 100, 'm'), recoverySec: r(60, 90), recoveryRule: 'Full walk-back or 60–90 s jog — no fatigue between strides' },
      { kind: 'reps', reps: r(4, 8), rep: b(15, 30, 's'), recoverySec: r(60, 90), recoveryRule: 'Full walk-back or 60–90 s jog — no fatigue between strides' },
    ],
    atPace: null,
    session: null,
    warmupCooldownMi: null,
    cadence: { minDays: 2, maxDays: 4, source: 'Frequency | 2–4×/week' },
    distances: ALL,
    phases: ALL_PHASES,
    tiers: EVERYONE,
    cites: [
      '| Strides | 50–100 m | Mile to 5K race pace; relaxed sprint | Full walk/jog | 4–8 reps |',
      'Distance | 50–100 m or 15–30 s each',
      'Placement | End of an easy run, mid-warmup before a workout, or standalone day',
      'When in cycle | All phases — never stop doing strides',
      'Contraindications | Not a workout — back off if form deteriorates',
    ],
  },
  {
    slug: 'hill-sprints',
    name: 'Hill sprints',
    section: '§7.3',
    family: 'speed',
    zones: [],
    effortOnly: true,
    structures: [
      { kind: 'reps', reps: r(4, 12), rep: b(8, 15, 's'), recoverySec: r(120, 180), recoveryRule: 'Walk down — full recovery (2–3 min)' },
    ],
    atPace: null,
    session: null,
    warmupCooldownMi: null,
    cadence: { minDays: 3, maxDays: 7, source: 'Frequency | 1–2×/week' },
    distances: ALL,
    phases: ALL_PHASES,
    tiers: EVERYONE,
    cites: [
      '| Hill sprints | 8–15 s | Max effort uphill | Walk-down full recovery | 6–12 reps |',
      'Grade | Steep (8–15%); steepest hill manageable with form',
      'Reps | Start 4–6, build to 8–12',
      'When in cycle | Year-round. Especially valuable in base phase',
      'Contraindications | Not for first-month-back runners; require base of easy running',
    ],
  },
  {
    slug: '200m-repeats',
    name: '200m repeats',
    section: '§7.4',
    family: 'speed',
    zones: ['R', 'mile'],
    effortOnly: false,
    structures: [
      { kind: 'reps', reps: r(8, 12), rep: b(200, 200, 'm'), recoverySec: null, recoveryRule: '200m jog (full recovery, equal-distance jog)' },
    ],
    atPace: b(1.6, 2.4, 'km'),
    session: null,
    warmupCooldownMi: null,
    cadence: { minDays: 7, maxDays: 14, source: 'Frequency | Weekly during speed block; 1× every 2 weeks otherwise' },
    distances: ALL,
    phases: ['base', 'race_specific', 'taper'],
    tiers: EVERYONE,
    cites: [
      '| 200m repeats | 200 m | R pace (≈ mile pace) | 200m jog | 8–12 reps |',
      'Total | 1.6–2.4 K at R',
      'When in cycle | Base, late specific, taper week',
      'Contraindications | Cap at 5% weekly mileage; don\'t shorten the rest',
    ],
  },
  {
    slug: '100m-repeats',
    name: '100m repeats',
    section: '§7.5',
    family: 'speed',
    zones: ['R'],
    effortOnly: false,
    structures: [
      { kind: 'reps', reps: r(8, 16), rep: b(100, 100, 'm'), recoverySec: null, recoveryRule: '100m walk or jog — full recovery' },
    ],
    atPace: null,
    session: null,
    warmupCooldownMi: null,
    cadence: { minDays: 7, maxDays: 7, source: 'Frequency | 1×/week or as part of warmup for longer sessions' },
    distances: ALL,
    phases: ALL_PHASES,
    tiers: EVERYONE,
    cites: [
      '| 100m repeats | 100 m | R to faster | 100m walk/jog | 8–16 reps |',
      'Pace | R pace or faster',
      'When in cycle | All phases',
      '§7 | Daniels: cap R pace at 5% of weekly mileage',
    ],
  },

  // ══ §8 · hills ════════════════════════════════════════════════════════════
  {
    slug: 'short-hill-repeats',
    name: 'Short hill repeats',
    section: '§8.2',
    family: 'hills',
    zones: [],
    effortOnly: true,
    structures: [
      { kind: 'reps', reps: r(8, 16), rep: b(10, 30, 's'), recoverySec: null, recoveryRule: 'Walk or jog back to start; full recovery' },
    ],
    atPace: null,
    session: null,
    warmupCooldownMi: null,
    cadence: { minDays: 7, maxDays: 14, source: 'Frequency | 1×/week base phase; 1× every 2 weeks specific' },
    distances: ALL,
    phases: ['base', 'hill_strength', 'specific_support', 'race_specific'],
    tiers: EVERYONE,
    cites: [
      '| Short hill repeats | 10–30 s | 4–7% | Strong, controlled (~95% effort) | 8–16 | Walk/jog down |',
      'Length | 100–150 m',
      'Pace | 90–95% effort, controlled',
      'Reps | 8–16 (start 8, build to 16)',
    ],
  },
  {
    slug: 'medium-hill-repeats',
    name: 'Medium hill repeats',
    section: '§8.3',
    family: 'hills',
    zones: ['5K', '10K'],
    effortOnly: true,
    structures: [
      { kind: 'reps', reps: r(6, 10), rep: b(60, 90, 's'), recoverySec: r(120, 180), recoveryRule: '2–3 min jog down' },
    ],
    atPace: null,
    session: null,
    warmupCooldownMi: null,
    cadence: null,
    distances: ALL,
    phases: ['base', 'hill_strength', 'specific_support'],
    tiers: EVERYONE,
    cites: [
      '| Medium hill repeats | 60–90 s | 4–6% | 5K–10K effort | 6–10 | 2–3 min jog down |',
      'Purpose | Aerobic + strength stimulus; bridges short hills and long hills',
      'When in cycle | Late base, early specific',
    ],
  },
  {
    slug: 'long-hill-repeats',
    name: 'Long hill repeats',
    section: '§8.4',
    family: 'hills',
    zones: ['T', '10K'],
    effortOnly: true,
    structures: [
      { kind: 'reps', reps: r(4, 8), rep: b(3, 5, 'min'), recoverySec: null, recoveryRule: 'Equal-time jog down' },
    ],
    atPace: null,
    session: null,
    warmupCooldownMi: null,
    cadence: null,
    distances: ALL,
    phases: ['hill_strength', 'specific_support', 'race_specific'],
    tiers: EVERYONE,
    cites: [
      '| Long hill repeats | 3–5 min | 3–5% | T to 10K effort | 4–8 | Equal jog down |',
      'Purpose | VO2max with hill-strength stimulus; substitute for flat intervals when injury-prone',
      'When in cycle | Specific phase; reduces orthopedic stress vs. flat intervals',
    ],
  },
  {
    slug: 'lydiard-hill-circuit',
    name: 'Lydiard hill circuit',
    section: '§8.5',
    family: 'hills',
    zones: [],
    effortOnly: true,
    structures: [
      {
        kind: 'sequence',
        steps: [
          { value: 800, unit: 'm', zone: null, recoverySec: null },
          { value: 800, unit: 'm', zone: 'E', recoverySec: null },
          { value: 700, unit: 'm', zone: null, recoverySec: null },
          { value: 800, unit: 'm', zone: null, recoverySec: null },
        ],
        recoveryRule: 'Built into loop',
      },
    ],
    atPace: null,
    session: b(45, 75, 'min'),
    warmupCooldownMi: null,
    cadence: { minDays: 2, maxDays: 3, source: 'Frequency | 2–3×/week during 4-week hill phase' },
    distances: ALL,
    phases: ['hill_strength'],
    tiers: NOT_BEGINNER,
    cites: [
      'Original loop (Lydiard) | ~1.9 mi: 800m of springing/bounding uphill, 800m flat jog, 700m fast relaxed striding downhill, 800m wind sprints on bottom flat',
      'Reps | 3–6 laps',
      'Total session | 45–75 min',
      'When in cycle | Lydiard hill phase: between base and anaerobic phase',
      'Contraindications | High orthopedic stress; not for novice runners',
    ],
  },
  {
    slug: 'hill-fartlek',
    name: 'Hill fartlek',
    section: '§8.6',
    family: 'hills',
    zones: [],
    effortOnly: true,
    structures: [
      { kind: 'continuous', block: b(30, 60, 'min'), shape: 'Surge each climb, recover on descent and flats' },
    ],
    atPace: b(5, 10, 'min'),
    session: b(30, 60, 'min'),
    warmupCooldownMi: null,
    cadence: null,
    distances: ALL,
    phases: ['base'],
    tiers: EVERYONE,
    cites: [
      '| Hill fartlek | 30–60 min | Variable | Mixed | n/a | Continuous run |',
      'Structure | 30–60 min run on hilly course; surge each climb, recover on descent and flats',
      'Total at-pace | 5–10 min total of uphill surging',
      'When in cycle | Base phase, trail/cross-country prep',
    ],
  },

  // ══ §9 · fartlek ══════════════════════════════════════════════════════════
  {
    slug: 'mona-fartlek',
    name: 'Mona fartlek',
    section: '§9.2',
    family: 'fartlek',
    zones: ['5K', 'mile'],
    effortOnly: false,
    structures: [
      {
        kind: 'sequence',
        steps: [
          { value: 90, unit: 's', zone: '5K', recoverySec: 90 },
          { value: 90, unit: 's', zone: '5K', recoverySec: 90 },
          { value: 60, unit: 's', zone: '5K', recoverySec: 60 },
          { value: 60, unit: 's', zone: '5K', recoverySec: 60 },
          { value: 60, unit: 's', zone: '5K', recoverySec: 60 },
          { value: 60, unit: 's', zone: '5K', recoverySec: 60 },
          { value: 30, unit: 's', zone: null, recoverySec: 30 },
          { value: 30, unit: 's', zone: null, recoverySec: 30 },
          { value: 30, unit: 's', zone: null, recoverySec: 30 },
          { value: 30, unit: 's', zone: null, recoverySec: 30 },
          { value: 15, unit: 's', zone: 'mile', recoverySec: 15 },
          { value: 15, unit: 's', zone: 'mile', recoverySec: 15 },
          { value: 15, unit: 's', zone: 'mile', recoverySec: 15 },
          { value: 15, unit: 's', zone: 'mile', recoverySec: 15 },
        ],
        recoveryRule: 'floats are recovery jogs (not stops)',
      },
    ],
    atPace: null,
    session: b(20, 20, 'min'),
    warmupCooldownMi: null,
    cadence: { minDays: 7, maxDays: 10, source: 'Frequency | Weekly or every 10 days' },
    distances: ALL,
    phases: BASE_THROUGH_SPECIFIC,
    tiers: EVERYONE,
    cites: [
      '| Mona fartlek | 20 min | 2×90 s, 4×60 s, 4×30 s, 4×15 s; equal float | 5K → mile effort |',
      'Structure | 2 × 90 s hard / 90 s float, then 4 × 60 s / 60 s float, then 4 × 30 s / 30 s float, then 4 × 15 s / 15 s float',
      'Pace | 90 s reps at 5K effort; 15 s reps at mile effort; floats are recovery jogs (not stops)',
      'Total | 20 min continuous; 14 reps',
      'Warmup/cooldown | 15 min E each side',
      'When in cycle | Base through specific; first session back from layoff (lighter version)',
    ],
    conventions: [
      'The 30 s reps carry no zone in the doc — it names only the 90 s (5K) and 15 s (mile) ' +
        'ends of the ramp — so their `zone` is null rather than interpolated.',
    ],
  },
  {
    slug: 'michigan-fartlek',
    name: 'Michigan fartlek',
    section: '§9.3',
    family: 'fartlek',
    zones: ['mile', '3K', 'T', 'MP'],
    effortOnly: false,
    structures: [
      {
        kind: 'sequence',
        steps: [
          { value: 1, unit: 'mi', zone: 'mile', recoverySec: 180 },
          { value: 1, unit: 'mi', zone: 'T', recoverySec: 180 },
          { value: 1200, unit: 'm', zone: '3K', recoverySec: 180 },
          { value: 1200, unit: 'm', zone: 'T', recoverySec: 180 },
          { value: 800, unit: 'm', zone: '3K', recoverySec: 180 },
          { value: 800, unit: 'm', zone: 'T', recoverySec: 180 },
          { value: 400, unit: 'm', zone: 'mile', recoverySec: null },
        ],
        recoveryRule: '3 min jog between segments',
      },
    ],
    atPace: null,
    session: b(25, 35, 'min'),
    warmupCooldownMi: null,
    cadence: null,
    perCycleMax: 1,
    distances: ['5k', '10k'],
    phases: ['race_specific'],
    tiers: NOT_BEGINNER,
    cites: [
      '| Michigan fartlek | ~25–35 min + cooldown | Mile track, mile road, 1200 track, 1200 road, 800 track, 800 road, 400 track |',
      'Pace span | Track segments at mile/3K effort; road segments at threshold/MP',
      'Total at-pace | ~3–4 mi track + ~3 mi road',
      'Frequency | 1× per training cycle (signature workout)',
      'When in cycle | Peak specific phase, XC/track',
      'Contraindications | Logistically demanding; substitute alternating surfaces if no road/track adjacent',
    ],
    conventions: [
      'The doc states no tier. Beginners are excluded here on the "Logistically demanding" ' +
        'contraindication plus the seven-segment pace ladder; that gate is ours.',
      '"XC/track" is mapped to the 5K and 10K categories — the doc does not use this ' +
        'app\'s distance categories at all.',
    ],
  },
  {
    slug: 'lydiard-fartlek',
    name: 'Lydiard fartlek',
    section: '§9.4',
    family: 'fartlek',
    zones: ['E'],
    effortOnly: true,
    structures: [
      { kind: 'continuous', block: b(45, 60, 'min'), shape: 'Easy bulk; surges from 30 s to 3 min at moderate-to-hard effort' },
    ],
    atPace: null,
    session: b(45, 60, 'min'),
    warmupCooldownMi: null,
    cadence: null,
    distances: ALL,
    phases: ['base'],
    tiers: EVERYONE,
    cites: [
      '| Lydiard fartlek | 45–60 min | Free, by feel | Easy → hard surges |',
      'Structure | Continuous run, 45–60 min, with surges of varying length and intensity by feel',
      'Surges | 4–10 per session',
      'When in cycle | Base phase; transitional weeks',
    ],
  },
  {
    slug: 'time-based-fartlek',
    name: 'Time-based fartlek',
    section: '§9.5',
    family: 'fartlek',
    zones: ['5K', '10K'],
    effortOnly: false,
    structures: [
      { kind: 'reps', reps: r(6, 6), rep: b(3, 3, 'min'), recoverySec: r(120, 120), recoveryRule: '6×3 min on / 2 min off' },
      { kind: 'reps', reps: r(8, 8), rep: b(2, 2, 'min'), recoverySec: r(60, 60), recoveryRule: '8×2 min on / 1 min off' },
      {
        kind: 'sequence',
        steps: [
          { value: 1, unit: 'min', zone: '10K', recoverySec: null },
          { value: 2, unit: 'min', zone: '10K', recoverySec: null },
          { value: 3, unit: 'min', zone: '10K', recoverySec: null },
          { value: 4, unit: 'min', zone: '10K', recoverySec: null },
          { value: 3, unit: 'min', zone: '10K', recoverySec: null },
          { value: 2, unit: 'min', zone: '10K', recoverySec: null },
          { value: 1, unit: 'min', zone: '10K', recoverySec: null },
        ],
        recoveryRule: 'floats are easy jog',
      },
    ],
    atPace: null,
    session: b(20, 40, 'min'),
    warmupCooldownMi: null,
    cadence: { minDays: 7, maxDays: 14, source: 'Frequency | Weekly or biweekly' },
    distances: ALL,
    phases: ['base'],
    tiers: EVERYONE,
    cites: [
      '| Time-based fartlek | 20–40 min | Pre-set work/float repeats | Variable |',
      'Common structures | 6×3 min on / 2 min off; 8×2 min on / 1 min off; 1-2-3-4-3-2-1 min ladder',
      'Pace | "On" segments at 5K–10K effort; floats are easy jog',
      'When in cycle | Base phase or trail-running prep',
    ],
    conventions: [
      'The 1-2-3-4-3-2-1 ladder\'s float lengths are not stated, so its steps carry a null ' +
        'recovery and the selector uses the doc\'s "floats are easy jog" rule.',
    ],
  },

  // ══ §10 · combo / alternation ═════════════════════════════════════════════
  {
    slug: 'mp-10k-alternations',
    name: 'MP/10K alternations',
    section: '§10.1',
    family: 'combo',
    zones: ['MP', '10K'],
    effortOnly: false,
    structures: [
      {
        kind: 'alternation',
        steady: { value: 1, unit: 'mi', zone: 'MP' },
        fast: { value: 1, unit: 'mi', zone: '10K' },
        cycles: r(5, 8),
      },
      {
        kind: 'alternation',
        steady: { value: 1, unit: 'mi', zone: 'MP' },
        fast: { value: 400, unit: 'm', zone: '10K' },
        cycles: r(6, 10),
      },
    ],
    atPace: b(8, 15, 'mi'),
    session: b(8, 15, 'mi'),
    warmupCooldownMi: null,
    cadence: { minDays: 14, maxDays: 21, source: 'Frequency | Every 2–3 weeks' },
    distances: ['m'],
    phases: ['race_specific'],
    tiers: EVERYONE,
    cites: [
      'Structure (long) | 1 mi at MP / 1 mi at 10K, repeated 5–8×',
      'Structure (entry) | 1 mi MP / 400 m at 10K, repeated 6–10×',
      'Total volume | 8–15 mi continuous',
      'Pace | Faster segments at 10K to HM pace; recovery segments at MP (NOT easy)',
      'When in cycle | Marathon specific phase, 6–10 weeks out',
      'Contraindications | High accumulated stress — full easy day before and after',
    ],
  },
  {
    slug: 'threshold-vo2-combo',
    name: 'Threshold + VO2 combo',
    section: '§10.2',
    family: 'combo',
    zones: ['T', 'I', 'R'],
    effortOnly: false,
    structures: [
      {
        kind: 'sequence',
        steps: [
          { value: 2, unit: 'mi', zone: 'T', recoverySec: 150 },
          { value: 800, unit: 'm', zone: 'I', recoverySec: null },
          { value: 800, unit: 'm', zone: 'I', recoverySec: null },
          { value: 800, unit: 'm', zone: 'I', recoverySec: null },
          { value: 800, unit: 'm', zone: 'I', recoverySec: null },
        ],
        recoveryRule: '2–3 min between blocks; standard recoveries within each block',
      },
      {
        kind: 'sequence',
        steps: [
          { value: 4, unit: 'mi', zone: 'T', recoverySec: 150 },
          { value: 400, unit: 'm', zone: 'R', recoverySec: null },
          { value: 400, unit: 'm', zone: 'R', recoverySec: null },
          { value: 400, unit: 'm', zone: 'R', recoverySec: null },
          { value: 400, unit: 'm', zone: 'R', recoverySec: null },
          { value: 400, unit: 'm', zone: 'R', recoverySec: null },
          { value: 400, unit: 'm', zone: 'R', recoverySec: null },
        ],
        recoveryRule: '2–3 min between blocks; standard recoveries within each block',
      },
    ],
    atPace: null,
    session: null,
    warmupCooldownMi: null,
    cadence: null,
    distances: ['hm', 'm'],
    phases: ['race_specific'],
    tiers: NOT_BEGINNER,
    cites: [
      'Common structures | 2 mi T + 4×800 I; 4 mi T + 6×400 R; 3×1 mi T + 4×1K I',
      'Pace | Each block at its own zone',
      'Recovery | 2–3 min between blocks; standard recoveries within each block',
      'When in cycle | Late specific phase, HM/marathon',
      'Contraindications | Don\'t combine zones if either system is undertrained — practice each in isolation first',
    ],
    conventions: [
      'The "practice each in isolation first" contraindication is mapped to excluding ' +
        'beginners. The doc states a training-history condition, not a tier.',
    ],
  },
  {
    slug: 'wave-tempo',
    name: 'Wave tempo',
    section: '§10.3',
    family: 'combo',
    zones: ['T'],
    effortOnly: false,
    structures: [
      { kind: 'continuous', block: b(4, 8, 'mi'), shape: 'Alternate ±5–15 s/mi around T pace, 30 s to 2 min per segment' },
    ],
    atPace: b(4, 8, 'mi'),
    session: null,
    warmupCooldownMi: null,
    cadence: null,
    distances: ['hm', 'm'],
    phases: SPECIFIC,
    tiers: EVERYONE,
    cites: [
      'Structure | Alternate ±5–15 s/mi around T pace, 30 s to 2 min per segment',
      'Total | 4–8 mi continuous',
      'Pace | Average comes out near T',
      'When in cycle | Specific phase HM/marathon',
    ],
  },

  // ══ §11 · marathon-specific ═══════════════════════════════════════════════
  {
    slug: 'canova-special-block',
    name: 'Canova special block',
    section: '§11.1',
    family: 'marathon_specific',
    zones: ['MP'],
    effortOnly: false,
    structures: [
      {
        kind: 'double',
        am: '25–30 km progressive long run, last portion at MP',
        pm: '15–20 km with 10–12 km at MP, or 4–6 × 2K at MP',
        gapHours: r(6, 8),
      },
    ],
    atPace: null,
    session: b(45, 50, 'km'),
    warmupCooldownMi: null,
    cadence: { minDays: 14, maxDays: 21, source: 'Spacing | 2–3 weeks between blocks' },
    perCycleMax: 3,
    distances: ['m'],
    phases: ['race_specific'],
    tiers: ['advanced_plus'],
    cites: [
      'Structure | Two sessions, same day, ~6–8 hours apart. AM and PM both at ~90% effort',
      'Total volume | 45–50 km (28–31 mi) across the day',
      'Frequency | 2–3× per marathon cycle',
      'Spacing | 2–3 weeks between blocks',
      'When in cycle | Specific phase; first block 8–10 weeks out, last 4–5 weeks out',
      'Contraindications | Elite-level workout; sub-elite runners scale to ~30–40 km total. Requires high training age',
    ],
    conventions: [
      '"Elite-level workout ... Requires high training age" is mapped to advanced_plus only. ' +
        'The doc offers a sub-elite scaling (30–40 km) but names no tier for it, so this ' +
        'module does not open the session to lower tiers on that sentence alone.',
    ],
  },
  {
    slug: 'canova-2k-repeats',
    name: 'Canova 2K repeats',
    section: '§11.2',
    family: 'marathon_specific',
    zones: ['MP', 'T'],
    effortOnly: false,
    structures: [
      { kind: 'reps', reps: r(4, 8), rep: b(2, 2, 'km'), recoverySec: r(120, 180), recoveryRule: '2–3 min jog (60–90 s for advanced)' },
    ],
    atPace: b(8, 16, 'km'),
    session: null,
    warmupCooldownMi: null,
    cadence: { minDays: 10, maxDays: 14, source: 'Frequency | Every 10–14 days in specific phase' },
    distances: ['m'],
    phases: ['race_specific'],
    tiers: EVERYONE,
    cites: [
      'Pace | Start slightly slower than MP; descend across reps to slightly faster than T (anaerobic threshold)',
      'Pace progression | Each rep 2.5–5 s/km faster than the previous',
      'Reps | 4–8 × 2K',
      'Recovery | 2–3 min jog (60–90 s for advanced)',
      'Total volume | 8–16 K at quality',
      'Pacing requirement | Even pace within each rep',
    ],
  },
  {
    slug: 'pre-fatigue-mp-work',
    name: 'Pre-fatigue MP work',
    section: '§11.4',
    family: 'marathon_specific',
    zones: ['E', 'MP'],
    effortOnly: false,
    structures: [
      {
        kind: 'double',
        am: '14–18 mi easy on Saturday',
        pm: '6–10 mi MP on Sunday',
        gapHours: null,
      },
      {
        kind: 'sequence',
        steps: [
          { value: 8, unit: 'mi', zone: 'E', recoverySec: 0 },
          { value: 8, unit: 'mi', zone: 'MP', recoverySec: 0 },
        ],
        recoveryRule: '8 mi easy + immediate 8 mi MP',
      },
    ],
    atPace: b(6, 10, 'mi'),
    session: null,
    warmupCooldownMi: null,
    cadence: { minDays: 21, maxDays: 28, source: 'Frequency | Every 3–4 weeks specific' },
    distances: ['m'],
    phases: ['race_specific'],
    tiers: NOT_BEGINNER,
    cites: [
      'Structures | (a) 14–18 mi easy on Saturday + 6–10 mi MP on Sunday; (b) 8 mi easy + immediate 8 mi MP; (c) 2-day back-to-back doubles',
      'Pace | MP exact',
      'Frequency | Every 3–4 weeks specific',
      'Contraindications | Highest accumulated stress workout; must be followed by ≥2 easy/recovery days',
    ],
    conventions: [
      '"Highest accumulated stress workout" is mapped to excluding beginners. The doc names ' +
        'no tier.',
    ],
  },

  // ══ §12 · cutdowns ════════════════════════════════════════════════════════
  {
    slug: 'mile-cutdowns',
    name: 'Mile cutdowns',
    section: '§12.2',
    family: 'cutdown',
    zones: ['MP', 'HM', 'T', '10K', '5K'],
    effortOnly: false,
    structures: [
      { kind: 'reps', reps: r(3, 6), rep: b(1, 1, 'mi'), recoverySec: r(60, 90), recoveryRule: '60–90 s jog (Daniels-style cruise rest)' },
    ],
    atPace: b(3, 6, 'mi'),
    session: null,
    warmupCooldownMi: null,
    cadence: { minDays: 14, maxDays: 14, source: 'Frequency | Every 2 weeks specific phase' },
    distances: ['5k', '10k', 'hm'],
    phases: SPECIFIC,
    tiers: EVERYONE,
    cites: [
      '| Mile cutdowns | 3–6 × 1 mi | Each rep 5–15 s/mi faster | 60–90 s jog |',
      'Structure | Start slower than MP; each rep 5–15 s/mi faster. Final rep at 5K pace or faster',
      'Pace example | 6 reps: MP+10, MP, MP-10, HM, T, 10K',
      'When in cycle | Specific phase, 5K/10K/HM',
    ],
  },
  {
    slug: '1k-cutdowns',
    name: '1K cutdowns',
    section: '§12.3',
    family: 'cutdown',
    zones: ['MP', '5K'],
    effortOnly: false,
    structures: [
      { kind: 'reps', reps: r(5, 8), rep: b(1, 1, 'km'), recoverySec: r(60, 90), recoveryRule: '60–90 s jog (or 200 m jog)' },
    ],
    atPace: null,
    session: null,
    warmupCooldownMi: null,
    cadence: { minDays: 7, maxDays: 10, source: 'Frequency | Every 7–10 days specific' },
    distances: ALL,
    phases: ['specific_support', 'race_specific', 'taper'],
    tiers: EVERYONE,
    cites: [
      '| 1K cutdowns | 5–8 × 1K | Each rep 5 s/mi faster | 60–90 s jog |',
      'Purpose | Smaller-dose cutdown; useful for taper sharpening',
      'Pace | Start at MP, finish at 5K',
    ],
    conventions: [
      '§12.3 states no distance list. All five are offered; the taper phase comes from the ' +
        'Purpose row ("useful for taper sharpening") rather than a "When in cycle" row, ' +
        'which §12.3 does not have.',
    ],
  },
  {
    slug: '5k-progression',
    name: '5K progression',
    section: '§12.4',
    family: 'cutdown',
    zones: ['HM', 'T', '10K', '5K'],
    effortOnly: false,
    structures: [
      {
        kind: 'sequence',
        steps: [
          { value: 1, unit: 'mi', zone: 'HM', recoverySec: 0 },
          { value: 1, unit: 'mi', zone: 'T', recoverySec: 0 },
          { value: 1.1, unit: 'mi', zone: '5K', recoverySec: 0 },
        ],
        recoveryRule: 'Recovery | None',
      },
    ],
    atPace: b(3.1, 3.1, 'mi'),
    session: null,
    warmupCooldownMi: null,
    cadence: null,
    distances: ['5k', '10k'],
    phases: SPECIFIC,
    tiers: EVERYONE,
    cites: [
      '| 5K progression | 5K continuous | 5K split into thirds, each faster | None |',
      'Structure | 5K continuous: first third at HM, middle at T, final third at 10K-5K',
      'Pace | Start ~30 s/mi slower than 5K, finish at or below 5K pace',
      'When in cycle | Specific phase 5K/10K',
    ],
    conventions: [
      'The doc says "thirds" of a 5K; the steps carry that as 1 + 1 + 1.1 miles so the ' +
        'sequence sums to 3.1. The doc states no mile split of its own.',
    ],
  },
  {
    slug: 'continuous-mile-cutdowns',
    name: 'Continuous mile cutdowns',
    section: '§12.5',
    family: 'cutdown',
    zones: ['MP', 'HM'],
    effortOnly: false,
    structures: [
      { kind: 'continuous', block: b(5, 7, 'mi'), shape: 'Each mile ~10–15 s/mi faster than prior' },
    ],
    atPace: b(5, 7, 'mi'),
    session: null,
    warmupCooldownMi: null,
    cadence: { minDays: 14, maxDays: 14, source: 'Frequency | Every 2 weeks specific' },
    distances: ALL,
    phases: SPECIFIC,
    tiers: EVERYONE,
    cites: [
      '| Continuous mile cutdown | 5–7 mi continuous | Each mile 10–15 s/mi faster | None |',
      'Structure | 5–7 mi continuous, each mile ~10–15 s/mi faster than prior',
      'Pace | Start MP+15, drop to slightly faster than HM by final mile',
      'Total | 5–7 mi at quality',
    ],
    conventions: ['§12.5 states no distance list; all five are offered.'],
  },

  // ══ §13 · ladders ═════════════════════════════════════════════════════════
  {
    slug: 'ascending-ladder',
    name: '400-800-1200-1600 ladder',
    section: '§13.2',
    family: 'ladder',
    zones: ['mile', '3K', '5K', '10K', 'HM'],
    effortOnly: false,
    structures: [
      {
        kind: 'sequence',
        steps: [
          { value: 400, unit: 'm', zone: 'mile', recoverySec: 90 },
          { value: 800, unit: 'm', zone: '3K', recoverySec: 180 },
          { value: 1200, unit: 'm', zone: '5K', recoverySec: 240 },
          { value: 1600, unit: 'm', zone: '10K', recoverySec: 270 },
        ],
        recoveryRule: 'Jog ≈ rep duration: 90 s after 400, 3 min after 800, 4 min after 1200, 4–5 min after 1600',
      },
    ],
    atPace: b(4, 4, 'km'),
    session: null,
    warmupCooldownMi: b(2, 3, 'mi'),
    cadence: { minDays: 10, maxDays: 14, source: 'Frequency | Every 10–14 days specific' },
    distances: ['5k', '10k'],
    phases: SPECIFIC,
    tiers: EVERYONE,
    cites: [
      '| Ascending ladder | 400-800-1200-1600 | Build mental load; finishing on long rep tests stamina |',
      'Pace by rep length | 400 at mile/3K; 800 at 3K/5K; 1200 at 5K/10K; 1600 at 10K/HM',
      'Recovery | Jog ≈ rep duration: 90 s after 400, 3 min after 800, 4 min after 1200, 4–5 min after 1600',
      'Total at-pace | 4 K (one-way); 8 K (full pyramid)',
      'When in cycle | Specific phase XC/track',
    ],
    conventions: [
      'The 1600 recovery band is 4–5 min; the step carries its midpoint (270 s). "XC/track" ' +
        'is mapped to the 5K and 10K categories.',
    ],
  },
  {
    slug: 'descending-ladder',
    name: 'Descending ladder',
    section: '§13.1',
    family: 'ladder',
    zones: ['10K', '5K', '3K', 'mile'],
    effortOnly: false,
    structures: [
      {
        kind: 'sequence',
        steps: [
          { value: 1600, unit: 'm', zone: '10K', recoverySec: 270 },
          { value: 1200, unit: 'm', zone: '5K', recoverySec: 240 },
          { value: 800, unit: 'm', zone: '3K', recoverySec: 180 },
          { value: 400, unit: 'm', zone: 'mile', recoverySec: 90 },
        ],
        recoveryRule: 'Jog ≈ rep duration',
      },
    ],
    atPace: b(4, 4, 'km'),
    session: null,
    warmupCooldownMi: b(2, 3, 'mi'),
    cadence: { minDays: 10, maxDays: 14, source: '§13.2 | Frequency | Every 10–14 days specific' },
    distances: ['5k', '10k'],
    phases: SPECIFIC,
    tiers: EVERYONE,
    cites: [
      '| Descending ladder | 1600-1200-800-400 | Front-loaded; produces ~2× time at peak intensity vs equal-volume sets |',
    ],
    conventions: [
      '§13.1\'s row gives the sequence and the target and nothing else. Pace-by-rep-length, ' +
        'recovery, cadence, phase and distance are taken from §13.2, the only field table ' +
        'in §13 that states them. That transfer is ours.',
    ],
  },
  {
    slug: 'up-and-down-pyramid',
    name: 'Up-and-down pyramid',
    section: '§13.3',
    family: 'ladder',
    zones: ['5K', '10K'],
    effortOnly: false,
    structures: [
      {
        kind: 'sequence',
        steps: [
          { value: 400, unit: 'm', zone: '5K', recoverySec: null },
          { value: 800, unit: 'm', zone: '5K', recoverySec: null },
          { value: 1200, unit: 'm', zone: '5K', recoverySec: null },
          { value: 1600, unit: 'm', zone: '10K', recoverySec: null },
          { value: 1200, unit: 'm', zone: '5K', recoverySec: null },
          { value: 800, unit: 'm', zone: '5K', recoverySec: null },
          { value: 400, unit: 'm', zone: '5K', recoverySec: null },
        ],
        recoveryRule: 'Equal time jog after each rep',
      },
    ],
    atPace: b(8, 8, 'km'),
    session: null,
    warmupCooldownMi: b(2, 3, 'mi'),
    cadence: { minDays: 10, maxDays: 14, source: '§13.2 | Frequency | Every 10–14 days specific' },
    distances: ['5k', '10k'],
    phases: SPECIFIC,
    tiers: EVERYONE,
    cites: [
      'Structure | 400-800-1200-1600-1200-800-400 (or 200-400-800-1200-800-400-200)',
      'Recovery | Equal time jog after each rep',
      'Pace | 5K to 10K range; sometimes ladder pace (faster on shorter reps)',
      'Total at-pace | 8 K full version',
      'Note | Descending half is mentally easier; ascending half builds toughness',
    ],
    conventions: [
      'The doc gives a "5K to 10K range" rather than a zone per rung; the steps carry 5K ' +
        'throughout with the 1600 at 10K, matching §13.2\'s pace-by-rep-length rule. ' +
        'Cadence, phase and distance are transferred from §13.2 as for the other ladders.',
    ],
  },
  {
    slug: 'compressed-pyramid',
    name: 'Compressed pyramid',
    section: '§13.1',
    family: 'ladder',
    zones: ['mile', '3K', '5K'],
    effortOnly: false,
    structures: [
      {
        kind: 'sequence',
        steps: [
          { value: 200, unit: 'm', zone: 'mile', recoverySec: null },
          { value: 400, unit: 'm', zone: 'mile', recoverySec: null },
          { value: 600, unit: 'm', zone: '3K', recoverySec: null },
          { value: 800, unit: 'm', zone: '3K', recoverySec: null },
          { value: 600, unit: 'm', zone: '3K', recoverySec: null },
          { value: 400, unit: 'm', zone: 'mile', recoverySec: null },
          { value: 200, unit: 'm', zone: 'mile', recoverySec: null },
        ],
        recoveryRule: 'Equal time jog after each rep',
      },
    ],
    atPace: b(3.2, 3.2, 'km'),
    session: null,
    warmupCooldownMi: b(2, 3, 'mi'),
    cadence: { minDays: 10, maxDays: 14, source: '§13.2 | Frequency | Every 10–14 days specific' },
    distances: ['5k'],
    phases: SPECIFIC,
    tiers: EVERYONE,
    cites: [
      '| Compressed pyramid | 200-400-600-800-600-400-200 | 5K/mile prep |',
    ],
    conventions: [
      'The distance list comes from the row\'s own Target column ("5K/mile prep"). Zones, ' +
        'recovery, cadence and phase are transferred from §13.2 and §13.3, as for the other ' +
        '§13.1 rows.',
    ],
  },

  // ══ §14.1 · 5K-specific ═══════════════════════════════════════════════════
  {
    slug: '3k-reps',
    name: '3K reps',
    section: '§14.1',
    family: 'race_specific',
    zones: ['10K', 'HM'],
    effortOnly: false,
    structures: [
      { kind: 'reps', reps: r(2, 3), rep: b(3, 3, 'km'), recoverySec: r(180, 180), recoveryRule: '3 min jog' },
    ],
    atPace: b(6, 9, 'km'),
    session: null,
    warmupCooldownMi: b(2, 3, 'mi'),
    cadence: null,
    distances: ['5k'],
    phases: ['race_specific'],
    tiers: EVERYONE,
    cites: ['| 3K reps | 2–3 × 3K | 10K to HM pace | 3 min jog |'],
  },
  {
    slug: 'mile-repeats-at-5k',
    name: 'Mile repeats at 5K',
    section: '§14.1',
    family: 'race_specific',
    zones: ['5K'],
    effortOnly: false,
    structures: [
      { kind: 'reps', reps: r(4, 5), rep: b(1, 1, 'mi'), recoverySec: r(120, 180), recoveryRule: '2–3 min jog' },
    ],
    atPace: b(4, 5, 'mi'),
    session: null,
    warmupCooldownMi: b(2, 3, 'mi'),
    cadence: null,
    distances: ['5k'],
    phases: ['race_specific'],
    tiers: EVERYONE,
    cites: ['| Mile repeats at 5K | 4–5 × 1 mi | 5K race pace | 2–3 min jog |'],
  },
  {
    slug: '400m-sets-5k',
    name: '2 × (4 × 400)',
    section: '§14.1',
    family: 'race_specific',
    zones: ['5K', '3K'],
    effortOnly: false,
    structures: [
      { kind: 'reps', reps: r(8, 8), rep: b(400, 400, 'm'), recoverySec: r(60, 60), recoveryRule: '60 s within set, 3 min between sets' },
    ],
    atPace: b(3.2, 3.2, 'km'),
    session: null,
    warmupCooldownMi: b(2, 3, 'mi'),
    cadence: null,
    distances: ['5k'],
    phases: ['race_specific'],
    tiers: EVERYONE,
    cites: ['| 2 × (4 × 400) | Two sets, set break | 5K to 3K | 60 s within set, 3 min between sets |'],
    conventions: [
      'Flattened to eight reps with the within-set recovery. The catalogue has no set-of-sets ' +
        'structure; the 3 min set break is preserved in the recovery rule text.',
    ],
  },
  {
    slug: '12x400-at-5k',
    name: '12 × 400 at 5K',
    section: '§14.1',
    family: 'race_specific',
    zones: ['5K'],
    effortOnly: false,
    structures: [
      { kind: 'reps', reps: r(12, 12), rep: b(400, 400, 'm'), recoverySec: r(60, 90), recoveryRule: '60–90 s jog' },
    ],
    atPace: b(4.8, 4.8, 'km'),
    session: null,
    warmupCooldownMi: b(2, 3, 'mi'),
    cadence: null,
    distances: ['5k'],
    phases: ['race_specific'],
    tiers: EVERYONE,
    cites: ['| 12 × 400 at 5K | Classic 5K simulator | 5K race pace | 60–90 s jog |'],
  },
  {
    slug: '5x1k-at-5k',
    name: '5 × 1K at 5K pace',
    section: '§14.1',
    family: 'race_specific',
    zones: ['5K'],
    effortOnly: false,
    structures: [
      { kind: 'reps', reps: r(5, 5), rep: b(1, 1, 'km'), recoverySec: r(90, 120), recoveryRule: '90 s – 2 min jog' },
    ],
    atPace: b(5, 5, 'km'),
    session: null,
    warmupCooldownMi: b(2, 3, 'mi'),
    cadence: null,
    distances: ['5k'],
    phases: ['race_specific'],
    tiers: EVERYONE,
    cites: ['| 5 × 1K at 5K pace | Threshold-volume at race pace | 5K race pace | 90 s – 2 min jog |'],
  },

  // ══ §14.2 · 10K-specific ══════════════════════════════════════════════════
  {
    slug: 'mile-repeats-at-10k',
    name: 'Mile repeats at 10K',
    section: '§14.2',
    family: 'race_specific',
    zones: ['10K'],
    effortOnly: false,
    structures: [
      { kind: 'reps', reps: r(5, 6), rep: b(1, 1, 'mi'), recoverySec: r(60, 60), recoveryRule: '60 s jog' },
    ],
    atPace: b(5, 6, 'mi'),
    session: null,
    warmupCooldownMi: b(2, 3, 'mi'),
    cadence: null,
    distances: ['10k'],
    phases: ['race_specific'],
    tiers: EVERYONE,
    cites: ['| Mile repeats at 10K | 5–6 × 1 mi | 10K race pace | 60 s jog |'],
  },
  {
    slug: '2k-reps-at-10k',
    name: '2K reps',
    section: '§14.2',
    family: 'race_specific',
    zones: ['10K'],
    effortOnly: false,
    structures: [
      { kind: 'reps', reps: r(4, 5), rep: b(2, 2, 'km'), recoverySec: r(120, 180), recoveryRule: '2–3 min jog' },
    ],
    atPace: b(8, 10, 'km'),
    session: null,
    warmupCooldownMi: b(2, 3, 'mi'),
    cadence: null,
    distances: ['10k'],
    phases: ['race_specific'],
    tiers: EVERYONE,
    cites: ['| 2K reps | 4–5 × 2K | 10K race pace | 2–3 min jog |'],
  },
  {
    slug: '3x2mi-at-10k',
    name: '3 × 2 mi',
    section: '§14.2',
    family: 'race_specific',
    zones: ['10K', 'HM'],
    effortOnly: false,
    structures: [
      { kind: 'reps', reps: r(3, 3), rep: b(2, 2, 'mi'), recoverySec: r(180, 180), recoveryRule: '3 min jog' },
    ],
    atPace: b(6, 6, 'mi'),
    session: null,
    warmupCooldownMi: b(2, 3, 'mi'),
    cadence: null,
    distances: ['10k'],
    phases: ['race_specific'],
    tiers: EVERYONE,
    cites: ['| 3 × 2 mi | Long-rep threshold | 10K to HM | 3 min jog |'],
  },
  {
    slug: '1200s-at-10k',
    name: '6 × 1200 at 10K',
    section: '§14.2',
    family: 'race_specific',
    zones: ['10K'],
    effortOnly: false,
    structures: [
      { kind: 'reps', reps: r(6, 6), rep: b(1200, 1200, 'm'), recoverySec: r(90, 120), recoveryRule: '90 s – 2 min jog' },
    ],
    atPace: b(7.2, 7.2, 'km'),
    session: null,
    warmupCooldownMi: b(2, 3, 'mi'),
    cadence: null,
    distances: ['10k'],
    phases: ['race_specific'],
    tiers: EVERYONE,
    cites: ['| 6 × 1200 at 10K | Mid-rep volume | 10K race pace | 90 s – 2 min jog |'],
  },

  // ══ §14.3 · half-specific ═════════════════════════════════════════════════
  {
    slug: '4x2mi-at-hm',
    name: '4 × 2 mi at HM',
    section: '§14.3',
    family: 'race_specific',
    zones: ['HM'],
    effortOnly: false,
    structures: [
      { kind: 'reps', reps: r(4, 4), rep: b(2, 2, 'mi'), recoverySec: r(60, 120), recoveryRule: '60–120 s jog' },
    ],
    atPace: b(8, 8, 'mi'),
    session: null,
    warmupCooldownMi: b(2, 3, 'mi'),
    cadence: null,
    distances: ['hm'],
    phases: ['race_specific'],
    tiers: EVERYONE,
    cites: [
      '| 4 × 2 mi | Predictor session | HM race pace | 60–120 s jog |',
      'The 4 × 2 mi at HM pace with 60–120 s rest is a classic HM readiness workout. Completing it in control 2 weeks before the race indicates readiness.',
    ],
  },
  {
    slug: '6x1mi-at-hm',
    name: '6 × 1 mi at HM',
    section: '§14.3',
    family: 'race_specific',
    zones: ['HM'],
    effortOnly: false,
    structures: [
      { kind: 'reps', reps: r(6, 6), rep: b(1, 1, 'mi'), recoverySec: r(60, 60), recoveryRule: '60 s jog' },
    ],
    atPace: b(6, 6, 'mi'),
    session: null,
    warmupCooldownMi: b(2, 3, 'mi'),
    cadence: null,
    distances: ['hm'],
    phases: ['race_specific'],
    tiers: EVERYONE,
    cites: ['| 6 × 1 mi at HM | Mid-rep volume | HM race pace | 60 s jog |'],
  },
  {
    slug: '3x3mi-at-hm',
    name: '3 × 3 mi at HM',
    section: '§14.3',
    family: 'race_specific',
    zones: ['HM'],
    effortOnly: false,
    structures: [
      { kind: 'reps', reps: r(3, 3), rep: b(3, 3, 'mi'), recoverySec: r(180, 180), recoveryRule: '3 min jog' },
    ],
    atPace: b(9, 9, 'mi'),
    session: null,
    warmupCooldownMi: b(2, 3, 'mi'),
    cadence: null,
    distances: ['hm'],
    phases: ['race_specific'],
    tiers: EVERYONE,
    cites: ['| 3 × 3 mi at HM | Long-rep stamina | HM race pace | 3 min jog |'],
  },
  {
    slug: '8x1k-at-hm',
    name: '8 × 1K at HM',
    section: '§14.3',
    family: 'race_specific',
    zones: ['HM', 'T'],
    effortOnly: false,
    structures: [
      { kind: 'reps', reps: r(8, 8), rep: b(1, 1, 'km'), recoverySec: r(60, 60), recoveryRule: '60 s jog' },
    ],
    atPace: b(8, 8, 'km'),
    session: null,
    warmupCooldownMi: b(2, 3, 'mi'),
    cadence: null,
    distances: ['hm'],
    phases: ['race_specific'],
    tiers: EVERYONE,
    cites: ['| 8 × 1K at HM | Sub-threshold volume | HM to T | 60 s jog |'],
  },
];

// ── lookups ─────────────────────────────────────────────────────────────────

const BY_SLUG = new Map(WORKOUT_CATALOGUE.map((e) => [e.slug, e]));

export function workoutBySlug(slug: string): CatalogueEntry | null {
  return BY_SLUG.get(slug) ?? null;
}

/**
 * The rep length §6 requires of a VO2max repetition, in minutes.
 *
 * Re-exported from `levers.ts` rather than restated, for the same reason the
 * continuous-tempo band is imported: one copy of a doctrine number, one claim
 * watching it.
 */
export { INTERVAL_REP_MINUTES, CONTINUOUS_TEMPO_MINUTES };
