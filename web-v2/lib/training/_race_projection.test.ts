/**
 * lib/training/_race_projection.test.ts — ONE race, ONE projected time.
 *
 * On the owner's account, 2026-08-30, CIM: Races list 3:22:17, CIM detail
 * 3:31:48, one tap apart, both labelled "Projected". Two legitimately
 * different quantities under one word.
 *
 * 2026-09-01 · P0 · the resolver is now a pure MAPPING from the race-pace
 * brain (`lib/race/race-outlook.ts`). Two halves, as before:
 *
 *   1 · the mapping behaves (trajectory when race day is projectable, the
 *       equivalence by name when it is not).
 *   2 · NO ROUTE RESOLVES A PROJECTION ANY OTHER WAY. A behavioural test of
 *       a shared function cannot catch a route that stops calling it, so the
 *       route sources are read and asserted against directly — and the
 *       things a route must NOT import are asserted too.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { raceProjectionFromOutlook, projectionCoachLine } from './race-projection';
import { composeRaceOutlook } from '@/lib/race/race-outlook';
import { fixtureReads, fixtureRace } from '@/lib/race/_race_outlook_fixture';

const ROOT = path.resolve(__dirname, '..', '..');
const src = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
/** Source with block and line comments blanked: an epitaph is not a call. */
const code = (rel: string) => src(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

/** Every surface that prints "Projected" or paces a race. */
const CONSUMERS = [
  'app/api/v5/races/route.ts',
  'app/api/v5/race/[slug]/route.ts',
  'lib/plan/goal-gap.ts',
  'lib/plan/goal-outlook.ts',
  'lib/training/goal-projection-resolve.ts',
  'components/faff-app/seed.ts',
];

describe('raceProjectionFromOutlook · mapping', () => {
  it('race day projectable → trajectory, with the outlook\'s own likely range', async () => {
    const o = await composeRaceOutlook(fixtureRace(), '2026-09-01', fixtureReads());
    const p = raceProjectionFromOutlook(o);
    expect(p.basis).toBe('trajectory');
    expect(p.projectedSec).toBe(Math.round(o.expectedRaceDay.expectedSec!));
    expect(p.likelyRangeSec).toEqual(o.expectedRaceDay.likelyRangeSec);
  });
  it('no race date → equivalence, named as such', async () => {
    const o = await composeRaceOutlook(fixtureRace({ dateISO: null }), '2026-09-01', fixtureReads());
    const p = raceProjectionFromOutlook(o);
    expect(p.basis).toBe('equivalence');
    expect(p.projectedSec).toBe(Math.round(o.currentProjection.expectedSec!));
  });
  it('no outlook → nothing, by name', () => {
    expect(raceProjectionFromOutlook(null)).toMatchObject({ projectedSec: null, basis: null });
  });
});

describe('every "Projected" consumer reads the brain and nothing else', () => {
  for (const rel of CONSUMERS) {
    it(`${rel} resolves through the outlook`, () => {
      const s = code(rel);
      expect(s, `${rel} must map through raceProjectionFromOutlook`).toMatch(/raceProjectionFromOutlook/);
      expect(s, `${rel} must resolve the outlook (by slug or via resolveOutlookForGap)`).toMatch(/resolveRaceOutlookBySlug|resolveOutlookForGap|resolveRaceOutlook\(/);
      expect(s, `${rel} must not call computeGoalProjection for a projection`).not.toMatch(/resolveRaceProjection\(/);
      expect(s, `${rel} must not read predictRaceTime for a race projection`).not.toMatch(/predictRaceTime\(/);
    });
  }
  it('the retired resolver is gone', () => {
    expect(src('lib/training/race-projection.ts')).not.toMatch(/export function resolveRaceProjection/);
    expect(code('lib/race/effective-race-target.ts')).not.toMatch(/projection_snapshots/);
  });
});

describe('projectionCoachLine · prose names the quantity beside it', () => {
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  it('trajectory basis speaks of the build', () => {
    expect(projectionCoachLine({ basis: 'trajectory', gapSec: 600, formatGap: fmt })).toMatch(/^This build projects 10:00 behind/);
  });
  it('equivalence basis speaks of today', () => {
    expect(projectionCoachLine({ basis: 'equivalence', gapSec: -60, formatGap: fmt })).toMatch(/^Today's fitness covers/);
  });
  it('no basis → no line', () => {
    expect(projectionCoachLine({ basis: null, gapSec: 600, formatGap: fmt })).toBeNull();
  });
});
