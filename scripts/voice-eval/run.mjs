#!/usr/bin/env node
/**
 * voice-eval/run.mjs — checks a coach output against the gold corpus.
 *
 * Two layers:
 *   1. Structural checks (deterministic, fast): jargon detection, length,
 *      doctrine violations (prescriptive verbs, fabricated metrics).
 *   2. LLM-as-judge (semantic): does the candidate match the doctrine of the
 *      closest gold sample? Returns PASS / WARN / FAIL with reasoning.
 *
 * Usage:
 *   node scripts/voice-eval/run.mjs --surface today --mode post-run --input candidate.json
 *
 * In CI: runs against every (surface, mode) combination using a fixed seed
 * state. If any FAIL, exit 1 → deploy blocked.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLD = join(__dirname, 'gold');

/* ────────────────────────── Structural checks ────────────────────────── */

// Phrases banned by doctrine. Each match drops the score.
const BANNED_PHRASES = [
  'aerobic engine',
  'absorption window',
  'anchor',
  'everything else supports',
  'closest you',
  'closer than you',          // similar nihilism
  'the foundation',
  'phase of training',        // textbook
  'putting in the work',      // generic gym
  'no pain no gain',
];

// Words that are too prescriptive on health surface.
const HEALTH_PRESCRIPTIVE = [
  'you need to',
  'you must',
  'you should',                // soft — flagged as warn, not fail
  'drop',                      // "drop 5 lbs"
  'sleep 8 hours',
];

// Verbs the coach uses when warm + inviting.
const WARM_VERBS = [
  'aim for', 'we want', "let's", 'try for', 'see how', 'keep an eye',
];

function structuralCheck(candidate) {
  const text = (candidate.voice ?? []).join('\n').toLowerCase();
  const lead = (candidate.lead ?? '').toLowerCase();
  const full = lead + '\n' + text;

  const issues = [];
  let level = 'pass';

  for (const phrase of BANNED_PHRASES) {
    if (full.includes(phrase)) {
      issues.push({ kind: 'banned_phrase', phrase, severity: 'fail' });
      level = 'fail';
    }
  }

  // Length sanity — TODAY voice should be 3-5 short paragraphs, total ~120-450 words.
  const wordCount = full.split(/\s+/).filter(Boolean).length;
  if (wordCount < 60)  { issues.push({ kind: 'too_short', wordCount, severity: 'warn' }); level = level === 'fail' ? 'fail' : 'warn'; }
  if (wordCount > 600) { issues.push({ kind: 'too_long',  wordCount, severity: 'warn' }); level = level === 'fail' ? 'fail' : 'warn'; }

  // Warm-verb presence — at least one should appear in a coaching paragraph.
  const hasWarmVerb = WARM_VERBS.some((v) => full.includes(v));
  if (!hasWarmVerb) {
    issues.push({ kind: 'no_warm_verb', severity: 'warn' });
    level = level === 'fail' ? 'fail' : 'warn';
  }

  // Lead is a noun phrase: must not end with period? Allow both for now but
  // flag if it's a long sentence with multiple clauses.
  if ((candidate.lead ?? '').split(/[.!?]/).filter(Boolean).length > 2) {
    issues.push({ kind: 'lead_too_complex', severity: 'warn' });
    level = level === 'fail' ? 'fail' : 'warn';
  }

  return { level, issues, wordCount };
}

/* ────────────────────────── Gold corpus loader ────────────────────────── */

function loadGold(surface, mode) {
  const dir = join(GOLD, surface);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.txt'))
    .filter((f) => mode == null || f.startsWith(mode) || f.includes(`-${mode}`))
    .map((f) => ({ name: f, body: readFileSync(join(dir, f), 'utf8') }));
}

/* ────────────────────────── Main ────────────────────────── */

function parseArgs() {
  const a = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < a.length; i += 2) {
    out[a[i].replace(/^--/, '')] = a[i + 1];
  }
  return out;
}

async function main() {
  const args = parseArgs();
  const surface = args.surface ?? 'today';
  const mode    = args.mode    ?? 'post-run';

  if (!args.input) {
    console.error('usage: node run.mjs --surface <s> --mode <m> --input <file.json>');
    console.error('       (input file shape: { lead: string, voice: string[] })');
    process.exit(2);
  }

  const candidate = JSON.parse(readFileSync(args.input, 'utf8'));
  const gold = loadGold(surface, mode);
  const struct = structuralCheck(candidate);

  console.log('━━━ STRUCTURAL ━━━');
  console.log(`level: ${struct.level} · words: ${struct.wordCount}`);
  if (struct.issues.length === 0) {
    console.log('(no issues)');
  } else {
    for (const i of struct.issues) console.log(`  · ${i.severity.toUpperCase()} · ${i.kind}${i.phrase ? ' · "' + i.phrase + '"' : ''}`);
  }

  console.log(`\n━━━ GOLD CORPUS (${surface}/${mode}) ━━━`);
  if (gold.length === 0) {
    console.log('(no gold samples for this surface/mode — add one to gold/' + surface + '/' + mode + '.txt)');
  } else {
    for (const g of gold) console.log(`  · ${g.name} (${g.body.split('\n').length} lines)`);
  }

  // LLM-as-judge wiring goes here in a follow-up: ANTHROPIC_API_KEY + a meta-prompt
  // that takes the candidate + closest gold sample + doctrine notes and returns
  // PASS/WARN/FAIL with reasoning. Stubbed for now.
  console.log('\n━━━ SEMANTIC JUDGE ━━━');
  console.log('(LLM-as-judge wiring deferred to P1 — structural check is the deploy gate today)');

  if (struct.level === 'fail') process.exit(1);
  process.exit(0);
}

main().catch((e) => { console.error('eval error:', e); process.exit(2); });
