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

describe('plan_workouts.date_iso is text — cast both sides or neither', () => {
  const files = [...walk(join(ROOT, 'lib')), ...walk(join(ROOT, 'app'))]
    // This file quotes the broken shapes on purpose.
    .filter((f) => !f.endsWith('_plan_date_join_lint.test.ts'));

  it('never compares an uncast date_iso against a date/timestamp expression', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const flat = flatten(readFileSync(file, 'utf8'));
      for (const re of [UNCAST_RIGHT, UNCAST_LEFT]) {
        re.lastIndex = 0;
        for (const m of flat.matchAll(re)) {
          offenders.push(`${file.slice(ROOT.length + 1)} · ${m[0].trim()}`);
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
