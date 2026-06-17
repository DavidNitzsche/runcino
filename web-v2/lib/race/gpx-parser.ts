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

  // Elevation gain · noise-thresholded (see elevationGainFt). Raw sample-to-
  // sample summing inflated gain badly from GPS/barometric jitter — AFC's
  // 5790-point track raw-summed to 923 ft vs Strava's 724.
  const elevation_gain_ft = elevationGainFt(
    points.map((p) => p.ele).filter((e): e is number => e != null),
  );

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

/**
 * Elevation gain (feet) from a sequence of metre elevations, with a noise
 * threshold (hysteresis). Summing every positive sample-to-sample delta
 * inflates gain badly from GPS/barometric jitter; a ~1.6 m floor — only count
 * a climb once it clears the threshold from the last reference, and reset the
 * reference on any descent — matches the trusted GPX/Strava figure (AFC half:
 * raw-sum 923 ft → 722 ft at 1.6 m, vs Strava's 724). This is the standard
 * min-elevation-change filter Strava/Garmin apply; raw summing is "gross gain".
 */
export function elevationGainFt(eles: number[], thresholdM = 1.6): number {
  if (eles.length < 2) return 0;
  let gainM = 0;
  let ref = eles[0];
  for (let i = 1; i < eles.length; i++) {
    const d = eles[i] - ref;
    if (d >= thresholdM) { gainM += d; ref = eles[i]; }   // cleared the noise floor → real climb
    else if (d < 0) { ref = eles[i]; }                    // descending → track the new low
  }
  return Math.round(gainM * 3.28084);
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
