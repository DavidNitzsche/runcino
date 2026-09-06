/**
 * lib/ops/_reassessment_evaluators.test.ts · WITHOUT A DATABASE.
 *
 * Behavioural proof (does the evaluator actually resolve the right way given
 * real rows) lives in `_reassessment_evaluators.db.test.ts`, which skips
 * loudly rather than reporting clean when no scratch database is reachable.
 * This file proves the things that do not need one: every kind this
 * dispatcher is responsible for is accounted for, and the FAILED_EVALUATION
 * decision this module makes concrete is actually held to, repo-wide, not
 * just inside this one file.
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ────────────────────────────────
 *
 * · WHETHER EITHER EVALUATOR'S DECISION IS RIGHT for a given row's data —
 *   that needs a real table and real evidence, and is the `.db.test.ts`
 *   file's job.
 * · WHETHER `reassessment-sweep.yml` OR THE CRON-LEDGER ENTRY ACTUALLY FIRE.
 *   `_automatic_mutations.test.ts` GUARD 2/3 and `_generated_content_gate
 *   .test.ts` GUARD 6 already check registration and workflow existence;
 *   this file does not re-derive those.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { REASSESSMENT_KINDS, type ReassessmentKind } from './reassessment-scheduler';
import { OWNED_ELSEWHERE } from './reassessment-evaluators';

const ROOT = path.join(__dirname, '../..'); // web-v2/

describe('liveness · every file this suite reasons about was actually read', () => {
  it('the evaluator module and the dispatch route both exist', () => {
    expect(readFileSync(path.join(__dirname, 'reassessment-evaluators.ts'), 'utf8').length).toBeGreaterThan(1000);
    expect(
      readFileSync(path.join(ROOT, 'app/api/cron/reassessment-sweep/route.ts'), 'utf8').length,
    ).toBeGreaterThan(500);
  });
});

describe('EVALCOVER-1 · every reassessment kind is either evaluated here or named as owned elsewhere', () => {
  const EVALUATED_HERE: readonly ReassessmentKind[] = ['POST_RACE_RECOVERY_CHECK', 'RETURN_TO_TRAINING_STAGE'];

  it('the two kinds this dispatcher evaluates are not ALSO in OWNED_ELSEWHERE', () => {
    for (const k of EVALUATED_HERE) {
      expect(OWNED_ELSEWHERE.has(k), `${k} cannot be both evaluated here and owned elsewhere`).toBe(false);
    }
  });

  it('every kind the CHECK constraint allows is accounted for by exactly one of the two sets', () => {
    const accounted = new Set<string>([...EVALUATED_HERE, ...OWNED_ELSEWHERE]);
    const missing = REASSESSMENT_KINDS.filter((k) => !accounted.has(k));
    expect(
      missing,
      'A kind is neither evaluated by this dispatcher nor named as owned elsewhere — it would '
      + 'silently fall through runReassessmentEvaluationSweep\'s loop with no counter incrementing '
      + 'and no problem logged. Add it to one set or the other.',
    ).toEqual([]);
    // And the reverse: nothing claims BOTH.
    expect(accounted.size).toBe(EVALUATED_HERE.length + OWNED_ELSEWHERE.size);
  });
});

/**
 * FAILEDEVAL-DECISION-1 · this module's own FAILED_EVALUATION ruling, held to
 * repo-wide rather than trusted from memory.
 *
 * `_reassessment_scheduler.test.ts`'s `NO_CALLER_YET.FAILED_EVALUATION`
 * argues the kind should never be constructed, because the real retry state
 * lives on the failing item's OWN kind via `recordAssessmentFailure`. This
 * evaluator module is the first real consumer that could have made that
 * argument false by inventing a caller for convenience; this scan proves it
 * did not, using the SAME extraction technique `_reassessment_scheduler
 * .test.ts`'s COVERAGE-1 already uses (a literal `kind: 'X'` within 400
 * characters of a `scheduleReassessment(` call), run across the whole
 * production tree, not just this file — so a caller added anywhere else in a
 * future session is caught by the same assertion.
 *
 * FALSIFIED while writing this file: temporarily adding
 * `scheduleReassessment({ kind: 'FAILED_EVALUATION', ... })` to
 * `reassessment-evaluators.ts` made this test fail, naming the file; removing
 * it again restored green.
 */
describe('FAILED_EVALUATION_STAYS_UNUSED · no production caller ever constructs this kind', () => {
  function walk(dir: string, out: string[]): void {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      const full = path.join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) { walk(full, out); continue; }
      if (!entry.endsWith('.ts') && !entry.endsWith('.tsx')) continue;
      if (entry.includes('.test.')) continue;
      out.push(full);
    }
  }

  const files: string[] = [];
  walk(path.join(ROOT, 'app'), files);
  walk(path.join(ROOT, 'lib'), files);

  it('liveness · the scan actually read a non-trivial number of files', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it('grepping every scheduleReassessment( call in the production tree finds no FAILED_EVALUATION', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      if (!src.includes('scheduleReassessment(')) continue;
      for (const m of src.matchAll(/scheduleReassessment\(\{[\s\S]{0,400}?kind:\s*'([A-Z_]+)'/g)) {
        if (m[1] === 'FAILED_EVALUATION') offenders.push(path.relative(ROOT, f));
      }
    }
    expect(
      offenders,
      'A caller constructs kind: \'FAILED_EVALUATION\'. Either this is a real, argued exception to '
      + 'the NO_CALLER_YET ruling in _reassessment_scheduler.test.ts (update that entry to say so) '
      + 'or this is exactly the "decoration" caller that ruling warns against — remove it and use '
      + 'recordAssessmentFailure on the item\'s OWN kind instead.',
    ).toEqual([]);
  });

  it('the retry machinery this decision relies on is real, not aspirational', () => {
    const src = readFileSync(path.join(__dirname, 'reassessment-evaluators.ts'), 'utf8');
    expect(src.includes('recordAssessmentFailure(')).toBe(true);
    expect(src.includes("kind: 'FAILED_EVALUATION'")).toBe(false);
  });
});
