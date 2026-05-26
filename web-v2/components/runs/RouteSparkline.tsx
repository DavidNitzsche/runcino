/**
 * RouteSparkline — decodes a Strava-style encoded polyline into lat/lng
 * pairs and draws the route as an SVG path. Doesn't replace a real map
 * tile provider, but shows the route SHAPE immediately so the modal
 * isn't just a "map render lands later" placeholder.
 *
 * Polyline encoding ref: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */

export function RouteSparkline({ polyline, height = 220 }: { polyline: string; height?: number }) {
  const pts = decodePolyline(polyline);
  if (pts.length < 2) return null;

  // Normalize lat/lng into the SVG box
  const lats = pts.map((p) => p[0]);
  const lngs = pts.map((p) => p[1]);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const latSpan = Math.max(0.0001, maxLat - minLat);
  const lngSpan = Math.max(0.0001, maxLng - minLng);

  // Aspect: lng is east-west (x), lat is north-south (y, flipped)
  // Latitude-aware longitude scaling so the shape isn't squashed.
  const centerLat = (maxLat + minLat) / 2;
  const lngScale = Math.cos(centerLat * Math.PI / 180);
  const aspect = (lngSpan * lngScale) / latSpan;
  const W = 600, PAD = 8;
  const innerW = W - PAD * 2;
  const innerH = height - PAD * 2;

  // Fit while preserving aspect
  let drawW = innerW, drawH = innerW / aspect;
  if (drawH > innerH) { drawH = innerH; drawW = innerH * aspect; }
  const offX = PAD + (innerW - drawW) / 2;
  const offY = PAD + (innerH - drawH) / 2;

  const project = (lat: number, lng: number) => {
    const x = offX + ((lng - minLng) * lngScale / (lngSpan * lngScale)) * drawW;
    const y = offY + (1 - (lat - minLat) / latSpan) * drawH;
    return [x, y];
  };

  // Build the path d-string
  const d = pts.map(([lat, lng], i) => {
    const [x, y] = project(lat, lng);
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  // Start + finish markers
  const [startX, startY] = project(pts[0][0], pts[0][1]);
  const [endX, endY]     = project(pts[pts.length - 1][0], pts[pts.length - 1][1]);

  return (
    <svg viewBox={`0 0 ${W} ${height}`} style={{ width: '100%', height: 'auto', maxHeight: height, display: 'block' }}>
      {/* Glow underlay */}
      <path d={d} fill="none" stroke="rgba(39,180,224,0.20)" strokeWidth={8} strokeLinejoin="round" strokeLinecap="round" />
      <path d={d} fill="none" stroke="var(--dist)"          strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      {/* Start: green dot · Finish: race orange */}
      <circle cx={startX} cy={startY} r={5} fill="var(--green)" stroke="#0a0a0c" strokeWidth={1.5} />
      <circle cx={endX}   cy={endY}   r={5} fill="var(--race)"  stroke="#0a0a0c" strokeWidth={1.5} />
    </svg>
  );
}

/** Decode a Google/Strava-encoded polyline string into [lat, lng] pairs. */
function decodePolyline(str: string): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  let index = 0, lat = 0, lng = 0;
  while (index < str.length) {
    let b: number, shift = 0, result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += dlat;
    shift = 0; result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lng += dlng;
    pts.push([lat / 1e5, lng / 1e5]);
  }
  return pts;
}
