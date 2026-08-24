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

/**
 * Every distance-keyed table literal in the tree, with its per-category values.
 *
 * 2026-08-18 · this used to require the literal `Record<\s*DistCategory\s*,`
 * immediately after the colon, which made it blind to two evasions that were
 * not evasions at all — just other people's ordinary style:
 *
 *   · a WRAPPER. `Readonly<Record<…>>` / `Partial<Record<…>>` put a type
 *     between the colon and the `Record`, and the scanner stopped looking.
 *   · a DIFFERENT TYPE NAME. `RaceDistanceCategory` was the same five-member
 *     union under another name, so nothing keyed to it was ever scanned.
 *
 * Together those hid EIGHT per-distance doctrine tables in
 * lib/race/distance-doctrine.ts — the opening allowance, both HR ceilings, the
 * warm-up protocol, the carb load, the pre-race meal, the on-course carb rate
 * and the caffeine schedule — from all three of the checks below. That file is
 * the one whose header says reading the wrong distance's row wrecks races.
 *
 * The scanner now accepts any number of wrapper generics before the `Record`
 * and any type alias whose name ends in `Category`.
 */
function catTables(): CatTable[] {
  const found: CatTable[] = [];
  for (const file of sourceFiles()) {
    const src = fs.readFileSync(file, 'utf8');
    const decl =
      /(?:export\s+)?const\s+(\w+)\s*:\s*(?:\w+<\s*)*Record<\s*\w*Category\s*,[\s\S]*?=\s*\{/g;
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
    'web-v2/lib/plan/adapt.ts#OVERSHOOT_RACE_RECENCY_DAYS:m==ultra':
      'The same shared doctrine answer as POST_RACE_RECOVERY_WEEKS:m==ultra above, in days ' +
      'rather than weeks: Research/00b gives the marathon 21-28 and the ultras 14-42, and 28 ' +
      'is the marathon ceiling sitting inside the ultra band. ' +
      'RECOVERY.overshoot-race-recency-is-per-distance checks each row against its own band ' +
      'and separately requires the two constants to agree, so a drift in either is caught.',
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
    'web-v2/lib/plan/goal-tiers.ts#BUILD_WINDOW_WEEKS:10k==hm':
      'DOCTRINE-HMWIN-1 (2026-08-17). The two arrive at 12 from different directions and both ' +
      'are read out of the doc. Research/22 §3 publishes `Duration | 12 weeks` for ALL THREE ' +
      'half plans, so the half is pinned to exactly 12 — it has no band to sit anywhere else ' +
      'in. The 10K\'s own plans run 10, 12 and 12-18 weeks, and 12 is the engine\'s choice ' +
      'inside that band. PLANMODE.build-window-fits-doctrine-plan checks each distance against ' +
      'its own headings and fails if either drifts outside them, so the agreement is ' +
      'arithmetic rather than a paste.',
    'web-v2/lib/plan/generate.ts#BLOCK_SHAPE:10k==hm':
      'Research/08 §9.1 gives the 10K a 7-10 day taper and the half 10-14 · both round to the ' +
      'same 2 whole weeks, which is the granularity the block planner works in. ' +
      'TAPER.duration-by-distance checks each against its own doctrine row.',
    'web-v2/lib/plan/generate.ts#BLOCK_SHAPE:m==ultra':
      'Documented at generate.ts:596-599 (#12) — Research/22 §Ultramarathon prescribes a ' +
      'marathon-style 3-week taper, and the race-specific stimulus for an ultra is the long ' +
      'run rather than a pace insert. TAPER.duration-by-distance checks both against their own ' +
      'doctrine rows.',
    'web-v2/lib/training/fitness-trajectory.ts#TAPER_WEEKS_BY_DISTANCE:10k==hm':
      'This table is a client-safe COPY of generate.ts BLOCK_SHAPE.taperWeeks, pinned to it ' +
      'value-for-value by TAPER.trajectory-build-weeks, which also checks each distance against ' +
      'its own Research/08 §9.1 row. The 10K and half share 2 for the same reason BLOCK_SHAPE ' +
      'does: their 7-10 and 10-14 day bands round to the same whole week. The copy exists ' +
      'because fitness-trajectory.ts is imported by a client component and generate.ts imports ' +
      '`pg`.',
    'web-v2/lib/training/fitness-trajectory.ts#TAPER_WEEKS_BY_DISTANCE:m==ultra':
      'Same pinned copy · see TAPER_WEEKS_BY_DISTANCE:10k==hm. Research/22 §Ultramarathon ' +
      'prescribes a marathon-style 3-week taper, which is why BLOCK_SHAPE shares the value too.',
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
    // ── 2026-08-18 · the eight tables the widened scanner can finally see ──
    // Every one of these shares was already in the code; none of them had ever
    // been looked at, because the scanner could not read a
    // `Readonly<Record<RaceDistanceCategory, …>>` declaration.
    'web-v2/lib/race/distance-doctrine.ts#RACE_HR_PCT_LTHR:m==ultra':
      'Research/08 §6.1 publishes FOUR rows — 5K, 10K, Half, Marathon — and no ultra. The ' +
      'engine holds the marathon\'s ceiling, the lowest doctrine states, rather than inventing ' +
      'one for a distance the table does not cover. RACEDAY.hr-ceilings asserts exactly that ' +
      'relationship and fails if the ultra ever drifts to a different number without a doctrine ' +
      'row behind it.',
    'web-v2/lib/race/distance-doctrine.ts#RACE_HR_PCT_MAX:m==ultra':
      'Same missing §6.1 ultra row · see RACE_HR_PCT_LTHR:m==ultra.',
    'web-v2/lib/race/distance-doctrine.ts#RACE_CARB_LOAD:5k==10k':
      'Research/08 §10.1 gives the 5K and the 10K a SINGLE shared row — the label is literally ' +
      '"5K, 10K" — because neither race clears the 90-minute gate the whole protocol is ' +
      'conditioned on. This is doctrine\'s own grouping, not a paste. RACEDAY.carb-load reads ' +
      'that row and separately asserts no two DIFFERENT doctrine rows collapse into one engine ' +
      'category.',
    'web-v2/lib/race/distance-doctrine.ts#RACE_PRERACE_MEAL_G_PER_KG:m==ultra':
      'Research/18 §"Adjustments by event" gives the Marathon and the Ultra byte-identical ' +
      '3-hour meals ("Full (3-4 g/kg)"). The values agree because the doc agrees; ' +
      'RACEDAY.prerace-meal reads each row separately and fails if either drifts.',
    'web-v2/lib/race/distance-doctrine.ts#RACE_CAFFEINE_FRACTIONS:5k==10k':
      'Research/18 §11 gives both the 5K and the 10K "Pre-race only" in the Caffeine plan ' +
      'column — zero on-course positions is doctrine\'s answer for both, not a copied row. ' +
      'RACEDAY.caffeine-schedule reads each row and requires the list to be empty only when ' +
      'the doc says pre-race only.',
    'web-v2/lib/race/distance-doctrine.ts#RACE_CAFFEINE_FRACTIONS:5k==ultra':
      'The two empties mean DIFFERENT things and the engine tracks the difference elsewhere. ' +
      'The 5K takes no on-course caffeine at all; the ultra takes 50-100 mg/hr (§11, 50K row) ' +
      'on an HOURLY schedule, which this positional table cannot express — ' +
      'ULTRA_CAFFEINE_INTERVAL_MIN carries it and caffeineStopIndexes branches on it before ' +
      'ever reading this table. RACEDAY.caffeine-schedule asserts the pairing: an empty ultra ' +
      'list is only acceptable while a real hourly interval exists.',
    'web-v2/lib/race/distance-doctrine.ts#RACE_CAFFEINE_FRACTIONS:10k==ultra':
      'Same pre-race-only vs hourly distinction · see RACE_CAFFEINE_FRACTIONS:5k==ultra.',
    'web-v2/lib/plan/gap-report.ts#RENEGOTIATION_WINDOW_WEEKS:10k==hm':
      'Not a physiology claim · it is how many weeks before race day a goal-renegotiation card ' +
      'surfaces. The 10K and the half share T-3 weeks because the trajectory settles at the ' +
      'same point for both, which the table\'s own header comment has said since it was ' +
      'written. Recorded as an unbound product table in UNBOUND_TABLES for the same reason.',
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
    // (Rule 7, 2026-08-19) · the `goal-tiers.ts#BUILD_WINDOW_WEEKS` entry that
    // used to sit here is DELETED TOO, and it was found by the staleness check
    // added below rather than by anyone reading the list. Its reason said
    // "there is nothing in Research/ to anchor a claim on"; that stopped being
    // true when PLANMODE.build-window-fits-doctrine-plan bound the table to
    // Research/22's own plan durations, and the entry then sat here excusing a
    // table that was already watched. That is precisely how an allowlist rots:
    // nobody re-reads an entry once it has a paragraph attached to it.
    'web-v2/lib/plan/gap-report.ts#RENEGOTIATION_WINDOW_WEEKS':
      'Not a physiology claim · it is a product decision about how many weeks before race day ' +
      'a goal-renegotiation card surfaces. Nothing in Research/ states a renegotiation lead ' +
      'time. Newly visible 2026-08-18 because the table was re-keyed from an inline four-member ' +
      'union to DistCategory — which is also how the missing \'ultra\' key was found: an ultra ' +
      'had been falling through to the marathon\'s window.',
    'web-v2/lib/training/goal-assessment.ts#SHORT_RUNWAY_WEEKS':
      'Not a physiology claim · it is the line under which the goal assessment says "this is a ' +
      'short build" and promises to prioritise arriving healthy. Research/22 publishes plan ' +
      'DURATIONS per distance but states no threshold below which a build stops working, so ' +
      'there is no band to bind. The numbers are the shortest plan each distance has in ' +
      'Research/22, used as a floor rather than a prescription.',
    // (Rule 7, 2026-08-19) · the `web-v2/lib/plan/validate.ts#CONSTRAINTS`
    // entry that used to sit here is DELETED. All four of its fields now carry
    // a claim: taperDropMin/Max by TAPER.validator-band-is-two-sided,
    // longRunWoWMaxPct by LONGRUN.wow-single-step-cap-is-the-injury-red-line,
    // and weeklyVolWoWMaxPct — the last unbound field of a table whose
    // siblings were all bound — by CONVENTION.validator-weekly-step-ceiling.
    // That last one is a labelled convention carrying a recorded violation,
    // which is a different and much better state than an allowlist entry: the
    // gate now reports the divergence on every run instead of excusing it.
  };

  it('every unbound-table entry is still unbound · a bound table must not stay allowlisted', () => {
    const stale: string[] = [];
    for (const key of Object.keys(UNBOUND_TABLES)) {
      const name = key.split('#')[1];
      if (DOCTRINE_REGISTRY.some((c) => c.binds.some((b) => b.includes(name)))) stale.push(key);
    }
    expect(
      stale,
      'These tables now carry a registry claim, so their allowlist entry is excusing nothing and\n' +
        'is the kind of stale exemption the gate exists to surface. Delete them.\n  ' +
        stale.join('\n  '),
    ).toEqual([]);
  });

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
      // (Rule 7, 2026-08-19) · `Research/04 §quality-density` is DELETED from
      // this list. Its last user was the simulator's quality-density risk
      // flag, which is now re-pointed at Research/00a §"Workout dose by race
      // distance" — a heading that exists, and the same one
      // QUALITY.sessions-per-week reads to establish the three-session ceiling
      // the flag fires at. The list shrinks by one; it may not grow.
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
    //
    // ── THE SHORT FORM WAS NOT BEING CHECKED (2026-08-21) ──────────────────
    //
    // `CITE` requires the `.md`, so `Research/00a §312` matched nothing here.
    // It also matched nothing in the line-number check below, which looks for
    // a COLON (`Research/00a:312`). A line number written with a § therefore
    // slipped between the two checks, and four of them were sitting in
    // lib/plan/generate.ts: `§308`, `§309`, `§311`, `§312` — the 10K, half,
    // 50K and 100K rows of a table that has no numbered sections at all.
    //
    // Their CONTENT was accurate, which is exactly why this matters: nothing
    // was going to catch them until someone inserted a paragraph in Research/
    // and the anchors silently came to mean four different rows. That is the
    // failure Rule 7 forbids line-number citations to prevent.
    //
    // Short-form citations are now resolved through the same heading check.
    const SHORT_CITE = /Research\/([0-9]{2}[a-z]?|[0-9]{2})\s+§(\d+(?:\.\d+)*)/g;
    // A gate that extracts nothing and reports "all clean" is worse than no
    // gate. This one is the reason the four above went unseen for months, so
    // it says out loud how many citations it actually looked at.
    let shortSeen = 0;
    const shortToDoc = new Map<string, string>();
    for (const d of docs) {
      const stem = d.match(/^([0-9]{2}[a-z]?)-/)?.[1];
      if (stem) shortToDoc.set(stem, d);
    }
    for (const file of sourceFiles()) {
      const src = fs.readFileSync(file, 'utf8');
      src.split('\n').forEach((line, i) => {
        for (const m of line.matchAll(SHORT_CITE)) {
          shortSeen++;
          const doc = shortToDoc.get(m[1]);
          if (!doc) {
            dead.push(`${rel(file)}:${i + 1}  Research/${m[1]} §${m[2]}  (no such doc)`);
            continue;
          }
          const key = `Research/${doc} §${m[2]}`;
          if (KNOWN_UNANCHORED.has(key)) continue;
          const heads = headingsOf.get(doc) ?? [];
          const ok = heads.some((h) =>
            new RegExp(`^(section )?${m[2].replace(/\./g, '\\.')}([.\\s)—-]|$)`).test(h),
          );
          if (!ok) dead.push(`${rel(file)}:${i + 1}  Research/${m[1]} §${m[2]}  (no such section — a line number?)`);
        }
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
      shortSeen,
      'the short-form §citation extractor matched nothing · it has stopped reading the source ' +
        'and every "no such section" it is not reporting is invisible again',
    ).toBeGreaterThan(100);
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
  // 2026-08-17 · WORKED THROUGH TO ZERO. All 25 were opened one at a time and
  // resolved into one of three outcomes:
  //
  //   · RE-POINTED (21) · the passage is real and Research/ already covered it,
  //     so the citation now names the file. Cutback depth and cadence, post-race
  //     duration, race-week easy durations, the maintenance shape, the long-run
  //     validator caps, the VDOT table, the plan-mode machine.
  //
  //   · RELABELLED AS CONVENTION (4 · adaptive-ramp, the post-deload re-entry
  //     cap, and both simulator citations) · the passage does not check out, and
  //     the behaviour is ours rather than doctrine's. Handled the way the
  //     cold-start anchor was: honest label, plus a claim asserting the
  //     properties the number actually owes. The simulator's whole fitness-
  //     response model is the big one — its VDOT-response-curve citation was
  //     fabricated in exactly the same shape as the anchor was, and had been
  //     projecting every runner's trajectory under it.
  //
  // Three engine-vs-doctrine divergences surfaced while binding the re-pointed
  // ones. All THREE were reported, not moved — each is an `exempt` key on its
  // claim, with the reason: BUILD_WINDOW_WEEKS.hm (14 wk vs Research/22's 12-wk
  // half plans), MAINTENANCE_BY_TIER daysPerWeek (5-7 vs §7's 3-4), and the
  // race-week T-3 easy (flat 35 min vs the marathon template's 0-30).
  //
  // An entry may not come back without somebody saying which of the three it is.
  const BOOK_CITATIONS_PER_FILE: Record<string, number> = {};

  /**
   * E · BARE ATTRIBUTION. The check below counts citations written as `Cite:`.
   * That is how the 0.5 VDOT/week fabrication in goal-gap.ts survived the
   * 2026-08-17 sweep for two months: it was written `Per Daniels: realistic
   * VDOT change in 1 week is ~0.5 pts`, with no `Cite:` anywhere on the line,
   * so nothing looked at it. It was not decorative — it justified the ladder
   * that decided whether a runner was told their goal was still reachable.
   *
   * Attribution is attribution however it is phrased. A comment that leans on
   * a named authority is making a citation and gets counted like one.
   */
  const BARE_ATTRIBUTIONS_PER_FILE: Record<string, number> = {};

  it('no comment attributes a number to a named authority without a citation', () => {
    const RE = /\b(?:per|according to|says|recommends)\s+(?:Daniels|Pfitzinger|Lydiard|Magness|Hudson)\b/i;
    const counts: Record<string, number> = {};
    for (const file of sourceFiles()) {
      const relPath = path.relative(path.join(repoRoot(), 'web-v2'), file);
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!/^\s*(\/\/|\*|\/\*)/.test(line)) continue; // comments only
        // A phrase inside backticks is being QUOTED, not asserted — that is
        // how a comment names the bad citation it is replacing. Strip quoted
        // spans before looking, so writing down what went wrong is allowed
        // and only a live attribution counts.
        const live = line.replace(/`[^`]*`/g, ' ');
        if (!RE.test(live)) continue;
        if (/Research\/|docs\/|Design\//.test(line)) continue; // carries a real pointer
        counts[relPath] = (counts[relPath] ?? 0) + 1;
      }
    }
    expect(
      counts,
      'A comment credits a named coach for a number with nothing to open. That is a citation\n' +
        'wearing plain clothes, and it is how "Per Daniels: realistic VDOT change in 1 week is\n' +
        '~0.5 pts" — a figure that appears nowhere in Research/ — spent two months deciding\n' +
        'whether runners were told their goal was reachable. Point it at the passage, or say\n' +
        'plainly that the number is ours.',
    ).toEqual(BARE_ATTRIBUTIONS_PER_FILE);
  });

  /**
   * F · LINE-NUMBER CITATIONS. Rule 7 opens with the rule and the reason:
   * "Anchor on quoted text, never a line number. Line numbers rot on the next
   * edit — the incident's own bug report cites `00b:196-204`, which is already
   * fragile."
   *
   * A `Research/05:407` reads like a citation and behaves like decoration.
   * Check D above happily resolves it, because the regex stops at the colon
   * and only ever sees `Research/05` — so the file exists, the check passes,
   * and the thing a human would actually open is a line that has since moved.
   * Every other guard in this file is blind to it in the same way.
   *
   * A CEILING, not an equality, and deliberately so. `BOOK_CITATIONS_PER_FILE`
   * above is an equality because it was worked to zero in one sitting; this
   * inventory starts at ~190 across 38 files, most of them owned by whoever is
   * mid-flight in `generate.ts` or `adapt.ts`. An equality would fail the
   * moment somebody CLEANED one up, which teaches exactly the wrong lesson.
   * So: a file may never grow past its recorded count, and a file not listed
   * here may have none at all. Shrinking is free; every entry that reaches
   * zero should be deleted.
   *
   * Counted per FILE, never per line, for the reason the book check gives:
   * moving a citation must stay free, and ADDING one must cost a conversation.
   */
  const LINE_CITATIONS_PER_FILE: Record<string, number> = {
    // Seeded 2026-08-19 from the tree as it stood · 130 across 20 files.
    // lib/plan/injury-protocols.ts (34 line references), lib/coach/
    // heat-acclimatization.ts (19) and lib/coach/strength-load.ts (2) were taken
    // to ZERO in the same change and are absent from this list on purpose — a
    // file at zero is not listed, so it cannot creep back to one.
    //
    // lib/plan/generate.ts and lib/plan/adapt.ts are half the remaining total
    // between them and are the obvious next two to clear.
    'lib/plan/generate.ts': 29,
    'lib/plan/adapt.ts': 24,
    // 2026-08-21 · heat-gate.ts taken from 17 to ZERO. Its eight thresholds
    // now carry registry claims (HEAT.acclimation-dose-thresholds,
    // .time-on-feet-triggers, .hard-bail-triggers) that read the numbers out
    // of Research/06's own tables, so the line references had nothing left to
    // do. A file at zero is not listed, so it cannot creep back to one.
    'lib/plan/spec-builder.ts': 12,
    'lib/coach/strength-recommender.ts': 11,
    'lib/plan/injury-builder.ts': 7,
    'lib/training/vdot.ts': 6,
    'lib/plan/goal-tiers.ts': 4,
    'lib/plan/strip-citations.ts': 3,
    'lib/plan/validate.ts': 3,
    'lib/plan/mutate.ts': 2,
    'lib/plan/recompute-paces.ts': 2,
    'lib/training/prescriptions.ts': 2,
    'lib/training/race-conditions.ts': 2,
    'lib/coach/glance-state.ts': 1,
    'lib/coach/state-loader.ts': 1,
    'lib/coach/weather-adjust.ts': 1,
    'lib/onboarding/state.ts': 1,
    'lib/plan/intensity-distribution.ts': 1,
    'lib/today/post-race-composition.ts': 1,
  };

  it('no file grows a new line-number citation · Rule 7 forbids them outright', () => {
    const RE = /Research\/[0-9]{2}[A-Za-z-]*(?:\.md)?:[0-9]+/g;
    const counts: Record<string, number> = {};
    for (const file of sourceFiles()) {
      const relPath = path.relative(path.join(repoRoot(), 'web-v2'), file);
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        // Same backtick rule as the two checks above: a comment QUOTING the
        // line reference it just deleted is not making one.
        const live = line.replace(/`[^`]*`/g, ' ');
        const n = [...live.matchAll(RE)].length;
        if (n > 0) counts[relPath] = (counts[relPath] ?? 0) + n;
      }
    }
    const grown: string[] = [];
    for (const [file, n] of Object.entries(counts)) {
      const ceiling = LINE_CITATIONS_PER_FILE[file] ?? 0;
      if (n > ceiling) grown.push(`${file}: ${n} (recorded ceiling ${ceiling})`);
    }
    expect(
      grown,
      'A citation written as a LINE NUMBER points at something that moves. Rule 7: "Anchor on\n' +
        'quoted text, never a line number." Every Research/ doc numbers its headings — cite the\n' +
        'section, or quote the sentence. If the number matters, put it in a registry claim that\n' +
        'parses it out of the doc at run time.\n  ' +
        grown.join('\n  '),
    ).toEqual([]);
  });

  it('every book-only citation is counted · an uncounted one is verified by nothing', () => {
    const BOOKS = /(Daniels|Pfitzinger|Lydiard|Magness|Hudson|Running Formula|Advanced Marathoning|Faster Road Racing)/;
    const counts: Record<string, number> = {};
    for (const file of sourceFiles()) {
      const rel = path.relative(path.join(repoRoot(), 'web-v2'), file);
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        // Same backtick rule as the bare-attribution check above: a comment
        // that quotes `Cite:` while explaining a citation it deleted is not
        // itself making one.
        const live = line.replace(/`[^`]*`/g, ' ');
        if (!/\b[Cc]ite:/.test(live)) continue;
        if (/Research\/|docs\/|Design\//.test(line)) continue;
        if (!BOOKS.test(live)) continue;
        counts[rel] = (counts[rel] ?? 0) + 1;
      }
    }
    expect(counts).toEqual(BOOK_CITATIONS_PER_FILE);
  });

  /**
   * 2026-08-21 · A CONSTANT THAT SAYS WHO WATCHES IT MUST BE TELLING THE TRUTH.
   *
   * Engine files write `Watched by \`AREA.claim-id\`` beside a constant, which
   * is the first thing anyone reads when deciding whether a number is safe to
   * change. Every one of the five in easy-discipline.ts named a claim that does
   * not exist — the claims had been renamed (PACE.easy-hr-ceiling-observational
   * → EASY.hr-ceiling-observational, and four more of the same shape) and the
   * file was never updated.
   *
   * The constants really were watched, so nothing was unguarded. What was
   * broken is the thing a person uses to FIND the guard, and a pointer that
   * resolves to nothing reads exactly like a constant nobody is watching. Both
   * failure directions are bad: an unwatched constant claiming a watcher, and a
   * watched constant whose watcher cannot be found.
   */
  it('every "Watched by" reference names a claim that exists', () => {
    const ids = new Set(DOCTRINE_REGISTRY.map((c) => c.id));
    const RE = /[Ww]atched by `([A-Z][A-Z0-9]*\.[a-z0-9-]+)`/g;
    const dead: string[] = [];
    let seen = 0;
    for (const file of sourceFiles()) {
      if (file.includes(`${path.sep}doctrine${path.sep}`)) continue;
      fs.readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          for (const m of line.matchAll(RE)) {
            seen++;
            if (!ids.has(m[1])) dead.push(`${rel(file)}:${i + 1}  ${m[1]}`);
          }
        });
    }
    // Same anti-no-op guard as the short-form citation check: a matcher that
    // matches nothing reports every file clean.
    expect(seen, 'the "Watched by" matcher found no references at all · it has stopped reading').toBeGreaterThan(0);
    expect(
      dead,
      'These comments name a doctrine claim that is not in the registry. Either the claim was\n' +
        'renamed (re-point the comment at its current id) or it never existed (the constant is\n' +
        'unwatched and needs a claim, not a comment saying it has one).\n  ' +
        dead.join('\n  '),
    ).toEqual([]);
  });

});
