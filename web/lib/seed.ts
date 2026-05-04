/**
 * Seed durable race data on first visit.
 *
 * Big Sur 2026-04-26 and Sombrero 2026-05-03 are real races David
 * actually ran. Their pre-built race plans live in web/public/ as
 * .runcino.json + .gpx pairs and get pulled into localStorage on
 * first load — so cleared browser data, a different machine, a fresh
 * deploy never wipes them.
 *
 * Once Strava OAuth lands (M2), real activity data fills in
 * actualResult + actualSplits per race; pre-race plans stay
 * untouched so the plan-vs-actual retrospective loop can compare
 * what was strategized against what was executed.
 *
 * Idempotent — checks the seeded flag and per-slug existence before
 * writing. User edits or deletions stick: deleted seeds don't auto-
 * regenerate, edited results aren't overwritten.
 */

import { getRace, saveRace, type SavedRace } from './storage';
import type { RuncinoPlan } from './types';

const SEEDED_FLAG = 'runcino:seeded:v1';

interface SeedSpec {
  slug: string;
  planUrl: string;     // path under /public to the pre-built .runcino.json
  gpxUrl: string;      // path under /public to the bundled GPX
  meta: SavedRace['meta'];
}

const SEEDS: SeedSpec[] = [
  {
    slug: 'big-sur-marathon',
    planUrl: '/big-sur-3-50.runcino.json',
    gpxUrl:  '/sample-bigsur.gpx',
    meta: {
      name: 'Big Sur Marathon',
      date: '2026-04-26',
      distanceMi: 26.2,
      goalDisplay: '3:50:00',
      courseSlug: 'big-sur-marathon',
    },
  },
  {
    slug: 'sombrero-half',
    planUrl: '/sombrero-half-1-32.runcino.json',
    gpxUrl:  '/sample-sombrero.gpx',
    meta: {
      name: 'Sombrero Half Marathon',
      date: '2026-05-03',
      distanceMi: 13.16,
      goalDisplay: '1:32:00',
      courseSlug: 'sombrero-half',
    },
  },
];

/** Async because each seed pulls JSON + GPX from /public via fetch.
 *  Safe to call on every page mount — short-circuits if already done. */
export async function seedIfNeeded(): Promise<{ added: string[] }> {
  if (typeof window === 'undefined') return { added: [] };
  if (window.localStorage.getItem(SEEDED_FLAG) === 'true') return { added: [] };

  const added: string[] = [];
  for (const seed of SEEDS) {
    if (getRace(seed.slug)) continue; // user already has this race; skip
    try {
      const [planRes, gpxRes] = await Promise.all([
        fetch(seed.planUrl, { cache: 'force-cache' }),
        fetch(seed.gpxUrl,  { cache: 'force-cache' }),
      ]);
      if (!planRes.ok || !gpxRes.ok) continue;
      const plan = (await planRes.json()) as RuncinoPlan;
      const gpxText = await gpxRes.text();
      const race: SavedRace = {
        slug: seed.slug,
        plan,
        gpxText,
        savedAt: new Date().toISOString(),
        meta: seed.meta,
        actualResult: null,
      };
      saveRace(race);
      added.push(seed.slug);
    } catch {
      // Leave the seeded flag unset so we retry on next mount.
      return { added };
    }
  }

  window.localStorage.setItem(SEEDED_FLAG, 'true');
  return { added };
}
