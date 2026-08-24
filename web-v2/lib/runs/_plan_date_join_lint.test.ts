/**
 * lib/runs/_plan_date_join_lint.test.ts · `plan_workouts.date_iso` is TEXT.
 *
 * THE BUG THIS CATCHES. `plan_workouts.date_iso` is a `text` column holding a
 * `YYYY-MM-DD` day key. A run's day key is also text — `data->>'date'`. Compare
 * the two as text and Postgres is happy. Cast ONE side to `date` and it is not:
 *
 *     ERROR:  operator does not exist: date = text
 *     ERROR:  operator does not exist: text >= timestamp without time zone
 *
 * Two shipped queries had exactly that, and both wrapped the call in
 * `.catch(() => empty)`, so the error never reached a log. Each returned its
 * empty fallback on every run, for every runner, since it was written:
 *
 *   · `lib/plan/drift-monitor.ts` · the 21-day pace-drift read over completed
 *     quality sessions. Zero rows, always — so the pace axis of the drift
 *     monitor had never once fired. Against the AFC block on 2026-07-15 the
 *     same query with the casts returns 11 real sessions.
 *   · `lib/coach/runner-calibration.ts` · the completed-workout count that
 *     decides `data_quality`. Always 0, so `data_quality` was pinned at
 *     `'cold-start'` and the `>= 3 → 'building'` / `>= 8 → 'calibrated'` gate
 *     could never open. The same count with the casts is 7.
 *
 * A swallowed type error looks exactly like an honest empty result. This lint
 * is the thing that can tell them apart without a database.
 *
 * THE RULE. Wherever `date_iso` meets a `date`/`timestamp` expression, cast
 * `date_iso` too. Text-to-text comparisons are fine and are not flagged.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** Strip line + block comments, then flatten to one line so a multi-line SQL
 *  template reads as a single string. A multi-line query defeats a per-line
 *  scan — which is how both of these survived every earlier grep. */
function flatten(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1 ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\s+/g, ' ');
}

/** `<something>::date = pw.date_iso` — the right side left as text. */
const UNCAST_RIGHT = /::\s*(?:date|timestamp\w*)\s*=\s*(?:[a-z_]+\.)?date_iso\b(?!\s*::)/gi;

/** `pw.date_iso >= $1::date` — the left side left as text. */
const UNCAST_LEFT =
  /(?:[a-z_]+\.)?date_iso\b(?!\s*::)\s*(?:>=|<=|<>|<|>|=)\s*\$\d+\s*::\s*(?:date|timestamp\w*)/gi;

/**
 * `date_iso BETWEEN $2::date AND $3::date` — the same bug, in the one syntax
 * the two patterns above cannot see.
 *
 * 2026-08-24 · `lib/plan/week-loader.ts` had exactly this against
 * `day_actions.date_iso`, which is a TEXT day key like the `plan_workouts` one.
 * `operator does not exist: text >= date`, on every week the runner has ever
 * loaded, inside a bare `catch {}` — so the week strip has never once drawn a
 * skip marker. Ten real skip rows sat in prod, two of them inside a single
 * seven-day window, all invisible.
 *
 * The lint above was written for this exact bug class three files earlier and
 * did not catch it, because `BETWEEN` spells the comparison with a keyword
 * instead of an operator. A pattern that only knows one spelling of a
 * comparison is a pattern that will keep missing the other one.
 *
 * Deliberately NOT limited to `plan_workouts` — `date_iso` is a text day key on
 * every table that has one.
 */
const UNCAST_BETWEEN =
  /(?:[a-z_]+\.)?date_iso\b(?!\s*::)\s+BETWEEN\b[^;]{0,120}?::\s*(?:date|timestamp\w*)/gi;

describe('plan_workouts.date_iso is text — cast both sides or neither', () => {
  /**
   * A file may opt out by containing this marker, verbatim.
   *
   * Only two things legitimately quote the broken SQL: this lint's own
   * fixtures, and a regression test asserting that a specific shipped query no
   * longer looks that way. Both need to write the bug down to be about it.
   *
   * A marker rather than a filename list, because a list is a thing you edit to
   * make a failure go away, and a marker is a thing you have to paste INTO the
   * file that is quoting the bug — where the next reader will see it, next to
   * the quote, and can check the claim.
   */
  const OPT_OUT = 'date_iso-lint: quotes the broken shape on purpose';

  const files = [...walk(join(ROOT, 'lib')), ...walk(join(ROOT, 'app'))]
    // This file quotes the broken shapes on purpose.
    .filter((f) => !f.endsWith('_plan_date_join_lint.test.ts'))
    .filter((f) => !readFileSync(f, 'utf8').includes(OPT_OUT));

  it('never compares an uncast date_iso against a date/timestamp expression', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const flat = flatten(readFileSync(file, 'utf8'));
      for (const re of [UNCAST_RIGHT, UNCAST_LEFT, UNCAST_BETWEEN]) {
        re.lastIndex = 0;
        for (const m of flat.matchAll(re)) {
          offenders.push(`${file.slice(ROOT.length + 1)} · ${m[0].trim()}`);
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  /**
   * The lint's own positive controls.
   *
   * A pattern that has stopped matching looks exactly like a codebase with no
   * violations, which is the same shape as the bug this whole file is about.
   * These fixtures are the shipped text of the three real defects, so a
   * regression in any pattern fails here rather than going quiet.
   */
  it('catches every shipped spelling of the bug', () => {
    const cases: Array<[string, RegExp]> = [
      // lib/coach/runner-calibration.ts, as shipped before 2026-08-24.
      [`AND (r.data->>'date')::date = pw.date_iso`, UNCAST_RIGHT],
      [`AND pw.date_iso >= $2::date - 14`, UNCAST_LEFT],
      // lib/plan/week-loader.ts, as shipped before 2026-08-24.
      [`AND date_iso BETWEEN $2::date AND $3::date`, UNCAST_BETWEEN],
    ];
    for (const [sql, re] of cases) {
      re.lastIndex = 0;
      expect(re.test(flatten(sql)), `pattern stopped matching: ${sql}`).toBe(true);
    }
  });

  it('leaves a correctly cast comparison alone', () => {
    const fine = [
      `AND (r.data->>'date')::date = pw.date_iso::date`,
      `AND pw.date_iso::date >= $2::date - 14`,
      `AND date_iso::date BETWEEN $2::date AND $3::date`,
      // Text-to-text is correct and must not be flagged — `YYYY-MM-DD` sorts
      // lexicographically, which is why these were written this way.
      `AND pw.date_iso = ($2::date + 1)::text`,
      `AND pw.date_iso < ($3::date + $2::int)::text`,
    ];
    for (const sql of fine) {
      for (const re of [UNCAST_RIGHT, UNCAST_LEFT, UNCAST_BETWEEN]) {
        re.lastIndex = 0;
        expect(re.test(flatten(sql)), `false positive on: ${sql}`).toBe(false);
      }
    }
  });
});
