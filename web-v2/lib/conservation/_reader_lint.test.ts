/**
 * lib/conservation/_reader_lint.test.ts · a guard nothing calls is a comment.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE FAILURE THIS EXISTS FOR
 *
 * On 2026-08-24 a fix landed for the run that reached David's phone at
 * 3:37/mi. `runPaceSecPerMi` was given a self-check: a stored pace implies a
 * paused share, and a paused share above half is not a pause but a bad number.
 * It was correct, it was tested, and its commit message said it "repairs every
 * surface and every historical row at once".
 *
 * It had zero call sites. Every surface still read `data.paceSPerMi` raw. The
 * poster, the log, the run detail and the recap were all exactly as wrong the
 * hour after the fix as the hour before it, and the suite was green both times
 * because the only thing calling the guard was the guard's own test.
 *
 * A conservation harness that reads through the sanctioned module would not
 * have caught that either — it would have been testing the module, not the
 * app. So this file checks the OTHER direction: that the surfaces are still
 * wired to it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT IT SCANS FOR · A CLOCK LADDER
 *
 * `runs.data` holds four different keys for how long a run took, and no two
 * ingest paths write the same subset. A reader therefore has to COALESCE, and
 * the ORDER it coalesces in is a semantic choice nothing was enforcing. On the
 * day this was written there were three, in three files:
 *
 *     lib/coach/log-state.ts     movingTimeS → movingSec  → durationSec
 *     lib/coach/run-state.ts     movingTimeS → duration_sec → elapsedTimeS
 *     app/api/v5/today/route.ts  durationSec → movingTimeS → elapsedTimeS
 *
 * Three orders, so the same run gave a different Time on the Log than on
 * Today. And the middle one names `duration_sec` in snake_case, which is a key
 * that exists on ZERO rows in the table — so on the 24 canonical rows whose
 * only clock IS `durationSec`, run detail's numeric path resolved to nothing.
 *
 * A file that spells two or more of those four keys is writing a ladder. That
 * is the shape this scans for. A single mention is usually a wire field or a
 * writer naming what it writes, and flagging those would bury the signal.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * BOTH DIRECTIONS ARE ENFORCED
 *
 * Adding a file to the allowlist to silence a new violation is one line and
 * visible in review. Leaving a file on the allowlist after migrating it fails
 * the staleness check, the same way the doctrine registry's `exempt` map
 * works. The list may shrink. It may not grow quietly.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const WEB = path.resolve(__dirname, '..', '..');
const ROOTS = ['lib', 'app'];

/**
 * The four spellings of "how long did this run take". Two or more of them in
 * one file is a COALESCE ladder with its own opinion.
 */
const CLOCK_KEYS = ['movingTimeS', 'movingSec', 'elapsedTimeS', 'durationSec'];

/** Modules allowed to speak these literals — the reader layer itself. */
/**
 * Every spelling that reaches the one reconciler. A surface calling any of
 * these is wired; a surface calling none of them is reading raw keys.
 */
const SHARED_READER_CALLS = [
  'runFacts(',
  'reconcileRun(',
  'coherentPace(',
  'coherentDurationSec(',
  'coherentMovingSec(',
  'coherentElapsedSec(',
];

const READER_MODULES = new Set([
  'lib/runs/run-shape.ts',   // the accessor layer and the SQL fragment builders
  'lib/runs/run-facts.ts',   // the basis-aware facade
  // THE DECISION POINT, added 2026-08-24. `reconcileRun` is where a row's
  // clocks are judged against each other; `runFacts` above is now a thin
  // basis-preference layer over it rather than a second opinion. Both are
  // readers by definition and must name every key they arbitrate — that is
  // the job, not a ladder.
  'lib/runs/coherence.ts',
  // The gate's own registry of which keys belong to which family. It lists
  // the members in order to police them; a lint that flagged its own
  // vocabulary would be unable to describe what it checks.
  'lib/runs/derived-registry.ts',
]);

/**
 * Pre-existing call sites, each with an honest reason. Every entry is a place
 * a number can still drift. The list is long on purpose — migrating all of it
 * at once is its own risk — and it is the queue.
 */
const ALLOW: Record<string, string> = {
  'lib/runs/canonical.ts':
    "THE WRITE SIDE, and the reason the read side had a problem to solve. `familyGuardedFill` has to name every member of the clock family in order to refuse a partial one — a fill that knew only two spellings is precisely how Strava's moving time landed on the watch's row on 2026-08-23 without its matching clock. It reads the keys to POLICE them, not to pick one, so it is a guard rather than a ladder. It should stay listed anyway: if this file ever starts CHOOSING a clock, that is a real finding and the entry is where the argument lives.",
  /* ── WRITERS. A writer has to name what it writes; these are not drift. ── */
  'app/api/watch/workouts/complete/route.ts':
    'WRITER · the watch completion mapper. Builds runs.data inline inside POST.',
  'app/api/ingest/workout/route.ts':
    'WRITER · the HealthKit mapper. Same shape.',

  /* ── THE MERGE. Names keys precisely because it is deciding between them. ── */
  'lib/runs/identity.ts':
    'THE DEDUP · compares two rows field by field to decide they are the same run. It has to see every spelling.',
  'lib/strava/push.ts':
    'OUTBOUND · builds the payload Faff sends TO Strava. Not a read of a Faff surface.',

  /* ── READERS NOT YET MIGRATED. Each is a place a number can still drift,
   *    and this is the queue, in the order I would take them. ───────────── */
  'lib/coach/run-state.ts':
    'MIGRATED, but the scan still fires: the file discusses `durationSec` in prose and passes a field NAMED `movingTimeS` to two helpers. The substring scan cannot tell those from a read, and over-reporting is the right direction for a lint.',
  'lib/coach/recovery-brief.ts':
    'post-race recovery copy · its own ladder over three keys',
  'lib/coach/recovery-phase.ts':
    'the recovery-phase reader · its own ladder over three keys',
  'lib/coach/training-state.ts':
    'the training-state reader · feeds the native TRAIN tab',
  'lib/coach/easy-discipline.ts':
    'the easy-discipline signal · two keys',
  'lib/plan/drift-monitor.ts':
    'plan drift · three keys',
  'lib/terrain/run-terrain.ts':
    'terrain resolution · all four keys, the widest ladder in the app',
  'lib/weather/openmeteo.ts':
    'the weather enrichment window · three keys, and the window it opens decides which hour\'s temperature a run is judged against',
  'app/api/admin/audit-weather/route.ts':
    'the weather audit endpoint · mirrors openmeteo\'s ladder',

  /* ── RACE PATH. Per CLAUDE.md these read `races.actual_result` first and the
   *    run keys are the labelled-provisional fallback. Migrating them means
   *    reasoning about the race source-of-truth rule as well, so they are
   *    deliberately last rather than accidentally missed. ─────────────────── */
  'lib/race/auto-result.ts': 'RACE PATH · see the note above',
};

const rel = (p: string) => path.relative(WEB, p).split(path.sep).join('/');

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.next') continue;
        walk(p);
      } else if (/\.tsx?$/.test(e.name) && !e.name.startsWith('._') && !/\.test\.tsx?$/.test(e.name)) {
        out.push(p);
      }
    }
  };
  for (const r of ROOTS) walk(path.join(WEB, r));
  return out;
}

/**
 * Which clock keys a file spells. Covers the three forms that appear: a
 * property access (`data.durationSec`), a jsonb text extract
 * (`data->>'durationSec'`), and a bracket index (`data['durationSec']`).
 *
 * Deliberately a plain substring scan rather than one clever regular
 * expression. A multi-line SQL string defeats a line-anchored pattern, and a
 * false finding was filed exactly that way in this repo on the day this was
 * written. A plain scan over-reports and never under-reports, which is the
 * right direction for a lint.
 */
function clockKeysIn(src: string): string[] {
  const hits: string[] = [];
  for (const key of CLOCK_KEYS) {
    for (const form of [`.${key}`, `'${key}'`, `"${key}"`]) {
      if (src.includes(form)) { hits.push(key); break; }
    }
  }
  return hits;
}

/** A ladder is two or more spellings of the same fact in one file. */
const isLadder = (hits: string[]) => hits.length >= 2;

describe('reader lint · one reader for how long a run took', () => {
  it('no new file spells its own clock ladder', () => {
    const violations: string[] = [];
    for (const file of sourceFiles()) {
      const r = rel(file);
      if (READER_MODULES.has(r) || ALLOW[r]) continue;
      const hits = clockKeysIn(fs.readFileSync(file, 'utf8'));
      if (isLadder(hits)) violations.push(`${r} — ${hits.join(' / ')}`);
    }
    console.log(`\n=== CLOCK LADDERS · ${Object.keys(ALLOW).length} known, ${violations.length} new ===`);
    for (const v of violations) console.log(`  ${v}`);
    expect(violations,
      'a new COALESCE over the four duration keys. Use `runFacts` from lib/runs/run-facts.ts, or add an allowlist entry with an honest reason.',
    ).toEqual([]);
  });

  it('the allowlist has no stale entries', () => {
    const stale: string[] = [];
    for (const [file, reason] of Object.entries(ALLOW)) {
      const abs = path.join(WEB, file);
      if (!fs.existsSync(abs)) { stale.push(`${file} — file is gone (${reason})`); continue; }
      if (!isLadder(clockKeysIn(fs.readFileSync(abs, 'utf8')))) {
        stale.push(`${file} — migrated, delete this entry (${reason})`);
      }
    }
    console.log(`\n=== ALLOWLIST STALENESS · ${stale.length} entries to delete ===`);
    for (const s of stale) console.log(`  ${s}`);
    expect(stale, 'the allowlist may shrink; a migrated file must be removed from it').toEqual([]);
  });

  it('the surfaces that print a run are wired to the shared reader', () => {
    // The direct answer to "the fix had zero call sites". Each of these prints
    // a distance, a clock and a pace side by side, and each one printed a
    // different run on 2026-08-23.
    const MUST_CALL: Array<[string, string]> = [
      ['app/api/v5/today/route.ts', 'the poster and the recap'],
      ['lib/coach/log-state.ts', 'the log'],
      ['lib/coach/run-state.ts', 'run detail'],
      // Added 2026-08-24. This route is the sentence the runner actually
      // reads — "Easy 11.0 mi at 3:37/mi" — and it was the last surface
      // assembling its facts inline. Note that the LADDER scan above never
      // flagged it: after the first half of the migration it spelled exactly
      // ONE clock key (`data.durationSec`, into the weather window), and a
      // ladder needs two. One raw key is not a ladder and is still a second
      // opinion, which is why the wiring check exists beside the ladder check
      // rather than instead of it.
      ['app/api/runs/[id]/recap/route.ts', 'the post-run recap sentence'],
    ];
    // Two facades over ONE reconciler, not two readers. `runFacts` carries the
    // basis preference a surface needs; `coherentPace` / `coherentDurationSec`
    // answer the narrower question without one. Both call `reconcileRun`, so a
    // surface reading through either cannot drift from a surface reading
    // through the other — which is the property this test defends. Naming only
    // `runFacts` here would fail a surface that is correctly wired, and a lint
    // that cries wolf gets an allowlist entry rather than a fix.
    const unwired: string[] = [];
    for (const [file, what] of MUST_CALL) {
      const src = fs.readFileSync(path.join(WEB, file), 'utf8');
      if (!SHARED_READER_CALLS.some((c) => src.includes(c))) {
        unwired.push(`${file} (${what}) reads no shared reader`);
      }
    }
    expect(unwired, 'a surface stopped reading through the shared reader and can drift again').toEqual([]);
  });

  it('nothing hands judgeWeather a raw clock key', () => {
    /* ── THE HEAT CLOCK · added 2026-08-24 ──────────────────────────────────
     *
     * `judgeWeather`'s `durationS` is how long the runner was in the heat, and
     * a null falls back to the FULL marathon-distance penalty — the Maughan
     * table in `Research/06` is anchored at marathon duration and scaled DOWN
     * for shorter efforts. So a missing clock does not produce a missing heat
     * number. It produces the largest one there is.
     *
     * All three callers read `durationSec` directly, and 133 of the 256
     * canonical rows carry no `durationSec` key at all — their wall clock is
     * in `elapsedTimeS`. Those runs were charged a marathon's worth of heat.
     * On 91 of the 207 weather-enriched rows the percentage was overstated,
     * and on 16 the recap showed a heat note on a day that did not warrant
     * one: "61°F. Cost you about 3% on pace" became "61°F · good conditions."
     * The worst was a 47-minute run at 83°F told it lost 12% to heat, against
     * a true 7%.
     *
     * This is the same defect as the clock ladders above wearing a different
     * hat — a raw key read where a reconciled one belongs — but the ladder
     * scan cannot see it, because ONE key is not a ladder. Hence its own
     * check, keyed on the call rather than on the key count. */
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const src = fs.readFileSync(file, 'utf8');
      if (!src.includes('judgeWeather(') && !src.includes('heatEffort(')) continue;
      // The property assignment, on one line, with a raw key on its right.
      for (const m of src.matchAll(/durationS:\s*([^\n]*)/g)) {
        const rhs = m[1];
        if (/\b(durationSec|elapsedTimeS|movingTimeS|movingSec)\b/.test(rhs)) {
          offenders.push(`${rel(file)} — durationS: ${rhs.trim()}`);
        }
      }
    }
    expect(offenders,
      'a heat judgement is reading a clock key directly. A null durationS charges the FULL ' +
      'marathon-distance penalty, so a missing key silently maximises the heat number. ' +
      'Use coherentElapsedSec / reconcileRun.',
    ).toEqual([]);
  });

  it('every surface that prints a climb asks the same instrument question', () => {
    /* ── THE ELEVATION FAMILY · added 2026-08-24 ────────────────────────────
     *
     * The clock check above is the same rule for a different field, and the
     * elevation family broke in exactly the same way and was not caught,
     * because the ladder scan looks for `durationSec`-shaped keys and an
     * elevation reader spells ONE key. One key is not a ladder.
     *
     * What was on screen for one eleven-mile run on 2026-08-23:
     *
     *     log          3195 ft   read data.elevGainFt raw
     *     run detail     57 ft   its own private 250 ft/mi drift heuristic
     *     recap        3195 ft   runElevGainFt(), canonical row only
     *     poster         57 ft   pickElevationGain(), over the twins
     *
     * `pickElevationGain` had one caller. It was correct and it was ignored,
     * which is the same failure `runPaceSecPerMi` had the morning before —
     * a guard nothing calls is a comment.
     *
     * Keyed on the CALL rather than on the key count, for the same reason the
     * judgeWeather check below is. */
    const RESOLVER_CALLS = [
      'pickElevationGain(',
      'resolveElevationGain(',
      // The terrain resolver takes an already-resolved figure as an argument;
      // a file that only hands it one is a consumer, not a second opinion.
    ];
    const MUST_RESOLVE: Array<[string, string]> = [
      ['app/api/v5/today/route.ts', 'the poster'],
      ['lib/coach/run-state.ts', 'run detail'],
      ['lib/coach/log-state.ts', 'the log'],
      ['app/api/runs/[id]/recap/route.ts', 'the recap, which feeds terrain and so feeds the verdict'],
    ];
    const unwired: string[] = [];
    for (const [file, what] of MUST_RESOLVE) {
      const src = fs.readFileSync(path.join(WEB, file), 'utf8');
      if (!RESOLVER_CALLS.some((c) => src.includes(c))) {
        unwired.push(`${file} (${what}) resolves elevation without the instrument ranking`);
      }
    }
    expect(unwired,
      'a surface is reading a climb without asking which instrument produced it. ' +
      'GPS-derived elevation runs 2.3x the barometer on this data and the tail is ' +
      'nonsense — 3195 ft against barometric twins reading 57. Use ' +
      '`resolveElevationGain` from lib/runs/twins.ts.',
    ).toEqual([]);
  });

  it('no surface re-derives a climb from split deltas', () => {
    /* The specific private heuristic that used to live in run-state: sum the
     * positive per-split elevation deltas and use that instead of the stored
     * figure when the stored one looks steep. It is a plausible guess and it
     * is the WRONG QUESTION — "is this implausible" rather than "which
     * instrument measured it" — and answering it per-surface is what put four
     * numbers on four screens.
     *
     * Scanned as a shape rather than by name because the next copy will be
     * spelled differently: an accumulation over `elev_change_ft` inside a
     * reader is the tell. */
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const r = rel(file);
      if (r === 'lib/runs/elevation.ts' || r === 'lib/runs/elev-from-gps.ts'
        || r === 'lib/runs/elev-sanity.ts' || r === 'lib/terrain/run-terrain.ts') continue;
      const src = fs.readFileSync(file, 'utf8');
      // A reduce/loop that accumulates a per-split elevation delta.
      if (/reduce\([^)]*\)\s*=>[^;]{0,200}elev_change_ft/s.test(src)
        || /\+=\s*[^;\n]{0,60}elev_change_ft/.test(src)) {
        offenders.push(r);
      }
    }
    expect(offenders,
      'a reader is rebuilding a run\'s climb out of its split deltas. That is a ' +
      'private opinion about a figure four surfaces have to agree on. Rank the ' +
      'instruments with `pickElevationGain` instead.',
    ).toEqual([]);
  });

  it('the shared readers are called by something other than their own tests', () => {
    // The generalised version of the same check. A guard whose only caller is
    // its own test file is a comment with a green tick beside it.
    let callers = 0;
    for (const file of sourceFiles()) {
      if (READER_MODULES.has(rel(file))) continue;
      const src = fs.readFileSync(file, 'utf8');
      if (SHARED_READER_CALLS.some((c) => src.includes(c))) callers++;
    }
    // This is the assertion that would have caught the morning of 2026-08-24,
    // when `runPaceSecPerMi` stated the rule correctly and had ZERO callers
    // while its own unit test passed. A guard whose only caller is its own
    // test file is a comment with a green tick beside it.
    expect(callers, 'the shared reader has no production callers — it is dead code').toBeGreaterThanOrEqual(3);
  });
});
