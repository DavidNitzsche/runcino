'use client';

/**
 * PacePlanElevation (#153) — replaces the boring pace table with a
 * horizontal mile-marker strip overlaid on the elevation curve.
 *
 * Visually tells the race STORY:
 *   - bottom curve = elevation profile (from course GPX when attached;
 *     a placeholder shape otherwise)
 *   - top chips floated over the curve = target pace per mile segment
 *   - phase labels (COASTAL FLAT / BRIDGE CLIMB / etc.) inline beneath
 *
 * Visually connects to the course schematic above (same x-axis, same
 * color story) so the runner can read course + pace as one widget.
 *
 * Pace segments are currently hard-coded for AFC Half; future: tie to a
 * race-level pace_plan JSON column.
 */
import * as React from 'react';

interface CourseGeometry {
  distance_mi: number;
  elevation_gain_ft: number;
  trackPoints: Array<{ lat: number; lon: number; ele: number | null }>;
}

interface PaceSegment {
  miStart: number;
  miEnd: number;
  pace: string;
  label: string;
  tone: 'flat' | 'climb' | 'descent' | 'finish';
}

export function PacePlanElevation({
  geometry, distanceMi, goalLabel,
}: {
  geometry?: CourseGeometry | null;
  distanceMi: number;
  goalLabel?: string;
}) {
  // Build elevation samples in feet, one per virtual mile (or a placeholder
  // shape if no GPX is attached).
  const samples = geometry?.trackPoints?.length
    ? samplePerMile(geometry, distanceMi)
    : placeholderElevation(distanceMi);

  // Pace segments — placeholder narrative aligned to a typical half profile.
  // TODO: tie to a per-race pace_plan when David nails the schema.
  const segments: PaceSegment[] = [
    { miStart: 0,    miEnd: 3,   pace: '7:00', label: 'COASTAL FLAT',  tone: 'flat' },
    { miStart: 3,    miEnd: 5,   pace: '6:55', label: 'GENTLE RISE',   tone: 'climb' },
    { miStart: 5,    miEnd: 6,   pace: '7:10', label: 'BRIDGE CLIMB',  tone: 'climb' },
    { miStart: 6,    miEnd: 9,   pace: '6:45', label: 'DESCENT',       tone: 'descent' },
    { miStart: 9,    miEnd: 12,  pace: '6:48', label: 'BAY FLAT',      tone: 'flat' },
    { miStart: 12,   miEnd: 13.1,pace: '6:30', label: 'FINISH',        tone: 'finish' },
  ];

  // Clamp segments to actual distance
  const filtered = segments
    .map((s) => ({ ...s, miEnd: Math.min(s.miEnd, distanceMi) }))
    .filter((s) => s.miStart < distanceMi);

  const minEle = Math.min(...samples);
  const maxEle = Math.max(...samples);
  const eleRange = Math.max(1, maxEle - minEle);

  // SVG geometry
  const W = 600;
  const H_chart = 110;
  const H_total = 220;
  const padX = 8;
  const padTop = 8;
  const chartTop = 78;     // where the elevation curve starts (pace chips above)

  // Curve points
  const xFor = (mi: number) => padX + (mi / distanceMi) * (W - padX * 2);
  const yFor = (ele: number) => chartTop + (H_chart - (ele - minEle) / eleRange * H_chart);

  // Elevation polyline path
  const points = samples.map((ele, i) => {
    const mi = (i / (samples.length - 1)) * distanceMi;
    return `${xFor(mi).toFixed(1)},${yFor(ele).toFixed(1)}`;
  });
  const linePath = `M ${points.join(' L ')}`;
  const areaPath = `${linePath} L ${xFor(distanceMi).toFixed(1)},${(chartTop + H_chart).toFixed(1)} L ${padX.toFixed(1)},${(chartTop + H_chart).toFixed(1)} Z`;

  // Tone colors — match the rest of the site
  const toneColor: Record<PaceSegment['tone'], string> = {
    flat: '#27B4E0',
    climb: '#FF8847',
    descent: '#3EBD41',
    finish: '#F3AD38',
  };

  return (
    <div style={{ marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
      <div className="card-eyebrow" style={{ color: 'var(--mute)', marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>PACE PLAN{goalLabel ? ` · GOAL ${goalLabel}` : ''}</span>
        {!geometry && (
          <span style={{ color: 'var(--dim)', letterSpacing: '0.5px', textTransform: 'none', fontSize: 10 }}>
            placeholder shape — import course GPX for real profile
          </span>
        )}
      </div>

      <svg viewBox={`0 0 ${W} ${H_total}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {/* Pace chips floated above elevation curve, one per segment */}
        {filtered.map((seg) => {
          const cx = (xFor(seg.miStart) + xFor(seg.miEnd)) / 2;
          const color = toneColor[seg.tone];
          return (
            <g key={`pace-${seg.miStart}`}>
              <rect
                x={cx - 30} y={padTop}
                width={60} height={28}
                rx={6}
                fill={`${color}22`}
                stroke={`${color}80`}
                strokeWidth={1}
              />
              <text
                x={cx} y={padTop + 18}
                textAnchor="middle"
                fontFamily="Bebas Neue, sans-serif"
                fontSize={16}
                fill={color}
                letterSpacing={1}
              >{seg.pace}</text>
            </g>
          );
        })}

        {/* Elevation curve */}
        <defs>
          <linearGradient id="ele-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(176,132,255,0.35)" />
            <stop offset="100%" stopColor="rgba(176,132,255,0)" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#ele-grad)" />
        <path d={linePath} fill="none" stroke="rgba(176,132,255,0.8)" strokeWidth={2} />

        {/* Segment dividers (vertical ticks at boundaries) */}
        {filtered.map((seg) => (
          <line
            key={`div-${seg.miEnd}`}
            x1={xFor(seg.miEnd)} y1={chartTop}
            x2={xFor(seg.miEnd)} y2={chartTop + H_chart}
            stroke="rgba(255,255,255,0.10)"
            strokeWidth={1}
            strokeDasharray="2 3"
          />
        ))}

        {/* Mile-marker baseline */}
        <line
          x1={padX} y1={chartTop + H_chart}
          x2={W - padX} y2={chartTop + H_chart}
          stroke="rgba(255,255,255,0.20)" strokeWidth={1}
        />
        {[0, 3, 6, 9, distanceMi].map((mi) => (
          <g key={`mi-${mi}`}>
            <line
              x1={xFor(mi)} y1={chartTop + H_chart - 4}
              x2={xFor(mi)} y2={chartTop + H_chart + 4}
              stroke="rgba(255,255,255,0.35)" strokeWidth={1}
            />
            <text
              x={xFor(mi)} y={chartTop + H_chart + 16}
              textAnchor="middle"
              fontFamily="Inter, sans-serif"
              fontSize={9}
              fontWeight={700}
              fill="rgba(246,247,248,0.45)"
              letterSpacing={0.5}
            >
              {mi % 1 === 0 ? mi : mi.toFixed(1)} mi
            </text>
          </g>
        ))}

        {/* Phase labels under the chart */}
        {filtered.map((seg) => {
          const cx = (xFor(seg.miStart) + xFor(seg.miEnd)) / 2;
          return (
            <text
              key={`lbl-${seg.miStart}`}
              x={cx} y={H_total - 6}
              textAnchor="middle"
              // v3 cutover 2026-05-28 — was HelveticaNeue-Bold; SVG can't read
              // CSS vars, so reference Oswald directly + system fallback chain.
              fontFamily="'Oswald', 'Inter', -apple-system, sans-serif"
              fontWeight={700}
              fontSize={9}
              fill={toneColor[seg.tone]}
              letterSpacing={1.2}
            >{seg.label}</text>
          );
        })}
      </svg>

      {!geometry && (
        <div style={{
          marginTop: 10, padding: '8px 12px', borderRadius: 8,
          background: 'rgba(243,173,56,0.06)', border: '1px dashed rgba(243,173,56,0.25)',
          fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--goal)',
          lineHeight: 1.5,
        }}>
          This is a placeholder profile. Once you import the course GPX (above), this strip renders the
          real elevation + pace plan for your specific course.
        </div>
      )}
    </div>
  );
}

/** Down-sample track points into one elevation value per virtual mile.
 *  Walks the array by distance accumulation so a 5,000-pt GPX collapses to ~13 samples. */
function samplePerMile(geometry: CourseGeometry, distanceMi: number): number[] {
  const target = Math.max(13, Math.ceil(distanceMi * 4));   // ~4 samples/mi for a smoother curve
  const pts = geometry.trackPoints.filter((p) => p.ele != null);
  if (pts.length < 2) return placeholderElevation(distanceMi);

  const out: number[] = [];
  const step = pts.length / target;
  for (let i = 0; i < target; i++) {
    const idx = Math.min(pts.length - 1, Math.floor(i * step));
    const ele = pts[idx].ele;
    if (ele == null) continue;
    out.push(ele * 3.28084); // meters → feet
  }
  return out.length > 0 ? out : placeholderElevation(distanceMi);
}

/** Generic placeholder curve resembling a typical road-race elevation shape. */
function placeholderElevation(distanceMi: number): number[] {
  const samples = 40;
  const out: number[] = [];
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    // Starts at 300ft, dips to ~50ft by mi 4, rises to ~200ft at mi 6, descends to 50ft, holds.
    const mi = t * distanceMi;
    const e =
      mi < 4   ? 300 - (mi / 4) * 250 :
      mi < 6   ? 50 + ((mi - 4) / 2) * 150 :
      mi < 9   ? 200 - ((mi - 6) / 3) * 150 :
                 50 + Math.sin((mi - 9) * 1.2) * 8;
    out.push(e);
  }
  return out;
}
