/**
 * Calendar role labelling + results provenance · deck Decision 3c.
 *
 * The role captions must state what the generator actually does with the
 * race (lib/plan/generate.ts · embedMidBlockRaces), not an abstract tag.
 */
import { describe, it, expect } from 'vitest';
import { resolveRaceRole, resolveProvenance } from './race-roles';

describe('resolveRaceRole · by priority', () => {
  it('A names the goal race', () => {
    const r = resolveRaceRole('A', { ownGoal: '3:00:00' });
    expect(r.role).toBe('A');
    expect(r.line).toBe('goal race · everything points here');
    expect(r.tag).toBe('3:00:00 goal');
  });

  it('A without a stated goal time does not invent one', () => {
    expect(resolveRaceRole('A').tag).toBe('goal race');
  });

  it('B says the race day stands in the week, and carries its own goal', () => {
    const r = resolveRaceRole('B', { ownGoal: '45:00' });
    expect(r.role).toBe('B');
    expect(r.line).toBe('tune-up · race day in your plan · own goal 45:00');
    expect(r.tag).toBe('tune-up');
  });

  it('B without an own goal stays silent about it', () => {
    expect(resolveRaceRole('B').line).toBe('tune-up · race day in your plan');
  });

  it('C says it converts a quality day', () => {
    const r = resolveRaceRole('C');
    expect(r.role).toBe('C');
    expect(r.line).toBe('converts a quality day · no taper, no recovery debt');
    expect(r.tag).toBe('quality day');
  });

  it('an unstated priority is a C · same bucket races-state puts it in', () => {
    expect(resolveRaceRole(null).role).toBe('C');
    expect(resolveRaceRole(undefined).role).toBe('C');
  });

  it('every role gets a distinct tone', () => {
    const tones = (['A', 'B', 'C'] as const).map((p) => resolveRaceRole(p).tone);
    expect(new Set(tones).size).toBe(3);
  });

  it('no role caption uses banned punctuation or hype', () => {
    for (const p of ['A', 'B', 'C', null] as const) {
      const line = resolveRaceRole(p, { ownGoal: '45:00' }).line;
      expect(line).not.toMatch(/[—!]/);
    }
  });
});

describe('resolveProvenance · results chips', () => {
  it('official is a chip time and is not provisional', () => {
    const r = resolveProvenance('official');
    expect(r?.label).toBe('Official');
    expect(r?.provisional).toBe(false);
  });

  it('logged is a curated entry and is not provisional', () => {
    const r = resolveProvenance('logged');
    expect(r?.label).toBe('Logged');
    expect(r?.provisional).toBe(false);
  });

  it('provisional names the watch as the source · race-data Rule 3', () => {
    const r = resolveProvenance('provisional');
    expect(r?.label).toBe('Provisional');
    expect(r?.source).toBe('Watch time');
    expect(r?.provisional).toBe(true);
  });

  it('no provenance means no chip · the row says it has no result instead', () => {
    expect(resolveProvenance(null)).toBeNull();
    expect(resolveProvenance(undefined)).toBeNull();
  });

  it('only the provisional chip is ever flagged provisional', () => {
    const flagged = (['official', 'logged', 'provisional'] as const)
      .filter((p) => resolveProvenance(p)?.provisional);
    expect(flagged).toEqual(['provisional']);
  });
});
