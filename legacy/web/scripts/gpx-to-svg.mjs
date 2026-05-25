/**
 * gpx-to-svg.mjs — parse a GPX, output two compact SVG snippets:
 *   1. route polyline (normalized to 600x340)
 *   2. elevation profile (normalized to 600x140)
 *
 * Usage: node web/scripts/gpx-to-svg.mjs designs/sample-sombrero.gpx
 * Prints the two <svg> blocks to stdout.
 */
import { readFileSync } from 'node:fs';

const file = process.argv[2] || 'designs/sample-sombrero.gpx';
const xml = readFileSync(file, 'utf8');

const points = [];
const re = /<trkpt\s+lat="([\d.\-]+)"\s+lon="([\d.\-]+)"><ele>([\d.\-]+)<\/ele><\/trkpt>/g;
let m;
while ((m = re.exec(xml))) {
  points.push({ lat: +m[1], lon: +m[2], ele: +m[3] });
}

// Downsample if huge
const stride = Math.max(1, Math.floor(points.length / 500));
const pts = points.filter((_, i) => i % stride === 0);

// ── ROUTE polyline ──
const minLat = Math.min(...pts.map((p) => p.lat));
const maxLat = Math.max(...pts.map((p) => p.lat));
const minLon = Math.min(...pts.map((p) => p.lon));
const maxLon = Math.max(...pts.map((p) => p.lon));
const W = 600;
const H = 340;
const pad = 24;
const lonRange = maxLon - minLon || 1;
const latRange = maxLat - minLat || 1;
// Maintain aspect-roughly: scale by max range
const scale = Math.min((W - 2 * pad) / lonRange, (H - 2 * pad) / latRange);
const offsetX = (W - lonRange * scale) / 2;
const offsetY = (H - latRange * scale) / 2;
const xy = pts.map((p) => {
  const x = offsetX + (p.lon - minLon) * scale;
  const y = H - (offsetY + (p.lat - minLat) * scale);
  return [x, y];
});
const pathD = xy.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
const [sx, sy] = xy[0];
const [ex, ey] = xy[xy.length - 1];

// ── ELEVATION profile ──
const EW = 600;
const EH = 140;
const epad = 8;
const eles = pts.map((p) => p.ele);
const minEle = Math.min(...eles);
const maxEle = Math.max(...eles);
const eleRange = (maxEle - minEle) || 1;
const ascentFt = (() => {
  let asc = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = pts[i].ele - pts[i - 1].ele;
    if (d > 0) asc += d;
  }
  return Math.round(asc * 3.28084); // meters → feet (assume GPX in meters)
})();

const elePoints = eles.map((e, i) => {
  const x = epad + (i / (eles.length - 1)) * (EW - 2 * epad);
  const y = EH - epad - ((e - minEle) / eleRange) * (EH - 2 * epad);
  return [x, y];
});
const elePath = elePoints.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
const eleAreaPath = `${elePath} L${EW - epad},${EH - epad} L${epad},${EH - epad} Z`;

// Distance estimate
const haversine = (a, b) => {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
let meters = 0;
for (let i = 1; i < points.length; i++) meters += haversine(points[i - 1], points[i]);
const miles = (meters / 1609.344).toFixed(1);

console.log('━━━ STATS ━━━');
console.log(`points: ${points.length} (rendered ${pts.length})`);
console.log(`distance: ${miles} mi`);
console.log(`elevation: gain ${ascentFt} ft · min ${(minEle * 3.28084).toFixed(0)}ft · max ${(maxEle * 3.28084).toFixed(0)}ft`);
console.log('\n━━━ ROUTE SVG ━━━');
console.log(`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;">
  <path d="${pathD}" fill="none" stroke="#FF8847" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
  <circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="6" fill="#3EBD41" stroke="#0a0c10" stroke-width="2"/>
  <circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="6" fill="#F3AD38" stroke="#0a0c10" stroke-width="2"/>
</svg>`);
console.log('\n━━━ ELEVATION SVG ━━━');
console.log(`<svg viewBox="0 0 ${EW} ${EH}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;">
  <defs>
    <linearGradient id="eleFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FF8847" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#FF8847" stop-opacity="0.04"/>
    </linearGradient>
  </defs>
  <path d="${eleAreaPath}" fill="url(#eleFill)" stroke="none"/>
  <path d="${elePath}" fill="none" stroke="#FF8847" stroke-width="2" stroke-linejoin="round"/>
</svg>`);
