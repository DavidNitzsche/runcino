/**
 * Strava OAuth + REST client (Node, no external deps).
 *
 * Setup:
 *   1. Register an app at https://www.strava.com/settings/api
 *      Authorization Callback Domain: localhost (and your Railway host)
 *   2. Copy Client ID / Client Secret into the deploy environment:
 *        STRAVA_CLIENT_ID
 *        STRAVA_CLIENT_SECRET
 *      Optional:
 *        STRAVA_REDIRECT_URI (defaults to <origin>/api/strava/callback)
 *        SESSION_SECRET (HMAC key for signed cookies; auto-generated if absent)
 *
 * Scopes: read,activity:read_all,profile:read_all
 */

'use strict';

const AUTH_URL = 'https://www.strava.com/oauth/authorize';
const TOKEN_URL = 'https://www.strava.com/oauth/token';
const API_BASE = 'https://www.strava.com/api/v3';

const SCOPE = 'read,activity:read_all,profile:read_all';

class StravaConfigError extends Error {}
class StravaApiError extends Error {
  constructor(status, body) {
    super(`Strava API ${status}: ${String(body).slice(0, 300)}`);
    this.status = status;
    this.body = body;
  }
}

function getConfig(origin) {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new StravaConfigError('Missing STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET');
  }
  const redirectUri =
    process.env.STRAVA_REDIRECT_URI ||
    `${origin || 'http://localhost:3000'}/api/strava/callback`;
  return { clientId, clientSecret, redirectUri };
}

function isConfigured() {
  return Boolean(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET);
}

function buildAuthorizeUrl(cfg, state) {
  const p = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: SCOPE,
    state,
  });
  return `${AUTH_URL}?${p.toString()}`;
}

async function exchangeCodeForToken(cfg, code) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new StravaApiError(res.status, await res.text());
  return res.json();
}

async function refreshTokens(cfg, refreshToken) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new StravaApiError(res.status, await res.text());
  return res.json();
}

async function stravaFetch(token, endpoint, params) {
  const url = new URL(`${API_BASE}${endpoint}`);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new StravaApiError(res.status, await res.text());
  return res.json();
}

/**
 * Given a session payload from the cookie, return a usable access_token,
 * refreshing if it's within 60s of expiring. Returns the (possibly updated)
 * session — the caller is responsible for re-issuing the cookie if rotated.
 */
async function ensureFreshToken(session, origin) {
  if (!session || !session.access_token) throw new StravaApiError(401, 'no session');
  const nowS = Math.floor(Date.now() / 1000);
  if (session.expires_at - 60 > nowS) {
    return { session, rotated: false };
  }
  const cfg = getConfig(origin);
  const r = await refreshTokens(cfg, session.refresh_token);
  const next = {
    ...session,
    access_token: r.access_token,
    refresh_token: r.refresh_token,
    expires_at: r.expires_at,
  };
  return { session: next, rotated: true };
}

async function fetchAthlete(token) {
  return stravaFetch(token, '/athlete');
}

async function fetchAthleteActivities(token, { perPage = 100, pages = 4, afterUnix, beforeUnix } = {}) {
  const out = [];
  for (let page = 1; page <= pages; page++) {
    const params = { per_page: perPage, page };
    if (afterUnix) params.after = afterUnix;
    if (beforeUnix) params.before = beforeUnix;
    const list = await stravaFetch(token, '/athlete/activities', params);
    if (!Array.isArray(list)) break;
    out.push(...list);
    if (list.length < perPage) break;
  }
  return out;
}

async function fetchActivityDetail(token, id) {
  return stravaFetch(token, `/activities/${id}`, { include_all_efforts: true });
}

module.exports = {
  SCOPE,
  StravaConfigError,
  StravaApiError,
  getConfig,
  isConfigured,
  buildAuthorizeUrl,
  exchangeCodeForToken,
  refreshTokens,
  ensureFreshToken,
  fetchAthlete,
  fetchAthleteActivities,
  fetchActivityDetail,
};
