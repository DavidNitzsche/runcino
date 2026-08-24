/**
 * lib/conservation/_run_conservation.test.ts · a number's journey.
 *
 * Pushes every run shape in `shapes.ts` through every reachable hop of the
 * pipeline and asserts, at each one, that the figures still mean what they
 * meant when they went in.
 *
 * Run:
 *   ./node_modules/.bin/vitest run lib/conservation --disable-console-intercept 2>&1 | tail -60
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS EXISTS TO CATCH, IN THE WORDS OF THE RUN THAT CAUSED IT
 *
 * 11.01 miles. 5298 seconds on his own watch. 8:01/mi. It reached his phone
 * as 3:37/mi, and the coach said "Easy 11.0 mi at 3:37/mi. A touch quicker
 * than the 9:22/mi easy target."
 *
 * The truth was on the same database row the whole time. A Strava moving time
 * of 2389 seconds, implying 16.6 mph for eleven miles, had been stamped beside
 * it, and every reader preferred it. The full suite was green.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE CANNOT PASS ON NOTHING
 *
 * Two guards, because "the harness ran and found nothing" and "the harness
 * did not run" look identical in a green CI log, and this codebase has
 * produced that exact false clean twice in one day.
 *
 *   · A FLOOR. Fewer than `MIN_SHAPES` shapes pushed, or fewer than
 *     `MIN_ASSERTIONS` law applications performed, is a failure regardless of
 *     what the laws found.
 *   · POSITIVE CONTROLS. Known corruptions — a pace that disagrees with its
 *     own clock, a split set that does not sum, a distance that changes
 *     between two screens — are planted and the harness must catch every one.
 *     A control that goes undetected fails the suite even when every real
 *     shape is clean, because it means the laws have stopped working.
 */
import { describe, it, expect } from 'vitest';
import {
  distanceConserved, timeConserved, paceMatchesOwnClock, surfacesAgree,
  splitsSumToDistance, zonesSumTo100, phasesWithinRun,
  type Finding, type RunTruth, type SurfaceReading,
} from './laws';
import { RUN_SHAPES, MIN_SHAPES, type RunShape } from './shapes';
import { readAllSurfaces, UNCOVERED } from './surfaces';
import { runFacts } from '@/lib/runs/run-facts';
import { clusterRuns, pickCanonical, planMergeOps, type RunRow } from '@/lib/runs/identity';
import { mergePreserve } from '@/lib/runs/merge-safe';

/**
 * LIVE VIOLATIONS, NAMED RATHER THAN LOOSENED.
 *
 * Each key is `LAW · shape` and each value is an honest reason it is still
 * failing. The doctrine registry's `exempt` map works the same way and for the
 * same argument: a gate quietly relaxed to fit reality stops being a gate, and
 * a gate that is red forever gets ignored. Naming the violation keeps it
 * visible and keeps the rest of the sweep meaningful.
 *
 * Staleness is enforced below. Fix the defect and the harness makes you delete
 * the entry. The list may shrink; it may not grow quietly.
 */
const EXEMPT: Record<string, string> = {
  'SPLITS_DO_NOT_SUM · merged-disagree':
    'REAL, AND IT IS IN THE DATA. The production row for 2026-08-23 stores `distanceMi` 11.01 and twelve splits summing to 11.88 — eleven whole miles and a 0.879 remainder — against a run the same row says was 11.01 miles. Header and split list disagree by 7.9%, and a runner scrolling run detail can see it. The cause is in split derivation rather than in any reader, so it is reported here and fixed there. Whoever fixes it deletes this line.',
  'SURFACES_ROUND_DIFFERENTLY · legacy-movingsec':
    'REAL, AND COSMETIC. 3.05 miles reads as "3.1 mi" on the poster and "3.0 mi" in the recap, because `fmtMi` in lib/faff/v5-today.ts rounds half up and the recap\'s own formatter does not. Two screens, two numbers, one run. There are 48 pace and duration formatters in this repo and no canonical module; this is one symptom of that and belongs to consolidating them, not to a correctness fix landed beside it.',
};

/**
 * The smallest number of law applications a real sweep performs.
 *
 * Counted per SURFACE, not per law call: four screens times four
 * reading-laws is sixteen checks on one run, and a floor stated in law calls
 * would still pass if the readings list arrived empty. Fourteen shapes reach
 * this comfortably; a sweep that silently stopped reading rows does not.
 */
const MIN_ASSERTIONS = 200;

let assertions = 0;
/** `n` is how many things this law actually looked at. Zero counts as zero. */
function apply(n: number, fn: () => Finding[]): Finding[] {
  assertions += n;
  return fn();
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE SWEEP
 * ═══════════════════════════════════════════════════════════════════════ */

function sweepShape(shape: RunShape): { findings: Finding[]; readings: SurfaceReading[] } {
  const findings: Finding[] = [];
  const truth: RunTruth = shape.truth;

  // HOP 1 · INGEST → CANONICAL.
  //
  // The dedup is pure, so it runs for real. `pickCanonical` decides which
  // physical row is the run, and on a merged day that decision is the one
  // that determines whose clock the runner is shown.
  if (shape.ingests.length > 1) {
    const rows: RunRow[] = shape.ingests.map((i) => ({ id: i.id, user_uuid: 'u', data: i.data }));
    const clusters = clusterRuns(rows);
    assertions++;
    if (clusters.length !== 1) {
      findings.push({
        law: 'DEDUP_SPLIT_ONE_RUN', shape: shape.id, surface: null,
        saw: `${shape.ingests.length} ingests of one run landed in ${clusters.length} clusters — the runner sees it ${clusters.length} times`,
      });
    } else {
      const { canonical } = pickCanonical(clusters[0]);
      assertions++;
      if (shape.expectCanonicalId && canonical.id !== shape.expectCanonicalId) {
        findings.push({
          law: 'DEDUP_WRONG_WINNER', shape: shape.id, surface: null,
          saw: `${canonical.id} won the dedup; ${shape.expectCanonicalId} holds the run's own clock`,
        });
      }
    }
    // The merge must settle. Re-planning over the same rows a second time
    // must ask for nothing — an unsettled merge re-writes rows every sync.
    const ops = planMergeOps(rows);
    assertions++;
    const applied: RunRow[] = rows.map((r) => {
      const set = ops.sets.find((s) => s.id === r.id);
      return set ? { ...r, data: { ...r.data, mergedIntoId: set.canonicalId } } : r;
    });
    const again = planMergeOps(applied);
    if (again.sets.length > 0 || again.clears.length > 0) {
      findings.push({
        law: 'MERGE_NOT_IDEMPOTENT', shape: shape.id, surface: null,
        saw: `a second merge pass over the same day still wants ${again.sets.length} sets and ${again.clears.length} clears`,
      });
    }
  }

  // HOP 2 · THE UPSERT. `mergePreserve` is the JS mirror of
  // `data || jsonb_strip_nulls(EXCLUDED.data)`. Re-writing a row with the
  // figures it already holds must not change any of them.
  const rewritten = mergePreserve(
    shape.canonical as Record<string, unknown>,
    shape.canonical as Record<string, unknown>,
  );
  assertions++;
  const before = runFacts(shape.canonical);
  const after = runFacts(rewritten as never);
  if (before.distanceMi !== after.distanceMi || before.timeSec !== after.timeSec) {
    findings.push({
      law: 'UPSERT_CHANGED_THE_ROW', shape: shape.id, surface: null,
      saw: 're-writing the row with its own contents changed its distance or its clock',
    });
  }

  // HOP 3 · EVERY SURFACE THAT PRINTS A NUMBER.
  const readings = readAllSurfaces(shape, shape.canonical);
  const n = readings.length;
  findings.push(...apply(n, () => distanceConserved(shape.id, truth, readings)));
  findings.push(...apply(n, () => timeConserved(shape.id, truth, readings)));
  findings.push(...apply(n, () => paceMatchesOwnClock(shape.id, truth, readings)));
  findings.push(...apply(n, () => surfacesAgree(shape.id, truth, readings)));

  // HOP 4 · THE PARTS.
  findings.push(...apply(shape.splitDistancesMi?.length ?? 0, () => splitsSumToDistance(shape.id, truth, shape.splitDistancesMi ?? null)));
  findings.push(...apply(shape.zones ? 1 : 0, () => zonesSumTo100(shape.id, shape.zones ?? null, (shape.canonical.avgHr as number | null) ?? null)));
  findings.push(...apply(shape.phases?.length ?? 0, () => phasesWithinRun(shape.id, truth, shape.phases ?? null)));

  return { findings, readings };
}

/* ══════════════════════════════════════════════════════════════════════════
 * POSITIVE CONTROLS
 *
 * Each plants one known corruption and asserts the harness catches it. These
 * are not tests of the app. They are tests of the tests, and they are the
 * reason a clean report from this file means anything at all.
 * ═══════════════════════════════════════════════════════════════════════ */

interface Control { name: string; law: string; run: () => Finding[] }

const TRUTH: RunTruth = { distanceMi: 11.01, elapsedSec: 5298, movingSec: null };
const good: SurfaceReading = { surface: 'poster', distanceMi: 11.01, timeSec: 5298, paceSecPerMi: 481.2 };

const CONTROLS: Control[] = [
  {
    name: 'a pace that disagrees with its own clock — the 3:37 itself',
    law: 'PACE_CONTRADICTS_CLOCK',
    run: () => paceMatchesOwnClock('control', TRUTH, [{ ...good, paceSecPerMi: 217 }]),
  },
  {
    name: 'a clock that is neither the run\'s elapsed nor its moving time',
    law: 'TIME_CHANGED',
    run: () => timeConserved('control', TRUTH, [{ ...good, timeSec: 2389, paceSecPerMi: 217 }]),
  },
  {
    name: 'a distance that changed on the way to a screen',
    law: 'DISTANCE_CHANGED',
    run: () => distanceConserved('control', TRUTH, [{ ...good, distanceMi: 11.88 }]),
  },
  {
    name: 'two screens printing two different distances for one run',
    law: 'SURFACES_DISAGREE_DISTANCE',
    run: () => surfacesAgree('control', TRUTH, [good, { ...good, surface: 'log', distanceMi: 10.4 }]),
  },
  {
    name: 'two screens printing two clocks the run never had',
    law: 'SURFACES_DISAGREE_TIME',
    run: () => surfacesAgree('control', TRUTH, [good, { ...good, surface: 'log', timeSec: 2389 }]),
  },
  {
    name: 'a split set that does not sum to the run',
    law: 'SPLITS_DO_NOT_SUM',
    run: () => splitsSumToDistance('control', TRUTH, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.879]),
  },
  {
    name: 'zone shares that do not sum to 100',
    law: 'ZONES_DO_NOT_SUM',
    run: () => zonesSumTo100('control', { z1: 15, z2: 37, z3: 21, z4: 12, z5: 4 }, 152),
  },
  {
    name: 'an all-zero zone set on a run that measured a heart rate',
    law: 'ZONES_EMPTY_WITH_HR',
    run: () => zonesSumTo100('control', { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 }, 152),
  },
  {
    name: 'phases summing to more distance than the run itself',
    law: 'PHASES_EXCEED_DISTANCE',
    run: () => phasesWithinRun('control', TRUTH, [{ actualDistanceMi: 8 }, { actualDistanceMi: 8 }]),
  },
  {
    name: 'phases summing to more time than the run itself',
    law: 'PHASES_EXCEED_TIME',
    run: () => phasesWithinRun('control', TRUTH, [{ actualDurationSec: 4000 }, { actualDurationSec: 4000 }]),
  },
  {
    name: 'a surface that printed no distance at all',
    law: 'DISTANCE_MISSING',
    run: () => distanceConserved('control', TRUTH, [{ ...good, distanceMi: null }]),
  },
];

/* ══════════════════════════════════════════════════════════════════════════
 * NEGATIVE CONTROLS — the laws must stay quiet on things that are FINE.
 *
 * A law that fires on a correct run is worse than no law: it teaches people
 * to re-run the gate until it passes. A genuinely paused run and a run with
 * no heart rate at all are both correct, and neither may produce a finding.
 * ═══════════════════════════════════════════════════════════════════════ */

const PAUSED: RunTruth = { distanceMi: 6, elapsedSec: 3600, movingSec: 3240 };

const QUIET: Array<{ name: string; run: () => Finding[] }> = [
  {
    name: 'a genuinely paused run · moving time honestly less than elapsed',
    run: () => timeConserved('quiet', PAUSED, [
      { surface: 'poster', distanceMi: 6, timeSec: 3600, paceSecPerMi: 600 },
      { surface: 'log', distanceMi: 6, timeSec: 3240, paceSecPerMi: 540 },
    ]),
  },
  {
    name: 'a paused run · the two screens differ by exactly the pause',
    run: () => surfacesAgree('quiet', PAUSED, [
      { surface: 'poster', distanceMi: 6, timeSec: 3600, paceSecPerMi: 600 },
      { surface: 'log', distanceMi: 6, timeSec: 3240, paceSecPerMi: 540 },
    ]),
  },
  {
    name: 'a run with no heart rate · all-zero zones are an honest absence',
    run: () => zonesSumTo100('quiet', { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 }, null),
  },
  {
    name: 'a run with no splits at all',
    run: () => splitsSumToDistance('quiet', PAUSED, null),
  },
  {
    name: 'a watch that stopped early · phases sum to LESS than the run',
    run: () => phasesWithinRun('quiet', PAUSED, [{ actualDistanceMi: 2, actualDurationSec: 1200 }]),
  },
  {
    name: 'an elite pace · the laws have no opinion about human speed',
    run: () => paceMatchesOwnClock('quiet', { distanceMi: 10, elapsedSec: 3000, movingSec: null },
      [{ surface: 'poster', distanceMi: 10, timeSec: 3000, paceSecPerMi: 300 }]),
  },
];

/* ══════════════════════════════════════════════════════════════════════════
 * THE GATE
 * ═══════════════════════════════════════════════════════════════════════ */

describe('conservation · a number\'s journey through the pipeline', () => {
  it('the laws catch every planted corruption', () => {
    const missed: string[] = [];
    for (const c of CONTROLS) {
      const found = c.run();
      if (!found.some((f) => f.law === c.law)) missed.push(`${c.law} · ${c.name}`);
    }
    console.log(`\n=== POSITIVE CONTROLS · ${CONTROLS.length} planted, ${CONTROLS.length - missed.length} caught ===`);
    for (const m of missed) console.log(`  MISSED  ${m}`);
    expect(missed, `the harness failed to catch ${missed.length} known corruptions — the laws have stopped working`).toEqual([]);
  });

  it('the laws stay quiet on runs that are fine', () => {
    const noisy: string[] = [];
    for (const q of QUIET) {
      const found = q.run();
      if (found.length > 0) noisy.push(`${q.name} → ${found.map((f) => f.law).join(', ')}`);
    }
    console.log(`\n=== NEGATIVE CONTROLS · ${QUIET.length} correct runs, ${QUIET.length - noisy.length} left alone ===`);
    for (const n of noisy) console.log(`  FALSE POSITIVE  ${n}`);
    expect(noisy, 'a law fired on a run that was correct').toEqual([]);
  });

  it('every run shape survives the pipeline unchanged', () => {
    const all: Finding[] = [];
    const posters: string[] = [];
    let observed = 0;

    for (const shape of RUN_SHAPES) {
      const { findings, readings } = sweepShape(shape);
      all.push(...findings);
      if (shape.canonicalIsObserved) observed++;
      const p = readings.find((r) => r.surface === 'poster');
      posters.push(
        `  ${shape.id.padEnd(20)} ${(p?.printed?.distance ?? '—')} · ${(p?.printed?.time ?? '—')} · ${(p?.printed?.pace ?? '—')}`,
      );
    }

    console.log(`\n=== PUSHED ${RUN_SHAPES.length} RUN SHAPES · ${assertions} law applications ===`);
    console.log(`(${observed} carry a canonical row observed in production rather than computed)`);
    console.log('\n--- what the poster prints ---');
    for (const line of posters) console.log(line);

    console.log('\n--- HOPS THIS HARNESS DOES NOT COVER ---');
    for (const u of UNCOVERED) console.log(`  · ${u}`);

    const key = (f: Finding) => `${f.law} · ${f.shape}`;
    const live = all.filter((f) => EXEMPT[key(f)] == null);
    const named = all.filter((f) => EXEMPT[key(f)] != null);

    const byLaw = new Map<string, Finding[]>();
    for (const f of live) {
      const list = byLaw.get(f.law) ?? [];
      list.push(f);
      byLaw.set(f.law, list);
    }
    console.log(`\n--- FINDINGS · ${live.length} unexplained across ${byLaw.size} laws ---`);
    for (const [law, list] of [...byLaw.entries()].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  [${list.length}] ${law}`);
      for (const f of list.slice(0, 4)) console.log(`        ${f.shape}${f.surface ? ' · ' + f.surface : ''} — ${f.saw}`);
    }

    console.log(`\n--- KNOWN VIOLATIONS, NAMED · ${named.length} ---`);
    for (const f of named) {
      console.log(`  ${key(f)}`);
      console.log(`      ${f.saw}`);
      console.log(`      why it stands: ${EXEMPT[key(f)]}`);
    }

    // STALENESS. An exemption whose defect is fixed must be deleted, or the
    // next reader believes the harness is still carrying a violation it is not.
    const firing = new Set(all.map(key));
    const stale = Object.keys(EXEMPT).filter((k) => !firing.has(k));
    expect(stale, 'these exemptions no longer fire — delete them').toEqual([]);

    // THE FLOOR. A harness that pushed nothing and reported clean is the same
    // bug one level up.
    expect(RUN_SHAPES.length, 'too few run shapes pushed for this sweep to mean anything')
      .toBeGreaterThanOrEqual(MIN_SHAPES);
    expect(assertions, 'too few law applications — the sweep did not actually run')
      .toBeGreaterThanOrEqual(MIN_ASSERTIONS);

    // THE GATE. Every finding is either fixed or named. Nothing is quiet.
    expect(live.map((f) => `${key(f)}${f.surface ? ' · ' + f.surface : ''} — ${f.saw}`))
      .toEqual([]);
  }, 30_000);

  it('the recap never states a pace the run disproves', () => {
    // The sentence is the surface. Reading the payload's fields would miss a
    // recap that computed correctly and then wrote the wrong number into prose
    // — which is exactly the shape of what David was told on the 23rd.
    const bad: string[] = [];
    for (const shape of RUN_SHAPES) {
      const facts = runFacts(shape.canonical, { basis: 'elapsed' });
      if (facts.paceSecPerMi == null) continue;
      const r = readAllSurfaces(shape, shape.canonical).find((x) => x.surface === 'recap');
      assertions++;
      if (r?.paceSecPerMi != null && Math.abs(r.paceSecPerMi - facts.paceSecPerMi) > 2) {
        bad.push(`${shape.id}: recap says ${r.printed?.pace}, the run was ${Math.round(facts.paceSecPerMi)} s/mi`);
      }
    }
    expect(bad, 'the recap stated a pace the run disproves').toEqual([]);
  });
});
