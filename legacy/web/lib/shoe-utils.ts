export type RunType =
  | 'race'
  | 'long'
  | 'easy'
  | 'recovery'
  | 'tempo'
  | 'intervals'
  | 'as_needed';

export interface Shoe {
  id: number;
  brand: string;
  model: string;
  color: string | null;
  run_types: RunType[];
  mileage: number;
  mileage_cap: number | null;
  preferred: boolean;
  retired: boolean;
  notes: string | null;
  created_at: string;
}

/** Recommend the best active shoe for a given run type. */
export function recommendShoe(shoes: Shoe[], runType: RunType): Shoe | null {
  const active = shoes.filter(s => !s.retired);
  const exact = active.filter(s => s.run_types.includes(runType));
  if (exact.length > 0) return exact[0];
  const fallback = active.filter(s => s.run_types.includes('as_needed'));
  if (fallback.length > 0) return fallback[0];
  return null;
}

/** Map a Strava workout_type or activity name to a RunType. */
export function inferRunType(workoutType: number | null | undefined, name: string): RunType {
  if (workoutType === 1) return 'race';
  if (workoutType === 2) return 'long';
  if (workoutType === 3) {
    const n = name.toLowerCase();
    if (n.includes('tempo') || n.includes('threshold')) return 'tempo';
    if (n.includes('interval') || n.includes('track') || n.includes('repeat')) return 'intervals';
    return 'tempo';
  }
  const n = name.toLowerCase();
  if (n.includes('recovery') || n.includes('shakeout')) return 'recovery';
  if (n.includes('long') || n.includes('lsd')) return 'long';
  if (n.includes('tempo') || n.includes('threshold')) return 'tempo';
  if (n.includes('interval') || n.includes('track')) return 'intervals';
  if (n.includes('race') || n.includes('marathon') || n.includes('half') || n.includes('10k') || n.includes('5k')) return 'race';
  return 'easy';
}
