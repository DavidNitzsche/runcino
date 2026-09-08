/**
 * lib/coach/_incline_zero_reading.test.ts
 *
 * A FLAT BELT IS A READING. ZERO PERCENT IS NOT "NO INCLINE".
 *
 * ── THE DEFECT (INCLINE-ZERO-1, found 2026-09-08) ───────────────────────────
 *
 * SIMROW-1 · RECAP moved the recap route's hand-written phase ladder onto its
 * owner, `lib/runs/run-shape.ts#runPhases` — the right move, and the reason
 * `recap-phase-readings.ts` exists. But the owner parsed `actualInclinePct`
 * with `pos()`, "a finite POSITIVE number, or null", and the route's own
 * ladder had been `typeof p.actualInclinePct === 'number' ? … : null`. So a
 * treadmill phase that genuinely recorded 0.0% arrived as `null`.
 *
 * `pos` is correct for distance, duration, pace and belt SPEED — a belt at
 * 0.0 mph is not moving. It is wrong for incline, and this app already knew
 * that twice over: `lib/runs/belt-averages.ts` passes `positiveOnly: false`
 * for incline and `true` for speed in the same call, and
 * `lib/terrain/run-terrain.ts#treadmillMeanInclinePct` uses a finite-number
 * parse of its own.
 *
 * ── WHAT IT COST, AND IN BOTH DIRECTIONS ────────────────────────────────────
 *
 * `lib/coach/run-win.ts#winTreadmill`'s steady-effort line appends
 * ", steady incline" when the surviving inclines span ≤ 0.5. It filters nulls
 * out, so dropping the zeros moves the sentence BOTH WAYS:
 *
 *   · a session run entirely at 0% loses the phrase — nothing survives;
 *   · a session that actually went 1% → 0% → 1% GAINS it — only the 1s
 *     survive, so a belt that changed reads as one that never did.
 *
 * The second is the one in this account's own rows. Three of the owner's real
 * treadmill completions carry a 0 on a work phase (2026-07-23, 2026-08-06,
 * 2026-08-28); the 2026-07-23 session below is one of them, verbatim.
 *
 * ── WHAT THIS FILE ASSERTS ──────────────────────────────────────────────────
 *
 *   1 · the owner keeps a real 0 as 0 for `actualInclinePct`;
 *   2 · the recap's readings carry it through, since that is the array
 *       `deriveWin` is handed;
 *   3 · the SENTENCE the runner reads is the one the belt earned — checked on
 *       the rendered text, not on the field, because the field is not what is
 *       on his screen (Rule 13);
 *   4 · belt SPEED keeps its positive-only parse, so this is a correction and
 *       not a blanket loosening.
 *
 * ── WHAT THIS FILE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
 *
 * It cannot fail on `winTreadmill` choosing the wrong PATTERN — it seeds a
 * session that reaches pattern 1 and stays there. It cannot fail on the
 * ±0.2 mph steadiness band or the ±0.5 incline band being the wrong numbers;
 * those are coach judgement and this file takes them as given. It cannot fail
 * on the recap's other five derivations, which `_recap_phase_row_identity`
 * owns. It only asks whether a measured zero survives the trip.
 *
 * ── FALSIFIED ───────────────────────────────────────────────────────────────
 *
 * Restoring `pos(p.actualInclinePct)` in `runPhases` reddens 1, 2 and 3, and
 * 3 reports the fabricated ", steady incline" over a belt that moved.
 */
import { describe, it, expect } from 'vitest';
import { runPhases, type RunData } from '@/lib/runs/run-shape';
import { recapPhaseReadings } from '@/lib/coach/recap-phase-readings';
import { deriveWin, type WinInput } from '@/lib/coach/run-win';

/**
 * `coach_intents.field = 'trd_46239D3F-9A43-4F2E-BE22-733DC84D41D2'`, the
 * owner's 2026-07-23 treadmill interval session, verbatim. Four work reps at
 * one identical belt speed, and the belt at 1% for three of them and 0% for
 * the second. Speeds are stored to full float precision on the real row.
 */
const REAL_0723 = [
  { type: 'warmup', label: 'Warm-up', actualSpeedMph: 6.70391061452514, actualInclinePct: 1, completed: true, actualDurationSec: 806 },
  { type: 'work', label: 'Interval · 1 mi', actualSpeedMph: 9.254498714652957, actualInclinePct: 1, completed: true, actualDurationSec: 389 },
  { type: 'recovery', label: 'Jog 3 min', actualSpeedMph: 6.70391061452514, actualInclinePct: 1, completed: true, actualDurationSec: 180 },
  { type: 'work', label: 'Interval · 1 mi', actualSpeedMph: 9.254498714652957, actualInclinePct: 0, completed: true, actualDurationSec: 389 },
  { type: 'recovery', label: 'Jog 3 min', actualSpeedMph: 6.70391061452514, actualInclinePct: 0, completed: true, actualDurationSec: 180 },
  { type: 'work', label: 'Interval · 1 mi', actualSpeedMph: 9.254498714652957, actualInclinePct: 1, completed: false, actualDurationSec: 346 },
  { type: 'recovery', label: 'Jog 3 min', actualSpeedMph: 6.70391061452514, actualInclinePct: 1, completed: false },
  { type: 'work', label: 'Interval · 1 mi', actualSpeedMph: 9.254498714652957, actualInclinePct: 1, completed: false },
  { type: 'cooldown', label: 'Cool-down', actualSpeedMph: 6.70391061452514, actualInclinePct: 1, completed: false },
];

/** The same session with the belt held at 0% throughout — the other direction. */
const ALL_FLAT = REAL_0723.map((p) => ({ ...p, actualInclinePct: 0 }));

function winFor(phases: unknown[]): string | null {
  const readings = recapPhaseReadings(phases);
  const input: WinInput = {
    type: 'intervals',
    phase: null,
    plannedMi: 6,
    plannedPaceSPerMi: 389,
    plannedHrCap: null,
    actualMi: 6.1,
    actualPaceSPerMi: 392,
    actualAvgHr: 158,
    indoor: true,
    source: 'treadmill',
    verdict: 'On plan',
    phases: readings.phases,
  } as unknown as WinInput;
  return deriveWin(input);
}

describe('INCLINE-ZERO-1 · a flat belt is a reading', () => {
  it('1 · `runPhases` keeps a measured 0 as 0, not null', () => {
    const out = runPhases({ phases: REAL_0723 } as unknown as RunData);
    expect(out.map((p) => p.actualInclinePct)).toEqual([1, 1, 1, 0, 0, 1, 1, 1, 1]);
    // Not "some are non-null" — the exact vector, so a future parse that
    // rounds, clamps, or drops one is visible rather than merely non-empty.
    expect(out.filter((p) => p.actualInclinePct === 0)).toHaveLength(2);
  });

  it('2 · the recap readings carry it into the array `deriveWin` is handed', () => {
    const readings = recapPhaseReadings(REAL_0723);
    const workInclines = readings.phases
      .filter((p) => p.type === 'work')
      .map((p) => p.actualInclinePct);
    expect(workInclines).toEqual([1, 0, 1, 1]);
  });

  it('3 · the SENTENCE matches the belt · a belt that moved is not "steady"', () => {
    // The four work reps are at one speed, so pattern 1 fires and the only
    // open question is the incline clause. The belt went 1% → 0% → 1%: a
    // 1.0 spread, past the 0.5 band, so there is no steady-incline claim to
    // make. With the zeros discarded the surviving inclines were [1,1,1] and
    // this line read ", steady incline" over a belt that changed.
    expect(winFor(REAL_0723)).toBe(
      "Held the line · 9.3 mph. The treadmill didn't drift you · the discipline did.",
    );
  });

  it('3b · …and a genuinely flat session KEEPS the phrase it earned', () => {
    // The other direction, and the one an absence-only assertion would miss.
    // Every work rep at 0.0%: a real, steady, flat belt. Discarding zeros
    // left this with no inclines at all and silently dropped the clause.
    expect(winFor(ALL_FLAT)).toBe(
      "Held the line · 9.3 mph, steady incline. The treadmill didn't drift you · the discipline did.",
    );
  });

  it('4 · belt SPEED keeps its positive-only parse — this is not a loosening', () => {
    // A phase reporting 0.0 mph is a belt that is not moving, which is the
    // case `pos` exists for. Only incline changed.
    const out = runPhases({
      phases: [{ type: 'work', actualSpeedMph: 0, actualInclinePct: 0, actualDistanceMi: 0 }],
    } as unknown as RunData);
    expect(out[0].actualSpeedMph).toBeNull();
    expect(out[0].actualDistanceMi).toBeNull();
    expect(out[0].actualInclinePct).toBe(0);
  });
});
