/**
 * lib/runs/_ingest_split_reconciliation.test.ts · ONE predicate for whether a
 * splits array reconciles with its run (Rule 16).
 *
 * `/api/ingest/workout` and `/api/watch/workouts/complete` both decide whether
 * to keep a payload's per-mile splits. Until 2026-08-31 they decided it
 * DIFFERENTLY: the watch route called `splitTimesReliable`, and the HealthKit
 * route carried a private `Math.abs(deltaS) <= 5` copy — the exact symmetric
 * rule `split-coverage.ts`'s own header records as replaced, because
 * `deriveSplitsFromPaceSamples` only emits a split on a whole-mile crossing, so
 * a run ending mid-mile legitimately falls one tail's worth of seconds short.
 *
 * Measured cost, on the owner's account: `runs.id = -41598809443969`
 * (2026-08-31, 6.18 mi, 51:35) arrived with SEVEN per-mile splits summing 2985s
 * against a 3095s duration. The 110-second shortfall is almost exactly the
 * un-split final 0.18 mile at that run's own pace. All seven were discarded,
 * which left the Evidence Engine with no heart-rate curve for that run at all.
 *
 * ── WHAT THIS FILE CANNOT FAIL ON (Rule 22) ────────────────────────────────
 *
 * It tests the PREDICATE, not the routes. It cannot catch a route that stops
 * calling the predicate, passes it the wrong duration, or drops the splits for
 * some other reason downstream — the greps at the bottom are the closest thing
 * to that, and they check the shape of the source rather than its behaviour.
 * It also cannot say whether keeping a shortfall-bearing splits array is
 * PHYSIOLOGICALLY right; that is what the shortfall bound encodes, and the
 * bound is `split-coverage.ts`'s to defend.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { splitTimesReliable, splitsSumSeconds } from './split-coverage';

const WEB_V2 = join(__dirname, '..', '..');
const src = (p: string) => readFileSync(join(WEB_V2, p), 'utf8');

/** Comments describe the old rule by name — the header of the very function
 *  that was fixed quotes it — so the ban below must read CODE only, or it
 *  fails on its own explanation. */
const code = (p: string) =>
  src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('split reconciliation · one predicate, two routes', () => {
  it("keeps the owner's 2026-08-31 splits — the shortfall is the un-split tail", () => {
    // The real numbers from `runs.data.splits_validation` on that row.
    expect(splitTimesReliable(2985, 3095, 6.18)).toBe(true);
    // FALSIFICATION · the rule the HealthKit route used to carry rejects them,
    // which is what actually happened in production. If this ever starts
    // passing, the old rule has come back.
    expect(Math.abs(2985 - 3095) <= 5).toBe(false);
  });

  it('still rejects an over-claim — the pause bug the check was written for', () => {
    // Splits summing MORE than the run lasted is impossible, and is the
    // signature of GPS-derived splits that ignored HKWorkoutEvent pauses.
    expect(splitTimesReliable(3200, 3095, 6.18)).toBe(false);
    // Right at the boundary, both sides.
    expect(splitTimesReliable(3099, 3095, 6.18)).toBe(true);
    expect(splitTimesReliable(3101, 3095, 6.18)).toBe(false);
  });

  it('rejects a shortfall bigger than one whole mile', () => {
    // A WHOLE mile missing is a broken array, not a tail. At 8:21/mi the
    // allowance is ~551s, so 700s short must fail.
    expect(splitTimesReliable(3095 - 700, 3095, 6.18)).toBe(false);
    expect(splitTimesReliable(3095 - 300, 3095, 6.18)).toBe(true);
  });

  it("accepts the owner's 2026-08-30 long run, whose splits cover 13.0 of 13.49 mi", () => {
    const splits = [505, 490, 470, 412, 442, 518, 436, 453, 474, 447, 510, 501, 505]
      .map((paceSecPerMi) => ({ paceSecPerMi, distanceMi: 1 }));
    const sum = splitsSumSeconds(splits);
    expect(sum).toBe(6163);
    expect(splitTimesReliable(sum, 6383, 13.49)).toBe(true);
  });

  it('BOTH ingest routes call the shared predicate, and neither keeps a private copy', () => {
    const hk = code('app/api/ingest/workout/route.ts');
    const watch = code('app/api/watch/workouts/complete/route.ts');
    for (const [name, s] of [['ingest/workout', hk], ['watch/workouts/complete', watch]] as const) {
      expect(s, `${name} must import the shared predicate`).toMatch(
        /from '@\/lib\/runs\/split-coverage'/,
      );
      expect(s, `${name} must call splitTimesReliable`).toMatch(/splitTimesReliable\s*\(/);
      // The private symmetric rule, in the shapes it has actually been written
      // in. LIVENESS: this pattern matched the HealthKit route before the fix,
      // which is how this assertion is known to be able to fail.
      expect(s, `${name} must not re-implement the ±5s rule`).not.toMatch(
        /Math\.abs\(\s*deltaS\s*\)\s*<=\s*5/,
      );
    }
  });

  it('the reconciliation is recorded whatever the verdict, not only on a drop', () => {
    // A continuity reader needs the numbers on the GOOD rows too, to tell an
    // interruption from an un-split tail. `splits_validation: reliable ? null`
    // collapsed "the clock reconciled" and "nothing ever checked" into the
    // same absent key (Rule 11).
    const hk = code('app/api/ingest/workout/route.ts');
    expect(hk).not.toMatch(/splits_validation:\s*splitsCheck\.reliable\s*\?\s*null/);
    expect(hk).toMatch(/splits_validation:\s*rawSplits\.length === 0 \? null/);
  });

  it('LIVENESS · the two route files were actually read', () => {
    // Rule 18: a scanner that reports clean because it looked at nothing is
    // the worst outcome available, since it also reports confidence.
    expect(src('app/api/ingest/workout/route.ts').length).toBeGreaterThan(10_000);
    expect(src('app/api/watch/workouts/complete/route.ts').length).toBeGreaterThan(10_000);
    // And the comment stripper left real code behind rather than emptying the
    // file, which would make every `not.toMatch` above pass vacuously.
    expect(code('app/api/ingest/workout/route.ts')).toMatch(/splitTimesReliable/);
    expect(code('app/api/ingest/workout/route.ts').length).toBeGreaterThan(5_000);
  });
});
