/**
 * lib/plan/_owned_days_reign.test.ts · "most recently authored" is not "most
 * authoritative" — the three-tier reign tiebreak, read off the SQL.
 *
 * There is no Postgres in this suite (see `_plan_undo.test.ts`'s header for
 * why owned-days tests are source scans rather than fixtures against a live
 * database), so this pins the emitted SQL's structure and clause ORDER rather
 * than executing it. The live falsifier that actually proves the fix — run
 * against the real account the bug was found on, both with the old tiebreak
 * (to prove the fixture is real) and the new one (to prove it's fixed) — is
 * `_probe_owned_days_reign_2026-09-01.test.ts`, gated behind a live DB.
 *
 * The scenario this encodes, verbatim from
 * `docs/reports/taper-tempo-comparison-basis-2026-09-01.md`: a plan authored
 * 2026-06-07 and archived 21 minutes later (a reverted `POST /api/plan/undo`
 * round-trip that never served a single day) carried a LATER `authored_iso`
 * than the runner's real plan — authored 2026-06-03, adapted in place four
 * times, live for two and a half months, archived only when its race
 * completed. Pre-fix, `authored_iso DESC` alone decided once both were
 * archived, so the 21-minute ghost outranked the real plan for every date
 * they both covered. The fix: a plan only owns a date if that date falls
 * inside its reign as the active plan, `[authored_iso,
 * COALESCE(archived_iso, now()))` — and the ghost's reign is 21 minutes in
 * June that contains no July or August date at all.
 */
import { describe, it, expect } from 'vitest';
import { ownedDaysSql } from './owned-days';

const emitted = ownedDaysSql();
const orderByAt = emitted.indexOf('ORDER BY');
const orderBy = emitted.slice(orderByAt);

describe('1 · reign containment outranks authored_iso once both candidates are archived', () => {
  it('tests calendar-day overlap against [authored_iso, archived_iso) — or [authored_iso, +∞) while active', () => {
    // The ghost's authored_iso (2026-06-07) predates the day boundary and its
    // archived_iso (21 minutes later, same day) is before the day even starts
    // for any date after 2026-06-07 — so its reign cannot contain a July date,
    // no matter how its authored_iso compares to the real plan's.
    expect(emitted).toContain("tp.authored_iso < ((pw.date_iso::date + interval '1 day') AT TIME ZONE 'UTC')");
    expect(emitted).toContain('(tp.archived_iso IS NULL OR tp.archived_iso > ((pw.date_iso::date) AT TIME ZONE \'UTC\'))');
  });

  it('leaves the active plan\'s reign open-ended, not truncated at now()', () => {
    // Truncating an active plan's reign at now() would make it fail to own
    // any FUTURE date — a plan authored today must still own next week's
    // workout even though "now" is earlier than next week. now() only enters
    // the tiebreak (case 2 below), never the reign's own upper bound.
    const reignPredicateCount = emitted.split("tp.authored_iso < ((pw.date_iso::date + interval '1 day')").length - 1;
    expect(reignPredicateCount, 'the containment predicate appears once standalone and once inside the tiebreak CASE').toBe(2);
    expect(emitted).not.toMatch(/archived_iso, now\(\)\) > \(/); // no COALESCE-truncated upper bound on the reign itself
  });

  it('computes the boundary against explicit UTC, not the session timezone', () => {
    // A connection in any other timezone casting date_iso through its own
    // session offset would shift the calendar-day boundary and could flip
    // which plan's reign appears to contain a date near midnight. The
    // containment predicate appears twice (the DESC clause and inside the
    // tiebreak CASE), each with two UTC casts.
    expect(emitted.match(/AT TIME ZONE 'UTC'/g)?.length).toBe(4);
  });

  it('reign-containment is the FIRST ordering clause after the date', () => {
    const dateAt = orderBy.indexOf('pw.date_iso');
    const reignAt = orderBy.indexOf("tp.authored_iso <");
    expect(dateAt).toBeGreaterThan(-1);
    expect(reignAt).toBeGreaterThan(dateAt);
  });
});

describe('2 · among multiple reigns containing the same date, the most recently active wins', () => {
  it('breaks ties on COALESCE(archived_iso, now()) DESC, not authored_iso', () => {
    // Two ARCHIVED plans' reigns can both cover one date only in a brief
    // undo/re-archive overlap (`training_plans_active_uq` forbids two
    // simultaneously-active plans). Among those, "was active most recently"
    // — not "was authored most recently" — is the tiebreak, so a plan
    // authored earlier but active later still wins its own dates correctly.
    expect(emitted).toContain('CASE WHEN');
    expect(emitted).toContain('THEN COALESCE(tp.archived_iso, now()) END DESC NULLS LAST');
  });

  it('an always-active plan (archived_iso NULL → now()) outranks any past archived_iso', () => {
    // now() is always later than any recorded archived_iso, so this clause
    // alone reproduces "prefer the currently active plan" for the ordinary
    // case, without a separate first clause for it.
    const caseAt = orderBy.indexOf('CASE WHEN');
    expect(caseAt).toBeGreaterThan(-1);
    const reignAt = orderBy.indexOf("tp.authored_iso <");
    expect(caseAt).toBeGreaterThan(reignAt);
  });
});

describe('3 · no candidate reign contains the date → fall back to the pre-2026-09-01 ordering, not a guess', () => {
  it('the fallback clauses are present, verbatim, and come LAST', () => {
    // A genuine gap in plan-ownership history should not happen; when it
    // does, this falls back to the ordering that shipped 2026-08-25 rather
    // than inventing new behavior for a case nothing has verified.
    expect(orderBy).toContain('(tp.archived_iso IS NULL) DESC');
    expect(orderBy).toContain('tp.authored_iso DESC');
    const fallbackActiveAt = orderBy.indexOf('(tp.archived_iso IS NULL) DESC');
    const fallbackAuthoredAt = orderBy.lastIndexOf('tp.authored_iso DESC');
    const caseEndAt = orderBy.indexOf('END DESC NULLS LAST');
    expect(caseEndAt, 'the reign tiebreak must precede the fallback').toBeLessThan(fallbackActiveAt);
    expect(fallbackActiveAt, 'archived_iso IS NULL fallback precedes authored_iso fallback')
      .toBeLessThan(fallbackAuthoredAt);
  });

  it('does not filter on archived_iso — only orders by it (so archived history stays visible)', () => {
    const whereAt = emitted.indexOf('WHERE');
    const whereClause = emitted.slice(whereAt, orderByAt);
    expect(whereClause).not.toMatch(/archived_iso/);
  });
});

describe('4 · the reverted-ghost scenario this fix exists for', () => {
  it('a later-authored, 21-minute, reverted plan cannot outrank a 2.5-month plan once both are archived', () => {
    // This is the property, stated in the words of the actual incident. The
    // live falsifier (`_probe_owned_days_reign_2026-09-01.test.ts`) proves it
    // holds against the real account; this scan proves the SQL that
    // implements it is the SQL actually shipped, not just described in prose.
    expect(emitted).toContain('DISTINCT ON (pw.date_iso)');
    expect(orderBy.indexOf("tp.authored_iso <")).toBeLessThan(orderBy.lastIndexOf('tp.authored_iso DESC'));
  });
});
