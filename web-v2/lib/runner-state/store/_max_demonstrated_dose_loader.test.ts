/**
 * lib/runner-state/store/_max_demonstrated_dose_loader.test.ts · F097.
 *
 * Tests the ONE wiring change this finding makes to `loaders.ts`:
 * `loadMaxDemonstratedDose` used to return `absentBelief(...)` unconditionally
 * — the field was null for every runner, every call, forever, regardless of
 * what `userUuid`/`todayISO` it was given. It now calls
 * `maxDemonstratedDoseByDomain` (`lib/execution/max-demonstrated-dose.ts`,
 * tested on its own terms in `lib/execution/_max_demonstrated_dose.test.ts`)
 * and submits whatever it returns.
 *
 * `maxDemonstratedDoseByDomain` is mocked here on purpose — this file is not
 * re-testing the aggregator's own window/taper/domain logic, only that the
 * LOADER correctly turns its output into a `submitted` belief (never
 * `absentBelief`) and turns a thrown read into `failedBelief` (never a
 * silent `absentBelief` masquerading as "measured, none found").
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/execution/max-demonstrated-dose', () => ({
  maxDemonstratedDoseByDomain: vi.fn(),
}));

import { maxDemonstratedDoseByDomain } from '@/lib/execution/max-demonstrated-dose';
import { loadMaxDemonstratedDose } from './loaders';

const USER = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const TODAY = '2026-09-14';

beforeEach(() => vi.clearAllMocks());

describe('F097 · loadMaxDemonstratedDose', () => {
  it('RULE 18 FALSIFICATION · a real per-domain max is submitted, never absent — the exact pre-fix defect this test would have caught', async () => {
    (maxDemonstratedDoseByDomain as any).mockResolvedValue({
      atPaceMinutesByDomain: { threshold: 42, marathon: 88.5 },
      windowDescribed: '2026-08-15 to 2026-09-14',
    });

    const belief = await loadMaxDemonstratedDose(USER, TODAY);

    // The pre-fix body was `return absentBelief(...)` — `reading.ok` was
    // `false` and `reading.why.kind` was `'ABSENT'` for every call, no
    // matter what this mock returns. Asserting `ok === true` AND the real
    // domain values is what a reverted fix fails on (see the paired
    // revert-and-confirm below, run manually per Rule 18 rather than kept
    // as a live test that edits its own subject file).
    expect(belief.reading.ok).toBe(true);
    if (belief.reading.ok) {
      expect(belief.reading.value.best.atPaceMinutesByFamily).toEqual({
        threshold: 42, marathon: 88.5,
      });
    }
  });

  it('an empty aggregation result is still SUBMITTED, not absent — "measured, none found" is a real answer', async () => {
    (maxDemonstratedDoseByDomain as any).mockResolvedValue({
      atPaceMinutesByDomain: {},
      windowDescribed: '2026-08-15 to 2026-09-14',
    });

    const belief = await loadMaxDemonstratedDose(USER, TODAY);

    expect(belief.reading.ok).toBe(true);
    if (belief.reading.ok) {
      expect(belief.reading.value.best.atPaceMinutesByFamily).toEqual({});
    }
  });

  it('a read that does not complete is FAILED, never a silent absence', async () => {
    (maxDemonstratedDoseByDomain as any).mockRejectedValue(new Error('pool timeout'));

    const belief = await loadMaxDemonstratedDose(USER, TODAY);

    expect(belief.reading.ok).toBe(false);
    if (!belief.reading.ok && belief.reading.why.kind === 'FAILED') {
      expect(belief.reading.why.what).toContain('pool timeout');
    } else {
      throw new Error('expected a FAILED readability, got something else');
    }
  });
});
