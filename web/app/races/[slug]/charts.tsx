import type { RuncinoPlan } from '../../../lib/types';
import type { ActualRace } from '../../../lib/retrospective';

export function PlanVsActualChart({ plan, actual }: { plan: RuncinoPlan; actual: ActualRace }) {
  const totalMi = plan.race.distance_mi;
  const W = 1000, H = 260, padL = 60, padR = 40, padT = 40, padB = 40;
  const paceMin = 420;
  const paceMax = 720;

  const xScale = (mi: number) => padL + (mi / totalMi) * (W - padL - padR);
  const yScale = (pace: number) => padT + ((pace - paceMin) / (paceMax - paceMin)) * (H - padT - padB);

  const paceSteps: Array<[number, number]> = [];
  for (const interval of plan.intervals) {
    if (interval.kind === 'pace') {
      paceSteps.push([interval.at_mi, interval.target_pace_s_per_mi]);
      paceSteps.push([interval.at_mi + interval.distance_mi, interval.target_pace_s_per_mi]);
    }
  }
  const plannedPath = paceSteps.length > 0
    ? 'M ' + paceSteps.map(([mi, p]) => `${xScale(mi)} ${yScale(p)}`).join(' L ')
    : '';

  const actualPath = actual.series.length > 0
    ? 'M ' + actual.series.map(s => `${xScale(s.atMi)} ${yScale(s.paceSPerMi)}`).join(' L ')
    : '';

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
      <g stroke="var(--color-line)" strokeWidth="1">
        {[0, 0.25, 0.5, 0.75, 1].map(t => (
          <line key={t} x1={padL} x2={W - padR} y1={padT + t * (H - padT - padB)} y2={padT + t * (H - padT - padB)} />
        ))}
      </g>
      <g fontSize="10" fill="var(--color-ink-3)">
        {[paceMin, paceMin + (paceMax - paceMin) * 0.5, paceMax].map(p => (
          <text key={p} x={padL - 6} y={yScale(p) + 3} textAnchor="end">
            {Math.floor(p / 60)}:{String(p % 60).padStart(2, '0')}
          </text>
        ))}
      </g>
      {plan.phases.map(p => (
        <line key={p.index} x1={xScale(p.end_mi)} x2={xScale(p.end_mi)} y1={padT} y2={H - padB}
              stroke="var(--color-ink-4)" strokeWidth="1" strokeDasharray="2 3" opacity="0.3" />
      ))}
      <path d={plannedPath} fill="none" stroke="var(--color-sage)" strokeWidth="2" strokeDasharray="5 4" />
      <path d={actualPath} fill="none" stroke="var(--color-terracotta)" strokeWidth="2.2" />
      <g fontSize="10" fill="var(--color-ink-3)" textAnchor="middle">
        {[0, 5, 10, 15, 20, 25, Math.round(totalMi)].map(mi => (
          <text key={mi} x={xScale(Math.min(mi, totalMi))} y={H - padB + 20}>mi {mi}</text>
        ))}
      </g>
    </svg>
  );
}

export function HrEnvelope({ series, avgHr, peakHr }: { series: ActualRace['series']; avgHr: number; peakHr: number }) {
  void avgHr; void peakHr;
  if (series.length === 0) return <div style={{ color: 'var(--color-ink-3)', fontSize: 13 }}>No HR series available.</div>;
  const W = 400, H = 140, padL = 30, padR = 10, padT = 20, padB = 20;
  const hrMin = 130, hrMax = 185;
  const maxMi = Math.max(...series.map(s => s.atMi));
  const xScale = (mi: number) => padL + (mi / maxMi) * (W - padL - padR);
  const yScale = (hr: number) => padT + ((hrMax - hr) / (hrMax - hrMin)) * (H - padT - padB);
  const hrPath = 'M ' + series.map(s => `${xScale(s.atMi)} ${yScale(s.hrBpm)}`).join(' L ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
      <rect x={padL} y={yScale(170)} width={W - padL - padR} height={yScale(155) - yScale(170)} fill="var(--color-terracotta-3)" opacity="0.5" />
      <g stroke="var(--color-line)">
        {[hrMin, 150, 170, hrMax].map(hr => (
          <line key={hr} x1={padL} x2={W - padR} y1={yScale(hr)} y2={yScale(hr)} />
        ))}
      </g>
      <g fontSize="9" fill="var(--color-ink-3)">
        {[hrMin, 150, 170, hrMax].map(hr => (
          <text key={hr} x={padL - 4} y={yScale(hr) + 3} textAnchor="end">{hr}</text>
        ))}
      </g>
      <path d={hrPath} fill="none" stroke="var(--color-danger)" strokeWidth="2" />
      <text x={W - padR - 4} y={yScale(165)} fontSize="9" fill="var(--color-terracotta)" textAnchor="end">Zone 4</text>
    </svg>
  );
}
