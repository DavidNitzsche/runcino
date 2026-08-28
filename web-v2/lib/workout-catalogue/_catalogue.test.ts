/**
 * lib/workout-catalogue/_catalogue.test.ts · does the catalogue actually say
 * what the doc says?
 *
 * The gate this file supplies, and the reason it reads the real file rather
 * than a fixture: a catalogue transcribed from doctrine can drift from doctrine
 * silently, and the two fabricated citations already found in this codebase
 * were both "a number wearing a research finding's clothes". So:
 *
 *   · COVERAGE is checked against §18, the doc's own name index, parsed at run
 *     time. If someone adds a workout to the doc, this fails until it is in the
 *     catalogue.
 *   · EVERY CITE is checked to be real text in the real file. A quote that no
 *     longer resolves fails here, not in review.
 *   · EVERY SECTION reference is checked to be a real heading.
 *
 * Run: ./node_modules/.bin/vitest run lib/workout-catalogue/_catalogue.test.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { repoRoot } from '@/lib/doctrine/resolve';
import { WORKOUT_CATALOGUE, CROSS_REFERENCES, workoutBySlug } from './catalogue';
import { ALL_DISTANCES, DOCTRINE_PHASES, TIERS } from './types';

const DOC = 'Research/04-workout-vocabulary.md';
const raw = fs.readFileSync(path.join(repoRoot(), DOC), 'utf8');
const lines = raw.split('\n');
const headings = lines.filter((l) => /^#{1,6}\s/.test(l)).map((l) => l.replace(/^#+\s*/, ''));

/** §18's own table, as [name, section] pairs. */
function lookupIndex(): Array<{ name: string; section: string }> {
  const at = lines.findIndex((l) => l.includes('## 18. Workout-name lookup index'));
  expect(at, '§18 is gone from the doc').toBeGreaterThan(-1);
  const out: Array<{ name: string; section: string }> = [];
  for (let i = at + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^#{1,6}\s/.test(l)) break;
    if (!/^\s*\|/.test(l)) continue;
    const cells = l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
    if (cells.length < 2) continue;
    if (/^-+$/.test(cells[0]) || cells[0].toLowerCase() === 'name') continue;
    out.push({ name: cells[0], section: cells[1] });
  }
  return out;
}

describe('WORKOUT CATALOGUE · coverage against the doc', () => {
  it('holds 60 distinct workouts', () => {
    // 59 from Research/04's own tables + VARIETY-R3-1's 400m R repeats, whose
    // dose is read from Research/22's advanced sample weeks (see its entry).
    expect(WORKOUT_CATALOGUE).toHaveLength(60);
  });

  it('has no duplicate slugs', () => {
    const seen = new Map<string, number>();
    for (const e of WORKOUT_CATALOGUE) seen.set(e.slug, (seen.get(e.slug) ?? 0) + 1);
    expect([...seen].filter(([, n]) => n > 1)).toEqual([]);
  });

  it('covers every name in §18, the doc\'s own lookup index', () => {
    const index = lookupIndex();
    // §18 is a real table with real rows · if the parse returns nothing the
    // test is passing vacuously, which is worse than failing.
    expect(index.length).toBeGreaterThanOrEqual(40);

    const sections = new Set(WORKOUT_CATALOGUE.map((e) => e.section));
    const xrefSections = new Set(CROSS_REFERENCES.map((x) => x.at));
    const missing: string[] = [];
    for (const row of index) {
      // A §18 row may name several sections ("§4.4, §11.3"). Covered when ANY
      // of them is a section the catalogue carries, or is a known cross-ref.
      const refs = row.section.split(',').map((s) => s.trim());
      const covered = refs.some((r) => sections.has(r) || xrefSections.has(r));
      if (!covered) missing.push(`${row.name} → ${row.section}`);
    }
    expect(missing, `§18 names workouts the catalogue does not carry:\n  ${missing.join('\n  ')}`).toEqual([]);
  });

  it('every cross-reference resolves to a real entry', () => {
    for (const x of CROSS_REFERENCES) {
      expect(workoutBySlug(x.resolvesTo), `${x.name} → ${x.resolvesTo}`).not.toBeNull();
    }
  });
});

describe('WORKOUT CATALOGUE · every citation still resolves', () => {
  it('every quoted row is verbatim text in Research/04', () => {
    const dead: string[] = [];
    for (const e of WORKOUT_CATALOGUE) {
      for (const cite of e.cites) {
        // Cites that name another doc, or cross-reference another section, are
        // checked by the doctrine lint and the registry rather than here.
        if (cite.startsWith('§') || cite.includes('Research/')) continue;
        if (!raw.includes(cite)) dead.push(`${e.slug}: ${cite}`);
      }
    }
    expect(
      dead,
      'These quotes are no longer in the doc. Re-read the passage and re-transcribe the\n' +
        'entry — do NOT edit the quote to match a number you like.\n  ' +
        dead.join('\n  '),
    ).toEqual([]);
  });

  it('every entry cites at least one row', () => {
    const bare = WORKOUT_CATALOGUE.filter((e) => e.cites.length === 0).map((e) => e.slug);
    expect(bare).toEqual([]);
  });

  it('every section reference is a real heading in the doc', () => {
    const dead: string[] = [];
    for (const e of WORKOUT_CATALOGUE) {
      const n = e.section.replace(/^§/, '');
      const ok = headings.some((h) => new RegExp(`^${n.replace(/\./g, '\\.')}([.\\s)]|$)`).test(h));
      if (!ok) dead.push(`${e.slug} → ${e.section}`);
    }
    expect(dead, `sections that no longer exist:\n  ${dead.join('\n  ')}`).toEqual([]);
  });
});

describe('WORKOUT CATALOGUE · internal shape', () => {
  it('every band runs low to high', () => {
    const bad: string[] = [];
    const check = (slug: string, what: string, lo: number, hi: number) => {
      if (!(lo <= hi)) bad.push(`${slug}.${what}: ${lo} > ${hi}`);
    };
    for (const e of WORKOUT_CATALOGUE) {
      if (e.atPace) check(e.slug, 'atPace', e.atPace.min, e.atPace.max);
      if (e.session) check(e.slug, 'session', e.session.min, e.session.max);
      if (e.warmupCooldownMi) check(e.slug, 'warmupCooldownMi', e.warmupCooldownMi.min, e.warmupCooldownMi.max);
      if (e.cadence) check(e.slug, 'cadence', e.cadence.minDays, e.cadence.maxDays);
      for (const s of e.structures) {
        if (s.kind === 'reps') {
          check(e.slug, 'reps', s.reps.min, s.reps.max);
          check(e.slug, 'rep', s.rep.min, s.rep.max);
          if (s.recoverySec) check(e.slug, 'recoverySec', s.recoverySec.min, s.recoverySec.max);
        }
        if (s.kind === 'continuous') check(e.slug, 'block', s.block.min, s.block.max);
        if (s.kind === 'alternation') check(e.slug, 'cycles', s.cycles.min, s.cycles.max);
      }
    }
    expect(bad).toEqual([]);
  });

  it('every entry declares at least one structure, distance, phase and tier', () => {
    const bad: string[] = [];
    for (const e of WORKOUT_CATALOGUE) {
      if (e.structures.length === 0) bad.push(`${e.slug}: no structure`);
      if (e.distances.length === 0) bad.push(`${e.slug}: no distance`);
      if (e.phases.length === 0) bad.push(`${e.slug}: no phase`);
      if (e.tiers.length === 0) bad.push(`${e.slug}: no tier`);
    }
    expect(bad).toEqual([]);
  });

  it('every distance, phase and tier is a member of its union', () => {
    const bad: string[] = [];
    for (const e of WORKOUT_CATALOGUE) {
      for (const d of e.distances) if (!ALL_DISTANCES.includes(d)) bad.push(`${e.slug}: distance ${d}`);
      for (const p of e.phases) if (!DOCTRINE_PHASES.includes(p)) bad.push(`${e.slug}: phase ${p}`);
      for (const t of e.tiers) if (!TIERS.includes(t)) bad.push(`${e.slug}: tier ${t}`);
    }
    expect(bad).toEqual([]);
  });

  it('a workout prescribed by effort names no clock pace, and vice versa', () => {
    // §8.1's pace column is "5K–10K effort", never a number. An entry that
    // claims both would let the composer hand a runner a flat-ground pace to
    // hold up a 6% grade.
    for (const e of WORKOUT_CATALOGUE) {
      if (e.family === 'hills') {
        expect(e.effortOnly, `${e.slug} is a hill session and must be effort-cued`).toBe(true);
      }
    }
  });

  it('every phase of the cycle has something the catalogue can put in it', () => {
    for (const phase of DOCTRINE_PHASES) {
      const n = WORKOUT_CATALOGUE.filter((e) => e.phases.includes(phase)).length;
      expect(n, `no workout is placed in ${phase}`).toBeGreaterThan(0);
    }
  });

  it('every distance has something at every experience tier', () => {
    for (const d of ALL_DISTANCES) {
      for (const t of TIERS) {
        const n = WORKOUT_CATALOGUE.filter((e) => e.distances.includes(d) && e.tiers.includes(t)).length;
        expect(n, `${d} at ${t} has no workouts at all`).toBeGreaterThan(0);
      }
    }
  });

  it('every convention is spelled out · a silent one is an invention', () => {
    // The rule this enforces: an entry may carry values the doc does not state,
    // but it must SAY SO. These are the entries whose placement or tier came
    // from somewhere other than their own field table.
    for (const slug of [
      'medium-long-run', '1200m-repeats', '800m-repeats', 'descending-ladder',
      'up-and-down-pyramid', 'compressed-pyramid', 'michigan-fartlek',
      'canova-special-block', 'threshold-vo2-combo', 'pre-fatigue-mp-work',
    ]) {
      const e = workoutBySlug(slug)!;
      expect(e.conventions?.length ?? 0, `${slug} borrows from outside its own table and says nothing`).toBeGreaterThan(0);
    }
  });
});
