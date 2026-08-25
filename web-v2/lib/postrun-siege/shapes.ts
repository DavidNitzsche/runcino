/**
 * lib/postrun-siege/shapes.ts · THE HOSTILE ROWS.
 *
 * Every shape a real watch, a real merge or a real Strava sync can produce and
 * that the post-run path has to survive. Not fuzz: each one is legal, storable
 * and has either been seen in this database or is one absorb away from it.
 *
 * The catalogue lives apart from the assertions so a new attack is one entry
 * here and nothing else, and so the count can be floored — see `MIN_SHAPES` in
 * `_siege.test.ts`. A harness that quietly shrinks is a harness that stops
 * covering the thing it was built for.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT A SHAPE IS GRADED ON
 *
 * Three outcomes, and only the third is a failure:
 *
 *   TRUTH    the surface prints what the row measured.
 *   REFUSAL  the surface prints nothing, or says it does not know. Rule three:
 *            a refusal is a correct answer, not an empty state.
 *   FICTION  the surface prints a number or a claim the row does not support.
 *
 * A crash is bad and visible. Fiction is worse, because the runner cannot tell.
 */

import type { RunData } from '@/lib/runs/run-shape';

export interface Shape {
  /** Stable id · appears in failure output, so keep it short and specific. */
  id: string;
  /** What a real device or merge does to produce this. */
  origin: string;
  data: RunData;
}

/** A mile split in the canonical watch shape. */
const mile = (n: number, paceS: number, hr: number | null) => ({
  mile: n,
  distanceMi: 1,
  paceSPerMi: paceS,
  ...(hr == null ? {} : { hr }),
});

const evenSplits = (n: number, paceS = 480, hr: number | null = 145) =>
  Array.from({ length: n }, (_, i) => mile(i + 1, paceS, hr));

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · SPLITS
 * ═══════════════════════════════════════════════════════════════════════ */

const SPLIT_SHAPES: Shape[] = [
  {
    id: 'splits/none',
    origin: 'Strava summary-only sync · the activity has no lap data',
    data: { distanceMi: 4, durationSec: 1920, splits: [] },
  },
  {
    id: 'splits/exactly-one',
    origin: 'a run under two miles · one lap fired',
    data: { distanceMi: 1.02, durationSec: 480, splits: [mile(1, 470, 142)] },
  },
  {
    id: 'splits/one-hundred',
    origin: 'a watch configured for auto-lap every 0.1 mi on a ten-miler',
    data: {
      distanceMi: 10,
      durationSec: 4800,
      splits: Array.from({ length: 100 }, (_, i) => ({
        mile: (i + 1) / 10, distanceMi: 0.1, paceSPerMi: 480, hr: 140 + (i % 20),
      })),
    },
  },
  {
    id: 'splits/reverse-order',
    origin: 'a merge that walked the loser array backwards',
    data: {
      distanceMi: 6, durationSec: 2880,
      splits: [...evenSplits(6)].reverse().map((s, i) => ({ ...s, hr: 165 - i * 5 })),
    },
  },
  {
    id: 'splits/duplicate-mile-numbers',
    origin: 'two ingests absorbed into one array · every mile appears twice',
    data: {
      distanceMi: 3, durationSec: 1440,
      splits: [mile(1, 480, 140), mile(1, 482, 141), mile(2, 485, 148), mile(2, 486, 149),
               mile(3, 490, 155), mile(3, 491, 156)],
    },
  },
  {
    id: 'splits/mile-zero',
    origin: 'a watch that numbers its first lap 0',
    data: {
      distanceMi: 4, durationSec: 1920,
      splits: [mile(0, 500, 130), mile(1, 480, 140), mile(2, 480, 145), mile(3, 480, 150)],
    },
  },
  {
    id: 'splits/trailing-partial-thousandth',
    origin: 'the runner stopped the watch a metre past the mile marker',
    data: {
      distanceMi: 4.001, durationSec: 1920,
      splits: [...evenSplits(4), { mile: 5, distanceMi: 0.001, paceSPerMi: 480, hr: 150 }],
    },
  },
  {
    id: 'splits/sum-twice-the-run',
    origin: 'the 2026-08-01 row · five splits totalling 4.14 mi on a 1.34-mile run',
    data: { distanceMi: 1.34, durationSec: 640, splits: evenSplits(4) },
  },
  {
    id: 'splits/sum-a-tenth-of-the-run',
    origin: 'a merge kept one lap of a ten-mile run',
    data: { distanceMi: 10, durationSec: 4800, splits: [mile(1, 480, 145)] },
  },
  {
    id: 'splits/pace-without-hr',
    origin: 'the strap dropped for the whole run · GPS kept lapping',
    data: { distanceMi: 5, durationSec: 2400, splits: evenSplits(5, 480, null) },
  },
  {
    id: 'splits/hr-without-pace',
    origin: 'an indoor run · HR recorded, no GPS to pace it',
    data: {
      distanceMi: 5, durationSec: 2400, indoor: true,
      splits: Array.from({ length: 5 }, (_, i) => ({ mile: i + 1, hr: 140 + i * 4 })),
    },
  },
  {
    id: 'splits/half-carry-a-pace',
    origin: 'GPS dropped for the back half · the laps kept firing on HR alone',
    data: {
      distanceMi: 8, durationSec: 3840,
      splits: [
        ...evenSplits(4, 470, 140),
        ...Array.from({ length: 4 }, (_, i) => ({ mile: i + 5, hr: 152 + i })),
      ],
    },
  },
  {
    id: 'splits/every-hr-identical',
    origin: 'a strap emitting its last good reading over and over',
    data: { distanceMi: 6, durationSec: 2880, splits: evenSplits(6, 480, 150) },
  },
  {
    id: 'splits/hr-zero',
    origin: 'the sentinel the watch ships before HR is ready',
    data: {
      distanceMi: 4, durationSec: 1920,
      splits: [mile(1, 480, 0), mile(2, 480, 0), mile(3, 480, 0), mile(4, 480, 0)],
    },
  },
  {
    id: 'splits/hr-250',
    origin: 'strap interference on a cold morning · a plausible-looking spike',
    data: {
      distanceMi: 4, durationSec: 1920,
      splits: [mile(1, 480, 140), mile(2, 480, 250), mile(3, 480, 250), mile(4, 480, 145)],
    },
  },
];

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · CLOCKS
 * ═══════════════════════════════════════════════════════════════════════ */

const CLOCK_SHAPES: Shape[] = [
  {
    id: 'clock/moving-exceeds-elapsed',
    origin: 'a third party stamped its moving time onto a shorter wall clock',
    data: { distanceMi: 5, durationSec: 2400, movingTimeS: 3000 },
  },
  {
    id: 'clock/the-2026-08-23-row',
    origin: 'the real incident · Strava moving time absorbed beside the watch clock',
    data: {
      distanceMi: 11.01, durationSec: 5298, movingTimeS: 2389, elapsedTimeS: 2389,
      movingSec: 2389, paceSPerMi: 217, avgPaceMinPerMi: '8:01', timeMoving: '88:23',
    },
  },
  {
    id: 'clock/both-zero',
    origin: 'a manual entry saved before the fields were filled',
    data: { distanceMi: 5, durationSec: 0, movingTimeS: 0 },
  },
  {
    id: 'clock/elapsed-only',
    origin: 'an apple_health row · durationSec and nothing else',
    data: { distanceMi: 5, durationSec: 2400 },
  },
  {
    id: 'clock/moving-only',
    origin: 'an old Strava row · movingTimeS with no wall clock',
    data: { distanceMi: 5, movingTimeS: 2400 },
  },
  {
    id: 'clock/three-seconds',
    origin: 'the runner started and stopped the watch by accident',
    data: { distanceMi: 0.01, durationSec: 3 },
  },
  {
    id: 'clock/nine-hours',
    origin: 'a fifty-mile ultra · or a watch left running in a car',
    data: { distanceMi: 50, durationSec: 32400 },
  },
  {
    id: 'clock/half-paused',
    origin: 'a genuinely stop-start city run · exactly at the tolerance',
    data: { distanceMi: 6, durationSec: 4000, movingTimeS: 2000 },
  },
];

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · DISTANCE
 * ═══════════════════════════════════════════════════════════════════════ */

const DISTANCE_SHAPES: Shape[] = [
  {
    id: 'distance/hundredth-of-a-mile',
    origin: 'a watch stopped seconds after it started',
    data: { distanceMi: 0.01, durationSec: 5, paceSPerMi: 500 },
  },
  {
    id: 'distance/zero',
    origin: 'a HealthKit workout with no distance samples at all',
    data: { distanceMi: 0, durationSec: 2400, avgHr: 140 },
  },
  {
    id: 'distance/absent',
    origin: 'an indoor workout logged with a duration and nothing else',
    data: { durationSec: 2400, avgHr: 140 },
  },
  {
    id: 'distance/one-hundred-miles',
    origin: 'a hundred-mile ultra · or a unit error upstream',
    data: { distanceMi: 100, durationSec: 86400 },
  },
  {
    id: 'distance/disagrees-with-splits-tenfold',
    origin: 'a metres/miles unit error on one side of a merge',
    data: { distanceMi: 0.4, durationSec: 1920, splits: evenSplits(4) },
  },
];

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · HEART RATE
 * ═══════════════════════════════════════════════════════════════════════ */

const HR_SHAPES: Shape[] = [
  {
    id: 'hr/none',
    origin: 'no strap · 32 rows in this database',
    data: { distanceMi: 5, durationSec: 2400, avgHr: null, maxHr: null },
  },
  {
    id: 'hr/avg-without-max',
    origin: 'a summary import that carries one figure',
    data: { distanceMi: 5, durationSec: 2400, avgHr: 145 },
  },
  {
    id: 'hr/max-below-avg',
    origin: 'two sources merged · one avg, the other max, neither aware',
    data: { distanceMi: 5, durationSec: 2400, avgHr: 165, maxHr: 140 },
  },
  {
    id: 'hr/zero',
    origin: 'the strap sentinel reaching the summary field',
    data: { distanceMi: 5, durationSec: 2400, avgHr: 0, maxHr: 0 },
  },
  {
    id: 'hr/two-fifty',
    origin: 'interference · a reading no runner produced',
    data: { distanceMi: 5, durationSec: 2400, avgHr: 250, maxHr: 250 },
  },
  {
    id: 'hr/zones-sum-zero',
    origin: 'five canonical rows carry this · a bucketer that counted nothing',
    data: {
      distanceMi: 5, durationSec: 2400, avgHr: 140,
      hrZonePcts: { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 },
    },
  },
  {
    id: 'hr/zones-sum-99',
    origin: 'the 2026-08-23 row · five independent roundings over one denominator',
    data: {
      distanceMi: 5, durationSec: 2400, avgHr: 140,
      hrZonePcts: { z1: 15, z2: 37, z3: 21, z4: 12, z5: 14 },
    },
  },
  {
    id: 'hr/zones-sum-140',
    origin: 'a bucketer double-counting overlapping bands',
    data: {
      distanceMi: 5, durationSec: 2400, avgHr: 140,
      hrZonePcts: { z1: 28, z2: 28, z3: 28, z4: 28, z5: 28 },
    },
  },
  {
    id: 'hr/zones-with-a-negative-share',
    origin: 'a bucketer that subtracted before it apportioned',
    data: {
      distanceMi: 5, durationSec: 2400, avgHr: 140,
      hrZonePcts: { z1: -10, z2: 40, z3: 30, z4: 20, z5: 20 },
    },
  },
  {
    id: 'hr/zones-without-avg',
    origin: 'a distribution survived a merge its own average did not',
    data: {
      distanceMi: 5, durationSec: 2400, avgHr: null,
      hrZonePcts: { z1: 20, z2: 20, z3: 20, z4: 20, z5: 20 },
    },
  },
];

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · ELEVATION
 * ═══════════════════════════════════════════════════════════════════════ */

const ELEVATION_SHAPES: Shape[] = [
  {
    id: 'elev/gps-derived-only',
    origin: 'no barometer · arithmetic over GPS altitude, systematically high',
    data: { distanceMi: 11, durationSec: 5280, elevGainFt: 3195, elevGainSource: 'gps_derived' },
  },
  {
    id: 'elev/negative',
    origin: 'a net-downhill point-to-point stored as a signed delta',
    data: { distanceMi: 6, durationSec: 2880, elevGainFt: -420, elevGainSource: 'raw' },
  },
  {
    id: 'elev/five-thousand-on-a-flat-three-miler',
    origin: 'a barometer that saw a weather front, not a hill',
    data: { distanceMi: 3, durationSec: 1440, elevGainFt: 5000, elevGainSource: 'raw' },
  },
  {
    id: 'elev/unlabelled-source',
    origin: 'the oldest rows · a figure with no provenance at all',
    data: { distanceMi: 6, durationSec: 2880, elevGainFt: 890 },
  },
  {
    id: 'elev/treadmill-with-a-climb',
    origin: 'a belt session carrying an outdoor row\'s elevation through a merge',
    data: { distanceMi: 5, durationSec: 2400, indoor: true, source: 'treadmill', elevGainFt: 640, elevGainSource: 'gps_derived' },
  },
];

/* ══════════════════════════════════════════════════════════════════════════
 * 6 · CONTEXT — the row is fine, the situation is not
 * ═══════════════════════════════════════════════════════════════════════ */

const CONTEXT_SHAPES: Shape[] = [
  {
    id: 'context/treadmill-with-a-stale-polyline',
    origin: 'a belt run merged with an outdoor twin · the route is not this run\'s',
    data: {
      distanceMi: 5, durationSec: 2400, indoor: true, source: 'treadmill',
      summaryPolyline: 'a}~fFxbojVaC?_@wA', startLatLng: [37.77, -122.42],
    },
  },
  {
    id: 'context/strava-numeric-workout-type',
    origin: 'a Strava race · workoutType is the number 1, not the word',
    data: { distanceMi: 13.1, durationSec: 5400, workoutType: 1, source: 'strava' },
  },
  {
    id: 'context/splits-flagged-unreliable',
    origin: '39% of rows · pause events inflated the split timestamps',
    data: {
      distanceMi: 6, durationSec: 2880, splits_unreliable: true,
      splits: [mile(1, 470, 140), mile(2, 475, 143), mile(3, 620, 147),
               mile(4, 480, 152), mile(5, 485, 158), mile(6, 900, 160)],
    },
  },
  {
    id: 'context/empty-polyline-string',
    origin: 'Strava returns "" when it has no route · not the same as null',
    data: { distanceMi: 5, durationSec: 2400, summaryPolyline: '' },
  },
];

export const SHAPES: readonly Shape[] = [
  ...SPLIT_SHAPES,
  ...CLOCK_SHAPES,
  ...DISTANCE_SHAPES,
  ...HR_SHAPES,
  ...ELEVATION_SHAPES,
  ...CONTEXT_SHAPES,
];

/**
 * Every string a surface may never print.
 *
 * `null` and `undefined` are here because a template literal writes them down:
 * `Easy ${miNum(mi)} mi` produced "Easy null mi" for a whole afternoon. `NaN`
 * and `Infinity` are here for the same reason one rung further along.
 */
export const FORBIDDEN_IN_PROSE: readonly string[] = [
  'null', 'undefined', 'NaN', 'Infinity', '[object Object]',
];
