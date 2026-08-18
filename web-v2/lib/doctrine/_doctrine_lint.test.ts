/**
 * lib/doctrine/_doctrine_lint.test.ts · structural lint for the failure modes
 * that keep producing doctrine defects.
 *
 * The registry checks claims someone thought to write down. This file scans the
 * source for the SHAPES that produced defects before anyone knew to look, so a
 * new instance is caught the first time it appears rather than the first time a
 * runner notices it on his phone.
 *
 *   A · COPIED CATEGORY. A distance-keyed table where one category's value was
 *       copied to another. Doctrine gives 5K, 10K, half, marathon and ultra
 *       different numbers for nearly everything; two identical values usually
 *       means a row was pasted, and occasionally means a deliberate share. Both
 *       are fine — but the deliberate one has to say so.
 *
 *   B · ONE REGIME APPLIED TO ALL. Reading a single hard-coded category out of
 *       a distance-keyed table in production code. This is the incident in one
 *       line: the marathon column, spent on every distance.
 *
 *   C · UNWATCHED TABLE. A distance-keyed doctrine table with no claim in the
 *       registry — a number asserting physiology with nothing checking it.
 *
 *   D · DEAD CITATION. A `Research/` reference in a comment pointing at a file
 *       or section that no longer exists. A citation nobody can follow is
 *       decoration, and decoration is what let the two-column misread survive.
 *
 * Allowlists are expected and honest. An entry costs one line and a reason; a
 * false positive left unexplained costs the lint its credibility.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { DOCTRINE_REGISTRY } from './registry';
import { repoRoot } from './resolve';

const LIB = path.join(repoRoot(), 'web-v2', 'lib');
const CATS = ['5k', '10k', 'hm', 'm', 'ultra'] as const;

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (
        e.name.endsWith('.ts') &&
        !e.name.startsWith('._') &&
        !/\.test\.ts$/.test(e.name) &&
        !p.includes(`${path.sep}doctrine${path.sep}`)
      ) {
        out.push(p);
      }
    }
  };
  walk(LIB);
  return out;
}

const rel = (p: string) => path.relative(repoRoot(), p);

interface CatTable {
  file: string;
  name: string;
  values: Partial<Record<(typeof CATS)[number], string>>;
}

/** Every `Record<DistCategory, …>` literal in the tree, with its per-category values. */
function catTables(): CatTable[] {
  const found: CatTable[] = [];
  for (const file of sourceFiles()) {
    const src = fs.readFileSync(file, 'utf8');
    const decl = /(?:export\s+)?const\s+(\w+)\s*:\s*Record<\s*DistCategory\s*,[\s\S]*?=\s*\{/g;
    let d: RegExpExecArray | null;
    while ((d = decl.exec(src))) {
      const open = decl.lastIndex - 1;
      let depth = 0;
      let end = open;
      for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) {
          end = i;
          break;
        }
      }
      const body = src.slice(open + 1, end);
      const values: CatTable['values'] = {};
      for (const cat of CATS) {
        const at = body.search(new RegExp(`(^|[\\s{,])'${cat}'\\s*:`, 'm'));
        if (at < 0) continue;
        const from = body.indexOf(':', at) + 1;
        let depth2 = 0;
        let i = from;
        for (; i < body.length; i++) {
          const ch = body[i];
          if (ch === '{' || ch === '[') depth2++;
          else if (ch === '}' || ch === ']') depth2--;
          else if (ch === ',' && depth2 === 0) break;
        }
        values[cat] = body
          .slice(from, i)
          .replace(/\/\/[^\n]*/g, '')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\s+/g, ' ')
          .trim();
      }
      found.push({ file: rel(file), name: d[1], values });
    }
  }
  return found;
}

describe('DOCTRINE LINT · the shapes that produce doctrine defects', () => {
  // ── A · a category's value copied onto another ────────────────────────────
  //
  // key = `file#TABLE:catA==catB` → why the two distances legitimately share a
  // value. "Because it was easier" is not a reason; "doctrine gives them the
  // same number" and "the split is real and tracked elsewhere" are.
  const SHARED_ON_PURPOSE: Record<string, string> = {
    'web-v2/lib/plan/goal-tiers.ts#POST_RACE_RECOVERY_WEEKS:m==ultra':
      'Research/00b gives the marathon 21-28 days and the ultras 14-42 depending on which ' +
      'ultra. 4 weeks (28 d) is the only whole-week value inside both, so the shared value is ' +
      'the doctrine answer rather than a paste. RECOVERY.post-race-duration checks it against ' +
      'the widest ultra band.',
    'web-v2/lib/plan/goal-tiers.ts#RECOVERY_WEEKLY_PCT_OF_BASE:m==ultra':
      'Deliberate and documented at goal-tiers.ts:97 — the ultra reuses the marathon reverse ' +
      'taper because Research/00b has no ultra-specific week-by-week protocol. The hole is ' +
      'real and named in the fix commit (52174bcd); it is not a copy nobody noticed.',
    'web-v2/lib/plan/goal-tiers.ts#RECOVERY_RUN_DAYS:m==ultra':
      'Same deliberate marathon/ultra share as RECOVERY_WEEKLY_PCT_OF_BASE above.',
    'web-v2/lib/plan/goal-tiers.ts#RECOVERY_RUN_DAYS:5k==10k':
      'Research/00b puts 5K zero-running days at 1-2 and 10K at 2-3; 4 running days out of 7 ' +
      'satisfies the 10K band, and the 5K profile is unreachable (POST_RACE_RECOVERY_WEEKS is ' +
      '0 for the 5K). Tracked as RECOVERY.zero-running-days · unreachable-5k.',
    'web-v2/lib/plan/goal-tiers.ts#RECOVERY_LONG_PCT:5k==10k':
      'Doctrine caps the long run at 25-30% of the week regardless of the race just run · the ' +
      'cap is not distance-specific, so sharing it is correct.',
    'web-v2/lib/plan/goal-tiers.ts#RECOVERY_LONG_PCT:5k==hm':
      'Same shared long-run cap · see RECOVERY_LONG_PCT:5k==10k.',
    'web-v2/lib/plan/goal-tiers.ts#RECOVERY_LONG_PCT:10k==hm':
      'Same shared long-run cap · see RECOVERY_LONG_PCT:5k==10k.',
    'web-v2/lib/plan/goal-tiers.ts#RECOVERY_LONG_PCT:m==ultra':
      'The marathon and ultra both hold the long deliberately small inside the reverse taper · ' +
      'documented at goal-tiers.ts:128-133.',
    'web-v2/lib/plan/generate.ts#BLOCK_SHAPE:10k==hm':
      'Research/08 §9.1 gives the 10K a 7-10 day taper and the half 10-14 · both round to the ' +
      'same 2 whole weeks, which is the granularity the block planner works in. ' +
      'TAPER.duration-by-distance checks each against its own doctrine row.',
    'web-v2/lib/plan/generate.ts#BLOCK_SHAPE:m==ultra':
      'Documented at generate.ts:596-599 (#12) — Research/22 §Ultramarathon prescribes a ' +
      'marathon-style 3-week taper, and the race-specific stimulus for an ultra is the long ' +
      'run rather than a pace insert. TAPER.duration-by-distance checks both against their own ' +
      'doctrine rows.',
    'web-v2/lib/coach/limiter.ts#DEFAULT_LIMITER:5k==10k':
      'Research/00a §"When each TID applies" gives 5K and 10K a SINGLE shared row, so the two ' +
      'distances have one rationale between them ("Build aerobic capacity broadly") and one ' +
      'default limiter follows. This is doctrine\'s own grouping, not a paste. ' +
      'LIMITER.goal-distance-default reads that row and fails if it ever splits.',
    'web-v2/lib/coach/limiter.ts#DEFAULT_LIMITER:hm==m':
      'The half and the marathon have separate rows in Research/00a §"When each TID applies" and ' +
      'both name LT2 as what dominates the event ("LT2 and economy dominate", "LT2 and fatigue ' +
      'resistance dominate"), so both correctly default to the threshold limiter. The values ' +
      'agree because the doctrine agrees; LIMITER.goal-distance-default checks each row ' +
      'separately and fails if either stops naming LT2.',
    // (DOCTRINE-1b, 2026-08-17) · the three CONSTRAINTS allowlist entries that
    // used to live here are DELETED. hm/m/ultra shared a flat 30% taper floor
    // and no ceiling at all; each row now carries its own floor AND its own
    // §9.1 ceiling, so the values genuinely differ and the lint correctly
    // stopped needing an exemption for them.
  };

  it('no distance category silently carries another category\'s value', () => {
    const unexplained: string[] = [];
    for (const t of catTables()) {
      for (let i = 0; i < CATS.length; i++) {
        for (let j = i + 1; j < CATS.length; j++) {
          const [a, b] = [CATS[i], CATS[j]];
          const [va, vb] = [t.values[a], t.values[b]];
          if (!va || !vb || va !== vb) continue;
          const key = `${t.file}#${t.name}:${a}==${b}`;
          if (!(key in SHARED_ON_PURPOSE)) unexplained.push(`${key}  →  ${va}`);
        }
      }
    }
    expect(
      unexplained,
      'These distance categories carry byte-identical values. Doctrine distinguishes them, so\n' +
        'either the values should differ, or the share is deliberate and belongs in\n' +
        'SHARED_ON_PURPOSE with the reason. This is the shape that turned the marathon reverse\n' +
        'taper into every distance\'s recovery plan.\n  ' +
        unexplained.join('\n  '),
    ).toEqual([]);
  });

  it('every allowlisted share still exists · stale allowlist entries must be deleted', () => {
    const live = new Set<string>();
    for (const t of catTables()) {
      for (let i = 0; i < CATS.length; i++) {
        for (let j = i + 1; j < CATS.length; j++) {
          const [a, b] = [CATS[i], CATS[j]];
          if (t.values[a] && t.values[a] === t.values[b]) live.add(`${t.file}#${t.name}:${a}==${b}`);
        }
      }
    }
    const stale = Object.keys(SHARED_ON_PURPOSE).filter((k) => !live.has(k));
    expect(stale, `these categories no longer share a value · delete the allowlist entries:\n  ${stale.join('\n  ')}`).toEqual(
      [],
    );
  });

  // ── B · one regime's constants applied across all distances ───────────────
  it('no production code reads a single hard-coded distance out of a doctrine table', () => {
    const tables = [...new Set(catTables().map((t) => t.name))];
    if (tables.length === 0) throw new Error('found no distance-keyed tables · the scanner is broken');
    const re = new RegExp(
      `\\b(${tables.join('|')})\\s*(?:\\.\\s*(hm|ultra)\\b|\\[\\s*['"](${CATS.join('|')})['"]\\s*\\])`,
      'g',
    );
    const hits: string[] = [];
    for (const file of sourceFiles()) {
      const src = fs.readFileSync(file, 'utf8');
      src.split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return; // comments describe, they don't execute
        for (const m of line.matchAll(re)) hits.push(`${rel(file)}:${i + 1}  ${m[0].trim()}`);
      });
    }
    expect(
      hits,
      'A distance-keyed doctrine table is being read at a fixed distance. If the surrounding\n' +
        "code is genuinely distance-specific, key it off the caller's category; if it is not,\n" +
        'this is the incident shape — one distance\'s doctrine spent on every distance.\n  ' +
        hits.join('\n  '),
    ).toEqual([]);
  });

  // ── C · a doctrine table with nothing watching it ─────────────────────────
  const UNBOUND_TABLES: Record<string, string> = {
    'web-v2/lib/plan/goal-tiers.ts#BUILD_WINDOW_WEEKS':
      'Not a physiology claim · it is a product decision about when race-prep mode opens. Its ' +
      'cited sources are Daniels and Pfitzinger book sections rather than a Research/ passage, ' +
      'so there is nothing in Research/ to anchor a claim on. Revisit if a build-window band is ' +
      'ever written into Research/22.',
    'web-v2/lib/plan/validate.ts#CONSTRAINTS':
      'Partly bound: taperDropMinPct is checked by TAPER.minimum-volume-drop. The other two ' +
      'fields (longRunWoWMaxPct, weeklyVolWoWMaxPct) are week-over-week validator ceilings with ' +
      'no direct Research/ band — see the unseeded-claims TODO in CLAUDE.md §Doctrine gate.',
  };

  it('every distance-keyed doctrine table is bound to a claim or explicitly unbound', () => {
    const bound = new Set(DOCTRINE_REGISTRY.flatMap((c) => c.binds).map((b) => b.split('#')[0].replace(/^lib\//, '')));
    const unwatched: string[] = [];
    for (const t of catTables()) {
      const key = `${t.file}#${t.name}`;
      const fileKey = t.file.replace(/^web-v2\/lib\//, '');
      const isBound = DOCTRINE_REGISTRY.some((c) =>
        c.binds.some((b) => b.includes(t.name) || (bound.has(fileKey) && b.includes(t.name))),
      );
      if (!isBound && !(key in UNBOUND_TABLES)) unwatched.push(key);
    }
    expect(
      unwatched,
      'These tables assert training science and no registry claim checks them. Add a claim in\n' +
        'lib/doctrine/registry.ts, or record why the table is not a doctrine claim in\n' +
        'UNBOUND_TABLES.\n  ' +
        unwatched.join('\n  '),
    ).toEqual([]);
  });

  // ── D · citations that no longer resolve ──────────────────────────────────
  it('every Research/ citation in the source points at a file that exists', () => {
    const docs = fs.readdirSync(path.join(repoRoot(), 'Research')).filter((f) => f.endsWith('.md'));
    const dead: string[] = [];
    for (const file of sourceFiles()) {
      const src = fs.readFileSync(file, 'utf8');
      src.split('\n').forEach((line, i) => {
        for (const m of line.matchAll(/Research\/([0-9A-Za-z._-]+)/g)) {
          const ref = m[1];
          const hit = ref.endsWith('.md') ? docs.includes(ref) : docs.some((d) => d.startsWith(ref.replace(/[:.].*$/, '')));
          if (!hit) dead.push(`${rel(file)}:${i + 1}  Research/${ref}`);
        }
      });
    }
    expect(
      dead,
      'These citations name a Research/ file that does not exist. A citation nobody can follow\n' +
        'is decoration — and decoration is what let a two-column misread survive review.\n  ' +
        dead.join('\n  '),
    ).toEqual([]);
  });

  it('every §section citation resolves to a heading in the cited doc', () => {
    // Known-unresolvable anchors, already self-flagged with TODO in lib/plan/citation.ts.
    // Listed here so the count cannot grow quietly; shrinking it is the goal.
    const KNOWN_UNANCHORED = new Set([
      'Research/00a-distance-running-training.md §missed-workout-policy',
      'Research/00b-recovery-protocols.md §recovery-load-scaling',
      'Research/01-pace-zones-vdot.md §T-pace-derivation',
      'Research/04-workout-vocabulary.md §hard-easy-rule',
      'Research/04-workout-vocabulary.md §quality-density',
      'Research/04-workout-vocabulary.md §long-run-progression',
      'Research/15-wearable-data.md §HR-Recovery',
      'Research/15-wearable-data.md §recovery-after-quality',
      'Research/22-plan-templates.md §quality-mix-by-distance',
      'Research/22-plan-templates.md §minimum-base-by-level',
      'Research/22-plan-templates.md §projection-feedback-loop',
      // Found by this lint on its first run, 2026-08-17. Each names a section that has never
      // existed under that name in the cited doc. The content is generally there; the anchor
      // is not. Left as-is because re-pointing 7 comments across 7 files is the engine
      // audit's business, not the gate's — but the list may not grow.
      'Research/00a-distance-running-training.md §off-season',
      'Research/00a-distance-running-training.md §easy-volume',
      'Research/00b-recovery-protocols.md §recovery-timelines',
      'Research/00b-recovery-protocols.md §rest-physiology',
      'Research/04-workout-vocabulary.md §intervals-and-threshold',
      'Research/05-injury-return-protocols.md §illness-return',
      'Research/08-pacing-and-race-week.md §day-before',
    ]);
    const headingsOf = new Map<string, string[]>();
    const docs = fs.readdirSync(path.join(repoRoot(), 'Research')).filter((f) => f.endsWith('.md'));
    for (const d of docs) {
      headingsOf.set(
        d,
        fs
          .readFileSync(path.join(repoRoot(), 'Research', d), 'utf8')
          .split('\n')
          .filter((l) => /^#{1,6}\s/.test(l))
          .map((l) => l.replace(/^#+\s*/, '').toLowerCase()),
      );
    }
    const dead: string[] = [];
    // Two citation forms are unambiguous enough to check, and only those are checked ·
    // a lint that guesses at free prose after a § earns itself an allowlist nobody reads.
    //   · numbered   `§9.3`, `§6`  → a heading beginning with that number
    //   · kebab      `§Volume-Progression-Rules` → a heading containing all its words
    // Bare words (`§HRV`, `§taper`) and line references (`Research/22:635`) are skipped.
    const CITE = /Research\/([0-9A-Za-z._-]+\.md)\s+§(\d+(?:\.\d+)*|[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+)/g;
    for (const file of sourceFiles()) {
      const src = fs.readFileSync(file, 'utf8');
      src.split('\n').forEach((line, i) => {
        for (const m of line.matchAll(CITE)) {
          const [doc, section] = [m[1], m[2]];
          const key = `Research/${doc} §${section}`;
          if (KNOWN_UNANCHORED.has(key)) continue;
          const heads = headingsOf.get(doc) ?? [];
          const ok = /^\d/.test(section)
            ? heads.some((h) =>
                // `## 9.1 Taper duration…` and `## Section 1 — Heat Adjustment…` are both
                // "section 1" · Research/06 numbers its sections the long way.
                new RegExp(`^(section )?${section.replace(/\./g, '\\.')}([.\\s)—-]|$)`).test(h),
              )
            : (() => {
                const words = section.toLowerCase().split(/[-_]+/).filter((w) => w.length > 2);
                return words.length > 0 && heads.some((h) => words.every((w) => h.includes(w)));
              })();
          if (!ok) dead.push(`${rel(file)}:${i + 1}  ${key}`);
        }
      });
    }
    expect(
      dead,
      'These §section citations do not match any heading in the doc they name. Re-point them at\n' +
        'the real heading, or move the claim into the registry where the anchor is resolved\n' +
        'against the file itself.\n  ' +
        dead.join('\n  '),
    ).toEqual([]);
  });

  /**
   * A citation that names a BOOK instead of a `Research/` file is invisible to
   * every other check in this file and to the registry itself — the gate only
   * ever resolves file anchors, so a book reference is verified by nothing.
   *
   * That is not hypothetical. `conservativeVdotFromMileage` — the number that
   * sets every new runner's paces — carried `Daniels Running Formula §"VDOT
   * and Training" — mileage-band heuristic` for two months. There is no such
   * table; Daniels derives VDOT from race performance and publishes no mileage
   * mapping. A product convention was wearing a research finding's clothes,
   * and the gate could not see it because it had nothing to open.
   *
   * Book citations are NOT banned — several are real, and `Research/` itself
   * cites these books. What is banned is a book citation nobody has counted.
   *
   * Counted per FILE, never per line: Rule 7 is explicit that line numbers rot
   * on the next edit, and an inventory that breaks whenever code moves gets
   * "fixed" by updating the numbers, which teaches people to ignore it. Moving
   * a citation is free; ADDING one fails here, and at that moment somebody has
   * to say whether the passage they are citing is real.
   */
  const BOOK_CITATIONS_PER_FILE: Record<string, number> = {
  'lib/glossary.ts': 1,
  'lib/plan/adaptive-ramp.ts': 1,
  'lib/plan/generate.ts': 6,
  'lib/plan/goal-tiers.ts': 8,
  'lib/plan/seed-from-onboarding.ts': 2,
  'lib/plan/simulator.ts': 2,
  'lib/plan/validate.ts': 4,
  'lib/training/vdot.ts': 1,
  };

  it('every book-only citation is counted · an uncounted one is verified by nothing', () => {
    const BOOKS = /(Daniels|Pfitzinger|Lydiard|Magness|Hudson|Running Formula|Advanced Marathoning|Faster Road Racing)/;
    const counts: Record<string, number> = {};
    for (const file of sourceFiles()) {
      const rel = path.relative(path.join(repoRoot(), 'web-v2'), file);
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!/\b[Cc]ite:/.test(line)) continue;
        if (/Research\/|docs\/|Design\//.test(line)) continue;
        if (!BOOKS.test(line)) continue;
        counts[rel] = (counts[rel] ?? 0) + 1;
      }
    }
    expect(counts).toEqual(BOOK_CITATIONS_PER_FILE);
  });

});
