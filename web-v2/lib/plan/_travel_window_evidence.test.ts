/**
 * TRAVELWINDOW-1 (2026-09-09) · a runner's real capability must not be
 * discounted for a travel week.
 *
 * Confirmed against fresh `origin/main` before this fix: `volume-evidence-
 * loader.ts` never joined `travel_windows`, so `declaredCause` was always
 * ABSENT and `classifyLowWeek` (`lib/adaptation/volume-evidence/admit.ts`)
 * had no way to answer TRAVEL_OR_LIFE for a short week that was actually a
 * declared trip. Per this file's own header (before this change): "It
 * cannot tell TRAVEL_OR_LIFE from MISSED_TRAINING." Docs cited by both
 * files: Rule 8 (a taper/recovery window is never the runner's normal —
 * the same corollary applies to a travel window, which is not a fact about
 * the runner's capacity either) and the per-finding context-filter rule
 * (2026-05-19 round 4).
 *
 * The concrete failure this closes: three or more consecutive travel weeks
 * used to fall through `classifyLowWeek`'s ladder all the way to
 * `GENUINE_CAPACITY_LOSS` (the one cause of six that `mayLowerBelief`), which
 * would LOWER the runner's demonstrated-volume belief off weeks that say
 * nothing about what he can carry — exactly the shape the audit
 * (docs/audit-2026-09-08-full-status-master-report.md §10a item 10) named.
 *
 * These tests exercise `declaredCauseForWeek` (the pure function extracted
 * from the loop `loadVolumeEvidence` now calls) directly, and then feed its
 * output straight into the REAL `classifyLowWeek` to prove the two pieces
 * compose correctly — no DB needed for either half, matching the house
 * pattern `_overshoot_race_recency.test.ts` already set for a sibling
 * Rule-8-shaped fix.
 */
import { describe, it, expect } from 'vitest';
import { declaredCauseForWeek } from './volume-evidence-loader';
import { classifyLowWeek } from '@/lib/adaptation/volume-evidence/admit';
import { measured } from '@/lib/adaptation/canonical/input';
import type { TravelWindow } from './travel-windows';

const NO_TRAVEL: TravelWindow[] = [];
const A_TRIP: TravelWindow[] = [{ startISO: '2026-09-10', endISO: '2026-09-16' }];

describe('declaredCauseForWeek · the pure per-week read', () => {
  it('FAIL-BEFORE CONTROL · with no travel windows at all, every week is absent', () => {
    // This is what the loader answered for EVERY runner before this fix —
    // kept as the explicit control so the tests below read as a delta from
    // it, not as an assertion invented after the fact.
    const cause = declaredCauseForWeek('2026-09-07', '2026-09-14', NO_TRAVEL);
    expect(cause.ok).toBe(false);
  });

  it('a week entirely inside a declared trip declares TRAVEL_OR_LIFE', () => {
    const cause = declaredCauseForWeek('2026-09-10', '2026-09-17', A_TRIP);
    expect(cause).toEqual(measured('TRAVEL_OR_LIFE'));
  });

  it('a week with ONE day inside the trip still declares the whole week', () => {
    // The trip starts mid-week (2026-09-10, a Thursday relative to a
    // Monday-start week 2026-09-07..09-14) — only the last four days
    // overlap, and the week still declares TRAVEL_OR_LIFE. A runner does
    // not train normally for three days and travel for four; the week is
    // the unit `classifyLowWeek` grades.
    const cause = declaredCauseForWeek('2026-09-07', '2026-09-14', A_TRIP);
    expect(cause).toEqual(measured('TRAVEL_OR_LIFE'));
  });

  it('a week entirely outside any window is absent, exactly as before', () => {
    const cause = declaredCauseForWeek('2026-08-03', '2026-08-10', A_TRIP);
    expect(cause.ok).toBe(false);
  });

  it('the exclusive week-end boundary is respected: the trip\'s own end day still counts, the day after does not', () => {
    // A_TRIP ends 2026-09-16. A week starting exactly the day after
    // (09-17..09-24) must NOT see the trip.
    expect(declaredCauseForWeek('2026-09-16', '2026-09-23', A_TRIP)).toEqual(measured('TRAVEL_OR_LIFE'));
    expect(declaredCauseForWeek('2026-09-17', '2026-09-24', A_TRIP).ok).toBe(false);
  });

  it('no windows at all never throws and always reads absent', () => {
    expect(declaredCauseForWeek('2026-01-01', '2026-01-08', []).ok).toBe(false);
  });
});

describe('declaredCauseForWeek composed with the REAL classifyLowWeek', () => {
  const baseInput = {
    weekStartISO: '2026-09-10',
    prescribedMi: 40,
    completedMi: measured(15),
    prescribedNonNormal: false,
    dataComplete: true,
    minConsecutiveWeeksForLoss: 3,
  } as const;

  it('THE INCIDENT THIS FIXES · a short week during a declared trip no longer reads as missed training', () => {
    const declaredCause = declaredCauseForWeek('2026-09-10', '2026-09-17', A_TRIP);
    const reading = classifyLowWeek({
      ...baseInput,
      declaredCause,
      consecutiveLowRepresentativeWeeks: 1,
    });
    expect(reading.cause).toBe('TRAVEL_OR_LIFE');
    expect(reading.mayLowerBelief).toBe(false);
  });

  it('FAIL-BEFORE, REPRODUCED EXACTLY · the same short week with the pre-fix constant input (always absent) reads as MISSED_TRAINING', () => {
    // `absent(...)` here stands in for exactly what `volume-evidence-loader
    // .ts` produced for every week, unconditionally, before this fix — the
    // literal old behaviour, not a re-derivation of it.
    const reading = classifyLowWeek({
      ...baseInput,
      declaredCause: { ok: false, why: { kind: 'ABSENT', what: 'nothing on this account records why a week came in short' } },
      consecutiveLowRepresentativeWeeks: 1,
    });
    expect(reading.cause).toBe('MISSED_TRAINING');
  });

  it('THE THREE-WEEK CASE THE AUDIT NAMED · three consecutive travel weeks no longer read as capacity loss', () => {
    // Before this fix, the third of three consecutive short weeks — with
    // `consecutiveLowRepresentativeWeeks` having climbed to 3 — fell through
    // every branch above GENUINE_CAPACITY_LOSS and landed on it, because
    // `declaredCause` was always absent. With the join in place the SAME
    // three weeks are declared TRAVEL_OR_LIFE and classifyLowWeek's
    // TRAVEL_OR_LIFE branch sits ABOVE the consecutive-loss check, so it is
    // read correctly regardless of how high the counter climbed.
    const declaredCause = declaredCauseForWeek('2026-09-10', '2026-09-17', A_TRIP);
    const thirdWeek = classifyLowWeek({
      ...baseInput,
      declaredCause,
      consecutiveLowRepresentativeWeeks: 3,
    });
    expect(thirdWeek.cause).toBe('TRAVEL_OR_LIFE');
    expect(thirdWeek.mayLowerBelief).toBe(false);

    // Falsify the fix, not just the absence of a regression: the same three
    // weeks WITHOUT the join (declaredCause forced absent) DO fall to
    // GENUINE_CAPACITY_LOSS at this exact counter value — proving the
    // TRAVEL_OR_LIFE branch, not some other guard, is what is protecting it.
    const thirdWeekUnfixed = classifyLowWeek({
      ...baseInput,
      declaredCause: { ok: false, why: { kind: 'ABSENT', what: 'nothing on this account records why a week came in short' } },
      consecutiveLowRepresentativeWeeks: 3,
    });
    expect(thirdWeekUnfixed.cause).toBe('GENUINE_CAPACITY_LOSS');
    expect(thirdWeekUnfixed.mayLowerBelief).toBe(true);
  });

  it('a genuinely undeclared short week still reads as MISSED_TRAINING, never as a free pass', () => {
    // The fix must not turn every low week into TRAVEL_OR_LIFE — only the
    // ones a real travel window covers.
    const declaredCause = declaredCauseForWeek('2026-08-03', '2026-08-10', A_TRIP);
    const reading = classifyLowWeek({
      ...baseInput,
      weekStartISO: '2026-08-03',
      declaredCause,
      consecutiveLowRepresentativeWeeks: 1,
    });
    expect(reading.cause).toBe('MISSED_TRAINING');
  });
});
