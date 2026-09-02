/**
 * lib/faff/_pace_zone_route_provenance.test.ts · the route CALLS the helper.
 *
 * `_pace_zone_provenance.test.ts` proves the helper; this proves
 * `app/api/v5/paces/route.ts` stamps every zone through it and reads the
 * high-intensity capacity from the Runner Model rather than deciding
 * provenance off the event alone. A behavioural test alone cannot catch a
 * route that stops calling the shared resolver (Rule 16's own enforcement
 * note), so this is a source scan with a liveness check.
 *
 * FALSIFIED (Rule 18): reverting the route's zone map to
 * `num(formatPaceMinSec(z.afterSPerMi), modelled)` fails test 2.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROUTE = path.resolve(__dirname, '..', '..', 'app', 'api', 'v5', 'paces', 'route.ts');

describe('paces route · zone provenance goes through the Runner Model', () => {
  const src = fs.readFileSync(ROUTE, 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('1 · liveness · the route exists and builds zones', () => {
    expect(src.length).toBeGreaterThan(1000);
    expect(code).toMatch(/resolveZonePaces\(/);
  });

  it('2 · every zone value is stamped through zoneIsModelled, never off the event bit alone', () => {
    expect(code).toMatch(/import \{[^}]*zoneIsModelled[^}]*\} from '@\/lib\/faff\/pace-zone-provenance'/);
    expect(code).toMatch(/resolveHighIntensityCapacity\(userId\)/);
    const zoneBlock = code.slice(code.indexOf('const zones = zonePaces.map'), code.indexOf('delta: formatDeltaLabel'));
    expect(zoneBlock).toMatch(/before: num\([^)]*\), zoneModelled\(z\.id\)\)/);
    expect(zoneBlock).toMatch(/after: num\([^)]*\), zoneModelled\(z\.id\)\)/);
    expect(zoneBlock).not.toMatch(/num\([^)]*\), modelled\)/);
  });

  it('3 · the race-confirmed caption is the helper\'s, not a literal null', () => {
    expect(code).toMatch(/\? highIntensityCaption\(direction, highIntensity\.sourceMode\)/);
  });
});
