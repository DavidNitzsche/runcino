/**
 * Runcino server — serves the static `designs/` site and adds a tiny
 * Strava OAuth + read-only API on top so the placeholder numbers in
 * hub.html / races.html / log.html can be replaced with real activity data.
 *
 * Routes:
 *   GET  /api/strava/login        → 302 to Strava authorize
 *   GET  /api/strava/callback     ← Strava redirects here, we exchange + cookie
 *   GET  /api/strava/status       → { configured, connected, athlete, lastSyncAt }
 *   GET  /api/strava/data         → aggregated data the client renders
 *   POST /api/strava/disconnect   → clears the cookie
 *   GET  /api/health              → liveness probe
 *   *                             → static file from designs/
 *
 * Tokens live in a single HMAC-signed HTTP-only cookie (see lib/cookies.js),
 * so there's no DB to provision on Railway.
 */

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const cookies = require('./lib/cookies');
const strava = require('./lib/strava');
const { aggregate } = require('./lib/aggregate');

const PORT = Number(process.env.PORT || 3000);
const STATIC_ROOT = path.join(__dirname, 'designs');
const ACTIVITY_CACHE_TTL_MS = 5 * 60 * 1000;

// athleteId → { ts, activities, athlete }
const cache = new Map();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.gpx':  'application/gpx+xml',
  '.txt':  'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
};

const server = http.createServer(async (req, res) => {
  try {
    const origin = computeOrigin(req);
    const secure = origin.startsWith('https://');
    const url = new URL(req.url, origin);

    if (url.pathname === '/api/health') {
      return sendJSON(res, 200, { ok: true });
    }
    if (url.pathname === '/api/strava/login') {
      return handleLogin(req, res, origin, secure);
    }
    if (url.pathname === '/api/strava/callback') {
      return handleCallback(req, res, origin, secure);
    }
    if (url.pathname === '/api/strava/status') {
      return handleStatus(req, res, origin, secure);
    }
    if (url.pathname === '/api/strava/data') {
      return handleData(req, res, origin, secure);
    }
    if (url.pathname === '/api/strava/disconnect') {
      return handleDisconnect(req, res, secure);
    }

    return serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error('Unhandled error', err);
    sendJSON(res, 500, { error: 'internal', message: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`Runcino · http://localhost:${PORT}`);
  if (!strava.isConfigured()) {
    console.log('  [strava] STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET not set — connect button will be disabled.');
  }
});

// ─── Handlers ────────────────────────────────────────────────────────────────

function handleLogin(req, res, origin, secure) {
  if (!strava.isConfigured()) {
    return redirect(res, '/integrations.html?error=not_configured');
  }
  const cfg = strava.getConfig(origin);
  const state = crypto.randomBytes(16).toString('hex');
  cookies.setOAuthState(res, state, { secure });
  return redirect(res, strava.buildAuthorizeUrl(cfg, state));
}

async function handleCallback(req, res, origin, secure) {
  const url = new URL(req.url, origin);
  const error = url.searchParams.get('error');
  if (error) return redirect(res, `/hub.html?strava_error=${encodeURIComponent(error)}`);

  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  if (!code || !stateParam) return redirect(res, '/hub.html?strava_error=missing_code');

  const stored = cookies.readOAuthState(req);
  cookies.clearOAuthState(res, { secure });
  if (!stored || stored !== stateParam) {
    return redirect(res, '/hub.html?strava_error=state_mismatch');
  }

  let cfg;
  try {
    cfg = strava.getConfig(origin);
  } catch {
    return redirect(res, '/hub.html?strava_error=not_configured');
  }

  let resp;
  try {
    resp = await strava.exchangeCodeForToken(cfg, code);
  } catch (err) {
    const tag = err instanceof strava.StravaApiError ? `token_exchange_${err.status}` : 'token_exchange_failed';
    return redirect(res, `/hub.html?strava_error=${tag}`);
  }

  const session = {
    access_token: resp.access_token,
    refresh_token: resp.refresh_token,
    expires_at: resp.expires_at,
    athlete_id: resp.athlete && resp.athlete.id,
    athlete: resp.athlete ? slimAthlete(resp.athlete) : null,
    connected_at: Math.floor(Date.now() / 1000),
  };
  cookies.writeSession(res, session, { secure });
  return redirect(res, '/hub.html?strava=connected');
}

async function handleStatus(req, res, origin, secure) {
  const session = cookies.readSession(req);
  if (!session) {
    return sendJSON(res, 200, {
      configured: strava.isConfigured(),
      connected: false,
      athlete: null,
    });
  }

  let liveSession = session;
  try {
    const { session: fresh, rotated } = await strava.ensureFreshToken(session, origin);
    liveSession = fresh;
    if (rotated) cookies.writeSession(res, fresh, { secure });
  } catch (err) {
    if (err instanceof strava.StravaApiError && (err.status === 401 || err.status === 400)) {
      cookies.clearSession(res, { secure });
      return sendJSON(res, 200, { configured: strava.isConfigured(), connected: false, athlete: null, error: 'session_expired' });
    }
    return sendJSON(res, 502, { configured: true, connected: false, error: err.message });
  }

  return sendJSON(res, 200, {
    configured: strava.isConfigured(),
    connected: true,
    athlete: liveSession.athlete,
    expires_at: liveSession.expires_at,
    connected_at: liveSession.connected_at || null,
  });
}

async function handleData(req, res, origin, secure) {
  const session = cookies.readSession(req);
  if (!session) {
    return sendJSON(res, 200, { connected: false });
  }

  let liveSession = session;
  try {
    const { session: fresh, rotated } = await strava.ensureFreshToken(session, origin);
    liveSession = fresh;
    if (rotated) cookies.writeSession(res, fresh, { secure });
  } catch (err) {
    if (err instanceof strava.StravaApiError && (err.status === 401 || err.status === 400)) {
      cookies.clearSession(res, { secure });
      return sendJSON(res, 200, { connected: false, error: 'session_expired' });
    }
    return sendJSON(res, 502, { connected: false, error: err.message });
  }

  const force = new URL(req.url, origin).searchParams.get('refresh') === '1';
  let activities, athlete;
  try {
    const data = await loadActivities(liveSession, { force });
    activities = data.activities;
    athlete = data.athlete;
  } catch (err) {
    return sendJSON(res, 502, { connected: true, error: err.message });
  }

  const summary = aggregate(activities, { now: new Date() });
  return sendJSON(res, 200, {
    connected: true,
    athlete,
    fetched_at: new Date().toISOString(),
    cache_age_ms: cacheAge(liveSession.athlete_id),
    activity_count: activities.length,
    ...summary,
  });
}

function handleDisconnect(req, res, secure) {
  cookies.clearSession(res, { secure });
  return sendJSON(res, 200, { ok: true });
}

// ─── Strava activity caching ────────────────────────────────────────────────

async function loadActivities(session, { force = false } = {}) {
  const id = session.athlete_id;
  const entry = id ? cache.get(id) : null;
  if (!force && entry && Date.now() - entry.ts < ACTIVITY_CACHE_TTL_MS) {
    return entry;
  }
  const [athlete, activities] = await Promise.all([
    strava.fetchAthlete(session.access_token).catch(() => session.athlete || null),
    strava.fetchAthleteActivities(session.access_token, { perPage: 100, pages: 4 }),
  ]);
  const data = {
    ts: Date.now(),
    athlete: athlete ? slimAthlete(athlete) : session.athlete,
    activities,
  };
  if (id) cache.set(id, data);
  return data;
}

function cacheAge(athleteId) {
  if (!athleteId) return null;
  const entry = cache.get(athleteId);
  if (!entry) return null;
  return Date.now() - entry.ts;
}

function slimAthlete(a) {
  return {
    id: a.id,
    firstname: a.firstname,
    lastname: a.lastname,
    username: a.username || null,
    profile: a.profile || null,
    city: a.city || null,
    state: a.state || null,
    country: a.country || null,
    sex: a.sex || null,
    weight: a.weight || null,
  };
}

// ─── Static file serving ────────────────────────────────────────────────────

async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    return res.end('Method Not Allowed');
  }

  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/hub.html';
  // Defend against path traversal
  if (rel.includes('..')) {
    res.writeHead(400);
    return res.end('Bad path');
  }

  let filePath = path.join(STATIC_ROOT, rel);
  let stat;
  try {
    stat = await fs.promises.stat(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      stat = await fs.promises.stat(filePath);
    }
  } catch {
    // Try .html fallback for clean URLs
    if (!path.extname(rel)) {
      try {
        const alt = path.join(STATIC_ROOT, `${rel}.html`);
        stat = await fs.promises.stat(alt);
        filePath = alt;
      } catch {
        return notFound(res);
      }
    } else {
      return notFound(res);
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  res.setHeader('content-type', MIME[ext] || 'application/octet-stream');
  if (ext === '.html') {
    res.setHeader('cache-control', 'no-cache');
  } else {
    res.setHeader('cache-control', 'public, max-age=300');
  }
  res.setHeader('content-length', String(stat.size));

  if (req.method === 'HEAD') {
    res.writeHead(200);
    return res.end();
  }
  res.writeHead(200);
  fs.createReadStream(filePath).pipe(res);
}

function notFound(res) {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sendJSON(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

function redirect(res, location) {
  res.writeHead(302, { location });
  res.end();
}

function computeOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || (req.socket && req.socket.encrypted ? 'https' : 'http');
  const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
  return `${proto}://${host}`;
}
