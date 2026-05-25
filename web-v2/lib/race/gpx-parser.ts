/**
 * gpx-parser.ts — parse a GPX/TCX/FIT file into the shape we store on
 * races.course_geometry.
 *
 * GPX only for now; TCX/FIT come later when needed.
 */

export interface CourseGeometry {
  source: 'upload' | 'library' | 'strava_match';
  trackPoints: { lat: number; lon: number; ele: number | null }[];
  distance_mi: number;
  elevation_gain_ft: number;
  bbox: { minLat: number; maxLat: number; minLon: number; maxLon: number };
  raw_filename?: string;
}

export function parseGPX(xml: string, filename?: string): CourseGeometry {
  const points: { lat: number; lon: number; ele: number | null }[] = [];
  const re = /<trkpt\s+lat="([\d.\-]+)"\s+lon="([\d.\-]+)">([\s\S]*?)<\/trkpt>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const eleMatch = m[3].match(/<ele>([\d.\-]+)<\/ele>/);
    points.push({
      lat: Number(m[1]),
      lon: Number(m[2]),
      ele: eleMatch ? Number(eleMatch[1]) : null,
    });
  }
  if (points.length < 2) {
    throw new Error('GPX has no track points');
  }

  // Distance (haversine)
  let meters = 0;
  for (let i = 1; i < points.length; i++) {
    meters += haversine(points[i - 1], points[i]);
  }
  const distance_mi = +(meters / 1609.344).toFixed(2);

  // Elevation gain (meters → feet)
  let gainM = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1].ele, b = points[i].ele;
    if (a != null && b != null && b > a) gainM += (b - a);
  }
  const elevation_gain_ft = Math.round(gainM * 3.28084);

  // BBox for clip + render
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const bbox = {
    minLat: Math.min(...lats), maxLat: Math.max(...lats),
    minLon: Math.min(...lons), maxLon: Math.max(...lons),
  };

  return {
    source: 'upload',
    trackPoints: points,
    distance_mi,
    elevation_gain_ft,
    bbox,
    raw_filename: filename,
  };
}

function haversine(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
