import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Nav, Footer } from '../../../components/nav';
import { getRaceWithLatest } from '../../../lib/db/repo';
import { computeRetrospective, type ActualRace } from '../../../lib/retrospective';
import { formatHMS, formatPaceMi } from '../../../lib/time';
import type { RuncinoPlan } from '../../../lib/types';
import { PlanVsActualChart, HrEnvelope } from './charts';

export const dynamic = 'force-dynamic';

function formatRaceDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default async function RaceDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await getRaceWithLatest(slug);
  if (!data) notFound();

  const { race, plan, actual } = data;

  return (
    <main style={{ maxWidth: 1180, margin: '0 auto', padding: '0 32px' }}>
      <Nav active="races" />

      <section style={{ padding: '40px 0 24px' }}>
        <div style={{ marginBottom: 16 }}>
          <Link href="/races" style={{ color: 'var(--color-ink-3)', textDecoration: 'none', fontSize: 14 }}>← All races</Link>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 8 }}>{formatRaceDate(race.raceDate)}</div>
            <h1 style={{ fontSize: 44, margin: '0 0 8px', lineHeight: 1.1 }}>{race.name}</h1>
            <div style={{ display: 'flex', gap: 12, fontSize: 14, color: 'var(--color-ink-3)' }}>
              <span style={{ textTransform: 'capitalize' }}>{race.status}</span>
              {race.goalFinishS && (
                <>
                  <span>·</span>
                  <span className="font-mono">goal {formatHMS(race.goalFinishS)}</span>
                </>
              )}
              {actual && (
                <>
                  <span>·</span>
                  <span className="font-mono">finished {formatHMS(actual.finish_time_s)}</span>
                </>
              )}
            </div>
          </div>
        </div>
        {race.notes && (
          <p style={{ marginTop: 16, color: 'var(--color-ink-2)', fontSize: 15, maxWidth: '60ch' }}>{race.notes}</p>
        )}
      </section>

      {!plan && (
        <section style={{ padding: '24px 0' }}>
          <div className="runcino-card" style={{ background: 'var(--color-paper-2)', textAlign: 'center', padding: 48 }}>
            <h3 style={{ fontSize: 20, marginBottom: 8 }}>No plan built yet.</h3>
            <p style={{ color: 'var(--color-ink-3)', marginBottom: 20 }}>Build a Minetti-adjusted plan from a course GPX.</p>
            <Link href="/" className="btn btn-accent">Build the plan →</Link>
          </div>
        </section>
      )}

      {plan && (
        <>
          <PlanSection plan={plan} hasActual={Boolean(actual)} />
          {actual ? (
            <ComparisonSection plan={plan} actual={actual} />
          ) : (
            <AwaitingActualSection />
          )}
          <FuelingSection plan={plan} />
          <LandmarksSection plan={plan} />
        </>
      )}

      <Footer tag={`races / ${race.slug}`} />
    </main>
  );
}

function PlanSection({ plan, hasActual }: { plan: RuncinoPlan; hasActual: boolean }) {
  return (
    <section style={{ padding: '16px 0' }}>
      <div className="eyebrow" style={{ marginBottom: 12 }}>The plan</div>
      <div className="runcino-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: 24, borderBottom: '1px solid var(--color-line)', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          <Stat label="Distance" value={`${plan.race.distance_mi.toFixed(2)} mi`} />
          <Stat label="Goal time" value={plan.goal.finish_time_display} mono />
          <Stat label="Strategy" value={plan.goal.strategy.replace('_', ' ')} />
          <Stat label="Net elev" value={`${plan.race.total_gain_ft >= plan.race.total_loss_ft ? '+' : '−'}${Math.abs(plan.race.total_gain_ft - plan.race.total_loss_ft)} ft`} />
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: 'var(--color-paper-2)', color: 'var(--color-ink-3)', fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              <th style={{ textAlign: 'left', padding: '12px 24px' }}>Phase</th>
              <th style={{ textAlign: 'right', padding: '12px 12px' }}>Grade</th>
              <th style={{ textAlign: 'right', padding: '12px 12px' }}>Pace</th>
              <th style={{ textAlign: 'right', padding: '12px 24px' }}>Cumul. {hasActual && <span style={{ fontWeight: 400 }}>(plan)</span>}</th>
            </tr>
          </thead>
          <tbody>
            {plan.phases.map(p => (
              <tr key={p.index} style={{ borderTop: '1px solid var(--color-line)' }}>
                <td style={{ padding: '14px 24px' }}>
                  <div style={{ fontWeight: 500 }}>{p.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-ink-3)' }}>mi {p.start_mi.toFixed(1)}–{p.end_mi.toFixed(1)}</div>
                </td>
                <td className="font-mono" style={{ padding: '14px 12px', textAlign: 'right', color: 'var(--color-ink-3)' }}>
                  {p.mean_grade_pct >= 0 ? '+' : ''}{p.mean_grade_pct.toFixed(1)}%
                </td>
                <td className="font-mono" style={{ padding: '14px 12px', textAlign: 'right', fontWeight: 500 }}>{p.target_pace_display}</td>
                <td className="font-mono" style={{ padding: '14px 24px', textAlign: 'right', color: 'var(--color-ink-3)' }}>{p.cumulative_time_display}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ComparisonSection({ plan, actual }: { plan: RuncinoPlan; actual: ActualRace }) {
  const retro = computeRetrospective(plan, actual);
  const isFaster = retro.finish_delta_s < 0;
  const deltaMin = Math.floor(Math.abs(retro.finish_delta_s) / 60);
  const deltaSec = Math.abs(retro.finish_delta_s) % 60;
  const deltaStr = `${retro.finish_delta_s >= 0 ? '+' : '−'}${deltaMin}:${String(deltaSec).padStart(2, '0')}`;

  return (
    <section style={{ padding: '32px 0 16px' }}>
      <div className="eyebrow" style={{ marginBottom: 12 }}>Plan vs actual</div>
      <div className="runcino-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: 24, borderBottom: '1px solid var(--color-line)', display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 24, alignItems: 'center' }}>
          <div>
            <h3 style={{ fontSize: 32, marginBottom: 8 }}>
              Finished <span className="serif-italic" style={{ color: isFaster ? 'var(--color-ok)' : 'var(--color-gold)' }}>{formatHMS(actual.finish_time_s)}</span>
            </h3>
            <div style={{ display: 'flex', gap: 14, color: 'var(--color-ink-3)', fontSize: 14, flexWrap: 'wrap' }}>
              <span>goal {formatHMS(plan.goal.finish_time_s)}</span>
              <span>·</span>
              <span style={{ color: isFaster ? 'var(--color-ok)' : 'var(--color-gold)' }}>{deltaStr} {isFaster ? 'under' : 'over'}</span>
              <span>·</span>
              <span>avg HR {actual.avg_hr_bpm}</span>
              <span>·</span>
              <span>peak {actual.peak_hr_bpm}</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
            <span className="runcino-pill">Wind {actual.weather.wind_mph} mph {actual.weather.wind_dir}</span>
            <span className="runcino-pill">{actual.weather.start_temp_f}°→{actual.weather.finish_temp_f}°F · {actual.weather.cloud_cover}</span>
          </div>
        </div>

        <div style={{ padding: 24, background: 'var(--color-paper-2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <h4 style={{ fontSize: 16, margin: 0 }}>Where the race diverged</h4>
            <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--color-ink-3)' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 12, height: 2, background: 'var(--color-sage)' }} /> planned
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 12, height: 2, background: 'var(--color-terracotta)' }} /> actual
              </span>
            </div>
          </div>
          <PlanVsActualChart plan={plan} actual={actual} />
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ color: 'var(--color-ink-3)', fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              <th style={{ textAlign: 'left', padding: '14px 24px' }}>Phase</th>
              <th style={{ textAlign: 'right', padding: '14px 12px' }}>Plan</th>
              <th style={{ textAlign: 'right', padding: '14px 12px' }}>Actual</th>
              <th style={{ textAlign: 'right', padding: '14px 12px' }}>Δ</th>
              <th style={{ textAlign: 'right', padding: '14px 24px' }}>HR</th>
            </tr>
          </thead>
          <tbody>
            {retro.phase_deltas.map(pd => {
              const color = pd.status === 'on_plan' ? 'var(--color-ok)'
                : pd.status === 'small_drift' ? 'var(--color-gold)'
                : 'var(--color-danger)';
              return (
                <tr key={pd.phaseIdx} style={{ borderTop: '1px solid var(--color-line)' }}>
                  <td style={{ padding: '14px 24px' }}>
                    <div style={{ fontWeight: 500 }}>{pd.label}</div>
                  </td>
                  <td className="font-mono" style={{ padding: '14px 12px', textAlign: 'right', color: 'var(--color-ink-3)' }}>
                    {formatPaceMi(pd.plannedPaceSPerMi)}
                  </td>
                  <td className="font-mono" style={{ padding: '14px 12px', textAlign: 'right', fontWeight: 500 }}>
                    {formatPaceMi(pd.actualPaceSPerMi)}
                  </td>
                  <td className="font-mono" style={{ padding: '14px 12px', textAlign: 'right', color, fontWeight: 600 }}>
                    {pd.deltaSPerMi >= 0 ? '+' : '−'}{Math.abs(pd.deltaSPerMi)}s
                  </td>
                  <td className="font-mono" style={{ padding: '14px 24px', textAlign: 'right', color: 'var(--color-ink-3)' }}>
                    {pd.meanHrBpm} <span style={{ color: 'var(--color-ink-4)' }}>· {pd.peakHrBpm}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
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
          <div className="eyebrow" style={{ marginBottom: 12 }}>Calibration</div>
          <CalibrationRow label="Climb coefficient" value={`${retro.calibration.climb_coefficient.toFixed(2)} ×`} color={retro.calibration.climb_coefficient < 1.05 ? 'var(--color-ok)' : 'var(--color-gold)'} />
          <CalibrationRow label="Descent coefficient" value={`${retro.calibration.descent_coefficient.toFixed(2)} ×`} color={retro.calibration.descent_coefficient < 1.05 ? 'var(--color-ok)' : 'var(--color-gold)'} />
          <CalibrationRow
            label="Headwind sensitivity"
            value={retro.calibration.headwind_sensitivity_s_per_mi_per_mph !== null
              ? `+${retro.calibration.headwind_sensitivity_s_per_mi_per_mph} s/mi/mph`
              : 'insufficient'}
            color={retro.calibration.headwind_sensitivity_s_per_mi_per_mph !== null ? 'var(--color-danger)' : 'var(--color-ink-4)'}
          />
          <CalibrationRow label="HR drift early→late" value={`${retro.calibration.hr_drift_bpm >= 0 ? '+' : ''}${retro.calibration.hr_drift_bpm} bpm`} color={retro.calibration.hr_drift_bpm < 8 ? 'var(--color-ok)' : 'var(--color-danger)'} />
        </div>
      </div>

      {retro.takeaways.length > 0 && (
        <div className="runcino-card" style={{ marginTop: 16, background: 'var(--color-ink)', color: 'var(--color-paper)', borderColor: 'var(--color-ink)' }}>
          <div className="eyebrow" style={{ color: 'var(--color-terracotta-2)', marginBottom: 12 }}>Carry into next race</div>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(retro.takeaways.length, 3)}, 1fr)`, gap: 20 }}>
            {retro.takeaways.map((t, i) => (
              <div key={i}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--color-terracotta)', display: 'grid', placeItems: 'center', fontWeight: 700, marginBottom: 10 }}>{i + 1}</div>
                <h4 style={{ color: 'var(--color-paper)', fontSize: 15, marginBottom: 6 }}>{t.title}</h4>
                <p style={{ color: 'var(--color-paper-3)', fontSize: 13, lineHeight: 1.5, margin: 0 }}>{t.note}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function AwaitingActualSection() {
  return (
    <section style={{ padding: '24px 0' }}>
      <div className="runcino-card" style={{ background: 'var(--color-paper-2)', padding: 32 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Awaiting Watch sync</div>
        <h3 style={{ fontSize: 20, marginBottom: 8 }}>Real splits will land here.</h3>
        <p style={{ color: 'var(--color-ink-3)', margin: 0, maxWidth: '58ch' }}>
          Once Apple Health or Strava is wired up, your finish time, per-phase splits, HR envelope, and weather snapshot will appear here automatically and compare against the plan above. The race stays archived even after the plan rolls forward.
        </p>
      </div>
    </section>
  );
}

function FuelingSection({ plan }: { plan: RuncinoPlan }) {
  return (
    <section style={{ padding: '24px 0' }}>
      <div className="eyebrow" style={{ marginBottom: 12 }}>Fueling</div>
      <div className="runcino-card">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: plan.fueling.notes ? 16 : 0 }}>
          <Stat label="Carbs / hr" value={`${plan.fueling.carb_target_g_per_hr} g`} />
          <Stat label="Total carbs" value={`${plan.fueling.total_carbs_g} g`} />
          <Stat label="Gels" value={`${plan.fueling.gel_count}`} />
          <Stat label="Per gel" value={`${plan.fueling.gel_carbs_g} g`} />
        </div>
        {plan.fueling.notes && (
          <p style={{ color: 'var(--color-ink-2)', margin: 0, fontSize: 14 }}>{plan.fueling.notes}</p>
        )}
      </div>
    </section>
  );
}

function LandmarksSection({ plan }: { plan: RuncinoPlan }) {
  const landmarks = plan.intervals.filter(i => i.kind === 'landmark') as Array<{ at_mi: number; label: string }>;
  if (landmarks.length === 0) return null;
  return (
    <section style={{ padding: '24px 0 48px' }}>
      <div className="eyebrow" style={{ marginBottom: 12 }}>Landmarks</div>
      <div className="runcino-card">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
          {landmarks.map((l, i) => (
            <div key={i} style={{ padding: 12, background: 'var(--color-paper-2)', borderRadius: 8 }}>
              <div className="font-mono" style={{ fontSize: 12, color: 'var(--color-ink-3)' }}>mi {l.at_mi.toFixed(1)}</div>
              <div style={{ fontWeight: 500, fontSize: 14, marginTop: 2 }}>{l.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 4 }}>{label}</div>
      <div className={mono ? 'font-mono' : ''} style={{ fontSize: 18, fontWeight: 500, textTransform: mono ? undefined : 'capitalize' }}>{value}</div>
    </div>
  );
}

function CalibrationRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--color-line)' }}>
      <span style={{ fontSize: 13, color: 'var(--color-ink-3)' }}>{label}</span>
      <span className="font-mono" style={{ color, fontWeight: 500, fontSize: 13 }}>{value}</span>
    </div>
  );
}
