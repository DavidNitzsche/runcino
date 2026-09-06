/**
 * lib/coaching-contract/_neutral_contract.test.ts · THE LEAF PROPERTY, GATED.
 *
 * The whole resolution of the folder-boundary problem rests on ONE claim:
 * `move-readjudication.ts` imports nothing, so a mover that holds a
 * `Readjudicator` acquires no reachability into the adaptation engine.
 *
 * Rule 19's corollary is exactly about this shape. `lthr-reanchor.ts` asserted
 * in its own header that it "imports no database at any depth"; it was false,
 * it was false for a day, and no check could tell. A header comment asserting
 * an invariant is documentation. This is the check.
 *
 * ── WHAT THIS GATE CANNOT FAIL ON  (Rule 22) ───────────────────────────────
 *
 * · **A dependency acquired at run time.** It reads source text for import,
 *   `require` and dynamic-`import` specifiers. A module fetched through a
 *   string built at run time, or reached through `globalThis`, is invisible to
 *   it. Nothing in this directory does that today and the "no specifiers at
 *   all" assertion is what keeps it that way — there is nothing to hide behind.
 * · **Whether the nine checks are the RIGHT nine.** They are the owner's list,
 *   transcribed. This asserts only that the union, the constant array and the
 *   report's key set agree with each other.
 * · **An implementation that lies.** A `Readjudicator` can return a report full
 *   of `state: 'ran', findings: []` without reading anything. That claim is
 *   `_move_readjudication.test.ts`'s to police, not this file's.
 * · **A mover that never asks for a report.** Also that file's, in the census.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  READJUDICATION_CHECKS,
  affectedWeeks,
  verdictOf,
  allFindings,
  findingsOf,
  checksThatCouldNotRun,
  noAdjudicatorReport,
  type CheckOutcome,
  type ReadjudicationCheck,
  type ReadjudicationReport,
} from './move-readjudication';

const WEB = path.resolve(__dirname, '..', '..');
const CONTRACT = path.join(WEB, 'lib/coaching-contract/move-readjudication.ts');

/** Static `from '…'`, dynamic `import('…')` and `require('…')`. All are edges. */
function specifiersIn(src: string): string[] {
  const out: string[] = [];
  for (const re of [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) out.push(m[1]);
  }
  return out;
}

const move = { planWorkoutId: 'w1', fromISO: '2026-09-12', toISO: '2026-09-14', optionId: null };
const weeks = affectedWeeks('2026-09-07', '2026-09-14');

function reportWith(overrides: Partial<Record<ReadjudicationCheck, CheckOutcome>>): ReadjudicationReport {
  const checks = {} as Record<ReadjudicationCheck, CheckOutcome>;
  for (const c of READJUDICATION_CHECKS) {
    checks[c] = overrides[c] ?? { state: 'ran', findings: [], read: 'nothing to say' };
  }
  return {
    move, weeks, checks, betterDate: null,
    planId: 'plan_1', planVersion: 'plan_1:none', asOfISO: '2026-09-12',
  };
}

describe('the neutral contract is a leaf', () => {
  it('liveness · the file was read and it is not empty', () => {
    expect(fs.existsSync(CONTRACT)).toBe(true);
    const src = fs.readFileSync(CONTRACT, 'utf8');
    expect(src.length).toBeGreaterThan(2000);
  });

  it('it imports NOTHING · zero specifiers of any kind', () => {
    const src = fs.readFileSync(CONTRACT, 'utf8');
    // Comments carry module PATHS in prose ("lib/plan/reschedule.ts may import
    // it"), which is exactly the explanation that must not be what trips the
    // check. Strip them, like `_reschedule_not_adaptation.test.ts` does.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(specifiersIn(code), 'the neutral contract acquired a dependency').toEqual([]);
  });

  it('ORACLE · the specifier patterns actually match when there is something to find', () => {
    // Rule 18 · a scanner that matches nothing must not report clean because
    // its pattern broke. Falsify the reader itself, not just the file.
    expect(specifiersIn(`import x from '@/lib/adaptation/canonical/evaluate';`))
      .toEqual(['@/lib/adaptation/canonical/evaluate']);
    expect(specifiersIn(`const m = await import('@/lib/db/pool');`)).toEqual(['@/lib/db/pool']);
    expect(specifiersIn(`const p = require('pg');`)).toEqual(['pg']);
  });
});

describe('the nine checks are a closed, total set', () => {
  it('there are nine, and the constant array has no duplicates', () => {
    expect(READJUDICATION_CHECKS).toHaveLength(9);
    expect(new Set(READJUDICATION_CHECKS).size).toBe(9);
  });

  it('a report is total over them · every check has an outcome', () => {
    const r = reportWith({});
    for (const c of READJUDICATION_CHECKS) expect(r.checks[c]).toBeDefined();
    expect(Object.keys(r.checks).sort()).toEqual([...READJUDICATION_CHECKS].sort());
  });

  it('the owner\'s nine requirements each have a member', () => {
    // Named literally rather than counted, so a rename that keeps the count at
    // nine still fails. The list is his, in his order.
    expect([...READJUDICATION_CHECKS]).toEqual([
      'BOTH_WEEKS',
      'DEMAND',
      'HARD_SESSION_SPACING',
      'LONG_RUN_PLACEMENT',
      'RACE_RECOVERY_TAPER_PROXIMITY',
      'CONDITIONAL_DOSES',
      'SCHEDULED_GATES',
      'DEFERRALS',
      'CONFLICTS',
    ]);
  });
});

describe('the verdict is derived, and INCOMPLETE is never CLEAR', () => {
  it('nothing to say · CLEAR', () => {
    expect(verdictOf(reportWith({}))).toBe('CLEAR');
  });

  it('a COSTS finding · COSTED, not CLEAR', () => {
    expect(verdictOf(reportWith({
      DEMAND: {
        state: 'ran',
        findings: [{
          check: 'DEMAND', severity: 'COSTS', what: 'the week gets heavier',
          onISO: '2026-09-14', magnitude: 3.2, citation: 'plan-load.ts',
        }],
        read: 'priced',
      },
    }))).toBe('COSTED');
  });

  it('a REFUSES finding · REFUSED', () => {
    expect(verdictOf(reportWith({
      HARD_SESSION_SPACING: {
        state: 'ran',
        findings: [{
          check: 'HARD_SESSION_SPACING', severity: 'REFUSES', what: 'back to back',
          onISO: '2026-09-14', magnitude: null, citation: 'validate.ts §9',
        }],
        read: 'read',
      },
    }))).toBe('REFUSED');
  });

  it('THE LOAD-BEARING ONE · a check that could not run is INCOMPLETE, never CLEAR', () => {
    const r = reportWith({ DEFERRALS: { state: 'refused', why: 'migration 167 is not applied here' } });
    expect(verdictOf(r)).toBe('INCOMPLETE');
    expect(checksThatCouldNotRun(r)).toEqual([
      { check: 'DEFERRALS', why: 'migration 167 is not applied here' },
    ]);
  });

  it('a refusal outranks an incomplete read · the runner needs the blocking reason', () => {
    expect(verdictOf(reportWith({
      DEFERRALS: { state: 'refused', why: 'no table' },
      CONFLICTS: {
        state: 'ran',
        findings: [{
          check: 'CONFLICTS', severity: 'REFUSES', what: 'that date is a race day',
          onISO: '2026-09-14', magnitude: null, citation: 'dateVerdict',
        }],
        read: 'read',
      },
    }))).toBe('REFUSED');
  });

  it('not_applicable is not a refusal and is not a finding', () => {
    const r = reportWith({ LONG_RUN_PLACEMENT: { state: 'not_applicable', why: 'the session is an easy run' } });
    expect(verdictOf(r)).toBe('CLEAR');
    expect(checksThatCouldNotRun(r)).toEqual([]);
    expect(findingsOf(r.checks.LONG_RUN_PLACEMENT)).toEqual([]);
  });

  it('a report with no adjudicator refuses on all nine · nobody-looked is not clean', () => {
    const r = noAdjudicatorReport(move, weeks, 'p', 'p:none', '2026-09-12', 'no adjudicator was supplied');
    expect(verdictOf(r)).toBe('INCOMPLETE');
    expect(checksThatCouldNotRun(r)).toHaveLength(9);
    expect(allFindings(r)).toEqual([]);
  });
});

describe('affectedWeeks derives crossing rather than accepting it', () => {
  it('two different weeks cross', () => {
    expect(affectedWeeks('2026-09-07', '2026-09-14').crossesWeekBoundary).toBe(true);
  });
  it('one week does not, and BOTH fields are still reported', () => {
    const w = affectedWeeks('2026-09-07', '2026-09-07');
    expect(w.crossesWeekBoundary).toBe(false);
    expect(w.fromWeekStartISO).toBe('2026-09-07');
    expect(w.toWeekStartISO).toBe('2026-09-07');
  });
});

describe('both sides of the boundary speak this contract', () => {

  it('the orchestrator implements it', () => {
    const src = fs.readFileSync(path.join(WEB, 'lib/brain/orchestration/move-orchestrator.ts'), 'utf8');
    expect(src).toContain("from '@/lib/coaching-contract/move-readjudication'");
    expect(src).toMatch(/Readjudicator/);
  });

  it('the contract sits in a directory neither lib/plan nor lib/adaptation owns', () => {
    expect(CONTRACT.includes(`${path.sep}lib${path.sep}coaching-contract${path.sep}`)).toBe(true);
    expect(CONTRACT.includes(`${path.sep}lib${path.sep}plan${path.sep}`)).toBe(false);
    expect(CONTRACT.includes(`${path.sep}lib${path.sep}adaptation${path.sep}`)).toBe(false);
  });
});
