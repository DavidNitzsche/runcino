/**
 * lib/faff/_pace_zone_provenance.test.ts · rule one, per zone.
 *
 * FALSIFIED before landing (Rule 18): with `zoneIsModelled` reduced to the
 * route's old `direction !== 'faster-race'` for every zone, test 2 fails.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ──────────────────────────────────────
 *   · It drives the pure helper. Whether `/api/v5/paces` CALLS it for every
 *     zone is checked by `_pace_zone_route_provenance.test.ts` (a source scan
 *     of the route), not here.
 */
import { describe, it, expect } from 'vitest';
import { zoneIsModelled, highIntensityCaption } from './pace-zone-provenance';
import type { SourceMode } from '@/lib/training/capacity-resolver';

const FALLBACK: SourceMode[] = ['vdot_fallback', 'user_prior', 'population_prior'];
const RANKABLE: SourceMode[] = ['direct', 'inferred', 'race_derived'];

describe('pace-zone provenance · rule one per zone', () => {
  it('1 · threshold follows the event exactly as before', () => {
    for (const m of [...FALLBACK, ...RANKABLE]) {
      expect(zoneIsModelled('threshold', 'faster-race', m)).toBe(false);
      expect(zoneIsModelled('threshold', 'faster-training', m)).toBe(true);
      expect(zoneIsModelled('threshold', 'slower', m)).toBe(true);
    }
  });

  it('2 · interval and rep stay MODELLED on a race-confirmed read while high intensity is a fallback', () => {
    for (const m of FALLBACK) {
      expect(zoneIsModelled('interval', 'faster-race', m), m).toBe(true);
      expect(zoneIsModelled('rep', 'faster-race', m), m).toBe(true);
    }
  });

  it('3 · the mark disappears from those rows the moment high intensity is read directly', () => {
    for (const m of RANKABLE) {
      expect(zoneIsModelled('interval', 'faster-race', m), m).toBe(false);
      expect(zoneIsModelled('rep', 'faster-race', m), m).toBe(false);
    }
  });

  it('4 · a modelled event is modelled on every zone whatever the capacity says', () => {
    for (const m of [...FALLBACK, ...RANKABLE]) {
      expect(zoneIsModelled('interval', 'slower', m)).toBe(true);
      expect(zoneIsModelled('rep', 'faster-training', m)).toBe(true);
    }
  });

  it('5 · the caption says so only on the race-confirmed, fallback-HI case, and obeys the voice', () => {
    expect(highIntensityCaption('faster-race', 'vdot_fallback')).toMatch(/not from your own interval sessions/);
    expect(highIntensityCaption('faster-race', 'direct')).toBeNull();
    expect(highIntensityCaption('faster-training', 'vdot_fallback')).toBeNull();
    const c = highIntensityCaption('faster-race', 'vdot_fallback')!;
    expect(c).not.toMatch(/[—!·]/);
  });
});
