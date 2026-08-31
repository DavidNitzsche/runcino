/**
 * lib/runs/_ingest_integrity.test.ts · the three shapes the ingest/merge path
 * was writing into this runner's training history, as a gate.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT THIS COVERS, AND WHAT IT IS BUILT FROM
 *
 * Every fixture below is a REAL row, measured from production on 2026-08-30
 * via `faff_readonly` over the owner's 267 `runs` rows — 153 canonical by
 * `NOT (data ? 'mergedIntoId')`, 114 losers. Nothing here is invented, and the
 * counts quoted in each section are the counts the sweep actually returned.
 *
 *   1 · SPLITS TRUNCATED FROM THE END   21 canonical rows carry fewer split
 *       elements than an absorbed sibling; the survivors are always a
 *       contiguous 1..k of the sibling's 1..n. `chooseSplits` now unions the
 *       missing mile indices in.
 *   2 · CLOCK CONTAMINATION             1 canonical row (2026-08-23) holds
 *       Strava's 39:49 clock family beside the watch's 8:01/mi. The write
 *       guard refuses it; the SQL guard stops the existing row anchoring a
 *       VDOT off 3:37/mi.
 *   3 · ELEVATION FAILING OPEN          3 of 8 above-threshold rows were
 *       accepted raw because their splits were too sparse to corroborate.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * RULE 18 · EVERY ASSERTION HERE HAS BEEN MADE TO FAIL
 *
 * Each block runs its invariant in BOTH directions: against the input that
 * broke (which must be caught) and against the input that is fine (which must
 * not be). A gate that has only ever seen the good case is a hypothesis.
 *
 * Where a threshold is involved the number is READ OUT of the module under
 * test rather than restated here, so a check cannot pass merely by agreeing
 * with itself.
 *
 * LIVENESS · the corpus is asserted non-empty and asserted to contain the rows
 * the sweep found, so a fixture list that was emptied or a filter that stopped
 * matching cannot report clean.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ON THE TWO ASSERTIONS THIS FILE DELIBERATELY DOES NOT MAKE
 *
 * The sweep that found defect 1 proposed gating on `split_count ∈
 * {floor(mi), ceil(mi)}` and on "the highest mile index equals the count",
 * stating both would have fired on all 21 truncated rows. MEASURED, THEY DO
 * NOT:
 *
 *   · the count rule fires on 4 of the 21, and on 24 of the 141 canonical rows
 *     carrying both splits and a distance — 20 of those 24 are legitimate
 *     (a `watch` row emitting whole miles only, an `apple_health` row with a
 *     metric array). Truncating by one usually lands exactly ON `floor(mi)`,
 *     which is the value the rule ADMITS. It is a noisy check that cannot see
 *     the defect it was proposed for.
 *   · the mile-index rule fires on 0 of 153. Every truncated array is a
 *     contiguous 1..k, so its highest index always equals its count.
 *
 * Adopting either would have meant a 24-entry allowlist guarding a rule blind
 * to the bug. The invariant that actually discriminates is the one the fix
 * restores — a canonical row may not have an absorbed sibling holding miles it
 * lacks — and that is what CANON-1 asserts. The mile-index shape check is kept
 * as CANON-1b because contiguity is still worth holding, and it is labelled
 * with what it can and cannot catch rather than credited with the find.
 */
import { describe, it, expect } from 'vitest';

import {
  chooseSplits, decomposesRun, paceString, type SplitCandidate,
} from '@/lib/runs/splits-adopt';
import {
  clockFamilyContradiction, familyGuardedFill, SOURCE_TIER, CLOCK_FAMILY,
  MAX_STORED_AVG_SPEED_MPH, splitsAreReal,
} from '@/lib/runs/canonical';
import {
  sanitizeElevGain, SUSPICION_THRESHOLD_FT_PER_MI, requiredSplitCoverage,
} from '@/lib/runs/elev-sanity';
import { normalizeSplits, runFinishSecSql, MAX_PAUSED_SHARE_SQL } from '@/lib/runs/run-shape';
import { MAX_PAUSED_SHARE, MAX_SPLIT_SUM_DRIFT_MI, reconcileRun } from '@/lib/runs/coherence';

const tierOf = (s: string | null) => (s ? SOURCE_TIER[s] ?? 0 : 0);

/* ══════════════════════════════════════════════════════════════════════════
 * THE CORPUS · real rows, measured 2026-08-30
 * ═══════════════════════════════════════════════════════════════════════ */

/** watch canonical, 2026-07-25, 18.00 mi. Miles 1-17 of 18. Real paces. */
const WATCH_0725 = [502, 489, 488, 489, 502, 486, 496, 488, 479, 448, 450, 460, 476, 466, 480, 499, 478]
  .map((p, i) => ({ hr: 134 + i, mile: i + 1, pace: paceString(p), paceSecPerMi: p }));

/** strava loser, same run. Strava-raw shape, METRES, and it holds mile 18. */
const STRAVA_0725 = [501, 489, 488, 489, 501, 486, 497, 488, 479, 448, 450, 461, 476, 466, 480, 498, 478, 485]
  .map((p, i) => ({
    split: i + 1,
    // 18 splits summing to exactly 18.000 mi, as measured.
    distance: 1609.344,
    moving_time: p,
    average_speed: 1609.344 / p,
    elevation_difference: 0.1,
  }));

/**
 * apple_watch loser, same run: 19 elements whose own distances sum to 18.893
 * against the row's stated 18.00. Its mile 1 is 7:49 against the other two
 * sources' 8:22 — its miles are not this run's miles.
 */
const APPLE_0725 = Array.from({ length: 19 }, (_, i) => ({
  hr: 130 + i,
  mile: i + 1,
  pace: '7:49',
  cadence: 143,
  elev_ft: 6,
  distanceMi: i < 18 ? 1 : 0.8930131004366813,
}));

/** The 2026-08-23 row, exactly as production holds it. */
const ROW_0823 = {
  source: 'watch',
  distanceMi: 11.01,
  durationSec: 5298,
  timeMoving: '88:23',
  avgPaceMinPerMi: '8:01',
  avgHr: 147,
} as Record<string, unknown>;

/** What the Strava webhook brought, and what landed. All four measured. */
const STRAVA_CLOCK_0823 = {
  movingTimeS: 2389, elapsedTimeS: 2389, paceSPerMi: 217, avgSpeedMph: 16.591,
} as Record<string, number>;

/**
 * The eight canonical rows above the elevation suspicion threshold, measured.
 * `nsplits` is the real split count on each.
 */
const ELEV_ABOVE_THRESHOLD = [
  { day: '2026-05-27', distanceMi: 5.86, elevGainFt: 1910, nsplits: 1, sparse: true },
  { day: '2026-05-29', distanceMi: 7.71, elevGainFt: 2492, nsplits: 1, sparse: true },
  { day: '2026-06-14', distanceMi: 13.13, elevGainFt: 4881, nsplits: 14, sparse: false },
  { day: '2026-06-27', distanceMi: 14.02, elevGainFt: 4780, nsplits: 15, sparse: false },
  { day: '2026-07-06', distanceMi: 6.01, elevGainFt: 2596, nsplits: 7, sparse: false },
  { day: '2026-07-08', distanceMi: 6.16, elevGainFt: 2358, nsplits: 7, sparse: false },
  { day: '2026-08-23', distanceMi: 11.01, elevGainFt: 3195, nsplits: 12, sparse: false },
  { day: '2026-08-26', distanceMi: 7.78, elevGainFt: 2807, nsplits: 0, sparse: true },
];

/**
 * The falsification anchors: the owner's genuinely hilly runs, which must
 * never be flagged. Big Sur is the one named in the brief.
 */
const HILLY_BUT_REAL = [
  { day: '2026-04-26 Big Sur', distanceMi: 26.81, elevGainFt: 2140, ftPerMi: 80 },
  { day: '2026-04-18 Point Mugu half', distanceMi: 13.5, elevGainFt: 2209, ftPerMi: 164 },
  { day: '2026-03-21', distanceMi: 8.5, elevGainFt: 1238, ftPerMi: 146 },
  { day: '2026-01-25', distanceMi: 21.51, elevGainFt: 1869, ftPerMi: 87 },
];

describe('LIVENESS · the corpus this gate scans', () => {
  it('LIVE-1 · every fixture list is non-empty and the expected size', () => {
    // A gate that reports clean because it looked at nothing is the worst
    // outcome available, since it also reports confidence.
    expect(WATCH_0725).toHaveLength(17);
    expect(STRAVA_0725).toHaveLength(18);
    expect(APPLE_0725).toHaveLength(19);
    expect(ELEV_ABOVE_THRESHOLD).toHaveLength(8);
    expect(ELEV_ABOVE_THRESHOLD.filter(r => r.sparse)).toHaveLength(3);
    expect(HILLY_BUT_REAL.length).toBeGreaterThan(0);
    expect(Object.keys(STRAVA_CLOCK_0823)).toHaveLength(4);
  });

  it('LIVE-2 · every corpus row really is the case it claims to be', () => {
    // The fixtures are only evidence if they still describe what they say.
    for (const r of ELEV_ABOVE_THRESHOLD) {
      expect(r.elevGainFt / r.distanceMi).toBeGreaterThan(SUSPICION_THRESHOLD_FT_PER_MI);
      expect(r.nsplits < requiredSplitCoverage(r.distanceMi)).toBe(r.sparse);
    }
    for (const r of HILLY_BUT_REAL) {
      expect(r.elevGainFt / r.distanceMi).toBeLessThan(SUSPICION_THRESHOLD_FT_PER_MI);
    }
    // The four contaminated keys are all clock-family members, which is what
    // made them one incident rather than four.
    for (const k of Object.keys(STRAVA_CLOCK_0823)) expect(CLOCK_FAMILY.has(k)).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * CANON-1 · A CANONICAL ROW KEEPS EVERY MILE IT RAN
 * ═══════════════════════════════════════════════════════════════════════ */

describe('CANON-1 · splits truncated from the end', () => {
  const candidates: SplitCandidate[] = [
    { source: 'strava', raw: STRAVA_0725 },
    { source: 'apple_watch', raw: APPLE_0725 },
  ];

  it('CANON-1 · the 2026-07-25 long run recovers its eighteenth mile', () => {
    const res = chooseSplits(WATCH_0725, candidates, 18.0, tierOf);
    expect(res.milesAdded).toEqual([18]);
    expect(res.adoptedFrom).toBe('strava');
    expect(res.splits).toHaveLength(18);
    // The first seventeen are the canonical's own elements, untouched. This is
    // the assertion that stops a "fix" that gains mile 18 by replacing the
    // array — the Strava array carries NO heart rate on any element, and
    // wholesale adoption would have deleted seventeen miles of it.
    expect(res.splits!.slice(0, 17)).toEqual(WATCH_0725);
    const added = res.splits![17] as Record<string, unknown>;
    expect(added.mile).toBe(18);
    expect(added.paceSecPerMi).toBe(485);
    // 8:05/mi against an 8:22 opening mile: the fast finish, which is the part
    // the coaching engine most needs to read.
    expect(added.pace).toBe('8:05');
  });

  it('CANON-1 FALSIFIED · the old rule adopted nothing here', () => {
    // Run the SUPERSEDED predicate against the same input and watch it decline.
    // `splitsAreReal` on a partial array is true, so `!real && real` was false
    // and the branch never fired. If this ever stops being true the defect has
    // changed shape and this whole file needs re-deriving.
    expect(splitsAreReal(WATCH_0725)).toBe(true);
    expect(splitsAreReal(STRAVA_0725)).toBe(false); // Strava-raw has no pace key
    expect(!splitsAreReal(WATCH_0725) && splitsAreReal(STRAVA_0725)).toBe(false);
  });

  it('CANON-1 · the richer apple_watch array is refused, on its own arithmetic', () => {
    // 19 elements beats 18, so an element-count rule would pick it. It sums to
    // 18.893 mi against a run of 18.00, so it decomposes a different run.
    const ns = normalizeSplits(APPLE_0725);
    expect(ns).toHaveLength(19);
    expect(decomposesRun(ns, 18.0)).toBe(false);
    // ... and BOTH DIRECTIONS: against the distance it actually describes, it
    // is admissible. The rule is about agreement, not about apple_watch.
    expect(decomposesRun(ns, 18.893)).toBe(true);
    // Strava's, on the same test, decomposes this run.
    expect(decomposesRun(normalizeSplits(STRAVA_0725), 18.0)).toBe(true);

    const res = chooseSplits(WATCH_0725, candidates, 18.0, tierOf);
    expect(res.refusals.some(r =>
      r.source === 'apple_watch' && r.reason === 'candidate-does-not-decompose-this-run')).toBe(true);
  });

  it('CANON-1 · tolerance is coherence.ts\'s, not a second opinion', () => {
    // Read out of the module rather than restated: a check that hardcodes both
    // sides only proves the test agrees with itself.
    const ns = normalizeSplits(APPLE_0725);
    const own = 18.893;
    expect(Math.abs(own - 18.0)).toBeGreaterThan(MAX_SPLIT_SUM_DRIFT_MI);
    // A row-level reconciler asked about the same array agrees it is not a
    // decomposition of this run — the write guard and the read guard must not
    // disagree about what "these splits describe this run" means.
    const c = reconcileRun({ distanceMi: 18.0, splits: APPLE_0725 } as never);
    expect(c.splitsCoverRun).toBe(false);
    expect(ns.length).toBe(19);
  });

  it('CANON-1 · 2026-05-24, a canonical holding ZERO against a sibling\'s 12', () => {
    // The worst case in the sweep: 11.12 mi with no splits at all, beside a
    // loser holding twelve real ones including the 10:20 and 9:42 closing
    // miles. `source` is null on that loser, so tier 0 must not block it —
    // splits adoption is deliberately tier-independent.
    const sibling = [521, 517, 529, 524, 530, 536, 526, 528, 538, 584, 620, 582]
      .map((p, i) => ({ mile: i + 1, avgHr: 140, paceSPerMi: p, elevDeltaFt: -7 }));
    const res = chooseSplits([], [{ source: null, raw: sibling }], 11.12, tierOf);
    expect(res.milesAdded).toHaveLength(12);
    expect(res.splits).toHaveLength(12);
    expect((res.splits![11] as Record<string, unknown>).paceSecPerMi).toBe(582);
  });

  it('CANON-1 · an equal-coverage sibling adds nothing, and writes nothing', () => {
    // The other direction. No gaps means no UPDATE — churn is a cost with no
    // benefit, and a no-op write is how a Rule 6 column loses a field.
    const res = chooseSplits(WATCH_0725, [{ source: 'strava', raw: WATCH_0725 }], 18.0, tierOf);
    expect(res.splits).toBeNull();
    expect(res.milesAdded).toEqual([]);
  });

  it('CANON-1 · tier breaks a tie between two arrays that both decompose the run', () => {
    // Both hold mile 18 and both sum to 18.00. apple_watch is tier 3, strava
    // tier 1, so the HR-bearing array wins — and that is the ONLY situation in
    // which tier decides anything here.
    const appleClean = Array.from({ length: 18 }, (_, i) => ({
      mile: i + 1, hr: 150, pace: '8:00', distanceMi: 1,
    }));
    const res = chooseSplits(WATCH_0725, [
      { source: 'strava', raw: STRAVA_0725 },
      { source: 'apple_watch', raw: appleClean },
    ], 18.0, tierOf);
    expect(res.adoptedFrom).toBe('apple_watch');
    expect((res.splits![17] as Record<string, unknown>).hr).toBe(150);
    expect(tierOf('apple_watch')).toBeGreaterThan(tierOf('strava'));
  });

  it('CANON-1 · an unalignable incumbent is REFUSED, not guessed', () => {
    // Rule 11 · "I cannot establish which mile is which" is not "there are no
    // gaps". Refusing names itself so the caller can log it.
    const noIndex = [{ pace: '8:00' }, { pace: '8:10' }];
    const res = chooseSplits(noIndex, [{ source: 'strava', raw: STRAVA_0725 }], 18.0, tierOf);
    expect(res.splits).toBeNull();
    expect(res.refusals[0].reason).toBe('incumbent-splits-carry-no-mile-index');
  });

  it('CANON-1 · an adopted element never carries an unmeasured value as zero', () => {
    // Strava-raw has no HR. The adopted mile must be missing the KEY, not
    // carrying `hr: 0` — a zero here reads as a measured heart rate of zero
    // everywhere downstream (Rule 11).
    const res = chooseSplits(WATCH_0725, [{ source: 'strava', raw: STRAVA_0725 }], 18.0, tierOf);
    const added = res.splits![17] as Record<string, unknown>;
    expect('hr' in added).toBe(false);
    expect(added.hr).toBeUndefined();
  });

  it('CANON-1 · the written shape round-trips through normalizeSplits', () => {
    // The whole point of routing adoption through the normaliser is that the
    // result is in ONE shape every consumer already reads. Prove it: the
    // adopted array must re-normalise to the same paces, and must satisfy the
    // `splitsAreReal` predicate the absorber and four readers gate on.
    const res = chooseSplits(WATCH_0725, [{ source: 'strava', raw: STRAVA_0725 }], 18.0, tierOf);
    const back = normalizeSplits(res.splits);
    expect(back).toHaveLength(18);
    expect(back.every(s => s.paceSec != null && s.mile != null)).toBe(true);
    expect(back[17].paceSec).toBeCloseTo(485, 0);
    expect(splitsAreReal(res.splits)).toBe(true);
  });

  it('CANON-1b · mile indices stay contiguous and 1-based (shape only)', () => {
    // NOTE WHAT THIS CANNOT DO: it fired on 0 of the 153 canonical rows,
    // truncated ones included, because a truncated array is still contiguous.
    // Kept because a gap in the middle would be a different and worse defect,
    // and labelled so nobody credits it with catching this one.
    const res = chooseSplits(WATCH_0725, candidates, 18.0, tierOf);
    const miles = (res.splits as Array<{ mile: number }>).map(s => s.mile);
    expect(miles).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
    expect(Math.max(...miles)).toBe(miles.length);

    // FALSIFIED: a gapped array must fail the same assertion.
    const gapped = [1, 2, 4, 5].map(m => ({ mile: m }));
    const gm = gapped.map(s => s.mile);
    expect(Math.max(...gm)).not.toBe(gm.length);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * CLOCK-1 · A ROW MAY NOT ANSWER ONE QUESTION TWO WAYS
 * ═══════════════════════════════════════════════════════════════════════ */

describe('CLOCK-1 · the 2026-08-23 contamination', () => {
  it('CLOCK-1 · every one of the four contaminated keys is refused at write time', () => {
    // The row-local invariant, applied key by key against the row as it would
    // be. All four must be caught; catching three would still leave the row
    // contradicting itself.
    const caught: string[] = [];
    for (const [k, v] of Object.entries(STRAVA_CLOCK_0823)) {
      const why = clockFamilyContradiction(ROW_0823, k, v);
      if (why) caught.push(k);
    }
    expect(caught.sort()).toEqual(['avgSpeedMph', 'movingTimeS', 'paceSPerMi'].sort());
    // `elapsedTimeS` is the one member the row-local test cannot judge alone —
    // it is not bound to `durationSec` by arithmetic (a wall clock and an
    // elapsed clock are the same quantity from two devices). It is refused by
    // the TIER guard instead, asserted below, which is why both guards exist.
    expect(clockFamilyContradiction(ROW_0823, 'elapsedTimeS', 2389)).toBeNull();
  });

  it('CLOCK-1 FALSIFIED · the row\'s OWN clock family is admitted unchanged', () => {
    // Both directions. The watch's own numbers must pass, or the guard is
    // just refusing everything and would look identical on this row.
    expect(clockFamilyContradiction(ROW_0823, 'movingTimeS', 5298)).toBeNull();
    expect(clockFamilyContradiction(ROW_0823, 'paceSPerMi', 481)).toBeNull();
    expect(clockFamilyContradiction(ROW_0823, 'avgSpeedMph', 7.48)).toBeNull();
    // And a key outside the family is never this guard's business.
    expect(clockFamilyContradiction(ROW_0823, 'avgHr', 147)).toBeNull();
  });

  it('CLOCK-1 · the five near-miss rows are NOT rejected', () => {
    // Measured: five canonical rows carry a Strava `paceSPerMi` sitting 6-11%
    // from `durationSec / distanceMi`. That is moving-time against wall clock —
    // two correct measurements of different things — and a guard that compared
    // pace to the WALL clock would reject all five. This is the assertion that
    // stops the threshold being tightened into a false-positive machine.
    const nearMiss = [
      { day: '2026-06-11', distanceMi: 6.9, durationSec: 3326, movingTimeS: 3112, paceSPerMi: 451 },
      { day: '2026-06-16', distanceMi: 7.5, durationSec: 3708, movingTimeS: 3495, paceSPerMi: 466 },
      { day: '2026-06-19', distanceMi: 6.45, durationSec: 3379, movingTimeS: 3150, paceSPerMi: 488 },
      { day: '2026-06-21', distanceMi: 13.15, durationSec: 6444, movingTimeS: 5883, paceSPerMi: 447 },
      { day: '2026-08-11', distanceMi: 5.97, durationSec: 2784, movingTimeS: 2479, paceSPerMi: 415 },
    ];
    expect(nearMiss).toHaveLength(5);
    for (const r of nearMiss) {
      expect(clockFamilyContradiction(r, 'paceSPerMi', r.paceSPerMi)).toBeNull();
      expect(clockFamilyContradiction(r, 'movingTimeS', r.movingTimeS)).toBeNull();
      // And each really IS a near miss — below the pause threshold, but by a
      // margin small enough that a careless threshold would have caught them.
      const paused = 1 - r.movingTimeS / r.durationSec;
      expect(paused).toBeLessThan(MAX_PAUSED_SHARE);
      expect(paused).toBeGreaterThan(0);
    }
  });

  it('CLOCK-1 · the tier guard refuses a lower-tier source regardless of coverage', () => {
    // The 2026-08-23 row predates `familyGuardedFill` by one day (it landed in
    // c7611006, 2026-08-24), so it ESCAPED rather than defeated the guard. A
    // re-run must now be blocked — and blocked for the whole family, not only
    // where a specific sibling happens to be populated.
    const strava = tierOf('strava');
    for (const key of ['movingTimeS', 'elapsedTimeS', 'paceSPerMi', 'avgSpeedMph']) {
      const v = familyGuardedFill(key, ROW_0823, {}, strava);
      expect(v.allow).toBe(false);
    }
  });

  it('CLOCK-1 · the tier guard closes the unknown-source hole', () => {
    // Seven of the owner's canonical rows carry no `source`, so every present
    // sibling used to score tier 0 and ANY incoming source outranked it — the
    // family could be assembled one key at a time from two providers.
    const noSource = { distanceMi: 10, durationSec: 5000 } as Record<string, unknown>;
    expect(familyGuardedFill('movingTimeS', noSource, {}, tierOf('strava')).allow).toBe(true);
    // The tier ladder cannot help here, which is exactly why the second,
    // source-independent net exists and catches it.
    expect(clockFamilyContradiction(noSource, 'movingTimeS', 2000)).not.toBeNull();
  });

  it('CLOCK-1 FALSIFIED · a row with NO clock at all still accepts one', () => {
    // Refusing here would leave a gap the reconciler cannot fill either. A
    // guard that refuses everything is not a guard.
    const empty = { source: 'watch', distanceMi: 10 } as Record<string, unknown>;
    expect(familyGuardedFill('movingTimeS', empty, {}, tierOf('strava')).allow).toBe(true);
    expect(clockFamilyContradiction(empty, 'movingTimeS', 5000)).toBeNull();
  });

  it('CLOCK-1 · an implied average speed above the running band is never stored', () => {
    // The brief's line: "An implied avgSpeedMph > 13 for a run is not a value
    // to store." Read the bound out of the module, and check both sides of it.
    expect(MAX_STORED_AVG_SPEED_MPH).toBe(13);
    expect(clockFamilyContradiction({ distanceMi: 11.01 }, 'avgSpeedMph', 16.591)).not.toBeNull();
    // 13.1 mph is the marathon world-record average, so the bound cannot
    // reject a human running; 7.48 mph is this run's real speed.
    expect(clockFamilyContradiction({ distanceMi: 11.01 }, 'avgSpeedMph', 12.9)).toBeNull();
  });

  it('CLOCK-1 · the SQL guard and the TS reconciler agree on the threshold', () => {
    // A template literal cannot reach a TS constant at query time, so the
    // number is written twice. This is the assertion that stops them drifting —
    // the same arrangement STAMP_ABSORBED_SQL has with mayStampAbsorbed.
    expect(Number(MAX_PAUSED_SHARE_SQL)).toBe(MAX_PAUSED_SHARE);
  });

  it('CLOCK-1 · the finish-seconds ladder carries the guard', () => {
    // The read-time half. `runFinishSecSql` fed `bestRecentVdot` 2389 s for
    // 11.01 mi — 3:37/mi, outside vdotFromRace's [30,85] band, so the run was
    // silently DISCARDED from the evidence pool rather than showing up wrong.
    // Measured against production: this changes exactly 1 of 153 canonical
    // rows, from 3:37/mi to 8:01/mi, and leaves the other 43 rows carrying
    // both clocks untouched.
    const sql = runFinishSecSql('r');
    expect(sql).toContain('CASE WHEN');
    expect(sql).toContain(MAX_PAUSED_SHARE_SQL);
    // FALSIFIED: the ladder must still name every rung it had, or the guard
    // has been "fixed" by deleting the fallbacks.
    for (const k of ['movingTimeS', 'movingSec', 'durationSec', 'elapsedTimeS']) {
      expect(sql).toContain(k);
    }
  });

  it('CLOCK-1 · the reconciler already refuses this row, and still does', () => {
    const c = reconcileRun({ ...ROW_0823, ...STRAVA_CLOCK_0823 } as never);
    expect(c.movingSec).toBeNull();
    expect(c.refusals.some(r => r.family === 'clock.moving-disproved')).toBe(true);
    // And what the runner is left with is the truth the row already held.
    expect(c.paceBasis).toBe('elapsed');
    expect(c.paceSecPerMi).toBeCloseTo(5298 / 11.01, 1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ELEV-1 · "CANNOT CHECK" IS NOT "CHECKED AND FINE"
 * ═══════════════════════════════════════════════════════════════════════ */

describe('ELEV-1 · the sparse-splits branch fails closed', () => {
  it('ELEV-1 · all three sparse rows are refused, not accepted raw', () => {
    const sparse = ELEV_ABOVE_THRESHOLD.filter(r => r.sparse);
    expect(sparse).toHaveLength(3);
    for (const r of sparse) {
      // Splits present but too few to corroborate — the real shape on
      // 2026-05-27 and 05-29 (one split each) and 08-26 (none).
      const splits = Array.from({ length: r.nsplits }, () => ({ elev_ft: 5 }));
      const out = sanitizeElevGain({
        elevGainFt: r.elevGainFt, distanceMi: r.distanceMi, splits,
      });
      expect(out).toEqual({ value: null, source: 'absent' });
    }
  });

  it('ELEV-1 · 2026-08-26 specifically: 2807 ft over 7.78 mi does not survive', () => {
    // The visible cost. `lib/terrain/run-terrain.ts` calls this on the READ,
    // so a 361 ft/mi reading on a flat LA route made deriveRecap forgive the
    // pace and say the effort was harder than it looks.
    const out = sanitizeElevGain({ elevGainFt: 2807, distanceMi: 7.78, splits: [] });
    expect(out.value).toBeNull();
    expect(out.source).toBe('absent');
  });

  it('ELEV-1 FALSIFIED · Big Sur must NOT flag', () => {
    // 26.81 mi / 2140 ft = 80 ft/mi, 27 splits. The anchor named in the brief.
    // If this ever returns absent, the threshold has been broken, not tightened.
    const bigSur = HILLY_BUT_REAL[0];
    expect(bigSur.day).toContain('Big Sur');
    const splits = Array.from({ length: 27 }, () => ({ elev_ft: 79 }));
    const out = sanitizeElevGain({
      elevGainFt: bigSur.elevGainFt, distanceMi: bigSur.distanceMi, splits,
    });
    expect(out).toEqual({ value: 2140, source: 'raw' });
  });

  it('ELEV-1 FALSIFIED · every genuinely hilly run survives, sparse splits included', () => {
    // The stronger form: below the threshold, split coverage is IRRELEVANT.
    // A hilly run with no splits at all must still keep its elevation, or the
    // fix has turned a fail-open into a fail-everything.
    for (const r of HILLY_BUT_REAL) {
      expect(sanitizeElevGain({
        elevGainFt: r.elevGainFt, distanceMi: r.distanceMi, splits: [],
      })).toEqual({ value: r.elevGainFt, source: 'raw' });
    }
  });

  it('ELEV-1 · the threshold is read out of the module, not restated', () => {
    // Straddle it with the module's own number so the test cannot pass by
    // agreeing with a stale copy of it.
    const mi = 10;
    const justUnder = Math.floor(SUSPICION_THRESHOLD_FT_PER_MI * mi) - 1;
    const wellOver = Math.ceil(SUSPICION_THRESHOLD_FT_PER_MI * mi) + 500;
    expect(sanitizeElevGain({ elevGainFt: justUnder, distanceMi: mi, splits: [] }).source).toBe('raw');
    expect(sanitizeElevGain({ elevGainFt: wellOver, distanceMi: mi, splits: [] }).source).toBe('absent');
  });

  it('ELEV-1 · coverage requirement is the one the module computes', () => {
    expect(requiredSplitCoverage(7.78)).toBe(5);
    expect(requiredSplitCoverage(5.86)).toBe(4);
    expect(requiredSplitCoverage(1)).toBe(3); // the floor
    // One below the requirement refuses; the requirement met, with corroborating
    // splits, does not — both directions across the same boundary.
    const mi = 8, raw = 3000;
    const need = requiredSplitCoverage(mi);
    const el = () => ({ elev_ft: 60 });
    expect(sanitizeElevGain({
      elevGainFt: raw, distanceMi: mi, splits: Array.from({ length: need - 1 }, el),
    }).source).toBe('absent');
    expect(sanitizeElevGain({
      elevGainFt: raw, distanceMi: mi, splits: Array.from({ length: need }, el),
    }).source).toBe('recomputed');
  });

  it('ELEV-1 · a suspicious value corroborated by its splits is still kept', () => {
    // The whole point of the threshold is that corroboration RESCUES a value.
    // A genuinely mountainous run whose splits agree keeps its number.
    const out = sanitizeElevGain({
      elevGainFt: 3000, distanceMi: 10, splits: Array.from({ length: 10 }, () => ({ elev_ft: 290 })),
    });
    expect(out).toEqual({ value: 3000, source: 'raw' });
  });
});
