/**
 * lib/plan/_sublabel_voice.test.ts — a sub_label is a runner-facing name.
 *
 * `displayTypeFor` (lib/faff/v5-today.ts) prefers `sub_label` over the raw
 * type column and title-cases it, so whatever the generator writes becomes
 * the headline on the after-run poster, in 56pt Archivo.
 *
 * Two labels reached production as engine shorthand: `EASY (MEDIUM)` and
 * `LONG (EASY)`, from the recovery-block rebuild path. Both read to a runner
 * as a qualifier on the effort — "easy, but medium?" — which is a
 * contradiction rather than a name. Every other label in the table is either
 * a plain type word (`EASY`, `LONG`, `SHAKEOUT`) or a real prescription
 * (`2 mi WU · 4 mi @ T · 2 mi CD`). Neither form needs a parenthesis.
 *
 * This scans the generator's own source rather than running it, because the
 * two offenders sat on branches that only fire on a recovery block inside a
 * half or 10K plan — reachable, and not reached by any fixture.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SOURCES = ['lib/plan/generate.ts', 'lib/plan/plan-templates.ts', 'lib/plan/injury-builder.ts'];

function subLabelLiterals(rel: string): string[] {
  const file = path.join(process.cwd(), rel);
  let src = '';
  try { src = readFileSync(file, 'utf8'); } catch { return []; }
  const out: string[] = [];
  for (const m of src.matchAll(/subLabel:\s*'([^']*)'/g)) out.push(m[1]);
  for (const m of src.matchAll(/sub_label:\s*'([^']*)'/g)) out.push(m[1]);
  return out;
}

describe('sub_label is a name, not engine shorthand', () => {
  it('extracts a non-trivial number of labels', () => {
    // A scanner that finds nothing and reports clean is worse than no
    // scanner. If this drops to zero the regex has drifted, not the code.
    const all = SOURCES.flatMap(subLabelLiterals);
    expect(all.length).toBeGreaterThan(10);
  });

  it('no label carries a parenthetical qualifier', () => {
    const offenders: Array<{ file: string; label: string }> = [];
    for (const rel of SOURCES) {
      for (const label of subLabelLiterals(rel)) {
        if (/\(|\)/.test(label)) offenders.push({ file: rel, label });
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no label shouts a second type at itself', () => {
    // `LONG (EASY)` was two type words fighting. Catch the shape even
    // without parentheses — "EASY LONG", "LONG EASY".
    const TYPES = ['EASY', 'LONG', 'REST', 'RACE', 'THRESHOLD', 'TEMPO', 'INTERVALS'];
    const offenders: string[] = [];
    for (const rel of SOURCES) {
      for (const label of subLabelLiterals(rel)) {
        const words = label.toUpperCase().split(/[^A-Z-]+/).filter(Boolean);
        const hits = words.filter((w) => TYPES.includes(w));
        if (hits.length > 1) offenders.push(`${rel}: ${label}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
