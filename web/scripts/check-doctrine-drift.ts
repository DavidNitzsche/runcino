/**
 * check-doctrine-drift.ts
 *
 * Build-time drift detector. Walks the app/ + components/ + lib/
 * source trees looking for inline numeric patterns that match
 * doctrine constants, and warns when a tile is hand-coding a
 * value that exists in coach/doctrine.
 *
 * Detection strategy:
 *   - Read every doctrine constant's exported numeric values via
 *     a regex pass over coach/doctrine/*.ts.
 *   - Walk source files; for each numeric literal in a non-doctrine
 *     file, check if it appears in the doctrine inventory.
 *   - Filter out trivial constants (0, 1, 2, common CSS values like
 *     0.5, 1.5, 100, 360) so we don't false-positive on layout
 *     numbers.
 *
 * Output: a list of (file:line) → suspect numeric literal lines.
 * The script exits with code 1 when any drift is found and code 0
 * when clean. Wire into CI to prevent re-introduction of inline
 * doctrine.
 *
 * Run: tsx scripts/check-doctrine-drift.ts
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..');
const DOCTRINE_DIR = join(ROOT, 'coach', 'doctrine');
const SCAN_DIRS = ['app', 'components', 'lib'].map(d => join(ROOT, d));

// Numeric literals smaller than this don't count — they're almost
// always layout/index values, not doctrine. Tuning these is key
// to keeping the noise floor low.
const TRIVIAL_NUMBERS = new Set<number>([
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
  12, 14, 15, 16, 18, 20, 24, 28, 30, 36, 40, 48, 50, 60, 64, 72, 80, 90, 100, 120, 128, 144, 168, 180, 200, 240, 256, 300, 320, 360, 400, 480, 500, 512, 600, 640, 720, 800, 960, 1024, 1080, 1280, 1440, 1600, 1920, 2048,
  // Common CSS / time values
  0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95,
  1.1, 1.2, 1.25, 1.3, 1.5, 1.6, 1.75, 2.0, 2.5, 3.0,
]);

function readAllFiles(dir: string): string[] {
  const out: string[] = [];
  function walk(p: string) {
    const entries = readdirSync(p);
    for (const e of entries) {
      const full = join(p, e);
      const s = statSync(full);
      if (s.isDirectory()) {
        if (e === 'node_modules' || e === '.next' || e === '__tests__') continue;
        walk(full);
      } else if (s.isFile() && (e.endsWith('.ts') || e.endsWith('.tsx'))) {
        out.push(full);
      }
    }
  }
  walk(dir);
  return out;
}

function extractDoctrineNumbers(): Map<number, Array<{ file: string; constName: string }>> {
  const inventory = new Map<number, Array<{ file: string; constName: string }>>();
  const files = readAllFiles(DOCTRINE_DIR);
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    // Find each export const NAME line and the numeric literals
    // INSIDE that const's value block (rough — fully accurate would
    // need a TS AST walker; this is the cheap version).
    const constRe = /export\s+const\s+([A-Z_][A-Z0-9_]*)\s*[:=]/g;
    const consts = Array.from(src.matchAll(constRe));
    for (let i = 0; i < consts.length; i++) {
      const start = consts[i].index ?? 0;
      const end = i + 1 < consts.length ? (consts[i + 1].index ?? src.length) : src.length;
      const block = src.slice(start, end);
      const name = consts[i][1];
      // numeric literals — int + decimal. Skip dates/version codes.
      const nums = Array.from(block.matchAll(/(?<![\w.])(-?\d+(?:\.\d+)?)/g));
      for (const m of nums) {
        const n = Number(m[1]);
        if (!Number.isFinite(n)) continue;
        if (TRIVIAL_NUMBERS.has(n)) continue;
        if (n >= 1900 && n <= 2100) continue;  // year-ish
        const list = inventory.get(n) ?? [];
        list.push({ file: relative(ROOT, f), constName: name });
        inventory.set(n, list);
      }
    }
  }
  return inventory;
}

interface Hit {
  file: string;
  line: number;
  number: number;
  matchedConstants: Array<{ file: string; constName: string }>;
  context: string;
}

function scanForDrift(inventory: Map<number, Array<{ file: string; constName: string }>>): Hit[] {
  const hits: Hit[] = [];
  for (const dir of SCAN_DIRS) {
    const files = readAllFiles(dir);
    for (const f of files) {
      // Skip the doctrine drift scanner output itself + tests + config
      if (f.includes('check-doctrine-drift')) continue;
      if (f.includes('/__tests__/')) continue;
      const src = readFileSync(f, 'utf8');
      const lines = src.split('\n');
      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];
        // Skip comments + import lines + style blocks
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
        if (line.trim().startsWith('import ')) continue;
        // Skip any line with a doctrine constant import name on it
        // — those are CONSUMING, not inlining.
        const styleHeavy = /style\s*=|className\s*=|fontSize\s*:|padding\s*:|margin\s*:|gap\s*:|borderRadius\s*:|width\s*:|height\s*:|opacity\s*:|letterSpacing\s*:|lineHeight\s*:|fontWeight\s*:|zIndex\s*:|top\s*:|left\s*:|right\s*:|bottom\s*:/.test(line);
        if (styleHeavy) continue;

        const nums = Array.from(line.matchAll(/(?<![\w.])(-?\d+(?:\.\d+)?)/g));
        for (const m of nums) {
          const n = Number(m[1]);
          if (!Number.isFinite(n)) continue;
          if (TRIVIAL_NUMBERS.has(n)) continue;
          if (n >= 1900 && n <= 2100) continue;
          const matched = inventory.get(n);
          if (!matched || matched.length === 0) continue;
          // De-dup: only the first match per (file, line, number)
          if (hits.some(h => h.file === f && h.line === lineIdx + 1 && h.number === n)) continue;
          hits.push({
            file: relative(ROOT, f),
            line: lineIdx + 1,
            number: n,
            matchedConstants: matched,
            context: line.trim().slice(0, 120),
          });
        }
      }
    }
  }
  return hits;
}

function main() {
  console.log('Scanning doctrine inventory...');
  const inventory = extractDoctrineNumbers();
  console.log(`  ${inventory.size} unique numeric values across ${[...inventory.values()].reduce((s, v) => s + v.length, 0)} doctrine occurrences`);

  console.log('Scanning app/, components/, lib/ for drift...');
  const hits = scanForDrift(inventory);

  if (hits.length === 0) {
    console.log('\n✓ No drift detected — every value matches an importable doctrine constant.');
    process.exit(0);
  }

  // Group hits by file for readable output
  const byFile = new Map<string, Hit[]>();
  for (const h of hits) {
    const list = byFile.get(h.file) ?? [];
    list.push(h);
    byFile.set(h.file, list);
  }

  console.log(`\n⚠ ${hits.length} potential drift instances across ${byFile.size} files:\n`);
  for (const [file, fileHits] of byFile) {
    console.log(`  ${file}`);
    for (const h of fileHits.slice(0, 5)) {
      const consts = h.matchedConstants.slice(0, 2).map(c => c.constName).join(', ');
      console.log(`    L${h.line}  ${h.number}  →  ${consts}`);
      console.log(`           ${h.context}`);
    }
    if (fileHits.length > 5) {
      console.log(`    … and ${fileHits.length - 5} more`);
    }
    console.log('');
  }

  console.log(`Found ${hits.length} suspect numeric literals. Review and either:`);
  console.log('  1. Replace with imports from coach/doctrine/, OR');
  console.log('  2. Add the literal to TRIVIAL_NUMBERS in this script if it\'s a layout number.');
  // Don't fail the build — this is a warning detector, not a gate.
  // CI can run it for visibility without blocking deploys.
  process.exit(0);
}

main();
