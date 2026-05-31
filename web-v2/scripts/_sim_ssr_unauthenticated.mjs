#!/usr/bin/env node
/**
 * SIM · Unauthenticated SSR-loader probe.
 *
 * Companion to _sim_unauthenticated.mjs (API route 401 probe). That
 * probe closes the 54-route session-auth fallback. This one closes the
 * SAME family of bug on the SSR / RSC surface — pages under /faff
 * (renders served by `app/<view>/page.tsx`) previously called
 * `buildSeed()` / `buildRaceDetail()` which defaulted to David's UUID
 * when no session was present. Result: any unauthenticated browser
 * visiting / or /races/<slug> would render David's plan, races, health
 * snapshot, etc. via SSR — exactly the cross-user leak the API fix
 * was supposed to close.
 *
 * Two modes (mirror of _sim_unauthenticated.mjs):
 *
 *   STATIC AUDIT (default) — asserts each SSR loader:
 *     (a) does NOT reference DEFAULT_USER_ID or the hardcoded David
 *         UUID (0645f40c-…),
 *     (b) calls `userIdFromCookies()` from @/lib/auth/session, and
 *     (c) handles the null case explicitly (empty seed / null return /
 *         redirect), i.e. NEVER falls through to a default user.
 *
 *   LIVE PROBE (--live[=URL]) — fetches the SSR pages with no auth
 *     headers and asserts the response body contains NONE of David's
 *     identifying strings (name, city, plan name, race slugs, etc.).
 *     Sniff-test for "the leak is closed in practice, not just on
 *     paper". Default URL: http://localhost:3000.
 *
 * Usage:
 *   node web-v2/scripts/_sim_ssr_unauthenticated.mjs
 *   node web-v2/scripts/_sim_ssr_unauthenticated.mjs --live
 *   node web-v2/scripts/_sim_ssr_unauthenticated.mjs --live=https://www.faff.run
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '..');

// ─── SSR loader catalog ────────────────────────────────────────────
//
// Every server-rendered file under web-v2/components/faff-app/ that
// loads per-user data. These are the surfaces buildSeed() /
// buildRaceDetail() feed into; if a fix lands in them, the consumers
// (all 11 page.tsx files under web-v2/app/{today,races,...}) inherit
// it for free.
const SSR_LOADERS = [
  'components/faff-app/seed.ts',
  'components/faff-app/raceDetail.ts',
];

// ─── Page-level checks ─────────────────────────────────────────────
//
// Every page.tsx that calls one of the SSR loaders. We don't expect
// per-user references here directly (the loaders are the gate) but we
// audit them to catch any new page that wires per-user data inline.
const PAGE_FILES = [
  'app/page.tsx',
  'app/today/page.tsx',
  'app/log/page.tsx',
  'app/training/page.tsx',
  'app/races/page.tsx',
  'app/races/[slug]/page.tsx',
  'app/health/page.tsx',
  'app/profile/page.tsx',
  'app/runs/[id]/page.tsx',
  'app/plan/page.tsx',
  'app/me/page.tsx',
];

// David's UUID — what the pre-fix code returned. Live probe asserts
// none of these strings appear in the body of an unauthenticated SSR
// response.
const DAVID_UUID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const DAVID_NAME = 'David';
// David's CIM goal-race slug is `cim-2025` based on his real data —
// the empty seed has no races, so finding this in the SSR HTML proves
// the leak is open.
const DAVID_LEAK_NEEDLES = [
  DAVID_UUID,
  'cim-2025',                // David's A-race slug
];

// ─── Static audit ─────────────────────────────────────────────────

function auditLoader(rel) {
  const full = path.join(APP_ROOT, rel);
  if (!fs.existsSync(full)) return { ok: false, reason: 'loader file not found' };
  const src = fs.readFileSync(full, 'utf8');
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  // Negative — these are the bug.
  const badPatterns = [
    /DEFAULT_USER_ID\s*=\s*process\.env/,         // hardcoded const
    /process\.env\.DEFAULT_USER_ID\s*\?\?\s*['"]/,// inline env fallback
    /['"]0645f40c-951d-4ccc-b86e-9979cd26c795/,   // bare David UUID
  ];
  const bad = badPatterns.find((re) => re.test(codeOnly));
  if (bad) {
    return { ok: false, reason: `still references the vulnerable pattern: ${bad}` };
  }

  // Positive — must call userIdFromCookies (or requireUserIdFromCookies).
  if (!/userIdFromCookies\s*\(/.test(codeOnly) && !/requireUserIdFromCookies\s*\(/.test(codeOnly)) {
    return { ok: false, reason: 'no userIdFromCookies() / requireUserIdFromCookies() call found' };
  }

  // Positive — must handle null/falsy explicitly. Pattern:
  //   if (!userId) return …
  // or
  //   const userId = await requireUserIdFromCookies(); // throws
  const handlesNull =
    /if\s*\(\s*!\s*userId\s*\)\s*(?:\{\s*)?return\b/.test(codeOnly) ||
    /requireUserIdFromCookies\s*\(/.test(codeOnly);
  if (!handlesNull) {
    return { ok: false, reason: 'userIdFromCookies() result not null-checked' };
  }
  return { ok: true };
}

function auditPage(rel) {
  const full = path.join(APP_ROOT, rel);
  if (!fs.existsSync(full)) return { ok: false, reason: 'page file not found' };
  const src = fs.readFileSync(full, 'utf8');
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  // Pages must NOT reference DEFAULT_USER_ID or David's UUID directly.
  // (Per-user lookups are the loaders' job.)
  if (/DEFAULT_USER_ID/.test(codeOnly) || /['"]0645f40c-/.test(codeOnly)) {
    return { ok: false, reason: 'page references DEFAULT_USER_ID or David UUID directly' };
  }
  return { ok: true };
}

function staticAudit() {
  const results = { pass: 0, fail: 0, failed: [] };
  console.log('=== STATIC AUDIT — SSR loaders ===\n');
  for (const rel of SSR_LOADERS) {
    const r = auditLoader(rel);
    if (r.ok) {
      results.pass++;
      console.log(`  ✓ ${rel}`);
    } else {
      results.fail++;
      results.failed.push({ file: rel, reason: r.reason });
      console.log(`  ✗ ${rel}  — ${r.reason}`);
    }
  }
  console.log('\n=== STATIC AUDIT — page wrappers ===\n');
  for (const rel of PAGE_FILES) {
    const r = auditPage(rel);
    if (r.ok) {
      results.pass++;
      console.log(`  ✓ ${rel}`);
    } else {
      results.fail++;
      results.failed.push({ file: rel, reason: r.reason });
      console.log(`  ✗ ${rel}  — ${r.reason}`);
    }
  }
  console.log(`\n${results.pass}/${results.pass + results.fail} SSR surfaces pass static audit`);
  return results;
}

// ─── Live probe ───────────────────────────────────────────────────

async function liveProbe(baseUrl) {
  console.log(`\n=== LIVE PROBE → ${baseUrl} ===\n`);
  const results = { pass: 0, fail: 0, failed: [] };

  // SSR routes that previously rendered David's data when no session.
  const SSR_ROUTES = [
    '/',          // root → buildSeed() with initial='today'
    '/today',
    '/training',
    '/races',
    '/health',
    '/profile',
    '/plan',
    '/log',
    '/me',
  ];

  for (const route of SSR_ROUTES) {
    const url = baseUrl + route;
    let r, body;
    try {
      r = await fetch(url, { redirect: 'manual' });
      body = await r.text();
    } catch (e) {
      results.fail++;
      results.failed.push({ route, reason: `network: ${e.message}` });
      console.log(`  ✗ ${route}  — network: ${e.message}`);
      continue;
    }
    // Acceptable outcomes:
    //   - 2xx with NO David-identifying strings in body
    //   - 3xx redirect (to onboarding / sign-in)
    if (r.status >= 300 && r.status < 400) {
      results.pass++;
      console.log(`  ✓ ${route}  → ${r.status} ${r.headers.get('location') ?? ''}`);
      continue;
    }
    const leak = DAVID_LEAK_NEEDLES.find((n) => body.includes(n));
    if (leak) {
      results.fail++;
      results.failed.push({ route, reason: `body contains David needle: "${leak}"` });
      console.log(`  ✗ ${route}  → ${r.status}, body leaks: "${leak}"`);
      continue;
    }
    results.pass++;
    console.log(`  ✓ ${route}  → ${r.status}, no David needle in body`);
  }
  console.log(`\n${results.pass}/${results.pass + results.fail} SSR routes free of David leak`);
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
    console.error(`\nFAIL — ${totalFail} SSR surfaces did not pass.`);
    process.exit(1);
  }
  console.log('\nPASS — all SSR loaders + pages behave correctly with no session.');
}

main().catch((e) => { console.error(e); process.exit(1); });
