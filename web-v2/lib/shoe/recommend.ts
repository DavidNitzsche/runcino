/**
 * Shoe recommender — pick the best active shoe from the runner's garage
 * for a given workout type. Ported from legacy/web/lib/shoe-utils.ts.
 *
 * Rule (per audit clarification 2026-05-30): "the coach/system auto
 * recommends shoes for each run based on what you have." Not Strava.
 *
 * Logic:
 *   1. Filter to active (non-retired) shoes.
 *   2. Prefer an exact run_types match (e.g. shoe tagged "tempo" for a
 *      tempo workout).
 *   3. Fall back to any shoe tagged "as_needed" if no exact match.
 *   4. Return null if no candidate (caller decides the placeholder).
 *
 * Tie-break: lowest mileage among equals. Spreading wear across the
 * rotation matches what every coach actually says about training shoes.
 */
export type ShoeRunType =
  | 'race'
  | 'long'
  | 'easy'
  | 'recovery'
  | 'tempo'
  | 'intervals'
  | 'as_needed';

export interface GarageShoe {
  id: string | number;
  name?: string;
  brand: string;
  model: string;
  runTypes: string[];     // string[] for compat with profile-state shape
  mileage: number;
  cap?: number | null;
  preferred?: boolean | null;
  retired?: boolean;
}

/** Best active shoe for the given run type, or null. */
export function recommendShoe(shoes: GarageShoe[], runType: ShoeRunType): GarageShoe | null {
  const active = shoes.filter((s) => !s.retired);
  if (active.length === 0) return null;
  const wants = String(runType).toLowerCase();
  const tagged = (s: GarageShoe, tag: string) =>
    (s.runTypes ?? []).some((t) => String(t).toLowerCase() === tag);
  const byLowestMileage = (a: GarageShoe, b: GarageShoe) => (a.mileage ?? 0) - (b.mileage ?? 0);

  // Exact tag match — prefer lowest mileage to spread the rotation.
  const exact = active.filter((s) => tagged(s, wants)).sort(byLowestMileage);
  if (exact.length > 0) return exact[0];

  // Fallback: any "as_needed" shoe.
  const fallback = active.filter((s) => tagged(s, 'as_needed')).sort(byLowestMileage);
  if (fallback.length > 0) return fallback[0];

  // Last resort: lowest-mileage preferred shoe, then lowest mileage overall.
  const preferred = active.filter((s) => s.preferred).sort(byLowestMileage);
  if (preferred.length > 0) return preferred[0];

  return active.slice().sort(byLowestMileage)[0] ?? null;
}

/** Human-friendly name for a recommended shoe. */
export function shoeDisplayName(s: GarageShoe | null): string | null {
  if (!s) return null;
  return (s.name && s.name.trim()) || `${s.brand} ${s.model}`.trim();
}

/**
 * Map a plan_workouts.type to a ShoeRunType. The plan vocabulary is wider
 * and inconsistent (`interval` vs `intervals`, `threshold`, `shakeout`,
 * `race_week_tuneup`) — a naive pass-through fails the exact run_types
 * match and dumps everything into `as_needed`. No planned workout
 * (unplanned/rest-day run) → 'easy'.
 *
 * Lives here (pure, no server deps) so BOTH the ingest hook
 * (lib/shoe/auto-assign.ts) and the client run-detail picker
 * (components/runs/RunDetailModal.tsx) share one mapper.
 */
const PLAN_TO_SHOE: Record<string, ShoeRunType> = {
  easy: 'easy',
  recovery: 'recovery',
  shakeout: 'recovery',
  long: 'long',
  tempo: 'tempo',
  threshold: 'tempo',
  race_week_tuneup: 'tempo',
  interval: 'intervals',
  intervals: 'intervals',
  vo2max: 'intervals',
  race: 'race',
};

export function planTypeToShoeType(t: string | null | undefined): ShoeRunType {
  if (!t) return 'easy';
  return PLAN_TO_SHOE[t.trim().toLowerCase()] ?? 'easy';
}
