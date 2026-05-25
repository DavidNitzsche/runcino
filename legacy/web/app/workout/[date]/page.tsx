/**
 * /workout/[date], single-session workout detail.
 *
 * Reads the active plan from the DB and shows the actual scheduled
 * workout for the requested date. Falls back gracefully when no plan
 * exists or the date isn't in the plan.
 */

import Link from 'next/link';
import { approxDuration } from '@/lib/duration';
import { Caption } from '../../../components/nav';
import { Topbar } from '../../components/Topbar';
import { TopbarClock } from '../../components/TopbarClock';
import { getCurrentPlan } from '../../../coach/plan-lifecycle';
import { resolvePlanUserId } from '../../../lib/plan-user';
import { vdotSnapshot, pacesFromVdot } from '../../../lib/vdot';
import { gatherCoachState } from '../../../lib/coach-state';
import { describeWorkout, describeKeyFromPlan, type WorkoutDescription } from '../../../lib/workout-descriptions';
import type { ResolvedFitness } from '../../../lib/fitness-resolver';
import type { PlanWorkout, PhaseLabel } from '../../../coach/plan-types';

function fmtPace(sPerMi: number): string {
  const m = Math.floor(sPerMi / 60);
  const s = Math.round(sPerMi % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const TYPE_DISPLAY: Record<string, string> = {
  threshold:        'Threshold',
  interval:         'Intervals',
  long:             'Long Run',
  easy:             'Easy Run',
  recovery:         'Recovery',
  shakeout:         'Shakeout',
  race:             'Race',
  rest:             'Rest',
  mp:               'Marathon Pace',
  race_week_tuneup: 'Race Week Tune-Up',
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
    getCurrentPlan(await resolvePlanUserId()).catch(() => ({ plan: null, action: 'error' })),
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
    : '-';

  // Breadcrumb date display.
  const dateObj = new Date(date + 'T12:00:00Z');
  const dateDisplay = dateObj.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  });

  const typeDisplay = workout ? (TYPE_DISPLAY[workout.type] ?? workout.type) : 'Workout';
  const phaseChip = phaseLabel ? PHASE_CHIP[phaseLabel] : null;

  const totalMi = workout?.distanceMi ?? 0;
  const easyPaceS = paces?.E ? Math.round((paces.E.lowS + paces.E.highS) / 2) : 540;
  const isQuality = workout?.isQuality ?? false;
  const subLabel = workout?.subLabel;

  // Structure + effort + why from the SAME describeWorkout the overview
  // modal and the iPhone use, no bespoke warm-up/main/cool-down split.
  const fitness: ResolvedFitness | null = paces
    ? ({
        paces,
        racePaceBand: { lowS: paces.T.lowS, highS: paces.T.highS, label: 'Race pace' },
        hrZones: null,
      } as unknown as ResolvedFitness)
    : null;
  const desc: WorkoutDescription | null =
    workout && workout.type !== 'rest'
      ? describeWorkout(describeKeyFromPlan(workout.type, workout.subLabel ?? null), workout.type, fitness)
      : null;

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

              {/* LEFT, workout body */}
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
                        value={approxDuration((totalMi * (workout.paceTargetSPerMi ?? easyPaceS)) / 60).value}
                        unit={approxDuration((totalMi * (workout.paceTargetSPerMi ?? easyPaceS)) / 60).unit}
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

                {/* Structure, from describeWorkout (same source as the
                    overview modal + iPhone), not a bespoke split. */}
                {workout.type !== 'rest' && totalMi > 0 && desc && desc.steps.length > 0 && (
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
                    <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {desc.steps.map((s, i) => (
                        <li key={i} style={{ display: 'flex', gap: 10 }}>
                          <span style={{
                            flex: '0 0 auto', width: 22, height: 22, borderRadius: 11,
                            background: 'var(--color-l3)', color: 'var(--color-t2)',
                            fontFamily: 'var(--font-data)', fontSize: 11, fontWeight: 700,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>{i + 1}</span>
                          <div style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--color-t1)' }}>
                            {s.kind === 'simple' ? (
                              <span>
                                <strong>{s.name}</strong>, <strong>{s.duration}</strong> at <strong>{s.pace}</strong>{' '}
                                <span style={{ color: 'var(--color-t3)' }}>({s.zone})</span>
                                {s.hrTarget && <span style={{ color: 'var(--color-t3)' }}> · HR <strong>{s.hrTarget}</strong></span>}
                              </span>
                            ) : (
                              <div>
                                <strong>{s.name}</strong>
                                <div style={{ color: 'var(--color-corporate)', fontFamily: 'var(--font-data)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', margin: '4px 0' }}>
                                  {s.times} rounds of:
                                </div>
                                <ul style={{ margin: 0, paddingLeft: 16 }}>
                                  {s.items.map((it, j) => (
                                    <li key={j} style={{ marginBottom: 2 }}>
                                      {it.verb} <strong>{it.duration}</strong>
                                      {it.pace && <> at <strong>{it.pace}</strong></>}
                                      {it.zone && <span style={{ color: 'var(--color-t3)' }}> ({it.zone})</span>}
                                      {it.suffix && <> {it.suffix}</>}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        </li>
                      ))}
                    </ol>
                    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--color-l2)' }}>
                      {/* TODAY'S JOB — coach-voice line that translates
                          today's prescription into goal-relevant action.
                          Quality days carry a stretch-pace target; long /
                          easy / rest emphasize the recovery role. Same
                          field the iPhone renders. */}
                      {desc.todaysJob && (
                        <>
                          <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, letterSpacing: '1.4px', color: 'var(--color-corporate)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Today&rsquo;s job</div>
                          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: 'var(--color-t1)' }}>{desc.todaysJob}</p>
                          <div style={{ height: 12 }} />
                        </>
                      )}
                      <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, letterSpacing: '1.4px', color: 'var(--color-t3)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>How it should feel</div>
                      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: 'var(--color-t1)' }}>{desc.effort}</p>
                      <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, letterSpacing: '1.4px', color: 'var(--color-t3)', fontWeight: 700, textTransform: 'uppercase', margin: '12px 0 4px' }}>Why this workout</div>
                      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: 'var(--color-t1)' }}>{desc.why}</p>
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
                            {m.ts.slice(0, 10)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* RIGHT, context column. The "Send to Watch" stub and the
                  "Weather wiring coming soon" tile were both removed — the
                  iPhone+watch sync is wired now (Apple Watch via Faff
                  iPhone), and weather is fetched by the run-detail recap
                  when GPS is available. Surfacing fake placeholders is
                  worse than an honest empty column. */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {paces && (
                  <div className="tile">
                    <div className="tile-h">
                      <div className="tile-lbl">Your pace zones</div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                      {[
                        { label: 'Easy (E)', range: paces.E ? `${fmtPace(paces.E.lowS)}–${fmtPace(paces.E.highS)}` : '-' },
                        { label: 'Marathon (M)', range: paces.M ? `${fmtPace(paces.M.lowS)}–${fmtPace(paces.M.highS)}` : '-' },
                        { label: 'Threshold (T)', range: paces.T ? `${fmtPace(paces.T.lowS)}–${fmtPace(paces.T.highS)}` : '-' },
                        { label: 'Interval (I)', range: paces.I ? `${fmtPace(paces.I.lowS)}–${fmtPace(paces.I.highS)}` : '-' },
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

