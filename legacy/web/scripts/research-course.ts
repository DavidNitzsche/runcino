#!/usr/bin/env tsx
/**
 * CLI: research a race and write a draft facts file.
 *
 * Usage:
 *   npm run research-course -- --race "California International Marathon" \
 *       [--url https://www.runsra.org/california-international-marathon] \
 *       [--date "first Sunday of December"] \
 *       [--distance 26.22]
 *
 * Requires ANTHROPIC_API_KEY in the environment.
 *
 * Output:
 *   web/data/courses/<slug>.draft.json   (never trusted automatically)
 *   stdout: a review summary the human uses to decide whether to promote
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { researchCourse, auditDraft } from '../lib/course-research';

function arg(name: string, args: string[]): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const raceName = arg('race', args);
  if (!raceName) {
    console.error('Usage: npm run research-course -- --race "<race name>" [--url <url>] [--date <text>] [--distance <mi>]');
    process.exit(1);
  }
  const officialUrl = arg('url', args);
  const typicalDate = arg('date', args);
  const expectedDistanceMi = arg('distance', args) ? Number(arg('distance', args)) : undefined;

  console.log(`Researching: ${raceName}`);
  if (officialUrl) console.log(`  URL hint: ${officialUrl}`);
  console.log('(this makes a live Claude API call with web search — ~30-60s)\n');

  const result = await researchCourse({ raceName, officialUrl, typicalDate, expectedDistanceMi });

  const { warnings, errors } = auditDraft(result.facts);

  const here = dirname(fileURLToPath(import.meta.url));
  const outDir = resolve(here, '..', 'data', 'courses');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, `${result.slug}.draft.json`);
  writeFileSync(outPath, JSON.stringify(result.facts, null, 2), 'utf8');

  console.log(`\nDraft written: ${outPath}`);
  console.log(`\n——— Reasoning ———\n${result.reasoning}\n`);
  if (result.unresolvedQuestions.length) {
    console.log(`——— Unresolved ———`);
    for (const q of result.unresolvedQuestions) console.log(`  • ${q}`);
    console.log();
  }
  if (warnings.length) {
    console.log(`——— Warnings ———`);
    for (const w of warnings) console.log(`  ! ${w}`);
    console.log();
  }
  if (errors.length) {
    console.log(`——— Errors ———`);
    for (const e of errors) console.log(`  ✗ ${e}`);
    console.log();
    process.exit(2);
  }

  console.log(`
Next steps:
  1. Open ${outPath}
  2. Cross-check every phase and landmark against the official race bible
  3. Promote to production: mv ${result.slug}.draft.json ${result.slug}.json
  4. Re-run tests to confirm no schema regressions
`);
}

main().catch(err => {
  console.error('Research failed:', err);
  process.exit(1);
});
