/**
 * localStorage CRUD for built race plans.
 *
 * The contract here is intentionally narrow: a "saved race" is one
 * `.runcino.json` payload + a copy of the GPX text + a few derived
 * meta fields used by the index page (so it can render a card without
 * re-parsing the GPX). Everything is stored under a single key as a
 * JSON-encoded map keyed by slug.
 *
 * This is the M0 persistence layer — when iCloud sync ships, this
 * gets replaced with a thin adapter that round-trips the same shape
 * to/from disk via the iOS app's shared container. The schema stays
 * identical so consumers (the /races index, the detail page) don't
 * need to change.
 */

import type { RuncinoPlan } from './types';

const STORAGE_KEY = 'runcino:races:v1';

export interface ActualResult {
  /** Finish time in seconds. */
  finishS: number;
  /** Pre-formatted "1:32:14" for display. */
  finishDisplay: string;
  /** Average pace in seconds per mile (computed from finishS / distance). */
  paceSPerMi: number;
  /** "7:01" formatted pace. */
  paceDisplay: string;
  /** Optional placement (rank). */
  place?: number | null;
  /** Optional field size. */
  fieldSize?: number | null;
  /** True if user marked this as a PR for the distance. */
  isPR?: boolean;
  /** Free-text notes from after the race. */
  notes?: string;
  /** ISO timestamp when the result was saved. */
  recordedAt: string;
}

export interface SavedRace {
  /** URL-safe slug, used as the route param at /races/[slug]. */
  slug: string;
  /** Full .runcino.json payload as built by /api/build-plan. */
  plan: RuncinoPlan;
  /** Original GPX text — kept so the detail page can re-render the
   *  map and elevation curve without round-tripping through the API. */
  gpxText: string;
  /** ISO timestamp when this entry was saved (most recent edit). */
  savedAt: string;
  /** UI-only convenience copies derived at save time. */
  meta: {
    name: string;
    date: string;            // YYYY-MM-DD
    distanceMi: number;
    goalDisplay: string;
    courseSlug: string;      // registered slug or custom slug
  };
  /** Actual race result, populated post-race. Null until the runner
   *  enters their time. M2 will auto-fill from Strava when the
   *  Strava activity matching this date lands. */
  actualResult?: ActualResult | null;
}

type StoredMap = Record<string, SavedRace>;

function readAll(): StoredMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as StoredMap) : {};
  } catch {
    return {};
  }
}

function writeAll(map: StoredMap): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

export function listRaces(): SavedRace[] {
  const map = readAll();
  return Object.values(map).sort((a, b) => {
    // Upcoming first (closest to today), then past races by recency.
    const today = Date.now();
    const aT = Date.parse(a.meta.date);
    const bT = Date.parse(b.meta.date);
    const aFuture = aT >= today;
    const bFuture = bT >= today;
    if (aFuture !== bFuture) return aFuture ? -1 : 1;
    return aFuture ? aT - bT : bT - aT;
  });
}

export function getRace(slug: string): SavedRace | null {
  return readAll()[slug] ?? null;
}

export function saveRace(race: SavedRace): void {
  const map = readAll();
  map[race.slug] = { ...race, savedAt: new Date().toISOString() };
  writeAll(map);
}

/** Update only the actualResult field — used by the post-race form on
 *  the detail page. Safer than full saveRace because it preserves the
 *  plan + gpxText untouched. */
export function setActualResult(slug: string, result: ActualResult | null): void {
  const map = readAll();
  const existing = map[slug];
  if (!existing) return;
  map[slug] = { ...existing, actualResult: result, savedAt: new Date().toISOString() };
  writeAll(map);
}

export function deleteRace(slug: string): void {
  const map = readAll();
  delete map[slug];
  writeAll(map);
}

/** Slugify a free-text race name. Falls back to a timestamp suffix on
 *  collision so two races with the same name never overwrite each other. */
export function slugifyRaceName(name: string, taken: Set<string> = new Set()): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'race';
  if (!taken.has(base)) return base;
  // Collision — suffix with year if present, else with a short hash.
  const year = new Date().getFullYear();
  if (!taken.has(`${base}-${year}`)) return `${base}-${year}`;
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}
