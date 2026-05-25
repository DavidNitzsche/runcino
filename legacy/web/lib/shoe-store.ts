import { query } from './db';
export type { RunType, Shoe } from './shoe-utils';
export { recommendShoe, inferRunType } from './shoe-utils';
import type { RunType, Shoe } from './shoe-utils';

const SHOE_COLS = `id, brand, model, color, run_types,
  mileage::float AS mileage, mileage_cap::float AS mileage_cap,
  preferred, retired, notes, created_at`;

export interface ShoeInput {
  brand: string;
  model: string;
  color?: string;
  run_types: RunType[];
  mileage?: number;
  mileage_cap?: number;
  preferred?: boolean;
  notes?: string;
}

export async function listShoes(): Promise<Shoe[]> {
  return query<Shoe>(
    `SELECT ${SHOE_COLS} FROM shoes ORDER BY retired ASC, preferred DESC, created_at ASC`,
  );
}

export async function getShoe(id: number): Promise<Shoe | null> {
  const rows = await query<Shoe>(
    `SELECT ${SHOE_COLS} FROM shoes WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function createShoe(input: ShoeInput): Promise<Shoe> {
  const rows = await query<Shoe>(
    `INSERT INTO shoes (brand, model, color, run_types, mileage, mileage_cap, preferred, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${SHOE_COLS}`,
    [
      input.brand,
      input.model,
      input.color ?? null,
      input.run_types,
      input.mileage ?? 0,
      input.mileage_cap ?? null,
      input.preferred ?? true,
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
  if (patch.preferred !== undefined)   { fields.push(`preferred = $${idx++}`);   values.push(patch.preferred); }
  if (patch.retired !== undefined)     { fields.push(`retired = $${idx++}`);     values.push(patch.retired); }
  if (patch.notes !== undefined)       { fields.push(`notes = $${idx++}`);       values.push(patch.notes); }

  if (fields.length === 0) return getShoe(id);

  values.push(id);
  const rows = await query<Shoe>(
    `UPDATE shoes SET ${fields.join(', ')}
     WHERE id = $${idx}
     RETURNING ${SHOE_COLS}`,
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

/** Default shoe rotation, seeded on first boot if shoes table is empty. */
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
