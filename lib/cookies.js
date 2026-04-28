/**
 * HMAC-signed cookies — no DB needed.
 *
 * Strava tokens are stored in a single `runcino_strava` cookie:
 *   <base64url(payload)>.<base64url(hmac-sha256(payload))>
 *
 * The cookie is HttpOnly + SameSite=Lax + Secure-when-https. Signing key
 * comes from SESSION_SECRET. If SESSION_SECRET is not set (local dev),
 * we derive a stable key from a `.runcino-secret` file alongside the
 * server so cookies survive restarts on a single machine.
 */

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const COOKIE_NAME = 'runcino_strava';
// 60 days — Strava refresh tokens don't expire, so we can keep the session long.
const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 60;

let cachedKey = null;

function getKey() {
  if (cachedKey) return cachedKey;
  const env = process.env.SESSION_SECRET;
  if (env && env.length >= 16) {
    cachedKey = Buffer.from(env, 'utf8');
    return cachedKey;
  }
  const fallback = path.join(process.cwd(), '.runcino-secret');
  try {
    cachedKey = fs.readFileSync(fallback);
  } catch {
    cachedKey = crypto.randomBytes(32);
    try { fs.writeFileSync(fallback, cachedKey, { mode: 0o600 }); } catch { /* read-only fs */ }
  }
  return cachedKey;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function sign(payload) {
  const json = JSON.stringify(payload);
  const body = b64url(json);
  const mac = crypto.createHmac('sha256', getKey()).update(body).digest();
  return `${body}.${b64url(mac)}`;
}

function verify(token) {
  if (!token || typeof token !== 'string') return null;
  const idx = token.indexOf('.');
  if (idx <= 0) return null;
  const body = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = b64url(crypto.createHmac('sha256', getKey()).update(body).digest());
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(b64urlDecode(body).toString('utf8'));
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (!k) continue;
    out[k] = decodeURIComponent(v);
  }
  return out;
}

function buildSetCookie(name, value, opts = {}) {
  const parts = [`${name}=${value}`];
  parts.push(`Path=${opts.path || '/'}`);
  if (opts.maxAge != null) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.expires) parts.push(`Expires=${opts.expires.toUTCString()}`);
  parts.push(`SameSite=${opts.sameSite || 'Lax'}`);
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

function readSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const session = verify(cookies[COOKIE_NAME]);
  return session;
}

function writeSession(res, payload, { secure = false } = {}) {
  res.setHeader('Set-Cookie', appendCookie(res.getHeader('Set-Cookie'), buildSetCookie(COOKIE_NAME, sign(payload), {
    maxAge: COOKIE_MAX_AGE_S,
    httpOnly: true,
    sameSite: 'Lax',
    secure,
    path: '/',
  })));
}

function clearSession(res, { secure = false } = {}) {
  res.setHeader('Set-Cookie', appendCookie(res.getHeader('Set-Cookie'), buildSetCookie(COOKIE_NAME, '', {
    maxAge: 0,
    httpOnly: true,
    sameSite: 'Lax',
    secure,
    path: '/',
  })));
}

function setOAuthState(res, value, { secure = false } = {}) {
  res.setHeader('Set-Cookie', appendCookie(res.getHeader('Set-Cookie'), buildSetCookie('runcino_oauth_state', value, {
    maxAge: 600,
    httpOnly: true,
    sameSite: 'Lax',
    secure,
    path: '/',
  })));
}

function readOAuthState(req) {
  const cookies = parseCookies(req.headers.cookie);
  return cookies['runcino_oauth_state'] || null;
}

function clearOAuthState(res, { secure = false } = {}) {
  res.setHeader('Set-Cookie', appendCookie(res.getHeader('Set-Cookie'), buildSetCookie('runcino_oauth_state', '', {
    maxAge: 0,
    httpOnly: true,
    sameSite: 'Lax',
    secure,
    path: '/',
  })));
}

function appendCookie(existing, next) {
  if (!existing) return [next];
  if (Array.isArray(existing)) return existing.concat(next);
  return [existing, next];
}

module.exports = {
  COOKIE_NAME,
  parseCookies,
  readSession,
  writeSession,
  clearSession,
  setOAuthState,
  readOAuthState,
  clearOAuthState,
};
