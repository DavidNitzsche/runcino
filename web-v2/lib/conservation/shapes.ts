/**
 * lib/conservation/shapes.ts · the runs the harness pushes through the app.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHERE THESE CAME FROM
 *
 * Not from imagination, and not from the consumers. Every key, every spelling
 * and every multiplicity below was read out of the live table over the
 * `faff_readonly` role on 2026-08-24, the same way `lib/runs/run-shape.ts`'s
 * census was: 256 rows, 149 of them canonical.
 *
 * The census that mattered, and that these shapes are built to cover:
 *
 *   · 66 canonical rows carry `durationSec`, 125 `movingTimeS`, 119
 *     `elapsedTimeS`, 5 the legacy `movingSec`, 124 `paceSPerMi`, 65 the
 *     display string `avgPaceMinPerMi`.
 *   · 24 canonical rows carry NEITHER `movingTimeS` NOR `elapsedTimeS` —
 *     watch-era rows whose only clock is `durationSec`.
 *   · 41 canonical rows carry a stored pace, a duration and a distance
 *     together. 6 of them disagree with themselves by more than 15 s/mi;
 *     ONE of them is arithmetically impossible.
 *   · 26 canonical rows store an `elapsedTimeS` SMALLER than their own
 *     `durationSec`, which is a contradiction — elapsed is the outer bound.
 *   · `splits` elements come in twelve distinct key-sets. `phases` in six.
 *   · `duration_sec`, snake_case, exists on ZERO rows. `lib/coach/run-state.ts`
 *     reads it twice.
 *
 * Every fixture below states the run's ground truth separately from the row
 * it produces, because the whole exercise is asking whether the row still
 * means what the run meant.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * NO DATABASE
 *
 * Production was read to LEARN the shapes and then closed. Nothing here
 * connects to anything. `lib/plan/_sweep_allusers.test.ts` grades 9,294 plan
 * archetypes the same way, and for the same reason: a gate that needs a
 * network is a gate that gets skipped.
 */
import type { RunData } from '@/lib/runs/run-shape';
import type { RunTruth } from './laws';

/** One physical ingest — a row as a single source writes it. */
export interface IngestRow {
  id: string;
  /** Drives `SOURCE_TIER` in `lib/runs/canonical.ts`. */
  source: string;
  data: RunData;
}

export interface RunShape {
  /** Stable key. Appears in every finding this shape produces. */
  id: string;
  /** What this run is, in a sentence. */
  what: string;
  /** What the runner actually did. The harness's ground truth. */
  truth: RunTruth;
  /** The physical rows, one per ingest that saw this run. */
  ingests: IngestRow[];
  /**
   * The row every surface ends up reading.
   *
   * For a single-ingest run this is that row. For a merged run it is the row
   * AFTER `enhanceCanonicalFromAbsorbed` has copied fields across — a step
   * that is welded to five database queries and cannot be run here, so the
   * result is stated rather than computed, and `canonicalIsObserved` says so.
   */
  canonical: RunData;
  /**
   * True when `canonical` was copied from a production row rather than being
   * the fixture's own single ingest. An observed row is evidence; a computed
   * one is an assumption. The harness reports the split.
   */
  canonicalIsObserved?: boolean;
  /** Which physical row SHOULD win the dedup, when there is more than one. */
  expectCanonicalId?: string;
  /** Per-split distances in miles, when the run has splits. */
  splitDistancesMi?: number[];
  /** Heart-rate zone shares as stored. */
  zones?: { z1: number; z2: number; z3: number; z4: number; z5: number } | null;
  /** Phases as stored, for the parts-vs-whole law. */
  phases?: Array<{ actualDistanceMi?: number | null; actualDurationSec?: number | null }> | null;
  /** What the plan asked for, when this run answers a plan day. */
  planned?: { type: string; distanceMi: number; paceSPerMi: number | null } | null;
  /**
   * Hops this shape genuinely cannot reach, and why. Printed by the harness on
   * every run. An unsimulated hop reported as clean is the failure this whole
   * file exists to correct, so it is never silent.
   */
  unreachable?: string[];
}

/** Split distances for a run of `mi` miles, mile-by-mile with a partial last. */
function mileSplits(mi: number): number[] {
  const out: number[] = [];
  let left = mi;
  while (left > 1) { out.push(1); left -= 1; }
  if (left > 0.01) out.push(Number(left.toFixed(4)));
  return out;
}

const ZONES_OK = { z1: 8, z2: 54, z3: 22, z4: 11, z5: 5 };

export const RUN_SHAPES: RunShape[] = [
  /* ────────────────────────────────────────────────────────────────────
   * 1 · THE ORDINARY CASE. If this one fails, nothing else matters.
   * ─────────────────────────────────────────────────────────────────── */
  {
    id: 'clean-gps',
    what: 'a clean outdoor GPS run, one ingest, nothing paused',
    truth: { distanceMi: 6.02, elapsedSec: 3134, movingSec: null },
    ingests: [{
      id: 'r1', source: 'watch',
      data: {
        date: '2026-08-10', source: 'watch', distanceMi: 6.02, durationSec: 3134,
        avgHr: 141, maxHr: 158, elevGainFt: 212, routePolyline: 'abc',
        hrZonePcts: ZONES_OK, splits: mileSplits(6.02).map((d, i) => ({ mile: i + 1, distanceMi: d, hr: 138 + i })),
      } as RunData,
    }],
    canonical: {
      date: '2026-08-10', source: 'watch', distanceMi: 6.02, durationSec: 3134,
      avgHr: 141, maxHr: 158, elevGainFt: 212, routePolyline: 'abc', hrZonePcts: ZONES_OK,
    } as RunData,
    splitDistancesMi: mileSplits(6.02),
    zones: ZONES_OK,
    planned: { type: 'easy', distanceMi: 6, paceSPerMi: 520 },
  },

  /* ────────────────────────────────────────────────────────────────────
   * 2 · THE CASE THAT SHIPPED. The 2026-08-23 run, exactly as production
   *     holds it. Three ingests, two of which disagree about the same
   *     eleven miles by a factor of two.
   *
   *     The canonical row is copied VERBATIM from production. Faff pushed
   *     the run to Strava, Strava returned a moving time of 2389 seconds
   *     for eleven miles — 16.6 mph — and the merge wrote it onto the
   *     watch's own row beside `durationSec` 5298 instead of instead of it.
   * ─────────────────────────────────────────────────────────────────── */
  {
    id: 'merged-disagree',
    what: 'a merged run whose two ingests disagree — the 2026-08-23 run, as production holds it',
    truth: { distanceMi: 11.01, elapsedSec: 5298, movingSec: null },
    ingests: [
      {
        id: '-55341764239083', source: 'watch',
        data: {
          date: '2026-08-23', startLocal: '2026-08-23T06:12:04', timezone: 'America/Los_Angeles',
          source: 'watch', distanceMi: 11.01, durationSec: 5298,
          avgPaceMinPerMi: '8:01', timeMoving: '88:23', avgHr: 152, maxHr: 178,
          hrZonePcts: { z1: 15, z2: 37, z3: 21, z4: 12, z5: 14 },
        } as RunData,
      },
      {
        id: '-3850571487038434', source: 'apple_watch',
        data: {
          date: '2026-08-23', startLocal: '2026-08-23T06:12:04', timezone: 'America/Los_Angeles',
          source: 'apple_watch', distanceMi: 11.01, durationSec: 5303,
          avgPaceMinPerMi: '8:01', timeMoving: '88:23',
        } as RunData,
      },
      {
        id: '19867778327', source: 'strava_webhook',
        data: {
          date: '2026-08-23', startLocal: '2026-08-23T13:12:04Z',
          source: 'strava_webhook', distanceMi: 11.01,
          durationSec: 2389, movingSec: 2389, avgPaceMinPerMi: '3:37', timeMoving: '39:49',
        } as RunData,
      },
    ],
    expectCanonicalId: '-55341764239083',
    canonicalIsObserved: true,
    canonical: {
      date: '2026-08-23', source: 'watch', distanceMi: 11.01,
      durationSec: 5298,          // the watch's own clock · 8:01/mi
      movingSec: 2389, movingTimeS: 2389, elapsedTimeS: 2389,  // all three stamped by the merge
      paceSPerMi: 217,            // 3:37/mi · what reached his phone
      avgPaceMinPerMi: '8:01', timeMoving: '88:23',
      avgHr: 152, maxHr: 178,
      hrZonePcts: { z1: 15, z2: 37, z3: 21, z4: 12, z5: 14 },
    } as RunData,
    // Twelve splits summing to 11.88 under an 11.01-mile heading. Read off
    // the production row; the last is a genuine partial, the overshoot is not.
    splitDistancesMi: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.8789237668161435],
    zones: { z1: 15, z2: 37, z3: 21, z4: 12, z5: 14 },
    planned: { type: 'easy', distanceMi: 11, paceSPerMi: 562 },
    unreachable: [
      'enhanceCanonicalFromAbsorbed — the field-copy loop is welded to five queries; the canonical row here is the observed production result, not a computed one',
    ],
  },

  /* ────────────────────────────────────────────────────────────────────
   * 3 · A REAL PAUSE. The guard must believe this one. A run genuinely
   *     stopped for nine minutes at lights is not a bad number, and a fix
   *     that "corrects" it has broken something that was working.
   * ─────────────────────────────────────────────────────────────────── */
  {
    id: 'honest-pause',
    what: 'a paused run — nine minutes at lights, honestly recorded',
    truth: { distanceMi: 6.0, elapsedSec: 3600, movingSec: 3240 },
    ingests: [{
      id: 'r3', source: 'strava',
      data: {
        date: '2026-08-11', source: 'strava', distanceMi: 6.0,
        elapsedTimeS: 3600, movingTimeS: 3240, paceSPerMi: 540,
        avgHr: 138, maxHr: 151,
      } as RunData,
    }],
    canonical: {
      date: '2026-08-11', source: 'strava', distanceMi: 6.0,
      elapsedTimeS: 3600, movingTimeS: 3240, paceSPerMi: 540, avgHr: 138, maxHr: 151,
    } as RunData,
    planned: { type: 'easy', distanceMi: 6, paceSPerMi: 540 },
  },

  /* ────────────────────────────────────────────────────────────────────
   * 4 · A TREADMILL RUN. No route, no GPS, and — on 24 canonical rows —
   *     no `movingTimeS` and no `elapsedTimeS` either. `durationSec` is
   *     the only clock this run has.
   * ─────────────────────────────────────────────────────────────────── */
  {
    id: 'treadmill-no-route',
    what: 'a treadmill run · no route, and durationSec is its only clock',
    truth: { distanceMi: 4.02, elapsedSec: 2065, movingSec: null },
    ingests: [{
      id: 'r4', source: 'treadmill',
      data: {
        date: '2026-08-24', source: 'treadmill', indoor: true, distanceMi: 4.02,
        durationSec: 2065, timeMoving: '34:30', avgHr: 144, maxHr: 160, elevGainFt: 0,
      } as RunData,
    }],
    canonical: {
      date: '2026-08-24', source: 'treadmill', indoor: true, distanceMi: 4.02,
      durationSec: 2065, timeMoving: '34:30', avgHr: 144, maxHr: 160, elevGainFt: 0,
    } as RunData,
    planned: { type: 'easy', distanceMi: 4, paceSPerMi: 515 },
  },

  /* ────────────────────────────────────────────────────────────────────
   * 5 · NO HEART RATE AT ALL. The zone law's escape hatch — and the
   *     all-zero placeholder that is NOT one. Five canonical rows store
   *     `{z1:0…z5:0}`; on a run with no HR that is honest.
   * ─────────────────────────────────────────────────────────────────── */
  {
    id: 'no-hr',
    what: 'a run with no heart rate · zones stored as an all-zero placeholder',
    truth: { distanceMi: 5.1, elapsedSec: 2754, movingSec: null },
    ingests: [{
      id: 'r5', source: 'manual',
      data: {
        date: '2026-08-12', source: 'manual', distanceMi: 5.1, durationSec: 2754,
        avgHr: null, maxHr: null, hrZonePcts: { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 },
      } as RunData,
    }],
    canonical: {
      date: '2026-08-12', source: 'manual', distanceMi: 5.1, durationSec: 2754,
      avgHr: null, maxHr: null, hrZonePcts: { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 },
    } as RunData,
    zones: { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 },
    planned: { type: 'easy', distanceMi: 5, paceSPerMi: 530 },
  },

  /* ────────────────────────────────────────────────────────────────────
   * 6 · A REP SESSION WITH NINE PHASES. Warm-up, four work reps, three
   *     recoveries, cool-down. The parts must not exceed the whole.
   * ─────────────────────────────────────────────────────────────────── */
  {
    id: 'reps-nine-phases',
    what: 'a rep session · nine phases, warm-up through cool-down',
    truth: { distanceMi: 8.0, elapsedSec: 3960, movingSec: null },
    ingests: [{
      id: 'r6', source: 'watch',
      data: {
        date: '2026-08-13', source: 'watch', distanceMi: 8.0, durationSec: 3960,
        workoutType: 'intervals', avgHr: 158, maxHr: 182, hrZonePcts: ZONES_OK,
        phases: [
          { index: 0, type: 'warmup', label: 'WU', actualDistanceMi: 2.0, actualDurationSec: 1080, completed: true },
          { index: 1, type: 'work', label: '1 mi @ I', actualDistanceMi: 1.0, actualDurationSec: 400, completed: true },
          { index: 2, type: 'recovery', label: 'jog', actualDistanceMi: 0.3, actualDurationSec: 180, completed: true },
          { index: 3, type: 'work', label: '1 mi @ I', actualDistanceMi: 1.0, actualDurationSec: 402, completed: true },
          { index: 4, type: 'recovery', label: 'jog', actualDistanceMi: 0.3, actualDurationSec: 180, completed: true },
          { index: 5, type: 'work', label: '1 mi @ I', actualDistanceMi: 1.0, actualDurationSec: 405, completed: true },
          { index: 6, type: 'recovery', label: 'jog', actualDistanceMi: 0.3, actualDurationSec: 180, completed: true },
          { index: 7, type: 'work', label: '1 mi @ I', actualDistanceMi: 1.0, actualDurationSec: 398, completed: true },
          { index: 8, type: 'cooldown', label: 'CD', actualDistanceMi: 1.1, actualDurationSec: 735, completed: true },
        ],
      } as RunData,
    }],
    canonical: {
      date: '2026-08-13', source: 'watch', distanceMi: 8.0, durationSec: 3960,
      workoutType: 'intervals', avgHr: 158, maxHr: 182, hrZonePcts: ZONES_OK,
    } as RunData,
    zones: ZONES_OK,
    phases: [
      { actualDistanceMi: 2.0, actualDurationSec: 1080 },
      { actualDistanceMi: 1.0, actualDurationSec: 400 },
      { actualDistanceMi: 0.3, actualDurationSec: 180 },
      { actualDistanceMi: 1.0, actualDurationSec: 402 },
      { actualDistanceMi: 0.3, actualDurationSec: 180 },
      { actualDistanceMi: 1.0, actualDurationSec: 405 },
      { actualDistanceMi: 0.3, actualDurationSec: 180 },
      { actualDistanceMi: 1.0, actualDurationSec: 398 },
      { actualDistanceMi: 1.1, actualDurationSec: 735 },
    ],
    planned: { type: 'intervals', distanceMi: 8, paceSPerMi: 400 },
  },

  /* ────────────────────────────────────────────────────────────────────
   * 7 · THE SAME KIND OF SESSION WITH NO PHASES AT ALL. A Strava-only
   *     interval run carries none, and the phase laws must stay quiet
   *     rather than inventing a violation out of an absence.
   * ─────────────────────────────────────────────────────────────────── */
  {
    id: 'reps-no-phases',
    what: 'a rep session ingested from Strava · no phases recorded',
    truth: { distanceMi: 7.5, elapsedSec: 3720, movingSec: 3690 },
    ingests: [{
      id: 'r7', source: 'strava',
      data: {
        date: '2026-08-14', source: 'strava', distanceMi: 7.5,
        elapsedTimeS: 3720, movingTimeS: 3690, paceSPerMi: 492,
        workoutType: 3, avgHr: 160, maxHr: 179,
      } as RunData,
    }],
    canonical: {
      date: '2026-08-14', source: 'strava', distanceMi: 7.5,
      elapsedTimeS: 3720, movingTimeS: 3690, paceSPerMi: 492,
      workoutType: 3, avgHr: 160, maxHr: 179,
    } as RunData,
    phases: null,
    planned: { type: 'threshold', distanceMi: 7, paceSPerMi: 430 },
  },

  /* ────────────────────────────────────────────────────────────────────
   * 8 · SPLITS FLAGGED UNRELIABLE. Eleven canonical split elements carry
   *     `unreliable: true` with a null pace. The heading must still be
   *     right, and the flagged split must not be counted as a zero.
   * ─────────────────────────────────────────────────────────────────── */
  {
    id: 'splits-unreliable',
    what: 'a run with a GPS-glitched split flagged unreliable',
    truth: { distanceMi: 9.14, elapsedSec: 4600, movingSec: null },
    ingests: [{
      id: 'r8', source: 'watch',
      data: {
        date: '2026-08-21', source: 'watch', distanceMi: 9.14, durationSec: 4600,
        timeMoving: '76:45', splits_unreliable: true, avgHr: 147, maxHr: 166,
      } as RunData,
    }],
    canonical: {
      date: '2026-08-21', source: 'watch', distanceMi: 9.14, durationSec: 4600,
      timeMoving: '76:45', splits_unreliable: true, avgHr: 147, maxHr: 166,
    } as RunData,
    splitDistancesMi: mileSplits(9.14),
    planned: { type: 'easy', distanceMi: 9, paceSPerMi: 525 },
  },

  /* ────────────────────────────────────────────────────────────────────
   * 9 · A VERY SHORT RUN. Just above `MIN_DISTANCE_MI`. Rounding has the
   *     least room to hide here, which is exactly why it belongs.
   * ─────────────────────────────────────────────────────────────────── */
  {
    id: 'very-short',
    what: 'a very short run · 0.6 mi shakeout',
    truth: { distanceMi: 0.62, elapsedSec: 331, movingSec: null },
    ingests: [{
      id: 'r9', source: 'watch',
      data: { date: '2026-08-15', source: 'watch', distanceMi: 0.62, durationSec: 331, avgHr: 118 } as RunData,
    }],
    canonical: { date: '2026-08-15', source: 'watch', distanceMi: 0.62, durationSec: 331, avgHr: 118 } as RunData,
    planned: { type: 'shakeout', distanceMi: 1, paceSPerMi: 560 },
  },

  /* ────────────────────────────────────────────────────────────────────
   * 10 · A TWENTY-MILER. Crosses the hour boundary in the clock format,
   *      which is where `102:33` came from once. See `run-state.ts:914`.
   * ─────────────────────────────────────────────────────────────────── */
  {
    id: 'twenty-miler',
    what: 'a twenty-mile long run · crosses the hour boundary',
    truth: { distanceMi: 20.14, elapsedSec: 11064, movingSec: 10890 },
    ingests: [{
      id: 'r10', source: 'strava',
      data: {
        date: '2026-08-16', source: 'strava', distanceMi: 20.14,
        elapsedTimeS: 11064, movingTimeS: 10890, paceSPerMi: 541,
        avgHr: 149, maxHr: 171, elevGainFt: 880,
      } as RunData,
    }],
    canonical: {
      date: '2026-08-16', source: 'strava', distanceMi: 20.14,
      elapsedTimeS: 11064, movingTimeS: 10890, paceSPerMi: 541,
      avgHr: 149, maxHr: 171, elevGainFt: 880,
    } as RunData,
    splitDistancesMi: mileSplits(20.14),
    planned: { type: 'long', distanceMi: 20, paceSPerMi: 550 },
  },

  /* ────────────────────────────────────────────────────────────────────
   * 11 · AN OVERSHOOT. Prescribed five, ran eleven. The run is honest;
   *      the question is whether the plan's five leaks into the run's
   *      numbers anywhere on the way to a screen.
   * ─────────────────────────────────────────────────────────────────── */
  {
    id: 'overshoot',
    what: 'prescribed 5 mi, ran 11 · the plan must not rewrite the run',
    truth: { distanceMi: 11.2, elapsedSec: 5824, movingSec: null },
    ingests: [{
      id: 'r11', source: 'watch',
      data: {
        date: '2026-08-17', source: 'watch', distanceMi: 11.2, durationSec: 5824,
        avgHr: 145, maxHr: 164, hrZonePcts: ZONES_OK,
      } as RunData,
    }],
    canonical: {
      date: '2026-08-17', source: 'watch', distanceMi: 11.2, durationSec: 5824,
      avgHr: 145, maxHr: 164, hrZonePcts: ZONES_OK,
    } as RunData,
    zones: ZONES_OK,
    planned: { type: 'easy', distanceMi: 5, paceSPerMi: 530 },
  },

  /* ────────────────────────────────────────────────────────────────────
   * 12 · A RUN THAT IS ALSO A RACE. Per CLAUDE.md the race RESULT is
   *      curated elsewhere; what this shape checks is only that the run's
   *      own figures survive the race labelling unchanged.
   * ─────────────────────────────────────────────────────────────────── */
  {
    id: 'run-is-a-race',
    what: 'a half marathon that is also a race · Strava workoutType 1',
    truth: { distanceMi: 13.11, elapsedSec: 6113, movingSec: 6113 },
    ingests: [{
      id: 'r12', source: 'strava',
      data: {
        date: '2026-08-16', source: 'strava', distanceMi: 13.11,
        elapsedTimeS: 6113, movingTimeS: 6113, paceSPerMi: 466,
        workoutType: 1, name: 'AFC Half Marathon', avgHr: 172, maxHr: 186,
      } as RunData,
    }],
    canonical: {
      date: '2026-08-16', source: 'strava', distanceMi: 13.11,
      elapsedTimeS: 6113, movingTimeS: 6113, paceSPerMi: 466,
      workoutType: 1, name: 'AFC Half Marathon', avgHr: 172, maxHr: 186,
    } as RunData,
    splitDistancesMi: mileSplits(13.11),
    planned: { type: 'race', distanceMi: 13.1, paceSPerMi: 466 },
    unreachable: [
      'races.actual_result — the curated race time is a different table and a different reader; per CLAUDE.md this shape asserts only that the RUN row survives, not that the race result is right',
    ],
  },

  /* ────────────────────────────────────────────────────────────────────
   * 13 · A STRAVA-ONLY ROW. No `durationSec` at all — the mirror of #4,
   *      and between them they cover both halves of the clock census.
   * ─────────────────────────────────────────────────────────────────── */
  {
    id: 'strava-only',
    what: 'a Strava-only row · moving and elapsed, but no durationSec',
    truth: { distanceMi: 7.03, elapsedSec: 3720, movingSec: 3684 },
    ingests: [{
      id: 'r13', source: 'strava',
      data: {
        date: '2026-08-18', source: 'strava', distanceMi: 7.03,
        elapsedTimeS: 3720, movingTimeS: 3684, paceSPerMi: 524,
        avgSpeedMph: 6.87, avgHr: 143, maxHr: 159,
      } as RunData,
    }],
    canonical: {
      date: '2026-08-18', source: 'strava', distanceMi: 7.03,
      elapsedTimeS: 3720, movingTimeS: 3684, paceSPerMi: 524,
      avgSpeedMph: 6.87, avgHr: 143, maxHr: 159,
    } as RunData,
    planned: { type: 'easy', distanceMi: 7, paceSPerMi: 530 },
  },

  /* ────────────────────────────────────────────────────────────────────
   * 14 · THE LEGACY SPELLING. Five canonical rows carry `movingSec` and
   *      nothing else — an early HealthKit era. They have no other clock,
   *      which is why the COALESCE ladders still name the key.
   * ─────────────────────────────────────────────────────────────────── */
  {
    id: 'legacy-movingsec',
    what: 'an early HealthKit row whose only clock is the legacy movingSec',
    truth: { distanceMi: 3.05, elapsedSec: 1608, movingSec: 1608 },
    ingests: [{
      id: 'r14', source: 'apple_health',
      data: { date: '2026-05-20', source: 'apple_health', distanceMi: 3.05, movingSec: 1608, avgHr: 136 } as RunData,
    }],
    canonical: { date: '2026-05-20', source: 'apple_health', distanceMi: 3.05, movingSec: 1608, avgHr: 136 } as RunData,
    planned: null,
  },
];

/**
 * THE FLOOR.
 *
 * A harness that pushes nothing and reports clean is the same bug one level
 * up, and it has already happened twice in this codebase in one day. The gate
 * refuses to pass below this count.
 */
export const MIN_SHAPES = 14;
