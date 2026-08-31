/**
 * lib/plan/_missed_dedup_durable.test.ts · REBUILD-DEDUP-1
 *
 * "The adapter has already answered for this missed session" must survive a
 * plan rebuild, because in this app a rebuild is the normal case rather than
 * the exception.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE DEFECT, MEASURED ON PRODUCTION ROWS (2026-08-30)
 *
 * The dedup keyed on `ci.field = pw.id`. `plan_workouts.id` is
 * `wko_<randomBytes(8)>`, re-minted on every persist, and nothing carries an id
 * across a rebuild — no id in the owner's 3,918 rows appears on more than one
 * `plan_id`.
 *
 * His missed long of 2026-08-02 was handled once (`plan_adapt_missed_noted`,
 * `field = wko_6bd64043882cb9c8`). FORTY plan versions carry a `long` on that
 * date. The id-only predicate recognises ONE of the forty — the generation that
 * happened to be live when the intent was written. Every rebuild since made
 * that handled miss invisible again, so the next pass could re-note it, or
 * re-drop it, or reschedule a session already dropped.
 *
 * With `47` plan versions in three months, that is not an edge case. On the
 * first morning of a fourteen-week block it reads as a plan the runner does not
 * recognise, which is the failure he has been most explicit about.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT THIS GATE HOLDS
 *
 * Two things, and the second is the one that rots:
 *
 *  1. The predicate matches on the AUTHORED DATE as well as the row id — the
 *     durable key the rest of the app already uses to marry a run to a
 *     prescription (`app/api/plan/undo/route.ts`: "matched to a prescription BY
 *     CALENDAR DATE, at read time, every time").
 *  2. Every call site goes through the ONE helper. A behavioural test cannot
 *     catch a third query that hand-rolls the predicate and gets it wrong, which
 *     is exactly how the second site drifted from the first (Rule 16, and the
 *     same source-scan shape `race-projection` uses).
 *
 * Falsified before landing: restoring `ci.field = pw.id` as the only clause
 * turns the date-clause cases red, and re-inlining either call site turns the
 * source scan red.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { MISSED_HANDLED_REASONS, missedAlreadyHandledSql } from './adapt';

const ADAPT = path.join(process.cwd(), 'lib/plan/adapt.ts');

/** Comment- and string-free enough to ask structural questions of. */
function sourceOfAdapt(): string {
  const src = fs.readFileSync(ADAPT, 'utf8');
  expect(src.length, 'adapt.ts read as empty · the scan would pass on nothing').toBeGreaterThan(10_000);
  return src;
}

describe('REBUILD-DEDUP-1 · a handled miss stays handled across a rebuild', () => {
  it('the predicate still matches on the row id · no existing dedup weakens', () => {
    // Intents written before this change carry no `planned_date` on the
    // reschedule path. Within one plan generation the id match is still exactly
    // right, so it stays.
    expect(missedAlreadyHandledSql(1)).toContain('ci.field = pw.id');
  });

  it('the predicate ALSO matches on the authored date · this is the fix', () => {
    const sql = missedAlreadyHandledSql(1);
    expect(sql).toContain("ci.value::jsonb->>'planned_date'");
    // The AUTHORED date, not the current one: a rescheduled row has already
    // moved, and the intent records where the session was originally asked for.
    // Same field `isStaleMissed` treats as the session's identity.
    expect(sql).toContain('COALESCE(pw.original_date_iso, pw.date_iso)');
  });

  it('the jsonb cast is guarded · coach_intents.value is TEXT and not always JSON', () => {
    const sql = missedAlreadyHandledSql(1);
    // A bare `AND` does not guarantee evaluation order in Postgres, so the
    // shape check has to be a CASE. An unguarded cast can throw on a row this
    // predicate was never about.
    expect(sql).toContain("CASE WHEN ci.value LIKE '{%'");
    expect(sql.indexOf("CASE WHEN ci.value LIKE '{%'"))
      .toBeLessThan(sql.indexOf("ci.value::jsonb->>'planned_date'"));
  });

  it('every handled-reason is in the predicate, read from the shared list', () => {
    // Read out of the constant rather than restated, so a new reason cannot be
    // added to one and forgotten in the other.
    expect(MISSED_HANDLED_REASONS.length).toBeGreaterThanOrEqual(4);
    const sql = missedAlreadyHandledSql(1);
    for (const reason of MISSED_HANDLED_REASONS) {
      expect(sql, `${reason} missing from the predicate`).toContain(`'${reason}'`);
    }
  });

  it('the user placeholder and the alias are both honoured', () => {
    expect(missedAlreadyHandledSql(3)).toContain('$3::uuid');
    const aliased = missedAlreadyHandledSql(1, 'x');
    expect(aliased).toContain('ci.field = x.id');
    expect(aliased).toContain('COALESCE(x.original_date_iso, x.date_iso)');
    expect(aliased).not.toContain('pw.');
  });

  it('NO call site hand-rolls the predicate · one definition, Rule 16', () => {
    const src = sourceOfAdapt();
    // The shape the two sites used to carry, in either spelling. Whitespace is
    // collapsed so a reformat cannot smuggle one past.
    const flat = src.replace(/\s+/g, ' ');
    const handRolled = flat.match(/ci\.field = pw\.id AND ci\.reason/g) ?? [];
    expect(
      handRolled,
      'a query compares ci.field to a plan_workouts id directly. That key is '
      + 're-minted on every rebuild — call missedAlreadyHandledSql() instead.',
    ).toEqual([]);
  });

  it('both known call sites actually invoke the helper', () => {
    const src = sourceOfAdapt();
    const calls = src.match(/missedAlreadyHandledSql\(/g) ?? [];
    // Two consumers today: detectMissedKeyWorkout's candidate query and the
    // anti-stacking probe. The floor is a liveness assertion — a scan that
    // matched nothing would otherwise report clean.
    expect(calls.length, 'the helper is defined but nothing calls it').toBeGreaterThanOrEqual(3);
  });

  it('the reschedule intent records planned_date, or the date clause is decorative', () => {
    const src = sourceOfAdapt().replace(/\s+/g, ' ');
    // The RETURNING that feeds it, and the field it writes. Without both, new
    // reschedule intents carry no date and only the id clause can ever match.
    expect(src).toContain('RETURNING COALESCE(pw.original_date_iso, pw.date_iso)::date::text AS planned_date');
    expect(src).toMatch(/planned_date: moved\.rows\?\.\[0\]\?\.planned_date/);
  });
});
