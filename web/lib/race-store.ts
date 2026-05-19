/**
 * Server-side race CRUD against Postgres. The single source of truth
 * for race plans + actual results. Replaces the old localStorage path
 * — clients now go through /api/races and /api/races/[slug].
 *
 * Schema: see lib/db.ts (`races` table).
 */

import { query } from './db';
import type { SavedRace, ActualResult } from './storage-types';

interface DBRow {
  slug: string;
  plan: SavedRace['plan'];
  gpx_text: string;
  meta: SavedRace['meta'];
  actual_result: ActualResult | null;
  saved_at: Date;
}

function toSaved(row: DBRow): SavedRace {
  return {
    slug: row.slug,
    plan: row.plan,
    gpxText: row.gpx_text,
    meta: row.meta,
    actualResult: row.actual_result ?? null,
    savedAt: row.saved_at instanceof Date ? row.saved_at.toISOString() : String(row.saved_at),
  };
}

/** List races, optionally scoped to a user.
 *
 *  Multi-tenant pattern matches strava_activities/shoes: when userId
 *  is supplied, returns rows where user_uuid matches OR user_uuid is
 *  NULL (un-migrated legacy rows still visible — no regression).
 *  Without userId, returns all races (admin/backwards-compat). */
export async function listRacesDB(userId?: string): Promise<SavedRace[]> {
  const rows = userId
    ? await query<DBRow>(
        `SELECT slug, plan, gpx_text, meta, actual_result, saved_at
           FROM races
          WHERE user_uuid = $1 OR user_uuid IS NULL`,
        [userId],
      )
    : await query<DBRow>('SELECT slug, plan, gpx_text, meta, actual_result, saved_at FROM races');
  return rows.map(toSaved).sort((a, b) => {
    const today = Date.now();
    const aT = Date.parse(a.meta.date);
    const bT = Date.parse(b.meta.date);
    const aFuture = aT >= today;
    const bFuture = bT >= today;
    if (aFuture !== bFuture) return aFuture ? -1 : 1;
    return aFuture ? aT - bT : bT - aT;
  });
}

export async function getRaceDB(slug: string, userId?: string): Promise<SavedRace | null> {
  const rows = userId
    ? await query<DBRow>(
        `SELECT slug, plan, gpx_text, meta, actual_result, saved_at
           FROM races
          WHERE slug = $1 AND (user_uuid = $2 OR user_uuid IS NULL)`,
        [slug, userId],
      )
    : await query<DBRow>('SELECT slug, plan, gpx_text, meta, actual_result, saved_at FROM races WHERE slug = $1', [slug]);
  return rows[0] ? toSaved(rows[0]) : null;
}

export async function saveRaceDB(race: SavedRace, userId?: string): Promise<void> {
  await query(
    `INSERT INTO races (slug, plan, gpx_text, meta, actual_result, saved_at, user_uuid)
     VALUES ($1, $2::jsonb, $3, $4::jsonb, $5::jsonb, NOW(), $6)
     ON CONFLICT (slug) DO UPDATE SET
       plan = EXCLUDED.plan,
       gpx_text = EXCLUDED.gpx_text,
       meta = EXCLUDED.meta,
       actual_result = EXCLUDED.actual_result,
       saved_at = NOW(),
       user_uuid = COALESCE(races.user_uuid, EXCLUDED.user_uuid)`,
    [
      race.slug,
      JSON.stringify(race.plan),
      race.gpxText,
      JSON.stringify(race.meta),
      race.actualResult ? JSON.stringify(race.actualResult) : null,
      userId ?? null,
    ],
  );
}

export async function setActualResultDB(slug: string, result: ActualResult | null): Promise<void> {
  await query(
    'UPDATE races SET actual_result = $2::jsonb, saved_at = NOW() WHERE slug = $1',
    [slug, result ? JSON.stringify(result) : null],
  );
}

export async function deleteRaceDB(slug: string): Promise<void> {
  await query('DELETE FROM races WHERE slug = $1', [slug]);
}

/** Upsert race plan + GPX without touching actual_result. Used by the
 *  seed migration so re-seeding never wipes a saved Strava finish. */
export async function upsertPlanDB(race: Omit<SavedRace, 'actualResult'>): Promise<void> {
  await query(
    `INSERT INTO races (slug, plan, gpx_text, meta, saved_at)
     VALUES ($1, $2::jsonb, $3, $4::jsonb, NOW())
     ON CONFLICT (slug) DO UPDATE SET
       plan = EXCLUDED.plan,
       gpx_text = EXCLUDED.gpx_text,
       meta = EXCLUDED.meta,
       saved_at = NOW()`,
    [race.slug, JSON.stringify(race.plan), race.gpxText, JSON.stringify(race.meta)],
  );
}
