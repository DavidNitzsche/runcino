/**
 * THE CROSS-LANGUAGE FORMAT CONTRACT.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * A pace formatted on the phone must equal the pace formatted on the server
 * for the same run. Nothing could check that before this file, because the two
 * implementations are in different languages and no test could see both.
 *
 * So the server writes the answers down. This test renders every case in the
 * table below through `lib/wire-format/format.ts` and emits a Swift file the
 * iPhone test bundle compiles and asserts against. Neither side can move
 * without the other going red:
 *
 *   · change the server formatter → this test fails until the vectors are
 *     regenerated, and the Swift test then fails until Swift agrees
 *   · change `FaffFmt` → the Swift test fails against the checked-in vectors
 *
 * Regenerate deliberately, never reflexively:
 *
 *     UPDATE_FORMAT_VECTORS=1 npx vitest run lib/wire-format/
 *
 * A regeneration that someone ran to make a test go green is exactly the
 * failure this guards against, so the diff is meant to be read.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THESE INPUTS
 *
 * The boundary cases are the whole point. `479.7` is the value that printed
 * `7:60/mi` on the server and `8:00` on the phone; `3599.7` printed `59:60`
 * against `1:00:00`. Fractional seconds arrive by division (a pace IS a
 * quotient), from HealthKit averaging, and from node-pg returning numerics as
 * floats — they are the normal case, not the exotic one.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as F from './format';
import { workoutTypeTitle, TITLED_WORKOUT_TYPES } from '../coach/workout-title';

const SWIFT_OUT = resolve(
  __dirname,
  '../../../native-v2/Faff/FaffTests/ClientSweep/FormatVectors.generated.swift',
);

/** Seconds. Whole values, then every way a fraction can land near a boundary. */
const SECONDS: number[] = [
  0, 1, 59, 60, 61, 90, 419, 420, 421, 451, 599, 600,
  // the carry boundary — the bug that started this
  359.5, 359.51, 419.5, 449.7, 479.4, 479.5, 479.7, 539.6, 599.7,
  // clock territory
  3599, 3599.4, 3599.5, 3599.7, 3600, 3601, 3661.4, 6113, 7199.8, 7200,
  // a real finish and a real projection
  6113.0, 10800, 11805.6,
  // hostile
  -1, 0.4, 0.6,
];

const MILES: number[] = [0, 0.04, 0.05, 1, 1.04, 1.05, 6.2, 6.24, 6.25, 13.1, 26.2, 100];
const DELTAS: number[] = [-24.4, -24.5, -1, 0, 0.4, 1, 24.5, 24.4];
const BPMS: number[] = [0, 1, 51.4, 51.5, 152, 164.5, 199];

type Row = { fn: string; input: number; out: string | null };

function build(): Row[] {
  const rows: Row[] = [];
  for (const s of SECONDS) {
    rows.push({ fn: 'paceMinSec', input: s, out: F.paceMinSec(s) });
    rows.push({ fn: 'clock', input: s, out: F.clock(s) });
    rows.push({ fn: 'raceTime', input: s, out: F.raceTime(s) });
  }
  for (const m of MILES) rows.push({ fn: 'miles', input: m, out: F.miles(m) });
  for (const d of DELTAS) rows.push({ fn: 'paceDeltaSec', input: d, out: F.paceDeltaSec(d) });
  for (const b of BPMS) rows.push({ fn: 'bpm', input: b, out: F.bpm(b) });
  return rows;
}

function renderSwift(rows: Row[]): string {
  const lit = (o: string | null) => (o == null ? 'nil' : `"${o}"`);
  const body = rows
    .map((r) => `        V(fn: .${r.fn}, input: ${r.input}, expected: ${lit(r.out)}),`)
    .join('\n');
  const typeBody = [...TITLED_WORKOUT_TYPES]
    .sort()
    .map((t) => `        T(wire: "${t}", serverTitle: "${workoutTypeTitle(t)}"),`)
    .join('\n');

  return `//
//  FormatVectors.generated.swift
//  GENERATED — do not edit by hand.
//
//  Written by \`web-v2/lib/wire-format/_format_vectors.test.ts\` from the
//  SERVER's own formatters in \`lib/wire-format/format.ts\`. Regenerate with:
//
//      UPDATE_FORMAT_VECTORS=1 npx vitest run lib/wire-format/
//
//  Every row is a number the server turned into a string, and
//  \`FormatConformanceTests\` asserts the phone turns the same number into the
//  same string. A pace formatted on the phone must equal the pace formatted on
//  the server for the same run; before this table nothing could check that.
//
//  Editing this file by hand to make a test pass would defeat its only
//  purpose. Fix the formatter on whichever side is wrong instead.
//

enum FormatVectors {

    enum Fn: String {
        case paceMinSec, clock, raceTime, miles, paceDeltaSec, bpm
    }

    struct V {
        let fn: Fn
        let input: Double
        /// What the SERVER produced. nil means the server declined to format.
        let expected: String?
    }

    static let all: [V] = [
${body}
    ]
}

/// EVERY WORKOUT TYPE THE SERVER CAN PUT ON THE WIRE, with the word it turns
/// each into for the display register.
///
/// A type headlined a screen in 44pt Archivo as \`RACE_WEEK_TUNEUP\` because
/// nothing checked that the phone had a word for it. \`RegisterSweepTests\`
/// walks this list and asserts the phone maps every one — so a type added to
/// the server with no client mapping fails on the phone rather than on the
/// runner's screen.
enum TypeVocabulary {
    struct T {
        let wire: String
        /// What the server headlines it as.
        let serverTitle: String
    }

    static let all: [T] = [
${typeBody}
    ]
}
`;
}

describe('wire-format · the cross-language contract', () => {
  const rows = build();

  it('produces a vector for every case', () => {
    expect(rows.length).toBeGreaterThan(100);
  });

  /**
   * THE BUG THAT STARTED THIS, pinned so it cannot come back. Before
   * `lib/wire-format/format.ts` existed, the composer rounded the REMAINDER
   * and printed a sixtieth second.
   */
  /**
   * NO WORKOUT TYPE MAY REACH THE DISPLAY REGISTER AS A RAW ENUM.
   *
   * This is the 44pt `RACE_WEEK_TUNEUP` incident, gated. The map covers that
   * one now; the fallback was the real defect and it was still waiting for the
   * next type nobody remembered to add.
   */
  it('turns every workout type into a word, never a token', () => {
    for (const t of TITLED_WORKOUT_TYPES) {
      const title = workoutTypeTitle(t);
      expect(title, `${t} headlines as a raw token`).not.toMatch(/_/);
      expect(title.length, `${t} has no title`).toBeGreaterThan(0);
    }
  });

  it('sanitises even a type nobody mapped', () => {
    expect(workoutTypeTitle('some_new_session_type')).toBe('SOME NEW SESSION TYPE');
    expect(workoutTypeTitle('some_new_session_type')).not.toMatch(/_/);
  });

  it('never carries a rounded remainder to :60', () => {
    for (const r of rows) {
      if (r.out == null) continue;
      expect(r.out, `${r.fn}(${r.input}) printed a :60`).not.toMatch(/:60(\D|$)/);
    }
  });

  it('agrees with the checked-in Swift vectors', () => {
    const swift = renderSwift(rows);

    if (process.env.UPDATE_FORMAT_VECTORS === '1') {
      mkdirSync(dirname(SWIFT_OUT), { recursive: true });
      writeFileSync(SWIFT_OUT, swift, 'utf8');
    }

    expect(
      existsSync(SWIFT_OUT),
      `${SWIFT_OUT} is missing. Generate it with UPDATE_FORMAT_VECTORS=1.`,
    ).toBe(true);

    expect(
      readFileSync(SWIFT_OUT, 'utf8'),
      'the Swift vectors have drifted from the server formatters — regenerate and read the diff',
    ).toBe(swift);
  });
});
