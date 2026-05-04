/**
 * Strava API client.
 *
 * Single-user, server-side. STRAVA_CLIENT_ID + STRAVA_CLIENT_SECRET
 * are app-level (set when registering at strava.com/settings/api).
 * STRAVA_REFRESH_TOKEN is captured once via the OAuth one-shot flow
 * (/api/strava/connect → /api/strava/callback) and lives in env from
 * then on. Strava refresh tokens don't expire unless the app is
 * deauthorized in the user's settings.
 *
 * Per Strava ToS: this is a personal-use single-athlete tool. The
 * activity list pulled here is never persisted to durable storage —
 * it lives only in localStorage as an actualResult fill-in on the
 * matching SavedRace.
 */

const STRAVA_OAUTH_URL = 'https://www.strava.com/oauth/token';
const STRAVA_API_BASE = 'https://www.strava.com/api/v3';

export interface StravaTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;        // unix seconds
  athlete?: { id: number; firstname?: string; lastname?: string };
}

export interface StravaActivity {
  id: number;
  name: string;
  distance: number;          // meters
  moving_time: number;       // seconds
  elapsed_time: number;
  total_elevation_gain: number;  // meters
  type: string;              // "Run", "Ride", etc.
  sport_type?: string;
  start_date: string;        // ISO UTC
  start_date_local: string;  // ISO local
  timezone?: string;
  average_speed?: number;    // m/s
  max_speed?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  has_heartrate?: boolean;
  average_cadence?: number;
  start_latlng?: [number, number];
  end_latlng?: [number, number];
  map?: { summary_polyline?: string };
}

/** Normalized fill-in for a SavedRace's actualResult slot. */
export interface ActivityResult {
  activityId: number;
  finishS: number;
  finishDisplay: string;
  paceSPerMi: number;
  paceDisplay: string;
  distanceMi: number;
  avgHr: number | null;
  maxHr: number | null;
  avgCadence: number | null;
  totalGainFt: number;
  startLocal: string;        // ISO
  name: string;
}

/* ── OAuth: code → tokens ──────────────────────────────────── */
export async function exchangeCode(code: string): Promise<StravaTokens> {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Missing STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET in env');

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: 'authorization_code',
  });
  const res = await fetch(STRAVA_OAUTH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Strava token exchange failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

/* ── OAuth: refresh_token → fresh access_token ─────────────── */
export async function refreshAccessToken(): Promise<{ accessToken: string; expiresAt: number; refreshToken: string }> {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  const refreshToken = process.env.STRAVA_REFRESH_TOKEN;
  if (!clientId || !clientSecret) throw new Error('Missing STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET in env');
  if (!refreshToken) throw new Error('Missing STRAVA_REFRESH_TOKEN in env — run /api/strava/connect to capture it');

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const res = await fetch(STRAVA_OAUTH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Strava refresh failed: ${res.status} ${await res.text()}`);
  const j = await res.json();
  return { accessToken: j.access_token, expiresAt: j.expires_at, refreshToken: j.refresh_token };
}

/* ── Activity fetch ─────────────────────────────────────────
   `after` is a Unix timestamp; only activities started after that
   point are returned. Strava returns up to 200 per page; we paginate
   until exhaustion. */
export async function fetchActivities({ after, before, perPage = 200 }: { after?: number; before?: number; perPage?: number } = {}): Promise<StravaActivity[]> {
  const { accessToken } = await refreshAccessToken();
  const all: StravaActivity[] = [];
  for (let page = 1; page < 50; page++) {
    const params = new URLSearchParams({ per_page: String(perPage), page: String(page) });
    if (after) params.set('after', String(after));
    if (before) params.set('before', String(before));
    const res = await fetch(`${STRAVA_API_BASE}/athlete/activities?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`Strava activities fetch failed: ${res.status} ${await res.text()}`);
    const batch: StravaActivity[] = await res.json();
    all.push(...batch);
    if (batch.length < perPage) break;
  }
  return all;
}

/* ── Date matching ──────────────────────────────────────────
   For a SavedRace dated YYYY-MM-DD and an expected distance in mi,
   find the best matching Strava activity. Match logic:
     1. Same start_date_local YYYY-MM-DD prefix
     2. type === 'Run' (or sport_type === 'Run')
     3. Distance within ±15% of expected (most marathons run a hair
        long because of GPS drift + tangents)
   Returns the longest activity matching #1+#2 if multiple. */
export function findRaceMatch(activities: StravaActivity[], raceDateISO: string, expectedDistMi: number): StravaActivity | null {
  const datePrefix = raceDateISO.slice(0, 10);
  const candidates = activities
    .filter(a => (a.start_date_local || a.start_date).slice(0, 10) === datePrefix)
    .filter(a => a.type === 'Run' || a.sport_type === 'Run');
  if (candidates.length === 0) return null;
  if (expectedDistMi > 0) {
    const expectedM = expectedDistMi * 1609.344;
    const within = candidates.filter(a => Math.abs(a.distance - expectedM) / expectedM < 0.15);
    if (within.length > 0) return within.sort((a, b) => b.distance - a.distance)[0];
  }
  return candidates.sort((a, b) => b.distance - a.distance)[0];
}

/* ── Activity → ActualResult shape ──────────────────────────
   Converts a Strava activity into the shape the SavedRace
   actualResult expects. Time formats use the existing fmt helpers
   inlined here so the lib stays portable. */
export function activityToResult(a: StravaActivity, distanceMi?: number): ActivityResult {
  const distMi = distanceMi ?? (a.distance / 1609.344);
  const finishS = a.moving_time;
  const paceSPerMi = Math.round(finishS / distMi);
  return {
    activityId: a.id,
    finishS,
    finishDisplay: fmtTimeShort(finishS),
    paceSPerMi,
    paceDisplay: fmtTimeShort(paceSPerMi),
    distanceMi: Math.round(distMi * 100) / 100,
    avgHr: a.average_heartrate ?? null,
    maxHr: a.max_heartrate ?? null,
    avgCadence: a.average_cadence ?? null,
    totalGainFt: Math.round((a.total_elevation_gain ?? 0) * 3.28084),
    startLocal: a.start_date_local || a.start_date,
    name: a.name,
  };
}

function fmtTimeShort(s: number): string {
  s = Math.round(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}
