import { query } from './db';

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
  retired: boolean;
  notes: string | null;
  created_at: string;
}

export interface ShoeInput {
  brand: string;
  model: string;
  color?: string;
  run_types: RunType[];
  mileage?: number;
  mileage_cap?: number;
  notes?: string;
}

export async function listShoes(): Promise<Shoe[]> {
  return query<Shoe>(
    `SELECT id, brand, model, color, run_types, mileage::float AS mileage,
            mileage_cap::float AS mileage_cap, retired, notes, created_at
     FROM shoes ORDER BY retired ASC, created_at ASC`,
  );
}

export async function getShoe(id: number): Promise<Shoe | null> {
  const rows = await query<Shoe>(
    `SELECT id, brand, model, color, run_types, mileage::float AS mileage,
            mileage_cap::float AS mileage_cap, retired, notes, created_at
     FROM shoes WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function createShoe(input: ShoeInput): Promise<Shoe> {
  const rows = await query<Shoe>(
    `INSERT INTO shoes (brand, model, color, run_types, mileage, mileage_cap, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, brand, model, color, run_types, mileage::float AS mileage,
               mileage_cap::float AS mileage_cap, retired, notes, created_at`,
    [
      input.brand,
      input.model,
      input.color ?? null,
      input.run_types,
      input.mileage ?? 0,
      input.mileage_cap ?? null,
      input.notes ?? null,
    ],
  );
  return rows[0];
}

export async function updateShoe(
  id: number,
  patch: Partial<ShoeInput & { retired: boolean; mileage: number }>,
): Promise<Shoe | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (patch.brand !== undefined)       { fields.push(`brand = $${idx++}`);       values.push(patch.brand); }
  if (patch.model !== undefined)       { fields.push(`model = $${idx++}`);       values.push(patch.model); }
  if (patch.color !== undefined)       { fields.push(`color = $${idx++}`);       values.push(patch.color); }
  if (patch.run_types !== undefined)   { fields.push(`run_types = $${idx++}`);   values.push(patch.run_types); }
  if (patch.mileage !== undefined)     { fields.push(`mileage = $${idx++}`);     values.push(patch.mileage); }
  if (patch.mileage_cap !== undefined) { fields.push(`mileage_cap = $${idx++}`); values.push(patch.mileage_cap); }
  if (patch.retired !== undefined)     { fields.push(`retired = $${idx++}`);     values.push(patch.retired); }
  if (patch.notes !== undefined)       { fields.push(`notes = $${idx++}`);       values.push(patch.notes); }

  if (fields.length === 0) return getShoe(id);

  values.push(id);
  const rows = await query<Shoe>(
    `UPDATE shoes SET ${fields.join(', ')}
     WHERE id = $${idx}
     RETURNING id, brand, model, color, run_types, mileage::float AS mileage,
               mileage_cap::float AS mileage_cap, retired, notes, created_at`,
    values,
  );
  return rows[0] ?? null;
}

/** Add miles to a shoe (called after run assignment). */
export async function addMileage(shoeId: number, miles: number): Promise<void> {
  await query(
    `UPDATE shoes SET mileage = mileage + $1 WHERE id = $2`,
    [miles, shoeId],
  );
}

/** Recommend the best active shoe for a given run type. */
export function recommendShoe(shoes: Shoe[], runType: RunType): Shoe | null {
  const active = shoes.filter(s => !s.retired);

  // Exact match on run type
  const exact = active.filter(s => s.run_types.includes(runType));
  if (exact.length > 0) return exact[0];

  // Fallback: as_needed shoe
  const fallback = active.filter(s => s.run_types.includes('as_needed'));
  if (fallback.length > 0) return fallback[0];

  return null;
}

/** Map a Strava workout_type or activity name to a RunType. */
export function inferRunType(workoutType: number | null | undefined, name: string): RunType {
  // Strava workout_type: 1 = race, 2 = long run, 3 = workout
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

/** Default shoe rotation — seeded on first boot if shoes table is empty. */
export const DEFAULT_SHOES: ShoeInput[] = [
  {
    brand: 'New Balance',
    model: 'SC Trainer v3',
    color: 'White',
    run_types: ['race'],
    mileage_cap: 300,
    notes: 'Race shoe',
  },
  {
    brand: 'Asics',
    model: 'Superblast 3',
    color: 'White',
    run_types: ['long', 'easy'],
    mileage_cap: 500,
    notes: 'Long runs and easy days',
  },
  {
    brand: 'Asics',
    model: 'Novablast 5',
    color: 'Black',
    run_types: ['recovery'],
    mileage_cap: 400,
    notes: 'Recovery runs',
  },
  {
    brand: 'Nike',
    model: 'Zoom Fly 6',
    color: 'Black',
    run_types: ['tempo', 'intervals'],
    mileage_cap: 400,
    notes: 'Tempo and quality sessions',
  },
  {
    brand: 'Nike',
    model: 'Vomero Plus',
    color: 'Gray',
    run_types: ['as_needed'],
    mileage_cap: 500,
    notes: 'As needed',
  },
];
