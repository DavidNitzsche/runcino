/**
 * lib/training/_pace_corpus.test.ts · direct-evidence pace readers, unit gate.
 *
 * Pure functions only — everything here is constructed by hand, no database.
 * `_pace_corpus.audit.test.ts` is the DB-backed companion that runs these same
 * readers against the owner's real account (Rule 13).
 *
 * ── WHAT THIS SUITE CANNOT FAIL ON (Rule 22) ────────────────────────────────
 *
 *  · A corpus that is uniformly wrong (a mis-calibrated watch corroborating
 *    itself K times) — same blind spot `vdot-corpus.ts`'s own gate names, for
 *    the same reason: corroboration defends against one bad row, not a bad
 *    instrument.
 *  · The DB loader (`loadCandidateRows`, `loadHrContext`, `loadPhasesByDate`)
 *    and the Rule 8 window loader (`loadPrescribedWindows`) — nothing here
 *    executes SQL.
 *  · Whether the classification bands are RIGHT for a human — that is a
 *    physiology claim the doctrine gate (`lib/doctrine/registry.ts`) makes,
 *    not this file.
 */
import { describe, it, expect } from 'vitest';
import {
  easyPaceCorpus,
  thresholdPaceCorpus,
  thresholdSegmentFromSplits,
  thresholdSegmentFromWholeRun,
  thresholdSegmentFromPhases,
  classifyEasyCandidates,
  classifyThresholdCandidates,
  EASY_PCT_HRMAX_BAND,
  THRESHOLD_PCT_HRMAX_BAND,
  THRESHOLD_MIN_QUALIFYING_SEC,
  THRESHOLD_MAX_REP_SEC,
  THRESHOLD_MIN_SESSION_TOTAL_SEC,
  EASY_MIN_DURATION_SEC,
  type PaceObservation,
  type CandidateRow,
  type HrContext,
  fullAuthority,
} from '@/lib/training/pace-corpus';
import { vdotFromRun, tPaceFromVdot } from '@/lib/training/vdot';
import type { PhaseBreakdown } from '@/lib/coach/run-state';

const MAX_HR = 190; // a plausible adult max, used across fixtures

/** An avgHr that lands in the middle of a %HRmax band. */
const midOfBand = (band: readonly [number, number]) => Math.round(MAX_HR * ((band[0] + band[1]) / 2));

const ctxHrMaxOnly: HrContext = { maxHrBpm: MAX_HR, lthrBpm: null, lthrFresh: false };

function obs(over: Partial<PaceObservation> & { id: string }): PaceObservation {
  return {
    ...fullAuthority(),
    date: '2026-08-01',
    paceSecPerMi: 480,
    durationSec: 1800,
    source: 'whole-run',
    hrBasis: 'pct_hrmax',
    hrPct: null,
    hrBandDistance: null,
    ...over,
  };
}

describe('easyPaceCorpus · pure statistic', () => {
  it('refuses with no observations', () => {
    const r = easyPaceCorpus([]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no_observations');
  });

  it('refuses below the corroboration minimum (K=3)', () => {
    const r = easyPaceCorpus([obs({ id: 'a', paceSecPerMi: 480 }), obs({ id: 'b', paceSecPerMi: 490 })]);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.reason).toBe('insufficient_corroboration'); expect(r.observations).toBe(2); }
  });

  it('reports the ceiling as the Kth-fastest qualifying pace', () => {
    // Paces s/mi, fastest first: 460, 470, 480(K=3rd fastest), 500, 520.
    const observations = [460, 470, 480, 500, 520].map((p, i) => obs({ id: `r${i}`, paceSecPerMi: p }));
    const r = easyPaceCorpus(observations, 3);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.observations).toBe(5);
      expect(r.ceilingSecPerMi).toBe(480);
      expect(r.supporting.length).toBe(3);
      expect(r.supporting.map((o) => o.paceSecPerMi)).toEqual([460, 470, 480]);
    }
  });

  it('a single fast outlier cannot set the ceiling alone — needs K corroborating runs', () => {
    // One very fast run (350) plus four ordinary ones (600s) — with 5 runs
    // the 3rd-fastest is 600, not 350, so the outlier alone cannot move it.
    const observations = [350, 600, 600, 600, 600].map((p, i) => obs({ id: `o${i}`, paceSecPerMi: p }));
    const r = easyPaceCorpus(observations, 3);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ceilingSecPerMi).toBe(600);
    }
  });

  it('additional SLOWER evidence cannot move the ceiling — the order-statistic property both readers rely on', () => {
    const withoutMore = [450, 460, 470].map((p, i) => obs({ id: `w${i}`, paceSecPerMi: p }));
    const withMoreSlower = [...withoutMore, obs({ id: 'slow1', paceSecPerMi: 700 }), obs({ id: 'slow2', paceSecPerMi: 720 })];
    const a = easyPaceCorpus(withoutMore, 3);
    const b = easyPaceCorpus(withMoreSlower, 3);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(b.ceilingSecPerMi).toBe(a.ceilingSecPerMi); // unmoved — insensitive to the bottom
      expect(b.observations).toBe(5);
    }
  });

  it('additional FASTER evidence DOES move the ceiling — this is why Rule 8 filtering still matters for a rested/taper day', () => {
    // A pool of 3 ordinary easy paces, then a 4th, genuinely faster observation
    // enters (e.g. a rested taper-week easy run read faster than usual). With
    // K=3 the 3rd-fastest of 4 becomes faster than the 3rd-fastest of 3 — the
    // ceiling MOVES on new fast evidence, unlike on new slow evidence above.
    // This is exactly the scenario resolveEasyPaceCorpus's Rule 8 filter
    // exists to keep out of the pool in the first place.
    const base = [460, 470, 480].map((p, i) => obs({ id: `b${i}`, paceSecPerMi: p }));
    const withFastTaperDay = [...base, obs({ id: 'taper-fast', paceSecPerMi: 440 })];
    const a = easyPaceCorpus(base, 3);
    const b = easyPaceCorpus(withFastTaperDay, 3);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(b.ceilingSecPerMi).toBeLessThan(a.ceilingSecPerMi); // faster (smaller s/mi)
    }
  });
});

describe('thresholdPaceCorpus · pure statistic (zone-bucketed VDOT reuse)', () => {
  it('refuses below K', () => {
    const r = thresholdPaceCorpus([obs({ id: 'a', paceSecPerMi: 400 })]);
    expect(r.ok).toBe(false);
  });

  it('round-trips through vdotFromTpace/tPaceFromVdot consistently', () => {
    const pace = 420; // 7:00/mi
    const observations = [0, 1, 2].map((i) => obs({ id: `t${i}`, paceSecPerMi: pace }));
    const r = thresholdPaceCorpus(observations, 3);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Corroborating three IDENTICAL paces should return that exact pace
      // (VDOT round-trip may introduce sub-second rounding).
      expect(Math.abs(r.tPaceSecPerMi - pace)).toBeLessThanOrEqual(2);
      expect(tPaceFromVdot(r.vdot)).not.toBeNull();
    }
  });

  it('deduplicates repeated ids (two qualifying segments off the same run), keeping the faster', () => {
    const observations = [
      obs({ id: 'dup', paceSecPerMi: 430 }),
      obs({ id: 'dup', paceSecPerMi: 410 }), // faster segment, same run
      obs({ id: 'b', paceSecPerMi: 420 }),
      obs({ id: 'c', paceSecPerMi: 425 }),
    ];
    const r = thresholdPaceCorpus(observations, 3);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.observations).toBe(3); // 'dup' counted once, not twice
  });
});

describe('thresholdSegmentFromSplits · splits-aware, the owner\'s "Broken Long Run" shape', () => {
  it('reads the sustained T-zone segment, excluding diluting recovery jogs', () => {
    const tHr = midOfBand(THRESHOLD_PCT_HRMAX_BAND); // e.g. ~169 for MAX_HR=190
    const easyHr = midOfBand(EASY_PCT_HRMAX_BAND); // e.g. ~136
    // A broken workout: warm-up (easy), 3 T-pace miles, a recovery jog, 2 more
    // T-pace miles, cool-down (easy). Splits are `faff-hr` shape.
    const splits = [
      { mile: 1, hr: easyHr, pace: '9:30', paceSecPerMi: 570 }, // warm-up
      { mile: 2, hr: tHr, pace: '6:50', paceSecPerMi: 410 },     // T rep
      { mile: 3, hr: tHr, pace: '6:48', paceSecPerMi: 408 },     // T rep
      { mile: 4, hr: tHr, pace: '6:52', paceSecPerMi: 412 },     // T rep
      { mile: 5, hr: easyHr, pace: '9:20', paceSecPerMi: 560 },  // recovery jog
      { mile: 6, hr: tHr, pace: '6:55', paceSecPerMi: 415 },     // T rep
      { mile: 7, hr: tHr, pace: '6:49', paceSecPerMi: 409 },     // T rep
      { mile: 8, hr: easyHr, pace: '9:40', paceSecPerMi: 580 },  // cool-down
    ];
    const seg = thresholdSegmentFromSplits(splits, ctxHrMaxOnly);
    expect(seg).not.toBeNull();
    if (seg) {
      expect(seg.source).toBe('splits');
      // The segment pace should be close to the T-pace splits (~410), NOT the
      // whole-run average (which is dragged toward ~480 by the easy miles).
      expect(seg.paceSecPerMi).toBeGreaterThan(405);
      expect(seg.paceSecPerMi).toBeLessThan(420);
      const wholeRunAvg = splits.reduce((s, x) => s + x.paceSecPerMi, 0) / splits.length;
      expect(seg.paceSecPerMi).toBeLessThan(wholeRunAvg); // segment is faster than the diluted average
    }
  });

  it('refuses when the qualifying pool is too short to be a real T session', () => {
    const tHr = midOfBand(THRESHOLD_PCT_HRMAX_BAND);
    const splits = [{ mile: 1, hr: tHr, pace: '6:50', paceSecPerMi: 410, distanceMi: 0.3 }]; // ~2 min
    const seg = thresholdSegmentFromSplits(splits, ctxHrMaxOnly);
    expect(seg).toBeNull();
  });

  it('refuses with no usable splits', () => {
    expect(thresholdSegmentFromSplits([], ctxHrMaxOnly)).toBeNull();
    expect(thresholdSegmentFromSplits(null, ctxHrMaxOnly)).toBeNull();
    expect(thresholdSegmentFromSplits(undefined, ctxHrMaxOnly)).toBeNull();
  });

  it('RULE 18 · refuses a splits array that does not reconcile against the row\'s own distance', () => {
    const tHr = midOfBand(THRESHOLD_PCT_HRMAX_BAND);
    const splits = [
      { mile: 1, hr: tHr, pace: '6:50', paceSecPerMi: 410, distanceMi: 1 },
      { mile: 2, hr: tHr, pace: '6:48', paceSecPerMi: 408, distanceMi: 1 },
      { mile: 3, hr: tHr, pace: '6:52', paceSecPerMi: 412, distanceMi: 1 },
    ];
    // The array itself is a perfectly good 3-mile T session by its own
    // arithmetic — the defect is that the ROW claims a wildly different
    // distance (e.g. a fabricated-tail or wrong-sibling adoption, the exact
    // shape splits-adopt.ts documents a real production row for).
    const rejected = thresholdSegmentFromSplits(splits, ctxHrMaxOnly, 12.0);
    expect(rejected).toBeNull();
    // The SAME array against a row distance it actually reconciles with is
    // admitted — falsifying the guard in both directions (Rule 18).
    const admitted = thresholdSegmentFromSplits(splits, ctxHrMaxOnly, 3.0);
    expect(admitted).not.toBeNull();
    // No row distance supplied at all (the pure-function unit tests above) —
    // the reconciliation check is skipped, not refused; this is the
    // documented default for a caller that doesn't have it.
    const noDistanceGiven = thresholdSegmentFromSplits(splits, ctxHrMaxOnly);
    expect(noDistanceGiven).not.toBeNull();
  });
});

describe('thresholdSegmentFromSplits · seed-and-grow, three real runs (Rule 13)', () => {
  // David's own real profile at the time this fix landed: fresh LTHR 168,
  // HRmax 183. All three fixtures below are pasted VERBATIM from
  // `runs.data.splits` for user_uuid 0645f40c-951d-4ccc-b86e-9979cd26c795
  // (read via DATABASE_URL_RO, 2026-08-31) — not paraphrased, not rounded.
  //
  // FALSIFIED AGAINST THE UNFIXED CODE (Rule 18): before this change, all
  // three of these real `tempo`-labeled runs produced NO threshold
  // observation at all. `thresholdSegmentFromSplits` returned null for every
  // one of them — 2026-07-21 and 2026-07-14 because `reconcileSplitsTotal`
  // rejected their real, coherent splits arrays (the first has no per-split
  // distance on 7 of 8 miles, manufacturing a false ~7 mi "mismatch"; the
  // second's 9 mile-trigger splits sum 0.39 mi — 4.9% — over their own row's
  // distance, ordinary GPS auto-lap noise the old 0.25 mi absolute tolerance
  // was too tight to admit); 2026-06-18 DID reconcile but its per-split
  // absolute T-zone HR gate (95-102% of a fresh 168 LTHR) excluded mile 3 at
  // 157 bpm / 93.5% — just under the floor, the exact "HR is still climbing
  // while pace has already arrived" shape Research/03 §1's own onset-lag row
  // names. `thresholdSegmentFromWholeRun` could not rescue any of the three
  // either — verified below — because a whole-run average diluted by
  // warm-up/cool-down never clears the T-band. All three of these facts were
  // reproduced against the live account before landing this fix.
  const ctx: HrContext = { maxHrBpm: 183, lthrBpm: 168, lthrFresh: true };

  it('2026-07-21 (tempo, 7.52 mi) · work block miles 3-6, 451 s/mi — was NULL under the old absolute band + strict reconciliation', () => {
    const splits = [
      { mile: 1, hr: 125, paceSecPerMi: 521 }, // warm-up
      { mile: 2, hr: 142, paceSecPerMi: 491 }, // warm-up
      { mile: 3, hr: 159, paceSecPerMi: 438 }, // work — 93.5% LTHR, BELOW the old absolute floor
      { mile: 4, hr: 156, paceSecPerMi: 450 }, // work — 92.9% LTHR, also below it
      { mile: 5, hr: 160, paceSecPerMi: 463 }, // work
      { mile: 6, hr: 160, paceSecPerMi: 453 }, // work
      { mile: 7, hr: 149, paceSecPerMi: 535 }, // cool-down
      { mile: 8, hr: null, paceSecPerMi: 501, distanceMi: 0.5167322834645669 }, // cool-down tail, no HR
    ];
    // reconcileSplitsTotal on this row's real distance (7.52 mi) returns
    // FALSE — 7 of these 8 splits carry no per-split distance at all, so the
    // old un-defaulted sum is ~0.52 mi against a 7.52 mi row. The new
    // reconciliation defaults a distance-less split to 1 mile ONLY when at
    // least one split in the array anchors a real distance (here, the
    // trailing partial mile does), which is what lets this array reconcile
    // at all: 7 × 1 mi + 0.5167 mi = 7.5167 mi against 7.52 mi.
    const seg = thresholdSegmentFromSplits(splits, ctx, 7.52);
    expect(seg).not.toBeNull();
    if (seg) {
      expect(seg.source).toBe('splits');
      expect(seg.paceSecPerMi).toBe(451);
      expect(seg.durationSec).toBe(1804); // 438+450+463+453 — all 4 real work miles pooled
      // A run whose row-level avgHr (148) is itself under the T-band (the
      // dilution `thresholdSegmentFromWholeRun` cannot see past).
      const wholeRun = thresholdSegmentFromWholeRun(
        { finishSec: 3607, distanceMi: 7.52, avgHr: 148, workoutTypeRaw: 'tempo' }, ctx,
      );
      expect(wholeRun).toBeNull();
    }
  });

  it('2026-06-18 (tempo, 8.15 mi) · work block miles 3-6, 425.5 s/mi — recovers mile 3 the old absolute HR gate dropped', () => {
    const splits = [
      { mile: 1, hr: 125, paceSecPerMi: 518, distanceMi: 1 },
      { mile: 2, hr: 137, paceSecPerMi: 501, distanceMi: 1 },
      { mile: 3, hr: 157, paceSecPerMi: 427, distanceMi: 1 }, // 93.5% LTHR — below the OLD absolute floor
      { mile: 4, hr: 162, paceSecPerMi: 420, distanceMi: 1 },
      { mile: 5, hr: 164, paceSecPerMi: 432, distanceMi: 1 },
      { mile: 6, hr: 167, paceSecPerMi: 423, distanceMi: 1 },
      { mile: 7, hr: 150, paceSecPerMi: 546, distanceMi: 1 },
      { mile: 8, hr: 145, paceSecPerMi: 527, distanceMi: 1 },
      { mile: 9, hr: 144, paceSecPerMi: 474, distanceMi: 0.3080168776371308 },
    ];
    const seg = thresholdSegmentFromSplits(splits, ctx, 8.15);
    expect(seg).not.toBeNull();
    if (seg) {
      expect(seg.paceSecPerMi).toBe(425.5);
      expect(seg.durationSec).toBe(1702); // 427+420+432+423 — mile 3 IS pooled this time
    }
  });

  it('2026-07-14 (tempo, 8.02 mi) · work miles 3-4, 435 s/mi — excludes the anomalous mile 5 on HR, not by special-casing it', () => {
    const splits = [
      { mile: 1, hr: 122, paceSecPerMi: 518, distanceMi: 1 },
      { mile: 2, hr: 131, paceSecPerMi: 452, distanceMi: 1 },
      { mile: 3, hr: 154, paceSecPerMi: 437, distanceMi: 1 },
      { mile: 4, hr: 160, paceSecPerMi: 433, distanceMi: 1 },
      // A real anomaly (downhill mile or sensor glitch): 6:46/mi at only 141
      // bpm — inside this run's own EASY band despite a fast GPS pace.
      { mile: 5, hr: 141, paceSecPerMi: 406, distanceMi: 1 },
      { mile: 6, hr: 150, paceSecPerMi: 440, distanceMi: 1 },
      { mile: 7, hr: 149, paceSecPerMi: 491, distanceMi: 1 },
      { mile: 8, hr: 145, paceSecPerMi: 506, distanceMi: 1 },
      { mile: 9, hr: 149, paceSecPerMi: 460, distanceMi: 0.4108695652173913 },
    ];
    // reconcileSplitsTotal on 8.02 mi returns FALSE here — these 9 splits sum
    // 8.41 mi, 0.39 mi (4.9%) of ordinary GPS auto-lap drift over the row's
    // own distance, which the new distance-scaled tolerance admits.
    const seg = thresholdSegmentFromSplits(splits, ctx, 8.02);
    expect(seg).not.toBeNull();
    if (seg) {
      expect(seg.paceSecPerMi).toBe(435);
      expect(seg.durationSec).toBe(870); // 437+433 — mile 5's anomaly never enters the pool
    }
  });
});

describe('thresholdSegmentFromWholeRun · the weaker no-splits fallback', () => {
  it('requires the label to positively say threshold-zone', () => {
    const tHr = midOfBand(THRESHOLD_PCT_HRMAX_BAND);
    const row = { finishSec: 1800, distanceMi: 4, avgHr: tHr, workoutTypeRaw: 'easy' };
    expect(thresholdSegmentFromWholeRun(row, ctxHrMaxOnly)).toBeNull();
    const row2 = { ...row, workoutTypeRaw: 'tempo' };
    expect(thresholdSegmentFromWholeRun(row2, ctxHrMaxOnly)).not.toBeNull();
  });

  it('refuses a threshold-labeled run whose whole-run HR is actually easy (diluted by WU/CD)', () => {
    const easyHr = midOfBand(EASY_PCT_HRMAX_BAND);
    const row = { finishSec: 1800, distanceMi: 4, avgHr: easyHr, workoutTypeRaw: 'threshold' };
    expect(thresholdSegmentFromWholeRun(row, ctxHrMaxOnly)).toBeNull();
  });
});

describe('classifyEasyCandidates · label + HR + duration, together', () => {
  const easyHr = midOfBand(EASY_PCT_HRMAX_BAND);
  const tHr = midOfBand(THRESHOLD_PCT_HRMAX_BAND);

  it('an unlabeled run classifies correctly by HR alone', () => {
    const rows: CandidateRow[] = [
      { id: 'u1', date: '2026-08-01', distanceMi: 6, finishSec: 3000, avgHr: easyHr, workoutTypeRaw: null, splits: null },
    ];
    const out = classifyEasyCandidates(rows, ctxHrMaxOnly);
    expect(out.length).toBe(1);
  });

  it('a label that positively says quality excludes the run from easy candidacy, even if HR looks easy', () => {
    // A tempo whose whole-run avg HR happens to read in the E band (a long
    // warm-up diluting it) must NOT count as easy evidence.
    const rows: CandidateRow[] = [
      { id: 'q1', date: '2026-08-01', distanceMi: 6, finishSec: 3000, avgHr: easyHr, workoutTypeRaw: 'tempo', splits: null },
    ];
    expect(classifyEasyCandidates(rows, ctxHrMaxOnly).length).toBe(0);
  });

  it('a run whose label says easy but whose HR says threshold is excluded (HR gate alone rejects it)', () => {
    const rows: CandidateRow[] = [
      { id: 'x1', date: '2026-08-01', distanceMi: 6, finishSec: 3000, avgHr: tHr, workoutTypeRaw: 'easy', splits: null },
    ];
    expect(classifyEasyCandidates(rows, ctxHrMaxOnly).length).toBe(0);
    // ...and it is ALSO excluded from threshold candidacy, by the label guard.
    expect(classifyThresholdCandidates(rows, ctxHrMaxOnly).length).toBe(0);
  });

  it('a run under the duration floor (a shakeout) does not qualify', () => {
    const rows: CandidateRow[] = [
      { id: 's1', date: '2026-08-01', distanceMi: 1.5, finishSec: EASY_MIN_DURATION_SEC - 60, avgHr: easyHr, workoutTypeRaw: null, splits: null },
    ];
    expect(classifyEasyCandidates(rows, ctxHrMaxOnly).length).toBe(0);
  });

  it('a run meeting the duration floor exactly qualifies', () => {
    const rows: CandidateRow[] = [
      { id: 's2', date: '2026-08-01', distanceMi: 3, finishSec: EASY_MIN_DURATION_SEC, avgHr: easyHr, workoutTypeRaw: null, splits: null },
    ];
    expect(classifyEasyCandidates(rows, ctxHrMaxOnly).length).toBe(1);
  });
});

describe('RULE 18 · falsify against the OLD behavior', () => {
  it('vdotFromRun (the pre-existing race-shaped read) is near-useless for genuine easy running', () => {
    // A genuinely easy 8-mile run at 8:00/mi, HR comfortably in the E band —
    // the owner's own stated "8:00/mi easily all day" pace. The OLD read
    // (vdotFromRun, which has no easy branch and falls through to
    // vdotFromRace) treats it as an all-out race and returns a VDOT that is
    // either null (fails the honesty gate — no quality label, HR under 80%
    // max) or, if it passed, badly understates fitness. Demonstrating the
    // gate failure IS the point: this run is invisible to the old mechanism.
    const easyHr = midOfBand(EASY_PCT_HRMAX_BAND);
    const v = vdotFromRun({
      finishSeconds: 8 * 480, // 8 miles @ 8:00/mi
      distanceMi: 8,
      workoutType: null,
      avgHr: easyHr,
      maxHr: MAX_HR,
    });
    expect(v).toBeNull(); // passesRunHonestyGate rejects it — not quality, HR under 80% max

    // The new direct-evidence reader sees the SAME run as exactly what it is.
    const rows: CandidateRow[] = [
      { id: 'e1', date: '2026-08-01', distanceMi: 8, finishSec: 8 * 480, avgHr: easyHr, workoutTypeRaw: null, splits: null },
    ];
    const out = classifyEasyCandidates(rows, ctxHrMaxOnly);
    expect(out.length).toBe(1);
    expect(out[0].paceSecPerMi).toBe(480);
  });

  it('a whole-run-average threshold read understates a broken/structured session vs. the split-aware read', () => {
    const tHr = midOfBand(THRESHOLD_PCT_HRMAX_BAND);
    const easyHr = midOfBand(EASY_PCT_HRMAX_BAND);
    const splits = [
      { mile: 1, hr: easyHr, pace: '9:30', paceSecPerMi: 570 },
      { mile: 2, hr: tHr, pace: '6:50', paceSecPerMi: 410 },
      { mile: 3, hr: tHr, pace: '6:48', paceSecPerMi: 408 },
      { mile: 4, hr: tHr, pace: '6:52', paceSecPerMi: 412 },
      { mile: 5, hr: easyHr, pace: '9:20', paceSecPerMi: 560 },
      { mile: 6, hr: tHr, pace: '6:55', paceSecPerMi: 415 },
      { mile: 7, hr: tHr, pace: '6:49', paceSecPerMi: 409 },
      { mile: 8, hr: easyHr, pace: '9:40', paceSecPerMi: 580 },
    ];
    const wholeRunAvgPace = splits.reduce((s, x) => s + x.paceSecPerMi, 0) / splits.length;
    const splitAware = thresholdSegmentFromSplits(splits, ctxHrMaxOnly);
    expect(splitAware).not.toBeNull();
    if (splitAware) {
      // The split-aware read is meaningfully faster (more honest) than the
      // diluted whole-run average — the exact defect the owner's "Broken Long
      // Run" example demonstrated.
      expect(wholeRunAvgPace - splitAware.paceSecPerMi).toBeGreaterThan(30);
    }
  });
});

/** A `PhaseBreakdown`-shaped fixture with sane defaults, matching what
 *  `mapWatchPhases` actually returns. */
function phase(over: Partial<PhaseBreakdown> & { type: PhaseBreakdown['type']; actual_duration_sec: number | null }): PhaseBreakdown {
  return {
    index: 0,
    label: 'Phase',
    target_pace: null,
    target_pace_sec: null,
    tolerance_pace_sec: null,
    pace_shape: 'none',
    status_label: null,
    target_distance_mi: null,
    target_duration_sec: null,
    actual_pace: null,
    actual_distance_mi: null,
    avg_hr: null,
    max_hr: null,
    avg_cadence: null,
    completed: true,
    status: null,
    verdict: null,
    time_in_tolerance_sec: null,
    time_out_of_tolerance_sec: null,
    ...over,
  };
}

describe('thresholdSegmentFromPhases · coach_intents.value.phases, HR informs reliability not admission', () => {
  it('pools multiple qualifying T-length work phases into one session (David\'s real 2026-07-16 shape: 3x ~6.8min reps at ~6:46/mi)', () => {
    const tHr = midOfBand(THRESHOLD_PCT_HRMAX_BAND);
    const phases = [
      phase({ index: 0, type: 'warmup', actual_duration_sec: 600, actual_distance_mi: 1.2, avg_hr: midOfBand(EASY_PCT_HRMAX_BAND) }),
      phase({ index: 1, type: 'work', actual_duration_sec: 407, actual_distance_mi: 1.0, avg_hr: tHr }),
      phase({ index: 2, type: 'recovery', actual_duration_sec: 90, actual_distance_mi: 0.15, avg_hr: 130 }),
      phase({ index: 3, type: 'work', actual_duration_sec: 410, actual_distance_mi: 1.0, avg_hr: tHr }),
      phase({ index: 4, type: 'recovery', actual_duration_sec: 90, actual_distance_mi: 0.15, avg_hr: 130 }),
      phase({ index: 5, type: 'work', actual_duration_sec: 408, actual_distance_mi: 1.0, avg_hr: tHr }),
      phase({ index: 6, type: 'cooldown', actual_duration_sec: 600, actual_distance_mi: 1.2, avg_hr: midOfBand(EASY_PCT_HRMAX_BAND) }),
    ];
    const seg = thresholdSegmentFromPhases(phases, ctxHrMaxOnly);
    expect(seg).not.toBeNull();
    if (seg) {
      expect(seg.source).toBe('phases');
      expect(seg.durationSec).toBe(407 + 410 + 408); // only the 3 work phases pooled
      // Recovery/warmup/cooldown never enter the pool, however their HR reads.
      expect(seg.paceSecPerMi).toBeGreaterThan(0);
      expect(seg.hrPct).not.toBeNull();
      expect(seg.hrBandDistance).not.toBeNull();
      expect(seg.hrBandDistance as number).toBeLessThan(1); // squarely in-band
    }
  });

  it('REFUSES David\'s real 2026-08-11 4x1km shape — reps too short to be T-pace by duration alone, even with in-band HR', () => {
    // Real production shape: four ~4-minute 1km reps at a T-zone heart rate.
    // Duration alone (not HR) is what correctly excludes this — it is
    // Repetition-pace work wearing a Threshold-zone heart rate.
    const tHr = midOfBand(THRESHOLD_PCT_HRMAX_BAND);
    const phases = [237, 242, 250, 259].map((sec, i) =>
      phase({ index: i, type: 'work', actual_duration_sec: sec, actual_distance_mi: 0.62, avg_hr: tHr }));
    expect(thresholdSegmentFromPhases(phases, ctxHrMaxOnly)).toBeNull();
  });

  it('a single qualifying rep alone is real work and still not a full session — needs the pooled 20-min total floor', () => {
    const tHr = midOfBand(THRESHOLD_PCT_HRMAX_BAND);
    const onePhase = [phase({ type: 'work', actual_duration_sec: THRESHOLD_MIN_QUALIFYING_SEC + 60, actual_distance_mi: 1.0, avg_hr: tHr })];
    expect(thresholdSegmentFromPhases(onePhase, ctxHrMaxOnly)).toBeNull();
    // Three reps of 500s (8.3 min, inside the per-rep window) clear the
    // 20-minute pooled total floor (1500s total).
    const threePhases = [0, 1, 2].map((i) =>
      phase({ index: i, type: 'work', actual_duration_sec: 500, actual_distance_mi: 1.0, avg_hr: tHr }));
    expect(threePhases.reduce((s, p) => s + (p.actual_duration_sec ?? 0), 0)).toBeGreaterThanOrEqual(THRESHOLD_MIN_SESSION_TOTAL_SEC);
    expect(thresholdSegmentFromPhases(threePhases, ctxHrMaxOnly)).not.toBeNull();
  });

  it('a rep at exactly the 20-minute per-rep ceiling qualifies; one second over does not', () => {
    const tHr = midOfBand(THRESHOLD_PCT_HRMAX_BAND);
    const atCeiling = [0, 1].map((i) =>
      phase({ index: i, type: 'work', actual_duration_sec: THRESHOLD_MAX_REP_SEC, actual_distance_mi: 3.0, avg_hr: tHr }));
    expect(thresholdSegmentFromPhases(atCeiling, ctxHrMaxOnly)).not.toBeNull();
    const overCeiling = [0, 1].map((i) =>
      phase({ index: i, type: 'work', actual_duration_sec: THRESHOLD_MAX_REP_SEC + 1, actual_distance_mi: 3.0, avg_hr: tHr }));
    // Both individual reps now fail the per-rep ceiling, so nothing qualifies.
    expect(thresholdSegmentFromPhases(overCeiling, ctxHrMaxOnly)).toBeNull();
  });

  it('HR clearly outside the T-band does NOT veto admission — course-corrected 2026-08-31 — but is reported honestly as unreliable', () => {
    // Right duration, right type, HR reading squarely in the EASY band (a
    // genuinely aerobic rep, or a strap that lagged) — still admitted, per
    // the external review: HR informs reliability, it is not a hard gate for
    // phase-sourced evidence.
    const easyHr = midOfBand(EASY_PCT_HRMAX_BAND);
    const phases = [0, 1, 2].map((i) =>
      phase({ index: i, type: 'work', actual_duration_sec: THRESHOLD_MIN_QUALIFYING_SEC + 120, actual_distance_mi: 1.0, avg_hr: easyHr }));
    const seg = thresholdSegmentFromPhases(phases, ctxHrMaxOnly);
    expect(seg).not.toBeNull();
    if (seg) {
      expect(seg.hrPct).not.toBeNull();
      // Well outside the T-band — a large hrBandDistance, not a rejection.
      expect(seg.hrBandDistance as number).toBeGreaterThan(1);
    }
  });

  it('admits a session with NO heart-rate reading at all (a treadmill with no strap) — duration/pace/type carry it alone', () => {
    const phases = [0, 1, 2].map((i) =>
      phase({ index: i, type: 'work', actual_duration_sec: 500, actual_distance_mi: 1.0, avg_hr: null }));
    const seg = thresholdSegmentFromPhases(phases, ctxHrMaxOnly);
    expect(seg).not.toBeNull();
    if (seg) {
      expect(seg.basis).toBeNull();
      expect(seg.hrPct).toBeNull();
      expect(seg.hrBandDistance).toBeNull(); // Rule 11 · unknown, not zero
    }
  });

  it('recovery/warmup/cooldown phases never qualify, however fast or however in-band their HR', () => {
    const tHr = midOfBand(THRESHOLD_PCT_HRMAX_BAND);
    const phases: PhaseBreakdown[] = [
      phase({ type: 'recovery', actual_duration_sec: 1500, actual_distance_mi: 3, avg_hr: tHr }),
      phase({ type: 'warmup', actual_duration_sec: 1500, actual_distance_mi: 3, avg_hr: tHr }),
      phase({ type: 'cooldown', actual_duration_sec: 1500, actual_distance_mi: 3, avg_hr: tHr }),
    ];
    expect(thresholdSegmentFromPhases(phases, ctxHrMaxOnly)).toBeNull();
  });

  it('refuses cleanly on an empty or malformed phase list rather than throwing (Rule 11)', () => {
    expect(thresholdSegmentFromPhases([], ctxHrMaxOnly)).toBeNull();
    const corrupted = [phase({ type: 'work', actual_duration_sec: null, actual_distance_mi: null })];
    expect(() => thresholdSegmentFromPhases(corrupted, ctxHrMaxOnly)).not.toThrow();
    expect(thresholdSegmentFromPhases(corrupted, ctxHrMaxOnly)).toBeNull();
  });
});

describe('classifyThresholdCandidates · phases preferred over splits, race excluded', () => {
  const tHr = midOfBand(THRESHOLD_PCT_HRMAX_BAND);

  it('a run with BOTH qualifying phases and reconciling splits contributes exactly one observation', () => {
    const workPhases: PhaseBreakdown[] = [0, 1, 2].map((i) =>
      phase({ index: i, type: 'work', actual_duration_sec: 500, actual_distance_mi: 1.0, avg_hr: tHr }));
    const splits = [
      { mile: 1, hr: tHr, pace: '6:50', paceSecPerMi: 410 },
      { mile: 2, hr: tHr, pace: '6:48', paceSecPerMi: 408 },
      { mile: 3, hr: tHr, pace: '6:52', paceSecPerMi: 412 },
    ];
    const rows: CandidateRow[] = [
      { id: 'both1', date: '2026-08-01', distanceMi: 6, finishSec: 3000, avgHr: tHr, workoutTypeRaw: 'tempo', splits, phases: workPhases },
    ];
    const out = classifyThresholdCandidates(rows, ctxHrMaxOnly);
    expect(out.length).toBe(1);
    expect(out[0].source).toBe('phases'); // phases preferred — the more direct measurement
  });

  it('falls back to splits when phases do not qualify, and to whole-run when neither does', () => {
    const shortReps: PhaseBreakdown[] = [237, 242, 250, 259].map((sec, i) =>
      phase({ index: i, type: 'work', actual_duration_sec: sec, actual_distance_mi: 0.62, avg_hr: tHr }));
    const splits = [
      { mile: 1, hr: tHr, pace: '6:50', paceSecPerMi: 410 },
      { mile: 2, hr: tHr, pace: '6:48', paceSecPerMi: 408 },
      { mile: 3, hr: tHr, pace: '6:52', paceSecPerMi: 412 },
    ];
    const rows: CandidateRow[] = [
      { id: 'fallback1', date: '2026-08-01', distanceMi: 6, finishSec: 3000, avgHr: tHr, workoutTypeRaw: 'tempo', splits, phases: shortReps },
    ];
    const out = classifyThresholdCandidates(rows, ctxHrMaxOnly);
    expect(out.length).toBe(1);
    expect(out[0].source).toBe('splits'); // phases refused (too short), splits pick it up
  });

  it('a `phases` field left undefined behaves exactly like an empty array — the pre-existing splits/whole-run behavior is unchanged', () => {
    const splits = [
      { mile: 1, hr: tHr, pace: '6:50', paceSecPerMi: 410 },
      { mile: 2, hr: tHr, pace: '6:48', paceSecPerMi: 408 },
      { mile: 3, hr: tHr, pace: '6:52', paceSecPerMi: 412 },
    ];
    const rows: CandidateRow[] = [
      { id: 'nophases1', date: '2026-08-01', distanceMi: 6, finishSec: 3000, avgHr: tHr, workoutTypeRaw: 'tempo', splits },
    ];
    const out = classifyThresholdCandidates(rows, ctxHrMaxOnly);
    expect(out.length).toBe(1);
    expect(out[0].source).toBe('splits');
  });

  it('a race-labeled run is excluded from threshold candidacy entirely, however qualifying its phases look', () => {
    const workPhases: PhaseBreakdown[] = [0, 1, 2].map((i) =>
      phase({ index: i, type: 'work', actual_duration_sec: THRESHOLD_MIN_QUALIFYING_SEC + 300, actual_distance_mi: 1.5, avg_hr: tHr }));
    const rows: CandidateRow[] = [
      { id: 'race1', date: '2026-08-16', distanceMi: 13.1, finishSec: 6000, avgHr: tHr, workoutTypeRaw: 'race', splits: null, phases: workPhases },
    ];
    expect(classifyThresholdCandidates(rows, ctxHrMaxOnly).length).toBe(0);
  });
});

describe('PaceObservation · hrPct / hrBandDistance retrofit (external review, 2026-08-31)', () => {
  it('classifyEasyCandidates reports the measured hrPct and a small hrBandDistance for a centered reading', () => {
    const easyHr = midOfBand(EASY_PCT_HRMAX_BAND);
    const rows: CandidateRow[] = [
      { id: 'e1', date: '2026-08-01', distanceMi: 6, finishSec: 3000, avgHr: easyHr, workoutTypeRaw: null, splits: null },
    ];
    const out = classifyEasyCandidates(rows, ctxHrMaxOnly);
    expect(out.length).toBe(1);
    expect(out[0].hrPct).toBeCloseTo(easyHr / MAX_HR, 3);
    expect(out[0].hrBandDistance as number).toBeLessThan(0.1); // dead center by construction
  });

  it('thresholdSegmentFromSplits reports a pooled hrPct/hrBandDistance, not a discarded boolean', () => {
    const tHr = midOfBand(THRESHOLD_PCT_HRMAX_BAND);
    const splits = [
      { mile: 1, hr: tHr, pace: '6:50', paceSecPerMi: 410 },
      { mile: 2, hr: tHr, pace: '6:48', paceSecPerMi: 408 },
      { mile: 3, hr: tHr, pace: '6:52', paceSecPerMi: 412 },
    ];
    const seg = thresholdSegmentFromSplits(splits, ctxHrMaxOnly);
    expect(seg).not.toBeNull();
    if (seg) {
      expect(seg.hrPct).not.toBeNull();
      expect(seg.hrBandDistance as number).toBeLessThan(1);
    }
  });
});
