/**
 * lib/coach/cold-start-personas.test.ts · the first month, simulated.
 *
 * 2026-08-17 cold-start audit. Four health signals asserted things they could
 * not know, and every one of them was loudest in a runner's first month — the
 * exact stretch where nobody was looking, because the existing persona bench
 * (`data-shape-personas.test.ts`) varies WHICH devices a runner has connected
 * and holds their history constant at "plenty".
 *
 * This bench varies the other axis: one runner, one device set, three ages.
 *
 *   day 3   · four runs in, two days of them inside the acute window
 *   day 10  · the interesting one · pre-fix this produced a false OVERREACH
 *             and a 4.00 ACWR simultaneously, off nothing but arithmetic
 *   day 30  · past both guards · everything must actually compute, because a
 *             guard that never opens is as broken as one that never closes
 *
 * The runner is deliberately unremarkable: 7 miles a day, every day, from the
 * moment they join. Nothing in this data says "injured", "overreaching" or
 * "spiking". Every alarming number the pre-fix engine produced for them came
 * from dividing by days that had not happened yet.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));

vi.mock('@/lib/runtime/runner-tz', () => ({
  runnerToday: vi.fn().mockResolvedValue('2026-03-31'),
  runnerTimezone: vi.fn().mockResolvedValue('America/Los_Angeles'),
  runnerTimezoneOrPacific: vi.fn().mockResolvedValue('America/Los_Angeles'),
}));

import { pool } from '@/lib/db/pool';
import { computeTrainingForm } from './training-form';
import { computeAcwr, ACWR_CHRONIC_DAYS } from './acwr';

const USER = '00000000-0000-0000-0000-0000000000c0';
const TODAY = '2026-03-31';
const MI_PER_DAY = 7;   // ~49 mi/wk · a real, ordinary training load

const iso = (daysBeforeToday: number): string =>
  new Date(Date.parse(TODAY + 'T12:00:00Z') - daysBeforeToday * 86400000)
    .toISOString().slice(0, 10);

/**
 * Wire the whole read surface for a runner whose account is `ageDays` old and
 * who has run `MI_PER_DAY` every single day of it.
 *
 * Dispatch is on query text rather than call order · both computeTrainingForm
 * and computeAcwr fan out with Promise.all.
 */
function runnerAged(ageDays: number): void {
  const firstISO = iso(ageDays - 1);
  const ranDay = (day: string) => day >= firstISO && day <= TODAY;

  (pool.query as ReturnType<typeof vi.fn>).mockImplementation((sql: string) => {
    // training-form · LTHR lookup. No HR strap · distance inference is used.
    if (sql.includes('SELECT lthr FROM profile')) {
      return Promise.resolve({ rows: [] });
    }

    // training-form · the 121-day generate_series. THIS is the query whose
    // shape made `rows.length === 0` unreachable: it returns a row per
    // calendar day whether or not the runner existed, and the pre-fix guard
    // was the only thing standing between an empty account and a TrainingForm.
    if (sql.includes('WITH all_days AS')) {
      const rows = [];
      for (let i = 120; i >= 0; i--) {
        const d = iso(i);
        rows.push({
          d,
          mi: ranDay(d) ? String(MI_PER_DAY) : '0',
          avg_hr: null,
          inferred_type: null,
        });
      }
      return Promise.resolve({ rows });
    }

    // volume.ts · firstRunISO. The account's true start.
    if (sql.includes('AS first')) {
      return Promise.resolve({ rows: [{ first: firstISO }] });
    }

    // volume.ts · mileageByDay. One canonical run row per day run.
    if (sql.includes('user_uuid::text AS user_uuid')) {
      const rows = [];
      for (let i = 0; i < ACWR_CHRONIC_DAYS; i++) {
        const d = iso(i);
        if (!ranDay(d)) continue;
        rows.push({
          id: `run-${d}`,
          user_uuid: USER,
          data: {
            date: d,
            distanceMi: MI_PER_DAY,
            startLocal: `${d}T06:00:00`,
            movingSec: 3600,
          },
        });
      }
      return Promise.resolve({ rows });
    }

    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => {
  (pool.query as ReturnType<typeof vi.fn>).mockReset();
});

describe('Cold-start persona · day 3', () => {
  beforeEach(() => runnerAged(3));

  it('LOAD · no ACWR · three days cannot fill a 28-day denominator', async () => {
    const r = await computeAcwr(USER, TODAY);
    expect(r.acwr).toBeNull();
    expect(r.acute7).toBeNull();
    expect(r.chronic28).toBeNull();
    expect(r.reason).toBe('insufficient_coverage');
    expect(r.coverageDays).toBe(3);
  });

  it('FORM · a verdict is withheld, the envelope still returns', async () => {
    const f = await computeTrainingForm(USER);
    expect(f).not.toBeNull();
    expect(f!.label).toBe('BUILDING');
    expect(f!.coverageDays).toBe(3);
    expect(f!.acwr).toBeNull();
  });
});

describe('Cold-start persona · day 10 · the two simultaneous fabrications', () => {
  beforeEach(() => runnerAged(10));

  it('LOAD · the 4.00 identity is gone', async () => {
    const r = await computeAcwr(USER, TODAY);
    // Pre-fix, both legs summed the same ten days: acute = sum/7,
    // chronic = sum/28, ratio = 28/7 = 4.00 exactly — for ANY mileage. That
    // number cleared the 2.0 injury hard cap and fired an urgent card.
    expect(r.acwr).toBeNull();
    expect(r.coverageDays).toBe(10);
    expect(r.reason).toBe('insufficient_coverage');
  });

  it('FORM · the false OVERREACH is gone, and the TSB that caused it is still there', async () => {
    const f = await computeTrainingForm(USER);
    expect(f).not.toBeNull();
    // The raw envelope is unchanged — this fix does not massage the numbers.
    // ATL (7-day) has converged on ten days of real load; CTL (42-day) has
    // not, because 111 of the 121 days in the window are days the account did
    // not exist and the EWMA is seeded at zero. TSB is deeply negative and
    // CTL clears the old CTL<10 magnitude guard, which is exactly why that
    // guard let OVERREACH through.
    expect(f!.tsb).toBeLessThan(-30);
    expect(f!.ctl).toBeGreaterThan(10);
    // What changed is the assertion made on top of them.
    expect(f!.label).toBe('BUILDING');
    expect(f!.coverageDays).toBe(10);
  });
});

describe('Cold-start persona · day 30 · the guards must open', () => {
  beforeEach(() => runnerAged(30));

  it('LOAD · ACWR computes, and a steady runner sits in the sweet spot', async () => {
    const r = await computeAcwr(USER, TODAY);
    expect(r.acwr).not.toBeNull();
    expect(r.coverageDays).toBe(ACWR_CHRONIC_DAYS);
    expect(r.reason).toBeNull();
    // Same mileage every day → acute/day and chronic/day are equal → ~1.00.
    // Emphatically NOT 4.00, and nowhere near the 1.5 spike band a runner
    // doing the identical thing every day was being put in.
    expect(r.acwr!).toBeGreaterThan(0.9);
    expect(r.acwr!).toBeLessThan(1.1);
  });

  it('FORM · still BUILDING · 30 days does not cover a 42-day CTL window', async () => {
    const f = await computeTrainingForm(USER);
    expect(f!.coverageDays).toBe(30);
    expect(f!.label).toBe('BUILDING');
    // ACWR, however, is now real — the two windows are different lengths and
    // become available at different times. That is the point of tracking
    // coverage per signal instead of having one global "is this user new" flag.
    expect(f!.acwr).not.toBeNull();
  });
});

describe('Cold-start persona · an account with no runs at all', () => {
  beforeEach(() => {
    (pool.query as ReturnType<typeof vi.fn>).mockImplementation((sql: string) => {
      if (sql.includes('WITH all_days AS')) {
        // The generate_series still returns 121 rows. It always does. This is
        // the shape that made the `rows.length === 0` guard dead code.
        const rows = [];
        for (let i = 120; i >= 0; i--) {
          rows.push({ d: iso(i), mi: '0', avg_hr: null, inferred_type: null });
        }
        return Promise.resolve({ rows });
      }
      if (sql.includes('AS first')) return Promise.resolve({ rows: [{ first: null }] });
      return Promise.resolve({ rows: [] });
    });
  });

  it('FORM · returns null · there is no athlete here to describe', async () => {
    expect(await computeTrainingForm(USER)).toBeNull();
  });

  it('LOAD · no ACWR', async () => {
    const r = await computeAcwr(USER, TODAY);
    expect(r.acwr).toBeNull();
    expect(r.coverageDays).toBe(0);
  });
});
