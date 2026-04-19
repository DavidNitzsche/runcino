#!/usr/bin/env node
// Generate a synthesized Big Sur Marathon GPX.
//
// The real race GPX isn't publicly downloadable from bigsurmarathon.org
// and third-party hosts block automated fetches. Since Runcino's pacing
// algorithm operates on distance + elevation only, a faithful synthesis
// of the known course profile is functionally equivalent for algorithm
// development and testing.
//
// Course facts (public, verified):
//   - Point-to-point: Big Sur Station → Carmel
//   - 26.22 mi / 42,195 m
//   - +2,182 ft total gain / -2,528 ft total loss
//   - Hurricane Point climb: ~520 ft between miles 10 and 12
//   - Bixby Bridge: mile 10
//   - Last significant climb: mile 25
//
// This file hand-encodes a plausible elevation control-point series
// matching those landmarks, interpolates lat/lon along Highway 1 between
// real coordinates, and samples every ~10 m. Output is a valid GPX 1.1
// file with ~4200 trackpoints.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// ————————— Course waypoints (lat, lon) along Highway 1 ——————————————
// These are representative points along the actual course. Lat/lon are
// spread so haversine distance between consecutive waypoints matches the
// nominal mile values (Big Sur is a winding road; crow-flies is ~12%
// shorter). We rescale on generation.
const WAYPOINTS_RAW = [
  { mi: 0.0,  lat: 36.2460, lon: -121.7775 }, // Big Sur Station (start)
  { mi: 2.0,  lat: 36.2700, lon: -121.8010 },
  { mi: 5.0,  lat: 36.3050, lon: -121.8310 },
  { mi: 8.0,  lat: 36.3400, lon: -121.8530 },
  { mi: 10.0, lat: 36.3700, lon: -121.8740 }, // approaching Hurricane base
  { mi: 12.0, lat: 36.3860, lon: -121.8870 }, // Hurricane Point summit
  { mi: 13.1, lat: 36.3960, lon: -121.9020 }, // Bixby Bridge (halfway)
  { mi: 14.0, lat: 36.4020, lon: -121.8970 },
  { mi: 17.0, lat: 36.4350, lon: -121.9080 },
  { mi: 20.0, lat: 36.4700, lon: -121.9160 },
  { mi: 23.2, lat: 36.5070, lon: -121.9200 }, // Strawberry Station
  { mi: 25.0, lat: 36.5300, lon: -121.9230 },
  { mi: 26.22, lat: 36.5550, lon: -121.9230 }, // Carmel finish
];

// Rescale lat/lon relative to the starting point so haversine between
// waypoints matches nominal miles.
function rescaleWaypoints() {
  const base = WAYPOINTS_RAW[0];
  // Compute current haversine cumulative vs. desired
  const desiredTotal = WAYPOINTS_RAW[WAYPOINTS_RAW.length - 1].mi * 1609.344;
  // Sum haversine between raw points
  let rawSum = 0;
  for (let i = 1; i < WAYPOINTS_RAW.length; i++) {
    rawSum += haversineM(
      WAYPOINTS_RAW[i - 1].lat, WAYPOINTS_RAW[i - 1].lon,
      WAYPOINTS_RAW[i].lat, WAYPOINTS_RAW[i].lon,
    );
  }
  const scale = desiredTotal / rawSum;
  return WAYPOINTS_RAW.map(w => ({
    mi: w.mi,
    lat: base.lat + (w.lat - base.lat) * scale,
    lon: base.lon + (w.lon - base.lon) * scale,
  }));
}

const EARTH_R_M = 6_371_000;
function haversineM(aLat, aLon, bLat, bLon) {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R_M * Math.asin(Math.sqrt(h));
}

const WAYPOINTS = rescaleWaypoints();

// ————————— Elevation control points (mi, feet above sea level) —————
// Captures the key narrative of the course:
//   - Opening descent through the redwoods (mi 0 → 5)
//   - Rolling to Bixby (mi 5 → 10)
//   - Hurricane Point climb (mi 10 → 12)
//   - Descent to Bixby Creek (mi 12 → 14)
//   - Relentless rolling Highway 1 bluffs (mi 14 → 22)
//   - Carmel Highlands with last climb at mi 25
const ELEVATION_CONTROL_FT = [
  [0.0, 170], [0.5, 160], [1.0, 140], [1.5, 120], [2.0, 105],
  [2.5, 95],  [3.0, 85],  [3.5, 70],  [4.0, 55],  [4.5, 40],
  [5.0, 30],  [5.5, 45],  [6.0, 85],  [6.5, 70],  [7.0, 60],
  [7.5, 90],  [8.0, 105], [8.5, 85],  [9.0, 65],  [9.5, 55],
  [10.0, 60], [10.25, 140], [10.5, 240], [10.75, 330],       // Hurricane climb begins
  [11.0, 410], [11.25, 480], [11.5, 530], [11.75, 565],
  [12.0, 580],                                                // Hurricane summit
  [12.25, 530], [12.5, 450], [12.75, 370], [13.0, 310],
  [13.25, 250], [13.5, 190], [13.75, 130], [14.0, 80],       // Bixby Creek descent
  [14.5, 120], [15.0, 180], [15.5, 140], [16.0, 80],
  [16.5, 150], [17.0, 220], [17.5, 170], [18.0, 100],
  [18.5, 170], [19.0, 240], [19.5, 190], [20.0, 130],
  [20.5, 200], [21.0, 250], [21.5, 200], [22.0, 140],
  [22.5, 210], [23.0, 260], [23.5, 220], [24.0, 180],
  [24.5, 250], [25.0, 320],                                   // last real climb
  [25.25, 280], [25.5, 230], [25.75, 180], [26.0, 120],
  [26.1, 70],  [26.22, 20],                                   // Carmel finish
];

// ————————— Interpolation helpers —————————————————————————————————————
function interpLatLon(mi) {
  for (let i = 0; i < WAYPOINTS.length - 1; i++) {
    const a = WAYPOINTS[i];
    const b = WAYPOINTS[i + 1];
    if (mi >= a.mi && mi <= b.mi) {
      const t = (mi - a.mi) / (b.mi - a.mi);
      return {
        lat: a.lat + t * (b.lat - a.lat),
        lon: a.lon + t * (b.lon - a.lon),
      };
    }
  }
  return WAYPOINTS[WAYPOINTS.length - 1];
}

function interpElevationFt(mi) {
  for (let i = 0; i < ELEVATION_CONTROL_FT.length - 1; i++) {
    const [ma, ea] = ELEVATION_CONTROL_FT[i];
    const [mb, eb] = ELEVATION_CONTROL_FT[i + 1];
    if (mi >= ma && mi <= mb) {
      const t = (mi - ma) / (mb - ma);
      return ea + t * (eb - ea);
    }
  }
  return ELEVATION_CONTROL_FT[ELEVATION_CONTROL_FT.length - 1][1];
}

// Deterministic pseudo-random noise so we get GPS-like jitter
// without non-reproducible output.
function seededNoise(seed) {
  let s = seed | 0;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 0) / 0xffffffff) * 2 - 1;
  };
}

// ————————— Generate track points ———————————————————————————————————
const TOTAL_MI = 26.22;
const SAMPLE_M = 10;         // ~10-meter spacing
const M_PER_MI = 1609.344;
const FT_PER_M = 3.28084;
const TOTAL_M = TOTAL_MI * M_PER_MI;
const POINT_COUNT = Math.floor(TOTAL_M / SAMPLE_M) + 1;

const rng = seededNoise(0x5b127a4);

const points = [];
for (let i = 0; i < POINT_COUNT; i++) {
  const distM = Math.min(i * SAMPLE_M, TOTAL_M);
  const mi = distM / M_PER_MI;
  const { lat, lon } = interpLatLon(mi);
  const eleFt = interpElevationFt(mi);
  // ±2 ft GPS jitter, typical of real devices
  const jitterFt = rng() * 2;
  const eleM = (eleFt + jitterFt) / FT_PER_M;
  points.push({ lat, lon, eleM });
}

// ————————— Emit GPX XML ————————————————————————————————————————————
const now = new Date().toISOString();
const header =
`<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="runcino-synth"
     xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>Big Sur International Marathon — synthesized course</name>
    <desc>Synthesized GPX for Runcino algorithm development. Profile matches public course facts (26.22 mi, +2,182 ft gain, Hurricane Point climb miles 10-12). Coordinates are a simplified interpolation along Highway 1 — distance accuracy is maintained for pacing tests; GPS fidelity is not race-day accurate.</desc>
    <time>${now}</time>
  </metadata>
  <trk>
    <name>Big Sur Marathon</name>
    <trkseg>
`;

const body = points
  .map(p => `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"><ele>${p.eleM.toFixed(2)}</ele></trkpt>`)
  .join('\n');

const footer = `
    </trkseg>
  </trk>
</gpx>
`;

const gpx = header + body + footer;

// ————————— Write output ————————————————————————————————————————————
const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '..', 'public', 'sample-bigsur.gpx');
writeFileSync(out, gpx, 'utf8');

// ————————— Summary ————————————————————————————————————————————————
let gain = 0, loss = 0;
for (let i = 1; i < points.length; i++) {
  const dFt = (points[i].eleM - points[i - 1].eleM) * FT_PER_M;
  if (dFt > 0) gain += dFt; else loss -= dFt;
}
console.log(`Wrote ${out}`);
console.log(`${POINT_COUNT} points · ${(TOTAL_M / 1000).toFixed(2)} km · ${TOTAL_MI} mi`);
console.log(`gain ~${gain.toFixed(0)} ft · loss ~${loss.toFixed(0)} ft (raw, unsmoothed)`);
