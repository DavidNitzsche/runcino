/**
 * _backdate_guard.test.ts · BACKDATE-1 · a regen never authors into the past.
 *
 * THE DEFECT THIS EXISTS FOR (live, 2026-08-30). The `recovery_complete`
 * lifecycle regen composes week 0 from the training-week boundary, which on a
 * Sunday is the previous Monday — six days already gone. `clipBeforeISO` is
 * deliberately null on that path so Rule 15 can carry the outgoing plan's
 * prescription onto the days the runner actually RAN. Nothing, however, stopped
 * the freshly-composed prescription from landing on a past day the runner did
 * NOT run. David's CIM block put `tempo 6mi · 3 mi @ T` on Tuesday 2026-08-25 —
 * five days past, unsealed, and 9 days after his 08-16 half, inside
 * `Research/00b`'s 10-14 day post-half no-quality window.
 *
 * The gate below walks composed days through `persistsComposedDay` — the same
 * function `persistPlan` calls — so it fails on the shape rather than on one
 * account's live rows.
 */
import { describe, it, expect } from 'vitest';
import { persistsComposedDay, requestedBlockStartISO, weekStartBoundaryOf } from './generate';

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** `persistPlan`'s own date derivation, so the walk below is not a paraphrase. */
function dateForDow(weekStartISO: string, dow: number): string {
  const weekStartDow = new Date(weekStartISO + 'T12:00:00Z').getUTCDay();
  return addDays(weekStartISO, (dow - weekStartDow + 7) % 7);
}

describe('BACKDATE-1 · persistsComposedDay', () => {
  const TODAY = '2026-08-30';

  it('keeps today · a same-day regeneration still authors today', () => {
    expect(persistsComposedDay({
      dateISO: TODAY, todayISO: TODAY, clipBeforeISO: null, sealed: false,
    })).toBe(true);
  });

  it('keeps every future day', () => {
    for (let k = 1; k <= 120; k++) {
      expect(persistsComposedDay({
        dateISO: addDays(TODAY, k), todayISO: TODAY, clipBeforeISO: null, sealed: false,
      })).toBe(true);
    }
  });

  it('DROPS an unsealed past day · the defect', () => {
    expect(persistsComposedDay({
      dateISO: '2026-08-25', todayISO: TODAY, clipBeforeISO: null, sealed: false,
    })).toBe(false);
  });

  it('KEEPS a sealed past day · Rule 15 still carries the prior prescription', () => {
    for (const iso of ['2026-08-24', '2026-08-26', '2026-08-27', '2026-08-28']) {
      expect(persistsComposedDay({
        dateISO: iso, todayISO: TODAY, clipBeforeISO: null, sealed: true,
      })).toBe(true);
    }
  });

  it('clipBeforeISO still wins on the onboarding path, sealed or not', () => {
    // startAnchor 'today' → the runner's first day is today; nothing before it.
    const clip = requestedBlockStartISO(TODAY, 'today', undefined);
    expect(clip).toBe(TODAY);
    expect(persistsComposedDay({
      dateISO: '2026-08-27', todayISO: TODAY, clipBeforeISO: clip, sealed: true,
    })).toBe(false);
  });

  it('a future-dated chosen start clips its own run-up', () => {
    const clip = requestedBlockStartISO(TODAY, 'today', '2026-09-07');
    expect(clip).toBe('2026-09-07');
    expect(persistsComposedDay({
      dateISO: '2026-09-06', todayISO: TODAY, clipBeforeISO: clip, sealed: false,
    })).toBe(false);
    expect(persistsComposedDay({
      dateISO: '2026-09-07', todayISO: TODAY, clipBeforeISO: clip, sealed: false,
    })).toBe(true);
  });
});

describe('BACKDATE-1 · lifecycle regen authors nothing before today', () => {
  /**
   * David's exact shape on the night the CIM block fires: Sunday long run
   * (`longRunDow` 0) → training week starts Monday; today is Sunday 08-30, so
   * week 0's boundary is 08-24 and six of its seven days are gone. Sealed =
   * the days he ran under the outgoing recovery plan; 08-25 and 08-29 are not.
   */
  const TODAY = '2026-08-30';
  const LONG_RUN_DOW = 0;
  const WEEK_START_DOW = (LONG_RUN_DOW + 1) % 7;
  const SEALED = new Set(['2026-08-24', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-30']);

  /** A composed week 0 in the shape the composer emits: dow-keyed days. */
  const week0Days = [
    { dow: 0, type: 'long', distanceMi: 13 },
    { dow: 1, type: 'easy', distanceMi: 2 },
    { dow: 2, type: 'tempo', distanceMi: 6 },     // ← the fabricated 08-25 quality day
    { dow: 3, type: 'easy', distanceMi: 2 },
    { dow: 4, type: 'intervals', distanceMi: 6 },
    { dow: 5, type: 'easy', distanceMi: 2 },
    { dow: 6, type: 'rest', distanceMi: 0 },
  ];

  it('week 0 still begins on the training-week boundary', () => {
    expect(weekStartBoundaryOf(TODAY, WEEK_START_DOW)).toBe('2026-08-24');
  });

  it('the regen path leaves clipBeforeISO null · week 0 is not clipped wholesale', () => {
    expect(requestedBlockStartISO(TODAY, 'monday', undefined)).toBe(null);
  });

  it('no day before today is newly authored, and every sealed day survives', () => {
    const clipBeforeISO = requestedBlockStartISO(TODAY, 'monday', undefined);
    const written: string[] = [];
    for (const d of week0Days) {
      if (d.distanceMi === 0 && d.type !== 'rest' && d.type !== 'race') continue;
      const dateISO = dateForDow('2026-08-24', d.dow);
      if (!persistsComposedDay({
        dateISO, todayISO: TODAY, clipBeforeISO, sealed: SEALED.has(dateISO),
      })) continue;
      written.push(dateISO);
    }

    const newlyAuthoredInPast = written.filter((iso) => iso < TODAY && !SEALED.has(iso));
    expect(newlyAuthoredInPast).toEqual([]);

    // Rule 15 is not collateral damage: every day he ran is still written.
    for (const iso of SEALED) expect(written).toContain(iso);

    // And the specific defect, named.
    expect(written).not.toContain('2026-08-25');
  });

  it('every day from today forward is authored · the block is not truncated', () => {
    const clipBeforeISO = requestedBlockStartISO(TODAY, 'monday', undefined);
    for (let wk = 0; wk < 15; wk++) {
      const startISO = addDays('2026-08-24', wk * 7);
      for (let dow = 0; dow < 7; dow++) {
        const dateISO = dateForDow(startISO, dow);
        if (dateISO < TODAY) continue;
        expect(persistsComposedDay({
          dateISO, todayISO: TODAY, clipBeforeISO, sealed: SEALED.has(dateISO),
        })).toBe(true);
      }
    }
  });
});
