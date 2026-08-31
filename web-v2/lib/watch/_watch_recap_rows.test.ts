/**
 * lib/watch/_watch_recap_rows.test.ts · the lobby recap board's rows.
 *
 * WATCH-DUP-HR-1 (2026-08-30). The board drew the owner's average heart rate
 * TWICE on one wrist screen — once as the `heart` row's value beside what was
 * asked, and again two rows later as `Heart rate, avg`. Verified by rendering
 * the real 2026-08-30 payload on a watch simulator, not by reading the code:
 *
 *     Heart              under 145        159
 *     Effort                          7 of 10
 *     Heart rate, avg                 159 bpm
 *
 * These assertions are written the way Rule 13 §3 asks for — against the SHAPE
 * of what the runner reads, never against the absence of a defect. "The
 * duplicate is gone" is satisfied by an empty list, by a board with no heart
 * row at all, and by a board that dropped the ask; each of those is a worse
 * bug than the one being fixed. So every case below states what the rows must
 * SAY, and the no-cap case asserts the average is still reported.
 *
 * Falsified against the unfixed composer before landing: case 1 failed with
 * two rows carrying "159", which is the defect named above.
 */
import { describe, it, expect } from 'vitest';
import { composeCompletedRows } from './build-workout';

/** The owner's real 2026-08-30 long run: 13.49 mi against a 13 mi ask, avg
 *  HR 159 against the spec's 145 cap, effort 7 of 10. */
const OWNER_LONG_RUN = {
  distanceMi: 13.49,
  askedMi: 13,
  avgHr: 159,
  askedHrCap: 145,
  askedHrIsHardCap: true,
  effortLogged: 7,
};

describe('the recap board says each number once', () => {
  it('reports the average heart rate exactly once when the plan set a cap', () => {
    const rows = composeCompletedRows(OWNER_LONG_RUN);

    // What the runner reads, not what the rows are keyed as — a surface
    // yields on the rendered text, not on a row id (Rule 17).
    const carrying159 = rows.filter((r) => (r.value ?? '').includes('159'));
    expect(carrying159).toHaveLength(1);

    // And the row that survived is the useful one: it still carries the ask
    // and still grades the reading. Dropping either would satisfy a
    // duplicate-count assertion while making the board worse.
    const heart = rows.find((r) => r.id === 'heart');
    expect(heart).toBeDefined();
    expect(heart!.sub).toBe('under 145');
    expect(heart!.value).toBe('159');
    expect(heart!.tone).toBe('attention');
  });

  it('still reports the average when no hard cap was prescribed', () => {
    // A quality day carries `lthr_bpm`, not `hr_cap_bpm`, so `heart` never
    // draws — and the plain reading is then the only report of the average
    // there is. This is the case the `hr_avg` row exists for, and removing
    // it wholesale instead of deferring would have silently deleted it.
    const rows = composeCompletedRows({ ...OWNER_LONG_RUN, askedHrCap: null, askedHrIsHardCap: false });

    expect(rows.find((r) => r.id === 'heart')).toBeUndefined();
    const avg = rows.find((r) => r.id === 'hr_avg');
    expect(avg).toBeDefined();
    expect(avg!.value).toBe('159 bpm');
  });

  it('draws no heart reading at all when the watch recorded none', () => {
    // Rule 11 · a missing reading is not a zero and not a dash. Neither row
    // may invent one, and the board is allowed to be shorter.
    const rows = composeCompletedRows({ ...OWNER_LONG_RUN, avgHr: null });

    expect(rows.find((r) => r.id === 'hr_avg')).toBeUndefined();
    const heart = rows.find((r) => r.id === 'heart');
    expect(heart!.value).toBeNull();
    expect(heart!.tone).toBeNull();
  });

  it('no two rows in any of these boards report the same reading', () => {
    // The general form of the defect, across every combination the flags can
    // take — the duplicate arose from two independent `if`s, so the guard has
    // to hold for the whole matrix rather than the one case that was seen.
    //
    // Compared on the NUMBER, not the string. The first draft of this
    // assertion compared `value` verbatim and passed against the unfixed
    // composer, because the two rows render "159" and "159 bpm" — different
    // strings, one number, and the runner reads the number. A unit suffix is
    // not a second quantity, and an assertion that thinks it is cannot see
    // the bug it was written for.
    const reading = (v: string) => v.replace(/[^\d.]/g, '');
    for (const askedHrIsHardCap of [true, false]) {
      for (const avgHr of [159, null]) {
        for (const effortLogged of [7, null]) {
          const rows = composeCompletedRows({
            ...OWNER_LONG_RUN,
            askedHrCap: askedHrIsHardCap ? 145 : null,
            askedHrIsHardCap,
            avgHr,
            effortLogged,
          });
          // Distance and effort legitimately share the numeric space with a
          // heart rate, so this compares only the rows that report a bpm.
          const hrRows = rows
            .filter((r) => r.id === 'heart' || r.id === 'hr_avg')
            .map((r) => r.value)
            .filter((v): v is string => v != null)
            .map(reading);
          expect(new Set(hrRows).size, `same reading twice in ${JSON.stringify(hrRows)}`)
            .toBe(hrRows.length);
        }
      }
    }
  });
});
