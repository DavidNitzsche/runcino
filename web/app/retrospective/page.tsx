'use client';

import { useMemo, useState } from 'react';
import { Nav, Footer } from '../../components/nav';
import { computeRetrospective, type ActualRace } from '../../lib/retrospective';
import { formatHMS, formatPaceMi } from '../../lib/time';
import type { RuncinoPlan } from '../../lib/types';
import planFixture from '../../public/big-sur-3-50.runcino.json';
import actualFixture from '../../fixtures/bigsur-actual.json';

export default function RetrospectivePage() {
  const plan = planFixture as unknown as RuncinoPlan;
  const actual = actualFixture as unknown as ActualRace;
  const retro = useMemo(() => computeRetrospective(plan, actual), [plan, actual]);
  const [narrative, setNarrative] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [stub, setStub] = useState(false);

  async function loadNarrative() {
    setLoading(true);
    try {
      const res = await fetch('/api/retrospective', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan, actual }),
      });
      const data = await res.json();
      setNarrative(data.narrative);
      setStub(data.stub);
    } finally {
      setLoading(false);
    }
  }

  const finishDisplay = formatHMS(retro.actual_finish_s);
  const goalDisplay = formatHMS(retro.planned_finish_s);
  const deltaMin = Math.floor(Math.abs(retro.finish_delta_s) / 60);
  const deltaSec = Math.abs(retro.finish_delta_s) % 60;
  const deltaStr = `${retro.finish_delta_s >= 0 ? '+' : '−'}${deltaMin}:${String(deltaSec).padStart(2, '0')}`;
  const isFaster = retro.finish_delta_s < 0;

  return (
    <main style={{ maxWidth: 1180, margin: '0 auto', padding: '0 32px' }}>
      <Nav active="retrospective" />

      <section style={{ padding: '48px 0 16px' }}>
        <div className="runcino-pill runcino-pill-accent" style={{ marginBottom: 16, display: 'inline-flex' }}>
          <span className="runcino-pill-dot" /> M1 · Post-race
        </div>
        <h1 style={{ fontSize: 52, maxWidth: '24ch', margin: '0 0 12px' }}>
          The race happened.<br />
          <span className="serif-italic">Here's what it teaches us.</span>
        </h1>
        <p style={{ fontSize: 18, color: 'var(--color-ink-3)', maxWidth: '62ch', lineHeight: 1.5 }}>
          Import the actual workout export from your Watch. The comparison engine reads plan-vs-actual by phase, computes HR drift, extracts your personal GAP coefficients, and Claude writes the narrative.
        </p>
      </section>

      <section style={{ padding: '32px 0 48px' }}>
        <div className="runcino-card" style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
          <div style={{ padding: 32, display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 32, alignItems: 'center', borderBottom: '1px solid var(--color-line)' }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 10 }}>Race report · {retro.race_date}</div>
              <h3 style={{ fontSize: 36, marginBottom: 8 }}>
                Finished <span className="serif-italic" style={{ color: isFaster ? 'var(--color-ok)' : 'var(--color-gold)' }}>{finishDisplay}</span>
              </h3>
              <div style={{ display: 'flex', gap: 16, color: 'var(--color-ink-3)', fontSize: 14 }}>
                <span>goal {goalDisplay}</span>
                <span>·</span>
                <span>{deltaStr} {isFaster ? 'under' : 'over'}</span>
                <span>·</span>
                <span>avg HR {actual.avg_hr_bpm}</span>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
              <span className="runcino-pill runcino-pill-sage">
                <span className="runcino-pill-dot" style={{ background: 'var(--color-sage)' }} />
                Avg HR {actual.avg_hr_bpm} · peak {actual.peak_hr_bpm}
              </span>
              <span className="runcino-pill">
                Wind {actual.weather.wind_mph} mph {actual.weather.wind_dir}
              </span>
              <span className="runcino-pill">
                Start {actual.weather.start_temp_f}°F · finish {actual.weather.finish_temp_f}°F
              </span>
            </div>
          </div>

          <div style={{ padding: 32, background: 'var(--color-paper-2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <div className="eyebrow" style={{ marginBottom: 4 }}>Plan vs actual</div>
                <h4 style={{ fontSize: 20 }}>Where the race diverged.</h4>
              </div>
              <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--color-ink-3)' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 12, height: 2, background: 'var(--color-sage)', display: 'inline-block' }} /> planned
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 12, height: 2, background: 'var(--color-terracotta)', display: 'inline-block' }} /> actual
                </span>
              </div>
            </div>
            <PlanVsActualChart plan={plan} actual={actual} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 16, marginBottom: 16 }}>
          <div className="runcino-card" style={{ borderColor: 'var(--color-terracotta-3)' }}>
            <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center' }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--color-ink)', color: 'var(--color-paper)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontStyle: 'italic', fontWeight: 600 }}>C</div>
              <div className="eyebrow" style={{ color: 'var(--color-ink-3)' }}>
                Claude's retrospective{stub && <span style={{ color: 'var(--color-ink-4)' }}> · stubbed</span>}
              </div>
            </div>

            {narrative ? (
              <div style={{ whiteSpace: 'pre-wrap', color: 'var(--color-ink-2)', lineHeight: 1.6 }}>
                {narrative}
              </div>
            ) : (
              <div>
                <h3 style={{ fontSize: 24, marginBottom: 12 }}>Read the race narrative?</h3>
                <p style={{ color: 'var(--color-ink-3)' }}>
                  Computed facts are above — plan drift, HR drift, climb/descent coefficients. Claude synthesizes these plus the weather log into a paragraph-form race report and carries the lessons forward.
                </p>
                <button className="btn btn-accent" onClick={loadNarrative} disabled={loading} style={{ marginTop: 8 }}>
                  {loading ? 'Writing…' : 'Write retrospective'}
                </button>
              </div>
            )}
          </div>

          <div className="runcino-card">
            <div className="eyebrow" style={{ marginBottom: 12 }}>Phase-by-phase</div>
            <h4 style={{ marginBottom: 16, fontSize: 18 }}>Splits vs target</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {retro.phase_deltas.map(pd => {
                const color =
                  pd.status === 'on_plan'     ? 'var(--color-ok)' :
                  pd.status === 'small_drift' ? 'var(--color-gold)' :
                                                'var(--color-danger)';
                return (
                  <div key={pd.phaseIdx} style={{
                    padding: 12,
                    background: pd.status === 'large_drift' ? '#FBF0EB' : 'var(--color-paper-2)',
                    borderRadius: 10,
                    borderLeft: `3px solid ${color}`,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{pd.label}</span>
                      <span className="font-mono" style={{ fontSize: 13, color }}>
                        {pd.deltaSPerMi >= 0 ? '+' : '−'}{Math.abs(pd.deltaSPerMi)} s/mi
                      </span>
                    </div>
                    <div className="font-mono" style={{ fontSize: 12, color: 'var(--color-ink-3)' }}>
                      planned {formatPaceMi(pd.plannedPaceSPerMi)} · ran {formatPaceMi(pd.actualPaceSPerMi)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div className="runcino-card">
            <div className="eyebrow" style={{ marginBottom: 12 }}>Heart rate</div>
            <HrEnvelope series={actual.series} avgHr={actual.avg_hr_bpm} peakHr={actual.peak_hr_bpm} />
            <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 12, color: 'var(--color-ink-3)' }}>
              <span>Avg {actual.avg_hr_bpm}</span>
              <span>Peak {actual.peak_hr_bpm}</span>
              <span>Late drift {retro.calibration.hr_drift_bpm >= 0 ? '+' : ''}{retro.calibration.hr_drift_bpm} bpm</span>
            </div>
          </div>
          <div className="runcino-card" style={{ background: 'var(--color-paper-2)' }}>
            <div className="eyebrow" style={{ marginBottom: 12 }}>Personal calibration</div>
            <h4 style={{ marginBottom: 16, fontSize: 18 }}>Your Minetti fudge factor</h4>
            <CalibrationRow label="Climb coefficient (observed)" value={`${retro.calibration.climb_coefficient.toFixed(2)} ×`} color={retro.calibration.climb_coefficient < 1.05 ? 'var(--color-ok)' : 'var(--color-gold)'} />
            <CalibrationRow label="Descent coefficient (observed)" value={`${retro.calibration.descent_coefficient.toFixed(2)} ×`} color={retro.calibration.descent_coefficient < 1.05 ? 'var(--color-ok)' : 'var(--color-gold)'} />
            <CalibrationRow
              label="Headwind sensitivity"
              value={retro.calibration.headwind_sensitivity_s_per_mi_per_mph !== null
                ? `+${retro.calibration.headwind_sensitivity_s_per_mi_per_mph} s/mi per mph`
                : 'insufficient data'}
              color={retro.calibration.headwind_sensitivity_s_per_mi_per_mph !== null ? 'var(--color-danger)' : 'var(--color-ink-4)'}
            />
            <CalibrationRow label="HR drift (early → late)" value={`${retro.calibration.hr_drift_bpm >= 0 ? '+' : ''}${retro.calibration.hr_drift_bpm} bpm`} color={retro.calibration.hr_drift_bpm < 8 ? 'var(--color-ok)' : 'var(--color-danger)'} />
          </div>
        </div>

        <div className="runcino-card" style={{ background: 'var(--color-ink)', color: 'var(--color-paper)', borderColor: 'var(--color-ink)' }}>
          <div className="eyebrow" style={{ color: 'var(--color-terracotta-2)', marginBottom: 12 }}>Carry into next race</div>
          <h3 style={{ color: 'var(--color-paper)', marginBottom: 16, fontSize: 24 }}>
            {retro.takeaways.length} takeaway{retro.takeaways.length === 1 ? '' : 's'} for the next build.
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(retro.takeaways.length, 3)}, 1fr)`, gap: 20 }}>
            {retro.takeaways.map((t, i) => (
              <div key={i}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--color-terracotta)', display: 'grid', placeItems: 'center', fontWeight: 700, marginBottom: 12 }}>{i + 1}</div>
                <h4 style={{ color: 'var(--color-paper)', fontSize: 16, marginBottom: 6 }}>{t.title}</h4>
                <p style={{ color: 'var(--color-paper-3)', fontSize: 13, lineHeight: 1.5, margin: 0 }}>{t.note}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Footer tag="M1 · retrospective" />
    </main>
  );
}

function CalibrationRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--color-line)' }}>
      <span style={{ fontSize: 13, color: 'var(--color-ink-3)' }}>{label}</span>
      <span className="font-mono" style={{ color, fontWeight: 500 }}>{value}</span>
    </div>
  );
}

function PlanVsActualChart({ plan, actual }: { plan: RuncinoPlan; actual: ActualRace }) {
  const totalMi = plan.race.distance_mi;
  const W = 1000, H = 260, padL = 60, padR = 40, padT = 40, padB = 40;
  const paceMin = 420; // 7:00/mi
  const paceMax = 720; // 12:00/mi

  const xScale = (mi: number) => padL + (mi / totalMi) * (W - padL - padR);
  const yScale = (pace: number) => padT + ((pace - paceMin) / (paceMax - paceMin)) * (H - padT - padB);

  // Build stepped planned-pace line from intervals
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

function HrEnvelope({ series, avgHr, peakHr }: { series: ActualRace['series']; avgHr: number; peakHr: number }) {
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
