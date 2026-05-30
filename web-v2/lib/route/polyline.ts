/**
 * Decode Google's encoded polyline format (used by Strava + Google Maps).
 * Returns an array of [lat, lng] pairs.
 *
 * Format spec: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 *
 * Used by RaceView, WorkoutDetail, and RunDetailModal to draw the actual
 * route shape instead of a hardcoded placeholder polyline.
 */
export function decodePolyline(encoded: string): Array<[number, number]> {
  if (!encoded) return [];
  const points: Array<[number, number]> = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const len = encoded.length;

  while (index < len) {
    // Decode lat
    let shift = 0;
    let result = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dLat = (result & 1) ? ~(result >> 1) : (result >> 1);
    lat += dLat;

    // Decode lng
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dLng = (result & 1) ? ~(result >> 1) : (result >> 1);
    lng += dLng;

    points.push([lat * 1e-5, lng * 1e-5]);
  }

  return points;
}

/**
 * Project a [lat, lng] sequence to an SVG path string inside the given viewBox.
 * Equal-area projection within the route's bounding box — preserves shape
 * for runs (~5-20 mi). Padding leaves room for endpoint dots.
 *
 * @returns The SVG path `d` attribute string, or null when the input is empty
 *   or degenerate (all points stacked at one location).
 */
export function polylineToSvgPath(
  points: Array<[number, number]>,
  viewW: number,
  viewH: number,
  pad = 10,
): string | null {
  if (points.length < 2) return null;

  let minLat = points[0][0], maxLat = points[0][0];
  let minLng = points[0][1], maxLng = points[0][1];
  for (const [lat, lng] of points) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  const latSpan = maxLat - minLat;
  const lngSpan = maxLng - minLng;
  if (latSpan === 0 && lngSpan === 0) return null;

  // Mercator-ish: scale lng by cos(midLat) so distance ratios feel right
  // for short routes. For a marathon at 35°N this brings the east-west
  // axis in line with north-south so the route shape doesn't squish.
  const midLat = (minLat + maxLat) / 2;
  const lngScale = Math.cos((midLat * Math.PI) / 180);
  const xSpan = lngSpan * lngScale || 1e-9;
  const ySpan = latSpan || 1e-9;

  // Fit into viewBox preserving aspect ratio
  const w = viewW - 2 * pad;
  const h = viewH - 2 * pad;
  const scale = Math.min(w / xSpan, h / ySpan);
  const drawW = xSpan * scale;
  const drawH = ySpan * scale;
  const offX = pad + (w - drawW) / 2;
  const offY = pad + (h - drawH) / 2;

  const project = ([lat, lng]: [number, number]): [number, number] => {
    const x = offX + (lng - minLng) * lngScale * scale;
    // Flip Y — SVG y axis points down; higher lat → smaller y.
    const y = offY + (maxLat - lat) * scale;
    return [x, y];
  };

  // Build the SVG path. Sample to keep it cheap — for routes with thousands
  // of points (long runs), one path command per ~3 input points still draws
  // a smooth shape at typical card sizes.
  const stride = Math.max(1, Math.floor(points.length / 600));
  const cmds: string[] = [];
  for (let i = 0; i < points.length; i += stride) {
    const [x, y] = project(points[i]);
    cmds.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`);
  }
  // Always include the last point
  if ((points.length - 1) % stride !== 0) {
    const [x, y] = project(points[points.length - 1]);
    cmds.push(`L${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return cmds.join(' ');
}

/** Project [lat, lng] start + end to their SVG (x, y) so callers can drop
 *  endpoint dots over the route. Mirrors polylineToSvgPath's projection. */
export function polylineEndpoints(
  points: Array<[number, number]>,
  viewW: number,
  viewH: number,
  pad = 10,
): { start: [number, number]; end: [number, number] } | null {
  if (points.length < 2) return null;
  let minLat = points[0][0], maxLat = points[0][0];
  let minLng = points[0][1], maxLng = points[0][1];
  for (const [lat, lng] of points) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  const latSpan = maxLat - minLat || 1e-9;
  const lngSpan = maxLng - minLng || 1e-9;
  const midLat = (minLat + maxLat) / 2;
  const lngScale = Math.cos((midLat * Math.PI) / 180);
  const xSpan = lngSpan * lngScale || 1e-9;
  const w = viewW - 2 * pad;
  const h = viewH - 2 * pad;
  const scale = Math.min(w / xSpan, h / latSpan);
  const offX = pad + (w - xSpan * scale) / 2;
  const offY = pad + (h - latSpan * scale) / 2;
  const project = ([lat, lng]: [number, number]): [number, number] => [
    offX + (lng - minLng) * lngScale * scale,
    offY + (maxLat - lat) * scale,
  ];
  return { start: project(points[0]), end: project(points[points.length - 1]) };
}

/**
 * Build an SVG elevation-profile path from per-mile elev_change_ft values.
 * Returns both the line path and a filled-area path so callers can render
 * the chart with a gradient underfill. Path is normalized into the given
 * viewBox.
 *
 * Cumulative integration: at mile i the elevation = sum(changes 0..i).
 * The curve floor floats to whatever the min cumulative elevation is so the
 * shape uses the full vertical range.
 */
export function elevPathFromSplits(
  splits: Array<{ elev_change_ft: number | null }>,
  viewW: number,
  viewH: number,
  pad = 4,
): { line: string; area: string } | null {
  if (!splits || splits.length < 2) return null;
  const changes = splits.map((s) => Number(s.elev_change_ft) || 0);
  // Cumulative elevation starting at 0
  const cum: number[] = [0];
  for (let i = 0; i < changes.length; i++) cum.push(cum[i] + changes[i]);
  const lo = Math.min(...cum);
  const hi = Math.max(...cum);
  const span = hi - lo || 1;
  // Skip drawing if the range is essentially flat (< ~3 ft over the run)
  // — the fake-looking zigzag was worse than honest flatness.
  if (span < 3) return null;

  const w = viewW - 2 * pad;
  const h = viewH - 2 * pad;
  const pts: Array<[number, number]> = cum.map((v, i) => [
    pad + (i / (cum.length - 1)) * w,
    pad + h - ((v - lo) / span) * h,
  ]);
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${viewH} L${pts[0][0].toFixed(1)},${viewH} Z`;
  return { line, area };
}
