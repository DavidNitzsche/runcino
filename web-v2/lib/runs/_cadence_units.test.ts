/**
 * lib/runs/_cadence_units.test.ts · `avgCadence` holds two units and the
 * app has to answer in one.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE FAILURE
 *
 * Apple Watch writes `avgCadence` as steps per minute across BOTH FEET.
 * Strava's `average_cadence` for a run is a PER-LEG count — half of it. Both
 * are honest readings of the same foot; the row does not say which it holds.
 *
 * Production, 2026-08-24, over 165 rows carrying the key:
 *
 *     apple_watch   58 rows   median 161 spm   implied stride 1.212 m
 *     watch         48 rows   median 162 spm   implied stride 1.261 m
 *     no source     56 rows   median  78 spm   implied stride 2.601 m
 *     apple_health   1 row           79 spm                   2.678 m
 *
 * A 2.6 m stride is not a running human, and the same runner's watch reports
 * 1.12-1.38 m on the runs either side. His cadence did not halve in May 2026;
 * `pullSync.ts` started doubling on ingest and the 88 rows imported before it
 * did were never revisited. 54 of the 57 affected rows are canonical, so they
 * are what the log, the poster, run detail and the recap have been drawing.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE HOLDS
 *
 *   1. The rule is the row's OWN arithmetic, not a band on the value. The
 *      114 spm row proves why: a band doubles it, the stride test does not.
 *   2. TypeScript and SQL agree. Two readers of one rule is how it rots.
 *   3. The surfaces are wired to the reader. `_reader_lint.test.ts` was
 *      written because a correct guard with zero call sites shipped green.
 *   4. A planted corruption the scan must catch, so a check that has stopped
 *      checking cannot report clean.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  runCadenceSpmSql,
  MIN_RUNNING_STRIDE_M,
  MAX_RUNNING_STRIDE_M,
  MIN_RUNNING_CADENCE_SPM,
  MAX_RUNNING_CADENCE_SPM,
  MAX_PAUSED_SHARE,
  type RunData,
} from '@/lib/runs/run-shape';
import { runCadenceSpm, reconcileRun, impliedStrideM } from '@/lib/runs/coherence';

const WEB = path.resolve(__dirname, '..', '..');

/**
 * Real production rows, by id, reduced to the keys the rule reads.
 *
 * Fixtures rather than a live query on purpose — this must fail on a laptop
 * with no `DATABASE_URL`. The figures were taken over `faff_readonly` on
 * 2026-08-24 and each row's id is here so they can be re-checked.
 */
const PROD: Array<{ id: string; note: string; row: RunData; expectSpm: number | null; expectBasis: string | null }> = [
  {
    id: '18512335226',
    note: '2026-05-14 · legacy Strava import, per-leg',
    row: { distanceMi: 4.36, movingTimeS: 2213, elapsedTimeS: 2213, avgCadence: 77.6 },
    expectSpm: 155.2,
    expectBasis: 'per_leg_doubled',
  },
  {
    id: '18698496177',
    note: '2026-05-22 · strava_webhook at 114 spm · a REAL low cadence',
    row: { distanceMi: 7.77, movingTimeS: 5730, durationSec: 5730, avgCadence: 114 },
    expectSpm: 114,
    expectBasis: 'as_recorded',
  },
  {
    id: '17665883608',
    note: '2026-03-03 · 1.18 mi fragment, per-leg 50 spm',
    row: { distanceMi: 1.18, movingTimeS: 613, elapsedTimeS: 616, avgCadence: 50 },
    expectSpm: 100,
    expectBasis: 'per_leg_doubled',
  },
  {
    id: '-55341764239083',
    note: '2026-08-23 · the 3:37/mi row · a FOREIGN moving clock beside the watch\'s own',
    // The one that makes the clock choice load-bearing. Against `movingTimeS`
    // 2389 s this cadence implies a 2.71 m stride and a naive guard "fixes" it
    // to 328 spm. The row's own `avgStrideLengthM` is 1.25 m.
    row: { distanceMi: 11.01, movingTimeS: 2389, elapsedTimeS: 2389, durationSec: 5298, avgCadence: 164, avgStrideLengthM: 1.25 },
    expectSpm: 164,
    expectBasis: 'as_recorded',
  },
  {
    id: '-161412146640788',
    note: '2026-08-16 · a watch row, left alone',
    row: { distanceMi: 13.2, movingTimeS: 5457, durationSec: 5457, avgCadence: 163 },
    expectSpm: 163,
    expectBasis: 'as_recorded',
  },
];

describe('cadence units · one label, two units', () => {
  it('resolves every production fixture to a both-feet step rate', () => {
    for (const c of PROD) {
      const got = runCadenceSpm(c.row);
      expect(got?.spm ?? null, `${c.id} · ${c.note}`).toBe(c.expectSpm);
      expect(got?.basis ?? null, `${c.id} · ${c.note}`).toBe(c.expectBasis);
    }
  });

  it('the 2026-08-23 row is decided by the RECONCILED clock, not the stored one', () => {
    // The specific regression this ordering exists for. Stated as its own
    // check because it is the difference between a guard and a wrong answer
    // delivered confidently.
    const row = PROD.find((p) => p.id === '-55341764239083')!.row;
    const naive = impliedStrideM(164, 11.01, 2389);
    expect(naive!).toBeGreaterThan(MAX_RUNNING_STRIDE_M);
    const c = reconcileRun(row);
    expect(c.movingSec, 'the foreign moving clock must be refused first').toBeNull();
    expect(c.cadenceSpm).toBe(164);
    expect(c.refusals.map((r) => r.family)).not.toContain('cadence.units-split');
  });

  it('a cadence no stride can explain is refused, not guessed', () => {
    const c = reconcileRun({ distanceMi: 6, durationSec: 3000, movingTimeS: 3000, avgCadence: 12 });
    expect(c.cadenceSpm).toBeNull();
    expect(c.cadenceBasis).toBeNull();
    expect(c.refusals.map((r) => r.family)).toContain('cadence.units-split');
  });

  it('a value-band rule would get the 114 spm row wrong · that is why the stride decides', () => {
    // The negative control for the rule ITSELF, not for a call site. If this
    // ever passes with a band, the band was widened until it stopped
    // separating anything.
    const row = PROD.find((p) => p.id === '18698496177')!.row;
    expect(114).toBeLessThan(MIN_RUNNING_CADENCE_SPM);      // a band would double it
    expect(runCadenceSpm(row)!.basis).toBe('as_recorded');  // the stride does not
    expect(impliedStrideM(228, 7.77, 5730)!).toBeLessThan(MIN_RUNNING_STRIDE_M);
  });

  it('the SQL fragment carries the same constants as the TypeScript', () => {
    const sql = runCadenceSpmSql();
    for (const k of [MIN_RUNNING_STRIDE_M, MAX_RUNNING_STRIDE_M,
                     MIN_RUNNING_CADENCE_SPM, MAX_RUNNING_CADENCE_SPM, MAX_PAUSED_SHARE]) {
      expect(sql, `the emitted SQL no longer mentions ${k}`).toContain(String(k));
    }
    // The clock has to be the reconciled one in SQL too. An elapsed-first
    // draft left 5 of the 56 per-leg rows halved, because `elapsedTimeS` on a
    // legacy Strava row is a real wall clock and runs up to 40% long.
    expect(sql).toContain("->>'movingTimeS'");
    expect(sql).toContain("->>'durationSec'");
    expect(sql.indexOf("->>'movingTimeS'"), 'the SQL must consider the moving clock first')
      .toBeLessThan(sql.indexOf('BETWEEN ' + MIN_RUNNING_STRIDE_M));
  });

  it('the SQL fragment takes an alias and does not leak a bare `data`', () => {
    const aliased = runCadenceSpmSql('r');
    expect(aliased).toContain('r.data');
    expect(/(^|[^.\w])data->/.test(aliased), 'an unaliased `data->` in an aliased fragment')
      .toBe(false);
  });

  it('every surface that prints a cadence asks the resolver', () => {
    /* The wiring direction. `lib/conservation/_reader_lint.test.ts` exists
     * because a correct guard with no call sites shipped green on the morning
     * of 2026-08-24; this is the same check for this family.
     *
     * Keyed on the CALL, because a cadence reader spells exactly one key and
     * a "two or more spellings" ladder scan cannot see it. */
    const MUST_CALL: Array<[string, string]> = [
      ['app/api/v5/today/route.ts', 'the poster'],
      ['app/api/runs/[id]/recap/route.ts', 'the recap'],
      ['lib/coach/run-state.ts', 'run detail'],
      ['lib/coach/log-state.ts', 'the log'],
      ['lib/coach/races-state.ts', 'the race-matched run'],
      ['lib/coach/state-loader.ts', 'the coach state'],
      ['lib/conservation/surfaces.ts', 'the conservation harness'],
      ['lib/coach/health-state.ts', 'the 60-day cadence baseline'],
      ['lib/coach/glance-state.ts', 'the glance cadence baseline'],
      ['components/faff-app/seed.ts', 'the form-metrics series'],
    ];
    const unwired: string[] = [];
    for (const [file, what] of MUST_CALL) {
      const abs = path.join(WEB, file);
      expect(fs.existsSync(abs), `${file} has moved · fix this list`).toBe(true);
      const src = fs.readFileSync(abs, 'utf8');
      if (!src.includes('runCadenceSpm(') && !src.includes('runCadenceSpmSql(')) {
        unwired.push(`${file} (${what})`);
      }
    }
    expect(unwired,
      'a surface is reading `avgCadence` without resolving its unit. 57 rows hold ' +
      'a per-leg count and 54 of them are canonical, so the raw key halves the ' +
      'runner\'s cadence for a third of his history.',
    ).toEqual([]);
  });

  it('no NEW file reads avgCadence raw', () => {
    /* The scan, with a floor on what it looked at. `phases[].avgCadence` is a
     * different field on a different object — watch-authored, always both
     * feet, no Strava writer — so a file is only flagged for the run-level
     * key. */
    const ALLOW: Record<string, string> = {
      'lib/runs/run-shape.ts': 'declares the SQL fragment and the RunData key.',
      'lib/runs/coherence.ts': 'is the resolver.',
      'lib/runs/derived-registry.ts': 'names the family in order to police it.',
      'app/api/strava/webhook/route.ts': 'WRITE path · doubles Strava\'s per-leg count on ingest.',
      'lib/strava/pullSync.ts': 'WRITE path · same doubling.',
      'app/api/ingest/workout/route.ts': 'WRITE path · the phone sends `avg_cadence_spm`, already both feet.',
      'app/api/watch/workouts/complete/route.ts': 'WRITE path · the watch sends both feet.',
      'app/api/run/manual/route.ts': 'WRITE path · writes null.',
      'lib/strava/build-tcx.ts': 'WRITE path · takes whatever the caller hands it.',
      // NOT MIGRATED, DELIBERATELY, AND IT IS A REAL OPEN QUESTION.
      //
      // `pushRunToStrava` puts `run.avgCadence` straight into the TCX as
      // `<Cadence>`. The Garmin TCX schema defines a running lap's Cadence as
      // a ONE-FOOT rate, which is the same convention Strava's own
      // `average_cadence` uses and the reason Strava's UI shows a runner ~82
      // rather than ~164. So the export is very likely sending a both-feet
      // figure into a per-leg field and doubling every run this app pushes.
      //
      // It is not fixed here because fixing it is an EXTERNAL WRITE with no
      // read-back: it changes the number on already-published activities'
      // successors, it cannot be verified from this side without inspecting
      // the runner's own Strava, and getting the direction wrong halves them
      // instead. Flagged for the owner rather than guessed at.
      'lib/strava/push.ts':
        'WRITE path to a third party. Almost certainly needs HALVING for the TCX '
        + 'per-leg convention rather than resolving; unverifiable from this side. '
        + 'Raised with the owner 2026-08-24, not changed.',
      'lib/coach/run-state.ts': 'reads `p.avgCadence` off a watch PHASE as well as calling the resolver for the run.',
      'app/api/v5/today/route.ts': 'reads `ph.avgCadence` off a watch PHASE as well as calling the resolver.',
      'lib/execution/verdict.ts':
        'reads `p.avgCadence` off a watch PHASE and nothing else. It is the ONE '
        + 'parser of the completion payload (VERDICT-1), so `mapWatchPhases` and '
        + 'the Today route now take the phase\'s cadence from it rather than '
        + 'each re-parsing the array — the same watch-authored, both-feet field '
        + 'the two entries above are allowed for, read in one place instead of '
        + 'three. It never touches the run-level key and imports no resolver, '
        + 'because a run-level unit question is not a phase-level one.',
      'lib/postrun/experience.ts':
        'reads `p.avgCadence` off a watch PHASE while composing the stride '
        + 'breakdown, and nothing else. Same watch-authored, both-feet field the '
        + 'three entries above are allowed for, and the same argument: a '
        + 'run-level unit question is not a phase-level one. It never touches '
        + 'the run-level key and imports no resolver. Added 2026-09-02 when the '
        + 'stride breakdown started drawing per-stride cadence — the gate caught '
        + 'it on the first CI run after the merge, which is the gate working.',
    };
    const files: string[] = [];
    const walk = (dir: string) => {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === 'node_modules' || e.name === '.next') continue;
          walk(p);
        } else if (/\.tsx?$/.test(e.name) && !e.name.startsWith('._') && !/\.test\.tsx?$/.test(e.name)) {
          files.push(p);
        }
      }
    };
    for (const r of ['lib', 'app', 'components']) walk(path.join(WEB, r));
    expect(files.length, 'the scan walked almost nothing').toBeGreaterThanOrEqual(400);

    const offenders: string[] = [];
    for (const f of files) {
      const r = path.relative(WEB, f).split(path.sep).join('/');
      if (ALLOW[r]) continue;
      const src = fs.readFileSync(f, 'utf8');
      if (readsCadenceRaw(src)) offenders.push(r);
    }
    console.log(`\n=== CADENCE RAW READS · ${files.length} files, ` +
                `${Object.keys(ALLOW).length} allowed, ${offenders.length} new ===`);
    for (const o of offenders) console.log(`  ${o}`);
    expect(offenders,
      'a file reads `avgCadence` without going through `runCadenceSpm` / `runCadenceSpmSql`. ' +
      'Use one of those, or add an allowlist entry with an honest reason.',
    ).toEqual([]);
  });

  it('the scanner catches a planted corruption', () => {
    const PLANTED: Array<[string, string]> = [
      ['property access', 'const c = Number(data.avgCadence) || null;'],
      ['jsonb extract', "const q = `SELECT (data->>'avgCadence')::numeric AS cadence FROM runs`;"],
      ['multi-line SQL', "const q = `SELECT id,\n  (data->>'avgCadence')::numeric\n    FROM runs`;"],
      ['bracket index', "const c = row['avgCadence'];"],
    ];
    for (const [label, src] of PLANTED) {
      expect(readsCadenceRaw(src), `planted corruption not caught · ${label}`).toBe(true);
    }
    const CLEAN = [
      'const c = runCadenceSpm(data)?.spm ?? null;',
      'const q = `SELECT ${runCadenceSpmSql()} AS cadence FROM runs`;',
      '// avgCadence is a per-leg count on the legacy rows.',
      '/* data->>\'avgCadence\' must never be read raw. */',
    ];
    for (const src of CLEAN) {
      expect(readsCadenceRaw(src), `false positive · ${src.slice(0, 40)}`).toBe(false);
    }
  });
});

/** Does this source read the run-level cadence key without the resolver? */
export function readsCadenceRaw(src: string): boolean {
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  // The three spellings a reader uses. `ph.avgCadence` / `p.avgCadence` /
  // `s.avgCadence` are PHASE and SPLIT reads on a different object and are
  // excluded by the negative lookbehind on the receiver name.
  return /(?<!\b(?:ph|p|s|phase|split)\.)\.avgCadence\b/.test(code)
      || /->>\s*'avgCadence'/.test(code)
      || /\[\s*['"]avgCadence['"]\s*\]/.test(code);
}
