/**
 * shoe-picker, auto-assign rule + ambiguity handling.
 *
 * The picker drives the sync-time shoe auto-assign in
 * syncSingleActivity. The contract is: pick a shoe iff there's a single
 * clear choice for the workout type; bail out (null) when there's no
 * match OR when multiple shoes match with no preferred flag. Better
 * to leave shoe_id NULL and have the user tap once than to log miles
 * against the wrong pair.
 *
 * Tests use the pure pickFromShoes() variant so we don't need a DB, 
 * the async pickShoeForWorkout() wrapper is a thin listShoes() +
 * pickFromShoes() composition.
 *
 * Ported from dev branch commit 29887d6.
 */

import { describe, it, expect } from 'vitest';
import { pickFromShoes } from '../shoe-picker';
import type { Shoe, RunType } from '../shoe-utils';

function makeShoe(over: Partial<Shoe> & { id: number; run_types: RunType[] }): Shoe {
  return {
    brand: 'Asics',
    model: 'Default',
    color: null,
    mileage: 0,
    mileage_cap: null,
    preferred: false,
    retired: false,
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

describe('pickFromShoes', () => {
  it('picks the single matching shoe for the workout type', () => {
    const shoes = [
      makeShoe({ id: 1, model: 'Novablast', run_types: ['easy'] }),
      makeShoe({ id: 2, model: 'Zoom Fly',  run_types: ['tempo', 'intervals'] }),
    ];
    expect(pickFromShoes(shoes, 'easy')).toBe(1);
    expect(pickFromShoes(shoes, 'threshold')).toBe(2);
  });

  it('returns null when no shoe matches', () => {
    const shoes = [makeShoe({ id: 1, run_types: ['easy'] })];
    expect(pickFromShoes(shoes, 'race')).toBeNull();
  });

  it('returns null when multiple shoes match and none are preferred', () => {
    const shoes = [
      makeShoe({ id: 1, model: 'Superblast', run_types: ['easy'] }),
      makeShoe({ id: 2, model: 'Novablast',  run_types: ['easy'] }),
    ];
    expect(pickFromShoes(shoes, 'easy')).toBeNull();
  });

  it('returns the preferred shoe when multiple match and one is preferred', () => {
    const shoes = [
      makeShoe({ id: 1, run_types: ['easy'] }),
      makeShoe({ id: 2, run_types: ['easy'], preferred: true }),
    ];
    expect(pickFromShoes(shoes, 'easy')).toBe(2);
  });

  it('returns null when multiple matches are ALL preferred (still ambiguous)', () => {
    const shoes = [
      makeShoe({ id: 1, run_types: ['easy'], preferred: true }),
      makeShoe({ id: 2, run_types: ['easy'], preferred: true }),
    ];
    expect(pickFromShoes(shoes, 'easy')).toBeNull();
  });

  it('rolls recovery up to easy when no dedicated recovery shoe exists', () => {
    const shoes = [makeShoe({ id: 1, run_types: ['easy'] })];
    expect(pickFromShoes(shoes, 'recovery')).toBe(1);
  });

  it('flags ambiguity when both a recovery and an easy shoe exist with no preferred flag', () => {
    const shoes = [
      makeShoe({ id: 1, run_types: ['easy'] }),
      makeShoe({ id: 2, run_types: ['recovery'] }),
    ];
    expect(pickFromShoes(shoes, 'recovery')).toBeNull();
  });

  it('prefers the recovery-tagged shoe when it carries the preferred flag', () => {
    const shoes = [
      makeShoe({ id: 1, run_types: ['easy'] }),
      makeShoe({ id: 2, run_types: ['recovery'], preferred: true }),
    ];
    expect(pickFromShoes(shoes, 'recovery')).toBe(2);
  });

  it('also handles general_aerobic via the recovery-rollup path', () => {
    const shoes = [makeShoe({ id: 1, run_types: ['easy'] })];
    expect(pickFromShoes(shoes, 'general_aerobic')).toBe(1);
  });

  it('skips retired shoes even when they match', () => {
    const shoes = [
      makeShoe({ id: 1, run_types: ['easy'], retired: true }),
      makeShoe({ id: 2, run_types: ['easy'] }),
    ];
    expect(pickFromShoes(shoes, 'easy')).toBe(2);
  });

  it('falls back to as_needed shoes when no run-type match exists', () => {
    const shoes = [
      makeShoe({ id: 1, run_types: ['tempo'] }),
      makeShoe({ id: 2, run_types: ['as_needed'] }),
    ];
    expect(pickFromShoes(shoes, 'long')).toBe(2);
  });

  it('returns null when as_needed fallback is also ambiguous', () => {
    const shoes = [
      makeShoe({ id: 1, run_types: ['as_needed'] }),
      makeShoe({ id: 2, run_types: ['as_needed'] }),
    ];
    expect(pickFromShoes(shoes, 'long')).toBeNull();
  });

  it('maps plan workout types correctly: race → race shoe', () => {
    const shoes = [
      makeShoe({ id: 1, run_types: ['easy'] }),
      makeShoe({ id: 2, run_types: ['race'] }),
    ];
    expect(pickFromShoes(shoes, 'race')).toBe(2);
  });

  it('maps interval → intervals shoe', () => {
    const shoes = [
      makeShoe({ id: 1, run_types: ['tempo', 'intervals'] }),
      makeShoe({ id: 2, run_types: ['easy'] }),
    ];
    expect(pickFromShoes(shoes, 'interval')).toBe(1);
  });

  it('returns null on an empty rotation', () => {
    expect(pickFromShoes([], 'easy')).toBeNull();
  });

  it('maps the synthetic-plan "quality" label to tempo (main-specific)', () => {
    // Main's synthetic plan tags threshold workouts as 'quality';
    // shoe-picker handles that label too. Verifies the inlined
    // runTypeForWorkout mapping covers main's label set.
    const shoes = [
      makeShoe({ id: 1, run_types: ['easy'] }),
      makeShoe({ id: 2, run_types: ['tempo'] }),
    ];
    expect(pickFromShoes(shoes, 'quality')).toBe(2);
  });
});
