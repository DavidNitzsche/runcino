#!/usr/bin/env node
/**
 * SIM · /login surface probe.
 *
 * Companion to the other 10 backend probes. Asserts the sign-in surface
 * landed in the shape the brief requires:
 *
 *   1. /login route exists at app/(auth)/login/page.tsx + AuthButtons.tsx
 *   2. The three buttons carry data-test markers so future PRs can find
 *      them: signin-apple, signin-google, signin-email
 *   3. /api/auth/apple route still exists and still mints sessions
 *      against the faff_session cookie (the unique anchor the SSR
 *      loaders read · brief calls out "MUST be exactly faff_session")
 *   4. Google + email button handlers fire a toast and DO NOT issue a
 *      fetch() · the brief explicitly defers those paths and the probe
 *      enforces that nobody quietly wires them in a future PR without
 *      updating the brief + this probe
 *   5. SSR loader (components/faff-app/seed.ts) redirects unauthenticated
 *      visitors to /login (not a guest state)
 *
 * Two modes (mirror of _sim_unauthenticated.mjs and friends):
 *
 *   STATIC AUDIT (default) — file existence + source-grep assertions.
 *   LIVE PROBE (--live[=URL]) — fetches /login and asserts the markers
 *     appear in the HTML, and /api/auth/apple rejects malformed bodies.
 *     Skipped by default since CI doesn't run a server.
 *
 * Usage:
 *   node web-v2/scripts/_sim_login_surface.mjs
 *   node web-v2/scripts/_sim_login_surface.mjs --live
 *   node web-v2/scripts/_sim_login_surface.mjs --live=https://www.faff.run
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '..');

const LOGIN_PAGE   = 'app/(auth)/login/page.tsx';
const LOGIN_BTNS   = 'app/(auth)/login/AuthButtons.tsx';
const APPLE_ROUTE  = 'app/api/auth/apple/route.ts';
const SESSION_LIB  = 'lib/auth/session.ts';
const SEED_LOADER  = 'components/faff-app/seed.ts';

function read(rel) {
  const full = path.join(APP_ROOT, rel);
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full, 'utf8');
}

function check(label, ok, detail) {
  const mark = ok ? '✓' : '✗';
  console.log(`  ${mark} ${label}${detail ? `  · ${detail}` : ''}`);
  return ok;
}

// ─── Static audit ─────────────────────────────────────────────────

function staticAudit() {
  console.log('=== STATIC AUDIT · sign-in surface ===\n');
  let pass = 0;
  let fail = 0;
  const record = (ok) => { ok ? pass++ : fail++; };

  // 1. Files exist.
  const pageSrc = read(LOGIN_PAGE);
  const btnSrc  = read(LOGIN_BTNS);
  const appleSrc = read(APPLE_ROUTE);
  const sessSrc  = read(SESSION_LIB);
  const seedSrc  = read(SEED_LOADER);

  record(check('app/(auth)/login/page.tsx exists',       !!pageSrc));
  record(check('app/(auth)/login/AuthButtons.tsx exists', !!btnSrc));
  record(check('app/api/auth/apple/route.ts exists',     !!appleSrc));
  record(check('lib/auth/session.ts exists',             !!sessSrc));
  record(check('components/faff-app/seed.ts exists',     !!seedSrc));
  if (!pageSrc || !btnSrc || !appleSrc || !sessSrc || !seedSrc) {
    console.log(`\nFAIL · ${fail} required files missing.`);
    return { pass, fail };
  }

  // 2. data-test markers on all three buttons.
  record(check('AuthButtons has data-test="signin-apple"',
    /data-test=["']signin-apple["']/.test(btnSrc)));
  record(check('AuthButtons has data-test="signin-google"',
    /data-test=["']signin-google["']/.test(btnSrc)));
  record(check('AuthButtons has data-test="signin-email"',
    /data-test=["']signin-email["']/.test(btnSrc)));

  // 3. Apple button POSTs to /api/auth/apple.
  record(check('Apple click handler POSTs to /api/auth/apple',
    /fetch\(['"]\/api\/auth\/apple['"]/.test(btnSrc)));

  // 4. Google + email buttons do NOT issue fetch().
  //    Implementation pattern: each button's onClick goes through
  //    onDeferred(kind), which calls showToast and never fetches.
  //    Static check · grep for onDeferred and assert no fetch in any
  //    code path that runs from those buttons.
  const usesOnDeferred = /onDeferred\(['"]google['"]\)|onDeferred\(['"]email['"]\)/.test(btnSrc);
  record(check('Google + email use onDeferred toast helper', usesOnDeferred));
  // Crude but effective: assert there is only ONE fetch call in the
  // module (the Apple POST). The deferred handlers must not add a
  // second one without the probe also being updated.
  const fetchCount = (btnSrc.match(/\bfetch\s*\(/g) || []).length;
  record(check('Only one fetch() in AuthButtons (the Apple POST)',
    fetchCount === 1, `found ${fetchCount}`));

  // 5. Apple route still validates the JWT and sets faff_session cookie.
  record(check('Apple route imports createSession from auth/session',
    /from\s+['"]@\/lib\/auth\/session['"]/.test(appleSrc) && /createSession/.test(appleSrc)));
  record(check('Apple route sets the faff_session cookie',
    /res\.cookies\.set\(\s*['"]faff_session['"]/.test(appleSrc)));
  record(check('Apple route still verifies issuer',
    /APPLE_ISSUER\s*=\s*['"]https:\/\/appleid\.apple\.com['"]/.test(appleSrc)));

  // 6. Session lib uses the faff_session cookie name (the unique anchor).
  record(check('session.ts cookie name is faff_session',
    /faff_session/.test(sessSrc) && !/['"]faff[_-]?sess['"]/.test(sessSrc.replace(/faff_session/g, ''))));

  // 7. seed.ts redirects unauthenticated visitors to /login (not emptySeed only).
  record(check('seed.ts wires a /login redirect for unauthenticated SSR',
    /redirect\(['"]\/login['"]\)/.test(seedSrc)));
  record(check('seed.ts still calls userIdFromCookies() before redirect',
    /userIdFromCookies\s*\(/.test(seedSrc)));

  // 8. Page redirects already-signed-in visitors AWAY from /login.
  record(check('/login redirects authenticated visitors to /today',
    /redirect\(['"]\/today['"]\)/.test(pageSrc) && /userIdFromCookies\s*\(/.test(pageSrc)));

  // 9. No em dashes in the page or button source.
  //    (Project rule · designs/faff-web-design-bundle/CLAUDE.md.)
  const emDashInPage = /—/.test(pageSrc);
  const emDashInBtns = /—/.test(btnSrc);
  record(check('No em dash in /login page', !emDashInPage));
  record(check('No em dash in AuthButtons',  !emDashInBtns));

  console.log(`\n${pass}/${pass + fail} static checks pass`);
  return { pass, fail };
}

// ─── Live probe ───────────────────────────────────────────────────

async function liveProbe(baseUrl) {
  console.log(`\n=== LIVE PROBE → ${baseUrl} ===\n`);
  let pass = 0;
  let fail = 0;
  const record = (ok) => { ok ? pass++ : fail++; };

  // a. GET /login → 200 + HTML containing all three data-test markers
  //    and the brand wordmark.
  let html = null;
  try {
    const r = await fetch(baseUrl + '/login', { redirect: 'manual' });
    if (r.status === 200) {
      html = await r.text();
      record(check('GET /login → 200'));
    } else if (r.status >= 300 && r.status < 400) {
      // If we're hitting a prod URL with a real session cookie injected
      // somehow we'd be redirected away. Treat as informational, not pass.
      record(check(`GET /login → ${r.status} (redirected · cannot probe markers)`, false));
    } else {
      record(check(`GET /login → ${r.status}`, false));
    }
  } catch (e) {
    record(check(`GET /login network: ${e.message}`, false));
  }

  if (html) {
    record(check('HTML contains data-test="signin-apple"',  html.includes('data-test="signin-apple"')));
    record(check('HTML contains data-test="signin-google"', html.includes('data-test="signin-google"')));
    record(check('HTML contains data-test="signin-email"',  html.includes('data-test="signin-email"')));
    // The brand mark "Faff" + dot + "Run" should show.
    record(check('HTML contains the Faff·Run wordmark',
      /Faff.*Run|Faff<.*Run/.test(html)));
    // No em dash leak in rendered output.
    record(check('No em dash in rendered /login HTML',
      !html.includes('—')));
  }

  // b. POST /api/auth/apple with no body → 400 (identity_token required).
  try {
    const r = await fetch(baseUrl + '/api/auth/apple', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    record(check('POST /api/auth/apple (empty body) → 400', r.status === 400));
  } catch (e) {
    record(check(`POST /api/auth/apple network: ${e.message}`, false));
  }

  // c. SSR loader · GET /today with no cookie → 307/302 → /login.
  try {
    const r = await fetch(baseUrl + '/today', { redirect: 'manual' });
    const loc = r.headers.get('location') ?? '';
    const ok = r.status >= 300 && r.status < 400 && /\/login(?:$|\?)/.test(loc);
    record(check(`GET /today (no session) → redirect to /login`,
      ok, `status=${r.status} location=${loc}`));
  } catch (e) {
    record(check(`GET /today network: ${e.message}`, false));
  }

  console.log(`\n${pass}/${pass + fail} live checks pass`);
  return { pass, fail };
}

// ─── Main ─────────────────────────────────────────────────────────

async function main() {
  const liveArg = process.argv.find((a) => a.startsWith('--live'));
  const auditResults = staticAudit();
  let liveResults = null;
  if (liveArg) {
    const m = liveArg.match(/^--live(?:=(.+))?$/);
    const baseUrl = (m && m[1] ? m[1] : 'http://localhost:3000').replace(/\/+$/, '');
    liveResults = await liveProbe(baseUrl);
  }
  const totalFail = auditResults.fail + (liveResults?.fail ?? 0);
  if (totalFail > 0) {
    console.error(`\nFAIL · ${totalFail} checks did not pass.`);
    process.exit(1);
  }
  console.log('\nPASS · /login surface conforms to the brief.');
}

main().catch((e) => { console.error(e); process.exit(1); });
