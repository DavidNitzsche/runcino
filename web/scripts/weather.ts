#!/usr/bin/env tsx
/**
 * CLI: fetch NOAA forecast for a lat/lon.
 *
 * Usage:
 *   npm run weather -- [--lat 36.556] [--lon -121.923]
 *
 * Defaults to Carmel Highlands (Big Sur Marathon finish area).
 */

import { fetchNoaaWeather } from '../lib/weather';

function arg(name: string, args: string[]): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const lat = Number(arg('lat', args) ?? '36.556');
  const lon = Number(arg('lon', args) ?? '-121.923');

  console.log(`Fetching NOAA forecast for ${lat}, ${lon}…\n`);
  const data = await fetchNoaaWeather(lat, lon);

  console.log(`Location: ${data.location.city ?? 'unknown'} (${data.location.lat}, ${data.location.lon})`);
  console.log();
  console.log(data.narrative);
  console.log();
  console.log('Raw start period:');
  console.log(JSON.stringify(data.start_period, null, 2));
}

main().catch(err => {
  console.error('Weather fetch failed:', err);
  process.exit(1);
});
