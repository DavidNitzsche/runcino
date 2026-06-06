/**
 * biological-sex.ts · canonical resolution + write for biological sex.
 *
 * Single source of truth so iPhone, web, and watch all see the same
 * value for the same user. Gates menstrual cycle ingest, cycle-phase
 * tile rendering, and any future sex-specific physiological adjustment
 * (Research/13 §sex-specific training).
 *
 * Schema reality: two tables store sex, unconstrained, inconsistent casing.
 * (runner_profile is gone — dropped Cluster 2 DDL 2026-06-05.)
 *
 *   users.sex   = "M"     ← legacy column on users table
 *   profile.sex = "Male"  ← rich profile table, edited via web settings
 *
 * Resolution order (first non-empty wins):
 *   1. profile.sex     · canonical for new writes · settings UI source
 *   2. users.sex       · legacy fallback
 *   3. 'not_specified' · cold-start default
 *
 * Normalization (text → enum):
 *   · female / Female / F / f / woman / W → 'female'
 *   · male   / Male   / M / m / man   / M → 'male'
 *   · everything else (incl. null/empty)  → 'not_specified'
 *
 * Writes go to all three places so a settings edit propagates regardless
 * of which table downstream code reads.
 */
import { pool } from '@/lib/db/pool';

export type BiologicalSex = 'female' | 'male' | 'not_specified';

/** Normalize free-text input from any of the legacy fields into the enum. */
export function normalizeSex(raw: string | null | undefined): BiologicalSex {
  if (raw == null) return 'not_specified';
  const s = String(raw).trim().toLowerCase();
  if (s === '') return 'not_specified';
  if (s === 'female' || s === 'f' || s === 'woman') return 'female';
  if (s === 'male'   || s === 'm' || s === 'man')   return 'male';
  // 'other', 'non-binary', 'prefer-not-to-say', 'intersex', etc. all map
  // to 'not_specified' for our purposes · the engine never assumes
  // biology beyond the female/male binary. The user identity itself
  // is whatever they say it is · this enum only governs cycle-phase
  // and HRV-adjustment surfaces gated by biological sex.
  return 'not_specified';
}

/**
 * Resolve the canonical biological sex for a user.
 *
 * Generic mechanism · no hardcoded values · works for any user.
 */
export async function loadBiologicalSex(userId: string): Promise<BiologicalSex> {
  const r = await pool.query<{ profile_sex: string | null; users_sex: string | null }>(
    `SELECT p.sex AS profile_sex, u.sex AS users_sex
       FROM users u
       LEFT JOIN profile p ON p.user_uuid = u.id
      WHERE u.id = $1
      LIMIT 1`,
    [userId],
  );
  const row = r.rows[0];
  if (!row) return 'not_specified';

  // Try each source in priority order. First normalized non-'not_specified' wins.
  for (const raw of [row.profile_sex, row.users_sex]) {
    const norm = normalizeSex(raw);
    if (norm !== 'not_specified') return norm;
  }
  return 'not_specified';
}

/**
 * Write biological sex to both storage sites. Respects the legacy
 * `users.sex` CHECK constraint (only accepts 'M' | 'F' | NULL) by
 * storing the short form there · profile.sex carries the long form
 * for the settings UI. loadBiologicalSex normalizes either on read.
 *
 * Idempotent · safe to call repeatedly.
 */
export async function setBiologicalSex(userId: string, value: BiologicalSex): Promise<void> {
  const usersStored = value === 'female' ? 'F' : value === 'male' ? 'M' : null;
  const profileStored = value === 'not_specified' ? null : value;
  await Promise.allSettled([
    pool.query(`UPDATE users SET sex = $1 WHERE id = $2`, [usersStored, userId]),
    pool.query(`UPDATE profile SET sex = $1 WHERE user_uuid = $2::uuid`, [profileStored, userId]),
  ]);
}

/**
 * Convenience predicate · gates cycle-phase ingest + tile rendering.
 *
 * Returns true ONLY when the runner has explicitly said female. Default
 * 'not_specified' returns false · we never assume biology.
 */
export async function isFemaleRunner(userId: string): Promise<boolean> {
  return (await loadBiologicalSex(userId)) === 'female';
}
