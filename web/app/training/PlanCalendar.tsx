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

interface PlanWorkoutData {
  id: string;
  dateISO: string;
  dow: number;
  type: string;
  distanceMi: number;
  isQuality: boolean;
  isLong: boolean;
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
        <div style={{ display: 'grid', gridTemplateColumns: '160px repeat(7, 1fr)', gap: 4, fontSize: 10, color: 'var(--t3)', fontFamily: 'var(--f-data)' }}>
          <div>WEEK</div>
          {DAY_LETTERS.map((d, i) => <div key={i} style={{ textAlign: 'center' }}>{d}</div>)}
        </div>
        {plan.weeks.map(wk => {
          const phase = phaseOf(wk.weekIdx);
          const phaseColor = phase ? PHASE_COLOR[phase.label] : 'var(--t3)';
          // Reorder workouts to be Mon-Sun visually (storage is already calendar-ordered)
          const ordered = [...wk.workouts].sort((a, b) => a.dateISO.localeCompare(b.dateISO));
          const weeklyMi = ordered.reduce((s, w) => s + w.distanceMi, 0);
          return (
            <div
              key={wk.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '160px repeat(7, 1fr)',
                gap: 4,
                padding: '6px 0',
                borderTop: '1px solid var(--l4)',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: phaseColor }} />
                  <span style={{ fontFamily: 'var(--f-display)', fontSize: 13, fontWeight: 600 }}>
                    W{wk.weekIdx + 1}
                  </span>
                  <span style={{ fontFamily: 'var(--f-data)', fontSize: 10, color: 'var(--t3)' }}>
                    {wk.weekStartISO.slice(5)}
                  </span>
                  {wk.isPeak && <span style={{ fontSize: 9, color: 'var(--race)', fontWeight: 700 }}>PEAK</span>}
                  {wk.isCutback && <span style={{ fontSize: 9, color: 'var(--att)', fontWeight: 700 }}>CUT</span>}
                  {wk.isRaceWeek && <span style={{ fontSize: 9, color: 'var(--race)', fontWeight: 700 }}>RACE</span>}
                </div>
                <div style={{ fontSize: 11, fontFamily: 'var(--f-data)', color: 'var(--t2)' }}>
                  {weeklyMi.toFixed(0)} MI
                </div>
              </div>
              {ordered.map(w => (
                <WorkoutCell key={w.id} w={w} phaseColor={phaseColor} />
              ))}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function WorkoutCell({ w, phaseColor }: { w: PlanWorkoutData; phaseColor: string }) {
  const adjusted = w.mutations.length > 0;
  const isRace = w.type === 'race';
  const bg = isRace
    ? 'rgba(212,82,60,.15)'
    : w.isQuality
    ? 'rgba(39,180,224,.08)'
    : w.isLong
    ? 'rgba(62,189,65,.08)'
    : 'transparent';
  return (
    <div
      style={{
        background: bg,
        border: adjusted ? `1px dashed var(--coach)` : `1px solid var(--l4)`,
        borderLeft: `3px solid ${isRace || w.isQuality || w.isLong ? phaseColor : 'transparent'}`,
        padding: '6px 8px',
        borderRadius: 4,
        textAlign: 'center',
        position: 'relative',
        minHeight: 44,
      }}
      title={adjusted ? w.mutations.map(m => m.reason).join(' · ') : w.type}
    >
      <div style={{ fontSize: 10, color: 'var(--t3)', fontFamily: 'var(--f-data)', textTransform: 'uppercase' }}>
        {w.type === 'rest' ? '—' : w.type.slice(0, 8)}
      </div>
      <div style={{ fontSize: 14, fontFamily: 'var(--f-display)', fontWeight: 600, color: 'var(--t0)' }}>
        {w.distanceMi > 0 ? w.distanceMi.toFixed(1) : ''}
      </div>
      {adjusted && (
        <div style={{
          position: 'absolute', top: 2, right: 2,
          fontSize: 8, color: 'var(--coach)', fontWeight: 700,
          letterSpacing: 0.5,
        }}>
          ▾ADJ
        </div>
      )}
    </div>
  );
}
