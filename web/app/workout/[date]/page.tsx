/**
 * /workout/[date] — single-session workout detail.
 *
 * Reads the active plan from the DB and shows the actual scheduled
 * workout for the requested date. Falls back gracefully when no plan
 * exists or the date isn't in the plan.
 */

import Link from 'next/link';
import { Caption } from '../../../components/nav';
import { Topbar } from '../../components/Topbar';
import { TopbarClock } from '../../components/TopbarClock';
import { getCurrentPlan } from '../../../coach/plan-lifecycle';
import { vdotSnapshot, pacesFromVdot } from '../../../lib/vdot';
import { gatherCoachState } from '../../../lib/coach-state';
import type { PlanWorkout, PhaseLabel } from '../../../coach/plan-types';

function fmtPace(sPerMi: number): string {
  const m = Math.floor(sPerMi / 60);
  const s = Math.round(sPerMi % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtMin(distMi: number, sPerMi: number): string {
  return `~${Math.round((distMi * sPerMi) / 60)} min`;
}

const TYPE_DISPLAY: Record<string, string> = {
  threshold: 'Threshold',
  interval:  'Intervals',
  long:      'Long Run',
  easy:      'Easy Run',
  recovery:  'Recovery',
  shakeout:  'Shakeout',
  race:      'Race',
  rest:      'Rest',
  mp:        'Marathon Pace',
};

const PHASE_CHIP: Record<PhaseLabel, { label: string; color: string }> = {
  BASE:        { label: 'BASE BLOCK',   color: 'var(--corp)'  },
  BUILD:       { label: 'BUILD BLOCK',  color: 'var(--good)'  },
  PEAK:        { label: 'PEAK BLOCK',   color: 'var(--att)'   },
  TAPER:       { label: 'TAPER',        color: 'var(--att)'   },
  RACE_WEEK:   { label: 'RACE WEEK',    color: 'var(--race)'  },
  MAINTENANCE: { label: 'MAINTENANCE',  color: 'var(--corp)'  },
};

export default async function WorkoutDetailPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;

  // Load plan + state in parallel.
  const [planResult, state] = await Promise.all([
    getCurrentPlan('me').catch(() => ({ plan: null, action: 'error' })),
    gatherCoachState().catch(() => null),
  ]);

  const plan = planResult.plan;

  // Find the workout and its week/phase.
  let workout: PlanWorkout | null = null;
  let phaseLabel: PhaseLabel | null = null;
  let weekIdx: number | null = null;
  let weekStart: string | null = null;

  if (plan) {
    for (const week of plan.weeks) {
      const found = week.workouts.find((w) => w.dateISO === date);
      if (found) {
        workout = found;
        weekIdx = week.weekIdx;
        weekStart = week.weekStartISO;
        const phase = plan.phases.find(
          (p) => week.weekIdx >= p.startWeekIdx && week.weekIdx <= p.endWeekIdx,
        );
        phaseLabel = phase?.label ?? null;
        break;
      }
    }
  }

  // Pace display.
  const vdotLib = state ? vdotSnapshot(state) : null;
  const paces = vdotLib ? pacesFromVdot(vdotLib.vdot) : null;

  const paceDisplay = workout?.paceTargetSPerMi
    ? fmtPace(workout.paceTargetSPerMi)
    : paces?.E
    ? `${fmtPace(paces.E.lowS)}–${fmtPace(paces.E.highS)}`
    : '—';

  // Breadcrumb date display.
  const dateObj = new Date(date + 'T12:00:00Z');
  const dateDisplay = dateObj.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  });

  const typeDisplay = workout ? (TYPE_DISPLAY[workout.type] ?? workout.type) : 'Workout';
  const phaseChip = phaseLabel ? PHASE_CHIP[phaseLabel] : null;

  // Warm-up / main / cool-down split.
  const totalMi = workout?.distanceMi ?? 0;
  const warmMi = workout && workout.type !== 'rest' ? Math.max(0.4, Math.round(totalMi * 0.16 * 10) / 10) : 0;
  const coolMi = workout && workout.type !== 'rest' ? Math.max(0.4, Math.round(totalMi * 0.16 * 10) / 10) : 0;
  const mainMi = Math.max(0, Math.round((totalMi - warmMi - coolMi) * 10) / 10);
  const easyPaceS = paces?.E ? Math.round((paces.E.lowS + paces.E.highS) / 2) : 540;
  const warmS = Math.round(warmMi * (easyPaceS + 30));

  const isQuality = workout?.isQuality ?? false;
  const subLabel = workout?.subLabel;

  return (
    <>
      <Caption left="faff.run · workout" right={`WORKOUT · ${date}`} />
      <div className="stage">
        <Topbar activeTab="training" clock={<TopbarClock />} />
        <div className="body">

          {/* Breadcrumb */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontFamily: 'var(--font-data)', fontSize: 10, letterSpacing: '1.6px',
            color: 'var(--color-t3)', fontWeight: 700, textTransform: 'uppercase',
            marginBottom: 14,
          }}>
            <Link href="/training" style={{ color: 'inherit' }}>Training</Link>
            <span>/</span>
            {plan && <><span>{plan.mode === 'race-prep' ? plan.goalISO : 'Maintenance'}</span><span>/</span></>}
            {weekIdx !== null && <><span>Wk {weekIdx + 1}{phaseLabel ? ` · ${phaseLabel.toLowerCase()}` : ''}</span><span>/</span></>}
            <span style={{ color: 'var(--color-t1)' }}>{dateDisplay} · {typeDisplay.toLowerCase()}</span>
          </div>

          {workout ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 14 }}>

              {/* LEFT — workout body */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

                {/* Hero */}
                <div className="tile" style={{
                  padding: '24px 26px',
                  background: isQuality
                    ? 'linear-gradient(135deg, var(--color-l2) 0%, var(--active-wash) 100%)'
                    : 'var(--color-l2)',
                  borderColor: isQuality ? 'rgba(79,143,247,.25)' : undefined,
                }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {isQuality && (
                      <span className="chip chip--corporate">{workout.type.toUpperCase()}</span>
                    )}
                    {phaseChip && (
                      <span className="chip" style={{ color: phaseChip.color, borderColor: phaseChip.color }}>
                        {phaseChip.label}
                      </span>
                    )}
                    {weekIdx !== null && (
                      <span className="chip">WK {weekIdx + 1}</span>
                    )}
                    {subLabel && (
                      <span className="chip" style={{ color: 'var(--color-t1)' }}>{subLabel}</span>
                    )}
                  </div>

                  <div style={{
                    fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 56,
                    lineHeight: 0.95, letterSpacing: '-.005em', textTransform: 'uppercase',
                    marginTop: 10,
                  }}>
                    {typeDisplay}
                  </div>

                  {/* KPI strip */}
                  {workout.type !== 'rest' && (
                    <div style={{
                      display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14,
                      padding: '18px 0 4px', borderTop: '1px solid var(--color-l4)', marginTop: 16,
                    }}>
                      <Kpi value={totalMi.toFixed(1)} unit="mi" label="Distance" />
                      <Kpi
                        value={`~${Math.round((totalMi * (workout.paceTargetSPerMi ?? easyPaceS)) / 60)}`}
                        unit="min"
                        label="Duration"
                      />
                      <Kpi value={paceDisplay} unit="/mi" label="Pace target" accent={isQuality} />
                      <Kpi
                        value={workout.isLong ? 'E' : isQuality ? 'T/I' : 'E'}
                        unit="zone"
                        label="Effort zone"
                      />
                    </div>
                  )}
                </div>

                {/* Notes / prescription */}
                {workout.notes && (
                  <div style={{
                    background: 'var(--color-l2)', borderRadius: 13, padding: '18px 20px',
                    borderLeft: `3px solid ${isQuality ? 'var(--color-corporate)' : 'var(--color-l5)'}`,
                  }}>
                    <div style={{
                      fontFamily: 'var(--font-data)', fontSize: 10, letterSpacing: '1.6px',
                      color: isQuality ? 'var(--color-corporate)' : 'var(--color-t3)',
                      fontWeight: 700, textTransform: 'uppercase', marginBottom: 8,
                    }}>
                      Session prescription
                    </div>
                    <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--color-t1)' }}>
                      {workout.notes}
                    </div>
                  </div>
                )}

                {/* Structure */}
                {workout.type !== 'rest' && totalMi > 0 && (
                  <div className="tile">
                    <div className="tile-h">
                      <div className="tile-lbl">Structure</div>
                      <div style={{
                        fontFamily: 'var(--font-data)', fontSize: 10, letterSpacing: '1.4px',
                        color: 'var(--color-t3)', fontWeight: 700, textTransform: 'uppercase',
                      }}>
                        Total · {totalMi.toFixed(1)} mi · ~{Math.round((totalMi * (workout.paceTargetSPerMi ?? easyPaceS)) / 60)} min
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <StructBlock
                        start="0:00"
                        name={`Warm-up · ${warmMi.toFixed(1)} mi easy`}
                        pace={`${fmtPace(easyPaceS + 30)}/mi`}
                        duration={fmtMin(warmMi, easyPaceS + 30)}
                      />
                      <StructBlock
                        start={fmtClock(warmS)}
                        name={`Main · ${mainMi.toFixed(1)} mi${subLabel ? ` · ${subLabel}` : ''}`}
                        pace={`${paceDisplay}/mi`}
                        duration={fmtMin(mainMi, workout.paceTargetSPerMi ?? easyPaceS)}
                        highlight={isQuality}
                      />
                      <StructBlock
                        start={fmtClock(Math.round(warmS + mainMi * (workout.paceTargetSPerMi ?? easyPaceS)))}
                        name={`Cool-down · ${coolMi.toFixed(1)} mi easy`}
                        pace={`${fmtPace(easyPaceS + 30)}/mi`}
                        duration={fmtMin(coolMi, easyPaceS + 30)}
                      />
                    </div>
                  </div>
                )}

                {/* Mutations */}
                {workout.mutations.length > 0 && (
                  <div className="tile">
                    <div className="tile-h">
                      <div className="tile-lbl">Coach adjustments</div>
                      <span className="chip chip--corporate">{workout.mutations.length} change{workout.mutations.length > 1 ? 's' : ''}</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {workout.mutations.slice().sort((a, b) => b.ts.localeCompare(a.ts)).map((m) => (
                        <div key={m.id} style={{
                          padding: '12px 14px', background: 'var(--color-l3)', borderRadius: 8,
                          borderLeft: '3px solid var(--color-corporate)',
                        }}>
                          <div style={{ fontSize: 13, color: 'var(--color-t1)', lineHeight: 1.5 }}>{m.reason}</div>
                          <div style={{
                            fontFamily: 'var(--font-data)', fontSize: 9.5, letterSpacing: '1.3px',
                            color: 'var(--color-t3)', fontWeight: 700, textTransform: 'uppercase', marginTop: 6,
                          }}>
                            {m.citation} · {m.ts.slice(0, 10)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* RIGHT — context column (stubs until M3) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="tile" style={{
                  background: 'var(--color-corporate)', borderRadius: 13, padding: '20px 22px',
                  color: '#fff',
                }}>
                  <div style={{
                    fontFamily: 'var(--font-data)', fontSize: 10, letterSpacing: '1.7px',
                    fontWeight: 700, textTransform: 'uppercase', opacity: 0.75,
                  }}>Ready when you are</div>
                  <div style={{
                    fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 28,
                    lineHeight: 1, textTransform: 'uppercase', marginTop: 8,
                  }}>Send to Watch</div>
                  <div style={{ fontSize: 12.5, lineHeight: 1.5, opacity: 0.8, marginTop: 10 }}>
                    Watch integration coming in M3 — Garmin Connect IQ export with per-rep targets and audio cues.
                  </div>
                  <button disabled style={{
                    marginTop: 14, padding: '10px 20px', borderRadius: 100,
                    background: 'rgba(255,255,255,.16)', color: '#fff',
                    border: '1px solid rgba(255,255,255,.18)',
                    fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'not-allowed',
                  }}>Send — coming soon</button>
                </div>

                <div className="tile">
                  <div className="tile-lbl">Conditions</div>
                  <div style={{ fontSize: 13, color: 'var(--color-t2)', marginTop: 8, lineHeight: 1.5 }}>
                    Weather wiring coming soon. Check your local forecast before heading out.
                  </div>
                </div>

                {paces && (
                  <div className="tile">
                    <div className="tile-h">
                      <div className="tile-lbl">Your pace zones</div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                      {[
                        { label: 'Easy (E)', range: paces.E ? `${fmtPace(paces.E.lowS)}–${fmtPace(paces.E.highS)}` : '—' },
                        { label: 'Marathon (M)', range: paces.M ? `${fmtPace(paces.M.lowS)}–${fmtPace(paces.M.highS)}` : '—' },
                        { label: 'Threshold (T)', range: paces.T ? `${fmtPace(paces.T.lowS)}–${fmtPace(paces.T.highS)}` : '—' },
                        { label: 'Interval (I)', range: paces.I ? `${fmtPace(paces.I.lowS)}–${fmtPace(paces.I.highS)}` : '—' },
                      ].map(({ label, range }) => (
                        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontFamily: 'var(--font-data)', fontSize: 10.5, letterSpacing: '1.2px', color: 'var(--color-t3)', fontWeight: 700, textTransform: 'uppercase' }}>{label}</span>
                          <span style={{ fontFamily: 'var(--font-data)', fontSize: 13, fontWeight: 700, color: 'var(--color-t1)' }}>{range}/mi</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div style={{
              padding: '40px 32px', background: 'var(--color-l2)', borderRadius: 13,
              textAlign: 'center', color: 'var(--color-t2)',
            }}>
              <div style={{
                fontFamily: 'var(--font-data)', fontSize: 10, letterSpacing: '1.8px',
                fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-t3)', marginBottom: 12,
              }}>
                {plan ? `No workout scheduled for ${dateDisplay}` : 'No active plan'}
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.6 }}>
                {plan
                  ? 'This date may be outside the plan window or on a rest day.'
                  : 'Build a training plan from the Training page to see workout detail here.'}
              </div>
              <Link href="/training" style={{
                display: 'inline-block', marginTop: 20, padding: '10px 20px',
                background: 'var(--color-corporate)', color: '#fff', borderRadius: 8,
                textDecoration: 'none', fontSize: 13, fontWeight: 600,
              }}>
                → Training Plan
              </Link>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Kpi({ value, unit, label, accent }: { value: string; unit: string; label: string; accent?: boolean }) {
  return (
    <div>
      <div style={{
        fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 32,
        letterSpacing: '-.02em', lineHeight: 1,
        color: accent ? 'var(--color-corporate)' : 'var(--color-t0)',
      }}>
        {value}
        <small style={{
          fontSize: 12, marginLeft: 4, fontFamily: 'var(--font-data)',
          letterSpacing: '1.2px', textTransform: 'uppercase',
          color: accent ? 'rgba(79,143,247,.6)' : 'var(--color-t3)',
        }}>{unit}</small>
      </div>
      <div style={{
        fontFamily: 'var(--font-data)', fontSize: 9.5, letterSpacing: '1.4px',
        color: 'var(--color-t3)', fontWeight: 700, textTransform: 'uppercase', marginTop: 6,
      }}>{label}</div>
    </div>
  );
}

function StructBlock({ start, name, pace, duration, highlight }: {
  start: string; name: string; pace: string; duration: string; highlight?: boolean;
}) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '60px 1fr auto auto',
      gap: 14, alignItems: 'center', padding: '12px 14px',
      background: highlight ? 'var(--active-wash)' : 'var(--color-l3)',
      borderRadius: 8,
      borderLeft: `3px solid ${highlight ? 'var(--color-corporate)' : 'var(--color-l5)'}`,
    }}>
      <span style={{
        fontFamily: 'var(--font-data)', fontSize: 10.5,
        color: highlight ? 'var(--color-corporate)' : 'var(--color-t3)', fontWeight: 700,
      }}>{start}</span>
      <span style={{ fontSize: 13.5, fontWeight: highlight ? 700 : 500, color: 'var(--color-t1)' }}>{name}</span>
      <span style={{
        fontFamily: 'var(--font-data)', fontSize: 13,
        color: highlight ? 'var(--color-corporate)' : 'var(--color-t1)', fontWeight: 700,
      }}>{pace}</span>
      <span style={{
        fontFamily: 'var(--font-data)', fontSize: 10.5,
        color: highlight ? 'rgba(79,143,247,.6)' : 'var(--color-t3)',
      }}>{duration}</span>
    </div>
  );
}

function fmtClock(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = Math.round(totalSec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
