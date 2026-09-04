/**
 * lib/plan/_midblock_signal2_source_gate.test.ts · EXECUTION-IDENTITY-1
 * (2026-09-03).
 *
 * `detectMidBlock`'s signal 2 counts runs "tagged" quality to decide whether
 * a runner reads as mid-block. Found live, same account this whole fix
 * traces to: a friend's unrelated 4.48mi easy run carried
 * `workoutType: 'intervals'` / `workoutTypeSource: 'plan'`, stamped by
 * `/api/ingest/workout`'s own passive date+distance heuristic — nothing to
 * do with whether it was a real quality effort. Before this fix that alone
 * was enough to count toward "has this runner been doing quality" — the
 * exact class of misattribution `lib/execution/day-resolver.ts`'s LEGACY
 * tier already refuses for completion/grading, now closed here too.
 *
 * `detectMidBlock` is private (does real `pool.query` calls, not exported)
 * and the ONE existing test on this function
 * (`lib/audit/_swallowed_failure_fixes.test.ts`) already verifies it by
 * source text rather than execution — same posture kept here, falsified per
 * Rule 18: this assertion fails against the pre-fix source (confirmed by
 * temporarily reverting the guard and re-running before landing this test).
 *
 * The real, both-directions proof — not a source-text stand-in for it — was
 * run directly against David's own production account (Rule 13): the
 * friend's actual row (`id -166065474720154`, `workoutType: 'intervals'`,
 * `workoutTypeSource: 'plan'`, `source: 'apple_watch'`) matched the OLD
 * predicate and does not match the NEW one; the real treadmill session that
 * date (`id -240375143823562`, `source: 'treadmill'`, live-tracked) matches
 * both — the fix excludes exactly the misattributed row and nothing else.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'generate.ts'), 'utf8');

function signal2Sql(src: string): string {
  const marker = "Signal 2 · runs with a quality-effort tag";
  const start = src.indexOf(marker);
  expect(start, 'signal 2 comment block not found — has it moved or been renamed?').toBeGreaterThan(-1);
  const queryStart = src.indexOf('SELECT COUNT(*)::text', start);
  const queryEnd = src.indexOf('logReadFailure', queryStart);
  expect(queryStart, 'signal 2 SQL not found after its comment block').toBeGreaterThan(-1);
  return src.slice(queryStart, queryEnd);
}

describe('EXECUTION-IDENTITY-1 · detectMidBlock signal 2 does not trust a passive sync\'s type stamp alone', () => {
  it('the workoutType arm is gated on a live-tracked source', () => {
    const sql = signal2Sql(SRC);
    // The OR-arm reading workoutType must be a nested clause requiring
    // source IN ('watch','treadmill','phone') — not a bare, ungated read.
    expect(sql).toMatch(/workoutType[\s\S]*~[\s\S]*AND\s+LOWER\(COALESCE\(r\.data->>'source'/);
    expect(sql).toContain("IN ('watch','treadmill','phone')");
  });

  it('the self-reported data->>\'type\' arm is untouched — a hand-logged tempo still counts', () => {
    const sql = signal2Sql(SRC);
    expect(sql).toMatch(/data->>'type'.*IN \('tempo','threshold','intervals','vo2max','race'\)/);
  });
});
