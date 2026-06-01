'use client';

/**
 * TrainView v2 — implements the approved "Train Options · Direction A
 * (Dashboard)" handoff (project Train Options.html · chat 2026-05-31).
 *
 * Full visual swap of the previous TrainView. Wiring kept compatible:
 *   - props: seed, onOpenDetail, onMeshChange (unchanged)
 *   - reads from seed.season + seed.week + seed.goalRace
 *
 * Layout per spec:
 *   - hero: kicker + ROAD TO eyebrow + BASE/BUILD/PEAK/TAPER ptitle +
 *           FOCUS line + right-side wkpill / sline / countdown
 *   - 13-week phase ramp (hover for mi tooltip, click to focus)
 *   - lower dashboard:
 *       row 1: phase-breakdown grid (Base/Build/Peak/Taper)
 *       row 2: THIS WEEK list  ·  PROJECTION card  ·  KEY WORKOUTS
 *   - full-plan modal (Month ↔ Weeks toggle)
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FaffSeed } from '../types';
import { PHASE, SEASON_TYPE_COLOR, type Mesh, type PhaseKey } from '../constants';
import { WhatChangedExpander } from '../toolkit';

interface PhaseMeta {
  k: PhaseKey;
  name: string;
  color: string;
  desc: string;
  weeksLabel: string;
  vol: string;
}

const PHASE_TYPE_COLOR: Record<string, string> = {
  easy: '#2faf7c', long: '#F3AD38', tempo: '#FF8847', threshold: '#FF8847',
  intervals: '#FC4D64', recovery: '#27B4E0', rest: '#8A90A0',
};

/** Resolve the PHASE constant key from a plan_phases.label string. */
function phaseKey(label: string): PhaseKey {
  const s = label.toLowerCase().trim();
  if (s.startsWith('base')) return 'base';
  if (s.startsWith('build')) return 'build';
  if (s.startsWith('peak')) return 'peak';
  if (s.startsWith('taper')) return 'taper';
  if (s.startsWith('race')) return 'race';
  return 'base';
}
function phaseColor(p: PhaseKey): string {
  // Brand effort palette: base ≈ teal, build ≈ amber, peak ≈ orange, taper ≈ green.
  if (p === 'base')  return '#3FB6B0';
  if (p === 'build') return '#E0A23A';
  if (p === 'peak')  return '#FF7A45';
  if (p === 'taper') return '#34C194';
  return '#FFCE8A'; // race
}

/** Group weeks by the REAL plan_phases data from training-state. Falls
 *  back to a heuristic split when no phases are authored (e.g. legacy
 *  plans where plan_phases is empty). */
function phaseGroups(
  raceIdx: number,
  phases: Array<{ label: string; startWeekIdx: number; endWeekIdx: number }>,
): Array<{ phase: PhaseKey; label: string; from: number; to: number }> {
  if (phases && phases.length > 0) {
    return phases
      .filter((p) => p.startWeekIdx < raceIdx)
      .map((p) => ({
        phase: phaseKey(p.label),
        label: p.label,
        from: Math.max(0, p.startWeekIdx),
        to: Math.min(raceIdx - 1, p.endWeekIdx),
      }));
  }
  // Fallback: scale base/build/peak/taper proportionally to plan length.
  const N = raceIdx;
  const split = (frac: number) => Math.max(1, Math.round(N * frac));
  const base = split(0.45);
  const build = split(0.30);
  const peak = split(0.15);
  const groups: Array<{ phase: PhaseKey; label: string; from: number; to: number }> = [];
  let cur = 0;
  if (base > 0)  { groups.push({ phase: 'base',  label: 'Base',  from: cur, to: Math.min(N - 1, cur + base - 1) });  cur += base; }
  if (build > 0 && cur < N) { groups.push({ phase: 'build', label: 'Build', from: cur, to: Math.min(N - 1, cur + build - 1) }); cur += build; }
  if (peak > 0 && cur < N)  { groups.push({ phase: 'peak',  label: 'Peak',  from: cur, to: Math.min(N - 1, cur + peak - 1) });  cur += peak; }
  if (cur < N) groups.push({ phase: 'taper', label: 'Taper', from: cur, to: N - 1 });
  return groups;
}
/** Which group does week i belong to. */
function phaseOfWeek(
  i: number,
  raceIdx: number,
  phases: Array<{ label: string; startWeekIdx: number; endWeekIdx: number }>,
): PhaseKey {
  if (i === raceIdx) return 'race';
  const groups = phaseGroups(raceIdx, phases);
  const g = groups.find((x) => i >= x.from && i <= x.to);
  return g?.phase ?? 'base';
}

/** Per-phase metadata for the breakdown grid. Uses real plan_phases. */
function buildPhaseMeta(
  raceIdx: number,
  phases: Array<{ label: string; startWeekIdx: number; endWeekIdx: number }>,
): PhaseMeta[] {
  return phaseGroups(raceIdx, phases).map((g) => {
    const p = PHASE[g.phase];
    return {
      k: g.phase,
      name: p?.name ?? g.label,
      color: phaseColor(g.phase),
      desc: p?.focus ?? '',
      weeksLabel: g.from === g.to ? `Wk ${g.from + 1}` : `Wk ${g.from + 1}–${g.to + 1}`,
      vol: '', // filled in from miles below
    };
  });
}

export function TrainView({
  seed, onOpenDetail, onMeshChange,
}: {
  seed: FaffSeed;
  onOpenDetail: (dayIdx: number) => void;
  onMeshChange: (mesh: Mesh | null) => void;
}) {
  const { nowIdx, raceIdx, miles, maxMi, phases: realPhases } = seed.season;
  const [focusIdx, setFocusIdx] = useState(nowIdx);
  const [planOpen, setPlanOpen] = useState(false);
  const [planTab, setPlanTab] = useState<'month' | 'weeks'>('month');

  const isRace = focusIdx === raceIdx;
  const curPhase = phaseOfWeek(focusIdx, raceIdx, realPhases);
  const curPhaseMeta = PHASE[curPhase];
  const goal = seed.goalRace;
  const daysOut = (raceIdx - focusIdx) * 7;

  // Per-phase metadata + volume range (compute from miles in that span).
  // Uses REAL plan_phases when present; falls back to a proportional split
  // for legacy plans that didn't author the phases table.
  const phases = useMemo(() => {
    const meta = buildPhaseMeta(raceIdx, realPhases);
    return meta.map((m) => {
      const grp = phaseGroups(raceIdx, realPhases).find((g) => g.phase === m.k);
      if (!grp) return m;
      const slice = miles.slice(grp.from, grp.to + 1).filter((mi) => mi > 0);
      const lo = slice.length ? Math.min(...slice) : 0;
      const hi = slice.length ? Math.max(...slice) : 0;
      const vol = slice.length ? (lo === hi ? `${lo} mi` : `${lo}–${hi} mi`) : '—';
      return { ...m, vol };
    });
  }, [raceIdx, miles, realPhases]);

  // Keep mesh in sync with focused week (lets the Shell mesh follow scrubbing)
  useEffect(() => {
    if (isRace) {
      onMeshChange(curPhaseMeta?.mesh ?? null);
    } else {
      onMeshChange(curPhaseMeta?.mesh ?? null);
    }
    return () => onMeshChange(null);
  }, [focusIdx, isRace, curPhaseMeta, onMeshChange]);

  // Key workouts pulled from real plan: pick the QUALITY day in each future
  // week + label by type. Done past weeks marked done; current week tagged NOW.
  // 2026-05-31: done rows also carry actual pace + influence (hit/miss vs
  // planned target) so the runner can see what each workout did.
  // 2026-05-31 (closed-loop): cross-reference seed.season.adaptations
  // (coach_intents.reason LIKE 'plan_adapt_%') so DONE workouts that
  // triggered a plan change AND future workouts that were modified both
  // surface a follow-on "→ Adapted" line.
  const milestones = useMemo(() => {
    type Mile = {
      wkLabel: string; dot: string; title: string; sub: string;
      state: 'DONE' | 'NOW' | 'KEY' | '' | 'RACE';
      raceRow?: boolean;
      date?: string;
      done?: boolean;
      influence?: { kind: 'hit' | 'close' | 'off'; copy: string } | null;
      adapt?: { kind: 'incoming' | 'outgoing'; copy: string } | null;
    };
    const out: Mile[] = [];
    type DayShape = {
      id?: string;
      dow: string; type: string; name: string; mi: number;
      paceSec: number | null; done: boolean; activityId?: string | null;
      donePaceSec?: number | null; doneAvgHr?: number | null;
      doneSplits?: Array<{ paceSec: number | null; hr: number | null }>;
      date?: string;
    };
    // Quality workouts have a work segment + warmup/recovery/cooldown.
    // The whole-run avg pace buries the rep pace under all the slow miles,
    // so for these types we extract the "work pace" from splits:
    // sort splits by pace, take the fastest N where N = the spec's rep
    // count (default 3), average them. That's a fair stand-in for "did
    // the runner hit the reps."
    const QUALITY_TYPES = new Set(['intervals', 'tempo', 'threshold']);
    function workPaceForQuality(pick: DayShape): number | null {
      const splits = (pick.doneSplits ?? []).map((s) => s.paceSec).filter((p): p is number => p != null && p > 0);
      if (splits.length < 2) return null;
      // N = rep count from spec if known, else min(3, splits.length)
      const repCount = Math.max(2, Math.min(splits.length - 1, 5));
      const sorted = [...splits].sort((a, b) => a - b);
      const fastest = sorted.slice(0, repCount);
      return Math.round(fastest.reduce((s, x) => s + x, 0) / fastest.length);
    }
    const adapts = seed.season.adaptations ?? [];
    const verbForKind = (k: string) => k === 'reschedule' ? 'rescheduled' : k === 'downgrade' ? 'eased' : k === 'shave' ? 'shaved' : 'adjusted';
    seed.season.weekDays.forEach((days, i) => {
      if (i >= raceIdx) return;
      const order = ['intervals', 'tempo', 'long'];
      const pick = days.find((d) => order.includes(d.type)) as DayShape | undefined;
      if (!pick) return;
      const isNow = i === nowIdx;
      const isPast = i < nowIdx;
      const isMid = i > nowIdx;
      const wkLabel = `WK ${i + 1}`;
      const dot = PHASE_TYPE_COLOR[pick.type] ?? '#8A90A0';
      const ttype = pick.type === 'intervals' ? 'Intervals'
        : pick.type === 'tempo' ? 'Tempo'
        : pick.type === 'long' ? 'Long run' : pick.name;
      const title = pick.name || ttype;
      const sub = `${pick.mi.toFixed(1)} mi${pick.paceSec ? ` @ ${Math.floor(pick.paceSec / 60)}:${String(Math.round(pick.paceSec % 60)).padStart(2, '0')}` : ''}`;
      const state: Mile['state'] = isPast ? 'DONE' : isNow ? 'NOW' : isMid && i >= raceIdx - 3 ? 'KEY' : '';
      // Influence: hit/miss vs planned target.
      //   Easy / long  — compare whole-run avg pace (steady aerobic effort).
      //   Quality      — extract WORK pace from the fastest N splits, since
      //                  the avg buries the rep pace under warmup + recovery
      //                  + cooldown miles ("8:36 avg" on a 6:47 rep day).
      // Tolerance is type-aware: intervals/tempo demand tighter execution.
      let influence: Mile['influence'] = null;
      if (state === 'DONE' && pick.paceSec) {
        let comparePace: number | null = null;
        let label = 'actual';
        if (QUALITY_TYPES.has(pick.type)) {
          comparePace = workPaceForQuality(pick);
          label = 'work pace';
        } else {
          comparePace = pick.donePaceSec ?? null;
        }
        if (comparePace) {
          const delta = comparePace - pick.paceSec;
          const tol = pick.type === 'long' ? 18 : 12; // s/mi
          if (Math.abs(delta) <= tol) {
            influence = { kind: 'hit', copy: `Hit · ${fmtPace(comparePace)} ${label}` };
          } else if (delta > 0 && delta <= tol * 2) {
            influence = { kind: 'close', copy: `Just off · ${fmtPace(comparePace)} ${label}` };
          } else if (delta > 0) {
            influence = { kind: 'off', copy: `Off pace · ${fmtPace(comparePace)} ${label}` };
          } else {
            influence = { kind: 'hit', copy: `Faster · ${fmtPace(comparePace)} ${label}` };
          }
        } else if (pick.donePaceSec) {
          // Quality workout with no usable splits — fall back to a neutral
          // "Logged" tag instead of falsely claiming "off pace" from the
          // whole-run avg (the bug David caught: 8:36 avg on a 6:47 rep day).
          influence = { kind: 'hit', copy: 'Logged' };
        }
      }
      // Adaptation cross-reference. Two angles:
      // 1. INCOMING — this week's quality day was itself modified by an
      //    adapt (coach_intents row targeting pick.id). Render on FUTURE
      //    rows: "← Adapted: eased, was tempo" so the runner sees the
      //    plan changed under them.
      // 2. OUTGOING — this week's DONE workout triggered an adapt that
      //    modified a LATER week. Render on DONE rows: "→ Triggered:
      //    Wk N tempo eased" so the runner sees the closed loop.
      let adapt: Mile['adapt'] = null;
      if (pick.id) {
        // Incoming: adapt directly targeting this week's quality workout.
        const incoming = adapts.find((a) => a.workoutId === pick.id);
        if (incoming && (isMid || isNow)) {
          const v = verbForKind(incoming.kind);
          const noun = incoming.newType ? ` to ${incoming.newType}` : '';
          adapt = { kind: 'incoming', copy: `Adapted: ${v}${noun} — ${shortWhy(incoming.why)}` };
        }
        // Outgoing: any adapt to a LATER week's workout, applied within
        // 3 days after this DONE workout (treats this week's result as
        // the trigger). Pick the closest match.
        if (!adapt && state === 'DONE' && pick.date) {
          const triggerMs = Date.parse(pick.date + 'T12:00:00Z');
          const candidates = adapts
            .filter((a) => a.weekIdx > i)
            .map((a) => ({ a, dt: Date.parse(a.ts) - triggerMs }))
            .filter((x) => x.dt >= 0 && x.dt <= 4 * 86400000);
          if (candidates.length > 0) {
            candidates.sort((a, b) => a.dt - b.dt);
            const a = candidates[0].a;
            const v = verbForKind(a.kind);
            adapt = { kind: 'outgoing', copy: `Triggered: Wk ${a.weekIdx + 1} ${v}` };
          }
        }
      }
      out.push({ wkLabel, dot, title, sub, state, date: pick.date, done: !!pick.done, influence, adapt });
    });
    if (goal) {
      out.push({
        wkLabel: 'RACE', dot: '#FFCE8A',
        title: goal.name, sub: `${goal.goal ? 'Sub ' + goal.goal + ' · ' : ''}${formatDate(goal.date)}`,
        state: 'RACE', raceRow: true,
      });
    }
    return out.slice(0, 9);
  }, [seed.season.weekDays, nowIdx, raceIdx, goal]);

  // Phase-ramp metadata aligned with the REAL plan_phases (for the bottom axis)
  const phaseAxis = useMemo(() => {
    const out: Array<{ key: PhaseKey; flex: number; color: string; label: string }> = [];
    phaseGroups(raceIdx, realPhases).forEach((g) => {
      out.push({ key: g.phase, flex: g.to - g.from + 1, color: phaseColor(g.phase), label: g.label });
    });
    out.push({ key: 'race', flex: 1, color: '#FFCE8A', label: 'Race' });
    return out;
  }, [raceIdx, realPhases]);

  function openPlan(tab: 'month' | 'weeks' = 'month') {
    setPlanTab(tab);
    setPlanOpen(true);
  }

  return (
    <div className="train2">
      {/* Header */}
      <div className="t-htop">
        <div>
          <div className="t-kicker">
            <span style={{ opacity: 0.92 }}>{(curPhaseMeta?.name ?? '—').toUpperCase()} PHASE · WEEK {focusIdx + 1}</span>
            <br />
            <span style={{ opacity: 0.74, letterSpacing: 1, fontWeight: 600 }}>
              {goal ? `${goal.name}${goal.location ? ' · ' + goal.location : ''} · ${formatDate(goal.date)}` : 'No goal race set'}
            </span>
          </div>
          <div className="t-eyebrow">
            ROAD TO <b>{(goal?.name ?? 'GOAL').split(' ')[0].toUpperCase()}</b>{goal ? ` · SUB ${goal.goal}` : ''}
          </div>
          <div className="t-ptitle">{isRace ? 'RACE DAY' : (curPhaseMeta?.name ?? '—')}</div>
          <div className="t-focus">
            <span className="ftag">FOCUS</span>
            <span className="ftx">{curPhaseMeta?.focus ?? 'Active block.'}</span>
          </div>
        </div>
        <div className="t-status">
          <span className="t-wkpill">
            <span className="dot" style={{ background: phaseColor(curPhase), boxShadow: `0 0 8px ${phaseColor(curPhase)}` }} />
            WK {focusIdx + 1} · {miles[focusIdx]} MI
          </span>
          <span className="sline">{(curPhaseMeta?.name ?? '—').toUpperCase()} · {(curPhaseMeta?.lab ?? '').toUpperCase()}</span>
          <span className="cd">
            {isRace ? <>Race day. It&rsquo;s here.</> : <><b>{daysOut}</b> days to the start line</>}
          </span>
        </div>
      </div>

      {/* Phase ramp */}
      <div className="ramp-wrap">
        <div className="ramp-head">
          <span className="lbl">{raceIdx}-WEEK BLOCK · WEEKLY VOLUME</span>
          <button className="ghostbtn" onClick={() => openPlan('month')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>
            FULL PLAN
          </button>
        </div>
        <div className="ramp">
          {miles.map((mi, i) => {
            const h = mi > 0 ? Math.round((mi / Math.max(maxMi, 1)) * 100) : 6;
            const ph = phaseOfWeek(i, raceIdx, realPhases);
            const isCur = i === focusIdx;
            const isPast = i < nowIdx;
            return (
              <div
                key={i}
                className={`bar${isCur ? ' cur' : ''}`}
                style={{ height: `${h}%`, background: phaseColor(ph), opacity: isPast && !isCur ? 0.62 : 1 }}
                title={`Week ${i + 1} · ${mi} mi`}
                onClick={() => setFocusIdx(i)}
                role="button"
                tabIndex={0}
              >
                <span className="bmi">{mi}</span>
              </div>
            );
          })}
          <div
            className={`bar race${focusIdx === raceIdx ? ' cur' : ''}`}
            style={{ height: '30%' }}
            title="Race day"
            onClick={() => openPlan('weeks')}
            role="button"
            tabIndex={0}
          />
        </div>
        <div className="ramp-nums">
          {miles.map((_, i) => <span key={i}>{i + 1}</span>)}
          <span style={{ color: '#FFCE8A', opacity: 0.85 }}>★</span>
        </div>
        <div className="ramp-phases">
          {phaseAxis.map((p, i) => (
            <div key={i} className="pp" style={{ flex: p.flex, color: p.color }}>
              {p.label.toUpperCase()}
            </div>
          ))}
        </div>
      </div>

      {/* Lower dashboard */}
      <div className="lower">
        {/* Phase breakdown grid */}
        <div className="phgrid">
          {phases.map((p) => {
            const now = p.k === curPhase;
            return (
              <div className={`phase${now ? ' now' : ''}`} key={p.k}>
                <span className="pbar" style={{ background: p.color }} />
                {now && <span className="nowtag">NOW</span>}
                <div className="pnm" style={{ color: p.color }}>{p.name}</div>
                <div className="pwk">{p.weeksLabel.toUpperCase()}</div>
                <div className="pdesc">{p.desc}</div>
                <div className="pvol">{p.vol} <small>TARGET VOL</small></div>
              </div>
            );
          })}
        </div>

        {/* This week · Projection · Key workouts */}
        <div className="arow">
          {/* THIS WEEK list */}
          <div className="card">
            <div className="ch">
              <span className="ct">THIS WEEK · WK {nowIdx + 1}</span>
              <span className="cx">{miles[nowIdx]} MI PLANNED</span>
            </div>
            <div className="twk">
              {seed.week.map((d, wi) => {
                const col = SEASON_TYPE_COLOR[d.type as keyof typeof SEASON_TYPE_COLOR] ?? '#8A90A0';
                const meta = d.dist === ' · ' ? 'rest' : `${d.dist} mi · ${d.pace}`;
                return (
                  <div
                    key={wi}
                    className={`twr${d.today ? ' today' : ''}${d.skipped ? ' skipped' : ''}`}
                    style={{ cursor: 'pointer' }}
                    onClick={() => onOpenDetail(wi)}
                    role="button"
                    tabIndex={0}
                  >
                    <span className="tdw">{d.dw}</span>
                    <span className="tdot" style={{ background: col }} />
                    <span className="tnm">{d.name}</span>
                    <span className="tmeta">{meta}</span>
                    {d.skipped ? null : d.done ? (
                      <span style={{ marginLeft: 10, display: 'flex', alignItems: 'center' }}>
                        <svg className="tck" viewBox="0 0 24 24" fill="none" stroke="#3EBD41" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
                      </span>
                    ) : d.today ? (
                      <span style={{ marginLeft: 10, fontSize: 9, fontWeight: 800, letterSpacing: 1, color: '#FFCE8A' }}>TODAY</span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          {/* PROJECTION card */}
          <div className="card proj">
            <div className="ch">
              <span className="ct">PROJECTION</span>
              <span className="cx">{goal ? `vs Sub ${goal.goal}` : '—'}</span>
            </div>
            {goal?.projected ? (
              <>
                <div className="pjbig" style={{ color: goal.onTrack ? '#86efa0' : '#FFCE8A' }}>{goal.projected}</div>
                <div className="pjlab">PROJECTED FINISH TODAY</div>
                <div className="pjbar">
                  <i style={{ width: `${Math.min(100, goal.goalPct ?? 80)}%` }} />
                  <span className="goalmark" style={{ left: '92%' }} />
                </div>
                <div className="pjrow">
                  <span>Goal {goal.goal}</span>
                  <span><b>{goal.delta}</b></span>
                </div>
                <div className="pjnote">
                  {goal.onTrack
                    ? 'On track. The threshold work in Build is what closes the last 100 seconds. Hold the easy days easy.'
                    : 'Behind goal. The next threshold blocks close the gap — protect them.'}
                </div>
              </>
            ) : (
              <>
                <div className="pjbig" style={{ opacity: 0.55 }}>—</div>
                <div className="pjlab">NO RACE GOAL SET</div>
                <div className="pjnote">Pick a primary race on /races to see the projection.</div>
              </>
            )}
          </div>

          {/* KEY WORKOUTS list */}
          <div className="card">
            <div className="ch"><span className="ct">KEY WORKOUTS TO RACE</span></div>
            <div className="miles">
              {milestones.map((m, i) => (
                <div key={i} className={`mile${m.state === 'DONE' ? ' done' : ''}${m.raceRow ? ' race' : ''}`}>
                  <span className="mwk">{m.wkLabel}</span>
                  <span className="mdot" style={{ background: m.dot }} />
                  <div className="mtx">
                    <div className="mtt">{m.title}</div>
                    <div className="mss">{m.sub}</div>
                    {m.influence && (
                      <div className="minf" style={{
                        color: m.influence.kind === 'hit'   ? '#86efa0'
                              : m.influence.kind === 'close' ? '#FFCE8A'
                              :                                 '#FF9560',
                      }}>
                        → {m.influence.copy}
                      </div>
                    )}
                    {m.adapt && (
                      <div className="minf madapt">
                        {m.adapt.kind === 'incoming' ? '← ' : '→ '}{m.adapt.copy}
                      </div>
                    )}
                  </div>
                  {m.state && (
                    <span className="mst" style={m.state === 'NOW' ? { color: '#FFCE8A', opacity: 0.95 } : undefined}>
                      {m.state}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Plan mutation history · WhatChangedExpander filters
              coach_intents to reason LIKE 'plan_adapt_%'. Closes
              coverage lines 487 (plan mutation history) + 580
              (9 adaptation trigger types). */}
          <div style={{ marginTop: 18 }}>
            <WhatChangedExpander label="PLAN ADJUSTMENTS" reasonPrefix="plan_adapt" />
          </div>
        </div>
      </div>

      {/* Full-plan modal */}
      {planOpen && (
        <PlanModal
          tab={planTab}
          onSetTab={setPlanTab}
          onClose={() => setPlanOpen(false)}
          seed={seed}
          focusIdx={focusIdx}
          setFocusIdx={setFocusIdx}
        />
      )}
    </div>
  );
}

/* ─────────────────────────  Full-plan modal  ───────────────────────── */

function PlanModal({
  tab, onSetTab, onClose, seed, focusIdx, setFocusIdx,
}: {
  tab: 'month' | 'weeks';
  onSetTab: (t: 'month' | 'weeks') => void;
  onClose: () => void;
  seed: FaffSeed;
  focusIdx: number;
  setFocusIdx: (i: number) => void;
}) {
  const goal = seed.goalRace;
  return (
    <div className="train2-ov" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="train2-sheet">
        <div className="sheet-top">
          <div>
            <div className="stt">Full plan</div>
            <div className="sts">{goal ? `${goal.name} · ${seed.season.raceIdx} weeks · Sub ${goal.goal}` : 'No goal race set'}</div>
          </div>
          <div className="seg">
            <button className={tab === 'month' ? 'on' : ''} onClick={() => onSetTab('month')}>Month</button>
            <button className={tab === 'weeks' ? 'on' : ''} onClick={() => onSetTab('weeks')}>Weeks</button>
          </div>
          <button className="sheet-x" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div className="sheet-body">
          {tab === 'month' ? <MonthCalendar seed={seed} /> : (
            <WeeksList seed={seed} focusIdx={focusIdx} onPick={(i) => { setFocusIdx(i); onClose(); }} />
          )}
        </div>
      </div>
    </div>
  );
}

function MonthCalendar({ seed }: { seed: FaffSeed }) {
  const goal = seed.goalRace;
  const today = new Date();
  // Auto-scroll the calendar to today's row when the modal opens. Each
  // today cell is tagged id="cal-today"; on mount we walk up to its
  // calmonth row and scroll it to the top of the visible viewport.
  // Closes David's "the top should be the current week" ask from the
  // FULL PLAN screenshot.
  const calRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const t = calRef.current?.querySelector('#cal-today');
    if (t && typeof (t as HTMLElement).scrollIntoView === 'function') {
      (t as HTMLElement).scrollIntoView({ block: 'start', behavior: 'auto' });
    }
  }, []);
  // Build all plan days into a Map<YYYY-MM-DD, day>
  const planMap = new Map<string, { type: string; name: string; mi: number; paceSec: number | null }>();
  // weekDays now carry `date` directly (fixed 2026-05-31 · the seed
  // builder was dropping training.weeks[i].days[j].date on the floor so
  // the calendar rendered every cell empty even though the plan had
  // workouts). Calendar now anchors each workout to its real slot.
  seed.season.weekDays.forEach((wkDays) => {
    wkDays.forEach((d) => {
      if (d.date) planMap.set(d.date, { type: d.type, name: d.name, mi: d.mi, paceSec: d.paceSec });
    });
  });

  // 2026-05-31: pick months from today forward through the race month.
  // Original window was today-1 → today+2 which surfaced backdated empty
  // months when the plan hadn't started yet (e.g. April was empty on May
  // 31 because David's plan begins next week). The fix is to anchor the
  // calendar on today's month and extend forward only — past the race if
  // there's no race set, otherwise stop at the race month.
  //
  // We compute the last month from goal.date when present (with a 1-month
  // floor to always show at least the current + next month even on
  // maintenance plans without a race anchor). When the plan extends well
  // past the race we still want the runner to see the months they're
  // training in, not arbitrary calendar fluff after.
  const months: Array<{ y: number; m: number; nm: string }> = [];
  const startY = today.getFullYear();
  const startM = today.getMonth();
  const goalDateRaw = goal?.date ? new Date(goal.date) : null;
  const goalY = goalDateRaw && Number.isFinite(goalDateRaw.getTime()) ? goalDateRaw.getFullYear() : startY;
  const goalM = goalDateRaw && Number.isFinite(goalDateRaw.getTime()) ? goalDateRaw.getMonth() : startM + 1;
  // Total months from today's month → race month (inclusive). Floor at 2
  // so we always render at least current + next month, ceiling at 8 so
  // a 6-month-out race doesn't render 7 months of empty cells either.
  const rawMonthsToRace = (goalY - startY) * 12 + (goalM - startM);
  const monthCount = Math.max(2, Math.min(8, rawMonthsToRace + 1));
  for (let off = 0; off < monthCount; off++) {
    const dt = new Date(startY, startM + off, 1);
    months.push({
      y: dt.getFullYear(),
      m: dt.getMonth(),
      nm: dt.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
    });
  }
  const DOW_LBL = ['M','T','W','T','F','S','S'];
  const tint = (c: string) => ({ background: `${c}38`, color: c });

  return (
    <div className="cal" ref={calRef}>
      {months.map((mo) => {
        const first = new Date(mo.y, mo.m, 1);
        const lead = (first.getDay() + 6) % 7;
        const daysInMonth = new Date(mo.y, mo.m + 1, 0).getDate();
        const cells: React.ReactNode[] = [];
        DOW_LBL.forEach((d, i) => cells.push(<div key={`dow-${i}`} className="cal-dow">{d}</div>));
        for (let i = 0; i < lead; i++) cells.push(<div key={`e-${i}`} className="cell empty" />);
        for (let dd = 1; dd <= daysInMonth; dd++) {
          const date = new Date(mo.y, mo.m, dd);
          const iso = date.toISOString().slice(0, 10);
          const isToday = date.toDateString() === today.toDateString();
          const isRace = goal && goal.date.slice(0, 10) === iso;
          const past = date < today && !isToday;
          const w = planMap.get(iso);
          const cls = `cell${isToday ? ' today' : ''}${isRace ? ' race' : ''}${past ? ' past' : ''}`;
          let body: React.ReactNode = null;
          if (isRace) {
            body = (
              <div className="cwk">
                <span className="ctag" style={tint('#FFCE8A')}>Race</span>
                <div className="cmeta">Race<small> · {goal!.goal}</small></div>
                <div className="cdet">{goal!.name}</div>
              </div>
            );
          } else if (w && w.type === 'rest') {
            body = <span className="crest">Rest day</span>;
          } else if (w) {
            const c = PHASE_TYPE_COLOR[w.type] ?? '#8A90A0';
            const pace = w.paceSec ? ` · ${Math.floor(w.paceSec / 60)}:${String(Math.round(w.paceSec % 60)).padStart(2, '0')}` : '';
            body = (
              <div className="cwk">
                <span className="ctag" style={tint(c)}>{w.name}</span>
                <div className="cmeta">{w.mi.toFixed(1)}<small> mi{pace}</small></div>
              </div>
            );
          }
          cells.push(
            <div key={`d-${dd}`} className={cls} id={isToday ? 'cal-today' : undefined}>
              <div className="cd">{dd}</div>
              {body}
            </div>
          );
        }
        return (
          <div className="calmonth" key={`${mo.y}-${mo.m}`}>
            <div className="cm-h">{mo.nm}</div>
            <div className="cal-grid">{cells}</div>
          </div>
        );
      })}
    </div>
  );
}

function WeeksList({ seed, focusIdx, onPick }: { seed: FaffSeed; focusIdx: number; onPick: (i: number) => void }) {
  const { miles, maxMi, raceIdx, phases } = seed.season;
  const groups = phaseGroups(raceIdx, phases);
  const goal = seed.goalRace;
  return (
    <div className="weeklist">
      {groups.map((g) => (
        <div key={`${g.label}-${g.from}`}>
          <div className="phlabel" style={{ color: phaseColor(g.phase) }}>
            {g.label.toUpperCase()}
            <span className="pl-line" style={{ background: `${phaseColor(g.phase)}33` }} />
          </div>
          {Array.from({ length: g.to - g.from + 1 }, (_, k) => {
            const i = g.from + k;
            const mi = miles[i] ?? 0;
            const dayList = seed.season.weekDays[i] ?? [];
            const quality = dayList.find((d) => ['intervals','tempo','long'].includes(d.type));
            const key = quality
              ? `${quality.type === 'intervals' ? 'Intervals' : quality.type === 'tempo' ? 'Tempo' : 'Long run'} · ${quality.mi.toFixed(1)} mi`
              : 'Easy week';
            return (
              <div
                key={i}
                className={`wkrow${i === focusIdx ? ' cur' : ''}`}
                onClick={() => onPick(i)}
                role="button"
                tabIndex={0}
              >
                <span className="wn">{i + 1}</span>
                <span className="wbar"><i style={{ width: `${Math.round((mi / Math.max(maxMi, 1)) * 100)}%`, background: phaseColor(g.phase) }} /></span>
                <span className="wkey">{key}</span>
                <span className="wmi">{mi} mi</span>
              </div>
            );
          })}
        </div>
      ))}
      {goal && (
        <>
          <div className="phlabel" style={{ color: '#FFCE8A' }}>
            RACE<span className="pl-line" style={{ background: '#FFCE8A33' }} />
          </div>
          <div className="wkrow race">
            <span className="wn">★</span>
            <span className="wkey">{goal.name} · Sub {goal.goal}</span>
            <span className="wmi">{formatDate(goal.date)}</span>
          </div>
        </>
      )}
    </div>
  );
}

function fmtPace(sec: number | null | undefined): string {
  if (!sec || sec <= 0) return '·';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
/** Trim coach_intents adapt `why` strings into a 5-6 word tag for the
 *  KEY WORKOUTS row. Full prose lives in the briefing voice; this card
 *  just wants enough to know what the signal was. */
function shortWhy(why: string): string {
  if (!why) return 'signal';
  const w = why.toLowerCase();
  if (w.includes('rhr'))             return 'RHR spike';
  if (w.includes('sleep'))           return 'sleep deficit';
  if (w.includes('niggle'))          return 'niggle';
  if (w.includes('sick'))            return 'illness';
  if (w.includes('injury'))          return 'injury';
  if (w.includes('overshoot') || w.includes('cap')) return 'volume cap';
  if (w.includes('missed') || w.includes('uncompleted')) return 'missed session';
  if (w.includes('vdot') || w.includes('pr'))            return 'PR / VDOT bump';
  // Fall back to first 6 words.
  return why.split(/\s+/).slice(0, 6).join(' ');
}
function formatDate(iso: string): string {
  if (!iso) return '·';
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d);
}
