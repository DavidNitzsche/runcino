/**
 * RealRouteSvg — renders the actual GPX polyline + start/finish dots.
 * Used when a race has course_geometry attached (any ingest vector).
 */

interface Geometry {
  trackPoints: { lat: number; lon: number }[];
  bbox: { minLat: number; maxLat: number; minLon: number; maxLon: number };
  distance_mi: number;
  elevation_gain_ft: number;
}

export function RealRouteSvg({ geometry }: { geometry: Geometry }) {
  const W = 600;
  const H = 280;
  const pad = 24;
  const stride = Math.max(1, Math.floor(geometry.trackPoints.length / 500));
  const pts = geometry.trackPoints.filter((_, i) => i % stride === 0);

  const lonRange = geometry.bbox.maxLon - geometry.bbox.minLon || 1;
  const latRange = geometry.bbox.maxLat - geometry.bbox.minLat || 1;
  const scale = Math.min((W - 2 * pad) / lonRange, (H - 2 * pad) / latRange);
  const offsetX = (W - lonRange * scale) / 2;
  const offsetY = (H - latRange * scale) / 2;

  const xy = pts.map((p) => {
    const x = offsetX + (p.lon - geometry.bbox.minLon) * scale;
    const y = H - (offsetY + (p.lat - geometry.bbox.minLat) * scale);
    return [x, y] as [number, number];
  });

  const d = xy.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [sx, sy] = xy[0];
  const [ex, ey] = xy[xy.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
      <path d={d} fill="none" stroke="var(--race)" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={sx.toFixed(1)} cy={sy.toFixed(1)} r={6} fill="var(--green)" stroke="var(--card-2)" strokeWidth={2} />
      <circle cx={ex.toFixed(1)} cy={ey.toFixed(1)} r={6} fill="var(--goal)" stroke="var(--card-2)" strokeWidth={2} />
    </svg>
  );
}
