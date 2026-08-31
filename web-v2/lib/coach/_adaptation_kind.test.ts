/**
 * lib/coach/_adaptation_kind.test.ts · a push has a name on every surface.
 *
 * `plan_adapt_upgrade` has ZERO rows in production, so this classifier has
 * never once been asked about an upward adaptation. The moment the ramp fires
 * — `lib/plan/adaptive-ramp.ts` gate 2 was fixed 2026-08-30 — it becomes the
 * first thing the runner reads about it. Rule 15: a path no case has reached is
 * untested however good it looks, so it gets exercised here before it meets him.
 *
 * The two defects this pins:
 *
 *  1. `tryAdaptiveBump` applies `kind: 'mark_upgrade'` and `applyAdaptations`
 *     records `plan_adapt_upgrade`. NEITHER spelling was accepted, so a push
 *     rendered as `'other'` — the same catch-all used for "this row differs
 *     from its authored self and we have no idea why".
 *  2. `lib/coach/readiness-brief.ts` carried a SECOND copy of the mapping whose
 *     accepted set was a strict subset — no `reshape`, no `upgrade` — so one
 *     adaptation had two names depending on which surface asked (Rule 16).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { resolveAdaptationKind, type AdaptationKind } from './adaptation-info';

describe('a push is named, not filed under "other"', () => {
  it('the adapter action kind the ramp actually applies resolves to upgrade', () => {
    // `tryAdaptiveBump` → applyAdaptations([{ kind: 'mark_upgrade', ... }]),
    // which writeIntent stores as value.kind. This is the live spelling.
    expect(resolveAdaptationKind({
      intentActionKind: 'mark_upgrade', intentReason: 'plan_adapt_upgrade', wasAdapted: true,
    })).toBe('upgrade');
  });

  it('and so does the reason alone, for a row whose value carries no kind', () => {
    expect(resolveAdaptationKind({
      intentActionKind: null, intentReason: 'plan_adapt_upgrade', wasAdapted: true,
    })).toBe('upgrade');
  });

  it('the progression cycle names the CYCLE; the row was reshaped', () => {
    expect(resolveAdaptationKind({
      intentActionKind: null, intentReason: 'plan_adapt_progression', wasAdapted: true,
    })).toBe('reshape');
    expect(resolveAdaptationKind({
      intentActionKind: 'reshape', intentReason: 'plan_adapt_progression', wasAdapted: true,
    })).toBe('reshape');
  });

  it('the downward kinds are unchanged · this widens nothing it should not', () => {
    for (const k of ['downgrade', 'reschedule', 'shave', 'mark_dirty'] as const) {
      expect(resolveAdaptationKind({ intentActionKind: k, intentReason: null, wasAdapted: true })).toBe(k);
      expect(resolveAdaptationKind({
        intentActionKind: null, intentReason: `plan_adapt_${k}`, wasAdapted: true,
      })).toBe(k);
    }
  });

  it('an unrecognised action kind is "other", not a crash and not a guess', () => {
    expect(resolveAdaptationKind({
      intentActionKind: 'something_new', intentReason: null, wasAdapted: true,
    })).toBe('other');
  });

  it('no intent and nothing changed is NO KIND · not "other"', () => {
    // "Nothing happened" and "something happened we cannot classify" are two
    // facts (Rule 11). An unadapted row must not carry an adaptation badge.
    expect(resolveAdaptationKind({
      intentActionKind: null, intentReason: null, wasAdapted: false,
    })).toBeNull();
    expect(resolveAdaptationKind({
      intentActionKind: null, intentReason: null, wasAdapted: true,
    })).toBe('other');
  });

  it('every kind the union declares is reachable · no decorative members', () => {
    const reachable = new Set<AdaptationKind | null>([
      resolveAdaptationKind({ intentActionKind: 'downgrade', intentReason: null, wasAdapted: true }),
      resolveAdaptationKind({ intentActionKind: 'reschedule', intentReason: null, wasAdapted: true }),
      resolveAdaptationKind({ intentActionKind: 'shave', intentReason: null, wasAdapted: true }),
      resolveAdaptationKind({ intentActionKind: 'mark_dirty', intentReason: null, wasAdapted: true }),
      resolveAdaptationKind({ intentActionKind: 'reshape', intentReason: null, wasAdapted: true }),
      resolveAdaptationKind({ intentActionKind: 'mark_upgrade', intentReason: null, wasAdapted: true }),
      resolveAdaptationKind({ intentActionKind: 'zzz', intentReason: null, wasAdapted: true }),
    ]);
    expect([...reachable].sort()).toEqual(
      ['downgrade', 'mark_dirty', 'other', 'reschedule', 'reshape', 'shave', 'upgrade'],
    );
  });

  it('THERE IS ONE RESOLVER · the readiness brief does not carry a second', () => {
    // The drift this file exists to end. A behavioural test cannot catch a
    // surface that stops calling the shared resolver, so the source is scanned
    // — the same shape `race-projection` uses for the three-projections fix.
    const brief = fs.readFileSync(
      path.join(process.cwd(), 'lib/coach/readiness-brief.ts'), 'utf8',
    );
    expect(brief.length).toBeGreaterThan(10_000);
    expect(brief).toContain('resolveAdaptationKind({');
    expect(
      brief,
      'readiness-brief has re-grown its own kind mapping · call resolveAdaptationKind',
    ).not.toMatch(/if \(k === 'downgrade' \|\| k === 'reschedule'/);
  });
});
