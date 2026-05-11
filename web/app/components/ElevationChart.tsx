'use client';

import {
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import type { SegmentSummary, GelPlacement, RacePhase } from '../../lib/core/types';

interface Props {
  segments: SegmentSummary[];
  gels: GelPlacement[];
  phases: RacePhase[] | null;
  totalGainFt: number | null;
  totalLossFt: number | null;
  totalMiles: number;
}

function gradeColor(grade: number): string {
  if (grade > 4) return '#ef4444';   // steep climb — red
  if (grade > 1.5) return '#f97316'; // climb — orange
  if (grade < -4) return '#14b8a6';  // steep descent — teal
  if (grade < -1.5) return '#22c55e'; // descent — green
  return '#3b82f6';                   // flat — blue
}

interface ChartPoint {
  mi: number;
  eleFt: number;
  grade: number;
  paceS: number;
  fill: string;
}

export default function ElevationChart({ segments, gels, phases, totalGainFt, totalLossFt, totalMiles }: Props) {
  // Build chart points from segments
  const data: ChartPoint[] = segments.map(seg => ({
    mi: Math.round(seg.startMi * 10) / 10,
    eleFt: Math.round(seg.eleFt),
    grade: Math.round(seg.gradePct * 10) / 10,
    paceS: seg.targetPaceS,
    fill: gradeColor(seg.gradePct),
  }));

  // Add final point if needed
  if (segments.length > 0) {
    const last = segments[segments.length - 1];
    data.push({
      mi: Math.round(last.endMi * 10) / 10,
      eleFt: Math.round(last.eleFt),
      grade: 0,
      paceS: last.targetPaceS,
      fill: '#3b82f6',
    });
  }

  const minEle = data.length > 0 ? Math.min(...data.map(d => d.eleFt)) - 50 : 0;
  const maxEle = data.length > 0 ? Math.max(...data.map(d => d.eleFt)) + 80 : 500;

  function formatPaceDisplay(s: number): string {
    const m = Math.floor(s / 60);
    const sec = Math.round(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}/mi`;
  }

  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ payload: ChartPoint }> }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
      <div style={{
        background: '#1c1c20',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 8,
        padding: '8px 12px',
        fontSize: 12,
        color: '#ebebef',
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
      }}>
        <div style={{ fontWeight: 700 }}>Mile {d.mi.toFixed(1)}</div>
        <div style={{ color: '#78788a' }}>{d.eleFt.toFixed(0)} ft</div>
        <div style={{ color: '#78788a' }}>Grade {d.grade > 0 ? '+' : ''}{d.grade.toFixed(1)}%</div>
        <div style={{ color: '#f97316', fontWeight: 600 }}>{formatPaceDisplay(d.paceS)}</div>
      </div>
    );
  };

  if (data.length === 0) {
    // No GPX — show research totals as a simple summary bar
    if (!totalGainFt && !totalLossFt) return null;
    return (
      <div style={{ padding: '16px 20px', background: '#ffffff', borderRadius: 10, border: '1px solid #e5e5e2', marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: '#9b9b98', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 12, fontWeight: 700 }}>
          Elevation Summary · Research Data Only
        </div>
        <div style={{ display: 'flex', gap: 24 }}>
          {totalGainFt && (
            <div>
              <div style={{ fontSize: 28, fontWeight: 800, color: '#ea580c', fontFamily: 'monospace' }}>+{totalGainFt.toLocaleString()} ft</div>
              <div style={{ fontSize: 11, color: '#9b9b98' }}>total gain</div>
            </div>
          )}
          {totalLossFt && (
            <div>
              <div style={{ fontSize: 28, fontWeight: 800, color: '#16a34a', fontFamily: 'monospace' }}>-{totalLossFt.toLocaleString()} ft</div>
              <div style={{ fontSize: 11, color: '#9b9b98' }}>total loss</div>
            </div>
          )}
        </div>
        <div style={{ fontSize: 11, color: '#9b9b98', marginTop: 8 }}>
          Upload a Garmin/Strava GPX for the full elevation profile
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 10, color: '#78788a', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 10, display: 'flex', gap: 16, flexWrap: 'wrap', fontWeight: 700 }}>
        <span>Elevation &amp; Pace Profile</span>
        <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ width: 8, height: 8, background: '#ef4444', borderRadius: 2, display: 'inline-block' }} />Steep climb
          </span>
          <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ width: 8, height: 8, background: '#f97316', borderRadius: 2, display: 'inline-block' }} />Climb
          </span>
          <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ width: 8, height: 8, background: '#3b82f6', borderRadius: 2, display: 'inline-block' }} />Flat
          </span>
          <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ width: 8, height: 8, background: '#22c55e', borderRadius: 2, display: 'inline-block' }} />Descent
          </span>
        </span>
      </div>
      <div style={{ height: 180, width: '100%' }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="eleGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="mi"
              type="number"
              domain={[0, Math.ceil(totalMiles)]}
              tickLine={false}
              axisLine={false}
              tick={{ fill: '#78788a', fontSize: 10 }}
              tickFormatter={v => `${v}mi`}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[minEle, maxEle]}
              tickLine={false}
              axisLine={false}
              tick={{ fill: '#78788a', fontSize: 10 }}
              tickFormatter={v => `${v}ft`}
              width={45}
            />
            <Tooltip content={<CustomTooltip />} />

            {/* Phase boundary lines */}
            {phases?.slice(1).map(phase => (
              <ReferenceLine
                key={phase.index}
                x={phase.start_mi}
                stroke="#2a2a32"
                strokeDasharray="3 3"
              />
            ))}

            {/* Gel markers */}
            {gels.map(gel => (
              <ReferenceLine
                key={gel.number}
                x={gel.at_mile}
                stroke={gel.caffeine ? '#f97316' : '#8888a0'}
                strokeDasharray="2 4"
                strokeWidth={1.5}
              />
            ))}

            <Area
              type="monotone"
              dataKey="eleFt"
              stroke="#3b82f6"
              strokeWidth={2}
              fill="url(#eleGrad)"
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
