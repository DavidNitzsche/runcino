/**
 * PlanCalendar · renders the active multi-week plan from /api/plan/active.
 *
 * One row per plan week. Each row shows the 7 days with their type
 * and distance. Phase chips on the left. Mutations surface as small
 * "ADJUSTED" chips on affected workouts.
 *
 * This is the surface that consumes `getActivePlan` for the /training
 * page per docs/PLAN_ARCHITECTURE.md §What the UI reads from the plan.
 */

'use client';

import { useEffect, useState } from 'react';
import { Card, CardHeader, CardLabel, CardPin, EmptyState } from '@/app/components';
import { WorkoutDetailPopup, type WorkoutPopupData } from '@/app/overview/WorkoutDetailPopup';

interface PlanWorkoutData {
  id: string;
  dateISO: string;
  dow: number;
  type: string;
  distanceMi: number;
  isQuality: boolean;
  isLong: boolean;
  notes?: string;
  subLabel?: string | null;
  paceTargetSPerMi?: number | null;
  mutations: Array<{ reason: string; trigger: string; citation: string }>;
}

interface PlanWeekData {
  id: string;
  weekIdx: number;
  weekStartISO: string;
  phaseId: string;
  isCutback: boolean;
  isPeak: boolean;
  isRaceWeek: boolean;
  rationale: string;
  workouts: PlanWorkoutData[];
}

interface PlanPhaseData {
  id: string;
  label: 'BASE' | 'BUILD' | 'PEAK' | 'TAPER' | 'RACE_WEEK' | 'MAINTENANCE';
  startWeekIdx: number;
  endWeekIdx: number;
}

interface PlanData {
  id: string;
  mode: 'race-prep' | 'maintenance';
  goalISO: string;
  weeks: PlanWeekData[];
  phases: PlanPhaseData[];
}

interface PlanResponse {
  ok: boolean;
  plan: PlanData | null;
  lifecycleAction: string;
  recentMutations: Array<{ ts: string; reason: string; trigger: string; citation: string; workoutDateISO: string }>;
  error?: string;
}

const PHASE_COLOR: Record<string, string> = {
  BASE:        'var(--good, #3ebd41)',
  BUILD:       'var(--corp, #27b4e0)',
  PEAK:        'var(--race, #d4523c)',
  TAPER:       'var(--att, #d1a85a)',
  RACE_WEEK:   'var(--race, #d4523c)',
  MAINTENANCE: 'var(--coach, #27b4e0)',
};

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function PlanCalendar() {
  const [response, setResponse] = useState<PlanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedWorkout, setSelectedWorkout] = useState<WorkoutPopupData | null>(null);
  // Browser-local calendar day (not UTC) so the "today" cell is right in the
  // evening — toISOString() is UTC and would highlight tomorrow after ~4-5pm PT.
  const today = new Date().toLocaleDateString('en-CA');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/plan/active', { cache: 'no-store' })
      .then(res => res.json())
      .then((json: PlanResponse) => {
        if (cancelled) return;
        if (!json.ok) {
          setError(json.error ?? 'Plan load failed');
          return;
        }
        setResponse(json);
      })
      .catch(e => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return (
      <Card span={12} padding="20px 22px">
        <CardHeader>
          <CardLabel>PLAN · MULTI-WEEK CALENDAR</CardLabel>
          <CardPin variant="warn">ERROR</CardPin>
        </CardHeader>
        <EmptyState variant="empty" title="Plan unavailable" body={error} />
      </Card>
    );
  }
  if (!response) {
    return (
      <Card span={12} padding="20px 22px">
        <CardHeader>
          <CardLabel>PLAN · MULTI-WEEK CALENDAR</CardLabel>
          <CardPin variant="muted">LOADING</CardPin>
        </CardHeader>
        <div style={{ height: 200 }} />
      </Card>
    );
  }
  if (!response.plan) {
    return (
      <Card span={12} padding="20px 22px">
        <CardHeader>
          <CardLabel>PLAN · MULTI-WEEK CALENDAR</CardLabel>
          <CardPin variant="muted">NO ACTIVE PLAN</CardPin>
        </CardHeader>
        <EmptyState
          variant="empty"
          title="No plan yet"
          body="Set your level + day prefs in the profile to author one."
        />
      </Card>
    );
  }
  const plan = response.plan;
  const phaseOf = (idx: number) => plan.phases.find(p => idx >= p.startWeekIdx && idx <= p.endWeekIdx);

  return (
    <Card span={12} padding="20px 22px">
      <CardHeader>
        <CardLabel>PLAN · MULTI-WEEK CALENDAR</CardLabel>
        <CardPin variant="coach">
          {plan.mode === 'race-prep' ? `RACE PREP · ${plan.goalISO}` : `MAINTENANCE · ${plan.goalISO}`}
        </CardPin>
      </CardHeader>

      {/* Phase legend */}
      <div style={{ display: 'flex', gap: 14, marginTop: 12, flexWrap: 'wrap' }}>
        {Array.from(new Set(plan.phases.map(p => p.label))).map(label => (
          <div key={label} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: PHASE_COLOR[label] || 'var(--t3)' }} />
            <span style={{ color: 'var(--t1)', fontFamily: 'var(--f-data)', letterSpacing: 1 }}>{label}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gap: 6, marginTop: 14 }}>
        {/* Header row */}
        <div style={{ display: 'grid', gridTemplateColumns: '80px repeat(7, 1fr)', gap: 4, fontSize: 9, color: 'var(--t3)', fontFamily: 'var(--f-data)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          <div>WK</div>
          {['MON','TUE','WED','THU','FRI','SAT','SUN'].map((d, i) => (
            <div key={i} style={{ textAlign: 'center' }}>{d}</div>
          ))}
        </div>
        {plan.weeks.map(wk => {
          const phase = phaseOf(wk.weekIdx);
          const phaseColor = phase ? PHASE_COLOR[phase.label] : 'var(--t3)';
          const ordered = [...wk.workouts].sort((a, b) => a.dateISO.localeCompare(b.dateISO));
          const weeklyMi = ordered.reduce((s, w) => s + w.distanceMi, 0);
          return (
            <div
              key={wk.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '80px repeat(7, 1fr)',
                gap: 4,
                padding: '5px 0',
                borderTop: '1px solid var(--l4)',
                alignItems: 'stretch',
              }}
            >
              {/* Week label column */}
              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2, paddingRight: 4 }}>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ width: 6, height: 6, borderRadius: 1, background: phaseColor, flexShrink: 0 }} />
                  <span style={{ fontFamily: 'var(--f-display)', fontSize: 12, fontWeight: 700, lineHeight: 1 }}>
                    W{wk.weekIdx + 1}
                  </span>
                </div>
                <div style={{ fontFamily: 'var(--f-data)', fontSize: 10, color: 'var(--t2)', lineHeight: 1 }}>
                  {weeklyMi % 1 === 0 ? weeklyMi.toFixed(0) : weeklyMi.toFixed(1)} MI
                </div>
                {(wk.isPeak || wk.isCutback || wk.isRaceWeek) && (
                  <div style={{ fontSize: 8, fontFamily: 'var(--f-data)', fontWeight: 700, color: wk.isRaceWeek ? 'var(--race)' : wk.isPeak ? 'var(--race)' : 'var(--att)', letterSpacing: '0.05em' }}>
                    {wk.isRaceWeek ? 'RACE' : wk.isPeak ? 'PEAK' : 'CUT'}
                  </div>
                )}
              </div>
              {ordered.map(w => (
                <WorkoutCell
                  key={w.id}
                  w={w}
                  phaseColor={phaseColor}
                  onOpen={(wo) => setSelectedWorkout(wo)}
                  today={today}
                />
              ))}
            </div>
          );
        })}
      </div>
      <WorkoutDetailPopup workout={selectedWorkout} onClose={() => setSelectedWorkout(null)} />
    </Card>
  );
}

const WORKOUT_LABELS: Record<string, string> = {
  easy: 'Easy', long: 'Long Run', threshold: 'Threshold',
  interval: 'Intervals', mp: 'MP', recovery: 'Recovery',
  shakeout: 'Shakeout', race: 'RACE', rest: 'Rest',
  race_week_tuneup: 'Tune-Up',
};

const WORKOUT_COLORS: Record<string, string> = {
  threshold: 'var(--corp)', interval: 'var(--corp)',
  long: 'var(--good)', race: 'var(--race)',
  recovery: 'var(--att)', shakeout: 'var(--att)',
  race_week_tuneup: 'var(--corp)',
};

function WorkoutCell({ w, phaseColor, onOpen, today }: {
  w: PlanWorkoutData;
  phaseColor: string;
  onOpen: (wo: WorkoutPopupData) => void;
  today?: string;
}) {
  const adjusted = w.mutations.length > 0;
  const isRace = w.type === 'race';
  const isRest = w.type === 'rest';
  const isToday = today ? w.dateISO === today : false;
  const hasStrength = w.notes?.includes('\n\nStrength');
  const accentColor = WORKOUT_COLORS[w.type] || (w.isQuality ? 'var(--corp)' : w.isLong ? 'var(--good)' : 'var(--l3)');
  const label = w.subLabel || WORKOUT_LABELS[w.type] || w.type;

  const popupData: WorkoutPopupData = {
    dateISO: w.dateISO, type: w.type, subLabel: w.subLabel,
    distanceMi: w.distanceMi, isQuality: w.isQuality, isLong: w.isLong,
    paceTargetSPerMi: w.paceTargetSPerMi, notes: w.notes,
    mutations: w.mutations.map(m => ({ reason: m.reason })),
  };

  return (
    <div
      onClick={() => !isRest && onOpen(popupData)}
      style={{
        aspectRatio: '1 / 1',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '7px 8px 6px',
        borderRadius: 6,
        border: isToday
          ? `2px solid var(--att)`
          : adjusted
          ? `1px dashed var(--coach)`
          : `1px solid var(--l4)`,
        borderTop: `3px solid ${isRest ? 'var(--l4)' : isRace ? 'var(--race)' : accentColor}`,
        background: isRace
          ? 'rgba(212,82,60,.10)'
          : w.isQuality
          ? 'rgba(39,180,224,.06)'
          : w.isLong
          ? 'rgba(62,189,65,.06)'
          : 'transparent',
        cursor: isRest ? 'default' : 'pointer',
        position: 'relative',
        minWidth: 0,
        transition: 'border-color 0.12s',
      }}
    >
      {/* Type label */}
      <div style={{
        fontFamily: 'var(--f-data)',
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: isRest ? 'var(--t3)' : isRace ? 'var(--race)' : accentColor,
        lineHeight: 1.1,
      }}>
        {isRest ? ', ' : label}
      </div>

      {/* Distance */}
      {w.distanceMi > 0 && (
        <div style={{
          fontFamily: 'var(--f-display)',
          fontSize: 15,
          fontWeight: 700,
          color: 'var(--t0)',
          lineHeight: 1,
          letterSpacing: '-0.02em',
        }}>
          {w.distanceMi % 1 === 0 ? w.distanceMi.toFixed(0) : w.distanceMi.toFixed(1)}
          <span style={{ fontFamily: 'var(--f-data)', fontSize: 8, fontWeight: 600, opacity: 0.5, marginLeft: 2 }}>MI</span>
        </div>
      )}

      {/* Strength badge */}
      {hasStrength && (
        <div style={{
          fontFamily: 'var(--f-data)',
          fontSize: 8,
          fontWeight: 700,
          color: 'var(--att)',
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          lineHeight: 1,
        }}>
          + STR
        </div>
      )}

      {/* Mutation chip */}
      {adjusted && (
        <div style={{
          position: 'absolute', top: 3, right: 4,
          fontSize: 7, color: 'var(--coach)', fontWeight: 700, letterSpacing: 0.3,
        }}>▾ADJ</div>
      )}
    </div>
  );
}
