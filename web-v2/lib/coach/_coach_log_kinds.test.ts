/**
 * lib/coach/_coach_log_kinds.test.ts — an internal receipt is not a coach-log
 * entry, and an unknown kind is never relabelled as a real one.
 *
 * THE ROW. `coach_intents` id 881 on the owner's account:
 *
 *     reason = 'coach_log_goal_answer'
 *     value  = {"action":"acknowledge"}
 *     ts     = 2026-08-26T04:08:14Z   (a Wednesday)
 *
 * It is the receipt of a button tap. It reached the runner-facing log because
 * `loadCoachLog` selects `reason LIKE 'coach_log_%'` and whoever named the
 * receipt reached for that prefix. Then four fallbacks fired in sequence:
 *
 *   · no `kind` in the value      → derived 'goal_answer' from the reason
 *   · 'goal_answer' not allowed   → SILENTLY COERCED to 'week_close'
 *   · no `dateISO`                → fell back to the row timestamp
 *   · no `body`                   → rendered ''
 *
 * Result on Races → THE LOG: an empty WEEK_CLOSE card dated Wednesday
 * 2026-08-26, a day that is not a week boundary, under a heading asserting a
 * week had closed. Every fallback did its job; the compound was a lie.
 *
 * The coercion is what made it invisible, so the coercion is what is tested.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');
const READER = path.join(ROOT, 'lib/coach/coach-log.ts');
const WRITER = path.join(ROOT, 'app/api/v5/goal-answer/route.ts');

/** The file with its comments stripped. The defect is being asserted absent
 *  from the CODE; the comments deliberately quote the old line to explain it,
 *  and a source scan that cannot tell those apart fails on its own docs. */
function codeOf(file: string): string {
  return fs.readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'))
    .join('\n');
}

describe('the reader excludes unknown kinds rather than renaming them', () => {
  const src = fs.readFileSync(READER, 'utf8');
  const code = codeOf(READER);

  it('no longer coerces an unrecognised kind to week_close', () => {
    // The exact shape of the defect: a ternary whose false branch is a real
    // kind. Any reappearance of "not in the list → call it something else".
    expect(code).not.toMatch(/\?\s*kind\s*:\s*'week_close'/);
    expect(code).not.toMatch(/:\s*'week_close',?\s*$/m);
  });

  it('skips the row instead', () => {
    expect(src).toMatch(/if\s*\(kind == null \|\| !PUBLISHED_KINDS\.has\(kind\)\)\s*continue;/);
  });

  it('does not publish an entry with an empty body', () => {
    // The visible symptom was a card with nothing in it. Even a KNOWN kind
    // carrying no body has no card to draw.
    expect(src).toMatch(/if\s*\(!body\.trim\(\)\)\s*continue;/);
  });

  it('derives its allowlist from REASON_OF_KIND rather than a hand-kept copy', () => {
    // The duplicate list had drifted: `REASON_OF_KIND` maps phase_boundary →
    // 'coach_log_phase' and first_ever → 'coach_log_first', so the old
    // `reason.replace(/^coach_log_/, '')` produced 'phase' and 'first' —
    // neither in the allowlist, both silently relabelled 'week_close'.
    expect(src).toMatch(/PUBLISHED_KINDS[\s\S]{0,200}Object\.keys\(REASON_OF_KIND\)/);
    expect(src).toMatch(/KIND_OF_REASON[\s\S]{0,200}Object\.entries\(REASON_OF_KIND\)/);
    // And the string surgery that got two of seven kinds wrong is gone.
    expect(code).not.toMatch(/r\.reason\.replace\(/);
  });
});

describe('the receipt no longer wears the log prefix', () => {
  const src = fs.readFileSync(WRITER, 'utf8');
  const code = codeOf(WRITER);

  it('goal-answer receipts are not written under coach_log_*', () => {
    expect(code).not.toMatch(/'coach_log_goal_answer'/);
    expect(src).toMatch(/GOAL_ANSWER_RECEIPT = 'goal_answer_receipt'/);
  });

  it('every writeIntent in the route stays clear of the log query', () => {
    // `loadCoachLog` selects `reason LIKE 'coach_log_%'`. Nothing this route
    // writes is a runner-facing log entry, so nothing it writes may match.
    const reasons = [...code.matchAll(/writeIntent\(\s*userId,\s*'([^']+)'/g)].map((m) => m[1]);
    for (const r of reasons) {
      expect(r, `${r} would be selected by loadCoachLog`).not.toMatch(/^coach_log_/);
    }
  });
});

describe('the reader still publishes every legitimate kind', () => {
  const src = fs.readFileSync(READER, 'utf8');

  it('all seven authored kinds plus fitness_shift remain publishable', () => {
    for (const kind of [
      'week_close', 'phase_boundary', 'first_ever', 'easy_discipline',
      'fitness_evidence', 'threshold_pattern', 'race_replacement',
    ]) {
      expect(src, `${kind} missing from REASON_OF_KIND`).toMatch(new RegExp(`${kind}: 'coach_log_`));
    }
    expect(src).toMatch(/PUBLISHED_KINDS[\s\S]{0,240}'fitness_shift'/);
  });
});
