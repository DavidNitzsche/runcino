'use client';

import type { RacePhase } from '../../lib/core/types';

interface Props {
  phases: RacePhase[];
  gpxAvailable: boolean;
  avgPaceDisplay: string;
}

function paceZoneStyle(paceS: number, avgPaceS: number): { color: string; bg: string } {
  if (avgPaceS === 0 || paceS === 0) return { color: '#8888a0', bg: '#1f1f25' };
  const delta = paceS - avgPaceS;
  if (delta > 30) return { color: '#ef4444', bg: 'rgba(239,68,68,0.08)' };
  if (delta > 10) return { color: '#f97316', bg: 'rgba(249,115,22,0.08)' };
  if (delta < -10) return { color: '#22c55e', bg: 'rgba(34,197,94,0.08)' };
  return { color: '#3b82f6', bg: 'rgba(59,130,246,0.08)' };
}

function formatPaceDisplay(s: number): string {
  if (s === 0) return '—';
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function parseAvgPaceS(display: string): number {
  // "8:35/mi" → 515
  const m = display.match(/(\d+):(\d{2})/);
  if (!m) return 0;
  return parseInt(m[1]) * 60 + parseInt(m[2]);
}

export default function PhaseCards({ phases, gpxAvailable, avgPaceDisplay }: Props) {
  const avgPaceS = parseAvgPaceS(avgPaceDisplay);

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{
        fontSize: 11, color: '#8888a0', textTransform: 'uppercase',
        letterSpacing: '1px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8,
      }}>
        Race Strategy
        {!gpxAvailable && (
          <span style={{
            fontSize: 10, background: '#1f1f25', border: '1px solid #2a2a32',
            borderRadius: 4, padding: '2px 6px', color: '#55556a',
          }}>
            Even splits · upload GPX for terrain pacing
          </span>
        )}
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: 10,
      }}>
        {phases.map(phase => {
          const zone = gpxAvailable ? paceZoneStyle(phase.avg_pace_s, avgPaceS) : { color: '#3b82f6', bg: 'rgba(59,130,246,0.08)' };
          const hasElevation = phase.gain_ft > 0 || phase.loss_ft > 0;

          return (
            <div key={phase.index} style={{
              background: '#18181c',
              border: '1px solid #2a2a32',
              borderRadius: 10,
              padding: '14px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}>
              {/* Phase name + distance */}
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#e8e8ee', marginBottom: 2 }}>
                  {phase.name}
                </div>
                <div style={{ fontSize: 11, color: '#55556a', fontFamily: 'monospace' }}>
                  mi {phase.start_mi.toFixed(1)} – {phase.end_mi.toFixed(1)}
                </div>
              </div>

              {/* Target pace */}
              <div style={{
                background: zone.bg,
                borderRadius: 8,
                padding: '8px 10px',
                display: 'inline-flex',
                flexDirection: 'column',
                gap: 2,
              }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: zone.color, fontFamily: 'monospace', lineHeight: 1 }}>
                  {formatPaceDisplay(phase.avg_pace_s)}
                  <span style={{ fontSize: 12, fontWeight: 400, color: '#8888a0', marginLeft: 4 }}>/mi</span>
                </div>
                {gpxAvailable && phase.avg_pace_s > 0 && avgPaceS > 0 && (
                  <div style={{ fontSize: 10, color: '#55556a' }}>
                    {phase.avg_pace_s > avgPaceS
                      ? `+${Math.round(phase.avg_pace_s - avgPaceS)}s vs avg`
                      : `-${Math.round(avgPaceS - phase.avg_pace_s)}s vs avg`}
                  </div>
                )}
              </div>

              {/* Elevation */}
              {hasElevation && (
                <div style={{ display: 'flex', gap: 10, fontSize: 11 }}>
                  {phase.gain_ft > 0 && (
                    <span style={{ color: '#f97316' }}>↑ {Math.round(phase.gain_ft)}ft</span>
                  )}
                  {phase.loss_ft > 0 && (
                    <span style={{ color: '#22c55e' }}>↓ {Math.round(phase.loss_ft)}ft</span>
                  )}
                </div>
              )}

              {/* Gels */}
              {phase.gels.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {phase.gels.map(gel => (
                    <span key={gel.number} style={{
                      fontSize: 10,
                      background: gel.caffeine ? 'rgba(249,115,22,0.15)' : 'rgba(136,136,160,0.12)',
                      color: gel.caffeine ? '#f97316' : '#8888a0',
                      border: `1px solid ${gel.caffeine ? 'rgba(249,115,22,0.3)' : '#2a2a32'}`,
                      borderRadius: 4,
                      padding: '2px 6px',
                      fontFamily: 'monospace',
                    }}>
                      mi {gel.at_mile.toFixed(1)} · {gel.label}
                    </span>
                  ))}
                </div>
              )}

              {/* Strategy note */}
              <div style={{ fontSize: 11, color: '#55556a', lineHeight: 1.5 }}>
                {phase.strategy_note}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
