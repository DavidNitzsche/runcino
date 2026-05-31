/**
 * workout-library · the shared L2 workout catalog reader.
 *
 * Replaces the hardcoded prescription strings that used to live inline in
 * lib/plan/generate.ts. Reads from the workout_library table seeded from
 * Research/04-workout-vocabulary.md + Research/22-plan-templates.md.
 *
 * The library is doctrine — the same rows are visible to every user.
 * Per-runner customization is a follow-up (workout_library_overrides
 * keyed by user_uuid). Today every runner gets the canonical doctrine.
 *
 * Caching:
 *   Templates are static doctrine — they change only when someone reruns
 *   _seed_workout_library.mjs. We memo all active rows in-process for a
 *   long TTL (10 min) to keep plan-generation fast. Pass { fresh: true }
 *   to bypass the cache after a re-seed.
 *
 * Fallback:
 *   pickWorkout() never throws. If the DB read fails or returns nothing,
 *   it returns null and the caller falls back to its inline default.
 *   Plan generation must never block on a missing template.
 */
import { pool } from '@/lib/db/pool';

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
  /** {miles_lo, miles_hi} parsed from numrange */
  distanceMi: { lo: number | null; hi: number | null } | null;
  /** {min_lo, min_hi} parsed from int4range */
  durationMin: { lo: number | null; hi: number | null } | null;
  frequencyMaxPerWeek: number;
  /** Machine-readable recipe — varies by family. */
  structure: Record<string, unknown>;
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

interface RawRow {
  id: number;
  slug: string;
  name: string;
  family: WorkoutFamily;
  distance_focus: string[];
  phase_fit: string[];
  level_fit: string[];
  pace_zones: string[];
  is_quality: boolean;
  is_long: boolean;
  typical_distance_mi: string | null;
  typical_duration_min: string | null;
  frequency_max_per_week: number;
  structure: Record<string, unknown>;
  prescription_text: string;
  notes: string | null;
  warmup_cooldown: string | null;
  citation: string;
}

// ── Cache ────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
let _cache: { rows: WorkoutTemplate[]; loadedAt: number } | null = null;

/** Drop the in-process cache. Call after _seed_workout_library.mjs. */
export function bustWorkoutLibraryCache(): void {
  _cache = null;
}

function parseRangeNum(rng: string | null): { lo: number | null; hi: number | null } | null {
  if (!rng) return null;
  // Postgres numrange / int4range textual form: '[lo,hi]' or '[lo,hi)' etc.
  const m = rng.match(/^([\[(])\s*([-\d.]*)\s*,\s*([-\d.]*)\s*([\])])$/);
  if (!m) return null;
  const lo = m[2] === '' ? null : Number(m[2]);
  const hi = m[3] === '' ? null : Number(m[3]);
  return { lo, hi };
}

function toTemplate(r: RawRow): WorkoutTemplate {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    family: r.family,
    distanceFocus: r.distance_focus ?? [],
    phaseFit: r.phase_fit ?? [],
    levelFit: r.level_fit ?? [],
    paceZones: r.pace_zones ?? [],
    isQuality: r.is_quality,
    isLong: r.is_long,
    distanceMi: parseRangeNum(r.typical_distance_mi),
    durationMin: parseRangeNum(r.typical_duration_min),
    frequencyMaxPerWeek: r.frequency_max_per_week,
    structure: r.structure ?? {},
    prescriptionText: r.prescription_text,
    notes: r.notes,
    warmupCooldown: r.warmup_cooldown,
    citation: r.citation,
  };
}

/**
 * Load all active templates. Used internally; exposed for diagnostics.
 * Returns [] on any DB error so plan generation never blocks.
 */
export async function loadAllWorkouts(opts: { fresh?: boolean } = {}): Promise<WorkoutTemplate[]> {
  const now = Date.now();
  if (!opts.fresh && _cache && now - _cache.loadedAt < CACHE_TTL_MS) {
    return _cache.rows;
  }
  try {
    const res = await pool.query<RawRow>(
      `SELECT id, slug, name, family, distance_focus, phase_fit, level_fit,
              pace_zones, is_quality, is_long,
              typical_distance_mi::text  AS typical_distance_mi,
              typical_duration_min::text AS typical_duration_min,
              frequency_max_per_week,
              structure, prescription_text, notes, warmup_cooldown, citation
         FROM workout_library
        WHERE active`
    );
    const rows = res.rows.map(toTemplate);
    _cache = { rows, loadedAt: now };
    return rows;
  } catch {
    // Table missing (pre-migration) or DB down — let callers fall back.
    return _cache?.rows ?? [];
  }
}

/** Match a template against the supplied filters. */
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
 * regeneration is reproducible. To vary, callers can pass {slug} or
 * iterate `findWorkouts()` themselves.
 */
export async function pickWorkout(args: PickArgs): Promise<WorkoutTemplate | null> {
  const all = await loadAllWorkouts();
  const candidates = all.filter((t) => matches(t, args));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.id - b.id);
  return candidates[0]!;
}

/** Return every matching template (lowest id first). */
export async function findWorkouts(args: PickArgs): Promise<WorkoutTemplate[]> {
  const all = await loadAllWorkouts();
  return all.filter((t) => matches(t, args)).sort((a, b) => a.id - b.id);
}

/** Diagnostic: count rows by family, for the data-architecture HTML doc. */
export async function workoutLibraryStats(): Promise<Record<string, number>> {
  const all = await loadAllWorkouts();
  const out: Record<string, number> = {};
  for (const t of all) out[t.family] = (out[t.family] ?? 0) + 1;
  return out;
}
