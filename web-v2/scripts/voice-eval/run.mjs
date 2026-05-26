/**
 * Voice eval runner (P37).
 *
 * Hits /api/briefing for each scenario (manipulating surface + mode
 * query params), captures the returned voice + topic shapes, runs
 * pass/fail checks against scenarios.json contract, prints a report.
 *
 * Lightweight: no Jest, no Vitest. Just node + fetch. Run from
 * `web-v2/` directory:
 *
 *   node scripts/voice-eval/run.mjs [--user 0645f40c-...] [--prod]
 *
 * --prod hits https://www.faff.run; default is http://localhost:3000.
 * Returns exit code 0 on pass, 1 if any scenario fails its asserts.
 *
 * NOT a regression-blocker — smoke-grade. Run after voice / engine /
 * tools / prompts changes.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const PROD = args.includes('--prod');
const userArg = args.find((a) => a.startsWith('--user='));
const USER_ID = userArg ? userArg.slice('--user='.length) : null;

const BASE_URL = PROD ? 'https://www.faff.run' : 'http://localhost:3000';

const scenarios = JSON.parse(fs.readFileSync(path.join(__dirname, 'scenarios.json'), 'utf8'));
console.log(`\n— Voice eval (${scenarios.version}) against ${BASE_URL}\n`);

let passed = 0, failed = 0;

for (const sc of scenarios.scenarios) {
  const url = new URL(`${BASE_URL}/api/briefing`);
  url.searchParams.set('surface', sc.surface);
  if (sc.mode) url.searchParams.set('mode', sc.mode);
  if (USER_ID) url.searchParams.set('user_id', USER_ID);

  process.stdout.write(`[${sc.id}] ${sc.label}… `);
  let body;
  try {
    const r = await fetch(url.toString());
    body = await r.json();
    if (!r.ok) throw new Error(`HTTP ${r.status} ${JSON.stringify(body).slice(0, 200)}`);
  } catch (e) {
    console.log(`× FETCH ${e.message}`);
    failed++;
    continue;
  }

  const voice = String(body.voice ?? '');
  const failures = [];

  // must_avoid: voice should not contain banned phrases
  for (const phrase of sc.must_avoid ?? []) {
    if (voice.toLowerCase().includes(phrase.toLowerCase())) {
      failures.push(`banned phrase: "${phrase}"`);
    }
  }

  // must_cite: voice should mention each required cite
  // (loose match — substrings, case-insensitive)
  for (const cite of sc.must_cite ?? []) {
    if (!voice.toLowerCase().includes(cite.toLowerCase())) {
      // soft — flag as warning, not fail
      failures.push(`missed cite: "${cite}" (soft)`);
    }
  }

  // length sanity
  if (voice.length < 30) failures.push(`voice too short (${voice.length} chars)`);
  if (voice.length > 2000) failures.push(`voice too long (${voice.length} chars)`);

  const hardFails = failures.filter((f) => !f.endsWith('(soft)'));
  if (hardFails.length === 0) {
    console.log(failures.length === 0 ? '✓' : `✓ (${failures.length} soft warn)`);
    passed++;
  } else {
    console.log(`× ${hardFails.length} fail`);
    for (const f of failures) console.log(`    · ${f}`);
    failed++;
  }
}

console.log(`\n— ${passed} passed · ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
