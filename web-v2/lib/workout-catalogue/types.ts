/**
 * lib/workout-catalogue/types.ts · the shape of a named workout.
 *
 * `Research/04-workout-vocabulary.md` is a catalogue of 59 named workouts
 * across 18 sections, each stated as a field table: purpose, pace zone,
 * structure, recovery, volume bounds, frequency, and the phase it belongs to.
 * Until now that was prose. The engine's session shapes were hardcoded strings
 * at a handful of sites, so the vocabulary a plan could express was whatever
 * somebody had typed into `inlineFamilyPrescriptions` — one shape per family
 * per distance.
 *
 * These types turn the doc into data. The rules the types encode:
 *
 *   · EVERY NUMBER CARRIES ITS SOURCE. `cites` on each entry quotes the row it
 *     came from. A number with no row behind it does not go in the catalogue —
 *     it goes in `conventions`, labelled as ours.
 *
 *   · BANDS STAY BANDS. Doctrine says "3-6 x 1 mi", not "4 x 1 mi". The
 *     catalogue keeps the band and the SELECTOR picks inside it, because the
 *     point where the band collapses to a number is the point where the
 *     runner's weekly volume gets a say.
 *
 *   · NOTHING HERE IS DISTANCE-KEYED. A workout declares which distances it
 *     belongs to (`distances`); there is no `Record<DistCategory, …>` table in
 *     this module. That is deliberate: the incident behind Rule 7 was one
 *     distance's column spent on every distance, and a per-entry membership
 *     list cannot express that mistake.
 */
import {
  DISTANCE_CATEGORIES,
  type DistanceCategory,
} from '@/lib/race/distance-category';
import type { WorkoutFamily } from '@/lib/plan/workout-library-static';

/**
 * The app's ONE race-distance categorizer · `lib/race/distance-category.ts`.
 *
 * Re-exported under the engine's historical name rather than redefined. The
 * codebase carried three incompatible categorizers until 2026-08-18, which
 * shipped a 15-mile race trained as a half and raced as a marathon; a
 * catalogue that declared its own distance union would be the fourth. Only the
 * ultra floor (50 km) is doctrine — the other three boundaries are documented
 * convention, and they are stated there, once.
 */
export type DistCategory = DistanceCategory;
export type { WorkoutFamily };

/**
 * The doc's own pace shorthand · `Research/04-workout-vocabulary.md`
 * §"Pace zone shorthand". Nothing outside that table is a zone.
 */
export type PaceZone =
  | 'E'    // easy
  | 'M'    // marathon effort (Daniels M)
  | 'T'    // threshold, LT2
  | 'ST'   // sub-threshold, near LT1 (Norwegian)
  | 'I'    // interval, VO2max
  | 'R'    // repetition, speed/economy
  | 'HM'   // half-marathon race pace
  | 'MP'   // marathon race pace
  | '10K'
  | '5K'
  | '3K'
  | 'mile'; // mile race pace · the doc's R anchor, "~mile to 800m race pace"

/**
 * `Research/04` §15 "Training-cycle placement summary" names five phases. They
 * are the doctrine's, not the engine's — `PHASE_FROM_ENGINE` in `select.ts`
 * maps the engine's four onto them and says where the mapping is a convention.
 */
export type DoctrinePhase =
  | 'base'              // §15 "Base (8–12+ wks)"
  | 'hill_strength'     // §15 "Hill / strength (3–4 wks, optional)"
  | 'specific_support'  // §15 "Specific support (4–6 wks)"
  | 'race_specific'     // §15 "Race-specific (4–8 wks)"
  | 'taper';            // §15 "Sharpening / taper (2–3 wks)"

export const DOCTRINE_PHASES: readonly DoctrinePhase[] = [
  'base',
  'hill_strength',
  'specific_support',
  'race_specific',
  'taper',
] as const;

/** The engine's experience tiers · `lib/plan/generate.ts#LevelKey`, non-null. */
export type Tier = 'beginner' | 'intermediate' | 'advanced' | 'advanced_plus';

export const TIERS: readonly Tier[] = ['beginner', 'intermediate', 'advanced', 'advanced_plus'] as const;

/** Every category, from the canonical categorizer. Never a second list. */
export const ALL_DISTANCES: readonly DistCategory[] = DISTANCE_CATEGORIES;

/** Units the doc states rep and session sizes in. */
export type MeasureUnit = 'mi' | 'km' | 'm' | 'min' | 's';

/** A band the doc states, kept as a band. `min === max` when it states one number. */
export interface Band {
  min: number;
  max: number;
  unit: MeasureUnit;
}

export interface RepBand {
  min: number;
  max: number;
}

/**
 * A homogeneous rep set: "3-6 x 1 mi with 1 min jog".
 *
 * `recoveryRule` carries the doc's words when the recovery is stated as a
 * RELATION rather than a number ("jog rest ≈ rep time", "1 min jog per mile of
 * work segment"). The relation is the doctrine; `recoverySec` is the band the
 * doc also gives where it gives one, and is null where it does not — the
 * selector derives from the rule in that case rather than inventing a number.
 */
export interface RepStructure {
  kind: 'reps';
  reps: RepBand;
  rep: Band;
  recoverySec: RepBand | null;
  recoveryRule: string | null;
  /**
   * EFFORT-RAMP-1 (2026-08-19) · present ONLY where the doc states the rep
   * count as a progression rather than as a flat band, and holding the doc's
   * own words for it.
   *
   * Two rows in `Research/04-workout-vocabulary.md` say it in as many words:
   *
   *   · §7.3 hill sprints      · `Reps | Start 4–6, build to 8–12`
   *   · §8.2 short hill repeats · `Reps | 8–16 (start 8, build to 16)`
   *
   * `reps.min` is then the START and `reps.max` the BUILT dose, and `fits`
   * walks between them on the block's own clock rather than opening at the
   * ceiling. Every other rep row in the doc — §8.3's "6–10", §8.4's "4–8",
   * §7.4's "8–12" — is a plain band with no ramp language, and those entries
   * carry no `repBuild` and are not ramped. The field is the doc's sentence,
   * so a claim can check that the sentence is still there rather than trusting
   * a boolean somebody set.
   */
  repBuild?: string;
}

/** A single unbroken effort: a tempo, a long run, a continuous fartlek. */
export interface ContinuousStructure {
  kind: 'continuous';
  /** Length of the block itself, in the unit the doc states it in. */
  block: Band;
  /** Stated shape of the effort inside the block, when the doc gives one. */
  shape: string | null;
}

/** One step of a heterogeneous set: a ladder rung, a Mona segment. */
export interface SequenceStep {
  value: number;
  unit: MeasureUnit;
  /** The zone this step runs at, where the doc assigns one per step. */
  zone: PaceZone | null;
  /** Recovery after this step, seconds. Null when the doc states a rule instead. */
  recoverySec: number | null;
}

/** An ordered set of unequal reps: ladders, Mona, the Michigan. */
export interface SequenceStructure {
  kind: 'sequence';
  steps: SequenceStep[];
  recoveryRule: string | null;
}

/** Continuous alternation between two paces with no true recovery · §10. */
export interface AlternationStructure {
  kind: 'alternation';
  fast: { value: number; unit: MeasureUnit; zone: PaceZone };
  steady: { value: number; unit: MeasureUnit; zone: PaceZone };
  cycles: RepBand;
}

/**
 * Two sessions the engine cannot put in one slot · §11.1's same-day block and
 * §5.4's double-threshold arm.
 *
 * `gapHours` is what separates the two readings. Where the doc states hours,
 * the two sessions share a calendar DAY (§11.1: "~6–8 hours apart"). Where it
 * is null, the shape spans two days (§11.4's "14–18 mi easy on Saturday + 6–10
 * mi MP on Sunday"). Both are declined by the selector, for different reasons —
 * one because `plan_workouts` holds one prescribed session per date, the other
 * because it wants a hard session the day after the long run. Read `gapHours`
 * before assuming which.
 */
export interface DoubleStructure {
  kind: 'double';
  am: string;
  pm: string;
  /** Hours between the two sessions, where the doc states them. */
  gapHours: RepBand | null;
}

export type Structure =
  | RepStructure
  | ContinuousStructure
  | SequenceStructure
  | AlternationStructure
  | DoubleStructure;

/** Days between two runnings of this session, read out of its Frequency row. */
export interface Cadence {
  minDays: number;
  maxDays: number;
  /** The doc's own words, so the derivation is checkable. */
  source: string;
}

export interface CatalogueEntry {
  /** Stable kebab id. Never reused for a different workout. */
  slug: string;
  /** The doc's name for it, as §18's lookup index writes it where it appears there. */
  name: string;
  /** Section it is specified in, e.g. `§5.3`. Resolvable in the doc's headings. */
  section: string;
  family: WorkoutFamily;
  /**
   * The zones the WORK segments target. Ordered as the workout runs them, so a
   * progression long run reads `['E','M','T']`.
   */
  zones: PaceZone[];
  /**
   * True where the doc prescribes EFFORT and never a clock pace — every hill
   * session, and the sprints. §8.1's pace column is "5K–10K effort", never a
   * number, because a flat-ground pace is unreachable on a 4-6% grade.
   */
  effortOnly: boolean;
  /**
   * The shapes the doc gives. More than one where the doc gives alternatives
   * ("5–10 × 1K, or 4–6 × 2K, or 4–6 × 6 min"). The selector picks the first
   * that fits the week.
   */
  structures: Structure[];
  /** The doc's "Total at-pace" / "Total volume" row for ONE session. */
  atPace: Band | null;
  /** The doc's whole-session distance or duration, where it states one. */
  session: Band | null;
  /** Warm-up and cool-down, from the doc's own row, in easy miles. */
  warmupCooldownMi: Band | null;
  cadence: Cadence | null;
  /**
   * The doc caps how many times this session appears in ONE training cycle
   * ("1× per training cycle", "2–3× per marathon cycle"). Absent where it does
   * not. The selector honours it without translating "a cycle" into a number of
   * days, because the doc never states that translation.
   */
  perCycleMax?: number;
  /** Distances this workout is named for. All five where the doc does not narrow it. */
  distances: DistCategory[];
  /** Phases from §15 plus the workout's own "When in cycle" row. */
  phases: DoctrinePhase[];
  /** Tiers, from the Contraindications row. Everyone where the doc is silent. */
  tiers: Tier[];
  /** Verbatim-ish quotes of the rows the numbers above were read out of. */
  cites: string[];
  /**
   * Anything in this entry the doc does NOT state and this module supplies.
   * A field here is a CONVENTION, not a research finding. Empty for most
   * entries; never used to launder a guess into a citation.
   */
  conventions?: string[];
}
