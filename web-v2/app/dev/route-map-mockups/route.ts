/**
 * GET /dev/route-map-mockups
 *
 * Auth-gated design-review page. Pulls the signed-in runner's most
 * recent GPS-tracked run from strava_activities and renders the four
 * candidate route-map styles against that real polyline · no paste,
 * no synthetic stub, no API token required. The leading card is
 * Style F+ (pace-graded route on a free OSM-derived dark map).
 *
 * Style F+ stack:
 *   · background  · CartoDB Dark Matter raster tiles · OpenStreetMap
 *                   data, freely licensed, no token required. CDN
 *                   served (basemaps.cartocdn.com). Attribution shown
 *                   in the bottom-right corner per OSM + CARTO terms.
 *   · library     · Leaflet 1.9 from unpkg CDN (~40KB gzip) · used
 *                   only to draw the tiles + fit the polyline bounds.
 *                   Interaction (zoom/pan) is disabled so the card
 *                   reads as a still image.
 *   · route       · Leaflet polylines, one per pace bucket. Each
 *                   segment colored by the runner's actual per-mile
 *                   pace (faster warmer, slower cooler · same effort-
 *                   temperature semantics as the EFF dots).
 *
 * Comparison styles below (all SVG-only, no external deps):
 *   A · Current production stripped (flat dark + grid)
 *   B · Cream paper · Apple Health pocket-map feel
 *   C · Topo blueprint · navy with iso-contour rings
 *   F · Pace-graded route on flat dark fill (no map background)
 *
 * Override the run with ?id=<activityId> to compare a specific run.
 *
 * Mapbox / Maptiler / paid tile vendors NOT used · the question
 * "why do I need Mapbox?" answered itself · we don't.
 */
import { NextRequest, NextResponse } from 'next/server';
import { userIdFromCookies } from '@/lib/auth/session';
import { pool } from '@/lib/db/pool';

export const dynamic = 'force-dynamic';

interface RunSummary {
  id: string;
  name: string | null;
  date: string | null;
  distanceMi: number | null;
  durationSec: number | null;
  polyline: string | null;
  splits: Array<{ mile: number; pace_s_per_mi: number | null }>;
}

async function loadRun(userId: string, activityId: string | null): Promise<RunSummary | null> {
  const where = activityId
    ? `AND (data->>'id' = $2 OR data->>'activityId' = $2 OR id::text = $2)`
    : `AND COALESCE(data->>'summaryPolyline', data->>'routePolyline') IS NOT NULL
       AND NOT (data ? 'mergedIntoId')`;
  const order = activityId
    ? `LIMIT 1`
    : `ORDER BY COALESCE(data->>'date', LEFT(data->>'startLocal',10)) DESC NULLS LAST LIMIT 1`;
  const args: any[] = [userId];
  if (activityId) args.push(activityId);

  const r = await pool.query(
    `SELECT id::text AS id,
            data->>'name' AS name,
            COALESCE(data->>'date', LEFT(data->>'startLocal',10)) AS date,
            (data->>'distanceMi')::numeric AS dist,
            (data->>'durationSec')::numeric AS dur,
            COALESCE(data->>'summaryPolyline', data->>'routePolyline') AS poly,
            data->'splits' AS splits
       FROM strava_activities
      WHERE user_uuid = $1
        ${where}
      ${order}`,
    args,
  ).catch(() => ({ rows: [] as any[] }));

  const row = r.rows[0];
  if (!row) return null;
  const splits: Array<{ mile: number; pace_s_per_mi: number | null }> = [];
  if (Array.isArray(row.splits)) {
    for (let i = 0; i < row.splits.length; i++) {
      const s: any = row.splits[i];
      // pace_s_per_mi might be a raw field, or we parse "m:ss" from s.pace.
      let sec: number | null = null;
      if (typeof s.pace_s_per_mi === 'number') sec = s.pace_s_per_mi;
      else if (typeof s.pace === 'string') {
        const m = s.pace.match(/^(\d+):(\d{2})$/);
        if (m) sec = Number(m[1]) * 60 + Number(m[2]);
      }
      splits.push({ mile: Number(s.mile ?? i + 1), pace_s_per_mi: sec });
    }
  }
  return {
    id: row.id,
    name: row.name ?? null,
    date: row.date ?? null,
    distanceMi: row.dist != null ? Number(row.dist) : null,
    durationSec: row.dur != null ? Number(row.dur) : null,
    polyline: row.poly ?? null,
    splits,
  };
}

export async function GET(req: NextRequest) {
  const userId = await userIdFromCookies();
  if (!userId) {
    return NextResponse.redirect(new URL('/login?next=/dev/route-map-mockups', req.url));
  }
  const activityId = req.nextUrl.searchParams.get('id');
  const run = await loadRun(userId, activityId);
  const html = renderHtml(run);
  return new NextResponse(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'private, no-cache',
    },
  });
}

function renderHtml(run: RunSummary | null): string {
  const polyline = run?.polyline ?? '';
  const splitsJson = JSON.stringify(run?.splits ?? []);
  const runMeta = run
    ? `${run.name ?? 'Run'} · ${run.distanceMi?.toFixed(1) ?? '?'} mi · ${run.date ?? ''}`
    : 'No GPS run found · paste a polyline below';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Route map mockups · live preview</title>
<meta name="viewport" content="width=1400">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin=""/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
<style>
  :root{
    --bg:#0A0C10; --ink:#F6F7F8; --mute:#8A90A0;
    --c1:#FFD2A4; --c2:#FF9A54; --c3:#FB6E3C; --c4:#F4502F; --c5:#E23A47; --base:#9E2438;
  }
  html,body{margin:0;padding:0;font-family:'Inter',sans-serif;background:var(--bg);color:var(--ink);min-height:100vh;}
  body{background:var(--base);position:relative;overflow-x:hidden;}
  .meshwrap{position:fixed;inset:0;z-index:0;background:var(--base);overflow:hidden;}
  .blobs{position:absolute;inset:-12%;filter:blur(46px);}
  .blob{position:absolute;border-radius:50%;opacity:.92;}
  .b1{left:-12%;top:-14%;width:74%;height:74%;background:var(--c1);}
  .b2{left:34%;top:-10%;width:70%;height:72%;background:var(--c2);}
  .b3{left:4%;top:18%;width:96%;height:88%;background:var(--c5);}
  .b4{left:-16%;top:42%;width:78%;height:78%;background:var(--c4);}
  .b5{left:30%;top:40%;width:80%;height:80%;background:var(--c3);}
  .fade{position:fixed;inset:0;z-index:1;background:linear-gradient(180deg,rgba(0,0,0,.36),rgba(0,0,0,0) 26%,rgba(0,0,0,0) 56%,rgba(0,0,0,.46));pointer-events:none;}
  .wrap{position:relative;z-index:2;max-width:1320px;margin:0 auto;padding:60px 32px 100px;}
  h1{font-family:'Oswald',sans-serif;font-weight:700;font-size:58px;line-height:.92;letter-spacing:-1px;margin:0;text-transform:uppercase;}
  .lede{color:rgba(246,247,248,.86);margin-top:16px;font-size:15px;max-width:780px;line-height:1.55;}
  .runmeta{margin-top:12px;font-family:'JetBrains Mono',monospace;font-size:12px;color:#FFCE8A;}
  .runmeta strong{color:#fff;}
  .controls{background:rgba(8,10,14,.55);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:16px 18px;margin:22px 0 28px;display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap;}
  .controls > div{flex:1;min-width:240px;display:flex;flex-direction:column;gap:6px;}
  .controls label{font-size:11px;font-weight:700;letter-spacing:1.4px;color:rgba(255,255,255,.7);}
  .controls textarea, .controls input{width:100%;background:rgba(8,10,14,.7);color:#FFE7C2;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:10px 12px;font-family:'JetBrains Mono',monospace;font-size:11.5px;}
  .controls textarea{min-height:54px;resize:vertical;}
  .controls button{background:#FF8847;color:#0a0c10;font-weight:700;letter-spacing:.6px;border:none;border-radius:10px;padding:11px 22px;cursor:pointer;font-size:13px;}
  .hint{color:rgba(246,247,248,.6);font-size:11.5px;line-height:1.4;}
  code{background:rgba(255,255,255,.06);padding:1px 6px;border-radius:4px;font-family:'JetBrains Mono',monospace;font-size:11.5px;color:#FFC98A;}

  .featured{margin-bottom:32px;}
  .featured .card-head .badge.fav{background:#FFCE8A;color:#0a0c10;}

  .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;}
  @media (max-width:1100px){.grid{grid-template-columns:1fr;}}

  .card{background:rgba(8,10,14,.42);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:0;overflow:hidden;}
  .featured .card{border-color:rgba(255,206,138,.4);box-shadow:0 26px 60px -20px rgba(0,0,0,.65);}
  .card-head{padding:18px 22px 14px;border-bottom:1px solid rgba(255,255,255,.06);}
  .card-head h3{margin:0;font-family:'Oswald',sans-serif;font-size:22px;font-weight:600;letter-spacing:.3px;}
  .card-head .badge{display:inline-block;padding:3px 9px;border-radius:5px;font-size:10px;letter-spacing:1.2px;font-weight:700;margin-left:8px;vertical-align:middle;}
  .badge.svg{background:rgba(143,240,176,.18);color:#86efa0;}
  .badge.token{background:rgba(255,206,138,.18);color:#FFCE8A;}
  .badge.compute{background:rgba(176,132,255,.18);color:#B084FF;}
  .card-head .note{color:rgba(246,247,248,.7);margin-top:6px;font-size:12.5px;line-height:1.5;}

  .map-frame{height:340px;position:relative;background:#0A0C10;}
  .featured .map-frame{height:520px;}
  .map-frame svg, .map-frame img{display:block;width:100%;height:100%;}
  .map-frame .overlay{position:absolute;inset:0;pointer-events:none;}
  .map-frame .placeholder{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;color:rgba(246,247,248,.5);font-size:12px;line-height:1.6;padding:18px;}
  .map-frame .placeholder strong{color:#FFCE8A;display:block;margin-bottom:6px;}

  .style-a{background:repeating-linear-gradient(0deg, rgba(255,255,255,.05) 0 1px, transparent 1px 28px),repeating-linear-gradient(90deg, rgba(255,255,255,.05) 0 1px, transparent 1px 28px),linear-gradient(155deg, rgba(8,14,22,.85), rgba(4,18,16,.78));}
  .style-b{background:radial-gradient(120% 100% at 20% 10%, #fff5e0, #f3e6c6 70%, #e7d6ab 100%);}
  .style-c{background:radial-gradient(50% 60% at 50% 50%, rgba(64,180,224,.10), transparent 70%),repeating-radial-gradient(circle at 50% 50%, rgba(64,180,224,.16) 0 1px, transparent 1px 32px),linear-gradient(135deg, #0a1320, #0b1d2c 70%);}

  .card-foot{padding:14px 22px;border-top:1px solid rgba(255,255,255,.06);display:flex;justify-content:space-between;align-items:center;color:rgba(246,247,248,.62);font-size:11.5px;}
  .card-foot .pros{color:#86efa0;}
  .card-foot .cons{color:#FFCE8A;}

  /* Pace legend that sits below the featured map */
  .pace-legend{display:flex;gap:14px;padding:14px 22px;font-size:11px;font-weight:600;letter-spacing:.4px;color:rgba(246,247,248,.7);border-top:1px solid rgba(255,255,255,.06);}
  .pace-legend .swatch{display:inline-block;width:14px;height:6px;border-radius:3px;margin-right:6px;vertical-align:middle;}
</style>
</head>
<body>

<div class="meshwrap" aria-hidden="true">
  <div class="blobs">
    <div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div>
    <div class="blob b4"></div><div class="blob b5"></div>
  </div>
</div>
<div class="fade" aria-hidden="true"></div>

<div class="wrap">
  <h1>Route map · live preview</h1>
  <p class="lede">
    All six candidate styles rendered against your actual run · no paste, no synthetic stub. Style F+ (pace-graded route on a real darker map) leads · the others below for comparison.
  </p>
  <div class="runmeta">RUN · <strong>${runMeta.replace(/[<>]/g, '')}</strong></div>

  <div class="controls">
    <div>
      <label for="poly">ENCODED POLYLINE · loaded from your run</label>
      <textarea id="poly" spellcheck="false">${polyline.replace(/[<>"]/g, '')}</textarea>
      <span class="hint">Override with <code>?id=&lt;activityId&gt;</code> in the URL to load a different run. No API tokens needed · the dark map is OpenStreetMap data via CartoDB's free CDN.</span>
    </div>
    <div style="flex:0 0 auto;">
      <button id="render">RENDER</button>
    </div>
  </div>

  <!-- Featured · Style F+ · pace-graded route on real OSM dark map -->
  <div class="featured">
    <div class="card">
      <div class="card-head">
        <h3>F+ · Pace-graded route on dark map <span class="badge fav">RECOMMENDED</span> <span class="badge svg">FREE TILES</span></h3>
        <p class="note">CartoDB Dark Matter tiles (OpenStreetMap data, free, no token) as the actual map background. Leaflet draws the tiles and your route on top, with per-mile pace coloring · faster miles burn warmer, slower miles cool toward teal. The map is darker than the route so the line pops. Real streets, real parks, real water · all the OSM data without paying a vendor.</p>
      </div>
      <div class="map-frame" id="map-fplus"></div>
      <div class="pace-legend" id="pace-legend"></div>
    </div>
  </div>

  <div class="grid">
    <div class="card">
      <div class="card-head"><h3>A · Current stripped <span class="badge svg">SVG</span></h3><p class="note">What's on /today right now · plain coral stroke on dark grid · honest schematic, no real terrain.</p></div>
      <div class="map-frame style-a" id="map-a"></div>
    </div>
    <div class="card">
      <div class="card-head"><h3>B · Cream paper <span class="badge svg">SVG</span></h3><p class="note">Light cream / parchment · Apple Health pocket-map feel · contrasts hard against orange mesh.</p></div>
      <div class="map-frame style-b" id="map-b"></div>
    </div>
    <div class="card">
      <div class="card-head"><h3>C · Topo blueprint <span class="badge svg">SVG</span></h3><p class="note">Dark navy with cyan iso-contour rings · feels schematic, not photo-real.</p></div>
      <div class="map-frame style-c" id="map-c"></div>
    </div>
    <div class="card">
      <div class="card-head"><h3>F · Pace-graded on dark fill <span class="badge compute">SVG + DATA</span></h3><p class="note">Same pace coloring as F+ but on a flat dark fill instead of real map tiles. No external requests at all · pure SVG.</p></div>
      <div class="map-frame style-a" id="map-f"></div>
    </div>
  </div>
</div>

<script>
const SPLITS = ${splitsJson};

function decodePolyline(encoded) {
  if (!encoded) return [];
  const points = [];
  let index = 0, lat = 0, lng = 0;
  const len = encoded.length;
  while (index < len) {
    let shift = 0, result = 0, b;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    points.push([lat * 1e-5, lng * 1e-5]);
  }
  return points;
}

// Equal-area projection within bbox · used by SVG-only cards (A/B/C/F).
function projectFlat(points, viewW, viewH, pad) {
  if (points.length < 2) return null;
  let minLat = points[0][0], maxLat = points[0][0];
  let minLng = points[0][1], maxLng = points[0][1];
  for (const [lat, lng] of points) {
    if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
  }
  const midLat = (minLat + maxLat) / 2;
  const lngScale = Math.cos(midLat * Math.PI / 180);
  const xSpan = (maxLng - minLng) * lngScale || 1e-9;
  const ySpan = (maxLat - minLat) || 1e-9;
  const w = viewW - 2 * pad, h = viewH - 2 * pad;
  const scale = Math.min(w / xSpan, h / ySpan);
  const offX = pad + (w - xSpan * scale) / 2;
  const offY = pad + (h - ySpan * scale) / 2;
  return points.map(([lat, lng]) => [
    offX + (lng - minLng) * lngScale * scale,
    offY + (maxLat - lat) * scale,
  ]);
}

// Proper Web Mercator projection · used by F+ to align SVG over Mapbox tiles.
function mercatorYFraction(lat) {
  const rad = lat * Math.PI / 180;
  return (1 - Math.log(Math.tan(Math.PI / 4 + rad / 2)) / Math.PI) / 2;
}
function projectMercator(points, viewW, viewH, padFrac) {
  if (points.length < 2) return null;
  let minLat = points[0][0], maxLat = points[0][0];
  let minLng = points[0][1], maxLng = points[0][1];
  for (const [lat, lng] of points) {
    if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
  }
  // Add padding fraction to bbox so route doesn't touch tile edges.
  const latPad = (maxLat - minLat) * padFrac;
  const lngPad = (maxLng - minLng) * padFrac;
  minLat -= latPad; maxLat += latPad;
  minLng -= lngPad; maxLng += lngPad;

  const minY = mercatorYFraction(maxLat);
  const maxY = mercatorYFraction(minLat);
  const lngSpan = (maxLng - minLng) || 1e-9;
  const ySpan = (maxY - minY) || 1e-9;

  // Pick the zoom so the bbox fits in viewW x viewH.
  const zoomX = Math.log2(viewW / (256 * (lngSpan / 360)));
  const zoomY = Math.log2(viewH / (256 * ySpan));
  const zoom = Math.min(zoomX, zoomY);
  const centerLng = (minLng + maxLng) / 2;
  const centerLat = (minLat + maxLat) / 2;

  // World size at this zoom (px)
  const worldSize = 256 * Math.pow(2, zoom);

  function project(lat, lng) {
    const xWorld = ((lng + 180) / 360) * worldSize;
    const yWorld = mercatorYFraction(lat) * worldSize;
    const xCenter = ((centerLng + 180) / 360) * worldSize;
    const yCenter = mercatorYFraction(centerLat) * worldSize;
    return [viewW / 2 + (xWorld - xCenter), viewH / 2 + (yWorld - yCenter)];
  }
  return {
    pts: points.map(p => project(p[0], p[1])),
    centerLat, centerLng, zoom,
  };
}

// Pace bucketing · split the route into 6 buckets, color each by
// the avg pace bucket of the splits whose miles fall in that bucket.
function paceBuckets(splits) {
  const valid = splits.filter(s => s.pace_s_per_mi != null && s.pace_s_per_mi > 0);
  if (valid.length < 2) return null;
  const paces = valid.map(s => s.pace_s_per_mi).sort((a, b) => a - b);
  // Quintile buckets · fastest 20%, then 20% increments
  const q = [
    paces[Math.floor(paces.length * 0.20)],
    paces[Math.floor(paces.length * 0.40)],
    paces[Math.floor(paces.length * 0.60)],
    paces[Math.floor(paces.length * 0.80)],
  ];
  function bucket(sec) {
    if (sec <= q[0]) return 0;
    if (sec <= q[1]) return 1;
    if (sec <= q[2]) return 2;
    if (sec <= q[3]) return 3;
    return 4;
  }
  const colors = ['#FC4D64', '#FF8847', '#F3AD38', '#48B3B5', '#27B4E0'];
  // Faster paces = warmer (red/orange · effort hot) · slower = cooler (teal · easy)
  return { bucket, colors, quintiles: q };
}

function fmtPace(sec) {
  if (!sec) return '·';
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return m + ':' + String(s).padStart(2, '0');
}

/* ─── Renderers ─────────────────────────────────────────── */

const VW = 700, VH = 380, PAD = 22, FEATURED_H = 520;

function svgWrap(pathD, pts, color, hasMarkers) {
  let body = '<path d="' + pathD + '" fill="none" stroke="' + color + '" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>';
  if (hasMarkers && pts.length >= 2) {
    // Endpoints
    body += '<circle cx="' + pts[0][0].toFixed(1) + '" cy="' + pts[0][1].toFixed(1) + '" r="6" fill="#04201f" stroke="#14C08C" stroke-width="2.4"/>';
    const last = pts[pts.length-1];
    body += '<circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="6" fill="' + color + '" stroke="#fff" stroke-width="1.8"/>';
  }
  return '<svg viewBox="0 0 ' + VW + ' ' + VH + '" preserveAspectRatio="xMidYMid meet">' + body + '</svg>';
}

function renderA(host, pts) {
  if (!pts) return;
  const pathD = pts.map((p, i) => (i===0?'M':'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  host.innerHTML = svgWrap(pathD, pts, '#FF8847', true);
}
function renderB(host, pts) {
  if (!pts) return;
  const pathD = pts.map((p, i) => (i===0?'M':'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  let body = '<path d="' + pathD + '" fill="none" stroke="#2b1d12" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>';
  body += '<circle cx="' + pts[0][0].toFixed(1) + '" cy="' + pts[0][1].toFixed(1) + '" r="5" fill="#fff5e0" stroke="#1f8a68" stroke-width="2.4"/>';
  const last = pts[pts.length-1];
  body += '<circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="5" fill="#E23A47" stroke="#fff5e0" stroke-width="1.8"/>';
  host.innerHTML = '<svg viewBox="0 0 ' + VW + ' ' + VH + '" preserveAspectRatio="xMidYMid meet">' + body + '</svg>';
}
function renderC(host, pts) {
  if (!pts) return;
  const pathD = pts.map((p, i) => (i===0?'M':'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  let body =
    '<defs><linearGradient id="cstroke" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#FFC98A"/><stop offset="1" stop-color="#FF6E3C"/>' +
    '</linearGradient></defs>' +
    '<path d="' + pathD + '" fill="none" stroke="url(#cstroke)" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>';
  body += '<circle cx="' + pts[0][0].toFixed(1) + '" cy="' + pts[0][1].toFixed(1) + '" r="6" fill="#0a1320" stroke="#86efa0" stroke-width="2.4"/>';
  const last = pts[pts.length-1];
  body += '<circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="6" fill="#FF8847" stroke="#fff" stroke-width="1.8"/>';
  host.innerHTML = '<svg viewBox="0 0 ' + VW + ' ' + VH + '" preserveAspectRatio="xMidYMid meet">' + body + '</svg>';
}

/* Render the featured F+ card · Leaflet map with CartoDB Dark Matter
   tiles + pace-graded polyline segments overlaid as native Leaflet
   polylines. No tokens, no env vars, no Mapbox. */
let leafletMap = null;
function renderFPlus(host, points) {
  if (!points || points.length < 2) {
    host.innerHTML = '<div class="placeholder"><strong>No polyline</strong>nothing to draw</div>';
    return;
  }
  if (typeof L === 'undefined') {
    host.innerHTML = '<div class="placeholder"><strong>Leaflet failed to load</strong>check your network</div>';
    return;
  }
  // Reset the host · Leaflet needs a clean container each render.
  host.innerHTML = '';
  host.style.position = 'relative';
  if (leafletMap) { leafletMap.remove(); leafletMap = null; }

  leafletMap = L.map(host, {
    zoomControl: false,
    attributionControl: true,
    dragging: false,
    touchZoom: false,
    doubleClickZoom: false,
    scrollWheelZoom: false,
    boxZoom: false,
    keyboard: false,
    tap: false,
  });

  // CartoDB Dark Matter · free OSM-derived dark tiles. Attribution
  // required (shown bottom-right by default).
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png', {
    subdomains: 'abcd',
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  }).addTo(leafletMap);

  const buckets = paceBuckets(SPLITS);
  if (buckets && SPLITS.length >= 2) {
    // Walk the polyline by Haversine distance · split into segments by
    // pace bucket so each Leaflet polyline gets a single color.
    const EARTH_MI = 3958.7613;
    function distMi(a, b) {
      const toRad = d => d * Math.PI / 180;
      const dLat = toRad(b[0] - a[0]), dLng = toRad(b[1] - a[1]);
      const x = Math.sin(dLat/2)**2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng/2)**2;
      return 2 * EARTH_MI * Math.asin(Math.min(1, Math.sqrt(x)));
    }
    let total = 0;
    let segStartIdx = 0;
    let lastBucket = null;
    function flush(endIdx, b) {
      if (segStartIdx >= endIdx || b == null) return;
      const segPts = points.slice(segStartIdx, endIdx + 1);
      L.polyline(segPts, {
        color: buckets.colors[b],
        weight: 5,
        opacity: 1,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(leafletMap);
    }
    for (let i = 0; i < points.length; i++) {
      if (i > 0) total += distMi(points[i-1], points[i]);
      const mile = Math.floor(total);
      const split = SPLITS[Math.min(mile, SPLITS.length - 1)];
      const b = split && split.pace_s_per_mi ? buckets.bucket(split.pace_s_per_mi) : null;
      if (lastBucket == null) lastBucket = b;
      if (b !== lastBucket) {
        flush(i, lastBucket);
        segStartIdx = i;
        lastBucket = b;
      }
    }
    flush(points.length - 1, lastBucket);
  } else {
    // No splits · render as a single coral stroke.
    L.polyline(points, { color: '#FF8847', weight: 5, opacity: 1, lineCap: 'round' }).addTo(leafletMap);
  }

  // Endpoint markers · circle markers so they scale with zoom.
  L.circleMarker(points[0], {
    radius: 7, fillColor: '#04201f', color: '#14C08C', weight: 3, fillOpacity: 1,
  }).addTo(leafletMap);
  L.circleMarker(points[points.length - 1], {
    radius: 7, fillColor: '#FF8847', color: '#fff', weight: 2, fillOpacity: 1,
  }).addTo(leafletMap);

  // Fit the map to the route's bounds with a small padding so the line
  // doesn't touch the edges.
  const bounds = L.latLngBounds(points);
  leafletMap.fitBounds(bounds, { padding: [24, 24] });
}

function renderF(host, pts) {
  if (!pts) return;
  const buckets = paceBuckets(SPLITS);
  let segments = '';
  if (buckets && SPLITS.length >= 2) {
    // Walk pts assigning bucket by approx-distance · use index ratio as
    // a proxy when no Haversine in SVG-only mode (good enough for the
    // flat-fill card; F+ does the proper distance walk).
    const N = pts.length;
    let lastIdx = 0, lastBucket = null;
    for (let i = 0; i < N; i++) {
      const mile = Math.floor(i / N * SPLITS.length);
      const split = SPLITS[Math.min(mile, SPLITS.length - 1)];
      const b = split && split.pace_s_per_mi ? buckets.bucket(split.pace_s_per_mi) : null;
      if (lastBucket == null) lastBucket = b;
      if (b !== lastBucket) {
        const seg = pts.slice(lastIdx, i + 1);
        const d = seg.map((p, j) => (j===0?'M':'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
        segments += '<path d="' + d + '" fill="none" stroke="' + buckets.colors[lastBucket] + '" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>';
        lastIdx = i;
        lastBucket = b;
      }
    }
    const seg = pts.slice(lastIdx);
    const d = seg.map((p, j) => (j===0?'M':'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    segments += '<path d="' + d + '" fill="none" stroke="' + buckets.colors[lastBucket || 2] + '" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>';
  } else {
    const d = pts.map((p, i) => (i===0?'M':'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    segments = '<path d="' + d + '" fill="none" stroke="#FF8847" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>';
  }
  segments += '<circle cx="' + pts[0][0].toFixed(1) + '" cy="' + pts[0][1].toFixed(1) + '" r="6" fill="#04201f" stroke="#14C08C" stroke-width="2.4"/>';
  const last = pts[pts.length-1];
  segments += '<circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="6" fill="#FC4D64" stroke="#fff" stroke-width="1.8"/>';
  host.innerHTML = '<svg viewBox="0 0 ' + VW + ' ' + VH + '" preserveAspectRatio="xMidYMid meet">' + segments + '</svg>';
}

function encodePolyline(points) {
  let prevLat = 0, prevLng = 0, out = '';
  for (const [lat, lng] of points) {
    const cLat = Math.round(lat * 1e5), cLng = Math.round(lng * 1e5);
    out += encodeSigned(cLat - prevLat); out += encodeSigned(cLng - prevLng);
    prevLat = cLat; prevLng = cLng;
  }
  return out;
}
function encodeSigned(v) {
  v = v < 0 ? ~(v << 1) : (v << 1);
  let out = '';
  while (v >= 0x20) { out += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>>= 5; }
  out += String.fromCharCode(v + 63);
  return out;
}

function buildLegend(host) {
  const buckets = paceBuckets(SPLITS);
  if (!buckets) { host.style.display = 'none'; return; }
  const labels = ['Fastest', 'Fast', 'Mid', 'Easier', 'Slowest'];
  let out = 'PACE  ';
  for (let i = 0; i < 5; i++) {
    out += '<span style="margin-right:14px"><span class="swatch" style="background:' + buckets.colors[i] + '"></span>' + labels[i] + ' &lt; ' + (buckets.quintiles[i] ? fmtPace(buckets.quintiles[i]) : '·') + '/mi</span>';
  }
  host.innerHTML = out;
}

function renderAll() {
  const encoded = document.getElementById('poly').value.trim();
  const points = decodePolyline(encoded);
  buildLegend(document.getElementById('pace-legend'));
  if (points.length < 2) {
    document.getElementById('map-fplus').innerHTML = '<div class="placeholder"><strong>Bad / empty polyline</strong>paste one above</div>';
    return;
  }
  const flatPts = projectFlat(points, VW, VH, PAD);
  renderA(document.getElementById('map-a'), flatPts);
  renderB(document.getElementById('map-b'), flatPts);
  renderC(document.getElementById('map-c'), flatPts);
  renderF(document.getElementById('map-f'), flatPts);
  // Featured F+ · CartoDB Dark Matter via Leaflet · no token required.
  renderFPlus(document.getElementById('map-fplus'), points);
}

document.getElementById('render').addEventListener('click', renderAll);
renderAll();
</script>

</body>
</html>`;
}
