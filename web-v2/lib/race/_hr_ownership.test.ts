/**
 * HR-OWNERSHIP-1 · the seven heart-rate numbers, each from ONE owner.
 *
 * `docs/HR_OWNERSHIP.md` states seven numbers, what each means, which single
 * function owns it, and what it comes to for the owner of this app (LTHR 168,
 * HRmax 183). A table in a document is prose (Rule 20), so this gate PARSES
 * that table at run time and recomputes every row from the owner named beside
 * it. A number that moves in the engine and not in the doc — or in the doc and
 * not in the engine — fails here.
 *
 * Rule 18: read the numbers out of the cited source rather than hardcoding
 * both sides, or the check only proves it agrees with itself.
 *
 * THE DEFECT CLASS. Race day used to carry ONE `hr_cap_bpm`, filled with a
 * race-effort figure and graded as a hard ceiling on every surface. The
 * owner's AFC half came in at avg HR 168 against a 168 cap — one beat from
 * amber on his PR, and not by coincidence, because `lthr-reanchor` had set
 * LTHR *to* that race's average. Five meanings, one column, none of them
 * stated. The table exists so that cannot recur; this gate is what makes the
 * table true.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ──────────────────────────────────────
 *
 *   · Whether the FORMULAS are right. `HR.easy-run-ceiling`, `HR.friel-lthr-
 *     zones`, `RACE.hr-bands-by-distance` and their siblings in the doctrine
 *     registry bind those to `Research/03` and `Research/08`. This gate binds
 *     the doc to the code, not the code to the research.
 *   · A surface that reads the right number and then draws it wrongly. The
 *     consumer table in §2 is prose; only §1's numbers are gated here.
 *   · The watch. Its copy of the race band is Swift; `check-wire-keys.sh`
 *     checks the key exists, and the render in the phase report is the
 *     evidence that it draws.
 *   · Anything about heart rate ARRIVING. A sensor that never reports, or
 *     reports a sentinel, is `run-shape.ts`'s question.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { aerobicCeilingBpm, thresholdPassHrBpm } from '@/lib/training/zones';
import { hrCapEasy } from '@/lib/plan/spec-builder';
import {
  RACE_HR_PCT_LTHR,
  raceAbortHrBpm,
  raceCheckpointMi,
} from '@/lib/race/distance-doctrine';
import {
  RACE_HR_LATE_DRIFT_ALLOWANCE_BPM,
  resolveRaceHrGuidance,
} from '@/lib/race/race-hr-guidance';

const ROOT = path.resolve(__dirname, '..', '..');
const DOC = path.resolve(ROOT, '..', 'docs', 'HR_OWNERSHIP.md');

/** The owner's own anchors, and the ones the doc's last column is stated at. */
const LTHR = 168;
const HRMAX = 183;
const MARATHON_MI = 26.22;
const TEN_K_MI = 6.21;

/** Row N's "Value for the owner" cell, as the ordered integers it contains. */
function docRowNumbers(): Map<number, number[]> {
  const src = fs.readFileSync(DOC, 'utf8');
  const anchor = src.indexOf('## 1 · The seven numbers');
  expect(anchor, 'the cited section is gone from docs/HR_OWNERSHIP.md').toBeGreaterThan(0);
  const table = src.slice(anchor, src.indexOf('## 2 ·', anchor));
  const out = new Map<number, number[]>();
  for (const line of table.split('\n')) {
    const m = /^\|\s*([1-7])\s*\|/.exec(line);
    if (!m) continue;
    const cells = line.split('|').map((c) => c.trim());
    // `| # | Number | Means | Owner | Value |` → leading '' then five cells.
    const value = cells[cells.length - 2] ?? '';
    // Strip distance LABELS ("10K", "5K") before reading figures — they name
    // which race the numbers belong to and are not themselves heart rates.
    const nums = (value.replace(/\d+\s*K\b/gi, '').match(/\d+/g) ?? []).map(Number);
    out.set(Number(m[1]), nums);
  }
  return out;
}

/** The race guidance for one distance, resolved with evidence so the band is
 *  enforced rather than informational. */
function guidanceFor(distanceMi: number, paceSecPerMi: number) {
  const g = resolveRaceHrGuidance({
    distanceMi,
    lthrBpm: LTHR,
    maxHrBpm: HRMAX,
    executionPaceSecPerMi: paceSecPerMi,
    efforts: [
      { id: 'a', dateISO: '2026-08-16', distanceMi: 13.1, paceSecPerMi, avgHr: 152, kind: 'long' },
      { id: 'b', dateISO: '2026-07-20', distanceMi: 16, paceSecPerMi: paceSecPerMi + 3, avgHr: 154, kind: 'long' },
    ],
  });
  expect(g, `no guidance resolved for ${distanceMi} mi`).not.toBeNull();
  return g!;
}

describe('HR-OWNERSHIP-1 · the doc and the engine state the same seven numbers', () => {
  const rows = docRowNumbers();

  it('the table is present and complete', () => {
    // LIVENESS · a gate that parses nothing reports clean, which is the worst
    // outcome available because it also reports confidence.
    expect([...rows.keys()].sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const [n, v] of rows) expect(v.length, `row ${n} states no number`).toBeGreaterThan(0);
  });

  it('1 · aerobic ceiling — zones.ts#aerobicCeilingBpm, then hrCapEasy', () => {
    const owner = hrCapEasy(LTHR, HRMAX);
    expect(owner).toBe(aerobicCeilingBpm(LTHR));   // the LTHR arm wins at these anchors
    expect(rows.get(1)).toEqual([owner]);
  });

  it('2 · expected threshold response — zones.ts#thresholdPassHrBpm', () => {
    expect(rows.get(2)).toEqual([thresholdPassHrBpm(LTHR)]);
  });

  it('3 · expected race response — race-hr-guidance, marathon and 10K', () => {
    const m = guidanceFor(MARATHON_MI, 451);
    const k = guidanceFor(TEN_K_MI, 429);
    expect(rows.get(3)).toEqual([...m.expectedRangeBpm, ...k.expectedRangeBpm]);
    // And the band IS doctrine's, not a second derivation.
    expect(m.expectedRangeBpm).toEqual([
      Math.round(LTHR * RACE_HR_PCT_LTHR.m[0]), Math.round(LTHR * RACE_HR_PCT_LTHR.m[1]),
    ]);
  });

  it('4 · early-race ceiling — the range LOW edge, through the checkpoint', () => {
    const m = guidanceFor(MARATHON_MI, 451);
    expect(rows.get(4)).toEqual([m.earlyCeilingBpm, m.earlyThroughMi]);
    expect(m.earlyCeilingBpm).toBe(m.expectedRangeBpm[0]);
    expect(m.earlyThroughMi).toBe(raceCheckpointMi(MARATHON_MI));
  });

  it('5 · late-race allowance — range high plus one hour of doctrine drift', () => {
    const m = guidanceFor(MARATHON_MI, 451);
    expect(rows.get(5)).toEqual([m.lateAllowanceBpm]);
    expect(m.lateAllowanceBpm).toBe(m.expectedRangeBpm[1] + RACE_HR_LATE_DRIFT_ALLOWANCE_BPM);
  });

  it('6 · pass / bail — the session s own contingency figures', () => {
    // The bail on threshold work is the Z5a top the spec-builder authors; the
    // pass line is the Z4→Z5a seam, which is row 2's owner. Both come out of
    // the same LTHR, which is the point of the row.
    const [bail, pass] = rows.get(6)!;
    expect(pass).toBe(thresholdPassHrBpm(LTHR));
    expect(bail).toBeGreaterThan(pass);
    // And the bail sits above the at-LT band rather than inside it, or it
    // would fire on a correctly executed cruise set.
    expect(bail).toBeGreaterThan(LTHR);
  });

  it('7 · safety stop — raceAbortHrBpm at the checkpoint', () => {
    const abort = raceAbortHrBpm({ distanceMi: MARATHON_MI, lthr: LTHR, maxHr: HRMAX });
    expect(rows.get(7)).toEqual([abort, raceCheckpointMi(MARATHON_MI)]);
    const m = guidanceFor(MARATHON_MI, 451);
    expect(m.checkpointAbortBpm).toBe(abort);
  });

  it('the abort sits ABOVE the expected band · a stop is not a target', () => {
    const m = guidanceFor(MARATHON_MI, 451);
    expect(m.checkpointAbortBpm!).toBeGreaterThan(m.expectedRangeBpm[1]);
    // …and above the late allowance would make it unreachable before the
    // finish; doctrine puts the trigger between the two.
    expect(m.checkpointAbortBpm!).toBeLessThanOrEqual(m.lateAllowanceBpm);
  });
});

describe('HR-OWNERSHIP-2 · informational HR never becomes an alarm', () => {
  it('no comparable efforts → informational, and the line says so', () => {
    const g = resolveRaceHrGuidance({
      distanceMi: MARATHON_MI, lthrBpm: LTHR, maxHrBpm: HRMAX,
      executionPaceSecPerMi: 451, efforts: [],
    });
    expect(g!.informationalOnly).toBe(true);
    expect(g!.reasons).toContain('NO_COMPARABLE_EFFORTS_INFORMATIONAL_ONLY');
  });

  it("the runner's own efforts above the band demote it, rather than raising it", () => {
    // The opposite failure is the one that matters: a band the runner's own
    // efforts contradict must stop instructing, NOT be widened to fit.
    const g = resolveRaceHrGuidance({
      distanceMi: MARATHON_MI, lthrBpm: LTHR, maxHrBpm: HRMAX,
      executionPaceSecPerMi: 451,
      efforts: [{ id: 'a', dateISO: '2026-08-16', distanceMi: 16, paceSecPerMi: 451, avgHr: 178, kind: 'long' }],
    });
    expect(g!.informationalOnly).toBe(true);
    expect(g!.reasons).toContain('OWN_EFFORTS_EXCEED_BAND_INFORMATIONAL_ONLY');
    // The band itself is unchanged — evidence changes what it may INSTRUCT,
    // never what doctrine says the number is.
    expect(g!.expectedRangeBpm).toEqual([
      Math.round(LTHR * RACE_HR_PCT_LTHR.m[0]), Math.round(LTHR * RACE_HR_PCT_LTHR.m[1]),
    ]);
  });

  it('a race row carries NO hr_cap_bpm · the 26-mile alarm cannot return', () => {
    // Source scan. `_race_row_refresh_gate` asserts the refresh does not write
    // one; this asserts AUTHORING does not either, which is the other door.
    const src = fs.readFileSync(path.join(ROOT, 'lib/plan/spec-builder.ts'), 'utf8');
    const race = src.slice(src.indexOf('a race row carries NO'), src.indexOf('a race row carries NO') + 900);
    expect(race).toMatch(/hr_cap_bpm:\s*null/);
  });
});
