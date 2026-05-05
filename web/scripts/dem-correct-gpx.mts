#!/usr/bin/env tsx
/**
 * dem-correct-gpx — strip GPS elevation from a GPX and replace it with
 * USGS 3DEP lidar data (1 m resolution, ~0.53 m RMSE vertical accuracy).
 *
 * Usage:
 *   npx tsx scripts/dem-correct-gpx.mts --in public/sample-bigsur.gpx \
 *                                        --out data/courses/big-sur.dem.gpx
 *
 * What it does:
 *   1. Parse every <trkpt> in the GPX.
 *   2. Sample points at ≤30 m intervals to keep the query count reasonable.
 *   3. Query USGS EPQS for each sampled point (batched, 8 concurrent).
 *   4. Interpolate DEM elevation back onto every original point.
 *   5. Write a corrected GPX + print elevation summary stats.
 *
 * The resulting GPX is stored in data/courses/ and used as the source of
 * truth for the pacing engine and elevation profile — NOT the user-uploaded
 * raw GPS track.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    in:  { type: 'string' },
    out: { type: 'string' },
    sample: { type: 'string', default: '30' }, // max meters between sampled points
    concurrency: { type: 'string', default: '8' },
  },
  strict: false,
});

const inFile  = values.in  ?? 'public/sample-bigsur.gpx';
const outFile = values.out ?? inFile.replace('.gpx', '.dem.gpx');
const sampleM = parseInt(values.sample as string, 10);
const concurrency = parseInt(values.concurrency as string, 10);

// ── Parse GPX ─────────────────────────────────────────────────────────────

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const raw = readFileSync(inFile, 'utf8');
const doc = new DOMParser().parseFromString(raw, 'application/xml');
const trkpts = Array.from(doc.getElementsByTagName('trkpt'));

interface Point {
  lat: number;
  lon: number;
  originalEleM: number;
  cumM: number;
  node: Element;
}

const points: Point[] = [];
let cumM = 0;
for (let i = 0; i < trkpts.length; i++) {
  const n = trkpts[i] as Element;
  const lat = parseFloat(n.getAttribute('lat') ?? '');
  const lon = parseFloat(n.getAttribute('lon') ?? '');
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  const eleNode = n.getElementsByTagName('ele')[0];
  const originalEleM = eleNode ? parseFloat(eleNode.textContent ?? '0') : 0;
  if (i > 0) {
    const prev = points[points.length - 1];
    cumM += haversineM(prev.lat, prev.lon, lat, lon);
  }
  points.push({ lat, lon, originalEleM, cumM, node: n as unknown as Element });
}

console.log(`Parsed ${points.length} trackpoints, course length ${(cumM / 1000).toFixed(2)} km`);

// ── Sample points for USGS query ──────────────────────────────────────────

const sampled: Array<{ idx: number; lat: number; lon: number }> = [];
let lastSampledM = -Infinity;
for (let i = 0; i < points.length; i++) {
  const p = points[i];
  if (i === 0 || i === points.length - 1 || p.cumM - lastSampledM >= sampleM) {
    sampled.push({ idx: i, lat: p.lat, lon: p.lon });
    lastSampledM = p.cumM;
  }
}
console.log(`Sampling ${sampled.length} points (≤${sampleM} m intervals)`);

// ── Query USGS EPQS ────────────────────────────────────────────────────────

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function queryEPQS(lat: number, lon: number, retries = 4): Promise<number> {
  const url = `https://epqs.nationalmap.gov/v1/json?x=${lon}&y=${lat}&wkid=4326&units=Meters&includeDate=false`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text.trim()) throw new Error('empty response');
      const j = JSON.parse(text) as { value: number | string };
      return typeof j.value === 'string' ? parseFloat(j.value) : j.value;
    } catch (e) {
      if (attempt === retries) throw new Error(`EPQS failed after ${retries} retries at ${lat},${lon}: ${e}`);
      await sleep(500 * 2 ** attempt); // 0.5s, 1s, 2s, 4s
    }
  }
  throw new Error('unreachable');
}

async function runConcurrent<T, R>(
  items: T[],
  fn: (item: T, i: number) => Promise<R>,
  limit: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

console.log(`Querying USGS EPQS (${concurrency} concurrent)…`);
const t0 = Date.now();

let done = 0;
const demElevations = await runConcurrent(sampled, async (s) => {
  const eleM = await queryEPQS(s.lat, s.lon);
  done++;
  if (done % 20 === 0 || done === sampled.length) {
    process.stdout.write(`\r  ${done}/${sampled.length} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }
  return eleM;
}, concurrency);
console.log('\nDone.');

// ── Interpolate DEM elevation onto all original points ────────────────────

// sampled[i].idx → demElevations[i]
// For non-sampled points, linear interpolation between the two nearest samples.
const sampledWithEle = sampled.map((s, i) => ({ ...s, eleM: demElevations[i], cumM: points[s.idx].cumM }));

function interpolateDEM(cumM: number): number {
  // Binary search for surrounding sample points
  let lo = 0, hi = sampledWithEle.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (sampledWithEle[mid].cumM <= cumM) lo = mid; else hi = mid;
  }
  const a = sampledWithEle[lo], b = sampledWithEle[hi];
  if (a.cumM === b.cumM) return a.eleM;
  const t = (cumM - a.cumM) / (b.cumM - a.cumM);
  return a.eleM + t * (b.eleM - a.eleM);
}

for (const pt of points) {
  const demEleM = interpolateDEM(pt.cumM);
  const eleNode = pt.node.getElementsByTagName('ele')[0];
  if (eleNode) {
    eleNode.textContent = demEleM.toFixed(2);
  }
}

// ── Compute stats ─────────────────────────────────────────────────────────

const demEleMValues = points.map(p => interpolateDEM(p.cumM));
const originalEleMValues = points.map(p => p.originalEleM);

function gainLoss(eles: number[], thresholdM = 1.0): { gainFt: number; lossFt: number } {
  let gain = 0, loss = 0;
  for (let i = 1; i < eles.length; i++) {
    const d = eles[i] - eles[i - 1];
    if (d > thresholdM) gain += d;
    else if (d < -thresholdM) loss += -d;
  }
  return { gainFt: gain * 3.28084, lossFt: loss * 3.28084 };
}

const origStats = gainLoss(originalEleMValues);
const demStats  = gainLoss(demEleMValues);
const origPeakFt = Math.max(...originalEleMValues) * 3.28084;
const demPeakFt  = Math.max(...demEleMValues) * 3.28084;
const origNetFt  = (originalEleMValues[originalEleMValues.length - 1] - originalEleMValues[0]) * 3.28084;
const demNetFt   = (demEleMValues[demEleMValues.length - 1] - demEleMValues[0]) * 3.28084;

console.log('\n── Elevation comparison ───────────────────────────────────');
console.log(`                    GPS (original)    DEM (corrected)`);
console.log(`Peak elevation:     ${origPeakFt.toFixed(0).padStart(7)} ft         ${demPeakFt.toFixed(0).padStart(7)} ft`);
console.log(`Net (start→finish): ${origNetFt.toFixed(0).padStart(7)} ft         ${demNetFt.toFixed(0).padStart(7)} ft`);
console.log(`Total gain:         ${origStats.gainFt.toFixed(0).padStart(7)} ft         ${demStats.gainFt.toFixed(0).padStart(7)} ft`);
console.log(`Total loss:         ${origStats.lossFt.toFixed(0).padStart(7)} ft         ${demStats.lossFt.toFixed(0).padStart(7)} ft`);
console.log('───────────────────────────────────────────────────────────');

// ── Write corrected GPX ────────────────────────────────────────────────────

const corrected = new XMLSerializer().serializeToString(doc);
writeFileSync(outFile, corrected, 'utf8');
console.log(`\nWrote corrected GPX → ${outFile}`);
console.log(`Update your course facts JSON:`);
console.log(`  "peak_elevation_ft": ${Math.round(demPeakFt)}`);
console.log(`  "total_gain_ft": ${Math.round(demStats.gainFt)}`);
console.log(`  "total_loss_ft": ${Math.round(demStats.lossFt)}`);
console.log(`  "net_ft": ${Math.round(demNetFt)}`);
