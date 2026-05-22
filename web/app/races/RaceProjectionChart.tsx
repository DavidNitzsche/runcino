/**
 * C9 · Race result projection chart · /races A-race hero
 *
 * Inline SVG chart showing two projected finish-time trajectories
 * over the weeks remaining to the A-race:
 *   - "If you maintain" (orange line at current VDOT)
 *   - "If you hit prescribed" (green line trending toward goal)
 *   - Goal time (horizontal reference, gray dashed)
 *
 * Surface-only · doesn't auto-modify anything. The chart updates as
 * VDOT changes (manual override, fresh race results).
 */

import type { RaceProjection } from '@/lib/race-projection';

interface Props {
  projection: RaceProjection;
}

function fmtTime(s: number): string {
  if (!s || s <= 0) return ', ';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

export function RaceProjectionChart({ projection }: Props) {
  if (projection.points.length === 0) return null;

  const W = 360;
  const H = 140;
  const padX = 28;
  const padY = 24;
  const plotW = W - padX * 2;
  const plotH = H - padY * 2;

  const allTimes = projection.points.flatMap((p) => [p.maintainFinishS, p.planFinishS]);
  allTimes.push(projection.goalFinishS);
  const minT = Math.min(...allTimes);
  const maxT = Math.max(...allTimes);
  const tRange = Math.max(1, maxT - minT);

  // Faster times render HIGHER (y-axis inverted).
  function yForTime(t: number): number {
    return padY + ((t - minT) / tRange) * plotH;
  }
  function xForWeek(w: number): number {
    return padX + (w / projection.weeksToRace) * plotW;
  }

  const maintainPath = projection.points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${xForWeek(p.weekIdx)},${yForTime(p.maintainFinishS)}`)
    .join(' ');
  const planPath = projection.points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${xForWeek(p.weekIdx)},${yForTime(p.planFinishS)}`)
    .join(' ');
  const goalY = yForTime(projection.goalFinishS);

  return (
    <div
      style={{
        marginTop: 14,
        padding: '12px 14px',
        background: 'rgba(8,8,8,.025)',
        border: '1px solid rgba(8,8,8,.08)',
        borderRadius: 10,
        fontFamily: 'Inter, sans-serif',
      }}
    >
      <div
        style={{
          fontFamily: 'Oswald, sans-serif',
          fontSize: 10,
          letterSpacing: 1.4,
          textTransform: 'uppercase',
          color: 'rgba(8,8,8,.55)',
          fontWeight: 700,
          marginBottom: 8,
        }}
      >
        Projection · next {projection.weeksToRace} weeks
      </div>

      <svg width={W} height={H} role="img" aria-label="Race projection chart">
        {/* Goal line */}
        <line
          x1={padX} x2={W - padX}
          y1={goalY} y2={goalY}
          stroke="rgba(8,8,8,.35)"
          strokeWidth="1"
          strokeDasharray="4 4"
        />
        <text x={W - padX + 2} y={goalY + 3}
          fontFamily="Inter, sans-serif"
          fontSize="10"
          fill="rgba(8,8,8,.62)">goal</text>

        {/* Maintain line */}
        <path d={maintainPath} fill="none" stroke="#E85D26" strokeWidth="1.6"
          strokeLinecap="round" strokeLinejoin="round" />

        {/* Plan line */}
        {projection.hasMeaningfulPlanTrajectory && (
          <path d={planPath} fill="none" stroke="#3EBD41" strokeWidth="1.6"
            strokeLinecap="round" strokeLinejoin="round" />
        )}

        {/* Start + end dots */}
        <circle cx={xForWeek(0)} cy={yForTime(projection.points[0].maintainFinishS)}
          r="3" fill="#E85D26" />
        {projection.hasMeaningfulPlanTrajectory && (
          <circle cx={xForWeek(projection.weeksToRace)} cy={yForTime(projection.points[projection.points.length - 1].planFinishS)}
            r="3" fill="#3EBD41" />
        )}
      </svg>

      <div
        style={{
          display: 'flex',
          gap: 14,
          marginTop: 6,
          fontSize: 11,
          color: 'rgba(8,8,8,.65)',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 10, height: 2, background: '#E85D26', display: 'inline-block' }} />
          If you maintain · {fmtTime(projection.points[0].maintainFinishS)}
        </span>
        {projection.hasMeaningfulPlanTrajectory && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 10, height: 2, background: '#3EBD41', display: 'inline-block' }} />
            If you hit prescribed · {fmtTime(projection.points[projection.points.length - 1].planFinishS)}
          </span>
        )}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 10, borderTop: '2px dashed rgba(8,8,8,.35)' }} />
          Goal · {fmtTime(projection.goalFinishS)}
        </span>
      </div>
      {!projection.hasMeaningfulPlanTrajectory && (
        <div
          style={{
            marginTop: 8,
            fontSize: 11,
            color: 'rgba(8,8,8,.55)',
            fontStyle: 'italic',
          }}
        >
          Goal is at or easier than current VDOT, plan line equals maintain line.
        </div>
      )}
    </div>
  );
}
