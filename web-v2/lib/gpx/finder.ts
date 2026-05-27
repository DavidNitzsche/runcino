/**
 * GPX finder (P46).
 *
 * Search canonical sources for a race course GPX. Deterministic API calls
 * — no LLM digging. Returns ranked candidates with source attribution so
 * the user can pick and import.
 *
 * Tier 1: Strava Routes (user's personal + starred routes via Routes API)
 *         — best signal: real runners upload race courses constantly.
 *         Auth: requires the user's Strava OAuth token (P39 ships this).
 *
 * Tier 2 (DEFERRED): Plotaroute search API — public route library, free-text
 *         search. Skipped in v1 because Plotaroute 403'd in testing and the
 *         API requires a paid plan for programmatic access.
 *
 * Tier 3 (manual fallback): The existing "+ COURSE GPX" upload button on
 *         /races/[slug] handles whatever neither tier covers.
 *
 * The finder returns candidates with:
 *   - source       — 'strava_route' | 'strava_starred'
 *   - sourceId     — Strava route id, used by /api/gpx/import
 *   - name         — route name as titled by uploader
 *   - distanceMi   — actual route distance
 *   - elevationGainFt
 *   - uploadedBy   — athlete name when available
 *   - uploadedAt   — ISO timestamp
 *   - confidence   — 0–1, derived from name match + distance match
 *   - mapImageUrl  — Strava-hosted preview (when available)
 */
import { getStravaToken } from '@/lib/strava/auth';

export interface GpxCandidate {
  source: 'strava_route' | 'strava_starred';
  sourceId: string;             // strava route id
  name: string;
  distanceMi: number;
  elevationGainFt: number | null;
  uploadedBy: string | null;
  uploadedAt: string | null;    // ISO
  confidence: number;           // 0–1
  mapImageUrl: string | null;
}

export interface FinderQuery {
  /** Free-text race name, e.g. "Americas Finest City Half" */
  q: string;
  /** Expected distance in miles, used for filtering + ranking. */
  expectedDistanceMi?: number;
  /** Distance tolerance in miles (default ±0.5 for half/marathon, ±0.1 for 5K). */
  toleranceMi?: number;
}

export async function findGpxCandidates(
  userId: string,
  query: FinderQuery
): Promise<{ candidates: GpxCandidate[]; sourcesAttempted: string[]; reason?: string }> {
  const sourcesAttempted: string[] = [];
  const all: GpxCandidate[] = [];

  // Tier 1: Strava Routes API
  try {
    sourcesAttempted.push('strava_routes');
    const stravaCandidates = await searchStravaRoutes(userId, query);
    all.push(...stravaCandidates);
  } catch (e: any) {
    if (e?.message === 'STRAVA_NOT_CONNECTED') {
      return {
        candidates: [],
        sourcesAttempted,
        reason: 'Strava not connected. Connect Strava on /profile to enable GPX search.',
      };
    }
    console.error('[gpx-finder] strava routes failed:', e?.message);
  }

  // Tier 2: Plotaroute — skipped in v1, see header.

  // Rank by confidence (descending), cap to 10.
  const ranked = all
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 10);

  return { candidates: ranked, sourcesAttempted };
}

/**
 * Search the user's Strava-connected route library. Strava's API exposes
 * routes the AUTHENTICATED USER has access to:
 *   - their own routes (created in Strava's route builder)
 *   - routes they starred (other people's routes they bookmarked)
 *
 * There is NO global "search all public routes" endpoint — Strava deliberately
 * doesn't expose that. So this works best when the runner has either:
 *   (a) Made or starred a route for the target race, OR
 *   (b) Joined the race's Strava club (and the club has posted routes)
 *
 * Endpoint: GET /api/v3/athletes/{id}/routes?per_page=200
 *           returns array of routes for the authenticated athlete.
 */
async function searchStravaRoutes(userId: string, query: FinderQuery): Promise<GpxCandidate[]> {
  const token = await getStravaToken(userId);

  // 1. Get authenticated athlete id (lightweight call).
  const meResp = await fetch('https://www.strava.com/api/v3/athlete', {
    headers: { 'Authorization': `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!meResp.ok) throw new Error(`strava /athlete failed: ${meResp.status}`);
  const me: any = await meResp.json();
  const athleteId = me.id;

  // 2. List the athlete's routes (own + starred).
  const routesResp = await fetch(
    `https://www.strava.com/api/v3/athletes/${athleteId}/routes?per_page=200`,
    {
      headers: { 'Authorization': `Bearer ${token}` },
      signal: AbortSignal.timeout(12000),
    }
  );
  if (!routesResp.ok) throw new Error(`strava /routes failed: ${routesResp.status}`);
  const routes: any[] = await routesResp.json();

  // 3. Filter + score each route against the query.
  const candidates: GpxCandidate[] = [];
  for (const r of routes) {
    const distanceMi = Number(r.distance) / 1609.344;
    const elevationGainFt = r.elevation_gain != null
      ? Math.round(Number(r.elevation_gain) * 3.28084)
      : null;

    const nameScore = nameMatchScore(r.name ?? '', query.q);
    const distScore = distanceMatchScore(distanceMi, query.expectedDistanceMi, query.toleranceMi);

    // Reject routes whose distance is wildly wrong — a 5K route isn't a
    // half marathon, no matter how well the name matches. Tolerance is
    // generous enough that ±0.5mi on a 13.1 still passes.
    if (query.expectedDistanceMi != null && distScore === 0) continue;
    // Reject routes whose name doesn't match at all — avoids "Saturday Run"
    // showing up when you searched for "Boston Marathon."
    if (nameScore < 0.15) continue;

    // Confidence: 60% name match + 40% distance match.
    const confidence = +(nameScore * 0.6 + distScore * 0.4).toFixed(2);

    candidates.push({
      source: r.athlete?.id === athleteId ? 'strava_route' : 'strava_starred',
      sourceId: String(r.id_str ?? r.id),
      name: r.name ?? 'Untitled route',
      distanceMi: +distanceMi.toFixed(2),
      elevationGainFt,
      uploadedBy: r.athlete
        ? [r.athlete.firstname, r.athlete.lastname].filter(Boolean).join(' ').trim() || null
        : null,
      uploadedAt: r.created_at ?? null,
      confidence,
      mapImageUrl: r.map?.summary_polyline
        ? null // we don't render a server-side map; iOS/web can polyline-decode if needed
        : null,
    });
  }

  return candidates;
}

/**
 * Score how well a route name matches the query. Returns 0–1.
 * Strategy: tokenize both, count overlapping tokens (case-insensitive),
 * divide by the query's token count. Bonus for exact substring match.
 */
function nameMatchScore(routeName: string, query: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const qTokens = norm(query);
  const rTokens = new Set(norm(routeName));
  if (qTokens.length === 0) return 0;

  const overlap = qTokens.filter((t) => rTokens.has(t)).length;
  const base = overlap / qTokens.length;

  // Bonus for exact substring (case-insensitive)
  const bonus = routeName.toLowerCase().includes(query.toLowerCase()) ? 0.2 : 0;
  return Math.min(1, base + bonus);
}

/**
 * Score how well a route's actual distance matches the expected race
 * distance. Returns 0–1. Without an expected distance, returns 0.5
 * (neutral) so we don't penalize routes we can't compare.
 */
function distanceMatchScore(
  actualMi: number,
  expectedMi: number | undefined,
  toleranceMi: number | undefined
): number {
  if (expectedMi == null) return 0.5;
  const tol = toleranceMi ?? autoTolerance(expectedMi);
  const delta = Math.abs(actualMi - expectedMi);
  if (delta > tol) return 0;
  // Linear falloff from 1 (perfect) to 0 (edge of tolerance).
  return +(1 - delta / tol).toFixed(2);
}

/**
 * Pick a sensible distance tolerance from the expected distance:
 *   5K  → ±0.10 mi
 *   10K → ±0.20 mi
 *   half → ±0.40 mi
 *   marathon → ±0.60 mi
 *   anything else → ±0.5 mi
 */
function autoTolerance(miles: number): number {
  if (miles < 4) return 0.10;
  if (miles < 8) return 0.20;
  if (miles < 16) return 0.40;
  if (miles < 30) return 0.60;
  return 0.5;
}

/**
 * Fetch the GPX file for a chosen route. Returns the raw GPX XML string.
 * The caller is responsible for parsing it (via lib/race/gpx-parser.ts)
 * and persisting to races.course_geometry.
 */
export async function fetchStravaRouteGpx(userId: string, routeId: string): Promise<string> {
  const token = await getStravaToken(userId);
  const resp = await fetch(
    `https://www.strava.com/api/v3/routes/${routeId}/export_gpx`,
    {
      headers: { 'Authorization': `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    }
  );
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`strava export_gpx failed: ${resp.status} ${txt.slice(0, 200)}`);
  }
  return resp.text();
}
