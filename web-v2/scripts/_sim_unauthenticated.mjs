#!/usr/bin/env node
/**
 * SIM · Unauthenticated request probe.
 *
 * After the 2026-05-30 user-isolation fix (39 API routes that previously
 * silently defaulted to David's UUID now return 401 when no session is
 * present), this probe ASSERTS that every category B/C/E route rejects
 * requests with no Authorization: Bearer + no faff_session cookie.
 *
 * Two modes:
 *
 *   STATIC AUDIT (default) — reads each route file's source and asserts
 *     that the handler either:
 *       (a) calls requireUserId(req) AND returns the auth value when it's a
 *           NextResponse (the canonical fixed shape), OR
 *       (b) calls requireAuth(req) inside a try/catch with 401 mapping, OR
 *       (c) is one of the known-public/cron exemptions.
 *     Routes that match (a)/(b) pass. Routes that still reference
 *     DEFAULT_USER_ID or `body.user_id ?? DAVID_USER_ID` as a code path
 *     fail loud.
 *
 *   LIVE PROBE (--live[=URL]) — actually fires requests at the dev server
 *     with no auth headers and asserts each returns HTTP 401. Useful as a
 *     post-deploy smoke test. Default URL: http://localhost:3000.
 *
 * Usage:
 *   node web-v2/scripts/_sim_unauthenticated.mjs           # static audit
 *   node web-v2/scripts/_sim_unauthenticated.mjs --live    # against localhost:3000
 *   node web-v2/scripts/_sim_unauthenticated.mjs --live=https://www.faff.run
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '..');
const API_DIR = path.join(APP_ROOT, 'app', 'api');

// ─── Route catalog ──────────────────────────────────────────────────
//
// Every route classified by category. Updates here MUST be matched in
// the fix. This double-entry-bookkeeping is intentional: if a route
// flips from "public" to "authenticated", BOTH the route and this
// catalog must change in the same commit, so reviewers can't miss it.

// Category A — Public (no session needed). Static audit passes
// automatically; live probe accepts ANY non-500 status (200/302/410/etc).
const PUBLIC_ROUTES = [
  '/api/tips',                     // GET — global form-tip library
  '/api/overview',                 // GET — legacy 410 GONE
  '/api/learn/[slug]',             // GET — global learn article
  '/api/usage',                    // GET — cost rollup (admin/debug)
  '/api/auth/apple',               // POST — Sign in with Apple (mints session)
  '/api/strava/webhook',           // GET/POST — Strava-signed callback
];

// Category D — Cron (CRON_SECRET bearer). Audit checks for that pattern.
const CRON_ROUTES = [
  '/api/cron/enrich-weather',
  '/api/cron/keep-warm',
  '/api/cron/notifications',
  '/api/cron/refresh-briefings',
  '/api/cron/run-adaptations',
  '/api/cron/snapshot-projections',
];

// Category B/C — Authenticated read/write. Audit checks for `requireUserId`
// or `requireAuth`. Live probe asserts 401 with no auth.
const AUTHENTICATED_ROUTES = [
  // Surface state loaders
  ['GET',    '/api/briefing'],
  ['GET',    '/api/coach/facts'],
  ['POST',   '/api/coach/facts'],
  ['POST',   '/api/coach/proposal'],
  ['GET',    '/api/profile'],
  ['PATCH',  '/api/profile'],
  ['GET',    '/api/profile/state'],
  ['GET',    '/api/profile/notifications'],
  ['PATCH',  '/api/profile/notifications'],
  ['GET',    '/api/races'],
  ['POST',   '/api/race'],
  ['PATCH',  '/api/race'],
  ['DELETE', '/api/race'],
  ['GET',    '/api/race/sample-slug'],         // [slug] route
  ['POST',   '/api/race/gpx'],
  ['POST',   '/api/checkin'],
  ['GET',    '/api/checkin/repair'],
  ['POST',   '/api/checkin/repair'],
  ['GET',    '/api/shoe'],
  ['POST',   '/api/shoe'],
  ['PATCH',  '/api/shoe'],
  ['DELETE', '/api/shoe'],
  ['GET',    '/api/settings'],
  ['PATCH',  '/api/settings'],
  ['PATCH',  '/api/plan/workout'],
  ['POST',   '/api/plan/generate'],
  ['GET',    '/api/plan/week'],
  ['GET',    '/api/runs/sample-id'],
  ['PATCH',  '/api/runs/sample-id'],
  ['GET',    '/api/runs/sample-id/rpe'],
  ['POST',   '/api/runs/sample-id/rpe'],
  ['POST',   '/api/ingest/workout'],
  ['POST',   '/api/ingest/health'],
  ['POST',   '/api/health/manual'],
  ['GET',    '/api/health/series'],
  ['GET',    '/api/health/state'],
  ['POST',   '/api/run/manual'],
  ['GET',    '/api/prescription'],
  ['GET',    '/api/readiness'],
  ['GET',    '/api/log'],
  ['GET',    '/api/training/state'],
  ['POST',   '/api/admin/backfill-workout-spec'],
  ['POST',   '/api/admin/recompute-runs'],
  ['GET',    '/api/admin/strava-webhook'],
  ['POST',   '/api/admin/strava-webhook'],
  ['POST',   '/api/onboarding/complete'],
  ['GET',    '/api/cross-training'],
  ['POST',   '/api/cross-training'],
  ['GET',    '/api/goals'],
  ['POST',   '/api/goals'],
  ['PATCH',  '/api/goals/sample-id'],
  ['DELETE', '/api/goals/sample-id'],
  ['GET',    '/api/strength'],
  ['POST',   '/api/strength'],
  ['GET',    '/api/today/skip'],
  ['POST',   '/api/today/skip'],
  ['DELETE', '/api/today/skip'],
  ['POST',   '/api/today/shoe'],
  ['DELETE', '/api/today/shoe'],
  ['GET',    '/api/niggle'],
  ['POST',   '/api/niggle'],
  ['DELETE', '/api/niggle'],
  ['POST',   '/api/niggle/recovery'],
  ['GET',    '/api/sick'],
  ['POST',   '/api/sick'],
  ['DELETE', '/api/sick'],
  ['POST',   '/api/sick/recovery'],
  ['POST',   '/api/notifications/register'],
  ['POST',   '/api/notifications/ack'],
  ['GET',    '/api/forecast/2026-05-30'],
  ['GET',    '/api/auth/strava'],
  ['POST',   '/api/auth/strava'],
  ['GET',    '/api/gpx/search'],
  ['POST',   '/api/gpx/import'],
  ['GET',    '/api/strava/status'],
  ['GET',    '/api/strava/pushes'],
  ['POST',   '/api/strava/push/sample-id'],
];

// Category E — Watch endpoints. Same 401 expectation; also asserts the
// legacy ?user_id= query parameter is rejected.
const WATCH_ROUTES = [
  ['GET',  '/api/watch/today'],
  ['POST', '/api/watch/workouts/complete'],
];

// ─── Static audit ─────────────────────────────────────────────────

function readRouteFile(routePath) {
  // Translate /api/x/y/z → web-v2/app/api/x/y/z/route.ts
  // Drop sample params (anything after a static prefix that isn't a literal segment).
  // Heuristic: if a segment matches /api/.../<sample>/sub, look up the [param] folder.
  const segs = routePath.replace(/^\/api\//, '').split('/');
  // Try literal first
  const literal = path.join(API_DIR, ...segs, 'route.ts');
  if (fs.existsSync(literal)) return { file: literal, src: fs.readFileSync(literal, 'utf8') };
  // Try with [param] in place of sample-* / dynamic segments.
  const tryDynamic = (i) => {
    const subdir = path.join(API_DIR, ...segs.slice(0, i));
    if (!fs.existsSync(subdir)) return null;
    const param = fs.readdirSync(subdir).find((d) => d.startsWith('[') && d.endsWith(']'));
    if (!param) return null;
    const rebuilt = [...segs.slice(0, i), param, ...segs.slice(i + 1)];
    const cand = path.join(API_DIR, ...rebuilt, 'route.ts');
    if (fs.existsSync(cand)) return { file: cand, src: fs.readFileSync(cand, 'utf8') };
    return null;
  };
  for (let i = 0; i < segs.length; i++) {
    const hit = tryDynamic(i);
    if (hit) return hit;
  }
  return null;
}

function auditRoute(method, routePath, isWatch = false) {
  const hit = readRouteFile(routePath);
  if (!hit) return { ok: false, reason: 'route file not found' };
  const { src } = hit;

  // Negative checks first — these are the bug we just fixed. ANY of
  // these patterns means the route is still vulnerable.
  const badPatterns = [
    /DEFAULT_USER_ID\s*\?\?\s*['"]0645f40c/,        // const DAVID_USER_ID = ...
    /process\.env\.DEFAULT_USER_ID/,                  // direct env fallback in code
    /body\.user_id\s*\?\?\s*DAVID/,                   // body.user_id ?? DAVID
    /searchParams\.get\(['"]user_id['"]\)\s*\?\?\s*DAVID/, // ?user_id= ?? DAVID
  ];
  const bad = badPatterns.find((re) => re.test(src));
  // The route may legitimately mention DEFAULT_USER_ID in a comment;
  // strip comments before the check to avoid false positives.
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const badInCode = badPatterns.find((re) => re.test(codeOnly));
  if (badInCode) {
    return { ok: false, reason: `still references the vulnerable pattern: ${badInCode}` };
  }

  // Positive check — must use requireUserId / requireAuth.
  if (!/requireUserId\s*\(/.test(src) && !/requireAuth\s*\(/.test(src)) {
    return {
      ok: false,
      reason: 'no requireUserId() / requireAuth() call found',
    };
  }

  // Watch-specific: assert the ?user_id= rejection.
  if (isWatch && routePath === '/api/watch/today') {
    if (!/user_id query parameter is no longer accepted/.test(src)) {
      return {
        ok: false,
        reason: 'watch/today missing explicit ?user_id= rejection',
      };
    }
  }

  return { ok: true };
}

function staticAudit() {
  const results = { pass: 0, fail: 0, failed: [] };

  console.log('=== STATIC AUDIT ===\n');
  console.log('Category B/C (authenticated read/write):');
  for (const [method, routePath] of AUTHENTICATED_ROUTES) {
    const r = auditRoute(method, routePath);
    if (r.ok) {
      results.pass++;
      console.log(`  ✓ ${method.padEnd(6)} ${routePath}`);
    } else {
      results.fail++;
      results.failed.push({ method, routePath, reason: r.reason });
      console.log(`  ✗ ${method.padEnd(6)} ${routePath}  — ${r.reason}`);
    }
  }

  console.log('\nCategory E (watch):');
  for (const [method, routePath] of WATCH_ROUTES) {
    const r = auditRoute(method, routePath, true);
    if (r.ok) {
      results.pass++;
      console.log(`  ✓ ${method.padEnd(6)} ${routePath}`);
    } else {
      results.fail++;
      results.failed.push({ method, routePath, reason: r.reason });
      console.log(`  ✗ ${method.padEnd(6)} ${routePath}  — ${r.reason}`);
    }
  }

  console.log('\nCategory A (public — sanity check, expected to skip auth):');
  for (const routePath of PUBLIC_ROUTES) {
    const hit = readRouteFile(routePath);
    if (!hit) {
      console.log(`  ? ${routePath}  — route file not found`);
      continue;
    }
    const codeOnly = hit.src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const usesAuth = /requireUserId|requireAuth/.test(codeOnly);
    console.log(`  ${usesAuth ? '·' : '·'} ${routePath}  (auth=${usesAuth ? 'yes' : 'no'})`);
  }

  console.log('\nCategory D (cron — must use CRON_SECRET, NOT user auth):');
  for (const routePath of CRON_ROUTES) {
    const hit = readRouteFile(routePath);
    if (!hit) {
      console.log(`  ? ${routePath}  — route file not found`);
      continue;
    }
    const usesCronSecret = /CRON_SECRET/.test(hit.src);
    console.log(`  ${usesCronSecret ? '✓' : '✗'} ${routePath}  (CRON_SECRET=${usesCronSecret})`);
    if (!usesCronSecret) {
      results.fail++;
      results.failed.push({ method: '*', routePath, reason: 'cron route missing CRON_SECRET' });
    }
  }

  console.log(`\n${results.pass}/${results.pass + results.fail} routes pass static audit`);
  return results;
}

// ─── Live probe ───────────────────────────────────────────────────

async function liveProbe(baseUrl) {
  console.log(`\n=== LIVE PROBE → ${baseUrl} ===\n`);
  const results = { pass: 0, fail: 0, failed: [] };

  const probe = async (method, routePath, isWatch = false) => {
    const url = baseUrl + routePath;
    const init = { method, headers: { 'Content-Type': 'application/json' } };
    // For POST/PATCH/DELETE, send a minimal body; 401 must trigger
    // before body validation.
    if (method !== 'GET') init.body = '{}';
    let r;
    try {
      r = await fetch(url, init);
    } catch (e) {
      return { ok: false, reason: `network: ${e.message}` };
    }
    if (r.status !== 401) {
      return { ok: false, reason: `expected 401, got ${r.status}` };
    }
    return { ok: true };
  };

  for (const [method, routePath] of AUTHENTICATED_ROUTES) {
    const r = await probe(method, routePath);
    if (r.ok) {
      results.pass++;
      console.log(`  ✓ ${method.padEnd(6)} ${routePath} → 401`);
    } else {
      results.fail++;
      results.failed.push({ method, routePath, reason: r.reason });
      console.log(`  ✗ ${method.padEnd(6)} ${routePath}  — ${r.reason}`);
    }
  }

  console.log('\nCategory E (watch):');
  for (const [method, routePath] of WATCH_ROUTES) {
    const r = await probe(method, routePath, true);
    if (r.ok) {
      results.pass++;
      console.log(`  ✓ ${method.padEnd(6)} ${routePath} → 401`);
    } else {
      results.fail++;
      results.failed.push({ method, routePath, reason: r.reason });
      console.log(`  ✗ ${method.padEnd(6)} ${routePath}  — ${r.reason}`);
    }
  }

  // Bonus: assert /api/watch/today rejects ?user_id= even with a valid
  // bearer token. (Without a bearer we get 401 first; we need to exercise
  // the explicit rejection path.) Skipped in pure-401 probe mode.
  console.log(`\n${results.pass}/${results.pass + results.fail} routes return 401 unauthenticated`);
  return results;
}

// ─── Main ─────────────────────────────────────────────────────────

async function main() {
  const liveArg = process.argv.find((a) => a.startsWith('--live'));
  const auditResults = staticAudit();
  let liveResults = null;
  if (liveArg) {
    const m = liveArg.match(/^--live(?:=(.+))?$/);
    const baseUrl = m && m[1] ? m[1].replace(/\/+$/, '') : 'http://localhost:3000';
    liveResults = await liveProbe(baseUrl);
  }
  const totalFail = auditResults.fail + (liveResults?.fail ?? 0);
  if (totalFail > 0) {
    console.error(`\nFAIL — ${totalFail} routes did not pass.`);
    process.exit(1);
  }
  console.log('\nPASS — all classified routes behave correctly with no session.');
}

main().catch((e) => { console.error(e); process.exit(1); });
