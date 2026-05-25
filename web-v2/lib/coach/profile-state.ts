/**
 * profile-state.ts
 * Identity + physiology (derived) + connections + preferences + shoes.
 */
import { pool } from '@/lib/db/pool';

export interface ProfileState {
  identity: { full_name: string | null; sex: string | null; age: number | null; city: string | null; height_cm: number | null };
  physiology: { max_hr: number | null; rhr: number | null; vo2: number | null; weight_lb: number | null };
  shoes: { id: string; name: string; brand: string; model: string; runTypes: string[]; mileage: number; cap: number; pctUsed: number; preferred: boolean | null; retired: boolean }[];
  nextARace: { slug: string; name: string; date: string; goal: string | null; days_to_race: number } | null;
}

export async function loadProfileState(userId: string): Promise<ProfileState> {
  const today = new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);

  const p = (await pool.query(
    `SELECT full_name, sex, age, city, height_cm, hrmax, rhr
       FROM profile
      WHERE user_uuid = $1 OR (user_uuid IS NULL AND user_id = 'me')
      ORDER BY (user_uuid = $1) DESC LIMIT 1`,
    [userId]
  )).rows[0];

  // Derived max HR + RHR from health_samples (fallback to profile cols)
  const mhrRow = (await pool.query(
    `SELECT MAX(value) AS m FROM health_samples WHERE user_id = $1 AND sample_type = 'hr'`,
    [userId]
  )).rows[0];
  const max_hr = mhrRow?.m ? Math.round(Number(mhrRow.m)) : (p?.hrmax ?? null);

  const rhrRow = (await pool.query(
    `SELECT AVG(value) AS a FROM health_samples
      WHERE user_id = $1 AND sample_type = 'resting_hr'
        AND recorded_at >= NOW() - interval '60 days'`,
    [userId]
  )).rows[0];
  const rhr = rhrRow?.a ? Math.round(Number(rhrRow.a)) : (p?.rhr ?? null);

  const vo2Row = (await pool.query(
    `SELECT value FROM health_samples WHERE user_id = $1 AND sample_type = 'vo2_max'
      ORDER BY recorded_at DESC LIMIT 1`,
    [userId]
  )).rows[0];
  const vo2 = vo2Row?.value ? +Number(vo2Row.value).toFixed(1) : null;

  const wRow = (await pool.query(
    `SELECT value FROM health_samples WHERE user_id = $1 AND sample_type = 'body_mass'
      ORDER BY sample_date DESC LIMIT 1`,
    [userId]
  )).rows[0];
  const weight_lb = wRow?.value ? +(Number(wRow.value) * 2.20462).toFixed(1) : null;

  // Shoes
  const shoes = (await pool.query(
    `SELECT id, brand, model, color, run_types, mileage, mileage_cap, retired, preferred
       FROM shoes
      WHERE user_uuid = $1 OR user_uuid IS NULL
      ORDER BY id`,
    [userId]
  )).rows.map((s: any) => {
    const m = Number(s.mileage) || 0;
    const cap = Number(s.mileage_cap) || 400;
    return {
      id: String(s.id),
      name: `${s.brand} ${s.model}`,
      brand: s.brand, model: s.model,
      runTypes: s.run_types ?? [],
      mileage: Math.round(m),
      cap, pctUsed: Math.round((m / cap) * 100),
      preferred: s.preferred,
      retired: !!s.retired,
    };
  });

  // Next A race for context (shoes-vs-race not surfaced unless flagged)
  const plan = (await pool.query(
    `SELECT race_id FROM training_plans WHERE (user_uuid = $1 OR user_id = 'me') AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [userId]
  )).rows[0];
  let nextARace: ProfileState['nextARace'] = null;
  if (plan?.race_id) {
    const raceRow = (await pool.query(`SELECT slug, meta FROM races WHERE slug = $1`, [plan.race_id])).rows[0];
    if (raceRow) {
      const date = raceRow.meta?.date;
      const days_to_race = Math.round((Date.parse(date + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 86400000);
      nextARace = { slug: raceRow.slug, name: raceRow.meta?.name, date, goal: raceRow.meta?.goalDisplay ?? null, days_to_race };
    }
  }

  return {
    identity: { full_name: p?.full_name ?? null, sex: p?.sex ?? null, age: p?.age ?? null, city: p?.city ?? null, height_cm: p?.height_cm ?? null },
    physiology: { max_hr, rhr, vo2, weight_lb },
    shoes: shoes.filter((s) => !s.retired),
    nextARace,
  };
}
