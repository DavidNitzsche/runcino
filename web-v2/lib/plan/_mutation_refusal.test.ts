/**
 * lib/plan/_mutation_refusal.test.ts · CALLERHONESTY-1 (2026-09-13)
 * CLAUDE.md Rule 11 (three facts, never one) and Rule 16 (one quantity, one
 * name), pointed at the LAST hop — the sentence the runner actually reads.
 *
 * ── THE BUG THIS FALSIFIES ──────────────────────────────────────────────────
 *
 * `mutatePlan` refuses for four separately-reasoned causes. Every caller
 * answered all four identically:
 *
 *     route handlers   { error: 'plan_invariant_violation', violations }  409
 *     replan-scenarios "That change would break the plan's own rules, so it
 *                       was not made."                     ← a string literal
 *     reschedule       "That move would break the plan. Nothing was changed."
 *                       ← keyed on `violations.length`, which every refusal
 *                         populates, so it was effectively unconditional too
 *
 * On a `plan_verification_failed` — a database read that THREW — the runner is
 * told his change conflicts with the plan's coaching rules. That is not a
 * vaguer version of the truth, it is a different and false statement, and it
 * is the one that costs him the fix: a rule conflict is not worth retrying and
 * a failed read is nothing but worth retrying.
 *
 * `lib/plan/_move_ledger_absent.db.test.ts` had already found the
 * `ledger_unwritten` instance and written FOUND-BUT-NOT-FIXED into its own
 * comments, asserting on `violations[0]` because the sentence could not be
 * trusted. This is the fix for the whole class.
 *
 * ── WHAT IS FALSIFIED, AND HOW ──────────────────────────────────────────────
 *
 * 1 · BEHAVIOUR. `refusalFor` is given each outcome and must produce a
 *     DISTINCT code, status and sentence. The specific assertions that would
 *     have failed against the old code: `plan_verification_failed` must not
 *     say "break", must not be 409, and must be marked retryable.
 * 2 · SOURCE. A behavioural test cannot see a caller that stops calling the
 *     shared resolver — Rule 16 names exactly this gap and says to assert it
 *     directly. Each caller is read and must (a) reach `refusalFor` and (b) no
 *     longer carry the literal it used to hardcode.
 *
 * Both were run against the pre-fix tree first: assertion set 1 fails on the
 * old code by construction (there was no `refusalFor` to import), and
 * assertion set 2 was confirmed to fail by restoring each literal in turn.
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ─────────────────────────────────
 *
 * · A NEW caller of `mutatePlan` that invents its own mapping. The scan below
 *   is a fixed list, not a discovery pass, so it is a ratchet against
 *   regression in the known callers and NOT a guarantee about future ones.
 *   `_mutation_boundary.test.ts` is the file that discovers writers; a
 *   discovery pass for REFUSAL MAPPINGS does not exist and is named here as
 *   the gap rather than implied to be covered.
 * · Whether the phone RENDERS the distinction. `APIV5.swift`'s
 *   `V5PlanChangeRefusal.isRefusal` splits refusal-vs-failure on the code, and
 *   the new codes land on the failure side (Retry offered), which is correct
 *   for the retryable ones. That is asserted here as a contract on the code
 *   strings only. Rule 13 verification on the device is not this file's claim.
 * · Anything about whether the OUTCOME itself is right. This file only checks
 *   that a given outcome is described honestly, never that the boundary chose
 *   the right outcome — that is the db suite next door.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { refusalFor, refusalBody, type MutationRefusalCode } from './mutation-refusal';

const REPO = join(__dirname, '..', '..');

/** The literal sentence the old code printed for every outcome. */
const THE_OLD_LIE = "would break the plan";

describe('CALLERHONESTY-1 · one outcome, one honest sentence', () => {
  it('a doctrine rejection keeps the sentence it always had · it was correct for THIS case', () => {
    const r = refusalFor({ outcome: 'rejected', violations: ['week has no quality'] }, { thing: 'That change' });
    expect(r.code).toBe<MutationRefusalCode>('plan_invariant_violation');
    expect(r.status).toBe(409);
    expect(r.reason).toContain(THE_OLD_LIE);
    expect(r.retryable, 'a rule conflict does not resolve itself on a retry').toBe(false);
    expect(r.violations).toEqual(['week has no quality']);
  });

  it(
    'THE FIX · a failed verification read is NOT described as a rule conflict, is NOT 409, '
    + 'and IS marked retryable — the three things the old generic body got wrong at once',
    () => {
      const r = refusalFor(
        { outcome: 'plan_verification_failed', violations: ['could not verify whether the requested plan_id is archived'] },
        { thing: 'That move' },
      );
      expect(r.code).toBe<MutationRefusalCode>('plan_verification_failed');
      expect(
        r.reason,
        'the runner must not be told his change breaks the plan when a read simply failed',
      ).not.toContain(THE_OLD_LIE);
      expect(r.reason.toLowerCase()).toContain('could not check');
      expect(r.reason.toLowerCase()).toContain('nothing has changed');
      expect(r.status, 'a read this server could not complete is not a 4xx conflict').toBe(503);
      expect(r.retryable, 'this is the one refusal where trying again is the correct action').toBe(true);
    },
  );

  it('`no_plan` is its own measured fact and keeps its own sentence', () => {
    const r = refusalFor({ outcome: 'no_plan', violations: ['no active plan resolved for this mutation'] });
    expect(r.code).toBe<MutationRefusalCode>('no_plan');
    expect(r.reason).not.toContain(THE_OLD_LIE);
    expect(r.reason).toContain('active plan');
    expect(r.retryable).toBe(false);
  });

  it(
    '`ledger_unwritten` says the change was not RECORDED · the exact case '
    + '_move_ledger_absent.db.test.ts logged as FOUND-BUT-NOT-FIXED',
    () => {
      const r = refusalFor({ outcome: 'ledger_unwritten', violations: ['the ledger table does not exist'] }, { thing: 'That move' });
      expect(r.code).toBe<MutationRefusalCode>('ledger_unrecorded');
      expect(r.reason).not.toContain(THE_OLD_LIE);
      expect(r.reason).toContain('recorded');
      expect(r.status).toBe(503);
    },
  );

  it('`duplicate` says it already happened, which is not a refusal of the request at all', () => {
    const r = refusalFor({ outcome: 'duplicate', violations: [] });
    expect(r.code).toBe<MutationRefusalCode>('duplicate');
    expect(r.reason).toContain('already been made');
    expect(r.retryable, 'retrying a duplicate produces another duplicate').toBe(false);
  });

  it('an unknown or absent outcome is named plainly, never folded into one of the four', () => {
    for (const outcome of ['not_attempted', null] as const) {
      const r = refusalFor({ outcome, violations: [] });
      expect(r.code, `outcome=${String(outcome)}`).toBe<MutationRefusalCode>('mutation_failed');
      expect(r.reason).not.toContain(THE_OLD_LIE);
    }
  });

  it('EVERY refusal produces a DISTINCT code · collapsing any two would be the original bug', () => {
    const codes = (['rejected', 'plan_verification_failed', 'no_plan', 'ledger_unwritten', 'duplicate'] as const)
      .map((o) => refusalFor({ outcome: o, violations: [] }).code);
    expect(new Set(codes).size, `two outcomes share a code: ${codes.join(', ')}`).toBe(codes.length);
  });

  it('EVERY refusal produces a DISTINCT sentence, for the same reason', () => {
    const said = (['rejected', 'plan_verification_failed', 'no_plan', 'ledger_unwritten', 'duplicate'] as const)
      .map((o) => refusalFor({ outcome: o, violations: [] }).reason);
    expect(new Set(said).size, `two outcomes share a sentence:\n${said.join('\n')}`).toBe(said.length);
  });

  it('the subject is the surface\'s, the WHY clause is the resolver\'s · Rule 16', () => {
    const move = refusalFor({ outcome: 'rejected', violations: [] }, { thing: 'That move' });
    const back = refusalFor({ outcome: 'rejected', violations: [] }, { thing: 'Putting that back' });
    expect(move.reason.startsWith('That move')).toBe(true);
    expect(back.reason.startsWith('Putting that back')).toBe(true);
    // Same clause after the subject, both times.
    expect(move.reason.slice('That move'.length)).toBe(back.reason.slice('Putting that back'.length));
  });

  it('COACH VOICE · no exclamation marks, no em dashes, no emoji, in any sentence', () => {
    for (const o of ['rejected', 'plan_verification_failed', 'no_plan', 'ledger_unwritten', 'duplicate', 'not_attempted'] as const) {
      const s = refusalFor({ outcome: o, violations: [] }).reason;
      expect(s, `exclamation mark in ${o}`).not.toContain('!');
      expect(s, `em dash in ${o}`).not.toContain('—');
      expect(s, `en dash in ${o}`).not.toContain('–');
      expect(/\p{Extended_Pictographic}/u.test(s), `emoji in ${o}`).toBe(false);
      expect(s.trim().endsWith('.'), `${o} does not end in a full stop: ${s}`).toBe(true);
    }
  });

  it('the wire body carries the code, the sentence and the retry hint', () => {
    const body = refusalBody(refusalFor({ outcome: 'plan_verification_failed', violations: ['x'] }));
    expect(body).toEqual({
      ok: false,
      error: 'plan_verification_failed',
      reason: expect.any(String),
      retryable: true,
      violations: ['x'],
    });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * SOURCE · Rule 16's own instruction: "a behavioural test alone cannot catch
 * a surface that stops calling the shared resolver."
 * ═══════════════════════════════════════════════════════════════════════ */

interface CallerPin {
  file: string;
  /** The literal this caller used to hardcode, which must not come back. */
  retired: readonly string[];
}

/** Every site that turns a `mutatePlan` result into something a person reads.
 *  A RATCHET: it may grow, and an entry may only be removed when the caller
 *  itself is deleted. */
const CALLERS: readonly CallerPin[] = [
  { file: 'app/api/plan/workout/route.ts', retired: ["{ error: 'plan_invariant_violation', violations: boundary.violations }"] },
  { file: 'app/api/today/reschedule/route.ts', retired: ["{ error: 'plan_invariant_violation', violations: boundary.violations }"] },
  { file: 'app/api/plan/workout/[id]/accept-standing/route.ts', retired: ["{ ok: false, error: 'plan_invariant_violation', violations: boundary.violations }"] },
  { file: 'app/api/plan/restore/route.ts', retired: ["{ ok: false, error: 'plan_invariant_violation', violations: boundary.violations }"] },
  { file: 'app/api/coach/proposal/route.ts', retired: ["{ error: 'plan_invariant_violation', violations: boundary.violations }"] },
  { file: 'lib/plan/replan-scenarios.ts', retired: ["reason: 'That change would break the plan\\'s own rules, so it was not made.'"] },
  { file: 'lib/plan/reschedule.ts', retired: ["'That move would break the plan. Nothing was changed.'"] },
  { file: 'lib/brain/proposal/accept.ts', retired: ["ok: false, error: 'rejected',"] },
  { file: 'lib/brain/proposal/undo-apply.ts', retired: ["      error: 'rejected',"] },
];

describe('CALLERHONESTY-1 · source · no caller re-derives the mapping', () => {
  it('LIVENESS · every pinned caller file was actually read', () => {
    let read = 0;
    for (const c of CALLERS) {
      const src = readFileSync(join(REPO, c.file), 'utf8');
      expect(src.length, `${c.file} is empty`).toBeGreaterThan(0);
      read++;
    }
    expect(read, 'the scan looked at nothing, which is the worst outcome available').toBe(CALLERS.length);
    expect(read).toBeGreaterThanOrEqual(9);
  });

  for (const c of CALLERS) {
    it(`${c.file} · routes its refusal through refusalFor`, () => {
      const src = readFileSync(join(REPO, c.file), 'utf8');
      expect(
        src,
        `${c.file} no longer imports the shared resolver, so it is describing `
        + 'mutation refusals on its own again (Rule 16)',
      ).toContain("from '@/lib/plan/mutation-refusal'");
      expect(src, `${c.file} imports the resolver and never calls it`).toContain('refusalFor(');
    });

    it(`${c.file} · the hardcoded refusal it used to carry has not come back`, () => {
      const src = readFileSync(join(REPO, c.file), 'utf8');
      for (const lit of c.retired) {
        // Comments quoting the old shape are how this file documents itself,
        // so the check is on CODE: strip full-line comments first.
        const code = src
          .split('\n')
          .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
          .join('\n');
        expect(
          code.includes(lit),
          `${c.file} answers a mutation refusal with a hardcoded literal again: ${lit}`,
        ).toBe(false);
      }
    });
  }
});
