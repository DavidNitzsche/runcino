/**
 * lib/shoe/gear-match.ts · match a Strava `gear` object to a row in the
 * runner's `shoes` table. Extracted verbatim from pullSync.ts so the
 * Strava pull path AND the ingest-time auto-assign hook share ONE gear
 * matcher (no third copy · cf. CLAUDE.md Rule 6 / Audit B2 input-dup).
 *
 * Strava ships gear as `{ name, nickname }` on the activity and
 * `{ brand_name, model_name }` on the detailed gear object · we read
 * every shape and fall back across them. Returns the shoe id or null.
 */
import { pool } from '@/lib/db/pool';

export async function matchShoeByGear(args: {
  userUuid: string;
  gear: unknown;
}): Promise<number | null> {
  const { userUuid, gear } = args;
  if (!gear || typeof gear !== 'object') return null;
  const g = gear as Record<string, unknown>;
  const brand = String(g.brand_name ?? g.brand ?? '').trim();
  const model = String(g.model_name ?? g.model ?? g.name ?? '').trim();
  if (!brand && !model) return null;
  if (brand && model) {
    const exact = (await pool.query<{ id: number }>(
      `SELECT id FROM shoes WHERE user_uuid = $1 AND retired = false
         AND LOWER(brand) = LOWER($2) AND LOWER(model) = LOWER($3) LIMIT 1`,
      [userUuid, brand, model],
    )).rows[0];
    if (exact) return exact.id;
    const loose = (await pool.query<{ id: number }>(
      `SELECT id FROM shoes WHERE user_uuid = $1 AND retired = false
         AND LOWER(brand) = LOWER($2)
         AND (LOWER(model) LIKE '%' || LOWER($3) || '%' OR LOWER($3) LIKE '%' || LOWER(model) || '%')
         LIMIT 1`,
      [userUuid, brand, model],
    )).rows[0];
    if (loose) return loose.id;
  }
  return null;
}
