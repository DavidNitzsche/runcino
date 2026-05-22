/**
 * Server-side seed for the two real races (Big Sur 2026-04-26 +
 * Sombrero 2026-05-03). Replaces the old client-side localStorage
 * seed.
 *
 * On first /api/races call, reads the bundled .runcino.json + GPX
 * pairs out of web/public/, upserts the race plan into Postgres
 * without touching actual_result. Idempotent, a tracking row in
 * `strava_sync_state` keys off SEED_VERSION so re-deploys don't
 * pointlessly re-write rows, but a version bump WILL refresh the
 * plan + GPX (preserving actual_result).
 *
 * Seed version cadence:
 *   v1 → v2, 5-phase structure
 *   v2 → v3, Big Sur goal corrected from 3:50 → 3:40
 *   v3 → v4, Postgres migration; first server-side seed
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { query } from './db';
import { upsertPlanDB } from './race-store';
import type { FaffPlan } from './types';
import type { SavedRace } from './storage-types';

const SEED_VERSION = 'v4';

interface SeedSpec {
  slug: string;
  planFile: string;
  gpxFile: string;
  meta: SavedRace['meta'];
}

const SEEDS: SeedSpec[] = [
  {
    slug: 'big-sur-marathon',
    planFile: 'big-sur-3-40.runcino.json',
    gpxFile:  'sample-bigsur.gpx',
    meta: {
      name: 'Big Sur Marathon',
      date: '2026-04-26',
      distanceMi: 26.2,
      goalDisplay: '3:40:00',
      courseSlug: 'big-sur-marathon',
    },
  },
  {
    slug: 'sombrero-half',
    planFile: 'sombrero-half-1-32.runcino.json',
    gpxFile:  'sample-sombrero.gpx',
    meta: {
      name: 'Sombrero Half Marathon',
      date: '2026-05-03',
      distanceMi: 13.16,
      goalDisplay: '1:32:00',
      courseSlug: 'sombrero-half',
    },
  },
];

let seeded = false;
let seeding: Promise<void> | null = null;

export async function ensureSeed(): Promise<void> {
  if (seeded) return;
  if (seeding) return seeding;
  seeding = runSeed().then(() => { seeded = true; }).finally(() => { seeding = null; });
  return seeding;
}

async function runSeed(): Promise<void> {
  // Skip if we've already seeded this version. Recorded in
  // strava_sync_state (a generic key/value bag).
  const rows = await query<{ value: { version?: string } }>(
    `SELECT value FROM strava_sync_state WHERE key = 'seed_version'`,
  );
  if (rows[0]?.value?.version === SEED_VERSION) { seeded = true; return; }

  const publicDir = path.join(process.cwd(), 'public');
  for (const seed of SEEDS) {
    try {
      const [planJson, gpxText] = await Promise.all([
        fs.readFile(path.join(publicDir, seed.planFile), 'utf8'),
        fs.readFile(path.join(publicDir, seed.gpxFile), 'utf8'),
      ]);
      const plan = JSON.parse(planJson) as FaffPlan;
      await upsertPlanDB({
        slug: seed.slug,
        plan,
        gpxText,
        meta: seed.meta,
        savedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.error(`[seed-server] failed to seed ${seed.slug}:`, e);
      // Don't mark seeded if we couldn't read files, try again next request.
      return;
    }
  }

  await query(
    `INSERT INTO strava_sync_state (key, value, updated_at)
     VALUES ('seed_version', $1::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [JSON.stringify({ version: SEED_VERSION, seededAt: new Date().toISOString() })],
  );
}
